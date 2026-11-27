// The module's «Vibe Coding» data on a rich store, against the answers the core's Queries.vibeCoding gave on the same
// store when the module was written (vibe-queries.expected.json, recorded before the core's copy was removed): the
// same answer for a day, seven days and all time, with a local reset hour, a UTC one and none, with and without a
// monthly cost budget. Fixed time zone, not UTC: a time-zone slip moves a step to another day and the comparison sees it.
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { addPrompt, addSession, addStep, addTool, check, memoryStore, moduleContext, Queries, rangeKeys, recorded } from "../../../test/module-test-kit.js";
import { estimateRows, vibeCoding, WORK_GAP_MS } from "../server/vibe-queries.js";

const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const MIN = 60_000;
const DAY = 86_400_000;
const NOW = local(2026, 10, 20, 15, 30);
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const BUDGET = { tokens: null, cost: 50, steps: null };
const tk = (input, output = 0, reasoning = 0, read = 0, write = 0) => ({ input, output, reasoning, cache: { read, write } });

/**
 * Forty days of work: a session with a subagent and a sub-subagent (prompts in both, user's and dispatch), a second
 * folder, a session without a folder ('?'), a step of a session the sessions table does not know, a subagent whose
 * parent is missing, steps still running, steps longer than WORK_GAP_MS, and a night that crosses midnight, the
 * UTC reset (05:00 local in October) and the local one at 05:00.
 */
function richStore() {
  const store = memoryStore();
  addSession(store, { id: "alpha", directory: "/w/alpha", title: "Alpha" });
  addSession(store, { id: "alpha_sub", parent: "alpha", directory: "/w/alpha", title: "Subagente" });
  addSession(store, { id: "alpha_sub_sub", parent: "alpha_sub", directory: "/w/beta" });
  addSession(store, { id: "beta", directory: "/w/beta", title: "Beta" });
  addSession(store, { id: "nodir", directory: null });
  addSession(store, { id: "night", directory: "/w/gamma", title: "Notte" });
  addSession(store, { id: "lost_sub", parent: "missing", directory: "/w/gamma" });
  const sessions = ["alpha", "alpha_sub", "alpha_sub_sub", "beta", "nodir", "lost_sub", "ghost"];
  const models = [
    ["anthropic", "claude-sonnet-5-5"],
    ["anthropic", "claude-opus-5-5"],
    ["lmstudio", "qwen"],
  ];
  let seed = 7;
  const rnd = (n) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };
  let n = 0;
  for (let d = 0; d < 40; d++) {
    const base = local(2026, 10, 20) - d * DAY;
    for (let k = 0, steps = 2 + rnd(5); k < steps; k++) {
      const session = sessions[rnd(sessions.length)];
      const [provider, model] = models[rnd(models.length)];
      const at = base + (8 + rnd(12)) * 3_600_000 + rnd(60) * MIN;
      if (at > NOW) continue;
      const running = rnd(9) === 0;
      const ms = rnd(4) === 0 ? 40 * MIN : (1 + rnd(20)) * 30_000;
      n++;
      addStep(store, {
        id: `s${n}`,
        session,
        provider,
        model,
        started: at,
        ended: running ? null : at + ms,
        cost: running ? null : rnd(300) / 100,
        tokens: running ? null : tk(100 + rnd(5000), rnd(800), rnd(50), rnd(20_000), rnd(900)),
      });
      if (rnd(3) === 0) addTool(store, { id: `t${n}`, session, message: `s${n}`, name: ["read", "bash", "edit"][rnd(3)], status: "completed", created: at + 1000, ended: at + 2000 });
      if (rnd(4) === 0) addPrompt(store, { id: `p${n}`, session, created: at - rnd(20) * MIN });
    }
  }
  // the night of 17-18 October: across midnight, 05:00 (UTC reset = 03:00 UTC, and the local reset at 05:00)
  const night = [
    [local(2026, 10, 17, 23, 40), 25 * MIN],
    [local(2026, 10, 18, 0, 10), 10 * MIN],
    [local(2026, 10, 18, 2, 50), 15 * MIN],
    [local(2026, 10, 18, 4, 50), 20 * MIN],
    [local(2026, 10, 18, 5, 20), 2 * MIN],
  ];
  for (const [i, [at, ms]] of night.entries()) addStep(store, { id: `night${i}`, session: "night", started: at, ended: at + ms, cost: 0.5, tokens: tk(2000, 300) });
  addPrompt(store, { id: "night_p", session: "night", created: local(2026, 10, 17, 23, 35) });
  // a pause of exactly WORK_GAP_MS between two steps: a break, not work
  addSession(store, { id: "edge", directory: "/w/beta" });
  addStep(store, { id: "edge0", session: "edge", started: local(2026, 10, 19, 10, 0), ended: local(2026, 10, 19, 10, 1), cost: 0.1, tokens: tk(100) });
  addStep(store, { id: "edge1", session: "edge", started: local(2026, 10, 19, 10, 31), ended: local(2026, 10, 19, 10, 32), cost: 0.1, tokens: tk(100) });
  // more sessions than the ten of topSessions
  for (let i = 0; i < 6; i++) {
    addSession(store, { id: `extra${i}`, directory: `/w/extra${i % 2}` });
    addStep(store, { id: `extra${i}`, session: `extra${i}`, started: local(2026, 10, 16, 9 + i), ended: local(2026, 10, 16, 9 + i, 5), cost: 0.2, tokens: tk(500 + i) });
  }
  // today, minutes ago: in the one-day period whatever the reset
  addStep(store, { id: "today0", session: "alpha", started: NOW - 20 * MIN, ended: NOW - 18 * MIN, cost: 1.25, tokens: tk(4000, 500, 20, 9000, 100) });
  addPrompt(store, { id: "today_p", session: "alpha", created: NOW - 22 * MIN });
  addPrompt(store, { id: "today_dispatch", session: "alpha_sub", created: NOW - 17 * MIN });
  addStep(store, { id: "today1", session: "alpha_sub", started: NOW - 16 * MIN, ended: NOW - 10 * MIN, cost: 0.75, tokens: tk(3000, 200) });
  addStep(store, { id: "today2", session: "nodir", started: NOW - 5 * MIN, tokens: null });
  return store;
}

/** The module's ctx on one rich store (and the Queries it is built on), with `reset` (none: midnight), `monthlyLimits` and `modelPrices` (LENS_MODEL_PRICES). */
function setup({ reset, monthlyLimits, modelPrices, store = richStore() } = {}) {
  const queries = new Queries(store, { ...(reset && { reset }), ...(monthlyLimits && { monthlyLimits }) });
  const config = { dbPath: ":memory:", scanIntervalMs: 60_000, ...(reset && { reset }), ...(modelPrices && { modelPrices }) };
  const ctx = moduleContext({ id: "vibecoding", config, store, collector: COLLECTOR, queries, log: QUIET });
  return { store, queries, ctx, config };
}

const CASES = {
  "reset locale alle 5, budget mensile": { reset: { hour: 5, utc: false }, monthlyLimits: BUDGET },
  "reset UTC alle 3, budget mensile": { reset: { hour: 3, utc: true }, monthlyLimits: BUDGET },
  "mezzanotte, senza budget": {},
};

// the core's answers, recorded once: case → period → answer
const EXPECTED = JSON.parse(fs.readFileSync(new URL("./vibe-queries.expected.json", import.meta.url), "utf8"));
// an answer as /api/vibe-coding sends it: plain JSON (the rows of node:sqlite have a null prototype)
const wire = (v) => JSON.parse(JSON.stringify(v));
// the answer without what came after the recording (the estimated cost, tested on its own below)
const NEW_KEYS = new Set(["pricing", "estimated", "unpriced"]);
// a folder's models gained their cost (spent) too
const recordedShape = (v) =>
  JSON.parse(
    JSON.stringify(v, function (k, x) {
      return NEW_KEYS.has(k) || (k === "cost" && "model" in this) ? undefined : x;
    }),
  );

for (const [name, options] of Object.entries(CASES)) {
  test(`vibeCoding del modulo = la risposta registrata di Queries.vibeCoding del core (${name}): un giorno, sette giorni, tutto`, () => {
    const { store, queries, ctx } = setup(options);
    try {
      const periods = {
        "un giorno": queries.dayRange(NOW),
        "sette giorni": { from: NOW - 7 * DAY, to: NOW + MIN },
        "tutto (from=0)": { from: 0, to: NOW + MIN },
        "tutto come lo legge ctx.range": ctx.range(new URLSearchParams(`from=0&to=${NOW + MIN}`)),
      };
      for (const [label, { from, to }] of Object.entries(periods)) {
        const got = vibeCoding(ctx, from, to, NOW);
        assert.deepEqual(recordedShape(got), EXPECTED[name][label], label);
        // the fixture really holds what the comparison is about
        assert.ok(got.totals.steps > 0 && got.totals.prompts > 0 && got.totals.workingMs > 0, `${label}: dati nel periodo`);
        assert.ok(got.byDirectory.some((f) => f.directory === "?"), `${label}: cartella «?»`);
        assert.equal(got.monthBudget === null, !options.monthlyLimits, `${label}: budget mensile`);
        if (label !== "un giorno") {
          assert.ok(got.totals.subagents >= 2 && got.byDay.length > 1, `${label}: subagent e più giorni`);
          assert.ok(got.byDirectory.some((f) => f.directory === "/w/gamma" && f.daily.length >= 2), `${label}: la notte a cavallo di due giorni`);
        }
      }
      assert.notEqual(vibeCoding(ctx, NOW - 7 * DAY, NOW + MIN, NOW).previous, null, "sette giorni: c'è il periodo precedente");
      assert.ok(vibeCoding(ctx, 0, NOW + MIN, NOW).totals.sessions > 10, "tutto: più sessioni di quelle in topSessions");
      // in the first days of the month the forecast window starts in the month before
      const early = local(2026, 10, 5, 12);
      assert.deepEqual(recordedShape(vibeCoding(ctx, early - 7 * DAY, early, early)), EXPECTED[name]["inizio del mese"], "inizio del mese");
    } finally {
      store.close();
    }
  });
}

test("vibeCoding del modulo: gapMs è WORK_GAP_MS, 30 minuti come nel core", () => {
  const { store, ctx } = setup();
  try {
    assert.equal(WORK_GAP_MS, 30 * MIN);
    assert.equal(vibeCoding(ctx, 0, NOW + MIN, NOW).gapMs, WORK_GAP_MS);
  } finally {
    store.close();
  }
});

test("piani: le letture del modulo cercano gli indici delle loro chiavi di intervallo", () => {
  const { store, queries, config } = setup({ reset: { hour: 5, utc: false }, monthlyLimits: BUDGET });
  try {
    const keys = rangeKeys(store.db);
    // the reader judges each text with EXPLAIN before preparing it: those are not the module's queries
    const sqls = recorded(store.db, (db) => vibeCoding(moduleContext({ id: "vibecoding", config, store: { db }, collector: COLLECTOR, queries, log: QUIET }), NOW - DAY, NOW + MIN, NOW)).filter((sql) => !/^EXPLAIN\b/.test(sql));
    let found = 0;
    const problems = [];
    for (const sql of sqls) {
      const r = check(store.db, sql, keys);
      found += r.found;
      for (const p of r.problems) problems.push(`${p}\n${sql}\n${r.plan.join("\n")}`);
    }
    assert.deepEqual(problems, []);
    assert.ok(found >= 10, `${found} query con un intervallo su una chiave, almeno 10`);
  } finally {
    store.close();
  }
});

// USD per million tokens, as loadConfig parses LENS_MODEL_PRICES; qwen (lmstudio) has no price
const price = (model, input, output, cacheRead, cacheWrite) => ({ model, provider: model.split("/")[0], name: model.split("/")[1], input, output, cacheRead, cacheWrite });
const PRICES = [price("anthropic/claude-sonnet-5-5", 3, 15, 0.3, 3.75), price("anthropic/claude-opus-5-5", 5, 25, 0.5, 6.25)];
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} ≠ ${b}`);
const sumOf = (list, key) => list.reduce((a, x) => a + x[key], 0);

test("stimato: la variante prende il prezzo del modello, uno step senza provider è «senza prezzo»", () => {
  const store = memoryStore();
  addSession(store, { id: "a", directory: "/p1" });
  addSession(store, { id: "b", directory: "/p2" });
  addStep(store, { id: "high", session: "a", provider: "anthropic", model: "x", variant: "high", started: local(2026, 10, 18, 10), ended: local(2026, 10, 18, 10, 1), tokens: tk(1000, 200, 50, 4000, 100) });
  addStep(store, { id: "plain", session: "a", provider: "anthropic", model: "z", started: local(2026, 10, 19, 10), ended: local(2026, 10, 19, 10, 1), tokens: tk(2000, 100), cost: 0.25 });
  addStep(store, { id: "noprov", session: "b", model: "y", started: local(2026, 10, 19, 11), ended: local(2026, 10, 19, 11, 1), tokens: tk(500, 50) });
  store.db.prepare("UPDATE steps SET provider = NULL WHERE id = 'noprov'").run();
  addStep(store, { id: "qwen", session: "b", provider: "lmstudio", model: "qwen", started: local(2026, 10, 19, 12), ended: local(2026, 10, 19, 12, 1), tokens: tk(300) });
  const { ctx } = setup({ store, modelPrices: [price("anthropic/x", 3, 15, 0.3, 3.75), price("anthropic/z", 3, 15, 0.3, 3.75)] });
  try {
    const got = wire(vibeCoding(ctx, local(2026, 10, 18), local(2026, 10, 20), NOW));
    // by hand: (1000×3 + (200+50)×15 + 4000×0.3 + 100×3.75) / 1e6 and (2000×3 + 100×15) / 1e6
    const high = 8325 / 1e6;
    const plain = 7500 / 1e6;
    assert.deepEqual(got.pricing, { empty: false });
    near(got.totals.estimated, high + plain, "totale");
    assert.equal(got.totals.unpriced, 550 + 300);
    const model = (key) => got.byModel.find((m) => m.model === key);
    near(model("anthropic/x#high").estimated, high, "variante high");
    near(model("anthropic/z").estimated, plain, "senza variante");
    assert.deepEqual([model("?/y").estimated, model("?/y").unpriced], [null, 550]);
    assert.deepEqual([model("lmstudio/qwen").estimated, model("lmstudio/qwen").unpriced], [null, 300]);
    const p1 = got.byDirectory.find((f) => f.directory === "/p1");
    const p2 = got.byDirectory.find((f) => f.directory === "/p2");
    near(p1.estimated, high + plain, "/p1");
    assert.deepEqual(p1.daily.map((d) => [d.day, d.unpriced]), [["2026-10-18", 0], ["2026-10-19", 0]]);
    near(p1.daily[0].estimated, high, "/p1 il 18");
    // a folder with no priced model: nothing estimated, every token counted apart
    assert.deepEqual([p2.estimated, p2.unpriced], [0, 850]);
    assert.deepEqual(p2.models.map((m) => [m.model, m.estimated, m.unpriced]), [["?/y", null, 550], ["lmstudio/qwen", null, 300]]);
    // what each model spent, next to its estimate (the detail derives how it is paid from both)
    assert.deepEqual(p1.models.map((m) => [m.model, m.cost]).sort(), [["anthropic/x#high", 0], ["anthropic/z", 0.25]]);
    // the helper Task 8 reads: folder → day → model key
    const rows = estimateRows(ctx, local(2026, 10, 18), local(2026, 10, 20), ctx.time.MIDNIGHT);
    near(rows.get("/p1").get("2026-10-18").get("anthropic/x#high").estimated, high, "estimateRows, variante");
    assert.deepEqual(rows.get("/p2").get("2026-10-19").get("?/y"), { estimated: null, unpriced: 550 });
  } finally {
    store.close();
  }
});

test("estimateRows: lo stesso modello con e senza variante, o di un altro provider, sono righe distinte", () => {
  const store = memoryStore();
  addSession(store, { id: "a", directory: "/p" });
  const at = local(2026, 10, 18, 10);
  addStep(store, { id: "high", session: "a", provider: "anthropic", model: "x", variant: "high", started: at, ended: at + MIN, tokens: tk(1000) });
  addStep(store, { id: "plain", session: "a", provider: "anthropic", model: "x", started: at + 2 * MIN, ended: at + 3 * MIN, tokens: tk(2000) });
  addStep(store, { id: "other", session: "a", provider: "openrouter", model: "x", started: at + 4 * MIN, ended: at + 5 * MIN, tokens: tk(400) });
  const { ctx } = setup({ store, modelPrices: [price("anthropic/x", 3, 15, 0.3, 3.75)] });
  try {
    const day = estimateRows(ctx, local(2026, 10, 18), local(2026, 10, 19), ctx.time.MIDNIGHT).get("/p").get("2026-10-18");
    assert.deepEqual(Object.fromEntries(day), {
      "anthropic/x#high": { estimated: 3000 / 1e6, unpriced: 0 },
      "anthropic/x": { estimated: 6000 / 1e6, unpriced: 0 },
      "openrouter/x": { estimated: null, unpriced: 400 },
    });
  } finally {
    store.close();
  }
});

test("stimato per modello: lo stesso nome con e senza variante e di un altro provider resta su righe distinte che sommano al totale", () => {
  const store = memoryStore();
  addSession(store, { id: "a", directory: "/p" });
  addSession(store, { id: "b", directory: "/q" });
  const at = local(2026, 10, 18, 10);
  addStep(store, { id: "high", session: "a", provider: "anthropic", model: "x", variant: "high", started: at, ended: at + MIN, tokens: tk(1000, 100) });
  addStep(store, { id: "plain", session: "a", provider: "anthropic", model: "x", started: at + 2 * MIN, ended: at + 3 * MIN, tokens: tk(2000) });
  addStep(store, { id: "other", session: "a", provider: "openrouter", model: "x", started: at + 4 * MIN, ended: at + 5 * MIN, tokens: tk(400) });
  addStep(store, { id: "q", session: "b", provider: "anthropic", model: "x", started: at + 6 * MIN, ended: at + 7 * MIN, tokens: tk(300) });
  const { ctx } = setup({ store, modelPrices: [price("anthropic/x", 3, 15, 0.3, 3.75)] });
  try {
    const got = wire(vibeCoding(ctx, local(2026, 10, 18), local(2026, 10, 19), NOW));
    assert.deepEqual(got.byModel.map((m) => [m.model, m.steps, m.tokens, m.unpriced]).sort(), [
      ["anthropic/x#high", 1, 1100, 0],
      ["anthropic/x", 2, 2300, 0],
      ["openrouter/x", 1, 400, 400],
    ]);
    near(got.totals.estimated, (1000 * 3 + 100 * 15 + 2000 * 3 + 300 * 3) / 1e6, "totale");
    near(sumOf(got.byModel.filter((m) => m.estimated !== null), "estimated"), got.totals.estimated, "Σ modelli = totale");
    assert.equal(sumOf(got.byModel, "unpriced"), got.totals.unpriced);
    for (const f of got.byDirectory) {
      near(sumOf(f.models.filter((m) => m.estimated !== null), "estimated"), f.estimated, `${f.directory}: Σ modelli`);
      assert.equal(sumOf(f.models, "tokens"), f.tokens, `${f.directory}: token dei modelli`);
    }
    assert.deepEqual(got.byDirectory.find((f) => f.directory === "/p").models.map((m) => m.model).sort(), ["anthropic/x", "anthropic/x#high", "openrouter/x"]);
  } finally {
    store.close();
  }
});

test("stimato sul fixture ricco: totale = token × prezzi step per step, i token di qwen «senza prezzo», nessun doppio conteggio", () => {
  const options = { reset: { hour: 5, utc: false } };
  const { store, ctx } = setup({ ...options, modelPrices: PRICES });
  const { store: plainStore, ctx: plainCtx } = setup(options);
  try {
    // by hand, from the steps themselves
    const byKey = new Map(PRICES.map((p) => [p.model, p]));
    let estimated = 0;
    let unpriced = 0;
    for (const r of store.db.prepare("SELECT provider, model, t_in, t_out, t_reason, t_cread, t_cwrite FROM steps").all()) {
      const p = byKey.get(`${r.provider}/${r.model}`);
      const [i, o, re, cr, cw] = [r.t_in, r.t_out, r.t_reason, r.t_cread, r.t_cwrite].map((n) => n ?? 0);
      if (p) estimated += (i * p.input + (o + re) * p.output + cr * p.cacheRead + cw * p.cacheWrite) / 1e6;
      else unpriced += i + o + re + cr + cw;
    }
    assert.ok(estimated > 0 && unpriced > 0, "il fixture ha modelli con e senza prezzo");
    const all = wire(vibeCoding(ctx, 0, NOW + MIN, NOW));
    near(all.totals.estimated, estimated, "totale");
    assert.equal(all.totals.unpriced, unpriced);

    const got = wire(vibeCoding(ctx, NOW - 7 * DAY, NOW + MIN, NOW));
    const plain = wire(vibeCoding(plainCtx, NOW - 7 * DAY, NOW + MIN, NOW));
    near(sumOf(got.byDirectory, "estimated"), got.totals.estimated, "cartelle = totale");
    near(sumOf(got.byModel.filter((m) => m.estimated !== null), "estimated"), got.totals.estimated, "modelli = totale");
    assert.equal(sumOf(got.byModel, "unpriced"), got.totals.unpriced);
    for (const [i, f] of got.byDirectory.entries()) {
      near(sumOf(f.daily, "estimated"), f.estimated, `${f.directory}: giorni`);
      assert.equal(sumOf(f.daily, "unpriced"), f.unpriced, `${f.directory}: giorni senza prezzo`);
      near(sumOf(f.models.filter((m) => m.estimated !== null), "estimated"), f.estimated, `${f.directory}: modelli`);
      // the same days and sessions as without a price list
      assert.deepEqual(f.daily.map((d) => [d.day, d.sessions, d.tokens]), plain.byDirectory[i].daily.map((d) => [d.day, d.sessions, d.tokens]), f.directory);
    }
    assert.equal(got.totals.sessions, plain.totals.sessions);
    // the previous period: what vibeCoding says of that period
    near(got.previous.estimated, wire(vibeCoding(ctx, got.previous.from, got.previous.to, NOW)).totals.estimated, "periodo precedente");
    assert.equal(got.previous.unpriced, wire(vibeCoding(ctx, got.previous.from, got.previous.to, NOW)).totals.unpriced);
    // the month's calendar days: the same days as without prices, each with a number
    for (const [i, f] of got.month.byDirectory.entries()) {
      assert.deepEqual(f.daily.map((d) => [d.day, d.sessions]), plain.month.byDirectory[i].daily.map((d) => [d.day, d.sessions]), `mese ${f.directory}`);
      assert.ok(f.daily.every((d) => typeof d.estimated === "number" && Number.isInteger(d.unpriced)), `mese ${f.directory}: stimato`);
    }
  } finally {
    store.close();
    plainStore.close();
  }
});

test("stimato con il listino vuoto: null ovunque, nessun token «senza prezzo», pricing.empty", () => {
  const { store, ctx } = setup({ reset: { hour: 5, utc: false } });
  try {
    const got = wire(vibeCoding(ctx, NOW - 7 * DAY, NOW + MIN, NOW));
    assert.deepEqual(got.pricing, { empty: true });
    const places = [
      got.totals,
      got.previous,
      ...got.byDirectory,
      ...got.byDirectory.flatMap((f) => [...f.daily, ...f.models]),
      ...got.byModel,
      ...got.month.byDirectory.flatMap((f) => f.daily),
    ];
    assert.ok(places.length > 20);
    for (const x of places) assert.deepEqual([x.estimated, x.unpriced], [null, 0], JSON.stringify(x));
    assert.equal(estimateRows(ctx, 0, NOW + MIN, ctx.time.MIDNIGHT).size, 0);
  } finally {
    store.close();
  }
});
