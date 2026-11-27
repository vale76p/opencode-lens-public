// Modelli di gauge, budget, indicatori e stato: ingressi reali dagli adattatori e asserzioni sui valori disegnati.
process.env.TZ = "Europe/Rome";

import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetAllInput, budgetInput, daysInput, kpiInput, statusInput } from "../public/adapt.js";
import { MODELS } from "../public/models-gauges.js";
import { compact } from "../public/ui.js";
import { Queries } from "../src/queries.js";
import { addRun, addSession, addStep, memoryStore, tokens } from "./helpers.js";
import { checkModel, HOSTILE, SIZES } from "./models-helpers.js";

const at = (s) => new Date(s).getTime();
const NOW = at("2026-10-15T12:00");
const DAY = [at("2026-10-15T00:00"), at("2026-10-16T00:00")];
const IDS = ["B1", "B2", "B4", "B5", "B10", "B11", "B12", "C1", "C14", "C16", "C19", "C20", "C17", "C18"];

function seeded() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", title: "Refactor" });
  const step = (id, when, t, extra = {}) => addStep(store, { id, session: "ses_1", provider: "az", model: "qwen", started: at(when), ended: at(when) + 60_000, tokens: t, cost: 1, ...extra });
  const timed = (when) => ({ requested: at(when), firstOutput: at(when) + 2000, streamed: at(when) + 10_000 });
  step("y1", "2026-10-14T09:00", tokens(1000, 100, 0, 800, 0), timed("2026-10-14T09:00"));
  step("y2", "2026-10-13T10:00", tokens(400, 50));
  step("b", "2026-10-15T09:00", tokens(2000, 600, 0, 6000, 0), timed("2026-10-15T09:00"));
  step("c", "2026-10-15T10:00", tokens(300, 30));
  addRun(store, { id: "r1", session: "ses_1", started: at("2026-10-15T08:59"), ended: at("2026-10-15T09:20") });
  addRun(store, { id: "r2", session: "ses_1", started: at("2026-10-15T11:00"), ended: at("2026-10-15T11:30"), outcome: "failed" });
  return store;
}

const LIMITS = { limits: { tokens: 100_000, cost: null, steps: null }, weeklyLimits: { tokens: 400_000, cost: null, steps: null }, monthlyLimits: { tokens: 500_000, cost: null, steps: null } };
const real = () => {
  const store = seeded();
  const q = new Queries(store, LIMITS);
  return { store, budget: q.budget(NOW), daily: q.daily(15, NOW), summary: q.summary(...DAY, NOW), hourly: q.hourly(7, NOW) };
};

// Hand-made budget period: `ratio` and `projectedRatio` drive the picture.
const bud = (ratio, projectedRatio, extra = {}) => ({
  period: "day",
  used: ratio * 30e6,
  limit: 30e6,
  projected: projectedRatio == null ? null : projectedRatio * 30e6,
  resetAt: 0,
  ratio,
  projectedRatio,
  timeLeftMs: 7.2 * 3_600_000,
  spanMs: 24 * 3_600_000,
  ...extra,
});
const SPEED = { tokensPerSec: { p50: 52 }, ttftMs: { p50: 1240, p95: 3400 }, toolTailMs: { p50: 820 }, n: 37 };
const NOLIMIT = bud(0.5, 0.5, { limit: null, ratio: null, projectedRatio: null, projected: null });
const all = (d, w, m) => ({ day: d, week: w, month: m });

const draw = (id, input, w = 480, h = 240, label = "t") => MODELS[id].draw(input, { w, h, uid: "a", label });
const count = (s, re) => (s.match(re) ?? []).length;
const num = (s, name) => Number(new RegExp(`${name}="(-?[\\d.]+)"`).exec(s)[1]);
const tag = (s, cls) => new RegExp(`<[a-z]+ [^>]*class="${cls}"[^>]*>`).exec(s)?.[0];
const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const lineAngle = (t) => norm(Math.atan2(num(t, "y2") - num(t, "y1"), num(t, "x2") - num(t, "x1")));
// fraction of a full circle swept by an arc path that starts at the top (-90 deg)
function arcFraction(tagStr, cx, cy) {
  const d = /d="([^"]+)"/.exec(tagStr)[1];
  const [x, y] = d.split(" ").at(-1).split(",").map(Number);
  return norm(Math.atan2(y - cy, x - cx) + Math.PI / 2) / (2 * Math.PI);
}

test("il catalogo ha i 14 modelli con nome, misura minima e forma completa", () => {
  assert.deepEqual(Object.keys(MODELS).sort(), [...IDS].sort());
  for (const id of IDS) {
    const m = MODELS[id];
    assert.equal(typeof m.name, "string", id);
    assert.ok(m.min.length === 2 && m.min.every((v) => v > 0), id);
    assert.ok(m.compactBelow === null || m.compactBelow > 0, id);
    assert.equal(typeof m.draw, "function", id);
  }
  const mins = { B1: [240, 150], B2: [240, 150], B4: [240, 170], B5: [300, 160], B10: [260, 150], B11: [220, 120], B12: [220, 120], C1: [300, 180], C14: [240, 150], C16: [260, 180], C19: [220, 120], C20: [240, 150], C17: [300, 150], C18: [220, 120] };
  for (const [id, min] of Object.entries(mins)) assert.deepEqual(MODELS[id].min, min, id);
});

test("checkModel: tutti i modelli su ingressi reali degli adattatori", () => {
  const { store, budget, daily, summary, hourly } = real();
  const inputs = {
    B1: [budgetInput(budget, "day", NOW)],
    B2: [budgetInput(budget, "week", NOW)],
    B4: [summary.speed],
    B5: [budgetAllInput(budget, NOW)],
    B10: [budgetAllInput(budget, NOW)],
    B11: [kpiInput("tokens", summary, daily, hourly)],
    B12: [kpiInput("cache", summary, daily, hourly)],
    C1: [budgetInput(budget, "month", NOW, daily)],
    C14: [budgetInput(budget, "day", NOW)],
    C16: [budgetAllInput(budget, NOW)],
    C19: [budgetInput(budget, "day", NOW)],
    C20: [kpiInput("ttft", summary, daily, hourly)],
    C17: [daysInput(daily)],
    C18: [statusInput({ state: "connected", server: { version: "2.0.32" }, lastEventAt: NOW - 3000, scan: { lastEnd: NOW }, counts: { sessions: 3 } }, budget, NOW)],
  };
  for (const id of IDS) {
    checkModel(null, MODELS[id].draw, inputs[id], [...SIZES, MODELS[id].min], { bigFigure: id === "B11" || id === "C20" ? "required" : false });
    assert.equal(typeof draw(id, inputs[id][0]), "string", `${id} dovrebbe disegnare con dati reali`);
  }
  store.close();
});

test("input vuoto: {empty} con testo; budget spento non e' un gauge a zero", () => {
  const emptyBy = {
    B1: [NOLIMIT, null],
    B2: [NOLIMIT],
    B4: [null, { tokensPerSec: { p50: null } }, { tokensPerSec: {} }],
    B5: [all(NOLIMIT, NOLIMIT, NOLIMIT), null],
    B10: [all(NOLIMIT, NOLIMIT, NOLIMIT)],
    B11: [kpiInput("tokens", {}, null, null), null],
    B12: [kpiInput("cache", {}, null, null)],
    C1: [NOLIMIT, bud(0.5, 0.5), bud(0.5, 0.5, { days: [] })],
    C14: [NOLIMIT],
    C16: [all(NOLIMIT, NOLIMIT, NOLIMIT)],
    C19: [NOLIMIT, bud(0.5, 0.5, { spanMs: 0, timeLeftMs: 0 })],
    C20: [kpiInput("ttft", {}, null, null)],
    C17: [[], null],
    C18: [{ items: [] }, null],
  };
  for (const [id, inputs] of Object.entries(emptyBy)) {
    for (const input of inputs) {
      for (const [w, h] of [MODELS[id].min, [480, 240]]) {
        const r = draw(id, input, w, h);
        assert.equal(typeof r?.empty, "string", `${id} con ${JSON.stringify(input)?.slice(0, 40)}`);
        assert.ok(r.empty.length > 3);
      }
    }
  }
  assert.equal(draw("B1", NOLIMIT).empty, "Nessun budget impostato");
});

test("un solo punto non rompe nulla", () => {
  const one = { ...kpiInput("tokens", { tokens: { total: 1200 } }, null, null), series: [1200], band: null, delta: null };
  const oneDay = daysInput({ days: [{ date: "2026-10-15", from: 0, tokens: 5, runs: 1, failedRuns: 0, tools: { calls: 2, errors: 0 } }] });
  const m1 = bud(0.2, 0.4, { period: "month", days: [{ date: "2026-10-01", used: 6e6 }], spanMs: 31 * 86_400_000 });
  checkModel(null, MODELS.B11.draw, [one], undefined, { bigFigure: "required" });
  checkModel(null, MODELS.B12.draw, [{ ...one, metric: "cache", value: 0.5, display: "50%" }]);
  checkModel(null, MODELS.C20.draw, [{ ...one, metric: "ttft", value: 1000, display: "1 s" }], undefined, { bigFigure: "required" });
  checkModel(null, MODELS.C17.draw, [oneDay]);
  checkModel(null, MODELS.C1.draw, [m1], [...SIZES, MODELS.C1.min]);
});

test("testo ostile nei titoli di stato e nell'etichetta del box viene escapato", () => {
  const st = {
    items: [
      { level: "bad", title: HOSTILE, sub: HOSTILE },
      { level: "good", title: "ok", sub: HOSTILE },
    ],
  };
  checkModel(null, MODELS.C18.draw, [st], [...SIZES, MODELS.C18.min]);
  const r = draw("C18", st, 480, 240, HOSTILE);
  assert.ok(r.includes("&lt;img"), "il testo ostile compare ma escapato");
  assert.ok(!r.includes(HOSTILE));
  assert.ok(draw("B1", bud(0.5, 0.8), 400, 240, HOSTILE).includes('aria-label="&lt;img'));
});

test("B1: lancetta all'angolo del rapporto, tacca della proiezione, gradiente in user space", () => {
  for (const [ratio, proj] of [
    [0.62, 0.86],
    [0.1, 0.3],
    [0.99, 1.4],
  ]) {
    const r = draw("B1", bud(ratio, proj), 400, 260);
    assert.ok(Math.abs(lineAngle(tag(r, "needle")) - norm(Math.PI + Math.PI * Math.min(1, ratio))) < 0.01, `lancetta a ${ratio}`);
    assert.ok(Math.abs(lineAngle(tag(r, "proj")) - norm(Math.PI + Math.PI * Math.min(1, proj))) < 0.01, `tacca a ${proj}`);
  }
  const r = draw("B1", bud(0.62, 0.86), 400, 260);
  const g = /<linearGradient[^>]*>/.exec(r)[0];
  assert.match(g, /gradientUnits="userSpaceOnUse"/);
  const cx = num(tag(r, "needle"), "x1");
  const x1 = num(g, "x1");
  const x2 = num(g, "x2");
  assert.ok(x1 < cx && x2 > cx && Math.abs(cx - x1 - (x2 - cx)) < 0.01, "il gradiente copre l'intero arco, centrato");
  assert.ok(!tag(draw("B1", bud(0.5, null), 400, 260), "proj"), "niente tacca senza proiezione");
});

test("B2: tacche accese = round(rapporto * 48)", () => {
  for (const ratio of [0, 0.73, 0.5, 1, 1.4]) {
    const r = draw("B2", bud(ratio, 0.9), 400, 240);
    assert.equal(count(r, /class="tick on"/g), Math.round(Math.min(1, ratio) * 48), `rapporto ${ratio}`);
    assert.equal(count(r, /class="tick( on)?"/g), 48);
  }
});

test("B4: lancetta a p50/100, bloccata tra 0 e 100", () => {
  const speed = (p50) => ({ tokensPerSec: { p50 }, n: 3 });
  for (const [p50, v] of [
    [52, 0.52],
    [0, 0],
    [250, 1],
    [100, 1],
  ]) {
    const r = draw("B4", speed(p50), 400, 260);
    assert.ok(Math.abs(lineAngle(tag(r, "needle")) - norm(Math.PI * 0.8 + Math.PI * 1.4 * v)) < 0.01, `p50 ${p50}`);
  }
  assert.ok(draw("B4", speed(52), 400, 260).includes("52 tok/s"));
});

test("B5: una riga per periodo con limite", () => {
  assert.equal(count(draw("B5", all(bud(0.62, 0.86), bud(0.75, 1.01), bud(0.42, 0.79)), 400, 240), /class="row"/g), 3);
  assert.equal(count(draw("B5", all(bud(0.62, 0.86), NOLIMIT, bud(0.42, 0.79)), 400, 240), /class="row"/g), 2);
  assert.equal(count(draw("B5", all(bud(0.62, 0.86), NOLIMIT, NOLIMIT), 400, 240), /class="proj"/g), 1);
});

test("B10: segmenti accesi = ceil(rapporto * 20)", () => {
  for (const ratio of [0.62, 0.05, 0, 1, 1.3]) {
    const r = draw("B10", all(bud(ratio, 0.9), NOLIMIT, NOLIMIT), 400, 240);
    assert.equal(count(r, /class="seg on"/g), Math.ceil(Math.min(1, ratio) * 20), `rapporto ${ratio}`);
    assert.equal(count(r, /class="seg( on)?"/g), 20);
  }
  assert.equal(count(draw("B10", all(bud(0.5, 0.5), bud(0.5, 0.5), NOLIMIT), 400, 240), /class="seg( on)?"/g), 40);
});

const kpi = (extra = {}) => ({
  metric: "tokens",
  value: 6e6,
  display: "6M",
  caption: "token oggi (rispetto alla media di questa ora)",
  delta: { ratio: 0.18, dir: "up" },
  baseline: "hour",
  series: Array.from({ length: 40 }, (_, i) => 1 + (i % 7)),
  band: { lo: 2, hi: 5 },
  bandNow: { lo: 2, hi: 5 },
  ...extra,
});

test("B11 e C20: oggi contro la stessa ora dei giorni prima, e senza quella base niente giudizio", () => {
  const labels = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.ok(labels(draw("B11", kpi(), 480, 200)).includes("vs media a quest&#39;ora"));
  assert.ok(labels(draw("B11", kpi({ metric: "cost", baseline: "hour" }), 480, 200)).includes("vs media a quest&#39;ora"), "il costo a quest'ora");
  assert.ok(labels(draw("B11", kpi({ metric: "ttft", baseline: "days" }), 480, 200)).includes("vs i giorni prima"));
  // C20: the earlier days' band is drawn, today is judged at this hour
  const morning = kpi({ metric: "cost", value: 30, display: "30 $", series: [80, 100, 120, 140, 30], band: { lo: 95, hi: 125 }, bandNow: { lo: 23.75, hi: 31.25 } });
  const svg = draw("C20", morning, 400, 240);
  assert.ok(labels(svg).includes("nella norma"), labels(svg).join("|"));
  assert.equal(count(svg, /class="out"/g), 2, "80 e 140 fuori dalla fascia; oggi (30 a quest'ora) dentro quella dell'ora");
  const blind = draw("C20", { ...morning, bandNow: null, delta: null }, 400, 240);
  assert.ok(!/norma</.test(blind) && !blind.includes('class="pill"'), "senza base a quest'ora: nessun giudizio");
  assert.equal(count(blind, /class="band"/g), 1, "la fascia dei giorni prima resta disegnata");
});

test("B11: 30 barre oltre 520 px, 14 altrimenti; didascalia accorciata sotto 340 px", () => {
  assert.equal(count(draw("B11", kpi(), 600, 200), /class="bar/g), 30);
  assert.equal(count(draw("B11", kpi(), 520, 200), /class="bar/g), 14);
  assert.equal(count(draw("B11", kpi(), 300, 200), /class="bar/g), 14);
  assert.equal(count(draw("B11", kpi({ series: [1, 2, 3] }), 600, 200), /class="bar/g), 3);
  const long = kpi().caption;
  assert.ok(draw("B11", kpi(), 600, 200).includes(long));
  const small = draw("B11", kpi(), 300, 200);
  assert.ok(!small.includes(long) && small.includes(">token oggi<"), "didascalia ridotta alla parte prima della parentesi");
  assert.equal(count(small, /class="bar current"/g), 1);
  assert.ok(!draw("B11", kpi({ delta: null }), 400, 200).includes('class="pill"'));
});

test("retry: la didascalia corta del kpi tiene la parte dei 429 nelle carte strette", () => {
  const r = kpi({ metric: "retries", value: 5, display: "5", caption: "retry di oggi · di cui 3 per limite di frequenza", short: "retry, di cui 3 per 429", series: [2, 4, 1, 5], band: { lo: 1, hi: 4 } });
  assert.ok(draw("B11", r, 400, 200).includes(">retry di oggi · di cui 3 per limite di frequenza<"));
  assert.ok(draw("B11", r, 300, 200).includes(">retry, di cui 3 per 429<"));
  assert.ok(draw("C20", r, 300, 200).includes(">retry, di cui 3 per 429<"));
  assert.ok(draw("B11", r, 400, 200).includes('data-tip="4"'), "barre con il numero intero");
});

test("errori dei tool: suggerimenti e fascia in percentuale, come le altre metriche", () => {
  const e = kpi({ metric: "toolErrors", value: 0.05, display: "5%", caption: "chiamate tool con errore", series: [0.02, 0.04, 0.06, 0.05], band: { lo: 0.02, hi: 0.06 } });
  const b11 = draw("B11", e, 400, 200);
  assert.ok(b11.includes('data-tip="5%"') && b11.includes('data-tip="2%"'), "barre con la percentuale");
  assert.ok(!b11.includes('data-tip="0,05"'));
  const c20 = draw("C20", e, 400, 200);
  assert.ok(c20.includes(">fascia normale 2%–6%<"), "fascia in percentuale");
  assert.ok(draw("B12", e, 400, 160).includes(">4,3%<"), "media dei giorni (4,25%) in percentuale");
});

test("B12: arco = tasso di cache; sparkline nascosta sotto 60 px di spazio", () => {
  const c = kpi({ metric: "cache", value: 0.93, display: "93%", caption: "del prompt da cache", series: [0.8, 0.85, 0.9, 0.93] });
  const wide = draw("B12", c, 400, 160);
  const track = tag(wide, "ring-track");
  assert.ok(Math.abs(arcFraction(tag(wide, "ring-value"), num(track, "cx"), num(track, "cy")) - 0.93) < 0.005);
  assert.ok(wide.includes('class="spark"'));
  const tight = draw("B12", c, 160, 120);
  assert.ok(!tight.includes('class="spark"'));
  assert.ok(tight.includes("93%"));
});

test("C1: il cono si apre da oggi; il giorno di sforamento solo se l'alto supera il limite", () => {
  const days = (n, perDay) => Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, used: perDay }));
  // today is day `n` of a 31-day month (12:00): the elapsed time comes from timeLeftMs, `shown` is how many days were fetched
  const month = (n, perDay, limit, shown = n) =>
    bud((n * perDay) / limit, null, { period: "month", limit, used: n * perDay, spanMs: 31 * 86_400_000, timeLeftMs: (31 - n + 0.5) * 86_400_000, days: days(n, perDay).slice(n - shown).map((d, i) => ({ ...d, date: `2026-10-${String(n - shown + i + 1).padStart(2, "0")}` })) });
  // 18 days at 10M/day against 400M: the high line (1.3x) ends at 180 + 169 = 349M, under the limit
  const calm = draw("C1", month(18, 10e6, 400e6), 480, 260);
  const poly = /<polygon [^>]*points="([^"]+)"/.exec(calm)[1].split(" ").map((p) => p.split(",").map(Number));
  assert.ok(Math.abs(Math.min(...poly.map((p) => p[0])) - num(tag(calm, "today"), "cx")) < 0.1, "il cono parte dal punto di oggi");
  assert.equal(count(calm, /class="cross"/g), 0);
  // 18 days at 20M/day: the high line crosses the limit
  const hot = draw("C1", month(18, 20e6, 400e6), 480, 260);
  assert.equal(count(hot, /class="cross"/g), 1);
  assert.match(hot, /lo superi il/);
  // already over the limit: the cross is the day it was passed (day 14: 280M... the first cumulative >= 400M)
  const over = draw("C1", month(18, 30e6, 400e6), 480, 260);
  assert.equal(count(over, /class="cross"/g), 1);
  assert.match(over, /superato il 14/);
});

test("C14: anello esterno = rapporto, interno = proiezione", () => {
  const r = draw("C14", bud(0.62, 0.86), 400, 240);
  const track = tag(r, "ring-track");
  const cx = num(track, "cx");
  const cy = num(track, "cy");
  const outer = tag(r, "ring-used");
  const inner = tag(r, "ring-proj");
  assert.ok(Math.abs(arcFraction(outer, cx, cy) - 0.62) < 0.005);
  assert.ok(Math.abs(arcFraction(inner, cx, cy) - 0.86) < 0.005);
  assert.ok(num(outer, "stroke-width") > num(inner, "stroke-width"));
  assert.ok(!draw("C14", bud(0.62, null), 400, 240).includes("ring-proj"));
});

test("C16: tre provette e segno tratteggiato della proiezione", () => {
  const r = draw("C16", all(bud(0.62, 0.86), bud(0.75, 1.01), bud(0.42, 0.79)), 400, 260);
  assert.equal(count(r, /class="tube"/g), 3);
  const marks = r.match(/<line [^>]*class="proj"[^>]*>/g);
  assert.equal(marks.length, 3);
  for (const m of marks) assert.match(m, /stroke-dasharray=/);
  assert.equal(count(draw("C16", all(bud(0.62, 0.86), NOLIMIT, bud(0.42, 0.79)), 400, 260), /class="tube"/g), 2);
});

test("C19: arco = tempo che resta / giorno; blocco di testo nascosto sotto 120 px di spazio", () => {
  const r = draw("C19", bud(0.3, 0.5), 420, 160);
  const track = tag(r, "ring-track");
  assert.ok(Math.abs(arcFraction(tag(r, "ring-value"), num(track, "cx"), num(track, "cy")) - 0.3) < 0.005, "7,2 h su 24");
  assert.match(r, /Restano/);
  assert.match(r, /token\/h/);
  const tight = draw("C19", bud(0.3, 0.5), 220, 120);
  assert.ok(!/Restano/.test(tight));
  assert.match(tight, /7 h 12 min/);
  // limit already used up: no hourly allowance to promise
  assert.ok(!/token\/h/.test(draw("C19", bud(1.2, 1.4), 420, 160)));
});

test("budget di step e di costo: cifre e unità seguono la metrica, i token restano come prima", () => {
  // the same picture in three metrics: 30M tokens, 300 steps, $30
  const steps = (ratio, p) => ({ ...bud(ratio, p), metric: "steps", used: ratio * 300, limit: 300, projected: p * 300 });
  const cost = (ratio, p) => ({ ...bud(ratio, p), metric: "cost", used: ratio * 30, limit: 30, projected: p * 30 });
  const texts = (svg) => [...svg.matchAll(/>([^<>]+)</g)].map((m) => m[1]).join(" | ");
  const tips = (svg) => [...svg.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1]).join(" | ");
  // C19: what is left and the hourly allowance in the metric's unit
  const c19s = texts(draw("C19", steps(0.3, 0.5), 560, 180));
  assert.match(c19s, /210 step/);
  assert.match(c19s, /≤ 29 step\/h/, "210 step in 7,2 h");
  assert.ok(!/token/.test(c19s), c19s);
  const c19c = texts(draw("C19", cost(0.3, 0.5), 560, 180));
  assert.match(c19c, /21,00\s\$/);
  assert.match(c19c, /≤ 2,92\s\$\/h/);
  assert.match(c19c, /9,00\s\$ di 30,00\s\$/, "la seconda colonna: usato di limite");
  assert.ok(!/token|step/.test(c19c), c19c);
  // tokens: the texts of before
  const c19t = texts(draw("C19", bud(0.3, 0.5), 560, 180));
  assert.match(c19t, /21M token/);
  assert.match(c19t, /token\/h/);
  // the others: the cost in dollars, in the drawing and in the tooltip; steps name their unit in the tooltip
  for (const id of ["B1", "B2", "C14"]) {
    const svg = draw(id, cost(0.3, 0.5), 480, 240);
    assert.match(texts(svg), /\$/, id);
    assert.match(tips(svg), /Budget: 9,00\s\$ di 30,00\s\$ \(30%\)/, id);
    assert.match(tips(draw(id, steps(0.3, 0.5), 480, 240)), /Budget: 90 di 300 step \(30%\)/, id);
    assert.ok(!/\$| step/.test(texts(draw(id, bud(0.3, 0.5), 480, 240)) + tips(draw(id, bud(0.3, 0.5), 480, 240))), `${id}: token come prima`);
  }
  for (const id of ["B5", "B10", "C16"]) {
    const svg = draw(id, all(cost(0.3, 0.5), cost(0.6, 0.9), cost(0.2, 0.4)), 400, 240);
    assert.match(tips(svg), /Oggi: 9,00\s\$ di 30,00\s\$/, id);
  }
  assert.match(texts(draw("B10", all(steps(0.3, 0.5), steps(0.6, 0.9), NOLIMIT), 400, 240)), /90 \/ 300/);
  // C1: axis, budget line, today's value and the end-of-month projection in dollars
  const days = Array.from({ length: 15 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, used: 1 }));
  const month = { ...cost(0.5, 0.95), period: "month", used: 15, projected: 28.5, spanMs: 31 * 86_400_000, timeLeftMs: 16.5 * 86_400_000, days };
  const c1 = texts(draw("C1", month, 600, 260));
  assert.match(c1, /budget 30,00\s\$/);
  assert.match(c1, /15,00\s\$/);
  assert.match(c1, /fine mese ~28,50\s\$/);
});

test("C20: fascia da p25-p75; i punti fuori fascia in warn", () => {
  const series = [3, 3, 4, 3, 9, 3, 4, 0.5, 3, 4];
  const r = draw("C20", kpi({ metric: "ttft", value: 4, display: "4 s", series, band: { lo: 2, hi: 5 } }), 400, 240);
  assert.equal(count(r, /class="out"/g), 2);
  for (const m of r.match(/<circle [^>]*class="out"[^>]*>/g)) assert.match(m, /fill="var\(--warning\)"/);
  assert.equal(count(r, /class="band"/g), 1);
  assert.equal(count(draw("C20", kpi({ series, band: null }), 400, 240), /class="(band|out)"/g), 0);
});

test("C17: solo Tool senza errori e Prompt riusciti; i giorni senza dati sono neutri", () => {
  const d = (i, calls, errors, runs, failedRuns) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, from: i, tokens: 0, cost: 0, cacheRate: null, runs, failedRuns, ttft: { p50: null, p95: null }, tools: { calls, errors } });
  const days = [d(0, 100, 0, 10, 0), d(1, 100, 10, 10, 1), d(2, 0, 0, 0, 0), d(3, 100, 30, 10, 5)];
  const r = draw("C17", days, 400, 200);
  assert.match(r, /Tool senza errori/);
  assert.match(r, /Prompt riusciti/);
  assert.ok(!/Collegamento|Contratto/.test(r));
  assert.equal(count(r, /class="cell /g), 8);
  assert.equal(count(r, /class="cell none"/g), 2, "il giorno 3 e' neutro in entrambe le righe");
  assert.equal(count(r, /class="cell good"/g), 2, "giorno 1: nessun errore e nessun prompt fallito");
  assert.equal(count(r, /class="cell bad"/g), 2, "giorno 4: 30% di errori, 50% di prompt falliti");
  assert.equal(count(r, /class="cell warn"/g), 2, "giorno 2: 10% di errori e di prompt falliti");
  // a window with no calls at all has nothing to rate
  const quiet = draw("C17", [d(0, 0, 0, 0, 0)], 400, 200);
  assert.equal(count(quiet, /class="cell none"/g), 2);
  assert.ok(quiet.includes("–"));
});

test("C18: titoli ritagliati alla larghezza, un'icona per livello", () => {
  const long = "Budget di un-modello-con-nome-lunghissimo-davvero superato".repeat(2);
  const st = {
    items: [
      { level: "good", title: long, sub: "sub" },
      { level: "warn", title: "b", sub: "s" },
      { level: "bad", title: "c", sub: "s" },
      { level: "good", title: "d", sub: "s" },
    ],
  };
  const r = draw("C18", st, 220, 200);
  const texts = (r.match(/<text [^>]*>[^<]*<\/text>/g) ?? []).join("");
  assert.ok(!texts.includes(long), "il testo disegnato e' ritagliato (il suggerimento resta intero)");
  assert.ok(texts.includes("…"));
  assert.equal(count(r, /class="icon good"/g), 2);
  assert.equal(count(r, /class="icon warn"/g), 1);
  assert.equal(count(r, /class="icon bad"/g), 1);
  assert.ok(draw("C18", { items: [{ level: "good", title: "Sincronizzazione completa", sub: "x" }] }, 480, 200).includes("Sincronizzazione completa"));
});

test("C1: stessa asse e stesso sforamento con 18 o 7 giorni scaricati dello stesso mese", () => {
  const days = (n, shown, perDay) => Array.from({ length: shown }, (_, i) => ({ date: `2026-10-${String(n - shown + i + 1).padStart(2, "0")}`, used: perDay }));
  const month = (n, shown, perDay, limit) => bud((n * perDay) / limit, null, { period: "month", limit, used: n * perDay, spanMs: 31 * 86_400_000, timeLeftMs: (31 - n + 0.5) * 86_400_000, days: days(n, shown, perDay) });
  const texts = (svg) => (svg.match(/<text [^>]*>[^<]*<\/text>/g) ?? []).filter((t) => /(\d+ [a-z]{3}<|oggi<)/.test(t)).join("");
  for (const [perDay, limit] of [
    [10e6, 400e6],
    [20e6, 400e6],
  ]) {
    const full = draw("C1", month(18, 18, perDay, limit), 480, 260);
    const week = draw("C1", month(18, 7, perDay, limit), 480, 260);
    assert.equal(texts(full), texts(week), "stesse etichette dell'asse");
    assert.match(texts(week), /1 ott/);
    assert.match(texts(week), /31 ott/);
    assert.equal(count(full, /class="cross"/g), count(week, /class="cross"/g), `sforamento ${perDay}`);
    assert.equal(num(tag(full, "today"), "cx"), num(tag(week, "today"), "cx"));
    assert.equal(/<polygon [^>]*points="([^"]+)"/.exec(full)[1], /<polygon [^>]*points="([^"]+)"/.exec(week)[1]);
  }
  assert.equal(count(draw("C1", month(18, 7, 10e6, 400e6), 480, 260), /class="cross"/g), 0, "nessun falso sforamento con la finestra corta");
});

test("C14: a destra nessun testo esce dalla carta, a 292, 330 e 380 px", () => {
  const b = bud(0.62, 0.86, { timeLeftMs: 31.5 * 3_600_000, used: 18.6e6, projected: 25.8e6 });
  for (const w of [292, 330, 379, 380, 420]) {
    const r = draw("C14", b, w, 240);
    for (const m of r.matchAll(/<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
      const anchor = /text-anchor="(\w+)"/.exec(m[0])[1];
      const width = m[3].length * m[2] * 0.55;
      const right = anchor === "middle" ? Number(m[1]) + width / 2 : anchor === "end" ? Number(m[1]) : Number(m[1]) + width;
      assert.ok(right <= w + 0.5, `"${m[3]}" esce a destra a ${w}px (${right.toFixed(0)})`);
    }
  }
});

test("dimensioni dei testi: corpo 10-12, una cifra titolo <= 18, solo B11 e C20 fino a 40", () => {
  const { store, daily, summary, hourly } = real();
  const cache = kpiInput("cache", summary, daily, hourly);
  const inputs = {
    B1: bud(0.62, 0.86),
    B2: bud(0.73, 0.9),
    B4: { tokensPerSec: { p50: 52 } },
    B5: all(bud(0.62, 0.86), bud(0.75, 1.01), bud(0.42, 0.79)),
    B10: all(bud(0.62, 0.86), bud(0.75, 1.01), bud(0.42, 0.79)),
    B11: kpi(),
    B12: { ...cache, series: [0.8, 0.9, 0.93] },
    C1: bud(0.5, null, { period: "month", spanMs: 31 * 86_400_000, timeLeftMs: 16.5 * 86_400_000, days: Array.from({ length: 15 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, used: 1e6 })) }),
    C14: bud(0.62, 0.86),
    C16: all(bud(0.62, 0.86), bud(0.75, 1.01), bud(0.42, 0.79)),
    C19: bud(0.3, 0.5),
    C20: kpi({ metric: "ttft", display: "4 s", value: 4 }),
    C17: Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, from: i, tokens: 0, cost: 0, cacheRate: null, runs: 4, failedRuns: 0, ttft: { p50: null, p95: null }, tools: { calls: 10, errors: 1 } })),
    C18: { items: [{ level: "good", title: "Collegato", sub: "ora" }, { level: "bad", title: "Budget superato", sub: "106%" }] },
  };
  for (const id of IDS) {
    checkModel(null, MODELS[id].draw, [inputs[id]], [MODELS[id].min, [480, 240], [1100, 300]], { bigFigure: id === "B11" || id === "C20" ? "required" : false });
  }
  // the KPI figure shrinks with the card height
  const fig = (id, h) => Math.max(...[...draw(id, inputs[id], 480, h).matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])));
  assert.ok(fig("B11", 120) < fig("B11", 300));
  assert.ok(fig("C20", 150) < fig("C20", 300));
  store.close();
});

test("compactBelow: ogni valore numerico corrisponde a un ramo reale (w-1 e w+1 differiscono)", () => {
  const cache = kpi({ metric: "cache", value: 0.93, display: "93%", caption: "del prompt da cache (mediana)", series: [0.8, 0.9, 0.93] });
  const inputs = {
    B1: bud(0.62, 0.86),
    B2: bud(0.73, 0.9),
    B11: kpi({ caption: "primo token (mediana)" }),
    B12: cache,
    C14: bud(0.62, 0.86),
    C16: all(bud(0.62, 0.86), bud(0.75, 1.01), bud(0.42, 0.79)),
    C19: bud(0.3, 0.5),
    C20: kpi({ caption: "primo token (mediana)", metric: "ttft", display: "4 s", value: 4 }),
    B4: SPEED,
    C18: { items: [{ level: "good", title: "Collegato", sub: "ora" }, { level: "bad", title: "Budget superato", sub: "106%" }] },
  };
  const heights = { B12: 160 };
  for (const id of IDS) {
    const cb = MODELS[id].compactBelow;
    if (cb === null) continue;
    const h = heights[id] ?? 240;
    // the drawn words and their alignment (not the geometry, which scales with the width anyway) differ across the threshold
    const words = (w) =>
      (draw(id, inputs[id], w, h).match(/<text [^>]*>[^<]*<\/text>/g) ?? [])
        .map((t) => `${/text-anchor="(\w+)"/.exec(t)?.[1]}:${t.replace(/<[^>]*>/g, "")}`)
        .sort()
        .join("|");
    assert.notEqual(words(cb - 1), words(cb + 1), `${id}: nessun ramo a ${cb}px`);
  }
});

test("C1: le etichette di budget, sforamento e valore di oggi non si sovrappongono (300x180)", () => {
  const days = (n, perDay) => Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, used: perDay }));
  const month = (n, perDay, limit) =>
    bud((n * perDay) / limit, null, { period: "month", limit, used: n * perDay, spanMs: 31 * 86_400_000, timeLeftMs: (31 - n + 0.5) * 86_400_000, days: days(n, perDay) });
  const boxes = (svg) =>
    [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)</g)].map((m) => {
      const [x, y, size, anchor, str] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]];
      const bw = str.length * size * 0.56;
      const x0 = anchor === "end" ? x - bw : anchor === "middle" ? x - bw / 2 : x;
      return { str, x0, x1: x0 + bw, y0: y - size, y1: y };
    });
  const clash = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  for (const [n, perDay, limit] of [[18, 24e6, 500e6], [18, 20e6, 400e6], [18, 30e6, 400e6], [26, 17e6, 500e6]]) {
    const svg = draw("C1", month(n, perDay, limit), 300, 180);
    const bs = boxes(svg);
    const budget = bs.find((b) => b.str.startsWith("budget"));
    const cross = bs.find((b) => /superi|superato/.test(b.str));
    const now = bs.find((b) => b.str === compact(n * perDay));
    assert.ok(budget && now, `${n}/${perDay}: budget label and value label present`);
    assert.ok(!/superi|superato/.test(budget.str), "il giorno di sforamento non sta nell'etichetta del budget");
    assert.ok(!clash(budget, now), `${n}/${perDay}: budget vs oggi`);
    if (cross) {
      assert.ok(!clash(budget, cross), `${n}/${perDay}: budget vs sforamento`);
      assert.ok(!clash(now, cross), `${n}/${perDay}: oggi vs sforamento`);
    }
    // the cross marker keeps the day in its tooltip whether or not the short label fits
    if (/class="cross"/.test(svg)) assert.match(/<circle[^>]*class="cross"[^>]*>/.exec(svg)[0], /data-tip="[^"]*(superi|superato)/);
  }
});

test("C20: la linea non esce dal riquadro del grafico con un picco isolato", () => {
  const series = [3, 3, 3, 3, 40, 3, 3, 3, 3, 3];
  const r = draw("C20", kpi({ metric: "ttft", value: 3, display: "3 s", series, band: { lo: 2, hi: 5 } }), 400, 240);
  const d = /<path d="(M[^"]+C[^"]+)" fill="none" stroke="var\(--series-1\)"/.exec(r)[1];
  const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
  const T0 = 18 + 40 + 14;
  const B0 = 240 - 8;
  assert.ok(ys.every((y) => y >= T0 - 0.1 && y <= B0 + 0.1), ys.join(" "));
});

// Every drawn text stays inside the card (width estimated at 0.55 em per character).
const inBox = (svg, w, h, where) => {
  for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
    const [x, y, size] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const anchor = /text-anchor="(\w+)"/.exec(m[0])[1];
    const width = m[4].replace(/&[#\w]+;/g, "x").length * size * 0.55;
    const x0 = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
    assert.ok(x0 >= -0.5 && x0 + width <= w + 0.5 && y - size * 0.8 >= -0.5 && y <= h + 0.5, `${where}: "${m[4]}" fuori dalla carta`);
  }
};
const STATUS = {
  items: [
    { level: "good", title: "Collegato a OpenCode", sub: "ultimo evento 3 s fa" },
    { level: "warn", title: "Budget del giorno al 84%", sub: "si azzera tra 7 h" },
    { level: "bad", title: "Contratto API cambiato", sub: "2 campi mancanti in message.updated e in session.updated" },
  ],
};

test("C19: seconda colonna (usato, metro, ritmo) solo con 260 px dopo il blocco di testo", () => {
  const b = bud(0.72, 0.95);
  for (const [w, h] of [[313, 136], [420, 160]]) {
    const r = draw("C19", b, w, h);
    assert.match(r, /Restano/);
    assert.ok(!/>Usato<|A questo ritmo/.test(r) && !r.includes('class="meter'), `${w}x${h}: niente seconda colonna`);
    inBox(r, w, h, `C19 ${w}x${h}`);
  }
  for (const [w, h] of [[434, 136], [480, 160]]) {
    const r = draw("C19", b, w, h);
    assert.ok(r.includes(">Usato<") && r.includes(">A questo ritmo<"), `${w}x${h}`);
    assert.ok(r.includes(`>${compact(b.used)} di 30M · 72%<`));
    const track = tag(r, "meter-track");
    assert.ok(Math.abs(num(tag(r, "meter"), "width") / num(track, "width") - 0.72) < 0.01, "metro pieno al 72%");
    assert.ok(Math.abs((num(tag(r, "proj"), "x1") - num(track, "x")) / num(track, "width") - 0.95) < 0.01, "tacca alla proiezione");
    assert.match(r, /fill="var\(--warning\)"[^>]*>28,5M \(95%\)</, "il ritmo prende il tono della proiezione");
    inBox(r, w, h, `C19 ${w}x${h}`);
  }
  assert.ok(!draw("C19", bud(0.72, null), 434, 136).includes('class="proj"'), "senza proiezione niente tacca");
});

test("C19: a 313x136 anello e testo sono centrati come gruppo", () => {
  const r = draw("C19", bud(0.3, 0.5), 313, 136);
  const cx = num(tag(r, "ring-track"), "cx");
  assert.ok(cx > 54 + 14, "l'anello si sposta verso il centro");
  inBox(r, 313, 136, "C19 313x136");
});

test("B2: «restano», pastiglia come quella di B11 e anello che riempie l'altezza", () => {
  const b = bud(0.73, 0.9);
  for (const w of [313, 434]) {
    const r = draw("B2", b, w, 192);
    assert.ok(r.includes(`>restano ${compact(b.limit - b.used)}<`), `${w}: restano`);
    const pill = /<g class="pill"><rect ([^>]*)\/>/.exec(r)[1];
    assert.match(pill, /height="22" rx="11"/);
    assert.match(pill, /fill-opacity="\.14"/);
    assert.equal(num(pill, "width"), Math.round("▲ vicino al limite".length * 6.6 + 24));
    assert.match(r, /font-size="11.5" fill="var\(--warning\)" text-anchor="middle" font-weight="700">▲ vicino al limite</);
    inBox(r, w, 192, `B2 ${w}x192`);
  }
  // the first tick points up from the centre: its outer end is R above it
  const outer = (w, h) => h / 2 - num(tag(draw("B2", b, w, h), "tick on"), "y2");
  assert.ok(Math.abs(outer(434, 192) - 90) < 0.01, "a 434x192 il raggio è h/2 − 6");
  assert.ok(Math.abs(outer(313, 192) - (313 - 176) / 2) < 0.01, "a 313x192 il raggio viene dalla larghezza");
  assert.ok(draw("B2", bud(1.2, 1.4), 434, 192).includes(">oltre di 6M<"));
  assert.ok(!draw("B2", b, 260, 192).includes("restano"), "forma ridotta: solo l'anello");
});

test("C14: anello fino a 110 px, «restano» nella legenda", () => {
  const b = bud(0.62, 0.86);
  const r = draw("C14", b, 434, 192);
  assert.ok(r.includes(`>restano ${compact(b.limit - b.used)}<`));
  inBox(r, 434, 192, "C14 434x192");
  // R = 110 (cap), outer stroke 16: track radius 102
  assert.equal(num(tag(draw("C14", b, 700, 300), "ring-track"), "r"), 102);
  assert.ok(!draw("C14", b, 313, 192).includes("restano"), "sotto 380 px solo gli anelli");
});

test("B4: da 380 px colonna con primo token, coda dei tool e numero di step", () => {
  const wide = draw("B4", SPEED, 434, 192);
  for (const s of ["Primo token", "1,2 s", "p95 3,4 s", "Coda dei tool", "820 ms", "su 37 step"]) assert.ok(wide.includes(`>${s}<`), s);
  assert.ok(Math.abs(lineAngle(tag(wide, "needle")) - norm(Math.PI * 0.8 + Math.PI * 1.4 * 0.52)) < 0.01, "la lancetta non cambia");
  inBox(wide, 434, 192, "B4 434x192");
  const narrow = draw("B4", SPEED, 313, 192);
  assert.ok(!narrow.includes("Primo token"), "a 313 px solo il tachimetro");
  inBox(narrow, 313, 192, "B4 313x192");
  // without the extra data the gauge stays alone and centred
  const bare = draw("B4", { tokensPerSec: { p50: 52 } }, 434, 192);
  assert.ok(!bare.includes("Primo token"));
  assert.equal(num(tag(bare, "needle"), "x1"), 217);
});

test("C18: da 380 px una riga per voce, sottotitolo a destra; sotto, il sottotitolo va sotto il titolo", () => {
  const wide = draw("C18", STATUS, 434, 136);
  const subs = wide.match(/<text [^>]*text-anchor="end"[^>]*>[^<]*<\/text>/g) ?? [];
  assert.equal(subs.length, 4, "il sottotitolo lungo va a capo");
  for (const t of subs) {
    assert.equal(num(t, "x"), 430);
    assert.equal(num(t, "font-size"), 10.5);
  }
  assert.match(subs[2], />2 campi mancanti in</, "a capo a uno spazio");
  assert.ok(subs[3].includes("…"), "oltre le due righe è ritagliato");
  const ys = (svg) => [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ys(wide)).size, 5, "titolo e sottotitolo corto sulla stessa riga, il lungo su due righe attorno al titolo");
  inBox(wide, 434, 136, "C18 434x136");
  const narrow = draw("C18", STATUS, 313, 136);
  assert.ok(!narrow.includes('text-anchor="end"'));
  assert.equal(new Set(ys(narrow)).size, 7, "a 313x136 tre voci su due righe, la terza su tre");
  inBox(narrow, 313, 136, "C18 313x136");
  // too low for a third line: the sub is cut in one
  const low = draw("C18", STATUS, 313, 110);
  assert.equal(new Set(ys(low)).size, 6);
  inBox(low, 313, 110, "C18 313x110");
});

test("C18: la nota «sessioni, ultima alle» va a capo invece di tagliarsi", () => {
  const st = { items: [{ level: "good", title: "Sincronizzazione completa", sub: "2181 sessioni, ultima alle 22:41" }] };
  const texts = (svg) => (svg.match(/<text [^>]*>[^<]*<\/text>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, ""));
  for (const w of [220, 230]) {
    const r = draw("C18", st, w, 120);
    assert.deepEqual(texts(r).slice(1), ["2181 sessioni, ultima alle", "22:41"], `${w} px: a capo a uno spazio, mai dentro l'ora`);
    inBox(r, w, 120, `C18 ${w}x120`);
  }
  assert.deepEqual(texts(draw("C18", st, 300, 120)).slice(1), ["2181 sessioni, ultima alle 22:41"], "intera quando ci sta");
});
