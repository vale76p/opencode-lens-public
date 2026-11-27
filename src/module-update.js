// Impostazioni › Aggiornamento, the other zip it takes: user modules zipped by hand: one folder <id>/ per module at the root, each with its
// module.js. Checked and extracted like the lens's zip (src/update.js: planEntries, extractPlan, the same caps) and
// previewed without running any of its code. Unsigned by design (only the lens's zip is signed): a module is code that
// runs in the lens process with the user's permissions, so it is judged by checkUserModule (which runs its top-level
// code) only at apply, once the user has seen the warning and confirmed; then the module folders are swapped in the
// user modules folder: the old one goes to .backup/<id>-<date>/, never half a module in its place.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { errorText, t } from "../public/i18n.js";
import { MODULE_ID } from "./config.js";
import { MODULES_DIR, checkUserModule } from "./modules.js";
import { SettingsError } from "./settings.js";
import { IGNORED, MAX_ENTRIES, MAX_UPLOAD, STAGE_TTL_MS, extractPlan, planEntries } from "./update.js";
import { ZipError, readZipEntries } from "./zip.js";

// inside the user modules folder; the leading dot keeps both out of the discovery (MODULE_ID starts with a letter)
const BACKUP = ".backup";
const STAGING = ".staging-";

/**
 * Whether `entries` (readZipEntries) are a package of modules: at the root only folders named like a module id, each
 * with its own module.js, macOS litter aside. Anything else (the lens's zip, a file at the root such as package.json)
 * is not, and goes the lens's way. Names only: planEntries judges them when the package is uploaded.
 */
export function isModulesPackage(entries) {
  const roots = new Map(); // id -> whether <id>/module.js is there
  for (const { name } of entries) {
    if (IGNORED(name)) continue;
    const slash = name.indexOf("/");
    if (slash < 1) return false;
    const root = name.slice(0, slash);
    if (!MODULE_ID.test(root)) return false;
    if (!roots.has(root)) roots.set(root, false);
    if (name === `${root}/module.js`) roots.set(root, true);
  }
  return roots.size > 0 && [...roots.values()].every(Boolean);
}

/**
 * What would be extracted from a package of modules, through the generic checks of planEntries.
 * @returns {{ids: string[], files: {rel: string, entry: object, mode: number}[], bytes: number}}
 */
export function planModules(entries) {
  const { roots, files: planned, bytes } = planEntries(entries);
  const files = planned.map(({ segs, entry, mode }) => {
    if (segs.length < 2) throw new ZipError(t("file fuori dalle cartelle dei moduli: {name}", { name: entry.name }));
    return { rel: segs.join("/"), entry, mode };
  });
  const have = new Set(files.map((f) => f.rel));
  const ids = [...roots].sort();
  if (!ids.length) throw new ZipError(t("lo zip è vuoto"));
  for (const id of ids) if (!MODULE_ID.test(id) || !have.has(`${id}/module.js`)) throw new ZipError(notModules());
  return { ids, files, bytes };
}

const notModules = () => t("non è un pacchetto di moduli: alla radice ci vuole una cartella <id>/ per modulo, ognuna con il suo module.js");

/** "20261101-102030": the UTC time of a backup folder's name. */
const stampOf = (ms) =>
  new Date(ms)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "")
    .replace("T", "-");

/** Whether `p` exists, a broken symlink included. */
function lexists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Uploads, previews and installs a zip of user modules. `dir` is <data dir>/update (where the lens's zips are staged
 * too; Updater.cleanup removes forgotten upload-* folders at startup), `userDir` the user modules folder (both null with
 * LENS_DB=:memory:). `settings` restarts the lens after an install (restartBlocked/restart, src/settings.js); `busy`
 * says a lens update or restart is under way; `check` is checkUserModule with what the lens found at startup (main.js),
 * called by apply only.
 */
export class ModuleUpdater {
  constructor({
    dir,
    userDir,
    settings = null,
    busy = () => false,
    check = (o) => checkUserModule(o),
    isCore = (id) => fs.existsSync(path.join(MODULES_DIR, id)),
    now = Date.now,
  }) {
    Object.assign(this, { dir, userDir, settings, isBusy: busy, check, isCore, now });
    this.staged = null;
    this.working = false;
    this.cleanup();
  }

  /** The .staging-* copies an install interrupted by a crash left in the user modules folder: removed at startup. */
  cleanup() {
    if (!this.userDir) return;
    let names = [];
    try {
      names = fs.readdirSync(this.userDir);
    } catch {
      return;
    }
    for (const n of names) if (n.startsWith(STAGING)) fs.rmSync(path.join(this.userDir, n), { recursive: true, force: true });
  }

  /** Whether a lens update, a restart, or another upload or apply of modules is under way. */
  busy() {
    return this.working || !!this.isBusy() || !!this.settings?.restarting;
  }

  /** Why the lens cannot restart itself after an install (then the user restarts it), or null. */
  restartReason() {
    if (!this.settings) return t("Impostazioni non disponibili.");
    return this.settings.restartBlocked() ?? null;
  }

  /** Whether the bytes of an upload are a package of modules (otherwise they are for the lens's Updater). */
  recognizes(buf) {
    try {
      return isModulesPackage(readZipEntries(buf, { maxEntries: MAX_ENTRIES + 100 }));
    } catch {
      return false;
    }
  }

  stagedPreview() {
    if (this.staged && this.now() - this.staged.at > STAGE_TTL_MS) this.discard();
    return this.staged?.preview ?? null;
  }

  /** Whether `id` is the upload staged here (and not expired): POST /api/update/apply comes here for it. */
  owns(id) {
    return typeof id === "string" && !!this.stagedPreview() && this.staged.id === id;
  }

  discard() {
    if (this.staged) fs.rmSync(this.staged.dir, { recursive: true, force: true });
    this.staged = null;
  }

  /** "link" or "folder" for what is at <userDir>/<id> now, null when nothing is. */
  installed(id) {
    try {
      return fs.lstatSync(path.join(this.userDir, id)).isSymbolicLink() ? "link" : "folder";
    } catch {
      return null;
    }
  }

  /**
   * POST /api/update with a zip of modules: checks the zip and extracts it next to the lens's uploads. The preview is
   * static (ids, new or replacing, size): no file of the modules is imported or run here.
   */
  async upload(buf) {
    if (!this.userDir || !this.dir) throw new SettingsError(409, [t("Il database è in memoria (LENS_DB=:memory:): non c'è una cartella per i moduli dell'utente.")]);
    if (this.busy()) throw new SettingsError(409, [t("La lens si sta già riavviando o aggiornando.")]);
    if (buf.length > MAX_UPLOAD) throw new SettingsError(413, [t("zip troppo grande (al massimo {n} MiB)", { n: MAX_UPLOAD / 1024 / 1024 })]);
    let plan;
    try {
      const entries = readZipEntries(buf, { maxEntries: MAX_ENTRIES + 100 });
      if (!entries.some((e) => !IGNORED(e.name))) throw new ZipError(t("lo zip è vuoto"));
      if (!isModulesPackage(entries)) throw new ZipError(notModules());
      plan = planModules(entries);
    } catch (err) {
      if (err instanceof ZipError) throw new SettingsError(400, [err.message]);
      throw err;
    }
    const core = plan.ids.filter((id) => this.isCore(id));
    if (core.length) throw new SettingsError(400, core.map((id) => t("{id} è l'id di un modulo della lens: un modulo dell'utente non può averlo", { id })));

    this.working = true;
    let dir = null;
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(this.dir, 0o700);
      const id = crypto.randomBytes(8).toString("hex");
      // upload-*: the name Updater.cleanup removes at startup
      dir = fs.mkdtempSync(path.join(this.dir, `upload-${id}-`));
      const src = path.join(dir, "modules");
      try {
        extractPlan(buf, plan, src);
      } catch (err) {
        if (err instanceof ZipError) throw new SettingsError(400, [err.message]);
        throw new SettingsError(500, [t("estrazione dello zip non riuscita: {message}", { message: err.message })]);
      }
      // static: nothing of the modules is imported before the user has seen the warning and confirmed (apply checks them)
      const modules = plan.ids.map((mid) => ({ id: mid, installed: this.installed(mid) }));
      const reason = this.restartReason();
      const preview = {
        type: "modules",
        id,
        expiresAt: this.now() + STAGE_TTL_MS,
        userDir: this.userDir,
        files: plan.files.length,
        bytes: plan.bytes,
        modules,
        restart: { available: !reason, reason },
      };
      this.discard();
      this.staged = { id, dir, src, at: this.now(), preview };
      dir = null;
      return preview;
    } finally {
      this.working = false;
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * POST /api/update/apply for the staged modules, sent once the user has seen the unsigned-code warning and confirmed.
   * First each module is judged with checkUserModule on the staged copy: that imports module.js and server/index.js
   * (their top-level code runs, as with lens_module_check) and calls configure(). Any error refuses the whole zip (400,
   * with `modules`: each one's result) and drops it, with nothing installed. Then each folder is swapped in the user
   * modules folder (the old one kept in .backup/) and the lens restarted when it runs under launchd; otherwise `reason`
   * says why the user restarts it. LENS_MODULES does not change: a module that was on stays on, a new one starts off.
   */
  async apply(body) {
    if (!this.userDir) throw new SettingsError(409, [t("Il database è in memoria (LENS_DB=:memory:): non c'è una cartella per i moduli dell'utente.")]);
    if (this.busy()) throw new SettingsError(409, [t("La lens si sta già riavviando o aggiornando.")]);
    if (!this.owns(body?.id)) throw new SettingsError(404, [t("Caricamento sconosciuto o scaduto: carica di nuovo lo zip.")]);
    const staged = this.staged;
    this.working = true; // no other upload or apply while the check runs
    let modules;
    try {
      const checked = [];
      for (const m of staged.preview.modules) {
        const r = await this.check({ id: m.id, userDir: staged.src });
        checked.push({ id: m.id, name: r.name ?? null, ok: r.ok, errors: r.errors.map(errorText), warnings: r.warnings.map(errorText) });
      }
      const bad = checked.filter((m) => !m.ok);
      if (bad.length) {
        // this zip can never be installed: dropped, a corrected one is uploaded again
        this.discard();
        const err = new SettingsError(400, [t("Alcuni moduli dello zip hanno errori: correggili e carica di nuovo lo zip."), ...bad.flatMap((m) => m.errors.map((e) => `${m.id}: ${e}`))]);
        err.modules = checked;
        throw err;
      }
      // a restart asked while the check ran: install nothing under it
      if (this.isBusy() || this.settings?.restarting) throw new SettingsError(409, [t("La lens si sta già riavviando o aggiornando.")]);
      try {
        modules = this.install(staged).map((d, i) => ({ ...d, name: checked[i].name, warnings: checked[i].warnings }));
      } finally {
        this.discard();
      }
    } finally {
      this.working = false;
    }
    const reason = this.restartReason();
    if (!reason) this.settings.restart();
    return { modules, restarting: !reason, reason };
  }

  /**
   * Copies every staged module next to its place (<userDir>/.staging-<id>-*), then swaps them in one by one: the old
   * folder (or symlink: the folder it points to is never touched) is renamed into .backup/, the copy renamed into its
   * place. Nothing is written outside the user modules folder.
   */
  install({ src, preview }) {
    const base = this.userDir;
    fs.mkdirSync(base, { recursive: true });
    // .backup is checked before any copy or swap: one that is not a real folder (a file, a link) refuses the install
    const backupDir = path.join(base, BACKUP);
    if (lexists(backupDir) && !fs.lstatSync(backupDir).isDirectory()) throw new SettingsError(500, [t("{dir} non è una cartella", { dir: backupDir })]);
    const ready = [];
    try {
      // all the copies first: one that fails leaves every installed module as it was
      for (const m of preview.modules) {
        const tmp = fs.mkdtempSync(path.join(base, `${STAGING}${m.id}-`));
        ready.push({ m, tmp, copy: path.join(tmp, m.id) });
        fs.cpSync(path.join(src, m.id), path.join(tmp, m.id), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      }
    } catch (err) {
      for (const r of ready) fs.rmSync(r.tmp, { recursive: true, force: true });
      throw new SettingsError(500, [t("copia dei moduli non riuscita: {message}", { message: err.message })]);
    }
    const stamp = stampOf(this.now());
    const done = []; // swapped: { id, replaced, backup, target, copy }
    let unrestored = null; // the module whose swap failed, when its old folder could not be put back either
    try {
      // created once, before the first swap
      if (preview.modules.some((m) => lexists(path.join(base, m.id)))) fs.mkdirSync(backupDir, { recursive: true });
      for (const { m, copy } of ready) {
        const target = path.join(base, m.id);
        const backup = lexists(target) ? this.backupPath(m.id, stamp) : null;
        if (backup) fs.renameSync(target, backup);
        try {
          fs.renameSync(copy, target);
        } catch (err) {
          // the failing module's own old folder back; if even that fails, it stays in .backup and the message says so
          try {
            if (backup) fs.renameSync(backup, target);
          } catch {
            unrestored = m.id;
          }
          throw err;
        }
        done.push({ id: m.id, replaced: !!backup, backup, target, copy });
      }
    } catch (err) {
      // all or nothing: the modules already swapped go back, last first (the new folder back into its staging, the old
      // one out of .backup)
      const stuck = unrestored ? [unrestored] : [];
      for (const d of done.reverse()) {
        try {
          fs.renameSync(d.target, d.copy);
          if (d.backup) fs.renameSync(d.backup, d.target);
        } catch {
          stuck.push(d.id);
        }
      }
      const errors = [t("installazione dei moduli interrotta: {message}", { message: err.message })];
      if (stuck.length) errors.push(t("Non rimessi com'erano: {ids}; le cartelle vecchie sono in {dir}.", { ids: stuck.join(", "), dir: backupDir }));
      throw new SettingsError(500, errors);
    } finally {
      for (const r of ready) fs.rmSync(r.tmp, { recursive: true, force: true });
    }
    return done.map(({ id, replaced, backup }) => ({ id, replaced, backup }));
  }

  /** A free <userDir>/.backup/<id>-<stamp>[-n] (install() has created and checked .backup). */
  backupPath(id, stamp) {
    const dir = path.join(this.userDir, BACKUP);
    let p = path.join(dir, `${id}-${stamp}`);
    for (let n = 2; lexists(p); n++) p = path.join(dir, `${id}-${stamp}-${n}`);
    return p;
  }
}
