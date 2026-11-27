// The dashboard layout chosen with «Personalizza dashboard», kept next to the
// database (dashboard-v2.json; dashboard.json is only read, as migration source). Personal to this install: never part of the app
// folder, so a release package never carries anyone's arrangement.
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";
import { validateLayout } from "../public/layout.js";

// What an older lens does not know: widget types added with the sidebar/Monitor work (`budget` was a v1 type, migrated to
// `hero`, so in a v2 layout it can only come from this version), the settings of the new styles, and the Monitor view.
// In practice the first save from this version always copies the old file: validateLayout adds the Monitor view to every
// layout it reads, and any layout with a Monitor view counts as new.
const NEW_TYPES = new Set(["kpi", "budget", "flow", "status", "speed", "rhythm", "day-sessions"]);
// The only `style` values a lens before the styles accepts, by type: every other type refused any `style`, «classic»
// included («impostazione sconosciuta «style»»).
const OLD_STYLES = { trend: ["columns", "line"], gauge: ["semi", "ring"] };
const NEW_KEYS = ["cols", "kinds", "density", "only", "time", "session"];

/** True when a v2 layout holds a setting a lens before the styles would not understand. */
export function usesNewSettings(layout) {
  const views = layout?.views;
  if (!views || typeof views !== "object") return false;
  if (Object.hasOwn(views, "monitor")) return true;
  return Object.values(views).some(
    (v) =>
      Array.isArray(v?.widgets) &&
      v.widgets.some((wd) => {
        const s = wd?.settings;
        if (NEW_TYPES.has(wd?.type)) return true;
        if (!s || typeof s !== "object") return false;
        const oldStyle = Object.hasOwn(OLD_STYLES, wd.type) && OLD_STYLES[wd.type].includes(s.style);
        return (s.style !== undefined && !oldStyle) || NEW_KEYS.some((k) => Object.hasOwn(s, k));
      }),
  );
}

export class DashboardStore {
  /** @param {{ dbPath: string }} o — ":memory:" keeps the layout in memory until restart */
  constructor({ dbPath }) {
    const dir = dbPath === ":memory:" ? null : path.dirname(dbPath);
    // v2 lives in its own file; dashboard.json (v1) is only ever read, so an older lens still finds it intact
    this.file = dir && path.join(dir, "dashboard-v2.json");
    this.legacyFile = dir && path.join(dir, "dashboard.json");
    this.memory = null;
  }

  get path() {
    return this.file;
  }

  /** Where the layout of before the new settings is kept (see write). */
  get prevFile() {
    return this.file?.replace(/\.json$/, ".prev.json");
  }

  /** Reads and validates one file: { layout, migrated } or null (absent / unusable). */
  #load(file) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (err) {
      if (err.code !== "ENOENT") log.warn(`impossibile leggere ${file}: ${err.message}`);
      return null;
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      log.warn(`${file} non è JSON valido: la dashboard lo ignora`);
      return null;
    }
    const v = validateLayout(doc);
    if (!v.ok) {
      log.warn(`${file} non è una disposizione valida (${v.errors.join("; ")}): la dashboard lo ignora`);
      return null;
    }
    return { layout: v.layout, migrated: v.migrated };
  }

  /** `{ layout (v2), migrated }`, or null when nothing usable exists (the page then draws the default). */
  read() {
    if (!this.file) return this.memory ? { layout: structuredClone(this.memory), migrated: false } : null;
    return this.#load(this.file) ?? this.#load(this.legacyFile);
  }

  /**
   * Before the first save with new settings, keeps the file an older lens wrote as dashboard-v2.prev.json (never
   * overwritten). «New» is judged on what is written against what is on disk: validateLayout adds the Monitor view to
   * any old document, so the layout alone cannot tell. Best effort: a failure must not block the save.
   */
  #keepOldCopy(layout) {
    if (!usesNewSettings(layout)) return;
    try {
      if (usesNewSettings(JSON.parse(fs.readFileSync(this.file, "utf8")))) return;
      fs.copyFileSync(this.file, this.prevFile, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if (err.code !== "EEXIST" && err.code !== "ENOENT" && !(err instanceof SyntaxError)) log.warn(`copia di ${this.file} non riuscita: ${err.message}`);
    }
  }

  /** `layout` must already be valid v2 (validateLayout). Atomic: temp file, then rename. */
  write(layout) {
    if (!this.file) {
      this.memory = structuredClone(layout);
      return;
    }
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    this.#keepOldCopy(layout);
    try {
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(tmp, `${JSON.stringify(layout, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** Removes only dashboard-v2.json: dashboard.json stays for older versions (and is migrated again). */
  reset() {
    if (!this.file) this.memory = null;
    else fs.rmSync(this.file, { force: true });
  }
}
