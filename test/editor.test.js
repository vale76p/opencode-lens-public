// The dashboard editor («Personalizza», public/editor.js) with the widgets the modules bring: the «Aggiungi» catalogue
// offers the active modules' types, the ⚙ panel reads their settings from the spec, and a widget of a module that is
// off survives editing the others and saving. The editor runs on a small fake DOM (just what it touches).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupEditor } from "../public/editor.js";
import { loadModuleWidgets } from "../public/module-widgets.js";
import { DEFAULT_LAYOUT, validateLayout } from "../public/layout.js";
import { configure } from "../public/i18n.js";

// ---------- fake DOM ----------
class Node {}
class Text extends Node {
  constructor(data) {
    super();
    this.data = String(data);
    this.parentElement = null;
  }
  get textContent() {
    return this.data;
  }
}
const PART = /^(\w+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/;
const ATTR = /\[([\w-]+)(?:=["']([^"']*)["'])?\]/g;
class Element extends Node {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.listeners = {};
    this.parentElement = null;
    this.style = {};
    this.classes = new Set();
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.isConnected = true;
    this.classList = {
      add: (...c) => {
        for (const x of c) this.classes.add(x);
      },
      remove: (...c) => {
        for (const x of c) this.classes.delete(x);
      },
      contains: (c) => this.classes.has(c),
      toggle: (c, force) => {
        const on = force ?? !this.classes.has(c);
        if (on) this.classes.add(c);
        else this.classes.delete(c);
        return on;
      },
    };
  }
  set className(v) {
    this.classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this.classes].join(" ");
  }
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.replaceChildren(new Text(v));
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k.startsWith("data-")) this.dataset[k.slice(5)] = String(v);
    if (k === "value") this.value = String(v);
    if (k === "checked") this.checked = true;
    if (k === "disabled") this.disabled = true;
  }
  getAttribute(k) {
    return this.attrs[k] ?? (k.startsWith("data-") ? (this.dataset[k.slice(5)] ?? null) : null);
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  /** Runs the listeners of `type` as the browser would for an event on this element. */
  dispatch(type, ev = {}) {
    const e = { target: this, preventDefault() {}, stopPropagation() {}, ...ev };
    for (const fn of [...(this.listeners[type] ?? [])]) fn(e);
  }
  append(...nodes) {
    for (const n of nodes) {
      const node = n instanceof Node ? n : new Text(n);
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.children.push(node);
    }
  }
  prepend(node) {
    this.append(node);
    this.children.unshift(this.children.pop());
  }
  removeChild(node) {
    this.children = this.children.filter((c) => c !== node);
    node.parentElement = null;
  }
  remove() {
    this.parentElement?.removeChild(this);
  }
  replaceChildren(...nodes) {
    for (const c of this.children) c.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  contains(n) {
    return n === this || this.descendants().includes(n);
  }
  focus() {}
  scrollIntoView() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  matches(sel) {
    return sel.split(",").some((one) => {
      const m = PART.exec(one.trim());
      if (!m) return false; // a selector this fake does not know matches nothing
      const [, tag, cls, attrs] = m;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (cls.split(".").filter(Boolean).some((c) => !this.classes.has(c))) return false;
      return [...attrs.matchAll(ATTR)].every(([, k, v]) => (v === undefined ? this.getAttribute(k) !== null : this.getAttribute(k) === v));
    });
  }
  ancestors() {
    return this.parentElement ? [this.parentElement, ...this.parentElement.ancestors()] : [];
  }
  descendants() {
    return this.children.flatMap((c) => (c instanceof Element ? [c, ...c.descendants()] : []));
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    if (sel.startsWith(":scope > ")) return this.children.filter((c) => c instanceof Element && c.matches(sel.slice(9)));
    const chain = (e, parts) => e.matches(parts.at(-1)) && (parts.length === 1 || e.ancestors().some((a) => chain(a, parts.slice(0, -1))));
    return this.descendants().filter((e) => sel.split(",").some((one) => chain(e, one.trim().split(/\s+/))));
  }
}

const IDS = ["customize", "edit-add", "catalog", "wset", "edit-save", "edit-cancel", "edit-reset", "edit-compact", "edit-costs", "edit-bar", "edit-title", "edit-done", "edit-msg", "edit-errors", "edit-live", "grid-adesso", "grid-analisi", "grid-monitor"];

/** What the editor reads of the page: `fn({ byId, saved })` runs with the fake globals, put back afterwards. */
async function withDom(fn) {
  const byId = new Map(IDS.map((id) => [id, new Element("div")]));
  const stores = new Map();
  const names = ["document", "window", "Node", "matchMedia", "localStorage", "fetch", "setTimeout"];
  const before = Object.fromEntries(names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const saved = [];
  Object.assign(globalThis, {
    document: { createElement: (tag) => new Element(tag), createTextNode: (d) => new Text(d), getElementById: (id) => byId.get(id) ?? null, addEventListener() {}, removeEventListener() {} },
    window: { innerWidth: 1200, innerHeight: 800, addEventListener() {} },
    Node,
    setTimeout: () => 0, // save() clears its «Disposizione salvata.» line after 4 s: not after the page is gone
    matchMedia:() => ({ matches: true, addEventListener() {} }),
    localStorage: { getItem: (k) => stores.get(k) ?? null, setItem: (k, v) => stores.set(k, String(v)), removeItem: (k) => stores.delete(k) },
    fetch: async (url, init) => {
      saved.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({}) };
    },
  });
  try {
    return await fn({ byId, saved });
  } finally {
    for (const k of names) {
      if (before[k]) Object.defineProperty(globalThis, k, before[k]);
      else delete globalThis[k];
    }
  }
}

// ---------- widgets of modules ----------
const file = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const draws = (...types) => file(`const r = { mount() {}, update() {} }; export default { ${types.map((t) => `${JSON.stringify(t)}: r`).join(", ")} };`);
const spec = (type, extra = {}) => ({ type, label: `Grafico ${type}`, description: `Disegna ${type}`, size: [6, 5], min: [2, 2], home: "adesso", data: ["/api/x"], settings: { title: null }, ...extra });
const page = (list) => ({ getElementById: (id) => (id === "lens-module-widgets" ? { textContent: JSON.stringify(list) } : null) });
const MODULES = () => [
  { id: "acceso", name: "Acceso", state: "on", file: draws("acceso-grafico", "acceso-analisi"), types: [spec("acceso-grafico", { settings: { title: null, range: ["dashboard", "day", 3600000], unit: ["token", "costi", "step"] } }), spec("acceso-analisi", { home: "analisi" })] },
  { id: "spento", name: "Spento", state: "off", file: null, types: [spec("spento-w")] },
  { id: "rotto", name: "Rotto", state: "on", file: file('throw new Error("sintassi");'), types: [spec("rotto-w")] },
];
const widget = (id, type, x, y, w, h, settings = {}) => ({ id, type, x, y, w, h, settings });

/**
 * The editor on a fake page with `adesso` holding `widgets`, the module widgets loaded from MODULES(). `fn({ ed, dom, layout, view, grid })`
 * runs inside; the editing session is dropped afterwards (the editor keeps it between tests).
 */
async function withEditor(widgets, fn, { view = "adesso", modules = MODULES() } = {}) {
  await loadModuleWidgets(page(modules));
  return withDom(async (dom) => {
    const state = { layout: structuredClone(DEFAULT_LAYOUT), view };
    state.layout.views.adesso.widgets = widgets;
    state.layout.views.analisi.widgets = [];
    state.layout.views.monitor.widgets = [];
    // the grid's renderGrid, reduced to a card per widget with its title
    const renderGrid = () => {
      for (const v of ["adesso", "analisi", "monitor"]) {
        dom.byId.get(`grid-${v}`).replaceChildren(
          ...state.layout.views[v].widgets.map((w) => {
            const n = new Element("div");
            n.className = "widget";
            n.setAttribute("data-id", w.id);
            const title = new Element("span");
            title.setAttribute("data-part", "title");
            title.textContent = w.settings.title ?? w.type;
            n.append(title);
            return n;
          }),
        );
      }
    };
    renderGrid();
    const ed = setupEditor({
      getLayout: () => state.layout,
      setLayout: (l) => {
        state.layout = l;
      },
      renderGrid,
      canSave: () => true,
      onChange() {},
      onSession() {},
      filters: () => ({ range: 604800000, metric: "tokens", by: "model" }),
      modelChoices: async () => [],
      view: () => state.view,
      migrated: () => false,
    });
    try {
      return await fn({ ed, dom, state, grid: dom.byId.get("grid-adesso") });
    } finally {
      if (ed.editing()) ed.cancel();
    }
  });
}

const start = (dom) => dom.byId.get("customize").dispatch("click");
const openCatalog = (dom) => dom.byId.get("edit-add").dispatch("click");
/** The catalogue's items as { text, group }: the group is the aria-label of the section it sits in. */
const catalog = (dom) =>
  dom.byId
    .get("catalog")
    .querySelectorAll(".catalog-item")
    .map((b) => ({ b, text: b.textContent, group: b.parentElement.getAttribute("aria-label") }));
const item = (dom, label) => catalog(dom).find((i) => i.text.includes(label));

test("catalogo: un widget di modulo acceso, con il badge, solo nella sua vista", async () => {
  await withEditor([widget("w-k", "kpis", 0, 0, 12, 3)], async ({ dom, state, ed }) => {
    start(dom);
    openCatalog(dom);
    const mine = item(dom, "Grafico acceso-grafico");
    assert.ok(mine, "il widget del modulo acceso è nel catalogo");
    assert.ok(mine.text.includes("modulo Acceso"), "col badge del modulo");
    assert.ok(mine.text.includes("Disegna acceso-grafico"), "la descrizione della spec, già tradotta dal server");
    assert.equal(mine.group, "Per questa vista", "home adesso: nella vista Adesso");
    assert.equal(item(dom, "Grafico acceso-analisi").group, "Altri", "home analisi: non tra quelli di Adesso");
    // dopo i tipi del nucleo, dentro il suo gruppo
    const names = catalog(dom)
      .filter((i) => i.group === "Per questa vista")
      .map((i) => i.text);
    assert.ok(names.findIndex((x) => x.includes("Grafico acceso-grafico")) > names.findIndex((x) => x.includes("Indicatori di oggi")), "i tipi del nucleo vengono prima");
    assert.ok(names.at(-1).includes("Grafico acceso-grafico"), "i widget dei moduli chiudono il gruppo");
    assert.equal(item(dom, "Indicatori di oggi").text.includes("modulo"), false, "niente badge sul nucleo");

    // nella vista Analisi è il contrario
    state.view = "analisi";
    ed.viewChanged?.();
    openCatalog(dom); // toggled closed by viewChanged: opens, rebuilt for the new view
    assert.equal(item(dom, "Grafico acceso-grafico").group, "Altri");
    assert.equal(item(dom, "Grafico acceso-analisi").group, "Per questa vista");
  });
});

test("catalogo: aggiungere un widget di modulo lo mette con la sua misura, in fondo senza spazio vuoto", async () => {
  await withEditor([widget("w-k", "kpis", 0, 0, 12, 3)], async ({ dom, state }) => {
    start(dom);
    openCatalog(dom);
    item(dom, "Grafico acceso-grafico").b.dispatch("click");
    const added = state.layout.views.adesso.widgets.find((w) => w.type === "acceso-grafico");
    assert.ok(added, "il widget è nel layout");
    assert.deepEqual([added.x, added.y, added.w, added.h], [0, 3, 6, 5], "la size della spec, subito sotto l'ultimo widget");
    assert.deepEqual(added.settings, {});
  });
});

test("catalogo: nessun widget di un modulo spento", async () => {
  await withEditor([], async ({ dom }) => {
    start(dom);
    openCatalog(dom);
    assert.equal(item(dom, "Grafico spento-w"), undefined, "modulo spento");
    assert.equal(item(dom, "Grafico rotto-w"), undefined, "modulo acceso il cui file non si carica: niente da disegnare");
    assert.equal(item(dom, "Spento"), undefined);
    assert.ok(item(dom, "Grafico acceso-grafico"), "gli altri restano");
  });
});

test("impostazioni di un widget di modulo: title e gli elenchi della spec", async () => {
  await withEditor([widget("w-m", "acceso-grafico", 0, 0, 6, 5, { unit: "costi" })], async ({ dom, state, grid }) => {
    start(dom);
    const node = grid.querySelector('[data-id="w-m"]');
    node.querySelector(".w-gear").dispatch("click");
    const panel = dom.byId.get("wset");
    assert.equal(panel.querySelector("strong").textContent, "Grafico acceso-grafico", "la label della spec, già tradotta");
    const names = panel.querySelectorAll(".wset-name").map((n) => n.textContent);
    assert.deepEqual(names, ["Titolo", "Periodo", "unit"], "title, poi i periodi, poi le chiavi del modulo");
    // la lista della spec, con il valore salvato scelto
    const unit = panel.querySelector('select[aria-label="unit"]');
    assert.deepEqual(
      unit.children.map((o) => o.textContent),
      ["token", "costi", "step"],
    );
    assert.equal(unit.value, "costi");
    unit.value = "step";
    unit.dispatch("change");
    assert.equal(state.layout.views.adesso.widgets[0].settings.unit, "step");
    // il titolo
    const title = dom.byId.get("wset").querySelector('input[aria-label="Titolo"]');
    title.value = "Il mio";
    title.dispatch("change");
    assert.equal(state.layout.views.adesso.widgets[0].settings.title, "Il mio");
  });
});

test("impostazioni di un widget di modulo spento: si aprono lo stesso", async () => {
  await withEditor([widget("w-s", "spento-w", 0, 0, 6, 5)], async ({ dom, grid }) => {
    start(dom);
    grid.querySelector('[data-id="w-s"]').querySelector(".w-gear").dispatch("click");
    assert.equal(dom.byId.get("wset").querySelector("strong").textContent, "Grafico spento-w");
    assert.deepEqual(
      dom.byId.get("wset").querySelectorAll(".wset-name").map((n) => n.textContent),
      ["Titolo"],
    );
  });
});

test("layout con un widget di modulo spento: spostare un altro widget e salvare lo conserva con posizione e settings", async () => {
  const off = widget("w-off", "spento-w", 4, 10, 5, 4, { title: "Mio", unit: "b" });
  await withEditor([widget("w-k", "kpis", 0, 0, 12, 3), off], async ({ ed, dom, state, grid }) => {
    start(dom);
    // sposta il widget del nucleo: un passo in giù
    grid.dispatch("keydown", { key: "ArrowDown", target: grid.querySelector('[data-id="w-k"]') });
    assert.equal(state.layout.views.adesso.widgets.find((w) => w.id === "w-k").y, 1, "il widget del nucleo si è spostato");
    const out = await ed.save();
    assert.deepEqual(out, { ok: true, errors: [] });
    // ciò che parte per il server è ciò che validateLayout accetta, e il widget del modulo spento c'è com'era
    const [{ body }] = dom.saved;
    assert.equal(validateLayout(body).ok, true);
    assert.deepEqual(
      body.views.adesso.widgets.find((w) => w.id === "w-off"),
      off,
      "tipo, posizione, misura e settings intatti",
    );
    assert.equal(body.views.adesso.widgets.find((w) => w.id === "w-k").y, 1);
  });
});

/** `fn` with the browser in English and `catalog` as its catalog (the core's and the modules' merged, as boot.js does). */
async function inEnglish(catalog, fn) {
  configure({ lang: "en", locale: "en-US", catalogs: { en: catalog } });
  try {
    return await fn();
  } finally {
    configure({ lang: "it", locale: "it-IT", catalogs: {} });
  }
}

test("catalogo in inglese: label, descrizione e nome del modulo tradotti nel browser dal catalogo del modulo (R17)", async () => {
  const texts = { "Grafico acceso-grafico": "On chart", "Disegna acceso-grafico": "Draws on", Acceso: "Lit", "modulo {name}": "{name} module" };
  await inEnglish(texts, () =>
    withEditor([], async ({ dom }) => {
      start(dom);
      openCatalog(dom);
      const mine = item(dom, "On chart");
      assert.ok(mine, catalog(dom).map((i) => i.text).join(" | "));
      assert.ok(mine.text.includes("Draws on"), mine.text);
      assert.ok(mine.text.includes("Lit module"), mine.text);
    }),
  );
});

test("impostazioni di un widget di modulo in inglese: chiave e valori col catalogo, t(chiave) e t(valore) (R20)", async () => {
  const texts = { unit: "Unit", token: "Tokens", costi: "Costs", "Grafico acceso-grafico": "On chart" };
  await inEnglish(texts, () =>
    withEditor([widget("w-m", "acceso-grafico", 0, 0, 6, 5, { unit: "costi" })], async ({ dom, grid }) => {
      start(dom);
      grid.querySelector('[data-id="w-m"]').querySelector(".w-gear").dispatch("click");
      const panel = dom.byId.get("wset");
      assert.equal(panel.querySelector("strong").textContent, "On chart");
      assert.ok(panel.querySelectorAll(".wset-name").some((n) => n.textContent === "Unit"), "la chiave tradotta");
      const unit = panel.querySelector('select[aria-label="Unit"]');
      assert.deepEqual(
        unit.children.map((o) => o.textContent),
        ["Tokens", "Costs", "step"],
        "i valori tradotti, uno senza traduzione resta com'è",
      );
      assert.deepEqual(
        unit.children.map((o) => o.getAttribute("value")),
        ["token", "costi", "step"],
        "il valore salvato resta quello del manifesto",
      );
    }),
  );
});

test("catalogo nella vista Monitor: nessun widget dei moduli (R23)", async () => {
  await withEditor(
    [],
    async ({ dom }) => {
      start(dom);
      openCatalog(dom);
      assert.ok(catalog(dom).length > 0, "il catalogo del nucleo c'è");
      assert.equal(item(dom, "Grafico acceso-grafico"), undefined);
      assert.equal(item(dom, "Grafico acceso-analisi"), undefined);
      assert.equal(item(dom, "modulo"), undefined);
    },
    { view: "monitor" },
  );
});

test("layout: il widget di un modulo si sposta e si ridimensiona nei suoi limiti, senza scavalcare sé stesso", async () => {
  await withEditor([widget("w-m", "acceso-grafico", 0, 4, 3, 3), widget("w-k", "kpis", 0, 0, 12, 3)], async ({ dom, state, grid }) => {
    start(dom);
    const node = () => grid.querySelector('[data-id="w-m"]');
    grid.dispatch("keydown", { key: "ArrowDown", target: node() });
    assert.deepEqual(state.layout.views.adesso.widgets[0].y, 5, "un passo, non oltre il proprio ingombro");
    // il minimo della spec ([2, 2]) vale quando lo si rimpicciolisce
    for (let i = 0; i < 5; i++) grid.dispatch("keydown", { key: "ArrowLeft", shiftKey: true, target: node() });
    for (let i = 0; i < 5; i++) grid.dispatch("keydown", { key: "ArrowUp", shiftKey: true, target: node() });
    const w = state.layout.views.adesso.widgets[0];
    assert.deepEqual([w.w, w.h], [2, 2]);
  });
});
