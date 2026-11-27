// Adattatori puri dalle API agli ingressi dei modelli, su corpi prodotti dal vero livello di query.
process.env.TZ = "Europe/Rome";

import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetAllInput, budgetInput, daysInput, hoursInput, kpiInput, lanesInput, modelsInput, othersLabel, promptsInput, rhythmInput, runsInput, seriesInput, seriesName, statusInput, summaryInput } from "../public/adapt.js";
import { quantile } from "../public/ui.js";
import { Queries } from "../src/queries.js";
import { addInternal, addPrompt, addRun, addSession, addStep, memoryStore, tokens } from "./helpers.js";

const at = (s) => new Date(s).getTime();
const NOW = at("2026-10-15T12:00");
const ML = (model, limit) => ({ model, provider: model.slice(0, model.indexOf("/")), name: model.slice(model.indexOf("/") + 1), limit });
const SLOTS = { model: ["az/qwen", "az/llama"] };
const slotFor = (by, key) => {
  const i = (SLOTS[by] ?? []).indexOf(key);
  return i >= 0 ? i + 1 : "other";
};

function seeded() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", title: "Refactor del collector" });
  addSession(store, { id: "ses_2" });
  const step = (id, session, model, when, t, extra = {}) =>
    addStep(store, { id, session, provider: "az", model, started: at(when), ended: at(when) + 60_000, tokens: t, cost: 1, ...extra });
  const timed = (when) => ({ requested: at(when), firstOutput: at(when) + 2000, streamed: at(when) + 10_000 });
  // the two days before today: the 7-day average and the daily series
  step("y1", "ses_1", "qwen", "2026-10-14T09:00", tokens(1000, 100, 0, 800, 0), timed("2026-10-14T09:00"));
  step("y2", "ses_1", "llama", "2026-10-13T10:00", tokens(400, 50));
  // today
  step("a", "ses_1", "qwen", "2026-10-15T00:10", tokens(500, 50));
  step("b", "ses_1", "qwen", "2026-10-15T09:00", tokens(2000, 200, 0, 6000, 0), timed("2026-10-15T09:00"));
  step("c", "ses_2", "llama", "2026-10-15T10:00", tokens(300, 30));
  step("d", "ses_2", "qwen", "2026-10-15T10:30", tokens(100, 10), { finish: "error" });
  addInternal(store, { id: "i", created: at("2026-10-15T09:30"), tokens: tokens(50) });
  addPrompt(store, { id: "p1", session: "ses_1", created: at("2026-10-15T08:59") });
  addRun(store, { id: "r1", session: "ses_1", started: at("2026-10-15T08:59"), ended: at("2026-10-15T09:20") });
  addRun(store, { id: "r2", session: "ses_1", started: at("2026-10-15T11:00"), ended: at("2026-10-15T11:30"), outcome: "interrupted", reason: "user" });
  addRun(store, { id: "r3", session: "ses_2", started: null, ended: at("2026-10-15T10:40"), outcome: "failed" });
  return store;
}

const DAY = [at("2026-10-15T00:00"), at("2026-10-16T00:00")];

test("«altri» dice che cosa raggruppa: modelli, agenti, provider…", () => {
  assert.equal(othersLabel("model"), "altri modelli");
  assert.equal(othersLabel("agent"), "altri agenti");
  assert.equal(othersLabel("provider"), "altri provider");
  assert.equal(othersLabel("boh"), "altre voci");
  assert.equal(seriesName("altri", "agent"), "altri agenti");
  assert.equal(seriesName("build", "agent"), "build");
  const s = seriesInput({ by: "model", labels: ["x"], series: [{ key: "altri", slot: "other", values: [1] }] }, () => 1);
  assert.deepEqual([s.series[0].key, s.series[0].label, s.series[0].slot], ["altri", "altri modelli", "other"]);
});

test("statusInput: l'ultimo evento non è nel testo ma nel suggerimento; senza eventi dice «nessun evento ricevuto finora»", () => {
  const items = statusInput({ state: "connected", server: { version: "2" } }, null, 1000).items;
  assert.equal(items[0].sub, undefined, "nessuna riga sotto il titolo");
  assert.equal(items[0].tip, "nessun evento ricevuto finora");
  const out = statusInput({ state: "connected", lastEventAt: 1000 - 12_000 }, null, 1000).items[0];
  assert.equal(out.sub, undefined);
  assert.equal(out.tip, "ultimo evento 12 s fa");
});

test("summaryInput: token con i task interni, velocità, numeri finiti, null senza corpo", () => {
  assert.equal(summaryInput(null), null);
  assert.equal(summaryInput("x"), null);
  const store = seeded();
  const sum = new Queries(store).summary(...DAY, NOW);
  const s = summaryInput(sum);
  assert.equal(s.tokens, sum.tokens.total + sum.internal.tokens.total);
  assert.equal(s.kinds.input, sum.tokens.input + sum.internal.tokens.input);
  assert.equal(s.internalTokens, sum.internal.tokens.total);
  assert.ok(s.internalTokens > 0, "il task interno del fixture");
  assert.equal(s.steps, 4);
  assert.equal(s.failedSteps, 1);
  assert.equal(s.sessions, 2);
  assert.ok(s.cacheRate > 0 && s.cacheRate < 1);
  assert.equal(s.latency.n, sum.latencyMs.n);
  assert.deepEqual(s.tools, { calls: 0, errors: 0 });
  // the speed: from the steps with timings (two in the fixture), finite or null
  assert.deepEqual(s.speed, { ttft: { p50: sum.speed.ttftMs.p50, p95: sum.speed.ttftMs.p95 }, tps: sum.speed.tokensPerSec.p50 });
  assert.ok(s.speed.ttft.p50 > 0 && s.speed.tps > 0, JSON.stringify(s.speed));
  store.close();
  // a body without the fields: zeros and nulls, never NaN
  const bare = summaryInput({});
  assert.equal(bare.tokens, 0);
  assert.deepEqual(bare.kinds, { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(bare.cacheRate, null);
  assert.deepEqual(bare.latency, { p50: null, p95: null, n: 0 });
  assert.deepEqual(bare.tools, { calls: 0, errors: 0 });
  assert.deepEqual(bare.speed, { ttft: { p50: null, p95: null }, tps: null });
  assert.deepEqual(summaryInput({ speed: { ttftMs: { p50: Number.NaN, p95: "x" }, tokensPerSec: {} } }).speed, { ttft: { p50: null, p95: null }, tps: null });
});

test("hoursInput: ore fino a quella corrente, poi null", () => {
  const store = seeded();
  const h = hoursInput(new Queries(store).hourly(7, NOW), NOW);
  assert.equal(h.labels.length, 24);
  assert.equal(h.nowIdx, 12);
  assert.equal(h.today.length, 24);
  assert.equal(h.today[0], 550);
  assert.equal(h.today[9], 8200 + 50);
  assert.equal(h.today[12], 0);
  assert.equal(h.today[13], null);
  assert.equal(h.avg.length, 24);
  assert.ok(h.soFarAvg > 0);
  store.close();
});

test("hoursInput: solo l'ora 0", () => {
  const store = seeded();
  const now = at("2026-10-15T00:20");
  const h = hoursInput(new Queries(store).hourly(7, now), now);
  assert.equal(h.nowIdx, 0);
  assert.equal(h.today[0], 550);
  assert.ok(h.today.slice(1).every((v) => v === null));
  store.close();
});

test("seriesInput: etichetta senza provider, slot dal lookup, altri e task interni fissi", () => {
  const store = seeded();
  const ts = new Queries(store).timeseries(...DAY, { metric: "tokens", by: "model", top: 1 });
  const s = seriesInput(ts, slotFor);
  assert.equal(s.unit, "hour");
  assert.equal(s.labels.length, 24);
  const byKey = Object.fromEntries(s.series.map((x) => [x.key, x]));
  assert.equal(byKey["az/qwen"].label, "qwen");
  assert.equal(byKey["az/qwen"].slot, 1);
  assert.equal(byKey.altri.slot, "other");
  assert.equal(byKey["task interni"].slot, 7);
  assert.equal(byKey["task interni"].label, "task interni");
  assert.equal(byKey["az/qwen"].values.length, 24);
  store.close();
});

test("seriesInput: nessuna serie", () => {
  assert.deepEqual(seriesInput({ unit: "day", labels: [], series: [] }, slotFor), { labels: [], unit: "day", series: [] });
  assert.deepEqual(seriesInput(null, slotFor).series, []);
});

test("daysInput: ttft e prompt dal vero /api/daily", () => {
  const store = seeded();
  const days = daysInput(new Queries(store).daily(3, NOW));
  assert.deepEqual(days.map((d) => d.date), ["2026-10-13", "2026-10-14", "2026-10-15"]);
  const today = days[2];
  assert.equal(today.runs, 3);
  assert.equal(today.failedRuns, 1);
  assert.equal(typeof today.from, "number");
  assert.equal(today.ttft.p50, 2000);
  assert.equal(days[0].ttft.p50, null);
  assert.deepEqual(today.tools, { calls: 0, errors: 0 });
  store.close();
});

test("daysInput: ttft null e campi mancanti", () => {
  const [d] = daysInput({ days: [{ date: "2026-10-15", from: 1, tokens: 5, cost: 0, cacheRate: null, runs: 0, ttft: { p50: null, p95: null } }] });
  assert.deepEqual(d.ttft, { p50: null, p95: null });
  assert.equal(d.failedRuns, 0);
  assert.equal(d.cacheRate, null);
  assert.deepEqual(d.tools, { calls: 0, errors: 0 });
  assert.deepEqual(daysInput({ days: [{ date: "x" }] })[0].ttft, { p50: null, p95: null });
  assert.deepEqual(daysInput(null), []);
});

test("budgetInput: limite, proiezione, reset e giorni del mese", () => {
  const store = seeded();
  const q = new Queries(store, { limits: { tokens: 100_000, cost: null, steps: null }, monthlyLimits: { tokens: 50_000, cost: null, steps: null } });
  const b = q.budget(NOW);
  const day = budgetInput(b, "day", NOW);
  assert.equal(day.period, "day");
  assert.equal(day.used, 550 + 8200 + 50 + 330 + 110);
  assert.equal(day.limit, 100_000);
  assert.equal(day.resetAt, at("2026-10-16T00:00"));
  assert.equal(day.ratio, day.used / 100_000);
  assert.equal(day.projected, b.periods.day.tokens.projected);
  assert.equal(day.projectedRatio, b.periods.day.tokens.projectedRatio);
  assert.ok(day.projectedRatio > day.ratio);
  assert.equal(day.timeLeftMs, 12 * 3_600_000);
  assert.equal(day.spanMs, 24 * 3_600_000);
  assert.equal(day.days, undefined);
  const month = budgetInput(b, "month", NOW, q.daily(15, NOW));
  assert.equal(month.limit, 50_000);
  assert.equal(month.days.length, 15);
  assert.equal(month.days.at(-1).date, "2026-10-15");
  assert.equal(month.days.at(-1).used, day.used);
  store.close();
});

test("budgetInput: step e costo dalla stessa risposta, il default resta i token", () => {
  const store = seeded();
  const limits = { tokens: 100_000, cost: 10, steps: 20 };
  const q = new Queries(store, { limits, weeklyLimits: limits, monthlyLimits: limits });
  const b = q.budget(NOW);
  const tokensDay = budgetInput(b, "day", NOW);
  assert.equal(tokensDay.metric, "tokens");
  assert.deepEqual(budgetInput(b, "day", NOW, null, "tokens"), tokensDay, "«tokens» esplicito = nessuna metrica");
  const steps = budgetInput(b, "day", NOW, null, "steps");
  assert.equal(steps.metric, "steps");
  assert.equal(steps.used, 4, "i quattro step di oggi");
  assert.equal(steps.limit, 20);
  assert.equal(steps.ratio, b.periods.day.steps.ratio);
  assert.equal(steps.projected, b.periods.day.steps.projected);
  const cost = budgetInput(b, "day", NOW, null, "cost");
  assert.equal(cost.used, b.periods.day.cost.used);
  assert.ok(cost.used >= 4, "un dollaro per step");
  assert.equal(cost.limit, 10);
  assert.equal(cost.timeLeftMs, tokensDay.timeLeftMs);
  // C1: the days of the period in the same metric
  const month = budgetInput(b, "month", NOW, q.daily(15, NOW), "steps");
  assert.equal(month.days.at(-1).used, 4);
  assert.equal(month.days.find((d) => d.date === "2026-10-14").used, 1);
  const all = budgetAllInput(b, NOW, "cost");
  assert.deepEqual(Object.values(all).map((p) => [p.metric, p.limit]), [["cost", 10], ["cost", 10], ["cost", 10]]);
  assert.equal(budgetAllInput(b, NOW).week.metric, "tokens");
  store.close();
});

test("budgetInput: senza limite (budget spento)", () => {
  const store = seeded();
  const b = new Queries(store).budget(NOW);
  const w = budgetInput(b, "week", NOW);
  assert.equal(w.limit, null);
  assert.equal(w.ratio, null);
  assert.equal(w.projectedRatio, null);
  assert.ok(w.used > 0);
  const all = budgetAllInput(b, NOW);
  assert.deepEqual(Object.keys(all), ["day", "week", "month"]);
  assert.equal(all.month.limit, null);
  store.close();
});

test("modelsInput: per token, etichetta, slot, limite e ratio dal budget", () => {
  const store = seeded();
  const q = new Queries(store, { modelLimits: [ML("az/qwen", 20_000)] });
  const rows = modelsInput(q.breakdown(...DAY, "model"), q.budget(NOW), slotFor);
  assert.deepEqual(rows.map((r) => r.label), ["qwen", "llama"]);
  const [qwen, llama] = rows;
  assert.equal(qwen.slot, 1);
  assert.equal(qwen.tokens.total, 550 + 8200 + 110);
  assert.equal(qwen.limit, 20_000);
  assert.equal(qwen.ratio, qwen.tokens.total / 20_000);
  assert.equal(llama.limit, null);
  assert.equal(llama.ratio, null);
  assert.equal(qwen.deltaRatio, null, "senza prev");
  assert.equal(qwen.steps, 3);
  assert.equal(qwen.failed, 1);
  assert.equal(qwen.speed.ttftMs.p50, 2000);
  assert.equal(llama.speed, null, "llama non ha tempi");
  store.close();
});

test("modelsInput: delta contro il periodo prima, senza budget", () => {
  const store = seeded();
  const q = new Queries(store);
  const prev = q.breakdown(at("2026-10-14T00:00"), at("2026-10-15T00:00"), "model");
  const rows = modelsInput(q.breakdown(...DAY, "model"), undefined, slotFor, prev);
  const qwen = rows.find((r) => r.label === "qwen");
  assert.equal(qwen.deltaRatio, (qwen.tokens.total - 1900) / 1900);
  assert.equal(qwen.limit, null);
  assert.equal(rows.find((r) => r.label === "llama").deltaRatio, null, "llama non c'era ieri");
  store.close();
});

test("modelsInput: breakdown vuoto", () => {
  const store = memoryStore();
  const q = new Queries(store);
  assert.deepEqual(modelsInput(q.breakdown(...DAY, "model"), q.budget(NOW), slotFor), []);
  assert.deepEqual(modelsInput(undefined, undefined, slotFor), []);
  store.close();
});

test("kpiInput: token con delta sull'ora, banda e serie giornaliera", () => {
  const store = seeded();
  const q = new Queries(store);
  const summary = q.summary(...DAY, NOW);
  const k = kpiInput("tokens", summary, q.daily(7, NOW), q.hourly(7, NOW));
  assert.equal(k.metric, "tokens");
  assert.equal(k.value, summary.tokens.total);
  assert.equal(k.caption, "token oggi");
  assert.equal(k.series.length, 7);
  assert.equal(k.series.at(-1), 9240);
  assert.equal(k.delta.dir, "up");
  assert.ok(k.band.lo <= k.band.hi);
  store.close();
});

test("kpiInput: cache, ttft e giornata senza dati", () => {
  const empty = memoryStore();
  const q = new Queries(empty);
  const e = kpiInput("cache", q.summary(...DAY, NOW), q.daily(7, NOW), q.hourly(7, NOW));
  assert.equal(e.value, null);
  assert.equal(e.display, "–");
  assert.equal(e.delta, null);
  assert.deepEqual(e.series, []);
  assert.equal(e.band, null);
  empty.close();

  const store = seeded();
  const q2 = new Queries(store);
  const args = [q2.summary(...DAY, NOW), q2.daily(7, NOW), q2.hourly(7, NOW)];
  const c = kpiInput("cache", ...args);
  assert.ok(c.value > 0 && c.value <= 1);
  assert.match(c.display, /%$/);
  const t = kpiInput("ttft", ...args);
  assert.equal(t.value, 2000);
  assert.equal(t.display, "2 s");
  store.close();
});

// /api/daily bodies made by hand: the earlier days, then today (the last entry), so far
const dayOf = (i, cost, runs, cacheRate = 0.5) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, from: i, tokens: cost * 1000, cost, cacheRate, runs, failedRuns: 0, ttft: { p50: 1000 }, tools: { calls: 0, errors: 0 } });
const DAILY = { days: [dayOf(0, 80, 8), dayOf(1, 100, 10), dayOf(2, 120, 12), dayOf(3, 140, 14), dayOf(4, 30, 3, 0.9)] };
const MORNING = { soFarAvg: 25_000, dayAvg: 100_000 }; // a quarter of a typical day's tokens done by now
const EVENING = { soFarAvg: 90_000, dayAvg: 100_000 };

test("kpiInput: costo e prompt di oggi contro la stessa parte dei giorni prima, di mattina e di sera", () => {
  const today = { cost: 30, cacheRate: 0.9 };
  // the mean of the earlier days is 110 $ and 11 prompts: at a quarter of the day, 27,5 $ and 2,75
  const cost = kpiInput("cost", today, DAILY, MORNING);
  assert.equal(cost.baseline, "hour");
  assert.equal(cost.delta.dir, "up", "30 $ alle prime ore valgono più di un quarto di 110 $");
  assert.ok(Math.abs(cost.delta.ratio - (30 - 27.5) / 27.5) < 1e-9);
  assert.equal(kpiInput("prompts", today, DAILY, MORNING).delta.dir, "up");
  assert.equal(kpiInput("cost", today, DAILY, EVENING).delta.dir, "down", "di sera: 30 $ contro 99 $");
  assert.equal(kpiInput("prompts", today, DAILY, EVENING).delta.dir, "down");
  // no hour profile: no delta for an additive metric, never today against whole days
  // (also when the earlier days had whole-day tokens but none by this hour: share 0 is no baseline)
  for (const h of [null, { soFarAvg: 0, dayAvg: 0 }, { soFarAvg: 0, dayAvg: 100_000 }]) {
    for (const metric of ["cost", "tokens"]) {
      const k = kpiInput(metric, today, DAILY, h);
      assert.equal(k.delta, null, `${metric} ${JSON.stringify(h)}`);
      assert.equal(k.baseline, null);
      assert.equal(k.bandNow, null, `${metric} ${JSON.stringify(h)}`);
    }
  }
  // a rate does not grow with the hour: the earlier days as they are
  const cache = kpiInput("cache", today, DAILY, MORNING);
  assert.equal(cache.baseline, "days");
  assert.ok(Math.abs(cache.delta.ratio - (0.9 - 0.5) / 0.5) < 1e-9);
  assert.deepEqual(cache.bandNow, cache.band);
});

test("kpiInput: la fascia normale è dei giorni prima, senza il parziale di oggi; a quest'ora la stessa in scala", () => {
  const k = kpiInput("cost", { cost: 30 }, DAILY, MORNING);
  const earlier = [80, 100, 120, 140];
  assert.deepEqual(k.band, { lo: quantile(earlier, 0.25), hi: quantile(earlier, 0.75) });
  assert.deepEqual(k.bandNow, { lo: k.band.lo / 4, hi: k.band.hi / 4 });
  assert.deepEqual(k.series, [80, 100, 120, 140, 30], "la serie disegnata ha anche oggi");
  // a rate missing today (no calls yet) does not take yesterday for today
  const noRate = { days: [...DAILY.days.slice(0, -2), { ...DAILY.days.at(-2), cacheRate: 0.9 }, { ...DAILY.days.at(-1), cacheRate: null }] };
  const c = kpiInput("cache", { cacheRate: null }, noRate, MORNING);
  assert.equal(c.value, null);
  assert.equal(kpiInput("cache", { cacheRate: 0.6 }, noRate, MORNING).delta.dir, "flat", "la media dei quattro giorni prima (0,6), ieri compreso");
});

test("kpiInput: le metriche del widget kpi (prompt ed errori dei tool)", () => {
  const store = seeded();
  const q = new Queries(store);
  const args = [q.summary(...DAY, NOW), q.daily(7, NOW), q.hourly(7, NOW)];
  // «prompts» is the layout's name of the prompts of the day: the models know it as «runs»
  assert.deepEqual(kpiInput("prompts", ...args), kpiInput("runs", ...args));
  const sum = args[0];
  const e = kpiInput("toolErrors", ...args);
  assert.equal(e.metric, "toolErrors");
  assert.equal(e.value, sum.tools.calls ? sum.tools.errors / sum.tools.calls : null);
  assert.equal(e.caption, "chiamate tool con errore");
  assert.match(e.display, /%$|^–$/);
  // a day without calls has no rate: out of the series, not a zero
  assert.equal(e.series.length, daysInput(args[1]).filter((d) => d.tools.calls > 0).length);
  store.close();
});

test("kpiInput: primo token contro la fascia dei giorni prima, senza scala sull'ora", () => {
  const ttft = (ms) => ({ ttft: { p50: ms } });
  const daily = { days: [1000, 1200, 1400, 1600].map((ms, i) => ({ ...dayOf(i, 100, 10), ...ttft(ms) })).concat({ ...dayOf(4, 30, 3), ...ttft(2000) }) };
  const k = kpiInput("ttft", { speed: { ttftMs: { p50: 2000 } } }, daily, MORNING);
  assert.equal(k.metric, "ttft");
  assert.equal(k.display, "2 s");
  assert.equal(k.caption, "primo token (mediana)");
  assert.equal(k.short, null, "la didascalia corta la fanno i modelli");
  assert.equal(k.baseline, "days", "una mediana non cresce con l'ora");
  assert.ok(Math.abs(k.delta.ratio - (2000 - 1300) / 1300) < 1e-9);
  assert.deepEqual(k.band, { lo: quantile([1000, 1200, 1400, 1600], 0.25), hi: quantile([1000, 1200, 1400, 1600], 0.75) });
  assert.deepEqual(k.bandNow, k.band);
  assert.deepEqual(k.series, [1000, 1200, 1400, 1600, 2000]);
});

test("kpiInput: retry di oggi con quelli per limite di frequenza, contro la stessa parte dei giorni prima", () => {
  const daily = { days: [4, 8, 12, 16].map((n, i) => ({ ...dayOf(i, 100, 10), retries: n, rateLimited: n / 2 })).concat({ ...dayOf(4, 30, 3), retries: 6, rateLimited: 2 }) };
  const k = kpiInput("retries", { retries: 6, rateLimited: 2 }, daily, MORNING);
  assert.equal(k.metric, "retries");
  assert.equal(k.value, 6);
  assert.equal(k.display, "6");
  assert.equal(k.caption, "retry di oggi · di cui 2 per limite di frequenza");
  assert.equal(k.short, "retry, di cui 2 per 429", "la parte dei 429 resta anche nella carta stretta");
  // the earlier days' mean is 10: a quarter of the day gives 2,5
  assert.equal(k.baseline, "hour");
  assert.ok(Math.abs(k.delta.ratio - (6 - 2.5) / 2.5) < 1e-9);
  assert.deepEqual(k.series, [4, 8, 12, 16, 6]);
  assert.deepEqual(k.bandNow, { lo: k.band.lo / 4, hi: k.band.hi / 4 });
  // no retries today: 0, never «–»; a summary without the field reads 0 for the rate limits
  const none = kpiInput("retries", { retries: 0 }, daily, MORNING);
  assert.equal(none.display, "0");
  assert.equal(none.caption, "retry di oggi · di cui 0 per limite di frequenza");
});

test("daysInput: retry e retry per limite di frequenza, 0 quando mancano", () => {
  const [d] = daysInput({ days: [{ date: "2026-10-19", retries: 3, rateLimited: 1 }] });
  assert.equal(d.retries, 3);
  assert.equal(d.rateLimited, 1);
  const [old] = daysInput({ days: [{ date: "2026-10-19" }] });
  assert.equal(old.retries, 0, "una lens più vecchia non manda i retry");
  assert.equal(old.rateLimited, 0);
});

const GOOD = { state: "connected", server: { version: "2.0.32" }, lastEventAt: NOW - 30_000, scan: { running: false, lastEnd: NOW, error: null }, drift: [], counts: { sessions: 2149 } };

test("statusInput: senza deriva né modelli sopra budget, 2 voci", () => {
  const store = seeded();
  const out = statusInput(GOOD, new Queries(store, { modelLimits: [ML("az/qwen", 1e9)] }).budget(NOW), NOW);
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items.map((i) => i.level), ["good", "good"]);
  assert.equal(out.items[0].title, "Collegato a OpenCode 2.0.32");
  assert.match(out.items[0].tip, /30 s fa/);
  assert.equal(out.items[1].title, "Sincronizzazione completa");
  assert.match(out.items[1].sub, /^2149 sessioni/);
  store.close();
});

test("statusInput: deriva e modello sopra budget, nell'ordine del mockup", () => {
  const store = seeded();
  const budget = new Queries(store, { modelLimits: [ML("az/qwen", 1000)] }).budget(NOW);
  const out = statusInput({ ...GOOD, drift: [{ type: "session.step.ended", count: 3, missing: ["tokens"], sample: null }] }, budget, NOW);
  assert.deepEqual(out.items.map((i) => i.level), ["good", "good", "warn", "bad"]);
  assert.equal(out.items[2].title, "Deriva dell'API");
  assert.equal(out.items[2].sub, "1 campo mancante in session.step.ended");
  assert.equal(out.items[3].title, "Budget di qwen superato");
  assert.equal(out.items[3].sub, "886% · 8,9k di 1k");
  store.close();
});

test("statusInput: disconnesso e sync fallita", () => {
  const out = statusInput({ state: "disconnected", lastError: "ECONNREFUSED", scan: { error: "boom" }, drift: [] }, null);
  assert.deepEqual(out.items.map((i) => i.level), ["bad", "bad"]);
  assert.equal(out.items[0].sub, "ECONNREFUSED");
  assert.equal(out.items[1].sub, "boom");
});

test("rhythmInput: massimo e somme per ora", () => {
  const store = seeded();
  const r = rhythmInput(new Queries(store).rhythm(28, NOW));
  assert.equal(r.cells.length, 7);
  assert.equal(r.cells[0].length, 24);
  assert.equal(r.max, Math.max(...r.cells.flat()));
  assert.equal(r.hourSums.length, 24);
  assert.equal(r.hourSums.reduce((a, b) => a + b, 0), r.cells.flat().reduce((a, b) => a + b, 0));
  assert.equal(r.promptHourSums[8], 1);
  const none = rhythmInput(null);
  assert.equal(none.max, 0);
  assert.equal(none.hourSums.length, 24);
  store.close();
});

test("runsInput e lanesInput dai run veri con la serie degli step", () => {
  const store = seeded();
  const rows = new Queries(store).runs(...DAY, { steps: true });
  const runs = runsInput(rows);
  assert.equal(runs.length, 3);
  const byId = Object.fromEntries(runs.map((r) => [r.id, r]));
  assert.equal(byId.r1.outcomeLabel, "riuscito");
  assert.equal(byId.r1.outcomeKind, "ok");
  assert.equal(byId.r2.outcomeLabel, "interrotto · da te");
  assert.equal(byId.r3.outcomeKind, "err");
  assert.equal(byId.r1.outcome, "succeeded", "il grezzo resta");
  assert.equal(runsInput(undefined).length, 0);

  const lanes = lanesInput(rows, NOW);
  assert.equal(lanes.now, NOW);
  assert.equal(lanes.from, at("2026-10-15T08:59"));
  assert.equal(lanes.to, at("2026-10-15T11:30"));
  assert.deepEqual(lanes.lanes.map((l) => [l.sessionID, l.title, l.slot, l.runs.length]), [["ses_1", "Refactor del collector", 1, 2], ["ses_2", "ses_2", 2, 1]]);
  const [r1] = lanes.lanes[0].runs;
  assert.deepEqual([r1.started, r1.ended], [at("2026-10-15T08:59"), at("2026-10-15T09:20")]);
  assert.deepEqual(r1.steps, [at("2026-10-15T09:00")], "solo gli step dentro il prompt");
  assert.deepEqual(r1.steps, [...r1.steps].sort((a, b) => a - b));
  const r3 = lanes.lanes[1].runs[0];
  assert.equal(r3.started, r3.ended, "senza inizio: un punto");
  store.close();
});

test("lanesInput: scarta gli step fuori da [started, ended]", () => {
  const run = { sessionID: "s", started: 100, ended: 200, stepSeries: [{ started: 50 }, { started: 100 }, { started: 150 }, { started: 200 }, { started: 250 }] };
  assert.deepEqual(lanesInput([run], 300).lanes[0].runs[0].steps, [100, 150, 200]);
});

test("lanesInput: nessun run", () => {
  assert.deepEqual(lanesInput([], NOW), { from: NOW, to: NOW, now: NOW, lanes: [], shown: 0, total: 0 });
});

test("lanesInput: l'asse parte dall'inizio del giorno dei budget, e il campione sa quanti run ha il giorno", () => {
  const store = seeded();
  const rows = new Queries(store).runs(...DAY, { steps: true });
  const lanes = lanesInput(rows, NOW, { from: DAY[0], total: 898 });
  assert.equal(lanes.from, DAY[0], "non dal primo run arrivato (08:59)");
  assert.equal(lanes.to, at("2026-10-15T11:30"));
  assert.deepEqual([lanes.shown, lanes.total], [3, 898]);
  // a run that began before the day's start keeps its start in view
  assert.equal(lanesInput([{ sessionID: "s", started: DAY[0] - 60_000, ended: DAY[0] + 60_000 }], NOW, { from: DAY[0] }).from, DAY[0] - 60_000);
  assert.equal(lanesInput(rows, NOW, { total: 1 }).total, 3, "mai meno di quelli arrivati");
  store.close();
});

test("promptsInput: i run del campione e il totale del periodo", () => {
  const store = seeded();
  const rows = new Queries(store).runs(...DAY, {});
  const p = promptsInput(rows, 1586);
  assert.deepEqual(p.runs, runsInput(rows));
  assert.equal(p.total, 1586);
  assert.equal(promptsInput(rows).total, rows.length, "senza totale: tutti quelli arrivati");
  assert.deepEqual(promptsInput(undefined, undefined), { runs: [], total: 0 });
  store.close();
});
