import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const TOKENS = ["frame", "sheet", "sheet-edge", "track", "control-edge", "nav-active"];

// The three token blocks: light :root, the media-query dark one, the forced dark one.
function blocks() {
  const light = css.match(/^:root \{[\s\S]*?\n\}/m)[0];
  const media = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:where\(:not\(\[data-theme="light"\]\)\) \{[\s\S]*?\n {2}\}/)[0];
  const forced = css.match(/^:root\[data-theme="dark"\] \{[\s\S]*?\n\}/m)[0];
  return [light, media, forced];
}

function rule(selector) {
  const i = css.indexOf(`\n${selector} {`);
  assert.ok(i >= 0, `rule ${selector} not found`);
  return css.slice(i + 1, css.indexOf("}", i) + 1);
}

function lum(hex) {
  const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const val = (block, name) => block.match(new RegExp(`^\\s*--${name}:\\s*(#[0-9a-fA-F]{6})`, "m"))[1];

test("cornice: i token nuovi esistono in chiaro e nei due scuri", () => {
  for (const t of TOKENS) {
    const n = (css.match(new RegExp(`^\\s*--${t}:`, "gm")) || []).length;
    assert.equal(n, 3, `--${t}`);
  }
});

test("cornice: contrasto ≥ 4.5 dei testi su --frame e --sheet", () => {
  for (const b of blocks()) {
    for (const bg of ["frame", "sheet"]) {
      assert.ok(contrast(val(b, "text-secondary"), val(b, bg)) >= 4.5, `text-secondary on ${bg}`);
      assert.ok(contrast(val(b, "text-primary"), val(b, bg)) >= 4.5, `text-primary on ${bg}`);
    }
  }
});

test("cornice: la barra in alto non sfoca e non ha bordo sotto", () => {
  const r = rule(".topbar");
  for (const bad of ["backdrop-filter", "border-bottom", "color-mix("]) assert.ok(!r.includes(bad), bad);
});

test("cornice: il menu non usa l'accento", () => {
  for (const sel of ['.nav a[aria-current="page"]', ".nav a:hover", ".nav-tpl:hover", ".rail-collapse:hover"]) {
    const lines = css.split("\n").filter((l) => l.startsWith(sel));
    assert.ok(lines.length, sel);
    for (const l of lines) assert.ok(!l.includes("--accent"), l);
  }
});

test("cornice: il foglio", () => {
  const r = rule(".view-body");
  for (const s of ["var(--sheet)", "var(--sheet-edge)", "border-radius: 14px", "margin: 0 8px 8px 0", "min-height: calc(100vh - 57px - 8px)"]) {
    assert.ok(r.includes(s), s);
  }
});

test("cornice: la barra sta sopra la barra di modifica e sotto il menu", () => {
  const z = (sel) => Number(rule(sel).match(/z-index:\s*(\d+)/)[1]);
  assert.ok(z(".topbar") > z(".edit-bar"), "topbar over edit-bar (its «Vista» popover opens over it)");
  assert.ok(z(".topbar") < z(".rail"), "topbar under the rail");
});

test("cornice: la barra della galleria non sfoca", () => {
  const r = rule(".gal-bar");
  for (const bad of ["backdrop-filter", "color-mix("]) assert.ok(!r.includes(bad), bad);
});

test("cornice: una sola azione fissa resta a destra quando la barra va a capo", () => {
  assert.match(css, /@container bar \(max-width: 900px\) \{[\s\S]*?\.s-action \{ margin-left: auto; \}/);
});
