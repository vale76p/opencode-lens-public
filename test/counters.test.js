// The counters of /metrics never go down when the lens deletes rows: Store.deleteCompensated takes a
// Queries.counterSnapshot before and after the DELETE and keeps the difference in counter_offsets,
// which families() adds back (F-17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Queries, labelKey } from "../src/queries.js";
import { addSession, addStep, addTool, memoryStore, tokens } from "./helpers.js";

const COLLECTOR = { status: () => ({ state: "connected", drift: [] }) };
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);
const NOW = T0 + 10 * DAY;

/** Steps and tools over three days, two models, an error, a commit, a step still open. */
function fixture() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", created: T0 });
  addSession(store, { id: "ses_2", created: T0 });
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < 4; i++) {
      const at = T0 + d * DAY + i * 60_000;
      const id = `st${d}${i}`;
      addStep(store, {
        id, session: i % 2 ? "ses_2" : "ses_1", model: i === 3 ? "other" : "claude-sonnet-5-5", started: at, ended: at + 5000, cost: 0.01 * (i + 1),
        tokens: tokens(100 + i, 10 + d, 1, 2, 3), requested: at, firstOutput: at + 500, streamed: at + 4000, finish: i === 2 ? "error" : "stop",
      });
      addTool(store, { id: `c${d}${i}`, session: i % 2 ? "ses_2" : "ses_1", message: id, name: i % 2 ? "bash" : "read", status: i === 1 ? "error" : "completed", created: at + 1000, ended: at + 2000, out_bytes: 10, is_commit: i === 3 ? 1 : 0 });
    }
  }
  addStep(store, { id: "open", started: T0 + 2 * DAY + 600_000 });
  return { store, q: new Queries(store) };
}

/** The counter and summary samples of families(), by the keys of counterSnapshot. */
function flat(fams) {
  const out = new Map();
  for (const f of fams) {
    if (f.type === "gauge") continue;
    for (const s of f.samples) {
      const labels = labelKey(s.labels);
      if (f.type === "summary") {
        out.set(JSON.stringify([`${f.name}_sum`, labels]), s.sum);
        out.set(JSON.stringify([`${f.name}_count`, labels]), s.count);
      } else out.set(JSON.stringify([f.name, labels]), s.value);
    }
  }
  return out;
}

const close = (a, b) => Math.abs(a - b) < 1e-9;
const day = (d) => ({ from: T0 + d * DAY - 12 * 3_600_000, to: T0 + (d + 1) * DAY - 12 * 3_600_000 });

function assertMonotonic(before, after) {
  for (const [key, value] of before) assert.ok(after.has(key) && after.get(key) >= value - 1e-9, `${key}: ${value} → ${after.get(key)}`);
}

test("labelKey: lo stesso insieme di etichette in qualsiasi ordine", () => {
  assert.equal(labelKey({ b: "1", a: "2" }), labelKey({ a: "2", b: "1" }));
  assert.equal(labelKey({ b: "1", a: "2" }), '[["a","2"],["b","1"]]');
  assert.equal(labelKey({}), "[]");
});

test("counterSnapshot senza offset: i campioni counter e summary di families()", () => {
  const { store, q } = fixture();
  const fams = flat(q.families(COLLECTOR, NOW));
  // the collector's own counter is not made of rows
  fams.delete(JSON.stringify(["opencode_lens_duplicate_events_total", "[]"]));
  assert.deepEqual([...q.counterSnapshot()].sort(), [...fams].sort());
  store.close();
});

test("counterSnapshot con scope [a, b): quanto la DELETE di quei giorni toglie, per chiave", () => {
  const { store, q } = fixture();
  const scope = day(1);
  const scoped = q.counterSnapshot(scope);
  const before = q.counterSnapshot();
  store.db.prepare(`DELETE FROM steps WHERE COALESCE(ended, last_started, started) >= ? AND COALESCE(ended, last_started, started) < ?`).run(scope.from, scope.to);
  store.db.prepare(`DELETE FROM tools WHERE COALESCE(ended, ran, created) >= ? AND COALESCE(ended, ran, created) < ?`).run(scope.from, scope.to);
  const after = q.counterSnapshot();
  assert.ok(scoped.size > 10, `${scoped.size} series in scope`);
  for (const [key, value] of before) {
    const lost = value - (after.get(key) ?? 0);
    assert.ok(close(lost, scoped.get(key) ?? 0), `${key}: lost ${lost}, scope ${scoped.get(key)}`);
  }
  for (const key of scoped.keys()) assert.ok(before.has(key), key);
  store.close();
});

test("deleteCompensated: dopo la cancellazione di step e tool nessuna serie cala né sparisce", () => {
  const { store, q } = fixture();
  const before = flat(q.families(COLLECTOR, NOW));
  const scope = day(0);
  const out = store.deleteCompensated(
    () => q.counterSnapshot(scope),
    (d) => ({ steps: Number(d.stepsBetween.run(scope.from, scope.to).changes), tools: Number(d.toolsBetween.run(scope.from, scope.to).changes) }),
    () => q.counterMargins(),
  );
  assert.deepEqual(out, { steps: 4, tools: 4 });
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM steps").get().n, 9);
  assert.ok(store.db.prepare("SELECT COUNT(*) n FROM counter_offsets").get().n > 0);
  const after = flat(q.families(COLLECTOR, NOW));
  assertMonotonic(before, after);
  // nothing else moved: the same values exactly
  for (const [key, value] of before) assert.ok(close(after.get(key), value), `${key}: ${value} → ${after.get(key)}`);
  store.close();
});

test("deleteCompensated: le serie sparite restano e le righe nuove si sommano agli offset", () => {
  const { store, q } = fixture();
  // the whole history of the "other" model and of bash goes; without scope the snapshot reads everything
  const before = flat(q.families(COLLECTOR, NOW));
  const otherKey = JSON.stringify(["opencode_lens_steps_total", labelKey({ provider: "anthropic", model: "other", agent: "build", finish: "stop" })]);
  assert.equal(before.get(otherKey), 3);
  store.deleteCompensated(
    () => q.counterSnapshot(),
    (d) => {
      d.stepsBetween.run(0, NOW);
      d.toolsBetween.run(0, NOW);
    },
    () => q.counterMargins(),
  );
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM steps").get().n, 0);
  const after = flat(q.families(COLLECTOR, NOW));
  assertMonotonic(before, after);
  assert.equal(after.get(otherKey), 3, "the series stays with its offset");
  addStep(store, { id: "new", model: "other", started: NOW - 1000, ended: NOW, finish: "stop", cost: 0.5, tokens: tokens(7) });
  const more = flat(q.families(COLLECTOR, NOW + 1));
  assert.equal(more.get(otherKey), 4, "a new row adds to the offset");
  assert.ok(close(more.get(JSON.stringify(["opencode_lens_cost_usd_total", labelKey({ provider: "anthropic", model: "other", agent: "build" })])), before.get(JSON.stringify(["opencode_lens_cost_usd_total", labelKey({ provider: "anthropic", model: "other", agent: "build" })])) + 0.5));
  store.close();
});

test("deleteCompensated: se remove lancia, ROLLBACK, nessun offset, righe intatte", () => {
  const { store, q } = fixture();
  assert.throws(
    () =>
      store.deleteCompensated(
        () => q.counterSnapshot(),
        (d) => {
          d.stepsBetween.run(0, NOW);
          throw new Error("a metà");
        },
        () => q.counterMargins(),
      ),
    /a metà/,
  );
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM steps").get().n, 13);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM counter_offsets").get().n, 0);
  store.close();
});

test("recordInternal cancella solo stime già assorbite: nessuna serie scende (D10b)", () => {
  const T = Date.UTC(2026, 9, 15, 8, 0, 0);
  const totals = (t_in) => ({ cost: 0, t_in, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 });
  const exact = (id, created, t_in) => ({ id, session_id: "ses_1", created, kind: "compaction", cost: 0, t_in, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 });
  // test/v4.test.js: a compaction read after its estimate absorbs it whole
  {
    const store = memoryStore();
    const q = new Queries(store);
    addStep(store, { id: "msg_1", started: T, ended: T + 500, tokens: tokens(100) });
    store.reconcileInternal("ses_1", T + 5000, totals(400));
    const before = q.counterSnapshot();
    store.tx(() => store.recordInternal(exact("msg_cmp", T + 1000, 300)));
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM internal_usage WHERE kind IS NULL").get().n, 0, "the estimate was deleted");
    assertMonotonic(before, q.counterSnapshot());
    store.close();
  }
  // partial cover, never below zero
  {
    const store = memoryStore();
    const q = new Queries(store);
    store.reconcileInternal("ses_1", T + 3000, totals(50));
    store.reconcileInternal("ses_1", T + 4000, totals(90));
    const before = q.counterSnapshot();
    store.tx(() => store.recordInternal(exact("msg_cmp", T + 2000, 70)));
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM internal_usage WHERE kind IS NULL").get().n, 1);
    assertMonotonic(before, q.counterSnapshot());
    store.close();
  }
});

test("deleteCompensated: una serie che vale 0 non sparisce quando se ne cancellano le righe", () => {
  const store = memoryStore();
  const q = new Queries(store);
  // no reasoning nor cache tokens, a tool with no output size: series at 0
  addStep(store, { id: "old", model: "oldmodel", started: T0, ended: T0 + 5000, cost: 1, tokens: tokens(100, 10), finish: "stop", requested: T0, firstOutput: T0 + 500, streamed: T0 + 4000 });
  addTool(store, { id: "t_old", message: "old", name: "grep", status: "completed", created: T0 + 1000, ended: T0 + 2000 });
  addStep(store, { id: "new", model: "newmodel", started: T0 + 5 * DAY, ended: T0 + 5 * DAY + 5000, cost: 2, tokens: tokens(200, 20), finish: "stop" });
  const before = flat(q.families(COLLECTOR, NOW));
  const zeros = [...before].filter(([, v]) => v === 0).map(([k]) => k);
  for (const name of ["opencode_lens_tokens_total", "opencode_lens_tool_output_bytes_total"]) assert.ok(zeros.some((k) => k.includes(name)), `${name} at 0 in the fixture`);
  const scope = day(0);
  store.deleteCompensated(
    () => q.counterSnapshot(scope),
    (d) => {
      d.stepsBetween.run(scope.from, scope.to);
      d.toolsBetween.run(scope.from, scope.to);
    },
    () => q.counterMargins(),
  );
  const after = flat(q.families(COLLECTOR, NOW));
  assertMonotonic(before, after);
  for (const k of zeros) assert.equal(after.get(k), 0, k);
  store.close();
});

test("families(): fondere gli offset costa O(offset + campioni), non O(offset × campioni)", () => {
  const store = memoryStore();
  const q = new Queries(store);
  let n = 0;
  // 30 models × 4 agents and 60 tools × 2 status, on a day the retention prunes and on a day it keeps
  for (const at0 of [T0, T0 + 5 * DAY]) {
    for (let m = 0; m < 30; m++) {
      for (let a = 0; a < 4; a++) {
        const at = at0 + n++ * 10;
        addStep(store, { id: `st${n}`, model: `model${m}`, agent: `agent${a}`, started: at, ended: at + 5, cost: 0.01, tokens: tokens(10, 2, 0, 1, 1), finish: "stop", requested: at, firstOutput: at + 1, streamed: at + 4 });
      }
    }
    for (let t = 0; t < 60; t++) {
      for (const status of ["completed", "error"]) {
        const at = at0 + n++ * 10;
        addTool(store, { id: `tl${n}`, message: "st1", name: `tool${t}`, status, created: at, ended: at + 3, out_bytes: 5 });
      }
    }
  }
  store.pruneSlice(day(0), (scope) => q.counterSnapshot(scope), () => q.counterMargins());
  const offsets = store.db.prepare("SELECT COUNT(*) n FROM counter_offsets").get().n;
  const before = flat(q.families(COLLECTOR, NOW));
  const samples = before.size;
  assert.ok(offsets > 1000 && samples > 1000, `${offsets} offsets, ${samples} series`);
  // labelKey goes through JSON.stringify: its calls count the label comparisons, whatever the machine's speed
  const stringify = JSON.stringify;
  let calls = 0;
  JSON.stringify = (...args) => (calls++, stringify(...args));
  try {
    q.families(COLLECTOR, NOW + 1);
  } finally {
    JSON.stringify = stringify;
  }
  assert.ok(calls <= 4 * (offsets + samples), `${calls} label keys for ${offsets} offsets and ${samples} series`);
  store.close();
});

test("deleteCompensated e pruneSlice rifiutano uno snapshot o i margini mancanti", () => {
  const { store, q } = fixture();
  const snapshot = () => q.counterSnapshot(day(0));
  const margins = () => q.counterMargins();
  const remove = (d) => d.stepsBetween.run(day(0).from, day(0).to);
  assert.throws(() => store.deleteCompensated(snapshot, remove), TypeError, "without margins");
  assert.throws(() => store.deleteCompensated(undefined, remove, margins), TypeError);
  assert.throws(() => store.deleteCompensated(snapshot, undefined, margins), TypeError);
  assert.throws(() => store.pruneSlice(day(0), (scope) => q.counterSnapshot(scope)), TypeError, "without margins");
  assert.throws(() => store.pruneSlice(day(0), undefined, margins), TypeError);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM steps").get().n, 13, "nothing deleted");
  store.close();
});
