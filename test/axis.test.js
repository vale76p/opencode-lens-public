// Pure axis helpers: importable in Node, no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { labelWidth, niceTicks, tickLabel } from "../public/axis.js";

test("nessuna etichetta ripetuta", () => {
  for (const metric of ["tokens", "cost", "steps", "count"]) {
    for (const max of [0, 1, 3, 7, 0.02, 0.015, 999, 1234]) {
      const integer = metric !== "cost"; // tokens, steps and counts are whole numbers
      const a = niceTicks(max, { integer });
      const labels = a.ticks.map((t) => tickLabel(t, metric, a.decimals));
      assert.equal(new Set(labels).size, labels.length, `${metric} ${max}: ${labels}`);
      assert.ok(a.max >= max);
    }
  }
});

test("metriche intere: passo intero", () => {
  const a = niceTicks(3, { integer: true });
  assert.equal(a.step, 1);
  assert.deepEqual(a.ticks, [0, 1, 2, 3]);
  assert.equal(niceTicks(0.4, { integer: true }).step, 1);
});

test("max 0 → asse 0–1", () => {
  const a = niceTicks(0);
  assert.equal(a.max, 1);
  assert.equal(a.ticks[0], 0);
  assert.equal(a.ticks.at(-1), 1);
  assert.deepEqual(niceTicks(0, { integer: true }).ticks, [0, 1]);
  assert.equal(niceTicks(Number.NaN).max, 1);
});

test("decimali per il denaro", () => {
  const a = niceTicks(0.02);
  assert.deepEqual(
    a.ticks.map((t) => tickLabel(t, "cost", a.decimals)),
    ["0,00 $", "0,01 $", "0,02 $"],
  );
});

test("denaro: gli stessi decimali su tutte le tacche", () => {
  const whole = niceTicks(100, { count: 3 });
  assert.deepEqual(
    whole.ticks.map((t) => tickLabel(t, "cost", whole.decimals)),
    ["0 $", "50 $", "100 $"],
  );
  const half = niceTicks(1.5, { count: 4 });
  assert.deepEqual(
    half.ticks.map((t) => tickLabel(t, "cost", half.decimals)),
    ["0,00 $", "0,50 $", "1,00 $", "1,50 $"],
  );
});

test("passi 1-2-5", () => {
  assert.equal(niceTicks(1234).step, 500);
  assert.equal(niceTicks(7).step, 5);
  assert.deepEqual(niceTicks(999).ticks, [0, 500, 1000]);
});

test("etichette per metrica", () => {
  assert.equal(tickLabel(1500, "tokens", 0), "1,5k");
  assert.equal(tickLabel(2, "count", 0), "2");
  assert.equal(tickLabel(12000, "count", 0), "12.000");
  assert.equal(tickLabel(0.005, "cost", 3), "0,005 $");
});

test("labelWidth: minimo 28", () => {
  assert.equal(labelWidth([]), 28);
  assert.equal(labelWidth(["0"]), 28);
  assert.equal(labelWidth(["1,5k", "11,53 $"], 10), 70);
});
