// Funzioni pure di disegno SVG e arnese di prova dei modelli.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arc, clip, esc, glow, gid, gradV, gutter, niceMax, niceScale, packLabels, polar, smooth, svgDoc, text, wrap2, yTicks } from "../public/draw.js";
import { compact, dur, money } from "../public/ui.js";
import { checkModel, HOSTILE, SIZES } from "./models-helpers.js";

test("esc: neutralizza & < > \" '", () => {
  assert.equal(esc(HOSTILE), "&lt;img src=x onerror=alert(1)&gt; &quot;&amp;&lt;&gt;");
  assert.equal(esc("it's"), "it&#39;s");
  assert.equal(esc(null), "");
});

test("smooth: uno e due punti danno un tracciato valido", () => {
  assert.equal(smooth([[1, 2]]), "M1,2");
  assert.match(smooth([[0, 0], [10, 5]]), /^M0,0 C[\d., -]+ 10\.0,5\.0$/);
  assert.equal(smooth([]), "");
});

test("smooth: una punta non esce mai dall'intervallo dei dati (niente sforamenti)", () => {
  const pts = [0, 0, 0, 100, 0, 0].map((v, i) => [i * 20, 100 - v]); // y down: data 0..100 -> y 100..0
  const ys = [...smooth(pts).matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
  assert.ok(ys.length > 6);
  assert.ok(ys.every((y) => y >= 0 && y <= 100), ys.join(" "));
  // decreasing x (reversed ribbon edge) behaves the same
  const rev = [...pts].reverse();
  assert.ok([...smooth(rev).matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].every((m) => Number(m[2]) >= 0 && Number(m[2]) <= 100));
});

test("niceScale: sceglie tacche e massimo con lo sforamento minore", () => {
  assert.ok(niceScale(40.8).max <= 50);
  assert.deepEqual(niceScale(1.3e6 * 1.05), { max: 1.5e6, n: 3 });
  const z = niceScale(0);
  assert.ok(z.max > 0 && z.n >= 3 && z.n <= 5);
  assert.equal(niceMax(1.3e6 * 1.05, 3), 1.5e6);
});

test("packLabels: distanzia, resta nell'intervallo, scarta le etichette che non entrano", () => {
  const p = packLabels([0, 1, 2, 3, 100], 12, 10, 110);
  assert.deepEqual(p.map((v) => v >= 10 && v <= 110), [true, true, true, true, true]);
  const s = [...p].sort((a, b) => a - b);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] >= 12 - 0.01);
  const q = packLabels([200, 200, 200, 200, 200], 12, 10, 40); // room for 3
  assert.equal(q.filter((v) => v === null).length, 2);
  assert.ok(q.filter((v) => v !== null).every((v) => v <= 40));
});

test("niceMax: arrotonda a un massimo con n tacche tonde", () => {
  assert.equal(niceMax(1.3e6 * 1.05, 3), 1.5e6);
  assert.equal(niceMax(0, 3), 3);
});

test("arc: oltre pi greco imposta il large-arc flag", () => {
  assert.match(arc(50, 50, 40, 0, Math.PI * 1.5), / 0 1 1 /);
  assert.match(arc(50, 50, 40, 0, Math.PI / 2), / 0 0 1 /);
  assert.deepEqual(polar(10, 10, 5, 0), [15, 10]);
});

test("text: esegue l'escape e applica i valori predefiniti", () => {
  const s = text(1, 2, HOSTILE);
  assert.ok(!s.includes("<img"));
  assert.match(s, /font-size="10.5" fill="var\(--text-muted\)" text-anchor="start" font-weight="400"/);
  assert.match(text(1, 2, "x", { anchor: "end", size: 12 }), /text-anchor="end"/);
});

test("clip, yTicks, svgDoc, gradV, glow, gid", () => {
  assert.equal(clip("abcdefghij", 40), "abcde…");
  assert.equal(clip("abc", 5), "abc");
  const t = yTicks(40, 200, 10, 100, 300, 3, (v) => `${v}k`);
  assert.match(t, />0<\/text>/);
  assert.match(t, />300k<\/text>/);
  assert.equal((t.match(/<line/g) ?? []).length, 4);
  const doc = svgDoc("<g/>", { w: 220, h: 150, label: HOSTILE });
  assert.match(doc, /^<svg class="model" width="220" height="150" viewBox="0 0 220 150" role="img" aria-label="&lt;img/);
  assert.equal(gid({ uid: "w1" }, "g1"), "w1-g1");
  assert.match(gradV("w1-g1", "var(--series-1)", 0.4), /id="w1-g1"/);
  assert.match(glow("w1-f", 2), /id="w1-f".*stdDeviation="2"/);
});

const model = (input, box) => {
  const g = gid(box, "g");
  const pts = input.pts.map((v, i) => [i * 10, v]);
  return svgDoc(`<defs>${gradV(g, "var(--series-1)", 0.4)}</defs><path d="${smooth(pts)}" fill="url(#${g})"/>${text(4, 12, input.name)}`, { ...box, label: input.name });
};

test("checkModel: accetta un modello corretto, anche con { empty }", (t) => {
  checkModel(t, model, [{ pts: [1, 2, 3], name: HOSTILE }, { pts: [5], name: "x" }], SIZES);
  checkModel(t, () => ({ empty: "Nessun dato" }), [null], SIZES);
});

test("checkModel: boccia i modelli difettosi, ciascuno per il suo motivo", (t) => {
  const bad = [
    ["id senza uid", () => `<svg><defs>${gradV("g1", "red", 1)}</defs></svg>`, /not scoped to uid a/],
    ["uid ignorato (id fisso)", () => `<svg><defs>${gradV("a-g1", "red", 1)}</defs></svg>`, /not scoped to uid b/],
    ["data-id non conta, id vero senza uid sì", () => '<svg data-id="a-x"><g id="q"/></svg>', /not scoped to uid a/],
    ["NaN", () => "<svg>NaN</svg>", /NaN or Infinity/],
    ["Infinity", () => '<svg><path d="M0,Infinity"/></svg>', /NaN or Infinity/],
    ["style attributo", () => '<svg><g style="x:y"/></svg>', /style attribute/],
    ["style con spazio e maiuscole", () => '<svg><g STYLE = "x:y"/></svg>', /style attribute/],
    ["elemento style", () => "<svg><style>g{}</style></svg>", /style attribute or element/],
    ["testo non escapato", (i) => `<svg>${i.name}</svg>`, /raw hostile text/],
    ["attributo non escapato", (i) => `<svg aria-label="${i.name}"></svg>`, /raw hostile text/],
    ["script", () => "<svg><script>alert(1)</script></svg>", /unescaped hostile markup/],
    ["non svg", () => "<div/>", /must start with <svg/],
    ["empty solo per un uid", (_i, b) => (b.uid === "a" ? { empty: "x" } : "<svg/>"), /for one uid but not the other/],
  ];
  for (const [name, fn, re] of bad) {
    assert.throws(() => checkModel(t, fn, [{ name: HOSTILE }], [[220, 150]]), { name: "AssertionError", message: re }, name);
  }
});

test("niceScale: step intero per i conteggi e tacche senza doppioni dopo la formattazione", () => {
  for (let peak = 1; peak <= 30; peak++) {
    const { max, n } = niceScale(peak, 2, 4, { fmt: compact, integer: true });
    assert.ok(Number.isInteger(max / n) && max >= peak, `peak ${peak}: ${max}/${n}`);
  }
  for (const [name, fmt] of [["compact", compact], ["dur", dur], ["money", money]]) {
    for (let v = 1e-3; v < 1e10; v *= 1.07) {
      const { max, n } = niceScale(v, 3, 5, { fmt });
      assert.ok(max >= v * (1 - 1e-9));
      const labels = Array.from({ length: n + 1 }, (_, i) => fmt((max / n) * i));
      assert.equal(new Set(labels).size, n + 1, `${name} v=${v}: ${labels}`);
    }
  }
});

test("gutter: largo quanto l'etichetta più lunga, fra min e max", () => {
  assert.equal(gutter(["ab"], { charW: 6, pad: 10, min: 60, max: 200 }), 60, "corta: il minimo");
  assert.equal(gutter(["x".repeat(20)], { charW: 6, pad: 10, min: 60, max: 200 }), 130);
  assert.equal(gutter(["x".repeat(100)], { charW: 6, pad: 10, min: 60, max: 200 }), 200, "lunga: il massimo");
  assert.equal(gutter([], { min: 60 }), 60);
  // what clip keeps at that width is the whole label
  const L = gutter(["llama-4-maverick#high"], { pad: 14, min: 70, max: 400 });
  assert.equal(clip("llama-4-maverick#high", L - 12), "llama-4-maverick#high");
});

test("wrap2: intera se ci sta, poi a capo dopo un separatore, poi tagliata", () => {
  assert.deepEqual(wrap2("qwen3", 100, 6), ["qwen3"]);
  assert.deepEqual(wrap2("llama-4-maverick#high", 60, 6), ["llama-4-", "maverick#…"]);
  assert.deepEqual(wrap2("abcdefghijklmnop", 48, 6), ["abcdefgh", "ijklmnop"]);
  assert.equal(wrap2("x".repeat(40), 48, 6)[1].at(-1), "…");
  assert.deepEqual(wrap2("ultima alle 22:41", 96, 6), ["ultima alle 22:", "41"]);
  assert.deepEqual(wrap2("ultima alle 22:41", 96, 6, " "), ["ultima alle ", "22:41"], "solo agli spazi");
});
