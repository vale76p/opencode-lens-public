// The core (src/, public/) never depends on a module; a module talks to the core only through its ctx
// (server side) or "/module-kit.js" (browser side). Ratchet: MARKERS lists what belongs to an extracted
// module, ALLOWED the places in the core still holding it; ALLOWED may only shrink.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// module id -> strings or regexes that must not appear in src/ or public/. For Sistema, '"sistema"' is the id as a
// quoted string (PAGES, a page id): «Tema: sistema» and the like do not match it, so it needs no exception.
// For Vibe Coding, "vibe-" covers its files (vibe-page.js, …), its ids (#vibe-range) and vibe-projects.json; the
// prose «Vibe Coding» in comments does not match it (case and hyphen). For Security, '"security"' is the id as a quoted
// string and "LENS_SECURITY_" its variables: the core's SECURITY_HEADERS, the header content-security-policy and the
// skill preset «angular-security» of the MCP examples match none of them, so ALLOWED stays empty. For IBM Bob, '"bob"' is
// the id as a quoted string, "bob-"/"bob_" its files, ids, classes and tables, "LENS_BOB" its variables (and the
// deprecated one) and the word «Bob» on its own: what the core keeps of Bob is only the deprecation of LENS_BOB, listed
// in ALLOWED below. For Skill, '"skill"' is the id as a quoted string, "skills-", "skill-presets", "skill-import" and
// "skill-figures" its files, ids and classes (skills-page.js, #skill-import, skill-presets.json), its routes, stores and
// MCP names, the page and "/lens:" the command of a preset. «preset» on its own is never a marker: the dashboard's
// templates (presets.js, presets-dialog.js, dashboard-presets.json) are the core's. What the core keeps of Skill names
// none of these markers: skill_uses with src/skill-uses.js and src/skill-ids.js, the collector's skills folder, the two
// metrics of skill loads and ctx.skillLoads; the three places that do are listed in ALLOWED below.
const MARKERS = {
  sistema: ["system-page.js", "system-cards.js", "system-model.js", "SystemInfo", "/api/system", "view-sistema", '"sistema"'],
  vibecoding: ["vibe-", "/api/vibe-", "view-vibecoding", "VibeProjectStore", "vibeCoding(", '"vibecoding"'],
  security: ["security-page", "security-model", "security-charts", "/api/security", "SecurityAudit", "view-security", "LENS_SECURITY_", '"security"'],
  bob: ['"bob"', "bob-", "bob_", "/api/bob", "BobSource", "BobQueries", "bobMode", "view-bob", "nav-bob", "sec-bob", "LENS_BOB", "Bobcoin", /\bbob\b/i],
  skill: ['"skill"', "skills-", "skill-presets", "skill-import", "skill-figures", "/api/skills", "/api/skill-usage", "/api/skill-loads", "SkillStore", "SkillPresetStore", "createPresetSource", "UnknownPresetError", "skillsPage", "view-skill", "/lens:"],
};
// core places still allowed to hold a marker: { file: "src/x.js", marker: <entry of MARKERS[id]>, why: "..." }
// The one thing the core keeps of IBM Bob: the deprecation of LENS_BOB (DEPRECATED_VARS in src/config.js with its
// sentence, used by the log line in src/main.js and the refusal in src/settings.js, and that sentence in the catalogs),
// because a plist written before the module can still carry the variable and the lens must say it is no longer needed
// instead of calling it unknown.
const BOB_WORD = MARKERS.bob.find((m) => m instanceof RegExp);
const DEPRECATION = "deprecazione di LENS_BOB (DEPRECATED_VARS): la variabile di un plist precedente al modulo va segnalata, non trattata come sconosciuta";
const ALLOWED = [
  { file: "src/config.js", marker: "LENS_BOB", why: DEPRECATION },
  { file: "src/config.js", marker: BOB_WORD, why: DEPRECATION },
  { file: "src/main.js", marker: "LENS_BOB", why: DEPRECATION },
  { file: "public/lang-en.js", marker: BOB_WORD, why: `la frase nel catalogo: ${DEPRECATION}` },
  { file: "public/lang-fr.js", marker: BOB_WORD, why: `la frase nel catalogo: ${DEPRECATION}` },
  // Skill: the rows of skill_uses stay the core's, written also while the module is off
  { file: "src/collector.js", marker: '"skill"', why: "il nome del tool nativo «skill» e il tipo di messaggio «skill» di OpenCode, da cui il collector ricava le righe di skill_uses" },
  { file: "src/skill-uses.js", marker: '"skill"', why: "il canale «skill» delle righe di skill_uses (il tool nativo di OpenCode), che il core scrive anche a Skill spento" },
  { file: "src/server.js", marker: "skill-presets", why: "noteMcp: un MCP più vecchio dell'intestazione X-Lens-Mcp-Version si riconosce dallo user-agent «node» su /api/skill-presets, un percorso che il core osserva e non serve" },
];

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// import … from "x", export … from "x", import "x"
const IMPORT = /^[ \t]*(?:import|export)\s+(?:[\w$*\s{},]+?\s+from\s*)?["']([^"']+)["']/gm;
const KIT = "/module-kit.js";
// The one path into the core's test/ a module's tests may use: the kit that re-exports the store builders, the module
// context and the query-plan check. It is a permanent rule (not a ratchet entry): module tests need a real Store, and
// funnelling them through one file keeps the rest of test/ and src/ unreachable.
const TEST_KIT = "../../../test/module-test-kit.js";
// The same kit for a module of the user's folder, which lives outside the app: the bare specifier the hooks resolve.
const USER_TEST_KIT = "/module-test-kit.js";

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p, ext);
    return ext.test(e.name) ? [p] : [];
  });
}

// import("x") with a literal; any other import( is dynamic with an expression, which the checks cannot follow
const DYNAMIC_LITERAL = /\bimport\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*\)/g;
const DYNAMIC_ANY = /(?<![\w$.])import\s*\(/g;

/** Every module specifier a source imports, statically or with import("literal"). */
const specifiersOf = (text) => [...text.matchAll(IMPORT)].map((m) => m[1]).concat([...text.matchAll(DYNAMIC_LITERAL)].map((m) => m[1] ?? m[2]));
/** How many import( calls take something other than a string literal. */
const opaqueImports = (text) => [...text.matchAll(DYNAMIC_ANY)].length - [...text.matchAll(DYNAMIC_LITERAL)].length;
const specifiers = (file) => specifiersOf(fs.readFileSync(file, "utf8"));
const inside = (dir, p) => p === dir || p.startsWith(dir + path.sep);

// what the core is made of: src/ and public/ (code, pages, styles), scripts/ and the shell scripts at the repo root
const CORE = [
  ...["src", "public"].flatMap((d) => walk(path.join(ROOT, d), /\.(m?js|html|css)$/)),
  ...walk(path.join(ROOT, "scripts"), /\.(m?js|sh)$/),
  ...fs.readdirSync(ROOT).filter((f) => /\.sh$/.test(f)).map((f) => path.join(ROOT, f)),
];

// every module folder: the real ones and the demo fixture, seen as if it were modules/demo/
const MODULES = [
  ...(fs.existsSync(path.join(ROOT, "modules"))
    ? fs.readdirSync(path.join(ROOT, "modules"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ id: e.name, dir: path.join(ROOT, "modules", e.name) }))
    : []),
  { id: "demo", dir: path.join(ROOT, "test/fixtures/modules/demo") },
];
const moduleFiles = (m) => walk(m.dir, /\.m?js$/);

const markerHit = (text, marker) => (marker instanceof RegExp ? marker.test(text) : text.includes(marker));
const sameMarker = (a, b) => (a instanceof RegExp && b instanceof RegExp ? a.source === b.source && a.flags === b.flags : a === b);

test("confini: il core non importa staticamente niente da modules/", () => {
  const bad = CORE.flatMap((f) => specifiers(f).filter((s) => /(^|\/)modules\//.test(s)).map((s) => `${rel(f)} → ${s}`));
  assert.deepEqual(bad, []);
});

test("confini: il core non contiene marcatori di un modulo fuori da ALLOWED", () => {
  const bad = [];
  for (const f of CORE) {
    const text = fs.readFileSync(f, "utf8");
    for (const [id, markers] of Object.entries(MARKERS)) {
      for (const marker of markers) {
        if (!markerHit(text, marker)) continue;
        if (ALLOWED.some((a) => a.file === rel(f) && sameMarker(a.marker, marker))) continue;
        bad.push(`${rel(f)} contiene ${String(marker)} (${id})`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

/** ALLOWED entries whose file is gone or no longer holds the marker. `read(file)` returns the text or null. */
function staleAllowed(allowed, read) {
  return allowed
    .filter((a) => {
      const text = read(a.file);
      return text === null || !markerHit(text, a.marker);
    })
    .map((a) => `${a.file}: ${String(a.marker)} (${a.why})`);
}

/**
 * Problems of one file of a module. `within` is the file's path inside the module folder (posix segments), `text` its source.
 * Only strings: nothing here touches the disk, so the synthetic cases below call it directly.
 * `user`: a module of the user's folder (extras/module-template copied there), whose tests take the test kit as the
 * bare "/module-test-kit.js" (resolved by test/module-hooks.mjs) instead of the relative path of modules/<id>/test/.
 */
function moduleFileProblems(id, within, text, { user = false } = {}) {
  const bad = [];
  const topLevelManifest = within.length === 1 && within[0] === "module.js";
  // mcp/ runs in the MCP process: everything it needs comes from the kit it receives, so only files of mcp/ itself
  const mcp = within[0] === "mcp";
  const kitOk = within[0] === "public" || within[0] === "test";
  const from = within.join("/");
  const dir = path.posix.dirname(from);
  const imports = [...text.matchAll(IMPORT)].map((m) => [m[1], false]).concat([...text.matchAll(DYNAMIC_LITERAL)].map((m) => [m[1] ?? m[2], true]));
  for (const [s, dynamic] of imports) {
    const where = `${id}/${from} → ${s}`;
    if (topLevelManifest && !dynamic) bad.push(`${where} (module.js non ha import statici)`);
    else if (mcp) {
      if (!s.startsWith(".") || !path.posix.normalize(path.posix.join(dir, s)).startsWith("mcp/")) bad.push(`${where} (mcp/ importa solo file relativi dentro mcp/)`);
    } else if (s.startsWith("node:")) continue;
    else if (s === KIT) {
      if (!kitOk) bad.push(`${where} (${KIT} solo da public/ e test/)`);
    } else if (s === (user ? USER_TEST_KIT : TEST_KIT)) {
      if (within[0] !== "test") bad.push(`${where} (il kit di test solo da test/)`);
    } else if (s.startsWith(".")) {
      if (path.posix.normalize(path.posix.join(dir, s)).startsWith("..")) bad.push(`${where} (esce da ${id}/)`);
    } else bad.push(`${where} (specificatore non ammesso)`);
  }
  if (opaqueImports(text) > 0) bad.push(`${id}/${from} (import() con espressione non letterale)`);
  return bad;
}

// The pieces of public/style.css no core page uses, kept for the modules' pages: the summary strip with its tiles and
// mix bar, the move menu of a card and the destructive button (the KIT lists of the modules' page tests). Each one must
// serve at least two modules, or it belongs in that module's own stylesheet.
const MODULE_CSS_KIT = ["danger", "fmenu", "mix", "vhero", "vk", "vk-delta", "vk-l", "vk-ring", "vk-s", "vk-v"];

test("confini: il CSS che il core tiene per i moduli serve ad almeno due moduli", () => {
  const pages = MODULES.filter((m) => m.id !== "demo").map((m) => ({
    id: m.id,
    text: walk(path.join(m.dir, "public"), /\.(js|html)$/)
      .filter((f) => !/[/\\]lang-[a-z]+\.js$/.test(f))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n"),
  }));
  const css = fs.readFileSync(path.join(ROOT, "public/style.css"), "utf8");
  const users = (cls) => pages.filter((p) => new RegExp(`(?<![\\w-])${cls}(?![\\w-])`).test(p.text)).map((p) => p.id);
  assert.deepEqual(MODULE_CSS_KIT.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css)), [], "voci che il core non stilizza più");
  assert.deepEqual(MODULE_CSS_KIT.filter((c) => users(c).length < 2).map((c) => `${c}: ${users(c).join(",") || "nessuno"}`), [], "da spostare nel foglio dell'unico modulo che le usa");
});

test("confini: ogni voce di ALLOWED trova ancora qualcosa", () => {
  const read = (file) => (fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), "utf8") : null);
  assert.deepEqual(staleAllowed(ALLOWED, read), [], "voci di ALLOWED ormai inutili: toglierle");
});

test("confini: un modulo importa solo dentro la propria cartella, node:*, /module-kit.js (public/ e test/) e il kit di test (test/)", () => {
  const bad = [];
  for (const m of MODULES) {
    for (const f of moduleFiles(m)) bad.push(...moduleFileProblems(m.id, path.relative(m.dir, f).split(path.sep), fs.readFileSync(f, "utf8")));
  }
  assert.deepEqual(bad, []);
});

test("confini (casi sintetici): i marcatori di Bob prendono la parola, la variabile e le sue forme", () => {
  const hit = (text) => MARKERS.bob.some((m) => markerHit(text, m));
  assert.ok(hit("// IBM Bob legge"));
  assert.ok(hit("LENS_BOB"));
  assert.ok(hit("il Bob del core"));
  assert.ok(!hit("Bobby e kebob"), "only the whole word");
});

test("confini (casi sintetici): una voce ALLOWED scaduta fa fallire", () => {
  const entry = { file: "src/x.js", marker: "Vecchio", why: "prova" };
  assert.equal(staleAllowed([entry], () => "niente da vedere").length, 1);
  assert.equal(staleAllowed([entry], () => null).length, 1);
  assert.deepEqual(staleAllowed([entry], () => "c'è Vecchio qui"), []);
});

test("confini (casi sintetici): import() dinamici", () => {
  const f = (within, text) => moduleFileProblems("x", within, text);
  assert.equal(f(["server", "a.js"], 'const m = await import("../../src/x.js");').length, 1, "import() letterale fuori dal modulo");
  assert.equal(f(["server", "a.js"], 'const m = await import("./b.js");').length, 0, "import() letterale dentro il modulo");
  assert.equal(f(["server", "a.js"], "const m = await import(nome);").length, 1, "import() con espressione");
  assert.equal(f(["server", "a.js"], 'const m = await import("./" + nome);').length, 1, "import() con concatenazione");
  assert.equal(f(["module.js"], 'export default { server: () => import("./server/index.js") };').length, 0, "il manifesto può caricare il server");
  assert.equal(f(["module.js"], 'import x from "./y.js";').length, 1, "il manifesto non ha import statici");
});

test("confini (casi sintetici): il kit di test è ammesso solo da modules/<id>/test/", () => {
  const f = (within, text) => moduleFileProblems("x", within, text);
  const kit = `import { memoryStore } from "${TEST_KIT}";`;
  assert.deepEqual(f(["test", "a.test.js"], kit), []);
  assert.equal(f(["server", "a.js"], kit).length, 1);
  assert.equal(f(["public", "a.js"], kit).length, 1);
  assert.equal(f(["test", "a.test.js"], 'import { memoryStore } from "../../../test/helpers.js";').length, 1, "un altro file di test/");
  assert.equal(f(["test", "a.test.js"], 'import { moduleContext } from "../../../src/module-kit.js";').length, 1, "il core");
  assert.equal(f(["test", "a.test.js"], `import { x } from "${KIT}";`).length, 0, "/module-kit.js resta ammesso");
});

test("confini: il modulo d'esempio (extras/module-template) importa come un modulo dell'utente", () => {
  const template = { id: "mio-modulo", dir: path.join(ROOT, "extras", "module-template") };
  const files = moduleFiles(template);
  assert.ok(files.some((f) => f.endsWith(`${path.sep}test${path.sep}template.test.js`)), "il modulo d'esempio ha i suoi test");
  const bad = files.flatMap((f) => moduleFileProblems(template.id, path.relative(template.dir, f).split(path.sep), fs.readFileSync(f, "utf8"), { user: true }));
  assert.deepEqual(bad, []);
});

test("confini: il core non importa niente da extras/", () => {
  const bad = CORE.flatMap((f) => specifiers(f).filter((s) => /(^|\/)extras\//.test(s)).map((s) => `${rel(f)} → ${s}`));
  assert.deepEqual(bad, []);
});

test("confini (casi sintetici): un modulo dell'utente prende il kit di test come \"/module-test-kit.js\", solo da test/", () => {
  const user = (within, text) => moduleFileProblems("x", within, text, { user: true });
  const builtIn = (within, text) => moduleFileProblems("x", within, text);
  const bare = 'import { memoryStore } from "/module-test-kit.js";';
  assert.deepEqual(user(["test", "a.test.js"], bare), [], "dai test di un modulo dell'utente");
  assert.equal(user(["server", "index.js"], bare).length, 1, "non dal lato server");
  assert.equal(user(["public", "page.js"], bare).length, 1, "non dal browser");
  assert.equal(user(["test", "a.test.js"], `import { memoryStore } from "${TEST_KIT}";`).length, 1, "un modulo dell'utente non sta in modules/: il percorso relativo esce dalla sua cartella");
  assert.equal(builtIn(["test", "a.test.js"], bare).length, 1, "un modulo della lens usa il percorso relativo, mai lo specificatore");
  assert.deepEqual(user(["test", "a.test.js"], `import { x } from "${KIT}";`), [], "/module-kit.js resta ammesso");
});

/** The specifiers of `file` (a path under ROOT) that reach into test/: relative ones resolving there, and the test kit's bare one. */
function testImports(file, specs) {
  const testDir = path.join(ROOT, "test");
  return specs.filter((s) => s === "/module-test-kit.js" || (s.startsWith(".") && inside(testDir, path.resolve(path.dirname(file), s))));
}

test("confini: il core non importa niente da test/", () => {
  const bad = CORE.flatMap((f) => testImports(f, specifiers(f)).map((s) => `${rel(f)} → ${s}`));
  assert.deepEqual(bad, []);
  // the check itself
  const src = path.join(ROOT, "src", "x.js");
  assert.deepEqual(testImports(src, ["../test/helpers.js", "./y.js", "node:fs", "/module-test-kit.js", "../public/ui.js"]), ["../test/helpers.js", "/module-test-kit.js"]);
  assert.deepEqual(testImports(path.join(ROOT, "scripts", "a.mjs"), ["../test/module-hooks.mjs"]), ["../test/module-hooks.mjs"]);
});

test("confini (casi sintetici): mcp/ importa solo file relativi dentro mcp/", () => {
  const f = (within, text) => moduleFileProblems("x", within, text);
  assert.deepEqual(f(["mcp", "tools.js"], 'import { a } from "./a.js";'), []);
  assert.deepEqual(f(["mcp", "sub", "b.js"], 'import { a } from "../a.js";'), [], "una sottocartella di mcp/ può risalire a mcp/");
  assert.equal(f(["mcp", "tools.js"], 'import fs from "node:fs";').length, 1, "nemmeno node:*: tutto dal kit");
  assert.equal(f(["mcp", "tools.js"], 'import { x } from "../server/x.js";').length, 1, "il lato server del modulo");
  assert.equal(f(["mcp", "tools.js"], 'import { x } from "../../../src/mcp/text.js";').length, 1, "il core");
  assert.equal(f(["mcp", "tools.js"], `import { x } from "${KIT}";`).length, 1, "/module-kit.js è del browser");
  assert.equal(f(["mcp", "tools.js"], 'const m = await import("../public/x.js");').length, 1, "neanche con import()");
});

test("confini: il codice server di un modulo non importa un file di public/ che usa /module-kit.js", () => {
  const bad = [];
  for (const m of MODULES) {
    const pub = path.join(m.dir, "public");
    for (const f of moduleFiles(m).filter((x) => inside(path.join(m.dir, "server"), x))) {
      for (const s of specifiers(f).filter((x) => x.startsWith("."))) {
        const target = path.resolve(path.dirname(f), s);
        if (!inside(pub, target) || !fs.existsSync(target)) continue;
        if (specifiers(target).includes(KIT)) bad.push(`${m.id}: ${rel(f)} → ${rel(target)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
