// IBM Bob as a module, against the answers of the core's Bob it replaced: bob-reads.expected.json and
// bob-views.expected.json were recorded from the core (plan D, Task 6a) on the fake bob.db below. On it, each on a
// lens database of its own: the rows of bob_* after one and two reads, status() (but `problem`, the module's own),
// the /metrics families, the page and the totals; then OpenCode's queries over the module's SELECTs, Bob alone and
// with OpenCode. Fixed time zone, not UTC: a slip moves a call to another day and the recording sees it. Every row
// is older than RUNNING_MS on the real clock, so the runs view (strftime('now')) answers the same on any day. The
// recordings change only on purpose: they are what the lens answered for Bob before it became a module.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addSession, addStep, fileStore, moduleContext, Queries, sourceQueries } from "../../../test/module-test-kit.js";
import tables from "../tables.js";
import { BobQueries } from "../server/queries.js";
import { configure } from "../server/settings.js";
import { BobSource } from "../server/source.js";
import { bobSource } from "../server/views.js";
import { addTask, openFakeBob, resetFakeIds, writeFakeBob } from "./fake-bob.js";

const NOW = new Date(2026, 9, 23, 15, 0, 0).getTime();
const DAY = 86_400_000;
const VARS = ["LENS_BOB_DB", "LENS_BOB_INTERVAL", "LENS_BOB_COIN_USD", "LENS_BOB_COINS_MONTHLY"];
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const BOB_TABLES = ["bob_tasks", "bob_requests", "bob_tools", "bob_prompts", "bob_runs"];
/** The recording `name` (bob-<name>.expected.json: JSON, one line per row or period). */
const recording = (name) => JSON.parse(fs.readFileSync(new URL(`./bob-${name}.expected.json`, import.meta.url), "utf8"));
// what a recording keeps of an answer: its JSON
const plain = (x) => JSON.parse(JSON.stringify(x));

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-bob-mod-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The module's ctx on a lens database on file with the module's tables, configured from `env` as the registry does. */
function moduleSide(t, env) {
  const store = fileStore({ moduleTables: [{ id: "bob", ...tables }] });
  t.after(() => store.close());
  const queries = new Queries(store);
  const base = { id: "bob", config: { dbPath: store.dbPath, scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries, log: QUIET, env, vars: VARS, tables };
  const { values, errors } = configure(moduleContext(base));
  assert.deepEqual(errors, []);
  return { store, queries, ctx: moduleContext({ ...base, settings: values }), settings: values };
}

const rows = (store) => Object.fromEntries(BOB_TABLES.map((table) => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((r) => ({ ...r }))]));

test("letture come registrate: righe di bob_* dopo una e due letture, stato, famiglie, pagina e totali", (t) => {
  resetFakeIds();
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  const counts = writeFakeBob(file, { now: NOW, days: 4 });
  const mod = moduleSide(t, { LENS_BOB_DB: file, HOME: "/h", LENS_BOB_COINS_MONTHLY: "180", LENS_BOB_COIN_USD: "0.55" });
  const bob = new BobSource(mod.ctx, { now: () => NOW });
  t.after(() => bob.close());
  const queries = new BobQueries(mod.ctx);
  const out = { first: bob.scan(), afterFirst: rows(mod.store) };
  assert.equal(out.first.tasks, counts.tasks + counts.subagents);
  // Bob goes on: one more turn of the last task (tools included), a task completed, a new task with a subagent
  const db = openFakeBob(file);
  const last = db.prepare("SELECT id FROM tasks WHERE parent_id IS NULL ORDER BY created_at DESC LIMIT 1").get().id;
  db.prepare("INSERT INTO messages (id, task_id, role, data, created_at) VALUES ('m-late', ?, 'assistant', ?, ?)").run(
    last,
    JSON.stringify({ role: "assistant", _meta: { spend: { input: 900, output: 40, cacheRead: 500, cacheWrite: 100, cost: 0.2 } }, toolCalls: [{ id: "toolu_late", name: "grep" }] }),
    NOW - 60_000,
  );
  db.prepare("INSERT INTO messages (id, task_id, role, data, created_at) VALUES ('m-late-tool', ?, 'tool', ?, ?)").run(last, JSON.stringify({ role: "tool", toolUsage: { signature: { id: "toolu_late", name: "grep", isError: true } }, _meta: { durationMs: 700 } }), NOW - 59_000);
  db.prepare("UPDATE tasks SET updated_at = ?, status = 'completed' WHERE id = ?").run(NOW - 59_000, last);
  const fresh = addTask(db, { cwd: "/w/nuovo", created: NOW - 30_000, requests: [{ at: NOW - 20_000, input: 100, output: 10, cost: 0.05, tools: [{ name: "read_file" }] }] });
  addTask(db, { parent: fresh, cwd: "/w/nuovo", created: NOW - 15_000, requests: [{ at: NOW - 10_000, input: 50, output: 5, cost: 0.02 }] });
  db.close();
  Object.assign(out, { second: bob.scan(), afterSecond: rows(mod.store), third: bob.scan() });

  // status: the core's fields, plus the module's problem (none while connected); bob.db sits in a temporary folder
  const { problem, ...status } = bob.status();
  assert.equal(problem, null);
  assert.equal(status.db, file);
  out.status = { ...status, db: "<bob.db>" };
  out.families = bob.families();
  out.periods = [
    [0, NOW + 1],
    [NOW - 2 * DAY, NOW + 1],
    [NOW - DAY, NOW - DAY / 2],
    [NOW + DAY, NOW + 2 * DAY],
  ].map(([from, to]) => ({ from, to, totals: queries.totals(from, to), page: queries.page(from, to, NOW) }));
  const expected = recording("reads");
  assert.deepEqual(plain(out), expected);
  // the recording is not empty: every table has rows, a pass reads something and the third nothing
  for (const table of BOB_TABLES) assert.ok(expected.afterSecond[table].length > 0, table);
  assert.equal(expected.second.tasks, 3);
  assert.deepEqual(expected.third, { tasks: 0 });
  assert.ok(expected.periods[1].page.totals.coins > 0);
});

test("viste come registrate: le query di OpenCode sulle select del modulo, «Solo» e «+»", (t) => {
  resetFakeIds();
  const dir = tmp(t);
  const file = path.join(dir, "bob.db");
  writeFakeBob(file, { now: NOW, days: 4 });
  const mod = moduleSide(t, { LENS_BOB_DB: file, HOME: "/h", LENS_BOB_COINS_MONTHLY: "180" });
  const bob = new BobSource(mod.ctx, { now: () => NOW });
  t.after(() => bob.close());
  bob.scan();
  // OpenCode's own rows, for «+ Bob»
  addSession(mod.store, { id: "ses_1", directory: "/Users/dev/gestionale", created: NOW - 3_600_000 });
  addStep(mod.store, { id: "msg_1", started: NOW - 3_000_000, ended: NOW - 2_990_000, cost: 0.02 });

  const options = {};
  const src = bobSource(mod.ctx, new BobQueries(mod.ctx));
  const viaModule = sourceQueries(mod.store.dbPath, options, src);
  t.after(() => viaModule.close());
  const answers = (views, totals) => ({
    ...Object.fromEntries(
      ["only", "add"].map((mode) => {
        const q = views[mode];
        const windows = [
          [NOW - 30 * DAY, NOW + 1],
          [NOW - DAY, NOW + 1],
        ].map(([from, to]) => ({ from, to, summary: q.summary(from, to, NOW), runs: q.runs(from, to, { limit: 200 }), sessions: q.sessions(from, to, 200) }));
        return [mode, { windows, daily: q.daily(7, NOW), budget: q.budget(NOW), range: q.range(0, NOW + 1) }];
      }),
    ),
    // the totals the selector adds to /api/summary
    totals: totals(NOW - 30 * DAY, NOW + 1),
  });
  const expected = recording("views");
  assert.deepEqual(plain(answers(viaModule, src.totals)), expected);
  assert.ok(expected.only.windows[0].summary.steps > 0);
  assert.ok(expected.only.windows[0].runs.length > 0);
  assert.equal(expected.only.budget.periods.month.cost.limit, 90);

  // a run still moving, on the real clock as the views judge it: the last prompt of an active task touched less than
  // RUNNING_MS ago is not a run yet; once the task completes it is
  const db = openFakeBob(file);
  const moving = addTask(db, { cwd: "/w/vivo", created: Date.now() - 120_000, requests: [{ at: Date.now() - 60_000, input: 10, output: 1, cost: 0.01 }] });
  db.close();
  bob.scan();
  const runsNow = () => viaModule.only.runs(Date.now() - 3_600_000, Date.now() + 1, { limit: 200 }).filter((r) => r.sessionID === moving);
  assert.deepEqual(runsNow(), []);
  const done = openFakeBob(file);
  done.prepare("UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(Date.now() - 30_000, moving);
  done.close();
  bob.scan();
  assert.equal(runsNow().length, 1);
});
