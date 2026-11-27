// Finto servizio OpenCode V2 per i test: service.json temporaneo, Basic auth,
// /api/health, /api/event (SSE), /api/session e /api/session/{id}/message
// con paginazione a cursore. Le forme dei dati ricalcano la beta 17823.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PASSWORD = "pw-test-1234";

/** Due sessioni: una principale con titolo generato (task interno), una figlia. */
export function scenario(T0) {
  const tok = (input, output, reasoning = 0, read = 0, write = 0) => ({ input, output, reasoning, cache: { read, write } });
  const sonnet = { id: "claude-sonnet-5-5", providerID: "anthropic" };
  const qwen = { id: "qwen3.5-9b", providerID: "lmstudio", variant: "default" };
  const m1 = {
    id: "msg_a1", type: "assistant", agent: "build", model: sonnet, finish: "tool-calls",
    cost: 0.012, tokens: tok(1000, 200, 50, 3000, 500),
    time: { created: T0 + 1000, streamed: T0 + 3900, completed: T0 + 4000 },
    content: [
      { type: "text", text: "non salvato" },
      { type: "tool", id: "call_1", name: "read", state: { status: "completed" }, time: { created: T0 + 3000, ran: T0 + 3100, completed: T0 + 3500 } },
    ],
  };
  const m2 = {
    id: "msg_a2", type: "assistant", agent: "build", model: qwen, finish: "stop",
    cost: 0, tokens: tok(800, 100),
    time: { created: T0 + 5000, streamed: T0 + 8800, completed: T0 + 9000 },
    content: [
      { type: "tool", id: "call_2", name: "bash", state: { status: "error", error: { type: "ToolError", message: "exit 1" } }, time: { created: T0 + 6000, ran: T0 + 6100, completed: T0 + 6400 } },
    ],
  };
  const m3 = {
    id: "msg_a3", type: "assistant", agent: "build", model: sonnet, finish: "error",
    error: { type: "APIError", message: "overloaded", status: 529 },
    cost: 0, tokens: tok(0, 0),
    time: { created: T0 + 10_000, completed: T0 + 13_000 },
    content: [],
  };
  const c1 = {
    id: "msg_c1", type: "assistant", agent: "explore", model: sonnet, finish: "stop",
    cost: 0.003, tokens: tok(400, 60, 0, 1200, 0),
    time: { created: T0 + 6000, completed: T0 + 7500 },
    content: [],
  };
  const user = (id, created) => ({ id, type: "user", time: { created }, content: [{ type: "text", text: "prompt non salvato" }] });
  // generazione del titolo: nessuno step visibile, solo nei totali di sessione
  const title = { cost: 0.0005, tokens: tok(120, 15) };
  // compaction automatica (OpenCode 2.0.32): messaggio con modello e consumo, il riassunto non si salva
  const cmp = {
    id: "msg_cmp", type: "compaction", status: "completed", reason: "auto", model: sonnet,
    cost: 0.002, tokens: tok(5000, 300), summary: "riassunto non salvato", recent: "",
    time: { created: T0 + 9500 },
  };
  const sum = (...usages) => {
    const t = tok(0, 0);
    let cost = 0;
    for (const m of usages) {
      cost += m.cost;
      t.input += m.tokens.input; t.output += m.tokens.output; t.reasoning += m.tokens.reasoning;
      t.cache.read += m.tokens.cache.read; t.cache.write += m.tokens.cache.write;
    }
    return { cost, tokens: t };
  };
  const s1 = {
    id: "ses_main", projectID: "prj_1", location: { directory: "/tmp/progetto" }, title: "Refactor del parser",
    ...sum(m1, m2, m3, title, cmp),
    time: { created: T0, updated: T0 + 13_000 },
  };
  const s2 = {
    id: "ses_child", parentID: "ses_main", projectID: "prj_1", location: { directory: "/tmp/progetto" }, title: "Sottoagente explore",
    ...sum(c1),
    time: { created: T0 + 5500, updated: T0 + 7500 },
  };
  const ev = (n, type, created, data) => ({ id: `evt_${String(n).padStart(3, "0")}`, type, created, data });
  const events = [
    ev(1, "session.created", T0, { sessionID: "ses_main", projectID: "prj_1", location: { directory: "/tmp/progetto" } }),
    ev(2, "session.step.started", T0 + 1000, { sessionID: "ses_main", assistantMessageID: "msg_a1", agent: "build", model: sonnet, started: T0 + 1000 }),
    ev(3, "session.tool.input.started", T0 + 3000, { sessionID: "ses_main", assistantMessageID: "msg_a1", id: "call_1", name: "read" }),
    ev(4, "session.tool.called", T0 + 3100, { sessionID: "ses_main", assistantMessageID: "msg_a1", id: "call_1", name: "read" }),
    ev(5, "session.tool.success", T0 + 3500, { sessionID: "ses_main", assistantMessageID: "msg_a1", id: "call_1" }),
    ev(6, "session.step.ended", T0 + 4000, { sessionID: "ses_main", assistantMessageID: "msg_a1", finish: "tool-calls", cost: m1.cost, tokens: m1.tokens }),
    ev(7, "session.step.started", T0 + 5000, { sessionID: "ses_main", assistantMessageID: "msg_a2", agent: "build", model: qwen, started: T0 + 5000 }),
    ev(8, "session.created", T0 + 5500, { sessionID: "ses_child", parentID: "ses_main", projectID: "prj_1", location: { directory: "/tmp/progetto" } }),
    ev(9, "session.step.started", T0 + 6000, { sessionID: "ses_child", assistantMessageID: "msg_c1", agent: "explore", model: sonnet, started: T0 + 6000 }),
    ev(10, "session.tool.input.started", T0 + 6000, { sessionID: "ses_main", assistantMessageID: "msg_a2", id: "call_2", name: "bash" }),
    ev(11, "session.tool.failed", T0 + 6400, { sessionID: "ses_main", assistantMessageID: "msg_a2", id: "call_2", error: { type: "ToolError", message: "exit 1" } }),
    ev(12, "session.step.ended", T0 + 7500, { sessionID: "ses_child", assistantMessageID: "msg_c1", finish: "stop", cost: c1.cost, tokens: c1.tokens }),
    ev(13, "session.usage.updated", T0 + 7500, { sessionID: "ses_child", cost: s2.cost, tokens: s2.tokens }),
    ev(14, "session.step.ended", T0 + 9000, { sessionID: "ses_main", assistantMessageID: "msg_a2", finish: "stop", cost: m2.cost, tokens: m2.tokens }),
    ev(15, "session.step.started", T0 + 10_000, { sessionID: "ses_main", assistantMessageID: "msg_a3", agent: "build", model: sonnet, started: T0 + 10_000 }),
    ev(16, "session.retry.scheduled", T0 + 11_000, { sessionID: "ses_main", assistantMessageID: "msg_a3", attempt: 1, error: { type: "APIError", message: "overloaded", status: 529 } }),
    ev(17, "session.step.started", T0 + 12_000, { sessionID: "ses_main", assistantMessageID: "msg_a3", agent: "build", model: sonnet, started: T0 + 12_000 }),
    ev(18, "session.step.failed", T0 + 13_000, { sessionID: "ses_main", assistantMessageID: "msg_a3", error: { type: "APIError", message: "overloaded", status: 529 } }),
    ev(19, "session.renamed", T0 + 13_000, { sessionID: "ses_main", title: s1.title }),
    ev(20, "session.usage.updated", T0 + 13_000, { sessionID: "ses_main", cost: s1.cost, tokens: s1.tokens }),
    ev(21, "session.execution.succeeded", T0 + 13_000, { sessionID: "ses_main" }),
  ];
  return {
    sessions: [s1, s2],
    messages: {
      ses_main: [user("msg_u1", T0 + 500), m1, m2, cmp, m3],
      ses_child: [user("msg_u2", T0 + 5600), c1],
    },
    events,
  };
}

/**
 * Avvia il finto servizio e scrive il service.json in una cartella temporanea.
 * `onEventStream(res, data)` scrive lo stream SSE; di default invia `data.events`.
 */
export async function startFakeOpencode({ data, pageSize = 2, onEventStream } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-lens-test-"));
  const serviceFile = path.join(dir, "service.json");
  const log = { requests: [], unauthorized: 0, badQuery: 0 };
  const expected = "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64");
  let eventsSent;
  const eventsDone = new Promise((r) => (eventsSent = r));

  const page = (res, items, url) => {
    if (url.searchParams.has("cursor") && url.searchParams.has("order")) {
      log.badQuery++;
      return reply(res, 400, { error: "order non ammesso insieme a cursor" });
    }
    // like the real service, the cursor carries the order of the first page
    const [cOrder, cStart] = (url.searchParams.get("cursor") ?? "").split(":");
    const order = cOrder || url.searchParams.get("order") || "asc";
    const sorted = [...items].sort((a, b) => (a.time.created - b.time.created) * (order === "desc" ? -1 : 1));
    const start = Number(cStart ?? 0);
    const slice = sorted.slice(start, start + pageSize);
    const next = start + pageSize < sorted.length ? `${order}:${start + pageSize}` : undefined;
    reply(res, 200, { data: slice, cursor: { next } });
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    log.requests.push(url.pathname);
    if (req.headers.authorization !== expected) {
      log.unauthorized++;
      return reply(res, 401, { error: "unauthorized" });
    }
    const p = url.pathname;
    if (p === "/api/health") return reply(res, 200, { healthy: true, version: "2.0.0-beta.17823", pid: 4242 });
    if (p === "/api/model") return reply(res, 200, { location: "global", data: data.models ?? [] });
    if (p === "/api/mcp" && data.mcpDelayMs) await new Promise((r) => setTimeout(r, data.mcpDelayMs));
    if (p === "/api/mcp") return data.mcp === 404 ? reply(res, 404, {}) : reply(res, 200, data.mcp ?? { location: { directory: dir }, data: [] });
    if (p === "/api/event") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": heartbeat\n\n");
      if (onEventStream) await onEventStream(res, data);
      else for (const e of data.events) res.write(`id: ${e.id}\nevent: message\ndata: ${JSON.stringify(e)}\n\n`);
      setTimeout(eventsSent, 100);
      return; // resta aperto, come il servizio vero
    }
    // il backfill parte solo dopo gli eventi live: ordine deterministico
    await eventsDone;
    if (p === "/api/session") return page(res, data.sessions, url);
    let m = /^\/api\/session\/([^/]+)\/message$/.exec(p);
    if (m) return page(res, data.messages[decodeURIComponent(m[1])] ?? [], url);
    m = /^\/api\/session\/([^/]+)$/.exec(p);
    if (m) {
      const s = data.sessions.find((x) => x.id === decodeURIComponent(m[1]));
      return s ? reply(res, 200, { data: s }) : reply(res, 404, {});
    }
    reply(res, 404, {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(serviceFile, JSON.stringify({ url, pid: 4242, version: "2.0.0-beta.17823", password: PASSWORD }));

  return {
    url,
    serviceFile,
    log,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
