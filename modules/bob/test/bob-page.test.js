// The browser side of IBM Bob: the page as the director gets it, its markup and stylesheet (only rules of its own,
// the core's classes only those its pages share), and the pure model of bob-model.js. The dashboard's selector
// («OpenCode», «+ Bob», «Solo Bob») is the core's (public/sources.js, test/sources.test.js); the panel in
// Impostazioni › Moduli is in settings-bob.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import manifest from "../module.js";
import { page, title } from "../public/page.js";
import { REFRESH_MS, bobPage } from "../public/bob-page.js";
import { DEFAULT_RANGE, RANGES, bobState, monthLine, monthTone, rangeQuery, readRange, tiles } from "../public/bob-model.js";

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const html = read("page.html");
const css = read("style.css");

// The core's stylesheet and page code, read as text only: what the page may take from the core's CSS
const CORE_PUBLIC = new URL("../../../public/", import.meta.url);
const coreCss = fs.readFileSync(new URL("style.css", CORE_PUBLIC), "utf8");
/** The pages' code of a public/ folder (.js and .html, not the catalogs). */
const sources = (dir) => fs.readdirSync(dir).filter((f) => /\.(js|html)$/.test(f) && !/^lang-/.test(f)).map((f) => fs.readFileSync(new URL(f, dir), "utf8"));
/** The selectors of a stylesheet, one by one (a comma inside :is( … ) does not separate them), at-rules opened. */
const selectorsOf = (sheet) =>
  [...sheet.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[^{]+\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g, "$1").matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map((m) => m[1].trim())
    .flatMap((list) => list.split(/,(?![^(]*\))/).map((x) => x.trim()));
/** Every class a stylesheet's selectors name. */
const cssClasses = (sheet) => new Set(selectorsOf(sheet).flatMap((sel) => [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((m) => m[1])));
/** The classes code puts on elements: class="…", class: "…" (its literals, ${…} left out). */
function classesUsed(texts) {
  const out = new Set();
  const words = (s) => s.split(/\s+/).filter((w) => /^[a-z][a-z0-9-]*$/.test(w));
  const literals = (s) => [...s.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, " "));
  for (const s of texts) {
    for (const m of s.matchAll(/\bclass="([^"]*)"/g)) for (const w of words(m[1])) out.add(w);
    for (const m of s.matchAll(/\bclass:\s*(`[^`]*`|[^,}\n]+)/g)) for (const w of literals(m[1]).flatMap(words)) out.add(w);
  }
  return out;
}
// The core classes the page and the panel use: building blocks of the core pages (cards, tables, top bar, slots,
// chips, facts, the meter of the month, the headings of Impostazioni). Each one is also used by the core's own pages, so
// a rule only IBM Bob needs cannot hide in public/style.css behind an entry here.
const SHARED = [
  "caption", "card", "card-head", "chipx", "code", "ctx", "facts", "ghost", "hidden", "led", "meter", "meter-fill", "muted", "num", "s-action", "s-ident",
  "s-period", "s-status", "seg", "slot", "sp", "spacer", "st-h3", "table-wrap", "tb-ico", "tb-row", "tb-title", "topbar", "view-body",
];

test("#bob: la pagina del modulo, la sua voce nel gruppo Dati e la sua vista", () => {
  assert.equal(page, bobPage);
  assert.equal(page.id, "bob");
  assert.equal(page.refreshMs, REFRESH_MS);
  assert.equal(REFRESH_MS, 30_000);
  assert.equal(title, "IBM Bob");
  assert.equal(manifest.page.title, "IBM Bob");
  assert.equal(manifest.menu.group, "dati");
  assert.match(html, /^<section class="page-view hidden" id="view-bob" aria-labelledby="bob-title">/);
  assert.match(html, /data-ico="bob"/);
  assert.doesNotMatch(html, /bob-off|LENS_BOB\b/, "no «off» card: the page exists only while the module is on");
  assert.doesNotMatch(html, /\sstyle=/);
  // every id the page looks for is in its markup
  const src = read("bob-page.js");
  const wanted = [...new Set([...src.matchAll(/\$\("([a-z][\w-]*)"\)/g)].map((m) => m[1]))];
  assert.ok(wanted.length >= 10);
  assert.deepEqual(wanted.filter((id) => !html.includes(`id="${id}"`)), []);
});

test("#bob: il periodo nel posto periodo con i nomi interi in aria-label e title, lo stato nel posto stato", () => {
  const bar = html.slice(0, html.indexOf("</header>"));
  const order = ["s-ident", "s-period", "s-status", "s-action"].map((c) => bar.indexOf(`class="slot ${c}"`));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), String(order));
  assert.ok(bar.indexOf('class="spacer"') > order[1] && bar.indexOf('class="spacer"') < order[2]);
  assert.equal(bar.lastIndexOf('class="slot '), order[3]);
  assert.ok(bar.indexOf('id="bob-live"') > order[2] && bar.indexOf('id="bob-live"') < order[3]);
  const period = bar.slice(order[1], bar.indexOf('class="spacer"'));
  assert.match(period, /id="bob-range"/);
  const LONG = { 604800000: "7 giorni", 2592000000: "30 giorni" };
  const buttons = [...period.matchAll(/<button\b[^>]*role="radio"[^>]*>([^<]*)<\/button>/g)];
  assert.deepEqual(buttons.map((b) => Number(b[0].match(/data-v="(-?\d+)"/)[1])), RANGES);
  for (const b of buttons) {
    const v = b[0].match(/data-v="(-?\d+)"/)[1];
    if (!(v in LONG)) {
      assert.equal(b[1], "Tutto", `${v} resta una parola`);
      continue;
    }
    assert.equal(b[1], `${LONG[v].split(" ")[0]} g`);
    assert.ok(b[0].includes(`aria-label="${LONG[v]}"`) && b[0].includes(`title="${LONG[v]}"`), v);
    assert.match(b[0], /data-i18n-aria-label/);
    assert.match(b[0], /data-i18n-title/);
  }
});

test("style.css: ogni regola è del modulo (una sua classe o un suo id nel selettore), il periodo come quelli del core", () => {
  const core = cssClasses(coreCss);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const own = (sel) => [...sel.matchAll(/#([\w-]+)/g)].some((m) => ids.has(m[1])) || [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].some((m) => !core.has(m[1]));
  assert.deepEqual(selectorsOf(css).filter((sel) => !own(sel)), [], "regole che cambierebbero le pagine del core");
  assert.match(css, /#bob-range \{ gap: 0; \}/);
  assert.match(css, /#bob-range button \{ min-width: 32px; padding: 0 7px; \}/);
  // the bars of the tables are the module's own (they were the core's .sys-bar*)
  for (const c of ["bob-bar", "bob-bar-cell", "bob-bar-wrap", "bob-bar-n", "bob-probes", "bob-probe-out", "bob-panel-head"]) assert.ok(cssClasses(css).has(c), c);
});

test("le classi del core che pagina e pannello usano sono solo quelle condivise: nel core niente CSS che serve solo a IBM Bob", () => {
  const core = cssClasses(coreCss);
  const here = classesUsed(sources(new URL("../public/", import.meta.url)));
  assert.ok(here.has("bob-tiles") && here.has("bob-bar") && here.has("chipx"), "le classi della pagina si leggono");
  assert.deepEqual([...here].filter((c) => core.has(c) && !SHARED.includes(c)).sort(), [], "classi stilizzate nel core da spostare nel modulo (o, se il core le usa, da aggiungere a SHARED)");
  const coreUsed = classesUsed(sources(CORE_PUBLIC));
  assert.deepEqual(SHARED.filter((c) => !coreUsed.has(c)), [], "voci di SHARED che nessuna pagina del core usa");
  assert.deepEqual(SHARED.filter((c) => !core.has(c)), [], "voci di SHARED che il core non stilizza più");
});

test("il core non ha più regole di IBM Bob: né i suoi id né le sue classi, né le barre .sys-bar* in public/style.css", () => {
  const coreSelectors = selectorsOf(coreCss);
  assert.deepEqual(coreSelectors.filter((sel) => /#bob-|\.bob-|\.sys-bar/.test(sel)), []);
  // the source selector of the bar is the core's, with a class of its own
  assert.match(coreCss, /\.source-seg \{ flex: none; \}/);
  // td.sec stays: the core's session detail uses it
  assert.match(coreCss, /td\.sec \{/);
});

test("periodo: solo 7 giorni, 30 giorni o tutto; la query parte da 0 per «Tutto»", () => {
  assert.equal(readRange(604_800_000), 604_800_000);
  assert.equal(readRange(0), 0);
  assert.equal(readRange(123), DEFAULT_RANGE);
  assert.equal(readRange(null), DEFAULT_RANGE);
  assert.equal(rangeQuery(0, 1000), "from=0&to=1001");
  assert.equal(rangeQuery(604_800_000, 700_000_000), "from=95200000&to=700000001");
});

test("mese: tono e frase con e senza piano", () => {
  assert.equal(monthTone({ limit: null }), "");
  assert.equal(monthTone({ limit: 100, ratio: 0.2, projectedRatio: 0.6 }), "good");
  assert.equal(monthTone({ limit: 100, ratio: 0.5, projectedRatio: 1.2 }), "warning");
  assert.equal(monthTone({ limit: 100, ratio: 1.1, projectedRatio: 2 }), "critical");
  assert.match(monthLine({ coins: 42, projected: 98, limit: 180, ratio: 42 / 180 }, "it-IT"), /^42 di 180 Bobcoin questo mese · 23% · a questo ritmo 98 a fine mese$/);
  assert.match(monthLine({ coins: 1.5, projected: 3, limit: null }, "it-IT"), /^1,5 Bobcoin questo mese/);
});

test("stato della lettura: nessuno stato ancora, collegato, database assente, formato cambiato, errore", () => {
  assert.deepEqual(bobState(undefined), ["none", "–"]);
  assert.deepEqual(bobState({ enabled: true, state: "connected" }), ["good", "collegato"]);
  assert.deepEqual(bobState({ enabled: true, state: "missing" }), ["warn", "database non trovato"]);
  assert.deepEqual(bobState({ enabled: true, state: "drift" }), ["bad", "formato cambiato"]);
  assert.deepEqual(bobState({ enabled: true, state: "error" }), ["bad", "errore di lettura"]);
  assert.deepEqual(bobState({ enabled: true, state: "starting" }), ["warn", "connessione…"]);
});

test("tessere: sei, con Bobcoin, token, task, chiamate, tool e in corso", () => {
  const page = { totals: { coins: 2.5, cost: 1.25, tokens: { total: 1000, input: 700, output: 300 }, tasks: 3, subagents: 1, requests: 9, tools: { calls: 12, errors: 0 }, running: 1 } };
  const fmt = { money: (c) => `$${c}`, compact: String, full: String };
  const rows = tiles(page, fmt, "it-IT");
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], ["Bobcoin", "2,5", "$1.25"]);
  assert.equal(rows[2][2], "+ 1 subagente");
});
