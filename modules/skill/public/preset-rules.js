// The rules of the skill presets that the browser and the module's server share: the limits, the id, the empty
// document, the validation of what is saved and the skills a preset names that the library lacks. No imports (the
// server imports this file, and Node cannot resolve /module-kit.js): `t` comes in as a parameter, Italian by default.

/** Presets at most, the length of a brief and of a name, skills per preset. */
export const MAX_SKILL_PRESETS = 30;
export const MAX_BRIEF = 500;
export const MAX_PRESET_SKILLS = 30;
export const MAX_NAME = 40;
export const PRESET_ID = /^[a-z0-9-]{1,40}$/;
export const MAX_PRESET_ID = 40;
// Same shape and length as SKILL_ID / MAX_ID of the library (server/ids.js): public/ does not import from server/
export const SKILL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SKILL_ID = 64;
/** Errors returned by validateSkillPresets at most. */
const MAX_ERRORS = 20;

export const EMPTY_SKILL_PRESETS = Object.freeze({ version: 1, presets: Object.freeze([]) });

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const key = (name) => name.trim().toLowerCase();
export const validSkillId = (id) => typeof id === "string" && id.length <= MAX_SKILL_ID && SKILL_ID.test(id);

/** The Italian text with its {placeholders} filled: the default `t` of validateSkillPresets. */
const fill = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : text);

/** Every problem at once, naming the preset, through `t` (Italian by default); `doc` is the normalized list when `ok`. */
export function validateSkillPresets(input, t = fill) {
  if (!isObject(input)) return { ok: false, errors: [t("i preset di skill devono essere un oggetto")] };
  if (input.version !== 1) return { ok: false, errors: [t("versione {version} non supportata (atteso 1)", { version: JSON.stringify(input.version) })] };
  if (!Array.isArray(input.presets)) return { ok: false, errors: [t("presets deve essere un elenco")] };
  if (input.presets.length > MAX_SKILL_PRESETS) return { ok: false, errors: [t("al massimo {max} preset di skill, trovati {n}", { max: MAX_SKILL_PRESETS, n: input.presets.length })] };
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
    if (typeof p.id !== "string" || !PRESET_ID.test(p.id)) errors.push(t("{label}: id non valido (minuscole, cifre e -, al massimo {max})", { label, max: MAX_PRESET_ID }));
    else if (ids.has(p.id)) errors.push(t("{label}: id ripetuto", { label }));
    else ids.add(p.id);
    if (typeof p.name !== "string" || p.name.trim().length < 1 || p.name.trim().length > MAX_NAME) errors.push(t("{label}: il nome va da 1 a {max} caratteri", { label, max: MAX_NAME }));
    else if (names.has(key(p.name))) errors.push(t("{label}: nome già in uso", { label }));
    else names.add(key(p.name));
    if (typeof p.brief !== "string" || p.brief.length > MAX_BRIEF) errors.push(t("{label}: brief deve essere un testo di al massimo {max} caratteri", { label, max: MAX_BRIEF }));
    if (!Array.isArray(p.skills) || p.skills.length > MAX_PRESET_SKILLS) errors.push(t("{label}: skills deve essere un elenco di al massimo {max} id", { label, max: MAX_PRESET_SKILLS }));
    else {
      const seen = new Set();
      for (const id of p.skills) {
        if (!validSkillId(id)) errors.push(t("{label}: id di skill non valido ({id})", { label, id: JSON.stringify(id) }));
        else if (seen.has(id)) errors.push(t("{label}: skill ripetuta ({id})", { label, id }));
        else seen.add(id);
      }
    }
    if (errors.length === before) presets.push({ id: p.id, name: p.name.trim(), brief: p.brief, skills: [...p.skills] });
  }
  if (errors.length) return { ok: false, errors: errors.length > MAX_ERRORS ? [...errors.slice(0, MAX_ERRORS), t("… e altri {n} errori", { n: errors.length - MAX_ERRORS })] : errors };
  return { ok: true, doc: { version: 1, presets } };
}

/** The skills of `preset` that are not in the library `index` (`{ skills: [{ id }] }`), in the preset's order. */
export function missingSkills(preset, index) {
  const known = new Set(index.skills.map((s) => s.id));
  return preset.skills.filter((id) => !known.has(id));
}
