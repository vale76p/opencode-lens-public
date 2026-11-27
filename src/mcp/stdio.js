// The MCP's transport: newline-delimited JSON-RPC on stdin/stdout.
import readline from "node:readline";
import { rpcError } from "./protocol.js";

/**
 * Newline-delimited JSON-RPC on `input`/`output`. Each request gets an AbortController:
 * notifications/cancelled aborts it and its response is dropped. Closing `input` aborts
 * everything still running and calls onClose. Returns `notify(method, params)`, which writes
 * a server notification (no id).
 */
export function serveStdio({ input, output, handler, onClose = () => {} }) {
  const inflight = new Map();
  const write = (frame) => output.write(`${JSON.stringify(frame)}\n`);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return write(rpcError(null, -32700, "JSON non valido"));
    }
    if (Array.isArray(msg)) return write(rpcError(null, -32600, "richiesta non valida: i batch non sono supportati"));
    if (msg?.method === "notifications/cancelled") {
      inflight.get(msg.params?.requestId)?.abort(msg.params?.reason ?? "annullata");
      return;
    }
    const ctrl = new AbortController();
    const id = msg?.id;
    if (id !== undefined && id !== null) inflight.set(id, ctrl);
    handler
      .handle(msg, { signal: ctrl.signal })
      .then(
        (res) => {
          if (res && !ctrl.signal.aborted) write(res);
        },
        (err) => {
          if (ctrl.signal.aborted) return;
          console.error("opencode-lens mcp: errore interno", err);
          write(rpcError(id ?? null, -32603, "errore interno"));
        },
      )
      .finally(() => {
        if (inflight.get(id) === ctrl) inflight.delete(id);
      });
  });
  rl.on("close", () => {
    for (const ctrl of inflight.values()) ctrl.abort("stdin chiuso");
    inflight.clear();
    onClose();
  });
  return { notify: (method, params) => write({ jsonrpc: "2.0", method, params }) };
}
