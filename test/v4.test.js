// Schema v4: request / first output / stream end of a step, reason of an
// interrupted run, exact internal usage (title, compaction) with absorption.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Collector, firstOutputOf, messageIdFromEvent } from "../src/collector.js";
import { SCHEMA_VERSION, Store } from "../src/store.js";
import { setLogLevel } from "../src/log.js";
import { addRun, addStep, memoryStore, tokens } from "./helpers.js";
import { startFakeOpencode } from "./fake-opencode.js";

setLogLevel("error");

const cols = (store, table) => store.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const V4_COLUMNS = {
  steps: ["requested", "first_output", "streamed"],
  runs: ["reason"],
  internal_usage: ["kind", "provider", "model", "variant", "reason"],
};

test("migrazione v3 → v4: colonne nuove, righe intatte, sessioni da rileggere", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-v4-"));
  const file = path.join(dir, "lens.db");
  try {
    // a v3 database: today's tables without the v4 columns
    const v3 = new Store(file);
    v3.close();
    const raw = new DatabaseSync(file);
    for (const [table, list] of Object.entries(V4_COLUMNS)) for (const c of list) raw.exec(`ALTER TABLE ${table} DROP COLUMN ${c}`);
    raw.exec(`INSERT INTO sessions (id, synced_cost, msg_watermark) VALUES ('s', 1, 5);
      INSERT INTO steps (id, session_id, started, ended, t_in) VALUES ('st', 's', 100, 200, 7);
      INSERT INTO runs (id, session_id, started, ended, outcome) VALUES ('r', 's', 100, 300, 'interrupted');
      INSERT INTO internal_usage (id, session_id, created, t_in) VALUES ('s:1', 's', 400, 9);
      PRAGMA user_version = 3;`);
    raw.close();

    const store = new Store(file);
    assert.equal(store.migrated, true);
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    assert.ok(SCHEMA_VERSION >= 4);
    for (const [table, list] of Object.entries(V4_COLUMNS)) for (const c of list) assert.ok(cols(store, table).includes(c), `${table}.${c}`);
    assert.deepEqual({ ...store.db.prepare(`SELECT started, ended, t_in, requested, first_output, streamed FROM steps`).get() }, { started: 100, ended: 200, t_in: 7, requested: null, first_output: null, streamed: null });
    assert.deepEqual({ ...store.db.prepare(`SELECT outcome, reason FROM runs`).get() }, { outcome: "interrupted", reason: null });
    assert.deepEqual({ ...store.db.prepare(`SELECT t_in, kind, model FROM internal_usage`).get() }, { t_in: 9, kind: null, model: null });
    assert.deepEqual({ ...store.db.prepare(`SELECT synced_cost, msg_watermark FROM sessions`).get() }, { synced_cost: null, msg_watermark: null });
    store.close();
    const again = new Store(file);
    assert.equal(again.migrated, false, "una volta sola");
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("database nuovo: colonne v4 già nello schema", () => {
  const store = memoryStore();
  for (const [table, list] of Object.entries(V4_COLUMNS)) for (const c of list) assert.ok(cols(store, table).includes(c), `${table}.${c}`);
});

test("stepStarted: un nuovo tentativo azzera primo output e fine dello stream", () => {
  const store = memoryStore();
  const st = store.st;
  const start = (requested, at) => st.stepStarted.run({ id: "m", session_id: "s", agent: "build", provider: "p", model: "x", variant: null, at, requested });
  const step = () => ({ ...store.db.prepare(`SELECT requested, first_output, streamed, attempts FROM steps WHERE id = 'm'`).get() });
  start(1000, 1200);
  st.stepOutput.run({ id: "m", at: 1500 });
  st.stepStreamed.run({ id: "m", at: 3000 });
  assert.deepEqual(step(), { requested: 1000, first_output: 1500, streamed: 3000, attempts: 1 });
  start(5000, 5200);
  assert.deepEqual(step(), { requested: 5000, first_output: null, streamed: null, attempts: 2 });
  st.stepOutput.run({ id: "m", at: 4000 });
  assert.equal(step().first_output, null, "evento del tentativo precedente");
  st.stepOutput.run({ id: "m", at: 5600 });
  st.stepOutput.run({ id: "m", at: 5800 });
  assert.equal(step().first_output, 5600);
});

test("stepStreamed: la fine dello stream di un tentativo precedente viene ignorata", () => {
  const store = memoryStore();
  const st = store.st;
  const start = (requested, at) => st.stepStarted.run({ id: "m", session_id: "s", agent: "build", provider: "p", model: "x", variant: null, at, requested });
  const streamed = () => store.db.prepare(`SELECT streamed FROM steps WHERE id = 'm'`).get().streamed;
  start(1000, 1200);
  start(5000, 5200);
  st.stepStreamed.run({ id: "m", at: 4000 });
  assert.equal(streamed(), null, "evento del tentativo precedente");
  st.stepStreamed.run({ id: "m", at: 9000 });
  assert.equal(streamed(), 9000);
  // without a known request the event is taken as it is
  st.stepStreamed.run({ id: "n", at: 1 });
  addStep(store, { id: "n", session: "s", started: 100 });
  st.stepStreamed.run({ id: "n", at: 700 });
  assert.equal(store.db.prepare(`SELECT streamed FROM steps WHERE id = 'n'`).get().streamed, 700);
});

test("runReason solo sui run interrotti", () => {
  const store = memoryStore();
  addRun(store, { id: "ok", ended: 100, outcome: "succeeded" });
  addRun(store, { id: "ko", ended: 200, outcome: "interrupted" });
  store.st.runReason.run({ id: "ok", reason: "user" });
  store.st.runReason.run({ id: "ko", reason: "user" });
  const r = Object.fromEntries(store.db.prepare(`SELECT id, reason FROM runs`).all().map((x) => [x.id, x.reason]));
  assert.deepEqual(r, { ok: null, ko: "user" });
});

// ---------- exact internal rows ----------

const T0 = Date.UTC(2026, 9, 15, 8, 0, 0);
const COLS = ["t_in", "t_out", "t_reason", "t_cread", "t_cwrite"];
const totalsOf = (cost, t_in, extra = {}) => ({ cost, t_in, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0, ...extra });
const exact = (id, created, t_in, extra = {}) => ({
  id, session_id: "ses_1", created, kind: "compaction", provider: null, model: null, variant: null, reason: null,
  cost: 0, t_in, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0, ...extra,
});
const rows = (store) => store.db.prepare(`SELECT * FROM internal_usage WHERE session_id = 'ses_1' ORDER BY created, id`).all().map((r) => ({ ...r }));
const residual = (store) => rows(store).filter((r) => r.kind === null);

/** Σ steps + Σ internal = session totals, column by column. */
function invariant(store, totals) {
  const st = store.db.prepare(`SELECT COALESCE(SUM(cost),0) cost, ${COLS.map((c) => `COALESCE(SUM(${c}),0) ${c}`).join(", ")} FROM steps WHERE session_id = 'ses_1'`).get();
  const it = store.db.prepare(`SELECT COALESCE(SUM(cost),0) cost, ${COLS.map((c) => `COALESCE(SUM(${c}),0) ${c}`).join(", ")} FROM internal_usage WHERE session_id = 'ses_1'`).get();
  for (const c of COLS) assert.equal(st[c] + it[c], totals[c], `invariante su ${c}`);
  assert.ok(Math.abs(st.cost + it.cost - totals.cost) < 1e-9, "invariante sul costo");
  for (const r of rows(store)) for (const c of [...COLS, "cost"]) assert.ok(r[c] >= 0, `${r.id}.${c} non negativo`);
}

test("recordInternal: compaction letta dopo la sua stima assorbe la riga «altro»", () => {
  const store = memoryStore();
  addStep(store, { id: "msg_1", started: T0, ended: T0 + 500, tokens: tokens(100) });
  const totals = totalsOf(0, 400);
  store.reconcileInternal("ses_1", T0 + 5000, totals);
  assert.equal(residual(store)[0].t_in, 300);
  assert.equal(store.tx(() => store.recordInternal(exact("msg_cmp", T0 + 1000, 300))), true);
  assert.equal(residual(store).length, 0);
  assert.deepEqual(rows(store).map((r) => [r.id, r.kind, r.t_in]), [["msg_cmp", "compaction", 300]]);
  invariant(store, totals);
  assert.equal(store.tx(() => store.recordInternal(exact("msg_cmp", T0 + 1000, 300))), false, "già registrata");
  assert.equal(rows(store).length, 1);
  invariant(store, totals);
  assert.equal(store.reconcileInternal("ses_1", T0 + 9000, totals), null);
});

test("recordInternal: titolo dal vivo prima dei totali", () => {
  const store = memoryStore();
  addStep(store, { id: "msg_1", started: T0, ended: T0 + 500, tokens: tokens(100) });
  store.tx(() => store.recordInternal(exact("evt_t", T0 + 1000, 120, { kind: "title" })));
  // the session totals do not include the title yet: transient, skipped
  assert.equal(store.reconcileInternal("ses_1", T0 + 2000, totalsOf(0, 100)), null);
  assert.equal(store.reconcileInternal("ses_1", T0 + 3000, totalsOf(0, 220)), null);
  assert.equal(residual(store).length, 0);
  invariant(store, totalsOf(0, 220));
});

test("recordInternal: titolo dal vivo dopo una lettura che lo aveva già stimato", () => {
  const store = memoryStore();
  addStep(store, { id: "msg_1", started: T0, ended: T0 + 500, tokens: tokens(100) });
  const totals = totalsOf(0.001, 220);
  store.reconcileInternal("ses_1", T0 + 5000, totals);
  store.tx(() => store.recordInternal(exact("evt_t", T0 + 4000, 120, { kind: "title", cost: 0.001 })));
  assert.equal(residual(store).length, 0);
  invariant(store, totals);
});

test("recordInternal: una stima più vecchia del consumo non viene toccata", () => {
  const store = memoryStore();
  store.reconcileInternal("ses_1", T0 + 1000, totalsOf(0, 50));
  store.tx(() => store.recordInternal(exact("msg_cmp", T0 + 2000, 30)));
  assert.equal(residual(store)[0].t_in, 50);
  invariant(store, totalsOf(0, 80));
});

test("recordInternal: copertura parziale, mai sotto zero", () => {
  const store = memoryStore();
  store.reconcileInternal("ses_1", T0 + 3000, totalsOf(0, 50));
  store.reconcileInternal("ses_1", T0 + 4000, totalsOf(0, 90));
  store.tx(() => store.recordInternal(exact("msg_cmp", T0 + 2000, 70)));
  assert.deepEqual(residual(store).map((r) => r.t_in), [20]);
  invariant(store, totalsOf(0, 90));
});

test("recordInternal: una rilettura con meno token non abbassa la riga esatta", () => {
  const store = memoryStore();
  store.tx(() => store.recordInternal(exact("msg_cmp", T0 + 1000, 300, { cost: 0.02, t_out: 40 })));
  store.tx(() => store.recordInternal(exact("msg_cmp", T0 + 1000, 200, { cost: 0.01, t_out: 50, model: "m" })));
  const [r] = rows(store);
  assert.deepEqual([r.t_in, r.t_out, r.cost, r.model], [300, 50, 0.02, "m"]);
});

test("reconcileInternal: id unici anche con righe esatte in mezzo", () => {
  const store = memoryStore();
  store.reconcileInternal("ses_1", T0 + 1000, totalsOf(0, 10));
  store.tx(() => store.recordInternal(exact("msg_cmp", T0 + 2000, 5)));
  assert.equal(store.reconcileInternal("ses_1", T0 + 3000, totalsOf(0, 20)).id, "ses_1:2");
  // an id already taken (e.g. by an older version) is skipped
  store.tx(() => store.recordInternal(exact("ses_1:3", T0 + 3500, 1)));
  assert.equal(store.reconcileInternal("ses_1", T0 + 4000, totalsOf(0, 30)).id, "ses_1:4");
});

// ---------- collector: live events ----------

const config = (extra = {}) => ({ serviceFile: "/nonesiste", serverUrl: "", storeTitles: true, scanIntervalMs: 120_000, ...extra });
function live() {
  const store = memoryStore();
  const c = new Collector(config(), store);
  let n = 0;
  const ev = (type, created, data, id = `evt_${++n}`) => c.handle({ id, type, created, data });
  const step = (id = "msg_1") => ({ ...store.db.prepare(`SELECT requested, first_output, streamed FROM steps WHERE id = ?`).get(id) });
  return { store, c, ev, step };
}
const MODEL = { id: "claude-sonnet-5-5", providerID: "anthropic" };
const call = { sessionID: "ses_1", assistantMessageID: "msg_1" };

test("messageIdFromEvent", () => {
  assert.equal(messageIdFromEvent("evt_abc"), "msg_abc");
  assert.equal(messageIdFromEvent("xyz"), null);
  assert.equal(messageIdFromEvent(undefined), null);
});

test("dal vivo: richiesta, primo output, fine dello stream", () => {
  const { c, ev, step } = live();
  ev("session.step.started", 1200, { ...call, agent: "build", model: MODEL, started: 1000 });
  ev("session.reasoning.started", 2500, { ...call, ordinal: 0 });
  ev("session.text.started", 2600, { ...call, ordinal: 0 });
  ev("session.step.streamed", 9000, call);
  assert.deepEqual(step(), { requested: 1000, first_output: 2500, streamed: 9000 });
  assert.equal(c.drift.size, 0);
  ev("session.step.started", 20_000, { sessionID: "ses_1", assistantMessageID: "msg_2", agent: "build", model: MODEL });
  assert.equal(step("msg_2").requested, 20_000, "senza data.started: l'istante dell'evento");
  assert.equal(c.drift.size, 0, "data.started ha un fallback: la sua assenza non è un drift (nessun banner)");
});

test("dal vivo: tentativo ripetuto", () => {
  const { ev, step } = live();
  ev("session.step.started", 1100, { ...call, agent: "build", model: MODEL, started: 1000 });
  ev("session.text.started", 1500, call);
  ev("session.step.started", 4100, { ...call, agent: "build", model: MODEL, started: 4000 });
  assert.equal(step().first_output, null);
  ev("session.text.started", 1600, call);
  assert.equal(step().first_output, null, "evento del primo tentativo");
  ev("session.tool.input.started", 4300, { ...call, id: "call_1", name: "read" });
  assert.equal(step().first_output, 4300);
});

test("dal vivo: motivo dell'interruzione prima e dopo il run", () => {
  const { store, c, ev } = live();
  ev("session.execution.interrupted", 1000, { sessionID: "ses_1", reason: "user" }, "evt_9");
  assert.equal(c.interrupts.get("msg_9"), "user");
  addRun(store, { id: "msg_8", ended: 2000, outcome: "interrupted" });
  ev("session.execution.interrupted", 2000, { sessionID: "ses_1", reason: "superseded" }, "evt_8");
  assert.equal(store.db.prepare(`SELECT reason FROM runs WHERE id = 'msg_8'`).get().reason, "superseded");
  ev("session.execution.interrupted", 3000, { sessionID: "ses_1", reason: "inactivity" }, "strano_7");
  assert.equal(c.interrupts.has("msg_7"), false);
  const details = store.db.prepare(`SELECT detail FROM signals WHERE type = 'session.execution.interrupted' ORDER BY created`).all().map((r) => JSON.parse(r.detail).reason);
  assert.deepEqual(details, ["user", "superseded", "inactivity"]);
});

test("dal vivo: compaction finite e nuove sessioni nel feed", () => {
  const { store, ev } = live();
  const feed = [];
  store.onChange((kind, item) => kind === "feed" && feed.push(item));
  ev("session.created", 500, { sessionID: "ses_1" });
  ev("session.created", 600, { sessionID: "ses_sub", parentID: "ses_1" });
  ev("session.compaction.started", 1900, { sessionID: "ses_1", reason: "manual", inputID: "msg_in" });
  ev("session.compaction.ended", 2100, { sessionID: "ses_1", reason: "manual", model: MODEL, text: "riassunto segreto", tokens: tokens(3000) });
  ev("session.compaction.failed", 3100, { sessionID: "ses_1", reason: "auto", error: { type: "aborted", message: "x" } });
  assert.deepEqual(feed, [
    { at: 500, kind: "session", sessionID: "ses_1" },
    { at: 2100, kind: "compaction", sessionID: "ses_1", failed: false, reason: "manual", provider: "anthropic", model: "claude-sonnet-5-5" },
    { at: 3100, kind: "compaction", sessionID: "ses_1", failed: true, reason: "auto", provider: null, model: null },
  ], "la sessione del subagente e l'inizio della compaction non sono eventi; mai il testo");
});

test("dal vivo: titolo e compaction come task interni esatti", () => {
  const { store, ev } = live();
  const tk = tokens(120, 15);
  ev("session.usage.recorded", 1000, { sessionID: "ses_1", source: "title", cost: 0.0005, tokens: tk }, "evt_title");
  ev("session.usage.recorded", 2000, { sessionID: "ses_1", source: "compaction", cost: 0.01, tokens: tokens(3000, 400) });
  ev("session.compaction.started", 1900, { sessionID: "ses_1", reason: "manual", recent: "testo", inputID: "msg_in" });
  ev("session.compaction.ended", 2100, { sessionID: "ses_1", reason: "manual", model: MODEL, text: "riassunto segreto", recent: "x", cost: 0.01, tokens: tokens(3000, 400) });
  ev("session.compaction.started", 3000, { sessionID: "ses_1", reason: "auto", recent: "" });
  ev("session.compaction.failed", 3100, { sessionID: "ses_1", reason: "auto", error: { type: "aborted", message: "x" } });
  const r = store.db.prepare(`SELECT id, kind, provider, model, reason, t_in, cost FROM internal_usage ORDER BY created`).all().map((x) => ({ ...x }));
  assert.deepEqual(r, [
    { id: "evt_title", kind: "title", provider: null, model: null, reason: null, t_in: 120, cost: 0.0005 },
    { id: "msg_in", kind: "compaction", provider: "anthropic", model: "claude-sonnet-5-5", reason: "manual", t_in: 3000, cost: 0.01 },
  ]);
  const sig = store.db.prepare(`SELECT type, detail FROM signals WHERE type LIKE 'session.compaction.%' ORDER BY created`).all();
  assert.deepEqual(sig.map((s) => [s.type, JSON.parse(s.detail).reason]), [
    ["session.compaction.started", "manual"],
    ["session.compaction.ended", "manual"],
    ["session.compaction.started", "auto"],
    ["session.compaction.failed", "auto"],
  ]);
  assert.equal(JSON.parse(sig[1].detail).model, "anthropic/claude-sonnet-5-5");
  assert.ok(!sig.some((s) => /segreto|testo/.test(s.detail)), "nessun testo salvato");
  const usage = store.db.prepare(`SELECT detail FROM signals WHERE type = 'session.usage.recorded'`).all().map((s) => JSON.parse(s.detail).source);
  assert.deepEqual(usage, ["title", "compaction"]);
});

test("dal vivo: evento ripetuto applicato una volta", () => {
  const { store, ev } = live();
  const data = { sessionID: "ses_1", source: "title", cost: 0.0005, tokens: tokens(120, 15) };
  ev("session.usage.recorded", 1000, data, "evt_same");
  ev("session.usage.recorded", 1000, data, "evt_same");
  assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM internal_usage`).get().n, 1);
});

// ---------- collector: message backfill ----------

test("firstOutputOf: solo una prima parte con orario", () => {
  assert.equal(firstOutputOf({ content: [{ type: "reasoning", text: "", time: { created: 2500 } }, { type: "text", text: "" }] }), 2500);
  assert.equal(firstOutputOf({ content: [{ type: "tool", id: "c", name: "read", time: { created: 3000, ran: 3100 } }] }), 3000);
  assert.equal(firstOutputOf({ content: [{ type: "text", text: "" }, { type: "tool", time: { created: 3000 } }] }), null);
  assert.equal(firstOutputOf({ content: [] }), null);
  assert.equal(firstOutputOf({}), null);
});

async function syncer(data) {
  const fake = await startFakeOpencode({ data, pageSize: 10 });
  const store = memoryStore();
  const collector = new Collector(config({ serviceFile: fake.serviceFile, storeTitles: false }), store);
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

const tk = (input, output = 0) => ({ input, output, reasoning: 0, cache: { read: 0, write: 0 } });
const assistant = (id, created, extra = {}) => ({
  id, type: "assistant", agent: "build", model: MODEL, finish: "stop", cost: 0, tokens: tk(100),
  time: { created, completed: created + 9050, streamed: created + 9000 },
  content: [{ type: "reasoning", text: "non salvato", time: { created: created + 1500 } }, { type: "text", text: "non salvato" }],
  ...extra,
});

test("backfill: orari dello step dai messaggi; il primo output dal vivo resta se il messaggio non lo sa", async () => {
  const msgs = [
    assistant("a1", 1000),
    assistant("a2", 20_000, { content: [{ type: "text", text: "x" }] }),
  ];
  const session = { id: "s1", cost: 0, tokens: tk(200), time: { created: 0, updated: 30_000 } };
  const h = await syncer({ events: [], sessions: [session], messages: { s1: msgs } });
  try {
    h.collector.handle({ id: "evt_1", type: "session.step.started", created: 20_100, data: { sessionID: "s1", assistantMessageID: "a2", agent: "build", model: MODEL, started: 20_000 } });
    h.collector.handle({ id: "evt_2", type: "session.text.started", created: 22_400, data: { sessionID: "s1", assistantMessageID: "a2" } });
    await h.collector.syncSession("s1");
    const step = (id) => ({ ...h.store.db.prepare(`SELECT requested, first_output, streamed FROM steps WHERE id = ?`).get(id) });
    assert.deepEqual(step("a1"), { requested: 1000, first_output: 2500, streamed: 10_000 });
    assert.deepEqual(step("a2"), { requested: 20_000, first_output: 22_400, streamed: 29_000 });
  } finally {
    await h.close();
  }
});

test("backfill: la compaction dai messaggi assorbe la stima di una lettura vecchia", async () => {
  const cmp = { id: "msg_cmp", type: "compaction", status: "completed", reason: "auto", summary: "riassunto non salvato", recent: "", time: { created: 12_000 } };
  const session = { id: "s1", cost: 0.003, tokens: tk(5100, 300), time: { created: 0, updated: 30_000 } };
  const data = { events: [], sessions: [session], messages: { s1: [assistant("a1", 1000), cmp] } };
  const h = await syncer(data);
  const all = () => h.store.db.prepare(`SELECT id, kind, model, reason, t_in, t_out, cost FROM internal_usage ORDER BY id`).all().map((r) => ({ ...r }));
  try {
    // an older OpenCode: the compaction message has no usage, the estimate holds it
    await h.collector.syncSession("s1");
    assert.deepEqual(all().map((r) => [r.kind, r.t_in, r.t_out]), [[null, 5000, 300]]);
    // the message now carries model and usage: the full re-read makes it exact
    Object.assign(cmp, { model: MODEL, cost: 0.003, tokens: tk(5000, 300) });
    await h.collector.syncSession("s1", undefined, { full: true });
    const exactRows = [{ id: "msg_cmp", kind: "compaction", model: "claude-sonnet-5-5", reason: "auto", t_in: 5000, t_out: 300, cost: 0.003 }];
    assert.deepEqual(all(), exactRows);
    await h.collector.syncSession("s1", undefined, { full: true });
    assert.deepEqual(all(), exactRows, "una seconda rilettura non cambia nulla");
    assert.ok(!JSON.stringify(h.store.db.prepare(`SELECT * FROM internal_usage`).all()).includes("riassunto"));
  } finally {
    await h.close();
  }
});

test("backfill: il motivo noto dal vivo arriva sul run", async () => {
  const msgs = [
    { id: "u1", type: "user", text: "x", metadata: {}, time: { created: 500 } },
    assistant("a1", 1000),
    { id: "idle1", type: "idle", outcome: "interrupted", time: { created: 11_000 } },
    { id: "u2", type: "user", text: "y", metadata: {}, time: { created: 12_000 } },
    assistant("a2", 12_500),
    { id: "idle2", type: "idle", outcome: "succeeded", time: { created: 22_000 } },
  ];
  const session = { id: "s1", cost: 0, tokens: tk(200), time: { created: 0, updated: 22_000 } };
  const h = await syncer({ events: [], sessions: [session], messages: { s1: msgs } });
  try {
    h.collector.interrupts.set("idle1", "inactivity");
    h.collector.interrupts.set("idle2", "user"); // not an interrupted run: ignored
    await h.collector.syncSession("s1");
    const r = Object.fromEntries(h.store.db.prepare(`SELECT id, reason FROM runs`).all().map((x) => [x.id, x.reason]));
    assert.deepEqual(r, { idle1: "inactivity", idle2: null });
  } finally {
    await h.close();
  }
});

// ---------- final review fixes ----------

test("dal vivo: senza compaction.started non si indovina l'id, nessuna riga dal vivo", () => {
  const { store, ev } = live();
  ev("session.compaction.ended", 5000, { sessionID: "ses_1", reason: "auto", model: MODEL, cost: 0.01, tokens: tokens(5000) }, "evt_end1");
  // started without inputID and without an evt_ id: no known message id either
  ev("session.compaction.started", 6000, { sessionID: "ses_1", reason: "auto", recent: "" }, "strano_s2");
  ev("session.compaction.ended", 7000, { sessionID: "ses_1", reason: "auto", model: MODEL, cost: 0.01, tokens: tokens(4000) }, "evt_end2");
  assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM internal_usage`).get().n, 0, "il consumo resta alla stima o alla lettura");
  assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM signals WHERE type = 'session.compaction.ended'`).get().n, 2, "i segnali restano");
});

test("dal vivo: la compaction prende l'istante di started e assorbe la stima registrata nel mezzo", () => {
  const { store, ev } = live();
  ev("session.compaction.started", 1000, { sessionID: "ses_1", reason: "auto", recent: "" }, "evt_s1");
  // a sync between OpenCode writing the totals and publishing ended: the compaction is estimated at 3000
  store.reconcileInternal("ses_1", 3000, { cost: 0.01, t_in: 5000, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 });
  ev("session.compaction.ended", 5000, { sessionID: "ses_1", reason: "auto", model: MODEL, cost: 0.01, tokens: tokens(5000) }, "evt_e1");
  const rows = store.db.prepare(`SELECT id, kind, created, t_in FROM internal_usage`).all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ id: "msg_s1", kind: "compaction", created: 1000, t_in: 5000 }]);
});

test("backfill: un tentativo ripetuto non riporta la richiesta al primo tentativo", () => {
  const { store, ev, step } = live();
  ev("session.step.started", 1100, { ...call, agent: "build", model: MODEL, started: 1000 });
  ev("session.step.started", 9100, { ...call, agent: "build", model: MODEL, started: 9000 });
  ev("session.text.started", 10_000, call);
  // the message keeps the first attempt's time.created and starts with text (no first output)
  addStep(store, { id: "msg_1", session: "ses_1", started: 1000, ended: 20_000, requested: 1000, streamed: 19_000, tokens: tokens(10, 100) });
  assert.deepEqual(step(), { requested: 9000, first_output: 10_000, streamed: 19_000 });
  // a first output read from the message of the last attempt still wins
  addStep(store, { id: "msg_1", session: "ses_1", started: 1000, ended: 20_000, requested: 1000, firstOutput: 9500, streamed: 19_000, tokens: tokens(10, 100) });
  assert.equal(step().first_output, 9500);
});

test("step.ended live tardivo: i token del backfill restano e l'invariante non si rompe", () => {
  const store = memoryStore();
  store.st.sessionCreated.run({ id: "ses_live", parent_id: null, project_id: null, directory: "/p", created: 1000 });
  // the authoritative backfill wrote every token kind
  addStep(store, { id: "msg_fin", session: "ses_live", started: 1000, ended: 2000, cost: 0.01, tokens: tokens(1000, 200, 50, 3000, 500) });
  const totals = { cost: 0.01, t_in: 1000, t_out: 200, t_reason: 50, t_cread: 3000, t_cwrite: 500 };
  assert.equal(store.reconcileInternal("ses_live", 2500, totals), null);

  // a late live event carries only the fields the contract requires
  const collector = new Collector({ serviceFile: "/nonexistent", serverUrl: "", storeTitles: false, scanIntervalMs: 120_000 }, store);
  collector.handle({ type: "session.step.ended", created: 3000, data: { sessionID: "ses_live", assistantMessageID: "msg_fin", finish: "stop", tokens: { input: 1000, output: 200 } } });

  const row = store.db.prepare("SELECT * FROM steps WHERE id = 'msg_fin'").get();
  assert.equal(row.t_reason, 50);
  assert.equal(row.t_cread, 3000);
  assert.equal(row.t_cwrite, 500);
  assert.ok(Math.abs(row.cost - 0.01) < 1e-12);
  // no phantom internal usage: the invariant Σ steps + Σ internal = totals still holds
  assert.equal(store.reconcileInternal("ses_live", 4000, totals), null);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM internal_usage").get().n, 0);
});
