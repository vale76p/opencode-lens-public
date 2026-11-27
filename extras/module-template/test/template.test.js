// The tests of the example module. Copy them with the module: they show how to try a module on a real ctx, without
// starting the lens. Run them (from anywhere) with the hooks of the app, which make "/module-kit.js" and
// "/module-test-kit.js" resolve as they do in the browser and in the app's own tests:
//
//   node --disable-warning=ExperimentalWarning --import <app>/test/module-hooks.mjs --test <your folder>/test/template.test.js
//
// <app> is a checkout of the lens or the installed app (~/Applications/opencode-lens): both carry the test kit. Inside
// the repository the hooks are ./test/module-hooks.mjs, and `npm test` already passes them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// the only two imports a module may take from the core: the test kit here, "/module-kit.js" in the browser files
import { catalogs, memoryStore, moduleContext, Queries, widgetContext } from "/module-test-kit.js";
import { full } from "/module-kit.js";
import manifest from "../module.js";
import { configure, create, files } from "../server/index.js";
import widgets from "../public/widgets.js";
import en from "../public/lang-en.js";
import fr from "../public/lang-fr.js";

const ID = "mio-modulo";
const NOTE = "LENS_MIO_MODULO_NOTE";
const ROOT = new URL("../", import.meta.url);
const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };

/** A ctx on an in-memory store. `dbPath`: where the data folder is (":memory:" keeps the note in memory); `settings`: what configure() gave. */
function setup({ dbPath = ":memory:", settings = {} } = {}) {
  const store = memoryStore();
  const queries = new Queries(store);
  const ctx = moduleContext({ id: ID, config: { dbPath, scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries, log: QUIET, settings });
  return { store, ctx };
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "lens-mio-modulo-"));
const get = (routes, query = "") => routes[`GET /api/${ID}`]({}, { url: new URL(`http://lens/api/${ID}${query}`), local: true });
const post = (routes, body) => routes[`POST /api/${ID}`].handler({}, { body, local: true });

// ---- the manifest ----

test("module.js: l'id è quello della cartella, senza import statici, e la voce di menu è nel gruppo dati", async () => {
  // (the folder is called mio-modulo once copied, module-template in the repository)
  assert.equal(manifest.id, ID);
  assert.match(manifest.id, /^[a-z][a-z0-9-]*$/);
  assert.equal(manifest.menu.group, "dati");
  assert.equal(manifest.page.title, "Il mio modulo");
  assert.doesNotMatch(fs.readFileSync(new URL("module.js", ROOT), "utf8"), /^\s*import\s/m, "un manifesto non ha import statici");
  const entry = await manifest.server();
  assert.equal(typeof entry.create, "function");
  assert.equal(typeof entry.configure, "function");
  assert.equal(typeof entry.files, "function");
});

test("module.js: l'impostazione LENS_MIO_MODULO_NOTE è di testo, e il widget legge una route GET del modulo", () => {
  assert.deepEqual(manifest.settings.map((s) => [s.name, s.kind]), [[NOTE, "text"]]);
  const { routes } = create(setup().ctx);
  assert.equal(manifest.widgetsFile, "widgets.js");
  assert.equal(manifest.widgets.length, 1);
  const [w] = manifest.widgets;
  assert.equal(w.type, `${ID}-conteggio`);
  assert.ok(w.type.length <= 31 && w.type.startsWith(`${ID}-`));
  assert.deepEqual([w.home, w.size, w.min], ["adesso", [3, 4], [3, 3]]);
  assert.equal(w.settings.title, null);
  assert.ok(w.settings.range.every((r) => ["dashboard", "day", "3600000", "28800000", "86400000", "604800000", "2592000000", "0"].includes(r)));
  assert.deepEqual(w.data, [`/api/${ID}?from={from}`]);
  // the path of a widget (the query and {from} apart) is a GET route of the module itself
  for (const p of w.data) assert.ok(Object.hasOwn(routes, `GET ${p.split("?")[0]}`), `${p} non è una route GET del modulo`);
});

// ---- configure ----

test("configure: valore vuoto = nessuna nota, valore pieno = la nota senza spazi attorno, troppo lunga = un errore", () => {
  const { ctx } = setup();
  const given = (env) => configure({ id: ID, env, paths: ctx.paths, i18n: ctx.i18n });
  assert.deepEqual(given({}), { values: { note: "" }, errors: [] });
  assert.deepEqual(given({ [NOTE]: "" }), { values: { note: "" }, errors: [] });
  assert.deepEqual(given({ [NOTE]: "  Ciao!  " }), { values: { note: "Ciao!" }, errors: [] });
  const long = given({ [NOTE]: "x".repeat(201) });
  assert.equal(long.errors.length, 1, "una nota di 201 caratteri non è valida");
  assert.match(long.errors[0].message, /LENS_MIO_MODULO_NOTE/);
});

// ---- the routes ----

test("create(ctx): le due route, la POST con corpo JSON di al più 4096 byte e «le note del modulo d'esempio»", () => {
  const { store, ctx } = setup();
  try {
    const { routes } = create(ctx);
    assert.deepEqual(Object.keys(routes).sort(), [`GET /api/${ID}`, `POST /api/${ID}`]);
    const p = routes[`POST /api/${ID}`];
    assert.deepEqual(p.body, { type: "json", max: 4096 });
    assert.equal(p.what, "le note del modulo d'esempio");
    assert.equal(typeof p.handler, "function");
  } finally {
    store.close();
  }
});

test("GET e POST: da vuoto, una nota aggiunta, la nota di benvenuto dalle impostazioni, l'ultima nota in testa", (t) => {
  const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const { store, ctx } = setup({ settings: { note: "Ciao!" } });
  try {
    const { routes } = create(ctx);
    assert.deepEqual(
      { ...get(routes), from: undefined, to: undefined },
      { note: "Ciao!", notes: [], count: 0, last: null, from: undefined, to: undefined, canSave: true },
    );
    assert.deepEqual(post(routes, { text: "  prima  " }), { ok: true });
    t.mock.timers.setTime(NOW + 1000);
    post(routes, { text: "seconda" });
    const got = get(routes, `?from=${NOW - 1000}`);
    assert.equal(got.count, 2);
    assert.deepEqual(got.notes, [{ text: "seconda", at: NOW + 1000 }, { text: "prima", at: NOW }], "la più recente per prima");
    assert.deepEqual(got.last, { text: "seconda", at: NOW + 1000 });
    // the period: from after the first note, only the second counts
    assert.equal(get(routes, `?from=${NOW + 1}`).count, 1);
    assert.equal(get(routes, `?from=${NOW + 2000}`).count, 0);
    assert.equal(get(routes, `?from=${NOW + 2000}`).last, null);
    // from=0 is «all»: it starts from the oldest note
    assert.equal(get(routes, "?from=0").count, 2);
    // from the network the page is read-only
    assert.equal(routes[`GET /api/${ID}`]({}, { url: new URL(`http://lens/api/${ID}`), local: false }).canSave, false);
  } finally {
    store.close();
  }
});

test("POST: una nota vuota, troppo lunga o non testo è un 400 con gli errori, e non scrive niente", () => {
  const { store, ctx } = setup();
  try {
    const { routes } = create(ctx);
    for (const body of [{}, { text: "" }, { text: "   " }, { text: 7 }, { text: "x".repeat(201) }, null, []]) {
      const r = post(routes, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.errors.length, 1);
      assert.equal(typeof r.body.errors[0], "string");
    }
    assert.equal(get(routes).count, 0, "un rifiuto non scrive");
    assert.deepEqual(post(routes, { text: "x".repeat(200) }), { ok: true }, "200 caratteri sono ammessi");
  } finally {
    store.close();
  }
});

test("POST: le note sono al più 50, la più vecchia esce; ogni aggiunta avvisa le dashboard aperte (ctx.live.changed)", () => {
  const { store, ctx } = setup();
  const heard = [];
  store.onChange((kind, item) => heard.push([kind, item]));
  try {
    const { routes } = create(ctx);
    for (let i = 1; i <= 51; i++) post(routes, { text: `nota ${i}` });
    const { notes } = get(routes, "?from=0");
    assert.equal(notes.length, 50);
    assert.equal(notes[0].text, "nota 51");
    assert.equal(notes.at(-1).text, "nota 2", "la prima è uscita");
    assert.equal(heard.length, 51);
    assert.equal(heard[0][0], ID, "il tipo di modifica è l'id del modulo");
  } finally {
    store.close();
  }
});

// ---- the file ----

test("il file mio-modulo.json: scritto accanto al database, riletto da un'altra istanza, dichiarato da files()", () => {
  const dir = tempDir();
  const dbPath = path.join(dir, "lens.db");
  const { store, ctx } = setup({ dbPath });
  try {
    const file = path.join(dir, `${ID}.json`);
    assert.equal(fs.existsSync(file), false, "create() non scrive niente");
    const { routes } = create(ctx);
    assert.deepEqual(post(routes, { text: "resta" }), { ok: true });
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.version, 1);
    assert.deepEqual(saved.notes.map((n) => n.text), ["resta"]);
    assert.equal(get(create(setup({ dbPath }).ctx).routes, "?from=0").notes[0].text, "resta", "un'altra istanza rilegge il file");
    const declared = files(ctx);
    assert.ok(declared.length >= 1);
    assert.equal(declared[0].path, file);
    for (const f of declared) {
      assert.equal(typeof f.label, "string");
      assert.ok(path.isAbsolute(f.path) && path.dirname(f.path) === dir, "dentro la cartella dei dati");
    }
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("un file illeggibile dà un elenco vuoto, e files() non dichiara niente con il database in memoria", (t) => {
  const dir = tempDir();
  const { store, ctx } = setup({ dbPath: path.join(dir, "lens.db") });
  try {
    fs.writeFileSync(path.join(dir, `${ID}.json`), "{ non è json");
    // the lens warns about the unreadable file on its log (console.error or console.warn, as its log level says):
    // expected here, so kept out of the test output
    const errors = t.mock.method(console, "error", () => {});
    const warnings = t.mock.method(console, "warn", () => {});
    assert.deepEqual(get(create(ctx).routes).notes, []);
    errors.mock.restore();
    warnings.mock.restore();
    assert.ok(errors.mock.callCount() + warnings.mock.callCount() >= 1, "un avviso per il file illeggibile");
    assert.ok(fs.existsSync(path.join(dir, `${ID}.bad.json`)), "la copia del file illeggibile resta");
    assert.deepEqual(files(setup().ctx), []);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("un file scritto a mano con le note in disordine si rilegge in ordine di tempo: l'ultima è la più recente", () => {
  const dir = tempDir();
  const { store, ctx } = setup({ dbPath: path.join(dir, "lens.db") });
  try {
    const notes = [{ text: "terza", at: 3000 }, { text: "prima", at: 1000 }, { text: "seconda", at: 2000 }];
    fs.writeFileSync(path.join(dir, `${ID}.json`), JSON.stringify({ version: 1, notes }));
    const got = get(create(ctx).routes, "?from=0");
    assert.deepEqual(got.notes.map((n) => n.text), ["terza", "seconda", "prima"], "la più recente per prima");
    assert.equal(got.last.text, "terza");
    assert.equal(got.from, 1000 - 60_000, "«tutto» parte dalla nota più vecchia");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the widget ----

/** Just enough DOM for el() and the widget: elements with children, attributes and text, and querySelector by data-part. */
class FakeNode {
  constructor(tag) {
    Object.assign(this, { tagName: tag, children: [], attrs: {}, className: "", own: "" });
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  append(...c) {
    this.children.push(...c);
  }
  replaceChildren(...c) {
    this.children = c;
  }
  set textContent(v) {
    this.own = String(v);
    this.children = [];
  }
  get textContent() {
    return this.own + this.children.map((c) => c.textContent).join("");
  }
  all() {
    return [this, ...this.children.flatMap((c) => (c instanceof FakeNode ? c.all() : []))];
  }
  querySelector(selector) {
    const part = /^\[data-part="([^"]+)"\]$/.exec(selector)?.[1];
    return this.all().find((n) => n.attrs["data-part"] === part) ?? null;
  }
}

function withDom(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (tag) => new FakeNode(tag), createTextNode: (s) => Object.assign(new FakeNode("#text"), { own: s }) };
  try {
    return fn();
  } finally {
    globalThis.document = saved.document;
    globalThis.Node = saved.Node;
  }
}

test("widgets.js: un renderer per ogni tipo del manifesto, con mount e update, e nessun timer", () => {
  assert.deepEqual(Object.keys(widgets), manifest.widgets.map((w) => w.type));
  for (const r of Object.values(widgets)) {
    assert.equal(typeof r.mount, "function");
    assert.equal(typeof r.update, "function");
  }
  assert.doesNotMatch(fs.readFileSync(new URL("public/widgets.js", ROOT), "utf8"), /setInterval|setTimeout|requestAnimationFrame/, "la griglia chiama update a ogni aggiornamento");
});

test("widgets.js: mount disegna il titolo (data-part=title), update il conteggio e l'ultima nota, solo come testo", () => {
  withDom(() => {
    const spec = manifest.widgets[0];
    const r = widgets[`${ID}-conteggio`];
    const root = new FakeNode("div");
    // the ctx the dashboard hands to mount and update: widgetContext() narrows the grid's ctx (its `paths` are the declared
    // ones with {from} resolved, `data(path)` reads the resolved path) to the frozen { widget, title, settings, data, inst }
    const resolved = spec.data[0].replace("{from}", "0");
    const ctx = (data) =>
      widgetContext(spec, {
        widget: { id: "w1", type: spec.type, settings: {} },
        title: "Le mie note",
        settings: { range: "day" },
        paths: [resolved],
        data: (p) => (p === resolved ? data : undefined),
        inst: {},
      });
    // the module sees the declared path as written, a path it did not declare gets nothing, and nothing can be changed
    const seen = ctx({ count: 7, last: null });
    assert.deepEqual(seen.data(spec.data[0]), { count: 7, last: null });
    assert.equal(seen.data("/api/altro"), undefined);
    assert.ok(Object.isFrozen(seen) && Object.isFrozen(seen.settings) && Object.isFrozen(seen.widget));
    r.mount(root, ctx(undefined));
    assert.equal(root.querySelector('[data-part="title"]').textContent, "Le mie note");
    // the dashboard moves the title when it changes: the element stays the one mount drew
    r.update(root, ctx({ count: 2, last: { text: "<b>ciao</b>", at: 1 } }));
    assert.equal(root.querySelector('[data-part="value"]').textContent, "2");
    assert.match(root.querySelector('[data-part="note"]').textContent, /^<b>ciao<\/b>$/, "il testo dell'utente non è mai markup");
    // the count is written with the locale's digit grouping, as the core's numbers are
    // (12345, not 1234: Italian groups the digits only from five on)
    r.update(root, ctx({ count: 12345, last: null }));
    assert.equal(root.querySelector('[data-part="value"]').textContent, full(12345));
    assert.notEqual(full(12345), "12345", "con il raggruppamento delle cifre della lingua");
    r.update(root, ctx({ count: 0, last: null }));
    assert.equal(root.querySelector('[data-part="value"]').textContent, "0");
    assert.equal(root.querySelector('[data-part="note"]').textContent, "Nessuna nota nel periodo");
  });
});

// ---- the page ----

test("page.js: esporta page (come le pagine del director) e title", async () => {
  const mod = await import("../public/page.js");
  assert.equal(mod.page.id, ID);
  for (const k of ["setup", "show", "refresh"]) assert.equal(typeof mod.page[k], "function", k);
  assert.equal(mod.title, "Il mio modulo");
  const html = fs.readFileSync(new URL("public/page.html", ROOT), "utf8");
  assert.match(html, new RegExp(`id="view-${ID}"`), "la pagina è una sezione view-<id>");
  assert.doesNotMatch(html, /\sstyle=|<script/, "niente stile in linea né script: la CSP li blocca");
});

/** Runs `fn(dom)` with a fake DOM holding the page's elements by id; `dom.submit()` sends the form as the browser would. */
async function withPage(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node };
  const dom = {};
  for (const id of ["mm-welcome", "mm-form", "mm-text", "mm-add", "mm-error", "mm-list"]) dom[id] = Object.assign(new FakeNode("x"), { disabled: false, value: "" });
  let onSubmit = null;
  dom["mm-form"].addEventListener = (type, handler) => {
    if (type === "submit") onSubmit = handler;
  };
  dom.submit = () => onSubmit({ preventDefault() {} });
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (s) => Object.assign(new FakeNode("#text"), { own: s }),
    getElementById: (id) => dom[id] ?? null,
  };
  try {
    return await fn(dom);
  } finally {
    globalThis.document = saved.document;
    globalThis.Node = saved.Node;
  }
}

test("page.js: una scrittura alla volta, anche quando la pagina si aggiorna mentre la nota si salva", async (t) => {
  const { page } = await import("../public/page.js");
  // the lens answers through fetch: the GET at once, the POST only when the test lets it go
  const answer = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
  let release;
  const posted = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, "fetch", async (_url, opts) => {
    if (opts?.method === "POST") {
      await posted;
      return answer({ ok: true });
    }
    return answer({ note: "", notes: [], count: 0, last: null, canSave: true });
  });
  await withPage(async (dom) => {
    page.setup({
      report: (err) => {
        throw err;
      },
    });
    await page.show();
    assert.equal(dom["mm-add"].disabled, false, "aperta da questo computer, la pagina può scrivere");
    dom["mm-text"].value = "prima";
    const saving = dom.submit();
    assert.equal(dom["mm-add"].disabled, true, "spenta mentre send è in corso");
    // the refresh every refreshMs lands while the POST is still in flight
    await page.refresh();
    assert.equal(dom["mm-add"].disabled, true, "un aggiornamento non riaccende il pulsante durante il salvataggio");
    assert.equal(dom["mm-text"].disabled, true, "né il campo");
    release();
    await saving;
    assert.equal(dom["mm-add"].disabled, false, "riaccesa dopo la risposta");
    assert.equal(dom["mm-text"].value, "", "il campo si svuota dopo il salvataggio");
  });
});

// ---- the catalogs and the imports ----

/** The sources of the module that are not catalogs or tests, as text, comments left out (they quote t("…") as an example). */
const sources = () =>
  ["module.js", "server/index.js", "public/page.js", "public/page.html", "public/widgets.js"].map((f) => [
    f,
    fs.readFileSync(new URL(f, ROOT), "utf8").replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, ""),
  ]);

/** The Italian texts the code asks to translate: t("…"), N_("…"), Localized("…"), tn(n, "…", "…") and the data-i18n marks of the page. */
function usedTexts() {
  const out = new Set();
  const str = String.raw`"((?:[^"\\\n]|\\.)*)"`;
  for (const [file, src] of sources()) {
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$.])(?:t|N_|Localized)\(\s*${str}`, "g"))) out.add(JSON.parse(`"${m[1]}"`));
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$.])tn\([^,]+,\s*${str}\s*,\s*${str}`, "g"))) out.add(JSON.parse(`"${m[2]}"`));
    if (file.endsWith(".html")) {
      for (const m of src.matchAll(/<([a-z0-9]+)((?:"[^"]*"|[^>"])*)>/g)) {
        const [, , attrs] = m;
        if (/\sdata-i18n(?=[\s>=]|$)/.test(attrs)) {
          const inner = /^([^<]*)</.exec(src.slice(m.index + m[0].length))?.[1].trim();
          if (inner) out.add(inner);
        }
        for (const a of attrs.matchAll(/\s(placeholder|aria-label|title)="([^"]*)"/g)) if (new RegExp(`\\sdata-i18n-${a[1]}(?=[\\s>=]|$)`).test(attrs)) out.add(a[2]);
      }
    }
  }
  // the texts of the manifest the registry and the page translate with the module's catalog
  out.add(manifest.name).add(manifest.description).add(manifest.page.title);
  for (const s of manifest.settings) for (const k of ["label", "help", "placeholder"]) if (s[k]) out.add(s[k]);
  for (const w of manifest.widgets) out.add(w.label).add(w.description);
  return out;
}

/**
 * The texts of `used` that have no translation, in English or in French. catalogs() of the test kit gives the core's
 * catalogs with the module's added, as the dashboard loads them: a text the core translates needs no entry of the module.
 */
function untranslated(used) {
  const all = catalogs({ en, fr });
  return [...used].filter((k) => !Object.hasOwn(all.en, k) || !Object.hasOwn(all.fr, k));
}

test("lang-en.js e lang-fr.js: stesse voci, ogni testo del modulo ha la sua traduzione, nessuna voce orfana", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  const used = usedTexts();
  assert.deepEqual(untranslated(used), [], "testi senza traduzione");
  // a text the core already translates (Salva, Annulla…) needs no entry in the module's catalogs
  assert.deepEqual(untranslated(["Salva", "Annulla"]), [], "i testi del nucleo sono già tradotti");
  const orphans = Object.keys(en).filter((k) => !used.has(k));
  assert.deepEqual(orphans, [], "voci di catalogo che nessun file usa");
  for (const catalog of [en, fr]) for (const [k, v] of Object.entries(catalog)) assert.ok(typeof v === "string" || (v && typeof v.one === "string" && typeof v.other === "string"), k);
});

test("gli import: solo dentro la cartella, node:* e, nel browser e nei test, i due kit del nucleo", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : [new URL(e.name, dir)]));
  const root = ROOT.pathname;
  for (const file of walk(ROOT).filter((u) => u.pathname.endsWith(".js"))) {
    const rel = path.relative(root, file.pathname);
    const src = fs.readFileSync(file, "utf8");
    const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    for (const spec of specs) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        assert.ok(path.resolve(path.dirname(file.pathname), spec).startsWith(root), `${rel}: ${spec} esce dalla cartella`);
      } else if (spec === "/module-kit.js") assert.ok(rel.startsWith("public/") || rel.startsWith("test/"), `${rel}: /module-kit.js è solo del browser e dei test`);
      else if (spec === "/module-test-kit.js") assert.ok(rel.startsWith("test/"), `${rel}: /module-test-kit.js è solo dei test`);
      else assert.ok(spec.startsWith("node:"), `${rel}: import non ammesso: ${spec}`);
    }
  }
});
