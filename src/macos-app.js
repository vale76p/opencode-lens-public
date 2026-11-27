// Impostazioni › Aggiornamento, the «App macOS» card: the optional OpenCode Lens.app
// (extras/macos), its version against the lens's, and its build launched from the
// dashboard with extras/macos/app.sh in a helper that outlives the lens, as an update.
// The only file of src/ that knows the app (test/macos-app.test.js).
import { t } from "../public/i18n.js";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SettingsError } from "./settings.js";
import { STALE_MS, helperEnv, processAlive, updateState } from "./update.js";

export const APP_NAME = "OpenCode Lens";
// `app.sh check` runs xcrun, which takes a moment: once a minute is enough for a settings card
export const CHECK_TTL_MS = 60_000;
const LOG_LINES = 40;
const RUN_TIMEOUT_MS = 15_000;

/** The helper: app.sh with its command, then its exit code in app.exit (written whole, then renamed). */
export function appHelperScript() {
  return [
    '/bin/bash "$1" "$3"',
    "code=$?",
    `printf '%s\\n' "$code" > "$2/app.exit.tmp" && mv -f "$2/app.exit.tmp" "$2/app.exit"`,
    'exit "$code"',
  ].join("\n");
}

function defaultRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: RUN_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * `updater` lends its conditions (`blocked()`: the lens runs from launchd and its install folder,
 * so a dev lens never replaces the real app) and its Node (`nodeDir()`); `dir` is <data dir>/update.
 * `run(cmd, args) → { status, stdout }` runs a short command and waits for it.
 */
export class MacosApp {
  constructor({ updater, appDir, home, dir, version, platform = process.platform, env = process.env, run = defaultRun, spawn = nodeSpawn, now = Date.now, isAlive = processAlive }) {
    Object.assign(this, { updater, appDir, home, dir, version, platform, env, run, spawn, now, isAlive });
    this.appSh = path.join(appDir, "extras", "macos", "app.sh");
    this.appPath = path.join(home, "Applications", `${APP_NAME}.app`);
    this.check = null;
    this.running = false;
  }

  supported() {
    return this.platform === "darwin" && fs.existsSync(this.appSh);
  }

  /** The installed app's version, null when it cannot be read. */
  installedVersion() {
    const r = this.run("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", path.join(this.appPath, "Contents", "Info.plist")]);
    const v = r.status === 0 ? r.stdout.trim() : "";
    return v || null;
  }

  canBuild() {
    if (!this.check || this.now() - this.check.at >= CHECK_TTL_MS) {
      const r = this.run("/bin/bash", [this.appSh, "check"]);
      this.check = { at: this.now(), ok: r.status === 0, reason: r.status === 0 ? null : r.stdout.trim().split("\n")[0] || t("compilazione non possibile") };
    }
    return { ok: this.check.ok, reason: this.check.reason };
  }

  paths() {
    return { json: path.join(this.dir, "app.json"), exit: path.join(this.dir, "app.exit"), log: path.join(this.dir, "app.log") };
  }

  /** The last build launched from the dashboard, from its files: it may have outlived a restart. */
  job({ local }) {
    if (!this.dir) return null;
    const p = this.paths();
    let last = null;
    try {
      last = JSON.parse(readText(p.json) ?? "null");
    } catch {
      last = null;
    }
    const exitText = readText(p.exit);
    const exit = exitText !== null && /^\d+\s*$/.test(exitText) ? Number(exitText) : null;
    const state = updateState({ last, exit, alive: last ? this.running || (this.isAlive(last.helper) && this.now() - (last.startedAt ?? 0) < STALE_MS) : false });
    if (!state) return null;
    state.command = last.command ?? null;
    if (local) {
      const log = readText(p.log);
      state.log = log === null ? null : log.split("\n").slice(-LOG_LINES - 1).join("\n").trimEnd();
    }
    return state;
  }

  busy() {
    return this.job({ local: false })?.state === "running";
  }

  /** GET /api/macos-app. The build log only for a client on this computer. */
  status({ local = false } = {}) {
    const lensVersion = this.version;
    if (!this.supported()) {
      return { supported: false, installed: false, version: null, lensVersion, aligned: false, canBuild: { ok: false, reason: null }, available: false, reason: t("L'app macOS c'è solo su macOS, con i suoi sorgenti nella cartella della lens."), job: null };
    }
    const installed = fs.existsSync(this.appPath);
    const version = installed ? this.installedVersion() : null;
    const canBuild = this.canBuild();
    const job = this.job({ local });
    let reason = this.updater.blocked();
    if (!reason && this.updater.busy()) reason = t("La lens si sta già riavviando o aggiornando.");
    if (!reason && job?.state === "running") reason = t("È in corso la compilazione dell'app macOS: aspetta che finisca.");
    if (!reason && !canBuild.ok) reason = canBuild.reason;
    return { supported: true, installed, version, lensVersion, aligned: installed && version === lensVersion, canBuild, available: !reason, reason: reason ?? null, job };
  }

  /** POST /api/macos-app/install: app.sh install, or update for an installed app, in a detached helper. */
  install() {
    const s = this.status();
    if (!s.available) throw new SettingsError(409, [s.reason]);
    const command = s.installed ? "update" : "install";
    const p = this.paths();
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    for (const f of [p.exit, p.json]) fs.rmSync(f, { force: true });
    const out = fs.openSync(p.log, "w", 0o600);
    let child;
    try {
      child = this.spawn("/bin/sh", ["-c", appHelperScript(), "sh", this.appSh, this.dir, command], {
        cwd: this.dir,
        detached: true,
        env: helperEnv({ env: this.env, nodeDir: this.updater.nodeDir() }),
        stdio: ["ignore", out, out],
      });
    } finally {
      fs.closeSync(out);
    }
    this.running = true;
    const last = { from: s.version, to: this.version, startedAt: this.now(), helper: child.pid ?? null, command };
    fs.writeFileSync(p.json, JSON.stringify(last), { mode: 0o600 });
    const done = () => {
      this.running = false;
      // the next status() reads the tools again: a build that failed may have been for them
      this.check = null;
    };
    child.on?.("exit", done);
    child.on?.("error", done);
    child.unref?.();
    return { started: true, command };
  }
}
