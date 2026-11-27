// docs/moduli-custom.md, the guide an LLM follows to write a Lens module (served by the MCP tool module_guide): it must
// say what the code does. These tests break when the manifest gains a field the guide's table does not list, when a
// limit, a timeout or a rule the guide quotes changes in the code, when a code block stops being the example module's
// code, when the example module is renamed, when a `## ` heading can no longer be asked for alone with module_guide's
// `section`, and when the links inside en/fr point at other sections than the Italian ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import template from "../extras/module-template/module.js";
import { LOAD_TIMEOUT_MS } from "../public/module-widgets.js";
import { MODULE_ID } from "../src/config.js";
import { ToolError } from "../src/mcp/errors.js";
import { createModuleAuthoringTools, GUIDE_PATH, guideSections } from "../src/mcp/module-authoring.js";
import { JSON_NAME } from "../src/module-kit.js";
import { TABLES_ID } from "../src/module-tables.js";
import { WIDGET_LIMITS } from "../src/module-widget-fields.js";
import { discoverAll, MANIFEST_FIELDS, ROUTE_KEY, START_TIMEOUT_MS } from "../src/modules.js";
import { MAX_UPLOAD } from "../src/update.js";
import { VERSION } from "../src/version.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUIDES = { it: "docs/moduli-custom.md", en: "docs/en/moduli-custom.md", fr: "docs/fr/moduli-custom.md" };
// how each language writes the units the guide quotes next to a value of the code
const UNITS = { it: { seconds: "secondi", mib: "MiB" }, en: { seconds: "seconds", mib: "MiB" }, fr: { seconds: "secondes", mib: "Mio" } };
const TEMPLATE = path.join(ROOT, "extras", "module-template");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const QUIET = { info() {}, warn() {}, error() {} };

/** The `## ` headings of a Markdown text, code fences left out. */
const headings = (text) => [...text.replace(/```[\s\S]*?```/g, "").matchAll(/^## +(.+?)\s*$/gm)].map((m) => m[1]);
/** The fenced ```js blocks of a Markdown text (also indented under a list item), each as its text. */
const jsBlocks = (text) => [...text.matchAll(/^[ \t]*```js\n([\s\S]*?)^[ \t]*```/gm)].map((m) => m[1]);
/** A line compared with whitespace normalized. */
const norm = (line) => line.trim().replace(/\s+/g, " ");
// the anchor GitHub gives to a heading (as in docs-i18n.test.js)
const slug = (h) => h.replace(/`/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/g, "-");

test("MANIFEST_FIELDS: sono esattamente i campi del manifesto che il registro legge per giudicarlo", async (t) => {
  // a copy of the example module whose manifest records every field read while discoverAll() judges it
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-guida-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const moduleDir = path.join(dir, template.id);
  fs.mkdirSync(moduleDir);
  const real = pathToFileURL(path.join(ROOT, "extras", "module-template", "module.js")).href;
  fs.writeFileSync(
    path.join(moduleDir, "module.js"),
    `import real from ${JSON.stringify(real)};\nexport const seen = new Set();\nexport default new Proxy(real, { get(o, k, r) { if (typeof k === "string") seen.add(k); return Reflect.get(o, k, r); } });\n`,
  );
  const { found } = await discoverAll(path.join(dir, "nessun-modulo-della-lens"), { userDir: dir, log: QUIET });
  assert.deepEqual(
    found.map((f) => [f.id, f.error?.message ?? null]),
    [[template.id, null]],
    "il modulo d'esempio è valido",
  );
  const { seen } = await import(pathToFileURL(path.join(moduleDir, "module.js")).href);
  assert.deepEqual([...seen].sort(), [...MANIFEST_FIELDS].sort());
  assert.ok(Object.isFrozen(MANIFEST_FIELDS));
});

test("la tabella del manifesto della guida ha una riga per ogni campo (it, en, fr)", () => {
  for (const [lang, file] of Object.entries(GUIDES)) {
    const text = read(file);
    const missing = MANIFEST_FIELDS.filter((f) => !text.includes(`| \`${f}\` |`));
    assert.deepEqual(missing, [], `${lang}: campi del manifesto senza riga nella tabella`);
  }
});

test("la guida riporta le regole e i tempi del codice: id, tabelle, file JSON, percorsi, corpo di una POST, start(), widget (it, en, fr)", () => {
  // the characters of a route path, as ROUTE_KEY writes them after /api/
  const routeChars = /api\\\/(\[[^\]]+\])/.exec(ROUTE_KEY.source)?.[1];
  assert.equal(routeChars, "[a-z0-9/_-]", "ROUTE_KEY ha ancora la sua classe di caratteri");
  for (const [lang, file] of Object.entries(GUIDES)) {
    const text = read(file);
    const { seconds, mib } = UNITS[lang];
    for (const [what, re] of [
      ["MODULE_ID", MODULE_ID],
      ["TABLES_ID", TABLES_ID],
      ["JSON_NAME", JSON_NAME],
    ]) {
      assert.ok(text.includes(`\`${re.source}\``), `${lang}: manca \`${re.source}\` (${what})`);
    }
    assert.ok(text.includes(`\`${routeChars}\``) && text.includes("`ROUTE_KEY`"), `${lang}: manca \`${routeChars}\` (ROUTE_KEY)`);
    // a timeout is quoted with its unit, right before the name of its constant
    for (const [name, ms] of [
      ["START_TIMEOUT_MS", START_TIMEOUT_MS],
      ["LOAD_TIMEOUT_MS", LOAD_TIMEOUT_MS],
    ]) {
      assert.match(text, new RegExp(`(?<![\\d.])${ms / 1000} ${seconds}[^\\n]{0,40}\`${name}\``), `${lang}: ${ms / 1000} ${seconds} (${name})`);
    }
    assert.match(text, new RegExp(`(?<![\\d.])${MAX_UPLOAD / 1024 / 1024} ${mib}`), `${lang}: il massimo di body.max (MAX_UPLOAD)`);
  }
});

/** Every line of the example module's files, whitespace normalized. */
function templateLines() {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return new Set(walk(TEMPLATE).flatMap((f) => fs.readFileSync(f, "utf8").split("\n").map(norm)));
}

/** A manifest with its functions as their source, to compare two manifests by structure. */
const shape = (v) => (typeof v === "function" ? `fn ${String(v)}` : Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : v);

test("i blocchi js della guida sono il codice del modulo d'esempio (it, en, fr)", async () => {
  const lines = templateLines();
  for (const [lang, file] of Object.entries(GUIDES)) {
    const blocks = jsBlocks(read(file));
    assert.ok(blocks.length >= 6, `${lang}: i blocchi js della guida (configure, manifesto, route, file JSON, pagina, widget)`);
    let manifests = 0;
    for (const block of blocks) {
      if (/^export default \{\n/.test(block)) {
        // the manifest is reflowed (one line per field): it must be the same object as the example's
        manifests++;
        const { default: shown } = await import(`data:text/javascript,${encodeURIComponent(block)}`);
        assert.deepEqual(shape(shown), shape(template), `${lang}: il manifesto della guida è quello di extras/module-template/module.js`);
        continue;
      }
      const missing = block
        .split("\n")
        .map(norm)
        .filter((l) => l !== "" && !lines.has(l));
      assert.deepEqual(missing, [], `${lang}: righe di un blocco js che non sono nel modulo d'esempio`);
    }
    assert.equal(manifests, 1, `${lang}: un blocco del manifesto`);
  }
});

test("il lens del modulo d'esempio è la versione della lens, e release-please lo porta avanti (R36)", async () => {
  assert.equal(template.lens, VERSION, "extras/module-template/module.js: lens è la versione di questa lens");
  const files = ["extras/module-template/module.js", ...Object.values(GUIDES)];
  for (const f of files) {
    // the generic updater of release-please rewrites the x.y.z of the lines that carry its marker
    const lines = read(f).split("\n").filter((l) => /^\s*lens: "\d+\.\d+\.\d+",/.test(l));
    assert.deepEqual(lines.map(norm), [`lens: "${VERSION}", // x-release-please-version`], `${f}: una riga lens, con il segnaposto di release-please`);
  }
  const extra = JSON.parse(read("release-please-config.json")).packages["."]["extra-files"];
  for (const f of files) assert.ok(extra.some((e) => e.type === "generic" && e.path === f), `release-please-config.json: ${f} tra gli extra-files`);
});

test("i link interni della guida portano alle stesse sezioni in it, en e fr", () => {
  const targets = (text) => {
    const titles = [...text.replace(/```[\s\S]*?```/g, "").matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => slug(m[1]));
    return [...text.replace(/```[\s\S]*?```/g, "").matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => {
      const i = titles.indexOf(m[1]);
      assert.ok(i >= 0, `#${m[1]} non è un titolo della guida`);
      return i;
    });
  };
  const it = targets(read(GUIDES.it));
  assert.ok(it.length >= 5, "la guida rimanda alle sue sezioni");
  for (const lang of ["en", "fr"]) assert.deepEqual(targets(read(GUIDES[lang])), it, `${lang}: i link interni, in ordine, puntano alle sezioni di quelli italiani`);
});

test("la guida riporta i limiti dei widget di src/module-widget-fields.js (it, en, fr)", () => {
  const cell = (v) => (Array.isArray(v) ? v.map((x) => `\`${x}\``).join(", ") : typeof v === "string" ? `\`${v}\`` : String(v));
  for (const [lang, file] of Object.entries(GUIDES)) {
    const text = read(file);
    for (const [k, v] of Object.entries(WIDGET_LIMITS)) assert.ok(text.includes(`| \`${k}\` | ${cell(v)} |`), `${lang}: manca la riga | \`${k}\` | ${cell(v)} |`);
  }
});

test("la guida usa i nomi veri del modulo d'esempio (it, en, fr)", () => {
  const names = [template.id, template.widgets[0].type, template.settings[0].name, "extras/module-template"];
  assert.deepEqual(names.slice(0, 3), ["mio-modulo", "mio-modulo-conteggio", "LENS_MIO_MODULO_NOTE"]);
  for (const [lang, file] of Object.entries(GUIDES)) {
    const text = read(file);
    for (const name of names) assert.ok(text.includes(name), `${lang}: manca ${name}`);
  }
});

test("ogni titolo ## della guida è una sezione di module_guide, che si chiede da sola con section", async () => {
  const text = read(GUIDES.it);
  assert.equal(path.join(ROOT, GUIDES.it), GUIDE_PATH, "module_guide serve proprio questo file");
  assert.ok(text.length < 200_000, "la guida entra intera in module_guide");
  const titles = guideSections(text).map((s) => s.title);
  assert.deepEqual(titles, headings(text), "le stesse intestazioni che module_guide usa per section");
  assert.ok(titles.length >= 12, "l'indice della spec ha 12 sezioni");
  for (const title of titles) {
    assert.ok(title.length <= 40, `titolo corto: ${title}`);
    assert.doesNotMatch(title, /questa installazione/i, "il titolo dei valori lo aggiunge module_guide");
  }
  // the lens is not reachable: module_guide answers with the guide and says the values are missing
  const connect = () => ({
    lens: {
      get: async () => {
        throw new ToolError("lens ferma");
      },
    },
  });
  const [guide] = createModuleAuthoringTools({ connect, guidePath: GUIDE_PATH });
  for (const title of titles) {
    const r = await guide.run({ section: title }, { signal: new AbortController().signal });
    assert.deepEqual(headings(r.text), [title], `section «${title}» dà quella sezione e nessun'altra`);
  }
});
