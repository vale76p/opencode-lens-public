// The widget fields of a module's manifest (widgets, widgetsFile), judged by the registry (a manifest error). A leaf: it
// imports nothing, so what it needs of the dashboard (the core widget types, the periods) comes in as arguments.

// Marks a text for the translation catalogs (as N_ of public/i18n.js, which this leaf cannot import).
const N_ = (text) => text;

const WIDGETS_FILE = /^[a-z0-9-]+\.js$/;
const TYPE = /^[a-z][a-z0-9-]*$/;
// the longest type a saved layout keeps (public/layout.js: /^[a-z][a-z0-9-]{0,30}$/)
const MAX_TYPE = 31;
// an escaped dot, slash or backslash, in any case: a data path never needs one (ESCAPED_PATH of src/server.js)
const ESCAPED = /%(2e|2f|5c)/i;
// the setting keys a module's widget may use whatever the core's: the title and the period
const OWN_KEYS = ["title", "range"];
const SETTING_KEY = /^[a-z][a-zA-Z0-9]*$/;
const HOMES = ["adesso", "analisi", "both"];
const MAX_WIDGETS = 12;
const MAX_DATA = 4;
const MAX_VALUES = 20;
const MAX_W = 12;
const MAX_H = 40;
// the one placeholder a data path may hold: the start of the dashboard period
const FROM = "{from}";

/** The limits of the widget fields, as GET /api/modules/authoring tells whoever writes a module. */
export const WIDGET_LIMITS = Object.freeze({
  homes: Object.freeze([...HOMES]),
  maxWidgets: MAX_WIDGETS,
  maxDataPaths: MAX_DATA,
  maxValues: MAX_VALUES,
  maxWidth: MAX_W,
  maxHeight: MAX_H,
  maxTypeLength: MAX_TYPE,
  fromPlaceholder: FROM,
});

const isText = (s) => typeof s === "string" && s.trim() !== "";
const inRange = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
const isSize = (v) => Array.isArray(v) && v.length === 2 && inRange(v[0], MAX_W) && inRange(v[1], MAX_H);

/** Whether `p` is a path of the HTTP API: /api/…, no "..", "#", spaces or escaped . / \, at most one {from} and no other braces. */
function isDataPath(p) {
  if (typeof p !== "string" || !p.startsWith("/api/") || p.includes("..") || p.includes("#") || /\s/.test(p) || ESCAPED.test(p)) return false;
  const parts = p.split(FROM);
  return parts.length <= 2 && !parts.some((s) => /[{}]/.test(s));
}

/** What is wrong with the `settings` of widget `type`, or null. `coreKeys`: the setting keys of the core's widget types. */
function settingsError(settings, type, ranges, coreKeys) {
  if (settings === undefined) return null;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return { text: N_("widgets: {type} ha settings non valide: dev'essere un oggetto"), params: { type } };
  for (const [key, values] of Object.entries(settings)) {
    if (key === "title") {
      if (values !== null) return { text: N_("widgets: {type}: settings.title può essere solo null"), params: { type } };
      continue;
    }
    if (!SETTING_KEY.test(key)) return { text: N_("widgets: {type}: settings.{key} non è un nome valido (lettere e cifre, comincia con una minuscola)"), params: { type, key } };
    // a core key (metric, source, by…) means something else to the editor and the grid: not a module's
    if (!OWN_KEYS.includes(key) && coreKeys.includes(key)) return { text: N_("widgets: {type}: settings.{key} è una chiave dei widget del core: usa title, range o un nome tuo"), params: { type, key } };
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_VALUES || !values.every(isText) || new Set(values).size !== values.length) {
      return { text: N_("widgets: {type}: settings.{key} deve essere un elenco da 1 a 20 testi distinti non vuoti"), params: { type, key } };
    }
    // «Dashboard» (follow the view) exists only for the period
    if (key !== "range" && values.includes("dashboard")) return { text: N_("widgets: {type}: settings.{key} non può offrire dashboard, che vale solo per range"), params: { type, key } };
    const unknown = key === "range" ? values.find((v) => !ranges.includes(v)) : undefined;
    if (unknown !== undefined) return { text: N_("widgets: {type}: settings.range ammette solo i periodi della dashboard, non {value}"), params: { type, value: unknown } };
  }
  return null;
}

/** What is wrong with the entry `w` of `widgets` (number `n`, from 1) of module `id`, or null. */
function entryError(w, n, id, { coreTypes, coreKeys, ranges, takenTypes }, seen) {
  if (!w || typeof w !== "object" || Array.isArray(w)) return { text: N_("widgets: la voce {n} deve essere un oggetto"), params: { n } };
  const prefix = `${id}-`;
  const named = typeof w.type === "string";
  if (!named || !w.type.startsWith(prefix) || w.type.length === prefix.length || !TYPE.test(w.type)) {
    return named
      ? { text: N_("widgets: il tipo {type} non è valido: deve essere {prefix}<nome> (minuscole, cifre e -)"), params: { type: w.type, prefix } }
      : { text: N_("widgets: la voce {n} ha un tipo non valido: deve essere {prefix}<nome> (minuscole, cifre e -)"), params: { n, prefix } };
  }
  const type = w.type;
  if (type.length > MAX_TYPE) return { text: N_("widgets: il tipo {type} è troppo lungo: al più 31 caratteri"), params: { type } };
  if (coreTypes.includes(type)) return { text: N_("widgets: il tipo {type} è un tipo del core"), params: { type } };
  if (takenTypes.has(type)) return { text: N_("widgets: il tipo {type} è già dichiarato dal modulo {id}"), params: { type, id: takenTypes.get(type) } };
  if (seen.has(type)) return { text: N_("widgets: il tipo {type} è ripetuto"), params: { type } };
  seen.add(type);
  if (!isText(w.label) || !isText(w.description)) return { text: N_("widgets: {type} vuole label e description, due testi non vuoti"), params: { type } };
  for (const field of ["size", "min"]) {
    if (!isSize(w[field])) return { text: N_("widgets: {type} ha {field} non valido: atteso [larghezza, altezza] interi, larghezza da 1 a 12, altezza da 1 a 40"), params: { type, field } };
  }
  if (w.min[0] > w.size[0] || w.min[1] > w.size[1]) return { text: N_("widgets: {type} ha min maggiore di size"), params: { type } };
  if (!HOMES.includes(w.home)) return { text: N_("widgets: {type} ha home non valida: adesso, analisi o both"), params: { type } };
  const settings = settingsError(w.settings, type, ranges, coreKeys);
  if (settings) return settings;
  if (!Array.isArray(w.data) || w.data.length < 1 || w.data.length > MAX_DATA || !w.data.every(isDataPath)) {
    return { text: N_("widgets: {type} vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {placeholder})"), params: { type, placeholder: FROM } };
  }
  return null;
}

/**
 * What is wrong with the widget fields of manifest `m`, or null. The answer is `{ text, params }`: an Italian template
 * with {placeholders}, which the registry turns into a Localized. `coreTypes`: the widget types of the dashboard;
 * `coreKeys`: the setting keys those types use (a module may reuse only title and range); `ranges`: the periods a
 * widget setting `range` may offer; `takenTypes`: type → id of the module (before this one by id) that declared it.
 */
export function widgetFieldsError(m, { coreTypes = [], coreKeys = [], ranges = [], takenTypes = new Map() } = {}) {
  if (m.widgetsFile !== undefined && (typeof m.widgetsFile !== "string" || !WIDGETS_FILE.test(m.widgetsFile))) {
    return { text: N_("widgetsFile deve essere il nome di un file .js della cartella public del modulo"), params: {} };
  }
  if (m.widgets === undefined) return null;
  if (m.widgetsFile === undefined) return { text: N_("widgets richiede anche widgetsFile, il file .js della cartella public del modulo che li disegna"), params: {} };
  if (!Array.isArray(m.widgets) || m.widgets.length < 1 || m.widgets.length > MAX_WIDGETS) return { text: N_("widgets deve essere un elenco da 1 a 12 widget"), params: {} };
  const seen = new Set();
  for (const [i, w] of m.widgets.entries()) {
    const error = entryError(w, i + 1, m.id, { coreTypes, coreKeys, ranges, takenTypes }, seen);
    if (error) return error;
  }
  return null;
}
