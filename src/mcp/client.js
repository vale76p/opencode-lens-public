// The MCP's HTTP client of the lens API.
import { VERSION } from "../version.js";
import { LensError } from "./errors.js";
import { cleanText } from "./text.js";

const seconds = (ms) => `${(ms / 1000).toLocaleString("it-IT")} s`;

/**
 * GET and POST on the lens API; failures become LensError, a cancellation travels as it is. `page` is a GET
 * that also returns the x-next-cursor of a paged list ({ body, next }; next null when the lens sends none).
 */
export function createLensClient({ url, token, source = null, fetch = globalThis.fetch, timeoutMs = 10_000 }) {
  const where = url.replace(/^http:\/\//, "");
  async function request(method, path, { params = {}, body: payload, withNext = false } = {}, signal = new AbortController().signal) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v));
    const timeout = AbortSignal.timeout(timeoutMs);
    // a failure of the connection or of the body: the client's cancellation travels as it is
    const lost = (err, what) => {
      if (signal.aborted) return err;
      if (timeout.aborted) return new LensError(`Lens non ha risposto entro ${seconds(timeoutMs)}`);
      return new LensError(what);
    };
    let res;
    let body;
    try {
      // the version tells the lens which MCP OpenCode is running: an old one after an update asks for a restart of OpenCode
      const headers = { "X-Lens-Mcp-Version": VERSION, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload !== undefined ? { "content-type": "application/json" } : {}) };
      res = await fetch(`${url}${path}${q.size ? `?${q}` : ""}`, { method, headers, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.any([signal, timeout]) });
    } catch (err) {
      throw lost(err, `Lens non risponde su ${where}: è attiva? (opencode-lens service status)${source ? `. ${source}` : ""}`);
    }
    if (res.status === 401) throw new LensError("token di Lens mancante o errato: LENS_TOKEN del plist o dell'ambiente dell'MCP");
    try {
      body = await res.text();
    } catch (err) {
      throw lost(err, `Lens ha interrotto la risposta su ${path}`);
    }
    if (!res.ok) {
      // the lens explains a refusal in { errors: [...] } (e.g. a 400 on a bad parameter)
      let why = null;
      try {
        const e = JSON.parse(body)?.errors;
        if (Array.isArray(e) && e.length) why = cleanText(e.join("; "));
      } catch {}
      throw new LensError(`Lens ha risposto HTTP ${res.status} su ${path}${why ? `: ${why}` : ""}`, res.status);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new LensError(`Lens ha risposto con dati non JSON su ${path}`, res.status);
    }
    return withNext ? { body: parsed, next: res.headers.get("x-next-cursor") } : parsed;
  }
  return {
    get: (path, params = {}, signal) => request("GET", path, { params }, signal),
    page: (path, params = {}, signal) => request("GET", path, { params, withNext: true }, signal),
    post: (path, body, signal) => request("POST", path, { body }, signal),
  };
}
