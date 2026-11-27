import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canApply } from "/module-kit.js";
import manifest from "../module.js";
import { page, title } from "../public/page.js";
import { COMPACT_ROWS, DEFAULT_RANGE, canApplyProjects, MONTH, RANGES, REFRESH_MS, compactRows, folderLabels, needsHistory, rangeQuery, readRange, vibePage, workingText } from "../public/vibe-page.js";

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const html = read("page.html");
const css = read("style.css");

// The core's stylesheet and page code, read as text only: what the page may take from the core's CSS
const CORE_PUBLIC = new URL("../../../public/", import.meta.url);
const coreCss = fs.readFileSync(new URL("style.css", CORE_PUBLIC), "utf8");
/** The pages' code of a public/ folder (.js and .html, not the catalogs): name → text. */
const sources = (dir) => fs.readdirSync(dir).filter((f) => /\.(js|html)$/.test(f) && !/^lang-/.test(f)).map((f) => fs.readFileSync(new URL(f, dir), "utf8"));
/** The selectors of a stylesheet, one by one (a comma inside :is( … ) does not separate them), at-rules left out. */
const selectorsOf = (sheet) =>
  [...sheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map((m) => m[1].trim())
    .filter((s) => !s.startsWith("@"))
    .flatMap((list) => list.split(/,(?![^(]*\))/).map((x) => x.trim()));
/** Every class a stylesheet's selectors name. */
const cssClasses = (sheet) => new Set(selectorsOf(sheet).flatMap((sel) => [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((m) => m[1])));
/**
 * The classes code puts on elements or looks for: class="…", class: "…" (its literals, ${…} left out), classList
 * calls and the .names in querySelector/closest/matches. Classes built at run time (slotClass, a lookup) are not seen.
 */
function classesUsed(texts) {
  const out = new Set();
  const words = (s) => s.split(/\s+/).filter((w) => /^[a-z][a-z0-9-]*$/.test(w));
  const literals = (s) => [...s.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, " "));
  for (const s of texts) {
    for (const m of s.matchAll(/\bclass="([^"]*)"/g)) for (const w of words(m[1])) out.add(w);
    for (const m of s.matchAll(/\bclass:\s*(`[^`]*`|[^,}\n]+)/g)) for (const w of literals(m[1]).flatMap(words)) out.add(w);
    for (const m of s.matchAll(/classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g)) for (const w of literals(m[1]).flatMap(words)) out.add(w);
    for (const m of s.matchAll(/(?:querySelector(?:All)?|closest|matches)\(([^)]*)\)/g)) for (const l of literals(m[1])) for (const c of l.matchAll(/\.([a-z][a-z0-9-]*)/g)) out.add(c[1]);
  }
  return out;
}
// The core classes this page uses: building blocks of the core pages (cards, tables, top bar, slots). Each one is also
// used by the core's own pages, so a rule only Vibe Coding needs cannot hide in public/style.css behind an entry here.
const SHARED = [
  "card", "card-head", "ctx", "dot", "dragging", "ghost", "hidden", "key", "muted", "n", "num", "over",
  "pbar", "s-action", "s-ident", "s-period", "seg", "slot", "small", "sp", "spacer", "sw", "t", "table-wrap", "tb-ico", "tb-row", "tb-title", "topbar", "v",
  "view-body",
];
// The pieces the core styles for the modules' pages and no core page uses: the summary strip with its tiles and mix
// bar, the move menu of a card and the destructive button, shared by Vibe Coding and Skill (test/module-boundaries.test.js
// keeps each of them used by at least two modules, so one module's rule cannot hide in the core behind this list).
const KIT = ["danger", "fmenu", "mix", "vhero", "vk", "vk-delta", "vk-l", "vk-ring", "vk-s", "vk-v"];

test("workingText: minuti sotto l'ora, poi ore con un decimale e intere da 100", () => {
  assert.equal(workingText(null), "–");
  assert.equal(workingText(0), "0 min");
  assert.equal(workingText(35 * 60_000), "35 min");
  assert.equal(workingText(59.6 * 60_000), "1 h", "si confronta ciò che si mostra: 60 min sono 1 h");
  assert.equal(workingText(5_400_000), "1,5 h");
  assert.equal(workingText(7_200_000), "2 h");
  assert.equal(workingText(393_840_000), "109 h");
});

test("rangeQuery: «da sempre» parte da 0, non dall'istante corrente", () => {
  const now = 1_760_000_000_000;
  assert.equal(rangeQuery(2_592_000_000, now), `from=${now - 2_592_000_000}&to=${now}`);
  assert.equal(rangeQuery(0, now), `from=0&to=${now}`);
});

test("readRange: solo i periodi offerti, altrimenti 30 giorni", () => {
  assert.deepEqual(RANGES, [604_800_000, 2_592_000_000, MONTH, 0]);
  assert.equal(readRange(MONTH), MONTH);
  assert.equal(DEFAULT_RANGE, 2_592_000_000);
  assert.equal(readRange(0), 0);
  assert.equal(readRange(604_800_000), 604_800_000);
  for (const bad of [null, undefined, "30", 12345, NaN]) assert.equal(readRange(bad), DEFAULT_RANGE);
});

test("#vibecoding: la pagina del modulo, la sua voce nel gruppo Dati e la sua vista", () => {
  assert.equal(page, vibePage);
  assert.equal(page.id, "vibecoding");
  assert.equal(title, "Vibe Coding");
  assert.equal(manifest.id, "vibecoding");
  assert.equal(manifest.page.title, "Vibe Coding");
  assert.equal(manifest.menu.group, "dati");
  assert.match(manifest.menu.icon, /^<circle /);
  assert.match(html, /^<section class="page-view hidden" id="view-vibecoding" aria-labelledby="vibe-title">/);
  assert.match(html, /data-ico="vibecoding"/);
  assert.match(html, /<div class="view-body" id="vibe-body"><\/div>/);
  assert.doesNotMatch(html, /\sstyle=/);
});

test("#vibecoding: il periodo sta nel posto periodo, con i nomi interi in aria-label e title", () => {
  const bar = html.slice(0, html.indexOf("</header>"));
  // the core's top bar: identity first, the period before the spacer, the fixed action last
  assert.ok(bar.indexOf('class="slot s-ident"') >= 0 && bar.indexOf('class="slot s-ident"') < bar.indexOf('class="slot s-period"'));
  const period = bar.slice(bar.indexOf('class="slot s-period"'), bar.indexOf('class="spacer"'));
  assert.match(period, /id="vibe-range"/);
  assert.equal(bar.lastIndexOf('class="slot '), bar.indexOf('class="slot s-action"'));
  const LONG = { 604800000: "7 giorni", 2592000000: "30 giorni" };
  const buttons = [...period.matchAll(/<button\b[^>]*role="radio"[^>]*>([^<]*)<\/button>/g)];
  assert.deepEqual(buttons.map((b) => Number(b[0].match(/data-v="(-?\d+)"/)[1])), RANGES);
  for (const b of buttons) {
    const v = b[0].match(/data-v="(-?\d+)"/)[1];
    if (!(v in LONG)) {
      assert.match(b[1], /^(Mese|Tutto)$/, `${v} resta una parola`);
      continue;
    }
    assert.equal(b[1], `${LONG[v].split(" ")[0]} g`);
    assert.ok(b[0].includes(`aria-label="${LONG[v]}"`) && b[0].includes(`title="${LONG[v]}"`), v);
    assert.match(b[0], /data-i18n-aria-label/);
    assert.match(b[0], /data-i18n-title/);
  }
});

test("style.css: ogni regola è della pagina (una sua classe o un suo id nel selettore), e il periodo come quelli del core", () => {
  const core = cssClasses(coreCss);
  const selectors = selectorsOf(css);
  assert.ok(selectors.length > 60);
  // the module's own names: ids #vibe-*, and classes the core's sheet does not know
  const own = (sel) => /#vibe-/.test(sel) || [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].some((m) => !core.has(m[1]));
  assert.deepEqual(selectors.filter((sel) => !own(sel)), [], "regole che cambierebbero le pagine del core");
  assert.match(css, /#vibe-range \{ gap: 0; \}/);
  assert.match(css, /#vibe-range button \{ min-width: 32px; padding: 0 7px; \}/);
});

test("le classi del core che la pagina usa sono solo quelle condivise: nel core niente CSS che serve solo a Vibe Coding", () => {
  const core = cssClasses(coreCss);
  const here = classesUsed(sources(new URL("../public/", import.meta.url)));
  assert.ok(here.has("vibe-board") && here.has("vk") && here.has("dhead"), "le classi della pagina si leggono");
  assert.deepEqual([...here].filter((c) => core.has(c) && !SHARED.includes(c) && !KIT.includes(c)).sort(), [], "classi stilizzate nel core da spostare nel modulo (o, se il core le usa, da aggiungere a SHARED)");
  const coreUsed = classesUsed(sources(CORE_PUBLIC));
  assert.deepEqual(SHARED.filter((c) => !coreUsed.has(c)), [], "voci di SHARED che nessuna pagina del core usa");
  assert.deepEqual([...SHARED, ...KIT].filter((c) => !core.has(c)), [], "voci di SHARED o KIT che il core non stilizza più");
  assert.deepEqual(KIT.filter((c) => !here.has(c)), [], "voci di KIT che la pagina non usa");
});

test("folderLabels: l'ultimo segmento, col genitore se due cartelle finiscono uguale, il percorso intero in extremis", () => {
  const l = folderLabels(["/Users/x/work/api", "/Users/x/work/web", "?"]);
  assert.equal(l.get("/Users/x/work/api"), "api");
  assert.equal(l.get("?"), "?");
  const same = folderLabels(["/a/app", "/b/app", "/c/solo"]);
  assert.equal(same.get("/a/app"), "a/app");
  assert.equal(same.get("/b/app"), "b/app");
  assert.equal(same.get("/c/solo"), "solo");
  const deep = folderLabels(["/x/a/app", "/y/a/app"]);
  assert.equal(deep.get("/x/a/app"), "/x/a/app");
  assert.equal(deep.get("/y/a/app"), "/y/a/app");
  assert.equal(folderLabels(["/"]).get("/"), "/");
});

test("readRange e rangeQuery: «Mese» parte dalla mezzanotte del 1°", () => {
  const now = new Date(2026, 9, 23, 15).getTime();
  assert.equal(rangeQuery(MONTH, now), `from=${new Date(2026, 9, 1).getTime()}&to=${now}`);
});

test("compactRows: 5 righe, tutte quando aperta", () => {
  const rows = Array.from({ length: 12 }, (_, i) => i);
  assert.equal(COMPACT_ROWS, 5);
  assert.deepEqual(compactRows(rows, false), [0, 1, 2, 3, 4]);
  assert.equal(compactRows(rows, true).length, 12);
  assert.equal(compactRows(rows.slice(0, 3), false).length, 3);
});

test("canApplyProjects: solo senza salvataggi in corso e con seq invariato", () => {
  assert.equal(canApplyProjects, canApply, "quello del kit del core");
  assert.equal(canApplyProjects({ pendingSaves: 0, seqAtStart: 3, seqNow: 3 }), true);
  assert.equal(canApplyProjects({ pendingSaves: 1, seqAtStart: 3, seqNow: 3 }), false);
  // refresh starts (seq 3), a save starts and ends (seq 5), the refresh returns: stale
  assert.equal(canApplyProjects({ pendingSaves: 0, seqAtStart: 3, seqNow: 5 }), false);
});

test("needsHistory: la prima volta, al cambio di giorno e dopo un salvataggio dei progetti; non nei refresh dello stesso giorno", () => {
  const morning = new Date(2026, 10, 20, 9).getTime();
  const evening = new Date(2026, 10, 20, 23, 59).getTime();
  const tomorrow = new Date(2026, 10, 21, 0, 1).getTime();
  assert.equal(needsHistory(null, morning, "v1"), true, "prima volta");
  const prev = { day: "2026-11-20", docVersion: "v1" };
  assert.equal(needsHistory(prev, morning + REFRESH_MS, "v1"), false, "refresh dello stesso giorno");
  assert.equal(needsHistory(prev, evening, "v1"), false);
  assert.equal(needsHistory(prev, tomorrow, "v1"), true, "cambio di giorno");
  assert.equal(needsHistory(prev, evening, "v2"), true, "dopo un salvataggio");
});

test("needsHistory: di nuovo quando il listino dei dati non è quello con cui è stato letto lo storico", () => {
  const now = new Date(2026, 9, 23, 9).getTime();
  const prev = { day: "2026-10-23", docVersion: "v1", pricing: { empty: false, rev: "a" } };
  assert.equal(needsHistory(prev, now, "v1", { empty: false, rev: "a" }), false, "same prices");
  assert.equal(needsHistory(prev, now, "v1", { empty: true, rev: "a" }), true, "listino svuotato");
  assert.equal(needsHistory(prev, now, "v1", { empty: false, rev: "b" }), true, "a price edited: the lens restarted");
  assert.equal(needsHistory({ ...prev, pricing: null }, now, "v1", { empty: false, rev: "a" }), true, "a history without pricing");
  assert.equal(needsHistory(prev, now, "v1"), false, "without the data's pricing only day and document count");
});
