import assert from "node:assert/strict";
import { test } from "node:test";
import { baseModel, EMPTY_PRICES, formatPrice, isPriceKey, parsePrice, priceList } from "../src/prices.js";

test("parsePrice: due, tre o quattro prezzi; default delle cache", () => {
  assert.deepEqual(parsePrice("3:15"), { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 });
  assert.deepEqual(parsePrice("3:15:0.5"), { input: 3, output: 15, cacheRead: 0.5, cacheWrite: 3 });
  assert.deepEqual(parsePrice("3:15:0.3:3.75"), { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
  for (const bad of ["", "3", "3:-1", "3:a", "3:15:1:2:3", "3,5:15", "1e-7:1"]) assert.equal(parsePrice(bad), null, bad);
});
test("formatPrice: niente esponenti, sei decimali", () => {
  assert.equal(formatPrice({ input: 0.0000001, output: 1, cacheRead: 0, cacheWrite: 0 }), "0:1:0:0");
  assert.equal(formatPrice(parsePrice("0.15:0.6")), "0.15:0.6");
});
test("formatPrice: la forma più corta, riletta uguale", () => {
  assert.equal(formatPrice(parsePrice("3:15:0.3:3")), "3:15");
  assert.equal(formatPrice(parsePrice("3:15:0.3:3.75")), "3:15:0.3:3.75");
  assert.equal(formatPrice(parsePrice("3:15:0.5")), "3:15:0.5");
});
test("baseModel: toglie #variante", () => {
  assert.equal(baseModel("a/b#high"), "a/b");
  assert.equal(baseModel("a/b"), "a/b");
});
test("priceList: varianti col prezzo del modello, ?/? senza prezzo, formula", () => {
  const p = priceList([{ model: "anthropic/x", ...parsePrice("3:15:0.3:3.75") }]);
  assert.equal(p.empty, false);
  assert.deepEqual(p.of("anthropic/x#high"), p.of("anthropic/x"));
  assert.equal(p.of("?/?"), null);
  const got = p.estimate("anthropic/x", { input: 1e6, output: 1e6, reasoning: 1e6, cacheRead: 1e6, cacheWrite: 1e6 });
  assert.ok(Math.abs(got - (3 + 15 + 15 + 0.3 + 3.75)) < 1e-9);
  assert.equal(p.estimate("openai/y", { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }), null);
  assert.equal(EMPTY_PRICES.empty, true);
});
test("isPriceKey: una sola regola per le chiavi", () => {
  for (const k of ["a/b", "openrouter/anthropic/x"]) assert.equal(isPriceKey(k), true, k);
  for (const k of ["a", "/b", "a/", "a b/c", "a/b#c", "?/?", "a/b,c", "a/b=c"]) assert.equal(isPriceKey(k), false, k);
});
test("parsePrice: al più 6 decimali e sotto 1e9, così formatPrice non arrotonda a 0 né scrive esponenti", () => {
  assert.equal(parsePrice("0.0000004:1"), null);
  assert.equal(parsePrice("1000000000:1"), null);
  assert.ok(parsePrice("999999999.999999:1"));
  assert.deepEqual(parsePrice("0.000001:1"), { input: 0.000001, output: 1, cacheRead: 1e-7, cacheWrite: 0.000001 });
  assert.equal(formatPrice(parsePrice("0.000001:1")), "0.000001:1");
});
test("estimate: i tipi mancanti valgono 0, mai NaN", () => {
  const p = priceList([{ model: "a/b", ...parsePrice("3:15") }]);
  assert.equal(p.estimate("a/b", { input: 1e6 }), 3);
  assert.equal(p.estimate("a/b", {}), 0);
});
