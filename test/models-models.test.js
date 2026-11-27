import assert from "node:assert/strict";
import { test } from "node:test";
import { modelsInput } from "../public/adapt.js";
import { MODELS } from "../public/models-models.js";
import { HOSTILE, SIZES, checkModel } from "./models-helpers.js";

const slotFor = (_by, key) => (key.length % 6) + 1;
const row = (key, total, extra = {}) => ({
  key,
  tokens: { input: total * 0.1, output: total * 0.05, reasoning: total * 0.05, cacheRead: total * 0.7, cacheWrite: total * 0.1, total },
  cost: 1,
  cacheRate: 0.7,
  steps: 3,
  failed: 0,
  speed: { ttftMs: { p50: 1200, p95: 3400 } },
  ...extra,
});
const BREAKDOWN = [
  row("p/qwen", 168e6),
  row("p/llama", 61e6, { speed: null }),
  row("p/gpt-oss#high", 38e6, { speed: { ttftMs: { p50: 2300, p95: null } } }),
  row("p/mistral", 29e6),
];
const BUDGET = {
  periods: {
    day: {
      models: [
        { model: "p/qwen", limit: 200e6, ratio: 0.84 },
        { model: "p/gpt-oss", limit: 30e6, ratio: 1.27 },
        { model: "p/mistral", limit: 100e6, ratio: 0.29 },
      ],
    },
  },
};
const PREV = [row("p/qwen", 142e6), row("p/llama", 70e6), row("p/gpt-oss#high", 28e6)];
const ROWS = modelsInput(BREAKDOWN, BUDGET, slotFor, PREV);
const NO_PREV = modelsInput(BREAKDOWN, BUDGET, slotFor);
const NO_LIMITS = modelsInput(BREAKDOWN, undefined, slotFor, PREV);
const ONE = modelsInput([row("p/solo", 5e6)], BUDGET, slotFor, PREV);
const HOSTILE_ROWS = modelsInput([row(`p/${HOSTILE}`, 9e6)], { periods: { day: { models: [{ model: HOSTILE, limit: 10e6, ratio: 0.9 }] } } }, slotFor, [row(`p/${HOSTILE}`, 8e6)]);
const SUMMARY = { count: 200, outcomes: { succeeded: 150, failed: 20, interrupted: 25, unknown: 5 } };
const ONE_RUN = { count: 1, outcomes: { succeeded: 1, failed: 0, interrupted: 0, unknown: 0 } };

const attr = (svg, role, name) => [...svg.matchAll(new RegExp(`data-role="${role}"[^>]*?\\s${name}="([^"]+)"`, "g"))].map((m) => Number(m[1]));
const draw = (id, input, w = 480, h = 240) => MODELS[id].draw(input, { w, h, uid: "a" });
const tips = (svg) => [...svg.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1]);

const CASES = {
  B3: ROWS,
  B6: ROWS,
  B7: ROWS,
  B8: ROWS,
  B9: ROWS,
  C15: ROWS,
  C21: ROWS,
  C8: SUMMARY,
};

for (const [id, input] of Object.entries(CASES)) {
  test(`${id}: contratto`, (t) => {
    const m = MODELS[id];
    assert.ok(m.name && Array.isArray(m.min) && (m.compactBelow === null || m.compactBelow > 0), "name, min, compactBelow (null = no reduced form)");
    const hostile = id === "C8" ? SUMMARY : HOSTILE_ROWS;
    const sizes = [...SIZES, m.min];
    checkModel(t, m.draw, [input, ONE, hostile, ...(id === "C8" ? [ONE_RUN] : [])], sizes);
    for (const e of id === "C8" ? [{ count: 0, outcomes: {} }, undefined] : [[], undefined]) {
      assert.equal(typeof m.draw(e, { w: 480, h: 240, uid: "a" }).empty, "string");
    }
  });
}

test("B3/C15: senza budget non c'è nulla da disegnare", () => {
  assert.equal(typeof draw("B3", NO_LIMITS).empty, "string");
  assert.equal(typeof draw("C15", NO_LIMITS).empty, "string");
});

test("B3: arco = min(ratio, 0.999); oltre 1 pallino e testo in --critical; i modelli senza limite restano fuori", () => {
  const svg = draw("B3", ROWS);
  assert.equal((svg.match(/data-role="ring"/g) ?? []).length, 3, "qwen, gpt-oss, mistral; llama senza limite");
  assert.equal((svg.match(/data-role="over"/g) ?? []).length, 1);
  assert.match(svg, /fill="var\(--critical\)"[^>]*>127%</, "percentuale in --critical");
  assert.ok(svg.includes(">127%<"));
  assert.ok(!svg.includes("llama"));
  // ratio 1.27 -> arc capped just under a full turn: end point is a hair away from the start point
  const near = draw("B3", modelsInput([row("p/x", 1e6)], { periods: { day: { models: [{ model: "p/x", limit: 1, ratio: 5 }] } } }, slotFor));
  const d = near.match(/data-role="ring" d="M([\d.-]+),([\d.-]+) A\S+ 0 (\d) 1 ([\d.-]+),([\d.-]+)"/);
  assert.equal(d[3], "1", "large-arc flag");
  assert.ok(Math.hypot(d[4] - d[1], d[5] - d[2]) < 1, "closes almost completely, never fully");
});

test("B6 senza budget: lunghezza barra proporzionale a token / primo, che è sempre pieno", () => {
  const svg = draw("B6", NO_LIMITS);
  const w = attr(svg, "bar", "width");
  assert.equal(w.length, 4);
  assert.ok(Math.abs(w[1] / w[0] - 61 / 168) < 0.01);
  assert.ok(Math.abs(w[3] / w[0] - 29 / 168) < 0.01);
  assert.match(svg, /rispetto al più usato/, "la legenda dice che cosa è la barra");
  assert.ok(tips(svg).some((t) => t.includes("del modello più usato")));
});

test("B6 con budget: la barra è la quota del budget, il primo modello non è più pieno", () => {
  const svg = draw("B6", ROWS);
  const w = attr(svg, "bar", "width");
  const track = 480 - 8;
  assert.equal(w.length, 3, "llama senza budget: nessuna barra");
  assert.ok(Math.abs(w[0] / track - 0.84) < 0.01, "qwen: 84% del budget, non la barra intera");
  assert.ok(Math.abs(w[1] / track - 1) < 0.01, "gpt-oss oltre il budget: barra piena");
  assert.ok(Math.abs(w[2] / track - 0.29) < 0.01);
  assert.match(svg, /nessun budget/);
  assert.match(svg, /quota del budget giornaliero/);
  assert.equal((svg.match(/stop-color="var\(--critical\)"/g) ?? []).length, 2, "solo la barra oltre il limite è rossa");
  assert.match(svg, /fill="var\(--critical\)"[^>]*>[^<]*127%</, "percentuale oltre il limite in rosso");
});

test("B6: il limite di 100M non riempie la barra del modello più usato", () => {
  const one = modelsInput([row("p/solo", 5e6)], { periods: { day: { models: [{ model: "p/solo", limit: 100e6, ratio: 0.05 }] } } }, slotFor);
  const [w] = attr(draw("B6", one), "bar", "width");
  assert.ok(Math.abs(w / (480 - 8) - 0.05) < 0.01);
});

test("B6: una variante mostra la sua quota del budget, non quella del modello intero", () => {
  const rows = modelsInput([row("p/qwen", 60e6), row("p/qwen#high", 20e6)], { periods: { day: { models: [{ model: "p/qwen", limit: 100e6, ratio: 0.8 }] } } }, slotFor);
  const svg = draw("B6", rows);
  const [a, b] = attr(svg, "bar", "width");
  assert.ok(Math.abs(a / (480 - 8) - 0.6) < 0.01);
  assert.ok(Math.abs(b / (480 - 8) - 0.2) < 0.01);
  assert.ok(tips(svg).some((t) => t.includes("20M token, 20% del budget") && t.includes("varianti sommate")));
});

test("B6: il nome del modello è scritto per intero quando c'è posto", () => {
  const long = modelsInput([row("azienda/llama-4-maverick-17b-128e-instruct", 9e6)], undefined, slotFor);
  assert.ok(draw("B6", long, 480, 160).includes(">llama-4-maverick-17b-128e-instruct<"));
});

test("B6: le voci che non entrano confluiscono in «altre N voci»", () => {
  const many = modelsInput(Array.from({ length: 12 }, (_, i) => row(`p/m${i}`, 10e6 - i)), undefined, slotFor);
  const svg = draw("B6", many, 480, 160);
  assert.match(svg, /altre \d+ voci/);
});

test("B7: i segmenti di ogni riga sommano al 100%", () => {
  const svg = draw("B7", ROWS, 480, 240);
  const w = attr(svg, "seg", "width");
  const L = attr(svg, "seg", "x")[0]; // the gutter follows the longest label (draw.js gutter)
  assert.ok(L >= 70 && L <= 480 * 0.4, `gutter ${L}`);
  const rowWidth = 480 - 8 - L;
  assert.equal(w.length, 4 * 5);
  for (let r = 0; r < 4; r++) {
    const sum = w.slice(r * 5, r * 5 + 5).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - rowWidth) < 1e-6, `riga ${r}: ${sum} vs ${rowWidth}`);
  }
});

test("B8: segno e lunghezza da deltaRatio, «–» senza periodo prima", () => {
  const svg = draw("B8", ROWS);
  const w = attr(svg, "delta", "width");
  const x = attr(svg, "delta", "x");
  assert.equal(w.length, 3, "mistral non era nel periodo prima");
  const maxD = Math.max(...ROWS.map((r) => Math.abs(r.deltaRatio ?? 0)));
  assert.ok(Math.abs(w[2] / w[0] - Math.abs(ROWS[2].deltaRatio) / ROWS[0].deltaRatio) < 1e-6);
  assert.ok(maxD > 0);
  assert.ok(svg.includes(">+18%<"), "qwen 142M -> 168M");
  assert.ok(svg.includes(">−13%<"), "llama 70M -> 61M");
  assert.ok(x[1] < x[0], "negativo a sinistra dell'asse");
  assert.ok(svg.includes(">rispetto al periodo prima<"), "l'asse dice con che cosa confronta");
  const none = draw("B8", NO_PREV);
  assert.equal(attr(none, "delta", "width").length, 0);
  assert.ok(none.includes(">–<"));
});

test("B9: punto a p50, baffo fino a p95, senza velocità il modello manca", () => {
  const svg = draw("B9", ROWS);
  assert.equal((svg.match(/data-role="dot"/g) ?? []).length, 3, "llama senza tempi");
  assert.equal((svg.match(/data-role="whisker"/g) ?? []).length, 2, "gpt-oss senza p95");
  assert.ok(!svg.includes("llama"));
  const [cx] = attr(svg, "dot", "cx");
  const [x1, x2] = [attr(svg, "whisker", "x1")[0], attr(svg, "whisker", "x2")[0]];
  assert.equal(cx, x1, "il baffo parte dal punto");
  assert.ok(x2 > x1);
  assert.ok(tips(svg).some((t) => t.includes("1,2 s (p50), 3,4 s (p95)")));
  assert.equal(typeof draw("B9", modelsInput([row("p/a", 1, { speed: null })], undefined, slotFor)).empty, "string");
});

test("C15: sweep a 270° e etichette che finiscono a cx − 10", () => {
  const svg = draw("C15", ROWS, 480, 240);
  const ds = [...svg.matchAll(/data-role="sweep" d="M([\d.-]+),([\d.-]+) A([\d.]+),\S+ 0 (\d) 1 ([\d.-]+),([\d.-]+)"/g)];
  assert.equal(ds.length, 3);
  // the over-budget ring is capped at the full 270° sweep: it ends level with the centre, left of it
  const cx = Number(ds[0][1]);
  const over = ds[1];
  assert.equal(over[4], "1", "oltre 180°");
  assert.ok(Math.abs(Number(over[6]) - 120) < 0.01, "cy");
  assert.ok(Math.abs(Number(over[5]) - (cx - Number(over[3]))) < 0.01, "270°: ends on the left at cx − r");
  const labels = [...svg.matchAll(/data-role="label" x="([\d.-]+)"/g)].map((m) => Number(m[1]));
  assert.ok(labels.length === 3 && labels.every((x) => Math.abs(x - (cx - 10)) < 1e-9));
  assert.ok(svg.includes('stroke="var(--critical)"'));
});

test("C21: forma compatta sotto 380 px, completa sopra", () => {
  const compact = draw("C21", ROWS, 300, 200);
  const full = draw("C21", ROWS, 500, 200);
  assert.ok(compact.includes("1° tok.") && !compact.includes("vs prima"));
  assert.ok(full.includes("vs prima") && full.includes("Primo token"));
  assert.ok(compact.includes(">1,2 s<") && compact.includes(">168M<"));
  assert.ok(full.includes("▲ 18%") && full.includes("▼ 13%"));
  assert.ok(draw("C21", NO_PREV, 500, 200).includes(">–<"));
});

test("C8: larghezze proporzionali ai conteggi, percentuali dal primo stadio", () => {
  const svg = draw("C8", SUMMARY);
  const w = attr(svg, "stage", "width");
  assert.equal(w.length, 3);
  assert.ok(Math.abs(w[1] / w[0] - 170 / 200) < 1e-9, "conclusi = 200 − 25 − 5");
  assert.ok(Math.abs(w[2] / w[0] - 150 / 200) < 1e-9, "senza errori = riusciti");
  assert.ok(svg.includes("200 · 100%") && svg.includes("170 · 85%") && svg.includes("150 · 75%"));
});

test("B7: le quote sono sulla somma dei cinque tipi, non su tokens.total", () => {
  const r = row("p/x", 1000, { tokens: { input: 100, output: 50, reasoning: 50, cacheRead: 700, cacheWrite: 100, total: 5000 } });
  const svg = draw("B7", modelsInput([r], undefined, slotFor), 480, 240);
  const w = attr(svg, "seg", "width");
  const L = attr(svg, "seg", "x")[0];
  assert.equal(w.length, 5);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - (480 - 8 - L)) < 1e-6);
  assert.ok(Math.abs(w[0] / (480 - 8 - L) - 0.7) < 1e-9, "cache letta = 700 / 1000");
});

test("B3: l'arco finisce all'angolo di ratio; sopra 1 si ferma a 0,999", () => {
  const sweepOf = (ratio) => {
    const budget = { periods: { day: { models: [{ model: "p/x", limit: 10, ratio }] } } };
    const svg = draw("B3", modelsInput([row("p/x", 1e6)], budget, slotFor), 480, 240);
    const [, cx, cy] = svg.match(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/);
    const [, x0, y0, , , x1, y1] = svg.match(/data-role="ring" d="M([\d.-]+),([\d.-]+) A(\S+) 0 (\d) 1 ([\d.-]+),([\d.-]+)"/);
    const turn = Math.atan2(y1 - cy, x1 - cx) - Math.atan2(y0 - cy, x0 - cx);
    return (((turn % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
  };
  assert.ok(Math.abs(sweepOf(0.84) - 0.84) < 0.005);
  assert.ok(Math.abs(sweepOf(1.6) - 0.999) < 0.005);
  assert.ok(sweepOf(1.6) < 1);
});

test("C8: nelle giunzioni le perdite tra due stadi; le giunzioni crescono con la carta", () => {
  const gapOf = (svg) => {
    const ys = attr(svg, "stage", "y");
    const hh = attr(svg, "stage", "height")[0];
    return ys[1] - ys[0] - hh;
  };
  for (const [w, h] of [
    [434, 136],
    [434, 192],
  ]) {
    const svg = draw("C8", SUMMARY, w, h);
    assert.deepEqual([...svg.matchAll(/data-role="loss"[^>]*>([^<]*)</g)].map((m) => m[1]), ["−30 interrotti", "−20 falliti"], `${w}x${h}`);
  }
  assert.ok(gapOf(draw("C8", SUMMARY, 434, 192)) > gapOf(draw("C8", SUMMARY, 434, 136)));
  assert.ok(attr(draw("C8", SUMMARY, 434, 400), "stage", "height").every((v) => v <= 44), "barre alte al massimo 44 px");
  assert.ok(!draw("C8", ONE_RUN, 434, 192).includes('data-role="loss"'), "niente perso, niente etichetta");
  assert.ok(!draw("C8", SUMMARY, 434, 110).includes('data-role="loss"'), "giunzioni sotto 12 px: niente etichetta");
});

test("C15: composizione centrata nella carta", () => {
  for (const [w, h] of [
    [313, 248],
    [313, 304],
    [434, 248],
  ]) {
    const svg = draw("C15", ROWS, w, h);
    const [, cx, , rad] = svg.match(/data-role="sweep" d="M([\d.-]+),([\d.-]+) A([\d.]+),/).map(Number);
    const sw = Number(/data-role="sweep"[^>]*stroke-width="([\d.]+)"/.exec(svg)[1]);
    const rMax = rad + sw / 2;
    const labels = [...svg.matchAll(/data-role="label"[^>]*>(.*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").replace(/&[#\w]+;/g, "x"));
    const leftW = Math.max(rMax, 10 + Math.max(...labels.map((l) => l.length * 6)));
    const left = cx - leftW;
    const right = w - (cx + rMax);
    assert.ok(left >= 0 && Math.abs(left - right) < 1, `${w}x${h}: margini ${left.toFixed(1)} / ${right.toFixed(1)}`);
  }
});

test("B7: lo spazio delle etichette segue la più lunga, entro il 40% della carta", () => {
  const short = modelsInput([row("p/a", 100), row("p/b", 50)], undefined, slotFor);
  const long = modelsInput([row("provider/un-modello-dal-nome-lungo", 100), row("p/b", 50)], undefined, slotFor);
  const gut = (svg) => attr(svg, "seg", "x")[0];
  assert.ok(gut(draw("B7", long, 900, 240)) > gut(draw("B7", short, 900, 240)), "un nome lungo allarga lo spazio");
  assert.ok(gut(draw("B7", long, 480, 240)) <= 480 * 0.4, "mai oltre il 40%");
  assert.ok(!draw("B7", long, 900, 240).includes("…"), "a 900 px il nome non si taglia");
});
