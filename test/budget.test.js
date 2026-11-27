// Periodi di calendario e budget settimanali/mensili (/api/budget).
process.env.TZ = "Europe/Rome";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Queries, periodBounds } from "../src/queries.js";
import { memoryStore, addStep, addInternal, tokens } from "./helpers.js";

const at = (s) => new Date(s).getTime(); // ora locale, es. "2026-10-15T12:00"
const H = 3_600_000;

test("periodBounds: giorno, settimana da lunedì, mese dal giorno 1", () => {
  const now = at("2026-10-15T12:00"); // giovedì
  assert.deepEqual(periodBounds("day", now), { from: at("2026-10-15T00:00"), to: at("2026-10-16T00:00") });
  assert.deepEqual(periodBounds("week", now), { from: at("2026-10-12T00:00"), to: at("2026-10-19T00:00") });
  assert.deepEqual(periodBounds("month", now), { from: at("2026-10-01T00:00"), to: at("2026-11-01T00:00") });
});

test("periodBounds: domenica sera, lunedì a mezzanotte, fine anno", () => {
  assert.equal(periodBounds("week", at("2026-10-18T23:59")).from, at("2026-10-12T00:00"));
  assert.equal(periodBounds("week", at("2026-10-19T00:00")).from, at("2026-10-19T00:00"));
  assert.deepEqual(periodBounds("month", at("2026-12-31T23:00")), { from: at("2026-12-01T00:00"), to: at("2027-01-01T00:00") });
  assert.deepEqual(periodBounds("week", at("2026-12-31T12:00")), { from: at("2026-12-28T00:00"), to: at("2027-01-04T00:00") });
});

test("periodBounds: cambio dell'ora legale", () => {
  // 25 ottobre 2026 a Roma: alle 03:00 si torna alle 02:00, il giorno dura 25 ore
  const d = periodBounds("day", at("2026-10-25T12:00"));
  assert.equal(d.to - d.from, 25 * H);
  const w = periodBounds("week", at("2026-10-25T12:00"));
  assert.equal(w.to - w.from, 7 * 24 * H + H);
  assert.equal(w.to, at("2026-10-26T00:00"));
});

function seeded() {
  const store = memoryStore();
  // lunedì 12 e giovedì 15 (oggi) nella settimana, venerdì 2 solo nel mese
  addStep(store, { id: "a", started: at("2026-10-12T10:00"), ended: at("2026-10-12T10:01"), tokens: tokens(1000), cost: 1 });
  addStep(store, { id: "b", started: at("2026-10-15T09:00"), ended: at("2026-10-15T09:01"), tokens: tokens(500, 500), cost: 2 });
  addStep(store, { id: "c", started: at("2026-10-02T09:00"), ended: at("2026-10-02T09:01"), tokens: tokens(4000), cost: 4 });
  addInternal(store, { id: "i", created: at("2026-10-15T09:30"), cost: 0.5, tokens: tokens(100) });
  return store;
}

test("budget: uso per periodo con internal_usage e giorni della settimana", () => {
  const store = seeded();
  const b = new Queries(store).budget(at("2026-10-15T12:00"));
  assert.deepEqual(Object.keys(b.periods), ["day", "week", "month"]);
  assert.equal(b.periods.day.tokens.used, 1100);
  assert.equal(b.periods.day.steps.used, 1);
  assert.equal(b.periods.day.cost.used, 2.5);
  assert.equal(b.periods.week.tokens.used, 2100);
  assert.equal(b.periods.week.steps.used, 2);
  assert.equal(b.periods.week.elapsed, 0.5);
  assert.equal(b.periods.month.tokens.used, 6100);
  assert.equal(b.periods.month.cost.used, 7.5);
  assert.equal(b.periods.week.days.length, 7);
  assert.deepEqual(b.periods.week.days[0], { date: "2026-10-12", tokens: 1000, cost: 1, steps: 1 });
  assert.deepEqual(b.periods.week.days[3], { date: "2026-10-15", tokens: 1100, cost: 2.5, steps: 1 });
  assert.deepEqual(b.periods.week.days[6], { date: "2026-10-18", tokens: 0, cost: 0, steps: 0 });
  assert.equal(b.periods.day.days, undefined);
  assert.equal(b.periods.day.tokens.limit, null);
  assert.equal(b.periods.day.tokens.pace, "none");
  store.close();
});

test("budget: limiti, proiezione dopo 1/24 del periodo e ritmo", () => {
  const store = seeded();
  const q = new Queries(store, {
    weeklyLimits: { tokens: 5000, cost: 2, steps: 3 },
    monthlyLimits: { tokens: 100_000, cost: null, steps: null },
  });
  const w = q.budget(at("2026-10-15T12:00")).periods.week;
  assert.equal(w.tokens.ratio, 2100 / 5000);
  assert.equal(w.tokens.projected, 4200, "a metà settimana raddoppia");
  assert.equal(w.tokens.pace, "under");
  assert.equal(w.steps.projectedRatio, 4 / 3);
  assert.equal(w.steps.pace, "over");
  assert.equal(w.cost.pace, "exceeded", "3,5 su 2");
  const m = q.budget(at("2026-10-15T12:00")).periods.month;
  assert.equal(m.tokens.pace, "under");
  assert.equal(m.cost.pace, "none");
  // lunedì alle 06:00: meno di 7 ore di settimana, niente proiezione
  const early = q.budget(at("2026-10-12T06:00")).periods.week;
  assert.equal(early.tokens.projected, null);
  assert.equal(early.tokens.projectedRatio, null);
  assert.equal(early.tokens.pace, "under");
  assert.notEqual(q.budget(at("2026-10-12T07:00")).periods.week.tokens.projected, null, "da 7 ore in poi");
  store.close();
});

test("today: stessa forma di prima, calcolato come il periodo giorno", () => {
  const store = seeded();
  const q = new Queries(store, { limits: { tokens: 2000, cost: null, steps: null } });
  const now = at("2026-10-15T12:00");
  const t = q.today(now);
  const d = q.budget(now).periods.day;
  assert.deepEqual(Object.keys(t), ["day", "from", "to", "now", "tokens", "cost", "steps", "windows"]);
  assert.deepEqual(Object.keys(t.tokens), ["used", "limit", "ratio", "projected", "projectedRatio"]);
  assert.equal(t.day, "2026-10-15");
  assert.equal(t.tokens.projected, d.tokens.projected);
  assert.equal(t.to, d.to);
  store.close();
});

test("today: proiezione dopo un'ora esatta anche nel giorno del cambio d'ora", () => {
  const store = seeded();
  const q = new Queries(store);
  // 25 ottobre: il giorno dura 25 ore, 1/24 sarebbe 62,5 minuti
  assert.equal(q.today(at("2026-10-25T00:59")).tokens.projected, null);
  assert.notEqual(q.today(at("2026-10-25T01:01")).tokens.projected, null);
  // la settimana resta a 1/24 del periodo
  assert.equal(q.budget(at("2026-10-19T06:59")).periods.week.tokens.projected, null);
  store.close();
});

test("budget: settimane del cambio d'ora, 169 e 167 ore, sette giorni da lunedì", () => {
  const store = memoryStore();
  addStep(store, { id: "dom-sera", started: at("2026-10-25T23:30"), ended: at("2026-10-25T23:31"), tokens: tokens(700) });
  addStep(store, { id: "lun-dopo", started: at("2026-10-26T00:30"), ended: at("2026-10-26T00:31"), tokens: tokens(5) });
  const q = new Queries(store);
  const autumn = q.budget(at("2026-10-25T12:00")).periods.week;
  assert.equal(autumn.to - autumn.from, 169 * H);
  assert.equal(autumn.elapsed, 157 / 169, "da lunedì 00:00 a domenica 12:00 con l'ora in più");
  assert.deepEqual(autumn.days.map((d) => d.date), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.equal(autumn.days[6].tokens, 700, "domenica sera resta nella settimana");
  assert.equal(autumn.tokens.used, 700, "lunedì dopo mezzanotte no");
  const spring = q.budget(at("2026-03-29T12:00")).periods.week;
  assert.equal(spring.to - spring.from, 167 * H);
  assert.equal(spring.days.length, 7);
  assert.equal(spring.days[6].date, "2026-03-29");
  store.close();
});

test("today: token del giorno intero e della fascia 7–19, ora locale", () => {
  const store = seeded(); // oggi: step alle 09:00 (1000 token) e task interno alle 09:30 (100)
  addStep(store, { id: "sera", started: at("2026-10-15T20:00"), ended: at("2026-10-15T20:01"), tokens: tokens(400) });
  addStep(store, { id: "presto", started: at("2026-10-15T06:59"), ended: at("2026-10-15T06:59:30"), tokens: tokens(200) });
  addStep(store, { id: "sette", started: at("2026-10-15T07:00"), ended: at("2026-10-15T07:00:30"), tokens: tokens(50) });
  const t = new Queries(store).today(at("2026-10-15T21:00"));
  assert.deepEqual(
    t.windows.map(({ startHour, endHour, tokens: n }) => [startHour, endHour, n]),
    [
      [0, 24, 1750],
      [7, 19, 1150],
    ],
  );
  assert.equal(t.windows[0].tokens, t.tokens.used);
  assert.deepEqual([t.windows[1].from, t.windows[1].to], [at("2026-10-15T07:00"), at("2026-10-15T19:00")]);
  // 25 ottobre, giorno di 25 ore: le fasce seguono l'ora locale
  const dst = new Queries(store).today(at("2026-10-25T12:00"));
  assert.equal(dst.windows[0].to - dst.windows[0].from, 25 * H);
  assert.equal(dst.windows[1].to - dst.windows[1].from, 12 * H);
  store.close();
});

const R2 = { hour: 2, utc: false };

test("periodBounds: giorno dall'ora di reset locale, anche prima del reset", () => {
  assert.deepEqual(periodBounds("day", at("2026-10-15T12:00"), R2), { from: at("2026-10-15T02:00"), to: at("2026-10-16T02:00") });
  assert.deepEqual(periodBounds("day", at("2026-10-15T01:30"), R2), { from: at("2026-10-14T02:00"), to: at("2026-10-15T02:00") });
  assert.deepEqual(periodBounds("day", at("2026-10-15T02:00"), R2).from, at("2026-10-15T02:00"));
});

test("periodBounds: reset in UTC", () => {
  const U = { hour: 0, utc: true };
  // ottobre a Roma è CEST (UTC+2): mezzanotte UTC = 02:00 locali
  assert.deepEqual(periodBounds("day", at("2026-10-15T12:00"), U), { from: at("2026-10-15T02:00"), to: at("2026-10-16T02:00") });
  assert.deepEqual(periodBounds("day", at("2026-10-15T01:00"), U), { from: at("2026-10-14T02:00"), to: at("2026-10-15T02:00") });
});

test("periodBounds: reset alle 12 nei giorni del cambio d'ora", () => {
  const R12 = { hour: 12, utc: false };
  const after = periodBounds("day", at("2026-10-25T13:00"), R12);
  assert.equal(after.to - after.from, 24 * H);
  const before = periodBounds("day", at("2026-10-25T09:00"), R12);
  assert.equal(before.to - before.from, 25 * H);
});

test("periodBounds: reset alle 2 nel giorno dell'ora legale (le 02:00 non esistono)", () => {
  // 29 marzo 2026 a Roma: alle 02:00 si passa alle 03:00; il reset cade nell'istante del salto
  assert.deepEqual(periodBounds("day", at("2026-03-29T01:30"), R2), { from: at("2026-03-28T02:00"), to: at("2026-03-29T03:00") });
  const d = periodBounds("day", at("2026-03-29T12:00"), R2);
  assert.deepEqual(d, { from: at("2026-03-29T03:00"), to: at("2026-03-30T02:00") });
  assert.equal(d.to - d.from, 23 * H);
  assert.equal(periodBounds("day", at("2026-03-30T02:30"), R2).from, at("2026-03-30T02:00"));
});

test("periodBounds: settimana e mese ignorano il reset", () => {
  const now = at("2026-10-15T12:00");
  assert.deepEqual(periodBounds("week", now, R2), periodBounds("week", now));
  assert.deepEqual(periodBounds("month", now, R2), periodBounds("month", now));
});

test("budget e today seguono LENS_RESET_HOUR, la settimana resta di 7 giorni di calendario", () => {
  const store = seeded();
  addStep(store, { id: "notte", started: at("2026-10-15T01:00"), ended: at("2026-10-15T01:01"), tokens: tokens(7000) });
  const q = new Queries(store, { reset: R2 });
  const b = q.budget(at("2026-10-15T12:00"));
  assert.equal(b.periods.day.from, at("2026-10-15T02:00"));
  assert.equal(b.periods.day.tokens.used, 1100, "lo step dell'01:00 è nel giorno di ieri");
  assert.equal(b.periods.week.days.length, 7);
  assert.equal(b.periods.week.from, at("2026-10-12T00:00"));
  const t = q.today(at("2026-10-15T12:00"));
  assert.equal(t.from, at("2026-10-15T02:00"));
  assert.deepEqual([t.windows[0].startHour, t.windows[0].endHour, t.windows[0].tokens], [2, 2, 1100]);
  assert.deepEqual([t.windows[1].startHour, t.windows[1].endHour], [7, 19]);
  const d = new Queries(store).today(at("2026-10-15T12:00"));
  assert.deepEqual([d.windows[0].startHour, d.windows[0].endHour], [0, 24]);
  store.close();
});

const ML = (model, limit) => ({ model, provider: model.slice(0, model.indexOf("/")), name: model.slice(model.indexOf("/") + 1), limit });

function modelStore() {
  const store = memoryStore();
  const step = (id, provider, model, started, n, variant = null) =>
    addStep(store, { id, provider, model, variant, started: at(started), ended: at(started) + 60_000, tokens: tokens(n) });
  step("q1", "az", "qwen", "2026-10-15T09:00", 300);
  step("q2", "az", "qwen", "2026-10-15T10:00", 100, "high");
  step("q0", "az", "qwen", "2026-10-14T10:00", 999);
  step("l1", "az", "llama", "2026-10-15T09:00", 600);
  step("o1", "openrouter", "anthropic/x", "2026-10-15T09:00", 40);
  addInternal(store, { id: "i", created: at("2026-10-15T09:30"), tokens: tokens(50) });
  return store;
}

test("budget: periods.day.models, varianti insieme, task interni fuori, modelli mai visti", () => {
  const store = modelStore();
  const modelLimits = [ML("az/qwen", 1000), ML("az/llama", 500), ML("az/ghost", 10), ML("openrouter/anthropic/x", 100)];
  const b = new Queries(store, { modelLimits }).budget(at("2026-10-15T12:00"));
  const m = b.periods.day.models;
  assert.deepEqual(m.map((x) => x.model), ["az/qwen", "az/llama", "az/ghost", "openrouter/anthropic/x"]);
  assert.equal(m[0].used, 400);
  assert.equal(m[0].limit, 1000);
  assert.equal(m[0].ratio, 0.4);
  assert.equal(m[0].projected, 800, "alle 12:00 metà giornata: proiezione doppia");
  assert.equal(m[0].seen, true);
  assert.equal(m[1].pace, "exceeded");
  assert.deepEqual([m[2].used, m[2].seen], [0, false]);
  assert.equal(m[3].used, 40);
  store.close();
});

test("budget: modelli nella prima ora senza proiezione, e nessun modello senza LENS_MODEL_LIMITS", () => {
  const store = modelStore();
  const early = new Queries(store, { modelLimits: [ML("az/qwen", 1000)] }).budget(at("2026-10-15T00:30"));
  assert.equal(early.periods.day.models[0].projected, null);
  assert.deepEqual(new Queries(store).budget(at("2026-10-15T12:00")).periods.day.models, []);
  store.close();
});

test("budget: solo i modelli della configurazione di OpenCode; senza configurazione tutti", () => {
  const store = modelStore();
  const modelLimits = [ML("az/qwen", 1000), ML("az/llama", 500)];
  const cfg = (available, models) => ({ current: () => ({ available, models: models.map((model) => ({ model })) }) });
  const on = new Queries(store, { modelLimits, opencodeModels: cfg(true, ["az/qwen"]) }).budget(at("2026-10-15T12:00"));
  assert.deepEqual(on.periods.day.models.map((m) => m.model), ["az/qwen"]);
  const off = new Queries(store, { modelLimits, opencodeModels: cfg(false, []) }).budget(at("2026-10-15T12:00"));
  assert.deepEqual(off.periods.day.models.map((m) => m.model), ["az/qwen", "az/llama"]);
  store.close();
});

test("modelTokens: token per provider/modello, varianti insieme", () => {
  const store = modelStore();
  const t = new Queries(store).modelTokens(at("2026-10-15T00:00"), at("2026-10-16T00:00"));
  assert.equal(t.get("az/qwen"), 400);
  assert.equal(t.get("az/llama"), 600);
  assert.equal(t.get("openrouter/anthropic/x"), 40);
  store.close();
});

test("dayRange segue LENS_RESET_HOUR", () => {
  const store = memoryStore();
  const q = new Queries(store, { reset: { hour: 2, utc: false } });
  assert.deepEqual(q.dayRange(at("2026-10-17T01:30")), { from: at("2026-10-16T02:00"), to: at("2026-10-17T02:00") });
  store.close();
});

const sum = (a) => a.reduce((x, y) => x + y, 0);
const step = (store, id, when, n) => addStep(store, { id, started: when, ended: when + 1000, tokens: tokens(n) });

test("hourly: 24 ore dall'ora di reset, somma = token del giorno", () => {
  const store = memoryStore();
  const now = at("2026-10-15T18:00");
  step(store, "a", at("2026-10-15T02:10"), 1000);
  step(store, "b", at("2026-10-15T15:30"), 500);
  addInternal(store, { id: "i", created: at("2026-10-15T15:40"), tokens: tokens(200) });
  const q = new Queries(store, { reset: { hour: 2, utc: false } });
  const h = q.hourly(7, now);
  assert.equal(h.labels.length, 24);
  assert.equal(h.labels[0], "02:00");
  assert.equal(h.labels[23], "01:00");
  assert.equal(h.tokens[0], 1000);
  assert.equal(h.tokens[13], 700);
  assert.equal(sum(h.tokens), q.period("day", q.limits, now).tokens.used);
  store.close();
});

test("hourly: media dei giorni precedenti e soFarAvg", () => {
  const store = memoryStore();
  for (const d of [12, 13, 14]) {
    step(store, `m${d}`, at(`2026-10-${d}T09:00`), 900);
    step(store, `s${d}`, at(`2026-10-${d}T20:00`), 300);
  }
  step(store, "today", at("2026-10-15T09:30"), 50);
  const h = new Queries(store).hourly(3, at("2026-10-15T12:00"));
  assert.equal(h.days, 3);
  assert.equal(h.avg[9], 900);
  assert.equal(h.avg[20], 300);
  assert.equal(h.soFarAvg, 900);
  assert.equal(h.dayAvg, 1200);
  assert.equal(h.tokens[9], 50);
  store.close();
});

test("hourly: soFarAvg conta solo fino allo stesso scostamento di now", () => {
  const store = memoryStore();
  for (const d of [12, 13, 14]) {
    step(store, `a${d}`, at(`2026-10-${d}T09:10`), 900); // before 09:30: counts
    step(store, `b${d}`, at(`2026-10-${d}T09:50`), 600); // after 09:30: must not count
  }
  const h = new Queries(store).hourly(3, at("2026-10-15T09:30"));
  assert.equal(h.soFarAvg, 900);
  assert.equal(h.avg[9], 1500);
  assert.equal(h.dayAvg, 1500);
  store.close();
});

test("hourly: giorno del cambio d'ora", () => {
  const store = memoryStore();
  const now = at("2026-10-25T18:00");
  step(store, "a", at("2026-10-25T02:30:00+02:00"), 100);
  step(store, "b", at("2026-10-25T02:30:00+01:00"), 40);
  step(store, "c", at("2026-10-25T10:00"), 7);
  const q = new Queries(store);
  const h = q.hourly(7, now);
  assert.equal(h.labels.length, 24);
  assert.equal(h.tokens.length, 24);
  assert.equal(h.tokens[2], 140);
  assert.equal(sum(h.tokens), 147);
  assert.equal(sum(h.tokens), q.period("day", q.limits, now).tokens.used);
  store.close();
});

test("hourly: database vuoto", () => {
  const store = memoryStore();
  const h = new Queries(store, { reset: { hour: 2, utc: false } }).hourly(99, at("2026-10-15T12:00"));
  assert.equal(h.days, 31);
  assert.deepEqual(h.tokens, new Array(24).fill(0));
  assert.deepEqual(h.avg, new Array(24).fill(0));
  assert.equal(h.soFarAvg, 0);
  assert.equal(h.dayAvg, 0);
  store.close();
});

test("daily: 7 giorni dei budget, oggi per ultimo", () => {
  const store = memoryStore();
  store.db.exec(`INSERT INTO sessions (id) VALUES ('p'), ('c')`);
  store.db.exec(`UPDATE sessions SET parent_id = 'p' WHERE id = 'c'`);
  const t = at("2026-10-15T09:00");
  addStep(store, { id: "a", session: "p", started: t, ended: t + 2000, tokens: tokens(100, 0, 0, 300), cost: 2 });
  addStep(store, { id: "b", session: "p", started: t + 5000, ended: t + 9000, tokens: tokens(0, 50), cost: 1 });
  const run = store.db.prepare(`INSERT INTO runs (id, session_id, started, ended, outcome) VALUES (?, ?, ?, ?, 'succeeded')`);
  run.run("r1", "p", t, t + 9000);
  run.run("r2", "c", t, t + 9000);
  const prompt = store.db.prepare(`INSERT INTO prompts (id, session_id, created) VALUES (?, ?, ?)`);
  prompt.run("pr1", "p", t);
  prompt.run("pr2", "c", t);
  const d = new Queries(store).daily(7, at("2026-10-15T12:00")).days;
  assert.equal(d.length, 7);
  assert.equal(d[0].date, "2026-10-09");
  assert.equal(d.at(-1).date, "2026-10-15");
  assert.equal(d[5].cacheRate, null);
  assert.equal(d[5].tokens, 0);
  assert.equal(d[5].latencyMs.p50, null);
  const today = d.at(-1);
  assert.equal(today.tokens, 450);
  assert.equal(today.cost, 3);
  assert.equal(today.steps, 2);
  assert.equal(today.runs, 1);
  assert.equal(today.prompts, 1);
  assert.equal(today.cacheRate, 0.75);
  assert.equal(today.latencyMs.p50, 3000);
  assert.deepEqual(today.tools, { calls: 0, errors: 0 });
  store.close();
});
