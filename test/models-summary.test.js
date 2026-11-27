// Modelli del Riepilogo (C22, C23, B13): ingressi reali dal vero livello di query, cifre, barrette, anelli, allineamento e stati vuoti.
process.env.TZ = "Europe/Rome";

import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryInput } from "../public/adapt.js";
import { MODELS } from "../public/models-summary.js";
import { compact, full, money, pct } from "../public/ui.js";
import { Queries } from "../src/queries.js";
import { addInternal, addSession, addStep, addTool, memoryStore, tokens } from "./helpers.js";
import { SIZES, checkModel } from "./models-helpers.js";

const at = (s) => new Date(s).getTime();
const NOW = at("2026-10-15T12:00");
const DAY = [at("2026-10-15T00:00"), at("2026-10-16T00:00")];
const IDS = ["C22", "C23", "B13"];
const box = (w = 480, h = 240) => ({ w, h, uid: "u", label: "prova" });
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const tips = (svg) => [...svg.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1].replaceAll("&#39;", "'"));
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const tagsOf = (svg, re) => [...svg.matchAll(re)].map((m) => m[0]);
const sizesOf = (svg) => [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));

function fixture() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", title: "Refactor" });
  addSession(store, { id: "ses_2" });
  const step = (id, session, when, t, extra = {}) =>
    addStep(store, { id, session, provider: "az", model: "qwen", started: at(when), ended: at(when) + 60_000, tokens: t, cost: 1, ...extra });
  step("a", "ses_1", "2026-10-15T09:00", tokens(2000, 600, 100, 6000, 300));
  step("b", "ses_1", "2026-10-15T10:00", tokens(300, 30));
  step("c", "ses_2", "2026-10-15T10:30", tokens(100, 10), { finish: "error" });
  addInternal(store, { id: "i", created: at("2026-10-15T09:30"), cost: 0.25, tokens: tokens(50, 5) });
  addTool(store, { id: "t1", name: "bash", status: "completed", created: at("2026-10-15T09:00"), ended: at("2026-10-15T09:00") + 1000 });
  addTool(store, { id: "t2", name: "read", status: "error", created: at("2026-10-15T09:01"), ended: at("2026-10-15T09:01") + 500, errorMsg: "no" });
  const sum = new Queries(store).summary(...DAY, NOW);
  store.close();
  return { sum, input: summaryInput(sum) };
}
const F = fixture();
// one step, nothing else
const ONE = summaryInput({ steps: 1, sessions: 1, models: 1, cost: 0.01, tokens: { input: 7, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 8 }, cacheRate: 0, latencyMs: { p50: 1200, p95: 1200, n: 1 }, tools: { calls: 0, errors: 0 } });

test("il catalogo ha i tre modelli con nome, misura minima e soglia compatta", () => {
  assert.deepEqual(Object.keys(MODELS), IDS);
  const mins = { C22: [300, 110], C23: [300, 200], B13: [300, 180] };
  const compactBelow = { C22: 640, C23: 640, B13: 360 };
  for (const id of IDS) {
    const m = MODELS[id];
    assert.equal(typeof m.name, "string", id);
    assert.deepEqual(m.min, mins[id], id);
    assert.equal(m.compactBelow, compactBelow[id], id);
    assert.equal(typeof m.draw, "function", id);
  }
});

// C22: six figures up to 24 px; C23: the token figure (26-40) and five up to 18; B13: six up to 18
const TYPE = { C22: { bigFigure: true, headlines: 6 }, C23: { bigFigure: "required", headlines: 6 }, B13: { bigFigure: false, headlines: 6 } };

for (const id of IDS) {
  test(`${id}: disegna l'ingresso reale e uno step solo a tutte le misure; vuoto senza step`, () => {
    const m = MODELS[id];
    const sizes = [...SIZES, m.min, [360, 200], [560, 220], [1118, 84], [1398, 80], [1398, 136], [675, 192], [707, 192], [707, 254]];
    checkModel(null, m.draw, [F.input, ONE], sizes, TYPE[id]);
    for (const [w, h] of sizes) {
      for (const empty of [null, undefined, summaryInput({}), summaryInput({ steps: 0, tokens: { total: 0 } })]) {
        const out = m.draw(empty, box(w, h));
        assert.equal(out.empty, "Nessuno step nel periodo", `${id} vuoto @ ${w}x${h}`);
      }
      assert.equal(typeof m.draw(F.input, box(w, h)), "string", `${id} reale @ ${w}x${h}`);
    }
  });
}

test("le cifre sono quelle del riepilogo: token con i task interni, costo, step, cache, latenza, tool, e il tooltip ha i numeri interi", () => {
  const s = F.input;
  assert.ok(s.internalTokens > 0 && s.failedSteps === 1 && s.tools.errors === 1, "il fixture ha task interni, uno step fallito e un errore dei tool");
  for (const id of IDS) {
    const svg = MODELS[id].draw(s, box(1100, 300));
    const all = texts(svg);
    for (const v of [compact(s.tokens), money(s.cost), full(s.steps), pct(s.cacheRate), full(s.tools.calls)]) assert.ok(all.includes(v), `${id}: manca ${v} in ${all.join("|")}`);
    const t = tips(svg);
    assert.ok(t.some((x) => x.startsWith(`Token nel periodo: ${full(s.tokens)}`) && x.includes(`task interni ${full(s.internalTokens)}`)), `${id}: ${t.join("|")}`);
    assert.ok(t.some((x) => x.includes("1 errori")), `${id}: errori dei tool`);
    assert.ok(t.some((x) => x.includes("1 falliti")), `${id}: step falliti`);
    assert.equal(tagsOf(svg, /<rect class="hit"[^>]*>/g).length, 6, `${id}: un'area per cifra`);
  }
});

// the captions: 12 px in the secondary ink
const captions = (svg) => tagsOf(svg, /<text[^>]*font-size="12" fill="var\(--text-secondary\)"[^>]*>[^<]*<\/text>/g).map((t) => ({ y: Number(attr(t, "y")), x: Number(attr(t, "x")), s: t.replace(/<[^>]*>/g, "") }));

test("C22: sei cifre in riga da 24 px, tre per riga sotto la soglia con le didascalie corte", () => {
  const svg = MODELS.C22.draw(F.input, box(1118, 84));
  const wide = texts(svg);
  for (const c of ["Token nel periodo", "Costo stimato", "Step", "Prompt da cache", "Latenza step", "Chiamate tool"]) assert.ok(wide.includes(c), c);
  // a strip of KPI figures: every value a 24 px headline, captions, notes and feet body text
  assert.deepEqual(sizesOf(svg).filter((v) => v > 12), [24, 24, 24, 24, 24, 24]);
  // the first column is the wider (1.4 fr): the second caption starts at 1.4 / 6.4 of the width
  const caps = captions(svg);
  assert.ok(Math.abs(caps[1].x - (1118 * 1.4) / 6.4 - 14) < 1, String(caps[1].x));
  const narrow = texts(MODELS.C22.draw(F.input, box(300, 110)));
  for (const c of ["Token", "Costo", "Step", "Cache", "Latenza", "Tool"]) assert.ok(narrow.includes(c), c);
  assert.ok(!narrow.includes("Prompt da cache"));
  assert.ok(sizesOf(MODELS.C22.draw(F.input, box(300, 110))).every((v) => v <= 18), "sotto la soglia le cifre sono più piccole");
  // the note only when the strip is at least 76 px high; falliti/retry live in the bar and its tooltip
  assert.ok(texts(MODELS.C22.draw(F.input, box(1398, 80))).includes(`${full(F.input.sessions)} sessioni · ${full(F.input.models)} modelli`));
  assert.ok(!texts(MODELS.C22.draw(F.input, box(1398, 70))).some((t) => t.includes("sessioni")));
  assert.ok(!texts(MODELS.C22.draw(F.input, box(1398, 80))).some((t) => t.includes("falliti")));
  // the first token's time joins the latency note only when it fits
  const sp = summaryInput({ ...F.sum, speed: { ttftMs: { p50: 1300, p95: 4000 }, tokensPerSec: { p50: 60 } } });
  assert.ok(texts(MODELS.C22.draw(sp, box(1800, 80))).some((t) => t.startsWith("mediana · p95") && t.endsWith("primo token 1,3 s")));
  assert.ok(!texts(MODELS.C22.draw(sp, box(700, 80))).some((t) => t.includes("primo token")));
});

test("i blocchi stanno in alto: le didascalie sulla stessa riga in C22 e in C23", () => {
  for (const [id, w, h] of [["C22", 1398, 80], ["C22", 1398, 200], ["C23", 1398, 136], ["C23", 707, 136], ["C23", 1100, 300]]) {
    const ys = new Set(captions(MODELS[id].draw(F.input, box(w, h))).map((c) => c.y));
    assert.deepEqual([...ys], [14], `${id} @ ${w}x${h}`);
  }
  // under the threshold: one line of captions per row of figures
  const rows = new Set(captions(MODELS.C22.draw(F.input, box(300, 110))).map((c) => c.y));
  assert.deepEqual([...rows], [14, 69]);
});

test("ogni cifra ha la sua barretta con il tooltip dei numeri", () => {
  const s = F.input;
  const svg = MODELS.C22.draw(s, box(1398, 80));
  const meters = tagsOf(svg, /<g class="meter"[^>]*>/g);
  assert.deepEqual(meters.map((t) => attr(t, "data-meter")), ["tokens", "cost", "steps", "cache", "latency", "tools"]);
  const tip = Object.fromEntries(meters.map((t) => [attr(t, "data-meter"), tips(t)[0]]));
  for (const k of ["cache letta", "output"]) assert.ok(tip.tokens.includes(k), tip.tokens);
  assert.ok(tip.tokens.includes(full(s.kinds.cacheRead)), tip.tokens);
  assert.ok(tip.cost.includes(money(s.internalCost)) && tip.cost.includes(pct(s.internalCost / s.cost)), tip.cost);
  assert.ok(tip.steps.includes(`${full(s.steps - s.failedSteps)} riusciti`) && tip.steps.includes("1 falliti"), tip.steps);
  assert.ok(tip.cache.includes(pct(s.cacheRate)), tip.cache);
  assert.ok(tip.latency.includes(`p95`) && tip.latency.includes(`${full(s.latency.n)} step completati`), tip.latency);
  assert.ok(tip.tools.includes("1 errori") && tip.tools.includes(`successo ${pct(1 - s.tools.errors / s.tools.calls)}`), tip.tools);
  // the segments: the kinds in their colours, the failed steps in --critical, the cache in --series-3 (no status colour)
  const body = (k) => svg.slice(svg.indexOf(`data-meter="${k}"`), svg.indexOf("</g>", svg.indexOf(`data-meter="${k}"`)));
  assert.ok(body("tokens").includes("var(--kind-cread)"));
  assert.ok(body("steps").includes("var(--critical)"));
  assert.ok(body("cache").includes("var(--series-3)") && !body("cache").includes("var(--good)"));
  assert.ok(body("cost").includes("var(--series-7)"));
  // the tools' errors on C17's thresholds: 1 of 2 calls failed, below 85%
  assert.ok(body("tools").includes("var(--critical)"));
  // C23: the five on the right have one each
  const c23 = tagsOf(MODELS.C23.draw(s, box(1398, 136)), /<g class="meter"[^>]*>/g).map((t) => attr(t, "data-meter"));
  assert.deepEqual(c23, ["cost", "steps", "cache", "latency", "tools"]);
});

test("C23: la cifra grande dei token, la barra della composizione per tipo e le altre cinque cifre", () => {
  const svg = MODELS.C23.draw(F.input, box(1398, 136));
  const big = sizesOf(svg).filter((v) => v > 18);
  assert.deepEqual(big, [Math.round(136 * 0.26)]);
  assert.deepEqual(sizesOf(svg).filter((v) => v > 12 && v <= 18), [18, 18, 18, 18, 18]);
  const bars = tagsOf(svg, /<rect[^>]*data-kind="[^"]*"[^>]*>/g);
  const present = Object.entries(F.input.kinds).filter(([, v]) => v > 0);
  assert.equal(bars.length, present.length, "una barra per tipo presente");
  const total = present.reduce((a, [, v]) => a + v, 0);
  for (const tag of bars) {
    const v = F.input.kinds[attr(tag, "data-kind")];
    assert.equal(attr(tag, "height"), "10");
    assert.ok(tips(tag).some((x) => x.includes(full(v)) && x.includes(pct(v / total))), tag);
  }
  // the bars fill the token block's width (minus the 2 px gaps between them)
  const leftW = Math.round(1398 * 0.4);
  const sum = bars.reduce((a, t) => a + Number(attr(t, "width")), 0);
  assert.ok(Math.abs(sum - (leftW - 8 - 2 * (bars.length - 1))) < 1, String(sum));
  // the legend: name, then amount and share
  const all = texts(svg);
  const [k, v] = present[0];
  const names = { cacheRead: "cache letta", input: "input", cacheWrite: "cache scritta", output: "output", reasoning: "ragionamento" };
  assert.ok(all.includes(names[k]) && all.includes(`${compact(v)} · ${pct(v / total)}`), all.join("|"));
  for (const c of ["Costo stimato", "Step", "Prompt da cache", "Latenza step", "Chiamate tool"]) assert.ok(all.includes(c), c);
  // narrow: the five under the token block when there is room (the legend gives way first), the figure alone when there is not
  const cost = (w, h) => texts(MODELS.C23.draw(F.input, box(w, h))).some((t) => t.startsWith("Costo"));
  assert.ok(cost(300, 260) && cost(300, 200));
  assert.ok(!cost(300, 120));
});

test("B13: sei tessere, la ciambella dei tipi di token, un anello per quota e la latenza come baffo", () => {
  const s = F.input;
  const svg = MODELS.B13.draw(s, box(675, 192));
  const present = Object.entries(s.kinds).filter(([, v]) => v > 0);
  assert.equal(tagsOf(svg, /<path[^>]*data-kind="[^"]*"[^>]*>/g).length, present.length, "la ciambella: un arco per tipo");
  const rings = tagsOf(svg, /<g class="ring"[^>]*>/g).map((t) => attr(t, "data-ring"));
  assert.deepEqual(rings, ["tokens", "cost", "steps", "cache", "latency", "tools"]);
  assert.equal(tagsOf(svg, /<circle[^>]*stroke="var\(--wash\)"[^>]*>/g).length, 5, "ogni anello ha la traccia; la latenza no");
  const ring = (k) => svg.slice(svg.indexOf(`data-ring="${k}"`), svg.indexOf("</g>", svg.indexOf(`data-ring="${k}"`)));
  assert.ok(!ring("latency").includes("<circle") && ring("latency").includes("var(--text-secondary)"), "il baffo con la tacca della mediana");
  // shares of success: the steps 2 of 3 and the tools 1 of 2 are below 85%; the cache in --series-3
  assert.ok(ring("steps").includes("var(--critical)") && texts(ring("steps")).includes(pct(2 / 3)), ring("steps"));
  assert.ok(ring("tools").includes("var(--critical)") && texts(ring("tools")).includes(pct(0.5)));
  assert.ok(ring("cache").includes("var(--series-3)") && !ring("cache").includes("var(--good)"));
  // the internal tasks' share of the cost: a ring from 5%, the track only below
  const share = s.internalCost / s.cost;
  assert.ok(share >= 0.05 && ring("cost").includes("ring-value") && texts(ring("cost")).includes(pct(share)), String(share));
  const tiny = MODELS.B13.draw(summaryInput({ ...F.sum, cost: 100 }), box(675, 192));
  const tinyCost = tiny.slice(tiny.indexOf('data-ring="cost"'), tiny.indexOf("</g>", tiny.indexOf('data-ring="cost"')));
  assert.ok(!tinyCost.includes("ring-value") && !texts(tinyCost).length, tinyCost);
  // all steps succeeded and no tool error: full green rings
  const fine = MODELS.B13.draw(summaryInput({ ...F.sum, tools: { calls: 3, errors: 0 }, failedSteps: 0 }), box(675, 192));
  for (const k of ["steps", "tools"]) {
    const r = fine.slice(fine.indexOf(`data-ring="${k}"`), fine.indexOf("</g>", fine.indexOf(`data-ring="${k}"`)));
    assert.ok(r.includes("var(--good)") && texts(r).includes("100%"), r);
  }
  // the rings grow with the tile: at 675x192 the radius is a third of the tile's height
  const track = tagsOf(svg, /<circle[^>]*>/g)[0];
  assert.ok(Math.abs(Number(attr(track, "r")) - 96 * 0.34) < 0.1, track);
  // values 18 px, only vertical dividers
  assert.deepEqual(sizesOf(svg).filter((v) => v > 12), [18, 18, 18, 18, 18, 18]);
  for (const l of tagsOf(svg, /<line[^>]*>/g)) assert.equal(attr(l, "x1"), attr(l, "x2"), l);
  // two per row under the threshold: still six hit areas
  assert.equal(tagsOf(MODELS.B13.draw(s, box(300, 180)), /<rect class="hit"[^>]*>/g).length, 6);
});

test("compactBelow: ogni soglia e un ramo reale del codice", () => {
  for (const id of IDS) {
    const m = MODELS[id];
    const h = Math.max(m.min[1], 260);
    const sig = (w) => texts(m.draw(F.input, box(w, h))).join("|");
    assert.notEqual(sig(m.compactBelow - 1), sig(m.compactBelow), `${id}: nessuna differenza a ${m.compactBelow}`);
  }
});

test("nessun testo esce dal riquadro, al minimo, a 480x240 e alle misure predefinite", () => {
  for (const id of IDS) {
    const m = MODELS[id];
    for (const [w, h] of [m.min, [480, 240], [1118, 84], [1398, 80], [1398, 136], [675, 192], [707, 254]]) {
      for (const input of [F.input, ONE]) {
        const svg = m.draw(input, box(w, h));
        for (const t of svg.matchAll(/<text\b[^>]*>[^<]*<\/text>/g)) {
          const x = Number(/\bx="([-\d.]+)"/.exec(t[0])?.[1]);
          const size = Number(/font-size="([\d.]+)"/.exec(t[0])?.[1] ?? 11);
          const anchor = /text-anchor="(\w+)"/.exec(t[0])?.[1] ?? "start";
          const label = t[0].replace(/<[^>]*>/g, "").replace(/&(lt|gt|amp|quot|#\d+);/g, "?");
          const len = label.length * size * 0.56;
          const [lo, hi] = anchor === "middle" ? [x - len / 2, x + len / 2] : anchor === "end" ? [x - len, x] : [x, x + len];
          assert.ok(lo >= -0.5 && hi <= w + 0.5, `${id} @ ${w}x${h}: "${label}" occupa ${lo.toFixed(1)}..${hi.toFixed(1)}`);
        }
      }
    }
  }
});

test("senza costi: il Riepilogo non ha la cifra del costo", async () => {
  const { prefs } = await import("../public/prefs.js");
  const svgOf = () => MODELS.C22.draw(F.input, { w: 1118, h: 84, uid: "c" });
  assert.ok(svgOf().includes("Costo"), "con i costi c'è");
  prefs.costs = false;
  try {
    const svg = svgOf();
    assert.ok(!svg.includes("Costo") && !svg.includes("$"), "senza costi sparisce");
  } finally {
    prefs.costs = true;
  }
});
