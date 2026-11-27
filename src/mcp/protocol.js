// JSON-RPC for MCP, both revisions: the handler is pure, one message in and the response out.
import { VERSION } from "../version.js";
import { PromptNotFoundError, ToolError } from "./errors.js";
import { INSTRUCTIONS } from "./instructions.js";
import { PROMPT_BRIEF_MAX } from "./prompts.js";
import { cleanName } from "./text.js";

export const PROTOCOL = { modern: "2026-07-28", legacy: ["2025-11-25", "2025-06-18", "2025-03-26"] };

const PROTOCOL_META = "io.modelcontextprotocol/protocolVersion";
const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";
const SESSION_META = "ai.opencode/sessionID";
const SERVER_INFO = { name: "opencode-lens" };
const CAPABILITIES = { tools: { listChanged: true }, prompts: { listChanged: true } };
const ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

export const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });

/**
 * The JSON-RPC handler, pure: one message in, the response out (null for notifications).
 * Both MCP revisions: 2025-11-25 (initialize) and 2026-07-28 (server/discover, _meta on every request).
 * `tools` is the list or a function giving it, asked again at every tools/list (the modules' tools come and go);
 * `find(name)` gives (or resolves to) the tool tools/call runs, null when unknown (by default: the one of that name in the list).
 * @param {{ tools: Tool[] | (() => Tool[]), find?: (name: string) => Tool | null | Promise<Tool | null>,
 *   instructions?: string | ((signal: AbortSignal) => Promise<string>), version?: string,
 *   prompts?: {list: (signal) => Promise<{id, name, brief}[]>, get: ({name}, signal, ctx) => Promise<{description: string, text: string}>} | null }} o
 * `prompts` is the prompt aggregator (src/mcp/prompts.js): `get` throws PromptNotFoundError for a name nobody has.
 * @typedef {{name: string, title: string, description: string, inputSchema: object, annotations?: object,
 *   run: (args: object, ctx: {sessionID: string|null, signal: AbortSignal}) => Promise<{text: string, isError?: boolean}>}} Tool
 */
export function createHandler({ tools, find = null, instructions = INSTRUCTIONS, prompts = null, version = VERSION }) {
  const serverInfo = { ...SERVER_INFO, version };
  const current = typeof tools === "function" ? tools : () => tools;
  const lookup = find ?? ((name) => current().find((t) => t.name === name) ?? null);

  const failures = new Set(); // reasons prompts/list has failed with since its last success, already on stderr
  const instructionsText = async (signal) => (typeof instructions === "function" ? instructions(signal) : instructions);

  async function result(method, params, signal) {
    switch (method) {
      case "initialize": {
        const asked = params?.protocolVersion;
        return { protocolVersion: PROTOCOL.legacy.includes(asked) ? asked : PROTOCOL.legacy[0], capabilities: CAPABILITIES, serverInfo, instructions: await instructionsText(signal) };
      }
      case "server/discover":
        return { ttlMs: 0, cacheScope: "private", supportedVersions: [PROTOCOL.modern], capabilities: CAPABILITIES, instructions: await instructionsText(signal), _meta: { [SERVER_INFO_META]: serverInfo } };
      case "ping":
        return {};
      case "tools/list":
        // a tool may declare its own annotations (module_check runs the module's code, so it is not read-only)
        return { tools: current().map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...(annotations ?? ANNOTATIONS) } })) };
      case "tools/call": {
        let tool = typeof params?.name === "string" ? lookup(params.name) : null;
        // awaited only when it is a promise: a synchronous lookup starts the tool before a cancellation can arrive
        if (tool instanceof Promise) {
          tool = await tool;
          signal.throwIfAborted();
        }
        if (!tool) throw Object.assign(new Error(`tool sconosciuto: ${params?.name}`), { rpc: -32602 });
        const args = params.arguments ?? {};
        if (typeof args !== "object" || Array.isArray(args)) throw Object.assign(new Error("arguments deve essere un oggetto"), { rpc: -32602 });
        const sessionID = typeof params._meta?.[SESSION_META] === "string" ? params._meta[SESSION_META] : null;
        try {
          const r = await tool.run(args, { sessionID, signal });
          return { content: [{ type: "text", text: r.text }], isError: r.isError === true };
        } catch (err) {
          if (signal.aborted) throw err;
          if (err instanceof ToolError) return { content: [{ type: "text", text: err.message }], isError: true };
          console.error(`opencode-lens mcp: errore in ${tool.name}`, err);
          return { content: [{ type: "text", text: `errore interno di opencode-lens mcp: ${err.message}` }], isError: true };
        }
      }
      case "prompts/list": {
        if (!prompts) break;
        try {
          const listed = (await prompts.list(signal)).map((p) => ({ name: p.id, title: cleanName(p.name) ?? p.id, description: cleanName(p.brief, PROMPT_BRIEF_MAX) ?? "" }));
          failures.clear(); // a failure after this one is news again
          return { prompts: listed };
        } catch (err) {
          if (signal.aborted) throw err;
          // the lens is down, the token is wrong or the config is invalid: clients ask at start and an empty list is
          // the honest answer, but the commands vanish without a word, so the reason goes to stderr (once per reason)
          if (!failures.has(err.message)) {
            failures.add(err.message);
            console.error(`opencode-lens mcp: prompts/list non riuscito, elenco vuoto: ${err.message}`);
          }
          return { prompts: [] };
        }
      }
      case "prompts/get": {
        if (!prompts) break;
        const name = params?.name;
        if (typeof name !== "string" || !name) throw Object.assign(new Error("name deve essere un testo non vuoto"), { rpc: -32602 });
        let got;
        try {
          got = await prompts.get({ name }, signal, { channel: "lens-prompt", sessionID: typeof params._meta?.[SESSION_META] === "string" ? params._meta[SESSION_META] : null });
        } catch (err) {
          if (signal.aborted) throw err;
          // only an unknown prompt is the client's mistake: a lens that is down or a bad config is the server's
          if (err instanceof PromptNotFoundError) throw Object.assign(new Error(err.message), { rpc: -32602 });
          console.error("opencode-lens mcp: errore in prompts/get", err);
          throw Object.assign(new Error(err.message), { rpc: -32603 });
        }
        return { description: String(got?.description ?? ""), messages: [{ role: "user", content: { type: "text", text: String(got?.text ?? "") } }] };
      }
    }
    throw Object.assign(new Error(`metodo sconosciuto: ${method}`), { rpc: -32601 });
  }

  return {
    async handle(msg, { signal }) {
      if (msg === null || typeof msg !== "object" || Array.isArray(msg)) return rpcError(null, -32600, "richiesta non valida");
      const id = msg.id;
      const isRequest = id !== undefined && id !== null;
      // a response from the client (we never send requests) or a notification: nothing to answer
      if (typeof msg.method !== "string") return isRequest && !("result" in msg || "error" in msg) ? rpcError(id, -32600, "richiesta non valida: manca method") : null;
      if (!isRequest) return null;
      const params = msg.params;
      if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) return rpcError(id, -32602, "params deve essere un oggetto");
      const asked = params?._meta?.[PROTOCOL_META];
      const modern = asked !== undefined;
      if (modern && asked !== PROTOCOL.modern) {
        return rpcError(id, -32022, `revisione MCP non supportata: ${asked}`, { supported: [PROTOCOL.modern], requested: asked });
      }
      try {
        const r = await result(msg.method, params, signal);
        return { jsonrpc: "2.0", id, result: modern || msg.method === "server/discover" ? { resultType: "complete", ...r } : r };
      } catch (err) {
        if (err.rpc) return rpcError(id, err.rpc, err.message);
        throw err;
      }
    },
  };
}
