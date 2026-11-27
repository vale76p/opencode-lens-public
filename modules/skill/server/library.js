// Skill library: skills in the Agent Skills format (a folder with SKILL.md and optional
// references/, scripts/, assets/) uploaded as zips or as a lone SKILL.md. Pure helpers, then the
// SkillStore: <data>/skills/<id>/<n>/ per version, <data>/skills.json as the index. The core's src/skills.js on the
// module's ctx: ctx.jsonStore for the index, ctx.zip for the zips, ctx.paths.dataDir for the folder, ctx.i18n.t
// for the messages, ctx.log for the log; a SkillError (status, errors) where the core threw a SkillError.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_ID, SKILL_ID } from "./ids.js";

export { MAX_ID, SKILL_ID };

/** A refusal with its HTTP status and its messages (already translated): the routes answer `{ errors }` with it. */
export class SkillError extends Error {
  constructor(status, errors) {
    super(errors.join("; "));
    this.status = status;
    this.errors = errors;
  }
}

export const MAX_SKILLS = 100;
export const MAX_VERSIONS = 20;
export const MAX_DESCRIPTION = 1024; // the Agent Skills limit
export const MAX_NAME = 128; // the display name: the id is capped at 64, a label may be longer but not unbounded
export const MAX_SKILL_MD = 1024 * 1024;
export const MAX_SKILL_ENTRIES = 2000;
export const MAX_LISTED_FILES = 10; // the files detail() names
const REMOVED = ".removed-"; // a skill folder being deleted, set aside under this name first (see remove)
export const MODES = Object.freeze(["version", "overwrite", "new"]);

/** The one place an import mode is validated, with its one message. */
export function checkMode(mode, t) {
  if (!MODES.includes(mode)) throw new SkillError(400, [t("modalità di import non valida: {mode} (ammesse: {modes})", { mode: JSON.stringify(mode), modes: MODES.join(", ") })]);
}

// What a browser or the Finder calls a second copy of SKILL.md («SKILL (1).md», «SKILL copia.md», «SKILL copy 2.md», «SKILL-2.md»): it names nothing
const NAMELESS_FILE = /^skill([ _-]*(\(\d+\)|\d+|(copia|copy)( \d+)?))?\.md$/i;

/** A display name without control characters (white space runs become one space); null when nothing is left. */
function cleanName(raw) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  const name = String(raw ?? "").replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return name === "" ? null : name;
}

/** The name as shown for a skill read back from disk: cleaned and cut to MAX_NAME code points. */
const displayName = (raw) => {
  const name = cleanName(raw);
  return name === null ? null : Array.from(name).slice(0, MAX_NAME).join("");
};

const unquote = (v) => {
  const s = v.trim();
  return s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0] ? s.slice(1, -1) : s;
};

/** The indented (or blank) lines following `lines[from]`, as [lines, index of the first line after them]. */
function indentedBlock(lines, from) {
  let end = from + 1;
  while (end < lines.length && (lines[end].trim() === "" || /^\s/.test(lines[end]))) end++;
  return [lines.slice(from + 1, end), end];
}

/** A block scalar's content: common indentation stripped; `|` keeps the line breaks, `>` folds them to spaces. */
function blockScalar(block, style) {
  const lines = block.map((l) => l.replace(/\s+$/, ""));
  const indents = lines.filter((l) => l !== "").map((l) => l.length - l.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;
  const text = lines.map((l) => l.slice(indent));
  while (text.length && text.at(-1) === "") text.pop();
  return style === "|" ? text.join("\n") : text.filter((l) => l !== "").join(" ");
}

/**
 * The frontmatter of a SKILL.md: only name, description and a flat metadata map are read,
 * every other key is ignored. Without a frontmatter the whole text is the body.
 * @returns {{name: string|null, description: string|null, metadata: Record<string,string>, body: string}}
 */
export function parseFrontmatter(text) {
  const src = text.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
  const none = { name: null, description: null, metadata: {}, body: src };
  const all = src.split("\n");
  if (all[0].trimEnd() !== "---") return none;
  const close = all.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (close < 0) return none;
  const lines = all.slice(1, close);
  const fields = {};
  const metadata = {};
  for (let i = 0; i < lines.length; ) {
    const m = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const [, key, raw] = m;
    const style = /^([|>])[+-]?\d*[ \t]*$/.exec(raw);
    if (style || (key === "metadata" && raw.trim() === "")) {
      const [block, next] = indentedBlock(lines, i);
      if (style) fields[key] = blockScalar(block, style[1]);
      else {
        for (const l of block) {
          const kv = /^ {2}([^\s:][^:]*):[ \t]*(.*)$/.exec(l);
          if (kv) metadata[kv[1].trim()] = unquote(kv[2]);
        }
      }
      i = next;
    } else {
      // a plain scalar may wrap onto the indented lines that follow: they join with one space
      let end = i + 1;
      const parts = [raw.trim()];
      while (end < lines.length && /^\s+\S/.test(lines[end])) parts.push(lines[end++].trim());
      fields[key] = unquote(parts.filter(Boolean).join(" "));
      i = end;
    }
  }
  const field = (k) => (fields[k]?.trim() ? fields[k].trim() : null);
  return { name: field("name"), description: field("description"), metadata, body: all.slice(close + 1).join("\n") };
}

const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID && SKILL_ID.test(id);

/** `s` as a slug: lowercase, runs of anything else as one hyphen, cut to MAX_ID. */
function slug(s) {
  const id = String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID)
    .replace(/-+$/, "");
  return validId(id) ? id : null;
}

/**
 * The skill's id. A frontmatter `name` that follows the Agent Skills rule is the id. Otherwise, as
 * OpenCode does, the zip's root folder (or the file name) names the skill and `name` stays a label;
 * failing that, the `name` itself made into a slug («Code Reviewer» → code-reviewer).
 */
export function skillIdFrom({ name, fallback }, t) {
  if (name != null && validId(name)) return name;
  // a bare SKILL.md names nothing: «skill» would be one skill that every nameless upload piles its versions on
  const fromFallback = fallback == null ? null : slug(fallback);
  const usable = fromFallback !== null && fromFallback !== "skill" ? fromFallback : null;
  if (name != null) {
    const id = usable ?? slug(name);
    if (id !== null && id !== "skill") return id;
    throw new SkillError(400, [t("il campo name del frontmatter non è valido ({name}): minuscole, cifre e trattini, al massimo {max} caratteri", { name: JSON.stringify(name), max: MAX_ID })]);
  }
  if (fallback == null || fromFallback === "skill") {
    throw new SkillError(400, [t("SKILL.md non ha name e non c'è un nome da cui ricavarlo: aggiungi un campo name al frontmatter di SKILL.md")]);
  }
  if (usable === null) {
    throw new SkillError(400, [t("non si ricava un id valido da «{name}»: aggiungi un campo name al frontmatter di SKILL.md", { name: fallback })]);
  }
  return usable;
}

/** Why a zip without SKILL.md at its root or in its only folder is refused: a SKILL.md further down says what to do about it. */
function whyNoSkill(planned, t) {
  const dirs = planned.filter((f) => f.segs.length >= 2 && f.segs.at(-1) === "SKILL.md").map((f) => f.segs.slice(0, -1).join("/"));
  if (dirs.length === 0) return t("lo zip non contiene SKILL.md alla radice o nella sua unica cartella");
  if (dirs.length === 1) return t("lo zip contiene SKILL.md solo dentro «{dir}», troppo annidata: comprimi direttamente la cartella della skill, con SKILL.md al primo livello", { dir: dirs[0] });
  const shown = dirs.slice(0, 5).join(", ");
  return t("lo zip contiene più skill ({dirs}): comprimi la cartella di una sola skill e importala", { dirs: dirs.length > 5 ? `${shown}, …` : shown });
}

/**
 * What would be stored from the zip: SKILL.md at the root or in the only top-level folder.
 * @returns {{root: string|null, files: {rel: string, entry: object, mode: number}[], bytes: number}}
 */
export function planSkill(entries, { t, zip }) {
  const { ZipError } = zip;
  const { roots, files: planned, bytes } = zip.planEntries(entries, { maxEntries: MAX_SKILL_ENTRIES, ignoreGit: true, backslash: true });
  const flat = planned.some((f) => f.segs.length === 1 && f.segs[0] === "SKILL.md");
  const root = flat ? null : roots.size === 1 ? [...roots][0] : undefined;
  if (root === undefined || (root !== null && !planned.some((f) => f.segs.length === 2 && f.segs[0] === root && f.segs[1] === "SKILL.md"))) {
    throw new ZipError(whyNoSkill(planned, t));
  }
  const files = planned.map(({ segs, entry, mode }) => {
    if (root !== null && segs.length < 2) throw new ZipError(t("file fuori dalla cartella della skill: {name}", { name: entry.name }));
    return { rel: (root === null ? segs : segs.slice(1)).join("/"), entry, mode };
  });
  return { root, files, bytes };
}

export const EMPTY_SKILLS = Object.freeze({ version: 1, skills: Object.freeze([]) });

const isCount = (v) => Number.isInteger(v) && v >= 0;

/**
 * The index document: { version: 1, skills: [{ id, name, description, current, currentSince?, versions: [{ n, importedAt, source, files, bytes, hash?, mdChars? }] }] }.
 * `currentSince` (ms) is when the current version became current (import, new version, overwrite, rollback, adoption); absent or non-numeric it is dropped and `list()` falls back to the current version's `importedAt`.
 * `hash` (64 hex) and `mdChars` (a count) are optional and dropped when malformed; any other field, on the
 * document, a skill or a version, is kept as it is (a newer Lens may have written it). The messages go to the log, not to the page.
 * @returns {{ok: true, doc: object} | {ok: false, errors: string[]}}
 */
export function validateSkillIndex(input) {
  const bad = (msg) => ({ ok: false, errors: [msg] });
  if (!input || typeof input !== "object" || input.version !== 1 || !Array.isArray(input.skills)) return bad("indice di skill non riconosciuto");
  const ids = new Set();
  const skills = [];
  for (const s of input.skills) {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || s.id.length > MAX_ID || !SKILL_ID.test(s.id)) return bad("id di skill non valido");
    if (ids.has(s.id)) return bad(`id doppio: ${s.id}`);
    ids.add(s.id);
    if (typeof s.name !== "string" || typeof s.description !== "string") return bad(`${s.id}: name o description mancante`);
    if (!Array.isArray(s.versions) || !s.versions.length) return bad(`${s.id}: nessuna versione`);
    const versions = [];
    for (const v of s.versions) {
      if (!v || !Number.isInteger(v.n) || v.n < 1 || versions.some((x) => x.n === v.n)) return bad(`${s.id}: numero di versione non valido`);
      if (!Number.isFinite(v.importedAt) || !["zip", "md"].includes(v.source) || !isCount(v.files) || !isCount(v.bytes)) return bad(`${s.id}: versione ${v.n} non valida`);
      const version = { ...v };
      // a hash counts only with the marker of the current format (an unmarked one is the older, unframed format: absent)
      if (!isHash(version.hash) || version.hashV !== HASH_V) {
        delete version.hash;
        delete version.hashV;
      }
      if ("mdChars" in version && !isCount(version.mdChars)) delete version.mdChars;
      versions.push(version);
    }
    if (!versions.some((v) => v.n === s.current)) return bad(`${s.id}: la versione corrente non esiste`);
    const skill = { ...s, versions };
    if ("currentSince" in skill && !Number.isFinite(skill.currentSince)) delete skill.currentSince;
    skills.push(skill);
  }
  return { ok: true, doc: { ...input, version: 1, skills } };
}

const SKILLS_WHAT = Object.freeze({ broken: "le skill sono ignorate", none: "non contiene un indice di skill valido", dropped: "sono ignorate" });
// the index next to the database and the library's folder, in ctx.paths.dataDir
export const INDEX = "skills.json";
export const LIBRARY = "skills";

/** The index's JsonStore (in memory with ":memory:"); building it touches nothing on disk. */
const indexStore = (ctx) => ctx.jsonStore({ name: INDEX, validate: validateSkillIndex, empty: () => structuredClone(EMPTY_SKILLS), what: SKILLS_WHAT });

/** Every file under `root` as { rel (forward slashes), size, mode (0o755 with an execute bit, else 0o644) }, sorted by rel. */
function walk(root) {
  const out = [];
  const visit = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full, `${prefix}${e.name}/`);
      else if (e.isFile()) {
        const st = fs.statSync(full);
        out.push({ rel: `${prefix}${e.name}`, size: st.size, mode: st.mode & 0o111 ? 0o755 : 0o644 });
      }
    }
  };
  visit(root, "");
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/**
 * `files` (walk's output, sorted by path) in the order a reader should hear about them: the documents and
 * scripts first (references/, scripts/, loose files), then assets/, then hidden files and backups
 * (a dot name anywhere in the path, `*.bak`, `*~`). Stable inside each group.
 */
function byRole(files) {
  const rank = (rel) => {
    const segs = rel.split("/");
    if (segs.some((s) => s.startsWith(".")) || /\.bak$|~$/.test(segs.at(-1))) return 2;
    return segs[0] === "assets" && segs.length > 1 ? 1 : 0;
  };
  return files.map((f) => [rank(f.rel), f]).sort((a, b) => a[0] - b[0]).map(([, f]) => f);
}

// The format of `hash`, stored next to it as `hashV`: 2 frames every file with its size (1, the unframed one, was never released)
const HASH_V = 2;

/**
 * The content hash of a version folder: sha256 over its files in path order, each as the path, a NUL, the
 * mode bits in octal («755» or «644»), a NUL, the size in bytes in decimal, a NUL and the bytes. Two folders
 * with the same files, bytes and execute bits hash the same, whatever order a zip listed them in (`modes: false` leaves the bits out, to tell a change of bits only); the size
 * keeps the records apart, so no file's bytes can pass for the records that follow it.
 */
function hashDir(root, files = walk(root), { modes = true } = {}) {
  const h = createHash("sha256");
  for (const f of files) {
    const data = fs.readFileSync(path.join(root, f.rel));
    h.update(f.rel).update("\0").update(modes ? f.mode.toString(8) : "").update("\0").update(String(data.length)).update("\0").update(data);
  }
  return h.digest("hex");
}

/** The length in code points of the body of the SKILL.md in `root`, frontmatter not counted. */
const mdCharsOf = (root) => Array.from(parseFrontmatter(fs.readFileSync(path.join(root, "SKILL.md"), "utf8")).body).length;

/** What a version folder is worth in the index: { hash, hashV, mdChars }. */
const statsOfDir = (root) => ({ hash: hashDir(root), hashV: HASH_V, mdChars: mdCharsOf(root) });

const isHash = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** Whether a version entry has both figures, the hash in the current format. */
const hasStats = (v) => isHash(v.hash) && v.hashV === HASH_V && isCount(v.mdChars);

const absent = (err) => err.code === "ENOENT" || err.code === "ENOTDIR";

/** Whether `p` exists; an error other than «not there» (permissions…) is thrown, it must not read as «gone». */
function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch (err) {
    if (absent(err)) return false;
    throw err;
  }
}

/** The names in `dir`; none when it is not there or is not a folder. */
function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    if (absent(err)) return [];
    throw err;
  }
}

const checkSkillMdSize = (size, t) => {
  if (size > MAX_SKILL_MD) throw new SkillError(400, [t("SKILL.md è troppo grande (oltre {n} MiB)", { n: MAX_SKILL_MD / 1024 / 1024 })]);
};

/** SKILL.md as text, from a Buffer or a string: at most 1 MiB, valid UTF-8. */
function skillMdText(src, t) {
  checkSkillMdSize(typeof src === "string" ? Buffer.byteLength(src) : src.length, t);
  if (typeof src === "string") return src;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(src);
  } catch {
    throw new SkillError(400, [t("SKILL.md non è UTF-8 valido")]);
  }
}

/**
 * The frontmatter of a SKILL.md being imported (a skill without description is refused) and the id it gets.
 * A `name` that is no valid id is a label: `byName(label)`, when given, may name the existing skill that carries it.
 */
function describeSkill(text, fallback, t, byName = null) {
  const fm = parseFrontmatter(text);
  fm.name = cleanName(fm.name);
  if (fm.name !== null && Array.from(fm.name).length > MAX_NAME) throw new SkillError(400, [t("name troppo lungo (al massimo {max} caratteri)", { max: MAX_NAME })]);
  const id = (fm.name !== null && !validId(fm.name) ? byName?.(fm.name) : null) ?? skillIdFrom({ name: fm.name, fallback }, t);
  if (!fm.description) throw new SkillError(400, [t("SKILL.md non ha description: senza, il modello non sa quando usarla")]);
  if (Array.from(fm.description).length > MAX_DESCRIPTION) throw new SkillError(400, [t("description troppo lunga (al massimo {max} caratteri)", { max: MAX_DESCRIPTION })]);
  return { fm, id };
}

/** A version number given as an integer or as digits (a query string); anything else is null. */
const parseVersion = (v) => (Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

const badRequest = (zip, fn) => {
  try {
    return fn();
  } catch (err) {
    if (err instanceof zip.ZipError) throw new SkillError(400, [err.message]);
    throw err;
  }
};

export class SkillStore {
  /**
   * @param {{ ctx: object, now?: () => number }} o — the module's ctx; without a data folder (ctx.paths.dataDir null,
   *   ":memory:") nothing can be imported. Building it reconciles the index with the disk (and may rewrite it).
   */
  constructor({ ctx, now = Date.now }) {
    this.now = now;
    this.t = ctx.i18n.t;
    this.log = ctx.log;
    this.zip = ctx.zip;
    this.index = indexStore(ctx);
    this.root = ctx.paths.dataDir === null ? null : path.join(ctx.paths.dataDir, LIBRARY);
    this.reconcile();
  }

  /** The folder of the library, or null with an in-memory database. */
  get dir() {
    return this.root;
  }

  get indexPath() {
    return this.index.path;
  }

  get badFile() {
    return this.index.badFile;
  }

  #versionDir(id, n) {
    return path.join(this.root, id, String(n));
  }

  /**
   * The index brought back in line with the disk: versions without a folder are dropped, version folders the
   * index does not know are adopted (read from their SKILL.md), the hash and mdChars an older index lacks are
   * worked out, leftovers of an interrupted import or removal swept. An index that exists but cannot be read
   * or understood is never replaced (nothing is adopted over it); a corrupt one only after a copy of it was made.
   * It never throws: the lens must start whatever state the library is in, so a step that fails is logged and skipped.
   */
  reconcile() {
    if (!this.root) return;
    try {
      this.#reconcile();
    } catch (err) {
      this.log.warn(`skill: indice non riallineato: ${err.message}`);
    }
  }

  #reconcile() {
    const doc = this.index.read();
    let writable = this.index.state !== "unusable";
    if (!writable) this.log.warn(`skill: ${this.index.path} non si legge o non si capisce: non lo riscrivo e non adotto le cartelle (rimettilo a posto, o toglilo per ricostruirlo dalle cartelle)`);
    else if (this.index.state === "corrupt") writable = this.#keepCorruptCopy();
    let changed = false;
    const skills = [];
    for (const s of doc.skills) {
      try {
        const kept = this.#reconcileSkill(s);
        if (kept.changed) changed = true;
        if (kept.skill) skills.push(kept.skill);
      } catch (err) {
        // not readable now (permissions, a file where the folder should be): keep the entry, it may be fine later
        this.log.warn(`skill ${s.id}: non riesco a controllare la cartella (${err.message}), la lascio com'è`);
        skills.push(s);
      }
    }
    let top = [];
    try {
      top = fs.readdirSync(this.root, { withFileTypes: true });
    } catch (err) {
      if (err.code !== "ENOENT") this.log.warn(`skill: non riesco a leggere ${this.root} (${err.message})`);
    }
    // a Dirent does not follow links: a link here (dangling or not) is neither swept into nor adopted
    for (const e of top.filter((x) => x.isDirectory())) {
      try {
        if (e.name.startsWith(REMOVED)) fs.rmSync(path.join(this.root, e.name), { recursive: true, force: true });
        else if (this.#sweepAndAdopt(e.name, skills, writable)) changed = true;
      } catch (err) {
        this.log.warn(`skill ${e.name}: cartella non controllata (${err.message})`);
      }
    }
    if (!writable) return;
    // the figures of the versions an older index (or an adoption) left without: once, here, so no request ever hashes
    for (const s of skills) {
      for (const v of s.versions) {
        if (hasStats(v)) continue;
        const stats = this.#statsOf(s.id, v.n);
        if (stats) {
          Object.assign(v, stats);
          changed = true;
        }
      }
    }
    if (changed) this.index.write({ ...doc, version: 1, skills });
  }

  /** Makes sure a copy of the corrupt index exists before it is replaced: the one the store keeps if it is this file, else a new one. */
  #keepCorruptCopy() {
    try {
      const text = fs.readFileSync(this.index.path, "utf8");
      const bad = this.index.badFile;
      if (exists(bad) && fs.readFileSync(bad, "utf8") === text) return true;
      fs.copyFileSync(this.index.path, bad.replace(/\.json$/, `-${randomBytes(3).toString("hex")}.json`), fs.constants.COPYFILE_EXCL);
      return true;
    } catch (err) {
      this.log.warn(`skill: non riesco a salvare una copia dell'indice rotto (${err.message}): non lo riscrivo`);
      return false;
    }
  }

  /** One index entry against the disk: { skill: the entry to keep (null: drop it), changed }. */
  #reconcileSkill(s) {
    const base = path.join(this.root, s.id);
    let changed = false;
    const versions = [];
    for (const v of s.versions) {
      const dir = path.join(base, String(v.n));
      if (exists(dir)) {
        versions.push(v);
        continue;
      }
      // an overwrite or a removal interrupted between its renames: the folder is still there, set aside
      const aside = listDir(base).find((n) => n.startsWith(`${v.n}.old-`));
      if (aside) {
        fs.renameSync(path.join(base, aside), dir);
        this.log.warn(`skill ${s.id}: versione ${v.n} ripristinata da ${aside}`);
        versions.push(v);
      } else {
        this.log.warn(`skill ${s.id}: la cartella della versione ${v.n} manca, la tolgo dall'indice`);
        changed = true;
      }
    }
    if (!versions.length) {
      this.log.warn(`skill ${s.id}: nessuna versione rimasta, la tolgo dall'indice`);
      return { skill: null, changed: true };
    }
    let current = s.current;
    if (!versions.some((v) => v.n === current)) {
      current = Math.max(...versions.map((v) => v.n));
      changed = true;
      return { skill: { ...s, current, currentSince: this.now(), versions }, changed };
    }
    return { skill: { ...s, current, versions }, changed };
  }

  /** Sweeps the leftovers of `skills/<id>` and, with `adopt`, adopts its numbered folders that `skills` (mutated) does not list. True when it adopted. */
  #sweepAndAdopt(id, skills, adopt) {
    const base = path.join(this.root, id);
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch (err) {
      if (!absent(err)) throw err;
    }
    // with an index we could not read an `.old-` folder may be the only copy of a version: only the other leftovers go
    const leftover = adopt ? /^\d+\.(tmp|old)-/ : /^\d+\.tmp-/;
    for (const e of entries) if (leftover.test(e.name)) fs.rmSync(path.join(base, e.name), { recursive: true, force: true });
    if (!adopt || !validId(id)) return false;
    const known = skills.find((s) => s.id === id);
    const adopted = [];
    // only real folders: a link named like a version points somewhere the library does not own
    for (const n of entries.filter((e) => e.isDirectory() && /^[1-9]\d*$/.test(e.name)).map((e) => Number(e.name))) {
      if (known?.versions.some((v) => v.n === n)) continue;
      const found = this.#adoptVersion(id, n);
      if (found) adopted.push(found);
    }
    if (!adopted.length) return false;
    adopted.sort((a, b) => a.entry.n - b.entry.n);
    if (known) {
      known.versions = [...known.versions, ...adopted.map((a) => a.entry)].sort((a, b) => a.n - b.n);
      this.log.warn(`skill ${id}: adottate le versioni ${adopted.map((a) => a.entry.n).join(", ")} che l'indice non conosceva`);
      return true;
    }
    if (skills.length >= MAX_SKILLS) {
      this.log.warn(`skill ${id}: la cartella non è nell'indice ma ci sono già ${MAX_SKILLS} skill, la lascio`);
      return false;
    }
    const top = adopted.at(-1);
    skills.push({
      id,
      name: displayName(top.fm.name) ?? id,
      description: Array.from(top.fm.description ?? "").slice(0, MAX_DESCRIPTION).join(""),
      current: top.entry.n,
      currentSince: this.now(),
      versions: adopted.map((a) => a.entry),
    });
    this.log.warn(`skill ${id}: la cartella non era nell'indice, l'ho adottata (versioni ${adopted.map((a) => a.entry.n).join(", ")})`);
    return true;
  }

  /**
   * The index entry of a version folder, rebuilt from its SKILL.md; null when it holds no readable one, or when
   * the folder or its SKILL.md is a link or leads out of `skills/<id>/<n>` (nothing outside the library is adopted).
   */
  #adoptVersion(id, n) {
    const dir = this.#versionDir(id, n);
    try {
      if (!fs.lstatSync(dir).isDirectory() || fs.realpathSync(dir) !== path.join(fs.realpathSync(this.root), id, String(n))) {
        this.log.warn(`skill ${id}: la cartella ${n} è un collegamento o esce dalla libreria, non la adotto`);
        return null;
      }
      const md = path.join(dir, "SKILL.md");
      const st = fs.lstatSync(md);
      if (!st.isFile() || st.size > MAX_SKILL_MD) return null;
      const fm = parseFrontmatter(fs.readFileSync(md, "utf8"));
      const files = walk(dir);
      const entry = { n, importedAt: Math.floor(fs.statSync(dir).mtimeMs), source: "zip", files: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) };
      return { entry, fm };
    } catch (err) {
      if (!absent(err)) this.log.warn(`skill ${id}: la cartella ${n} non si legge (${err.message})`);
      return null;
    }
  }

  /** The library, each skill with the absolute folder of its current version. */
  list() {
    if (!this.root) return { version: 1, skills: [] };
    const { skills } = this.index.read();
    return { version: 1, skills: skills.map((s) => ({ ...s, currentSince: s.currentSince ?? s.versions.find((v) => v.n === s.current).importedAt, dir: this.#versionDir(s.id, s.current) })) };
  }

  /** The hash and mdChars of a version read from its folder; null when the folder cannot be read. */
  #statsOf(id, n) {
    try {
      return statsOfDir(this.#versionDir(id, n));
    } catch {
      return null;
    }
  }

  /** `version` null is the current one. Null when the skill or the version is not there. */
  detail(id, { version = null } = {}) {
    if (!this.root) return null;
    const skill = this.index.read().skills.find((s) => s.id === id);
    if (!skill) return null;
    const n = version === null ? skill.current : parseVersion(version);
    if (!skill.versions.some((v) => v.n === n)) return null;
    const dir = this.#versionDir(id, n);
    let fm;
    let files;
    try {
      fm = parseFrontmatter(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"));
      files = walk(dir).filter((f) => f.rel !== "SKILL.md");
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
    return {
      id,
      name: displayName(fm.name) ?? skill.name,
      description: fm.description ?? skill.description,
      metadata: fm.metadata,
      current: skill.current,
      version: n,
      dir,
      body: fm.body,
      files: byRole(files).slice(0, MAX_LISTED_FILES).map((f) => path.join(dir, f.rel)),
      totalFiles: files.length,
      versions: skill.versions,
    };
  }

  /** A skill from a zip: SKILL.md at its root or in its only folder, plus whatever is next to it. */
  importZip(buf, { mode = "version", filename = null } = {}) {
    this.#checkImport(mode);
    const { t, zip } = this;
    return badRequest(zip, () => {
      const plan = planSkill(zip.readEntries(buf, { maxEntries: MAX_SKILL_ENTRIES }), { t, zip });
      const md = plan.files.find((f) => f.rel === "SKILL.md");
      checkSkillMdSize(md.entry.size, t); // before inflating it
      const text = skillMdText(zip.entryData(buf, md.entry), t);
      // the id of a nameless skill: the zip's root folder, else the zip's file name
      const fallback = plan.root ?? filename?.replace(/\.(zip|skill)$/i, "") ?? null;
      if (fallback == null && parseFrontmatter(text).name == null) {
        throw new SkillError(400, [t("SKILL.md non ha name e lo zip non ha una cartella radice: aggiungi un campo name al frontmatter di SKILL.md")]);
      }
      const { fm, id } = describeSkill(text, fallback, t);
      return this.#commit({ id, fm, mode, source: "zip", fill: (dest) => zip.extractPlan(buf, plan, dest) });
    });
  }

  /**
   * A lone SKILL.md. On a skill that exists it brings the current version's other files along.
   * Which skill: a frontmatter `name` that is an id; else the skill whose stored display name is exactly
   * that `name`; else the usual derivation, where `filename` names a skill whose frontmatter has no name
   * (unless it is a bare «SKILL.md» or a copy of it: «SKILL (1).md», «SKILL copia.md»).
   */
  importMarkdown(text, { mode = "version", filename = null } = {}) {
    this.#checkImport(mode);
    const md = skillMdText(text, this.t);
    const fallback = typeof filename === "string" && !NAMELESS_FILE.test(filename) ? filename.replace(/\.md$/i, "") : null;
    const byName = (label) => {
      const hits = this.index.read().skills.filter((s) => s.name === label);
      return hits.length === 1 ? hits[0].id : null;
    };
    const { fm, id } = describeSkill(md, fallback, this.t, byName);
    return this.#commit({
      id,
      fm,
      mode,
      source: "md",
      fill: (dest, skill) => {
        if (skill) fs.cpSync(this.#versionDir(id, skill.current), dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "SKILL.md"), md, { mode: 0o644 });
      },
    });
  }

  #checkImport(mode) {
    const { t } = this;
    if (!this.root) throw new SkillError(409, [t("Il database è in memoria (LENS_DB=:memory:): non c'è una cartella dati dove tenere le skill.")]);
    checkMode(mode, this.t);
    this.#assertUsable();
  }

  /**
   * Why the library cannot be used, or null: the index file exists but cannot be read, is not JSON or is not a skill
   * index (a corrupt one that startup rebuilt from the folders reads fine and is not counted). Reads the index.
   * Shown instead of an empty library, which it would look like, and it suspends every change until the file is repaired or moved.
   */
  unusable() {
    const { t } = this;
    if (!this.root) return null;
    this.index.read();
    if (this.index.state !== "unusable" && this.index.state !== "corrupt") return null;
    return t("L'indice delle skill (skills.json) non è leggibile: la libreria non viene mostrata e gli import sono sospesi finché non lo ripari o lo sposti.");
  }

  #assertUsable() {
    const reason = this.unusable();
    if (reason) throw new SkillError(409, [reason]);
  }

  /**
   * Builds the version in a temporary folder, moves it into place, then writes the index.
   * The live folder is never removed before its replacement is in place; any failure leaves nothing behind.
   */
  #commit({ id, fm, mode, source, fill }) {
    const { t } = this;
    const doc = this.index.read();
    const skill = doc.skills.find((s) => s.id === id);
    if (skill && mode === "new") throw new SkillError(409, [t("esiste già una skill «{id}»: aggiungi una versione o sovrascrivi la corrente", { id })]);
    if (!skill && doc.skills.length >= MAX_SKILLS) throw new SkillError(400, [t("ci sono già {max} skill: toglierne una prima di aggiungerne un'altra", { max: MAX_SKILLS })]);
    const overwrite = !!skill && mode === "overwrite";
    const base = path.join(this.root, id);
    const createdBase = !exists(base);
    let n;
    let tmp;
    try {
      // above every version the index knows and every numbered folder on disk: an index that failed to load
      // (broken file) must never lead to a folder that holds real data being replaced
      const onDisk = createdBase ? [] : fs.readdirSync(base).filter((d) => /^\d+$/.test(d)).map(Number);
      n = overwrite ? skill.current : Math.max(0, ...(skill?.versions.map((v) => v.n) ?? []), ...onDisk) + 1;
      fs.mkdirSync(base, { recursive: true, mode: 0o700 });
      tmp = fs.mkdtempSync(path.join(base, `${n}.tmp-`));
    } catch (err) {
      try {
        if (createdBase) fs.rmSync(base, { recursive: true, force: true });
      } catch {
        // nothing of ours to remove (a file stands in the way)
      }
      // a file where a folder of the library should be (skills/ or skills/<id>): the user's to fix, not a server fault
      if (err.code === "ENOTDIR" || err.code === "EEXIST") throw new SkillError(409, [t("nella cartella delle skill c'è un file dove dovrebbe esserci una cartella: toglilo a mano e riprova")]);
      throw err;
    }
    const final = this.#versionDir(id, n);
    let aside = null;
    let placed = false;
    try {
      fill(tmp, skill);
      const files = walk(tmp);
      const stats = { hash: hashDir(tmp, files), hashV: HASH_V, mdChars: mdCharsOf(tmp) };
      // the same content as the current version: nothing to add, whichever of version and overwrite was asked
      if (skill && (this.#sameAsCurrent(skill, stats.hash) || this.#sameFilesAsCurrent(skill, tmp, files))) {
        fs.rmSync(tmp, { recursive: true, force: true });
        return { id, version: skill.current, unchanged: true };
      }
      if (skill && mode === "version" && skill.versions.length >= MAX_VERSIONS) throw new SkillError(400, [t("«{id}» ha già {max} versioni: toglierne una prima di aggiungerne un'altra", { id, max: MAX_VERSIONS })]);
      if (overwrite) {
        const moved = `${final}.old-${randomBytes(4).toString("hex")}`;
        fs.renameSync(final, moved);
        aside = moved;
      }
      // `final` is free (n is above every folder) or the live one just moved aside: this rename cannot land on data
      fs.renameSync(tmp, final);
      placed = true;
      const entry = { n, importedAt: this.now(), source, files: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0), ...stats };
      const meta = { name: fm.name ?? id, description: fm.description };
      if (skill) {
        Object.assign(skill, meta, { current: n, currentSince: entry.importedAt });
        skill.versions = [...skill.versions.filter((v) => v.n !== n), entry].sort((a, b) => a.n - b.n);
      } else {
        doc.skills.push({ id, ...meta, current: n, currentSince: entry.importedAt, versions: [entry] });
      }
      this.index.write(doc);
    } catch (err) {
      // before the index is written, what the filesystem refuses comes from the zip's content or from a folder the user can see gone
      const refused = placed ? null : this.#refusal(err, skill);
      if (placed) fs.rmSync(final, { recursive: true, force: true });
      if (aside) {
        try {
          fs.renameSync(aside, final);
        } catch (restore) {
          this.log.warn(`skill ${id}: la versione ${n} non si rimette a posto da ${path.basename(aside)}: ${restore.message}`);
        }
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      if (createdBase) fs.rmSync(base, { recursive: true, force: true });
      throw refused ?? err;
    }
    if (aside) fs.rmSync(aside, { recursive: true, force: true });
    return { id, version: n };
  }

  /** Whether `hash` is the content of the skill's current version, which must still be on the disk. */
  #sameAsCurrent(skill, hash) {
    if (!exists(this.#versionDir(skill.id, skill.current))) return false;
    const current = skill.versions.find((v) => v.n === skill.current);
    return (current && hasStats(current) ? current.hash : this.#statsOf(skill.id, skill.current)?.hash) === hash;
  }

  /**
   * Whether the folder `dir` (`files`: its walk) holds the very paths and bytes of the skill's current version, whatever the
   * execute bits: a browser can only guess those from a folder (it cannot read them), so the same skill imported from a
   * Finder zip and from a folder differs in nothing but its modes. The current version keeps its own.
   */
  #sameFilesAsCurrent(skill, dir, files) {
    const live = this.#versionDir(skill.id, skill.current);
    if (!exists(live)) return false;
    const current = walk(live);
    if (current.length !== files.length || current.some((f, i) => f.rel !== files[i].rel || f.size !== files[i].size)) return false;
    return hashDir(live, current, { modes: false }) === hashDir(dir, files, { modes: false });
  }

  /**
   * What a failed fill or move says to the user, as a SkillError, or null when it is not their doing:
   * names the disk cannot hold (400), the current version's folder gone from the disk (409).
   */
  #refusal(err, skill) {
    const { t } = this;
    switch (err?.code) {
      case "EEXIST":
        return new SkillError(400, [t("due file con lo stesso nome dopo la normalizzazione")]);
      case "ENAMETOOLONG":
        return new SkillError(400, [t("nome di file troppo lungo")]);
      case "ENOTDIR":
      case "EISDIR":
        return new SkillError(400, [t("un file dello zip ha lo stesso nome di una cartella")]);
      case "ENOENT":
        if (skill && !exists(this.#versionDir(skill.id, skill.current))) return new SkillError(409, [t("la cartella della versione corrente manca: ricarica la pagina")]);
        return null;
      default:
        return null;
    }
  }

  /**
   * The skill, and the version number asked for when there is one (404 for an unknown skill or version).
   * With `required` a missing version (null, undefined) is a 400: it must never stand for "the current one".
   */
  #find(doc, id, version = null, { required = false } = {}) {
    const { t } = this;
    const skill = doc.skills.find((s) => s.id === id);
    if (!skill) throw new SkillError(404, [t("skill sconosciuta: {id}", { id })]);
    if (required && (version === null || version === undefined)) throw new SkillError(400, [t("serve una versione (un numero intero)")]);
    const n = version === null ? null : parseVersion(version);
    if (version !== null && !skill.versions.some((v) => v.n === n)) throw new SkillError(404, [t("la skill «{id}» non ha la versione {n}", { id, n: String(version) })]);
    return { skill, n };
  }

  /** Makes `version` the current one; the listed description follows it. */
  rollback(id, version) {
    this.#assertUsable();
    const doc = this.index.read();
    const { skill, n } = this.#find(doc, id, version, { required: true });
    // rolling back to the version already in use changes nothing: it keeps its «in use since»
    if (skill.current !== n) skill.currentSince = this.now();
    skill.current = n;
    try {
      const fm = parseFrontmatter(fs.readFileSync(path.join(this.#versionDir(id, n), "SKILL.md"), "utf8"));
      skill.name = displayName(fm.name) ?? skill.name;
      skill.description = fm.description ?? skill.description;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    this.index.write(doc);
  }

  /**
   * Deletes `target` in a crash-safe order: set aside under `aside` (a name reconcile sweeps), then `write()` the
   * index, then remove it. A failed write puts it back; a crash leaves only the set-aside folder, which startup
   * restores (an `.old-` of a version the index still lists) or sweeps, and never a folder startup would adopt.
   */
  #discard(target, aside, write) {
    let moved = null;
    try {
      fs.renameSync(target, aside);
      moved = aside;
    } catch (err) {
      if (!absent(err)) throw err; // nothing there to delete
    }
    try {
      write();
    } catch (err) {
      if (moved) {
        try {
          fs.renameSync(moved, target);
        } catch (restore) {
          this.log.warn(`skill: ${path.basename(target)} non si rimette a posto da ${path.basename(moved)}: ${restore.message}`);
        }
      }
      throw err;
    }
    if (moved) fs.rmSync(moved, { recursive: true, force: true });
  }

  removeVersion(id, version) {
    const { t } = this;
    this.#assertUsable();
    const doc = this.index.read();
    const { skill, n } = this.#find(doc, id, version, { required: true });
    if (skill.current === n) throw new SkillError(400, [t("la versione {n} di «{id}» è quella in uso: attiva un'altra versione prima di toglierla", { id, n })]);
    skill.versions = skill.versions.filter((v) => v.n !== n);
    const dir = this.#versionDir(id, n);
    this.#discard(dir, `${dir}.old-${randomBytes(4).toString("hex")}`, () => this.index.write(doc));
  }

  remove(id) {
    this.#assertUsable();
    const doc = this.index.read();
    this.#find(doc, id);
    doc.skills = doc.skills.filter((s) => s.id !== id);
    this.#discard(path.join(this.root, id), path.join(this.root, `${REMOVED}${randomBytes(4).toString("hex")}-${id}`), () => this.index.write(doc));
  }
}
