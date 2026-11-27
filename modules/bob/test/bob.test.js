// IBM Bob as a second source (server/source.js, server/queries.js, server/views.js): read-only polling of a fake
// bob.db, never a title or a text in the lens, the module's queries and its views through OpenCode's. That OpenCode's
// answers do not change with Bob on is checked through the core's server in test/server-modules.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileStore, memoryStore, moduleContext, Queries, sourceQueries } from "../../../test/module-test-kit.js";
import tables from "../tables.js";
import { BobQueries } from "../server/queries.js";
import { BobSource, directoryOf, kindOf, readSpend } from "../server/source.js";
import { BOB_CONTEXT, bobLimits, bobSource } from "../server/views.js";
import { SECRET, addTask, openFakeBob, seedFakeBob, writeFakeBob } from "./fake-bob.js";

const NOW = new Date(2026, 9, 23, 15, 0, 0).getTime();
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const MODULE_TABLES = [{ id: "bob", ...tables }];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lens-bob-"));

/**
 * The module's ctx on `store` (created with the module's tables), with its settings: bob.db at `dbPath`. `source`:
 * the module declares one, so ctx.live.feed exists.
 */
function contextOf(store, dbPath, extra = {}, { source = false } = {}) {
  const settings = { dbPath, intervalMs: 30_000, coinUsd: 0.5, monthlyCoins: null, ...extra };
  return moduleContext({ id: "bob", config: { dbPath: store.dbPath ?? ":memory:", scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries: new Queries(store), log: QUIET, settings, tables, source });
}

/** Bob on a lens database in memory (on a file with `onFile`, for the views), with the fixed clock unless `now`. */
function source(dbPath, extra, { onFile = false, now = () => NOW, live = false } = {}) {
  const store = onFile ? fileStore({ moduleTables: MODULE_TABLES }) : memoryStore({ moduleTables: MODULE_TABLES });
  const ctx = contextOf(store, dbPath, extra, { source: live });
  const bob = new BobSource(ctx, { now });
  return { store, ctx, bob };
}

test("lettori: spend di Bob con l'input senza cache, tipo del task e cartella", () => {
  // Bob's input is the whole prompt, cache included: the lens keeps the fresh part, as OpenCode does
  assert.deepEqual(readSpend(JSON.stringify({ input: 1000, output: 50, cacheRead: 700, cacheWrite: 200, cost: 0.12, contextTokens: 1050 })), { coins: 0.12, t_in: 100, t_out: 50, t_cread: 700, t_cwrite: 200 });
  assert.deepEqual(readSpend({ input: 10, output: 2 }), { coins: null, t_in: 10, t_out: 2, t_cread: 0, t_cwrite: 0 });
  assert.equal(readSpend({ input: 10, cacheRead: 30 }).t_in, 0, "never below zero");
  assert.equal(readSpend(JSON.stringify({ something: "else" })), null);
  assert.equal(readSpend("not json"), null);
  assert.equal(readSpend(null), null);
  assert.equal(kindOf({ parent_id: null, task_type: "normal" }), "task");
  assert.equal(kindOf({ parent_id: "p", task_type: "subagent" }), "subagent");
  assert.equal(kindOf({ parent_id: "p", task_type: "subtask" }), "subagent");
  assert.equal(directoryOf("file:/Users/me/repo"), "/Users/me/repo");
  assert.equal(directoryOf("git:abc"), null);
});

test("sorgente: legge task, subagent, chiamate e tool; nessun titolo né testo nella lens", () => {
  const dir = tmp();
  const file = path.join(dir, "bob.db");
  const counts = writeFakeBob(file, { now: NOW });
  const { store, bob } = source(file);
  const r = bob.scan();
  assert.equal(bob.state(), "connected");
  assert.equal(r.tasks, counts.tasks + counts.subagents);
  const lens = store.db.prepare("SELECT COUNT(*) n, COALESCE(SUM(kind = 'subagent'), 0) sub FROM bob_tasks").get();
  assert.equal(lens.n, counts.tasks + counts.subagents);
  assert.equal(lens.sub, counts.subagents);
  // Bob's own totals per task are what the lens keeps
  const src = new DatabaseSync(file, { readOnly: true });
  const bob0 = src
    .prepare(`SELECT SUM(json_extract(costs, '$.cost')) c,
        SUM(json_extract(costs, '$.input') - json_extract(costs, '$.cacheRead') - json_extract(costs, '$.cacheWrite')) fresh,
        (SELECT COUNT(*) FROM messages WHERE role = 'assistant') calls, (SELECT COUNT(*) FROM messages WHERE role = 'user') prompts,
        (SELECT COUNT(*) FROM messages WHERE role = 'tool') tools FROM tasks`)
    .get();
  src.close();
  const lensSums = store.db.prepare("SELECT SUM(coins) c, SUM(t_in) fresh FROM bob_tasks").get();
  assert.ok(Math.abs(lensSums.c - bob0.c) < 1e-6, "Bob's cost per task");
  assert.equal(lensSums.fresh, bob0.fresh, "the input without the cache");
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_requests").get().n, bob0.calls, "one step per assistant message");
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_requests WHERE t_in > t_cread").get().n, 0, "fresh input, not the whole prompt");
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_tools WHERE status <> 'pending'").get().n, bob0.tools, "every tool message closes its call");
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_tools x LEFT JOIN bob_requests r ON r.id = x.message_id WHERE r.id IS NULL").get().n, 0, "every call belongs to its model call");
  assert.ok(store.db.prepare("SELECT COUNT(*) n FROM bob_tools WHERE status = 'error'").get().n > 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_tools WHERE ended - created < 50").get().n, 0, "a call lasts Bob's durationMs");
  assert.deepEqual(store.db.prepare("SELECT DISTINCT mode FROM bob_tasks ORDER BY 1").all().map((r) => r.mode), ["advanced", "ask", "code", "plan"]);
  // one prompt per user message, the instant only
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_prompts").get().n, bob0.prompts);
  assert.equal(bob0.prompts, counts.prompts + counts.subagents);
  // nothing of Bob's text reaches the lens
  for (const t of ["bob_tasks", "bob_requests", "bob_tools", "bob_prompts"]) {
    for (const row of store.db.prepare(`SELECT * FROM ${t}`).all()) assert.ok(!JSON.stringify(row).includes(SECRET), `${t}: ${JSON.stringify(row)}`);
  }
  // idempotent: a second pass finds nothing new and writes nothing twice
  const before = store.db.prepare("SELECT (SELECT COUNT(*) FROM bob_requests) r, (SELECT COUNT(*) FROM bob_tools) t").get();
  assert.equal(bob.scan().tasks, 0);
  assert.deepEqual(store.db.prepare("SELECT (SELECT COUNT(*) FROM bob_requests) r, (SELECT COUNT(*) FROM bob_tools) t").get(), before);
  bob.close();
  store.close();
});

test("sorgente: un task che continua viene riletto, solo i messaggi nuovi si aggiungono", () => {
  const dir = tmp();
  const file = path.join(dir, "bob.db");
  const db = openFakeBob(file);
  const id = addTask(db, { cwd: "/w/a", created: NOW - 60_000, requests: [{ at: NOW - 50_000, input: 100, output: 10, cost: 0.1, tools: [{ name: "read_file" }] }] });
  const { store, bob } = source(file);
  bob.scan();
  assert.equal(store.db.prepare("SELECT requests FROM bob_tasks WHERE id = ?").get(id).requests, 1);
  // Bob writes one more turn and moves updated_at and costs
  db.prepare("INSERT INTO messages (id, task_id, role, data, created_at) VALUES ('m-late', ?, 'assistant', ?, ?)").run(id, JSON.stringify({ role: "assistant", _meta: { spend: { input: 250, output: 20, cacheRead: 50, cacheWrite: 0, cost: 0.2 } } }), NOW - 10_000);
  db.prepare("UPDATE tasks SET status = 'completed', updated_at = ?, costs = ? WHERE id = ?").run(NOW - 10_000, JSON.stringify({ input: 350, output: 30, cacheRead: 50, cacheWrite: 0, cost: 0.3 }), id);
  assert.equal(bob.scan().tasks, 1);
  const t = store.db.prepare("SELECT status, coins, t_in, requests FROM bob_tasks WHERE id = ?").get(id);
  assert.deepEqual({ ...t }, { status: "completed", coins: 0.3, t_in: 300, requests: 2 });
  db.close();
  bob.close();
  store.close();
});

test("sorgente: file assente, poi creato; drift quando manca una colonna", () => {
  const dir = tmp();
  const file = path.join(dir, "bob.db");
  const { store, bob } = source(file);
  bob.scan();
  assert.equal(bob.state(), "missing");
  assert.equal(bob.status().tasks, 0);
  const db = openFakeBob(file);
  addTask(db, { created: NOW - 1000, requests: [] });
  db.close();
  bob.scan();
  assert.equal(bob.state(), "connected");
  assert.equal(bob.status().tasks, 1);
  bob.close();

  const other = path.join(dir, "old.db");
  const legacy = new DatabaseSync(other);
  legacy.exec("CREATE TABLE tasks (id TEXT, created_at INTEGER, updated_at INTEGER); CREATE TABLE messages (task_id TEXT, role TEXT, data TEXT, created_at INTEGER);");
  legacy.close();
  const s2 = new BobSource(contextOf(store, other), { now: () => NOW });
  s2.scan();
  assert.equal(s2.state(), "drift");
  assert.deepEqual(s2.status().drift.map((d) => d.what), ["tasks"]);
  assert.ok(s2.families().some((f) => f.name === "opencode_lens_bob_drift" && f.samples[0].value === 1));
  s2.close();
  store.close();
});

test("aggiornamento dalla 0.32.0: tool senza message_id e lettore vecchio, tutto riletto senza perdere righe", () => {
  const dir = tmp();
  const file = path.join(dir, "bob.db");
  const counts = writeFakeBob(file, { now: NOW });
  // the tables as 0.32.0 left them: bob_tools without message_id, a task read by the old reader, no reader recorded
  const old = fileStore();
  old.db.exec(tables.sql);
  old.db.exec("DROP TABLE bob_tools; CREATE TABLE bob_tools (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, name TEXT, status TEXT, created INTEGER, ended INTEGER, child_task TEXT)");
  old.db.prepare("INSERT INTO bob_tasks (id, kind, coins, created, updated) VALUES ('gone-from-bob', 'task', 1.5, 1, 2)").run();
  // this lens opens it with the module's tables: the column the module declares is added, Bob on or off
  const store = old.reopen({ moduleTables: MODULE_TABLES });
  assert.ok(store.db.prepare("PRAGMA table_info(bob_tools)").all().some((c) => c.name === "message_id"));
  const bob = new BobSource(contextOf(store, file), { now: () => NOW });
  assert.equal(store.meta("module:bob:data:bob_reader"), "3");
  assert.equal(bob.scan().tasks, counts.tasks + counts.subagents);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_tasks WHERE id = 'gone-from-bob'").get().n, 1, "a task Bob already deleted stays");
  // the same reader again: nothing to re-read
  const again = new BobSource(contextOf(store, file), { now: () => NOW });
  assert.equal(again.scan().tasks, 0);
  bob.close();
  again.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("query: totali del periodo, somma con OpenCode e pagina", () => {
  const dir = tmp();
  const file = path.join(dir, "bob.db");
  writeFakeBob(file, { now: NOW });
  const { store, ctx, bob } = source(file, { monthlyCoins: 180 });
  bob.scan();
  const q = new BobQueries(ctx);
  const all = q.totals(0, NOW + 1);
  assert.ok(Math.abs(all.coins - store.db.prepare("SELECT SUM(coins) c FROM bob_tasks").get().c) < 1e-9, "every Bobcoin counted once");
  assert.ok(Math.abs(all.cost - all.coins * 0.5) < 1e-9);
  assert.equal(all.tokens.total, all.tokens.input + all.tokens.output + all.tokens.cacheRead + all.tokens.cacheWrite);

  const page = q.page(NOW - 7 * 86_400_000, NOW + 1, NOW);
  assert.ok(page.byDay.length >= 7 && page.byDay.length <= 9, `${page.byDay.length} days`);
  assert.ok(Math.abs(page.byDay.reduce((a, d) => a + d.coins, 0) - page.totals.coins) < 1e-9);
  assert.ok(page.byDirectory.length > 0 && page.byDirectory.every((d) => d.directory.startsWith("/Users/dev/")));
  assert.deepEqual(page.byModel.map((m) => m.model), ["auto"], "Bob does not record the model");
  assert.ok(page.tools.some((t) => t.name === "read_file"));
  assert.ok(page.recent.length > 0 && page.recent.every((t) => !("title" in t)));
  assert.equal(page.totals.running, 1);
  assert.ok(page.recent.every((t) => ["running", "idle", "completed", "error"].includes(t.state)));
  assert.equal(page.recent.filter((t) => t.state === "running").length, 1);
  assert.equal(page.month.limit, 180);
  assert.ok(page.month.coins > 0 && page.month.ratio > 0);
  bob.close();
  store.close();
});

test("viste di Bob: prompt in corso, attività, feed e budget del piano, sul tempo reale", () => {
  const dir = tmp();
  const now = Date.now();
  const file = path.join(dir, "bob.db");
  writeFakeBob(file, { now });
  const { store, ctx, bob } = source(file, { monthlyCoins: 180 }, { onFile: true, now: Date.now, live: true });
  const events = [];
  store.onChange((kind, item) => kind === "feed" && events.push(item));
  bob.scan();
  // the live feed: only what Bob did in the last minutes, marked as Bob's, never the backlog
  assert.ok(events.length > 0 && events.length <= 20);
  assert.ok(events.every((e) => e.source === "bob" && e.at > now - 10 * 60_000));
  assert.ok(events.some((e) => e.kind === "step" && e.provider === "bob" && e.agent === "code"));
  events.length = 0;
  bob.scan();
  assert.equal(events.length, 0, "nothing new, nothing published");

  const views = sourceQueries(store.dbPath, {}, bobSource(ctx, new BobQueries(ctx)));
  try {
    // «+ Bob» on the combined views gives the same live prompts as OpenCode's plus Bob's read apart (what the server serves)
    assert.deepEqual(views.add.liveRuns(now).runs, [...new Queries(store).liveRuns(now).runs, ...views.only.liveRuns(now).runs]);
    // the task in progress: one live prompt, its context against Bob's 270k window
    const live = views.only.liveRuns(now);
    assert.equal(live.runs.length, 1);
    const r = live.runs[0];
    assert.equal(r.model, "bob/auto");
    assert.equal(r.context.limit, BOB_CONTEXT);
    assert.ok(r.context.used > 0 && r.context.ratio > 0 && r.context.ratio < 1);
    assert.equal(r.title, null);
    // activity: runs, prompts and subagents of Bob; no permissions
    const a = views.only.activity(now - 30 * 86_400_000, now + 1);
    assert.ok(a.runs.count > 0 && a.prompts.count > 0 && a.subagents.sessions > 0);
    assert.equal(a.permissions.asked, 0);
    // the feed's history: Bob's model calls and tasks
    const feed = views.only.feed(40);
    assert.ok(feed.length > 0 && feed.filter((f) => f.kind === "step").every((f) => f.provider === "bob"));
    // budgets: Bob's plan as the month, the day and the week its share; no per-model budget
    const b = views.only.budget(now);
    assert.equal(b.periods.month.cost.limit, 90);
    assert.equal(b.periods.day.cost.limit, bobLimits({ coinUsd: 0.5, monthlyCoins: 180 }).limits.cost);
    assert.equal(b.periods.week.cost.limit, bobLimits({ coinUsd: 0.5, monthlyCoins: 180 }).weeklyLimits.cost);
    assert.equal(b.periods.month.tokens.limit, null);
    assert.deepEqual(b.periods.day.models, []);
    assert.ok(b.periods.month.cost.used > 0);
    // without a plan, no budget at all
    assert.deepEqual(bobLimits({ coinUsd: 0.5 }).monthlyLimits, { tokens: null, cost: null, steps: null });
  } finally {
    views.close();
    bob.close();
    store.close();
  }
});

test("run di Bob calcolati alla lettura: uno per prompt dei task principali, fine prima del prompt successivo", () => {
  const dir = tmp();
  const now = Date.now();
  const file = path.join(dir, "bob.db");
  const db = openFakeBob(file);
  // two prompts: the first ends with its last tool, the second with its last call; a subagent's prompt is no run
  const id = addTask(db, {
    cwd: "/w/a",
    created: now - 3_600_000,
    status: "error",
    requests: [
      { at: now - 3_590_000, input: 10, output: 1, tools: [{ name: "read_file", ms: 5000 }] },
      { at: now - 1_800_000, prompt: now - 1_810_000, input: 10, output: 1 },
    ],
  });
  addTask(db, { parent: id, cwd: "/w/a", created: now - 3_500_000, requests: [{ at: now - 3_499_000, input: 5, output: 1 }] });
  // a task still moving: its only prompt is not a run yet
  addTask(db, { cwd: "/w/b", created: now - 120_000, requests: [{ at: now - 60_000, input: 10, output: 1 }] });
  db.close();
  const { store, ctx, bob } = source(file, {}, { onFile: true, now: Date.now });
  bob.scan();
  const rows = store.db.prepare("SELECT task_id, started, ended, last FROM bob_runs ORDER BY started").all().map((r) => ({ ...r }));
  assert.deepEqual(rows.map((r) => [r.task_id === id, r.started, r.ended, r.last]), [
    [true, now - 3_600_000, now - 3_590_000 + 5000, 0],
    [true, now - 1_810_000, now - 1_800_000, 1],
    [false, now - 120_000, now - 60_000, 1],
  ]);
  const views = sourceQueries(store.dbPath, {}, bobSource(ctx, new BobQueries(ctx)));
  try {
    const runs = views.only.db.prepare("SELECT session_id, started, ended, outcome FROM runs ORDER BY started").all().map((r) => ({ ...r }));
    assert.deepEqual(runs, [
      { session_id: id, started: now - 3_600_000, ended: now - 3_590_000 + 5000, outcome: "succeeded" },
      { session_id: id, started: now - 1_810_000, ended: now - 1_800_000, outcome: "failed" },
    ]);
  } finally {
    views.close();
    bob.close();
    store.close();
  }
});

test("fixture: stessi dati con lo stesso seme", () => {
  const a = openFakeBob(":memory:");
  const b = openFakeBob(":memory:");
  const ca = seedFakeBob(a, { now: NOW, seed: 3 });
  const cb = seedFakeBob(b, { now: NOW, seed: 3 });
  assert.equal(ca.tasks, cb.tasks);
  assert.equal(ca.messages, cb.messages);
  a.close();
  b.close();
});
