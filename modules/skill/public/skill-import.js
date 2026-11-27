// Importing several files or whole folders from the browser: the page gets a flat list of files with their
// relative paths (a picker, or a dropped folder walked with the FileSystemEntry API), groups them into skills
// (every folder that directly contains a SKILL.md is one skill) and zips each folder skill in the page
// (zip-writer.js), so the upload route stays the same: one POST per skill. No DOM here: tested in Node.
import { bytes, t } from "/module-kit.js";
import { writeZip, zipSize } from "./zip-writer.js";

/** Files walked in a dropped folder at most: more is a folder that is not meant to be imported (a whole home, node_modules). */
export const MAX_WALK = 20_000;

const JUNK = new Set([".DS_Store", "__MACOSX", ".git"]);
/** Whether a path (as segments) is left by the system or a version control, never part of a skill: .DS_Store, __MACOSX, .git, ._* (AppleDouble). */
export const isJunk = (segs) => segs.some((s) => JUNK.has(s) || s.startsWith("._"));

const segmentsOf = (path) => String(path).replace(/\\/g, "/").split("/").filter(Boolean);

/**
 * `items` ([{ path, file }]: the path as the user picked it, with the folder in front) as skills and loose files.
 * Every folder that directly contains a file named exactly SKILL.md is a skill; its files are all those under it
 * except the ones of a skill folder nested inside it. A file at the top (no folder) is loose: a zip, a .skill, a
 * SKILL.md of its own. Anything else (a README beside the skills) is an orphan, counted and left out; junk is counted too.
 * @returns {{ skills: {dir: string, name: string, files: {rel: string, file: object}[]}[], loose: {name: string, file: object}[], orphans: number, junk: number }}
 */
export function groupItems(items) {
  const kept = [];
  let junk = 0;
  for (const { path, file } of items) {
    const segs = segmentsOf(path);
    if (!segs.length) continue;
    if (isJunk(segs)) junk++;
    else kept.push({ segs, file });
  }
  const dirs = new Set(kept.filter((k) => k.segs.length >= 2 && k.segs.at(-1) === "SKILL.md").map((k) => k.segs.slice(0, -1).join("/")));
  const skills = new Map();
  const loose = [];
  let orphans = 0;
  for (const { segs, file } of kept) {
    // the deepest skill folder that holds this file
    let depth = segs.length - 1;
    while (depth >= 1 && !dirs.has(segs.slice(0, depth).join("/"))) depth--;
    if (depth >= 1) {
      const dir = segs.slice(0, depth).join("/");
      if (!skills.has(dir)) skills.set(dir, { dir, name: segs[depth - 1], files: [] });
      skills.get(dir).files.push({ rel: segs.slice(depth).join("/"), file });
    } else if (segs.length === 1) loose.push({ name: segs[0], file });
    else orphans++;
  }
  return { skills: [...skills.values()].sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)), loose, orphans, junk };
}

/**
 * What to upload for `items`: the folder skills first, then the loose files, each one request. `jobs` is empty
 * when there is nothing to import; `orphans` and `junk` are what was left out.
 * @returns {{ jobs: ({kind: "folder", name: string, skill: object} | {kind: "file", name: string, file: object})[], orphans: number, junk: number }}
 */
export function planImport(items) {
  const g = groupItems(items);
  return {
    jobs: [...g.skills.map((skill) => ({ kind: "folder", name: skill.name, skill })), ...g.loose.map(({ name, file }) => ({ kind: "file", name, file }))],
    orphans: g.orphans,
    junk: g.junk,
  };
}

/** The files of a picker (`multiple`, or `webkitdirectory`, which gives each file its path inside the chosen folder) as items. */
export const pickedItems = (files) => [...files].map((file) => ({ path: file.webkitRelativePath || file.name, file }));

/** The permission bits of a file the browser gives no mode for: an executable script (in scripts/, starting with #!) is 0755, anything else 0644. */
export function guessMode(rel, data) {
  return /^scripts\//.test(rel) && data[0] === 0x23 && data[1] === 0x21 ? 0o755 : 0o644;
}

const byRel = (a, b) => (a.rel === "SKILL.md" ? -1 : b.rel === "SKILL.md" ? 1 : a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

/**
 * The zip of a folder skill (the folder's name as the root folder, as Finder's «Comprimi» does, so the importer
 * derives the same id), within `max` bytes: a folder over it is refused here, before reading any file.
 * @returns {Promise<Uint8Array>}
 */
export async function buildSkillZip(skill, { max }) {
  const files = [...skill.files].sort(byRel);
  const size = zipSize(files.map((f) => ({ name: `${skill.name}/${f.rel}`, size: f.file.size })));
  const tooBig = () => new Error(t("la cartella è troppo grande ({size}, al massimo {max})", { size: bytes(size), max: bytes(max) }));
  if (size > max) throw tooBig();
  const entries = [];
  for (const { rel, file } of files) {
    let data;
    try {
      data = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      throw new Error(t("non riesco a leggere {name}: {message}", { name: rel, message: err?.message || err?.name || String(err) }));
    }
    entries.push({ name: `${skill.name}/${rel}`, data, mode: guessMode(rel, data) });
  }
  const zip = writeZip(entries);
  if (zip.length > max) throw tooBig();
  return zip;
}

const message = (err) => err?.message || err?.name || String(err);
const fileOf = (entry) => new Promise((ok, fail) => entry.file(ok, fail));
/** All the children of a directory entry: the reader gives them in blocks (at most 100 in Chrome) until an empty one. */
async function childrenOf(dir) {
  const reader = dir.createReader();
  const all = [];
  for (;;) {
    const block = await new Promise((ok, fail) => reader.readEntries(ok, fail));
    if (!block.length) return all;
    all.push(...block);
  }
}

/**
 * The files under dropped `entries` (FileSystemEntry: files and folders) as items with their path from the dropped
 * folder down. .git and __MACOSX folders are not entered. More than `limit` files is an error.
 */
export async function walkEntries(entries, { limit = MAX_WALK } = {}) {
  const out = [];
  const over = () => new Error(t("troppi file nella cartella (più di {max}): scegli una cartella di skill più piccola", { max: limit }));
  async function visit(entry, prefix) {
    const path = `${prefix}${entry.name}`;
    if (entry.isFile) {
      let file;
      try {
        file = await fileOf(entry);
      } catch (err) {
        throw new Error(t("non riesco a leggere {name}: {message}", { name: path, message: message(err) }));
      }
      if (out.length >= limit) throw over();
      out.push({ path, file });
    } else if (entry.isDirectory) {
      if (JUNK.has(entry.name)) return;
      let children;
      try {
        children = await childrenOf(entry);
      } catch (err) {
        throw new Error(t("non riesco a leggere la cartella {name}: {message}", { name: path, message: message(err) }));
      }
      for (const child of children) await visit(child, `${path}/`);
    }
  }
  for (const entry of entries) await visit(entry, "");
  return out;
}

/**
 * The items of a drop. The entries are taken before the first wait: the browser empties `dataTransfer` once the
 * drop handler has returned. A browser without webkitGetAsEntry gives the plain files (a dropped folder is then not walked).
 */
export async function droppedItems(dataTransfer) {
  const entries = [...(dataTransfer?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry?.() ?? null);
  const files = [...(dataTransfer?.files ?? [])];
  if (entries.length && entries.every(Boolean)) return walkEntries(entries);
  return files.map((file) => ({ path: file.name, file }));
}
