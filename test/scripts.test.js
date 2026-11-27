import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderPlist } from "../src/service.js";
import { generateKeyPair } from "../src/signature.js";
import { Updater } from "../src/update.js";
import { TEST_RELEASE_KEY, lensZipEntries, makeZip, signEntries, waitFor } from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// the files of test/ the app carries (see the install.sh and package.sh FILES): the module test kit and what it imports from there
const TEST_KIT = ["test/module-test-kit.js", "test/module-hooks.mjs", "test/helpers.js", "test/query-plan-check.js"];

for (const script of ["install.sh", "uninstall.sh", "scripts/package.sh"]) {
  test(`bash -n ${script}`, () => {
    const r = spawnSync("bash", ["-n", path.join(ROOT, script)], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  });
}

// install.sh and uninstall.sh hand the service over to `opencode-lens service`, where
// the launchd logic (and its tests, in service.test.js) lives
test("install.sh e uninstall.sh delegano a opencode-lens service", () => {
  const install = fs.readFileSync(path.join(ROOT, "install.sh"), "utf8");
  const uninstall = fs.readFileSync(path.join(ROOT, "uninstall.sh"), "utf8");
  assert.match(install, /src\/main\.js" service install/);
  assert.match(install, /LENS_PORT:\+--port/);
  assert.match(uninstall, /src\/main\.js" service uninstall "\$@"/);
  assert.doesNotMatch(install + uninstall, /launchctl|(^|[;&|(]\s*)sudo\s/m);
});

// bash 3.2 (macOS) in a UTF-8 locale reads the bytes of a character such as «…»
// right after `$NAME` as part of the name: "APP…: unbound variable" under set -u
test("script: nessuna $VARIABILE seguita da un carattere non ASCII (va tra graffe)", () => {
  for (const script of ["install.sh", "uninstall.sh", "scripts/package.sh"]) {
    const lines = fs.readFileSync(path.join(ROOT, script), "utf8").split("\n");
    const bad = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /\$[A-Za-z_][A-Za-z0-9_]*[^\t -~]/.test(l));
    assert.deepEqual(bad, [], script);
  }
});

// the locale of a Terminal on macOS, where the bug above shows up
const UTF8 = process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";

// install.sh from an extracted zip, in a temporary HOME. The fake `node` records the
// `service` call instead of running it, so launchd is never touched; everything
// else (version check, database backup) goes to the real Node.
const sh = (body) => `#!/bin/bash\n${body}\n`;
const FAKE_NODE = sh(`case " $* " in *" service "*) echo "$0 $*" >> "$NODE_LOG" ;; *) exec "$REAL_NODE" "$@" ;; esac`);
const OLD_NODE = sh(`case "$1" in -e) exit 1 ;; -p) echo 20.0.0 ;; *) exit 1 ;; esac`);

function installFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-install-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, "dl", "opencode-lens-opencode-lens-v9.9.9");
  const write = (p, text, mode = 0o644) => {
    fs.mkdirSync(path.dirname(path.join(src, p)), { recursive: true });
    fs.writeFileSync(path.join(src, p), text, { mode });
  };
  fs.mkdirSync(src, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "install.sh"), path.join(src, "install.sh"));
  write("package.json", '{\n  "name": "opencode-lens",\n  "version": "9.9.9"\n}\n');
  write("src/main.js", "");
  write("public/index.html", "");
  write("scripts/verify.mjs", "");
  write("scripts/package.sh", "");
  write("extras/opencode/lens-guard.v2.ts", "");
  write("test/x.test.js", "");
  for (const f of TEST_KIT) write(f, "");
  const home = path.join(dir, "home");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  const log = path.join(dir, "node.log");
  const run = (env = {}) =>
    spawnSync("bash", [path.join(src, "install.sh")], {
      encoding: "utf8",
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, NODE_LOG: log, REAL_NODE: process.execPath, LC_ALL: UTF8, ...env },
    });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "");
  const run2 = (args, env = {}) =>
    spawnSync("bash", [path.join(src, "install.sh"), ...args], {
      encoding: "utf8",
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, NODE_LOG: log, REAL_NODE: process.execPath, LC_ALL: UTF8, ...env },
    });
  return { dir, src, home, bin, run, run2, calls, app: path.join(home, "Applications", "opencode-lens") };
}

/** An earlier installation: an old app folder, its LaunchAgent and a database with one row. */
function previousInstall(f, appDir, { git = false } = {}) {
  fs.mkdirSync(path.join(appDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "src", "main.js"), "");
  fs.writeFileSync(path.join(appDir, "package.json"), '{\n  "name": "opencode-lens",\n  "version": "0.1.0"\n}\n');
  if (git) fs.mkdirSync(path.join(appDir, ".git"));
  const plist = path.join(f.home, "Library", "LaunchAgents", "local.opencode-lens.plist");
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  const env = { LENS_PORT: "4777", LENS_TOKEN: "segreto-di-prova-1234" };
  fs.writeFileSync(plist, renderPlist({ node: "/usr/bin/node", main: path.join(appDir, "src", "main.js"), appDir, env, logPath: "/tmp/lens.log" }));
  const dataDir = path.join(f.home, "Library", "Application Support", "opencode-lens");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "lens.db");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('dato')");
  db.close();
  fs.writeFileSync(path.join(dataDir, "dashboard.json"), "{}");
  return { plist, dataDir, dbPath, db: fs.readFileSync(dbPath), plistText: fs.readFileSync(plist, "utf8") };
}

test("install.sh da uno zip: copia in ~/Applications/opencode-lens solo i file dell'app e installa il servizio", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  const r = f.run({ LENS_PORT: "4800" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Installo opencode-lens 9\.9\.9/);
  for (const p of ["package.json", "install.sh", "src/main.js", "public/index.html", "scripts/verify.mjs", "extras/opencode/lens-guard.v2.ts"]) {
    assert.ok(fs.existsSync(path.join(f.app, p)), p);
  }
  for (const p of ["test/x.test.js", "scripts/package.sh"]) assert.equal(fs.existsSync(path.join(f.app, p)), false, p);
  // from test/ only the kit a module's tests run on travels
  assert.deepEqual(fs.readdirSync(path.join(f.app, "test")).sort(), TEST_KIT.map((p) => path.basename(p)).sort());
  assert.deepEqual(fs.readdirSync(path.join(f.home, "Applications")), ["opencode-lens"], "nessuna cartella temporanea rimasta");
  assert.equal(f.calls().trim(), `${path.join(f.bin, "node")} --disable-warning=ExperimentalWarning ${path.join(f.app, "src/main.js")} service install --port 4800`);
});

test("install.sh senza Node adatto: scarica Node dal mirror, verifica il checksum e lo conserva agli aggiornamenti", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), OLD_NODE, { mode: 0o755 });
  // a mirror laid out like nodejs.org/dist, served through file://
  const os_ = process.platform === "darwin" ? "darwin" : "linux";
  const arch = os.arch() === "arm64" ? "arm64" : "x64";
  const name = `node-v24.0.0-${os_}-${arch}`;
  const mirror = path.join(f.dir, "mirror");
  const line = path.join(mirror, "latest-v24.x");
  fs.mkdirSync(path.join(f.dir, "pkg", name, "bin"), { recursive: true });
  fs.writeFileSync(path.join(f.dir, "pkg", name, "bin", "node"), FAKE_NODE, { mode: 0o755 });
  fs.mkdirSync(line, { recursive: true });
  const tar = spawnSync("tar", ["-czf", path.join(line, `${name}.tar.gz`), "-C", path.join(f.dir, "pkg"), name]);
  assert.equal(tar.status, 0, String(tar.stderr));
  const sum = crypto.createHash("sha256").update(fs.readFileSync(path.join(line, `${name}.tar.gz`))).digest("hex");
  fs.writeFileSync(path.join(line, "SHASUMS256.txt"), `${"0".repeat(64)}  ${name}.pkg\n${sum}  ${name}.tar.gz\n`);

  const r = f.run({ LENS_NODE_MIRROR: `file://${mirror}` });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const node = path.join(f.app, "node", "bin", "node");
  assert.ok(fs.existsSync(node));
  assert.match(f.calls(), new RegExp(`^${node} .* service install\\n$`));

  // update from a new zip: the downloaded Node stays, nothing is downloaded again
  fs.rmSync(mirror, { recursive: true });
  const again = f.run({ LENS_NODE_MIRROR: `file://${mirror}` });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.doesNotMatch(again.stdout, /scarico Node/);
  assert.ok(fs.existsSync(node));
});

test("install.sh: checksum di Node sbagliato → si ferma senza installare Node", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), OLD_NODE, { mode: 0o755 });
  const name = `node-v24.0.0-${process.platform === "darwin" ? "darwin" : "linux"}-${os.arch() === "arm64" ? "arm64" : "x64"}`;
  const line = path.join(f.dir, "mirror", "latest-v24.x");
  fs.mkdirSync(line, { recursive: true });
  fs.writeFileSync(path.join(line, `${name}.tar.gz`), "non un tarball");
  fs.writeFileSync(path.join(line, "SHASUMS256.txt"), `${"0".repeat(64)}  ${name}.tar.gz\n`);
  const r = f.run({ LENS_NODE_MIRROR: `file://${path.join(f.dir, "mirror")}` });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Checksum/);
  assert.equal(fs.existsSync(path.join(f.app, "node")), false);
  assert.equal(f.calls(), "");
});

// the app's own script, faked: it writes to the same log as the fake `node`, so the order shows
const FAKE_APP_SH = sh(`echo "app.sh $*" >> "$NODE_LOG"; exit "\${APP_EXIT:-0}"`);
const appInstalled = (f) => fs.mkdirSync(path.join(f.home, "Applications", "OpenCode Lens.app", "Contents"), { recursive: true });
const appLines = (f) => f.calls().split("\n").filter((l) => l.startsWith("app.sh "));

test("install.sh: con l'app installata la riallinea dopo il servizio", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  fs.mkdirSync(path.join(f.src, "extras", "macos"), { recursive: true });
  fs.writeFileSync(path.join(f.src, "extras", "macos", "app.sh"), FAKE_APP_SH, { mode: 0o755 });
  appInstalled(f);
  const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = f.calls().trim().split("\n");
  assert.match(lines[0], / service install$/);
  assert.equal(lines[1], "app.sh update");
  assert.match(r.stdout, /Allineo l'app OpenCode Lens/);
});

test("install.sh: senza app, o con LENS_SKIP_APP=1, non chiama app.sh", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  fs.mkdirSync(path.join(f.src, "extras", "macos"), { recursive: true });
  fs.writeFileSync(path.join(f.src, "extras", "macos", "app.sh"), FAKE_APP_SH, { mode: 0o755 });
  assert.equal(f.run().status, 0);
  assert.deepEqual(appLines(f), []);
  appInstalled(f);
  assert.equal(f.run({ LENS_SKIP_APP: "1" }).status, 0);
  assert.deepEqual(appLines(f), []);
});

test("install.sh: app.sh che fallisce non fa fallire l'installazione", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  fs.mkdirSync(path.join(f.src, "extras", "macos"), { recursive: true });
  fs.writeFileSync(path.join(f.src, "extras", "macos", "app.sh"), FAKE_APP_SH, { mode: 0o755 });
  appInstalled(f);
  const r = f.run({ APP_EXIT: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(appLines(f), ["app.sh update"]);
  assert.match(r.stdout, /App OpenCode Lens non allineata/);
});

test("install.sh da un clone: allinea l'app dal clone", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  fs.mkdirSync(path.join(f.src, ".git"));
  fs.mkdirSync(path.join(f.src, "extras", "macos"), { recursive: true });
  fs.writeFileSync(path.join(f.src, "extras", "macos", "app.sh"), FAKE_APP_SH, { mode: 0o755 });
  appInstalled(f);
  const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(f.calls(), new RegExp(`${path.join(f.src, "src/main.js").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} service install`));
  assert.deepEqual(appLines(f), ["app.sh update"]);
});

test("install.sh non sovrascrive un clone in ~/Applications/opencode-lens", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  fs.mkdirSync(path.join(f.app, ".git"), { recursive: true });
  fs.writeFileSync(path.join(f.app, "mio.txt"), "lavoro");
  const r = f.run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /clone/);
  assert.equal(fs.readFileSync(path.join(f.app, "mio.txt"), "utf8"), "lavoro");
  assert.equal(f.calls(), "");
});

// package.sh builds the zip from what git tracks at HEAD: untracked or ignored files
// in the working tree (a test .db, private notes) never reach the package
test("package.sh impacchetta da git archive HEAD e conserva i symlink", () => {
  const sh = fs.readFileSync(path.join(ROOT, "scripts/package.sh"), "utf8");
  assert.match(sh, /git archive --format=tar HEAD -- "\$\{FILES\[@\]\}" \| tar -x -C "\$WORK\/opencode-lens"/);
  assert.match(sh, /git diff --quiet HEAD -- "\$\{FILES\[@\]\}"/, "si ferma con modifiche non committate");
  assert.match(sh, /^FILES=\(.*\bextras\b.*\)$/m, "il pacchetto contiene extras/ (plugin lens-guard)");
  assert.match(sh, /^FILES=\(.*\bmodules\b.*\)$/m, "il pacchetto contiene modules/");
  assert.match(fs.readFileSync(path.join(ROOT, "install.sh"), "utf8"), /^FILES=\(.*\bmodules\b.*\)$/m, "install.sh copia modules/");
  assert.match(sh, /zip -qrXy /, "zip -y: i symlink restano symlink");
  assert.doesNotMatch(sh, /cp -R/);
});

test("package.sh fuori dalla radice di un repository git: si ferma prima dei test", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-package-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.copyFileSync(path.join(ROOT, "scripts/package.sh"), path.join(dir, "scripts/package.sh"));
    fs.writeFileSync(path.join(dir, "package.json"), '{"version":"0.0.0"}');
    const r = spawnSync("bash", [path.join(dir, "scripts/package.sh")], {
      encoding: "utf8",
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /non è la radice di un repository git/);
    assert.doesNotMatch(r.stdout, /Test…/);
    assert.equal(fs.existsSync(path.join(dir, "dist")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("install.sh copia nell'app gli stessi file che package.sh mette nello zip", () => {
  const files = (file) => /^FILES=\((.*)\)$/m.exec(fs.readFileSync(path.join(ROOT, file), "utf8"))?.[1].split(/\s+/).sort();
  // a file packed but not copied reaches the zip and never the installed app (as scripts/bob-probe.mjs in 0.32.0)
  assert.deepEqual(files("install.sh"), files("scripts/package.sh"));
  // IBM Bob's probe travels in modules/ (modules/bob/scripts/bob-probe.mjs), not on its own
  assert.ok(files("install.sh").includes("modules"));
  assert.ok(!files("install.sh").includes("scripts/bob-probe.mjs"));
});

/**
 * Every file `entry` reaches through static `import … from`, `export … from` and `import "…"`, and through
 * `import("…")` with a string literal (relative specifiers only), `entry` included; paths relative to ROOT.
 * `read(rel)` gives a file's source.
 */
function importClosure(entry, read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8")) {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = read(rel);
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|(?<![\w$.])import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith(".")) visit(path.relative(ROOT, path.resolve(ROOT, path.dirname(rel), spec)));
    }
  };
  visit(entry);
  return [...seen].sort();
}

test("la chiusura degli import segue anche import(\"…\") con un percorso relativo", () => {
  const files = {
    "k/a.js": 'import { b } from "./b.js";\nexport const load = () => import("./c.js");\nconst d = await import(\'../d.js\');',
    "k/b.js": 'export * from "./e.js";\nimport fs from "node:fs";\nconst x = await import(name);',
    "k/c.js": "",
    "d.js": "",
    "k/e.js": 'import "./f.js";',
    "k/f.js": "",
  };
  assert.deepEqual(importClosure("k/a.js", (rel) => files[rel]), ["d.js", "k/a.js", "k/b.js", "k/c.js", "k/e.js", "k/f.js"]);
});

test("il pacchetto contiene il test kit dei moduli e tutto ciò che importa", () => {
  const closure = importClosure("test/module-test-kit.js");
  // the closure is what it should be: the kit pulls the helpers and the query-plan check, and the core files they read
  for (const f of ["test/helpers.js", "test/query-plan-check.js", "src/store.js", "src/module-kit.js", "public/module-widgets.js"]) assert.ok(closure.includes(f), `${f} è nella chiusura`);
  // the kit's hooks (node --import) travel too: a module copied outside the app runs its tests with them
  const wanted = new Set([...closure.filter((f) => f.startsWith("test/")), "test/module-hooks.mjs"]);
  const lists = (file) => /^FILES=\((.*)\)$/m.exec(fs.readFileSync(path.join(ROOT, file), "utf8"))?.[1].split(/\s+/);
  for (const script of ["install.sh", "scripts/package.sh"]) {
    const files = lists(script);
    for (const f of wanted) assert.ok(files.includes(f), `${script}: manca ${f}`);
    // what is not under test/ already travels with its folder
    for (const f of closure.filter((f) => !f.startsWith("test/"))) assert.ok(files.some((d) => f === d || f.startsWith(`${d}/`)), `${script}: ${f} non è in nessuna voce`);
    // nothing but the kit's own files from test/: the test files and the fixtures stay in the repository
    assert.deepEqual(
      files.filter((f) => f.startsWith("test/")).sort(),
      [...wanted].sort(),
      `${script}: da test/ viaggia solo il test kit`,
    );
  }
});

test("git archive non esclude niente di FILES: .gitattributes lascia passare il test kit", () => {
  // package.sh builds the zip with `git archive`, which drops what .gitattributes marks export-ignore: a folder
  // marked so is skipped whole, so every prefix of each FILES entry is checked, not just the entry
  const files = /^FILES=\((.*)\)$/m.exec(fs.readFileSync(path.join(ROOT, "scripts/package.sh"), "utf8"))[1].split(/\s+/);
  const prefixes = [...new Set(files.flatMap((f) => f.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"))))];
  const out = spawnSync("git", ["check-attr", "export-ignore", "--", ...prefixes], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_DIR: undefined } });
  assert.equal(out.status, 0, out.stderr);
  const ignored = out.stdout.split("\n").filter((l) => l.endsWith(": export-ignore: set"));
  assert.deepEqual(ignored, [], "nessuna voce di FILES (né una sua cartella) è export-ignore");
  // and the rest of test/ still stays out of the GitHub source archives
  const rest = spawnSync("git", ["check-attr", "export-ignore", "--", "test/scripts.test.js", "test/fixtures"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_DIR: undefined } });
  assert.match(rest.stdout, /^test\/scripts\.test\.js: export-ignore: set$/m);
  assert.match(rest.stdout, /^test\/fixtures: export-ignore: set$/m);
});

test("package.sh esclude docs/mockups e i test dei moduli dallo zip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-package-"));
  const write = (rel, body, mode) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    if (mode) fs.chmodSync(file, mode);
  };
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    write("package.json", '{"name":"opencode-lens","version":"0.0.0","scripts":{"test":"node -e 0"}}');
    write("LICENSE", "l");
    write("README.md", "r");
    write("CHANGELOG.md", "c");
    for (const f of ["README.en.md", "README.fr.md", "CHANGELOG.en.md", "CHANGELOG.fr.md"]) write(f, "t");
    write("install.sh", "#!/bin/sh\n", 0o755);
    write("uninstall.sh", "#!/bin/sh\n", 0o755);
    write("src/main.js", "process.exit(0)\n");
    write("public/index.html", "<!doctype html>");
    write("scripts/verify.mjs", "");
    write("docs/guida.md", "g");
    write("docs/mockups/index.html", "<!doctype html>");
    write("extras/opencode/lens-guard.v2.ts", "");
    write("modules/demo/module.js", "export default {};\n");
    write("modules/demo/scripts/probe.mjs", "");
    write("modules/demo/test/demo.test.js", "");
    write("test/x.test.js", "");
    for (const f of TEST_KIT) write(f, "");
    fs.copyFileSync(path.join(ROOT, "scripts/package.sh"), path.join(dir, "scripts/package.sh"));
    assert.equal(git("init", "-q").status, 0);
    git("add", "-A");
    const c = git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x");
    assert.equal(c.status, 0, c.stderr);
    // no signing variables from outside (the release workflow sets them): this repository has no signer
    const env = { ...process.env, LENS_RELEASE_KEY: "", LENS_RELEASE_KEY_FILE: "", LENS_REQUIRE_SIGNATURE: "" };
    const r = spawnSync("bash", [path.join(dir, "scripts/package.sh")], { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const list = spawnSync("unzip", ["-l", path.join(dir, "dist/opencode-lens-0.0.0.zip")], { encoding: "utf8" });
    assert.match(list.stdout, /docs\/guida\.md/);
    assert.doesNotMatch(list.stdout, /docs\/mockups/);
    // the modules travel (their scripts too, as IBM Bob's probe), their tests do not
    assert.match(list.stdout, /modules\/demo\/module\.js/);
    assert.match(list.stdout, /modules\/demo\/scripts\/probe\.mjs/);
    assert.doesNotMatch(list.stdout, /modules\/demo\/test/);
    // the module test kit travels, the tests of the app do not
    for (const f of TEST_KIT) assert.match(list.stdout, new RegExp(f.replace(/\./g, "\\.")));
    assert.doesNotMatch(list.stdout, /test\/x\.test\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("package.sh firma i file con LENS_RELEASE_KEY e senza chiave si ferma se la firma è obbligatoria", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-package-signed-"));
  const write = (rel, body, mode) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    if (mode) fs.chmodSync(file, mode);
  };
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  const run = (env) => spawnSync("bash", [path.join(dir, "scripts/package.sh")], { cwd: dir, encoding: "utf8", env: { ...process.env, LENS_RELEASE_KEY: "", LENS_RELEASE_KEY_FILE: "", ...env } });
  try {
    write("package.json", '{"name":"opencode-lens","version":"0.0.1","scripts":{"test":"node -e 0"}}');
    for (const f of ["LICENSE", "README.md", "README.en.md", "README.fr.md", "CHANGELOG.md", "CHANGELOG.en.md", "CHANGELOG.fr.md", "docs/guida.md", "scripts/verify.mjs", "extras/x.ts", "modules/demo/module.js"]) write(f, "t");
    for (const f of TEST_KIT) write(f, "t");
    write("install.sh", "#!/bin/sh\n", 0o755);
    write("uninstall.sh", "#!/bin/sh\n", 0o755);
    write("src/main.js", "process.exit(0)\n");
    write("public/index.html", "<!doctype html>");
    for (const f of ["src/signature.js", "scripts/sign-release.mjs", "scripts/package.sh"]) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    write("src/release-key.js", `export const RELEASE_PUBLIC_KEY = "${TEST_RELEASE_KEY.publicKey}";\n`);
    assert.equal(git("init", "-q").status, 0);
    git("add", "-A");
    assert.equal(git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x").status, 0);

    const required = run({ LENS_REQUIRE_SIGNATURE: "1" });
    assert.notEqual(required.status, 0);
    assert.match(required.stderr, /LENS_REQUIRE_SIGNATURE=1 ma manca la chiave/);

    const signed = run({ LENS_RELEASE_KEY: TEST_RELEASE_KEY.privatePem, LENS_REQUIRE_SIGNATURE: "1" });
    assert.equal(signed.status, 0, signed.stdout + signed.stderr);
    assert.match(signed.stdout, /firmato/);
    const out = path.join(dir, "out");
    assert.equal(spawnSync("unzip", ["-q", path.join(dir, "dist/opencode-lens-0.0.1.zip"), "-d", out]).status, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "opencode-lens", "MANIFEST.json"), "utf8"));
    assert.equal(manifest.version, "0.0.1");
    assert.ok("src/main.js" in manifest.files && "LICENSE" in manifest.files);
    const verify = (folder) => spawnSync(process.execPath, [path.join(dir, "scripts/sign-release.mjs"), "verify", folder], { encoding: "utf8" });
    assert.equal(verify(path.join(out, "opencode-lens")).status, 0);
    fs.appendFileSync(path.join(out, "opencode-lens", "src", "main.js"), "// cambiato\n");
    assert.match(verify(path.join(out, "opencode-lens")).stderr, /modificato: src\/main\.js/);

    const other = run({ LENS_RELEASE_KEY: generateKeyPair().privatePem });
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /non corrisponde alla chiave pubblica/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("git archive non esclude niente del modulo d'esempio: i suoi test viaggiano con lui", () => {
  const tracked = spawnSync("git", ["ls-files", "--", "extras/module-template"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_DIR: undefined } });
  assert.equal(tracked.status, 0, tracked.stderr);
  const files = tracked.stdout.split("\n").filter(Boolean);
  assert.ok(files.includes("extras/module-template/test/template.test.js"), "i test del modulo d'esempio sono nel repository");
  const out = spawnSync("git", ["check-attr", "export-ignore", "--", "extras", "extras/module-template", ...files], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_DIR: undefined } });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.stdout.split("\n").filter((l) => l.endsWith(": export-ignore: set")), []);
});

function lens(args, env = {}) {
  return spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "src/main.js"), ...args], {
    encoding: "utf8",
    env: { ...process.env, OPENCODE_SERVICE_FILE: "/nonesiste/service.json", ...env },
  });
}

test("main.js --help esce con 0 senza toccare OpenCode ed elenca service e mcp", () => {
  const r = lens(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--check/);
  assert.match(r.stdout, /--resync/);
  assert.match(r.stdout, /service install \[--port N\]/);
  assert.match(r.stdout, /service uninstall \[--purge\]/);
  assert.match(r.stdout, /opencode-lens mcp \[install\]/);
  assert.match(r.stdout, /mcp install +stampa la riga opencode2 mcp add/);
});

test("main.js mcp con un argomento sconosciuto: uso su stderr, stdout vuoto, exit 2", () => {
  const r = lens(["mcp", "boh"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /uso: opencode-lens mcp \[install\]/);
});

test("main.js service: azione mancante o sconosciuta → uso ed exit 2", () => {
  for (const args of [["service"], ["service", "boh"]]) {
    const r = lens(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /uso: opencode-lens service/);
  }
  const port = lens(["service", "install", "--port", "abc"]);
  assert.equal(port.status, 2);
  assert.match(port.stderr, /--port/);
});

test("main.js service status con una HOME vuota: non installato, nessuna variabile richiesta", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lens-status-"));
  try {
    // an invalid environment must not stop service commands: they do not start the lens
    const r = lens(["service", "status"], { HOME: home, LENS_PORT: "nonvalida" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /non installato/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("install.sh sopra un'installazione precedente: copia del database e del plist, vecchia cartella nel Cestino, dati intatti", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  const old = path.join(f.home, "Downloads", "opencode-lens");
  const prev = previousInstall(f, old);
  fs.mkdirSync(path.join(f.home, ".Trash"));

  const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`app: ${old} \\(0\\.1\\.0\\)`));
  // the database, the dashboard layout and the plist are left as they were
  assert.deepEqual(fs.readFileSync(prev.dbPath), prev.db);
  assert.equal(fs.readFileSync(path.join(prev.dataDir, "dashboard.json"), "utf8"), "{}");
  assert.equal(fs.readFileSync(prev.plist, "utf8"), prev.plistText);
  // a readable copy of the database and of the plist, with its variables
  const backups = fs.readdirSync(path.join(prev.dataDir, "backup"));
  const dbCopy = backups.find((n) => /^lens-0\.1\.0-\d{8}-\d{6}\.db$/.test(n));
  assert.ok(dbCopy, backups.join(", "));
  const copy = new DatabaseSync(path.join(prev.dataDir, "backup", dbCopy), { readOnly: true });
  assert.deepEqual({ ...copy.prepare("SELECT x FROM t").get() }, { x: "dato" });
  copy.close();
  const plistCopy = backups.find((n) => n.endsWith(".plist"));
  assert.match(fs.readFileSync(path.join(prev.dataDir, "backup", plistCopy), "utf8"), /segreto-di-prova-1234/);
  assert.equal(fs.statSync(path.join(prev.dataDir, "backup", plistCopy)).mode & 0o777, 0o600);
  // the old app folder goes to the Trash only after the service install succeeded
  assert.match(f.calls(), / service install\n$/);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.readdirSync(path.join(f.home, ".Trash")).filter((n) => n.startsWith("opencode-lens-")).length, 1);
});

test("install.sh --check: elenca servizio, database e altre copie senza cambiare niente", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  const old = path.join(f.home, "Downloads", "opencode-lens");
  const prev = previousInstall(f, old);
  const stray = path.join(f.home, "Desktop", "opencode-lens-0.5.0");
  fs.mkdirSync(path.join(stray, "src"), { recursive: true });
  fs.writeFileSync(path.join(stray, "src", "main.js"), "");
  fs.writeFileSync(path.join(stray, "package.json"), '{ "name": "opencode-lens", "version": "0.5.0" }');

  const r = f.run2(["--check"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Versione da installare: 9\.9\.9/);
  assert.match(r.stdout, new RegExp(`app: ${old} \\(0\\.1\\.0\\)`));
  assert.match(r.stdout, /node: \/usr\/bin\/node/);
  assert.match(r.stdout, /Database: .*lens\.db/);
  assert.match(r.stdout, new RegExp(`Altra copia, non usata dal servizio: ${fs.realpathSync(stray)} \\(0\\.5\\.0\\)`));
  assert.match(r.stdout, /nessuna modifica/);
  assert.equal(fs.existsSync(f.app), false);
  assert.equal(fs.existsSync(path.join(prev.dataDir, "backup")), false);
  assert.ok(fs.existsSync(old));
  assert.equal(f.calls(), "");

  const extra = f.run2(["a", "b"]);
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /uso: bash install\.sh/);
});

test("install.sh: il clone da cui partiva il servizio resta dove si trova", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  const clone = path.join(f.home, "Documents", "opencode-lens");
  previousInstall(f, clone, { git: true });
  const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /lo lascio dove si trova/);
  assert.ok(fs.existsSync(path.join(clone, ".git")));
});

test("install.sh con LENS_NO_SCAN=1 non cerca altre copie", (t) => {
  const f = installFixture(t);
  fs.writeFileSync(path.join(f.bin, "node"), FAKE_NODE, { mode: 0o755 });
  const stray = path.join(f.home, "Desktop", "opencode-lens-0.5.0");
  fs.mkdirSync(path.join(stray, "src"), { recursive: true });
  fs.writeFileSync(path.join(stray, "src", "main.js"), "");
  fs.writeFileSync(path.join(stray, "package.json"), '{ "name": "opencode-lens", "version": "0.5.0" }');
  assert.match(f.run2(["--check"]).stdout, /Altra copia/);
  const r = f.run2(["--check"], { LENS_NO_SCAN: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /Altra copia/);
});

// Impostazioni › Aggiornamento end to end, launchd aside: the uploaded zip's real install.sh
// run by the real detached helper, in a temporary HOME with the fake node first in PATH
async function updaterFixture(t, install) {
  const f = installFixture(t);
  const prev = previousInstall(f, f.app);
  const log = path.join(f.dir, "helper-node.log");
  // the helper's environment is clean: the fake node knows its paths by heart
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(path.join(f.bin, "node"), sh(`case " $* " in *" service "*) echo "$0 $*" >> ${q(log)} ;; *) exec ${q(process.execPath)} "$@" ;; esac`), { mode: 0o755 });
  const settings = {
    platform: "darwin",
    plistPath: prev.plist,
    label: "local.opencode-lens",
    env: { XPC_SERVICE_NAME: "local.opencode-lens" },
    restarting: false,
    status: () => ({ pending: false }),
  };
  const updater = new Updater({
    settings,
    appDir: f.app,
    home: f.home,
    dir: path.join(prev.dataDir, "update"),
    version: "0.1.0",
    programArguments: () => [path.join(f.bin, "node"), path.join(f.app, "src", "main.js")],
    env: { HOME: f.home, LC_ALL: UTF8, LENS_PORT: "4999", XPC_SERVICE_NAME: "local.opencode-lens" },
    releaseKey: TEST_RELEASE_KEY.publicKey,
  });
  const entries = signEntries(lensZipEntries("opencode-lens-opencode-lens-v9.9.9", { install: install ?? fs.readFileSync(path.join(ROOT, "install.sh"), "utf8") }));
  const preview = updater.upload(makeZip(entries));
  const uploadDir = updater.staged.dir;
  updater.apply({ id: preview.id });
  const exitFile = path.join(updater.dir, "last.exit");
  await waitFor(() => fs.existsSync(exitFile) && !updater.running, { timeoutMs: 30_000, what: "fine dell'helper" });
  return { f, prev, updater, settings, uploadDir, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "") };
}

test("Aggiornamento: l'helper lancia install.sh dello zip, che copia l'app, fa il backup e reinstalla il servizio", async (t) => {
  const { f, prev, updater, settings, uploadDir, calls } = await updaterFixture(t);
  const s = updater.status({ local: true });
  assert.equal(s.last.state, "ok", s.last.log);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.app, "package.json"), "utf8")).version, "9.9.9");
  // LENS_PORT of the running lens must not reach install.sh: the plist's port stays
  assert.match(calls(), / service install\n$/);
  assert.ok(fs.readdirSync(path.join(prev.dataDir, "backup")).some((n) => /^lens-0\.1\.0-.*\.db$/.test(n)));
  assert.equal(fs.existsSync(uploadDir), false);
  assert.equal(settings.restarting, false);
  assert.match(s.last.log, /Installo opencode-lens 9\.9\.9/);
  assert.doesNotMatch(s.last.log, /Altra copia/);
});

test("Aggiornamento: install.sh che fallisce lascia la lens com'era e lo stato «non riuscito»", async (t) => {
  const { f, updater, settings } = await updaterFixture(t, "#!/bin/bash\necho rotto >&2\nexit 3\n");
  const s = updater.status({ local: true });
  assert.equal(s.last.state, "failed");
  assert.equal(s.last.exit, 3);
  assert.match(s.last.log, /rotto/);
  assert.equal(settings.restarting, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.app, "package.json"), "utf8")).version, "0.1.0");
});

/** GET on 127.0.0.1:port with an explicit Host header; resolves { status, type, body }. */
function get(port, p, host = `127.0.0.1:${port}`, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("main.js con un database che non si apre: resta su, /healthz 503 col motivo, un solo messaggio nel log", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-baddb-"));
  const db = new DatabaseSync(path.join(dir, "lens.db"));
  db.exec("PRAGMA user_version = 99"); // a newer lens wrote it: this one refuses to open it
  db.close();
  const port = await new Promise((r) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });
  const env = { ...process.env, HOME: dir, LENS_DB: path.join(dir, "lens.db"), LENS_PORT: String(port), OPENCODE_SERVICE_FILE: "/nonesiste/service.json" };
  delete env.XPC_SERVICE_NAME;
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "src/main.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((r) => child.on("exit", (code, signal) => r({ code, signal })));
  try {
    let health;
    await waitFor(async () => (health = await get(port, "/healthz").catch(() => null)) !== null && child.exitCode === null, {
      what: "la lens risponde invece di uscire",
    });
    assert.equal(health.status, 503, output);
    const h = JSON.parse(health.body);
    assert.equal(h.ok, false);
    assert.match(h.error, /schema 99/);
    const page = await get(port, "/");
    assert.equal(page.status, 503);
    assert.match(page.type, /^text\/plain/);
    assert.match(page.body, /schema 99/);
    assert.equal((await get(port, "/", "evil.example:80")).status, 403, "stesso controllo dell'Host della lens");
    assert.equal((await get(port, "/api/settings", undefined, "POST")).status, 405, "nessuna scrittura");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(child.exitCode, null, "ancora in esecuzione: launchd non la riavvia in loop");
    assert.equal(output.match(/schema 99/g)?.length, 1, `un solo messaggio, senza stack:\n${output}`);
    child.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// in the release workflow npm run package has the private key in its environment: the tests it runs must not
test("package.sh lancia i test senza le variabili della chiave di firma", () => {
  const sh = fs.readFileSync(path.join(ROOT, "scripts/package.sh"), "utf8");
  assert.match(sh, /env -u LENS_RELEASE_KEY -u LENS_RELEASE_KEY_FILE -u LENS_REQUIRE_SIGNATURE npm test/);
  assert.doesNotMatch(sh.replace(/env -u [^\n]*npm test/g, ""), /npm test/);
});
