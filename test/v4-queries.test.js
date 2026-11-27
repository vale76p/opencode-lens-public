// Schema v4 in the API: step speed, interrupt reasons, internal usage by kind and model.
import { test } from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { Queries, SPEED_MIN_TOKENS, SPEED_MIN_WINDOW_MS, speedStats, stepSpeed } from "../src/queries.js";
import { OtlpExporter } from "../src/otlp.js";
import { setLogLevel } from "../src/log.js";
import { addInternal, addRun, addSession, addStep, memoryStore, tokens } from "./helpers.js";

setLogLevel("error");

const ALL = [0, 1e15];
const NOW = 1_800_000_000_000;
const base = { requested: 1000, first_output: 3000, streamed: 13_000, ended: 13_500, finish: "stop", t_out: 300, t_reason: 100 };

test("stepSpeed: primo token, tok/s e coda dei tool con le soglie", () => {
  assert.equal(SPEED_MIN_WINDOW_MS, 500);
  assert.equal(SPEED_MIN_TOKENS, 20);
  assert.deepEqual(stepSpeed(base), { ttftMs: 2000, tokensPerSec: 40, toolTailMs: 500 });
  assert.equal(stepSpeed({ ...base, streamed: 3400 }).tokensPerSec, null, "finestra di 400 ms");
  assert.equal(stepSpeed({ ...base, t_out: 19, t_reason: 0 }).tokensPerSec, null, "19 token");
  assert.equal(stepSpeed({ ...base, finish: "error" }).tokensPerSec, null, "step fallito");
  assert.equal(stepSpeed({ ...base, first_output: 900 }).ttftMs, null, "output prima della richiesta");
  assert.equal(stepSpeed({ ...base, ended: 12_000 }).toolTailMs, null, "fine prima dello stream");
  assert.deepEqual(stepSpeed({}), { ttftMs: null, tokensPerSec: null, toolTailMs: null });
});

test("speedStats: percentili e vuoto", () => {
  assert.deepEqual(speedStats([]), { ttftMs: { p50: null, p95: null }, tokensPerSec: { p50: null }, toolTailMs: { p50: null }, n: 0 });
  const s = speedStats([base, { ...base, first_output: 5000 }, { ...base, t_out: 1, t_reason: 0 }]);
  assert.equal(s.n, 2);
  assert.equal(s.ttftMs.p50, 2000);
  assert.equal(s.tokensPerSec.p50, 45);
});

/** A step with v4 times: request at `at`, first output 2 s later, 10 s of stream, 500 ms of tools. */
function timedStep(store, id, at, extra = {}) {
  addStep(store, {
    id,
    started: at,
    ended: at + 12_500,
    requested: at,
    firstOutput: at + 2000,
    streamed: at + 12_000,
    tokens: tokens(1000, 300, 100),
    ...extra,
  });
}

function internalMix(store) {
  addStep(store, { id: "s1", started: 100, ended: 200, tokens: tokens(1000) });
  store.tx(() => {
    store.recordInternal({ id: "evt_t", session_id: "ses_1", created: 300, kind: "title", cost: 0.001, t_in: 100, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 });
    store.recordInternal({
      id: "msg_c", session_id: "ses_1", created: 400, kind: "compaction", provider: "anthropic", model: "claude-sonnet-5-5", variant: null, reason: "auto",
      cost: 0.01, t_in: 300, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0,
    });
  });
  addInternal(store, { id: "ses_1:1", created: 500, cost: 0.0001, tokens: tokens(50) });
  const sig = (id, type, detail) => store.st.signal.run({ id, type, session_id: "ses_1", message_id: null, created: 400, detail: JSON.stringify(detail) });
  sig("e1", "session.compaction.ended", { reason: "auto" });
  sig("e2", "session.compaction.ended", { reason: "manual" });
  sig("e3", "session.compaction.ended", {});
}

test("summary: velocità, task interni per tipo e per modello, compaction per motivo", () => {
  const store = memoryStore();
  internalMix(store);
  timedStep(store, "fast", 1000);
  const s = new Queries(store).summary(...ALL);
  assert.equal(s.internal.tokens.total, 450);
  assert.deepEqual(
    Object.fromEntries(Object.entries(s.internal.byKind).map(([k, v]) => [k, v.tokens.total])),
    { title: 100, compaction: 300, other: 50 },
  );
  assert.ok(Math.abs(s.internal.byKind.compaction.cost - 0.01) < 1e-12);
  assert.deepEqual(s.internal.byModel.map((m) => [m.key, m.tokens.total]), [["anthropic/claude-sonnet-5-5", 300]]);
  assert.deepEqual(s.compactionsByReason, { auto: 1, manual: 1, unknown: 1 });
  assert.equal(s.compactions, 3);
  assert.equal(s.speed.n, 1);
  assert.equal(s.speed.ttftMs.p50, 2000);
  assert.equal(s.speed.tokensPerSec.p50, 40);
  assert.equal(s.speed.toolTailMs.p50, 500);
});

test("breakdown: le compaction non entrano nei numeri per modello; velocità per modello", () => {
  const store = memoryStore();
  internalMix(store);
  timedStep(store, "fast", 1000);
  const rows = new Queries(store).breakdown(...ALL, "model");
  const row = rows.find((r) => r.key === "anthropic/claude-sonnet-5-5");
  assert.equal(row.tokens.total, 1000 + 1400, "solo gli step");
  assert.equal(row.speed.tokensPerSec.p50, 40);
  assert.equal(row.speed.ttftMs.p50, 2000);
  assert.ok("outputTokensPerSec" in row, "il campo vecchio resta");
});

test("runs: motivo e velocità; runSummary: interruzioni", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1" });
  addRun(store, { id: "r1", started: 0, ended: 20_000, outcome: "interrupted", reason: "user" });
  addRun(store, { id: "r2", started: 30_000, ended: 50_000, outcome: "interrupted" });
  addRun(store, { id: "r3", started: 60_000, ended: 80_000, outcome: "succeeded" });
  timedStep(store, "a", 1000);
  const q = new Queries(store);
  const runs = Object.fromEntries(q.runs(...ALL).map((r) => [r.id, r]));
  assert.equal(runs.r1.reason, "user");
  assert.equal(runs.r2.reason, null);
  assert.equal(runs.r1.speed.tokensPerSec.p50, 40);
  assert.equal(runs.r2.speed.n, 0);
  const sum = q.runSummary(...ALL);
  assert.deepEqual(sum.interruptions, { user: 1, superseded: 0, inactivity: 0, shutdown: 0, unknown: 1 });
  assert.equal(Object.values(sum.interruptions).reduce((a, b) => a + b, 0), sum.outcomes.interrupted);
});

test("live: velocità dell'ultimo step finito e attesa del primo token", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1" });
  timedStep(store, "done", NOW - 60_000);
  addStep(store, { id: "wait", started: NOW - 3000, requested: NOW - 3000 });
  const q = new Queries(store);
  let [r] = q.liveRuns(NOW).runs;
  assert.deepEqual(r.speed, { ttftMs: 2000, tokensPerSec: 40 });
  assert.equal(r.waitingSince, NOW - 3000);
  store.st.stepOutput.run({ id: "wait", at: NOW - 1000 });
  [r] = q.liveRuns(NOW).runs;
  assert.equal(r.waitingSince, null);
});

test("live: una risposta vuota non resta «in attesa del primo token» dopo la fine dello stream", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1" });
  addStep(store, { id: "empty", started: NOW - 3000, requested: NOW - 3000 });
  const q = new Queries(store);
  assert.equal(q.liveRuns(NOW).runs[0].waitingSince, NOW - 3000);
  store.st.stepStreamed.run({ id: "empty", at: NOW - 1000 });
  assert.equal(q.liveRuns(NOW).runs[0].waitingSince, null);
});

test("session: orari e velocità degli step, tipo dei task interni, motivo dei run", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1" });
  internalMix(store);
  timedStep(store, "a", 1000);
  addRun(store, { id: "r1", started: 0, ended: 20_000, outcome: "interrupted", reason: "inactivity" });
  const s = new Queries(store).session("ses_1");
  const a = s.steps.find((x) => x.id === "a");
  assert.deepEqual([a.requested, a.firstOutput, a.streamed, a.ttftMs, a.tokensPerSec, a.toolTailMs], [1000, 3000, 13_000, 2000, 40, 500]);
  assert.deepEqual(s.internal.map((i) => [i.id, i.kind, i.model, i.reason]), [
    ["evt_t", "title", null, null],
    ["msg_c", "compaction", "anthropic/claude-sonnet-5-5", "auto"],
    ["ses_1:1", null, null, null],
  ]);
  assert.equal(s.runs[0].reason, "inactivity");
});

test("database vuoto: niente NaN nei campi nuovi", () => {
  const q = new Queries(memoryStore());
  const out = JSON.stringify([q.summary(...ALL), q.breakdown(...ALL), q.runs(...ALL), q.runSummary(...ALL), q.liveRuns(NOW)]);
  assert.ok(!out.includes("NaN"));
  const s = q.summary(...ALL);
  assert.equal(s.speed.n, 0);
  assert.deepEqual(s.internal.byModel, []);
  assert.equal(s.internal.byKind.other.tokens.total, 0);
  assert.deepEqual(s.compactionsByReason, { auto: 0, manual: 0, unknown: 0 });
});

// ---------- /metrics and OTLP ----------

const fakeCollector = { status: () => ({ state: "connected", lastEventAt: null, drift: [], duplicateEvents: 0 }) };
const counters = (q) =>
  Object.fromEntries(
    q
      .families(fakeCollector)
      .filter((f) => f.type === "counter")
      .flatMap((f) => f.samples.map((x) => [`${f.name}${JSON.stringify(x.labels)}`, x.value])),
  );

test("/metrics v4: famiglie nuove, quelle vecchie invariate", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1" });
  internalMix(store);
  timedStep(store, "a", 1000);
  addRun(store, { id: "r1", started: 0, ended: 20_000, outcome: "interrupted", reason: "user" });
  addRun(store, { id: "r2", started: 30_000, ended: 40_000, outcome: "interrupted" });
  const q = new Queries(store);
  const text = q.metrics(fakeCollector);
  assert.match(text, /^opencode_lens_step_ttft_seconds_sum\{provider="anthropic",model="claude-sonnet-5-5",agent="build"\} 2$/m);
  assert.match(text, /^opencode_lens_step_ttft_seconds_count\{[^}]*\} 1$/m);
  assert.match(text, /^opencode_lens_step_output_tokens_per_second_sum\{[^}]*\} 40$/m);
  assert.match(text, /^opencode_lens_runs_interrupted_total\{reason="user"\} 1$/m);
  assert.doesNotMatch(text, /runs_interrupted_total\{reason="unknown"/);
  assert.match(text, /^opencode_lens_internal_usage_tokens_total\{source="title",kind="input"\} 100$/m);
  assert.match(text, /^opencode_lens_internal_usage_tokens_total\{source="compaction",kind="input"\} 300$/m);
  assert.match(text, /^opencode_lens_internal_usage_cost_usd_total\{source="compaction"\} 0.01$/m);
  assert.doesNotMatch(text, /source="other"/);
  assert.match(text, /^opencode_lens_internal_tokens_total\{kind="input"\} 450$/m, "il totale vecchio comprende tutto");
});

test("/metrics v4: assorbire una stima non fa scendere nessun contatore", () => {
  const store = memoryStore();
  addStep(store, { id: "s1", started: 100, ended: 200, tokens: tokens(100) });
  store.reconcileInternal("ses_1", 5000, { cost: 0.01, t_in: 400, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 });
  const q = new Queries(store);
  const before = counters(q);
  store.tx(() => store.recordInternal({ id: "msg_c", session_id: "ses_1", created: 1000, kind: "compaction", cost: 0.01, t_in: 300, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 }));
  const after = counters(q);
  for (const [k, v] of Object.entries(before)) assert.ok((after[k] ?? 0) >= v - 1e-12, `${k}: ${v} → ${after[k]}`);
});

test("/metrics v4: primo token e tok/s per gruppo come stepSpeed, soglie comprese", () => {
  const store = memoryStore();
  const at = (id, extra) => addStep(store, { id, started: 0, ended: 20_000, requested: 1000, firstOutput: 3000, streamed: 13_000, tokens: tokens(10, 300, 100), ...extra });
  at("a1", {});
  at("a2", { firstOutput: 3500, streamed: 4000 }); // window of exactly 500 ms
  at("a3", { streamed: 3499 }); // window of 499 ms: no rate
  at("a4", { tokens: tokens(10, 20, 0) }); // exactly 20 tokens
  at("a5", { tokens: tokens(10, 19, 0) }); // 19 tokens: no rate
  at("a6", { finish: "error" }); // failed: ttft only
  at("a7", { firstOutput: 900 }); // output before the request: rate only
  at("b1", { model: "altro", agent: "plan", firstOutput: 1777, streamed: 9999 });
  at("c1", { provider: null, model: null, agent: null });
  at("d1", { requested: null }); // no request: not a speed step
  at("e1", { firstOutput: null, streamed: null }); // nothing to measure
  store.db.exec(`UPDATE steps SET finish = NULL WHERE id = 'a4'`); // finish unknown counts as not failed
  store.db.exec(`UPDATE steps SET provider = NULL, model = NULL, agent = NULL WHERE id = 'c1'`);
  // reference: the per-step stepSpeed() summed per label set, in insertion order
  const ref = new Map();
  for (const r of store.db.prepare(`SELECT * FROM steps WHERE requested IS NOT NULL AND ended IS NOT NULL ORDER BY rowid`).all()) {
    const v = stepSpeed(r);
    if (v.ttftMs == null && v.tokensPerSec == null) continue;
    const labels = { provider: r.provider ?? "?", model: r.model ?? "?", agent: r.agent ?? "?" };
    const k = JSON.stringify(labels);
    const a = ref.get(k) ?? ref.set(k, { labels, ts: 0, tn: 0, rs: 0, rn: 0 }).get(k);
    if (v.ttftMs != null) (a.ts += v.ttftMs / 1000), a.tn++;
    if (v.tokensPerSec != null) (a.rs += v.tokensPerSec), a.rn++;
  }
  const fams = Object.fromEntries(new Queries(store).families(fakeCollector).map((f) => [f.name, f.samples]));
  const want = (sum, n) => [...ref.values()].filter((a) => a[n]).map((a) => ({ labels: a.labels, sum: a[sum], count: a[n] }));
  assert.deepEqual(fams.opencode_lens_step_ttft_seconds, want("ts", "tn"));
  assert.deepEqual(fams.opencode_lens_step_output_tokens_per_second, want("rs", "rn"));
  assert.equal(fams.opencode_lens_step_ttft_seconds.length, 3);
});

async function receiver() {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ path: req.url, body: JSON.parse(body) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { got, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("OTLP: primo token e tok/s sugli step, motivo sui run interrotti", async () => {
  const store = memoryStore();
  const now = NOW;
  addSession(store, { id: "ses_1" });
  addRun(store, { id: "r1", started: now - 60_000, ended: now - 30_000, outcome: "interrupted", reason: "superseded" });
  timedStep(store, "fast", now - 59_000);
  addStep(store, { id: "plain", started: now - 40_000, ended: now - 39_000, tokens: tokens(10, 1) });
  const rx = await receiver();
  try {
    const config = { labels: {}, otlp: { endpoint: rx.url, headers: {}, intervalMs: 60_000, temporality: "delta", traces: true } };
    await new OtlpExporter({ config, store, queries: new Queries(store), collector: fakeCollector }).exportOnce(now);
    const spans = rx.got.find((g) => g.path === "/v1/traces").body.resourceSpans[0].scopeSpans[0].spans;
    const at = (sp, k) => Object.values(sp.attributes.find((a) => a.key === k)?.value ?? {})[0];
    const llm = spans.filter((sp) => sp.name === "opencode.llm");
    const fast = llm.find((sp) => at(sp, "opencode.step.ttft_ms") !== undefined);
    assert.equal(Number(at(fast, "opencode.step.ttft_ms")), 2000);
    assert.equal(Number(at(fast, "opencode.step.output_tokens_per_second")), 40);
    assert.equal(llm.filter((sp) => at(sp, "opencode.step.ttft_ms") === undefined && at(sp, "opencode.step.output_tokens_per_second") === undefined).length, 1);
    assert.equal(at(spans.find((sp) => sp.name === "opencode.run"), "opencode.run.interrupt_reason"), "superseded");
  } finally {
    await rx.close();
  }
});

test("daily: ttft e failedRuns per giorno", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1" });
  const d1 = new Date(2026, 9, 14, 12).getTime();
  const d2 = new Date(2026, 9, 15, 12).getTime();
  const now = new Date(2026, 9, 15, 18).getTime();
  addStep(store, { id: "a", started: d1, ended: d1 + 100 });
  for (const [i, ttft] of [1000, 2000, 4000].entries()) {
    const t = d2 + i * 1000;
    addStep(store, { id: `b${i}`, started: t, ended: t + 100, requested: t, firstOutput: t + ttft });
  }
  addRun(store, { id: "r1", started: d2, ended: d2 + 500, outcome: "failed" });
  addRun(store, { id: "r2", started: d2, ended: d2 + 900, outcome: "succeeded" });
  const { days } = new Queries(store).daily(2, now);
  assert.equal(days[1].ttft.p50, 2000);
  assert.equal(days[0].failedRuns, 0);
  assert.equal(days[1].failedRuns, 1);
  assert.equal(days[1].runs, 2);
  assert.deepEqual(days[0].ttft, { p50: null, p95: null });
});
