// The optional macOS app built for real: npm run test:macos, on the Mac before a release.
// Skipped off macOS or without the Command Line Tools (xcode-select -p first: /usr/bin/swiftc
// is a shim that would open the installation dialog). The app is never launched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "extras/macos/app.sh");

function toolsMissing() {
  if (process.platform !== "darwin") return "solo su macOS";
  if (spawnSync("xcode-select", ["-p"]).status !== 0) return "Command Line Tools assenti (xcode-select --install)";
  if (spawnSync("xcrun", ["--find", "swiftc"]).status !== 0) return "swiftc non trovato";
  return false;
}
const skip = toolsMissing();

// LENS_APP_SIGN empty: always the ad-hoc signature, whatever the shell exports
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", timeout: 600_000, env: { ...process.env, LENS_APP_SIGN: "" } });

test("app macOS: i test della parte pura (app.sh test)", { skip }, () => {
  const r = run("bash", [SCRIPT, "test"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^OK \d+ checks$/m);
});

test("app macOS: app.sh build --out produce un bundle firmato e coerente con package.json", { skip }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "lens-app-build-"));
  try {
    const r = run("bash", [SCRIPT, "build", "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /warning:/, "swiftc senza warning");
    const app = path.join(fs.realpathSync(out), "OpenCode Lens.app");
    const info = path.join(app, "Contents/Info.plist");
    assert.equal(run("plutil", ["-lint", "-s", info]).status, 0);
    const key = (k) => run("plutil", ["-extract", k, "raw", "-o", "-", info]).stdout.trim();

    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const [major, minor, patch] = version.split(".").map((n) => Number.parseInt(n, 10));
    assert.equal(key("CFBundleShortVersionString"), version);
    assert.equal(key("CFBundleVersion"), String(major * 10000 + minor * 100 + patch));
    assert.equal(key("CFBundleIdentifier"), "local.opencode-lens.app");
    assert.equal(key("CFBundleExecutable"), "OpenCodeLens");
    assert.equal(fs.readFileSync(path.join(app, "Contents/PkgInfo"), "utf8"), "APPL????");
    assert.ok(fs.statSync(path.join(app, "Contents/Resources/AppIcon.icns")).size > 0, "icona generata");

    const verify = run("codesign", ["--verify", "--strict", app]);
    assert.equal(verify.status, 0, verify.stderr);
    const sig = run("codesign", ["-dv", app]).stderr;
    assert.match(sig, /Signature=adhoc/);
    assert.match(sig, /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/);

    const archs = run("lipo", ["-archs", path.join(app, "Contents/MacOS/OpenCodeLens")]).stdout.trim();
    assert.equal(archs, run("uname", ["-m"]).stdout.trim());
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
