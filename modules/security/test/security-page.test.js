// The browser side of Security: the page as the director gets it, its markup and stylesheet (only rules of its
// own, the core's classes only those its pages share), and the pure model of security-model.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import manifest from "../module.js";
import { page, title } from "../public/page.js";
import { PAGE_SIZE, REFRESH_MS, securityPage } from "../public/security-page.js";
import {
  DEFAULT_RANGE,
  RANGES,
  chipCap,
  checksPassed,
  compact,
  delta,
  detailKey,
  healthRows,
  isBlock,
  kpiText,
  outcomeKind,
  outcomeLabel,
  pageSpan,
  policyGroups,
  postureOf,
  rangeQuery,
  rateSeries,
  readRange,
  splitCap,
  verdictKind,
  verdictLine,
  verdictText,
} from "../public/security-model.js";

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const html = read("page.html");
const css = read("style.css");

// The core's stylesheet and page code, read as text only: what the page may take from the core's CSS
const CORE_PUBLIC = new URL("../../../public/", import.meta.url);
const coreCss = fs.readFileSync(new URL("style.css", CORE_PUBLIC), "utf8");
/** The pages' code of a public/ folder (.js and .html, not the catalogs): name → text. */
const sources = (dir) => fs.readdirSync(dir).filter((f) => /\.(js|html)$/.test(f) && !/^lang-/.test(f)).map((f) => fs.readFileSync(new URL(f, dir), "utf8"));
/** The selectors of a stylesheet, one by one (a comma inside :is( … ) does not separate them), at-rules opened. */
const selectorsOf = (sheet) =>
  [...sheet.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[^{]+\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g, "$1").matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map((m) => m[1].trim())
    .flatMap((list) => list.split(/,(?![^(]*\))/).map((x) => x.trim()));
/** Every class a stylesheet's selectors name. */
const cssClasses = (sheet) => new Set(selectorsOf(sheet).flatMap((sel) => [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((m) => m[1])));
/**
 * The classes code puts on elements or looks for: class="…", class: "…" (its literals, ${…} left out), classList
 * calls and the .names in querySelector/closest/matches. Classes built at run time (o-${kind}, tone-${n}) are not seen.
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
// The core classes this page uses: building blocks of the core pages (cards, tables, top bar, slots, chips, states,
// the category bars of the tables) and SVG parts named like the core's charts'. Each one is also used by the core's
// own pages, so a rule only Security needs cannot hide in public/style.css behind an entry here. The «sec-» prefix
// is not the test: the sections of Impostazioni are #sec-generale, #sec-moduli…, and stay in the core.
const SHARED = ["bad", "callout", "caption", "card", "card-head", "chipx", "code", "ctx", "detail", "detail-body", "facts", "ghost", "grid", "hidden", "hit", "led", "legend", "mono", "muted", "s-action", "s-ident", "s-period", "s-status", "sd-l", "sd-more", "sd-r", "sd-row", "sd-track", "sec", "seg", "slot", "small", "spacer", "sw", "table-wrap", "tb-ico", "tb-row", "tb-title", "topbar", "view-body", "wide", "wrap"];

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

const health = (over = {}) => ({
  audit: { state: "ok", bytes: 2048, modified: NOW - 1000, parseErrors: 0, truncated: false },
  policy: { state: "ok", auditLogMatches: true },
  plugin: { state: "ok" },
  lastEvent: { state: "ok", at: NOW - 60_000 },
  cross: { state: "ok", lensCalls: 4, auditEvents: 4 },
  verdict: "good",
  ...over,
});

test("#security: la pagina del modulo, la sua voce nel gruppo Lens e la sua vista", () => {
  assert.equal(page, securityPage);
  assert.equal(page.id, "security");
  assert.equal(page.refreshMs, REFRESH_MS);
  assert.equal(REFRESH_MS, 10_000);
  assert.equal(PAGE_SIZE, 50);
  assert.equal(title, "Security");
  assert.equal(manifest.page.title, "Security");
  assert.equal(manifest.menu.group, "lens");
  assert.match(html, /^<section class="page-view hidden" id="view-security" aria-labelledby="sec-title">/);
  assert.match(html, /data-ico="security"/);
  for (const id of ["sec-range", "sec-live", "sec-guards", "sec-outcome", "sec-restricted", "sec-health", "sec-policy"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /\sstyle=/);
  // every id the page looks for is in its markup
  const src = read("security-page.js");
  const wanted = [...new Set([...src.matchAll(/\$\("([a-z][\w-]*)"\)/g)].map((m) => m[1]))];
  assert.ok(wanted.length > 20);
  assert.deepEqual(wanted.filter((id) => !html.includes(`id="${id}"`)), []);
});

test("#security: il periodo nel posto periodo con i nomi interi in aria-label e title, lo stato nel posto stato", () => {
  const bar = html.slice(0, html.indexOf("</header>"));
  const slotOf = (cls) => bar.slice(bar.indexOf(`class="slot ${cls}"`), bar.indexOf("</div>", bar.indexOf(`class="slot ${cls}"`)) + 6);
  // the core's top bar: identity, period, spacer, status, the fixed action last
  const order = ["s-ident", "s-period", "s-status", "s-action"].map((c) => bar.indexOf(`class="slot ${c}"`));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), String(order));
  assert.ok(bar.indexOf('class="spacer"') > order[1] && bar.indexOf('class="spacer"') < order[2]);
  assert.equal(bar.lastIndexOf('class="slot '), order[3]);
  assert.match(slotOf("s-status"), /id="sec-live"/);
  const period = bar.slice(order[1], bar.indexOf('class="spacer"'));
  assert.match(period, /id="sec-range"/);
  const LONG = { 604800000: "7 giorni", 2592000000: "30 giorni" };
  const buttons = [...period.matchAll(/<button\b[^>]*role="radio"[^>]*>([^<]*)<\/button>/g)];
  assert.deepEqual(
    buttons.map((b) => Number(b[0].match(/data-v="(-?\d+)"/)[1])),
    RANGES,
  );
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

test("style.css: ogni regola è della pagina (una sua classe o un suo id nel selettore), e il periodo come quelli del core", () => {
  const core = cssClasses(coreCss);
  const selectors = selectorsOf(css);
  assert.ok(selectors.length > 150);
  // the module's own names: ids #sec-* of its markup, and classes the core's sheet does not know
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const own = (sel) => [...sel.matchAll(/#([\w-]+)/g)].some((m) => ids.has(m[1])) || [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].some((m) => !core.has(m[1]));
  assert.deepEqual(selectors.filter((sel) => !own(sel)), [], "regole che cambierebbero le pagine del core");
  assert.match(css, /#sec-range \{ gap: 0; \}/);
  assert.match(css, /#sec-range button \{ min-width: 32px; padding: 0 7px; \}/);
});

test("le classi del core che la pagina usa sono solo quelle condivise: nel core niente CSS che serve solo a Security", () => {
  const core = cssClasses(coreCss);
  const here = classesUsed(sources(new URL("../public/", import.meta.url)));
  assert.ok(here.has("sec-guards") && here.has("sec-hero") && here.has("chipx"), "le classi della pagina si leggono");
  assert.deepEqual([...here].filter((c) => core.has(c) && !SHARED.includes(c)).sort(), [], "classi stilizzate nel core da spostare nel modulo (o, se il core le usa, da aggiungere a SHARED)");
  const coreUsed = classesUsed(sources(CORE_PUBLIC));
  assert.deepEqual(SHARED.filter((c) => !coreUsed.has(c)), [], "voci di SHARED che nessuna pagina del core usa");
  assert.deepEqual(SHARED.filter((c) => !core.has(c)), [], "voci di SHARED che il core non stilizza più");
  // the classes the page builds at run time are styled here, not in the core
  for (const c of ["tone-0", "tone-5", "o-allowed", "o-other", "t-calls", "t-rate", "sec-blocked", "v-good", "hm-4"]) {
    assert.ok(css.includes(`.${c}`), c);
    assert.ok(!core.has(c), `${c} nel core`);
  }
});

test("il core non ha più regole di Security: né i suoi id né le sue classi in public/style.css (le sezioni di Impostazioni restano)", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const coreSelectors = selectorsOf(coreCss);
  assert.deepEqual(coreSelectors.filter((sel) => ids.some((id) => new RegExp(`#${id}(?![\\w-])`).test(sel))), []);
  const mine = cssClasses(css);
  const shared = cssClasses(coreCss);
  assert.deepEqual([...mine].filter((c) => /^(sec|tone|o|t|hm)-/.test(c) && shared.has(c)), []);
  // the Impostazioni sections share the prefix and are the core's
  assert.match(fs.readFileSync(new URL("index.html", CORE_PUBLIC), "utf8"), /id="sec-generale"/);
});

test("verdictKind e verdictText: bad con policy invalid, warn con gap o stale, good altrimenti; il testo peggiore prima", () => {
  assert.equal(verdictKind(health()), "good");
  assert.equal(verdictText(health(), NOW), "Guard attivo");
  const invalid = health({ policy: { state: "invalid", auditLogMatches: null }, verdict: "bad" });
  assert.equal(verdictKind(invalid), "bad");
  assert.equal(verdictText(invalid, NOW), "Policy non valida");
  const gap = health({ cross: { state: "gap", lensCalls: 12, auditEvents: 9 }, verdict: "warn" });
  assert.equal(verdictKind(gap), "warn");
  assert.equal(verdictText(gap, NOW), "Lens ha visto 12 chiamate, l'audit 9");
  const stale = health({ lastEvent: { state: "stale", at: NOW - 9 * DAY }, verdict: "warn" });
  assert.equal(verdictKind(stale), "warn");
  assert.equal(verdictText(stale, NOW), "Nessun evento da 9 g");
  // several problems: the worst first, joined
  const many = health({ policy: { state: "invalid", auditLogMatches: null }, audit: { state: "ok", bytes: 1, modified: 1, parseErrors: 3, truncated: false }, lastEvent: { state: "stale", at: NOW - 8 * DAY }, verdict: "bad" });
  assert.equal(verdictText(many, NOW), "Policy non valida · 3 righe illeggibili · Nessun evento da 8 g");
  assert.equal(verdictText(health({ audit: { state: "ok", bytes: 1, modified: 1, parseErrors: 1, truncated: false } }), NOW), "1 riga illeggibile");
  // without the server's verdict the fields decide
  const bare = health({ cross: { state: "gap", lensCalls: 2, auditEvents: 0 } });
  bare.verdict = undefined;
  assert.equal(verdictKind(bare), "warn");
  assert.equal(verdictKind(null), "warn");
  // an audit with nothing in it yet is not «attivo»
  const empty = health({ lastEvent: { state: "none", at: null }, audit: { state: "empty", bytes: 0, modified: null, parseErrors: 0, truncated: false } });
  assert.equal(verdictText(empty, NOW), "Nessun evento registrato");
});

test("healthRows: cinque righe nell'ordine, con gli stati veri anche da rete", () => {
  const rows = healthRows({ health: health(), restricted: false });
  assert.deepEqual(
    rows.map((r) => r.key),
    ["audit", "policy", "plugin", "lastEvent", "cross"],
  );
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["ok", "ok", "ok", "ok", "ok"],
  );
  assert.ok(rows.every((r) => r.label && r.text));
  // from the network the states are the real ones: nothing is replaced by «none»
  const net = healthRows({ health: health({ policy: { state: "invalid", auditLogMatches: null }, plugin: { state: "missing" } }), restricted: true });
  assert.equal(net.find((r) => r.key === "policy").kind, "err");
  assert.equal(net.find((r) => r.key === "plugin").kind, "none");
  assert.ok(!net.some((r) => /solo da questo computer/.test(r.text)));
  const warn = healthRows(
    {
      health: health({
        audit: { state: "ok", bytes: 10, modified: 1, parseErrors: 2, truncated: true },
        policy: { state: "ok", auditLogMatches: false },
        lastEvent: { state: "stale", at: NOW - 10 * DAY },
        cross: { state: "gap", lensCalls: 5, auditEvents: 1 },
      }),
    },
  );
  assert.deepEqual(
    warn.map((r) => r.kind),
    ["warn", "warn", "ok", "warn", "warn"],
  );
  const none = healthRows(
    {
      health: health({
        audit: { state: "empty", bytes: 0, modified: null, parseErrors: 0, truncated: false },
        lastEvent: { state: "none", at: null },
        cross: { state: "unknown", lensCalls: 0, auditEvents: 0 },
        policy: { state: "missing", auditLogMatches: null },
      }),
    },
  );
  assert.deepEqual(
    none.map((r) => r.kind),
    ["none", "none", "ok", "none", "none"],
  );
  assert.deepEqual(healthRows({}), []);
});

test("kpiText: tasso solo con rateShown, ultimo blocco da lastBlock", () => {
  const last = { at: NOW - 1000, tool: "context7_query-docs" };
  const d = { totals: { events: 8, blocked: 2, allowed: 6, other: 0, parseErrors: 0 }, rateShown: true, lastBlock: last };
  assert.deepEqual(kpiText(d), { calls: 8, blocked: 2, rate: "25%", lastBlock: last });
  const onlyBlocks = kpiText({ totals: { events: 3, blocked: 3, allowed: 0, other: 0 }, rateShown: false, lastBlock: null });
  assert.equal(onlyBlocks.rate, null);
  assert.equal(onlyBlocks.lastBlock, null);
  assert.equal(onlyBlocks.blocked, 3);
  // the last block does not come from the rows of the page
  const fromD = kpiText({ totals: { events: 1, blocked: 0, allowed: 1 }, rateShown: true, lastBlock: { at: 5, tool: "x" }, events: { rows: [] } });
  assert.deepEqual(fromD.lastBlock, { at: 5, tool: "x" });
  assert.deepEqual(kpiText({}), { calls: 0, blocked: 0, rate: null, lastBlock: null });
});

test("outcomeKind e outcomeLabel: i quattro esiti noti, testo com'è per gli altri", () => {
  assert.equal(outcomeKind("allowed"), "ok");
  assert.equal(outcomeKind("blocked"), "err");
  assert.equal(outcomeKind("approved-by-user"), "warn");
  assert.equal(outcomeKind("rejected-by-user"), "none");
  for (const other of ["strano", "?", null, undefined]) assert.equal(outcomeKind(other), "none");
  assert.equal(outcomeLabel("allowed"), "Consentito");
  assert.equal(outcomeLabel("blocked"), "Bloccato");
  assert.equal(outcomeLabel("approved-by-user"), "Approvato dall'utente");
  assert.equal(outcomeLabel("rejected-by-user"), "Rifiutato dall'utente");
  assert.equal(outcomeLabel("strano"), "strano");
  assert.equal(outcomeLabel(null), "–");
});

test("readRange e rangeQuery: come Vibe Coding", () => {
  assert.deepEqual(RANGES, [604_800_000, 2_592_000_000, 0]);
  assert.equal(DEFAULT_RANGE, 2_592_000_000);
  assert.equal(readRange(0), 0);
  assert.equal(readRange(604_800_000), 604_800_000);
  for (const bad of [null, undefined, "30", 12345, Number.NaN]) assert.equal(readRange(bad), DEFAULT_RANGE);
  assert.equal(rangeQuery(2_592_000_000, NOW), `from=${NOW - 2_592_000_000}&to=${NOW}`);
  assert.equal(rangeQuery(0, NOW), `from=0&to=${NOW}`);
});

test("splitCap: i primi n e quanti ne restano; pageSpan: «N–M di T»", () => {
  assert.equal(chipCap, 3);
  assert.deepEqual(splitCap(["a", "b", "c", "d", "e"], chipCap), { shown: ["a", "b", "c"], more: 2 });
  assert.deepEqual(splitCap(["a"], 3), { shown: ["a"], more: 0 });
  assert.deepEqual(splitCap(null, 3), { shown: [], more: 0 });
  assert.deepEqual(pageSpan(0, 50, 120), { from: 1, to: 50, total: 120, prev: false, next: true });
  assert.deepEqual(pageSpan(100, 50, 120), { from: 101, to: 120, total: 120, prev: true, next: false });
  assert.deepEqual(pageSpan(0, 50, 0), { from: 0, to: 0, total: 0, prev: false, next: false });
});

test("healthRows: il confronto con Lens dice entrambi i numeri e «come in Lens» solo se uguali", () => {
  const cross = (c) => healthRows({ health: health({ cross: c }) }).find((r) => r.key === "cross");
  const zero = cross({ state: "ok", lensCalls: 0, auditEvents: 60 });
  assert.equal(zero.kind, "ok");
  assert.equal(zero.text, "Lens 0 · audit 60");
  assert.equal(cross({ state: "ok", lensCalls: 4, auditEvents: 4 }).text, "4 chiamate, come in Lens");
  assert.equal(cross({ state: "ok", lensCalls: 1, auditEvents: 1 }).text, "1 chiamata, come in Lens");
  assert.equal(cross({ state: "gap", lensCalls: 12, auditEvents: 9 }).text, "Lens ha visto 12 chiamate, l'audit 9");
  assert.equal(cross({ state: "gap", lensCalls: 1, auditEvents: 0 }).text, "Lens ha visto 1 chiamata, l'audit 0");
  assert.equal(verdictText(health({ cross: { state: "gap", lensCalls: 1, auditEvents: 0 }, verdict: "warn" }), NOW), "Lens ha visto 1 chiamata, l'audit 0");
});

test("splitCap con il totale: «+N» conta anche le voci che il server non ha mandato", () => {
  assert.deepEqual(splitCap(["a", "b", "c", "d", "e", "f", "g"], 5, 80), { shown: ["a", "b", "c", "d", "e"], more: 75 });
  assert.deepEqual(splitCap(["a", "b"], 5, 2), { shown: ["a", "b"], more: 0 });
  assert.deepEqual(splitCap(["a", "b"], 5, undefined), { shown: ["a", "b"], more: 0 });
  assert.deepEqual(splitCap(["a", "b", "c"], 2, 1), { shown: ["a", "b"], more: 1 }, "un totale più piccolo delle voci non conta");
});

test("verdictLine: il guard scelto e il suo verdetto in parole, per il sottotitolo", () => {
  assert.equal(verdictLine({ label: "Context7 guard", health: health() }, NOW), "Context7 guard: Guard attivo");
  assert.equal(verdictLine({ label: "X", health: health({ policy: { state: "invalid" }, verdict: "bad" }) }, NOW), "X: Policy non valida");
  assert.equal(verdictLine(null, NOW), null);
});

test("detailKey: cambia solo quando cambia l'evento aperto o come si mostrano le sue categorie", () => {
  const e = { at: 1, tool: "t", callID: "c", findings: [{ category: "A", detail: "d" }], session: null, lensTool: null };
  const meta = new Map([["A", { code: "A", label: "A", tone: 1, count: 3 }]]);
  const k = detailKey(e, meta);
  assert.equal(detailKey(structuredClone(e), new Map([["A", { code: "A", label: "A", tone: 1, count: 9 }]])), k, "il conteggio della categoria non conta");
  assert.notEqual(detailKey({ ...e, session: { title: "S", directory: "/p" } }, meta), k);
  assert.notEqual(detailKey({ ...e, lensTool: { id: "x", status: "completed" } }, meta), k);
  assert.notEqual(detailKey(e, new Map([["A", { code: "A", label: "A", tone: 2, count: 3 }]])), k);
});

test("isBlock: blocked e rejected-by-user contano come blocchi, gli altri esiti no", () => {
  assert.equal(isBlock("blocked"), true);
  assert.equal(isBlock("rejected-by-user"), true);
  for (const o of ["allowed", "approved-by-user", "strano", null, undefined]) assert.equal(isBlock(o), false);
});

test("compact: toglie null, undefined e false, tiene tutto il resto nell'ordine", () => {
  const a = { n: 1 };
  assert.deepEqual(compact([a, null, undefined, false, "", 0, a]), [a, "", 0, a]);
  assert.deepEqual(compact([null, undefined, false]), []);
});

test("il dettaglio dell'evento passa da compact: replaceChildren non deve mai ricevere null (diventerebbe il testo «null»)", () => {
  const src = fs.readFileSync(new URL("../public/security-page.js", import.meta.url), "utf8");
  assert.match(src, /detailCell\.replaceChildren\(\.\.\.compact\(detailBody\(/);
});

test("healthRows: ogni riga ha una nota che dice perché conta, diversa per stato", () => {
  const ok = healthRows({ health: health() });
  assert.ok(ok.every((r) => typeof r.note === "string" && r.note.length > 0));
  const gap = healthRows({ health: health({ cross: { state: "gap", lensCalls: 5, auditEvents: 1 } }) });
  assert.notEqual(gap.find((r) => r.key === "cross").note, ok.find((r) => r.key === "cross").note);
  const stale = healthRows({ health: health({ lastEvent: { state: "stale", at: NOW - 10 * DAY } }) });
  assert.notEqual(stale.find((r) => r.key === "lastEvent").note, ok.find((r) => r.key === "lastEvent").note);
});

test("checksPassed: warn ed err non passano; un controllo facoltativo assente («none») non è un problema", () => {
  const rows = (...kinds) => kinds.map((kind) => ({ kind }));
  assert.deepEqual(checksPassed(rows("ok", "ok", "ok", "ok", "ok")), { passed: 5, total: 5 });
  assert.deepEqual(checksPassed(rows("ok", "none", "ok", "warn", "err")), { passed: 3, total: 5 });
  assert.deepEqual(checksPassed([]), { passed: 0, total: 0 });
});

test("delta: rapporto col periodo prima, piatto sotto il 3 %, null senza periodo prima, da zero senza percentuale", () => {
  assert.deepEqual(delta(116, 100), { dir: "up", ratio: 0.16 });
  assert.deepEqual(delta(80, 100), { dir: "down", ratio: -0.2 });
  assert.deepEqual(delta(102, 100), { dir: "flat", ratio: 0.02 });
  assert.deepEqual(delta(0, 0), { dir: "flat", ratio: 0 });
  assert.deepEqual(delta(5, 0), { dir: "up", ratio: null });
  assert.equal(delta(5, null), null);
  assert.equal(delta(5, undefined), null);
});

test("rateSeries: blocchi su eventi in una finestra mobile di 7 secchielli, 0 dove non ci sono eventi", () => {
  const b = (allowed, blocked, rejected = 0) => ({ at: 0, allowed, approved: 0, rejected, blocked, other: 0 });
  assert.deepEqual(rateSeries([b(1, 1), b(0, 0), b(2, 0, 2)]), [0.5, 0.5, 0.5]);
  assert.deepEqual(rateSeries([b(0, 0), b(3, 1)]), [0, 0.25]);
  const long = Array.from({ length: 9 }, (_, i) => (i === 0 ? b(0, 4) : b(1, 0)));
  assert.equal(rateSeries(long)[6], 4 / 10);
  assert.equal(rateSeries(long)[7], 0); // the block of the first bucket left the window
  assert.deepEqual(rateSeries([]), []);
});

const field = (key, kind, value, extra = {}) => ({ key, kind, value, masked: false, ...extra });

test("postureOf: solo le chiavi note con un valore del tipo atteso, nell'ordine fisso; mode diverso da block la dice", () => {
  const fields = [
    field("logEvidence", "bool", false),
    field("mode", "text", "block"),
    field("failClosed", "bool", false),
    field("detectPersonalData", "text", "yes"), // not a bool: no pill
    field("auditAllowed", "bool", true),
    field("other", "bool", true),
  ];
  assert.deepEqual(
    postureOf(fields).map((p) => [p.key, p.on]),
    [["mode", true], ["failClosed", false], ["logEvidence", true], ["auditAllowed", true]],
  );
  const warn = postureOf([field("mode", "text", "warn")]);
  assert.equal(warn[0].on, false);
  assert.match(warn[0].label, /warn/);
  assert.ok(postureOf([field("mode", "text", "••••", { masked: true })]).length === 0);
  assert.deepEqual(postureOf([]), []);
});

test("policyGroups: chiavi note nei loro gruppi nell'ordine fisso, le altre in «Altre» nell'ordine del file, gruppi vuoti tolti", () => {
  const groups = policyGroups([field("zeta", "number", 1), field("auditLog", "text", "~/a"), field("mode", "text", "block"), field("alpha", "bool", true), field("maxNewlines", "number", 2)]);
  assert.deepEqual(
    groups.map((g) => [g.key, g.fields.map((f) => f.key)]),
    [["apply", ["mode"]], ["detect", ["maxNewlines"]], ["audit", ["auditLog"]], ["other", ["zeta", "alpha"]]],
  );
  assert.ok(groups.every((g) => g.label));
  assert.deepEqual(policyGroups([]), []);
});
