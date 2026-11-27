// Module registry: finds modules/<id>/module.js, judges each manifest, and starts only the enabled ones.
// A module that fails to load or start goes to the "error" state with its reason; the lens and the other
// modules carry on. The core reads only what a module declares: it never imports module code by name.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CORE_PAGES } from "../public/derive.js";
import { Localized } from "../public/i18n.js";
import { RANGES, VIEWS, WIDGET_TYPES } from "../public/layout.js";
import { KNOWN_VARS, MODULE_ID, userModulesDir } from "./config.js";
import { CORE_CHANGE_KINDS, CORE_DIRS, CORE_PATHS, CORE_STATUS_KEYS, SOURCE_RESERVED, SUMMARY_KEYS } from "./core-paths.js";
import { CORE_TOOL_NAMES } from "./mcp/tool-names.js";
import { coreFileNames, settingsContext } from "./module-kit.js";
import { mcpFieldsError } from "./module-mcp-fields.js";
import { checkModuleTables } from "./module-tables.js";
import { widgetFieldsError } from "./module-widget-fields.js";
import { MAX_UPLOAD } from "./update.js";
import { VERSION } from "./version.js";

// the user modules folder lives in config.js (the MCP process needs it and must not load this file)
export { userModulesDir };

export const MODULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "modules");

const MENU_GROUPS = ["dati", "lens"];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
// "GET /api/x", "GET /api/x/*" (every path under /api/x/), "POST /api/x" or "POST /api/x/*" (docs/moduli-custom.md quotes its characters)
export const ROUTE_KEY = /^(GET|POST) \/api\/[a-z0-9/_-]+(\/\*)?$/;
// a variable a module declares in `settings`, and the kinds of field the Moduli card draws
const SETTING_NAME = /^LENS_[A-Z0-9_]+$/;
const SETTING_KINDS = ["text", "secret", "num"];
// what a files() entry is: a file the module writes, a folder it writes, a path it only reads
const FILE_KINDS = ["write", "dir", "read"];
// a module's panel in Impostazioni › Moduli: a file of its public/ folder
const PANEL_FILE = /^[a-z0-9-]+\.js$/;
// a media type a raw POST accepts: type/subtype, no parameters, no wildcard (RFC 9110 token characters, minus "*")
const MEDIA_TYPE = /^[a-z0-9!#$%&'+.^_`|~-]+\/[a-z0-9!#$%&'+.^_`|~-]+$/;
// what a browser sends cross-site without a preflight (CORS-safelisted): the core's CSRF defence is that a write's
// content-type is never one of these, so a module cannot accept them
const SAFELISTED_TYPES = ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"];

/** How long an async start() may take before the module goes to "error" and is stopped (a registry option, for tests). */
export const START_TIMEOUT_MS = 10_000;

const errorMessage = (err) => err?.message ?? String(err);

/** -1 / 0 / 1 comparing two "x.y.z" strings already checked against SEMVER. */
function compareVersions(a, b) {
  const pa = a.match(SEMVER).slice(1).map(Number);
  const pb = b.match(SEMVER).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/**
 * What is wrong with a manifest's `settings` (a Localized), or null. `taken`: variable → id of the module (before
 * this one by id) that declared it; a variable of the core or of an earlier module cannot be declared again.
 */
function settingsError(settings, taken) {
  if (settings === undefined) return null;
  if (!Array.isArray(settings)) return new Localized("settings deve essere un elenco di { name, label, help, kind }");
  const seen = new Set();
  for (const s of settings) {
    const name = s?.name;
    if (typeof name !== "string" || !SETTING_NAME.test(name)) return new Localized("settings: {name} non è il nome di una variabile LENS_… (maiuscole, cifre, _)", { name: String(name) });
    if (KNOWN_VARS.has(name)) return new Localized("settings: {name} è una variabile del core", { name });
    if (taken.has(name)) return new Localized("settings: {name} è già dichiarata dal modulo {id}", { name, id: taken.get(name) });
    if (seen.has(name)) return new Localized("settings: {name} è ripetuta", { name });
    seen.add(name);
    if (typeof s.label !== "string" || !s.label || typeof s.help !== "string" || !SETTING_KINDS.includes(s.kind) || (s.placeholder !== undefined && typeof s.placeholder !== "string")) {
      return new Localized("settings: {name} vuole label, help, kind (text, secret o num) e placeholder facoltativo, tutti testi", { name });
    }
    for (const bound of ["min", "max"]) {
      if (s[bound] === undefined) continue;
      if (s.kind !== "num" || !Number.isSafeInteger(s[bound])) return new Localized("settings: {name} accetta {bound} solo come intero e solo con kind num", { name, bound });
    }
    if (s.min !== undefined && s.max !== undefined && s.min > s.max) return new Localized("settings: {name} ha min maggiore di max", { name });
  }
  return null;
}

// the widget types of the dashboard and every setting key they use: a module's widget neither takes the first nor
// reuses the second (title and range aside)
const CORE_WIDGET_TYPES = Object.keys(WIDGET_TYPES);
const CORE_SETTING_KEYS = [...new Set(Object.values(WIDGET_TYPES).flatMap((spec) => Object.keys(spec.settings ?? {})))];

/**
 * Every top-level field of a manifest that manifestError() reads (mcpFieldsError and widgetFieldsError included): the
 * contract a module writes to. docs/moduli-custom.md names each one; test/module-guide.test.js checks both lists.
 */
export const MANIFEST_FIELDS = Object.freeze(["id", "name", "description", "lens", "menu", "page", "server", "settings", "mcp", "mcpTools", "mcpInstructions", "mcpExamples", "mcpPrompts", "notice", "settingsPanel", "tables", "source", "widgets", "widgetsFile"]);

/** What is wrong with the manifest found in folder `id` (a Localized), or null when it is usable by this lens version. */
function manifestError(m, id, version, taken = new Map(), takenTypes = new Map()) {
  if (!m || typeof m !== "object") return new Localized("module.js non esporta un manifesto");
  if (m.id !== id) return new Localized("id {found} diverso dalla cartella {folder}", { found: m.id, folder: id });
  if (CORE_PAGES.includes(id) || VIEWS.includes(id)) return new Localized("id {id} riservato a una pagina o a una vista del core", { id });
  if (CORE_STATUS_KEYS.includes(id)) return new Localized("id {id} riservato a una chiave di /api/status", { id });
  if (CORE_CHANGE_KINDS.includes(id)) return new Localized("id {id} riservato a un tipo di modifica del core", { id });
  const missing = [];
  for (const k of ["name", "description", "lens"]) if (typeof m[k] !== "string" || !m[k]) missing.push(k);
  if (!m.menu || !MENU_GROUPS.includes(m.menu.group)) missing.push("menu.group");
  if (!Number.isFinite(m.menu?.order)) missing.push("menu.order");
  if (typeof m.menu?.icon !== "string") missing.push("menu.icon");
  if (typeof m.page?.title !== "string" || !m.page.title) missing.push("page.title");
  if (typeof m.server !== "function") missing.push("server");
  if (missing.length) return new Localized("campi mancanti o non validi nel manifesto: {fields}", { fields: missing.join(", ") });
  if (!SEMVER.test(m.lens)) return new Localized("versione minima {lens} non valida (atteso x.y.z)", { lens: m.lens });
  if (SEMVER.test(version) && compareVersions(m.lens, version) > 0) return new Localized("richiede la lens {lens} o successiva (questa è la {version})", { lens: m.lens, version });
  if (m.notice !== undefined && (typeof m.notice !== "string" || !m.notice)) return new Localized("notice deve essere un testo");
  if (m.settingsPanel !== undefined && (typeof m.settingsPanel !== "string" || !PANEL_FILE.test(m.settingsPanel))) return new Localized("settingsPanel deve essere il nome di un file .js della cartella public del modulo");
  if (m.tables !== undefined && typeof m.tables !== "function") return new Localized("tables deve essere una funzione che importa tables.js");
  const mcp = mcpFieldsError(m);
  if (mcp) return new Localized(mcp.text, mcp.params);
  const widgets = widgetFieldsError(m, { coreTypes: CORE_WIDGET_TYPES, coreKeys: CORE_SETTING_KEYS, ranges: RANGES, takenTypes });
  if (widgets) return new Localized(widgets.text, widgets.params);
  return sourceError(m.source, id) ?? settingsError(m.settings, taken);
}

/**
 * What is wrong with a manifest's `source` (a Localized), or null. The source is chosen with ?<id>=1|only and adds a
 * block <id> to /api/summary: its id can be neither a parameter the core reads nor a key of the summary.
 */
function sourceError(source, id) {
  if (source === undefined) return null;
  if (!source || typeof source !== "object" || typeof source.label !== "string" || !source.label) return new Localized("source deve essere { label }, con label un testo");
  if (SOURCE_RESERVED.includes(id)) return new Localized("id {id} riservato a un parametro del core: non può essere una sorgente", { id });
  if (SUMMARY_KEYS.includes(id)) return new Localized("id {id} riservato a una chiave di /api/summary: non può essere una sorgente", { id });
  return null;
}

/** The variables a module's manifest declares. */
const declaredVars = (manifest) => (manifest?.settings ?? []).map((s) => s.name);

/** The variables declared by the usable modules of `found` (discoverModules), on or off: known to the core, never typos. */
export function moduleVars(found) {
  return new Set(found.flatMap((f) => (f.manifest ? declaredVars(f.manifest) : [])));
}

/**
 * configure(ctx)'s answer made safe: { values: a plain object, errors: Localized[], failed }; a bare string error becomes a
 * Localized of itself, a missing or malformed answer one error and `failed` (the module is broken, not just unconfigured).
 */
function settingsResult(r) {
  if (!r || typeof r !== "object" || (r.errors !== undefined && !Array.isArray(r.errors))) return { values: {}, errors: [new Localized("configure() deve restituire { values, errors }")], failed: true };
  const values = r.values && typeof r.values === "object" && !Array.isArray(r.values) ? r.values : {};
  return { values, errors: (r.errors ?? []).map((e) => (e instanceof Localized ? e : new Localized(String(e?.message ?? e)))), failed: false };
}

/**
 * Why a module's route entry cannot be served, or null: a GET is a function, a POST (exact or under a prefix) a body the
 * core reads and bounds, JSON (`type` "json", the default) or raw bytes of the content-types it lists (`type` "raw").
 */
function routeError(key, value) {
  if (!ROUTE_KEY.test(key)) return "chiave non valida (atteso «GET /api/…», «GET /api/…/*», «POST /api/…» o «POST /api/…/*»)";
  if (key.startsWith("GET ")) return typeof value === "function" ? null : "serve una funzione";
  if (!value || typeof value !== "object" || typeof value.handler !== "function" || !value.body || typeof value.body !== "object") return "una POST si dichiara { handler, body, what }";
  const type = value.body.type ?? "json";
  if (type !== "json" && type !== "raw") return 'body.type deve essere "json" o "raw"';
  const max = value.body.max;
  if (!Number.isInteger(max) || max < 1 || max > MAX_UPLOAD) return `body.max deve essere un intero tra 1 e ${MAX_UPLOAD}`;
  const types = value.body.types;
  if (type === "json" && types !== undefined) return "body.types vale solo con body.type raw";
  if (type === "raw") {
    if (!Array.isArray(types) || !types.length) return "una POST raw elenca i suoi content-type in body.types";
    for (const ct of types) {
      if (typeof ct !== "string" || !MEDIA_TYPE.test(ct.toLowerCase())) return `body.types: ${JSON.stringify(ct)} non è un content-type (tipo/sottotipo, senza parametri né *)`;
      if (SAFELISTED_TYPES.includes(ct.toLowerCase())) return `body.types: ${ct} lo manda anche una pagina di un altro sito, senza preflight`;
    }
  }
  if (typeof value.what !== "string" || !value.what) return "manca what (cosa si modifica, per i messaggi di rifiuto)";
  return null;
}

/** A valid POST's body as the core keeps it: { type: "json", max } or { type: "raw", max, types } with the types lowercased. */
function postBody(body) {
  return body.type === "raw" ? { type: "raw", max: body.max, types: body.types.map((ct) => ct.toLowerCase()) } : { type: "json", max: body.max };
}

/**
 * The core path a module route on `where` ("/api/x", or "/api/x/*" for every path under /api/x/) would touch,
 * or null. Both ways count: the module's path inside a core prefix, or the module's prefix covering a core path.
 * The method does not matter: a core path is the core's for GET and POST alike.
 */
function corePathOf(where) {
  const paths = [...CORE_PATHS.exact, ...CORE_PATHS.writes];
  if (!where.endsWith("/*")) return paths.find((c) => c === where) ?? CORE_PATHS.prefixes.find((c) => where.startsWith(c)) ?? null;
  const prefix = where.slice(0, -1);
  return paths.find((c) => c.startsWith(prefix)) ?? CORE_PATHS.prefixes.find((c) => c.startsWith(prefix) || prefix.startsWith(c)) ?? null;
}

/** Whether `p` is an absolute path strictly inside folder `dir` once resolved ("..", the folder itself and a null `dir` are not). */
function insideDir(dir, p) {
  if (!dir || typeof p !== "string" || !path.isAbsolute(p)) return false;
  const rel = path.relative(dir, path.resolve(p));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Whether `where` (resolved, inside `dataDir`) is the core's: a file of CORE_FILES or the database at `dbPath` with its
 * companions, a folder of CORE_DIRS, or something inside one of those folders; names compared without case.
 */
function coreDataPath(dataDir, where, dbPath) {
  const rel = path.relative(dataDir, where);
  // compared in lower case: APFS (and HFS+) ignore case by default, so Update/ or LENS.DB are the core's too
  const top = rel.split(path.sep)[0].toLowerCase();
  const isTop = rel.split(path.sep).length === 1;
  return CORE_DIRS.some((d) => d.toLowerCase() === top) || (isTop && coreFileNames(dbPath).some((f) => f.toLowerCase() === top));
}

/** decodeURIComponent that returns null instead of throwing on a malformed escape. */
function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * The modules `ids` of `dir`, in that order, with their `origin`: { id, dir, origin, manifest } when usable,
 * { id, dir, origin, error: Localized } otherwise. `taken` is the variables map of the modules judged before,
 * `takenTypes` the same for the widget types (type → id).
 */
async function loadModules(dir, ids, origin, version, taken, takenTypes) {
  const found = [];
  for (const id of ids) {
    const moduleDir = path.join(dir, id);
    try {
      const { default: manifest } = await import(pathToFileURL(path.join(moduleDir, "module.js")).href);
      const error = manifestError(manifest, id, version, taken, takenTypes);
      if (!error) {
        for (const name of declaredVars(manifest)) taken.set(name, id);
        for (const w of manifest.widgets ?? []) takenTypes.set(w.type, id);
      }
      found.push(error ? { id, dir: moduleDir, origin, error } : { id, dir: moduleDir, origin, manifest });
    } catch (err) {
      found.push({ id, dir: moduleDir, origin, error: new Localized("manifesto non caricabile: {error}", { error: errorMessage(err) }) });
    }
  }
  return found;
}

/**
 * The ids of the module folders in `dir`, sorted; [] when it is absent (silently) or unreadable (a warning).
 * `follow`: a symlink to a folder counts as a module folder (the user's folder, where a module is often a link to a
 * working copy); the app's own modules/ never follows links.
 */
async function moduleIds(dir, log, { follow = false } = {}) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== "ENOENT") log.warn(`moduli: cartella ${dir} non leggibile (${errorMessage(err)}), nessun modulo`);
    return [];
  }
  // folders whose name is not an id (Finder copies like "demo 2") are not modules
  const named = entries.filter((e) => MODULE_ID.test(e.name));
  const ids = [];
  for (const e of named) {
    if (e.isDirectory() || (follow && e.isSymbolicLink() && (await fs.stat(path.join(dir, e.name)).then((s) => s.isDirectory(), () => false)))) ids.push(e.name);
  }
  return ids.sort();
}

/**
 * The modules of `dir` (the app's own, origin "core") and then those of `userDir` (the user's, origin "user"), each by
 * id; the variables a module declares are claimed in that order. A user module with the id of a built-in one is not
 * loaded: it goes to `shadowed` ({ id, dir }), and the built-in one wins.
 */
export async function discoverAll(dir = MODULES_DIR, { version = VERSION, log = console, userDir = null } = {}) {
  const taken = new Map(); // variable -> id of the module that declared it first
  const takenTypes = new Map(); // widget type -> id of the module that declared it first
  const found = await loadModules(dir, await moduleIds(dir, log), "core", version, taken, takenTypes);
  const shadowed = [];
  if (userDir) {
    const own = new Set(found.map((f) => f.id));
    const ids = await moduleIds(userDir, log, { follow: true });
    for (const id of ids.filter((i) => own.has(i))) {
      shadowed.push({ id, dir: path.join(userDir, id) });
      log.warn(`moduli: «${id}» in ${userDir} ignorato, esiste un modulo interno con lo stesso id`);
    }
    found.push(...(await loadModules(userDir, ids.filter((i) => !own.has(i)), "user", version, taken, takenTypes)));
  }
  return { found, shadowed };
}

/** Modules in `dir` (and `userDir`, if given), as discoverAll() finds them but without the shadowed ones. */
export async function discoverModules(dir = MODULES_DIR, opts = {}) {
  return (await discoverAll(dir, opts)).found;
}

// Each check imports the files again under a new query: the ESM cache keeps every instance for the life of the process,
// so a module checked a hundred times leaves a hundred copies of its files in memory (a check is rare and by hand)
let checkRuns = 0;

/** Imports `file` bypassing the ESM cache: the URL carries the file's mtime and a counter that never repeats (mtime alone would not tell two writes in the same tick apart). */
async function freshImport(file) {
  const { mtimeMs } = await fs.stat(file);
  return import(`${pathToFileURL(file).href}?v=${mtimeMs}-${++checkRuns}`);
}

/** The module at `file` imported fresh when the file is there, otherwise through the manifest's own import (`viaManifest`, which the cache may serve). */
async function freshOrDeclared(file, viaManifest) {
  return (await isFile(file)) ? freshImport(file) : viaManifest();
}

const isDirectory = (p) => fs.stat(p).then((s) => s.isDirectory(), () => false);
const isFile = (p) => fs.stat(p).then((s) => s.isFile(), () => false);

/**
 * Judges the user module `id` in `userDir` as the lens would at startup, without activating it: { ok, id, dir, errors,
 * warnings } with both lists Localized. `found` is what discoverAll() found at startup: a variable, widget type or MCP
 * tool of a module before this one is an error (as at startup), of a module after it a warning (at the restart that
 * module would lose it); a core tool's name is an error too. `env` and `dbPath` are what configure() is asked
 * with. It imports module.js, tables.js and server/index.js afresh (a corrected file is seen at once, with no restart)
 * and calls at most configure(): never create, start, hasData or files. An `id` that is not a module id touches no disk.
 */
export async function checkUserModule({ id, userDir, found = [], env = process.env, version = VERSION, dbPath = null }) {
  const errors = [];
  const warnings = [];
  let name = null; // the manifest's name, once module.js has loaded (the preview of a modules zip shows it)
  const done = (dir) => ({ ok: errors.length === 0, id: typeof id === "string" ? id : null, name, dir, errors, warnings });
  if (typeof id !== "string" || !MODULE_ID.test(id)) {
    errors.push(new Localized("id non valido"));
    return done(null);
  }
  if (!userDir) {
    errors.push(new Localized("la lens non ha una cartella per i moduli dell'utente (database in memoria)"));
    return done(null);
  }
  const moduleDir = path.join(userDir, id);
  if (!(await isDirectory(moduleDir))) {
    errors.push(new Localized("nessuna cartella {dir}", { dir: moduleDir }));
    return done(moduleDir);
  }
  // a built-in id is never imported from the user's folder (discoverAll leaves it in `shadowed`)
  if (found.some((f) => f.id === id && f.origin === "core") || (await isDirectory(path.join(MODULES_DIR, id)))) {
    errors.push(new Localized("La cartella {dir} ha l'id di un modulo della lens: rinominala", { dir: moduleDir }));
    return done(moduleDir);
  }
  let manifest;
  try {
    manifest = (await freshImport(path.join(moduleDir, "module.js"))).default;
  } catch (err) {
    // ENOENT comes from the stat of module.js: an import that cannot resolve a file says ERR_MODULE_NOT_FOUND
    errors.push(err?.code === "ENOENT" ? new Localized("nessun module.js in {dir}", { dir: moduleDir }) : new Localized("manifesto non caricabile: {error}", { error: errorMessage(err) }));
    return done(moduleDir);
  }
  if (typeof manifest?.name === "string") name = manifest.name;
  // what the other modules hold, as discoverAll() claims it: the built-in ones first, then the user's by id. A name
  // held by one before this module is an error of this module; one held by a module after it, a warning (R38)
  const others = found.filter((f) => f.id !== id && f.manifest);
  const isEarlier = (o) => o.origin !== "user" || o.id < id;
  const earlier = others.filter(isEarlier);
  const later = others.filter((o) => !isEarlier(o));
  const taken = new Map();
  const takenTypes = new Map();
  for (const f of earlier) {
    for (const name of declaredVars(f.manifest)) taken.set(name, f.id);
    for (const w of f.manifest.widgets ?? []) takenTypes.set(w.type, f.id);
  }
  const broken = manifestError(manifest, id, version, taken, takenTypes);
  if (broken) {
    errors.push(broken);
    return done(moduleDir);
  }
  errors.push(...toolErrors(manifest, earlier));
  if (typeof manifest.tables === "function") {
    try {
      const def = (await freshOrDeclared(path.join(moduleDir, "tables.js"), manifest.tables))?.default;
      const refused = checkModuleTables(id, def);
      if (refused) errors.push(refused);
    } catch (err) {
      errors.push(new Localized("tabelle non caricabili: {error}", { error: errorMessage(err) }));
    }
  }
  let entry = null;
  try {
    entry = await freshOrDeclared(path.join(moduleDir, "server", "index.js"), manifest.server);
  } catch (err) {
    errors.push(new Localized("server/index.js non caricabile: {error}", { error: errorMessage(err) }));
  }
  if (entry && typeof entry.create !== "function") errors.push(new Localized("server/index.js deve esportare create(ctx)"));
  if (typeof entry?.configure === "function") {
    try {
      errors.push(...settingsResult(await entry.configure(settingsContext({ id, env, vars: declaredVars(manifest), dbPath }))).errors);
    } catch (err) {
      errors.push(new Localized("impostazioni non verificabili: {error}", { error: errorMessage(err) }));
    }
  }
  // the check really runs the module's top-level code (tables.js only when the manifest declares tables), and cannot
  // see the routes (they are born in create())
  warnings.push(
    typeof manifest.tables === "function"
      ? new Localized("a ogni controllo il codice di primo livello di module.js, tables.js e server/index.js viene eseguito nel processo della lens; i file che server/index.js importa restano quelli caricati all'avvio")
      : new Localized("a ogni controllo il codice di primo livello di module.js e server/index.js viene eseguito nel processo della lens; i file che server/index.js importa restano quelli caricati all'avvio"),
  );
  if (!errors.length) warnings.push(new Localized("le route del modulo nascono in create() e non si controllano qui: una route già presa da un altro modulo si vede solo nel log all'avvio"));
  const known = found.find((f) => f.id === id);
  if (!known) warnings.push(new Localized("il modulo non è ancora tra quelli scoperti: riavvia la lens"));
  else if (known.error && !errors.length) warnings.push(new Localized("all'avvio della lens questo modulo non si era caricato: riavvia la lens per usarlo"));
  else if (known.manifest) warnings.push(new Localized("il modulo è già caricato: le modifiche valgono dopo un riavvio della lens"));
  warnings.push(...laterWarnings(manifest, later));
  warnings.push(...widgetWarnings(manifest, id, others, await isFile(path.join(moduleDir, "public", String(manifest.widgetsFile)))));
  return done(moduleDir);
}

/** The errors of the checked manifest's mcpTools, as Localized: a core tool's name, or a name a module before it by id (`earlier`) declares. */
function toolErrors(manifest, earlier) {
  const out = [];
  for (const name of manifest.mcpTools ?? []) {
    const owner = earlier.find((o) => (o.manifest.mcpTools ?? []).includes(name));
    if (CORE_TOOL_NAMES.includes(name)) out.push(new Localized("il nome dello strumento {name} è del core", { name }));
    else if (owner) out.push(new Localized("mcpTools: {name} è già dichiarato dal modulo {id}", { name, id: owner.id }));
  }
  return out;
}

/**
 * The names of the checked manifest that a module after it by id (`later`) already holds, as Localized warnings: at the
 * restart this module claims them first, so that module goes to error (a variable, a widget type) or, for an MCP tool,
 * loses it (the MCP process drops the second declaration, src/mcp/modules.js).
 */
function laterWarnings(manifest, later) {
  const out = [];
  const held = (o) => ({ vars: declaredVars(o.manifest), types: (o.manifest.widgets ?? []).map((w) => w.type), tools: o.manifest.mcpTools ?? [] });
  const mine = held({ manifest });
  for (const o of later) {
    const theirs = held(o);
    for (const name of [...mine.vars.filter((v) => theirs.vars.includes(v)), ...mine.types.filter((t) => theirs.types.includes(t))]) {
      out.push(new Localized("{name} è già del modulo {id}: al riavvio quel modulo andrebbe in errore", { name, id: o.id }));
    }
    for (const name of mine.tools.filter((t) => theirs.tools.includes(t))) out.push(new Localized("{name} è già del modulo {id}: al riavvio quel modulo perderebbe lo strumento", { name, id: o.id }));
  }
  return out;
}

/**
 * What to tell about the widgets of the checked manifest, as Localized: its widgetsFile missing from public/ (`fileThere`),
 * the data paths that only the startup verifies, and widget types starting with another module's id (a module `foo`
 * declaring `foo-bar-x` while `foo-bar` exists), seen from both modules.
 */
function widgetWarnings(manifest, id, others, fileThere) {
  const mine = Array.isArray(manifest.widgets) ? manifest.widgets : [];
  const out = [];
  if (manifest.widgetsFile !== undefined && !fileThere) out.push(new Localized("widgetsFile {file} non c'è nella cartella public del modulo", { file: manifest.widgetsFile }));
  for (const w of mine) {
    for (const o of others) {
      if (w.type.startsWith(`${o.id}-`)) out.push(new Localized("il tipo {type} comincia con l'id del modulo {id}: i widget dei due moduli potrebbero confondersi", { type: w.type, id: o.id }));
    }
  }
  for (const o of others) {
    for (const w of o.manifest.widgets ?? []) {
      if (w.type.startsWith(`${id}-`)) out.push(new Localized("il modulo {id} dichiara il tipo {type}, che comincia con l'id di questo modulo: i widget dei due moduli potrebbero confondersi", { id: o.id, type: w.type }));
    }
  }
  if (mine.length) out.push(new Localized("i percorsi nel campo data dei widget vengono verificati solo all'avvio"));
  return out;
}

export class ModuleRegistry {
  #enabled;
  #log;
  #startTimeoutMs;
  #env; // the environment the modules are configured from at startup
  #modules = new Map(); // id -> { id, dir, origin, manifest, state, reason, instance, familiesFailed, statusFailed, stateFailed, settings }
  // the route table of the active modules, built by start(); for each path the first module (by id) declaring it
  #routes = new Map(); // exact GET path -> { id, handler }
  #prefixes = []; // [{ prefix: "/api/x/", id, handler }], in declaration order
  #writes = new Map(); // exact POST path -> { id, handler, body, what }
  #writePrefixes = []; // [{ prefix: "/api/x/", id, handler, body, what }], in declaration order
  #shadowed; // [{ id, dir }]: user modules left out because a built-in one has their id
  #dbPath; // the database: ctx.paths.dataDir of configure() comes from it
  #notices = new Set(); // ids whose «was in use» notice is pending (meta module:<id>:notice is the persistence)

  constructor({ found, shadowed = [], enabled, log, env = process.env, startTimeoutMs = START_TIMEOUT_MS, dbPath = null }) {
    this.#dbPath = dbPath;
    this.#shadowed = shadowed.map((s) => ({ ...s }));
    this.#startTimeoutMs = startTimeoutMs;
    this.#enabled = [...enabled];
    this.#log = log;
    this.#env = env;
    for (const f of found) {
      // settings: what configure() said at startup ({ values, errors }), asked once by #settings
      this.#modules.set(f.id, { id: f.id, dir: f.dir, origin: f.origin ?? "core", manifest: f.manifest ?? null, state: f.error ? "error" : "off", reason: f.error ?? null, instance: null, familiesFailed: false, statusFailed: false, stateFailed: false, settings: null });
    }
    const unknown = this.#enabled.filter((id) => !this.#modules.has(id));
    if (unknown.length) log.warn(`LENS_MODULES: moduli non trovati, ignorati: ${unknown.join(", ")}`);
  }

  /** The user modules left out because a built-in one has the same id: [{ id, dir }], a copy. */
  get shadowed() {
    return this.#shadowed.map((s) => ({ ...s }));
  }

  /** The enabled ids as configured, unknown ones included. */
  get enabled() {
    return [...this.#enabled];
  }

  /**
   * Every module found, with its state (on · off · unconfigured: enabled but its settings are incomplete · error); `dir` is the module's folder (/api/modules shows it only for a user's module, to a client on this computer); `origin` is "core" (the app's modules/) or "user" (the folder next to the database). `reason` is null, a Localized or (wrong
   * settings) an array of them (public/i18n.js): render it with errorText() inside the request, so it follows the
   * reader's language. `settings`: the fields the manifest declares, Italian texts for t(); `mcp`: whether it has MCP tools;
   * `mcpPrompts`: whether its MCP file offers prompts;
   * `mcpExamples`: the questions it suggests for them (Italian texts for t()). `manifest`: whether a usable manifest was
   * found (false for a module in error that failed to load: its name is then its id).
   */
  list() {
    return [...this.#modules.values()].map((m) => ({
      id: m.id,
      dir: m.dir,
      origin: m.origin,
      manifest: m.manifest !== null,
      name: m.manifest?.name ?? m.id,
      description: m.manifest?.description ?? "",
      state: m.state,
      reason: m.reason,
      menu: m.manifest?.menu ?? null,
      page: m.manifest?.page ?? null,
      notice: this.#notices.has(m.id),
      noticeMessage: m.manifest?.notice ?? null,
      settingsPanel: m.manifest?.settingsPanel ?? null,
      settings: m.manifest?.settings ?? [],
      mcp: typeof m.manifest?.mcp === "function",
      mcpPrompts: m.manifest?.mcpPrompts === true,
      mcpExamples: Array.isArray(m.manifest?.mcpExamples) ? m.manifest.mcpExamples.filter((x) => typeof x === "string" && x.trim()) : [],
      // an active module's widgets are those whose data it serves (start() drops the others); any other state keeps the manifest's
      widgets: m.state === "on" && m.widgets ? m.widgets : (m.manifest?.widgets ?? []),
      // for an active module, the widgets start() dropped, each with `dropped`: the path that is not a GET route of its
      droppedWidgets: m.state === "on" ? (m.droppedWidgets ?? []) : [],
      widgetsFile: m.manifest?.widgetsFile ?? null,
    }));
  }

  /**
   * The names the modules hold, on or off, whatever their state (a module that failed to load holds only its id):
   * { ids, vars (settings), tools (mcpTools), widgetTypes }, each sorted. What a new module must not take: the server adds
   * the core's own (GET /api/modules/authoring).
   */
  taken() {
    const ids = [];
    const vars = new Set();
    const tools = new Set();
    const widgetTypes = new Set();
    for (const m of this.#modules.values()) {
      ids.push(m.id);
      for (const name of declaredVars(m.manifest)) vars.add(name);
      for (const name of Array.isArray(m.manifest?.mcpTools) ? m.manifest.mcpTools : []) tools.add(name);
      for (const w of Array.isArray(m.manifest?.widgets) ? m.manifest.widgets : []) if (typeof w?.type === "string") widgetTypes.add(w.type);
    }
    return { ids: ids.sort(), vars: [...vars].sort(), tools: [...tools].sort(), widgetTypes: [...widgetTypes].sort() };
  }

  activeIds() {
    return this.#active().map((m) => m.id);
  }

  #active() {
    return [...this.#modules.values()].filter((m) => m.state === "on");
  }

  /**
   * configure(ctx) of module `m` on `env`: { values, errors, failed }. A module without configure has no values; one whose
   * configure throws has that error (and `failed`: the module is broken, while `errors` alone mean "to configure"). A Node entry that does not load gives nothing here: start() and hasData() say why.
   */
  async #configure(m, env) {
    let entry;
    try {
      entry = await m.manifest.server();
    } catch {
      return { values: {}, errors: [], failed: false };
    }
    if (typeof entry?.configure !== "function") return { values: {}, errors: [], failed: false };
    try {
      return settingsResult(await entry.configure(settingsContext({ id: m.id, env, vars: declaredVars(m.manifest), dbPath: this.#dbPath })));
    } catch (err) {
      return { values: {}, errors: [new Localized("impostazioni non verificabili: {error}", { error: errorMessage(err) })], failed: true };
    }
  }

  /** The settings of module `m` on the startup environment, asked once. */
  async #settings(m) {
    m.settings ??= await this.#configure(m, this.#env);
    return m.settings;
  }

  /** The ctx of module `m` from `makeCtx`, with its variables and settings, its checked tables (ctx.writer) and whether it declares a source (ctx.live.feed). */
  #ctx(m, makeCtx) {
    return makeCtx(m.id, { env: this.#env, vars: declaredVars(m.manifest), settings: m.settings?.values ?? {}, tables: m.tables, source: m.manifest?.source !== undefined });
  }

  /**
   * The errors the settings of the modules in `enabled` would have in `env` (the whole environment after a save),
   * as Localized; the modules off are not judged. Nothing changes: configure only reads the values it is given.
   */
  async validateEnv(env, enabled) {
    const errors = [];
    for (const m of this.#modules.values()) {
      if (m.manifest && enabled.includes(m.id)) errors.push(...(await this.#configure(m, env)).errors);
    }
    return errors;
  }

  /**
   * The tables of every module found (on or off: they are created even with the module off, so its data and schema
   * follow the lens), as { id, version, sql, columns } for new Store(…, { moduleTables }). Call it before the Store.
   * A tables.js that does not load, or that checkModuleTables refuses, puts its module in "error" with the reason.
   */
  async tables() {
    const out = [];
    for (const m of this.#modules.values()) {
      if (typeof m.manifest?.tables !== "function") continue;
      let def;
      try {
        def = (await m.manifest.tables())?.default;
      } catch (err) {
        this.#fail(m, new Localized("tabelle non caricabili: {error}", { error: errorMessage(err) }));
        continue;
      }
      const error = checkModuleTables(m.id, def);
      if (error) this.#fail(m, error);
      else {
        m.tables = { version: def.version, sql: def.sql, columns: def.columns }; // its ctx.writer writes the tables this sql creates
        out.push({ id: m.id, ...m.tables });
      }
    }
    return out;
  }

  /** The modules whose tables the Store could not create (store.moduleTableErrors, id → Localized) go to "error". Call it before start(). */
  tableErrors(errors) {
    for (const [id, reason] of errors) {
      const m = this.#modules.get(id);
      if (!m) continue;
      m.tables = undefined; // tables that do not exist: no ctx.writer
      this.#fail(m, reason);
    }
  }

  /** Module `m` in "error" with `reason` (a Localized), logged once. */
  #fail(m, reason) {
    m.state = "error";
    m.reason = reason;
    this.#log.error(`modulo ${m.id}: ${reason.message}`);
  }

  /**
   * Configures every module found (on or off), then loads, creates and starts the enabled ones; one whose settings are
   * wrong or that throws goes to "error", the others carry on.
   */
  async start(makeCtx) {
    for (const m of this.#modules.values()) if (m.manifest) await this.#settings(m);
    for (const m of this.#modules.values()) {
      if (m.state === "error" || !this.#enabled.includes(m.id)) continue;
      if (m.settings.errors.length) {
        // errors alone: the module waits for its settings (like off); a configure that failed is a broken module
        m.state = m.settings.failed ? "error" : "unconfigured";
        m.reason = m.settings.errors.length === 1 ? m.settings.errors[0] : m.settings.errors;
        this.#log[m.settings.failed ? "error" : "warn"](`modulo ${m.id}: impostazioni non valide: ${m.settings.errors.map((e) => e.message).join("; ")}`);
        continue;
      }
      let instance = null;
      try {
        const entry = await m.manifest.server();
        const created = entry.create(this.#ctx(m, makeCtx)) ?? {};
        if (typeof created.then === "function") {
          created.then(null, () => {}); // its rejection is this error, not an unhandled one
          throw new Localized("create() deve restituire il modulo subito, non una promessa");
        }
        instance = created;
        // a source is chosen in the dashboard by the module's state: no source without status(), nor without source()
        if (m.manifest.source !== undefined && (typeof instance.status !== "function" || typeof instance.source !== "function")) {
          throw new Localized("un modulo con source deve esporre status() e source()");
        }
        await this.#withTimeout(instance.start?.()); // an async start that rejects or never ends fails like one that throws
        m.instance = instance;
        m.state = "on";
      } catch (err) {
        m.state = "error";
        m.reason = err instanceof Localized ? err : new Localized("avvio non riuscito: {error}", { error: errorMessage(err) });
        this.#log.error(`modulo ${m.id}: avvio fallito`, err);
        // created but failed in start(): stop whatever it had already begun
        if (instance) await this.#stopOne(m.id, instance);
      }
    }
    const sources = this.#active().filter((m) => m.manifest.source !== undefined);
    if (sources.length > 1) this.#log.warn(`moduli ${sources.map((m) => m.id).join(", ")}: una sola sorgente alla volta, resta quella di ${sources[0].id}`);
    this.#buildRoutes();
    this.#checkWidgets();
  }

  /**
   * A widget reads the module's own API: one with a data path that is not a GET route of its module (a query and
   * {from} aside) is dropped with a warning, the module stays on. Their rest is what list() gives for an active module.
   */
  #checkWidgets() {
    for (const m of this.#active()) {
      const declared = m.manifest.widgets;
      if (!declared) continue;
      m.widgets = [];
      m.droppedWidgets = []; // the dropped entries with the path that is not a route of theirs, for the dashboard's placeholder
      for (const w of declared) {
        const bad = w.data.find((p) => this.route("GET", p.split("?")[0].replace("{from}", ""))?.id !== m.id);
        if (bad === undefined) {
          m.widgets.push(w);
          continue;
        }
        this.#log.warn(`[${m.id}] widget ${w.type}: ${bad} non è una sua route GET, scartato`);
        m.droppedWidgets.push({ ...w, dropped: bad });
      }
    }
  }

  /** The source of the active modules: the first by id that declares one, { id, label, instance }; null without. */
  source() {
    const m = this.#active().find((x) => x.manifest.source !== undefined);
    return m ? { id: m.id, label: m.manifest.source.label, instance: m.instance } : null;
  }

  /**
   * Started module `id` to "error" with `reason` (a Localized), logged once: stopped, its routes gone. For what the core
   * finds wrong after start(), like a source whose views do not open.
   */
  async fail(id, reason) {
    const m = this.#modules.get(id);
    if (m?.state !== "on") return;
    const instance = m.instance;
    m.instance = null;
    this.#fail(m, reason);
    await this.#stopOne(id, instance);
    this.#buildRoutes();
  }

  /** `result` of a start(), or a rejection when it has not settled within the timeout (a sync start cannot be cut short). */
  async #withTimeout(result) {
    if (typeof result?.then !== "function") return result;
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Localized("start() non ha finito entro {seconds} s", { seconds: this.#startTimeoutMs / 1000 })), this.#startTimeoutMs);
    });
    result.then(null, () => {}); // a rejection after the timeout is not an unhandled one
    try {
      return await Promise.race([result, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The route table of the active modules: invalid entries, and those on a core path, are dropped with a warning; the module stays on. */
  #buildRoutes() {
    this.#routes.clear();
    this.#prefixes = [];
    this.#writes.clear();
    this.#writePrefixes = [];
    const owner = new Map();
    for (const m of this.#active()) {
      for (const [key, value] of Object.entries(m.instance.routes ?? {})) {
        const error = routeError(key, value);
        if (error) {
          this.#log.warn(`modulo ${m.id}: route ${key} scartata: ${error}`);
          continue;
        }
        const where = key.slice(key.indexOf(" ") + 1);
        const core = corePathOf(where);
        if (core) {
          this.#log.warn(`modulo ${m.id}: route ${key} scartata: tocca il percorso del core ${core}`);
          continue;
        }
        if (owner.has(key)) {
          this.#log.warn(`route ${key} dichiarata da ${owner.get(key)} e da ${m.id}: resta quella di ${owner.get(key)}`);
          continue;
        }
        owner.set(key, m.id);
        if (key.startsWith("POST ")) {
          const write = { id: m.id, handler: value.handler, body: postBody(value.body), what: value.what };
          if (where.endsWith("/*")) this.#writePrefixes.push({ prefix: where.slice(0, -1), ...write });
          else this.#writes.set(where, write);
        } else if (where.endsWith("/*")) this.#prefixes.push({ prefix: where.slice(0, -1), id: m.id, handler: value });
        else this.#routes.set(where, { id: m.id, handler: value });
      }
    }
  }

  /**
   * After an upgrade, the modules found off that already have data. Meta `module:<id>:notice` of a module
   * judged for the first time becomes "pending" (off and its hasData(ctx) true) or "seen"; an enabled one that
   * was pending becomes "seen". A hasData that throws counts as false. Call it after start(). Returns the
   * pending ids, which list() flags until dismissNotice().
   */
  async notices(makeCtx, store) {
    this.#notices.clear();
    for (const m of this.#modules.values()) {
      if (!m.manifest) continue; // a manifest that does not load cannot be asked: judged once it does
      const key = `module:${m.id}:notice`;
      const saved = store.meta(key);
      if (m.state !== "off") {
        if (saved === undefined || saved === "pending") store.meta(key, "seen");
        continue;
      }
      if (saved === undefined) store.meta(key, (await this.#hasData(m, makeCtx)) ? "pending" : "seen");
      if (store.meta(key) === "pending") this.#notices.add(m.id);
    }
    return [...this.#notices];
  }

  async #hasData(m, makeCtx) {
    // wrong settings: whatever it would find there is not its data
    if ((await this.#settings(m)).errors.length) return false;
    try {
      const entry = await m.manifest.server();
      return typeof entry.hasData === "function" && !!(await entry.hasData(this.#ctx(m, makeCtx)));
    } catch (err) {
      this.#log.error(`modulo ${m.id}: hasData non riuscito`, err);
      return false;
    }
  }

  /**
   * The files every module found (on or off, never started for this) declares with files(ctx): { id, label,
   * path, note, kind, on }, label and note in Italian for t(). `kind` is "write" (default), "dir" or "read"; `on` says whether the module is active. A module whose settings are wrong is not asked: its paths
   * would come from those values. A files() that throws is logged and gives nothing. A "write" entry
   * goes into the uninstall script's `rm -f` and a "dir" one (a folder) into its `rm -rf`, so one without a label, whose
   * path is not inside the data folder (the database's directory; none with ":memory:"), or that is a file or folder of
   * the core (CORE_FILES, the database, CORE_DIRS and what is inside them) is dropped with a warning. A "read" entry
   * (never removed) may be any absolute path; an unknown kind is dropped. A "write" or "dir" path declared again (by a
   * later module by id, or twice by one) is listed once, the first time, with a warning: the uninstall script removes it once.
   */
  async files(makeCtx) {
    const out = [];
    const owner = new Map(); // resolved path -> id of the module that declared it first
    for (const m of this.#modules.values()) {
      if (!m.manifest || (await this.#settings(m)).errors.length) continue;
      let entries;
      let dataDir;
      let dbPath;
      try {
        const entry = await m.manifest.server();
        if (typeof entry.files !== "function") continue;
        const ctx = this.#ctx(m, makeCtx);
        dataDir = ctx.dbPath === ":memory:" ? null : path.dirname(path.resolve(ctx.dbPath));
        dbPath = ctx.dbPath;
        entries = await entry.files(ctx);
        if (!Array.isArray(entries)) throw new TypeError("files() deve restituire un array");
      } catch (err) {
        this.#log.error(`modulo ${m.id}: elenco dei file non riuscito`, err);
        continue;
      }
      for (const f of entries) {
        const kind = f?.kind ?? "write";
        const okPath = kind === "read" ? typeof f.path === "string" && path.isAbsolute(f.path) : insideDir(dataDir, f?.path);
        if (typeof f?.label !== "string" || !f.label || !FILE_KINDS.includes(kind) || !okPath) {
          this.#log.warn(`modulo ${m.id}: file scartato, servono label, kind write, dir o read e un percorso (write e dir: nella cartella dei dati, read: assoluto): ${JSON.stringify(f)}`);
          continue;
        }
        const where = path.resolve(f.path);
        if (kind !== "read" && coreDataPath(dataDir, where, dbPath)) {
          this.#log.warn(`modulo ${m.id}: file scartato, ${where} è un file o una cartella del core`);
          continue;
        }
        if (kind !== "read") {
          if (owner.has(where)) {
            this.#log.warn(`modulo ${m.id}: file scartato, ${where} è dichiarato anche da ${owner.get(where)}: resta la voce di ${owner.get(where)}`);
            continue;
          }
          owner.set(where, m.id);
        }
        out.push({ id: m.id, label: f.label, path: where, note: typeof f.note === "string" && f.note ? f.note : null, kind, on: m.state === "on" });
      }
    }
    return out;
  }

  /** The notice of module `id` closed for good; false when no module with a manifest has that id. */
  dismissNotice(id, store) {
    if (!this.#modules.get(id)?.manifest) return false;
    store.meta(`module:${id}:notice`, "dismissed");
    this.#notices.delete(id);
    return true;
  }

  async #stopOne(id, instance) {
    try {
      await instance.stop?.();
    } catch (err) {
      this.#log.error(`modulo ${id}: arresto fallito`, err);
    }
  }

  /** Stops every active module; a failing stop is logged and does not keep the others from stopping. */
  async stop() {
    for (const m of this.#active()) await this.#stopOne(m.id, m.instance);
  }

  /**
   * The active module's route for a GET/HEAD on `pathname`, or null: { id, handler, rest }. An exact path
   * comes before a prefix; under a prefix `rest` is what follows it, already decoded (it may hold "/" and
   * ".."), "" for the prefix itself and null for a malformed escape; an exact path has no `rest`.
   */
  route(method, pathname) {
    if (method !== "GET" && method !== "HEAD") return null;
    const exact = this.#routes.get(pathname);
    if (exact) return { ...exact, rest: undefined };
    const hit = this.#prefixes.find((r) => pathname.startsWith(r.prefix));
    return hit ? { id: hit.id, handler: hit.handler, rest: decode(pathname.slice(hit.prefix.length)) } : null;
  }

  /**
   * The active module's POST on `pathname`, or null: { id, handler, body: { type, max, types? }, what, rest }. An exact
   * path comes before a prefix; `rest` as for route(): decoded under a prefix ("" for the prefix itself, null for a
   * malformed escape), undefined for an exact path.
   */
  write(pathname) {
    const exact = this.#writes.get(pathname);
    if (exact) return { ...exact, rest: undefined };
    const hit = this.#writePrefixes.find((w) => pathname.startsWith(w.prefix));
    if (!hit) return null;
    const { prefix, ...write } = hit;
    return { ...write, rest: decode(pathname.slice(prefix.length)) };
  }

  /**
   * Whether an active module has a route, GET or POST, on `pathname`. The paths of a module that is not on are not
   * among them: there the core answers 404 to every method, never 405 (they are not in the table of the 405).
   */
  serves(pathname) {
    return this.route("GET", pathname) !== null || this.write(pathname) !== null;
  }

  /** Metric families of the active modules; one whose families() throws is skipped (and logged once). */
  families() {
    return this.#active().flatMap((m) => {
      try {
        return m.instance.families?.() ?? [];
      } catch (err) {
        if (!m.familiesFailed) this.#log.error(`modulo ${m.id}: metriche non disponibili`, err);
        m.familiesFailed = true;
        return [];
      }
    });
  }

  /**
   * What /api/status shows of each active module with status(), by id. One whose status() throws is left out (and
   * logged once): never a failed /api/status.
   */
  statuses() {
    return this.#answers("status", "statusFailed", "stato non disponibile");
  }

  /** What /healthz shows of each active module with state(), a reading without queries, by id; one that throws is left out (logged once). */
  states() {
    return this.#answers("state", "stateFailed", "stato per /healthz non disponibile");
  }

  #answers(method, flag, what) {
    const out = {};
    for (const m of this.#active()) {
      if (typeof m.instance[method] !== "function") continue;
      try {
        const answer = m.instance[method]();
        // tried here, so an answer JSON cannot carry (BigInt, a cycle) fails like a throw instead of a 500 in the server
        // (the answer itself stays as it is: its Localized sentences are translated per reader later)
        JSON.stringify(answer);
        out[m.id] = answer;
      } catch (err) {
        if (!m[flag]) this.#log.error(`modulo ${m.id}: ${what}`, err);
        m[flag] = true;
      }
    }
    return out;
  }

  /** public/lang-<lang>.js of every module found without error, merged; a module without one adds nothing. */
  async catalogs(lang) {
    const out = {};
    if (!/^[a-z]+$/.test(lang)) return out;
    for (const m of this.#modules.values()) {
      if (!m.manifest) continue;
      const file = path.join(m.dir, "public", `lang-${lang}.js`);
      try {
        await fs.access(file);
      } catch {
        continue;
      }
      try {
        Object.assign(out, (await import(pathToFileURL(file).href)).default);
      } catch (err) {
        this.#log.warn(`modulo ${m.id}: catalogo ${lang} non caricabile`, err);
      }
    }
    return out;
  }
}
