import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS, LOCALES, N_, t } from "../public/i18n.js";
import { isPriceKey, parsePrice } from "./prices.js";

const home = os.homedir();

export function defaultDbPath() {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "opencode-lens", "lens.db");
  }
  const data = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(data, "opencode-lens", "lens.db");
}

// the app's own modules/ folder, as src/modules.js MODULES_DIR (config.js stays free of imports of the lens)
const APP_MODULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "modules");

/**
 * The folder of the user's own modules, next to the database (outside the app folder, which install.sh deletes on every
 * update): absolute and normalized, the same default as config.dbPath. null when there is no data folder
 * (LENS_DB=":memory:") or when it would be the app's own modules/ (a database in the app folder).
 */
export function userModulesDir(env = process.env) {
  const db = (env.LENS_DB ?? "").trim();
  if (db === ":memory:") return null;
  const dir = path.resolve(path.dirname(db || defaultDbPath()), "modules");
  return dir === APP_MODULES_DIR ? null : dir;
}

function defaultServiceFile() {
  // Same lookup as @opencode-ai/client: $XDG_STATE_HOME/opencode/service.json
  const state = process.env.XDG_STATE_HOME || path.join(home, ".local", "state");
  return path.join(state, "opencode", "service.json");
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const BOOL = { 0: false, 1: true, false: false, true: true };
const HOST_PORT = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):\d{1,5}$/;
export const KNOWN_VARS = new Set([
  "LENS_HOST", "LENS_PORT", "LENS_TOKEN", "LENS_ALLOWED_HOSTS", "LENS_DB", "LENS_SCAN_INTERVAL",
  "LENS_STORE_TITLES", "LENS_LOG_LEVEL", "OPENCODE_SERVICE_FILE", "OPENCODE_SERVER_URL",
  "OPENCODE_SERVER_USERNAME", "OPENCODE_SERVER_PASSWORD",
  "LENS_LIMIT_TOKENS", "LENS_LIMIT_COST", "LENS_LIMIT_STEPS", "LENS_LABELS",
  "LENS_LIMIT_TOKENS_WEEKLY", "LENS_LIMIT_COST_WEEKLY", "LENS_LIMIT_STEPS_WEEKLY",
  "LENS_LIMIT_TOKENS_MONTHLY", "LENS_LIMIT_COST_MONTHLY", "LENS_LIMIT_STEPS_MONTHLY",
  "LENS_MODEL_LIMITS", "LENS_MODEL_PRICES", "LENS_RESET_HOUR", "LENS_LANG", "LENS_LOCALE",
  "LENS_OTLP_ENDPOINT", "LENS_OTLP_HEADERS", "LENS_OTLP_INTERVAL", "LENS_OTLP_TEMPORALITY", "LENS_OTLP_TRACES",
  "LENS_RETENTION_DAYS", "LENS_MODULES",
]);
// Variables the lens no longer reads, name → the sentence that says why (Italian, {name} filled, translated by t()):
// ignored whatever their value (never an error nor an unknown variable; empty counts as unset), one line in the log at
// startup, offered for removal in Impostazioni and never written again (src/settings.js).
// LENS_BOB: IBM Bob is a module (modules/bob), turned on from Impostazioni › Moduli.
export const DEPRECATED_VARS = new Map([["LENS_BOB", N_("{name} non serve più: IBM Bob è un modulo, accendilo da Impostazioni › Moduli")]]);
/** A module id: also the folder name and the page id. */
export const MODULE_ID = /^[a-z][a-z0-9-]*$/;
// the shortest retention: every fixed window of the dashboard (the calendar's 370 days at most) stays exact
export const RETENTION_MIN_DAYS = 400;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// every label name the lens itself uses on some series
const RESERVED_LABELS = new Set(["provider", "model", "agent", "kind", "finish", "status", "tool", "type", "action", "reply", "outcome", "quantile", "version", "node", "le"]);

/** "a=1,b=2" → [["a","1"],["b","2"]]; values may contain "=" but not ",". */
function pairs(name, value, errors) {
  const out = [];
  for (const item of value.split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = item.indexOf("=");
    if (i <= 0) {
      errors.push(t("{name}: \"{item}\" deve essere chiave=valore", { name, item }));
      continue;
    }
    out.push([item.slice(0, i).trim(), item.slice(i + 1).trim()]);
  }
  return out;
}

function hasCredentials(v) {
  const u = new URL(v);
  return u.username !== "" || u.password !== "";
}

function httpUrl(v) {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}

/**
 * Reads and validates the environment. Every invalid value is reported at once,
 * so a typo stops the lens at startup instead of silently falling back.
 * `extraKnown`: the variables the modules declare (moduleVars in src/modules.js), known even with the module
 * off; only the surrogates check applies to them here, their module validates the rest.
 */
export function loadConfig(rawEnv = process.env, { extraKnown = new Set() } = {}) {
  const errors = [];
  // lone surrogates cannot be written to the plist (plutil refuses them) nor sent anywhere intact:
  // reported without the value, which is then ignored so no other check repeats it
  const env = { ...rawEnv };
  for (const k of [...KNOWN_VARS, ...extraKnown]) {
    if (typeof env[k] === "string" && !env[k].isWellFormed()) {
      errors.push(t("{name} contiene caratteri Unicode non validi (surrogati isolati)", { name: k }));
      delete env[k];
    }
  }
  const get = (name) => (env[name] === undefined || env[name] === "" ? undefined : env[name].trim());

  function int(name, fallback, min, max, unit = "") {
    const v = get(name);
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!/^\d+$/.test(v) || n < min || n > max) {
      errors.push(unit ? t("{name} deve essere un intero tra {min} e {max} secondi, trovato \"{value}\"", { name, min, max, value: v }) : t("{name} deve essere un intero tra {min} e {max}, trovato \"{value}\"", { name, min, max, value: v }));
      return fallback;
    }
    return n;
  }

  const host = get("LENS_HOST") ?? "127.0.0.1";
  const port = int("LENS_PORT", 4777, 0, 65535);
  const token = env.LENS_TOKEN || "";
  const loopback = LOOPBACK.has(host);
  if (!loopback && token.length < 16) {
    errors.push(t("LENS_HOST={host} espone la dashboard fuori da questo Mac: imposta anche LENS_TOKEN (almeno 16 caratteri).", { host }));
  }

  const extraHosts = (get("LENS_ALLOWED_HOSTS") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const h of extraHosts) {
    if (!HOST_PORT.test(h)) errors.push(t("LENS_ALLOWED_HOSTS: \"{host}\" deve essere nome:porta, es. macbook.local:{port}", { host: h, port }));
  }

  const scanSec = int("LENS_SCAN_INTERVAL", 120, 10, 86400, " secondi");
  // days of steps and tool calls to keep (src/retention.js); unset: forever
  const retentionDays = int("LENS_RETENTION_DAYS", null, RETENTION_MIN_DAYS, 36500);

  const titles = get("LENS_STORE_TITLES")?.toLowerCase();
  if (titles !== undefined && !(titles in BOOL)) errors.push(t("LENS_STORE_TITLES deve essere 0 o 1, trovato \"{value}\"", { value: titles }));

  const logLevel = get("LENS_LOG_LEVEL")?.toLowerCase() ?? "info";
  if (!LOG_LEVELS.has(logLevel)) errors.push(t("LENS_LOG_LEVEL deve essere uno tra {list}, trovato \"{value}\"", { list: [...LOG_LEVELS].join(", "), value: logLevel }));

  const lang = get("LENS_LANG")?.toLowerCase() ?? "auto";
  if (lang !== "auto" && !LANGS.includes(lang)) errors.push(t("LENS_LANG deve essere uno tra {list}, trovato \"{value}\"", { list: ["auto", ...LANGS].join(", "), value: lang }));
  const locale = get("LENS_LOCALE") ?? "auto";
  if (locale !== "auto" && !LOCALES.includes(locale)) errors.push(t("LENS_LOCALE deve essere uno tra {list}, trovato \"{value}\"", { list: ["auto", ...LOCALES].join(", "), value: locale }));

  function positive(name) {
    const v = get(name);
    if (v === undefined) return null;
    const n = Number(v);
    if (!/^\d+(\.\d+)?$/.test(v) || !(n > 0)) {
      errors.push(t("{name} deve essere un numero maggiore di 0, trovato \"{value}\"", { name, value: v }));
      return null;
    }
    return n;
  }
  // budgets per period: "" daily, "_WEEKLY" from Monday, "_MONTHLY" from the 1st
  function limitSet(suffix) {
    const set = {
      tokens: positive(`LENS_LIMIT_TOKENS${suffix}`),
      cost: positive(`LENS_LIMIT_COST${suffix}`),
      steps: positive(`LENS_LIMIT_STEPS${suffix}`),
    };
    for (const k of ["tokens", "steps"]) {
      if (set[k] !== null && !Number.isInteger(set[k])) errors.push(t("{name} deve essere un intero", { name: `LENS_LIMIT_${k.toUpperCase()}${suffix}` }));
    }
    return set;
  }
  const limits = limitSet("");
  const weeklyLimits = limitSet("_WEEKLY");
  const monthlyLimits = limitSet("_MONTHLY");

  // daily token budget of single models: "provider/model=tokens,…", variants share the model's budget
  const modelLimits = [];
  for (const [model, v] of pairs("LENS_MODEL_LIMITS", get("LENS_MODEL_LIMITS") ?? "", errors)) {
    const slash = model.indexOf("/");
    if (slash <= 0 || slash === model.length - 1) errors.push(t("LENS_MODEL_LIMITS: \"{model}\" deve essere provider/modello, come nella tabella per modello", { model }));
    else if (!/^\d+$/.test(v) || !(Number(v) > 0)) errors.push(t("LENS_MODEL_LIMITS: il budget di {model} deve essere un intero di token maggiore di 0, trovato \"{value}\"", { model, value: v }));
    else if (modelLimits.some((m) => m.model === model)) errors.push(t("LENS_MODEL_LIMITS: {model} è ripetuto", { model }));
    else modelLimits.push({ model, provider: model.slice(0, slash), name: model.slice(slash + 1), limit: Number(v) });
  }

  // price list of single models, USD per million tokens: "provider/model=in:out[:cacheRead[:cacheWrite]],…"
  const modelPrices = [];
  for (const [model, v] of pairs("LENS_MODEL_PRICES", get("LENS_MODEL_PRICES") ?? "", errors)) {
    const slash = model.indexOf("/");
    const price = parsePrice(v);
    if (!isPriceKey(model)) errors.push(t("LENS_MODEL_PRICES: \"{model}\" deve essere provider/modello, senza spazi, ? né #", { model }));
    else if (!price) errors.push(t("LENS_MODEL_PRICES: il prezzo di {model} deve essere input:output[:cache letta[:cache scritta]] in $ per milione, trovato \"{value}\"", { model, value: v }));
    else if (modelPrices.some((m) => m.model === model)) errors.push(t("LENS_MODEL_PRICES: {model} è ripetuto", { model }));
    else modelPrices.push({ model, provider: model.slice(0, slash), name: model.slice(slash + 1), ...price });
  }

  // start of the budget day: a local hour, or a UTC one with a trailing Z
  const resetRaw = get("LENS_RESET_HOUR");
  let reset = { hour: 0, utc: false };
  if (resetRaw !== undefined) {
    const m = /^(\d{1,2})([zZ]?)$/.exec(resetRaw);
    if (!m || Number(m[1]) > 23) errors.push(t("LENS_RESET_HOUR deve essere un'ora 0–23, locale o con Z per UTC (es. 2 o 0Z), trovato \"{value}\"", { value: resetRaw }));
    else reset = { hour: Number(m[1]), utc: m[2] !== "" };
  }

  const labels = {};
  for (const [k, v] of pairs("LENS_LABELS", get("LENS_LABELS") ?? "", errors)) {
    if (!LABEL_NAME.test(k) || k.startsWith("__")) errors.push(t("LENS_LABELS: \"{name}\" non è un nome di etichetta valido (lettere, cifre, _)", { name: k }));
    else if (RESERVED_LABELS.has(k)) errors.push(t("LENS_LABELS: \"{name}\" è già usata dalle metriche della lens", { name: k }));
    else labels[k] = v;
  }

  const otlpEndpoint = (get("LENS_OTLP_ENDPOINT") ?? "").replace(/\/+$/, "");
  if (otlpEndpoint && !httpUrl(otlpEndpoint)) {
    errors.push(t("LENS_OTLP_ENDPOINT deve essere un URL completo con schema, es. http://127.0.0.1:4318, trovato \"{value}\"", { value: otlpEndpoint }));
  }
  const otlpHeaders = Object.fromEntries(pairs("LENS_OTLP_HEADERS", env.LENS_OTLP_HEADERS ?? "", errors));
  const otlpInterval = int("LENS_OTLP_INTERVAL", 60, 10, 3600, " secondi");
  const temporality = get("LENS_OTLP_TEMPORALITY")?.toLowerCase() ?? "cumulative";
  if (!["cumulative", "delta"].includes(temporality)) errors.push(t("LENS_OTLP_TEMPORALITY deve essere cumulative o delta, trovato \"{value}\"", { value: temporality }));
  const traces = get("LENS_OTLP_TRACES")?.toLowerCase();
  if (traces !== undefined && !(traces in BOOL)) errors.push(t("LENS_OTLP_TRACES deve essere 0 o 1, trovato \"{value}\"", { value: traces }));
  if (!otlpEndpoint) {
    for (const k of ["LENS_OTLP_HEADERS", "LENS_OTLP_INTERVAL", "LENS_OTLP_TEMPORALITY", "LENS_OTLP_TRACES"]) {
      if (get(k) !== undefined) errors.push(t("{name} è impostata ma LENS_OTLP_ENDPOINT no: verrebbe ignorata", { name: k }));
    }
  }

  // enabled modules: ids are only checked for shape here, the registry judges unknown ones
  const modules = [];
  for (const id of (get("LENS_MODULES") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!MODULE_ID.test(id)) errors.push(t("LENS_MODULES: \"{id}\" non è un id di modulo valido (minuscole, cifre, trattino)", { id }));
    else if (modules.includes(id)) errors.push(t("LENS_MODULES: {id} è ripetuto", { id }));
    else modules.push(id);
  }

  const serverUrl = get("OPENCODE_SERVER_URL") ?? "";
  if (serverUrl) {
    if (!httpUrl(serverUrl)) errors.push(t("OPENCODE_SERVER_URL deve essere un URL completo con schema, es. http://127.0.0.1:4096, trovato \"{value}\"", { value: serverUrl }));
    // fetch refuses such a URL, and the lens would show it (password included) in its errors and settings
    else if (hasCredentials(serverUrl)) errors.push(t("OPENCODE_SERVER_URL non deve contenere utente e password: metti la password in OPENCODE_SERVER_PASSWORD e l'utente in OPENCODE_SERVER_USERNAME"));
  } else if (get("OPENCODE_SERVER_PASSWORD")) {
    errors.push(t("OPENCODE_SERVER_PASSWORD è impostata ma OPENCODE_SERVER_URL no: la password verrebbe ignorata"));
  }

  if (errors.length) throw new Error(`${t("Configurazione non valida:")}\n- ${errors.join("\n- ")}`);

  return {
    host,
    port,
    token,
    loopback,
    allowedHosts: new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
      ...extraHosts,
    ]),
    dbPath: get("LENS_DB") ?? defaultDbPath(),
    serviceFile: get("OPENCODE_SERVICE_FILE") ?? defaultServiceFile(),
    // explicit server override (e.g. a --standalone server): URL + optional password
    serverUrl,
    serverPassword: env.OPENCODE_SERVER_PASSWORD || "",
    serverUsername: get("OPENCODE_SERVER_USERNAME") ?? "opencode",
    scanIntervalMs: scanSec * 1000,
    retentionDays,
    storeTitles: titles === undefined ? true : BOOL[titles],
    logLevel,
    lang,
    locale,
    limits,
    weeklyLimits,
    monthlyLimits,
    modelLimits,
    modelPrices,
    reset,
    labels,
    modules,
    otlp: otlpEndpoint
      ? { endpoint: otlpEndpoint, headers: otlpHeaders, intervalMs: otlpInterval * 1000, temporality, traces: traces === undefined ? true : BOOL[traces] }
      : null,
    // which settings came from the environment (vs defaults), for /api/about
    fromEnv: new Set(Object.keys(env).filter((k) => KNOWN_VARS.has(k) && env[k] !== "")),
    // LENS_* names the lens does not know: almost always a typo
    unknownEnv: Object.keys(env).filter((k) => k.startsWith("LENS_") && !KNOWN_VARS.has(k) && !extraKnown.has(k) && !DEPRECATED_VARS.has(k)).sort(),
    // names the lens no longer reads, set in the environment (src/main.js says so once)
    deprecatedEnv: Object.keys(env).filter((k) => DEPRECATED_VARS.has(k) && env[k] !== "").sort(),
  };
}
