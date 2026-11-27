// Curve morbide del widget linea: interpolazione monotona (Fritsch–Carlson).
import { test } from "node:test";
import assert from "node:assert/strict";
import { areaPath, monotonePath } from "../public/curves.js";

/** [[x1,y1,x2,y2,x,y], …] from the C segments of a path. */
function segments(d) {
  return [...d.matchAll(/C([^C]+)/g)].map((m) => m[1].split(/[ ,]+/).filter(Boolean).map(Number));
}

test("monotonePath: casi minimi", () => {
  assert.equal(monotonePath([]), "");
  assert.equal(monotonePath([[1, 2]]), "M1,2");
  assert.equal(monotonePath([[0, 0], [5, 5]]), "M0,0L5,5");
});

test("monotonePath: passa per i punti e non supera i valori", () => {
  const pts = [
    [0, 100],
    [10, 40],
    [20, 40],
    [30, 0],
    [40, 90],
  ];
  const d = monotonePath(pts);
  assert.ok(d.startsWith("M0,100C"), d);
  const segs = segments(d);
  assert.equal(segs.length, pts.length - 1);
  for (const [i, s] of segs.entries()) {
    const [a, b] = [pts[i], pts[i + 1]];
    assert.deepEqual([s[4], s[5]], b, `il segmento ${i} finisce sul punto`);
    const lo = Math.min(a[1], b[1]);
    const hi = Math.max(a[1], b[1]);
    for (const y of [s[1], s[3]]) assert.ok(y >= lo - 1e-9 && y <= hi + 1e-9, `controllo ${y} fuori da [${lo}, ${hi}] nel segmento ${i}`);
    for (const x of [s[0], s[2]]) assert.ok(x >= a[0] && x <= b[0], `x di controllo dentro il segmento ${i}`);
  }
  // il tratto piatto [10,40]→[20,40] resta piatto
  assert.deepEqual([segs[1][1], segs[1][3]], [40, 40]);
});

test("monotonePath: decimali a 2 cifre, coppie x,y senza spazi", () => {
  const d = monotonePath([
    [0, 0],
    [3, 1],
    [7, 2],
  ]);
  assert.doesNotMatch(d, /\d\.\d{3,}/);
  assert.doesNotMatch(d, /, | ,/);
});

test("areaPath: la curva chiusa sulla linea di base", () => {
  const pts = [
    [0, 10],
    [10, 20],
    [20, 5],
  ];
  assert.equal(areaPath(pts, 50), `${monotonePath(pts)}L20,50L0,50Z`);
  assert.equal(areaPath([], 50), "");
});
