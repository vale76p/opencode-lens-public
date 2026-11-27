// I bucket della dashboard sono in ora locale: fuso fisso, diverso da UTC,
// così un errore di fuso sposta gli step di bucket e il test lo vede.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Queries, quantile, httpStatus } from "../src/queries.js";
import { memoryStore, addStep, addInternal, addTool, addSession, addRun, tokens } from "./helpers.js";

const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const near = (a, b) => Math.abs(a - b) < 1e-12;

function seeded() {
  const store = memoryStore();
  // 23:30 locale del 14 = 21:30 UTC
  addStep(store, { id: "a", started: local(2026, 10, 14, 23, 30), ended: local(2026, 10, 14, 23, 30) + 10_000, cost: 0.01, tokens: tokens(100, 50, 10, 300, 50) });
  // 00:30 locale del 15 = 22:30 UTC del 14
  addStep(store, { id: "b", provider: "lmstudio", model: "qwen3.5-9b", started: local(2026, 10, 15, 0, 30), ended: local(2026, 10, 15, 0, 30) + 4000, tokens: tokens(200, 100) });
  addStep(store, { id: "c", started: local(2026, 10, 15, 1), ended: local(2026, 10, 15, 1) + 1000, finish: "error", errorType: "APIError", errorMsg: "overloaded" });
  addStep(store, { id: "d", started: local(2026, 10, 15, 2), tokens: null }); // in corso
  addStep(store, { id: "old", started: local(2026, 10, 1, 12), ended: local(2026, 10, 1, 12) + 1000, cost: 5, tokens: tokens(9999) });
  addInternal(store, { id: "ses_1:1", created: local(2026, 10, 15, 0, 45), cost: 0.001, tokens: tokens(20, 5) });
  addTool(store, { id: "t1", name: "read", status: "completed", created: local(2026, 10, 14, 23, 31), ended: local(2026, 10, 14, 23, 31) + 200 });
  addTool(store, { id: "t2", name: "bash", status: "error", created: local(2026, 10, 15, 0, 31), ended: local(2026, 10, 15, 0, 31) + 900, errorMsg: "exit 1" });
  store.st.signal.run({ id: "evt_r1", type: "session.retry.scheduled", session_id: "ses_1", message_id: "c", created: local(2026, 10, 15, 1), detail: "{}" });
  return { store, q: new Queries(store) };
}

test("summary: totali del periodo, cache, latenza, tool, retry", () => {
  const { q } = seeded();
  const s = q.summary(local(2026, 10, 14), local(2026, 10, 16), local(2026, 10, 15, 2, 10));
  assert.equal(s.steps, 4);
  assert.equal(s.failedSteps, 1);
  assert.equal(s.runningSteps, 1);
  assert.equal(s.sessions, 1);
  assert.equal(s.models, 2);
  assert.ok(near(s.stepCost, 0.01));
  assert.ok(near(s.cost, 0.011), "il costo include i task interni");
  assert.deepEqual(s.tokens, { input: 300, output: 150, reasoning: 10, cacheRead: 300, cacheWrite: 50, total: 810 });
  assert.ok(near(s.cacheRate, 300 / (300 + 300 + 50)), "cache letta / prompt reale");
  assert.ok(near(s.internal.cost, 0.001));
  assert.equal(s.internal.tokens.total, 25);
  // step falliti e in corso esclusi dalla latenza
  assert.deepEqual(s.latencyMs, { p50: 7000, p95: 9700, n: 2 });
  assert.deepEqual(s.tools, { calls: 2, errors: 1 });
  assert.equal(s.retries, 1);
  assert.equal(s.rateLimited, 0, "un retry senza errore non è un limite di frequenza");
});

test("summary e daily: i retry di oggi, con quelli per limite di frequenza (429)", () => {
  const store = memoryStore();
  try {
    const day = local(2026, 10, 15);
    const retry = (id, at, error) => store.st.signal.run({ id, type: "session.retry.scheduled", session_id: "ses_1", message_id: null, created: at, detail: JSON.stringify({ attempt: 1, error }) });
    retry("r1", day + 3_600_000, { error_type: "APIError", error_msg: "Too Many Requests (HTTP 429)" });
    retry("r2", day + 3_700_000, { error_type: "provider", error_msg: "Rate limit reached for requests" });
    retry("r3", day + 3_800_000, { error_type: "rate_limit_error", error_msg: "slow down" });
    retry("r4", day + 3_900_000, { error_type: "APIError", error_msg: "Overloaded (HTTP 529)" });
    retry("r5", day + 4_000_000, { error_type: "APIError", error_msg: "prompt too long: 14290 tokens (HTTP 400)" });
    retry("r_ieri", day - 3_600_000, { error_type: "APIError", error_msg: "quota (HTTP 429)" });
    // a failed run that mentions 429 is not a retry
    store.st.signal.run({ id: "f1", type: "session.execution.failed", session_id: "ses_1", message_id: null, created: day + 4_100_000, detail: JSON.stringify({ error: { error_msg: "(HTTP 429)" } }) });
    const q = new Queries(store);
    const now = day + 5_000_000;
    const s = q.summary(day, day + 86_400_000, now);
    assert.equal(s.retries, 5);
    assert.equal(s.rateLimited, 3, "429, «rate limit» nel messaggio e rate_limit nel tipo; non 529 né 14290");
    const days = q.daily(2, now).days;
    assert.deepEqual(days.map((d) => [d.retries, d.rateLimited]), [[1, 1], [5, 3]]);
  } finally {
    store.close();
  }
});

test("summary: uno step rimasto a metà da più di 30 minuti non è «in corso», ma resta nel periodo", () => {
  const { store, q } = seeded();
  const s = q.summary(local(2026, 10, 1), local(2026, 10, 17), local(2026, 10, 16));
  assert.equal(s.runningSteps, 0);
  assert.equal(s.steps, 5);
  store.close();
});

test("tools: un errore senza messaggio conta fra gli errori ma non fra i messaggi più frequenti", () => {
  const store = memoryStore();
  const t0 = local(2026, 10, 15, 10);
  // IBM Bob records only that a call failed; OpenCode may too
  addTool(store, { id: "e1", name: "apply_diff", status: "error", created: t0, ended: t0 + 10 });
  addTool(store, { id: "e2", name: "apply_diff", status: "error", created: t0, ended: t0 + 10, errorMsg: "patch non applicabile" });
  addTool(store, { id: "e3", name: "grep", status: "error", created: t0, ended: t0 + 10 });
  const q = new Queries(store);
  const rows = Object.fromEntries(q.tools(t0 - 1, t0 + 60_000, t0 + 60_000).map((r) => [r.name, r]));
  assert.equal(rows.apply_diff.errors, 2);
  assert.deepEqual(rows.apply_diff.topErrors, [{ message: "patch non applicabile", count: 1 }]);
  assert.equal(rows.grep.errors, 1);
  assert.deepEqual(rows.grep.topErrors, []);
  store.close();
});

test("tools: durata di esecuzione da `ran`, da `created` solo per i dati senza `ran`", () => {
  const store = memoryStore();
  const t0 = local(2026, 10, 15, 10);
  // OpenCode recente: il modello scrive gli argomenti per 2 s, il tool gira 100 ms
  addTool(store, { id: "r1", name: "read", status: "completed", created: t0, ran: t0 + 2000, ended: t0 + 2100 });
  addTool(store, { id: "r2", name: "read", status: "completed", created: t0, ran: t0 + 1000, ended: t0 + 1300 });
  // OpenCode precedente: niente `ran`, `created` è già l'avvio dell'esecuzione
  addTool(store, { id: "r3", name: "read", status: "completed", created: t0, ran: null, ended: t0 + 10 });
  addTool(store, { id: "r4", name: "read", status: "running", created: t0, ran: t0 + 5, ended: null });
  const q = new Queries(store);
  const read = q.tools(t0 - 1, t0 + 60_000, t0 + 60_000).find((r) => r.name === "read");
  assert.equal(read.calls, 4);
  assert.deepEqual(read.durationMs, { p50: 100, p95: 280, n: 3 });
  assert.equal(read.open, 1);
  // a call left half-way is no longer open after 30 minutes, as in /metrics
  assert.equal(q.tools(t0 - 1, t0 + 60_000, t0 + 31 * 60_000).find((r) => r.name === "read").open, 0);
});

test("session: uno step senza fine è «in corso» solo nei 30 minuti dopo l'avvio", () => {
  const { store, q } = seeded();
  store.st.sessionTouch.run("ses_1", local(2026, 10, 15, 2));
  const at = (now) => Object.fromEntries(q.session("ses_1", now).steps.map((st) => [st.id, st.running]));
  assert.deepEqual(at(local(2026, 10, 15, 2, 10)), { old: false, a: false, b: false, c: false, d: true });
  assert.equal(at(local(2026, 10, 16)).d, false);
  store.close();
});

test("quantile interpola tra i valori ordinati", () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10], 0.95), 10);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

test("timeseries orario: bucket in ora locale, task interni in coda", () => {
  const { q } = seeded();
  const ts = q.timeseries(local(2026, 10, 14), local(2026, 10, 16), { metric: "tokens", by: "model" });
  assert.equal(ts.unit, "hour");
  assert.equal(ts.labels.length, 48);
  assert.equal(ts.labels[0], "2026-10-14 00:00");
  const at = (key, label) => ts.series.find((s) => s.key === key).values[ts.labels.indexOf(label)];
  assert.equal(at("anthropic/claude-sonnet-5-5", "2026-10-14 23:00"), 510);
  assert.equal(at("lmstudio/qwen3.5-9b", "2026-10-15 00:00"), 300);
  assert.equal(at("task interni", "2026-10-15 00:00"), 25);
  assert.equal(ts.series.at(-1).key, "task interni");
  assert.equal(ts.series.at(-1).slot, 7);
  // "steps" non include i task interni
  const steps = q.timeseries(local(2026, 10, 14), local(2026, 10, 16), { metric: "steps" });
  assert.ok(!steps.series.some((s) => s.key === "task interni"));
  assert.equal(steps.series.reduce((a, s) => a + s.total, 0), 4);
});

test("timeseries by=total: una sola serie «totale», più i task interni", () => {
  const { q } = seeded();
  const ts = q.timeseries(local(2026, 10, 14), local(2026, 10, 16), { metric: "tokens", by: "total" });
  assert.deepEqual(
    ts.series.map((s) => s.key),
    ["totale", "task interni"],
  );
  const byModel = q.timeseries(local(2026, 10, 14), local(2026, 10, 16), { metric: "tokens", by: "model" });
  const stepsOnly = (t) => t.series.filter((s) => s.key !== "task interni").reduce((a, s) => a + s.total, 0);
  assert.equal(ts.series[0].total, stepsOnly(byModel));
  assert.equal(ts.series[0].slot, 1);
});

test("timeseries con model: una sola serie per provider/modello, varianti insieme", () => {
  const { q } = seeded();
  const all = q.timeseries(local(2026, 10, 14), local(2026, 10, 16), { metric: "tokens", by: "model" });
  const ts = q.timeseries(local(2026, 10, 14), local(2026, 10, 16), { metric: "tokens", model: "lmstudio/qwen3.5-9b" });
  assert.equal(ts.unit, "hour");
  assert.deepEqual(ts.labels, all.labels);
  assert.deepEqual(
    ts.series.map((s) => s.key),
    ["lmstudio/qwen3.5-9b"],
  );
  const variants = all.series.filter((s) => s.key.split("#")[0] === "lmstudio/qwen3.5-9b");
  assert.equal(ts.series[0].total, variants.reduce((a, s) => a + s.total, 0));
  assert.equal(ts.series[0].values[ts.labels.indexOf("2026-10-15 00:00")], 300);
  const none = q.timeseries(local(2026, 10, 14), local(2026, 10, 16), { metric: "tokens", model: "x/nessuno" });
  assert.equal(none.series[0].total, 0);
});

test("timeseries giornaliero: il giorno è quello locale, non UTC", () => {
  const { q } = seeded();
  const ts = q.timeseries(local(2026, 10, 8), local(2026, 10, 18), { metric: "cost" });
  assert.equal(ts.unit, "day");
  assert.equal(ts.labels[0], "2026-10-08");
  assert.equal(ts.labels.at(-1), "2026-10-17");
  const qwen = ts.series.find((s) => s.key === "lmstudio/qwen3.5-9b");
  const tok = q.timeseries(local(2026, 10, 8), local(2026, 10, 18), { metric: "tokens" });
  const qwenTok = tok.series.find((s) => s.key === "lmstudio/qwen3.5-9b");
  assert.equal(qwenTok.values[tok.labels.indexOf("2026-10-15")], 300);
  assert.equal(qwenTok.values[tok.labels.indexOf("2026-10-14")], 0);
  assert.equal(qwen.total, 0);
  const sonnet = ts.series.find((s) => s.key === "anthropic/claude-sonnet-5-5");
  assert.ok(near(sonnet.values[ts.labels.indexOf("2026-10-14")], 0.01));
});

test("timeseries settimanale: settimane da lunedì in ora locale", () => {
  const store = memoryStore();
  // domenica 18/10 23:30 locale → settimana del 12; lunedì 19/10 00:30 locale (domenica in UTC) → settimana del 19
  addStep(store, { id: "sun", started: local(2026, 10, 18, 23, 30), ended: local(2026, 10, 18, 23, 31), tokens: tokens(10) });
  addStep(store, { id: "mon", started: local(2026, 10, 19, 0, 30), ended: local(2026, 10, 19, 0, 31), tokens: tokens(7) });
  const q = new Queries(store);
  const ts = q.timeseries(local(2026, 5, 1), local(2026, 10, 25));
  assert.equal(ts.unit, "week");
  assert.equal(ts.labels[0], "2026-04-27"); // il lunedì prima del 1° maggio
  assert.ok(ts.labels.every((l) => new Date(`${l}T12:00:00`).getDay() === 1), "ogni etichetta è un lunedì");
  const v = ts.series[0].values;
  assert.equal(v[ts.labels.indexOf("2026-10-12")], 10);
  assert.equal(v[ts.labels.indexOf("2026-10-19")], 7);
});

test("slot colore stabili e raggruppamento in \"altri\"", () => {
  const store = memoryStore();
  // 7 modelli: m1 ha più token di sempre, m7 meno
  for (let i = 1; i <= 7; i++) {
    addStep(store, { id: `old${i}`, model: `m${i}`, started: local(2026, 9, 1, 10), ended: local(2026, 9, 1, 10, 1), tokens: tokens(1000 * (8 - i)) });
  }
  // nel periodo scelto compaiono solo m3 (molto usato) e m7
  addStep(store, { id: "p3", model: "m3", started: local(2026, 10, 15, 10), ended: local(2026, 10, 15, 10, 1), tokens: tokens(50) });
  addStep(store, { id: "p7", model: "m7", started: local(2026, 10, 15, 11), ended: local(2026, 10, 15, 11, 1), tokens: tokens(80) });
  addInternal(store, { id: "ses_1:1", created: local(2026, 10, 15, 12), tokens: tokens(5) });
  const q = new Queries(store);

  const slots = q.slots("model");
  assert.deepEqual(slots, ["m1", "m2", "m3", "m4", "m5", "m6"].map((m) => `anthropic/${m}`));

  const ts = q.timeseries(local(2026, 10, 15), local(2026, 10, 16));
  assert.deepEqual(
    ts.series.map((s) => [s.key, s.slot, s.total]),
    [
      ["anthropic/m3", 3, 50], // conserva lo slot di sempre anche se nel periodo è il primo
      ["altri", "other", 80],
      ["task interni", 7, 5],
    ],
  );
  // la stessa entità ha lo stesso slot in un altro periodo
  const all = q.timeseries(local(2026, 9, 1), local(2026, 10, 16));
  assert.equal(all.series.find((s) => s.key === "anthropic/m3").slot, 3);
  assert.equal(all.series.find((s) => s.key === "altri").total, 1000 + 80);

  // OpenCode Monitor follows one model with `model`: outside the top 6 it still gets its own series
  const m7 = q.timeseries(local(2026, 10, 15), local(2026, 10, 16), { metric: "tokens", by: "model", model: "anthropic/m7" });
  assert.deepEqual(m7.labels, ts.labels);
  assert.deepEqual(
    m7.series.map((s) => [s.key, s.slot, s.total]),
    [["anthropic/m7", 1, 80]],
  );
  assert.equal(m7.series[0].values[m7.labels.indexOf("2026-10-15 11:00")], 80);
});

test("range: from=0 parte dal primo dato noto", () => {
  const { q } = seeded();
  const r = q.range(0, NaN);
  assert.equal(r.from, local(2026, 10, 1, 12) - 60_000);
  assert.ok(r.to > Date.now());
});

test("by con nomi di proprietà di Object (constructor, __proto__, toString): si usa il modello", () => {
  const { q } = seeded();
  const from = local(2026, 10, 14);
  const to = local(2026, 10, 16);
  const model = q.breakdown(from, to, "model");
  for (const by of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.deepEqual(q.breakdown(from, to, by), model, by);
    assert.deepEqual(q.timeseries(from, to, { by }).series, q.timeseries(from, to, { by: "model" }).series, by);
    assert.deepEqual(q.slots(by), q.slots("model"), by);
  }
});

test("/metrics: i counter contano solo step e tool finiti, quelli in corso sono gauge", () => {
  const { store, q } = seeded();
  addTool(store, { id: "t3", name: "read", status: "running", created: local(2026, 10, 15, 2), ended: null });
  addTool(store, { id: "t4", name: "read", status: "pending", created: local(2026, 10, 15, 2), ran: null, ended: null });
  const collector = { status: () => ({ state: "connected", lastEventAt: null, drift: [], duplicateEvents: 0 }) };
  const text = q.metrics(collector, local(2026, 10, 15, 2, 10));
  assert.doesNotMatch(text, /finish="running"/);
  assert.doesNotMatch(text, /opencode_lens_tool_calls_total\{[^}]*status="(running|pending)"/);
  assert.doesNotMatch(text, /opencode_lens_tool_output_bytes_total\{[^}]*status="(running|pending)"/);
  assert.match(text, /^opencode_lens_steps_total\{provider="anthropic",model="claude-sonnet-5-5",agent="build",finish="stop"\} 2$/m);
  assert.match(text, /^opencode_lens_steps_running\{provider="anthropic",model="claude-sonnet-5-5",agent="build"\} 1$/m);
  assert.match(text, /^opencode_lens_tool_calls_total\{tool="read",status="completed"\} 1$/m);
  assert.match(text, /^opencode_lens_tool_calls_running\{tool="read"\} 2$/m);
  store.close();
});

test("/metrics: step e tool rimasti a metà da più di 30 minuti escono dai gauge «in corso»", () => {
  const { store, q } = seeded();
  addTool(store, { id: "t3", name: "read", status: "running", created: local(2026, 10, 15, 2), ended: null });
  const collector = { status: () => ({ state: "connected", lastEventAt: null, drift: [], duplicateEvents: 0 }) };
  const text = q.metrics(collector, local(2026, 10, 16));
  assert.doesNotMatch(text, /^opencode_lens_steps_running\{/m);
  assert.doesNotMatch(text, /^opencode_lens_tool_calls_running\{/m);
  assert.match(text, /^opencode_lens_steps_total\{provider="anthropic",model="claude-sonnet-5-5",agent="build",finish="stop"\} 2$/m);
  store.close();
});

test("/metrics: uno step finito senza provider e modello non entra nei contatori finché il backfill non li scrive", () => {
  const store = memoryStore();
  const q = new Queries(store);
  const collector = { status: () => ({ state: "connected", lastEventAt: null, drift: [], duplicateEvents: 0 }) };
  const T = local(2026, 10, 15, 9);
  // only its end seen live (step.started lost in a reconnection): no provider, model or agent yet
  store.st.stepEnded.run({ id: "m1", session_id: "ses_1", at: T + 1000, finish: "stop", error_type: null, error_msg: null, cost: 0.01, t_in: 10, t_out: 5, t_reason: 0, t_cread: 0, t_cwrite: 0 });
  const series = (text) =>
    new Map(text.split("\n").filter((l) => /^opencode_lens_(steps_total|tokens_total|cost_usd_total|step_duration_seconds_(sum|count))\{/.test(l)).map((l) => [l.slice(0, l.lastIndexOf(" ")), Number(l.slice(l.lastIndexOf(" ") + 1))]));
  const before = series(q.metrics(collector, T + 5000));
  assert.deepEqual([...before.keys()].filter((k) => /provider="\?"|model="\?"/.test(k)), [], "nessuna serie ?/?");
  addStep(store, { id: "m1", started: T, ended: T + 1000, cost: 0.01, tokens: tokens(10, 5) });
  const after = series(q.metrics(collector, T + 5000));
  assert.match([...after.keys()].join("\n"), /opencode_lens_steps_total\{provider="anthropic",model="claude-sonnet-5-5",agent="build",finish="stop"\}/);
  // counters never go back: every series of the first scrape is still there, not lower
  for (const [k, v] of before) assert.ok((after.get(k) ?? -1) >= v, `${k}: ${v} → ${after.get(k)}`);
  store.close();
});

test("contextLimit: config prima, poi catalogo, variante tolta", () => {
  const catalog = { limit: (m) => (m === "openai/gpt-6.1-sol" ? { context: 628000, output: 1 } : m === "az/qwen" ? { context: 1, output: 1 } : null) };
  const opencodeModels = { current: () => ({ available: true, models: [{ model: "az/qwen", context: 32000 }] }) };
  const q = new Queries(memoryStore(), { opencodeModels, catalog });
  assert.equal(q.contextLimit("openai/gpt-6.1-sol#xhigh"), 628000);
  assert.equal(q.contextLimit("az/qwen#hi"), 32000);
  assert.equal(q.contextLimit("nope/x"), null);
  assert.equal(new Queries(memoryStore()).contextLimit("openai/gpt-6.1-sol"), null);
});

test("feed comprende i run chiusi", () => {
  const store = memoryStore();
  try {
    addSession(store, { id: "ses_1" });
    addSession(store, { id: "ses_sub", parent: "ses_1" });
    addRun(store, { id: "r1", session: "ses_1", started: 1000, ended: 5000, outcome: "failed" });
    addRun(store, { id: "r2", session: "ses_1", started: null, ended: 6000 });
    addRun(store, { id: "r3", session: "ses_sub", started: 1000, ended: 7000 });
    const runs = new Queries(store).feed(10).filter((i) => i.kind === "run").map((i) => ({ ...i }));
    assert.deepEqual(runs, [
      { at: 6000, kind: "run", sessionID: "ses_1", outcome: "succeeded", durationMs: null },
      { at: 5000, kind: "run", sessionID: "ses_1", outcome: "failed", durationMs: 4000 },
    ]);
  } finally {
    store.close();
  }
});

test("feed: compaction finite o fallite e nuove sessioni principali", () => {
  const store = memoryStore();
  try {
    addSession(store, { id: "ses_1", created: 1000 });
    addSession(store, { id: "ses_sub", parent: "ses_1", created: 2000 });
    addSession(store, { id: "ses_2", created: null });
    const sig = (id, type, created, detail) => store.st.signal.run({ id, type, session_id: "ses_1", message_id: null, created, detail: JSON.stringify(detail) });
    sig("c0", "session.compaction.started", 2500, { reason: "auto" });
    sig("c1", "session.compaction.ended", 3000, { reason: "auto", model: "anthropic/claude-sonnet-5-5" });
    sig("c2", "session.compaction.failed", 4000, { reason: "manual" });
    const items = new Queries(store).feed(10).map((i) => ({ ...i }));
    assert.deepEqual(items, [
      { at: 4000, kind: "compaction", sessionID: "ses_1", failed: true, reason: "manual", provider: null, model: null },
      { at: 3000, kind: "compaction", sessionID: "ses_1", failed: false, reason: "auto", provider: "anthropic", model: "claude-sonnet-5-5" },
      { at: 1000, kind: "session", sessionID: "ses_1" },
    ], "niente compaction iniziate, sessioni dei subagenti o senza data");
  } finally {
    store.close();
  }
});

const T0 = local(2026, 10, 15, 9);
const signal = (store, { id, type = "session.retry.scheduled", session = "ses_1", message = null, created, detail = {} }) =>
  store.st.signal.run({ id, type, session_id: session, message_id: message, created, detail: JSON.stringify(detail) });

/** Two failed steps on claude-opus (two sessions), a failed tool, two retries (one without message_id) and a failed execution. */
function seedErrors(store) {
  addSession(store, { id: "ses_1", directory: "/p" });
  addSession(store, { id: "ses_2", directory: "/q" });
  addSession(store, { id: "ses_sub", parent: "ses_2", directory: "/q" });
  const opus = { provider: "anthropic", model: "claude-opus", finish: "error", errorType: "provider.rate-limit", errorMsg: "Too many requests (HTTP 429)" };
  addStep(store, { id: "e1", session: "ses_1", started: T0, ended: T0 + 1000, ...opus });
  addStep(store, { id: "e2", session: "ses_2", started: T0 + 5000, ended: T0 + 6000, ...opus });
  store.db.prepare("UPDATE steps SET attempts = 3 WHERE id = 'e1'").run();
  addStep(store, { id: "ok", session: "ses_sub", provider: "openai", model: "gpt-6", started: T0 + 7000, ended: T0 + 8000 });
  addTool(store, { id: "t_err", session: "ses_1", message: "e1", name: "bash", status: "error", created: T0 + 200, ended: T0 + 300, errorMsg: "exit 1\nrm: denied" });
  const err = { error_type: "provider.rate-limit", error_msg: "x (HTTP 429)" };
  signal(store, { id: "r1", message: "e1", created: T0 + 500, detail: { attempt: 2, error: err } });
  signal(store, { id: "r2", session: "ses_2", created: T0 + 5500, detail: { attempt: 1, error: err } });
  signal(store, { id: "f1", type: "session.execution.failed", session: "ses_sub", created: T0 + 9000, detail: { error: { error_type: "provider.quota", error_msg: "quota (HTTP 402)" } } });
}

test("errors: step, tool, retry ed esecuzioni fallite raggruppati per modello, tipo e status", () => {
  const store = memoryStore();
  try {
    seedErrors(store);
    const e = new Queries(store).errors(T0 - 60_000, T0 + 60_000);
    assert.deepEqual(e.totals, { steps: 2, tools: 1, retries: 2, runs: 1 });
    const step = e.groups.find((g) => g.source === "step");
    assert.equal(step.model, "anthropic/claude-opus");
    assert.equal(step.type, "provider.rate-limit");
    assert.equal(step.status, 429);
    assert.equal(step.count, 2);
    assert.equal(step.sessions, 2);
    assert.equal(step.maxAttempt, 3);
    assert.equal(step.first, T0 + 1000);
    assert.equal(step.last, T0 + 6000);
    const retry = e.groups.find((g) => g.source === "retry");
    assert.equal(retry.count, 2, "il retry senza message_id va sull'ultimo step della sessione");
    assert.equal(retry.model, "anthropic/claude-opus");
    assert.equal(retry.status, 429);
    assert.equal(retry.maxAttempt, 2);
    const tool = e.groups.find((g) => g.source === "tool");
    assert.deepEqual([tool.tool, tool.model, tool.status, tool.count], ["bash", "anthropic/claude-opus", null, 1]);
    const run = e.groups.find((g) => g.source === "run");
    assert.deepEqual([run.model, run.type, run.status], ["openai/gpt-6", "provider.quota", 402]);
    assert.equal(e.groups[0].count, 2, "i gruppi più numerosi prima");
    assert.ok(e.groups.every((g) => g.samples === undefined), "niente testo senza text");
  } finally {
    store.close();
  }
});

test("errors: conteggi coerenti con summary() sullo stesso periodo", () => {
  const { store, q } = seeded();
  try {
    seedErrors(store);
    const from = local(2026, 10, 14);
    const to = local(2026, 10, 16);
    const s = q.summary(from, to);
    const e = q.errors(from, to);
    assert.equal(e.totals.steps, s.failedSteps);
    assert.equal(e.totals.tools, s.tools.errors);
    assert.equal(e.totals.retries, s.retries);
    assert.equal(e.totals.runs, s.failedRuns);
    assert.equal(e.groups.reduce((a, g) => a + g.count, 0), s.failedSteps + s.tools.errors + s.retries + s.failedRuns);
  } finally {
    store.close();
  }
});

test("errors: retry senza step né message_id → modello «?»; filtro per sessione con i subagenti e per directory; samples solo con text", () => {
  const store = memoryStore();
  try {
    seedErrors(store);
    signal(store, { id: "r_orphan", session: "ses_none", message: "missing", created: T0 + 100 });
    const q = new Queries(store);
    const all = q.errors(T0 - 60_000, T0 + 60_000);
    const orphan = all.groups.find((g) => g.source === "retry" && g.model === "?");
    assert.deepEqual([orphan.count, orphan.type, orphan.status], [1, "?", null]);
    const tree = q.errors(T0 - 60_000, T0 + 60_000, { sessionID: "ses_2" });
    assert.deepEqual(tree.totals, { steps: 1, tools: 0, retries: 1, runs: 1 }, "ses_2 e il suo subagente");
    assert.deepEqual(tree.scope, { sessionID: "ses_2", directory: null });
    const dir = q.errors(T0 - 60_000, T0 + 60_000, { directory: "/p" });
    assert.deepEqual(dir.totals, { steps: 1, tools: 1, retries: 1, runs: 0 });
    const text = q.errors(T0 - 60_000, T0 + 60_000, { text: true });
    const step = text.groups.find((g) => g.source === "step");
    assert.deepEqual(step.samples, [{ message: "Too many requests (HTTP 429)", count: 2 }]);
    assert.deepEqual(text.groups.find((g) => g.source === "tool").samples, [{ message: "exit 1\nrm: denied", count: 1 }]);
    assert.equal(q.errors(T0 - 60_000, T0 + 60_000, { limit: 2 }).groups.length, 2);
  } finally {
    store.close();
  }
});

test("errors: copertura parziale quando il periodo inizia prima del primo signal, nulla senza signals", () => {
  const store = memoryStore();
  try {
    const q = new Queries(store);
    assert.deepEqual(q.errors(T0, T0 + 1000).coverage, { signalsSince: null, partial: true });
    seedErrors(store);
    assert.deepEqual(q.errors(T0 - 60_000, T0 + 60_000).coverage, { signalsSince: T0 + 500, partial: true });
    assert.deepEqual(q.errors(T0 + 600, T0 + 60_000).coverage, { signalsSince: T0 + 500, partial: false });
  } finally {
    store.close();
  }
});

test("httpStatus: suffisso (HTTP n) in fondo, altrimenti null", () => {
  assert.equal(httpStatus("Too many requests (HTTP 429)"), 429);
  assert.equal(httpStatus("(HTTP 500) poi altro"), null);
  assert.equal(httpStatus("niente"), null);
  assert.equal(httpStatus(null), null);
});

test("timeseries orario nel giorno del ritorno all'ora solare: 25 bucket, le due 02:00 distinte", () => {
  // 25/10/2026, Europe/Rome: alle 03:00 CEST si torna alle 02:00 CET, l'ora 02:00 esiste due volte.
  const store = memoryStore();
  const first = Date.UTC(2026, 9, 25, 0, 30); // 02:30 CEST
  const second = Date.UTC(2026, 9, 25, 1, 30); // 02:30 CET
  addStep(store, { id: "cest", started: first, ended: first + 1000, tokens: tokens(100) });
  addStep(store, { id: "cet", started: second, ended: second + 1000, tokens: tokens(7) });
  addStep(store, { id: "after", started: second + 3_600_000, ended: second + 3_601_000, tokens: tokens(1) }); // 03:30 CET
  const q = new Queries(store);
  const from = local(2026, 10, 25);
  const to = local(2026, 10, 26);
  assert.equal((to - from) / 3_600_000, 25);
  const ts = q.timeseries(from, to, { metric: "tokens", by: "model" });
  assert.equal(ts.labels.length, 25);
  assert.equal(ts.labels[2], "2026-10-25 02:00");
  assert.equal(ts.labels[3], "2026-10-25 02:00");
  assert.equal(ts.labels[4], "2026-10-25 03:00");
  assert.equal(ts.labels.at(-1), "2026-10-25 23:00");
  const values = ts.series.find((s) => s.key === "anthropic/claude-sonnet-5-5").values;
  assert.deepEqual(values.slice(0, 6), [0, 0, 100, 7, 1, 0]);
  // la serie di un solo modello (OpenCode Monitor) segue gli stessi bucket
  const one = q.timeseries(from, to, { metric: "tokens", by: "model", model: "anthropic/claude-sonnet-5-5" });
  assert.equal(one.labels.length, 25);
  assert.deepEqual(one.series[0].values.slice(0, 6), [0, 0, 100, 7, 1, 0]);
});

test("timeseries orario nel giorno dell'ora legale: 23 bucket, le 02:00 non ci sono", () => {
  // 29/03/2026, Europe/Rome: alle 02:00 CET si passa alle 03:00 CEST.
  const store = memoryStore();
  const at = Date.UTC(2026, 2, 29, 1, 30); // 03:30 CEST
  addStep(store, { id: "x", started: at, ended: at + 1000, tokens: tokens(5) });
  const ts = new Queries(store).timeseries(local(2026, 3, 29), local(2026, 3, 30), { metric: "tokens", by: "model" });
  assert.equal(ts.labels.length, 23);
  assert.deepEqual(ts.labels.slice(0, 4), ["2026-03-29 00:00", "2026-03-29 01:00", "2026-03-29 03:00", "2026-03-29 04:00"]);
  assert.deepEqual(ts.series[0].values.slice(0, 4), [0, 0, 5, 0]);
});

test("breakdown: righe ordinate per token totali del gruppo, non per una riga a caso", () => {
  // x has the larger sum (5002) but its first and last rows are the smallest (1):
  // an ORDER BY on bare columns sees one row of the group and would put y (20 × 60) first.
  const store = memoryStore();
  const at = local(2026, 10, 15, 10);
  addStep(store, { id: "x1", model: "x", started: at, ended: at + 1, tokens: tokens(1) });
  addStep(store, { id: "x2", model: "x", started: at + 2, ended: at + 3, tokens: tokens(5000) });
  addStep(store, { id: "x3", model: "x", started: at + 4, ended: at + 5, tokens: tokens(1) });
  for (let i = 0; i < 20; i++) addStep(store, { id: `y${i}`, model: "y", started: at + 10 + i, ended: at + 11 + i, tokens: tokens(0, 0, 0, 60) });
  const rows = new Queries(store).breakdown(local(2026, 10, 15), local(2026, 10, 16), "model");
  assert.deepEqual(
    rows.map((r) => [r.key, r.tokens.total]),
    [
      ["anthropic/x", 5002],
      ["anthropic/y", 1200],
    ],
  );
});

test("metrics: le famiglie extra compaiono nel testo Prometheus", () => {
  const { q } = seeded();
  const collector = { status: () => ({ state: "connected", lastEventAt: null, drift: [], duplicateEvents: 0 }) };
  const now = local(2026, 10, 15, 2, 10);
  const extra = [
    { name: "opencode_lens_security_events", type: "gauge", help: "Events in the audit", samples: [{ labels: { guard: 'g"x', outcome: "blocked" }, value: 3 }] },
    { name: "opencode_lens_empty", type: "gauge", help: "nothing", samples: [] },
  ];
  const text = q.metrics(collector, now, extra);
  assert.match(text, /^# HELP opencode_lens_security_events Events in the audit$/m);
  assert.match(text, /^# TYPE opencode_lens_security_events gauge$/m);
  assert.match(text, /^opencode_lens_security_events\{guard="g\\"x",outcome="blocked"\} 3$/m);
  assert.doesNotMatch(text, /opencode_lens_empty/);
  assert.equal(q.metrics(collector, now), q.metrics(collector, now, []));
  assert.ok(q.families(collector, now, extra).some((f) => f.name === "opencode_lens_security_events"));
});

test("sessions: i task interni della riga sono quelli del periodo, non all-time", () => {
  const store = memoryStore();
  addSession(store, { id: "ses_1", created: 900 });
  addStep(store, { id: "msg_periodo", started: 1000, ended: 2000, cost: 0.001, tokens: tokens(100, 0, 0, 0, 0) });
  addInternal(store, { id: "ses_1:1", created: 1500, cost: 0.0005, tokens: tokens(35, 0, 0, 0, 0) });
  addInternal(store, { id: "ses_1:2", created: 400, cost: 0.0007, tokens: tokens(77, 0, 0, 0, 0) });
  const q = new Queries(store);
  const rows = q.sessions(500, 2500);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].internalTokens, 35);
  assert.ok(near(rows[0].internalCost, 0.0005));
});

// --- skill_uses resta del core: le metriche delle skill (la pagina è del modulo Skill) ---
function skillStore() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", directory: "/a", created: 500 });
  addSession(store, { id: "ses_2", directory: "/b", created: 900 });
  return store;
}
const use = (store, id, row) => store.skillUse({ session_id: "ses_1", status: "completed", origin: "lens", ...row, id });

test("metriche: contatori delle skill e dei preset, native comprese", () => {
  const store = skillStore();
  use(store, "1", { at: 1, channel: "skill", skill_id: "alfa" });
  use(store, "2", { at: 2, channel: "skill", skill_id: "alfa", origin: "native" });
  use(store, "3", { at: 3, channel: "skill", skill_id: "alfa", status: "error" });
  use(store, "4", { at: 4, channel: "lens-preset", preset_id: "web" });
  use(store, "5", { at: 5, channel: "lens-preset", preset_id: "web", status: "error" });
  const fams = new Queries(store).families({ status: () => ({ state: "connected", drift: [] }) }, 10);
  const loads = fams.find((f) => f.name === "opencode_lens_skill_loads_total");
  assert.equal(loads.type, "counter");
  assert.deepEqual(loads.samples.map((s) => [s.labels.origin, s.value]).sort(), [["lens", 1], ["native", 1]]);
  const pre = fams.find((f) => f.name === "opencode_lens_skill_preset_loads_total");
  assert.deepEqual(pre.samples, [{ labels: { preset: "web", channel: "lens-preset" }, value: 1 }]);
});

// ---------- keyset pages (F-19): `after` instead of an offset ----------

/** 12 sessions with steps at different times, two pairs sharing their last step's time. */
function manySessions() {
  const store = memoryStore();
  const T = local(2026, 10, 10, 9);
  for (let i = 0; i < 12; i++) {
    const id = `ses_${String(i).padStart(2, "0")}`;
    addSession(store, { id, created: T });
    const last = T + (i === 5 || i === 9 ? i - 1 : i) * 60_000; // 5 ties with 4, 9 with 8
    addStep(store, { id: `${id}_a`, session: id, started: last - 30_000, ended: last - 20_000, tokens: tokens(10) });
    addStep(store, { id: `${id}_b`, session: id, started: last - 5000, ended: last, tokens: tokens(10) });
  }
  return { store, q: new Queries(store), from: T - 3_600_000, to: T + 3_600_000 };
}

const walkSessions = (q, from, to, limit, byCursor) => {
  const ids = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    const rows = byCursor ? q.sessions(from, to, limit, 0, after) : q.sessions(from, to, limit, page * limit);
    ids.push(...rows.map((r) => r.id));
    if (rows.length < limit) break;
    after = { last: rows.at(-1).last, id: rows.at(-1).id };
  }
  return ids;
};

test("sessions con after: lo stesso elenco del walk con offset, anche con last uguali", () => {
  const { q, from, to } = manySessions();
  const all = q.sessions(from, to, 100).map((r) => r.id);
  assert.equal(all.length, 12);
  for (const limit of [1, 2, 5, 12]) {
    assert.deepEqual(walkSessions(q, from, to, limit, true), all, `limit ${limit}`);
    assert.deepEqual(walkSessions(q, from, to, limit, false), all);
  }
});

test("sessions: una sessione che risale tra due pagine dà un doppione con l'offset, nessuno col cursore", () => {
  for (const byCursor of [false, true]) {
    const { store, q, from, to } = manySessions();
    const first = q.sessions(from, to, 4, 0);
    // a session of the second page gets a new step: it is now the most recent
    const moved = q.sessions(from, to, 4, 4)[1].id;
    addStep(store, { id: `${moved}_new`, session: moved, started: to - 20_000, ended: to - 10_000, tokens: tokens(1) });
    const second = byCursor ? q.sessions(from, to, 4, 0, { last: first.at(-1).last, id: first.at(-1).id }) : q.sessions(from, to, 4, 4);
    const ids = [...first, ...second].map((r) => r.id);
    if (byCursor) assert.equal(new Set(ids).size, ids.length, "no duplicate with the cursor");
    else assert.ok(new Set(ids).size < ids.length, "the offset repeats the last session of the first page");
  }
});

/** 9 runs of three sessions, ties on the end and on tokens, some failed or with a tool error. */
function manyRuns() {
  const store = memoryStore();
  const T = local(2026, 10, 10, 9);
  for (const s of ["ses_a", "ses_b", "ses_c"]) addSession(store, { id: s, created: T });
  let k = 0;
  for (let i = 0; i < 9; i++) {
    const session = ["ses_a", "ses_b", "ses_c"][i % 3];
    const ended = T + Math.floor(i / 2) * 600_000 + 300_000; // pairs of runs ending together
    const started = i === 4 ? null : ended - (i % 4) * 60_000 - 60_000;
    addRun(store, { id: `run_${i}`, session, started, ended, outcome: i === 2 ? "failed" : "succeeded" });
    const at = ended - 30_000;
    addStep(store, { id: `st_${k++}`, session, started: at, ended: at + 1000, tokens: tokens(i % 3 === 0 ? 100 : 100 + i) });
    if (i === 6) addTool(store, { id: "t_err", session, message: `st_${k - 1}`, name: "bash", status: "error", created: at + 100, ended: at + 200, errorMsg: "x" });
  }
  return { store, q: new Queries(store), from: T - 3_600_000, to: T + 10 * 3_600_000 };
}

test("runs con after: recent, tokens, duration e problemi danno l'elenco completo e ordinato", () => {
  const { q, from, to } = manyRuns();
  for (const [sort, problems] of [["recent", false], ["tokens", false], ["duration", false], ["recent", true], ["tokens", true]]) {
    const all = q.runs(from, to, { limit: 100, sort, problems }).map((r) => r.id);
    assert.equal(all.length, problems ? 2 : 9, `${sort} ${problems}`);
    for (const limit of [1, 2, 4]) {
      const ids = [];
      let after = null;
      for (let page = 0; page < 20; page++) {
        const rows = q.runs(from, to, { limit, sort, problems, after });
        ids.push(...rows.map((r) => r.id));
        if (rows.length < limit) break;
        const last = rows.at(-1);
        after = { ended: last.ended, id: last.id, v: sort === "tokens" ? last.tokens.total : last.durationMs ?? -1 };
      }
      assert.deepEqual(ids, all, `${sort} problems=${problems} limit=${limit}`);
    }
  }
});
