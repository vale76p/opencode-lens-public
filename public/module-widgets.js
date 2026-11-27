// The widgets the modules bring to the dashboard, in the browser: their specs from the page's JSON tag
// (<script type="application/json" id="lens-module-widgets">, src/module-html.js), their renderers from each active
// module's widgets file, and what stands in for the ones that cannot be drawn (module off, in error, to configure,
// file not loaded). Imports only layout.js and i18n.js: the grid, the editor and the catalogue read it, never the
// other way round. Nothing runs on import: loadModuleWidgets() fills the registry.
import { WIDGET_TYPES, resolveSettings } from "./layout.js";
import { t } from "./i18n.js";

// the one placeholder a data path may hold (src/module-widget-fields.js): the start of the dashboard period
const FROM = "{from}";
// the bound a saved layout puts on a type (layout.js), at most 31 characters
const TYPE = /^[a-z][a-z0-9-]{0,30}$/;
const PROBLEM_STATES = ["off", "error", "unconfigured"];
/** How long a widgets file may take to load: past it (a stalled response, a top-level await that never settles) its widgets count as not loaded. */
export const LOAD_TIMEOUT_MS = 5000;

let specs = new Map(); // type → frozen spec & { module: { id, name } }, every module that declares widgets
let renderers = new Map(); // type → { mount, update, resize? }, only the active modules whose file loaded
let problems = new Map(); // type → { kind, name, detail?, path? }, every declared type without a renderer
let modules = []; // { id, error }: every module of the list, `error` when it is in error (a saved type of it nobody declares says so)

const frozenPair = (v) => (Array.isArray(v) ? Object.freeze([...v]) : v);
const frozenSettings = (s) => (s && typeof s === "object" && !Array.isArray(s) ? Object.freeze(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, frozenPair(v)]))) : undefined);

/** Only the known fields of a spec, frozen; null for an entry that is not a module's widget type. */
function readSpec(raw, module) {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string" || !TYPE.test(raw.type) || Object.hasOwn(WIDGET_TYPES, raw.type)) return null;
  const data = Array.isArray(raw.data) ? raw.data.filter((p) => typeof p === "string") : [];
  const spec = { type: raw.type, label: String(raw.label ?? raw.type), description: String(raw.description ?? ""), size: frozenPair(raw.size), min: frozenPair(raw.min), home: raw.home, data: Object.freeze(data), module };
  const settings = frozenSettings(raw.settings);
  if (settings) spec.settings = settings;
  return Object.freeze(spec);
}

/** The modules of the page's JSON tag; [] without it or when it cannot be read. */
function readList(doc) {
  try {
    const list = JSON.parse(doc?.getElementById?.("lens-module-widgets")?.textContent ?? "[]");
    return Array.isArray(list) ? list.filter((m) => m && typeof m === "object" && typeof m.id === "string" && Array.isArray(m.types)) : [];
  } catch (err) {
    console.error("widget dei moduli: elenco non leggibile", err);
    return [];
  }
}

/**
 * Where a widgets file keeps its renderers by type: `export default { "<type>": { mount, update } }` (the form the
 * template and the guide show), which wins when present, else its named exports (`export { w as "<type>" }`).
 */
const rendererTable = (ns) => (ns?.default && typeof ns.default === "object" ? ns.default : ns);

/** import(file), or a rejection once `ms` have passed: the dashboard, which awaits it, never waits on a stalled file. */
function importWithin(file, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${file}: caricamento oltre ${ms} ms`)), ms);
  });
  return Promise.race([import(file), late]).finally(() => clearTimeout(timer));
}

/**
 * Reads the modules' widgets from the page and imports the widgets file of each active one, all at once: a file
 * that fails to load (a syntax error, a 404, longer than `timeoutMs`) or a declared type it has no `{ mount, update }` for (rendererTable) leaves
 * that type with the «load» problem, and the others load the same. A type the server dropped at start (`dropped`: the
 * path that is not a GET route of its module) has the «route» problem and is never drawn. Never rejects. Every call
 * starts from scratch.
 */
export async function loadModuleWidgets(doc = document, { timeoutMs = LOAD_TIMEOUT_MS } = {}) {
  specs = new Map();
  renderers = new Map();
  problems = new Map();
  const loads = [];
  const list = readList(doc);
  modules = list.map((m) => ({ id: m.id, error: m.state === "error" }));
  for (const m of list) {
    // the Italian source of the module's name: translated where it is shown (moduleProblemText, the editor's badge)
    const name = typeof m.name === "string" && m.name ? m.name : m.id;
    const module = Object.freeze({ id: m.id, name });
    const read = m.types.map((raw) => [readSpec(raw, module), typeof raw?.dropped === "string" ? raw.dropped : null]).filter(([s]) => s && !specs.has(s.type));
    for (const [s] of read) specs.set(s.type, s);
    for (const [s, path] of read) if (path !== null) problems.set(s.type, { kind: "route", name, path });
    const types = read.filter(([, path]) => path === null).map(([s]) => s);
    if (!types.length) continue;
    if (m.state !== "on") {
      const kind = PROBLEM_STATES.includes(m.state) ? m.state : "off";
      for (const s of types) problems.set(s.type, { kind, name });
    } else if (typeof m.file !== "string" || !m.file) {
      for (const s of types) problems.set(s.type, { kind: "load", name });
    } else loads.push({ file: m.file, name, types });
  }
  const got = await Promise.allSettled(loads.map(({ file }) => importWithin(file, timeoutMs)));
  got.forEach((r, i) => {
    const { file, name, types } = loads[i];
    if (r.status === "rejected") console.error(`widget dei moduli: ${file} non caricabile`, r.reason);
    const table = r.status === "fulfilled" ? rendererTable(r.value) : null;
    for (const s of types) {
      const own = table?.[s.type];
      if (own && typeof own.mount === "function" && typeof own.update === "function") {
        renderers.set(s.type, wrap(s, own));
        continue;
      }
      const detail = r.status === "rejected" ? (r.reason?.message ?? String(r.reason)) : `${file}: ${s.type} senza mount e update`;
      if (r.status === "fulfilled") console.error(`widget dei moduli: ${detail}`);
      problems.set(s.type, { kind: "load", name, detail });
    }
  });
}

/**
 * The frozen subset of the grid's ctx (`ctx`: { widget, title, settings, paths, data, inst }, `paths` being the spec's
 * declared paths with {from} resolved) a module's renderer may see — the widget (a frozen copy), its title, its settings
 * resolved, inst, and data(path) of its declared paths only, as declared (with {from}) or as read. The test kit
 * re-exports it, so a module's widgets file is tried with the ctx it gets at run time.
 */
export function widgetContext(spec, ctx) {
  const paths = ctx.paths ?? [];
  const pathOf = (p) => {
    const i = spec.data.indexOf(p);
    if (i >= 0) return paths[i];
    return paths.includes(p) ? p : undefined;
  };
  const widget = ctx.widget ?? {};
  return Object.freeze({
    widget: Object.freeze({ ...widget, settings: Object.freeze({ ...(widget.settings ?? {}) }) }),
    title: ctx.title,
    settings: Object.freeze({ ...(widget.settings ?? {}), ...ctx.settings }),
    data: (p) => {
      const at = pathOf(p);
      return at === undefined ? undefined : ctx.data(at);
    },
    inst: ctx.inst,
  });
}

/**
 * The renderer handed to the grid: the module's own, called with widgetContext() of the grid's ctx. A module's optional
 * `resize(root, ctx)` passes too: the grid then watches the card's size (ResizeObserver) as it does a core widget's
 * with one.
 */
function wrap(spec, own) {
  const narrow = (ctx) => widgetContext(spec, ctx);
  const renderer = { mount: (root, ctx) => own.mount(root, narrow(ctx)), update: (root, ctx) => own.update(root, narrow(ctx)) };
  if (typeof own.resize === "function") renderer.resize = (root, ctx) => own.resize(root, narrow(ctx));
  return Object.freeze(renderer);
}

/** The spec of a module's widget type, with its module ({ id, name }), also for a module that is off; null otherwise. */
export function moduleWidgetSpec(type) {
  return specs.get(type) ?? null;
}

/** The renderer of a module's widget type: only for an active module whose file loaded; null otherwise. */
export function moduleRenderer(type) {
  return renderers.get(type) ?? null;
}

/** The specs of the module widget types that can be drawn (an active module whose file loaded), in the modules' order: what the editor's catalogue offers. */
export function moduleCatalog() {
  return [...specs.values()].filter((s) => renderers.has(s.type));
}

/**
 * Why a module's widget type cannot be drawn: { kind: "off" | "error" | "unconfigured" | "load", name, detail? }, or
 * { kind: "route", name, path } for one dropped at start; null otherwise. `name` is the module's Italian source. A type
 * no module declares belongs to the module whose `id-` is its longest prefix (ids can be prefixes of each other: foo,
 * foo-bar): when that module is in error (with no manifest the server lists it with no types), { kind: "error", name:
 * its id }; otherwise null, a type of nobody.
 */
export function moduleWidgetProblem(type) {
  const own = problems.get(type);
  if (own) return own;
  if (typeof type !== "string" || specs.has(type)) return null;
  const owner = modules.filter((m) => type.startsWith(`${m.id}-`)).reduce((best, m) => (!best || m.id.length > best.id.length ? m : best), null);
  return owner?.error ? { kind: "error", name: owner.id } : null;
}

/** The text a widget of `type` that cannot be drawn shows in its place, the module's name translated with its catalog. */
export function moduleProblemText(problem, type) {
  const name = t(problem.name);
  if (problem.kind === "route") return t("Il widget {type} legge {path}, che non è una route GET del modulo", { type, path: problem.path });
  if (problem.kind === "off") return t("Il modulo {name} è spento: attivalo da Impostazioni › Moduli", { name });
  if (problem.kind === "error") return t("Il modulo {name} è in errore: vedi Impostazioni › Moduli", { name });
  if (problem.kind === "unconfigured") return t("Il modulo {name} è da configurare: vedi Impostazioni › Moduli", { name });
  return t("Widget del modulo {name} non caricato", { name });
}

/**
 * The API paths a module's widget reads, its declared `data` with {from} replaced as requestsFor builds `from`
 * (layout.js): "day" for the budget day, else `now - range` (0 for «tutto»). None for a widget that cannot be drawn.
 */
export function moduleRequests(widget, global, now) {
  const spec = specs.get(widget?.type);
  if (!spec || !renderers.has(widget.type)) return [];
  const { range } = resolveSettings(widget, global);
  const from = range === "day" ? "day" : String(range === 0 ? 0 : now - range);
  return spec.data.map((p) => p.replace(FROM, from));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A declared data path as a pattern of the paths read for it: {from} is "day" or a number of ms (moduleRequests). */
const pathPattern = (p) => new RegExp(`^${p.split(FROM).map(escapeRe).join("(?:day|\\d+)")}$`);

/**
 * The endpoints (the path without its query, live-refresh.js endpointOf) among `paths` (what the grid on screen reads)
 * that the drawable widgets of module `id` read: what a live change of kind `id` (the module's ctx.live.changed) reads
 * again. [] for a module with none on screen.
 */
export function moduleLivePaths(id, paths) {
  const patterns = [...specs.values()].filter((s) => s.module.id === id && renderers.has(s.type)).flatMap((s) => s.data.map(pathPattern));
  if (!patterns.length) return [];
  return [...new Set(paths.filter((p) => patterns.some((re) => re.test(p))).map((p) => String(p).split("?")[0]))];
}

/** The spec of any widget type: the core's (WIDGET_TYPES) or a module's; null for a type nobody declares. */
export const widgetSpec = (type) => WIDGET_TYPES[type] ?? moduleWidgetSpec(type);
