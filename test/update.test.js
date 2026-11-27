import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAX_UPLOAD,
  STAGE_TTL_MS,
  STALE_MS,
  Updater,
  compareVersions,
  extractPlan,
  helperEnv,
  helperScript,
  inspectPackage,
  nodeSatisfies,
  packageKind,
  planEntries,
  planPackage,
  safeEntryName,
  updateState,
} from "../src/update.js";
import { generateKeyPair } from "../src/signature.js";
import { ZipError, readZipEntries } from "../src/zip.js";
import { TEST_RELEASE_KEY, lensZipEntries, makeZip, signEntries } from "./helpers.js";

const plan = (entries) => {
  const buf = makeZip(entries);
  return { buf, plan: planPackage(readZipEntries(buf)) };
};

test("safeEntryName: niente percorsi che escono dalla cartella o non portabili", () => {
  assert.deepEqual(safeEntryName("a/b/c.js"), ["a", "b", "c.js"]);
  assert.deepEqual(safeEntryName("a/b/"), ["a", "b"]);
  for (const bad of ["", "/etc/passwd", "a/../../x", "a/./b", "a//b", "C:/x", "a\\b", "a/\u0000b", "../x"]) {
    assert.equal(safeEntryName(bad), null, bad);
  }
});

test("planPackage: zip della release, Source code di GitHub e cartella rifatta col Finder", () => {
  for (const root of ["opencode-lens", "opencode-lens-opencode-lens-v0.17.0", "opencode-lens-main", "Nuova cartella"]) {
    const { plan: p } = plan(lensZipEntries(root));
    assert.equal(p.root, root);
    assert.ok(p.files.some((f) => f.rel === "src/main.js"));
  }
  assert.deepEqual(["opencode-lens", "opencode-lens-opencode-lens-v0.17.0", "opencode-lens-main", "Nuova cartella"].map(packageKind), ["release", "source", "branch", "cartella"]);
});

test("planEntries: la cartella dei metadati di versione è un errore di default, ignorata con ignoreGit; il file .gitignore non conta", () => {
  const entries = readZipEntries(
    makeZip([
      { name: "a/x", data: "1" },
      { name: "a/.git/HEAD", data: "ref" },
      { name: "a/.gitignore", data: "y" },
    ]),
  );
  assert.throws(() => planEntries(entries), /\.git/);
  const p = planEntries(entries, { ignoreGit: true });
  assert.deepEqual(
    p.files.map((f) => f.segs.join("/")),
    ["a/x", "a/.gitignore"],
  );
});

test("planPackage: ignora __MACOSX, ._* e .DS_Store; permessi 0755 solo con il bit di esecuzione", () => {
  const { plan: p } = plan([...lensZipEntries(), { name: "__MACOSX/opencode-lens/._install.sh", data: "x" }, { name: "opencode-lens/.DS_Store", data: "x" }, { name: "opencode-lens/src/._main.js", data: "x" }]);
  assert.ok(!p.files.some((f) => /DS_Store|\._/.test(f.rel)));
  assert.equal(p.files.find((f) => f.rel === "install.sh").mode, 0o755);
  assert.equal(p.files.find((f) => f.rel === "src/main.js").mode, 0o644);
});

test("planPackage: rifiuta zip ostili o che non sono la lens", () => {
  const cases = [
    [[...lensZipEntries(), { name: "opencode-lens/../../evil", data: "x" }], /nome non valido/],
    [[...lensZipEntries(), { name: "/tmp/evil", data: "x" }], /nome non valido/],
    [[...lensZipEntries(), { name: "opencode-lens/link", data: "/etc", mode: 0o120777 }], /collegamento simbolico/],
    [[...lensZipEntries(), { name: "opencode-lens/fifo", mode: 0o010644 }], /tipo speciale/],
    [[...lensZipEntries(), { name: "opencode-lens/SRC/main.js", data: "x" }], /file doppio/],
    [[...lensZipEntries(), { name: "opencode-lens/.git/HEAD", data: "ref" }], /\.git/],
    [[...lensZipEntries(), { name: "altro/x", data: "x" }], /una sola cartella/],
    [[...lensZipEntries(), { name: "README.md", data: "x" }], /una sola cartella|fuori dalla cartella/],
    [lensZipEntries().filter((e) => !e.name.endsWith("install.sh")), /mancano install\.sh/],
    [[], /vuoto/],
  ];
  for (const [entries, re] of cases) assert.throws(() => plan(entries), re);
});

test("planPackage: limite sulla dimensione estratta dichiarata", () => {
  assert.throws(() => plan([...lensZipEntries(), { name: "opencode-lens/big", data: "x", size: 65 * 1024 * 1024 }]), /troppo grande/);
});

test("extractPlan: scrive i file con i permessi e non sovrascrive niente", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-extract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { buf, plan: p } = plan(lensZipEntries("opencode-lens-main"));
  const dest = path.join(dir, "opencode-lens");
  extractPlan(buf, p, dest);
  assert.equal(fs.readFileSync(path.join(dest, "src", "main.js"), "utf8"), "// main\n");
  assert.equal(fs.statSync(path.join(dest, "install.sh")).mode & 0o777, 0o755);
  assert.throws(() => extractPlan(buf, p, dest), /EEXIST/);
});

test("compareVersions e nodeSatisfies", () => {
  assert.equal(compareVersions("0.17.0", "0.16.0"), 1);
  assert.equal(compareVersions("0.16.0", "0.16.0"), 0);
  assert.equal(compareVersions("0.9.0", "0.16.0"), -1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("x", "1.0.0"), null);
  assert.equal(nodeSatisfies(">=22.13", "22.13.0"), true);
  assert.equal(nodeSatisfies(">=22.13", "22.12.9"), false);
  assert.equal(nodeSatisfies(">=24", "24.1.0"), true);
  assert.equal(nodeSatisfies("^22", "18.0.0"), true);
});

test("inspectPackage: confronto, novità tra le due versioni, avvisi ed errori", () => {
  const md = "## [0.18.0](x) (2026-10-20)\n\n### Aggiunto\n\n* **opencode-lens:** b\n\n## [0.17.0](x) (2026-10-19)\n\n### Corretto\n\n* **opencode-lens:** a\n\n## [0.16.0](x) (2026-10-18)\n\n* vecchia\n";
  const base = { pkg: { name: "opencode-lens", version: "0.18.0", engines: { node: ">=22.13" } }, changelogMd: md, installSh: "LENS_NO_SCAN", current: "0.16.0", nodeVersion: "24.0.0", kind: "release" };
  const newer = inspectPackage(base);
  assert.equal(newer.comparison, "newer");
  assert.deepEqual(newer.changes.map((c) => [c.version, c.items]), [["0.18.0", ["b"]], ["0.17.0", ["a"]]]);
  assert.deepEqual([newer.errors, newer.warnings], [[], []]);

  const same = inspectPackage({ ...base, current: "0.18.0" });
  assert.equal(same.comparison, "same");
  assert.match(same.warnings[0], /già installata/);
  const older = inspectPackage({ ...base, current: "0.19.0" });
  assert.equal(older.comparison, "older");
  assert.match(older.warnings.join(), /più vecchia/);
  assert.match(inspectPackage({ ...base, installSh: "", kind: "branch" }).warnings.join("|"), /branch.*\|.*Download, Scrivania e Documenti/);

  assert.match(inspectPackage({ ...base, pkg: { ...base.pkg, version: "0.12.0" } }).errors[0], /più vecchia della 0\.12\.1/);
  assert.match(inspectPackage({ ...base, pkg: { ...base.pkg, engines: { node: ">=26" } } }).errors[0], /richiede Node >=26/);
  assert.match(inspectPackage({ ...base, pkg: { name: "altro", version: "1.0.0" } }).errors[0], /non è di opencode-lens/);
  assert.match(inspectPackage({ ...base, pkg: { name: "opencode-lens" } }).errors[0], /versione dello zip non valida/);
});

test("helperEnv: niente variabili della lens né di launchd, il suo Node in testa al PATH, niente download", () => {
  const env = helperEnv({
    env: { HOME: "/h", USER: "u", LANG: "it_IT.UTF-8", LENS_PORT: "4999", LENS_TOKEN: "x", LENS_SKIP_BACKUP: "1", XPC_SERVICE_NAME: "local.opencode-lens", PATH: "/usr/bin", OPENCODE_SERVER_PASSWORD: "p" },
    nodeDir: "/opt/homebrew/opt/node/bin",
  });
  assert.deepEqual(env, { HOME: "/h", USER: "u", LANG: "it_IT.UTF-8", PATH: "/opt/homebrew/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin", LENS_NO_SCAN: "1", LENS_NODE_MIRROR: "file:///nonexistent" });
});

test("helperScript: install.sh, poi il codice d'uscita, poi la cartella estratta rimossa solo se è di un upload", () => {
  const s = helperScript();
  assert.match(s, /\/bin\/bash "\$1\/install\.sh"/);
  assert.match(s, /mv -f "\$2\/last\.exit\.tmp" "\$2\/last\.exit"/);
  assert.match(s, /case "\$3" in "\$2"\/upload-\*\) rm -rf "\$3"/);
});

test("updateState", () => {
  const last = { from: "0.16.0", to: "0.17.0", startedAt: 1 };
  assert.equal(updateState({ last: null }), null);
  assert.equal(updateState({ last, exit: null, alive: true }).state, "running");
  assert.equal(updateState({ last, exit: null, alive: false }).state, "interrupted");
  assert.equal(updateState({ last, exit: 0 }).state, "ok");
  assert.deepEqual(updateState({ last, exit: 3 }), { from: "0.16.0", to: "0.17.0", startedAt: 1, state: "failed", exit: 3 });
});

// --- Updater ---------------------------------------------------------------------

function fixture(t, { settingsOver = {}, ...over } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-updater-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const appDir = path.join(home, "Applications", "opencode-lens");
  fs.mkdirSync(appDir, { recursive: true });
  const plistPath = path.join(root, "lens.plist");
  fs.writeFileSync(plistPath, "<plist/>");
  const settings = {
    platform: "darwin",
    plistPath,
    label: "local.opencode-lens",
    env: { XPC_SERVICE_NAME: "local.opencode-lens" },
    restarting: false,
    pending: false,
    status() {
      return { pending: this.pending };
    },
    ...settingsOver,
  };
  const spawned = [];
  const child = Object.assign(new EventEmitter(), { pid: 4242, unref() {} });
  let now = 1000;
  const u = new Updater({
    settings,
    appDir,
    home,
    dir: path.join(root, "data", "update"),
    version: "0.16.0",
    nodeVersion: "24.0.0",
    programArguments: () => ["/opt/homebrew/opt/node/bin/node", "--disable-warning=ExperimentalWarning", path.join(appDir, "src", "main.js")],
    env: { HOME: home, LENS_PORT: "4777", XPC_SERVICE_NAME: "local.opencode-lens" },
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      return child;
    },
    now: () => now,
    isAlive: (pid) => pid === 4242 && !child.exited,
    pid: 777,
    releaseKey: TEST_RELEASE_KEY.publicKey,
    ...over,
  });
  return { u, root, home, appDir, settings, spawned, child, tick: (ms) => (now += ms) };
}

const zip = (opts) => makeZip(signEntries(lensZipEntries("opencode-lens", { version: "0.17.0", install: "#!/bin/bash\n# LENS_NO_SCAN\n", ...opts })));

test("Updater.upload: estrae nella cartella update e restituisce l'anteprima", (t) => {
  const f = fixture(t);
  const p = f.u.upload(zip());
  assert.equal(p.version, "0.17.0");
  assert.equal(p.current, "0.16.0");
  assert.equal(p.comparison, "newer");
  assert.equal(p.kind, "release");
  assert.deepEqual(p.changes.map((c) => c.version), ["0.17.0"]);
  assert.match(p.id, /^[0-9a-f]{16}$/);
  const src = f.u.staged.src;
  assert.ok(src.startsWith(path.join(f.root, "data", "update", "upload-")));
  assert.equal(fs.readFileSync(path.join(src, "src", "main.js"), "utf8"), "// main\n");
  assert.equal(fs.statSync(path.join(f.root, "data", "update")).mode & 0o777, 0o700);
  assert.deepEqual(f.u.status().staged, p);
  // a second upload replaces the first
  const first = f.u.staged.dir;
  f.u.upload(zip());
  assert.ok(!fs.existsSync(first));
});

test("Updater.upload: zip non valido o rifiutato → 400 senza scrivere niente", (t) => {
  const f = fixture(t);
  assert.throws(() => f.u.upload(Buffer.from("nope")), (err) => err.status === 400 && /non è un file zip/.test(err.errors[0]));
  assert.throws(() => f.u.upload(zip({ version: "0.10.0" })), (err) => err.status === 400 && /0\.12\.1/.test(err.errors[0]));
  assert.throws(() => f.u.upload(Buffer.alloc(MAX_UPLOAD + 1)), (err) => err.status === 413);
  assert.ok(!fs.existsSync(path.join(f.root, "data", "update")) || fs.readdirSync(path.join(f.root, "data", "update")).length === 0);
});

test("Updater.upload: solo release firmate, con gli stessi file del manifesto", (t) => {
  const f = fixture(t);
  const entries = lensZipEntries("opencode-lens", { version: "0.17.0" });
  const refused = (buf, re) => assert.throws(() => f.u.upload(buf), (err) => err.status === 400 && re.test(err.errors[0]));
  refused(makeZip(entries), /non è firmato/);
  refused(makeZip(signEntries(entries, { key: generateKeyPair().privatePem })), /Firma dello zip non valida/);
  const signed = signEntries(entries);
  const swap = (name, data) => signed.map((e) => (e.name === name ? { ...e, data } : e));
  refused(makeZip(swap("opencode-lens/src/main.js", "// altro\n")), /modificati dopo la firma della release: src\/main\.js/);
  refused(makeZip(swap("opencode-lens/MANIFEST.json", "{}")), /Firma dello zip non valida/);
  refused(makeZip([...signed, { name: "opencode-lens/src/extra.js", data: "x" }]), /non fanno parte della release: src\/extra\.js/);
  refused(makeZip(signed.filter((e) => e.name !== "opencode-lens/CHANGELOG.md")), /Mancano file della release: CHANGELOG\.md/);
  assert.ok(!fs.existsSync(path.join(f.root, "data", "update")) || fs.readdirSync(path.join(f.root, "data", "update")).length === 0);
  // the Finder compressing the extracted folder again: other root name, macOS litter, same files
  const refolded = signed.map((e) => ({ ...e, name: e.name.replace(/^opencode-lens/, "Nuova cartella") }));
  assert.equal(f.u.upload(makeZip([...refolded, { name: "Nuova cartella/.DS_Store", data: "x" }])).version, "0.17.0");
  // a lens without a key cannot check anything: from the terminal only
  const g = fixture(t, { releaseKey: null });
  assert.throws(() => g.u.upload(makeZip(signed)), (err) => err.status === 409 && /non ha la chiave/.test(err.errors[0]));
});

test("Updater.upload: senza cartella dati (database in memoria) 409", (t) => {
  const f = fixture(t, { dir: null });
  assert.throws(() => f.u.upload(zip()), (err) => err.status === 409);
  assert.match(f.u.blocked(), /in memoria/);
});

test("Updater: all'avvio cancella i caricamenti mai applicati", (t) => {
  const f = fixture(t);
  f.u.upload(zip());
  const dir = f.u.staged.dir;
  new Updater({ settings: f.settings, appDir: f.appDir, home: f.home, dir: path.dirname(dir), version: "0.16.0" });
  assert.ok(!fs.existsSync(dir));
});

test("Updater.blocked: come Salva e riavvia, più cartella dell'app e clone", (t) => {
  assert.equal(fixture(t).u.blocked(), null);
  assert.match(fixture(t, { settingsOver: { platform: "linux" } }).u.blocked(), /solo con il servizio di macOS/);
  assert.match(fixture(t, { settingsOver: { plistPath: "/nope.plist" } }).u.blocked(), /LaunchAgent non trovato/);
  assert.match(fixture(t, { settingsOver: { env: {} } }).u.blocked(), /avviata a mano/);
  const other = fixture(t);
  other.u.appDir = path.join(other.root, "clone");
  fs.mkdirSync(other.u.appDir);
  assert.match(other.u.blocked(), /gira da .*clone, non da/);
  fs.mkdirSync(path.join(other.u.appDir, ".git"));
  assert.match(other.u.blocked(), /clone del repository/);
});

test("Updater.apply: lancia l'helper staccato con l'ambiente pulito e segna il riavvio", (t) => {
  const f = fixture(t);
  const p = f.u.upload(zip());
  const staged = f.u.staged;
  assert.deepEqual(f.u.apply({ id: p.id }), { restarting: true, version: "0.17.0" });
  const [call] = f.spawned;
  assert.equal(call.cmd, "/bin/sh");
  assert.deepEqual(call.args.slice(0, 2), ["-c", helperScript()]);
  assert.deepEqual(call.args.slice(2), ["sh", staged.src, f.u.dir, staged.dir]);
  assert.equal(call.opts.cwd, f.u.dir);
  assert.equal(call.opts.detached, true);
  assert.equal(call.opts.env.PATH.split(":")[0], "/opt/homebrew/opt/node/bin");
  assert.equal(call.opts.env.LENS_PORT, undefined);
  assert.equal(call.opts.env.XPC_SERVICE_NAME, undefined);
  assert.equal(f.settings.restarting, true);
  const last = JSON.parse(fs.readFileSync(path.join(f.u.dir, "last.json"), "utf8"));
  assert.deepEqual([last.from, last.to, last.pid, last.helper], ["0.16.0", "0.17.0", 777, 4242]);
  assert.equal(f.u.status().last.state, "running");
  assert.equal(f.u.status().running, true);
  assert.equal(f.u.status().staged, null);
  // a second apply, or a save of the settings, while it runs
  assert.throws(() => f.u.apply({ id: p.id }), (err) => err.status === 409);
  assert.throws(() => f.u.upload(zip()), (err) => err.status === 409);
});

test("Updater.apply: install.sh fallito prima del riavvio → non riuscito, la lens torna salvabile", (t) => {
  const f = fixture(t);
  const p = f.u.upload(zip());
  f.u.apply({ id: p.id });
  fs.writeFileSync(path.join(f.u.dir, "last.exit"), "1\n");
  fs.writeFileSync(path.join(f.u.dir, "last.log"), "riga 1\nIn /x non c'è opencode-lens\n");
  f.child.exited = true;
  f.child.emit("exit", 1);
  assert.equal(f.settings.restarting, false);
  const s = f.u.status({ local: true });
  assert.equal(s.running, false);
  assert.equal(s.last.state, "failed");
  assert.equal(s.last.exit, 1);
  assert.match(s.last.log, /non c'è opencode-lens/);
  assert.equal(f.u.status({ local: false }).last.log, undefined);
});

test("Updater.apply: rifiuti", (t) => {
  const f = fixture(t);
  assert.throws(() => f.u.apply({ id: "x" }), (err) => err.status === 404);
  const p = f.u.upload(zip());
  assert.throws(() => f.u.apply({ id: "altro" }), (err) => err.status === 404);
  f.settings.pending = true;
  assert.throws(() => f.u.apply({ id: p.id }), (err) => err.status === 409 && /non ancora applicate/.test(err.errors[0]));
  f.settings.pending = false;
  f.tick(STAGE_TTL_MS + 1);
  assert.throws(() => f.u.apply({ id: p.id }), (err) => err.status === 404);
  assert.equal(f.spawned.length, 0);

  const g = fixture(t);
  g.u.version = "0.18.0";
  const older = g.u.upload(zip());
  assert.equal(older.comparison, "older");
  assert.throws(() => g.u.apply({ id: older.id }), (err) => err.status === 400 && /più vecchia/.test(err.errors[0]));
  g.u.apply({ id: older.id, allowOlder: true });
  assert.equal(g.spawned.length, 1);

  const h = fixture(t, { settingsOver: { env: {} } });
  const ph = h.u.upload(zip());
  assert.throws(() => h.u.apply({ id: ph.id }), (err) => err.status === 409 && /avviata a mano/.test(err.errors[0]));
});

test("Updater: dopo il riavvio la lens nuova legge com'è andata", (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.u.dir, { recursive: true });
  fs.writeFileSync(path.join(f.u.dir, "last.json"), JSON.stringify({ from: "0.15.0", to: "0.16.0", startedAt: 5, pid: 1, helper: 99 }));
  assert.equal(f.u.status().last.state, "interrupted");
  fs.writeFileSync(path.join(f.u.dir, "last.exit"), "0\n");
  assert.deepEqual(f.u.status().last, { from: "0.15.0", to: "0.16.0", startedAt: 5, state: "ok", exit: 0 });
});

test("ZipError resta un errore distinto", () => {
  assert.ok(new ZipError("x") instanceof Error);
});

test("safeEntryName: rifiuta i controlli C1 e DEL, accetta le lettere accentate, gli spazi e ..nome", () => {
  for (const bad of ["a/e\u0301\u0081.md", "a/\u0085x", "a/\u007fx", "a/\u009fx", "a/x\u0000", "a/x\u001f"]) assert.equal(safeEntryName(bad), null, JSON.stringify(bad));
  assert.deepEqual(safeEntryName("a/café note.md"), ["a", "café note.md"]);
  assert.deepEqual(safeEntryName("a/..notes.md"), ["a", "..notes.md"]);
});

test("planEntries: i duplicati si confrontano dopo la normalizzazione NFC, i segmenti oltre 255 byte sono rifiutati con il nome", () => {
  // two spellings of the same name (NFC and NFD) are one file on APFS
  const entries = ["d/caf\u00e9.md", "d/cafe\u0301.md"].map((name) => ({ name, mode: 0o100644, size: 1, dir: false }));
  assert.throws(() => planEntries(entries), /file doppio/);
  // the same through the zip reader
  assert.throws(() => planEntries(readZipEntries(makeZip([{ name: "d/caf\u00e9.md", data: "1" }, { name: "d/cafe\u0301.md", data: "2" }]))), /file doppio/);
  const long = `d/${"é".repeat(128)}.md`; // 256 UTF-8 bytes plus the extension
  assert.throws(
    () => planEntries(readZipEntries(makeZip([{ name: long, data: "1" }]))),
    (e) => e instanceof ZipError && /troppo lungo/.test(e.message) && e.message.includes("é".repeat(10)),
  );
  assert.doesNotThrow(() => planEntries(readZipEntries(makeZip([{ name: `d/${"a".repeat(255)}`, data: "1" }]))));
});

test("planEntries: con backslash i separatori \\ di PowerShell si accettano solo se nessuna voce usa /, con le stesse verifiche", () => {
  const win = (list) => readZipEntries(makeZip(list.map((name) => ({ name, data: "x" }))));
  const ok = planEntries(win(["skill\\SKILL.md", "skill\\references\\a.md"]), { backslash: true });
  assert.deepEqual(ok.files.map((f) => f.segs.join("/")), ["skill/SKILL.md", "skill/references/a.md"]);
  assert.deepEqual([...ok.roots], ["skill"]);
  // a directory entry ends with the separator
  const dirs = planEntries(readZipEntries(makeZip([{ name: "skill\\" }, { name: "skill\\SKILL.md", data: "x" }])), { backslash: true });
  assert.deepEqual(dirs.files.map((f) => f.segs.join("/")), ["skill/SKILL.md"]);
  assert.ok(dirs.files[0].entry.name.includes("/"), "the entry the extraction reads carries the normalised name");
  // without the option, or with a mix, it is still refused
  assert.throws(() => planEntries(win(["skill\\SKILL.md"])), /nome non valido/);
  assert.throws(() => planEntries(win(["skill/SKILL.md", "skill\\a.md"]), { backslash: true }), /nome non valido/);
  // the safety checks run after the normalisation
  for (const bad of ["skill\\..\\x", "..\\x", "\\abs\\x", "C:\\x", "skill\\.\\x", "skill\\\\x"]) {
    assert.throws(() => planEntries(win([bad]), { backslash: true }), /nome non valido/, bad);
  }
  assert.throws(() => planEntries(win(["a\\x", "A\\X"]), { backslash: true }), /file doppio/);
  // planPackage (the update zip) keeps refusing backslashes
  assert.throws(() => plan([...lensZipEntries(), { name: "opencode-lens\\evil", data: "x" }]), /nome non valido/);
});

test("extractPlan: un file che comincia con due punti (..notes.md) non è un percorso fuori dalla cartella", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-extract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const buf = makeZip([{ name: "..notes.md", data: "x" }]);
  const p = planEntries(readZipEntries(buf));
  const asPlan = (rel) => ({ files: [{ rel, entry: p.files[0].entry, mode: 0o644 }] });
  extractPlan(buf, asPlan("..notes.md"), path.join(dir, "out"));
  assert.equal(fs.readFileSync(path.join(dir, "out", "..notes.md"), "utf8"), "x");
  assert.throws(() => extractPlan(buf, asPlan("../x"), path.join(dir, "out2")), /fuori dalla cartella/);
});

test("Updater.apply: con una compilazione dell'app in corso → 409", (t) => {
  let appBusy = true;
  const f = fixture(t, { appBusy: () => appBusy });
  const p = f.u.upload(zip());
  assert.throws(() => f.u.apply({ id: p.id }), (err) => err.status === 409 && /compilazione dell'app macOS/.test(err.errors[0]));
  assert.equal(f.spawned.length, 0);
  appBusy = false;
  f.u.apply({ id: p.id });
  assert.equal(f.spawned.length, 1);
});

test("Updater.busy: un install.sh ancora vivo dopo il riavvio conta come occupato", (t) => {
  // the new lens: install.sh restarted it and is still running (app.sh update), its helper alive
  const f = fixture(t);
  fs.mkdirSync(f.u.dir, { recursive: true });
  fs.writeFileSync(path.join(f.u.dir, "last.json"), JSON.stringify({ from: "0.15.0", to: "0.16.0", startedAt: 1000, pid: 1, helper: 4242 }));
  assert.equal(f.u.busy(), true);
  const p = f.u.upload.bind(f.u);
  assert.throws(() => p(zip()), (err) => err.status === 409);
  f.child.exited = true;
  assert.equal(f.u.busy(), false);
});

test("Updater: un helper vivo da più di STALE_MS è un PID riusato, non un aggiornamento in corso", (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.u.dir, { recursive: true });
  fs.writeFileSync(path.join(f.u.dir, "last.json"), JSON.stringify({ from: "0.15.0", to: "0.16.0", startedAt: 1000, pid: 1, helper: 4242 }));
  f.tick(STALE_MS + 1);
  assert.equal(f.u.status().last.state, "interrupted");
  assert.equal(f.u.busy(), false);
});
