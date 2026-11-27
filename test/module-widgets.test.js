// The modules' widgets in the browser (public/module-widgets.js) and in the dashboard grid (public/dashboard-grid.js):
// the registry read from the page's JSON tag, the files imported as data: URLs, the grid drawn on a small fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOAD_TIMEOUT_MS, loadModuleWidgets, moduleLivePaths, moduleRenderer, moduleRequests, moduleWidgetProblem, moduleWidgetSpec, widgetContext, widgetSpec } from "../public/module-widgets.js";
import { DEFAULT_LAYOUT, WIDGET_TYPES } from "../public/layout.js";
import { widgetTitle } from "../public/widgets.js";
import { WIDGETS } from "../public/registry.js";
import { createGrid } from "../public/dashboard-grid.js";
import { configure, t } from "../public/i18n.js";
import { kindPaths, sourceState } from "../public/sources.js";
import { planRead } from "../public/live-refresh.js";

/** `fn` with the browser in English, `catalog` as its catalog (core and modules' merged, as boot.js does); Italian again after. */
async function inEnglish(catalog, fn) {
  configure({ lang: "en", locale: "en-US", catalogs: { en: catalog } });
  try {
    return await fn();
  } finally {
    configure({ lang: "it", locale: "it-IT", catalogs: {} });
  }
}

const NOW = 1_800_000_000_000;
/** A widgets file served as a data: URL (a fresh URL per source: no import cache in the way). */
const file = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
/** The renderers of `types`: every call recorded in globalThis.__mw; `throws` lists the types whose mount throws. */
const renderers = (types, throws = []) =>
  file(
    `const log = (globalThis.__mw ??= []);
${types
  .map(
    (type, i) => `const r${i} = {
  mount(root, ctx) { log.push(["mount", ${JSON.stringify(type)}, ctx]); ${throws.includes(type) ? 'throw new Error("mount rotto");' : 'root.append(Object.assign(document.createElement("i"), { className: "drawing" }));'} },
  update(root, ctx) { log.push(["update", ${JSON.stringify(type)}, ctx]); root.dataset.drawn = String(ctx.data("/api/x?from={from}")?.value); },
};
export { r${i} as ${JSON.stringify(type)} };`,
  )
  .join("\n")}`,
  );
const spec = (type, extra = {}) => ({ type, label: `Grafico ${type}`, description: "Un grafico", size: [4, 4], min: [2, 2], home: "adesso", data: ["/api/x?from={from}"], ...extra });
/** A document with the JSON tag of the Task B2 (none when `list` is null). */
const page = (list) => ({ getElementById: (id) => (id === "lens-module-widgets" && list !== null ? { textContent: typeof list === "string" ? list : JSON.stringify(list) } : null) });

const MODULES = () => [
  { id: "acceso", name: "Acceso", state: "on", file: renderers(["acceso-grafico"]), types: [spec("acceso-grafico", { evil: "<script>" })] },
  { id: "x", name: "Ics", state: "off", file: null, types: [spec("x-off")] },
  { id: "conf", name: "Conf", state: "unconfigured", file: null, types: [spec("conf-w")] },
  { id: "err", name: "Err", state: "error", file: null, types: [spec("err-w")] },
  { id: "rotto", name: "Rotto", state: "on", file: file('throw new Error("sintassi");'), types: [spec("rotto-w")] },
  { id: "mezzo", name: "Mezzo", state: "on", file: renderers(["mezzo-a"]), types: [spec("mezzo-a"), spec("mezzo-b")] },
];

test("loadModuleWidgets: un modulo acceso ha renderer e spec, uno spento solo la spec e il problema «off»", async () => {
  await loadModuleWidgets(page(MODULES()));
  const r = moduleRenderer("acceso-grafico");
  assert.equal(typeof r?.mount, "function");
  assert.equal(typeof r?.update, "function");
  const s = moduleWidgetSpec("acceso-grafico");
  assert.deepEqual(s.module, { id: "acceso", name: "Acceso" });
  assert.equal(s.label, "Grafico acceso-grafico");
  assert.deepEqual(s.data, ["/api/x?from={from}"]);
  assert.equal(Object.hasOwn(s, "evil"), false, "solo i campi noti della spec");
  assert.equal(moduleWidgetProblem("acceso-grafico"), null);

  assert.equal(moduleRenderer("x-off"), null);
  assert.deepEqual(moduleWidgetSpec("x-off").module, { id: "x", name: "Ics" }, "la spec anche per un modulo spento");
  assert.equal(moduleWidgetProblem("x-off").kind, "off");
  assert.equal(moduleWidgetProblem("x-off").name, "Ics");
  assert.equal(moduleWidgetProblem("conf-w").kind, "unconfigured");
  assert.equal(moduleWidgetProblem("err-w").kind, "error");
  for (const fn of [moduleRenderer, moduleWidgetSpec, moduleWidgetProblem]) assert.equal(fn("nessuno-w"), null, "un tipo che nessuno dichiara");
});

// modules in error with no manifest to read (R35): only their id, no widget types
const BROKEN = () => [
  { id: "foo", name: "foo", state: "error", file: null, types: [] },
  { id: "foo-bar", name: "foo-bar", state: "error", file: null, types: [] },
];

test("moduleWidgetProblem: un tipo che nessuno dichiara è del modulo in errore col prefisso id- più lungo (R35)", async () => {
  await loadModuleWidgets(page([...BROKEN(), ...MODULES()]));
  assert.deepEqual(moduleWidgetProblem("foo-grafico"), { kind: "error", name: "foo" });
  assert.deepEqual(moduleWidgetProblem("foo-bar-grafico"), { kind: "error", name: "foo-bar" }, "foo-bar- è più lungo di foo-");
  // the order of the list does not matter
  await loadModuleWidgets(page([...BROKEN().reverse(), ...MODULES()]));
  assert.deepEqual(moduleWidgetProblem("foo-bar-grafico"), { kind: "error", name: "foo-bar" });
  assert.deepEqual(moduleWidgetProblem("foo-grafico"), { kind: "error", name: "foo" });
  for (const type of ["nessuno-w", "foobar-w", "foo"]) assert.equal(moduleWidgetProblem(type), null, `${type}: nessun modulo in errore ha quel prefisso`);
  assert.equal(moduleWidgetSpec("foo-grafico"), null, "nessuna spec: il manifesto non c'è");
  assert.equal(moduleRenderer("foo-grafico"), null);
  // a type the module in error does not declare, while the longest prefix is a module that is on: unknown, as today
  await loadModuleWidgets(page([{ id: "acceso", name: "acceso", state: "error", file: null, types: [] }, { ...MODULES()[0], id: "acceso-grafico", types: [spec("acceso-grafico-w")] }]));
  assert.equal(moduleWidgetProblem("acceso-grafico-altro"), null, "il prefisso più lungo è di un modulo che non è in errore");
  assert.deepEqual(moduleWidgetProblem("acceso-altro"), { kind: "error", name: "acceso" });
});

test("griglia: widget salvato di un modulo in errore senza manifesto → riquadro «in errore» col suo id (R35)", async () => {
  await loadModuleWidgets(page([...BROKEN(), ...MODULES()]));
  const { card, requests } = await drawGrid([at("e1", "foo-bar-grafico"), at("n1", "nessuno-w", 4)]);
  assert.deepEqual(requests, []);
  assert.ok(card("e1").textContent.includes(t("Il modulo {name} è in errore: vedi Impostazioni › Moduli", { name: "foo-bar" })), card("e1").textContent);
  assert.equal(card("n1"), null, "un tipo di nessuno resta non disegnato");
});

test("loadModuleWidgets: un file che lancia all'import vale «load» e il caricamento risolve (Review Focus 2)", async () => {
  await assert.doesNotReject(loadModuleWidgets(page(MODULES())));
  assert.equal(moduleRenderer("rotto-w"), null);
  assert.equal(moduleWidgetProblem("rotto-w").kind, "load");
  assert.equal(moduleWidgetProblem("rotto-w").name, "Rotto");
  assert.ok(moduleRenderer("acceso-grafico"), "gli altri moduli si caricano lo stesso");
  // a 404: import() of a file that does not exist
  await assert.doesNotReject(loadModuleWidgets(page([{ id: "via", name: "Via", state: "on", file: "file:///non/esiste/widgets.js", types: [spec("via-w")] }])));
  assert.equal(moduleWidgetProblem("via-w").kind, "load");
});

test("loadModuleWidgets: un file che non si risolve mai scade dopo il timeout: «load», e il caricamento risolve", async () => {
  assert.equal(LOAD_TIMEOUT_MS, 5000);
  const started = Date.now();
  const list = [{ id: "appeso", name: "Appeso", state: "on", file: file("await new Promise(() => {});"), types: [spec("appeso-w")] }, MODULES()[0]];
  await loadModuleWidgets(page(list), { timeoutMs: 50 });
  assert.ok(Date.now() - started < 2000, "non aspetta il file appeso");
  assert.equal(moduleWidgetProblem("appeso-w").kind, "load");
  assert.ok(moduleRenderer("acceso-grafico"), "gli altri moduli si caricano lo stesso");
});

test("loadModuleWidgets: un tipo dichiarato senza export { mount, update } è «load», gli altri tipi dello stesso file no", async () => {
  await loadModuleWidgets(page(MODULES()));
  assert.ok(moduleRenderer("mezzo-a"));
  assert.equal(moduleRenderer("mezzo-b"), null);
  assert.equal(moduleWidgetProblem("mezzo-b").kind, "load");
  await loadModuleWidgets(page([{ id: "senza", name: "Senza", state: "on", file: file("export const x = 1;"), types: [spec("senza-w")] }]));
  assert.equal(moduleWidgetProblem("senza-w").kind, "load");
  await loadModuleWidgets(page([{ id: "meta", name: "Meta", state: "on", file: file('const r = { mount() {} }; export { r as "meta-w" };'), types: [spec("meta-w")] }]));
  assert.equal(moduleWidgetProblem("meta-w").kind, "load", "senza update");
});

test("loadModuleWidgets: export default { [tipo]: { mount, update } } vale come gli export per nome; se c'è vince", async () => {
  const draw = (tag) => `{ mount() { globalThis.__mwTag = ${JSON.stringify(tag)}; }, update() {} }`;
  await loadModuleWidgets(
    page([
      { id: "def", name: "Def", state: "on", file: file(`export default { "def-a": ${draw("default")}, "def-c": { mount() {} } };`), types: [spec("def-a"), spec("def-b"), spec("def-c")] },
      { id: "both", name: "Both", state: "on", file: file(`const named = ${draw("nome")}; export { named as "both-w", named as "both-n" }; export default { "both-w": ${draw("default")} };`), types: [spec("both-w"), spec("both-n")] },
    ]),
  );
  assert.ok(moduleRenderer("def-a"), "il tipo nell'export default");
  assert.equal(moduleWidgetProblem("def-b").kind, "load", "un tipo dichiarato che il default non ha");
  assert.equal(moduleWidgetProblem("def-c").kind, "load", "un renderer senza update");
  moduleRenderer("both-w").mount(null, { widget: {}, settings: {}, paths: [], data: () => undefined });
  assert.equal(globalThis.__mwTag, "default", "default e per nome: vince il default");
  assert.equal(moduleRenderer("both-n"), null, "con un default, gli export per nome non contano");
  assert.equal(moduleWidgetProblem("both-n").kind, "load");
});

test("loadModuleWidgets: senza il tag, con un JSON rotto o un tipo del nucleo non registra niente e risolve", async () => {
  await loadModuleWidgets(page(MODULES()));
  await loadModuleWidgets(page(null));
  assert.equal(moduleWidgetSpec("acceso-grafico"), null, "ogni caricamento riparte da zero");
  await assert.doesNotReject(loadModuleWidgets(page("{rotto")));
  assert.equal(moduleWidgetSpec("acceso-grafico"), null);
  await loadModuleWidgets(page([{ id: "hero", name: "H", state: "off", file: null, types: [spec("hero")] }]));
  assert.equal(moduleWidgetSpec("hero"), null, "un tipo del nucleo non diventa di un modulo");
  assert.equal(widgetSpec("hero"), WIDGET_TYPES.hero);
});

test("moduleRequests: {from} col giorno, con now - range, 0 per «tutto»; nessuna richiesta senza renderer", async () => {
  await loadModuleWidgets(page(MODULES()));
  const w = (settings) => ({ id: "w", type: "acceso-grafico", settings });
  assert.deepEqual(moduleRequests(w({ range: "day" }), { range: 604800000 }, NOW), ["/api/x?from=day"]);
  assert.deepEqual(moduleRequests(w({ range: "3600000" }), { range: "day" }, NOW), [`/api/x?from=${NOW - 3600000}`]);
  assert.deepEqual(moduleRequests(w({}), { range: "day" }, NOW), ["/api/x?from=day"], "senza range: quello della vista");
  assert.deepEqual(moduleRequests(w({ range: "dashboard" }), { range: 0 }, NOW), ["/api/x?from=0"]);
  assert.deepEqual(moduleRequests({ id: "o", type: "x-off" }, { range: "day" }, NOW), [], "modulo spento: niente da leggere");
  assert.deepEqual(moduleRequests({ id: "r", type: "rotto-w" }, { range: "day" }, NOW), []);
  assert.deepEqual(moduleRequests({ id: "n", type: "nessuno-w" }, { range: "day" }, NOW), []);
});

test("widgetSpec: i tipi del nucleo da WIDGET_TYPES, quelli dei moduli dal registro; il titolo usa la sua label", async () => {
  await loadModuleWidgets(page(MODULES()));
  assert.equal(widgetSpec("trend"), WIDGET_TYPES.trend);
  assert.equal(widgetSpec("x-off").label, "Grafico x-off");
  assert.equal(widgetSpec("nessuno-w"), null);
  assert.equal(widgetTitle({ type: "acceso-grafico" }, {}), "Grafico acceso-grafico");
  assert.equal(widgetTitle({ type: "acceso-grafico", settings: { title: "Mio" } }, {}), "Mio");
  assert.equal(widgetTitle({ type: "nessuno-w" }, {}), "nessuno-w");
});

test("i testi dei problemi: spento, in errore, da configurare, non caricato", async () => {
  const { moduleProblemText } = await import("../public/module-widgets.js");
  assert.equal(moduleProblemText({ kind: "off", name: "Ics" }), t("Il modulo {name} è spento: attivalo da Impostazioni › Moduli", { name: "Ics" }));
  assert.equal(moduleProblemText({ kind: "error", name: "Ics" }), t("Il modulo {name} è in errore: vedi Impostazioni › Moduli", { name: "Ics" }));
  assert.equal(moduleProblemText({ kind: "unconfigured", name: "Ics" }), t("Il modulo {name} è da configurare: vedi Impostazioni › Moduli", { name: "Ics" }));
  assert.equal(moduleProblemText({ kind: "load", name: "Ics" }), t("Widget del modulo {name} non caricato", { name: "Ics" }));
});

test("i testi dei moduli arrivano in italiano e si traducono nel browser col catalogo del modulo (R17)", async () => {
  await loadModuleWidgets(page(MODULES()));
  const { moduleProblemText } = await import("../public/module-widgets.js");
  const catalog = {
    "Grafico acceso-grafico": "On chart",
    Ics: "Ex",
    "Il modulo {name} è spento: attivalo da Impostazioni › Moduli": "The {name} module is off: turn it on in Settings › Modules",
    "Widget del modulo {name} non caricato": "Widget of the {name} module not loaded",
  };
  await inEnglish(catalog, () => {
    assert.equal(widgetTitle({ type: "acceso-grafico" }, {}), "On chart", "la label della spec, tradotta");
    assert.equal(moduleProblemText(moduleWidgetProblem("x-off")), "The Ex module is off: turn it on in Settings › Modules", "anche il nome del modulo");
    assert.equal(moduleProblemText(moduleWidgetProblem("rotto-w")), "Widget of the Rotto module not loaded", "un nome senza traduzione resta com'è");
  });
  assert.equal(widgetTitle({ type: "acceso-grafico" }, {}), "Grafico acceso-grafico");
});

test("loadModuleWidgets: un tipo di più di 31 caratteri non è registrato, come nel layout (R25)", async () => {
  const long = `lungo-${"a".repeat(26)}`;
  assert.equal(long.length, 32);
  const fits = `lungo-${"a".repeat(25)}`;
  await loadModuleWidgets(page([{ id: "lungo", name: "Lungo", state: "off", file: null, types: [spec(long), spec(fits)] }]));
  assert.equal(moduleWidgetSpec(long), null);
  assert.ok(moduleWidgetSpec(fits));
});

test("loadModuleWidgets: un widget scartato all'avvio dice quale percorso non è una route GET del modulo (R18)", async () => {
  const { moduleProblemText } = await import("../public/module-widgets.js");
  await loadModuleWidgets(
    page([
      // every widget dropped: no file to load
      { id: "tutti", name: "Tutti", state: "on", file: null, types: [spec("tutti-w", { dropped: "/api/altro/x" })] },
      // one kept, one dropped: the file draws the kept one
      { id: "mezzi", name: "Mezzi", state: "on", file: renderers(["mezzi-ok", "mezzi-ko"]), types: [spec("mezzi-ok"), spec("mezzi-ko", { dropped: "/api/status" })] },
    ]),
  );
  assert.deepEqual(moduleWidgetProblem("tutti-w"), { kind: "route", name: "Tutti", path: "/api/altro/x" });
  assert.deepEqual(moduleWidgetProblem("mezzi-ko"), { kind: "route", name: "Mezzi", path: "/api/status" });
  assert.equal(moduleRenderer("mezzi-ko"), null, "scartato: niente renderer anche se il file lo disegna");
  assert.ok(moduleRenderer("mezzi-ok"));
  assert.equal(moduleWidgetProblem("mezzi-ok"), null);
  assert.deepEqual(moduleRequests({ id: "k", type: "mezzi-ko" }, { range: "day" }, NOW), [], "nessuna richiesta");
  assert.equal(
    moduleProblemText(moduleWidgetProblem("tutti-w"), "tutti-w"),
    t("Il widget {type} legge {path}, che non è una route GET del modulo", { type: "tutti-w", path: "/api/altro/x" }),
  );
});

test("wrap: il resize del renderer del modulo passa, col ctx ristretto; senza resize non c'è (R21)", async () => {
  const src = `const log = (globalThis.__mwResize ??= []);
export default {
  "rs-con": { mount() {}, update() {}, resize(root, ctx) { log.push([root, ctx]); } },
  "rs-senza": { mount() {}, update() {} },
};`;
  await loadModuleWidgets(page([{ id: "rs", name: "Rs", state: "on", file: file(src), types: [spec("rs-con"), spec("rs-senza")] }]));
  const r = moduleRenderer("rs-con");
  assert.equal(typeof r.resize, "function");
  assert.equal("resize" in moduleRenderer("rs-senza"), false);
  (globalThis.__mwResize ??= []).length = 0;
  const root = {};
  r.resize(root, { widget: { id: "w", settings: {} }, title: "T", settings: { range: "day" }, paths: ["/api/x?from=day"], data: (p) => (p === "/api/x?from=day" ? { value: 1 } : undefined), inst: {}, slotFor() {} });
  const [[got, ctx]] = globalThis.__mwResize;
  assert.equal(got, root);
  assert.ok(Object.isFrozen(ctx));
  assert.deepEqual(Object.keys(ctx).sort(), ["data", "inst", "settings", "title", "widget"]);
  assert.deepEqual(ctx.data("/api/x?from={from}"), { value: 1 });
});

test("widgetContext: il ctx ristretto che il test kit dà ai moduli, congelato, con i soli percorsi dichiarati", () => {
  const read = [];
  const grid = { widget: { id: "w", type: "rs-con", settings: { a: 1, range: "dashboard" } }, title: "T", settings: { range: "day" }, paths: ["/api/x?from=day"], data: (p) => (read.push(p), { value: 1 }), inst: { keep: true }, slotFor() {} };
  const ctx = widgetContext(spec("rs-con"), grid);
  assert.deepEqual(Object.keys(ctx).sort(), ["data", "inst", "settings", "title", "widget"]);
  assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.widget) && Object.isFrozen(ctx.widget.settings) && Object.isFrozen(ctx.settings));
  assert.deepEqual(ctx.settings, { a: 1, range: "day" }, "le impostazioni risolte vincono su quelle salvate");
  assert.equal(ctx.widget.settings.range, "dashboard", "il widget salvato resta com'era");
  assert.equal(ctx.inst, grid.inst);
  assert.deepEqual(ctx.data("/api/x?from={from}"), { value: 1 }, "il percorso dichiarato, risolto dalla griglia");
  assert.deepEqual(ctx.data("/api/x?from=day"), { value: 1 }, "o già risolto");
  assert.equal(ctx.data("/api/altro"), undefined, "un percorso non dichiarato non esce");
  assert.deepEqual(read, ["/api/x?from=day", "/api/x?from=day"]);
});

test("live: un cambiamento del tipo <id del modulo> rilegge i percorsi dei suoi widget in Adesso (R22)", async () => {
  await loadModuleWidgets(page([...MODULES(), { id: "altro", name: "Altro", state: "on", file: renderers(["altro-w"]), types: [spec("altro-w", { data: ["/api/altro/{from}/x"] })] }]));
  const { requests } = await drawGrid([at("m1", "acceso-grafico"), at("m2", "altro-w", 4), at("k", "kpis", 0)]);
  const paths = [...requests, "/api/status"];
  assert.ok(paths.includes("/api/x?from=day") && paths.includes("/api/altro/day/x"), paths.join(" "));
  const ids = ["acceso", "altro"];
  const plan = (kind) =>
    planRead(paths, { kinds: new Set([kind]), have: new Set(paths), readAt: new Map(paths.map((p) => [p, NOW])), now: NOW + 60_000, extra: (k) => kindPaths(k, sourceState, ids, moduleLivePaths(k, paths)) }).read; // as dashboard-live.js wires it
  assert.deepEqual(moduleLivePaths("acceso", paths), ["/api/x"], "the endpoint, as touchedBy compares them");
  assert.deepEqual(moduleLivePaths("x", paths), [], "a module that is off draws nothing");
  assert.deepEqual(plan("acceso"), ["/api/x?from=day", "/api/status"], "solo i percorsi dei widget del modulo, e lo stato");
  assert.deepEqual(plan("altro"), ["/api/altro/day/x", "/api/status"], "{from} anche nel percorso");
});

// ---------- the grid ----------

/** Just enough DOM for createGrid's renderGrid and drawWidget: elements, text, classes, data-*, a few selectors. */
async function withGridDom(fn) {
  class Node {
    parentElement = null;
  }
  class Text extends Node {
    constructor(data) {
      super();
      this.data = String(data);
    }
    get textContent() {
      return this.data;
    }
  }
  class Element extends Node {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attrs = {};
      this.dataset = {};
      this.style = { setProperty(k, v) { this[k] = v; } };
      this.className = "";
      this.connected = false;
      const names = () => this.className.split(/\s+/).filter(Boolean);
      this.classList = {
        contains: (c) => names().includes(c),
        add: (...cs) => (this.className = [...new Set([...names(), ...cs])].join(" ")),
        remove: (...cs) => (this.className = names().filter((n) => !cs.includes(n)).join(" ")),
        toggle: (c, on) => {
          const want = on === undefined ? !names().includes(c) : Boolean(on);
          if (want) this.classList.add(c);
          else this.classList.remove(c);
          return want;
        },
      };
    }
    get textContent() {
      return this.children.map((c) => c.textContent).join(" ");
    }
    set textContent(v) {
      this.replaceChildren(new Text(v));
    }
    get isConnected() {
      for (let n = this; n; n = n.parentElement) if (n.connected) return true;
      return false;
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    }
    getAttribute(k) {
      return this.attrs[k] ?? (k.startsWith("data-") ? (this.dataset[k.slice(5)] ?? null) : null);
    }
    addEventListener() {}
    append(...nodes) {
      for (const n of nodes) {
        const node = n instanceof Node ? n : new Text(n);
        node.parentElement?.removeChild(node);
        node.parentElement = this;
        this.children.push(node);
      }
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
    matches(sel) {
      const attr = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
      if (attr) return this.getAttribute(attr[1]) === attr[2];
      if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
      return this.tagName === sel.toUpperCase();
    }
    descendants() {
      return this.children.flatMap((c) => (c instanceof Element ? [c, ...c.descendants()] : []));
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] ?? null;
    }
    querySelectorAll(sel) {
      if (sel.startsWith(":scope > ")) return this.children.filter((c) => c instanceof Element && c.matches(sel.slice(9)));
      return this.descendants().filter((e) => e.matches(sel));
    }
  }
  const byId = new Map();
  const host = (id) => {
    const n = new Element("div");
    n.connected = true;
    byId.set(id, n);
    return n;
  };
  for (const v of ["adesso", "analisi", "monitor", "prompt", "sessioni", "galleria"]) host(`grid-${v}`);
  host("grid-empty");
  const metric = host("f-metric");
  for (const v of ["cost", "tokens"]) {
    const b = new Element("button");
    b.setAttribute("data-v", v);
    metric.append(b);
  }
  const shell = new Element("div");
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.document = { createElement: (tag) => new Element(tag), createTextNode: (d) => new Text(d), getElementById: (id) => byId.get(id) ?? null, querySelector: (s) => (s === ".shell" ? shell : null) };
  globalThis.Node = Node;
  // the fixed pages (Prompt, Sessioni) mount the core's runs and sessions: stand-ins here, this DOM is too small for them
  const core = { runs: WIDGETS.runs, sessions: WIDGETS.sessions };
  WIDGETS.runs = WIDGETS.sessions = { mount() {}, update() {} };
  try {
    return await fn(byId);
  } finally {
    Object.assign(WIDGETS, core);
    globalThis.document = saved.document;
    globalThis.Node = saved.Node;
  }
}

const fakeApp = () => ({
  state: { page: "dashboard", subview: "adesso", range: 604800000, metric: "tokens", by: "model", slots: {}, feed: [], feedGen: 0 },
  gallery: { tab: () => "adesso", widgets: () => [], isOpen: () => false, status() {} },
  templates: () => null,
  layoutReady: () => true,
  refresh() {},
});

/** A grid whose Adesso holds `widgets` (the other views empty), with `data` already read, drawn once; then `next(grid)`. */
function drawGrid(widgets, data = {}, next = null) {
  return withGridDom(async (byId) => {
    (globalThis.__mw ??= []).length = 0; // emptied in place: each widgets file holds on to this array
    const grid = createGrid(fakeApp());
    const layout = structuredClone(DEFAULT_LAYOUT);
    layout.views.adesso.widgets = widgets;
    layout.views.analisi.widgets = [];
    layout.views.monitor.widgets = [];
    grid.model.layout = layout;
    grid.model.now = NOW;
    for (const [p, body] of Object.entries(data)) grid.model.data.set(p, { body, total: 0 });
    grid.renderGrid();
    await next?.(grid);
    const card = (id) => byId.get("grid-adesso").children.find((n) => n.dataset.id === id) ?? null;
    return { grid, card, calls: globalThis.__mw, requests: grid.viewRequests("adesso", NOW, {}) };
  });
}
const at = (id, type, x = 0) => ({ id, type, x, y: 0, w: 4, h: 4, settings: {} });

test("griglia: widget di modulo acceso disegnato con il suo update", async () => {
  await loadModuleWidgets(page(MODULES()));
  const { card, calls, requests } = await drawGrid([at("m1", "acceso-grafico")], { "/api/x?from=day": { value: 42 } });
  assert.deepEqual(requests, ["/api/x?from=day"], "la vista legge il percorso del modulo, con {from} del giorno di Adesso");
  assert.equal(card("m1").dataset.drawn, "42", "update ha letto il suo dato");
  const kinds = calls.map(([k, type]) => `${k}:${type}`);
  assert.deepEqual(kinds, ["mount:acceso-grafico", "update:acceso-grafico"]);
  const ctx = calls[1][2];
  assert.ok(Object.isFrozen(ctx), "il ctx è congelato");
  assert.deepEqual(Object.keys(ctx).sort(), ["data", "inst", "settings", "title", "widget"]);
  assert.equal(ctx.title, "Grafico acceso-grafico");
  assert.equal(ctx.settings.range, "day");
  assert.deepEqual(ctx.data("/api/x?from=day"), { value: 42 }, "anche col percorso risolto");
  assert.equal(ctx.data("/api/budget"), undefined, "niente dati che il widget non ha dichiarato");
  assert.ok(Object.isFrozen(ctx.widget));
});

test("griglia: widget di modulo spento → riquadro «spento», nessuna richiesta", async () => {
  await loadModuleWidgets(page(MODULES()));
  const { card, calls, requests } = await drawGrid([at("m1", "x-off")]);
  assert.deepEqual(requests, []);
  assert.ok(card("m1"), "il riquadro c'è");
  assert.ok(card("m1").textContent.includes(t("Il modulo {name} è spento: attivalo da Impostazioni › Moduli", { name: "Ics" })), card("m1").textContent);
  assert.deepEqual(calls, []);
  const load = await drawGrid([at("m2", "rotto-w")]);
  assert.deepEqual(load.requests, []);
  assert.ok(load.card("m2").textContent.includes(t("Widget del modulo {name} non caricato", { name: "Rotto" })), "un file che non si carica: l'errore nel riquadro");
});

test("griglia: mount che lancia → errore nel riquadro, gli altri widget disegnati", async () => {
  await loadModuleWidgets(page([{ id: "due", name: "Due", state: "on", file: renderers(["due-ko", "due-ok"], ["due-ko"]), types: [spec("due-ko"), spec("due-ok")] }]));
  const { card, calls } = await drawGrid([at("ko", "due-ko"), at("ok", "due-ok", 4)], { "/api/x?from=day": { value: 7 } });
  assert.ok(card("ko").textContent.includes("Dati non disponibili"), card("ko").textContent);
  assert.equal(card("ko").dataset.drawn, undefined, "update non chiamato dopo un mount fallito");
  assert.equal(card("ok").dataset.drawn, "7");
  assert.ok(calls.some(([k, type]) => k === "update" && type === "due-ok"));
  assert.ok(!calls.some(([k, type]) => k === "update" && type === "due-ko"));
});

test("griglia: tipo di nessuno resta non disegnato come oggi", async () => {
  await loadModuleWidgets(page(MODULES()));
  const { grid, card, requests } = await drawGrid([at("n1", "nessuno-w"), at("m1", "acceso-grafico", 4)], { "/api/x?from=day": { value: 1 } });
  assert.equal(card("n1"), null);
  assert.equal(grid.model.instances.has("n1"), false);
  assert.deepEqual(grid.model.layout.views.adesso.widgets.map((w) => w.id), ["n1", "m1"], "resta nel layout");
  assert.deepEqual(requests, ["/api/x?from=day"]);
});

test("griglia: un riquadro ridisegnato senza renderer non tiene il disegno di prima né un secondo stato", async () => {
  await loadModuleWidgets(page(MODULES()));
  const offText = t("Il modulo {name} è spento: attivalo da Impostazioni › Moduli", { name: "Acceso" });
  const { card } = await drawGrid([at("m1", "acceso-grafico")], { "/api/x?from=day": { value: 3 } }, async (grid) => {
    const node = grid.model.instances.get("m1").el;
    assert.equal(node.querySelectorAll(".drawing").length, 1, "disegnato dal suo renderer");
    // the module goes off, and the widget's settings change: the same card, remounted with no renderer
    await loadModuleWidgets(page(MODULES().map((m) => (m.id === "acceso" ? { ...m, state: "off", file: null } : m))));
    grid.model.layout.views.adesso.widgets = [{ ...at("m1", "acceso-grafico"), settings: { range: "day" } }];
    grid.renderGrid();
  });
  assert.equal(card("m1").querySelectorAll(".drawing").length, 0, "niente del disegno di prima");
  assert.equal(card("m1").querySelectorAll(".w-state").length, 1, "un solo riquadro di stato");
  assert.ok(card("m1").textContent.includes(offText));

  await loadModuleWidgets(page(MODULES()));
  const twice = await drawGrid([at("o1", "x-off")], {}, (grid) => {
    grid.model.layout.views.adesso.widgets = [{ ...at("o1", "x-off"), settings: { range: "day" } }];
    grid.renderGrid();
  });
  assert.equal(twice.card("o1").querySelectorAll(".w-state").length, 1, "un widget spento con altre impostazioni: sempre un solo stato");
});

test("griglia: un widget scartato all'avvio dice il percorso, senza richieste (R18)", async () => {
  await loadModuleWidgets(page([{ id: "tutti", name: "Tutti", state: "on", file: null, types: [spec("tutti-w", { dropped: "/api/altro/x" })] }]));
  const { card, calls, requests } = await drawGrid([at("d1", "tutti-w")]);
  assert.deepEqual(requests, []);
  assert.ok(card("d1").textContent.includes(t("Il widget {type} legge {path}, che non è una route GET del modulo", { type: "tutti-w", path: "/api/altro/x" })), card("d1").textContent);
  assert.deepEqual(calls, []);
});

test("griglia: «Solo {label}» non copre mai un widget di modulo, i suoi dati non sono di OpenCode (R19)", async () => {
  await loadModuleWidgets(page(MODULES()));
  const saved = { ...sourceState };
  Object.assign(sourceState, { id: "demo", label: "Demo", on: true, choice: "only" });
  try {
    const { card } = await drawGrid([at("m1", "acceso-grafico")], { "/api/x?from=day": { value: 42 } });
    assert.equal(card("m1").dataset.drawn, "42", "disegnato con i suoi dati");
    assert.equal(card("m1").classList.contains("costs-hidden"), false);
    assert.ok(!card("m1").textContent.includes("Solo OpenCode"), card("m1").textContent);
  } finally {
    Object.assign(sourceState, saved);
  }
});

test("griglia: un widget di modulo con resize ha il suo ResizeObserver come quelli del nucleo (R21)", async () => {
  const src = `export default { "rso-w": { mount() {}, update() {}, resize() {} } };`;
  await loadModuleWidgets(page([{ id: "rso", name: "Rso", state: "on", file: file(src), types: [spec("rso-w")] }]));
  const observed = [];
  const saved = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe(node) {
      observed.push(node);
    }
    disconnect() {}
  };
  try {
    const { grid, card } = await drawGrid([at("r1", "rso-w")], { "/api/x?from=day": { value: 1 } });
    assert.ok(grid.model.instances.get("r1").observer, "l'observer c'è");
    assert.deepEqual(observed, [card("r1")]);
  } finally {
    globalThis.ResizeObserver = saved;
  }
});
