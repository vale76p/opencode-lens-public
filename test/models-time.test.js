// Modelli dell'andamento nel tempo (G1 G2 G3 G4 C2 C3 C4 C5 C6): controlli comuni e valori chiave.
process.env.TZ = "Europe/Rome";

import assert from "node:assert/strict";
import { test } from "node:test";
import { daysInput, hoursInput, rhythmInput, seriesInput } from "../public/adapt.js";
import { MODELS } from "../public/models-time.js";
import { checkModel, HOSTILE, SIZES } from "./models-helpers.js";

const NOW = new Date("2026-10-15T12:30").getTime();
const FROM = new Date("2026-10-15T00:00").getTime();
const slotFor = (_by, key) => (key === "altri" ? "other" : ["a", "b", "c", "d"].indexOf(key) + 1 || "other");
const isEmpty = (r) => typeof r === "object" && typeof r.empty === "string";
const box = (w, h) => ({ w, h, uid: "a", label: "t" });
const draw = (id, input, w = 480, h = 240) => MODELS[id].draw(input, box(w, h));
const sizes = (id) => [...SIZES, MODELS[id].min];
const attr = (s, name) => [...s.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]);

const hourly = (tokens, avg = tokens.map((v) => v * 0.8)) => ({
  from: FROM,
  labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
  tokens,
  avg,
  soFarAvg: 1000,
});
const HOURS = hoursInput(hourly(Array.from({ length: 24 }, (_, i) => (i < 13 ? 1000 + 700 * Math.sin(i / 2) ** 2 : 0))), NOW);
const HOURS_ZERO = hoursInput(hourly(new Array(24).fill(0)), NOW);
const HOURS_ONE = hoursInput(hourly(new Array(24).fill(0).map((_, i) => (i === 0 ? 500 : 0))), FROM + 600_000);

const days = (n) => Array.from({ length: n }, (_, i) => `2026-10-${String(15 - (n - 1 - i)).padStart(2, "0")}`);
const mkSeries = (labels, rows, unit = "day") =>
  seriesInput({ by: "model", unit, labels, series: rows.map(([key, values]) => ({ key, values })) }, slotFor);
const SERIES = mkSeries(days(7), [
  ["a", [900, 800, 1000, 1200, 700, 900, 1500]],
  ["b", [400, 900, 300, 500, 800, 600, 400]],
  ["c", [200, 100, 600, 100, 300, 800, 200]],
  ["d", [50, 60, 70, 80, 90, 100, 110]],
]);
const SERIES_HOSTILE = mkSeries(days(3), [[HOSTILE, [10, 20, 30]], ["b", [5, 5, 5]]]);
const SERIES_EMPTY = mkSeries([], []);
const SERIES_ZERO = mkSeries(days(3), [["a", [0, 0, 0]]]);
const SERIES_ONE = mkSeries(days(1), [["a", [10]], ["b", [5]]]);
const TWO = mkSeries(days(2), [["a", [1000, 1500]], ["b", [800, 400]], ["c", [300, 300]]]);

const mkDays = (ttft) =>
  daysInput({ days: ttft.map((p, i) => ({ date: `2026-10-${String(1 + i).padStart(2, "0")}`, from: i, tokens: 10, cost: 1, runs: 1, ttft: p === null ? {} : { p50: p, p95: p * 2.5 } })) });
const DAYS = mkDays([1200, 1500, null, 1100, 1300, 1800]);

test("tutti i modelli: id, nome italiano, misure minime", () => {
  assert.deepEqual(Object.keys(MODELS), ["G1", "G2", "G3", "G4", "C2", "C3", "C4", "C5", "C6"]);
  const mins = { G1: [260, 160], G2: [300, 180], G3: [260, 160], G4: [240, 150], C2: [260, 160], C3: [220, 200], C4: [300, 180], C5: [280, 160], C6: [200, 180] };
  for (const [id, m] of Object.entries(MODELS)) {
    assert.ok(m.name && typeof m.draw === "function" && m.compactBelow > 0, id);
    assert.deepEqual(m.min, mins[id], id);
  }
});

test("G1: punto dell'ora corrente e media tratteggiata", () => {
  const inputs = [HOURS, HOURS_ONE];
  checkModel(null, MODELS.G1.draw, inputs, sizes("G1"));
  const svg = draw("G1", HOURS, 480, 240);
  const L = 44;
  const R = 480 - 14;
  const cx = Number(attr(svg.match(/<circle data-now[^>]*>/)[0], "cx")[0]);
  assert.ok(Math.abs(cx - (L + ((R - L) * HOURS.nowIdx) / 23)) < 0.01);
  assert.match(svg, /<path data-avg="1"[^>]*stroke-dasharray/);
  assert.ok(isEmpty(draw("G1", HOURS_ZERO)));
  assert.ok(isEmpty(draw("G1", null)));
  checkModel(null, MODELS.G1.draw, [{ ...HOURS, labels: HOURS.labels.map(() => HOSTILE) }], sizes("G1"));
});

test("G2: una etichetta finale per serie, a 14 px, «oggi» per ultima", () => {
  checkModel(null, MODELS.G2.draw, [SERIES, SERIES_HOSTILE, SERIES_ONE, SERIES_EMPTY, SERIES_ZERO], sizes("G2"));
  const svg = draw("G2", SERIES, 480, 240);
  const ends = [...svg.matchAll(/<text x="[^"]*" y="([^"]*)"[^>]*data-end="1"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  assert.equal(ends.length, SERIES.series.length);
  for (let i = 1; i < ends.length; i++) assert.ok(ends[i] - ends[i - 1] >= 14, `${ends}`);
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.equal(texts.at(-1), "oggi");
  assert.ok(isEmpty(draw("G2", SERIES_EMPTY)));
  assert.ok(isEmpty(draw("G2", SERIES_ZERO)));
});

test("G3: la cima dell'ultima colonna è la somma delle serie", () => {
  checkModel(null, MODELS.G3.draw, [SERIES, SERIES_HOSTILE, SERIES_ONE, SERIES_EMPTY], sizes("G3"));
  const svg = draw("G3", SERIES, 480, 240);
  const total = 1500 + 400 + 200 + 110;
  assert.deepEqual(attr(svg, "data-top"), [String(total)]);
  assert.ok(svg.includes(`>2,2k</text>`));
  assert.ok(isEmpty(draw("G3", SERIES_ZERO)));
});

test("G4: la pillola del picco sta sulla colonna massima", () => {
  checkModel(null, MODELS.G4.draw, [HOURS, HOURS_ONE, SERIES, SERIES_ONE, mkSeries(days(5), [["a", [1, 2, 3, 2, 1]]]), SERIES_EMPTY, HOURS_ZERO], sizes("G4"));
  const one = mkSeries(days(5), [["a", [100, 200, 900, 300, 100]]]);
  const svg = draw("G4", one, 480, 240);
  const L = 44;
  const R = 480 - 12;
  const band = (R - L) / 5;
  const pill = svg.match(/<rect data-peak="(\d+)" x="([^"]*)" y="[^"]*" width="([^"]*)"/);
  assert.equal(pill[1], "2");
  assert.ok(Math.abs(Number(pill[2]) + Number(pill[3]) / 2 - (L + band * 2.5)) < 0.2);
  const peakHour = HOURS.today.indexOf(Math.max(...HOURS.today.filter(Number.isFinite)));
  assert.equal(draw("G4", HOURS).match(/data-peak="(\d+)"/)[1], String(peakHour));
  assert.ok(isEmpty(draw("G4", HOURS_ZERO)));
});

test("C2: i giorni senza p50 interrompono il tracciato", () => {
  checkModel(null, MODELS.C2.draw, [DAYS, mkDays([1200]), mkDays([null, null]), [], mkDays([900, null, 1000])], sizes("C2"));
  const svg = draw("C2", DAYS, 480, 240);
  assert.equal(attr(svg, "data-seg").length, 2); // two runs of days, not one path through the gap
  assert.ok(isEmpty(draw("C2", mkDays([null, null]))));
  assert.ok(isEmpty(draw("C2", [])));
  // a lone measured day between gaps is a dot, not a zero
  const lone = draw("C2", mkDays([null, 1000, null, 1200, 1300]), 480, 240);
  assert.equal(attr(lone, "data-seg").length, 1);
  assert.ok(!/\bcy="NaN/.test(lone));
});

test("C3: 1 colonna sotto 420 px, 2 tra 420 e 899, 4 da 900", () => {
  checkModel(null, MODELS.C3.draw, [SERIES, SERIES_HOSTILE, SERIES_ONE, SERIES_EMPTY], [...sizes("C3"), [419, 600], [420, 300], [900, 300]]);
  const cols = (w, h) => new Set(draw("C3", SERIES, w, h).match(/<rect data-panel="\d+" data-plot="[^"]*" x="[^"]*"/g).map((m) => m.match(/x="([^"]*)"/)[1])).size;
  assert.equal(cols(419, 600), 1);
  assert.equal(cols(420, 300), 2);
  assert.equal(cols(899, 300), 2);
  assert.equal(cols(900, 300), 4);
  assert.equal(attr(draw("C3", SERIES, 900, 300), "data-panel").length, 4);
  assert.ok(isEmpty(draw("C3", SERIES_ZERO)));
});

test("C4: le posizioni sono 1..n in ogni giorno", () => {
  checkModel(null, MODELS.C4.draw, [SERIES, SERIES_HOSTILE, SERIES_ONE, SERIES_EMPTY, mkSeries(days(2), [["a", [5, 5]], ["b", [5, 5]]])], sizes("C4"));
  const svg = draw("C4", SERIES, 480, 240);
  const dots = [...svg.matchAll(/data-rank="(\d+)" data-day="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(dots.length, 4 * 7);
  for (let d = 0; d < 7; d++) assert.deepEqual(dots.filter((x) => x[1] === d).map((x) => x[0]).sort(), [1, 2, 3, 4]);
  // last day: a 1500, b 400, c 200, d 110
  const last = Object.fromEntries(dots.filter((x) => x[1] === 6).map((x, i) => [i, x[0]]));
  assert.deepEqual(Object.values(last), [1, 2, 3, 4]);
  assert.ok(isEmpty(draw("C4", SERIES_ZERO)));
  // only the last 7 buckets are ranked
  assert.equal(attr(draw("C4", mkSeries(days(5).concat(["2026-10-16", "2026-10-17", "2026-10-18"]), [["a", [1, 2, 3, 4, 5, 6, 7, 8]]]), 480, 240), "data-day").length, 7);
});

test("C5: la freccia segue il confronto", () => {
  checkModel(null, MODELS.C5.draw, [TWO, SERIES, SERIES_HOSTILE, SERIES_ONE, SERIES_EMPTY], sizes("C5"));
  const svg = draw("C5", TWO, 480, 240);
  const dirs = attr(svg, "data-dir");
  assert.deepEqual(dirs, ["up", "down", "flat"]);
  assert.ok(svg.includes("▲ 50%"));
  assert.ok(svg.includes("▼ 50%"));
  assert.ok(isEmpty(draw("C5", mkSeries(days(1), [["a", [5]]]))));
  assert.ok(isEmpty(draw("C5", mkSeries(days(2), [["a", [0, 0]]]))));
});

test("C6: 24 barre, il picco in --series-2 (ritmo); l'ingresso del Hero, tolto, non si disegna", () => {
  const rhythm = rhythmInput({ days: 4, cells: [Array.from({ length: 24 }, (_, h) => (h === 17 ? 90 : h > 8 && h < 20 ? 10 + h : 0)), new Array(24).fill(0)], prompts: [new Array(24).fill(0)] });
  const rhythmZero = rhythmInput({ days: 0, cells: [new Array(24).fill(0)], prompts: [] });
  checkModel(null, MODELS.C6.draw, [rhythm, { ...rhythm, hourSums: rhythm.hourSums.map((_, i) => (i === 3 ? HOSTILE.length : 0)) }], sizes("C6"));
  const rh = draw("C6", rhythm, 480, 240);
  assert.equal(attr(rh, "data-hour").length, 24);
  assert.deepEqual([...rh.matchAll(/data-hour="(\d+)"[^>]*stroke="var\(--series-2\)"/g)].map((m) => m[1]), ["17"]);
  assert.ok(rh.includes("17:00–18:00"));
  // the four figures beside the clock; under compactBelow the clock alone
  const words = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  for (const [w, h] of [[434, 192], [434, 248], [600, 192]]) {
    const r = words(draw("C6", rhythm, w, h));
    for (const l of ["Ora di punta", "Ore attive", "Giorno di punta", "Media a settimana"]) assert.ok(r.includes(l), `${w}x${h}: ${r.join("|")}`);
  }
  const C6 = MODELS.C6;
  assert.ok(!words(draw("C6", rhythm, C6.compactBelow - 1, 192)).includes("Ora di punta"));
  assert.ok(words(draw("C6", rhythm, C6.compactBelow, 192)).includes("Ora di punta"));
  // the clock and its figures are centred as a group, every text inside the box
  for (const [input, w, h] of [[rhythm, 434, 248], [rhythm, 434, 192], [rhythm, 700, 240]]) {
    const svg = draw("C6", input, w, h);
    const spans = [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)</g)].map(([, x, y, size, anchor, t]) => {
      const len = t.length * size * 0.56;
      assert.ok(Number(y) <= h && Number(y) >= 8, `${w}x${h}: y ${y}`);
      return anchor === "middle" ? [x - len / 2, +x + len / 2] : [+x, +x + len];
    });
    const lo = Math.min(...spans.map((p) => p[0]));
    const hi = Math.max(...spans.map((p) => p[1]));
    assert.ok(lo >= 0 && hi <= w, `${w}x${h}: ${lo}..${hi}`);
    assert.ok(Math.abs(lo - (w - hi)) <= 24, `${w}x${h}: margini ${lo} e ${w - hi}`);
  }
  assert.ok(isEmpty(draw("C6", HOURS)), "i dati di oggi per ora (il Hero) non sono del ritmo");
  assert.ok(isEmpty(draw("C6", rhythmZero)));
  assert.ok(isEmpty(draw("C6", null)));
});

// ---- fix round 1: sizes, label spacing, legend and panel limits ----

test("dimensioni dei testi: 10-12 px, al massimo una cifra di testa fino a 18", () => {
  const rhythm = rhythmInput({ days: 2, cells: [Array.from({ length: 24 }, (_, h) => h * 3)], prompts: [] });
  const inputs = { G1: HOURS, G2: SERIES, G3: SERIES, G4: HOURS, C2: DAYS, C3: SERIES, C4: SERIES, C5: TWO };
  for (const [id, input] of Object.entries(inputs)) checkModel(null, MODELS[id].draw, [input], sizes(id));
  checkModel(null, MODELS.C6.draw, [rhythm], sizes("C6"));
});

test("G4: le etichette x non si toccano (14 e 30 colonne, larghezza minima)", () => {
  for (const n of [14, 30]) {
    const labels = Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    const svg = draw("G4", mkSeries(labels, [["a", labels.map((_, i) => 100 + i)]]), 240, 150);
    const xs = [...svg.matchAll(/<text x="([^"]*)" y="144"[^>]*>([^<]*)</g)].map((m) => [Number(m[1]), m[2].length * 5.6]);
    assert.ok(xs.length >= 2);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i][0] - xs[i - 1][0] >= (xs[i][1] + xs[i - 1][1]) / 2, `n=${n}: ${JSON.stringify(xs)}`);
  }
});

test("G3: la legenda sta nella larghezza e il resto diventa «+N»", () => {
  const many = mkSeries(days(4), Array.from({ length: 8 }, (_, k) => [`provider/modello-${k}`, [10 + k, 20, 30, 40]]));
  for (const w of [480, 440]) {
    const svg = draw("G3", many, w, 240);
    const swatches = [...svg.matchAll(/<rect x="([^"]*)" y="6" width="8"/g)].map((m) => Number(m[1]));
    assert.ok(swatches.length >= 1 && swatches.length < 8, `w=${w}`);
    // each item as wide as its label: the last one shown ends inside the card
    const last = Math.max(...swatches);
    const label = svg.match(new RegExp(`<text x="${last + 12}" y="14"[^>]*>([^<]*)</text>`))?.[1] ?? "";
    assert.ok(label && last + 12 + label.length * 5.8 <= w, `w=${w}: legend overflows`);
    assert.ok(svg.includes(`>+${8 - swatches.length}</text>`));
  }
  // short names: all eight fit, uncut
  const short = draw("G3", mkSeries(days(4), Array.from({ length: 8 }, (_, k) => [`m${k}`, [10 + k, 20, 30, 40]])), 900, 240);
  assert.equal([...short.matchAll(/<rect x="[^"]*" y="6" width="8"/g)].length, 8);
});

test("C3: pannelli con altezza minima, il resto in «+N non mostrati»", () => {
  const many = mkSeries(days(4), Array.from({ length: 8 }, (_, k) => [`m${k}`, [10 + k, 20, 30, 40]]));
  checkModel(null, MODELS.C3.draw, [many], sizes("C3"));
  const svg = draw("C3", many, 220, 200);
  const plots = attr(svg, "data-plot").map(Number);
  assert.ok(plots.length >= 1 && plots.length < 8);
  for (const p of plots) assert.ok(p >= 20, `plot ${p}`);
  assert.ok(svg.includes(`+${8 - plots.length} non mostrati`));
  // the hit overlay comes after the sparkline, so it receives the pointer
  assert.ok(svg.indexOf("<path") < svg.indexOf("data-panel"));
  assert.ok(!draw("C3", many, 1000, 300).includes("non mostrati"));
});

test("G1: nessun valore finito oggi -> vuoto", () => {
  assert.ok(isEmpty(draw("G1", { ...HOURS, today: HOURS.today.map(() => null) })));
});

const tagsOf = (svg, re) => [...svg.matchAll(re)].map((m) => m[0]);
const num = (tag, name) => Number(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]);

// Real-data shape: 30 days, the first series jumps to 120M on the last day, 11 others stay under 10M.
const SPIKY = (() => {
  const calm = (k) => Array.from({ length: 30 }, (_, i) => 1e5 * (k + 1) + ((i * 37 * (k + 3)) % 9) * 5e5);
  const top = Array.from({ length: 30 }, (_, i) => (i === 29 ? 120e6 : 2e6 + (i % 5) * 1e5));
  return mkSeries(days(30).map((_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`), [["top", top], ...Array.from({ length: 11 }, (_, k) => [`s${k}`, calm(k)])]);
})();

test("G2: con un picco a 120M e 12 serie le etichette e le curve restano nel grafico", () => {
  for (const [w, h] of [MODELS.G2.min, [260, 160], [480, 240]]) {
    const T0 = 12;
    const B0 = h - 22;
    const svg = draw("G2", SPIKY, w, h);
    const ends = tagsOf(svg, /<text[^>]*data-end="1"[^>]*>/g).map((t) => num(t, "y"));
    assert.ok(ends.length >= 1, `${w}x${h}`);
    assert.ok(ends.every((y) => y >= T0 + 8 && y <= B0 + 3.5 + 0.1), `${w}x${h}: ${ends}`);
    // the top series (drawn first) sits on its own endpoint when everything fits (at the smallest sizes packing may legitimately shift it)
    const dot = tagsOf(svg, /<circle[^>]*r="3.5"[^>]*>/g)[0];
    if (h >= 240) assert.ok(Math.abs(ends[0] - 3.5 - num(dot, "cy")) <= 1.1, `${w}x${h}: label ${ends[0]} vs endpoint ${num(dot, "cy")}`);
    for (const d of attr(svg, "d").filter((v) => v.startsWith("M") && v.includes("C"))) {
      const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
      assert.ok(ys.every((y) => y >= T0 - 0.1 && y <= B0 + 0.1), `${w}x${h}: ${ys.filter((y) => y < T0 || y > B0)}`);
    }
  }
});

test("C5: ogni etichetta sta all'estremità della sua linea, su entrambi i lati, dentro il riquadro", () => {
  const rows = [["a", [1, 120e6, 121e6]], ["b", [1, 119e6, 118e6]], ...["c", "d", "e", "f", "g", "h"].map((k, i) => [k, [1, 9e5 - i * 1e5, 8e5 - i * 1e5]])];
  const s = mkSeries(days(3), rows);
  for (const [w, h] of [[480, 240], MODELS.C5.min]) {
    const svg = draw("C5", s, w, h);
    const ends = tagsOf(svg, /<line x1="[\d.]+" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" stroke="var\(--series/g);
    assert.equal(ends.length, 8);
    // left labels are end-anchored; right ones are the bold primary-colour texts without anchor
    const sides = [
      [/<text [^>]*font-size="10.5"[^>]*text-anchor="end"[^>]*>/g, "y1", "left"],
      [/<text x="[^"]*" y="[^"]*" font-size="10.5" fill="var\(--text-primary\)" font-weight="600">/g, "y2", "right"],
    ];
    for (const [re, endY, anchor] of sides) {
      const ys = tagsOf(svg, re)
        .map((t) => num(t, "y") - 3.5)
        .filter((y) => y < h - 20);
      assert.equal(ys.length, 8, `${w}x${h} ${anchor}`);
      assert.ok(ys.every((y) => y >= 0 && y <= h), `${w}x${h} ${anchor}: ${ys}`);
      const sorted = [...ys].sort((p, q) => p - q);
      for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 12.9, `${w}x${h} ${anchor}: ${sorted}`);
      // the two big series (first two rows) own the two topmost labels, each by its own endpoint
      for (const k of [0, 1]) {
        assert.ok(ys[k] <= sorted[1], `${w}x${h} ${anchor}: big series ${k} is not among the two highest labels (${ys})`);
        assert.ok(Math.abs(ys[k] - num(ends[k], endY)) <= 14, `${w}x${h} ${anchor} ${k}`);
      }
    }
  }
});

test("G2: nessuna tacca ripetuta sull'asse, a qualunque ordine di grandezza", () => {
  for (let v = 0.4; v < 1e9; v *= 1.21) {
    const svg = draw("G2", mkSeries(days(3), [["a", [v, v * 0.5, v]], ["b", [v / 4, v / 3, v / 2]]]), 480, 240);
    const labels = tagsOf(svg, /<text x="38"[^>]*text-anchor="end"[^>]*>[^<]*<\/text>/g).map((t) => t.replace(/<[^>]*>/g, ""));
    assert.ok(labels.length >= 3 && new Set(labels).size === labels.length, `v=${v}: ${labels}`);
  }
});
