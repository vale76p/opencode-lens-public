// Modelli di distribuzione e composizione, su corpi prodotti dal vero livello di query.
process.env.TZ = "Europe/Rome";

import assert from "node:assert/strict";
import { test } from "node:test";
import { niceMax } from "../public/draw.js";
import { lanesInput, modelsInput, rhythmInput, runsInput } from "../public/adapt.js";
import { MODELS } from "../public/models-dist.js";
import { compact, pct, quantile } from "../public/ui.js";
import { Queries } from "../src/queries.js";
import { HOSTILE, SIZES, checkModel } from "./models-helpers.js";
import { addPrompt, addRun, addSession, addStep, addTool, memoryStore, tokens } from "./helpers.js";

const at = (s) => new Date(s).getTime();
const NOW = at("2026-10-15T12:00");
const DAY = [at("2026-10-15T00:00"), at("2026-10-16T00:00")];
const WIDE = [at("2026-10-12T00:00"), at("2026-10-16T00:00")];
const SLOTS = ["az/qwen", "az/llama", "az/mistral"];
const slotFor = (_by, key) => {
  const i = SLOTS.indexOf(key);
  return i >= 0 ? i + 1 : "other";
};

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const tagsOf = (svg, re) => [...svg.matchAll(re)].map((m) => m[0]);
const box = (w = 480, h = 240) => ({ w, h, uid: "u", label: "prova" });
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

function seeded() {
  const store = memoryStore();
  addSession(store, { id: "ses_1", title: "Refactor del collector" });
  addSession(store, { id: "ses_2", title: HOSTILE });
  const step = (id, session, model, when, t, extra = {}) =>
    addStep(store, { id, session, provider: "az", model, started: at(when), ended: at(when) + 60_000, tokens: t, cost: 0.5, ...extra });
  const timed = (when) => ({ requested: at(when), firstOutput: at(when) + 2000, streamed: at(when) + 12_000 });
  step("y1", "ses_1", "qwen", "2026-10-14T09:00", tokens(1000, 100, 0, 800, 0), timed("2026-10-14T09:00"));
  step("y2", "ses_2", "llama", "2026-10-14T10:00", tokens(40_000, 500, 100, 0, 0), timed("2026-10-14T10:00"));
  step("a", "ses_1", "qwen", "2026-10-15T00:10", tokens(500, 50));
  step("b", "ses_1", "qwen", "2026-10-15T09:00", tokens(2000, 200, 0, 60_000, 100), timed("2026-10-15T09:00"));
  step("c", "ses_2", "llama", "2026-10-15T10:00", tokens(300, 30, 20, 0, 0), timed("2026-10-15T10:00"));
  step("d", "ses_2", "qwen", "2026-10-15T10:30", tokens(100, 10), { finish: "error" });
  step("e", "ses_1", "mistral", "2026-10-15T11:00", tokens(150_000, 3000, 0, 20_000, 0), timed("2026-10-15T11:00"));
  addTool(store, { id: "t1", session: "ses_1", name: "bash", status: "completed", created: at("2026-10-15T09:00"), ended: at("2026-10-15T09:00") + 1000 });
  addTool(store, { id: "t2", session: "ses_1", name: "read", status: "completed", created: at("2026-10-15T09:01"), ended: at("2026-10-15T09:01") + 500 });
  addPrompt(store, { id: "p1", session: "ses_1", created: at("2026-10-15T08:59") });
  addRun(store, { id: "r0", session: "ses_1", started: at("2026-10-14T08:59"), ended: at("2026-10-14T09:20") });
  addRun(store, { id: "r00", session: "ses_2", started: at("2026-10-14T09:59"), ended: at("2026-10-14T10:40") });
  addRun(store, { id: "r1", session: "ses_1", started: at("2026-10-15T08:59"), ended: at("2026-10-15T09:20") });
  addRun(store, { id: "r2", session: "ses_2", started: at("2026-10-15T09:55"), ended: at("2026-10-15T10:50"), outcome: "failed" });
  addRun(store, { id: "r3", session: "ses_1", started: at("2026-10-15T10:55"), ended: at("2026-10-15T11:30") });
  addRun(store, { id: "r4", session: "ses_2", started: null, ended: at("2026-10-15T11:40"), outcome: "interrupted", reason: "user" });
  return store;
}

function fixture() {
  const store = seeded();
  const q = new Queries(store);
  const models = modelsInput(q.breakdown(...DAY, "model"), q.budget(NOW), slotFor);
  const rows = q.runs(...WIDE, { steps: true });
  const out = {
    models,
    summary: q.summary(...DAY, NOW),
    calendar: q.calendar("tokens", NOW),
    rhythm: rhythmInput(q.rhythm(28, NOW)),
    runs: runsInput(rows),
    lanes: lanesInput(rows, NOW),
    runSummary: q.runSummary(...WIDE),
  };
  store.close();
  return out;
}

const F = fixture();
// the run-stats input (adapt.js promptsInput): the runs and the period's count, by default all of them
const P = (runs, total = runs.length) => ({ runs, total });

test("il catalogo ha i quattordici modelli con nome, misura minima e soglia compatta", () => {
  assert.deepEqual(Object.keys(MODELS), ["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "C7", "C9", "C10", "C11", "C12", "C13"]);
  for (const [id, m] of Object.entries(MODELS)) {
    assert.equal(typeof m.name, "string", id);
    assert.ok(m.min.length === 2 && m.min[0] > 0 && m.min[1] > 0, id);
    assert.ok(m.compactBelow === null || Number.isFinite(m.compactBelow), id);
    assert.equal(typeof m.draw, "function", id);
  }
  const mins = { G5: [300, 120], G6: [300, 140], G7: [300, 180], G8: [300, 180], G9: [260, 160], G10: [240, 160], G11: [300, 190], G12: [220, 160], C7: [300, 180], C9: [300, 180], C10: [300, 180], C11: [300, 160], C12: [300, 180], C13: [220, 140] };
  for (const [id, min] of Object.entries(mins)) assert.deepEqual(MODELS[id].min, min, id);
});

const hostile = (models) => models.map((m) => ({ ...m, key: `az/${HOSTILE}`, label: HOSTILE }));
const hostileRuns = (runs) => runs.map((r) => ({ ...r, title: HOSTILE, models: [`az/${HOSTILE}`] }));
const hostileLanes = (l) => ({ ...l, lanes: l.lanes.map((x) => ({ ...x, title: HOSTILE })) });

const CASES = {
  G5: { real: [F.rhythm], empty: rhythmInput(null), one: rhythmInput({ days: 1, cells: [[1, ...Array(23).fill(0)], ...Array(6).fill(Array(24).fill(0))], prompts: [] }), hostile: [] },
  G6: { real: [F.calendar], empty: { metric: "tokens", days: [], max: 0, streak: 0, longestStreak: 0, activeDays: 0 }, one: { metric: "tokens", days: [{ date: "2026-10-15", value: 5, steps: 1 }], max: 5, streak: 1, longestStreak: 1, activeDays: 1 }, hostile: [] },
  G7: { real: [P(F.runs), P(F.runs, 1586)], empty: P([]), one: P([F.runs[0]]), hostile: [P(hostileRuns(F.runs))] },
  G8: { real: [F.runSummary], empty: { count: 0, histogram: [], tokens: { p50: null, p95: null, n: 0 } }, one: { count: 1, histogram: [{ lo: 0, hi: 10000, count: 1 }, { lo: 10000, hi: null, count: 0 }], tokens: { p50: 5000, p95: 5000, n: 1 } }, hostile: [] },
  G9: { real: [F.models], empty: [], one: [F.models[0]], hostile: [hostile(F.models)] },
  G10: { real: [F.summary], empty: { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, one: { tokens: { input: 7, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 7 } }, hostile: [] },
  G11: { real: [F.models], empty: [], one: [F.models[0]], hostile: [hostile(F.models)] },
  G12: { real: [F.models], empty: [], one: [F.models[0]], hostile: [hostile(F.models)] },
  C7: { real: [F.lanes, { ...F.lanes, shown: 200, total: 1586 }], empty: { from: NOW, to: NOW, now: NOW, lanes: [] }, one: { from: NOW, to: NOW, now: NOW, lanes: [{ sessionID: "s", title: "s", slot: 1, runs: [{ started: NOW, ended: NOW, steps: [] }] }] }, hostile: [hostileLanes(F.lanes)] },
  C9: { real: [F.models], empty: [], one: [F.models[0]], hostile: [hostile(F.models)] },
  C10: { real: [P(F.runs), P(F.runs, 1586)], empty: P([]), one: P([F.runs[0]]), hostile: [P(hostileRuns(F.runs))] },
  C11: { real: [P(F.runs), P(F.runs, 1586)], empty: P([]), one: P([F.runs[0]]), hostile: [P(hostileRuns(F.runs))] },
  C12: { real: [P(F.runs), P(F.runs, 1586)], empty: P([]), one: P([F.runs[0]]), hostile: [P(hostileRuns(F.runs))] },
  C13: { real: [F.summary], empty: { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, one: { tokens: { input: 7, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 7 } }, hostile: [] },
};

for (const [id, c] of Object.entries(CASES)) {
  test(`${id}: disegna ingressi reali, uno solo, vuoto e ostile a tutte le misure`, () => {
    const m = MODELS[id];
    const sizes = [...SIZES, m.min];
    checkModel(null, m.draw, [...c.real, c.one, ...c.hostile], sizes);
    for (const [w, h] of sizes) {
      const empty = m.draw(c.empty, box(w, h));
      assert.equal(typeof empty.empty, "string", `${id} vuoto @ ${w}x${h}`);
      assert.ok(empty.empty.length > 3);
      for (const input of c.real) assert.equal(typeof m.draw(input, box(w, h)), "string", `${id} reale @ ${w}x${h}`);
    }
  });
}

test("G5: 7x24 celle, opacita proporzionale a cella / massimo", () => {
  const svg = MODELS.G5.draw(F.rhythm, box(600, 260));
  const cells = tagsOf(svg, /<rect[^>]*data-cell="[^"]*"[^>]*>/g);
  assert.equal(cells.length, 168);
  const max = F.rhythm.max;
  assert.ok(max > 0);
  for (const tag of cells) {
    const [d, h] = attr(tag, "data-cell").split(",").map(Number);
    const v = F.rhythm.cells[d][h];
    if (v > 0) assert.ok(Math.abs(Number(attr(tag, "fill-opacity")) - v / max) < 0.002, `cella ${d},${h}`);
    else assert.equal(attr(tag, "fill"), "var(--wash)");
  }
  assert.ok(cells.some((t) => Number(attr(t, "fill-opacity")) === 1), "la cella massima e piena");
  // small squares, never big tiles: every cell is square and at most 12 px, whatever the room
  for (const tag of cells) {
    const cw = Number(attr(tag, "width"));
    assert.equal(Number(attr(tag, "height")), cw, "quadrata");
    assert.ok(cw > 0 && cw <= 12, `lato ${cw}`);
  }
  // the figures sit right of the grid: two columns from 600 px, one (short forms) from 400, none below
  const all = texts(svg);
  assert.ok(["Ora di punta", "Giorno di punta", "Media a settimana", "Ore attive"].every((l) => all.includes(l)), all.join("|"));
  const peak = F.rhythm.hourSums.indexOf(Math.max(...F.rhythm.hourSums));
  const hh = (n) => String(n % 24).padStart(2, "0");
  const peakText = `${hh(peak)}:00–${hh(peak + 1)}:00`;
  assert.ok(all.includes(peakText), all.join("|"));
  const xOf = (s, label) => Number(attr(tagsOf(s, new RegExp(`<text[^>]*>${label}</text>`, "g"))[0], "x"));
  const cellsOf = (s) => tagsOf(s, /<rect[^>]*data-cell="[^"]*"[^>]*>/g);
  const gridRight = (s) => Math.max(...cellsOf(s).map((t) => Number(attr(t, "x")) + Number(attr(t, "width"))));
  assert.ok(xOf(svg, "Ora di punta") > gridRight(svg), "a destra della griglia");
  // the default card (5 x 4) and its neighbours: small squares, the hour band, the scale always, nothing outside the box
  for (const [w, h] of [[675, 136], [554, 136], [434, 136], [399, 136], [300, 120], [1100, 300]]) {
    const at = `${w}x${h}`;
    const s = MODELS.G5.draw(F.rhythm, box(w, h));
    const cs = cellsOf(s);
    assert.equal(cs.length, 168, at);
    for (const tag of cs) {
      assert.equal(attr(tag, "width"), attr(tag, "height"), `${at}: quadrata`);
      assert.ok(Number(attr(tag, "width")) <= 12, `${at}: lato ${attr(tag, "width")}`);
    }
    assert.equal(tagsOf(s, /<rect[^>]*data-hour="[^"]*"[^>]*>/g).length, 24, `${at}: banda delle ore`);
    const t = texts(s);
    assert.ok(t.includes("meno") && t.includes("più"), `${at}: legenda della scala`);
    // the legend squares are as big as the cells
    const legend = tagsOf(s, /<rect(?![^>]*data-)[^>]*fill-opacity[^>]*>/g);
    assert.equal(legend.length, 5, at);
    for (const tag of legend) assert.equal(attr(tag, "width"), attr(cs[0], "width"), at);
    assert.equal(t.includes("Ora di punta"), w >= 400, `${at}: cifre`);
    inBox(s, w, h);
    // the drawing spans the width: no large empty margin on the right
    const rects = tagsOf(s, /<rect\b[^>]*>/g).map((tag) => Number(attr(tag, "x")) + Number(attr(tag, "width")));
    const ends = [...s.matchAll(/<text\b[^>]*>[^<]*<\/text>/g)].map(([tag]) => Number(attr(tag, "x")) + (attr(tag, "text-anchor") === "start" ? tag.replace(/<[^>]*>/g, "").length * Number(attr(tag, "font-size")) * 0.56 : 0));
    const right = Math.max(...rects, ...ends);
    if (w <= 700) assert.ok(right >= w - 40, `${at}: margine destro ${w - right}`);
  }
  // 675 x 136: two columns of figures, the day totals beside the grid, the peak day at full strength
  const wide = MODELS.G5.draw(F.rhythm, box(675, 136));
  const days = tagsOf(wide, /<rect[^>]*data-day="[^"]*"[^>]*>/g);
  assert.equal(days.length, 7);
  assert.ok(Number(attr(days[0], "x")) >= gridRight(wide), "a destra della griglia");
  assert.equal(days.filter((t) => attr(t, "fill-opacity") === "1").length, 1);
  assert.ok(xOf(wide, "Giorno di punta") > xOf(wide, "Ora di punta"), "due colonne");
  assert.ok(texts(wide).includes(peakText));
  // 554 x 136: one column of figures in the short form, day bars still there
  const mid = MODELS.G5.draw(F.rhythm, box(554, 136));
  assert.ok(texts(mid).includes(`${hh(peak)}–${hh(peak + 1)}`), texts(mid).join("|"));
  assert.equal(tagsOf(mid, /<rect[^>]*data-day=/g).length, 7);
  // 434 x 136: one column, no room for the day bars
  const narrow = MODELS.G5.draw(F.rhythm, box(434, 136));
  assert.ok(texts(narrow).includes("Ora di punta"));
  assert.equal(tagsOf(narrow, /<rect[^>]*data-day=/g).length, 0);
  // under 400 px: the grid and its legend only
  const tiny = MODELS.G5.draw(F.rhythm, box(300, 180));
  assert.ok(!texts(tiny).includes("Ora di punta") && texts(tiny).includes("meno"), texts(tiny).join("|"));
});

test("G6: la cella di oggi ha il contorno, il testo della serie viene dal corpo", () => {
  const svg = MODELS.G6.draw(F.calendar, box(600, 200));
  const cells = tagsOf(svg, /<rect[^>]*data-date="[^"]*"[^>]*>/g);
  const outlined = cells.filter((t) => / stroke="/.test(t));
  assert.equal(outlined.length, 1);
  assert.equal(attr(outlined[0], "data-date"), F.calendar.days.at(-1).date);
  const all = texts(svg);
  assert.ok(F.calendar.streak >= 1);
  assert.ok(all.includes(F.calendar.streak === 1 ? "1 giorno" : `${F.calendar.streak} giorni`), all.join("|"));
  assert.ok(all.includes(String(F.calendar.activeDays)));
  const narrow = MODELS.G6.draw(F.calendar, box(300, 140));
  assert.ok(tagsOf(narrow, /<rect[^>]*data-date=/g).length < cells.length + 1);
});

test("G7: assi logaritmici, raggio dalle chiamate agli strumenti", () => {
  const withTools = F.runs.map((r, i) => ({ ...r, tools: { calls: i * 10, errors: 0, execMs: 0 } }));
  const svg = MODELS.G7.draw(P(withTools), box(520, 260));
  const dots = tagsOf(svg, /<circle[^>]*data-run="[^"]*"[^>]*>/g);
  const plotted = withTools.filter((r) => r.durationMs > 0 && r.tokens.total > 0);
  assert.equal(dots.length, plotted.length);
  const byId = new Map(dots.map((t) => [attr(t, "data-run"), t]));
  const sorted = [...plotted].sort((a, b) => a.tools.calls - b.tools.calls);
  for (let i = 1; i < sorted.length; i++) {
    const a = Number(attr(byId.get(sorted[i - 1].id), "r"));
    const b = Number(attr(byId.get(sorted[i].id), "r"));
    assert.ok(b >= a, "piu chiamate, raggio non minore");
  }
  assert.ok(Number(attr(byId.get(sorted.at(-1).id), "r")) > Number(attr(byId.get(sorted[0].id), "r")));
  // logarithmic: a decade of tokens spans the same height anywhere on the axis
  const ys = plotted.map((r) => [r.tokens.total, Number(attr(byId.get(r.id), "cy"))]).sort((a, b) => a[0] - b[0]);
  const k = (a, b) => (b[1] - a[1]) / Math.log10(b[0] / a[0]);
  const slopes = ys.slice(1).map((p, i) => ys[i][0] === p[0] ? null : k(ys[i], p)).filter((x) => x !== null && Number.isFinite(x));
  for (const s of slopes) assert.ok(Math.abs(s - slopes[0]) < 0.2, "pendenza costante in scala log");
});

test("G8: le linee p50/p95 cadono nella barra del loro valore", () => {
  const svg = MODELS.G8.draw(F.runSummary, box(520, 260));
  const bars = tagsOf(svg, /<rect[^>]*data-bucket="[^"]*"[^>]*>/g);
  assert.equal(bars.length, F.runSummary.histogram.length);
  const lines = Object.fromEntries(tagsOf(svg, /<line[^>]*data-q="[^"]*"[^>]*>/g).map((t) => [attr(t, "data-q"), Number(attr(t, "x1"))]));
  for (const q of ["p50", "p95"]) {
    const v = F.runSummary.tokens[q];
    const i = F.runSummary.histogram.findIndex((b) => v >= b.lo && (b.hi === null || v < b.hi));
    const x = Number(attr(bars[i], "x"));
    const w = Number(attr(bars[i], "width"));
    assert.ok(lines[q] >= x - 0.5 && lines[q] <= x + w + 0.5, `${q} fuori dalla barra ${i}`);
    assert.ok(texts(svg).includes(`${q} ${compact(v)}`));
  }
  assert.ok(lines.p95 >= lines.p50);
});

test("G9: le aree stanno tra loro come le quote di token", () => {
  const svg = MODELS.G9.draw(F.models, box(480, 260));
  const rects = tagsOf(svg, /<rect[^>]*data-model="[^"]*"[^>]*>/g);
  assert.equal(rects.length, F.models.length);
  const area = (t) => Number(attr(t, "width")) * Number(attr(t, "height"));
  const total = rects.reduce((s, t) => s + area(t), 0);
  const sum = F.models.reduce((s, m) => s + m.tokens.total, 0);
  for (const m of F.models) {
    const t = rects.find((r) => attr(r, "data-model") === m.key);
    assert.ok(Math.abs(area(t) - (total * m.tokens.total) / sum) <= 1, m.key);
  }
});

test("G10: gli archi sommano a 2pi meno gli spazi", () => {
  const svg = MODELS.G10.draw(F.summary, box(480, 240));
  const arcs = tagsOf(svg, /<path[^>]*data-sweep="[^"]*"[^>]*>/g);
  const kinds = Object.values({ ...F.summary.tokens, total: 0 }).filter((v) => v > 0).length;
  assert.equal(arcs.length, kinds);
  const sum = arcs.reduce((s, t) => s + Number(attr(t, "data-sweep")), 0);
  const gaps = arcs.map((t) => Number(attr(t, "data-gap")));
  assert.ok(gaps.every((g) => g <= 0.04) && gaps.includes(0.04), "spazio di 0,04 rad tra gli archi");
  assert.ok(Math.abs(sum + gaps.reduce((a, b) => a + b, 0) - 2 * Math.PI) < 1e-9, `${sum}`);
  assert.ok(texts(svg).includes(compact(F.summary.tokens.total)));
  // geometry from the path data: angles of the endpoints around the centre
  const geo = box(700, 420);
  const tk = { input: 30, output: 20, reasoning: 10, cacheRead: 100, cacheWrite: 40, total: 200 };
  const big = MODELS.G10.draw({ tokens: tk }, geo);
  const ring = tagsOf(big, /<circle[^>]*>/g)[0];
  const [cx, cy] = [Number(attr(ring, "cx")), Number(attr(ring, "cy"))];
  const paths = tagsOf(big, /<path[^>]*data-sweep="[^"]*"[^>]*>/g).map((t) => {
    const n = attr(t, "d").match(/-?\d+(?:\.\d+)?/g).map(Number);
    const ang = (x, y) => Math.atan2(y - cy, x - cx);
    return { a0: ang(n[0], n[1]), a1: ang(n[7], n[8]) };
  });
  const TAU = 2 * Math.PI;
  const mod = (a) => ((a % TAU) + TAU) % TAU;
  const order = ["cacheRead", "input", "cacheWrite", "output", "reasoning"];
  assert.equal(paths.length, 5);
  paths.forEach((p, i) => {
    const share = tk[order[i]] / tk.total;
    assert.ok(Math.abs(mod(p.a1 - p.a0) - (share * TAU - 0.04)) < 0.005, `ampiezza di ${order[i]}`);
    const next = paths[(i + 1) % 5];
    assert.ok(Math.abs(mod(next.a0 - p.a1) - 0.04) < 0.005, `spazio dopo ${order[i]}`);
  });
  const one = MODELS.G10.draw(CASES.G10.one, box(480, 240));
  assert.ok(Math.abs(Number(attr(tagsOf(one, /<(?:path|circle)[^>]*data-sweep="[^"]*"[^>]*>/g)[0], "data-sweep")) - 2 * Math.PI) < 1e-6);
});

test("G11: cinque assi, step riusciti = 1 - falliti/step", () => {
  const svg = MODELS.G11.draw(F.models, box(520, 260));
  assert.equal(tagsOf(svg, /<line[^>]*data-axis="[^"]*"[^>]*>/g).length, 5);
  const polys = tagsOf(svg, /<polygon[^>]*data-model="[^"]*"[^>]*>/g);
  assert.equal(polys.length, Math.min(3, F.models.length));
  for (const m of F.models.slice(0, 3)) {
    const ok = 1 - m.failed / m.steps;
    const tip = tagsOf(svg, /<circle[^>]*data-tip="[^"]*"[^>]*>/g).map((t) => attr(t, "data-tip")).find((t) => t.includes(m.label) && t.includes("step riusciti"));
    assert.ok(tip?.includes(`step riusciti ${pct(ok)}`), `${m.label}: ${tip}`);
  }
  assert.ok(F.models.some((m) => m.failed > 0), "la fixture ha uno step fallito");
});

test("G12: altezze dei nodi proporzionali, etichette compatte sotto i 420 px", () => {
  const svg = MODELS.G12.draw(F.models, box(600, 260));
  const nodes = tagsOf(svg, /<rect[^>]*data-node="model"[^>]*>/g);
  assert.equal(nodes.length, F.models.length);
  const k = Number(attr(nodes[0], "height")) / F.models[0].tokens.total;
  for (const [i, n] of nodes.entries()) assert.ok(Math.abs(Number(attr(n, "height")) - F.models[i].tokens.total * k) < 0.01);
  const wide = texts(MODELS.G12.draw(F.models, box(600, 260)));
  const narrow = texts(MODELS.G12.draw(F.models, box(380, 260)));
  assert.ok(wide.some((t) => t.startsWith("cache letta")));
  assert.ok(narrow.some((t) => t.startsWith("cache")) && !narrow.some((t) => t.startsWith("cache letta")));
});

test("C7: un rettangolo per run, tacche solo dove ci sono step", () => {
  const svg = MODELS.C7.draw(F.lanes, box(600, 260));
  const runs = tagsOf(svg, /<rect[^>]*data-run="[^"]*"[^>]*>/g);
  const expected = F.lanes.lanes.reduce((s, l) => s + l.runs.length, 0);
  assert.equal(runs.length, expected);
  const ticks = tagsOf(svg, /<line[^>]*data-step="[^"]*"[^>]*>/g);
  assert.equal(ticks.length, F.lanes.lanes.reduce((s, l) => s + l.runs.reduce((n, r) => n + r.steps.length, 0), 0));
  assert.ok(ticks.length > 0);
  const none = { ...F.lanes, lanes: F.lanes.lanes.map((l) => ({ ...l, runs: l.runs.map((r) => ({ ...r, steps: [] })) })) };
  assert.equal(tagsOf(MODELS.C7.draw(none, box(600, 260)), /data-step=/g).length, 0);
});

test("C9: la barra del totale e la somma dei costi", () => {
  const svg = MODELS.C9.draw(F.models, box(600, 260));
  const total = tagsOf(svg, /<rect[^>]*data-total="[^"]*"[^>]*>/g);
  assert.equal(total.length, 1);
  const sum = F.models.reduce((s, m) => s + m.cost, 0);
  assert.ok(Math.abs(Number(attr(total[0], "data-total")) - sum) < 1e-9);
  const bars = tagsOf(svg, /<rect[^>]*data-bar="[^"]*"[^>]*>/g);
  const h = bars.reduce((s, t) => s + Number(attr(t, "height")), 0);
  assert.ok(Math.abs(h - Number(attr(total[0], "height"))) < 0.05, "le barre salgono fino al totale");
  assert.equal(typeof MODELS.C9.draw(F.models.map((m) => ({ ...m, cost: 0 })), box(600, 260)).empty, "string");
});

test("C10: i quartili vengono da quantile", () => {
  const key = F.runs.find((r) => r.durationMs != null).models[0];
  const d = F.runs.filter((r) => r.models[0] === key && r.durationMs != null).map((r) => r.durationMs).sort((a, b) => a - b);
  assert.ok(d.length >= 1);
  const svg = MODELS.C10.draw(P(F.runs), box(600, 260));
  const stat = (name) => tagsOf(svg, /<line[^>]*data-stat="[^"]*"[^>]*>/g).find((t) => attr(t, "data-model") === key && attr(t, "data-stat") === name);
  const groups = new Map();
  for (const r of F.runs) if (r.durationMs != null) groups.set(r.models[0], [...(groups.get(r.models[0]) ?? []), r.durationMs]);
  const p95s = [...groups.values()].map((v) => quantile([...v].sort((a, b) => a - b), 0.95));
  const max = niceMax(Math.max(...p95s, 1), 4);
  // the label gutter follows the longest model label (draw.js gutter): read it from the labels, drawn at L - 10
  const L = Math.min(...tagsOf(svg, /<text[^>]*text-anchor="end"[^>]*>/g).map((t) => Number(attr(t, "x")))) + 10; // the leftmost: the labels, not the note
  assert.ok(L >= 84 && L <= Math.max(84, 600 * 0.38), `gutter ${L}`);
  const axis = (v) => L + ((600 - 14 - L) * v) / max;
  for (const [name, q] of [["p5", 0.05], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p95", 0.95]]) {
    assert.ok(Math.abs(Number(attr(stat(name), "x1")) - axis(quantile(d, q))) < 0.01, name);
  }
});

test("C11: nessuna coppia di punti si sovrappone", () => {
  const many = Array.from({ length: 90 }, (_, i) => ({ ...F.runs[i % F.runs.length], id: `x${i}`, tokens: { ...F.runs[0].tokens, total: 5000 + ((i * 7919) % 400) * 3000 } }));
  for (const runs of [F.runs, many]) {
    const svg = MODELS.C11.draw(P(runs), box(520, 240));
    const dots = tagsOf(svg, /<circle[^>]*data-run="[^"]*"[^>]*>/g).map((t) => [Number(attr(t, "cx")), Number(attr(t, "cy")), Number(attr(t, "r"))]);
    assert.ok(dots.length > 0);
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dist = Math.hypot(dots[i][0] - dots[j][0], dots[i][1] - dots[j][1]);
        assert.ok(dist >= dots[i][2] + dots[j][2] - 0.02, `punti ${i} e ${j} a ${dist}`);
      }
    }
  }
});

test("C12: una cresta per ogni giorno con dati", () => {
  const svg = MODELS.C12.draw(P(F.runs), box(520, 260));
  const days = new Set(F.runs.filter((r) => r.tokens.total > 0).map((r) => new Date(r.ended).toDateString()));
  const ridges = tagsOf(svg, /<path[^>]*data-day="[^"]*"[^>]*>/g);
  assert.equal(ridges.length, days.size);
  assert.equal(new Set(ridges.map((t) => attr(t, "data-day"))).size, days.size);
  assert.ok(days.size >= 2);
});

const ariaOf = (svg) => attr(svg.match(/<svg[^>]*>/)[0], "aria-label");

test("un campione dei prompt del periodo lo dice, nel disegno e nell'aria-label (G7, C10, C11, C12, C7)", () => {
  const note = `ultimi ${F.runs.length} di 898 prompt`;
  for (const id of ["G7", "C10", "C11", "C12"]) {
    for (const [w, h] of [MODELS[id].min, [480, 240]]) {
      const svg = MODELS[id].draw(P(F.runs, 898), box(w, h));
      assert.ok(texts(svg).some((t) => t.includes(note)), `${id} @ ${w}x${h}: ${texts(svg).join("|")}`);
      assert.ok(ariaOf(svg).startsWith("prova · ") && ariaOf(svg).includes(note), `${id}: ${ariaOf(svg)}`);
      inBox(svg, w, h);
    }
    // the whole period: no note
    const all = MODELS[id].draw(P(F.runs), box(480, 240));
    assert.ok(!texts(all).some((t) => t.includes("ultimi")), id);
    assert.equal(ariaOf(all), "prova", id);
  }
  const lanes = MODELS.C7.draw({ ...F.lanes, shown: 200, total: 898 }, box(600, 260));
  assert.ok(texts(lanes).includes("ultimi 200 di 898 prompt"), texts(lanes).join("|"));
  assert.ok(ariaOf(lanes).includes("ultimi 200 di 898 prompt"));
  assert.ok(!texts(MODELS.C7.draw({ ...F.lanes, shown: 200, total: 200 }, box(600, 260))).some((t) => t.startsWith("ultimi")));
});

test("il campione di 1000 prompt (il tetto del server) lo dice per intero, anche alla misura minima", () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...F.runs[i % F.runs.length], id: `m${i}`, ended: NOW - i * 60_000, tokens: { ...F.runs[0].tokens, total: 1000 + i * 997 } }));
  const note = "ultimi 1000 di 123.456 prompt";
  for (const id of ["G7", "C10", "C11", "C12"]) {
    const [w, h] = MODELS[id].min;
    const svg = MODELS[id].draw(P(many, 123_456), box(w, h));
    const line = texts(svg).find((t) => t.includes(note));
    assert.ok(line, `${id}: ${texts(svg).join("|")}`);
    // anchored at w - 4, 10 px: about 5.6 px a character, and it must start inside the card
    assert.ok(line.length * 5.6 <= w - 8, `${id}: «${line}» non entra in ${w} px`);
    assert.ok(ariaOf(svg).includes(note), `${id}: ${ariaOf(svg)}`);
    inBox(svg, w, h);
  }
  const lanes = MODELS.C7.draw({ ...F.lanes, shown: 1000, total: 4321 }, box(...MODELS.C7.min));
  assert.ok(texts(lanes).includes("ultimi 1000 di 4321 prompt"), texts(lanes).join("|"));
});

test("C11: oltre i 150 punti conta quelli che non disegna", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ ...F.runs[i % F.runs.length], id: `x${i}`, ended: NOW - i * 1000, tokens: { ...F.runs[0].tokens, total: 1000 + i * 997 } }));
  const svg = MODELS.C11.draw(P(many), box(600, 300));
  const dots = tagsOf(svg, /<circle[^>]*data-run="[^"]*"[^>]*>/g).length;
  assert.ok(dots <= 150 && dots > 0, `${dots}`);
  assert.ok(texts(svg).includes(`+${200 - dots} non mostrati`), texts(svg).join("|"));
  assert.ok(ariaOf(svg).includes(`+${200 - dots} non mostrati`));
  // every dot placed: no note
  assert.ok(!texts(MODELS.C11.draw(P(F.runs), box(600, 300))).some((t) => t.includes("non mostrati")));
});

test("C12: tiene i giorni che entrano e dice quanti sono", () => {
  const day = 86_400_000;
  const runs = Array.from({ length: 20 }, (_, i) => ({ ...F.runs[0], id: `d${i}`, ended: NOW - i * day, tokens: { ...F.runs[0].tokens, total: 2000 + i * 100 } }));
  const [w, h] = MODELS.C12.min;
  const svg = MODELS.C12.draw(P(runs), box(w, h));
  const ridges = tagsOf(svg, /<path[^>]*data-day="[^"]*"[^>]*>/g).length;
  assert.ok(ridges < 20 && ridges > 1, `${ridges}`);
  assert.ok(texts(svg).includes(`ultimi ${ridges} giorni`), texts(svg).join("|"));
  inBox(svg, w, h);
  // with a sample too, both notes
  const both = MODELS.C12.draw(P(runs, 500), box(480, 240));
  assert.ok(texts(both).some((t) => /^ultimi \d+ giorni · ultimi 20 di 500 prompt$/.test(t)), texts(both).join("|"));
  assert.ok(!texts(MODELS.C12.draw(P(runs.slice(0, 3)), box(w, h))).some((t) => t.startsWith("ultimi")));
});

test("C12: sotto la nota nessuna cresta sale nella sua fascia", () => {
  const day = 86_400_000;
  // 8 days, the oldest one the busiest (the tallest ridge sits right under the note)
  const runs = Array.from({ length: 8 }, (_, i) => Array.from({ length: i === 7 ? 30 : 3 }, (__, k) => ({ ...F.runs[0], id: `d${i}-${k}`, ended: NOW - i * day, tokens: { ...F.runs[0].tokens, total: 2000 + k * 500 } }))).flat();
  for (const [w, h] of [[480, 240], [300, 180], [600, 300]]) {
    const svg = MODELS.C12.draw(P(runs, 900), box(w, h));
    const top = 14 + 12; // T0 with a note
    for (const p of tagsOf(svg, /<path[^>]*data-day="[^"]*"[^>]*>/g)) {
      const ys = [...attr(p, "d").matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
      assert.ok(Math.min(...ys) >= top - 0.01, `${w}x${h}: ${Math.min(...ys)} < ${top}`);
    }
  }
});

test("C13: cento celle, i conteggi arrotondano a 100", () => {
  const svg = MODELS.C13.draw(F.summary, box(480, 240));
  const cells = tagsOf(svg, /<rect[^>]*data-kind="[^"]*"[^>]*>/g);
  assert.equal(cells.length, 100);
  const counts = {};
  for (const t of cells) counts[attr(t, "data-kind")] = (counts[attr(t, "data-kind")] ?? 0) + 1;
  const t = F.summary.tokens;
  for (const [kind, v] of Object.entries({ cacheRead: t.cacheRead, input: t.input, cacheWrite: t.cacheWrite, output: t.output, reasoning: t.reasoning })) {
    if (v > 0) assert.ok(Math.abs((counts[kind] ?? 0) - (v / t.total) * 100) < 1, kind);
  }
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 100);
  const odd = MODELS.C13.draw({ tokens: { input: 1, output: 1, reasoning: 1, cacheRead: 0, cacheWrite: 0, total: 3 } }, box(480, 240));
  assert.equal(tagsOf(odd, /<rect[^>]*data-kind=/g).length, 100);
});

const inBox = (svg, w, h) => {
  for (const t of tagsOf(svg, /<(?:rect|text|path|line|circle)\b[^>]*>/g)) {
    for (const k of ["x", "x1", "x2", "cx"]) {
      const v = attr(t, k);
      if (v !== undefined) assert.ok(Number(v) >= -0.01 && Number(v) <= w + 0.01, `${k}=${v} fuori da ${w}: ${t.slice(0, 90)}`);
    }
    for (const k of ["y", "y1", "y2", "cy"]) {
      const v = attr(t, k);
      if (v !== undefined) assert.ok(Number(v) >= -0.01 && Number(v) <= h + 0.01, `${k}=${v} fuori da ${h}: ${t.slice(0, 90)}`);
    }
    if (attr(t, "height") !== undefined && attr(t, "y") !== undefined) assert.ok(Number(attr(t, "y")) + Number(attr(t, "height")) <= h + 0.5, `fondo fuori: ${t.slice(0, 90)}`);
  }
};

test("G12: con decine di milioni di token resta dentro la scatola", () => {
  const heavy = Array.from({ length: 8 }, (_, i) => {
    const total = 50_000_000 / (i + 1);
    return { ...F.models[0], key: `az/m${i}`, label: `m${i}`, slot: (i % 6) + 1, tokens: { input: total * 0.1, output: total * 0.05, reasoning: total * 0.05, cacheRead: total * 0.7, cacheWrite: total * 0.1, total }, cost: 1 };
  });
  for (const [w, h] of [MODELS.G12.min, [600, 260], [380, 200]]) {
    const svg = MODELS.G12.draw(heavy, box(w, h));
    inBox(svg, w, h);
    const nodes = tagsOf(svg, /<rect[^>]*data-node="model"[^>]*>/g);
    assert.ok(Number(attr(nodes[0], "height")) < h);
  }
});

test("G8: p50 e p95 cadono dentro la barra, anche ai limiti dei contenitori", () => {
  const hist = F.runSummary.histogram;
  for (const i of [1, 3, hist.length - 1]) {
    for (const v of [hist[i].lo, hist[i].hi === null ? hist[i].lo * 2 : hist[i].hi - 1]) {
      const sum = { ...F.runSummary, tokens: { p50: v, p95: v } };
      const svg = MODELS.G8.draw(sum, box(520, 260));
      const bar = tagsOf(svg, /<rect[^>]*data-bucket="[^"]*"[^>]*>/g)[i];
      const x = Number(attr(bar, "x"));
      const bw = Number(attr(bar, "width"));
      const lx = Number(attr(tagsOf(svg, /<line[^>]*data-q="p50"[^>]*>/g)[0], "x1"));
      assert.ok(lx >= x - 0.01 && lx <= x + bw + 0.01, `bucket ${i}, valore ${v}: ${lx} fuori da ${x}..${x + bw}`);
      if (v === hist[i].lo) assert.ok(Math.abs(lx - x) < 0.01, "il limite inferiore sta all'inizio della barra");
    }
  }
});

test("G11: nessuna etichetta degli assi esce dalla scatola", () => {
  for (const [w, h] of [MODELS.G11.min, [360, 200], [420, 220], [520, 260]]) {
    const svg = MODELS.G11.draw(F.models, box(w, h));
    for (const t of tagsOf(svg, /<text[^>]*>[^<]*<\/text>/g)) {
      const x = Number(attr(t, "x"));
      const width = (t.match(/>([^<]*)</)[1].length * 5.5);
      const anchor = attr(t, "text-anchor");
      const [x0, x1] = anchor === "end" ? [x - width, x] : anchor === "middle" ? [x - width / 2, x + width / 2] : [x, x + width];
      assert.ok(x0 >= 0 && x1 <= w, `${t.match(/>([^<]*)</)[1]} @ ${w}x${h}: ${x0}..${x1}`);
      assert.ok(Number(attr(t, "y")) <= h && Number(attr(t, "y")) >= 8);
    }
  }
});

test("G11: il radar usa l'altezza e il gruppo radar + legenda e centrato", () => {
  for (const [w, h] of [[434, 192], [520, 260], [675, 248], [300, 190]]) {
    const svg = MODELS.G11.draw(F.models, box(w, h));
    const axes = tagsOf(svg, /<line[^>]*data-axis="[^"]*"[^>]*>/g);
    const R = Math.hypot(Number(attr(axes[0], "x2")) - Number(attr(axes[0], "x1")), Number(attr(axes[0], "y2")) - Number(attr(axes[0], "y1")));
    assert.ok(R >= (h - 44) / 2, `${w}x${h}: raggio ${R}`);
    const spans = tagsOf(svg, /<text[^>]*>[^<]*<\/text>/g).map((t) => {
      const x = Number(attr(t, "x"));
      const len = t.replace(/<[^>]*>/g, "").length * Number(attr(t, "font-size")) * 0.56;
      const a = attr(t, "text-anchor");
      return a === "end" ? [x - len, x] : a === "middle" ? [x - len / 2, x + len / 2] : [x, x + len];
    });
    const lo = Math.min(...spans.map((p) => p[0]));
    const hi = Math.max(...spans.map((p) => p[1]));
    assert.ok(Math.abs(lo - (w - hi)) <= 24, `${w}x${h}: margini ${lo.toFixed(1)} e ${(w - hi).toFixed(1)}`);
  }
});

test("C7: con 25 sessioni tiene quelle piu recenti, in ordine, e conta le altre", () => {
  const lanes = Array.from({ length: 25 }, (_, i) => ({ sessionID: `s${i}`, title: `sessione ${i}`, slot: (i % 6) + 1, runs: [{ started: NOW + i * 1000, ended: NOW + i * 1000 + 500, steps: [] }] }));
  // the lane with the latest activity is an early one
  lanes[2].runs[0].ended = NOW + 10_000_000;
  const input = { from: NOW, to: NOW + 10_000_000, now: NOW + 10_000_000, lanes };
  const [w, h] = MODELS.C7.min;
  const svg = MODELS.C7.draw(input, box(w, h));
  const runs = tagsOf(svg, /<rect[^>]*data-run="[^"]*"[^>]*>/g).map((t) => attr(t, "data-run").split(":")[0]);
  const fit = Math.floor((h - 26) / 18) - 1;
  assert.equal(runs.length, fit);
  assert.ok(runs.includes("s2"), "la corsia con l'attivita piu recente resta");
  const idx = runs.map((r) => Number(r.slice(1)));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), "ordine di inizio");
  assert.ok(texts(svg).includes(`+${25 - fit} sessioni`), texts(svg).join("|"));
  inBox(svg, w, h);
});

test("dimensioni dei testi: da 10 a 12 px, al piu una cifra di testa fino a 18", () => {
  const inputs = { G5: F.rhythm, G6: F.calendar, G7: P(F.runs), G8: F.runSummary, G9: F.models, G10: F.summary, G11: F.models, G12: F.models, C7: F.lanes, C9: F.models, C10: P(F.runs), C11: P(F.runs), C12: P(F.runs), C13: F.summary };
  for (const [id, m] of Object.entries(MODELS)) {
    checkModel(null, m.draw, [inputs[id]], [...SIZES, m.min, [360, 200], [420, 220], [700, 420]]);
  }
});

test("compactBelow: ogni soglia e un ramo reale del codice, null dove il modello scala e basta", () => {
  const inputs = { G5: F.rhythm, G6: F.calendar, G7: P(F.runs), G8: F.runSummary, G9: F.models, G10: F.summary, G11: F.models, G12: F.models, C7: F.lanes, C9: F.models, C10: P(F.runs), C11: P(F.runs), C12: P(F.runs), C13: F.summary };
  const signature = (svg) => texts(svg).join("|");
  const expected = { G5: 400, G6: null, G7: null, G8: null, G9: null, G10: 300, G11: 360, G12: 420, C7: null, C9: null, C10: 420, C11: null, C12: null, C13: 300 };
  for (const [id, m] of Object.entries(MODELS)) {
    assert.equal(m.compactBelow, expected[id], id);
    if (m.compactBelow === null) continue;
    const h = Math.max(m.min[1], 260);
    const below = m.draw(inputs[id], box(m.compactBelow - 1, h));
    const above = m.draw(inputs[id], box(m.compactBelow, h));
    assert.notEqual(signature(below), signature(above), `${id}: nessuna differenza a ${m.compactBelow}`);
  }
});

test("nessun testo esce dal riquadro, a destra o a sinistra, al minimo e a 480x240", () => {
  for (const [id, c] of Object.entries(CASES)) {
    const m = MODELS[id];
    for (const [w, h] of [m.min, [480, 240]]) {
      for (const input of [...c.real, c.one]) {
        const svg = m.draw(input, box(w, h));
        if (typeof svg !== "string") continue;
        for (const t of svg.matchAll(/<text\b[^>]*>[^<]*<\/text>/g)) {
          const x = Number(/\bx="([-\d.]+)"/.exec(t[0])?.[1]);
          const size = Number(/font-size="([\d.]+)"/.exec(t[0])?.[1] ?? 11);
          const anchor = /text-anchor="(\w+)"/.exec(t[0])?.[1] ?? "start";
          const label = t[0].replace(/<[^>]*>/g, "").replace(/&(lt|gt|amp|quot|#\d+);/g, "?");
          const len = label.length * size * 0.56;
          const [lo, hi] = anchor === "middle" ? [x - len / 2, x + len / 2] : anchor === "end" ? [x - len, x] : [x, x + len];
          assert.ok(lo >= -0.5 && hi <= w + 0.5, `${id} @ ${w}x${h}: "${t[0].replace(/<[^>]*>/g, "")}" occupa ${lo.toFixed(1)}..${hi.toFixed(1)}`);
        }
      }
    }
  }
});

const mkModel = (i, total, cost = total / 1e6) => ({
  key: `m${i}`,
  label: `modello-${i}`,
  slot: i < 7 ? i + 1 : "other",
  cost,
  tokens: { input: total / 2, output: total / 4, reasoning: 0, cacheRead: total / 4, cacheWrite: 0, total },
});

test("G12: le etichette a sinistra non si sovrappongono nemmeno con modelli minuscoli", () => {
  const models = [mkModel(0, 5e9), ...[1, 2, 3, 4, 5, 6, 7].map((i) => mkModel(i, 1000 + i))];
  for (const [w, h] of [MODELS.G12.min, [480, 240], [600, 260]]) {
    const svg = MODELS.G12.draw(models, box(w, h));
    const ys = tagsOf(svg, /<text[^>]*text-anchor="end"[^>]*>/g).map((t) => Number(attr(t, "y")));
    if (w >= 300) assert.ok(ys.length >= 1, `${w}x${h}`);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 12, `${w}x${h}: ${sorted}`);
    assert.ok(sorted.every((y) => y >= 0 && y <= h), `${w}x${h}: ${sorted}`);
  }
});

test("G7: le bolle sono limitate al grafico anche al minimo", () => {
  const withTools = F.runs.map((r, i) => ({ ...r, tools: { calls: 1 + i * 50, errors: 0, execMs: 0 } }));
  for (const [w, h] of [MODELS.G7.min, [520, 260]]) {
    const rs = tagsOf(MODELS.G7.draw(P(withTools), box(w, h)), /<circle[^>]*data-run="[^"]*"[^>]*>/g).map((t) => Number(attr(t, "r")));
    assert.ok(rs.length > 1);
    assert.ok(Math.max(...rs) <= 8, `${w}x${h}: ${Math.max(...rs)}`);
    if (h === MODELS.G7.min[1]) assert.ok(Math.max(...rs) <= (h - 14 - 28) / 20 + 0.01, `${Math.max(...rs)}`);
  }
});

test("C9: l'asse non spreca il grafico (40,8 $ non finisce su 80 $)", () => {
  const models = [mkModel(0, 1e6, 20.4), mkModel(1, 1e6, 20.4)];
  const svg = MODELS.C9.draw(models, box(300, 180));
  const labels = texts(svg).filter((t) => /\$|€/.test(t));
  const top = Math.max(...labels.map((t) => Number(t.replace(/[^\d,]/g, "").replace(",", "."))));
  assert.ok(top <= 50.01, `asse fino a ${top}: ${labels}`);
});

test("C10: le righe riempiono il grafico e il blocco è centrato", () => {
  const mk = (id, model, ms) => ({ ...F.runs[0], id, models: [model], durationMs: ms });
  const runs = [mk("a", "az/qwen", 1000), mk("b", "az/qwen", 5000), mk("c", "az/llama", 2000), mk("d", "az/llama", 9000)];
  const svg = MODELS.C10.draw(P(runs), box(480, 240));
  const ys = [...new Set(tagsOf(svg, /<line[^>]*data-stat="p50"[^>]*>/g).map((t) => (Number(attr(t, "y1")) + Number(attr(t, "y2"))) / 2))].sort((a, b) => a - b);
  assert.equal(ys.length, 2);
  assert.ok(ys[1] - ys[0] >= 60, `${ys}`);
  assert.ok(Math.abs((ys[0] + ys[1]) / 2 - (6 + (240 - 28)) / 2) <= 3, `${ys}`);
});

const yLabels = (svg, x) => tagsOf(svg, new RegExp(`<text x="${x}"[^>]*text-anchor="end"[^>]*>[^<]*</text>`, "g")).map((t) => t.replace(/<[^>]*>/g, ""));

test("G8: le tacche dei conteggi sono intere e uniche per ogni picco da 1 a 30", () => {
  for (let peak = 1; peak <= 30; peak++) {
    const sum = { count: peak, histogram: [{ lo: 0, hi: 10_000, count: peak }, { lo: 10_000, hi: null, count: 0 }], tokens: { p50: 5000, p95: 5000, n: peak } };
    const labels = yLabels(MODELS.G8.draw(sum, box(520, 260)), 28);
    const nums = labels.map(Number);
    assert.ok(labels.length >= 3 && new Set(labels).size === labels.length, `peak ${peak}: ${labels}`);
    assert.ok(nums.every((v, i) => Number.isInteger(v) && v === i * nums[1]), `peak ${peak}: ${labels}`);
    assert.ok(nums.at(-1) >= peak);
  }
});

test("C9: nessuna tacca ripetuta sull'asse dei costi, da pochi centesimi in su", () => {
  for (let v = 0.003; v < 5e4; v *= 1.13) {
    const svg = MODELS.C9.draw([mkModel(0, 1e6, v), mkModel(1, 1e6, v / 3)], box(480, 260));
    const labels = yLabels(svg, 42);
    assert.ok(labels.length >= 3 && new Set(labels).size === labels.length, `v=${v}: ${labels}`);
  }
});
