import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setContext } from "../public/ui.js";

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");
const html = read("index.html");
const css = read("style.css");

const SLOTS = ["s-ident", "s-period", "s-vista", "s-source", "s-status", "s-actions", "s-action"];

// Each page view's top bar, by the view's id («dashboard», «prompt», …).
function bars() {
  const out = {};
  for (const m of html.matchAll(/<section class="page-view[^"]*" id="view-([a-z]+)"/g)) {
    const rest = html.slice(m.index);
    const bar = rest.match(/<header class="topbar">[\s\S]*?<\/header>/);
    assert.ok(bar, `view-${m[1]}: no top bar`);
    out[m[1]] = bar[0];
  }
  return out;
}
const BARS = bars();

// The outer HTML of the element whose opening tag contains `marker`, by balancing its tag name.
function element(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const start = src.lastIndexOf("<", at);
  const name = src.slice(start + 1).match(/^[a-z0-9]+/)[0];
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "g");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return src.slice(start, re.lastIndex);
  }
  return null;
}
const slot = (bar, cls) => element(bar, `class="slot ${cls}"`);
function inSlot(page, cls, marker) {
  const s = slot(BARS[page], cls);
  assert.ok(s, `${page}: no ${cls}`);
  assert.ok(s.includes(marker), `${page}: ${marker} not in ${cls}`);
}

test("barra: ogni barra ha identità e azione fissa", () => {
  // the core's pages; a module's page brings its own bar (IBM Bob's: modules/bob/test/bob-page.test.js, Skill's: modules/skill/test/skill-page.test.js)
  assert.equal(Object.keys(BARS).length, 6);
  assert.equal((html.match(/<header class="topbar">/g) || []).length, 6);
  for (const [page, bar] of Object.entries(BARS)) {
    assert.ok(bar.includes('class="slot s-ident"'), `${page}: s-ident`);
    assert.ok(bar.includes('class="slot s-action"'), `${page}: s-action`);
    assert.equal(bar.lastIndexOf('class="slot '), bar.indexOf('class="slot s-action"'), `${page}: s-action is the last slot`);
  }
});

test("barra: i posti seguono l'ordine", () => {
  for (const [page, bar] of Object.entries(BARS)) {
    const at = SLOTS.map((s) => bar.indexOf(`class="slot ${s}"`)).filter((i) => i >= 0);
    assert.deepEqual(at, [...at].sort((a, b) => a - b), page);
    // every slot is a child of the one row, none nested in another
    for (const s of SLOTS) {
      const own = slot(bar, s);
      if (own) assert.ok(!own.slice(own.indexOf(">")).includes('class="slot '), `${page}: ${s} holds another slot`);
    }
  }
});

test("barra: la dashboard ha tutti e tre i posti a sinistra", () => {
  const bar = BARS.dashboard;
  for (const s of ["s-period", "s-vista", "s-source", "s-status", "s-actions"]) assert.ok(slot(bar, s), s);
  inSlot("dashboard", "s-period", 'id="f-range"');
  inSlot("dashboard", "s-vista", 'class="vista-wrap"');
  inSlot("dashboard", "s-source", 'id="source-select"');
  inSlot("dashboard", "s-status", 'id="mon-clock"');
  inSlot("dashboard", "s-status", 'id="edit-done"');
  inSlot("dashboard", "s-actions", 'id="fullscreen"');
  inSlot("dashboard", "s-action", 'id="customize"');
  assert.ok(!html.includes('id="f-analisi"'), "the Analisi filters are two controls, not one wrapper");
});

test("barra: i controlli delle pagine stanno nel loro posto (la pagina di Skill è del modulo: modules/skill/test/skill-page.test.js)", () => {
  inSlot("galleria", "s-status", 'id="gal-ids"');
  inSlot("impostazioni", "s-action", 'class="ghost link-btn"');
});

test("barra: Prompt e Sessioni hanno i posti per i filtri di Analisi", () => {
  for (const page of ["dashboard", "prompt", "sessioni"]) {
    for (const [cls, name] of [["s-period", "period"], ["s-vista", "vista"]]) {
      const s = slot(BARS[page], cls);
      assert.ok(s, `${page}: ${cls}`);
      assert.match(s.slice(0, s.indexOf(">")), new RegExp(`data-filters="${page}-${name}"`), `${page}: ${cls}`);
    }
  }
});

test("barra: niente più larghezza riservata alla riga di Analisi", () => {
  assert.ok(!read("shell-status.js").includes("reserveAnalisiContext"));
  assert.ok(!read("app.js").includes("reserveAnalisiContext"));
  assert.ok(!css.includes("#analisi-context { min-width: 0 !important"));
});

// the block of an at-rule, from its opening brace to the matching closing one
function block(prelude) {
  const at = css.indexOf(`${prelude} {`);
  assert.ok(at >= 0, `${prelude} not found`);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  return null;
}

test("barra: posti fissi sopra la soglia", () => {
  // the container is the bar itself, not the page: a container on .page-view would hold its fixed drawers and toasts
  const topbar = css.split("\n").filter((l) => l.startsWith(".topbar {"));
  assert.ok(topbar.some((l) => l.includes("container: bar / inline-size")), "container on .topbar");
  assert.ok(!/\.page-view \{[^}]*container/.test(css), "no container on .page-view");
  assert.ok(!css.includes("dashbar"), "the dashboard's own container is gone");
  const fixed = block("@container bar (min-width: 1240px)");
  for (const s of [".s-ident { width: 320px", ".s-period { width: 250px", ".s-vista { width: 200px", ".s-action { width: 32px"]) {
    assert.ok(fixed.includes(s), s);
  }
  assert.match(fixed, /\.s-source \{ width: \d+px/);
});

test("barra: sotto 900 px ogni barra va a capo per gruppi interi", () => {
  assert.match(block("@container bar (max-width: 900px)"), /\.tb-row \{[^}]*flex-wrap: wrap/);
});

test("setContext: scrive la riga e la mette intera nel title dell'identità", () => {
  const ident = { title: "" };
  const line = { textContent: "", hidden: false, classList: { contains: () => false }, closest: (sel) => (sel === ".s-ident" ? ident : null) };
  setContext(line, "Ultimi 7 giorni · 17 ott – 24 ott");
  assert.equal(line.textContent, "Ultimi 7 giorni · 17 ott – 24 ott");
  assert.equal(ident.title, "Ultimi 7 giorni · 17 ott – 24 ott");
  // a hidden line (another subview's) leaves the title to the one shown
  const other = { ...line, textContent: "", classList: { contains: (c) => c === "hidden" } };
  setContext(other, "Oggi");
  assert.equal(other.textContent, "Oggi");
  assert.equal(ident.title, "Ultimi 7 giorni · 17 ott – 24 ott");
});
