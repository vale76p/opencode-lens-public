// Finto provider compatibile OpenAI (Chat Completions, streaming SSE) per i test
// di integrazione: risposte scriptate, nessuna credenziale, nessuna rete.
import http from "node:http";

/**
 * `script` è una lista di risposte per le richieste dell'agente (quelle con
 * dei tool), in ordine:
 *   { text: "..." }                                   risposta finale
 *   { tool: { name: "read", args: { path } } }        chiamata a un tool
 *   { ..., delayMs: 1500 }                            risponde dopo un'attesa
 * Le richieste senza tool (titolo della sessione, compaction) ricevono un
 * testo fisso e non consumano lo script. Oltre la fine risponde "fine".
 */
export async function startFakeModel(script) {
  const requests = [];
  let n = 0; // every request
  let k = 0; // agent-loop requests: position in the script
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const url = new URL(req.url, "http://x");
      if (req.method === "GET" && url.pathname.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ object: "list", data: [{ id: "lens-test", object: "model" }] }));
      }
      if (!url.pathname.endsWith("/chat/completions")) {
        res.writeHead(404);
        return res.end();
      }
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* keep empty */
      }
      requests.push(parsed);
      const agentLoop = Array.isArray(parsed.tools) && parsed.tools.length > 0;
      const step = agentLoop ? (script[k++] ?? { text: "fine" }) : { text: "Titolo di prova" };
      n++;
      const id = `chatcmpl-${n}`;
      const chunk = (delta, finish = null, usage) =>
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: parsed.model ?? "lens-test", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
      if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(chunk({ role: "assistant" }));
      const usage = { prompt_tokens: 100 + n, completion_tokens: 10 + n, total_tokens: 110 + 2 * n };
      if (step.tool) {
        res.write(chunk({ tool_calls: [{ index: 0, id: `call_${n}`, type: "function", function: { name: step.tool.name, arguments: "" } }] }));
        res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(step.tool.args) } }] }));
        res.write(chunk({}, "tool_calls"));
      } else {
        res.write(chunk({ content: step.text }));
        res.write(chunk({}, "stop"));
      }
      // usage in a final chunk with no choices, as OpenAI does with stream_options.include_usage
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "lens-test", choices: [], usage })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * A provider that always fails: `GET …/models` answers like startFakeModel,
 * every other request gets `status` with the JSON `body` (e.g. 429 quota
 * exhausted) and counts as one hit.
 */
export async function startFailingModel({ status = 429, headers = {}, body }) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.method === "GET" && req.url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ object: "list", data: [{ id: "lens-test", object: "model" }] }));
      }
      hits++;
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    hits: () => hits,
    close: () => new Promise((r) => server.close(r)),
  };
}
