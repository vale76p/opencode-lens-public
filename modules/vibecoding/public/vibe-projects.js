// Projects of Vibe Coding: named groups of working folders, each with a color slot and an optional
// monthly budget. Pure module with no imports, like presets.js: the browser uses it to edit the document,
// the server to validate what it saves (passing its t, so the errors follow the reader's language).

/** Projects, folders (in all projects), characters of a name and color slots (series 1..7) at most. */
export const MAX_PROJECTS = 50;
export const MAX_FOLDERS = 500;
export const MAX_NAME = 60;
export const COLORS = 7;
const MAX_FOLDER = 1024;
/** Errors returned by validateVibeProjects at most. */
const MAX_ERRORS = 20;
const ID = /^p_[a-z0-9]{1,40}$/;

export const EMPTY_VIBE_PROJECTS = Object.freeze({ version: 1, projects: Object.freeze([]) });

/** A real calendar day written YYYY-MM-DD. */
export function isDay(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const key = (name) => name.trim().toLowerCase();
const doc = (projects) => ({ version: 1, projects });

/** The Italian text with its {placeholders} filled: the default `t` of validateVibeProjects. */
const fill = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : text);

/**
 * Every problem at once, naming the project, through `t` (Italian by default); `doc` is the normalized document
 * when `ok`.
 */
export function validateVibeProjects(input, t = fill) {
  if (!isObject(input)) return { ok: false, errors: [t("i progetti devono essere un oggetto")] };
  if (input.version !== 1) return { ok: false, errors: [t("versione {version} non supportata (atteso 1)", { version: JSON.stringify(input.version) })] };
  if (!Array.isArray(input.projects)) return { ok: false, errors: [t("projects deve essere un elenco")] };
  if (input.projects.length > MAX_PROJECTS) return { ok: false, errors: [t("al massimo {max} progetti, trovati {n}", { max: MAX_PROJECTS, n: input.projects.length })] };
  const total = input.projects.reduce((n, p) => n + (isObject(p) && Array.isArray(p.folders) ? p.folders.length : 0), 0);
  if (total > MAX_FOLDERS) return { ok: false, errors: [t("al massimo {max} cartelle in tutto, trovate {n}", { max: MAX_FOLDERS, n: total })] };
  const errors = [];
  const ids = new Set();
  const names = new Set();
  const seen = new Set();
  const projects = [];
  for (const [i, p] of input.projects.entries()) {
    const label = isObject(p) && typeof p.name === "string" && p.name.trim() ? t("progetto «{name}»", { name: p.name.trim() }) : t("progetto n. {n}", { n: i + 1 });
    if (!isObject(p)) {
      errors.push(t("{label}: deve essere un oggetto", { label }));
      continue;
    }
    const before = errors.length;
    if (typeof p.id !== "string" || !ID.test(p.id)) errors.push(t("{label}: id non valido (p_ e poi lettere minuscole e cifre, al massimo 40)", { label }));
    else if (ids.has(p.id)) errors.push(t("{label}: id ripetuto", { label }));
    else ids.add(p.id);
    if (typeof p.name !== "string" || p.name.trim().length < 1 || p.name.trim().length > MAX_NAME) errors.push(t("{label}: il nome va da 1 a {max} caratteri", { label, max: MAX_NAME }));
    else if (names.has(key(p.name))) errors.push(t("{label}: nome già in uso", { label }));
    else names.add(key(p.name));
    if (!Number.isInteger(p.color) || p.color < 1 || p.color > COLORS) errors.push(t("{label}: il colore va da 1 a {max}", { label, max: COLORS }));
    if (p.budget !== null && !(typeof p.budget === "number" && Number.isFinite(p.budget) && p.budget > 0)) errors.push(t("{label}: il budget deve essere un numero maggiore di zero o null", { label }));
    if (!Array.isArray(p.folders)) errors.push(t("{label}: folders deve essere un elenco", { label }));
    else {
      for (const f of p.folders) {
        if (typeof f !== "string" || f.length < 1 || f.length > MAX_FOLDER || f === "?") errors.push(t("{label}: cartella non valida (testo da 1 a {max} caratteri, diverso da «?»)", { label, max: MAX_FOLDER }));
        else if (seen.has(f)) errors.push(t("{label}: la cartella {folder} è già in un altro progetto", { label, folder: f }));
        else seen.add(f);
      }
    }
    // Tolerant on purpose: a bad date must not make the store discard the whole file, so only an unknown kind
    // and due < start are errors; anything else degrades to an ongoing project without dates.
    const kind = p.kind ?? "ongoing";
    let start = null;
    let due = null;
    if (kind !== "ongoing" && kind !== "deadline") errors.push(t("{label}: tipo non valido (ongoing o deadline)", { label }));
    else if (kind === "deadline" && isDay(p.due)) {
      due = p.due;
      start = isDay(p.start) ? p.start : null;
      if (start && due < start) errors.push(t("{label}: la scadenza è prima dell'inizio", { label }));
    }
    if (errors.length === before) projects.push({ id: p.id, name: p.name.trim(), color: p.color, budget: due ? p.budget : kind === "deadline" ? null : p.budget, folders: [...p.folders], kind: due ? "deadline" : "ongoing", start, due });
  }
  if (errors.length) return { ok: false, errors: errors.length > MAX_ERRORS ? [...errors.slice(0, MAX_ERRORS), t("… e altri {n} errori", { n: errors.length - MAX_ERRORS })] : errors };
  return { ok: true, doc: doc(projects) };
}

/** A fresh id: «p_» and eight characters of [a-z0-9]. */
export function newProjectId() {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `p_${[...bytes].map((b) => abc[b % abc.length]).join("")}`;
}

/** The color slot (1..COLORS) used by fewest projects; the lowest on a tie. */
function freeColor(list) {
  const uses = Array.from({ length: COLORS }, (_, i) => list.projects.filter((p) => p.color === i + 1).length);
  return uses.indexOf(Math.min(...uses)) + 1;
}

/** The document with a new project `id` named `name` (no budget, no folders) at the end. */
export function addProject(list, name, id) {
  const project = { id, name: String(name).trim(), color: freeColor(list), budget: null, folders: [], kind: "ongoing", start: null, due: null };
  return doc([...list.projects.map((p) => ({ ...p, folders: [...p.folders] })), project]);
}

const edit = (list, id, change) =>
  doc(list.projects.map((p) => {
    const q = p.id === id ? change(p) : p;
    return { ...q, folders: [...q.folders] };
  }));

export const renameProject = (list, id, name) => edit(list, id, (p) => ({ ...p, name: String(name).trim() }));

/** `budget` is a number above zero, or null for none. */
export const setBudget = (list, id, budget) => edit(list, id, (p) => ({ ...p, budget }));

/** Switches the kind and clears the budget (monthly and total are different things); a deadline gets `due` = today + 30 days if it has none. */
export function setKind(list, id, kind, today) {
  const p = list.projects.find((q) => q.id === id);
  if (!p || (p.kind ?? "ongoing") === kind || (kind !== "ongoing" && kind !== "deadline") || (kind === "deadline" && !isDay(today))) return list;
  return edit(list, id, (q) => {
    if (kind === "ongoing") return { ...q, kind, budget: null, start: null, due: null };
    const due = q.due ?? new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10);
    return { ...q, kind, budget: null, due };
  });
}

/** Sets the dates of a deadline project; anything that would not validate on the next load (non-days, due < start) changes nothing. */
export function setDates(list, id, { start, due }) {
  const p = list.projects.find((q) => q.id === id);
  if (p?.kind !== "deadline" || !isDay(due) || (start !== null && !isDay(start)) || (start !== null && due < start)) return list;
  return edit(list, id, (q) => ({ ...q, start, due }));
}

/**
 * What was typed in the budget field: `{ ok: true, value }` with a number above zero (a comma works as the
 * decimal point: «25,5») or null for an empty field (no budget); `{ ok: false }` for anything else.
 */
export function parseBudget(text) {
  const s = String(text ?? "").trim();
  if (s === "") return { ok: true, value: null };
  if (!/^\d+([.,]\d+)?$/.test(s)) return { ok: false };
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? { ok: true, value: n } : { ok: false };
}

/** The project goes away; its folders are left without a project. */
export const deleteProject = (list, id) => doc(list.projects.filter((p) => p.id !== id).map((p) => ({ ...p, folders: [...p.folders] })));

/** `folder` leaves every project and goes to the end of `toId`; null means «Senza progetto». An unknown `toId` changes nothing. */
export function moveFolder(list, folder, toId) {
  if (toId !== null && !list.projects.some((p) => p.id === toId)) return doc(list.projects.map((p) => ({ ...p, folders: [...p.folders] })));
  return doc(list.projects.map((p) => {
    const folders = p.folders.filter((f) => f !== folder);
    return { ...p, folders: p.id === toId ? [...folders, folder] : folders };
  }));
}

/** The project holding `folder`, or null. */
export const projectOf = (list, folder) => list.projects.find((p) => p.folders.includes(folder)) ?? null;
