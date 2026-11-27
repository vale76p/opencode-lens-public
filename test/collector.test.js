import { test } from "node:test";
import assert from "node:assert/strict";
import { Collector } from "../src/collector.js";
import { OpencodeClient, OpencodeUnavailable, discover } from "../src/opencode.js";
import { setLogLevel } from "../src/log.js";
import { memoryStore, waitFor } from "./helpers.js";
import { startFakeOpencode, scenario } from "./fake-opencode.js";

setLogLevel("error");

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const config = (serviceFile, extra = {}) => ({ serviceFile, serverUrl: "", storeTitles: true, scanIntervalMs: 120_000, ...extra });

test("parser SSE: commenti, CRLF, chunk spezzati, data su più righe, JSON non valido", async () => {
  const chunks = [
    "id: 1\nevent: message\ndata: {\"type\":\"a\",\"n\":1}\n\n",
    "data:{\"type\":\"b\"}\r\n\r\n",
    "data: {\"type\":\"c\",",
    Buffer.from("\"x\":\"é\"}\n").subarray(0, 7), // spezza anche la "é" (2 byte) tra due chunk
    Buffer.from("\"x\":\"é\"}\n").subarray(7),
    "\n: ping\n\n",
    "data: {\"type\":\"d\",\ndata: \"y\":2}\n\n",
    "data: non json\n\n",
    "data: {\"type\":\"e\"}\n\n",
  ];
  const fake = await startFakeOpencode({
    data: { events: [] },
    async onEventStream(res) {
      for (const c of chunks) {
        res.write(c);
        await pause(15);
      }
      res.end();
    },
  });
  try {
    const client = new OpencodeClient(config(fake.serviceFile));
    const events = [];
    let opened = 0;
    await client.stream({ onOpen: () => opened++, onEvent: (e) => events.push(e) });
    assert.equal(opened, 1);
    assert.deepEqual(events, [
      { type: "a", n: 1 },
      { type: "b" },
      { type: "c", x: "é" },
      { type: "d", y: 2 },
      { type: "e" },
    ]);
    assert.equal(fake.log.unauthorized, 0);
  } finally {
    await fake.close();
  }
});

test("discovery: service.json assente, password errata → nuova discovery", async () => {
  await assert.rejects(discover(config("/nonesiste/service.json")), (err) => err instanceof OpencodeUnavailable && /servizio non registrato/.test(err.message));

  const fake = await startFakeOpencode({ data: { events: [], sessions: [], messages: {} } });
  try {
    // server esplicito con password sbagliata: 401 e endpoint azzerato
    const wrong = new OpencodeClient({ serverUrl: fake.url + "/", serverPassword: "sbagliata", serverUsername: "opencode" });
    await assert.rejects(wrong.connect(), OpencodeUnavailable);
    assert.equal(wrong.endpoint, null);
    // stesso server via service.json: Basic auth con la password giusta
    const client = new OpencodeClient(config(fake.serviceFile));
    const info = await client.connect();
    assert.equal(info.version, "2.0.0-beta.17823");
    assert.equal(info.pid, 4242);
    assert.equal(info.url, fake.url);
    assert.equal(info.source, fake.serviceFile);
  } finally {
    await fake.close();
  }
});

test("collector contro un finto OpenCode: live + backfill riconciliati coi totali di sessione", async () => {
  const T0 = Date.now() - 60_000;
  const data = scenario(T0);
  const fake = await startFakeOpencode({ data, pageSize: 2 });
  const store = memoryStore();
  const collector = new Collector(config(fake.serviceFile), store);
  const ctrl = new AbortController();
  const running = collector.run(ctrl.signal);
  try {
    // il sync differito di session.execution.succeeded rilegge ses_main via GET /api/session/{id}
    await waitFor(
      () =>
        collector.state === "connected" &&
        !collector.scan.running &&
        collector.scan.lastEnd &&
        fake.log.requests.includes("/api/session/ses_main") &&
        collector.syncing.size === 0 &&
        collector.pendingSync.size === 0,
      { what: "scan completo e sync di fine run" },
    );

    assert.equal(fake.log.unauthorized, 0, "ogni richiesta usa la Basic auth");
    assert.equal(fake.log.badQuery, 0, "mai order insieme a cursor");
    assert.equal(collector.status().server.version, "2.0.0-beta.17823");
    assert.equal(collector.eventsSeen, data.events.length);
    assert.deepEqual(collector.status().drift, [], "tutte le forme di evento rispettano il contratto");
    assert.equal(collector.scan.sessions, 2);

    // Σ step + Σ interni = totali di OpenCode, sessione per sessione
    for (const s of data.sessions) {
      const st = store.db
        .prepare(`SELECT COUNT(*) n, SUM(cost) c, SUM(t_in) i, SUM(t_out) o, SUM(t_reason) r, SUM(t_cread) cr, SUM(t_cwrite) cw FROM steps WHERE session_id = ?`)
        .get(s.id);
      const it = store.db
        .prepare(`SELECT COALESCE(SUM(cost),0) c, COALESCE(SUM(t_in),0) i, COALESCE(SUM(t_out),0) o, COALESCE(SUM(t_reason),0) r, COALESCE(SUM(t_cread),0) cr, COALESCE(SUM(t_cwrite),0) cw FROM internal_usage WHERE session_id = ?`)
        .get(s.id);
      const assistant = data.messages[s.id].filter((m) => m.type === "assistant").length;
      assert.equal(st.n, assistant, `${s.id}: uno step per messaggio assistant`);
      assert.ok(Math.abs(st.c + it.c - s.cost) < 1e-9, `${s.id}: costo`);
      assert.deepEqual(
        [st.i + it.i, st.o + it.o, st.r + it.r, st.cr + it.cr, st.cw + it.cw],
        [s.tokens.input, s.tokens.output, s.tokens.reasoning, s.tokens.cache.read, s.tokens.cache.write],
        `${s.id}: token per tipo`,
      );
    }

    // due task interni, registrati una volta sola: la compaction esatta dal suo messaggio,
    // il titolo come stima (lo scenario non manda session.usage.recorded)
    const internal = store.db.prepare(`SELECT * FROM internal_usage ORDER BY id`).all();
    assert.deepEqual(internal.map((r) => [r.id, r.session_id, r.kind, r.model, r.reason, r.t_in, r.t_out]), [
      ["msg_cmp", "ses_main", "compaction", "claude-sonnet-5-5", "auto", 5000, 300],
      ["ses_main:1", "ses_main", null, null, null, 120, 15],
    ]);
    assert.ok(Math.abs(internal[1].cost - 0.0005) < 1e-12);

    const step = (id) => store.db.prepare(`SELECT * FROM steps WHERE id = ?`).get(id);
    assert.equal(step("msg_a1").model, "claude-sonnet-5-5");
    assert.equal(step("msg_a1").provider, "anthropic");
    assert.equal(step("msg_a1").ended, T0 + 4000);
    assert.equal(step("msg_a3").attempts, 2, "il retry riusa lo stesso ID");
    assert.equal(step("msg_a3").finish, "error");
    assert.equal(step("msg_a3").error_type, "APIError");
    assert.match(step("msg_a3").error_msg, /overloaded \(HTTP 529\)/);
    assert.equal(step("msg_c1").agent, "explore");
    // v4: richiesta, primo output (dal vivo: il messaggio comincia con testo) e fine dello stream
    assert.deepEqual([step("msg_a1").requested, step("msg_a1").first_output, step("msg_a1").streamed], [T0 + 1000, T0 + 3000, T0 + 3900]);
    assert.deepEqual([step("msg_a2").requested, step("msg_a2").first_output, step("msg_a2").streamed], [T0 + 5000, T0 + 6000, T0 + 8800]);

    const tool = (id) => store.db.prepare(`SELECT * FROM tools WHERE id = ?`).get(id);
    assert.equal(tool("msg_a1:call_1").status, "completed");
    assert.equal(tool("msg_a1:call_1").ran, T0 + 3100);
    assert.equal(tool("msg_a2:call_2").status, "error");
    assert.equal(tool("msg_a2:call_2").name, "bash");
    assert.match(tool("msg_a2:call_2").error_msg, /exit 1/);

    const sessions = store.db.prepare(`SELECT * FROM sessions ORDER BY id`).all();
    assert.deepEqual(sessions.map((s) => [s.id, s.parent_id, s.title, s.directory]), [
      ["ses_child", "ses_main", "Sottoagente explore", "/tmp/progetto"],
      ["ses_main", null, "Refactor del parser", "/tmp/progetto"],
    ]);
    const signals = store.db.prepare(`SELECT type, message_id FROM signals`).all();
    assert.deepEqual(signals.map((s) => ({ ...s })), [{ type: "session.retry.scheduled", message_id: "msg_a3" }]);

    // nessun prompt o testo salvato
    const dump = ["steps", "tools", "internal_usage", "signals"].map((t) => JSON.stringify(store.db.prepare(`SELECT * FROM ${t}`).all())).join("");
    assert.ok(!dump.includes("non salvato"));

    // un secondo scan senza cambiamenti non sincronizza nulla e non duplica
    await collector.fullScan();
    assert.equal(collector.scan.synced, 0);
    // un resync completo non duplica né step né task interni
    await collector.fullScan({ force: true });
    assert.equal(collector.scan.synced, 2);
    assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM steps`).get().n, 4);
    assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM internal_usage`).get().n, 2);
  } finally {
    ctrl.abort();
    await running;
    await fake.close();
    store.close();
  }
  assert.equal(collector.state, "stopped");
});

test("401 concorrente: la richiesta in volo che fallisce in rete dà OpencodeUnavailable", async () => {
  const http = await import("node:http");
  const srv = http.createServer((req, res) => {
    if (req.url === "/a") {
      res.writeHead(401);
      res.end();
    } else setTimeout(() => req.socket.destroy(), 100); // connessione chiusa a metà richiesta
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const client = new OpencodeClient({ serverUrl: `http://127.0.0.1:${srv.address().port}`, serverPassword: "x", serverUsername: "opencode" });
    const [b, a] = await Promise.allSettled([client.request("/b"), client.request("/a")]);
    assert.ok(a.reason instanceof OpencodeUnavailable, String(a.reason));
    assert.ok(b.reason instanceof OpencodeUnavailable, String(b.reason));
    assert.match(b.reason.message, /connessione a http:\/\/127\.0\.0\.1:\d+ fallita/);
    assert.equal(client.endpoint, null, "il 401 azzera l'endpoint");
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
});

/** Collector with an open event stream (the fake answers the backfill only after it). */
async function streamingCollector(data, pageSize) {
  const fake = await startFakeOpencode({ data, pageSize });
  const store = memoryStore();
  const collector = new Collector(config(fake.serviceFile, { storeTitles: false }), store);
  const ctrl = new AbortController();
  const streaming = collector.client.stream({ signal: ctrl.signal, onEvent() {} }).catch(() => {});
  return {
    fake,
    store,
    collector,
    async close() {
      ctrl.abort();
      await streaming;
      await fake.close();
      store.close();
    },
  };
}

test("run lungo: l'inizio resta quello del prompt anche se il sync incrementale non lo rilegge", async () => {
  const T0 = Date.now() - 3 * 3_600_000;
  const STEP = 60_000; // uno step al minuto, 30 minuti di run
  const tok = { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  const prompt = { id: "u1", type: "user", text: "x", metadata: {}, time: { created: T0 } };
  const asst = (i) => ({
    id: `a${String(i).padStart(3, "0")}`, type: "assistant", model: { id: "m", providerID: "p" }, finish: "tool-calls", cost: 0.001, tokens: tok,
    time: { created: T0 + 1000 + i * STEP, completed: T0 + 1000 + i * STEP + 5000, streamed: T0 + 1100 + i * STEP }, content: [],
  });
  const all = [prompt, ...Array.from({ length: 30 }, (_, i) => asst(i))];
  const idle = { id: "idle1", type: "idle", outcome: "succeeded", time: { created: T0 + 1000 + 30 * STEP + 6000 } };
  const session = (msgs, updated) => {
    const n = msgs.filter((m) => m.type === "assistant").length;
    return { id: "s1", cost: n * 0.001, tokens: { ...tok, input: 10 * n, output: n }, time: { created: T0, updated } };
  };
  // uno scan periodico vede il run dopo 25 step
  const first = all.slice(0, 26);
  const data = { events: [], sessions: [session(first, first.at(-1).time.completed)], messages: { s1: first } };
  const h = await streamingCollector(data, 10);
  try {
    await h.collector.syncSession("s1");
    // il run continua e finisce: il sync incrementale legge solo le pagine recenti
    data.messages.s1 = [...all, idle];
    data.sessions[0] = session(all, idle.time.created);
    await h.collector.syncSession("s1");
    const run = h.store.db.prepare(`SELECT started, ended FROM runs WHERE id = 'idle1'`).get();
    assert.equal(run.started, T0, "inizio = prompt");
    assert.equal(run.ended, idle.time.created);
  } finally {
    await h.close();
  }
});

/** A finished session of `n` assistant steps (1 token in, 1 out, 0.001 each) after one prompt, and its idle. */
function longSession(n) {
  const T0 = Date.now() - 3 * 3_600_000;
  const tok = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  const msgs = [{ id: "u0", type: "user", text: "x", metadata: {}, time: { created: T0 } }];
  for (let i = 0; i < n; i++) {
    const at = T0 + 1000 + i * 1000;
    msgs.push({
      id: `a${String(i).padStart(5, "0")}`, type: "assistant", model: { id: "m", providerID: "p" }, finish: "stop", cost: 0.001, tokens: tok,
      time: { created: at, streamed: at + 100, completed: at + 500 },
      content: [{ type: "tool", id: `c${i}`, name: "read", state: { status: "completed" }, time: { created: at + 10, ran: at + 20, completed: at + 30 } }],
    });
  }
  const end = T0 + 1000 + n * 1000;
  msgs.push({ id: "idle1", type: "idle", outcome: "succeeded", time: { created: end } });
  const session = { id: "s1", cost: n * 0.001, tokens: { ...tok, input: n, output: n }, time: { created: T0, updated: end } };
  return { events: [], sessions: [session], messages: { s1: msgs } };
}

/** Records how many steps each store.tx() wrote; `fail` throws inside the n-th one (rolled back). */
function watchTx(store, { fail = null } = {}) {
  const tx = store.tx.bind(store);
  const count = () => store.db.prepare("SELECT COUNT(*) n FROM steps").get().n;
  const sizes = [];
  store.tx = (fn) =>
    tx(() => {
      const before = count();
      const r = fn();
      if (sizes.length + 1 === fail) throw new Error("scrittura fallita");
      sizes.push(count() - before);
      return r;
    });
  return { sizes, restore: () => (store.tx = tx) };
}

test("sync di una sessione lunga: gli step si scrivono a blocchi, non in una transazione sola", async () => {
  const data = longSession(1200);
  const h = await streamingCollector(data, 100);
  try {
    const w = watchTx(h.store);
    await h.collector.syncSession("s1");
    assert.ok(w.sizes.length > 1, `${w.sizes.length} transazioni`);
    assert.ok(Math.max(...w.sizes) <= 500, `al più 500 step per transazione, non ${Math.max(...w.sizes)}`);
    const st = h.store.db.prepare("SELECT COUNT(*) n, SUM(cost) cost FROM steps").get();
    assert.equal(st.n, 1200);
    assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM tools").get().n, 1200);
    assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM internal_usage").get().n, 0, "Σ step = totali: nessuna stima");
    assert.equal(h.store.db.prepare("SELECT started FROM runs WHERE id = 'idle1'").get().started, data.messages.s1[0].time.created, "inizio = prompt, anche con gli step scritti a blocchi");
  } finally {
    await h.close();
  }
});

test("sync interrotto a metà: i blocchi scritti restano, il watermark e la stima no, il sync successivo completa", async () => {
  const h = await streamingCollector(longSession(1200), 100);
  try {
    const w = watchTx(h.store, { fail: 2 });
    await assert.rejects(h.collector.syncSession("s1"), /scrittura fallita/);
    const s = h.store.db.prepare("SELECT msg_watermark, synced_cost FROM sessions WHERE id = 's1'").get();
    assert.equal(s.msg_watermark, null, "watermark non avanzato");
    assert.equal(s.synced_cost, null, "sessione da risincronizzare");
    assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM internal_usage").get().n, 0, "nessuna stima da step mancanti");
    const partial = h.store.db.prepare("SELECT COUNT(*) n FROM steps").get().n;
    assert.ok(partial > 0 && partial < 1200, `${partial} step dal primo blocco`);
    w.restore();
    await h.collector.syncSession("s1");
    assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM steps").get().n, 1200);
    assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM internal_usage").get().n, 0);
    assert.ok(h.store.db.prepare("SELECT msg_watermark FROM sessions WHERE id = 's1'").get().msg_watermark > 0);
  } finally {
    await h.close();
  }
});

test("--resync durante uno scan già in corso: la rilettura completa avviene dopo, non viene saltata", async () => {
  const T0 = Date.now() - 3_600_000;
  const N = 30;
  const tok = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  const sessions = [];
  const messages = {};
  for (let i = 0; i < N; i++) {
    sessions.push({ id: `s${i}`, cost: 0.001, tokens: tok, time: { created: T0 + i, updated: T0 + i + 10 } });
    messages[`s${i}`] = [{ id: `m${i}`, type: "assistant", cost: 0.001, tokens: tok, model: { id: "x", providerID: "p" }, time: { created: T0 + i, completed: T0 + i + 5, streamed: T0 + i + 1 }, content: [] }];
  }
  const h = await streamingCollector({ events: [], sessions, messages }, 100);
  try {
    const auto = h.collector.fullScan(); // lo scan automatico della connessione
    assert.equal(h.collector.scan.running, true);
    await h.collector.fullScan({ force: true });
    const reads = h.fake.log.requests.filter((p) => p.endsWith("/message")).length;
    assert.equal(reads, 2 * N, "scan iniziale + rilettura forzata");
    assert.equal(h.collector.scan.running, false);
    await auto;
  } finally {
    await h.close();
  }
});

test("legge /api/model alla connessione", async () => {
  const entry = (id) => ({ id, providerID: "lmstudio", modelID: "qwen3.5-9b-mlx", name: "Qwen", limit: { context: 200000, output: 32000 } });
  const fake = await startFakeOpencode({ data: { events: [], sessions: [], messages: {}, models: [entry("a"), entry("b")] } });
  const collector = new Collector(config(fake.serviceFile), memoryStore());
  const ctrl = new AbortController();
  const running = collector.run(ctrl.signal);
  try {
    await waitFor(() => collector.models.limit("lmstudio/qwen3.5-9b-mlx"), { what: "catalogo letto" });
    assert.equal(collector.models.limit("lmstudio/qwen3.5-9b-mlx").context, 200000);
    assert.ok(fake.log.requests.includes("/api/model"));
    assert.equal(fake.log.unauthorized, 0);
  } finally {
    ctrl.abort();
    await running;
    await fake.close();
  }
});

test("il drift del catalogo modelli compare nello stato del collector", async () => {
  const fake = await startFakeOpencode({ data: { events: [], sessions: [], messages: {}, models: [{ providerID: "p", modelID: "m", limit: {} }] } });
  const collector = new Collector(config(fake.serviceFile), memoryStore());
  const ctrl = new AbortController();
  const running = collector.run(ctrl.signal);
  try {
    await waitFor(() => collector.status().drift.some((d) => d.type === "GET /api/model"), { what: "drift del catalogo" });
    const d = collector.status().drift.find((x) => x.type === "GET /api/model");
    assert.deepEqual(d.missing, ["data[].limit.context"]);
  } finally {
    ctrl.abort();
    await running;
    await fake.close();
  }
});

/** One finished run (prompt, one step, idle) ending `endedAgo` ms ago. */
function finishedRun(endedAgo) {
  const tok = { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  const T = Date.now() - endedAgo - 10_000;
  const msgs = [
    { id: "u1", type: "user", text: "x", metadata: {}, time: { created: T } },
    { id: "a1", type: "assistant", model: { id: "m", providerID: "p" }, finish: "stop", cost: 0.001, tokens: tok, time: { created: T + 1000, completed: T + 5000, streamed: T + 1100 }, content: [] },
    { id: "idle1", type: "idle", outcome: "succeeded", time: { created: T + 6000 } },
  ];
  const session = { id: "s1", cost: 0.001, tokens: { ...tok }, time: { created: T, updated: T + 6000 } };
  return { T, data: { events: [], sessions: [session], messages: { s1: msgs } } };
}

test("un idle nuovo manda un evento run dopo il commit", async () => {
  const r = finishedRun(60_000);
  const h = await streamingCollector(r.data, 10);
  try {
    const seen = [];
    h.store.onChange((kind, item) => {
      if (kind === "feed" && item.kind === "run") seen.push({ item, committed: !!h.store.db.prepare(`SELECT 1 FROM runs WHERE id = 'idle1'`).get() });
    });
    await h.collector.syncSession("s1");
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].item, { at: r.T + 6000, kind: "run", sessionID: "s1", outcome: "succeeded", durationMs: 6000 });
    assert.ok(seen[0].committed, "emesso dopo il commit");
  } finally {
    await h.close();
  }
});

test("una nuova lettura di run vecchi non manda eventi", async () => {
  const r = finishedRun(3_600_000);
  const h = await streamingCollector(r.data, 10);
  try {
    const seen = [];
    h.store.onChange((kind, item) => kind === "feed" && item.kind === "run" && seen.push(item));
    await h.collector.syncSession("s1");
    assert.equal(h.store.db.prepare(`SELECT COUNT(*) n FROM runs`).get().n, 1);
    assert.equal(seen.length, 0);
  } finally {
    await h.close();
  }
});

test("lo stesso idle sincronizzato due volte manda un solo evento", async () => {
  const r = finishedRun(60_000);
  const h = await streamingCollector(r.data, 10);
  try {
    const seen = [];
    h.store.onChange((kind, item) => kind === "feed" && item.kind === "run" && seen.push(item));
    await h.collector.syncSession("s1");
    await h.collector.syncSession("s1", undefined, { full: true });
    assert.equal(seen.length, 1);
  } finally {
    await h.close();
  }
});

test("l'idle di un subagente non manda eventi run", async () => {
  const r = finishedRun(60_000);
  r.data.sessions[0].parentID = "s0";
  const h = await streamingCollector(r.data, 10);
  try {
    const seen = [];
    h.store.onChange((kind, item) => kind === "feed" && item.kind === "run" && seen.push(item));
    await h.collector.syncSession("s1");
    assert.equal(h.store.db.prepare(`SELECT COUNT(*) n FROM runs`).get().n, 1, "il run è salvato");
    assert.equal(seen.length, 0);
  } finally {
    await h.close();
  }
});

test("commitFlag: «git commit» dentro una stringa quodata non è un commit", async () => {
  const { commitFlag } = await import("../src/collector.js");
  assert.equal(commitFlag("bash", 'echo "ricorda: git commit prima di push"'), 0);
  assert.equal(commitFlag("bash", "echo 'git commit' >/dev/null"), 0);
  assert.equal(commitFlag("bash", 'git commit -m "il messaggio dice git commit"'), 1);
  assert.equal(commitFlag("bash", "git -C .. commit -m 'x'"), 1);
  assert.equal(commitFlag("bash", "echo 'git commit' && git commit -m x"), 1);
  assert.equal(commitFlag("zsh", "git commit -m x"), null);
});

test("skill e lens_preset dal backfill finiscono in skill_uses", async () => {
  const T0 = Date.now() - 3_600_000;
  const tok = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  const part = (id, name, state) => ({ type: "tool", id, name, state, time: { created: T0 + 10, ran: T0 + 20, completed: T0 + 30 } });
  const msgs = [
    { id: "u0", type: "user", text: "x", metadata: {}, time: { created: T0 }, skills: [{ id: "pdf", name: "pdf", text: "BODY", mention: "@pdf" }] },
    {
      id: "a0", type: "assistant", model: { id: "m", providerID: "p" }, finish: "stop", cost: 0.001, tokens: tok,
      time: { created: T0 + 1000, streamed: T0 + 1100, completed: T0 + 1500 },
      content: [
        part("c1", "skill", { status: "completed", input: { id: "pdf" }, metadata: { directory: "/somewhere/pdf" }, content: [{ text: "SECRET" }] }),
        part("c2", "skill", { status: "completed", input: {} }),
        part("c0", "skill", { status: "completed", input: { id: "ok", extra: "SECRET" } }),
        part("c3", "execute", { status: "completed", input: { code: "SECRET" }, metadata: { toolCalls: [{ tool: "lens.preset", status: "completed", input: { name: "Vibe" } }] } }),
        // no time on the part: the row takes the message's (a NULL `at` would abort the session sync)
        { type: "tool", id: "c4", name: "skill", state: { status: "completed", input: { id: "notime" } } },
      ],
    },
    { id: "sk1", type: "skill", skill: "docx", name: "docx", text: "BODY", time: { created: T0 + 1800 } },
    { id: "idle1", type: "idle", outcome: "succeeded", time: { created: T0 + 2000 } },
  ];
  const data = { events: [], sessions: [{ id: "s1", cost: 0.001, tokens: { ...tok }, time: { created: T0, updated: T0 + 2000 } }], messages: { s1: msgs } };
  const h = await streamingCollector(data, 10);
  try {
    await h.collector.syncSession("s1");
    await h.collector.syncSession("s1"); // idempotent
    const rows = h.store.db.prepare(`SELECT id, session_id, channel, skill_id, preset_id, origin, at FROM skill_uses ORDER BY id`).all();
    assert.deepEqual(
      rows.map((r) => ({ ...r })),
      [
        { id: "a0:c0", session_id: "s1", channel: "skill", skill_id: "ok", preset_id: null, origin: "native", at: T0 + 30 },
        { id: "a0:c1", session_id: "s1", channel: "skill", skill_id: "pdf", preset_id: null, origin: "native", at: T0 + 30 },
        { id: "a0:c3:0", session_id: "s1", channel: "lens-preset", skill_id: null, preset_id: "Vibe", origin: "lens", at: T0 + 30 },
        { id: "a0:c4", session_id: "s1", channel: "skill", skill_id: "notime", preset_id: null, origin: "native", at: T0 + 1500 },
        { id: "sk1", session_id: "s1", channel: "activated", skill_id: "docx", preset_id: null, origin: "native", at: T0 + 1800 },
        { id: "u0:skill:pdf", session_id: "s1", channel: "activated", skill_id: "pdf", preset_id: null, origin: "native", at: T0 },
      ],
    );
    // the session synced all the way: steps written, watermark moved, reconciliation done
    assert.equal(h.store.db.prepare(`SELECT COUNT(*) n FROM steps WHERE session_id = 's1'`).get().n, 1);
    assert.ok(h.store.db.prepare(`SELECT msg_watermark w FROM sessions WHERE id = 's1'`).get().w > 0);
    const drift = h.collector.status().drift.find((d) => d.type === "tool skill"); // counted once per part
    assert.deepEqual(drift && [drift.count, drift.missing], [1, ["input.id"]]);
    assert.ok(!JSON.stringify(drift).includes("SECRET"));
  } finally {
    await h.close();
  }
});

test("session.skill.activated: il contratto chiede sessionID e id; l'evento live non scrive righe", () => {
  const store = memoryStore();
  const collector = new Collector(config("/x/service.json"), store);
  try {
    collector.handle({ id: "e1", type: "session.skill.activated", data: { sessionID: "s1", id: "pdf" } });
    assert.deepEqual(collector.status().drift, []);
    collector.handle({ id: "e2", type: "session.skill.activated", data: { sessionID: "s1" } });
    const d = collector.status().drift.find((x) => x.type === "session.skill.activated");
    assert.deepEqual([d.count, d.missing], [1, ["data.id"]]);
    assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM skill_uses`).get().n, 0);
  } finally {
    store.close();
  }
});

test("lettore OpenCode: su un DB nuovo il collector registra opencode_reader = 1 senza toccare le sessioni", () => {
  const store = memoryStore();
  try {
    store.db.prepare("INSERT INTO sessions (id, synced_cost, msg_watermark) VALUES ('s1', 1.5, 500)").run();
    assert.equal(store.meta("opencode_reader"), undefined);
    new Collector(config("/x/service.json"), store);
    assert.equal(store.meta("opencode_reader"), "1");
    assert.deepEqual({ ...store.db.prepare("SELECT synced_cost, msg_watermark FROM sessions WHERE id = 's1'").get() }, { synced_cost: 1.5, msg_watermark: 500 });
  } finally {
    store.close();
  }
});

test("lettore OpenCode: con un'altra versione registrata ogni sessione si rilegge da capo", () => {
  const store = memoryStore();
  try {
    store.db.prepare("INSERT INTO sessions (id, synced_cost, msg_watermark) VALUES ('s1', 1.5, 500)").run();
    store.meta("opencode_reader", "0");
    new Collector(config("/x/service.json"), store);
    assert.equal(store.meta("opencode_reader"), "1");
    assert.deepEqual({ ...store.db.prepare("SELECT synced_cost, msg_watermark FROM sessions WHERE id = 's1'").get() }, { synced_cost: null, msg_watermark: null });
  } finally {
    store.close();
  }
});

/**
 * F-12: a session where `open` (an assistant or a compaction) is listed still open at the first sync, and
 * four finished steps created after it sit on a page older than the stop of the second sync. They overlap
 * it: only the fake lists them so (OpenCode does not, test/integration/opencode.test.js), and that is what
 * once hid the open one. Session totals leave out what is still open, as OpenCode does.
 */
function openBeyondOldPage(T, open, finished) {
  const tok = (input) => ({ input, output: 1, reasoning: 0, cache: { read: 0, write: 0 } });
  const done = (id, created, completed) => ({
    id, type: "assistant", model: { id: "m", providerID: "p" }, finish: "stop", cost: 0.001, tokens: tok(10), time: { created, streamed: created + 50, completed }, content: [],
  });
  const before = [
    { id: "u1", type: "user", text: "x", metadata: {}, time: { created: T } },
    ...[1, 2, 3, 4].map((i) => done(`old${i}`, T + i * 1000, T + i * 1000 + 100)),
    done("r1", T + 700_000, T + 700_500),
  ];
  const session = (extra, updated) => ({ id: "s1", cost: 0.005 + extra.cost, tokens: tok(50 + extra.input), time: { created: T, updated } });
  const data = { events: [], sessions: [session({ cost: 0, input: 0 }, T + 700_500)], messages: { s1: [...before, open] } };
  return {
    data,
    finish(updated) {
      data.messages.s1 = [...before, finished];
      data.sessions[0] = session({ cost: finished.cost, input: finished.tokens.input }, updated);
    },
  };
}

const messageReads = (fake) => fake.log.requests.filter((p) => p.endsWith("/message")).length;
const sums = (store) => store.db.prepare(`SELECT
    (SELECT COALESCE(SUM(t_in), 0) FROM steps) + (SELECT COALESCE(SUM(t_in), 0) FROM internal_usage) t_in,
    (SELECT t_in FROM sessions WHERE id = 's1') total,
    (SELECT COUNT(*) FROM internal_usage WHERE kind IS NULL) estimates`).get();

test("run lungo con uno step aperto oltre la prima pagina vecchia: il sync dopo lo rilegge da finito (F-12)", async () => {
  const T = Date.now() - 2 * 3_600_000;
  const longL = { id: "longL", type: "assistant", model: { id: "m", providerID: "p" }, time: { created: T + 500, streamed: T + 600 }, content: [] };
  const s = openBeyondOldPage(T, longL, {
    ...longL, finish: "stop", cost: 0.007, tokens: { input: 700, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, time: { ...longL.time, completed: T + 720_000 },
  });
  const h = await streamingCollector(s.data, 2);
  const wm = () => h.store.db.prepare("SELECT msg_watermark w FROM sessions WHERE id = 's1'").get().w;
  try {
    await h.collector.syncSession("s1");
    assert.equal(wm(), T + 500, "resumes from the start of the open step, not from the newest finished one");
    assert.equal(h.store.db.prepare("SELECT ended FROM steps WHERE id = 'longL'").get().ended, null);
    s.finish(T + 720_000);
    await h.collector.syncSession("s1");
    const step = h.store.db.prepare("SELECT ended, t_in FROM steps WHERE id = 'longL'").get();
    assert.deepEqual({ ...step }, { ended: T + 720_000, t_in: 700 });
    const after = sums(h.store);
    assert.equal(after.estimates, 0, "no estimate for the long step");
    assert.equal(after.t_in, after.total, "Σ steps + Σ internal = session totals");
    assert.equal(h.store.db.prepare("SELECT COALESCE(SUM(t_in), 0) n FROM steps").get().n, after.total, "Σ steps = totals");
    assert.equal(wm(), T + 720_000);
    const reads = messageReads(h.fake);
    await h.collector.syncSession("s1");
    assert.ok(messageReads(h.fake) - reads <= 3, `${messageReads(h.fake) - reads} pages read once nothing is open`);
  } finally {
    await h.close();
  }
});

test("uno step aperto da più di un giorno non ferma il watermark", async () => {
  const now = Date.now();
  const T = now - 2 * 3_600_000;
  const orphan = { id: "orphan", type: "assistant", model: { id: "m", providerID: "p" }, time: { created: now - 25 * 3_600_000 }, content: [] };
  const s = openBeyondOldPage(T, orphan, orphan);
  const h = await streamingCollector(s.data, 2);
  try {
    await h.collector.syncSession("s1");
    assert.equal(h.store.db.prepare("SELECT msg_watermark w FROM sessions WHERE id = 's1'").get().w, T + 700_500, "the orphan holds nothing");
  } finally {
    await h.close();
  }
});

test("compaction in corso: il sync dopo ne legge l'uso esatto", async () => {
  const T = Date.now() - 2 * 3_600_000;
  const running = { id: "cmp1", type: "compaction", status: "running", reason: "auto", model: { id: "m", providerID: "p" }, time: { created: T + 500 } };
  const s = openBeyondOldPage(T, running, { ...running, status: "completed", cost: 0.003, tokens: { input: 300, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } });
  const h = await streamingCollector(s.data, 2);
  try {
    await h.collector.syncSession("s1");
    assert.equal(h.store.db.prepare("SELECT msg_watermark w FROM sessions WHERE id = 's1'").get().w, T + 500);
    s.finish(T + 720_000);
    await h.collector.syncSession("s1");
    const rows = h.store.db.prepare("SELECT id, kind, t_in FROM internal_usage ORDER BY id").all().map((r) => ({ ...r }));
    assert.deepEqual(rows, [{ id: "cmp1", kind: "compaction", t_in: 300 }], "the exact usage, no estimate");
    const after = sums(h.store);
    assert.equal(after.t_in, after.total);
  } finally {
    await h.close();
  }
});

test("il punto di ripresa già salvato scende quando il sync dopo trova un aperto più vecchio", async () => {
  const T = Date.now() - 2 * 3_600_000;
  const tok = { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  const done = (id, created, completed) => ({ id, type: "assistant", model: { id: "m", providerID: "p" }, finish: "stop", cost: 0.001, tokens: tok, time: { created, completed }, content: [] });
  const finished = [{ id: "u1", type: "user", text: "x", metadata: {}, time: { created: T } }, done("a1", T + 1000, T + 2000), done("a2", T + 700_000, T + 700_500)];
  const session = { id: "s1", cost: 0.002, tokens: { ...tok, input: 20, output: 2 }, time: { created: T, updated: T + 700_500 } };
  const data = { events: [], sessions: [session], messages: { s1: finished } };
  const h = await streamingCollector(data, 2);
  const wm = () => h.store.db.prepare("SELECT msg_watermark w FROM sessions WHERE id = 's1'").get().w;
  try {
    await h.collector.syncSession("s1");
    assert.equal(wm(), T + 700_500);
    // listed only now, open, started 5 minutes before the resume point saved (the fake lists it so)
    data.messages.s1 = [...finished, { id: "late", type: "assistant", model: { id: "m", providerID: "p" }, time: { created: T + 400_500 }, content: [] }];
    await h.collector.syncSession("s1");
    assert.equal(wm(), T + 400_500, "the saved resume point goes down to the open one");
  } finally {
    await h.close();
  }
});
