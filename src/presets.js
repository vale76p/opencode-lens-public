// Personal JSON documents kept next to the database (dashboard-presets.json, ...).
// Personal to this install, like the layout: never part of the app folder.
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";
import { EMPTY_PRESETS, validatePresets } from "../public/presets.js";

/** What the warnings of a JsonStore call its content: the three phrases agree in gender and number. */
const PRESETS_WHAT = Object.freeze({ broken: "i preset sono ignorati", none: "non contiene preset validi", dropped: "sono ignorati" });

export class JsonStore {
  /**
   * @param {{ dbPath: string, name: string, validate: (parsed: unknown) => {ok: true, doc: object} | {ok: false, errors: string[]}, empty: () => object, what?: {broken: string, none: string, dropped: string} }} o
   *   `name` is the file next to the database; ":memory:" keeps the document in memory until restart;
   *   `what` words the warnings (default: the presets), e.g. «le skill sono ignorate»
   */
  constructor({ dbPath, name, validate, empty, what = PRESETS_WHAT }) {
    const dir = dbPath === ":memory:" ? null : path.dirname(dbPath);
    this.file = dir && path.join(dir, name);
    this.validate = validate;
    this.empty = empty;
    this.what = what;
    this.memory = null;
    // how the last read found the file: "absent" (none yet), "ok", "corrupt" (not JSON), "unusable" (unreadable or not a valid document)
    this.state = "absent";
    this.warned = null; // the content of the unusable file already reported: the page reads it on every load
  }

  get path() {
    return this.file;
  }

  /** Where the first unusable file is kept before a save replaces it (see read). */
  get badFile() {
    return this.file?.replace(/\.json$/, ".bad.json");
  }

  /** Copies an unusable file aside, once (never overwritten): a save would otherwise destroy everything in it. Best effort. */
  #keepBadCopy() {
    try {
      fs.copyFileSync(this.file, this.badFile, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if (err.code !== "EEXIST" && err.code !== "ENOENT") log.warn(`copia di ${this.file} non riuscita: ${err.message}`);
    }
  }

  /** An unusable file: kept aside, and reported once per content. */
  #reject(text, message) {
    this.#keepBadCopy();
    if (this.warned === text) return;
    this.warned = text;
    log.warn(message);
  }

  /** The saved document; an empty one when there is no file or it cannot be used (a warning says why, and the file is kept in `badFile`). */
  read() {
    if (!this.file) return this.memory ? structuredClone(this.memory) : this.empty();
    let text;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      this.state = err.code === "ENOENT" ? "absent" : "unusable";
      if (err.code !== "ENOENT") log.warn(`impossibile leggere ${this.file}: ${err.message}`);
      return this.empty();
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.state = "corrupt";
      this.#reject(text, `${this.file} non è JSON valido: ${this.what.broken} (una copia resta in ${this.badFile})`);
      return this.empty();
    }
    const v = this.validate(parsed);
    if (!v.ok) {
      this.state = "unusable";
      this.#reject(text, `${this.file} ${this.what.none} (${v.errors.join("; ")}): ${this.what.dropped} (una copia resta in ${this.badFile})`);
      return this.empty();
    }
    this.warned = null;
    this.state = "ok";
    return v.doc;
  }

  /** `doc` must already be valid (`validate`). Atomic: temp file, then rename. */
  write(doc) {
    if (!this.file) {
      this.memory = structuredClone(doc);
      return;
    }
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}

export class PresetStore extends JsonStore {
  /** @param {{ dbPath: string }} o — ":memory:" keeps the presets in memory until restart */
  constructor({ dbPath }) {
    super({ dbPath, name: "dashboard-presets.json", validate: validatePresets, empty: () => structuredClone(EMPTY_PRESETS) });
  }
}
