// The reads other modules make through the Store instead of its connection: /api/status and Sistema
// (counts), Impostazioni (databaseInfo) and the OTLP traces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPENCODE_TABLES } from "../src/schema.js";
import { addRun, addSession, addStep, addTool, memoryStore, tokens } from "./helpers.js";

const NOW = 1_800_000_000_000;

function fixture() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", created: NOW - 10_000 });
  addSession(store, { id: "ses_2", parent: "ses_1", created: NOW - 9_000 });
  addStep(store, { id: "s1", started: NOW - 8_000, ended: NOW - 7_000, tokens: tokens(10, 5) });
  addStep(store, { id: "s2", started: NOW - 6_000, ended: NOW - 5_000 });
  addStep(store, { id: "s3", started: NOW - 4_000 }); // still running
  addTool(store, { id: "t1", message: "s1", name: "task", status: "completed", created: NOW - 7_500, ended: NOW - 7_200, child_session: "ses_2" });
  addTool(store, { id: "t2", message: "s1", name: "read", status: "running", created: NOW - 7_400 });
  addRun(store, { id: "r1", started: NOW - 9_000, ended: NOW - 4_500 });
  addRun(store, { id: "r2", started: NOW - 3_000, ended: NOW - 1_000 });
  return store;
}

test("store: counts() è la riga della SELECT dei conteggi, così com'è", () => {
  const store = fixture();
  const raw = store.db.prepare(`SELECT (SELECT COUNT(*) FROM sessions) sessions, (SELECT COUNT(*) FROM steps) steps, (SELECT COUNT(*) FROM tools) tools`).get();
  assert.deepEqual(store.counts(), raw);
  assert.equal(JSON.stringify(store.counts()), JSON.stringify(raw));
  assert.equal(JSON.stringify(store.counts()), '{"sessions":2,"steps":3,"tools":2}');
  store.close();
});

test("store: databaseInfo() ha versione, journal, byte e le tabelle di OpenCode in ordine", () => {
  const store = fixture();
  const info = store.databaseInfo();
  assert.deepEqual(Object.keys(info), ["sqlite", "journalMode", "bytes", "tables"]);
  assert.equal(info.sqlite, store.db.prepare("SELECT sqlite_version() v").get().v);
  assert.equal(info.journalMode, "memory");
  assert.ok(info.bytes > 0);
  assert.deepEqual(Object.keys(info.tables), [...OPENCODE_TABLES]);
  assert.deepEqual(info.tables, { sessions: 2, steps: 3, tools: 2, internal_usage: 0, signals: 0, prompts: 0, runs: 2, permissions: 0 });
  store.close();
});

test("store: le letture delle tracce OTLP", () => {
  const store = fixture();
  assert.deepEqual(
    store.runsAfterRowid(0, 10).map((r) => [r.rowid, r.id]),
    [
      [1, "r1"],
      [2, "r2"],
    ],
  );
  assert.deepEqual(store.runsAfterRowid(1, 10).map((r) => r.id), ["r2"]);
  assert.deepEqual(store.runsAfterRowid(0, 1).map((r) => r.id), ["r1"]);
  assert.deepEqual(store.runsEndedSince(NOW - 2_000, 10).map((r) => r.id), ["r2"]);
  assert.equal(store.runsEndedSince(NOW, 10).length, 0);
  assert.equal(store.maxRunRowid(), 2);
  assert.equal(memoryStore().maxRunRowid(), null);
  const { parents, dispatch } = store.lineage();
  assert.deepEqual(
    parents.map((r) => ({ ...r })),
    [
      { id: "ses_1", p: null },
      { id: "ses_2", p: "ses_1" },
    ],
  );
  assert.deepEqual(dispatch.map((r) => ({ ...r })), [{ c: "ses_2", id: "t1" }]);
  // finished steps that started inside the run, by end; the running one is out
  assert.deepEqual(store.finishedSteps("ses_1", NOW - 9_000, NOW - 4_500).map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(store.finishedSteps("ses_1", NOW - 6_500, NOW).map((s) => s.id), ["s2"]);
  assert.deepEqual(store.finishedTools("s1").map((t) => t.id), ["t1"]);
  assert.deepEqual(store.finishedTools("s2"), []);
  store.close();
});

test("store: lo Store non crea né legge le tabelle di IBM Bob, che sono del modulo bob (modules/bob/tables.js)", () => {
  const store = memoryStore();
  assert.deepEqual(store.db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'bob%'").all(), []);
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
  assert.deepEqual(methods.filter((m) => /bob/i.test(m)), []);
  store.close();
});
