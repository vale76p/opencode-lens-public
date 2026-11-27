// Segnali aggiunti con lo schema v2: permessi, prompt, run, commit, subagenti,
// dettagli dei tool, eventi duplicati, oggi/calendario, export OTLP.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { Collector, commitFlag } from "../src/collector.js";
import { Queries } from "../src/queries.js";
import { Store, SCHEMA_VERSION } from "../src/store.js";
import { OtlpExporter } from "../src/otlp.js";
import { setLogLevel } from "../src/log.js";
import { memoryStore, addStep, addTool, tokens } from "./helpers.js";
import { startFakeOpencode } from "./fake-opencode.js";

setLogLevel("error");

const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const config = (serviceFile = "/nonesiste", extra = {}) => ({ serviceFile, serverUrl: "", storeTitles: true, scanIntervalMs: 120_000, ...extra });
const fakeCollector = { status: () => ({ state: "connected", lastEventAt: null, drift: [], duplicateEvents: 0 }) };

test("commitFlag: solo git commit riusciti nei tool shell", () => {
  assert.equal(commitFlag("bash", "git add . && git commit -m 'x'"), 1);
  assert.equal(commitFlag("bash", "git -C /repo commit --amend --no-edit"), 1);
  assert.equal(commitFlag("functions.shell", "git commit -m x"), 1);
  assert.equal(commitFlag("bash", "git commit-tree abc"), 0);
  assert.equal(commitFlag("bash", "git log --grep commit"), 0);
  assert.equal(commitFlag("bash", "git commit -m x", 1), 0, "uscita non zero");
  assert.equal(commitFlag("read", "git commit"), null, "non è un tool shell");
  assert.equal(commitFlag("bash", undefined), null);
});

test("eventi dal vivo: permessi, consegna del prompt, tool con commit, subagente, output, duplicati", () => {
  const store = memoryStore();
  const c = new Collector(config(), store);
  let n = 0;
  const ev = (type, created, data, id = `evt_${++n}`) => c.handle({ id, type, created, data });
  const call = { sessionID: "ses_1", assistantMessageID: "msg_1" };

  ev("permission.asked", 1000, { id: "per_1", sessionID: "ses_1", action: "bash", resources: ["git push", "rm -rf x"] });
  ev("permission.replied", 4000, { sessionID: "ses_1", requestID: "per_1", reply: "reject" });
  ev("permission.asked", 5000, { id: "per_2", sessionID: "ses_1", action: "edit", resources: ["a.ts"] });
  const perms = store.db.prepare(`SELECT * FROM permissions ORDER BY id`).all();
  assert.deepEqual(perms.map((p) => [p.id, p.action, p.resources, p.asked, p.replied, p.reply]), [
    ["per_1", "bash", 2, 1000, 4000, "reject"],
    ["per_2", "edit", 1, 5000, null, null],
  ]);

  ev("session.inbox.enqueued", 6000, { sessionID: "ses_1", inboxID: "msg_u9", item: { type: "user", delivery: "steer", payload: { text: "testo segreto" } } });
  assert.equal(c.deliveries.get("msg_u9"), "steer");
  assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM prompts`).get().n, 0, "il prompt arriva dal sync, non dall'evento");

  ev("session.tool.input.started", 7000, { ...call, id: "c1", name: "bash" });
  ev("session.tool.called", 7100, { ...call, id: "c1", executed: false, input: { command: "git commit -m 'fix'" } });
  ev("session.tool.success", 7400, { ...call, id: "c1", content: [{ type: "text", text: "è fatto" }], metadata: { exit: 0 } });
  const t1 = store.db.prepare(`SELECT * FROM tools WHERE id = 'msg_1:c1'`).get();
  assert.deepEqual([t1.is_commit, t1.provider_exec, t1.out_bytes, t1.ran], [1, 0, Buffer.byteLength("è fatto"), 7100]);

  ev("session.tool.input.started", 8000, { ...call, id: "c2", name: "bash" });
  ev("session.tool.called", 8100, { ...call, id: "c2", input: { command: "git commit -m x" } });
  ev("session.tool.success", 8200, { ...call, id: "c2", content: [], metadata: { exit: 1 } });
  assert.equal(store.db.prepare(`SELECT is_commit FROM tools WHERE id = 'msg_1:c2'`).get().is_commit, 0, "commit fallito");

  ev("session.tool.input.started", 9000, { ...call, id: "c3", name: "task" });
  ev("session.tool.called", 9100, { ...call, id: "c3", input: { description: "x" } });
  ev("session.tool.progress", 9200, { sessionID: "ses_1", id: "c3", metadata: { sessionID: "ses_child" } });
  assert.equal(store.db.prepare(`SELECT child_session FROM tools WHERE id = 'msg_1:c3'`).get().child_session, "ses_child");

  // stesso id evento due volte: applicato una volta, contato come duplicato
  ev("session.retry.scheduled", 9500, { sessionID: "ses_1", attempt: 1 }, "evt_dup");
  ev("session.retry.scheduled", 9500, { sessionID: "ses_1", attempt: 1 }, "evt_dup");
  assert.equal(c.status().duplicateEvents, 1);
  assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM signals`).get().n, 1);
  assert.deepEqual(c.status().drift, [], "le forme dei nuovi eventi rispettano il contratto");
  store.close();
});

test("sync: prompt e run dai messaggi (idle con esito, e storici senza idle), tool dal backfill", async () => {
  const T = Date.now() - 3 * 86_400_000;
  const a = (id, created, completed, extra = {}) => ({ id, type: "assistant", agent: "build", model: { id: "m", providerID: "p" }, finish: "stop", cost: 0.01, tokens: tokens(10, 5), time: { created, completed }, content: [], ...extra });
  const msgs = [
    { id: "u1", type: "user", text: "ciao mondo", files: [{}], agents: [], time: { created: T } },
    a("a1", T + 100, T + 2000, {
      content: [
        { type: "tool", id: "k1", name: "bash", executed: false, state: { status: "completed", input: { command: "git commit -am x" }, content: [{ type: "text", text: "12345" }], metadata: { exit: 0 } }, time: { created: T + 500, ran: T + 600, completed: T + 900 } },
        { type: "tool", id: "k2", name: "task", state: { status: "completed", input: {}, content: [], metadata: { sessionId: "ses_kid", parentSessionId: "ses_new" } }, time: { created: T + 1000, completed: T + 1900 } },
      ],
    }),
    { id: "i1", type: "idle", outcome: "succeeded", time: { created: T + 2100 } },
    { id: "s1", type: "synthetic", text: "x", time: { created: T + 3000 } },
    a("a2", T + 3100, T + 4000, { finish: "error" }),
    { id: "i2", type: "idle", outcome: "failed", time: { created: T + 4100 } },
  ];
  // sessione vecchia: niente idle e prompt nel formato di allora, run dedotti da prompt a prompt
  const O = T - 86_400_000; // il giorno prima, con OpenCode che non scriveva ancora i messaggi idle
  const old = [
    { id: "o_u1", type: "user", text: "uno", time: { created: O } },
    a("o_a1", O + 100, O + 1000),
    a("o_a2", O + 1100, O + 1500),
    { id: "o_u2", type: "user", text: "due due", time: { created: O + 5000 } },
    a("o_a3", O + 5100, O + 6000, { finish: "error" }),
  ];
  // sessione attuale con un prompt steer e uno queue a run in corso: un solo run
  const steer = [
    { id: "w_u1", type: "user", text: "primo", files: [], agents: [], metadata: {}, time: { created: T + 10_000 } },
    a("w_a1", T + 10_100, T + 12_000),
    { id: "w_u2", type: "user", text: "aggiunta", files: [], agents: [], metadata: {}, time: { created: T + 12_500 } },
    a("w_a2", T + 12_600, T + 14_000),
    { id: "w_u3", type: "user", text: "in coda", files: [], agents: [], metadata: {}, time: { created: T + 14_100 } },
    a("w_a3", T + 14_200, T + 15_000),
    { id: "w_i1", type: "idle", outcome: "succeeded", time: { created: T + 15_100 } },
  ];
  // run attuale ancora in corso: niente idle, ma nessun run dedotto
  const going = [
    { id: "g_u1", type: "user", text: "lungo", files: [], agents: [], metadata: {}, time: { created: T } },
    a("g_a1", T + 100, T + 900),
  ];
  const sessions = [
    { id: "ses_going", cost: 0.01, tokens: tokens(10, 5), time: { created: T, updated: T + 900 } },
    { id: "ses_new", cost: 0.02, tokens: tokens(20, 10), time: { created: T, updated: T + 4100 } },
    { id: "ses_old", cost: 0.03, tokens: tokens(30, 15), time: { created: T - 86_400_000, updated: T - 86_400_000 + 6000 } },
    { id: "ses_steer", cost: 0.03, tokens: tokens(30, 15), time: { created: T + 10_000, updated: T + 15_100 } },
  ];
  const fake = await startFakeOpencode({ data: { events: [], sessions, messages: { ses_new: msgs, ses_old: old, ses_steer: steer, ses_going: going } } });
  const store = memoryStore();
  try {
    const c = new Collector(config(fake.serviceFile), store);
    c.deliveries.set("u1", "queue");
    await c.client.connect();
    await new Promise((r) => setTimeout(r, 150)); // il finto servizio risponde dopo lo stream eventi
    c.client.stream({ onOpen() {}, onEvent() {}, signal: AbortSignal.timeout(300) }).catch(() => {});
    await c.syncSession("ses_new");
    await c.syncSession("ses_old");
    await c.syncSession("ses_steer");
    await c.syncSession("ses_going");

    const runs = store.db.prepare(`SELECT id, session_id, started, ended, outcome FROM runs ORDER BY session_id, ended`).all();
    assert.deepEqual(runs.map((r) => ({ ...r })), [
      { id: "i1", session_id: "ses_new", started: T, ended: T + 2100, outcome: "succeeded" },
      { id: "i2", session_id: "ses_new", started: T + 3000, ended: T + 4100, outcome: "failed" },
      { id: "o_u1:derived", session_id: "ses_old", started: O, ended: O + 1500, outcome: null },
      { id: "o_u2:derived", session_id: "ses_old", started: O + 5000, ended: O + 6000, outcome: "failed" },
      { id: "w_i1", session_id: "ses_steer", started: T + 10_000, ended: T + 15_100, outcome: "succeeded" },
    ]);
    const prompts = store.db.prepare(`SELECT id, chars, files, delivery FROM prompts WHERE session_id NOT IN ('ses_steer', 'ses_going') ORDER BY id`).all();
    assert.deepEqual(prompts.map((p) => ({ ...p })), [
      { id: "o_u1", chars: 3, files: 0, delivery: null },
      { id: "o_u2", chars: 7, files: 0, delivery: null },
      { id: "u1", chars: 10, files: 1, delivery: "queue" },
    ]);
    const tool = (id) => store.db.prepare(`SELECT * FROM tools WHERE id = ?`).get(id);
    assert.deepEqual([tool("a1:k1").is_commit, tool("a1:k1").out_bytes, tool("a1:k1").provider_exec], [1, 5, 0]);
    assert.equal(tool("a1:k2").child_session, "ses_kid");
    const dump = JSON.stringify(store.db.prepare(`SELECT * FROM prompts`).all());
    assert.ok(!dump.includes("ciao"), "il testo del prompt non viene salvato");

    // risincronizzare non duplica
    await c.syncSession("ses_new", undefined, { full: true });
    assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM runs`).get().n, 5);
    assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM prompts`).get().n, 7);
  } finally {
    await fake.close();
    store.close();
  }
});

test("migrazione da schema v1: colonne nuove e rilettura dello storico", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-mig-"));
  const file = path.join(dir, "lens.db");
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_id TEXT, project_id TEXT, directory TEXT, title TEXT,
      cost REAL NOT NULL DEFAULT 0, t_in INTEGER NOT NULL DEFAULT 0, t_out INTEGER NOT NULL DEFAULT 0, t_reason INTEGER NOT NULL DEFAULT 0,
      t_cread INTEGER NOT NULL DEFAULT 0, t_cwrite INTEGER NOT NULL DEFAULT 0, created INTEGER, updated INTEGER, deleted INTEGER,
      last_activity INTEGER, synced_cost REAL, synced_tokens INTEGER, synced_updated INTEGER, msg_watermark INTEGER);
      CREATE TABLE tools (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT, call_id TEXT, name TEXT, status TEXT,
      error_type TEXT, error_msg TEXT, created INTEGER, ran INTEGER, ended INTEGER);
      INSERT INTO sessions (id, synced_cost, msg_watermark) VALUES ('s', 1.5, 123);
      INSERT INTO tools (id, session_id, name) VALUES ('t', 's', 'read');`);
    old.close();
    const store = new Store(file);
    assert.equal(store.migrated, true);
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    const cols = store.db.prepare("PRAGMA table_info(tools)").all().map((c) => c.name);
    for (const col of ["child_session", "out_bytes", "provider_exec", "is_commit"]) assert.ok(cols.includes(col), col);
    assert.deepEqual({ ...store.db.prepare(`SELECT synced_cost, msg_watermark FROM sessions`).get() }, { synced_cost: null, msg_watermark: null });
    assert.equal(store.db.prepare(`SELECT name FROM tools`).get().name, "read", "i dati restano");
    store.close();
    const again = new Store(file);
    assert.equal(again.migrated, false, "una volta sola");
    again.close();

    // v2 → v3: via i run dedotti per errore dopo l'epoca degli idle, il resto resta
    const v2 = new DatabaseSync(file);
    v2.exec(`INSERT INTO runs (id, session_id, started, ended, outcome) VALUES
      ('old:derived', 's', 100, 200, NULL), ('i1', 's', 900, 1000, 'succeeded'), ('split:derived', 's', 1100, 1200, NULL);
      UPDATE sessions SET synced_cost = 1, msg_watermark = 5; PRAGMA user_version = 2;`);
    v2.close();
    const v3 = new Store(file);
    assert.equal(v3.migrated, true);
    assert.deepEqual(v3.db.prepare(`SELECT id FROM runs ORDER BY id`).all().map((r) => r.id), ["i1", "old:derived"]);
    assert.equal(v3.db.prepare(`SELECT synced_cost FROM sessions`).get().synced_cost, null, "storico da rileggere");
    const idx = v3.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tools'`).all().map((r) => r.name);
    assert.ok(idx.includes("tools_message") && idx.includes("tools_session"));
    v3.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function seeded() {
  const store = memoryStore();
  const day = local(2026, 10, 15);
  store.st.sessionCreated.run({ id: "ses_1", parent_id: null, project_id: null, directory: "/p", created: day });
  store.st.sessionCreated.run({ id: "ses_sub", parent_id: "ses_1", project_id: null, directory: "/p", created: day });
  store.st.sessionCreated.run({ id: "ses_subsub", parent_id: "ses_sub", project_id: null, directory: "/p", created: day });
  addStep(store, { id: "a", session: "ses_1", started: day + 3_600_000, ended: day + 3_610_000, cost: 0.5, tokens: tokens(1000, 100) });
  addStep(store, { id: "b", session: "ses_sub", agent: "explore", started: day + 3_620_000, ended: day + 3_630_000, cost: 0.25, tokens: tokens(400, 100) });
  addStep(store, { id: "c", session: "ses_subsub", agent: "explore", started: day + 3_640_000, ended: day + 3_650_000, cost: 0.25, tokens: tokens(400, 100) });
  addStep(store, { id: "d", session: "ses_1", started: day - 2 * 86_400_000, ended: day - 2 * 86_400_000 + 1000, tokens: tokens(10) });
  store.st.runUpsert.run({ id: "r1", session_id: "ses_1", started: day + 3_590_000, ended: day + 3_700_000, outcome: "succeeded" });
  store.st.runUpsert.run({ id: "r2", session_id: "ses_1", started: null, ended: day + 3_800_000, outcome: null });
  store.st.promptUpsert.run({ id: "u1", session_id: "ses_1", created: day + 3_590_000, chars: 100, files: 1, agents: 0, delivery: "steer" });
  store.st.promptUpsert.run({ id: "u2", session_id: "ses_1", created: day + 3_595_000, chars: 300, files: 0, agents: 0, delivery: null });
  // il prompt di dispatch scritto dal padre e il run proprio del subagente: non sono interazione dell'utente
  store.st.promptUpsert.run({ id: "u_sub", session_id: "ses_sub", created: day + 3_616_000, chars: 5000, files: 0, agents: 0, delivery: "steer" });
  store.st.runUpsert.run({ id: "r_sub", session_id: "ses_sub", started: day + 3_616_000, ended: day + 3_640_000, outcome: "succeeded" });
  store.st.permissionAsked.run({ id: "p1", session_id: "ses_1", action: "bash", resources: 1, at: day + 3_605_000 });
  store.st.permissionReplied.run({ id: "p1", session_id: "ses_1", at: day + 3_609_000, reply: "reject" });
  store.st.permissionAsked.run({ id: "p2", session_id: "ses_1", action: "bash", resources: 1, at: day + 3_611_000 });
  addTool(store, { id: "msg_a:t1", session: "ses_1", message: "a", name: "bash", status: "completed", created: day + 3_605_000, ended: day + 3_606_000, is_commit: 1, out_bytes: 100 });
  addTool(store, { id: "msg_a:t2", session: "ses_1", message: "a", name: "task", status: "completed", created: day + 3_615_000, ended: day + 3_650_000, child_session: "ses_sub", out_bytes: 300 });
  return { store, day };
}

test("activity: run con subagenti, prompt, permessi, commit", () => {
  const { store, day } = seeded();
  const q = new Queries(store);
  const a = q.activity(day, day + 86_400_000);
  assert.equal(a.runs.count, 2);
  assert.deepEqual(a.runs.outcomes, { succeeded: 1, unknown: 1 });
  assert.deepEqual(a.runs.durationMs, { p50: 110_000, p95: 110_000, n: 1 }, "i run senza inizio non hanno durata");
  // r1 copre gli step a, b (subagente) e c (subagente del subagente)
  assert.ok(Math.abs(Math.max(...[a.runs.cost.p50, a.runs.cost.p95]) - 1) < 1e-9, "costo del run con i subagenti annidati");
  assert.deepEqual(a.prompts, { count: 2, avgChars: 200, withFiles: 1, steer: 1 });
  assert.equal(a.permissions.asked, 2);
  assert.equal(a.permissions.rejected, 1);
  assert.equal(a.permissions.pending, 1);
  assert.deepEqual(a.permissions.waitMs, { p50: 4000, p95: 4000, n: 1 });
  assert.equal(a.permissions.byAction[0].action, "bash");
  assert.equal(a.commits.count, 1);
  assert.ok(Math.abs(a.commits.costPerCommit - 1) < 1e-9);
  assert.equal(a.subagents.sessions, 2);
  assert.ok(Math.abs(a.subagents.costShare - 0.5) < 1e-9);
  store.close();
});

test("sessions: rollup dei subagenti, tipo di agente, dettaglio con timeline", () => {
  const { store, day } = seeded();
  const q = new Queries(store);
  const rows = q.sessions(day, day + 86_400_000);
  const root = rows.find((r) => r.id === "ses_1");
  assert.equal(root.subagents.sessions, 2);
  assert.ok(Math.abs(root.subagents.cost - 1) < 1e-9);
  assert.equal(rows.find((r) => r.id === "ses_subsub").subagents, null);
  const bd = q.breakdown(day, day + 86_400_000, "kind");
  assert.deepEqual(bd.map((r) => [r.key, r.steps]).sort(), [["primario", 1], ["subagente", 2]]);
  const s = q.session("ses_1");
  assert.equal(s.runs.length, 2);
  assert.equal(s.children.length, 1);
  const stepA = s.steps.find((x) => x.id === "a");
  assert.deepEqual(stepA.calls.map((c) => [c.name, c.commit, c.childSession, c.outBytes]), [
    ["bash", true, null, 100],
    ["task", false, "ses_sub", 300],
  ]);
  const tools = q.tools(day, day + 86_400_000);
  assert.equal(tools.find((t) => t.name === "bash").commits, 1);
  assert.equal(tools.find((t) => t.name === "task").avgOutputBytes, 300);
  store.close();
});

test("today: budget, soglie e proiezione lineare", () => {
  const { store, day } = seeded();
  const q = new Queries(store, { limits: { tokens: 2000, cost: null, steps: 10 } });
  const noon = day + 12 * 3_600_000;
  const t = q.today(noon);
  assert.equal(t.day, "2026-10-15");
  assert.equal(t.tokens.used, 2100);
  assert.equal(t.tokens.ratio, 2100 / 2000);
  assert.equal(t.tokens.projected, 4200, "a mezzogiorno raddoppia");
  assert.equal(t.steps.used, 3);
  assert.equal(t.cost.limit, null);
  assert.equal(t.cost.ratio, null);
  assert.equal(q.today(day + 30 * 60_000).tokens.projected, null, "nessuna proiezione nella prima ora");
  store.close();
});

test("calendar: 53 settimane da lunedì, giorni attivi e serie", () => {
  const { store, day } = seeded();
  const q = new Queries(store);
  const c = q.calendar("tokens", day + 13 * 3_600_000);
  assert.equal(c.days.at(-1).date, "2026-10-15");
  assert.equal(new Date(c.days[0].date + "T12:00").getDay(), 1, "parte da un lunedì");
  assert.ok(c.days.length >= 365 && c.days.length <= 371);
  assert.equal(c.activeDays, 2);
  assert.equal(c.streak, 1);
  assert.equal(q.calendar("tokens", day + 86_400_000 + 3_600_000).streak, 1, "a inizio giornata la serie non si azzera");
  assert.equal(c.days.at(-1).value, 2100);
  assert.equal(c.days.find((d) => d.date === "2026-10-13").value, 10);
  store.close();
});

test("/metrics: famiglie nuove ed etichette comuni su ogni serie", () => {
  const { store } = seeded();
  const q = new Queries(store, { labels: { host: "mini" }, limits: { tokens: 5000, cost: null, steps: null } });
  const text = q.metrics(fakeCollector);
  for (const line of text.split("\n").filter((l) => l && !l.startsWith("#"))) assert.match(line, /\{host="mini"/, line);
  assert.match(text, /^opencode_lens_commits_total\{host="mini"\} 1$/m);
  assert.match(text, /^opencode_lens_prompts_total\{host="mini"\} 2$/m);
  assert.match(text, /^opencode_lens_runs_total\{host="mini",outcome="succeeded"\} 1$/m, "senza il run del subagente");
  assert.match(text, /^opencode_lens_permissions_pending\{host="mini",action="bash"\} 1$/m);
  assert.doesNotMatch(text, /reply="pending"/, "le richieste in sospeso non sono un counter");
  assert.match(text, /^opencode_lens_permission_wait_seconds_sum\{host="mini",action="bash",reply="reject"\} 4$/m);
  assert.match(text, /^opencode_lens_daily_limit\{host="mini",kind="tokens"\} 5000$/m);
  assert.match(text, /^opencode_lens_subagent_sessions_total\{host="mini"\} 2$/m);
  store.close();
});

async function receiver() {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ path: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { got, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("OTLP: metriche cumulative e delta, tracce run → step → tool con subagenti annidati, nessun doppione", async () => {
  const { store, day } = seeded();
  const rx = await receiver();
  try {
    const cfg = (temporality) => ({
      labels: { host: "mini" },
      otlp: { endpoint: rx.url, headers: { authorization: "Bearer xyz" }, intervalMs: 60_000, temporality, traces: true },
    });
    const q = new Queries(store, { labels: { host: "mini" } });
    // "now" poco dopo i run del giorno, dentro l'ora di storico del primo avvio
    const now = day + 3_800_000 + 120_000;
    const ex = new OtlpExporter({ config: cfg("delta"), store, queries: q, collector: fakeCollector });
    await ex.exportOnce(now);
    const metrics = rx.got.find((g) => g.path === "/v1/metrics");
    assert.equal(metrics.headers.authorization, "Bearer xyz");
    const rm = metrics.body.resourceMetrics[0];
    const res = Object.fromEntries(rm.resource.attributes.map((a) => [a.key, Object.values(a.value)[0]]));
    assert.equal(res["service.name"], "opencode-lens");
    assert.equal(res.host, "mini");
    const byName = (body, name) => body.resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === name);
    const commits = byName(metrics.body, "opencode_lens_commits_total");
    assert.equal(commits.sum.aggregationTemporality, 1);
    assert.equal(commits.sum.dataPoints[0].asDouble, 1);
    assert.ok(byName(metrics.body, "opencode_lens_run_duration_seconds").summary);

    const traces = rx.got.find((g) => g.path === "/v1/traces").body.resourceSpans[0].scopeSpans[0].spans;
    const span = (name, pred = () => true) => traces.find((s) => s.name === name && pred(s));
    const at = (s, k) => Object.values(s.attributes.find((a) => a.key === k)?.value ?? {})[0];
    const run = span("opencode.run", (s) => at(s, "session.id") === "ses_1");
    const subRun = span("opencode.run", (s) => at(s, "session.id") === "ses_sub");
    const stepA = span("opencode.llm", (s) => at(s, "session.id") === "ses_1");
    const task = span("opencode.tool.task");
    const stepB = span("opencode.llm", (s) => at(s, "session.id") === "ses_sub");
    assert.equal(stepA.parentSpanId, run.spanId, "step dentro il run");
    assert.equal(task.parentSpanId, stepA.spanId, "tool dentro lo step");
    assert.equal(subRun.parentSpanId, task.spanId, "il run del subagente sotto il task che lo ha lanciato");
    assert.equal(stepB.parentSpanId, subRun.spanId, "lo step del subagente dentro il suo run");
    assert.equal(traces.filter((s) => s.name === "opencode.run").length, 2, "il run senza inizio non ha span");
    assert.ok(!JSON.stringify(traces).includes("exit 1"), "nessun messaggio d'errore libero negli span");
    assert.equal(new Set(traces.map((s) => s.traceId)).size, 1, "una traccia per sessione radice");
    assert.equal(at(span("opencode.tool.bash"), "opencode.git_commit"), true);
    assert.equal(ex.status().spansExported, traces.length);

    // secondo export: niente span già inviati, contatori delta a zero
    rx.got.length = 0;
    await ex.exportOnce(now + 10_000);
    assert.equal(rx.got.filter((g) => g.path === "/v1/traces").length, 0);
    assert.equal(byName(rx.got[0].body, "opencode_lens_commits_total").sum.dataPoints[0].asDouble, 0);

    // riavvio: lo stato delta è nel database, nessun reinvio dello storico
    rx.got.length = 0;
    const restarted = new OtlpExporter({ config: cfg("delta"), store, queries: q, collector: fakeCollector });
    await restarted.exportOnce(now + 20_000);
    assert.equal(byName(rx.got[0].body, "opencode_lens_commits_total").sum.dataPoints[0].asDouble, 0, "dopo il riavvio il delta resta 0");

    // un run sincronizzato in ritardo, con una fine più vecchia dell'ultimo export, esce comunque
    rx.got.length = 0;
    addStep(store, { id: "late", session: "ses_1", started: day + 3_300_000, ended: day + 3_310_000, tokens: tokens(5) });
    store.st.runUpsert.run({ id: "r_late", session_id: "ses_1", started: day + 3_299_000, ended: day + 3_320_000, outcome: "succeeded" });
    await restarted.exportOnce(now + 30_000);
    const late = rx.got.find((g) => g.path === "/v1/traces").body.resourceSpans[0].scopeSpans[0].spans;
    const lateRun = late.find((x) => x.name === "opencode.run");
    assert.equal(late.length, 2);
    assert.equal(late.find((x) => x.name === "opencode.llm").parentSpanId, lateRun.spanId);

    // cumulativo: il valore intero
    rx.got.length = 0;
    const cum = new OtlpExporter({ config: cfg("cumulative"), store, queries: q, collector: fakeCollector });
    await cum.exportOnce(now + 40_000);
    const c2 = byName(rx.got[0].body, "opencode_lens_commits_total");
    assert.deepEqual([c2.sum.aggregationTemporality, c2.sum.dataPoints[0].asDouble], [2, 1]);
  } finally {
    await rx.close();
    store.close();
  }
});

const extraCounter = (v) => ({ name: "x_total", help: "x", type: "counter", samples: [{ labels: {}, value: v }] });
const xPoint = (rx) => rx.got.find((g) => g.path === "/v1/metrics").body.resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === "x_total")?.sum.dataPoints[0].asDouble;

for (const restart of [false, true]) {
  test(`OTLP delta: una serie che sparisce e ricompare non viene rimandata intera${restart ? " (anche dopo un riavvio)" : ""}`, async () => {
    const { store } = seeded();
    const rx = await receiver();
    try {
      const cfg = { labels: {}, otlp: { endpoint: rx.url, headers: {}, intervalMs: 60_000, temporality: "delta", traces: false } };
      const q = new Queries(store, { labels: {} });
      let extra = [extraCounter(10)];
      const make = () => new OtlpExporter({ config: cfg, store, queries: q, collector: fakeCollector, extraFamilies: () => extra });
      let ex = make();
      await ex.exportOnce(1_000);
      assert.equal(xPoint(rx), 10);
      extra = [];
      rx.got.length = 0;
      await ex.exportOnce(2_000);
      assert.equal(xPoint(rx), undefined);
      if (restart) ex = make();
      extra = [extraCounter(12)];
      rx.got.length = 0;
      await ex.exportOnce(3_000);
      assert.equal(xPoint(rx), 2);
    } finally {
      await rx.close();
      store.close();
    }
  });
}

test("OTLP delta: due export insieme (collector lento) mandano l'aumento una volta sola", async () => {
  const { store } = seeded();
  const rx = await receiver();
  try {
    const cfg = { labels: {}, otlp: { endpoint: rx.url, headers: {}, intervalMs: 10_000, temporality: "delta", traces: false } };
    const ex = new OtlpExporter({ config: cfg, store, queries: new Queries(store, { labels: {} }), collector: fakeCollector, extraFamilies: () => [extraCounter(10)] });
    await Promise.all([ex.exportOnce(1_000), ex.exportOnce(2_000)]);
    const sent = rx.got.filter((g) => g.path === "/v1/metrics").map((g) => g.body.resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === "x_total").sum.dataPoints[0].asDouble);
    assert.deepEqual(sent, [10]);
    // finished: the next one goes out on its own
    rx.got.length = 0;
    await ex.exportOnce(3_000);
    assert.equal(xPoint(rx), 0);
  } finally {
    await rx.close();
    store.close();
  }
});

test("OTLP esporta le famiglie extra come /metrics", async () => {
  const { store } = seeded();
  const rx = await receiver();
  try {
    const cfg = { labels: {}, otlp: { endpoint: rx.url, headers: {}, intervalMs: 60_000, temporality: "cumulative", traces: false } };
    const q = new Queries(store, { labels: {} });
    const ex = new OtlpExporter({ config: cfg, store, queries: q, collector: fakeCollector, extraFamilies: () => [{ name: "y", help: "y", type: "gauge", samples: [{ labels: {}, value: 7 }] }] });
    await ex.exportOnce(1_000);
    const y = rx.got[0].body.resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === "y");
    assert.equal(y.gauge.dataPoints[0].asDouble, 7);
  } finally {
    await rx.close();
    store.close();
  }
});

test("OTLP: export fallito, nessun dato perso né in delta né nelle tracce", async () => {
  const { store, day } = seeded();
  let fail = true;
  const got = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (fail) {
        res.writeHead(401);
        return res.end("no");
      }
      got.push({ path: req.url, body: JSON.parse(body) });
      res.writeHead(200);
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const ex = new OtlpExporter({
      config: { otlp: { endpoint: `http://127.0.0.1:${server.address().port}`, headers: {}, intervalMs: 60_000, temporality: "delta", traces: true } },
      store,
      queries: new Queries(store),
      collector: fakeCollector,
    });
    const now = day + 3_920_000;
    await assert.rejects(ex.exportOnce(now));
    assert.match(ex.status().lastError, /HTTP 401/);
    assert.equal(store.meta("otlp_runs_rowid"), undefined, "watermark fermo");
    assert.equal(store.meta("otlp_delta"), undefined, "baseline delta ferma");
    fail = false;
    await ex.exportOnce(now + 10_000);
    const commits = got[0].body.resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === "opencode_lens_commits_total");
    assert.equal(commits.sum.dataPoints[0].asDouble, 1, "il delta dell'export fallito arriva al successivo");
    assert.ok(got.find((g) => g.path === "/v1/traces"), "gli span ripartono");
    assert.equal(ex.status().lastError, null);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
  }
});

test("OTLP delta: uno step o un tool esportato mentre è in corso non viene contato due volte", () => {
  const store = memoryStore();
  const c = new Collector(config(), store);
  const q = new Queries(store);
  const ex = new OtlpExporter({ config: { otlp: { endpoint: "http://127.0.0.1:1", headers: {}, intervalMs: 60_000, temporality: "delta", traces: false } }, store, queries: q, collector: c });
  const sum = { opencode_lens_steps_total: 0, opencode_lens_tool_calls_total: 0, opencode_lens_tokens_total: 0 };
  const tick = (now) => {
    const m = ex.metricsPayload(now);
    for (const metric of m.payload.resourceMetrics[0].scopeMetrics[0].metrics) {
      if (metric.name in sum) for (const p of metric.sum.dataPoints) sum[metric.name] += p.asDouble;
    }
    ex.prev = m.next; // come dopo un export accettato
  };
  const T = Date.now() - 100_000;
  for (let i = 0; i < 5; i++) {
    const mid = `m${i}`;
    const t = T + i * 10;
    c.handle({ id: `${mid}a`, type: "session.step.started", created: t, data: { sessionID: "s", assistantMessageID: mid, model: { id: "x", providerID: "p" } } });
    c.handle({ id: `${mid}b`, type: "session.tool.called", created: t + 1, data: { sessionID: "s", assistantMessageID: mid, id: "t", name: "bash" } });
    tick(t + 1); // export con step e tool in volo
    c.handle({ id: `${mid}c`, type: "session.tool.success", created: t + 2, data: { sessionID: "s", assistantMessageID: mid, id: "t" } });
    c.handle({ id: `${mid}d`, type: "session.step.ended", created: t + 3, data: { sessionID: "s", assistantMessageID: mid, finish: "stop", cost: 0, tokens: tokens(1, 1) } });
    tick(t + 3);
  }
  assert.equal(sum.opencode_lens_steps_total, 5);
  assert.equal(sum.opencode_lens_tool_calls_total, 5);
  assert.equal(sum.opencode_lens_tokens_total, 10);
  store.close();
});

test("OTLP delta: un contatore che cala manda 0 e riallinea la base", () => {
  const store = memoryStore();
  const values = [5, 3, 4];
  let k = 0;
  const queries = { families: () => [{ name: "opencode_lens_x_total", type: "counter", help: "x", samples: [{ labels: { a: "1" }, value: values[k] }] }] };
  const ex = new OtlpExporter({ config: { otlp: { endpoint: "http://127.0.0.1:1", headers: {}, intervalMs: 60_000, temporality: "delta", traces: false } }, store, queries, collector: null });
  const sent = [];
  for (; k < values.length; k++) {
    const m = ex.metricsPayload(Date.now());
    sent.push(m.payload.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asDouble);
    ex.prev = m.next; // as after an accepted export
  }
  assert.deepEqual(sent, [5, 0, 1]);
  store.close();
});

/** A model and a tool whose every row the retention prunes, and a newer step that stays. */
function prunedSeries() {
  const store = memoryStore();
  const DAY = 864e5;
  const T0 = Date.UTC(2024, 0, 10, 12);
  addStep(store, { id: "old", model: "oldmodel", started: T0, ended: T0 + 5000, cost: 1, tokens: tokens(100, 10), finish: "stop" });
  addTool(store, { id: "t_old", message: "old", name: "grep", status: "completed", created: T0 + 1000, ended: T0 + 2000 });
  addStep(store, { id: "new", model: "newmodel", started: T0 + 5 * DAY, ended: T0 + 5 * DAY + 5000, cost: 2, tokens: tokens(200, 20), finish: "stop" });
  const q = new Queries(store);
  const prune = () => store.pruneSlice({ from: T0 - 12 * 3_600_000, to: T0 + 12 * 3_600_000 }, (s) => q.counterSnapshot(s), () => q.counterMargins());
  return { store, q, prune };
}
const deltaConfig = { otlp: { endpoint: "http://127.0.0.1:1", headers: {}, intervalMs: 60_000, temporality: "delta", traces: false } };
const COLLECTOR_UP = { status: () => ({ state: "connected", drift: [] }), drift: [] };

/** What an OTLP delta backend adds up per series (attributes as a set), after one more export. */
function backendSums(ex, sums = new Map()) {
  const m = ex.metricsPayload(Date.now());
  for (const mt of m.payload.resourceMetrics[0].scopeMetrics[0].metrics) {
    if (!mt.sum) continue;
    for (const p of mt.sum.dataPoints) {
      const k = mt.name + JSON.stringify(p.attributes.map((a) => `${a.key}=${Object.values(a.value)[0]}`).sort());
      sums.set(k, (sums.get(k) ?? 0) + p.asDouble);
    }
  }
  ex.prev = m.next; // as after an accepted export
  return { sums, next: m.next };
}

test("OTLP delta: dopo la retention una serie di soli offset non viene rimandata per intero", () => {
  const { store, q, prune } = prunedSeries();
  const ex = new OtlpExporter({ config: deltaConfig, store, queries: q, collector: COLLECTOR_UP });
  const { sums } = backendSums(ex);
  const before = new Map(sums);
  prune();
  backendSums(ex, sums);
  for (const [k, v] of sums) assert.ok(Math.abs(v - (before.get(k) ?? 0)) < 1e-9, `${k}: ${before.get(k)} → ${v}`);
  store.close();
});

test("OTLP delta: lo stato salvato da una lens precedente (chiavi nell'ordine della famiglia) non fa rimandare nulla, anche dopo la retention", () => {
  const { store, q, prune } = prunedSeries();
  // the state as the lens before this one saved it: name + JSON of the labels in the order families() builds them
  const values = [];
  const sums = new Map();
  for (const f of q.families(COLLECTOR_UP)) {
    if (f.type !== "counter") continue;
    for (const s of f.samples) {
      values.push([`${f.name}${JSON.stringify(s.labels)}`, s.value]);
      const k = f.name + JSON.stringify(Object.entries(s.labels).map(([a, b]) => `${a}=${b}`).sort());
      sums.set(k, s.value);
    }
  }
  store.meta("otlp_delta", JSON.stringify({ endpoint: deltaConfig.otlp.endpoint, at: Date.now() - 60_000, values }));
  const before = new Map(sums);
  prune();
  const ex = new OtlpExporter({ config: deltaConfig, store, queries: q, collector: COLLECTOR_UP });
  backendSums(ex, sums);
  for (const [k, v] of sums) assert.ok(Math.abs(v - (before.get(k) ?? 0)) < 1e-9, `${k}: ${before.get(k)} → ${v}`);
  store.close();
});
