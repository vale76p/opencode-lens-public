// The days the retention prunes stay in the totals: Store.pruneSlice sums their steps and tool calls into
// daily_steps / daily_tools before deleting them, keeps what they counted in counter_offsets, and
// retention_until stops a re-read from writing them back.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Queries, labelKey } from "../src/queries.js";
import { TABLE_COLUMNS } from "../src/schema.js";
import { SOURCE_VIEWS, sourceQueries } from "../src/source-views.js";
import { Store } from "../src/store.js";
import { addSession, addStep, addTool, memoryStore, tokens } from "./helpers.js";

const COLLECTOR = { status: () => ({ state: "connected", drift: [] }) };

/**
 * A module's alternative source as src/source-views.js takes it: for each view the rows of `rows[view]` (column →
 * SQL literal, NULL for the others) in OpenCode's columns, none when it has none.
 */
function fakeSource(rows = {}) {
  const select = (view, values) => `SELECT ${TABLE_COLUMNS[view].split(", ").map((c) => `${values[c] ?? "NULL"} AS ${c}`).join(", ")}`;
  const selects = Object.fromEntries(SOURCE_VIEWS.map((v) => [v, rows[v]?.length ? rows[v].map((r) => select(v, r)).join(" UNION ALL ") : `${select(v, {})} WHERE 0`]));
  return { selects, totals: () => null };
}
const midnight = (y, m, d) => new Date(y, m, d).getTime();
const D0 = midnight(2026, 0, 10);
const D1 = midnight(2026, 0, 11);
const D2 = midnight(2026, 0, 12);
const D3 = midnight(2026, 0, 13);
const H = 3_600_000;

/** Three local days of steps and tools, two sessions, two models (one with a variant), errors. */
function seed(store) {
  addSession(store, { id: "ses_1", created: D0 });
  addSession(store, { id: "ses_2", created: D0 });
  let n = 0;
  for (const day of [D0, D1, D2]) {
    for (let i = 0; i < 5; i++) {
      const at = day + 9 * H + i * 600_000;
      const id = `st${n++}`;
      addStep(store, {
        id, session: i % 2 ? "ses_2" : "ses_1", model: i === 4 ? "other" : "claude-sonnet-5-5", variant: i === 3 ? "high" : null, agent: i === 1 ? "plan" : "build",
        started: at, ended: at + 30_000, cost: 0.001 * (i + 1), tokens: tokens(100 * (i + 1), 10, 2, 50, 5), finish: i === 2 ? "error" : "stop",
        requested: at, firstOutput: at + 1000, streamed: at + 20_000,
      });
      addTool(store, { id: `c${id}`, session: i % 2 ? "ses_2" : "ses_1", message: id, name: i % 2 ? "bash" : "read", status: i === 0 ? "error" : "completed", created: at + 2000, ended: at + 5000 });
    }
  }
}

/** Σ of every session's steps, as OpenCode's session totals would be. */
const sessionTotals = (store, id) =>
  store.db.prepare(`SELECT COALESCE(SUM(cost),0) cost, COALESCE(SUM(t_in),0) t_in, COALESCE(SUM(t_out),0) t_out, COALESCE(SUM(t_reason),0) t_reason,
    COALESCE(SUM(t_cread),0) t_cread, COALESCE(SUM(t_cwrite),0) t_cwrite FROM steps WHERE session_id = ?`).get(id);

/** The counter and summary series of families(). */
function flat(fams) {
  const out = new Map();
  for (const f of fams) {
    if (f.type === "gauge") continue;
    for (const s of f.samples) {
      const k = labelKey(s.labels);
      if (f.type === "summary") {
        out.set(`${f.name}_sum${k}`, s.sum);
        out.set(`${f.name}_count${k}`, s.count);
      } else out.set(`${f.name}${k}`, s.value);
    }
  }
  return out;
}

const pick = (s) => ({ steps: s.steps, failedSteps: s.failedSteps, cost: s.cost, stepCost: s.stepCost, tokens: s.tokens, cacheRate: s.cacheRate, sessions: s.sessions, models: s.models, tools: s.tools });
const prune = (store, q, from, to) => store.pruneSlice({ from, to }, (scope) => q.counterSnapshot(scope), () => q.counterMargins());

/** A step row as the backfill writes it (Store.stepFromMessage). */
const stepRow = (id, at) => ({
  id, session_id: "ses_1", agent: "build", provider: "anthropic", model: "m", variant: null, started: at, ended: at + 1000, finish: "stop", error_type: null, error_msg: null,
  cost: 0.5, t_in: 1, t_out: 1, t_reason: 0, t_cread: 0, t_cwrite: 0, requested: null, first_output: null, streamed: null,
});

test("pruneSlice: il riepilogo somma esattamente ciò che cancella, retention_until avanza, /metrics non cala", () => {
  const store = memoryStore();
  const q = new Queries(store);
  seed(store);
  const steps = store.db
    .prepare(`SELECT session_id, COALESCE(provider,'?') provider, COALESCE(model,'?') model, COALESCE(variant,'default') variant, COALESCE(agent,'?') agent,
      COUNT(*) steps, SUM(finish = 'error') failed, SUM(cost) cost, SUM(t_in) t_in, SUM(t_out) t_out, SUM(t_reason) t_reason, SUM(t_cread) t_cread, SUM(t_cwrite) t_cwrite
      FROM steps WHERE ended >= ? AND ended < ? GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5`)
    .all(D0, D1)
    .map((r) => ({ day: D0, ...r }));
  const tools = store.db.prepare(`SELECT session_id, name, COUNT(*) calls, SUM(status = 'error') errors FROM tools WHERE ended >= ? AND ended < ? GROUP BY 1, 2 ORDER BY 1, 2`).all(D0, D1).map((r) => ({ day: D0, ...r }));
  const before = flat(q.families(COLLECTOR, D3));

  assert.deepEqual(prune(store, q, D0, D1), { steps: 5, tools: 5 });
  const cols = "day, session_id, provider, model, variant, agent, steps, failed, cost, t_in, t_out, t_reason, t_cread, t_cwrite";
  assert.deepEqual(store.db.prepare(`SELECT ${cols} FROM daily_steps ORDER BY 2, 3, 4, 5, 6`).all().map((r) => ({ ...r })), steps.map((r) => ({ ...r })));
  assert.deepEqual(store.db.prepare(`SELECT day, session_id, name, calls, errors FROM daily_tools ORDER BY 2, 3`).all().map((r) => ({ ...r })), tools.map((r) => ({ ...r })));
  assert.equal(store.meta("retention_until"), String(D1));
  assert.equal(store.retainedUntil(), D1);
  assert.equal(store.oldestRow(), D1 + 9 * H + 2000 + 3000, "the oldest tool call left (ended)");
  const after = flat(q.families(COLLECTOR, D3));
  for (const [key, value] of before) assert.ok(after.has(key) && after.get(key) >= value - 1e-9, `${key}: ${value} → ${after.get(key)}`);
  store.close();
});

test("pruneSlice: «Tutto» invariato, e range(0) copre ancora i giorni potati", () => {
  const store = memoryStore();
  const q = new Queries(store);
  seed(store);
  const all = q.range(0);
  const before = pick(q.summary(all.from, all.to, D3));
  prune(store, q, D0, D1);
  prune(store, q, D1, D2);
  const range = q.range(0);
  // «Tutto» starts where it did: the earliest start of the pruned rows is kept (meta retention_from)
  assert.equal(range.from, all.from);
  const after = pick(q.summary(range.from, range.to, D3));
  assert.deepEqual(after, before);
  assert.equal(after.steps, 15);
  assert.equal(after.sessions, 2);
  assert.equal(after.models, 3);
  // a period of the pruned day alone
  assert.equal(q.summary(D0, D1, D3).steps, 5);
  assert.equal(q.summary(D0, D1, D3).tools.calls, 5);
  store.close();
});

test("dopo il pruning Store.tool e stepFromMessage non riscrivono le righe più vecchie", () => {
  const store = memoryStore();
  const q = new Queries(store);
  seed(store);
  assert.equal(store.stepFromMessage(stepRow("early", D0 + H)), true, "nothing pruned yet: written");
  store.db.prepare("DELETE FROM steps WHERE id = 'early'").run();
  prune(store, q, D0, D1);
  assert.equal(store.stepFromMessage(stepRow("st0", D0 + 9 * H)), false);
  assert.equal(store.stepFromMessage(stepRow("late", D1 + H)), true);
  store.tool({ id: "cst0", session_id: "ses_1", message_id: "st0", call_id: "cst0", name: "read", status: "completed", created: D0 + 9 * H, ended: D0 + 9 * H + 10 });
  store.tool({ id: "cnew", session_id: "ses_1", message_id: "late", call_id: "cnew", name: "read", status: "completed", created: D1 + H, ended: D1 + H + 10 });
  assert.deepEqual(store.db.prepare("SELECT id FROM steps WHERE id IN ('st0', 'late') ORDER BY id").all().map((r) => r.id), ["late"]);
  assert.deepEqual(store.db.prepare("SELECT id FROM tools WHERE id IN ('cst0', 'cnew') ORDER BY id").all().map((r) => r.id), ["cnew"]);
  // a Store opened again keeps the guard
  store.close();
});

test("retention_until resta alla riapertura", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-rollup-"));
  try {
    const file = path.join(dir, "lens.db");
    const store = new Store(file);
    seed(store);
    prune(store, new Queries(store), D0, D1);
    store.close();
    const again = new Store(file);
    assert.equal(again.retainedUntil(), D1);
    assert.equal(again.stepFromMessage(stepRow("st0", D0 + 9 * H)), false);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reconcileInternal dopo il pruning non crea stime", () => {
  const store = memoryStore();
  const q = new Queries(store);
  seed(store);
  const totals = { ses_1: sessionTotals(store, "ses_1"), ses_2: sessionTotals(store, "ses_2") };
  prune(store, q, D0, D1);
  for (const id of ["ses_1", "ses_2"]) assert.equal(store.reconcileInternal(id, D3, totals[id]), null, id);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM internal_usage").get().n, 0);
  store.close();
});

test("pruneSlice: un intervallo non valido è un RangeError", () => {
  const store = memoryStore();
  const q = new Queries(store);
  for (const [from, to] of [[D1, D0], [D0, D0], [0.5, D1], [D0, Number.NaN]]) assert.throws(() => prune(store, q, from, to), RangeError);
  store.close();
});

test("«Solo …» di una sorgente non conta i giorni potati di OpenCode, «+ …» sì", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-rollup-"));
  try {
    const file = path.join(dir, "lens.db");
    const store = new Store(file);
    seed(store);
    prune(store, new Queries(store), D0, D1);
    const views = sourceQueries(file, {}, fakeSource());
    try {
      const only = views.only.summary(D0, D3, D3);
      assert.equal(only.steps, 0);
      assert.equal(only.tools.calls, 0);
      assert.equal(views.add.summary(D0, D3, D3).steps, 15);
    } finally {
      views.close();
      store.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("«Solo …»: dopo una retention di OpenCode «Tutto» parte dai dati della sorgente come prima", async () => {
  const { Retention } = await import("../src/retention.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-rollup-"));
  try {
    const file = path.join(dir, "lens.db");
    const store = new Store(file);
    const now = Date.now();
    // OpenCode: steps 600 and 2 days ago; the source: one task with two model calls 100 days ago
    addSession(store, { id: "ses_1", created: now - 600 * 86_400_000 });
    addStep(store, { id: "old", started: now - 600 * 86_400_000, ended: now - 600 * 86_400_000 + 1000, cost: 1, tokens: tokens(10), finish: "stop" });
    addStep(store, { id: "new", started: now - 2 * 86_400_000, ended: now - 2 * 86_400_000 + 1000, cost: 1, tokens: tokens(10), finish: "stop" });
    const bobAt = now - 100 * 86_400_000;
    const call = (id, at) => ({ id: `'${id}'`, session_id: "'t1'", provider: "'x'", model: "'auto'", started: at, ended: at, cost: 0.5, t_in: 10, t_out: 1, t_reason: 0, t_cread: 0, t_cwrite: 0, finish: "'stop'" });
    const src = fakeSource({
      sessions: [{ id: "'t1'", directory: "'/w'", cost: 1, t_in: 20, t_out: 2, created: bobAt, updated: bobAt + 60_000 }],
      steps: [call("t1:1", bobAt + 1000), call("t1:2", bobAt + 30_000)],
    });
    const tutto = () => {
      const views = sourceQueries(file, {}, src);
      try {
        const r = views.only.range(0, now + 60_000);
        return { range: r, summary: pick(views.only.summary(r.from, r.to, now)), timeseries: views.only.timeseries(r.from, r.to) };
      } finally {
        views.close();
      }
    };
    const before = tutto();
    assert.equal(before.range.from, bobAt + 1000 - 60_000, "the source's first call");
    assert.equal(before.summary.steps, 2);
    assert.equal((await new Retention({ store, queries: new Queries(store), days: 400, now: () => now }).run()).steps, 1);
    assert.ok(store.meta("retention_from"));
    assert.deepEqual(tutto(), before);
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
