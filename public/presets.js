// Personal presets of the dashboard templates: a named copy of the three views (and of «Mostra i
// costi») that can be applied from the «Modello» menu. Pure module, like layout.js: the browser
// uses it to edit the list and say what is in use, the server to validate what it saves
// (src/presets.js).
import { N_, t } from "./i18n.js";
import { TEMPLATES, VIEWS, costsShown, originOf, sameLayout, templateOf, validateLayout } from "./layout.js";

/** Presets at most, and the length of a name. */
export const MAX_PRESETS = 10;
export const MAX_NAME = 40;
/** Errors returned by validatePresets at most. */
const MAX_ERRORS = 20;
const ID = /^[a-z0-9-]{1,40}$/i;

export const EMPTY_PRESETS = Object.freeze({ version: 1, presets: Object.freeze([]) });

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (message) => {
  throw new Error(message);
};
const key = (name) => name.trim().toLowerCase();
const doc = (presets) => ({ version: 1, presets });

/**
 * What a preset keeps of a layout: the three views and the costs preference, as a fresh unfrozen copy.
 * The views of a newer version and the origin (it belongs to the layout in use) are left out.
 */
export function snapshot(layout) {
  const views = Object.fromEntries(VIEWS.map((v) => [v, structuredClone(layout?.views?.[v])]));
  return { version: 2, views, prefs: { costs: costsShown(layout) } };
}

/** Every problem at once, in Italian, naming the preset; `doc` is the normalized list when `ok`. */
export function validatePresets(input) {
  if (!isObject(input)) return { ok: false, errors: [t("i preset devono essere un oggetto")] };
  if (input.version !== 1) return { ok: false, errors: [t("versione {version} non supportata (atteso 1)", { version: JSON.stringify(input.version) })] };
  if (!Array.isArray(input.presets)) return { ok: false, errors: [t("presets deve essere un elenco")] };
  if (input.presets.length > MAX_PRESETS) return { ok: false, errors: [t("al massimo {max} preset, trovati {n}", { max: MAX_PRESETS, n: input.presets.length })] };
  const errors = [];
  const ids = new Set();
  const names = new Set();
  const presets = [];
  for (const [i, p] of input.presets.entries()) {
    const label = isObject(p) && typeof p.name === "string" && p.name.trim() ? t("preset «{name}»", { name: p.name.trim() }) : t("preset n. {n}", { n: i + 1 });
    if (!isObject(p)) {
      errors.push(t("{label}: deve essere un oggetto", { label }));
      continue;
    }
    const before = errors.length;
    if (typeof p.id !== "string" || !ID.test(p.id)) errors.push(t("{label}: id non valido (lettere, cifre e -, al massimo 40)", { label }));
    else if (ids.has(p.id)) errors.push(t("{label}: id ripetuto", { label }));
    else ids.add(p.id);
    if (typeof p.name !== "string" || p.name.trim().length < 1 || p.name.trim().length > MAX_NAME) errors.push(t("{label}: il nome va da 1 a {max} caratteri", { label, max: MAX_NAME }));
    else if (names.has(key(p.name))) errors.push(t("{label}: nome già in uso", { label }));
    else names.add(key(p.name));
    if (p.base !== null && (typeof p.base !== "string" || p.base.length > 40)) errors.push(t("{label}: base deve essere un testo di al massimo 40 caratteri o null", { label }));
    const v = validateLayout(p.layout);
    if (!v.ok) errors.push(...v.errors.map((e) => t("{label}: {error}", { label, error: e })));
    if (errors.length === before) presets.push({ id: p.id, name: p.name.trim(), base: p.base, layout: snapshot(v.layout) });
  }
  if (errors.length) return { ok: false, errors: errors.length > MAX_ERRORS ? [...errors.slice(0, MAX_ERRORS), t("… e altri {n} errori", { n: errors.length - MAX_ERRORS })] : errors };
  return { ok: true, doc: doc(presets) };
}

/** The trimmed `name`, or an Error in Italian when it is empty, too long or taken by another preset than `exceptId`. */
function checkedName(list, name, exceptId = null) {
  const clean = String(name ?? "").trim();
  if (clean.length < 1 || clean.length > MAX_NAME) fail(t("Il nome va da 1 a {max} caratteri.", { max: MAX_NAME }));
  if (list.presets.some((p) => p.id !== exceptId && key(p.name) === key(clean))) fail(t("Esiste già un preset con questo nome."));
  return clean;
}

const find = (list, id) => list.presets.find((p) => p.id === id) ?? fail(t("Preset sconosciuto."));

function newPresetId() {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `p-${[...bytes].map((b) => abc[b % abc.length]).join("")}`;
}

/** The list with a new preset holding `layout`; `base` is the template it was copied from, if any. */
export function addPreset(list, { name, layout, base = null }) {
  const clean = checkedName(list, name);
  if (list.presets.length >= MAX_PRESETS) fail(t("Al massimo {max} preset: eliminane uno.", { max: MAX_PRESETS }));
  const preset = { id: newPresetId(), name: clean, base, layout: snapshot(layout) };
  return { doc: doc([...list.presets, preset]), preset };
}

export function renamePreset(list, id, name) {
  find(list, id);
  const clean = checkedName(list, name, id);
  return doc(list.presets.map((p) => (p.id === id ? { ...p, name: clean } : p)));
}

export function removePreset(list, id) {
  find(list, id);
  return doc(list.presets.filter((p) => p.id !== id));
}

/** The preset keeps the layout `layout` from now on (name and base stay). */
export function updatePreset(list, id, layout) {
  find(list, id);
  return doc(list.presets.map((p) => (p.id === id ? { ...p, layout: snapshot(layout) } : p)));
}

/** A copy named «<name> (copia)», then «(copia 2)» and so on, within MAX_NAME characters. */
export function duplicatePreset(list, id) {
  const source = find(list, id);
  const taken = new Set(list.presets.map((p) => key(p.name)));
  for (let n = 1; ; n++) {
    const suffix = ` ${n === 1 ? t("(copia)") : t("(copia {n})", { n })}`;
    const name = `${source.name.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(key(name))) return addPreset(list, { name, layout: source.layout, base: source.base });
  }
}

/**
 * `layout` with the three views of `preset`, as a fresh unfrozen copy; the views of a newer version
 * it may carry stay. The costs preference follows the preset, and the origin names it.
 */
export function applyPreset(layout, preset) {
  const prefs = { ...(layout?.prefs ?? {}), costs: costsShown(preset.layout), origin: `p:${preset.id}` };
  return { version: 2, views: { ...(layout?.views ?? {}), ...structuredClone(preset.layout.views) }, prefs };
}

// `name` is the Italian text of a template or of a custom layout (the menu translates it); a preset's name is the user's own
const personal = { kind: null, id: null, name: N_("Personalizzata"), modified: false };

/**
 * What the layout in use is: a template or a preset, as it was saved (`modified: false`) or changed
 * since (`modified: true`), or a personal arrangement. The origin in `prefs` says what it started from;
 * without a match it is the first preset, then the template, that looks like it.
 */
export function resolveMode(layout, list) {
  const entry = (kind, id, name, source) => ({ kind, id, name, source });
  const origin = originOf(layout);
  let from = null;
  if (origin?.startsWith("t:") && Object.hasOwn(TEMPLATES, origin.slice(2))) {
    const id = origin.slice(2);
    from = entry("template", id, TEMPLATES[id].label, TEMPLATES[id].layout);
  } else if (origin?.startsWith("p:")) {
    const p = list.presets.find((x) => x.id === origin.slice(2));
    if (p) from = entry("preset", p.id, p.name, p.layout);
  }
  const shown = ({ kind, id, name }, modified) => ({ kind, id, name, modified });
  if (from && sameLayout(layout, from.source)) return shown(from, false);
  const preset = list.presets.find((p) => sameLayout(layout, p.layout));
  if (preset) return shown(entry("preset", preset.id, preset.name), false);
  const template = templateOf(layout);
  if (template) return shown(entry("template", template, TEMPLATES[template].label), false);
  return from ? shown(from, true) : { ...personal };
}
