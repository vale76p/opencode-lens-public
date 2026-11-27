import assert from "node:assert/strict";
import { test } from "node:test";
import { SIZES, autoScale, gridScale, sizeOf } from "../public/scale.js";

test("autoScale: da 1500 a 2200 px non cambia niente", () => {
  for (const w of [1500, 1512, 1710, 1920, 2200]) assert.equal(autoScale(w), 1, String(w));
});

test("autoScale: sotto 1500 px si rimpicciolisce in proporzione, fino al 75%", () => {
  assert.equal(autoScale(1200), 0.8);
  assert.equal(autoScale(1100), 0.75, "il minimo");
  assert.equal(autoScale(760), 0.75);
});

test("autoScale: sopra 2200 px cresce in proporzione, fino al 150%", () => {
  assert.equal(autoScale(2560), 1.16);
  assert.equal(autoScale(3840), 1.5, "un 4K a scala 100%");
  assert.equal(autoScale(7680), 1.5, "il massimo");
});

test("autoScale e gridScale: sotto 700 px (la griglia è già una colonna) e senza larghezza vale 1", () => {
  for (const w of [0, 320, 699, NaN, undefined, null]) {
    assert.equal(autoScale(w), 1, String(w));
    assert.equal(gridScale("grande", w), 1, `grande a ${w}`);
  }
});

test("gridScale: una scelta fissa non dipende dalla larghezza", () => {
  for (const w of [1100, 1920, 3840]) {
    assert.equal(gridScale("piccola", w), SIZES.piccola);
    assert.equal(gridScale("normale", w), 1);
    assert.equal(gridScale("grande", w), SIZES.grande);
  }
});

test("gridScale: auto, e un valore sconosciuto, seguono la larghezza", () => {
  assert.equal(gridScale("auto", 3840), 1.5);
  assert.equal(gridScale("boh", 1200), 0.8);
  assert.equal(gridScale(undefined, 1920), 1);
});

test("sizeOf: una scelta salvata non valida torna ad auto", () => {
  assert.equal(sizeOf("piccola"), "piccola");
  assert.equal(sizeOf("auto"), "auto");
  for (const v of ["", "xl", 3, null, undefined, "__proto__", "toString"]) assert.equal(sizeOf(v), "auto", String(v));
});
