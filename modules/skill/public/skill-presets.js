// Skill presets: a named, logical group of library skills with a short brief («what this group is for»). Pure: the
// page uses it to edit the list. The rules the module's server applies too (the limits, the ids, the validation of
// what is saved, the skills a preset lacks) live in preset-rules.js, which has no imports; this file adds the edits of
// the dialog and of the board and the weight of a preset. The id is chosen by the user (it is what the MCP tools take).
import { getLocale, t, tn } from "/module-kit.js";
import { MAX_PRESET_ID, MAX_NAME, MAX_PRESET_SKILLS, MAX_SKILL_PRESETS, MAX_BRIEF, validateSkillPresets as validateWith, validSkillId, PRESET_ID } from "./preset-rules.js";

export { EMPTY_SKILL_PRESETS, MAX_BRIEF, MAX_NAME, MAX_PRESET_SKILLS, MAX_SKILL_PRESETS, missingSkills, PRESET_ID } from "./preset-rules.js";
/** The same as PRESET_TEXT_CAP of the module's MCP tools (mcp/tools.js): code points of skill text in one preset answer (a test keeps the two equal). */
export const PRESET_TEXT_CAP = 40_000;

/** Throws a refusal in Italian: `validation` marks it as a rule broken (not a failure of the connection), `field` names the form field it is about. */
const fail = (message, field) => {
  throw Object.assign(new Error(message), { validation: true, ...(field && { field }) });
};
const key = (name) => name.trim().toLowerCase();
const doc = (presets) => ({ version: 1, presets });

/** Every problem at once, in the page's language, naming the preset; `doc` is the normalized list when `ok` (preset-rules.js). */
export const validateSkillPresets = (input) => validateWith(input, t);

/** A proposal for the id of a preset named `name`: lowercase, runs of other characters become «-», at most 40 characters. */
export function slugFrom(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_PRESET_ID)
    .replace(/-+$/, "");
}

/** The trimmed `name`, or an Error in Italian when it is empty, too long or taken by another preset than `exceptId`. */
function checkedName(list, name, exceptId = null) {
  const clean = String(name ?? "").trim();
  if (clean.length < 1 || clean.length > MAX_NAME) fail(t("Il nome va da 1 a {max} caratteri.", { max: MAX_NAME }), "name");
  if (list.presets.some((p) => p.id !== exceptId && key(p.name) === key(clean))) fail(t("Esiste già un preset con questo nome."), "name");
  return clean;
}

function checkedBrief(brief) {
  if (typeof brief !== "string" || brief.length > MAX_BRIEF) fail(t("Il brief va scritto in al massimo {max} caratteri.", { max: MAX_BRIEF }), "brief");
  return brief;
}

/** A fresh copy of `skills`, or an Error in Italian when it is not a list of at most 30 distinct, valid skill ids. */
function checkedSkills(skills) {
  if (!Array.isArray(skills) || skills.length > MAX_PRESET_SKILLS) fail(t("Un preset ha al massimo {max} skill.", { max: MAX_PRESET_SKILLS }), "skills");
  const seen = new Set();
  for (const id of skills) {
    if (!validSkillId(id)) fail(t("Id di skill non valido: {id}.", { id: JSON.stringify(id) }), "skills");
    if (seen.has(id)) fail(t("Skill ripetuta: {id}.", { id }), "skills");
    seen.add(id);
  }
  return [...skills];
}

const find = (list, id) => list.presets.find((p) => p.id === id) ?? fail(t("Preset sconosciuto."));

/** The list with a new preset; `id` is the user's choice and must be new. */
export function addSkillPreset(list, { id, name, brief = "", skills = [] }) {
  if (typeof id !== "string" || !PRESET_ID.test(id)) fail(t("L'id va da 1 a {max} caratteri: minuscole, cifre e trattini.", { max: MAX_PRESET_ID }), "id");
  if (list.presets.some((p) => p.id === id)) fail(t("Esiste già un preset con questo id."), "id");
  const clean = checkedName(list, name);
  if (list.presets.length >= MAX_SKILL_PRESETS) fail(t("Al massimo {max} preset di skill: eliminane uno.", { max: MAX_SKILL_PRESETS }));
  const preset = { id, name: clean, brief: checkedBrief(brief), skills: checkedSkills(skills) };
  return { doc: doc([...list.presets, preset]), preset };
}

/** The list with `name`, `brief` and `skills` of the preset replaced when given; the others stay. */
export function updateSkillPreset(list, id, { name, brief, skills } = {}) {
  const current = find(list, id);
  const next = {
    ...current,
    ...(name !== undefined && { name: checkedName(list, name, id) }),
    ...(brief !== undefined && { brief: checkedBrief(brief) }),
    ...(skills !== undefined && { skills: checkedSkills(skills) }),
  };
  return doc(list.presets.map((p) => (p.id === id ? next : p)));
}

export function removeSkillPreset(list, id) {
  find(list, id);
  return doc(list.presets.filter((p) => p.id !== id));
}

/** A copy with id «<id>-copia», then «-copia-2» and so on (within 40 characters), named «<name> (copia)», «(copia 2)»… */
export function duplicateSkillPreset(list, id) {
  const source = find(list, id);
  const names = new Set(list.presets.map((p) => key(p.name)));
  const ids = new Set(list.presets.map((p) => p.id));
  for (let n = 1; ; n++) {
    const idSuffix = n === 1 ? "-copia" : `-copia-${n}`;
    const copyId = `${source.id.slice(0, MAX_PRESET_ID - idSuffix.length).replace(/-+$/, "")}${idSuffix}`;
    const nameSuffix = ` ${n === 1 ? t("(copia)") : t("(copia {n})", { n })}`;
    const copyName = `${source.name.slice(0, MAX_NAME - nameSuffix.length).trimEnd()}${nameSuffix}`;
    if (!ids.has(copyId) && !names.has(key(copyName))) return addSkillPreset(list, { id: copyId, name: copyName, brief: source.brief, skills: source.skills });
  }
}

// What the MCP puts around a skill's text (skillBlock and the omission forms in mcp/tools.js). A test runs the real MCP on
// a fake lens and keeps this estimate and its answer together; when skillBlock's frame changes, change this too.
const LISTED_FILES = 10; // the files the lens names for a skill (MAX_LISTED_FILES in server/library.js)
const FILE_PATH_AVG = 35; // the part of a listed file's path after the skill's folder, with its slash: /api/skills does not carry the paths
const DIR_GUESS = 100; // the skill's folder when /api/skills does not carry it
const DESCRIPTION_CAP = 1024;
const len = (s) => Array.from(s).length;
const omittedBody = (id) => `Testo non incluso per dimensione: leggi SKILL.md con il tool read, oppure chiedi preset con skill="${id}".`;
const oneLiner = (id) => `Skill «${id}» non inclusa per dimensione: chiedi preset con skill="${id}".`;
const missingLine = (id) => `Skill «${id}» assente dalla libreria di Lens.`;
const restLine = (n) => `… e altre ${n} skill non incluse: chiedi preset con skill="<id>"`;

/** The lengths of the lines of a skill's block other than its text, from what /api/skills says of the skill. */
function frameLines(id, skill, version) {
  const dir = typeof skill.dir === "string" ? len(skill.dir) : DIR_GUESS;
  const description = Math.min(len(String(skill.description ?? "").trim()), DESCRIPTION_CAP);
  const total = Math.max(0, (Number.isInteger(version?.files) ? version.files : 1) - 1); // the lens counts the files except SKILL.md
  const listed = Math.min(total, LISTED_FILES);
  const more = total - listed;
  return [
    len(`<skill_content name="${id}">`),
    ...(description ? [len("Descrizione: ") + description] : []),
    len("Cartella base di questa skill: ") + dir,
    len("I percorsi relativi (scripts/, references/…) partono da lì."),
    ...(listed ? [len("<skill_files>"), ...Array(listed).fill(len("<file></file>") + dir + FILE_PATH_AVG), len("</skill_files>")] : []),
    ...(more ? [len(`… e altri ${more} file in `) + dir] : []),
    len("</skill_content>"),
  ];
}

/** The length of a block of `lines` (their lengths) with one text line of `text` characters among them (none when 0). */
const joined = (lines, text) => lines.reduce((a, b) => a + b, 0) + lines.length - 1 + (text > 0 ? text + 1 : 0);

/**
 * What the skills `ids` (a preset's, in its order) weigh against the cap of the MCP's answer, modelled on what the MCP
 * does: each skill costs the SKILL.md body length (`mdChars`, of the version in use) plus the lines it adds around it
 * (description, base folder, up to ten file paths, the frame tags), and the preset has a header line. The MCP goes
 * through the skills in order and gives each one in full when it fits what is left, else without its text (the omission
 * form), else in one line; a later, smaller skill may still fit after a big one that did not. `cut` marks the skills that
 * will probably arrive without their text. `used` is what the preset would weigh with every skill in full. `preset`
 * (`{ id, name, brief }`) lets the header be counted. A missing skill is a short line and is never cut; a version without
 * `mdChars` (an old index) counts no text and is `unknown`. An estimate: the paths of the files are guessed from their
 * number, and the MCP has two more limits (bytes and lines) that a text of ordinary size does not reach.
 * @returns {{ used: number, cap: number, cut: number, items: {id: string, chars: number, missing: boolean, unknown: boolean, cut: boolean}[] }}
 */
export function presetWeight(ids, index, preset = null, cap = PRESET_TEXT_CAP) {
  const byId = new Map(index.skills.map((s) => [s.id, s]));
  const rows = ids.map((id) => {
    const skill = byId.get(id);
    if (!skill) return { id, chars: 0, missing: true, unknown: false, forms: [len(missingLine(id)), len(oneLiner(id))] };
    const version = skill.versions.find((v) => v.n === skill.current) ?? skill.versions.at(-1);
    const unknown = !Number.isInteger(version?.mdChars);
    const chars = unknown ? 0 : version.mdChars;
    const lines = frameLines(id, skill, version);
    return { id, chars, missing: false, unknown, forms: [joined(lines, chars), joined(lines, len(omittedBody(id))), len(oneLiner(id))] };
  });
  const header = ids.length
    ? len(`Preset ${preset?.name ?? preset?.id ?? ""} (${preset?.id ?? ""})${preset?.brief ? `: ${preset.brief}` : ""} · skill: `) + ids.reduce((n, id, i) => n + len(id) + (i ? 2 : 0) + (byId.has(id) ? 0 : len(" (assente)")), 0)
    : 0;
  // what the MCP would build, skill by skill, with the room it keeps for the closing line about the ones still to come
  let room = cap - header;
  const items = rows.map((row, i) => {
    const left = rows.length - i - 1;
    const after = left ? 1 + len(restLine(left)) : 0;
    const form = row.forms.findIndex((cost) => 1 + cost + after <= room);
    if (form >= 0) room -= 1 + row.forms[form];
    return { id: row.id, chars: row.chars, missing: row.missing, unknown: row.unknown, cut: !row.missing && form !== 0 };
  });
  const used = ids.length ? rows.reduce((n, row) => n + 1 + row.forms[0], header) : 0;
  return { used, cap, cut: items.filter((i) => i.cut).length, items };
}

const number = (n) => new Intl.NumberFormat(getLocale()).format(n);

/** «12.000 di 40.000 caratteri · stima». */
export const weightText = (w) => t("{used} di {cap} caratteri · stima", { used: number(w.used), cap: number(w.cap) });

/** Why some skills arrive without their text, or null when all of them fit. */
export const cutText = (w) =>
  w.cut
    ? tn(w.cut, "Probabilmente {n} skill arriverà senza testo: il preset supera i {cap} caratteri. Cambia l'ordine o togline qualcuna.", "Probabilmente {n} skill arriveranno senza testo: il preset supera i {cap} caratteri. Cambia l'ordine o togline qualcuna.", { cap: number(w.cap) })
    : null;

/** The colour class of a weight bar (the .meter-fill levels): good, warning from 80%, critical over the cap. */
export const weightLevel = (w) => (w.used > w.cap ? "critical" : w.used >= w.cap * 0.8 ? "warning" : "good");

/** `list` with `id` moved one place (`delta` -1 up, +1 down); a copy, the same order at the ends or for an id that is not there. */
export function moveSkill(list, id, delta) {
  const next = [...list];
  const from = next.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** `list` with `id` added at the end (when `on` and not there yet) or taken out (when not `on`); a copy, the order picked stays. */
export function toggleSkill(list, id, on) {
  const rest = list.filter((s) => s !== id);
  return on ? (list.includes(id) ? [...list] : [...rest, id]) : rest;
}

/**
 * The board moves: where `id` goes when dragged from column `from` to column `to` (a preset id, or null for the library).
 * Returns a new document (the original is never changed) and what happened: "add" (library → preset), "move" or "copy"
 * (preset → another preset), "remove" (preset → library), "reorder" (same preset), or null when there is nothing to do:
 * same position, skill already in the destination (a move then keeps it in the source too), library → library, unknown preset.
 * `index` is the position the skill ends up at in the resulting destination list (null or a non-integer = the end); out-of-range values are clamped.
 * Over MAX_PRESET_SKILLS the document comes back unchanged with an `error` text.
 */
export function placeSkill(doc, { id, from, to, index = null, copy = false }) {
  const same = { doc, change: null };
  const preset = (key) => (key === null ? null : doc.presets.find((p) => p.id === key));
  const src = preset(from);
  const dst = preset(to);
  if ((from !== null && !src) || (to !== null && !dst)) return same;
  const withSkills = (key, skills) => ({ ...doc, presets: doc.presets.map((p) => (p.id === key ? { ...p, skills } : p)) });
  const insert = (list, at) => {
    const rest = list.filter((s) => s !== id);
    const pos = !Number.isInteger(at) ? rest.length : Math.max(0, Math.min(at, rest.length));
    return [...rest.slice(0, pos), id, ...rest.slice(pos)];
  };

  if (to === null) {
    if (!src?.skills.includes(id)) return same;
    return { doc: withSkills(from, toggleSkill(src.skills, id, false)), change: "remove" };
  }
  if (from === to) {
    if (!src.skills.includes(id)) return same;
    const next = insert(src.skills, index);
    if (next.every((s, i) => s === src.skills[i])) return same;
    return { doc: withSkills(from, next), change: "reorder" };
  }
  if (src && !src.skills.includes(id)) return same;
  if (dst.skills.includes(id)) return same;
  if (dst.skills.length >= MAX_PRESET_SKILLS) return { doc, change: null, error: t("Un preset ha al massimo {max} skill.", { max: MAX_PRESET_SKILLS }) };
  let next = withSkills(to, insert(dst.skills, index));
  if (src && !copy) next = { ...next, presets: next.presets.map((p) => (p.id === from ? { ...p, skills: toggleSkill(p.skills, id, false) } : p)) };
  return { doc: next, change: !src ? "add" : copy ? "copy" : "move" };
}
