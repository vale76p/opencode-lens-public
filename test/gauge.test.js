// Lettura del widget gauge: budget dal /api/budget, percentuali dal riepilogo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GAUGE_LABELS, GAUGE_SOURCES, budgetLevel, gaugeReading } from "../public/gauge.js";

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const period = (used, limit, projectedRatio = null) => ({ used, limit, ratio: limit ? used / limit : null, projected: null, projectedRatio, pace: "none" });

test("GAUGE_SOURCES: nove budget, il budget di un modello e tre percentuali", () => {
  assert.equal(GAUGE_SOURCES.length, 13);
  assert.equal(GAUGE_SOURCES[9], "budget-model");
  assert.equal(GAUGE_SOURCES[0], "budget-day-tokens");
  assert.deepEqual(GAUGE_SOURCES.slice(-3), ["cache", "failed-steps", "tool-errors"]);
});

test("gaugeReading: budget con proiezione e livelli 80% / 100%", () => {
  const budget = { periods: { week: { tokens: { used: 32e6, limit: 50e6, ratio: 0.64, projected: 40.5e6, projectedRatio: 0.81 } } } };
  assert.deepEqual(pick(gaugeReading("budget-week-tokens", { budget }), ["kind", "ratio", "used", "limit", "level", "projectedRatio", "unit"]), {
    kind: "budget",
    ratio: 0.64,
    used: 32e6,
    limit: 50e6,
    level: "good",
    projectedRatio: 0.81,
    unit: "tokens",
  });
  const at = (used) => gaugeReading("budget-month-cost", { budget: { periods: { month: { cost: period(used, 100) } } } });
  assert.equal(at(85).level, "warning");
  assert.equal(at(102).level, "critical");
  assert.equal(at(102).unit, "cost");
  const none = gaugeReading("budget-day-steps", { budget: { periods: { day: { steps: period(40, null) } } } });
  assert.deepEqual(pick(none, ["ratio", "level", "used", "limit"]), { ratio: null, level: "none", used: 40, limit: null });
});

test("gaugeReading: percentuali dal riepilogo del periodo", () => {
  const summary = { steps: 200, failedSteps: 12, cacheRate: 0.34, tools: { calls: 200, errors: 12 } };
  assert.deepEqual(pick(gaugeReading("cache", { summary }), ["kind", "ratio", "level", "unit"]), { kind: "percent", ratio: 0.34, level: "neutral", unit: null });
  assert.equal(gaugeReading("tool-errors", { summary }).ratio, 0.06);
  assert.equal(gaugeReading("tool-errors", { summary }).level, "warning");
  assert.equal(gaugeReading("failed-steps", { summary: { ...summary, failedSteps: 4 } }).level, "good");
  assert.equal(gaugeReading("failed-steps", { summary: { ...summary, failedSteps: 40 } }).level, "critical");
  const empty = { steps: 0, failedSteps: 0, cacheRate: null, tools: { calls: 0, errors: 0 } };
  for (const s of ["cache", "failed-steps", "tool-errors"]) assert.equal(gaugeReading(s, { summary: empty }).ratio, null, s);
});

test("gaugeReading: budget giornaliero di un modello", () => {
  const budget = { periods: { day: { models: [{ model: "az/qwen", used: 85, limit: 100, ratio: 0.85, projected: 170, projectedRatio: 1.7, pace: "over", seen: true }] } } };
  const g = gaugeReading("budget-model", { budget, model: "az/qwen" });
  assert.deepEqual(pick(g, ["kind", "ratio", "used", "limit", "projectedRatio", "unit", "level", "missing"]), {
    kind: "budget", ratio: 0.85, used: 85, limit: 100, projectedRatio: 1.7, unit: "tokens", level: "warning", missing: false,
  });
  const gone = gaugeReading("budget-model", { budget, model: "az/llama" });
  assert.deepEqual(pick(gone, ["kind", "limit", "missing"]), { kind: "budget", limit: null, missing: true });
  assert.equal(gaugeReading("budget-model", { budget }).missing, true, "nessun modello scelto");
  assert.equal(g.seen, true);
  const typo = { periods: { day: { models: [{ model: "az/qwen3coder", used: 0, limit: 100, ratio: 0, projected: null, projectedRatio: null, pace: "under", seen: false }] } } };
  const unseen = gaugeReading("budget-model", { budget: typo, model: "az/qwen3coder" });
  assert.deepEqual(pick(unseen, ["seen", "level"]), { seen: false, level: "none" }, "un modello mai visto non è «verde»");
  assert.ok(GAUGE_SOURCES.includes("budget-model"));
  assert.equal(GAUGE_LABELS["budget-model"], "Budget giornaliero di un modello");
});

test("gaugeReading: fonte sconosciuta o dati mancanti → nessun valore", () => {
  assert.equal(gaugeReading("budget-year-tokens", { budget: { periods: {} } }).ratio, null);
  assert.equal(gaugeReading("cache", {}).ratio, null);
});

test("budgetLevel: una sola regola per i budget, dall'80% avviso, dal 100% critico", () => {
  assert.deepEqual([null, 0, 0.79, 0.8, 0.99, 1, 1.4].map(budgetLevel), ["none", "good", "good", "warning", "warning", "critical", "critical"]);
});
