// The optional macOS app (extras/macos): static checks that run everywhere, CI included.
// Building and signing it is in test/macos/app.test.js (npm run test:macos, macOS only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "extras/macos");
const SCRIPT = path.join(APP, "app.sh");

/** Every file under `dir` (relative to ROOT), recursively. */
function files(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(rel));
    else out.push(rel);
  }
  return out;
}

const swiftSources = () => files("extras/macos/Sources").filter((f) => f.endsWith(".swift"));

test("app macOS: app.sh è bash valido", () => {
  const r = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

// bash 3.2 reads the bytes of a character such as «…» right after `$NAME` as part of the name
test("app macOS: in app.sh nessuna $VARIABILE seguita da un carattere non ASCII", () => {
  const lines = fs.readFileSync(SCRIPT, "utf8").split("\n");
  const bad = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /\$[A-Za-z_][A-Za-z0-9_]*[^\t -~]/.test(l));
  assert.deepEqual(bad, []);
});

test("app macOS: fuori da macOS app.sh build si ferma subito", () => {
  // a fake uname makes this run (and mean the same) on macOS too
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "lens-app-uname-"));
  try {
    fs.writeFileSync(path.join(bin, "uname"), "#!/bin/sh\necho Linux\n", { mode: 0o755 });
    const r = spawnSync("bash", [SCRIPT, "build", "--out", path.join(bin, "out")], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /solo su macOS/);
    assert.equal(fs.existsSync(path.join(bin, "out")), false, "nessuna cartella creata");
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("app macOS: Info.plist con bundle id, eseguibile, macOS minimo e ATS solo locale", () => {
  const plist = fs.readFileSync(path.join(APP, "Info.plist"), "utf8");
  const value = (key) => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
  assert.equal(value("CFBundleIdentifier"), "local.opencode-lens.app");
  assert.equal(value("CFBundleExecutable"), "OpenCodeLens");
  assert.equal(value("CFBundleName"), "OpenCode Lens");
  assert.equal(value("LSMinimumSystemVersion"), "13.0");
  assert.equal(value("CFBundleIconFile"), "AppIcon");
  assert.match(plist, /<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
  assert.match(plist, /<key>NSSupportsAutomaticTermination<\/key>\s*<false\/>/);
  assert.doesNotMatch(plist, /NSAllowsArbitraryLoads/);
  assert.doesNotMatch(plist, /LSUIElement/);
});

test("app macOS: Sources/Core importa solo Foundation", () => {
  const core = swiftSources().filter((f) => f.includes(`${path.sep}Core${path.sep}`));
  assert.ok(core.length >= 5, "sorgenti di Core");
  for (const f of core) {
    const imports = fs.readFileSync(path.join(ROOT, f), "utf8").match(/^\s*(@\w+\s+)?import\s+\S+/gm) ?? [];
    assert.deepEqual(imports.map((l) => l.trim()), ["import Foundation"], f);
  }
});

test("app macOS: nessun JavaScript iniettato, nessun token in URL, nessun ATS aperto", () => {
  const forbidden = /WKUserScript|WKScriptMessageHandler|addUserScript|evaluateJavaScript|callAsyncJavaScript|NSAllowsArbitraryLoads|token=/;
  const sources = swiftSources();
  assert.ok(sources.length >= 10, "sorgenti Swift");
  // the one exception: «Open in Browser» (LensEndpoint.browserURL), the system browser has no other way in
  const allowed = (f, text) => (f.endsWith(`Core${path.sep}LensEndpoint.swift`) ? text.replace(/public func browserURL\(page: String\?\) -> URL \{[\s\S]*?\n {4}\}/, "") : text);
  for (const f of sources) assert.doesNotMatch(allowed(f, fs.readFileSync(path.join(ROOT, f), "utf8")), forbidden, f);
});

// the URL with the token goes only to the system browser: the web view gets the token as a cookie
test("app macOS: l'URL con il token va solo a NSWorkspace, mai alla web view", () => {
  const app = swiftSources().filter((f) => f.includes(`${path.sep}App${path.sep}`));
  const lines = app.flatMap((f) => fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").filter((l) => /browserURL/.test(l) && !/^\s*\/\/\//.test(l)));
  assert.ok(lines.length >= 2, "browserURL usato");
  for (const l of lines) assert.match(l, /NSWorkspace\.shared\.open\(|var browserURL: URL \{/, l.trim());
});

// window.open from a script is not a click: it must never reach the system browser
test("app macOS: solo i link cliccati vanno nel browser, mai un window.open di uno script", () => {
  const app = swiftSources().filter((f) => f.includes(`${path.sep}App${path.sep}`));
  const all = app.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  assert.match(all, /javaScriptCanOpenWindowsAutomatically = false/);
  for (const f of app) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /userLink:\s*true/, f);
});

// The lens works the same without the app: only these files may name it (install.sh aligns it,
// Impostazioni installs it); uninstall.sh never touches it
const NAMES_THE_APP = ["install.sh", "src/macos-app.js", "public/settings-macos-app.js", "public/index.html", "public/lang-en.js", "public/lang-fr.js"];

test("app macOS: solo i file autorizzati della lens nominano l'app", () => {
  const lens = [...files("src"), ...files("public"), ...files("scripts"), "install.sh", "uninstall.sh"];
  const named = lens.filter((f) => /extras\/macos|local\.opencode-lens\.app|OpenCode Lens\.app/.test(fs.readFileSync(path.join(ROOT, f), "latin1")));
  assert.deepEqual(named.sort(), [...NAMES_THE_APP].sort());
  assert.ok(!NAMES_THE_APP.includes("uninstall.sh"));
});

test("app macOS: app.sh uninstall toglie app, cache e dati WebKit e lascia stare il resto", () => {
  // a temporary HOME and stubs for the commands that would reach the real session
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lens-app-home-"));
  try {
    const bin = path.join(home, "bin");
    const log = path.join(home, "calls.log");
    fs.mkdirSync(bin);
    const stub = (name, body = "") => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}`, { mode: 0o755 });
    stub("uname", "echo Darwin\n");
    stub("pkill", "exit 1\n");
    stub("pgrep", "exit 1\n");
    stub("defaults");
    const id = "local.opencode-lens.app";
    const app = path.join(home, "Applications/OpenCode Lens.app/Contents/MacOS");
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, "OpenCodeLens"), `#!/bin/sh\necho "OpenCodeLens $*" >> "${log}"\n`, { mode: 0o755 });
    const gone = [
      "Library/Caches/opencode-lens-app/OpenCode Lens.app",
      `Library/WebKit/${id}/x`,
      `Library/Caches/${id}/x`,
      `Library/HTTPStorages/${id}/x`,
      `Library/Saved Application State/${id}.savedState/x`,
    ];
    const kept = ["Applications/opencode-lens/package.json", "Library/LaunchAgents/local.opencode-lens.plist", "Library/Application Support/opencode-lens/lens.db"];
    for (const f of [...gone, ...kept]) {
      fs.mkdirSync(path.join(home, path.dirname(f)), { recursive: true });
      fs.writeFileSync(path.join(home, f), "x");
    }
    fs.writeFileSync(path.join(home, `Library/HTTPStorages/${id}.binarycookies`), "x");

    const r = spawnSync("bash", [SCRIPT, "uninstall"], { encoding: "utf8", env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = fs.readFileSync(log, "utf8").split("\n");
    assert.ok(calls.indexOf("OpenCodeLens --unregister-login-item") >= 0, "elemento di login tolto");
    assert.ok(calls.indexOf("OpenCodeLens --unregister-login-item") < calls.indexOf("pkill -TERM -x OpenCodeLens"), "prima di chiudere e cancellare l'app");
    assert.ok(calls.includes(`defaults delete ${id}`));
    assert.equal(fs.existsSync(path.join(home, "Applications/OpenCode Lens.app")), false);
    assert.equal(fs.existsSync(path.join(home, `Library/HTTPStorages/${id}.binarycookies`)), false);
    for (const f of gone) assert.equal(fs.existsSync(path.join(home, path.dirname(f))), false, f);
    for (const f of kept) assert.ok(fs.existsSync(path.join(home, f)), f);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("app macOS: install e uninstall si fermano con HOME vuota o /", () => {
  // every command that could write or delete is a stub that only logs: nothing is touched even if the guard broke
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-app-nohome-"));
  try {
    const bin = path.join(dir, "bin");
    const log = path.join(dir, "calls.log");
    fs.mkdirSync(bin);
    for (const name of ["uname", "rm", "mkdir", "ditto", "open", "xcrun", "xcode-select", "codesign", "pkill", "pgrep", "defaults", "sw_vers"]) {
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${name === "uname" ? "echo Darwin\n" : ""}`, { mode: 0o755 });
    }
    for (const home of ["", "/"]) {
      for (const cmd of ["install", "uninstall"]) {
        const r = spawnSync("bash", [SCRIPT, cmd], { encoding: "utf8", env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } });
        assert.equal(r.status, 1, `${cmd} con HOME="${home}"`);
        assert.match(r.stderr, /HOME non impostata o uguale a \//);
      }
    }
    assert.equal(fs.existsSync(log), false, "nessun comando eseguito");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// app.sh check and update, in a temporary HOME (with a space, like the app's name) and with fake
// tools in front of PATH: nothing is ever built, installed or opened.
function appFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-app sh-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home dir");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  const marker = path.join(dir, "xcrun-called");
  const tool = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  tool("xcrun", `echo "$*" >> "${marker}"; exit 1`);
  tool("open", `echo "open $*" >> "${marker}"`);
  const run = (cmd) => spawnSync("bash", [SCRIPT, cmd], { encoding: "utf8", env: { HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin` } });
  const installApp = (version) => {
    const contents = path.join(home, "Applications", "OpenCode Lens.app", "Contents");
    fs.mkdirSync(contents, { recursive: true });
    fs.writeFileSync(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`);
  };
  return { home, tool, run, installApp, called: () => fs.existsSync(marker), cache: path.join(home, "Library", "Caches", "opencode-lens-app") };
}

const MACOS = { skip: process.platform !== "darwin" && "solo su macOS" };
const LENS_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

test("app.sh check: senza Command Line Tools dice cosa fare e non chiama mai xcrun", MACOS, (t) => {
  const f = appFixture(t);
  f.tool("xcode-select", "exit 2");
  const r = f.run("check");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /xcode-select --install/);
  assert.equal(r.stdout.trim().split("\n").length, 1, "una riga sola");
  assert.equal(f.called(), false, "xcrun può aprire la finestra di installazione");
});

test("app.sh update: senza app installata non fa niente", MACOS, (t) => {
  const f = appFixture(t);
  const r = f.run("update");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.called(), false);
  assert.equal(fs.existsSync(f.cache), false);
});

test("app.sh update: app già alla versione della lens non fa niente", MACOS, (t) => {
  const f = appFixture(t);
  f.installApp(LENS_VERSION);
  const r = f.run("update");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.called(), false);
  assert.equal(fs.existsSync(f.cache), false);
});

test("app.sh: update riapre solo un'app che era aperta, install la apre sempre", () => {
  const text = fs.readFileSync(SCRIPT, "utf8");
  const body = (name) => new RegExp(`\\n${name}\\(\\) \\{\\n([\\s\\S]*?)\\n\\}\\n`).exec(text)?.[1] ?? "";
  assert.match(body("install_app"), /pgrep -x "\$EXE"/, "install_app guarda se l'app era aperta prima di chiuderla");
  assert.match(body("install_app"), /if \[\[ "\$open" == always \|\| "\$was_open" -eq 1 \]\]; then\s*\n\s*open -a "\$DEST"/);
  assert.match(text, /\n {2}install\) install_app always ;;/);
  assert.match(body("update_app"), /install_app if-running/);
});

test("app.sh: stop_app chiude l'app con SIGTERM (un ⌘Q per l'app) e usa SIGKILL solo dopo 5 secondi", () => {
  const text = fs.readFileSync(SCRIPT, "utf8");
  const stop = /\nstop_app\(\) \{\n([\s\S]*?)\n\}\n/.exec(text)?.[1] ?? "";
  assert.match(stop, /for sig in TERM KILL; do\s*\n\s*pkill "-\$sig" -x "\$EXE"/);
  assert.match(stop, /for i in 1 2 3 4 5 6 7 8 9 10; do\s*\n\s*pgrep -x "\$EXE" >\/dev\/null 2>&1 \|\| return 0\s*\n\s*sleep 0\.5/);
  const main = fs.readFileSync(path.join(APP, "Sources", "App", "main.swift"), "utf8");
  assert.match(main, /signal\(SIGTERM, SIG_IGN\)/);
  assert.match(main, /DispatchSource\.makeSignalSource\(signal: SIGTERM, queue: \.main\)/);
  assert.match(main, /NSApp\.terminate\(nil\)/);
});

test("app.sh: senza LENS_APP_SIGN riusa il certificato dell'app installata se è nel portachiavi", () => {
  const text = fs.readFileSync(SCRIPT, "utf8");
  assert.match(text, /codesign -dv "\$DEST" 2>&1 \| sed -n 's\/\^Authority=\/\/p'/);
  assert.match(text, /security find-identity -v -p codesigning/);
  assert.match(text, /codesign --force --sign "\$identity"/);
});
