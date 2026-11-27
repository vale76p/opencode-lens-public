// Editing the lens's environment from the dashboard ("Impostazioni").
// The source of truth stays the LaunchAgent's EnvironmentVariables, which
// install.sh keeps on reinstall: a change is validated with the startup rules,
// written to the plist and applied by reloading the service, because launchd
// caches a job's environment until it is booted out and bootstrapped again.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { DEPRECATED_VARS, KNOWN_VARS, loadConfig } from "./config.js";
import { errorText, LANGS, LOCALES, t } from "../public/i18n.js";
import { LAUNCHD_LABEL, PLIST_PATH, VARS, launchdLogPath } from "./about.js";
import { periodBounds } from "./period.js";
import { formatPrice, isPriceKey, parsePrice } from "./prices.js";
import { redactUrl } from "./url.js";
import { parseTokens } from "../public/token-units.js";

const CHOICES = {
  LENS_STORE_TITLES: ["1", "0"],
  LENS_LOG_LEVEL: ["debug", "info", "warn", "error"],
  LENS_OTLP_TEMPORALITY: ["cumulative", "delta"],
  LENS_OTLP_TRACES: ["1", "0"],
  LENS_LANG: ["auto", ...LANGS],
  LENS_LOCALE: ["auto", ...LOCALES],
};
const MAX_VALUE = 4096;
// LENS_MODEL_LIMITS is written only from the «Budget per modello» card, for the models of OpenCode's configuration
const MODEL_VAR = "LENS_MODEL_LIMITS";
// LENS_MODEL_PRICES is written only from the «Listino prezzi» card
const PRICE_VAR = "LENS_MODEL_PRICES";
const MANAGED = new Map([
  [MODEL_VAR, () => t("{name} si imposta dalla sezione «Budget per modello», con i modelli della configurazione di OpenCode", { name: MODEL_VAR })],
  [PRICE_VAR, () => t("{name} si imposta dalla sezione «Listino prezzi»", { name: PRICE_VAR })],
]);
const DAY_MS = 86_400_000;
// a variable the lens no longer reads (DEPRECATED_VARS) is only removed, never set again
const deprecated = (name) => t(DEPRECATED_VARS.get(name), { name });
// one parser for the page and the server: "100M", "1,5M", "500k" → tokens
export { parseTokens };

/**
 * "a/b=1,c/d=2" → [["a/b", 1], ["c/d", 2]], split like loadConfig does. Entries loadConfig
 * would refuse (a hand edit of the plist) are left out, so the next save drops them
 * instead of every save failing on them.
 */
function limitPairs(value) {
  const out = new Map();
  for (const item of (value ?? "").split(",").map((s) => s.trim())) {
    const i = item.indexOf("=");
    const model = item.slice(0, i).trim();
    const n = item.slice(i + 1).trim();
    const slash = model.indexOf("/");
    if (i > 0 && slash > 0 && slash < model.length - 1 && /^\d+$/.test(n) && Number(n) > 0 && !out.has(model)) out.set(model, Number(n));
  }
  return [...out];
}

/**
 * "a/b=3:15,…" → Map model → price, keeping only the entries isPriceKey and parsePrice accept (the same rule as loadConfig).
 */
function pricePairs(value) {
  const out = new Map();
  for (const item of (value ?? "").split(",").map((s) => s.trim())) {
    const i = item.indexOf("=");
    const model = item.slice(0, i).trim();
    const price = parsePrice(item.slice(i + 1).trim());
    if (i > 0 && isPriceKey(model) && price && !out.has(model)) out.set(model, price);
  }
  return out;
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const CONTROL = /[\u0000-\u001f\u007f]/;
const WILDCARD = new Set(["0.0.0.0", "::"]);

export class SettingsError extends Error {
  constructor(status, errors) {
    super(errors.join("; "));
    this.status = status;
    this.errors = errors;
  }
}

/** Keys of a plist through plutil (macOS). */
export const plutil = {
  /** One top-level key as JSON, undefined when the plist does not have it. */
  extract(file, key) {
    try {
      return JSON.parse(execFileSync("plutil", ["-extract", key, "json", "-o", "-", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    } catch (err) {
      if (/No value at that key path/.test(err.stderr ?? "")) return undefined;
      throw new Error(t("impossibile leggere {file}: {why}", { file, why: (err.stderr || err.message).trim() }));
    }
  },
  /** EnvironmentVariables as strings, {} when there are none. */
  read(file) {
    return Object.fromEntries(Object.entries(this.extract(file, "EnvironmentVariables") ?? {}).map(([k, v]) => [k, String(v)]));
  },
  write(file, vars) {
    // edit a copy, check it, then swap it in: a failed write never leaves half a plist
    const tmp = `${file}.lens-tmp`;
    try {
      fs.copyFileSync(file, tmp);
      fs.chmodSync(tmp, 0o600); // the values may be secrets; also fixes a plist written 0644 by older versions
      execFileSync("plutil", ["-replace", "EnvironmentVariables", "-json", JSON.stringify(vars), tmp], { stdio: ["ignore", "ignore", "pipe"] });
      execFileSync("plutil", ["-lint", tmp], { stdio: ["ignore", "ignore", "pipe"] });
      fs.renameSync(tmp, file);
    } catch (err) {
      // execFileSync's message carries the command line, i.e. every value with the secrets: keep only stderr
      const why = String(err.stderr ?? "").trim() || (err.code ? t("errore {code}", { code: err.code }) : t("errore sconosciuto"));
      throw new SettingsError(500, [t("impossibile scrivere {file}: {why}", { file, why })]);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  },
};

/**
 * The reload helper ($1 domain, $2 label, $3 plist). launchd refuses to bootstrap a disabled job (the Monitor disables it
 * when «Avvia lens al login» is off), so the job is enabled first and the user's choice is put back afterwards.
 */
export const RELOAD_SCRIPT = [
  "sleep 1",
  "was_disabled=0",
  'launchctl print-disabled "$1" 2>/dev/null | grep -qF -e "\\"$2\\" => disabled" -e "\\"$2\\" => true" && was_disabled=1',
  'launchctl bootout "$1/$2" 2>/dev/null',
  'launchctl enable "$1/$2"',
  "ok=1",
  'for i in 1 2 3 4 5 6 7 8 9 10; do launchctl bootstrap "$1" "$3" && ok=0 && break; sleep 1; done',
  '[ "$was_disabled" = 1 ] && launchctl disable "$1/$2"',
  '[ "$ok" = 0 ] && exit 0',
  'echo "opencode-lens: riavvio dopo la modifica delle impostazioni non riuscito: launchctl bootstrap $1 $3" >&2',
  "exit 1",
].join("\n");

/**
 * Reloads the LaunchAgent so it starts again with the plist's environment.
 * Runs in its own session: bootout stops this process and its process group,
 * and the helper has to outlive it to bootstrap the job again.
 */
export function reloadService({ label = LAUNCHD_LABEL, plistPath = PLIST_PATH } = {}) {
  const domain = `gui/${os.userInfo().uid}`;
  const script = RELOAD_SCRIPT;
  const logPath = launchdLogPath(plistPath);
  let out = "ignore";
  try {
    if (logPath) out = fs.openSync(logPath, "a");
  } catch {
    /* no log: the helper runs silent */
  }
  spawn("/bin/sh", ["-c", script, "sh", domain, label, plistPath], { detached: true, stdio: ["ignore", out, out] }).unref();
  if (typeof out === "number") fs.closeSync(out);
}

/** true when nothing listens on host:port (the port a change moves the lens to). */
export function portFree(host, port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

function configErrors(err) {
  return err.message
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
}

export class Settings {
  /**
   * @param {{ config: object, env?: Record<string,string|undefined>, plistPath?: string, label?: string, platform?: string,
   *   io?: { read(file: string): Record<string,string>, write(file: string, vars: Record<string,string>): void },
   *   reload?: (o: { label: string, plistPath: string }) => void, isPortFree?: (host: string, port: number) => Promise<boolean>,
   *   moduleVars?: Set<string>, modules?: { validateEnv(env: object, enabled: string[]): Promise<object[]> } }} o
   *   moduleVars: the variables the modules declare (moduleVars in src/modules.js), editable like the core's;
   *   modules: the registry, which checks them for the modules on after a save
   */
  constructor({
    config,
    env = process.env,
    plistPath = PLIST_PATH,
    label = LAUNCHD_LABEL,
    platform = process.platform,
    io = plutil,
    reload = reloadService,
    isPortFree = portFree,
    models = null,
    queries = null,
    moduleVars = new Set(),
    modules = null,
  }) {
    // models: OpenCode's configured models ({ current() }); queries: today's tokens per model
    Object.assign(this, { config, env, plistPath, label, platform, io, reload, isPortFree, models, queries, moduleVars, modules });
    this.restarting = false;
    this.plistCache = null; // values(): { key: "mtime:size", values }
  }

  /** A variable this page writes: the core's or a module's. */
  known(name) {
    return KNOWN_VARS.has(name) || this.moduleVars.has(name);
  }

  /**
   * The variables as the page shows them (the modules' fields): the plist's when it can write, otherwise those in use.
   * plutil blocks the event loop and GET /api/modules asks for them often (the MCP polls it): the plist is read again
   * only when its mtime or size changes, or after a save.
   */
  values() {
    if (this.blocked()) return this.env;
    try {
      const st = fs.statSync(this.plistPath);
      const key = `${st.mtimeMs}:${st.size}`;
      if (this.plistCache?.key !== key) this.plistCache = { key, values: this.io.read(this.plistPath) };
      return this.plistCache.values;
    } catch {
      this.plistCache = null;
      return this.env;
    }
  }

  /** Which condition keeps the page from writing: "platform" · "no-plist" · "manual", or null when it can. */
  blockedKind() {
    if (this.platform !== "darwin") return "platform";
    if (!fs.existsSync(this.plistPath)) return "no-plist";
    if (this.env.XPC_SERVICE_NAME !== this.label) return "manual";
    return null;
  }

  /** Why the page cannot write, or null when it can. */
  blocked() {
    switch (this.blockedKind()) {
      case "platform":
        return t("Le variabili si modificano dalla dashboard solo con il servizio di macOS (opencode-lens service install).");
      case "no-plist":
        return t("LaunchAgent non trovato ({path}): installa il servizio con opencode-lens service install per modificarle da qui.", { path: this.plistPath });
      case "manual":
        return t("La lens è stata avviata a mano (npm start), non da launchd: le variabili vengono dalla shell. Installala come servizio con opencode-lens service install per modificarle da qui.");
      default:
        return null;
    }
  }

  /** Whether `plist` (its variables) has a variable of the lens or of a module edited by hand and not reloaded yet. */
  pendingIn(plist) {
    return [...KNOWN_VARS, ...this.moduleVars].some((k) => (plist[k] ?? "") !== (this.env[k] ?? ""));
  }

  /**
   * The plist read now, for a restart: { pending } (variables not applied yet) and `error` when it cannot be read.
   * Nothing to say when the page cannot write it (blocked(): restartBlocked() gives that reason first).
   */
  plistCheck() {
    if (this.blocked()) return { pending: false, error: null };
    try {
      return { pending: this.pendingIn(this.io.read(this.plistPath)), error: null };
    } catch (err) {
      return { pending: false, error: err.message };
    }
  }

  /**
   * Why the lens cannot restart itself from the dashboard, or null when it can: not under launchd, a plist that cannot
   * be read (bootout, then a bootstrap that fails, would leave the lens down), or a plist edited by hand and not applied
   * yet (launchctl would load it without the checks of «Salva e riavvia»). `plist` ({ pending, error }): already read by
   * the caller, so it is not read twice.
   */
  restartBlocked({ plist } = {}) {
    switch (this.blockedKind()) {
      case "platform":
        return t("La lens si riavvia dalla dashboard solo con il servizio di macOS (opencode-lens service install).");
      case "no-plist":
        return t("LaunchAgent non trovato ({path}): installa il servizio con opencode-lens service install per riavviare la lens da qui.", { path: this.plistPath });
      case "manual":
        return t("La lens è stata avviata a mano (npm start), non da launchd: riavviala da dove l'hai avviata, oppure installala come servizio con opencode-lens service install.");
      default: {
        const { pending, error } = plist ?? this.plistCheck();
        if (error) return t("Il plist del servizio non si legge ({error}): correggilo prima di riavviare.", { error });
        return pending ? t("Ci sono variabili modificate nel plist e non ancora applicate: applicale (Salva e riavvia) prima di aggiornare.") : null;
      }
    }
  }

  /** { available, reason } of the restart button for a client: `local` is a client on this computer. */
  restartState(local, { plist } = {}) {
    const reason = local ? this.restartBlocked({ plist }) : t("{what} si chiede solo da questo computer", { what: t("il riavvio") });
    return { available: !reason, reason };
  }

  /**
   * POST /api/restart: reloads the service as a save does, without touching the plist. Refused (409) outside launchd,
   * and while a restart is already under way.
   */
  restart() {
    const reason = this.restartBlocked();
    if (reason) throw new SettingsError(409, [reason]);
    if (this.restarting) throw new SettingsError(409, [t("La lens si sta già riavviando.")]);
    this.restarting = true;
    this.reload({ label: this.label, plistPath: this.plistPath });
    return { restarting: true };
  }

  /**
   * GET /api/settings: plist values (never secrets) and whether the process lags behind them.
   * `local` (a client on this computer) gets LENS_OTLP_ENDPOINT as written; the others get it
   * redacted, as /api/about shows it: its credentials or ?api_key= are readable with the read token.
   */
  status({ local = false } = {}) {
    const reason = this.blocked();
    let plist = {};
    let readError = null;
    if (!reason) {
      try {
        plist = this.io.read(this.plistPath);
      } catch (err) {
        readError = err.message;
      }
    }
    const editable = !reason && !readError;
    // edited by hand and not reloaded yet
    const pending = editable && this.pendingIn(plist);
    const cfg = this.models?.current(); // read once for both cards
    return {
      editable,
      reason: reason ?? readError,
      plist: this.plistPath,
      pid: process.pid,
      restarting: this.restarting,
      // POST /api/restart: only a client on this computer, only under launchd, and not over a pending plist
      restart: this.restartState(local, { plist: { pending, error: reason ? null : readError } }),
      pending,
      vars: VARS.map(([name, , help, secret]) => ({
        name,
        help,
        secret: !!secret,
        choices: CHOICES[name] ?? null,
        set: plist[name] !== undefined && plist[name] !== "",
        value: secret ? "" : name === "LENS_OTLP_ENDPOINT" && plist[name] && !local ? redactUrl(plist[name]) : (plist[name] ?? ""),
        managed: MANAGED.has(name),
      })),
      unknown: Object.keys(plist).filter((k) => !this.known(k) && !DEPRECATED_VARS.has(k) && k.startsWith("LENS_")).sort(),
      // in the plist but no longer read (src/config.js): the page offers to remove them
      deprecated: Object.keys(plist).filter((k) => DEPRECATED_VARS.has(k) && plist[k] !== "").sort(),
      models: this.modelStatus(editable ? limitPairs(plist[MODEL_VAR]) : (this.config.modelLimits ?? []).map((m) => [m.model, m.limit]), cfg),
      prices: this.priceStatus(editable ? pricePairs(plist[PRICE_VAR]) : new Map((this.config.modelPrices ?? []).map(({ model, input, output, cacheRead, cacheWrite }) => [model, { input, output, cacheRead, cacheWrite }])), cfg),
    };
  }

  /**
   * The rows of the «Listino prezzi» card: OpenCode's configured models, those used in the last 90 days and those
   * already priced (`prices`: model → price), most used in the last 30 days first, then by name.
   */
  priceStatus(prices, cfg = this.models?.current()) {
    const labels = new Map((cfg?.available ? cfg.models : []).map((m) => [m.model, m.label ?? null]));
    const now = Date.now();
    const used30 = this.queries?.modelTokens(now - 30 * DAY_MS, now) ?? new Map();
    const used90 = this.queries?.modelTokens(now - 90 * DAY_MS, now) ?? new Map();
    // steps without provider or model come back as "null/…" or "…/null"
    const models = new Set([...labels.keys(), ...[...used90.keys()].filter((k) => !/^null\/|\/null$/.test(k)), ...prices.keys()]);
    // a key the card could not save or clear (spaces, `?`, `#`, no provider) gets no row
    const rows = [...models].filter((model) => isPriceKey(model)).map((model) => ({ model, label: labels.get(model) ?? null, price: prices.get(model) ?? null, tokens30d: used30.get(model) ?? 0 }));
    return { rows: rows.sort((a, b) => b.tokens30d - a.tokens30d || a.model.localeCompare(b.model)) };
  }

  /**
   * The models of OpenCode's configuration with their budget (from `limits`, the plist's
   * pairs) and today's tokens; budgets of models no longer configured are history.
   * Without a readable configuration every budget is listed as is, and none is history.
   */
  modelStatus(limits, current = this.models?.current()) {
    const cfg = current ?? { dir: null, files: [], available: false, error: null, models: [] };
    const { from, to } = periodBounds("day", Date.now(), this.config.reset);
    const used = this.queries?.modelTokens(from, to) ?? new Map();
    const byModel = new Map(limits);
    const configured = cfg.available
      ? cfg.models.map((m) => ({ model: m.model, label: m.label ?? null, limit: byModel.get(m.model) ?? null, today: used.get(m.model) ?? 0 }))
      : limits.map(([model, limit]) => ({ model, label: null, limit, today: used.get(model) ?? 0 }));
    const known = new Set(cfg.models.map((m) => m.model));
    const history = cfg.available ? limits.filter(([model]) => !known.has(model)).map(([model, limit]) => ({ model, limit })) : [];
    return { dir: cfg.dir, files: cfg.files, available: cfg.available, error: cfg.error, configured, history };
  }

  /** LENS_MODEL_LIMITS after `changes` ({ model: value, "" = no budget }): only configured models, history kept. */
  composeModelLimits(current, changes, errors) {
    const serialize = (pairs) => [...pairs].map(([model, n]) => `${model}=${n}`).join(",");
    if (changes === undefined) return serialize(limitPairs(current)); // unchanged, minus entries loadConfig would refuse
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      errors.push(t("modelLimits: formato atteso {format}", { format: '{ "provider/modello": "100M" }' }));
      return current;
    }
    const cfg = this.models?.current();
    if (!cfg?.available) {
      errors.push(t("Budget per modello non modificabili: {why}", { why: cfg?.error ?? t("configurazione di OpenCode non disponibile") }));
      return current;
    }
    const known = new Set(cfg.models.map((m) => m.model));
    const pairs = new Map(limitPairs(current)); // insertion order: existing entries first, new ones after
    for (const [model, raw] of Object.entries(changes)) {
      if (!known.has(model)) errors.push(t("{model}: non è nella configurazione di OpenCode, il budget non si può impostare", { model }));
      else if (typeof raw !== "string") errors.push(t("{model}: il budget deve essere un testo", { model }));
      else if (raw.trim() === "") pairs.delete(model);
      else {
        const n = parseTokens(raw);
        if (n === null) errors.push(t("{model}: budget non valido \"{value}\" (un intero di token, o con k, M, G: es. 100M)", { model, value: raw }));
        else pairs.set(model, n);
      }
    }
    return serialize(pairs);
  }

  /**
   * LENS_MODEL_PRICES after `changes` ({ model: { input, output, cacheRead, cacheWrite } as the card's texts, an empty
   * cache = its default; "" = no price }). Any provider/model is accepted: it does not need OpenCode's configuration.
   */
  composeModelPrices(current, changes, errors) {
    const prices = pricePairs(current); // insertion order: existing entries first, new ones after
    const serialize = () => [...prices].map(([model, p]) => `${model}=${formatPrice(p)}`).join(",");
    if (changes === undefined) return serialize(); // unchanged, minus entries loadConfig would refuse
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      errors.push(t("modelPrices: formato atteso {format}", { format: '{ "provider/modello": { input, output, cacheRead, cacheWrite } }' }));
      return current;
    }
    for (const [model, raw] of Object.entries(changes)) {
      const fields = raw && typeof raw === "object" ? ["input", "output", "cacheRead", "cacheWrite"].map((k) => raw[k] ?? "") : null;
      if (!isPriceKey(model) || CONTROL.test(model)) errors.push(t("{model}: deve essere provider/modello in {var}, senza spazi, virgole, =, ? né #", { model, var: PRICE_VAR }));
      else if (raw === "") prices.delete(model);
      else if (!fields?.every((v) => typeof v === "string")) errors.push(t("{model}: il prezzo deve essere {format} o \"\"", { model, format: "{ input, output, cacheRead, cacheWrite }" }));
      else {
        const [input, output, read, write] = fields.map((v) => v.trim().replaceAll(",", "."));
        // only trailing empties go: the others would shift
        const join = (parts) => {
          while (parts.length > 2 && parts.at(-1) === "") parts.pop();
          return parts.join(":");
        };
        const text = join([input, output, read, write]); // the user's own texts, shown in the error
        // a cache write without a cache read: a placeholder parses, then the read takes its default, input/10
        const price = parsePrice(join([input, output, read || (write ? input : ""), write]));
        if (price && !read && write) price.cacheRead = Number((price.input / 10).toFixed(6)); // as many decimals as formatPrice writes
        if (!price) errors.push(t("{model}: prezzo non valido \"{value}\" in {var} (input:output[:cache letta[:cache scritta]] in $ per milione, es. 3:15)", { model, value: text, var: PRICE_VAR }));
        else prices.set(model, price);
      }
    }
    return serialize();
  }

  /**
   * POST /api/settings with { set: {NAME: value}, unset: [NAME] }. Validates the
   * resulting environment like startup does, writes the plist, reloads the lens.
   * An empty change with a pending plist just reloads.
   */
  async apply(body) {
    const reason = this.blocked();
    if (reason) throw new SettingsError(409, [reason]);
    if (this.restarting) throw new SettingsError(409, [t("La lens si sta già riavviando.")]);
    const set = body?.set ?? {};
    const unset = body?.unset ?? [];
    if (typeof set !== "object" || Array.isArray(set) || !Array.isArray(unset)) {
      throw new SettingsError(400, [t("formato atteso: {format}", { format: "{ set: { NOME: valore }, unset: [NOME] }" })]);
    }

    const current = this.io.read(this.plistPath);
    const next = { ...current };
    const errors = [];
    for (const name of unset) {
      // unknown LENS_* names can only be removed: they are typos the page offers to clean up; so are the deprecated ones
      if (typeof name !== "string" || !(this.known(name) || DEPRECATED_VARS.has(name) || (name.startsWith("LENS_") && name in current))) errors.push(t("variabile sconosciuta: {name}", { name }));
      else if (MANAGED.has(name)) errors.push(MANAGED.get(name)());
      else delete next[name];
    }
    for (const [name, raw] of Object.entries(set)) {
      if (DEPRECATED_VARS.has(name)) errors.push(deprecated(name));
      else if (!this.known(name)) errors.push(t("variabile sconosciuta: {name}", { name }));
      else if (MANAGED.has(name)) errors.push(MANAGED.get(name)());
      else if (typeof raw !== "string") errors.push(t("{name}: il valore deve essere una stringa", { name }));
      else if (raw.length > MAX_VALUE) errors.push(t("{name}: valore troppo lungo (massimo {max} caratteri)", { name, max: MAX_VALUE }));
      else if (CONTROL.test(raw)) errors.push(t("{name}: il valore non può contenere a capo o caratteri di controllo", { name }));
      else if (raw.trim() === "") delete next[name];
      else next[name] = raw.trim();
    }
    const composed = [
      [MODEL_VAR, this.composeModelLimits(current[MODEL_VAR] ?? "", body?.modelLimits, errors), body?.modelLimits],
      [PRICE_VAR, this.composeModelPrices(current[PRICE_VAR] ?? "", body?.modelPrices, errors), body?.modelPrices],
    ];
    for (const [name, value, sent] of composed) {
      // only a value the request composes: a long one written by hand never blocks the other saves
      if (sent !== undefined && value.length > MAX_VALUE) errors.push(t("{name}: valore troppo lungo (massimo {max} caratteri)", { name, max: MAX_VALUE }));
      if (value) next[name] = value;
      else delete next[name];
    }
    if (errors.length) throw new SettingsError(400, errors);

    // the environment the lens would start with: launchd's own variables plus the plist's
    const base = Object.fromEntries(Object.entries(this.env).filter(([k]) => !KNOWN_VARS.has(k) && !k.startsWith("LENS_")));
    let cfg;
    try {
      cfg = loadConfig({ ...base, ...next }, { extraKnown: this.moduleVars });
    } catch (err) {
      throw new SettingsError(400, configErrors(err));
    }
    // the modules on after the save check their own variables; their errors start with the variable's name
    const moduleErrors = (await this.modules?.validateEnv({ ...base, ...next }, cfg.modules)) ?? [];
    if (moduleErrors.length) throw new SettingsError(400, moduleErrors.map(errorText));
    const moved = cfg.port !== this.config.port || cfg.host !== this.config.host;
    if (moved && cfg.port !== 0 && !(await this.isPortFree(cfg.host, cfg.port))) {
      throw new SettingsError(400, [t("La porta {port} su {host} è già occupata da un altro processo.", { port: cfg.port, host: cfg.host })]);
    }

    const changed = JSON.stringify(Object.entries(next).sort()) !== JSON.stringify(Object.entries(current).sort());
    if (!changed && !this.status().pending) return { changed: false, restarting: false, url: null };
    if (changed) {
      this.io.write(this.plistPath, next);
      this.plistCache = null; // the mtime may not move within its resolution
    }
    this.restarting = true;
    this.reload({ label: this.label, plistPath: this.plistPath });
    let url = null;
    if (moved && cfg.port !== 0) {
      const host = cfg.host === "::1" ? "[::1]" : WILDCARD.has(cfg.host) || cfg.loopback ? "127.0.0.1" : cfg.host.includes(":") ? `[${cfg.host}]` : cfg.host;
      url = `http://${host}:${cfg.port}/#impostazioni`;
    }
    return { changed, restarting: true, url, portUnknown: moved && cfg.port === 0 };
  }
}
