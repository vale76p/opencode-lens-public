// Every range read of Queries searches the index of the time it filters on. The keys come
// from the database itself (the indexes on a COALESCE(...) in sqlite_master), not from the code that
// writes the queries: an expression rewritten differently from its index is caught by the real plan.
// Each method runs on a fresh Queries whose connection records every SQL it prepares; for every range
// predicate on a key the plan must SEARCH that index and never SCAN the table. A method must also show
// at least as many such (query, key) pairs as it has today, so one that drifts away from its key is noticed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Queries } from "../src/queries.js";
import { check, rangeKeys, recorded } from "./query-plan-check.js";
import { addPrompt, addRun, addSession, addStep, addTool, memoryStore, tokens } from "./helpers.js";

const NOW = 1_800_000_000_000;
const H = 3_600_000;
const F = NOW - 24 * H;
const T = NOW + 60_000;
const COLLECTOR = { status: () => ({ state: "connected", drift: [], scan: {}, server: {} }), drift: [] };
const LIMITS = { tokens: 1000, cost: 1, steps: 10 };


function fixture() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", created: NOW - 5 * H, title: "x" });
  addSession(store, { id: "ses_2", parent: "ses_1", created: NOW - 4 * H });
  const s1 = NOW - 3 * H;
  addStep(store, { id: "s1", started: s1, ended: s1 + 5000, tokens: tokens(10, 5), requested: s1, firstOutput: s1 + 1000, streamed: s1 + 4000 });
  addStep(store, { id: "s2", session: "ses_2", started: s1 + 10_000, ended: s1 + 12_000, finish: "error", errorType: "APIError" });
  addStep(store, { id: "s3", started: NOW - 1000 });
  addTool(store, { id: "t1", message: "s1", name: "bash", status: "error", created: s1 + 2000, ended: s1 + 3000, errorMsg: "boom", child_session: "ses_2" });
  addTool(store, { id: "t2", message: "s3", name: "read", status: "running", created: NOW - 500 });
  addRun(store, { id: "r1", started: s1 - 1000, ended: s1 + 6000 });
  addPrompt(store, { id: "p1", created: s1 - 1000 });
  store.st.permissionAsked.run({ id: "perm1", session_id: "ses_1", action: "bash", resources: 1, at: NOW - 2000 });
  return store;
}

// method → [least (SQL, key) pairs with a range predicate today, call]
const METHODS = {
  summary: [4, (q) => q.summary(F, T, NOW)],
  timeseries: [1, (q) => q.timeseries(F, T)],
  modelTimeseries: [1, (q) => q.timeseries(F, T, { model: "anthropic/claude-sonnet-5-5" })],
  breakdown: [3, (q) => q.breakdown(F, T, "directory")],
  tools: [3, (q) => q.tools(F, T, NOW)],
  sessionCount: [1, (q) => q.sessionCount(F, T)],
  // and the keyset page after a session (cursor): one query more, the subagent roll-up is the same text
  sessions: [3, (q) => (q.sessions(F, T), q.sessions(F, T, 50, 0, { last: NOW, id: "ses_1" }))],
  activity: [5, (q) => q.activity(F, T)],
  // and the keyset page after a run (cursor): its own query is on runs_ended, not a COALESCE key
  runs: [2, (q) => (q.runs(F, T, { steps: true }), q.runs(F, T, { after: { ended: NOW, id: "r1" } }))],
  runCount: [2, (q) => q.runCount(F, T, { problems: true })],
  runSummary: [2, (q) => q.runSummary(F, T)],
  liveRuns: [3, (q) => q.liveRuns(NOW)],
  hourTotals: [1, (q) => q.hourTotals(F, T)],
  hourly: [2, (q) => q.hourly(7, NOW)],
  rhythm: [1, (q) => q.rhythm(28, NOW)],
  daily: [5, (q) => q.daily(7, NOW)],
  usage: [1, (q) => q.usage(F, T)],
  period: [1, (q) => q.period("week", LIMITS, NOW)],
  modelTokens: [1, (q) => q.modelTokens(F, T)],
  today: [1, (q) => q.today(NOW)],
  budget: [2, (q) => q.budget(NOW)],
  calendar: [1, (q) => q.calendar("tokens", NOW)],
  errors: [2, (q) => q.errors(F, T)],
  families: [1, (q) => q.families(COLLECTOR, NOW)],
  metrics: [1, (q) => q.metrics(COLLECTOR, NOW)],
  // the whole tables, then the scope a deletion takes: steps_total & co. and ttft on steps_ts, tools and commits on tools_ts
  counterSnapshot: [4, (q) => (q.counterSnapshot(), q.counterSnapshot({ from: F, to: T }))],
};
// not checked here, with the reason
const EXCLUDED = {
  constructor: "nessuna query",
  dayRange: "nessuna query",
  range: "MIN/MAX su tutta la tabella, nessun intervallo",
  slots: "colori dei modelli su tutta la storia, nessun intervallo",
  session: "per sessione",
  contextLimit: "nessuna query",
  modelBudgets: "nessuna query propria",
  feed: "ultimi eventi, non un intervallo (fuori scope della Fase 1)",
  signals: "signals_created, nessun COALESCE",
  counterMargins: "somme su tutta la tabella, nessun intervallo",
  counterMarginsAsync: "come counterMargins, a blocchi di righe",
};

test("piani: le chiavi di intervallo sono gli indici su COALESCE del database", () => {
  const store = memoryStore();
  assert.deepEqual(
    rangeKeys(store.db).map((k) => k.index),
    ["permissions_asked", "steps_ts", "tools_ts"],
  );
  store.close();
});

// IBM Bob's reads (modules/bob/server/queries.js) are checked the same way by the module's own test
test("piani: ogni metodo di Queries è controllato o escluso con un motivo", () => {
  assert.deepEqual(Object.getOwnPropertyNames(Queries.prototype).sort(), [...Object.keys(METHODS), ...Object.keys(EXCLUDED)].sort());
});

for (const [name, [least, call]] of Object.entries(METHODS)) {
  test(`piani: ${name} cerca gli indici delle sue chiavi di intervallo`, () => {
    const store = fixture();
    const keys = rangeKeys(store.db);
    const sqls = recorded(store.db, (db) => call(new Queries({ db })));
    let found = 0;
    const problems = [];
    for (const sql of sqls) {
      const r = check(store.db, sql, keys);
      found += r.found;
      for (const p of r.problems) problems.push(`${p}\n${sql}\n${r.plan.join("\n")}`);
    }
    assert.deepEqual(problems, []);
    assert.ok(found >= least, `${name}: ${found} query con un intervallo su una chiave, almeno ${least}`);
    store.close();
  });
}

test("piani: senza l'indice il controllo se ne accorge", () => {
  const store = fixture();
  const keys = rangeKeys(store.db);
  const step = keys.find((k) => k.index === "steps_ts");
  const expr = `COALESCE(${step.cols.join(", ")})`;
  const sql = `SELECT COUNT(*) FROM steps WHERE ${expr} >= ? AND ${expr} < ?`;
  assert.deepEqual(check(store.db, sql, keys).problems, []);
  store.db.exec("DROP INDEX steps_ts");
  const r = check(store.db, sql, keys);
  assert.equal(r.found, 1);
  assert.deepEqual(r.problems, ["steps_ts non cercato", "SCAN steps (steps)"]);
  store.close();
});
