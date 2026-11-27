// Impostazioni › Aggiornamento with a zip of user modules (src/module-update.js): one or more modules zipped by
// hand, recognized, staged and previewed without running any of its code, then checked (checkUserModule) only at
// apply, after the user has confirmed, and installed by swapping each module folder, the old one kept in .backup/.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ModuleUpdater, isModulesPackage } from "../src/module-update.js";
import { MAX_UPLOAD } from "../src/update.js";
import { checkUserModule, discoverAll, MODULES_DIR } from "../src/modules.js";
import { loadConfig } from "../src/config.js";
import { Settings } from "../src/settings.js";
import { readZipEntries } from "../src/zip.js";
import { lensZipEntries, makeZip } from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "extras", "module-template");
const QUIET = { info() {}, warn() {}, error() {} };

/** The files of `dir` as makeZip entries under `prefix/`, folders first, like a module folder zipped from the Finder. */
function folderEntries(dir, prefix) {
  const out = [{ name: `${prefix}/` }];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...folderEntries(full, `${prefix}/${e.name}`));
    else out.push({ name: `${prefix}/${e.name}`, data: fs.readFileSync(full) });
  }
  return out;
}

const SERVER_OK = "export function configure() { return { values: {}, errors: [] }; }\nexport function create() { return {}; }\n";

/**
 * A minimal valid user module `id` as makeZip entries; `lens` too new makes the check fail. `marker`: a file that the
 * top-level code of module.js and of server/index.js appends a line to, to see when the module's code runs.
 */
function moduleEntries(id, { name = "Mio", lens = "0.1.0", server = SERVER_OK, marker = null, extra = [] } = {}) {
  const touch = (who) => (marker ? `globalThis.process.getBuiltinModule("node:fs").appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${id} ${who}\n`)});\n` : "");
  return [
    { name: `${id}/` },
    {
      name: `${id}/module.js`,
      data: `${touch("module.js")}export default { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, description: "D", lens: ${JSON.stringify(lens)}, menu: { group: "dati", order: 90, icon: "" }, page: { title: "Mio" }, server: () => import("./server/index.js") };\n`,
    },
    { name: `${id}/server/index.js`, data: `${touch("server")}${server}` },
    ...extra,
  ];
}

/** A zip of two modules: the example module as it ships, plus a minimal one. */
const releaseZip = (extra = []) => makeZip([...folderEntries(TEMPLATE, "mio-modulo"), ...moduleEntries("altro"), ...extra]);

async function fixture(t, { restartReason = null, busy = () => false, memory = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-module-update-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, "data");
  const userDir = path.join(data, "modules");
  fs.mkdirSync(data, { recursive: true });
  // the database and a module's data file: never touched by an update of the modules
  fs.writeFileSync(path.join(data, "lens.db"), "db");
  fs.writeFileSync(path.join(data, "mio-modulo.json"), '{"scans":[1]}');
  const restarts = [];
  const checked = [];
  const settings = {
    restarting: false,
    restartBlocked: () => restartReason,
    restart() {
      restarts.push(1);
      this.restarting = true;
      return { restarting: true };
    },
  };
  const found = () => discoverAll(MODULES_DIR, { userDir, log: QUIET }).then((r) => r.found);
  const u = new ModuleUpdater({
    // LENS_DB=:memory: has neither a user modules folder nor a data folder
    dir: memory ? null : path.join(data, "update"),
    userDir: memory ? null : userDir,
    settings,
    busy,
    check: async ({ id, userDir: dir }) => {
      checked.push(id);
      return checkUserModule({ id, userDir: dir, found: await found(), env: {}, dbPath: null });
    },
    now: () => Date.UTC(2026, 10, 1, 10, 20, 30),
  });
  return { root, data, userDir, settings, restarts, checked, u };
}

const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const readMarker = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").sort() : []);

test("isModulesPackage: una cartella <id>/ con module.js per modulo alla radice, nient'altro", () => {
  const is = (entries) => isModulesPackage(readZipEntries(makeZip(entries)));
  assert.equal(is([...folderEntries(TEMPLATE, "mio-modulo"), ...moduleEntries("altro")]), true);
  // Finder's «Comprimi» of one module folder, with its litter
  assert.equal(is([...moduleEntries("mio"), { name: "__MACOSX/mio/._module.js", data: "x" }, { name: "mio/.DS_Store", data: "x" }]), true);
  // the lens's own zip: one folder, no module.js at its top
  assert.equal(is(lensZipEntries()), false);
  assert.equal(is([...moduleEntries("mio"), { name: "package.json", data: "{}" }]), false, "un file alla radice");
  assert.equal(is([...moduleEntries("mio"), { name: "altro/README.md", data: "x" }]), false, "una cartella senza module.js");
  assert.equal(is(moduleEntries("Mio Modulo")), false, "il nome della cartella non è un id");
  assert.equal(is([{ name: "mio/module.js/" }]), false, "module.js è una cartella");
  assert.equal(is([]), false);
});

test("ModuleUpdater.upload: anteprima statica di un pacchetto nuovo, estratto solo nella cartella update", async (t) => {
  const f = await fixture(t);
  const p = await f.u.upload(releaseZip());
  assert.equal(p.type, "modules");
  assert.match(p.id, /^[0-9a-f]{16}$/);
  assert.equal(p.userDir, f.userDir);
  assert.deepEqual(p.modules, [
    { id: "altro", installed: null },
    { id: "mio-modulo", installed: null },
  ]);
  assert.deepEqual(p.restart, { available: true, reason: null });
  assert.deepEqual(f.checked, [], "nessun controllo prima della conferma");
  // staged next to the lens's own uploads, nothing yet in the user modules folder
  assert.ok(f.u.staged.dir.startsWith(path.join(f.data, "update", "upload-")));
  assert.ok(fs.existsSync(path.join(f.u.staged.dir, "modules", "mio-modulo", "server", "index.js")));
  assert.deepEqual(listDir(f.userDir), []);
  assert.deepEqual(f.u.stagedPreview(), p);
  // a second upload replaces the first
  const first = f.u.staged.dir;
  await f.u.upload(releaseZip());
  assert.ok(!fs.existsSync(first));
});

test("ModuleUpdater: il codice di un modulo caricato non gira prima di apply, gira al controllo di apply", async (t) => {
  const f = await fixture(t);
  const marker = path.join(f.root, "ran.txt");
  const p = await f.u.upload(makeZip(moduleEntries("mio-modulo", { marker })));
  assert.equal(f.u.stagedPreview().id, p.id);
  assert.deepEqual(readMarker(marker), [], "upload e anteprima non importano module.js né server/index.js");
  const r = await f.u.apply({ id: p.id });
  assert.deepEqual(readMarker(marker), ["mio-modulo module.js", "mio-modulo server"], "il controllo di apply li esegue");
  assert.deepEqual(f.checked, ["mio-modulo"]);
  assert.equal(r.modules[0].name, "Mio");
});

test("ModuleUpdater.upload: «sostituisce» un modulo installato, anche se è un collegamento simbolico", async (t) => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.userDir, "mio-modulo"), { recursive: true });
  const work = path.join(f.root, "work", "altro");
  fs.mkdirSync(work, { recursive: true });
  fs.symlinkSync(work, path.join(f.userDir, "altro"));
  const p = await f.u.upload(releaseZip());
  assert.deepEqual(
    p.modules.map((m) => [m.id, m.installed]),
    [
      ["altro", "link"],
      ["mio-modulo", "folder"],
    ],
  );
});

test("ModuleUpdater.apply: un modulo che non passa il controllo → 400 con gli errori per modulo, niente installato", async (t) => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.userDir, "buono"), { recursive: true });
  fs.writeFileSync(path.join(f.userDir, "buono", "module.js"), "// installato\n");
  const p = await f.u.upload(makeZip([...moduleEntries("rotto", { lens: "99.0.0" }), ...moduleEntries("buono")]));
  await assert.rejects(f.u.apply({ id: p.id }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.errors.join(" "), /rotto: /);
    const rotto = err.modules.find((m) => m.id === "rotto");
    assert.equal(rotto.ok, false);
    assert.ok(rotto.errors.length > 0 && rotto.errors.every((e) => typeof e === "string"));
    assert.equal(err.modules.find((m) => m.id === "buono").ok, true);
    return true;
  });
  assert.deepEqual(f.checked.sort(), ["buono", "rotto"]);
  // nothing touched: the installed module as it was, no backup, no staging, no restart
  assert.deepEqual(listDir(f.userDir), ["buono"]);
  assert.equal(fs.readFileSync(path.join(f.userDir, "buono", "module.js"), "utf8"), "// installato\n");
  assert.deepEqual(f.restarts, []);
  // this upload can never be installed: dropped, its folder removed
  assert.equal(f.u.staged, null);
  assert.deepEqual(listDir(path.join(f.data, "update")), []);
});

test("ModuleUpdater.upload: rifiuta l'id di un modulo della lens, la lens senza cartella dei moduli, lo zip vuoto o che non è di moduli", async (t) => {
  const f = await fixture(t);
  const refused = async (buf, status, re) => {
    await assert.rejects(f.u.upload(buf), (err) => err.status === status && re.test(err.errors.join(" ")));
  };
  await refused(makeZip([...moduleEntries("sistema"), ...moduleEntries("mio")]), 400, /sistema.*modulo della lens/);
  await refused(makeZip([]), 400, /non è un file zip|vuoto/);
  await refused(makeZip([{ name: "x.txt", data: "x" }]), 400, /pacchetto di moduli/);
  await refused(makeZip(lensZipEntries()), 400, /pacchetto di moduli/);
  await refused(Buffer.alloc(MAX_UPLOAD + 1), 413, /troppo grande/);
  assert.deepEqual(listDir(path.join(f.data, "update")), []);
  const memory = await fixture(t, { memory: true });
  await assert.rejects(memory.u.upload(releaseZip()), (err) => err.status === 409 && /:memory:/.test(err.errors[0]));
  const busy = await fixture(t, { busy: () => true });
  await assert.rejects(busy.u.upload(releaseZip()), (err) => err.status === 409);
});

test("ModuleUpdater.upload: percorsi pericolosi, collegamenti simbolici e file speciali rifiutati da planEntries, niente estratto", async (t) => {
  const f = await fixture(t);
  const cases = [
    [{ name: "mio/../../evil", data: "x" }, /nome non valido/],
    [{ name: "mio/server/../../../evil", data: "x" }, /nome non valido/],
    [{ name: "mio/link", data: "/etc", mode: 0o120777 }, /collegamento simbolico/],
    [{ name: "mio/fifo", mode: 0o010644 }, /tipo speciale/],
    [{ name: "mio/.git/HEAD", data: "ref" }, /\.git/],
    [{ name: "mio/SERVER/index.js", data: "x" }, /file doppio/],
  ];
  for (const [entry, re] of cases) {
    await assert.rejects(f.u.upload(makeZip([...moduleEntries("mio"), entry])), (err) => err.status === 400 && re.test(err.errors[0]), entry.name);
  }
  assert.deepEqual(listDir(path.join(f.data, "update")), []);
  assert.ok(!fs.existsSync(path.join(f.root, "evil")) && !fs.existsSync(path.join(f.data, "evil")));
});

test("ModuleUpdater.apply: controllo, copia di sicurezza in .backup, sostituzione completa, dati del modulo intatti, riavvio chiesto", async (t) => {
  const f = await fixture(t);
  const old = path.join(f.userDir, "mio-modulo");
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "module.js"), "// la versione vecchia\n");
  fs.writeFileSync(path.join(old, "solo-vecchio.txt"), "x");
  const p = await f.u.upload(releaseZip());
  const r = await f.u.apply({ id: p.id });
  assert.deepEqual(f.checked.sort(), ["altro", "mio-modulo"]);
  assert.equal(r.restarting, true);
  assert.equal(r.reason, null);
  assert.deepEqual(f.restarts, [1]);
  assert.deepEqual(
    r.modules.map((m) => [m.id, m.name, m.replaced]),
    [
      ["altro", "Mio", false],
      ["mio-modulo", "Il mio modulo", true],
    ],
  );
  // the check's reminders, as text
  assert.ok(r.modules[0].warnings.length > 0 && r.modules[0].warnings.every((w) => typeof w === "string"));
  // the new folders, whole; nothing of the old one left in them
  assert.equal(fs.readFileSync(path.join(f.userDir, "mio-modulo", "module.js"), "utf8"), fs.readFileSync(path.join(TEMPLATE, "module.js"), "utf8"));
  assert.ok(fs.existsSync(path.join(f.userDir, "mio-modulo", "public", "widgets.js")));
  assert.ok(!fs.existsSync(path.join(f.userDir, "mio-modulo", "solo-vecchio.txt")));
  assert.ok(fs.existsSync(path.join(f.userDir, "altro", "server", "index.js")));
  // the old folder in .backup/<id>-<date>/, and no staging folder left behind
  const backups = listDir(path.join(f.userDir, ".backup"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^mio-modulo-20261101-102030$/);
  assert.equal(r.modules[1].backup, path.join(f.userDir, ".backup", backups[0]));
  assert.equal(fs.readFileSync(path.join(f.userDir, ".backup", backups[0], "module.js"), "utf8"), "// la versione vecchia\n");
  assert.deepEqual(listDir(f.userDir), [".backup", "altro", "mio-modulo"]);
  // the module's data and the database, next to it: untouched
  assert.equal(fs.readFileSync(path.join(f.data, "mio-modulo.json"), "utf8"), '{"scans":[1]}');
  assert.equal(fs.readFileSync(path.join(f.data, "lens.db"), "utf8"), "db");
  // the upload is gone: applied once
  assert.equal(f.u.staged, null);
  assert.deepEqual(listDir(path.join(f.data, "update")), []);
  // restarting now: nothing else is applied
  await assert.rejects(f.u.apply({ id: p.id }), (err) => err.status === 409);
  f.settings.restarting = false;
  await assert.rejects(f.u.apply({ id: p.id }), (err) => err.status === 404);
});

test("ModuleUpdater.apply: due backup nello stesso secondo non si sovrascrivono", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) {
    fs.mkdirSync(path.join(f.userDir, "mio-modulo"), { recursive: true });
    f.settings.restarting = false; // the restart of the first install is over
    const p = await f.u.upload(makeZip(moduleEntries("mio-modulo")));
    await f.u.apply({ id: p.id });
  }
  assert.equal(listDir(path.join(f.userDir, ".backup")).length, 2);
});

test("ModuleUpdater.apply: un collegamento simbolico va in .backup, la cartella a cui punta non si tocca", async (t) => {
  const f = await fixture(t);
  const work = path.join(f.root, "work", "mio-modulo");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "module.js"), "// copia di lavoro\n");
  fs.mkdirSync(f.userDir, { recursive: true });
  fs.symlinkSync(work, path.join(f.userDir, "mio-modulo"));
  const p = await f.u.upload(makeZip(moduleEntries("mio-modulo")));
  await f.u.apply({ id: p.id });
  assert.equal(fs.readFileSync(path.join(work, "module.js"), "utf8"), "// copia di lavoro\n");
  assert.ok(!fs.lstatSync(path.join(f.userDir, "mio-modulo")).isSymbolicLink());
  const [backup] = listDir(path.join(f.userDir, ".backup"));
  assert.ok(fs.lstatSync(path.join(f.userDir, ".backup", backup)).isSymbolicLink());
});

test("ModuleUpdater.apply: fuori da launchd installa e dice di riavviare a mano; rifiuta caricamenti sconosciuti e lens occupata", async (t) => {
  const f = await fixture(t, { restartReason: "La lens è stata avviata a mano (npm start)" });
  const p = await f.u.upload(makeZip(moduleEntries("mio-modulo")));
  assert.deepEqual(p.restart, { available: false, reason: "La lens è stata avviata a mano (npm start)" });
  await assert.rejects(f.u.apply({ id: "nope" }), (err) => err.status === 404);
  await assert.rejects(f.u.apply(null), (err) => err.status === 404);
  const r = await f.u.apply({ id: p.id });
  assert.equal(r.restarting, false);
  assert.match(r.reason, /avviata a mano/);
  assert.deepEqual(f.restarts, []);
  assert.ok(fs.existsSync(path.join(f.userDir, "mio-modulo", "module.js")));

  const g = await fixture(t);
  const q = await g.u.upload(makeZip(moduleEntries("mio-modulo")));
  g.settings.restarting = true;
  await assert.rejects(g.u.apply({ id: q.id }), (err) => err.status === 409);
  assert.deepEqual(g.checked, [], "una lens occupata non controlla niente");
  assert.deepEqual(listDir(g.userDir), []);
  // a restart asked while the check runs: nothing is installed
  g.settings.restarting = false;
  g.u.check = async () => {
    g.settings.restarting = true;
    return { ok: true, name: "Mio", errors: [], warnings: [] };
  };
  await assert.rejects(g.u.apply({ id: q.id }), (err) => err.status === 409);
  assert.deepEqual(listDir(g.userDir), []);
});

test("ModuleUpdater.apply con un plist non ancora applicato: installa, non riavvia, e dice perché", async (t) => {
  const f = await fixture(t);
  // a real Settings under launchd whose plist was edited by hand: a reload would load it unchecked
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-module-update-plist-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plistPath = path.join(dir, "local.opencode-lens.plist");
  fs.writeFileSync(plistPath, "<plist/>");
  const reloads = [];
  f.u.settings = new Settings({
    config: loadConfig({ LENS_DB: ":memory:" }),
    env: { XPC_SERVICE_NAME: "local.opencode-lens" },
    plistPath,
    label: "local.opencode-lens",
    platform: "darwin",
    io: { read: () => ({ LENS_LIMIT_TOKENS: "abc" }), write: () => {} },
    reload: (o) => reloads.push(o),
  });
  const p = await f.u.upload(makeZip(moduleEntries("mio-modulo")));
  assert.equal(p.restart.available, false);
  const r = await f.u.apply({ id: p.id });
  assert.equal(r.restarting, false);
  assert.match(r.reason, /non ancora applicate/);
  assert.deepEqual(reloads, []);
  assert.ok(fs.existsSync(path.join(f.userDir, "mio-modulo", "module.js")), "installato lo stesso");
});

test("ModuleUpdater.apply con un plist che non si legge: installa, non riavvia, e dice perché", async (t) => {
  const f = await fixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-module-update-plist-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plistPath = path.join(dir, "local.opencode-lens.plist");
  fs.writeFileSync(plistPath, "<plist/>");
  const reloads = [];
  f.u.settings = new Settings({
    config: loadConfig({ LENS_DB: ":memory:" }),
    env: { XPC_SERVICE_NAME: "local.opencode-lens" },
    plistPath,
    label: "local.opencode-lens",
    platform: "darwin",
    io: {
      read: () => {
        throw new Error("plist rotto");
      },
      write: () => {},
    },
    reload: (o) => reloads.push(o),
  });
  const p = await f.u.upload(makeZip(moduleEntries("mio-modulo")));
  const r = await f.u.apply({ id: p.id });
  assert.equal(r.restarting, false);
  assert.match(r.reason, /plist del servizio non si legge \(plist rotto\)/);
  assert.deepEqual(reloads, []);
  assert.ok(fs.existsSync(path.join(f.userDir, "mio-modulo", "module.js")), "installato lo stesso");
});

test("ModuleUpdater.install: se rimettere a posto un modulo non riesce, il messaggio lo nomina", async (t) => {
  const f = await fixture(t);
  for (const id of ["alfa", "beta"]) {
    fs.mkdirSync(path.join(f.userDir, id), { recursive: true });
    fs.writeFileSync(path.join(f.userDir, id, "module.js"), `// ${id} vecchio\n`);
  }
  const p = await f.u.upload(makeZip([...moduleEntries("alfa"), ...moduleEntries("beta")]));
  f.u.check = async () => ({ ok: true, name: "M", errors: [], warnings: [] });
  const rename = fs.renameSync;
  t.after(() => {
    fs.renameSync = rename;
  });
  const backupDir = path.join(f.userDir, ".backup");
  fs.renameSync = (from, to) => {
    // beta's swap fails, and so does putting beta's old folder back; alfa's rollback works
    if (to === path.join(f.userDir, "beta") && (path.basename(path.dirname(from)).startsWith(".staging-") || path.dirname(from) === backupDir)) throw new Error("disco pieno");
    return rename(from, to);
  };
  await assert.rejects(f.u.apply({ id: p.id }), (err) => {
    assert.equal(err.status, 500);
    assert.match(err.errors.join(" "), /Non rimessi com'erano: beta;/);
    assert.doesNotMatch(err.errors.join(" "), /Non rimessi com'erano: [^;]*alfa/);
    return true;
  });
  fs.renameSync = rename;
  assert.equal(fs.readFileSync(path.join(f.userDir, "alfa", "module.js"), "utf8"), "// alfa vecchio\n");
  // beta's old folder stays in .backup, named in the message
  assert.equal(listDir(backupDir).length, 1);
  assert.match(listDir(backupDir)[0], /^beta-/);
  assert.deepEqual(f.restarts, []);
});

test("ModuleUpdater.install: una copia che non riesce toglie le .staging-* e non tocca niente", async (t) => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.userDir, "mio-modulo"), { recursive: true });
  fs.writeFileSync(path.join(f.userDir, "mio-modulo", "module.js"), "// vecchio\n");
  const p = await f.u.upload(makeZip([...moduleEntries("alfa"), ...moduleEntries("mio-modulo")]));
  // the staged copy of the second module vanishes: its copy fails
  fs.rmSync(path.join(f.u.staged.src, "mio-modulo"), { recursive: true });
  f.u.check = async () => ({ ok: true, name: "M", errors: [], warnings: [] });
  await assert.rejects(f.u.apply({ id: p.id }), (err) => err.status === 500 && /copia dei moduli non riuscita/.test(err.errors[0]));
  assert.deepEqual(listDir(f.userDir), ["mio-modulo"], "niente .staging-*, niente .backup, alfa non installato");
  assert.equal(fs.readFileSync(path.join(f.userDir, "mio-modulo", "module.js"), "utf8"), "// vecchio\n");
  assert.deepEqual(f.restarts, []);
});

test("ModuleUpdater.install: tutto o niente, uno scambio che non riesce rimette a posto anche i moduli già scambiati", async (t) => {
  const f = await fixture(t);
  for (const id of ["alfa", "beta"]) {
    fs.mkdirSync(path.join(f.userDir, id), { recursive: true });
    fs.writeFileSync(path.join(f.userDir, id, "module.js"), `// ${id} vecchio\n`);
  }
  const p = await f.u.upload(makeZip([...moduleEntries("alfa"), ...moduleEntries("beta")]));
  f.u.check = async () => ({ ok: true, name: "M", errors: [], warnings: [] });
  // the rename of beta's copy into place fails, after alfa was swapped
  const rename = fs.renameSync;
  t.after(() => {
    fs.renameSync = rename;
  });
  fs.renameSync = (from, to) => {
    if (to === path.join(f.userDir, "beta") && path.basename(path.dirname(from)).startsWith(".staging-")) throw new Error("disco pieno");
    return rename(from, to);
  };
  await assert.rejects(f.u.apply({ id: p.id }), (err) => err.status === 500 && /disco pieno/.test(err.errors.join(" ")));
  fs.renameSync = rename;
  for (const id of ["alfa", "beta"]) assert.equal(fs.readFileSync(path.join(f.userDir, id, "module.js"), "utf8"), `// ${id} vecchio\n`, id);
  assert.deepEqual(listDir(f.userDir), [".backup", "alfa", "beta"], "niente .staging-*");
  assert.deepEqual(listDir(path.join(f.userDir, ".backup")), [], "i backup sono tornati al loro posto");
  assert.deepEqual(f.restarts, []);
});

test("ModuleUpdater.install: uno scambio che non riesce rimette la cartella vecchia al suo posto", async (t) => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.userDir, "mio-modulo"), { recursive: true });
  fs.writeFileSync(path.join(f.userDir, "mio-modulo", "module.js"), "// vecchio\n");
  const p = await f.u.upload(makeZip(moduleEntries("mio-modulo")));
  f.u.check = async () => ({ ok: true, name: "M", errors: [], warnings: [] });
  const rename = fs.renameSync;
  t.after(() => {
    fs.renameSync = rename;
  });
  fs.renameSync = (from, to) => {
    if (to === path.join(f.userDir, "mio-modulo") && path.basename(path.dirname(from)).startsWith(".staging-")) throw new Error("disco pieno");
    return rename(from, to);
  };
  await assert.rejects(f.u.apply({ id: p.id }), (err) => err.status === 500);
  fs.renameSync = rename;
  assert.equal(fs.readFileSync(path.join(f.userDir, "mio-modulo", "module.js"), "utf8"), "// vecchio\n");
  assert.deepEqual(listDir(f.userDir).filter((n) => n.startsWith(".staging-")), []);
  assert.deepEqual(f.restarts, []);
});

test("ModuleUpdater.install: un .backup che non è una cartella è rifiutato prima di toccare qualunque modulo", async (t) => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.userDir, "mio-modulo"), { recursive: true });
  fs.writeFileSync(path.join(f.userDir, "mio-modulo", "module.js"), "// vecchio\n");
  fs.writeFileSync(path.join(f.userDir, ".backup"), "un file");
  const p = await f.u.upload(makeZip([...moduleEntries("alfa"), ...moduleEntries("mio-modulo")]));
  f.u.check = async () => ({ ok: true, name: "M", errors: [], warnings: [] });
  await assert.rejects(f.u.apply({ id: p.id }), (err) => err.status === 500 && /\.backup/.test(err.errors.join(" ")));
  assert.deepEqual(listDir(f.userDir), [".backup", "mio-modulo"], "alfa non installato, niente .staging-*");
  assert.equal(fs.readFileSync(path.join(f.userDir, "mio-modulo", "module.js"), "utf8"), "// vecchio\n");
  assert.deepEqual(f.restarts, []);
});

test("ModuleUpdater: le .staging-* rimaste da un'interruzione si tolgono all'avvio, il resto no", async (t) => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.userDir, ".staging-mio-abc123", "mio"), { recursive: true });
  fs.mkdirSync(path.join(f.userDir, ".backup", "mio-20261101-000000"), { recursive: true });
  fs.mkdirSync(path.join(f.userDir, "mio"), { recursive: true });
  new ModuleUpdater({ dir: path.join(f.data, "update"), userDir: f.userDir });
  assert.deepEqual(listDir(f.userDir), [".backup", "mio"]);
  assert.deepEqual(listDir(path.join(f.userDir, ".backup")), ["mio-20261101-000000"]);
  // no folder: nothing to do, nothing created
  const none = path.join(f.root, "assente");
  new ModuleUpdater({ dir: null, userDir: none });
  assert.ok(!fs.existsSync(none));
});

test("ModuleUpdater.busy(): vero mentre il controllo di apply gira", async (t) => {
  const f = await fixture(t);
  const p = await f.u.upload(makeZip(moduleEntries("mio-modulo")));
  let during = null;
  f.u.check = async () => {
    during = f.u.busy();
    return { ok: true, name: "M", errors: [], warnings: [] };
  };
  await f.u.apply({ id: p.id });
  assert.equal(during, true);
  f.settings.restarting = false;
  assert.equal(f.u.busy(), false);
});

test("ModuleUpdater: owns() solo per il suo caricamento; discard() toglie la cartella; scade dopo 30 minuti", async (t) => {
  const f = await fixture(t);
  const p = await f.u.upload(makeZip(moduleEntries("mio-modulo")));
  assert.equal(f.u.owns(p.id), true);
  assert.equal(f.u.owns("altro"), false);
  assert.equal(f.u.owns(undefined), false);
  const dir = f.u.staged.dir;
  f.u.discard();
  assert.ok(!fs.existsSync(dir));
  assert.equal(f.u.owns(p.id), false);
  let now = 0;
  const g = await fixture(t);
  g.u.now = () => now;
  const q = await g.u.upload(makeZip(moduleEntries("mio-modulo")));
  now += 31 * 60_000;
  assert.equal(g.u.owns(q.id), false);
  await assert.rejects(g.u.apply({ id: q.id }), (err) => err.status === 404);
});
