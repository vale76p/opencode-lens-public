// LENS_RETENTION_DAYS (src/retention.js): the days older than the cutoff are pruned one transaction each,
// the counters, the totals of «Tutto» and the invariant Σ steps + Σ pruned + Σ internal = totals do not
// change, and a full re-read from OpenCode does not bring the pruned rows back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Collector } from "../src/collector.js";
import { setLogLevel } from "../src/log.js";
import { Queries, labelKey } from "../src/queries.js";
import { Retention, dayBounds, retentionCutoff } from "../src/retention.js";
import { addPrompt, addRun, addSession, addStep, addTool, memoryStore, tokens, waitFor } from "./helpers.js";
import { startFakeOpencode } from "./fake-opencode.js";

setLogLevel("error");

const COLLECTOR = { status: () => ({ state: "connected", drift: [] }) };
const DAY = 86_400_000;
const NOW = new Date(2027, 5, 15, 15, 30).getTime();
const CUTOFF = retentionCutoff(NOW, 400);

/** Steps and tools on the three days before the cutoff and on two after it. */
function fixture() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", created: CUTOFF - 10 * DAY });
  let n = 0;
  for (const k of [-3, -2, -1, 0, 5]) {
    const day = dayBounds(CUTOFF + k * DAY + 12 * 3_600_000).from;
    for (let i = 0; i < 3; i++) {
      const at = day + 10 * 3_600_000 + i * 60_000;
      const id = `st${n++}`;
      addStep(store, { id, started: at, ended: at + 20_000, cost: 0.01, tokens: tokens(100, 10, 0, 5, 1), finish: i === 1 ? "error" : "stop", requested: at, firstOutput: at + 500, streamed: at + 15_000 });
      addTool(store, { id: `c${id}`, message: id, name: "read", status: "completed", created: at + 1000, ended: at + 2000 });
    }
  }
  return { store, q: new Queries(store) };
}

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

/** How many transactions store.tx() opened. */
function countTx(store) {
  const tx = store.tx.bind(store);
  const seen = { n: 0 };
  store.tx = (fn) => {
    seen.n++;
    return tx(fn);
  };
  return seen;
}

const totals = (s) => ({ steps: s.steps, failedSteps: s.failedSteps, cost: s.cost, stepCost: s.stepCost, tokens: s.tokens, cacheRate: s.cacheRate, sessions: s.sessions, models: s.models, tools: s.tools });

test("retentionCutoff e dayBounds: mezzanotte locale, anche al cambio d'ora", () => {
  assert.equal(retentionCutoff(NOW, 400), new Date(2026, 4, 11).getTime());
  assert.equal(new Date(CUTOFF).getHours(), 0);
  const { from, to } = dayBounds(new Date(2026, 2, 29, 12).getTime());
  assert.equal(from, new Date(2026, 2, 29).getTime());
  assert.equal(to, new Date(2026, 2, 30).getTime());
  const b = dayBounds(new Date(2026, 9, 25, 23, 59).getTime());
  assert.equal(new Date(b.to).getHours(), 0);
  assert.equal(new Date(b.to).getDate(), 26);
});

test("retention: un giorno per transazione, /metrics e «Tutto» invariati, un secondo run non fa nulla", async () => {
  const { store, q } = fixture();
  const all = q.range(0);
  const before = { fams: flat(q.families(COLLECTOR, NOW)), summary: totals(q.summary(0, NOW + DAY, NOW)) };
  assert.equal(before.summary.steps, 15);
  const tx = countTx(store);
  const retention = new Retention({ store, queries: q, days: 400, now: () => NOW });
  assert.deepEqual(await retention.run(), { days: 3, steps: 9, tools: 9 });
  assert.equal(tx.n, 3, "one transaction per day");
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM steps").get().n, 6);
  assert.ok(store.oldestRow() >= CUTOFF);
  assert.ok(store.db.prepare("SELECT COUNT(*) n FROM counter_offsets").get().n > 0, "offsets kept");
  const after = flat(q.families(COLLECTOR, NOW));
  for (const [key, value] of before.fams) assert.ok(after.has(key) && after.get(key) >= value - 1e-9, `${key}: ${value} → ${after.get(key)}`);
  assert.deepEqual(totals(q.summary(0, NOW + DAY, NOW)), before.summary);
  assert.ok(q.range(0).from <= all.from);
  assert.deepEqual(await retention.run(), { days: 0, steps: 0, tools: 0 });
  assert.equal(tx.n, 3);
  store.close();
});

test("retention: due run insieme sono lo stesso run", async () => {
  const { store, q } = fixture();
  const retention = new Retention({ store, queries: q, days: 400, now: () => NOW });
  const a = retention.run();
  assert.equal(retention.run(), a);
  assert.equal((await a).days, 3);
  store.close();
});

test("retention: stop() ferma il run prima del giorno dopo", async () => {
  const { store, q } = fixture();
  const retention = new Retention({ store, queries: q, days: 400, now: () => NOW });
  // stopped right after its first day (the margins are read before it, a block at a time)
  const prune = store.pruneSlice.bind(store);
  store.pruneSlice = (...args) => {
    const r = prune(...args);
    retention.stop();
    return r;
  };
  const run = retention.run();
  assert.equal((await run).days, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM steps").get().n, 12);
  store.close();
});

test("retention: start() lancia il primo run dopo l'attesa, stop() ferma i timer", async () => {
  const { store, q } = fixture();
  const retention = new Retention({ store, queries: q, days: 400, now: () => NOW, firstDelayMs: 5, everyMs: 60_000 });
  retention.start();
  try {
    await waitFor(() => store.db.prepare("SELECT COUNT(*) n FROM steps").get().n === 6, { what: "primo run" });
  } finally {
    retention.stop();
  }
  await new Promise((r) => setTimeout(r, 20));
  store.close();
});

/** A session on OpenCode with steps 500 days old and 2 days old, each with a tool call. */
function oldAndNew(now) {
  const tok = { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } };
  const msgs = [];
  const noon = (ago) => dayBounds(now - ago * DAY).from + 12 * 3_600_000; // well inside one local day
  for (const [ago, n] of [[500, 3], [2, 2]]) {
    const T = noon(ago);
    msgs.push({ id: `u${ago}`, type: "user", text: "x", metadata: {}, time: { created: T } });
    for (let i = 0; i < n; i++) {
      const at = T + 1000 + i * 1000;
      msgs.push({
        id: `a${ago}_${i}`, type: "assistant", model: { id: "m", providerID: "p" }, finish: "stop", cost: 0.001, tokens: tok,
        time: { created: at, streamed: at + 100, completed: at + 500 },
        content: [{ type: "tool", id: `c${i}`, name: "read", state: { status: "completed" }, time: { created: at + 10, ran: at + 20, completed: at + 30 } }],
      });
    }
    msgs.push({ id: `idle${ago}`, type: "idle", outcome: "succeeded", time: { created: T + 5000 + n * 1000 } });
  }
  const session = { id: "s1", cost: 5 * 0.001, tokens: { ...tok, input: 50, output: 10 }, time: { created: noon(500), updated: msgs.at(-1).time.created } };
  return { events: [], sessions: [session], messages: { s1: msgs } };
}

test("retention + resync: le righe potate non tornano e Σ step + Σ potati + Σ interni = totali", async () => {
  const now = Date.now();
  const data = oldAndNew(now);
  const fake = await startFakeOpencode({ data, pageSize: 2 });
  const store = memoryStore();
  const collector = new Collector({ serviceFile: fake.serviceFile, serverUrl: "", storeTitles: false, scanIntervalMs: 120_000 }, store);
  const ctrl = new AbortController();
  const streaming = collector.client.stream({ signal: ctrl.signal, onEvent() {} }).catch(() => {});
  const q = new Queries(store);
  const count = (table) => store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  const sums = () =>
    store.db.prepare(`SELECT
      (SELECT COALESCE(SUM(t_in),0) FROM steps) + (SELECT COALESCE(SUM(t_in),0) FROM daily_steps) + (SELECT COALESCE(SUM(t_in),0) FROM internal_usage) t_in,
      (SELECT COALESCE(SUM(cost),0) FROM steps) + (SELECT COALESCE(SUM(cost),0) FROM daily_steps) + (SELECT COALESCE(SUM(cost),0) FROM internal_usage) cost,
      (SELECT COUNT(*) FROM steps) + (SELECT COALESCE(SUM(steps),0) FROM daily_steps) steps`).get();
  try {
    await collector.fullScan();
    assert.equal(count("steps"), 5);
    assert.equal(count("tools"), 5);
    const fams = flat(q.families(COLLECTOR, now));
    const r = await new Retention({ store, queries: q, days: 400, now: () => now }).run();
    assert.deepEqual(r, { days: 1, steps: 3, tools: 3 });
    assert.equal(count("steps"), 2);
    await collector.fullScan({ force: true });
    assert.equal(count("steps"), 2, "the pruned steps are not written back");
    assert.equal(count("tools"), 2, "nor their tool calls");
    assert.equal(count("runs"), 2, "runs stay");
    assert.equal(count("prompts"), 2, "prompts stay");
    const s = sums();
    assert.deepEqual({ t_in: s.t_in, steps: s.steps }, { t_in: 50, steps: 5 });
    assert.ok(Math.abs(s.cost - 0.005) < 1e-9, `cost ${s.cost}`);
    assert.equal(count("internal_usage"), 0, "no estimate");
    const after = flat(q.families(COLLECTOR, now));
    for (const [key, value] of fams) assert.ok(after.has(key) && after.get(key) >= value - 1e-9, `${key}: ${value} → ${after.get(key)}`);
  } finally {
    ctrl.abort();
    await streaming;
    await fake.close();
    store.close();
  }
});

test("retention: un tool del giorno prima del suo step (step a cavallo della mezzanotte) resta in «Tutto»", async () => {
  const store = memoryStore();
  const q = new Queries(store);
  const D = dayBounds(NOW - 600 * DAY).from; // a local midnight 600 days before
  addSession(store, { id: "ses_1", created: D - 3_600_000 });
  addStep(store, { id: "s_old", started: D - 3_600_000, ended: D + 3_600_000, cost: 1, tokens: tokens(10, 1), finish: "stop" }); // 23:00 → 01:00
  addTool(store, { id: "t_old", message: "s_old", name: "bash", status: "completed", created: D - 1_900_000, ended: D - 1_800_000 }); // 23:30 of the day before
  addStep(store, { id: "s_new", started: NOW - DAY, ended: NOW - DAY + 5000, cost: 1, tokens: tokens(10, 1), finish: "stop" });
  const all = () => {
    const r = q.range(0, NOW + 60_000);
    return { from: r.from, summary: totals(q.summary(r.from, r.to, NOW)) };
  };
  const before = all();
  assert.deepEqual(await new Retention({ store, queries: q, days: 400, now: () => NOW }).run(), { days: 2, steps: 1, tools: 1 });
  const after = all();
  assert.deepEqual(after.summary, before.summary);
  assert.equal(after.summary.tools.calls, 1);
  assert.ok(after.from <= before.from, `range(0).from moved forward: ${before.from} → ${after.from}`);
  store.close();
});

/**
 * «Tutto» before and after the retention of a step across local midnight (23:00 → 01:00), oldest of all, with a
 * prompt, a retry and a permission between its start and midnight; `tool` adds a tool call of the day before.
 */
async function acrossMidnight({ tool }) {
  const store = memoryStore();
  const q = new Queries(store);
  const D = dayBounds(NOW - 600 * DAY).from;
  addSession(store, { id: "ses_1", created: D - 3_700_000 });
  addPrompt(store, { id: "p_old", created: D - 3_630_000 }); // 22:59:30
  addStep(store, { id: "s_old", started: D - 3_600_000, ended: D + 3_600_000, cost: 1, tokens: tokens(10, 1), finish: "stop" });
  if (tool) addTool(store, { id: "t_old", message: "s_old", name: "bash", status: "completed", created: D - 1_900_000, ended: D - 1_800_000 });
  addRun(store, { id: "r_old", started: D - 3_630_000, ended: D + 3_700_000 });
  store.st.signal.run({ id: "sig_old", type: "session.retry.scheduled", session_id: "ses_1", message_id: "s_old", created: D - 1_800_000, detail: "{}" });
  store.st.permissionAsked.run({ id: "perm_old", session_id: "ses_1", action: "bash", resources: 1, at: D - 1_500_000 });
  addPrompt(store, { id: "p_new", created: NOW - DAY - 1000 });
  addStep(store, { id: "s_new", started: NOW - DAY, ended: NOW - DAY + 5000, cost: 1, tokens: tokens(10, 1), finish: "stop" });
  addRun(store, { id: "r_new", started: NOW - DAY - 1000, ended: NOW - DAY + 6000 });
  const all = () => {
    const r = q.range(0, NOW + 60_000);
    const s = q.summary(r.from, r.to, NOW);
    const a = q.activity(r.from, r.to);
    return {
      from: r.from,
      summary: { ...totals(s), retries: s.retries, rateLimited: s.rateLimited, failedRuns: s.failedRuns, compactions: s.compactions },
      signals: q.signals(r.from, r.to),
      // the model of a retry comes from its step: once the step is pruned it is «?» (a declared limit)
      errors: (({ groups, ...e }) => ({ ...e, groups: groups.map(({ model, provider, ...g }) => g) }))(q.errors(r.from, r.to)),
      // the runs' own counts and times (their steps, cost and tokens come from the steps kept: a declared limit)
      activity: { prompts: a.prompts, permissions: a.permissions, runs: { count: a.runs.count, outcomes: a.runs.outcomes, durationMs: a.runs.durationMs } },
    };
  };
  const before = all();
  await new Retention({ store, queries: q, days: 400, now: () => NOW }).run();
  const after = all();
  store.close();
  return { before, after };
}

for (const tool of [false, true]) {
  test(`retention: «Tutto» parte da dove partiva, con uno step a cavallo della mezzanotte${tool ? " e un tool del giorno prima" : ""}`, async () => {
    const { before, after } = await acrossMidnight({ tool });
    assert.equal(before.summary.retries, 1);
    assert.equal(before.activity.prompts.count, 2);
    assert.equal(new Date(after.from).toISOString(), new Date(before.from).toISOString(), "range(0).from as without the retention");
    assert.deepEqual(after.summary, before.summary);
    assert.deepEqual(after.signals, before.signals);
    assert.deepEqual(after.errors, before.errors);
    assert.deepEqual(after.activity, before.activity);
  });
}

test("retention: nessun contatore REAL cala nemmeno di un ulp (confronto esatto)", async () => {
  // every 7 days for 700 days, 4 steps of $0.1: sums of 0.1 that the pruning would round differently
  const store = memoryStore();
  const q = new Queries(store);
  for (let d = 700; d >= 0; d -= 7) {
    const noon = dayBounds(NOW - d * DAY).from + (d % 3 === 0 ? 23.5 * 3_600_000 : 12 * 3_600_000);
    for (let i = 0; i < 4; i++) {
      const at = noon + i * 1_200_000;
      addStep(store, {
        id: `st_${d}_${i}`, session: `ses_${d}`, model: i % 2 ? "m-a" : "m-b", agent: i === 3 ? "plan" : "build", started: at, ended: at + 900_000, cost: 0.1,
        tokens: tokens(100, 10, i, 2, 1), finish: i === 2 ? "error" : "stop", requested: at, firstOutput: at + 2000, streamed: at + 800_000,
      });
      if (i !== 1) addTool(store, { id: `t_${d}_${i}`, session: `ses_${d}`, message: `st_${d}_${i}`, name: i === 3 ? "bash" : "read", status: i === 0 ? "error" : "completed", created: at + 1000, ended: at + 5000, out_bytes: 9 });
    }
  }
  const before = flat(q.families(COLLECTOR, NOW));
  assert.ok((await new Retention({ store, queries: q, days: 400, now: () => NOW }).run()).days > 10);
  const after = flat(q.families(COLLECTOR, NOW));
  const down = [...before].filter(([k, v]) => !(after.get(k) >= v)).map(([k, v]) => `${k}: ${v} → ${after.get(k)}`);
  assert.deepEqual(down, []);
  store.close();
});

test("retention: due intervalli adiacenti dentro un giorno potato non lo contano due volte", async () => {
  const store = memoryStore();
  const q = new Queries(store);
  const H = 3_600_000;
  const D = dayBounds(NOW - 500 * DAY).from;
  addSession(store, { id: "ses_1", created: D });
  for (const [i, h] of [[0, 8], [1, 8.5], [2, 14], [3, 14.5]]) addStep(store, { id: `s${i}`, started: D + h * H, ended: D + h * H + 60_000, cost: 1, tokens: tokens(10), finish: "stop" });
  addStep(store, { id: "new", started: NOW - DAY, ended: NOW - DAY + 1000, cost: 1, tokens: tokens(10), finish: "stop" });
  await new Retention({ store, queries: q, days: 400, now: () => NOW }).run();
  const steps = (from, to) => q.summary(from, to, NOW).steps;
  assert.ok(steps(D, D + 12 * H) + steps(D + 12 * H, D + 24 * H) <= 4, "the pruned day at most once");
  assert.equal(steps(D, D + 24 * H), 4, "the whole day");
  assert.equal(steps(D + 13 * H, D + 15 * H), 0, "a range without the day's midnight: nothing of the day (its rows are gone)");
  const all = q.range(0, NOW + 60_000);
  assert.equal(q.summary(all.from, all.to, NOW).steps, 5, "«Tutto» still counts the day");
  store.close();
});

test("retention: migliaia di righe con costi e tempi che arrotondano male, nessuna serie REAL cala (confronto esatto)", async () => {
  const store = memoryStore();
  const q = new Queries(store);
  const COSTS = [0.1, 0.7, 1 / 3, 0.01, 2 / 7, 1e-7, 123.456];
  let n = 0;
  store.db.exec("BEGIN");
  for (let d = 460; d >= 380; d--) {
    const noon = dayBounds(NOW - d * DAY).from + 12 * 3_600_000;
    for (let i = 0; i < 40; i++) {
      const at = noon + i * 61_111;
      const id = `st_${n++}`;
      addStep(store, {
        id, model: `m${i % 3}`, agent: i % 4 ? "build" : "plan", started: at, ended: at + 1234 + (i % 17) * 333, cost: COSTS[(n * 7 + i) % COSTS.length],
        tokens: tokens(100 + i, 10 + (i % 5)), finish: i % 11 ? "stop" : "error", requested: at, firstOutput: at + 101 + (i % 13) * 37, streamed: at + 1100 + (i % 7) * 211,
      });
      addTool(store, { id: `t_${n}`, message: id, name: `tool${i % 5}`, status: i % 9 ? "completed" : "error", created: at + 10, ran: at + 17, ended: at + 17 + (i % 23) * 41 });
    }
  }
  store.db.exec("COMMIT");
  const before = flat(q.families(COLLECTOR, NOW));
  assert.equal(n, 81 * 40);
  assert.ok((await new Retention({ store, queries: q, days: 400, now: () => NOW }).run()).days > 50);
  const after = flat(q.families(COLLECTOR, NOW));
  const down = [...before].filter(([k, v]) => !(after.get(k) >= v)).map(([k, v]) => `${k}: ${v} → ${after.get(k)}`);
  assert.deepEqual(down, []);
  store.close();
});

test("retention: due periodi adiacenti che iniziano prima di retention_from non contano due volte il giorno", async () => {
  const store = memoryStore();
  const q = new Queries(store);
  const H = 3_600_000;
  const D = dayBounds(NOW - 500 * DAY).from;
  addSession(store, { id: "ses_1", created: D + 23 * H });
  addStep(store, { id: "s_old", started: D + 23 * H, ended: D + 25 * H, cost: 1, tokens: tokens(10), finish: "stop" }); // 23:00 → 01:00
  addTool(store, { id: "t_old", message: "s_old", name: "bash", status: "completed", created: D + 23.4 * H, ended: D + 23.5 * H });
  addStep(store, { id: "new", started: NOW - DAY, ended: NOW - DAY + 1000, cost: 1, tokens: tokens(10), finish: "stop" });
  await new Retention({ store, queries: q, days: 400, now: () => NOW }).run();
  const sum = (from, to) => {
    const s = q.summary(from, to, NOW);
    return s.steps + s.tools.calls;
  };
  const [a, b] = [sum(D + 10 * H, D + 20 * H), sum(D + 20 * H, D + 5 * DAY)];
  assert.ok(a + b <= sum(D + 10 * H, D + 5 * DAY), `A ${a} + B ${b} > A∪B`);
  assert.equal(sum(D + 10 * H, D + 5 * DAY), 2, "the pruned step and tool, once");
  store.close();
});

test("retention: margine per serie, una serie a 0 resta 0 e una piccola accanto a una grande quasi non cresce", async () => {
  const store = memoryStore();
  const q = new Queries(store);
  store.db.exec("BEGIN");
  let n = 0;
  for (let d = 700; d >= 1; d -= 2) {
    const noon = dayBounds(NOW - d * DAY).from + 12 * 3_600_000;
    for (let i = 0; i < 20; i++) {
      const at = noon + i * 60_000;
      const model = i === 0 ? "free" : i === 1 ? "tiny" : "big";
      const cost = model === "free" ? 0 : model === "tiny" ? 1e-7 : 3.5 + (i % 7) * 0.001;
      addStep(store, { id: `st_${n++}`, model, started: at, ended: at + 5000 + (i % 11) * 777, cost, tokens: tokens(100, 10), finish: "stop", requested: at, firstOutput: at + 100 + (i % 7), streamed: at + 4000 });
    }
  }
  store.db.exec("COMMIT");
  const before = flat(q.families(COLLECTOR, NOW));
  assert.ok((await new Retention({ store, queries: q, days: 400, now: () => NOW }).run()).days > 100);
  const after = flat(q.families(COLLECTOR, NOW));
  const cost = (model) => JSON.stringify(["opencode_lens_cost_usd_total", labelKey({ provider: "anthropic", model, agent: "build" })]);
  const k = (key) => `opencode_lens_cost_usd_total${JSON.parse(key)[1]}`;
  assert.equal(after.get(k(cost("free"))), 0, "a series at 0 stays 0");
  for (const [key, v] of before) {
    const a = after.get(key);
    assert.ok(a >= v, `${key}: ${v} → ${a}`);
    if (v !== 0) assert.ok((a - v) / Math.abs(v) <= 1e-8, `${key}: relative raise ${(a - v) / Math.abs(v)}`);
  }
  // its margin is its own, not the one of the big series beside it
  const tiny = [before.get(k(cost("tiny"))), after.get(k(cost("tiny")))];
  assert.ok(tiny[0] > 0 && (tiny[1] - tiny[0]) / tiny[0] <= 1e-9, `tiny: ${tiny[0]} → ${tiny[1]}`);
  store.close();
});
