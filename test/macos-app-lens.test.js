// src/macos-app.js: the lens's view of OpenCode Lens.app (Impostazioni › Aggiornamento).
// Every command is faked: nothing is built, installed or opened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHECK_TTL_MS, MacosApp, appHelperScript } from "../src/macos-app.js";
import { STALE_MS } from "../src/update.js";

function fixture(t, { platform = "darwin", appSh = true, installed = null, canBuild = true, blocked = null, updaterBusy = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-macos-app-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const appDir = path.join(home, "Applications", "opencode-lens");
  fs.mkdirSync(path.join(appDir, "extras", "macos"), { recursive: true });
  if (appSh) fs.writeFileSync(path.join(appDir, "extras", "macos", "app.sh"), "");
  const app = path.join(home, "Applications", "OpenCode Lens.app");
  const state = { installed, canBuild, blocked, updaterBusy, now: 1000 };
  const install = (version) => {
    fs.mkdirSync(app, { recursive: true });
    state.installed = version;
  };
  if (installed !== null) install(installed);
  const runs = [];
  const run = (cmd, args) => {
    runs.push([cmd, ...args]);
    if (cmd === "/usr/bin/plutil") return state.installed ? { status: 0, stdout: `${state.installed}\n` } : { status: 1, stdout: "" };
    if (args[1] === "check") return state.canBuild ? { status: 0, stdout: "" } : { status: 1, stdout: "Serve swiftc: xcode-select --install (Xcode non serve).\n" };
    throw new Error(`comando inatteso: ${cmd} ${args.join(" ")}`);
  };
  const spawned = [];
  const child = Object.assign(new EventEmitter(), { pid: 5151, unref() {} });
  const updater = { blocked: () => state.blocked, busy: () => state.updaterBusy, nodeDir: () => "/opt/homebrew/opt/node/bin" };
  const make = () =>
    new MacosApp({
      updater,
      appDir,
      home,
      dir: path.join(root, "data", "update"),
      version: "0.39.0",
      platform,
      env: { HOME: home, LENS_PORT: "4777", XPC_SERVICE_NAME: "local.opencode-lens" },
      run,
      spawn: (cmd, args, opts) => {
        spawned.push({ cmd, args, opts });
        return child;
      },
      now: () => state.now,
      isAlive: (pid) => pid === 5151 && !child.exited,
    });
  return { m: make(), make, state, install, runs, spawned, child, appDir, home, appSh: path.join(appDir, "extras", "macos", "app.sh"), dir: path.join(root, "data", "update") };
}

test("MacosApp.status: non macOS o senza app.sh → non supportato, nessun comando eseguito", (t) => {
  for (const opts of [{ platform: "linux" }, { appSh: false }]) {
    const f = fixture(t, opts);
    const s = f.m.status();
    assert.equal(s.supported, false);
    assert.equal(s.available, false);
    assert.deepEqual(f.runs, []);
  }
});

test("MacosApp.status: app assente, allineata, diversa in entrambi i versi, Info.plist illeggibile", (t) => {
  const absent = fixture(t).m.status();
  assert.deepEqual([absent.supported, absent.installed, absent.version, absent.lensVersion, absent.aligned], [true, false, null, "0.39.0", false]);
  assert.equal(fixture(t, { installed: "0.39.0" }).m.status().aligned, true);
  for (const v of ["0.38.3", "0.40.0"]) {
    const s = fixture(t, { installed: v }).m.status();
    assert.deepEqual([s.installed, s.version, s.aligned], [true, v, false]);
  }
  const f = fixture(t, { installed: "0.39.0" });
  f.state.installed = null; // the bundle is there, its Info.plist is not readable
  const s = f.m.status();
  assert.deepEqual([s.installed, s.version, s.aligned], [true, null, false]);
});

test("MacosApp.status: check in cache per 60 s", (t) => {
  const f = fixture(t);
  const checks = () => f.runs.filter((r) => r[2] === "check").length;
  f.m.status();
  f.state.now += CHECK_TTL_MS - 1000;
  f.m.status();
  assert.equal(checks(), 1);
  f.state.now += 2000;
  f.m.status();
  assert.equal(checks(), 2);
  assert.deepEqual(f.runs.find((r) => r[2] === "check"), ["/bin/bash", f.appSh, "check"]);
});

test("MacosApp.status: senza Command Line Tools non disponibile con il motivo di app.sh", (t) => {
  const s = fixture(t, { canBuild: false }).m.status();
  assert.deepEqual(s.canBuild, { ok: false, reason: "Serve swiftc: xcode-select --install (Xcode non serve)." });
  assert.equal(s.available, false);
  assert.match(s.reason, /xcode-select --install/);
});

test("MacosApp.install: lens di sviluppo o aggiornamento in corso → 409 senza lanciare niente", (t) => {
  const dev = fixture(t, { blocked: "La lens è stata avviata a mano (npm start), non da launchd" });
  assert.equal(dev.m.status().available, false);
  assert.match(dev.m.status().reason, /avviata a mano/);
  assert.throws(() => dev.m.install(), (err) => err.status === 409 && /avviata a mano/.test(err.errors[0]));
  const busy = fixture(t, { updaterBusy: true });
  assert.throws(() => busy.m.install(), (err) => err.status === 409);
  assert.equal(dev.spawned.length + busy.spawned.length, 0);
});

test("MacosApp.install: lancia app.sh staccato con l'ambiente pulito", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.m.install(), { started: true, command: "install" });
  const [call] = f.spawned;
  assert.equal(call.cmd, "/bin/sh");
  assert.deepEqual(call.args, ["-c", appHelperScript(), "sh", f.appSh, f.dir, "install"]);
  assert.equal(call.opts.detached, true);
  assert.equal(call.opts.cwd, f.dir);
  assert.equal(call.opts.env.PATH.split(":")[0], "/opt/homebrew/opt/node/bin");
  assert.equal(call.opts.env.LENS_PORT, undefined);
  assert.equal(call.opts.env.XPC_SERVICE_NAME, undefined);
  const json = JSON.parse(fs.readFileSync(path.join(f.dir, "app.json"), "utf8"));
  assert.deepEqual([json.from, json.to, json.helper, json.command], [null, "0.39.0", 5151, "install"]);
  assert.equal(fs.statSync(path.join(f.dir, "app.log")).mode & 0o777, 0o600);
  assert.equal(f.m.busy(), true);
  assert.equal(f.m.status().job.state, "running");
  assert.equal(f.m.status().available, false);
  assert.throws(() => f.m.install(), (err) => err.status === 409);

  const g = fixture(t, { installed: "0.38.3" });
  assert.deepEqual(g.m.install(), { started: true, command: "update" });
  assert.equal(g.spawned[0].args.at(-1), "update");
});

test("MacosApp: dopo un riavvio legge running, interrupted, ok e failed dai file", (t) => {
  const f = fixture(t);
  f.m.install();
  fs.writeFileSync(path.join(f.dir, "app.log"), "Compilazione dell'app 0.39.0 (arm64)…\n");
  assert.equal(f.make().status().job.state, "running", "helper ancora vivo");
  assert.equal(f.make().busy(), true);
  f.child.exited = true;
  assert.equal(f.make().status().job.state, "interrupted");
  fs.writeFileSync(path.join(f.dir, "app.exit"), "0\n");
  assert.equal(f.make().status().job.state, "ok");
  fs.writeFileSync(path.join(f.dir, "app.exit"), "1\n");
  const s = f.make().status({ local: true });
  assert.deepEqual([s.job.state, s.job.exit], ["failed", 1]);
  assert.match(s.job.log, /Compilazione dell'app/);
  assert.equal(f.make().status({ local: false }).job.log, undefined);
  assert.equal(f.make().busy(), false);
});

test("appHelperScript: app.sh, poi il codice d'uscita scritto in modo atomico", () => {
  const sh = appHelperScript();
  assert.match(sh, /\/bin\/bash "\$1" "\$3"/);
  assert.match(sh, /> "\$2\/app\.exit\.tmp" && mv -f "\$2\/app\.exit\.tmp" "\$2\/app\.exit"/);
});

test("MacosApp: una compilazione vecchia di più di STALE_MS non è più in corso (PID riusato dopo un riavvio del Mac)", (t) => {
  const f = fixture(t);
  f.m.install();
  const later = f.make();
  assert.equal(later.busy(), true);
  f.state.now += STALE_MS + 1;
  assert.equal(f.make().status().job.state, "interrupted");
  assert.equal(f.make().busy(), false);
});
