// The MCP server `lens` as the Impostazioni page shows it: its state read from OpenCode
// (GET /api/mcp) and from OpenCode's global config, and the texts to connect it.
// Read-only towards OpenCode: never the experimental.mcp.* writes.
import { N_, t } from "../public/i18n.js";
import fs from "node:fs";
import { installArgs, installLine } from "./mcp/config.js";
import { readLensMcp } from "./opencode-config.js";
import { stablePath } from "./service.js";
import { VERSION } from "./version.js";

/** Two commands are the same server: node through the Homebrew opt link, .js files through realpath. */
export function sameCommand(a, b, { realpath = fs.realpathSync } = {}) {
  if (a.length !== b.length) return false;
  const real = (p) => {
    try {
      return realpath(p);
    } catch {
      return p;
    }
  };
  const norm = (arg, i) => (i === 0 ? stablePath(arg) : arg.endsWith(".js") ? real(arg) : arg);
  return a.every((arg, i) => norm(arg, i) === norm(b[i], i));
}

/** The command, the opencode.jsonc entry and the prompt for the model, for the server run as `args`. */
export function suggested(args) {
  const list = JSON.stringify(args);
  return {
    command: installLine({ programArguments: args.slice(0, -1), execPath: args[0], mainPath: args[1] }),
    jsonc: `"lens": { "type": "local", "command": ${list} }`,
    prompt:
      `${t('Aggiungi alla mia configurazione globale di OpenCode (~/.config/opencode/opencode.jsonc) un server MCP locale chiamato "lens", con "type": "local" e "command": {command}.', { command: list })} ` +
      `${t("Modifica solo la chiave mcp.servers.lens: non toccare, riordinare o riformattare il resto del file e mantieni i commenti.")} ` +
      t("Non cambiare agenti né permessi. Alla fine dimmi di eseguire opencode2 reload."),
  };
}

/** A version as package.json writes it: anything else counts as unknown. */
const MCP_VERSION = /^[0-9A-Za-z.+-]{1,40}$/;

const FROM_OPENCODE = { connected: "connected", failed: "failed", disabled: "disabled", pending: "pending", needs_auth: "pending" };

/** OpenCode's failure reason as text: it may be a string or an error object. */
function reasonText(st) {
  const r = st?.error ?? st?.message;
  if (r == null) return null;
  return typeof r === "string" ? r : typeof r.message === "string" ? r.message : JSON.stringify(r);
}

/**
 * The state of `lens`: OpenCode wins when it reports the server, the global config decides
 * otherwise, and an unreachable OpenCode or an unreadable config is «unknown» (never a guess).
 * @param {{ reachable: boolean, reason?: string, server: {status?: {status?: string, error?: unknown, message?: unknown}}|null,
 *   declaration: {declared: boolean, disabled: boolean, unreadable?: boolean, error?: string|null} }} o
 * @returns {{ state: "connected"|"failed"|"disabled"|"pending"|"declared"|"missing"|"unknown", detail: string|null }}
 */
export function mcpState({ reachable, reason, server, declaration }) {
  const unreadable = declaration.unreadable ? t("configurazione globale non leggibile: {error}", { error: declaration.error }) : null;
  const file = unreadable ?? (declaration.disabled ? t("disattivato nel file") : declaration.declared ? t("dichiarato nella configurazione globale") : t("non dichiarato nella configurazione globale"));
  if (!reachable) return { state: "unknown", detail: `${t(reason ?? "OpenCode non raggiungibile")}; ${file}` };
  if (server) {
    const status = server.status?.status;
    const state = FROM_OPENCODE[status] ?? "unknown";
    const notes = [];
    if (state === "failed") notes.push(reasonText(server.status));
    if (state === "disabled") notes.push(t("acceso e spento da OpenCode"));
    if (state === "unknown") notes.push(t("stato «{status}» non riconosciuto", { status: status ?? "?" }));
    if (state !== "disabled" && declaration.disabled) notes.push(t("disattivato nel file: esegui opencode2 reload"));
    if (unreadable) notes.push(unreadable);
    else if (!declaration.declared) notes.push(t("dichiarato fuori dalla configurazione globale"));
    const detail = notes.filter(Boolean).join(" · ");
    return { state, detail: detail || null };
  }
  if (unreadable) return { state: "unknown", detail: unreadable };
  if (declaration.disabled) return { state: "disabled", detail: t("acceso e spento da OpenCode") };
  if (declaration.declared) return { state: "declared", detail: t("esegui opencode2 reload; se resta così, OpenCode non lo carica per la cartella di default") };
  return { state: "missing", detail: null };
}

/**
 * The state of the MCP server for GET /api/mcp/status. Asks OpenCode at most every `ttlMs`
 * (concurrent calls share one request) and never when the collector is not connected.
 */
export class McpStatus {
  constructor({ client, isConnected, configDir, programArguments, execPath, mainPath, now = Date.now, ttlMs = 10_000, version = VERSION }) {
    Object.assign(this, { client, isConnected, configDir, programArguments, execPath, mainPath, now, ttlMs, version });
    this.cached = null; // { at, value: {reachable, server} }
    this.inflight = null;
    this.running = null; // { version|null, seenAt }: the last MCP process that called the lens, in memory only
  }

  /**
   * A request of the MCP reached the lens: `version` is its X-Lens-Mcp-Version, "" for an MCP that
   * predates the header. OpenCode keeps the MCP it started: after an update it runs the old code
   * until OpenCode restarts, and the Impostazioni page says so.
   */
  seen(version) {
    this.running = { version: MCP_VERSION.test(version) ? version : null, seenAt: this.now() };
  }

  /** The MCP seen last, with whether it is older than this lens, or null before the first request. */
  #running() {
    if (!this.running) return null;
    const { version, seenAt } = this.running;
    return { version, seenAt, stale: version !== this.version };
  }

  async #opencode() {
    if (!this.isConnected()) return { reachable: false, server: null };
    const at = this.now();
    if (this.cached && at - this.cached.at <= this.ttlMs) return this.cached.value;
    this.inflight ??= (async () => {
      let value;
      try {
        const body = await this.client.request("/api/mcp", { allow404: true, timeoutMs: 3000 });
        value = Array.isArray(body?.data)
          ? { reachable: true, server: body.data.find((s) => s?.name === "lens") ?? null }
          : { reachable: false, reason: body === undefined ? N_("OpenCode non espone /api/mcp") : N_("risposta di OpenCode a /api/mcp non riconosciuta"), server: null };
      } catch {
        value = { reachable: false, server: null };
      }
      this.cached = { at, value };
      return value;
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  async get() {
    const { reachable, reason, server } = await this.#opencode();
    const { declared, disabled, command, errorText, unreadable, error } = readLensMcp(this.configDir);
    const programArguments = this.programArguments();
    const args = installArgs({ programArguments, execPath: this.execPath, mainPath: this.mainPath });
    const { state, detail } = mcpState({ reachable, reason, server, declaration: { declared, disabled, unreadable, error } });
    const running = this.#running();
    const stale = running?.stale
      ? running.version
        ? t("MCP alla v{mcp} in esecuzione: riavvia OpenCode per passare alla v{lens}", { mcp: running.version, lens: this.version })
        : t("MCP di una versione precedente in esecuzione: riavvia OpenCode per passare alla v{lens}", { lens: this.version })
      : null;
    return {
      state,
      detail: [stale, detail].filter(Boolean).join(" · ") || null,
      running,
      lensVersion: this.version,
      server: { declared, disabled, command, errorText },
      opencode: server ? { status: server.status?.status ?? null, reason: reasonText(server.status) } : null,
      suggested: suggested(args),
      commandMatches: programArguments && command ? sameCommand(command, args) : null,
    };
  }
}
