// Minimal client for the OpenCode V2 local service: discovery, authenticated
// JSON requests and the /api/event SSE stream. No dependencies.
import fs from "node:fs/promises";
import { Localized } from "../public/i18n.js";
import { log } from "./log.js";

export class OpencodeUnavailable extends Localized {}

/** Resolve the service endpoint. Re-read on every call: port and password change on restart. */
export async function discover(config) {
  if (config.serverUrl) {
    return {
      url: config.serverUrl.replace(/\/+$/, ""),
      auth: config.serverPassword ? basic(config.serverUsername, config.serverPassword) : undefined,
      version: undefined,
      pid: undefined,
      source: "OPENCODE_SERVER_URL",
    };
  }
  let raw;
  try {
    raw = await fs.readFile(config.serviceFile, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") throw new OpencodeUnavailable("servizio non registrato ({file} assente)", { file: config.serviceFile });
    throw err;
  }
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    throw new OpencodeUnavailable("{file} non è JSON valido", { file: config.serviceFile });
  }
  if (typeof info.url !== "string") throw new OpencodeUnavailable("{file} senza campo url", { file: config.serviceFile });
  return {
    url: info.url.replace(/\/+$/, ""),
    auth: typeof info.password === "string" ? basic("opencode", info.password) : undefined,
    version: info.version,
    pid: info.pid,
    source: config.serviceFile,
  };
}

function basic(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export class OpencodeClient {
  constructor(config) {
    this.config = config;
    this.endpoint = null;
  }

  async connect() {
    const ep = await discover(this.config);
    this.endpoint = ep;
    const health = await this.health(ep);
    return { ...health, url: ep.url, source: ep.source };
  }

  async health(ep = this.endpoint) {
    // Docs describe /api/info; beta builds expose /api/health. Try both.
    for (const p of ["/api/health", "/api/info"]) {
      const res = await this.request(p, { allow404: true });
      if (res !== undefined) {
        return {
          healthy: res.healthy ?? res.ready ?? true,
          version: res.version ?? ep?.version,
          pid: res.pid ?? ep?.pid,
        };
      }
    }
    throw new OpencodeUnavailable("il servizio non espone /api/health né /api/info");
  }

  headers(extra = {}, ep = this.endpoint) {
    const h = { accept: "application/json", ...extra };
    if (ep?.auth) h.authorization = ep.auth;
    return h;
  }

  /** Current endpoint, discovered if needed. Callers keep their own copy: a concurrent 401 may clear this.endpoint. */
  async #endpoint() {
    if (!this.endpoint) this.endpoint = await discover(this.config);
    return this.endpoint;
  }

  /** After a 401: force rediscovery, unless another request already found a new endpoint. */
  #forget(ep) {
    if (this.endpoint === ep) this.endpoint = null;
  }

  async request(path, { allow404 = false, timeoutMs = 30_000 } = {}) {
    const ep = await this.#endpoint();
    let res;
    try {
      res = await fetch(ep.url + path, {
        headers: this.headers({}, ep),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new OpencodeUnavailable("connessione a {url} fallita: {why}", { url: ep.url, why: err.cause?.code || err.message });
    }
    if (res.status === 404 && allow404) {
      await res.body?.cancel();
      return undefined;
    }
    if (res.status === 401) {
      await res.body?.cancel();
      // password rotated: force rediscovery on next call
      this.#forget(ep);
      throw new OpencodeUnavailable("401 dal servizio: password cambiata, riprovo con nuova discovery");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`${path} → HTTP ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /** Iterate every page of a cursor-paginated list endpoint. */
  async *paginate(path, params = {}, { maxPages = 10_000 } = {}) {
    let cursor = null;
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams(params);
      if (cursor) {
        q.delete("order"); // the API rejects order together with cursor
        q.set("cursor", cursor);
      }
      const body = await this.request(`${path}?${q}`);
      const data = Array.isArray(body?.data) ? body.data : [];
      if (data.length === 0) return;
      const stop = yield data;
      if (stop === "stop") return;
      cursor = body?.cursor?.next;
      if (!cursor) return;
    }
  }

  /**
   * Subscribe to /api/event. Calls onEvent(obj) per event. Resolves when the
   * stream ends; rejects on error. Aborts if no bytes (incl. heartbeats) arrive
   * within idleMs.
   */
  async stream({ onOpen, onEvent, signal, idleMs = 60_000 }) {
    const ep = await this.#endpoint();
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(new Error("stopped"));
    signal?.addEventListener("abort", onAbort, { once: true });
    let idle;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(new Error(`nessun dato da ${idleMs / 1000}s`)), idleMs);
    };
    try {
      arm();
      let res;
      try {
        res = await fetch(ep.url + "/api/event", {
          headers: this.headers({ accept: "text/event-stream" }, ep),
          signal: ctrl.signal,
        });
      } catch (err) {
        throw new OpencodeUnavailable("stream eventi: {why}", { why: ctrl.signal.reason?.message || err.cause?.code || err.message });
      }
      if (res.status === 401) {
        this.#forget(ep);
        throw new OpencodeUnavailable("401 sullo stream eventi");
      }
      if (!res.ok || !res.body) throw new Error(`/api/event → HTTP ${res.status}`);
      onOpen?.();
      const decoder = new TextDecoder();
      let buf = "";
      let dataLines = [];
      try {
        for await (const chunk of res.body) {
          arm();
          buf += decoder.decode(chunk, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) !== -1) {
            let line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line === "") {
              if (dataLines.length) {
                const payload = dataLines.join("\n");
                dataLines = [];
                let obj;
                try {
                  obj = JSON.parse(payload);
                } catch {
                  // only the size: the payload may carry prompt text or tool output
                  log.warn(`evento SSE non JSON ignorato (${payload.length} caratteri)`);
                  continue;
                }
                onEvent(obj);
              }
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(line[5] === " " ? 6 : 5));
            }
            // comments (": heartbeat"), "event:" and "id:" lines need no handling
          }
        }
      } catch (err) {
        if (signal?.aborted) return;
        throw new OpencodeUnavailable("stream eventi interrotto: {why}", { why: ctrl.signal.reason?.message || err.message });
      }
    } finally {
      clearTimeout(idle);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
