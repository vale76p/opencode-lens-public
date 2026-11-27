// Shared harness for model tests (not a test file itself: no .test.js suffix).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const DEFINED = new Set([...CSS.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));

export const SIZES = [[220, 150], [480, 240], [1100, 300]];
export const HOSTILE = '<img src=x onerror=alert(1)> "&<>';

// Lookbehind keeps data-id="…" and similar from counting as ids.
const ids = (s) => new Set([...s.matchAll(/(?<![\w-])id="([^"]*)"/g)].map((m) => m[1]));
const isEmpty = (r) => r && typeof r === "object" && typeof r.empty === "string";

// Full set of checks on one draw result; returns its id set (null for { empty }).
function checkDraw(r, uid, where, bigFigure, headlines = 1) {
  if (isEmpty(r)) return null;
  assert.equal(typeof r, "string", `${where}: expected a string or { empty }`);
  assert.ok(r.startsWith("<svg"), `${where}: must start with <svg`);
  assert.ok(!/NaN|Infinity/.test(r), `${where}: NaN or Infinity in output`);
  assert.ok(!/\sstyle\s*=|<style[\s>]/i.test(r), `${where}: style attribute or element (CSP)`);
  // Escaped copies of the fixture are &lt;img…, so they cannot match these.
  assert.ok(!r.includes(HOSTILE), `${where}: raw hostile text in output`);
  assert.ok(!/<img|<script/i.test(r), `${where}: unescaped hostile markup`);
  // R14: body text 10-12, at most one headline up to 18 (up to 40 for a big-figure model).
  const sizes = [...r.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
  const big = sizes.filter((v) => v > 12);
  assert.ok(sizes.every((v) => v >= 10), `${where}: font-size below 10 (${[...new Set(sizes)]})`);
  assert.ok(big.length <= headlines, `${where}: more than ${headlines} headline size${headlines > 1 ? "s" : ""} (${big})`);
  assert.ok(big.every((v) => v <= (bigFigure ? 40 : 18)), `${where}: font-size above ${bigFigure ? 40 : 18} (${big})`);
  for (const m of r.matchAll(/var\((--[a-z0-9-]+)\)/g)) assert.ok(DEFINED.has(m[1]), `${where}: ${m[1]} is not defined in style.css`);
  if (bigFigure === "required") assert.equal(big.filter((v) => v > 18).length, 1, `${where}: exactly one figure above 18 expected (${sizes})`);
  const found = ids(r);
  for (const id of found) assert.ok(id.startsWith(`${uid}-`), `${where}: id "${id}" is not scoped to uid ${uid}`);
  return found;
}

// Draws every input at every size with two uids (opts.bigFigure: true = the model may carry one figure up to 40 px; "required" = it must;
// opts.headlines: how many texts above 12 px the model may have, one by default); `draw(input, { w, h, uid })` returns an SVG string or { empty }.
export function checkModel(_t, draw, inputs, sizes = SIZES, opts = {}) {
  for (const input of inputs) {
    for (const [w, h] of sizes) {
      const where = `${JSON.stringify(input)?.slice(0, 80)} @ ${w}x${h}`;
      const a = draw(input, { w, h, uid: "a" });
      const b = draw(input, { w, h, uid: "b" });
      assert.equal(isEmpty(a), isEmpty(b), `${where}: { empty } for one uid but not the other`);
      const A = checkDraw(a, "a", `${where} [a]`, opts.bigFigure, opts.headlines);
      const B = checkDraw(b, "b", `${where} [b]`, opts.bigFigure, opts.headlines);
      if (!A || !B) continue;
      for (const id of B) assert.ok(!A.has(id), `${where}: id "${id}" shared between instances`);
    }
  }
}
