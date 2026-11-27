// The Skill module's page as the dashboard gets it: the manifest's menu entry, page.js for the director, page.html (the
// section and the presets dialog, moved from the core's index.html) and style.css (the Skill rules moved from the core's
// stylesheet, which keeps only what its own pages use and the pieces it offers the modules). Plan E, Task 6c.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canApply } from "/module-kit.js";
import manifest from "../module.js";
import { page, title } from "../public/page.js";
import { canApplyPresets, skillsPage } from "../public/skills-page.js";

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const html = read("page.html");
const css = read("style.css");

// The core's stylesheet and page code, read as text only: what the page may take from the core's CSS
const CORE_PUBLIC = new URL("../../../public/", import.meta.url);
const coreCss = fs.readFileSync(new URL("style.css", CORE_PUBLIC), "utf8");
/** The pages' code of a public/ folder (.js and .html, not the catalogs). */
const sources = (dir) => fs.readdirSync(dir).filter((f) => /\.(js|html)$/.test(f) && !/^lang-/.test(f)).map((f) => fs.readFileSync(new URL(f, dir), "utf8"));
/** The selectors of a stylesheet, one by one (a comma inside :is( … ) does not separate them), at-rules and keyframe steps left out. */
const selectorsOf = (sheet) =>
  [...sheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map((m) => m[1].trim())
    .filter((s) => !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s))
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
// The core classes this page uses: building blocks of the core pages (cards, top bar, slots, pills, meters) and the
// form of the dashboard's presets dialog (presets-*, the core's presets-dialog.js), which the skill presets dialog
// reuses. Each one is also used by the core's own pages, so a rule only Skill needs cannot hide in public/style.css.
const SHARED = [
  "bad", "caption", "card", "card-head", "ctx", "dot", "dragging", "ghost", "hidden", "meter", "meter-fill", "muted", "n", "note", "num", "on", "over",
  "pbar", "pill", "presets-acts", "presets-dialog", "presets-error", "presets-field", "presets-head", "presets-input", "presets-list", "presets-name",
  "presets-new", "presets-row", "presets-who", "primary", "s-action", "s-ident", "s-period", "search", "seg", "slot", "spacer", "spark", "state", "sw",
  "t", "tb-ico", "tb-row", "tb-title", "thin", "topbar", "up-drop", "view-body", "wset-name",
];
// The pieces the core styles for the modules' pages and no core page uses: the summary strip with its tiles and mix
// bar, the move menu of a card and the destructive button, shared with Vibe Coding (test/module-boundaries.test.js keeps
// each of them used by at least two modules).
const KIT = ["danger", "fmenu", "mix", "vhero", "vk", "vk-delta", "vk-l", "vk-ring", "vk-s", "vk-v"];
// A state modifier the core puts on its own elements under its own compound rules (.status.warn, .chipx.warn, set at
// run time): the page's rules for it are scoped to its own classes (.skp.warn, .drawer .pill.warn).
const MODIFIERS = ["warn"];

test("manifesto: voce nel gruppo Lens, prima di Sistema e Security, pagina «Skill»", () => {
  assert.equal(manifest.id, "skill");
  assert.equal(manifest.menu.group, "lens");
  assert.equal(manifest.menu.order, 10);
  assert.equal(manifest.page.title, "Skill");
  assert.match(manifest.menu.icon, /^<path d="M5 4\.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"\/>/);
});

test("page.js: la pagina per il regista della dashboard, col titolo; canApplyPresets è canApply del kit", () => {
  assert.equal(page, skillsPage);
  assert.equal(page.id, "skill");
  assert.equal(typeof page.setup, "function");
  assert.equal(typeof page.show, "function");
  assert.equal(title, "Skill");
  assert.equal(canApplyPresets, canApply);
});

test("page.html: la sezione #skill con la sua barra, il pannello di import, la bacheca, il cassetto e il dialogo dei preset", () => {
  assert.match(html, /^<section class="page-view hidden" id="view-skill" aria-labelledby="skill-title">/);
  assert.match(html, /<dialog class="presets-dialog skill-dialog" id="skill-presets-dialog" aria-labelledby="skill-presets-title"><\/dialog>\n$/);
  for (const id of ["skill-reason", "skill-drop", "skill-file", "skill-choose", "skill-choose-dir", "skill-dir", "skill-results", "skill-mode", "skill-msg", "skill-empty", "skill-hero", "skill-board", "skill-lib-msg", "skill-drawer", "skill-toast", "skill-veil", "skill-new-preset", "skill-import-open", "skill-range"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // the old library table and preset cards are the board now
  for (const id of ["skill-table", "skill-search", "skill-sort", "skill-unused", "skill-presets-manage"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`), id);
  assert.deepEqual([...html.matchAll(/<input type="radio" name="skill-mode" value="(\w+)"/g)].map((m) => m[1]), ["version", "overwrite", "new"]);
});

test("page.html: il periodo nel posto periodo prima dello spazio, «+ Nuovo preset» e «Importa…» nel posto azioni", () => {
  const bar = html.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
  // identity first, the fixed action last, as every bar of the core
  assert.ok(bar.includes('class="slot s-ident"') && bar.includes('class="slot s-action"'));
  assert.equal(bar.lastIndexOf('class="slot '), bar.indexOf('class="slot s-action"'), "s-action è l'ultimo posto");
  assert.ok(bar.indexOf('id="skill-range"') > bar.indexOf('class="slot s-period"') && bar.indexOf('id="skill-range"') < bar.indexOf('class="spacer"'));
  const actions = bar.slice(bar.indexOf('class="slot s-actions"'), bar.indexOf('class="slot s-action"'));
  for (const id of ["skill-new-preset", "skill-import-open"]) assert.match(actions, new RegExp(`id="${id}"`), id);
  assert.ok(bar.indexOf('data-ico="skill"') > bar.indexOf('class="slot s-ident"') && bar.indexOf('data-ico="skill"') < bar.indexOf('class="slot s-period"'), "l'icona della voce nel posto identità");
});

test("page.html: periodi corti con il nome intero in aria-label e title", () => {
  const LONG = { 7: "7 giorni", 30: "30 giorni", 90: "90 giorni" };
  const seg = html.slice(html.indexOf('id="skill-range"'), html.indexOf("</div>", html.indexOf('id="skill-range"')));
  const buttons = [...seg.matchAll(/<button\b[^>]*role="radio"[^>]*>([^<]*)<\/button>/g)];
  assert.equal(buttons.length, 4);
  for (const b of buttons) {
    const v = b[0].match(/data-v="(-?\d+)"/)[1];
    if (!(v in LONG)) {
      assert.match(b[1], /^Tutto$/, `${v} resta una parola`);
      continue;
    }
    assert.equal(b[1], `${v} g`);
    assert.ok(b[0].includes(`aria-label="${LONG[v]}"`) && b[0].includes(`title="${LONG[v]}"`), v);
    assert.match(b[0], /data-i18n-aria-label/);
    assert.match(b[0], /data-i18n-title/);
  }
});

test("style.css: ogni regola è della pagina (una sua classe o un suo id nel selettore), e il periodo come quelli del core", () => {
  const core = cssClasses(coreCss);
  const selectors = selectorsOf(css);
  assert.ok(selectors.length > 150);
  // the module's own names: ids #skill-*, and classes the core's sheet does not know
  const own = (sel) => /#skill-/.test(sel) || [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].some((m) => !core.has(m[1]));
  assert.deepEqual(selectors.filter((sel) => !own(sel)), [], "regole che cambierebbero le pagine del core");
  assert.match(css, /#skill-range \{ gap: 0; \}/);
  assert.match(css, /#skill-range button \{ min-width: 32px; padding: 0 7px; \}/);
  // nothing of Skill is left in the core's sheet
  assert.doesNotMatch(coreCss, /#skill-|\.skill-|\.sboard|\.scol|\.drawer|\.sk\b/);
});

test("le classi del core che la pagina usa sono solo quelle condivise: nel core niente CSS che serve solo a Skill", () => {
  const core = cssClasses(coreCss);
  const here = classesUsed(sources(new URL("../public/", import.meta.url)));
  assert.ok(here.has("sboard") && here.has("drawer") && here.has("skill-pick"), "le classi della pagina si leggono");
  const allowed = [...SHARED, ...KIT, ...MODIFIERS];
  assert.deepEqual([...here].filter((c) => core.has(c) && !allowed.includes(c)).sort(), [], "classi stilizzate nel core da spostare nel modulo (o, se il core le usa, da aggiungere a SHARED)");
  const coreUsed = classesUsed(sources(CORE_PUBLIC));
  assert.deepEqual(SHARED.filter((c) => !coreUsed.has(c)), [], "voci di SHARED che nessuna pagina del core usa");
  assert.deepEqual(allowed.filter((c) => !core.has(c)), [], "voci che il core non stilizza più");
  assert.deepEqual(allowed.filter((c) => !here.has(c)), [], "voci che la pagina non usa");
});
