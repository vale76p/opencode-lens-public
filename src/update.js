// Impostazioni › Aggiornamento: a zip of the lens uploaded from the dashboard is
// checked and extracted here, previewed, and applied by running its own
// install.sh in a helper that outlives the lens (service install boots it out).
// No network: the zip comes from the user, and the helper cannot download Node.
import { t } from "../public/i18n.js";
import crypto from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseChangelog } from "./changelog.js";
import { RELEASE_PUBLIC_KEY } from "./release-key.js";
import { SettingsError } from "./settings.js";
import { MANIFEST, MANIFEST_SIG, compareManifest, manifestSigned } from "./signature.js";
import { ZipError, entryData, readZipEntries } from "./zip.js";

export const MAX_UPLOAD = 16 * 1024 * 1024;
export const MAX_UNPACKED = 64 * 1024 * 1024;
export const MAX_ENTRIES = 5000;
// the first install.sh with backup and staging that also runs in a UTF-8 Terminal
export const MIN_VERSION = "0.12.1";
export const STAGE_TTL_MS = 30 * 60_000;
// an install.sh, or a build of the macOS app, never takes this long: a helper "alive" after it is a PID
// reused after a reboot or logout, not a job still running
export const STALE_MS = 20 * 60_000;
const REQUIRED = ["package.json", "src/main.js", "install.sh", "public/index.html"];
const LOG_LINES = 40;
const MAX_SEGMENT_BYTES = 255;
// left by Finder's «Comprimi» and by macOS on other volumes: never part of the app
export const IGNORED = (name) => name.startsWith("__MACOSX/") || /(^|\/)(\._[^/]*|\.DS_Store)$/.test(name);
const IN_GIT = (name) => /(^|\/)\.git(\/|$)/.test(name);

/** An entry name as relative segments, or null when it could escape or is not portable. */
export function safeEntryName(name) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (!name || /[\\\u0000-\u001f\u007f-\u009f]/.test(name) || name.startsWith("/") || /^[A-Za-z]:/.test(name)) return null;
  const segs = name.replace(/\/$/, "").split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return null;
  return segs;
}

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

/**
 * The generic checks of an untrusted zip: ignored macOS entries, safe names, no symlinks,
 * special files or .git, no case-insensitive duplicates, entry and byte caps.
 * Directories count in `roots` but not in `files`. Names are compared as NFC (APFS treats two spellings
 * as one file) and no segment may exceed 255 bytes (the file name limit).
 * `backslash` accepts the `\` separators of Windows PowerShell 5.1 archives, but only when no entry
 * uses `/`; they are turned into `/` and every other check runs on the result.
 * @returns {{roots: Set<string>, files: {segs: string[], entry: object, mode: number}[], bytes: number}}
 */
export function planEntries(entries, { maxEntries = MAX_ENTRIES, maxUnpacked = MAX_UNPACKED, ignoreGit = false, backslash = false } = {}) {
  if (backslash && entries.some((e) => e.name.includes("\\")) && !entries.some((e) => e.name.includes("/"))) {
    entries = entries.map((e) => {
      const name = e.name.replaceAll("\\", "/");
      return { ...e, name, dir: e.dir || name.endsWith("/") };
    });
  }
  const kept = entries.filter((e) => !IGNORED(e.name) && !(ignoreGit && IN_GIT(e.name)));
  if (kept.length > maxEntries) throw new ZipError(t("troppi file nello zip ({n}, al massimo {max})", { n: kept.length, max: maxEntries }));
  const seen = new Set();
  const roots = new Set();
  const folders = new Set();
  const fileNames = new Map();
  const files = [];
  let bytes = 0;
  for (const e of kept) {
    const segs = safeEntryName(e.name);
    if (!segs) throw new ZipError(t("nome non valido nello zip: {name}", { name: JSON.stringify(e.name) }));
    const type = e.mode == null ? 0 : e.mode & S_IFMT;
    if (type === 0o120000) throw new ZipError(t("collegamento simbolico nello zip: {name}", { name: e.name }));
    if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) throw new ZipError(t("file di tipo speciale nello zip: {name}", { name: e.name }));
    if (segs.includes(".git")) throw new ZipError(t("lo zip contiene una cartella .git: estrai una release, non un clone"));
    if (segs.some((s) => Buffer.byteLength(s) > MAX_SEGMENT_BYTES)) throw new ZipError(t("nome di file troppo lungo nello zip: {name}", { name: e.name }));
    const key = segs.join("/").normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new ZipError(t("file doppio nello zip: {name}", { name: e.name }));
    seen.add(key);
    roots.add(segs[0]);
    const isDir = e.dir || type === S_IFDIR;
    for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join("/").normalize("NFC").toLowerCase());
    if (isDir) folders.add(key);
    else fileNames.set(key, e.name);
    if (isDir) continue;
    bytes += e.size;
    if (bytes > maxUnpacked) throw new ZipError(t("zip troppo grande una volta estratto (oltre {n} MiB)", { n: maxUnpacked / 1024 / 1024 }));
    files.push({ segs, entry: e, mode: e.mode != null && e.mode & 0o111 ? 0o755 : 0o644 });
  }
  // «a» a file and «a/b» another file: one of them cannot be written
  for (const [key, name] of fileNames) if (folders.has(key)) throw new ZipError(t("un file dello zip ha lo stesso nome di una cartella: {name}", { name }));
  return { roots, files, bytes };
}

/**
 * What would be extracted from `entries`: one root folder holding the app.
 * @returns {{root: string, files: {rel: string, entry: object, mode: number}[], bytes: number}}
 */
export function planPackage(entries) {
  const { roots, files: planned, bytes } = planEntries(entries);
  const files = planned.map(({ segs, entry, mode }) => {
    if (segs.length < 2) throw new ZipError(t("file fuori dalla cartella dell'app: {name}", { name: entry.name }));
    return { rel: segs.slice(1).join("/"), entry, mode };
  });
  if (roots.size !== 1) throw new ZipError(roots.size ? t("lo zip deve contenere una sola cartella, quella dell'app") : t("lo zip è vuoto"));
  const have = new Set(files.map((f) => f.rel));
  const missing = REQUIRED.filter((f) => !have.has(f));
  if (missing.length) throw new ZipError(t("non è uno zip di opencode-lens: mancano {files}", { files: missing.join(", ") }));
  return { root: [...roots][0], files, bytes };
}

/** One file of the plan, by its path inside the app folder. */
export function planFile(buf, plan, rel) {
  const f = plan.files.find((x) => x.rel === rel);
  return f ? entryData(buf, f.entry) : null;
}

const MAX_LISTED = 5;

/**
 * The zip's files must be those of a release signed with `releaseKey` (src/signature.js):
 * the same bytes, none missing, none added. Throws otherwise; nothing has been written yet.
 */
export function checkSignature(buf, plan, releaseKey) {
  if (!releaseKey) throw new SettingsError(409, [t("Questa lens non ha la chiave per verificare gli aggiornamenti: aggiornala da terminale con bash <cartella estratta>/install.sh.")]);
  const manifest = planFile(buf, plan, MANIFEST);
  const signature = planFile(buf, plan, MANIFEST_SIG);
  if (!manifest || !signature) throw new ZipError(t("Lo zip non è firmato: carica lo zip della release (opencode-lens-X.Y.Z.zip), non il «Source code» di GitHub né uno zip fatto a mano."));
  if (!manifestSigned(manifest, signature.toString("utf8"), releaseKey)) throw new ZipError(t("Firma dello zip non valida: non viene da una release di opencode-lens. Scaricalo di nuovo dalla pagina delle release."));
  const files = Object.fromEntries(plan.files.map((f) => [f.rel, () => entryData(buf, f.entry)]));
  const diff = compareManifest(manifest, files);
  if (diff.malformed) throw new ZipError(t("{file} dello zip non è leggibile.", { file: MANIFEST }));
  const list = (names) => names.slice(0, MAX_LISTED).join(", ") + (names.length > MAX_LISTED ? " …" : "");
  if (diff.changed.length) throw new ZipError(t("File modificati dopo la firma della release: {files}", { files: list(diff.changed) }));
  if (diff.missing.length) throw new ZipError(t("Mancano file della release: {files}", { files: list(diff.missing) }));
  if (diff.extra.length) throw new ZipError(t("File che non fanno parte della release: {files}", { files: list(diff.extra) }));
}

/** Writes the plan's files under `dest`, which must be a new, empty folder. */
export function extractPlan(buf, plan, dest) {
  const base = path.resolve(dest);
  for (const f of plan.files) {
    const target = path.resolve(base, f.rel);
    const rel = path.relative(base, target);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ZipError(t("percorso fuori dalla cartella: {path}", { path: f.rel }));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    // wx: never overwrite, never follow a link
    fs.writeFileSync(target, entryData(buf, f.entry), { flag: "wx", mode: f.mode });
  }
}

/** Which zip the root folder comes from: the release asset, GitHub's source zip, a branch download. */
export function packageKind(root) {
  if (root === "opencode-lens") return "release";
  if (/^opencode-lens-opencode-lens-v\d/.test(root)) return "source";
  if (/^opencode-lens-/.test(root)) return "branch";
  return "cartella";
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** -1, 0, 1 like a sort comparator; null when either is not X.Y.Z. A pre-release sorts before its release. */
export function compareVersions(a, b) {
  const x = SEMVER.exec(String(a ?? ""));
  const y = SEMVER.exec(String(b ?? ""));
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return Math.sign(d);
  }
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  return x[4] < y[4] ? -1 : 1;
}

/** Whether Node `version` meets `range` (only the ">=X.Y[.Z]" form the lens uses; anything else counts as met). */
export function nodeSatisfies(range, version) {
  const m = /^\s*>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range ?? "");
  if (!m) return true;
  return compareVersions(version, `${m[1]}.${m[2] ?? 0}.${m[3] ?? 0}`) >= 0;
}

/**
 * The preview of a package: version against the running one, its CHANGELOG entries in
 * between, warnings, and errors that refuse it.
 */
export function inspectPackage({ pkg, changelogMd, installSh = "", current, nodeVersion, kind }) {
  const errors = [];
  const warnings = [];
  if (pkg?.name !== "opencode-lens") errors.push(t("il package.json dello zip non è di opencode-lens"));
  const version = typeof pkg?.version === "string" ? pkg.version : null;
  const comparison = compareVersions(version, current);
  if (comparison === null) errors.push(t("versione dello zip non valida: {version}", { version: version ?? t("assente") }));
  else if (compareVersions(version, MIN_VERSION) < 0) errors.push(t("la {version} è più vecchia della {min}, la prima che si installa così: installala da terminale", { version, min: MIN_VERSION }));
  const engines = pkg?.engines?.node;
  if (engines && !nodeSatisfies(engines, nodeVersion)) errors.push(t("la {version} richiede Node {engines}, questa lens gira con {node}: aggiorna Node e installala da terminale", { version, engines, node: nodeVersion }));
  if (comparison === 0) warnings.push(t("È la versione già installata: verrà reinstallata."));
  if (comparison < 0) warnings.push(t("È più vecchia della {current} installata: il database potrebbe avere uno schema più nuovo, e una versione senza questa sezione non si aggiorna più dalla dashboard.", { current }));
  if (kind === "branch") warnings.push(t("Lo zip è di un branch, non di una release."));
  if (!installSh.includes("LENS_NO_SCAN")) warnings.push(t("Il suo install.sh cerca altre copie in Download, Scrivania e Documenti: macOS potrebbe chiedere il permesso."));
  let changes = [];
  if (comparison > 0 && changelogMd) {
    changes = parseChangelog(changelogMd)
      .filter((r) => !r.unreleased && compareVersions(r.version, current) > 0 && compareVersions(r.version, version) <= 0)
      .map((r) => ({ version: r.version, date: r.date, items: r.sections.flatMap((s) => s.items).slice(0, 12) }));
  }
  return { version, comparison: comparison === null ? null : comparison > 0 ? "newer" : comparison < 0 ? "older" : "same", errors, warnings, changes };
}

/**
 * The helper: install.sh of the extracted zip, then its exit code next to the log,
 * then the extracted folder removed. $1 app folder, $2 update dir, $3 upload dir.
 */
export function helperScript() {
  return [
    "sleep 1",
    '/bin/bash "$1/install.sh"',
    "code=$?",
    `printf '%s\\n' "$code" > "$2/last.exit.tmp" && mv -f "$2/last.exit.tmp" "$2/last.exit"`,
    'case "$3" in "$2"/upload-*) rm -rf "$3" ;; esac',
    'exit "$code"',
  ].join("\n");
}

const PASS = ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"];

/**
 * The helper's environment: none of the lens's own (LENS_PORT would override the plist's port,
 * XPC_SERVICE_NAME is launchd's), the lens's Node first in PATH, and no way to download Node.
 */
export function helperEnv({ env, nodeDir }) {
  const out = {};
  for (const k of PASS) if (env[k] !== undefined) out[k] = env[k];
  out.PATH = [nodeDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(":");
  out.LENS_NO_SCAN = "1";
  out.LENS_NODE_MIRROR = "file:///nonexistent";
  return out;
}

/**
 * The last update from its files: last.json (written before the helper started), last.exit
 * (written by the helper at the end) and whether the helper is still alive.
 */
export function updateState({ last, exit, alive }) {
  if (!last) return null;
  let state;
  if (exit !== null && exit !== undefined) state = exit === 0 ? "ok" : "failed";
  else state = alive ? "running" : "interrupted";
  return { from: last.from ?? null, to: last.to ?? null, startedAt: last.startedAt ?? null, state, exit: exit ?? null };
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Uploads, previews and applies an update zip. `dir` is <data dir>/update (null without one,
 * e.g. LENS_DB=:memory:); `settings` shares the restart flag and the launchd checks.
 */
export class Updater {
  constructor({
    settings = null,
    appDir,
    home,
    dir,
    version,
    nodeVersion = process.versions.node,
    programArguments = () => null,
    execPath = process.execPath,
    env = process.env,
    spawn = nodeSpawn,
    now = Date.now,
    isAlive = processAlive,
    pid = process.pid,
    realpath = fs.realpathSync,
    releaseKey = RELEASE_PUBLIC_KEY,
    // a build of the macOS app launched from the dashboard (src/macos-app.js): never two app.sh at once
    appBusy = () => false,
  }) {
    Object.assign(this, { settings, appDir, home, dir, version, nodeVersion, programArguments, execPath, env, spawn, now, isAlive, pid, realpath, releaseKey, appBusy });
    this.staged = null;
    this.running = false;
    this.cleanup();
  }

  /** Folders of uploads never applied (a restart forgets them): removed at startup. */
  cleanup() {
    if (!this.dir) return;
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const n of names) if (n.startsWith("upload-")) fs.rmSync(path.join(this.dir, n), { recursive: true, force: true });
  }

  /** Why an update cannot be applied from here, or null. */
  blocked() {
    // the conditions of «Salva e riavvia»: the helper reloads the same LaunchAgent
    const s = this.settings;
    if (!s) return t("Impostazioni non disponibili.");
    if (s.platform !== "darwin") return t("L'aggiornamento dalla dashboard c'è solo con il servizio di macOS.");
    if (!fs.existsSync(s.plistPath)) return t("LaunchAgent non trovato ({path}): la prima volta installa la lens da terminale, con bash <cartella estratta>/install.sh.", { path: s.plistPath });
    if (s.env.XPC_SERVICE_NAME !== s.label) return t("La lens è stata avviata a mano (npm start), non da launchd: si aggiorna dalla dashboard solo quando gira come servizio.");
    if (!this.dir) return t("Il database è in memoria (LENS_DB=:memory:): non c'è una cartella dati dove preparare l'aggiornamento.");
    const real = (p) => {
      try {
        return this.realpath(p);
      } catch {
        return null;
      }
    };
    const expected = path.join(this.home, "Applications", "opencode-lens");
    if (fs.existsSync(path.join(this.appDir, ".git"))) return t("La lens gira da un clone del repository ({path}): aggiornala con git pull.", { path: this.appDir });
    if (real(this.appDir) !== real(expected)) return t("La lens gira da {from}, non da {expected}: aggiornala da terminale con bash <cartella estratta>/install.sh.", { from: this.appDir, expected });
    return null;
  }

  // also an install.sh started by the lens before its restart: it may still be running app.sh update
  busy() {
    return this.running || !!this.settings?.restarting || this.last({ local: false })?.state === "running";
  }

  lastPaths() {
    return { json: path.join(this.dir, "last.json"), exit: path.join(this.dir, "last.exit"), log: path.join(this.dir, "last.log") };
  }

  last({ local }) {
    if (!this.dir) return null;
    const p = this.lastPaths();
    let last = null;
    try {
      last = JSON.parse(readText(p.json) ?? "null");
    } catch {
      last = null;
    }
    const exitText = readText(p.exit);
    const exit = exitText !== null && /^\d+\s*$/.test(exitText) ? Number(exitText) : null;
    const state = updateState({ last, exit, alive: last ? this.running || (this.isAlive(last.helper) && this.now() - (last.startedAt ?? 0) < STALE_MS) : false });
    if (state && local) {
      const log = readText(p.log);
      state.log = log === null ? null : log.split("\n").slice(-LOG_LINES - 1).join("\n").trimEnd();
    }
    return state;
  }

  stagedPreview() {
    if (this.staged && this.now() - this.staged.at > STAGE_TTL_MS) this.discard();
    return this.staged?.preview ?? null;
  }

  discard() {
    if (this.staged) fs.rmSync(this.staged.dir, { recursive: true, force: true });
    this.staged = null;
  }

  /** GET /api/update. The install.sh log only for a client on this computer. */
  status({ local = false } = {}) {
    const reason = this.blocked();
    return {
      available: !reason,
      reason,
      version: this.version,
      appDir: this.appDir,
      pid: this.pid,
      staged: this.stagedPreview(),
      running: this.busy(),
      last: this.last({ local }),
      maxUpload: MAX_UPLOAD,
    };
  }

  /** POST /api/update with the zip's bytes: checks, extracts, previews. Never runs anything from it. */
  upload(buf) {
    if (!this.dir) throw new SettingsError(409, [t("Il database è in memoria (LENS_DB=:memory:): l'aggiornamento non è disponibile.")]);
    if (this.busy()) throw new SettingsError(409, [t("La lens si sta già riavviando o aggiornando.")]);
    if (buf.length > MAX_UPLOAD) throw new SettingsError(413, [t("zip troppo grande (al massimo {n} MiB)", { n: MAX_UPLOAD / 1024 / 1024 })]);
    let plan;
    let preview;
    try {
      plan = planPackage(readZipEntries(buf, { maxEntries: MAX_ENTRIES + 100 }));
      checkSignature(buf, plan, this.releaseKey);
      let pkg;
      try {
        pkg = JSON.parse(planFile(buf, plan, "package.json").toString("utf8"));
      } catch (err) {
        if (err instanceof ZipError) throw err;
        throw new ZipError(t("package.json dello zip non leggibile"));
      }
      const kind = packageKind(plan.root);
      const insp = inspectPackage({
        pkg,
        changelogMd: planFile(buf, plan, "CHANGELOG.md")?.toString("utf8") ?? "",
        installSh: planFile(buf, plan, "install.sh").toString("utf8"),
        current: this.version,
        nodeVersion: this.nodeVersion,
        kind,
      });
      if (insp.errors.length) throw new SettingsError(400, insp.errors);
      preview = { kind, root: plan.root, version: insp.version, current: this.version, comparison: insp.comparison, files: plan.files.length, bytes: plan.bytes, changes: insp.changes, warnings: insp.warnings };
    } catch (err) {
      if (err instanceof ZipError) throw new SettingsError(400, [err.message]);
      throw err;
    }
    this.discard();
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.dir, 0o700);
    const id = crypto.randomBytes(8).toString("hex");
    const dir = fs.mkdtempSync(path.join(this.dir, `upload-${id}-`));
    try {
      extractPlan(buf, plan, path.join(dir, "opencode-lens"));
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      if (err instanceof ZipError) throw new SettingsError(400, [err.message]);
      throw new SettingsError(500, [t("estrazione dello zip non riuscita: {message}", { message: err.message })]);
    }
    preview.id = id;
    preview.expiresAt = this.now() + STAGE_TTL_MS;
    this.staged = { id, dir, src: path.join(dir, "opencode-lens"), at: this.now(), preview };
    return preview;
  }

  /** The folder of the Node that launchd starts: the plist's, else this process's. */
  nodeDir() {
    const args = this.programArguments();
    const node = Array.isArray(args) && typeof args[0] === "string" && args[0] ? args[0] : this.execPath;
    return path.dirname(node);
  }

  /** POST /api/update/apply: runs the staged zip's install.sh in a helper that outlives the lens. */
  apply(body) {
    const reason = this.blocked();
    if (reason) throw new SettingsError(409, [reason]);
    if (this.busy()) throw new SettingsError(409, [t("La lens si sta già riavviando o aggiornando.")]);
    if (this.appBusy()) throw new SettingsError(409, [t("È in corso la compilazione dell'app macOS: aspetta che finisca.")]);
    const id = body?.id;
    if (typeof id !== "string" || !this.stagedPreview() || this.staged.id !== id) {
      throw new SettingsError(404, [t("Caricamento sconosciuto o scaduto: carica di nuovo lo zip.")]);
    }
    const p = this.staged.preview;
    if (p.comparison === "older" && body?.allowOlder !== true) {
      throw new SettingsError(400, [t("La {version} è più vecchia della {current} installata: conferma che vuoi installarla comunque.", { version: p.version, current: this.version })]);
    }
    if (this.settings.status().pending) {
      throw new SettingsError(409, [t("Ci sono variabili modificate nel plist e non ancora applicate: applicale (Salva e riavvia) prima di aggiornare.")]);
    }

    const paths = this.lastPaths();
    for (const f of [paths.exit, paths.json]) fs.rmSync(f, { force: true });
    const out = fs.openSync(paths.log, "w", 0o600);
    const staged = this.staged;
    let child;
    try {
      child = this.spawn("/bin/sh", ["-c", helperScript(), "sh", staged.src, this.dir, staged.dir], {
        cwd: this.dir,
        detached: true,
        env: helperEnv({ env: this.env, nodeDir: this.nodeDir() }),
        stdio: ["ignore", out, out],
      });
    } finally {
      fs.closeSync(out);
    }
    // the helper owns the extracted folder now: it removes it when install.sh is done
    this.staged = null;
    this.running = true;
    this.settings.restarting = true;
    const last = { id, from: this.version, to: p.version, startedAt: this.now(), pid: this.pid, helper: child.pid ?? null };
    fs.writeFileSync(paths.json, JSON.stringify(last), { mode: 0o600 });
    // still alive when the helper exits: install.sh stopped before restarting the lens
    child.on?.("exit", () => {
      this.running = false;
      this.settings.restarting = false;
    });
    child.on?.("error", () => {
      this.running = false;
      this.settings.restarting = false;
    });
    child.unref?.();
    return { restarting: true, version: p.version };
  }
}
