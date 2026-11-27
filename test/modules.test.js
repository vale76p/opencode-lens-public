import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorText, Localized } from "../public/i18n.js";
import { addCatalogs, requestContext } from "../src/i18n-request.js";
import { about } from "../src/about.js";
import { defaultDbPath, loadConfig } from "../src/config.js";
import { checkUserModule, discoverAll, discoverModules, ModuleRegistry, MODULES_DIR, moduleVars, START_TIMEOUT_MS, userModulesDir } from "../src/modules.js";
import { moduleContext, Reply } from "../src/module-kit.js";
import { Queries } from "../src/queries.js";
import { MAX_UPLOAD } from "../src/update.js";
import { APP_DIR, VERSION } from "../src/version.js";
import { calls, demoRoute, resetCalls, seen } from "./fixtures/modules/demo/server/index.js";
import { calls as asyncfailCalls } from "./fixtures/modules/asyncfail/server/index.js";
import { calls as startfailCalls } from "./fixtures/modules/startfail/server/index.js";
import { Store } from "../src/store.js";
import demoTables from "./fixtures/modules/demo/tables.js";
import { fileStore, memoryStore } from "./helpers.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "modules");

function fakeLog() {
  const lines = { info: [], warn: [], error: [] };
  return { lines, info: (m) => lines.info.push(m), warn: (m) => lines.warn.push(m), error: (m) => lines.error.push(m) };
}

const inEnglish = (fn) => requestContext.run({ lang: "en", locale: "en-US" }, fn);
const inFrench = (fn) => requestContext.run({ lang: "fr", locale: "fr-FR" }, fn);
function makeCtx(id, dbPath = ":memory:", extra = {}) {
  const store = memoryStore();
  return moduleContext({ id, config: { dbPath, scanIntervalMs: 120_000 }, store, collector: null, queries: new Queries(store), log: fakeLog(), ...extra });
}
// what the registry passes (the module's variables and settings) reaches moduleContext, over `env`
const ctxWith = (env) => (id, extra) => makeCtx(id, ":memory:", { env, ...extra });

beforeEach(() => resetCalls());

test("MODULES_DIR è la cartella modules accanto a src", () => {
  assert.equal(MODULES_DIR, path.join(APP_DIR, "modules"));
});

test("discoverModules sui moduli veri: ognuno si carica senza errori con la versione di questa lens", async () => {
  const found = await discoverModules(MODULES_DIR, { version: VERSION });
  assert.deepEqual(found.map((m) => m.id), ["bob", "security", "sistema", "skill", "vibecoding"]);
  assert.deepEqual(found.filter((m) => m.error).map((m) => `${m.id}: ${m.error.message}`), []);
  // their tables.js pass the core's check, and the Store creates them
  const log = fakeLog();
  const registry = new ModuleRegistry({ found, enabled: [], log });
  const tables = await registry.tables();
  assert.deepEqual(tables.map((t) => t.id), ["bob"]);
  assert.deepEqual(registry.list().filter((m) => m.state === "error").map((m) => `${m.id}: ${m.reason?.message}`), []);
  const store = new Store(":memory:", { moduleTables: tables });
  try {
    assert.equal(store.moduleTableErrors.size, 0);
    assert.equal(store.meta("module:bob:schema"), "1");
  } finally {
    store.close();
  }
});

test("moduli veri (Review Focus 4): il database di una lens 0.32.0 (bob_tools senza message_id) con Bob spento parte e ha la colonna", async () => {
  const found = await discoverModules(MODULES_DIR, { version: VERSION });
  const registry = new ModuleRegistry({ found, enabled: [], log: fakeLog() });
  // bob_* as the core of 0.32.0 created them: bob_tools without message_id, Bob's rows in them
  const old = fileStore();
  const bobSql = (await registry.tables()).find((t) => t.id === "bob").sql;
  old.db.exec(bobSql);
  old.db.exec("DROP TABLE bob_tools; CREATE TABLE bob_tools (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, name TEXT, status TEXT, created INTEGER, ended INTEGER, child_task TEXT)");
  old.db.prepare("INSERT INTO bob_tools (id, task_id, name, status, created) VALUES ('t1:c1', 't1', 'read_file', 'completed', 1)").run();
  // this lens, Bob off: the Store creates the modules' tables (on or off), the missing column first
  const store = old.reopen({ moduleTables: await registry.tables() });
  try {
    assert.equal(store.moduleTableErrors.size, 0);
    assert.deepEqual(store.db.prepare("PRAGMA table_info(bob_tools)").all().map((c) => c.name), ["id", "task_id", "name", "status", "created", "ended", "child_task", "message_id"]);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_tools").get().n, 1, "no row lost");
    assert.ok(store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'bob_tools_ts'").get(), "the indexes after the column");
    assert.equal(store.meta("module:bob:schema"), "1");
    assert.deepEqual(registry.list().find((m) => m.id === "bob").state, "off");
  } finally {
    store.close();
  }
});

test("discoverModules: solo cartelle con id valido, ordinate, errori per voce", async () => {
  const found = await discoverModules(dir);
  assert.deepEqual(found.map((m) => m.id), ["asyncfail", "broken", "crash", "demo", "famfail", "gemello", "impostazioni", "promessa", "sbagliato", "startfail"]);
  const by = Object.fromEntries(found.map((m) => [m.id, m]));
  assert.ok(by.broken.error instanceof Localized && by.sbagliato.error instanceof Localized, "errori traducibili");
  assert.match(by.broken.error.message, /manifesto rotto/);
  assert.match(by.sbagliato.error.message, /altro/);
  assert.match(inEnglish(() => errorText(by.sbagliato.error)), /^id altro differs from the folder sbagliato$/);
  assert.equal(by.demo.error, undefined);
  assert.equal(by.demo.manifest.name, "Demo");
  assert.equal(by.demo.dir, path.join(dir, "demo"));
  assert.equal(by.crash.error, undefined);
});

test("discoverModules: l'id di una pagina o vista del core è riservato", async () => {
  const found = await discoverModules(dir);
  const taken = found.find((m) => m.id === "impostazioni");
  assert.ok(taken.error instanceof Localized);
  assert.match(inEnglish(() => errorText(taken.error)), /^id impostazioni is reserved for a core page or view$/);
});

test("discoverModules: cartella non leggibile (non ENOENT) → avviso e nessun modulo, senza lanciare", async () => {
  const warns = [];
  const file = path.join(dir, "demo", "module.js"); // a file, not a folder: readdir fails with ENOTDIR
  assert.deepEqual(await discoverModules(file, { log: { warn: (m) => warns.push(m) } }), []);
  assert.equal(warns.length, 1);
});

test("discoverModules: cartella assente → nessun modulo", async () => {
  assert.deepEqual(await discoverModules(path.join(dir, "assente")), []);
});

/** A temporary folder holding one minimal module per id; `vars[id]` is the LENS_ variable that module declares, if any. */
function modulesFolder(ids, vars = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-moduli-two-"));
  for (const id of ids) {
    fs.mkdirSync(path.join(root, id));
    const settings = vars[id] ? `settings: [{ name: ${JSON.stringify(vars[id])}, label: "x", help: "x", kind: "text" }],` : "";
    fs.writeFileSync(
      path.join(root, id, "module.js"),
      `export default { id: ${JSON.stringify(id)}, name: ${JSON.stringify(id)}, description: "x", lens: "0.1.0", menu: { group: "dati", order: 90, icon: "" }, page: { title: ${JSON.stringify(id)} }, ${settings} server: () => import("./server.js") };\n`,
    );
  }
  return root;
}

test("discoverAll: i moduli dell'utente arrivano dopo gli interni, con origin", async () => {
  const core = modulesFolder(["alfa", "gamma"]);
  const user = modulesFolder(["beta"]);
  const { found, shadowed } = await discoverAll(core, { userDir: user });
  // the built-in ones first (by id), then the user's (by id)
  assert.deepEqual(found.map((f) => [f.id, f.origin]), [["alfa", "core"], ["gamma", "core"], ["beta", "user"]]);
  assert.equal(found[2].dir, path.join(user, "beta"));
  assert.deepEqual(shadowed, []);
});

test("discoverAll: un id dell'utente uguale a un interno è in shadowed, l'interno vince", async () => {
  const core = modulesFolder(["alfa"]);
  const user = modulesFolder(["alfa"]);
  const { found, shadowed } = await discoverAll(core, { userDir: user, log: fakeLog() });
  assert.deepEqual(found.map((f) => [f.id, f.origin, f.dir]), [["alfa", "core", path.join(core, "alfa")]]);
  assert.deepEqual(shadowed, [{ id: "alfa", dir: path.join(user, "alfa") }]);
  // discoverModules with a userDir is the same list, the collision left out
  assert.deepEqual((await discoverModules(core, { userDir: user, log: fakeLog() })).map((f) => f.id), ["alfa"]);
});

test("discoverAll: una variabile LENS_ già di un modulo interno manda in error quello dell'utente", async () => {
  const core = modulesFolder(["alfa"], { alfa: "LENS_ALFA_X" });
  const user = modulesFolder(["beta"], { beta: "LENS_ALFA_X" });
  const { found } = await discoverAll(core, { userDir: user });
  const beta = found.find((f) => f.id === "beta");
  assert.equal(beta.origin, "user");
  assert.ok(beta.error instanceof Localized);
  assert.match(beta.error.message, /è già dichiarata dal modulo alfa/);
  assert.match(inEnglish(() => errorText(beta.error)), /LENS_ALFA_X is already declared by the module alfa/);
  assert.equal(found.find((f) => f.id === "alfa").error, undefined);
});

test("discoverAll: un modulo dell'utente con l'id di un interno non viene mai importato", async () => {
  const core = modulesFolder(["alfa"]);
  const user = modulesFolder(["alfa", "beta"]);
  const marker = path.join(core, "marker");
  // a top-level side effect: it runs only if module.js is imported
  for (const id of ["alfa", "beta"]) {
    const file = path.join(user, id, "module.js");
    fs.writeFileSync(file, `import fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(id)});\n${fs.readFileSync(file, "utf8")}`);
  }
  const { found, shadowed } = await discoverAll(core, { userDir: user, log: fakeLog() });
  assert.deepEqual(shadowed.map((s) => s.id), ["alfa"]);
  assert.equal(found.find((f) => f.id === "beta").origin, "user");
  assert.equal(fs.readFileSync(marker, "utf8"), "beta", "solo il modulo non omonimo è stato importato");
});

test("discoverAll: nella cartella dell'utente un link simbolico a una cartella è un modulo, nel core no", async () => {
  const real = modulesFolder(["gamma", "delta"]);
  const core = fs.mkdtempSync(path.join(os.tmpdir(), "lens-moduli-core-"));
  const user = fs.mkdtempSync(path.join(os.tmpdir(), "lens-moduli-user-"));
  fs.symlinkSync(path.join(real, "gamma"), path.join(user, "gamma"), "dir");
  fs.symlinkSync(path.join(real, "delta"), path.join(core, "delta"), "dir");
  fs.symlinkSync(path.join(real, "assente"), path.join(user, "rotto"), "dir"); // dangling: not a module
  fs.writeFileSync(path.join(real, "file.txt"), "x");
  fs.symlinkSync(path.join(real, "file.txt"), path.join(user, "file"), "file"); // a link to a file: not a module
  const { found } = await discoverAll(core, { userDir: user, log: fakeLog() });
  assert.deepEqual(found.map((f) => [f.id, f.origin, f.error]), [["gamma", "user", undefined]]);
  assert.equal(found[0].dir, path.join(user, "gamma"));
});

test("discoverAll: cartella dell'utente assente o null", async () => {
  const warns = fakeLog();
  const expected = (await discoverModules(dir)).map((f) => ({ ...f, origin: "core" }));
  for (const userDir of [null, path.join(dir, "assente"), undefined]) {
    const { found, shadowed } = await discoverAll(dir, { userDir, log: warns });
    assert.deepEqual(found, expected);
    assert.deepEqual(shadowed, []);
  }
  assert.deepEqual(warns.lines.warn, [], "una cartella assente non è un avviso");
  assert.ok((await discoverModules(dir)).every((f) => f.origin === "core"));
});

test("userModulesDir", () => {
  assert.equal(userModulesDir({ LENS_DB: "/x/y/lens.db" }), path.join("/x/y", "modules"));
  assert.equal(userModulesDir({ LENS_DB: ":memory:" }), null);
  assert.equal(userModulesDir({}), path.join(path.dirname(defaultDbPath()), "modules"));
  // never inside the app folder, which install.sh deletes on every update
  const appDir = path.dirname(MODULES_DIR);
  for (const env of [{}, { LENS_DB: "/x/y/lens.db" }]) {
    const rel = path.relative(appDir, userModulesDir(env));
    assert.ok(rel.startsWith("..") || path.isAbsolute(rel), `${userModulesDir(env)} è dentro ${appDir}`);
  }
});

test("discoverModules: lens più nuova della versione del core → errore che cita la versione minima", async () => {
  const found = await discoverModules(dir, { version: "0.0.1" });
  const demo = found.find((m) => m.id === "demo");
  assert.match(demo.error.message, /0\.40\.0/);
  assert.match(inEnglish(() => errorText(demo.error)), /requires lens 0\.40\.0 or later/);
  assert.equal(demo.manifest, undefined);
});

test("ModuleRegistry: id abilitati senza cartella → un avviso, enabled resta intero", async () => {
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["crash", "demo", "nessuno"], log });
  assert.equal(log.lines.warn.length, 1);
  assert.match(log.lines.warn[0], /nessuno/);
  assert.deepEqual(reg.enabled, ["crash", "demo", "nessuno"]);
});

test("ModuleRegistry.start: un modulo che fallisce va in errore, gli altri partono", async () => {
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["crash", "demo", "nessuno"], log });
  await reg.start(makeCtx);
  const by = Object.fromEntries(reg.list().map((m) => [m.id, m]));
  assert.equal(by.crash.state, "error");
  assert.ok(by.crash.reason instanceof Localized);
  assert.match(by.crash.reason.message, /avvio fallito/);
  assert.match(inEnglish(() => errorText(by.crash.reason)), /^start failed: avvio fallito$/);
  assert.equal(by.demo.state, "on");
  assert.equal(by.demo.reason, null);
  assert.equal(by.broken.state, "error", "un manifesto rotto resta in errore anche spento");
  assert.equal(by.sbagliato.state, "error");
  assert.deepEqual(by.demo.menu, { group: "dati", order: 50, icon: '<circle cx="12" cy="12" r="8"/>' });
  assert.deepEqual(by.demo.page, { title: "Demo" });
  assert.equal(by.demo.name, "Demo");
  assert.equal(by.demo.description, "Modulo di prova");
  assert.deepEqual(reg.activeIds(), ["demo"]);
  assert.equal(calls.create, 1);
  assert.equal(calls.start, 1);
  assert.equal(reg.route("GET", "/api/demo").handler, demoRoute);
  assert.equal(reg.route("HEAD", "/api/demo").handler, demoRoute);
  assert.equal(reg.route("POST", "/api/demo"), null);
  assert.equal(reg.route("GET", "/api/altro"), null);
  assert.deepEqual(reg.families().map((f) => f.name), ["lens_demo_total"]);
  assert.ok(log.lines.error.some((l) => /crash/.test(l)), "il fallimento finisce nel log");
});

test("ModuleRegistry: moduli spenti non vengono creati né avviati", async () => {
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog() });
  await reg.start(makeCtx);
  assert.equal(calls.create, 0);
  assert.equal(calls.start, 0);
  assert.equal(reg.route("GET", "/api/demo"), null);
  assert.deepEqual(reg.families(), []);
  assert.deepEqual(reg.activeIds(), []);
  assert.equal(reg.list().find((m) => m.id === "demo").state, "off");
});

test("ModuleRegistry.stop chiama lo stop di ogni modulo attivo una volta", async () => {
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog() });
  await reg.start(makeCtx);
  await reg.stop();
  assert.equal(calls.stop, 1);
});

test("ModuleRegistry.start: se start() lancia dopo create, il modulo viene fermato e va in errore", async () => {
  startfailCalls.start = startfailCalls.stop = 0;
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["startfail"], log });
  await reg.start(makeCtx);
  const m = reg.list().find((x) => x.id === "startfail");
  assert.equal(m.state, "error");
  assert.match(m.reason.message, /start fallito/);
  assert.equal(startfailCalls.start, 1);
  assert.equal(startfailCalls.stop, 1, "quello che aveva avviato viene fermato");
  await reg.stop();
  assert.equal(startfailCalls.stop, 1, "un modulo in errore non è fermato due volte");
});

test("ModuleRegistry.start: uno start asincrono che rifiuta va in errore come uno che lancia", async () => {
  asyncfailCalls.start = asyncfailCalls.stop = 0;
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["asyncfail", "demo"], log: fakeLog() });
  await reg.start(makeCtx);
  const m = reg.list().find((x) => x.id === "asyncfail");
  assert.equal(m.state, "error");
  assert.match(m.reason.message, /start asincrono fallito/);
  assert.equal(asyncfailCalls.start, 1);
  assert.equal(asyncfailCalls.stop, 1);
  assert.deepEqual(reg.activeIds(), ["demo"], "gli altri moduli restano attivi");
});

test("ModuleRegistry.start: create asincrona → errore: il modulo va restituito subito", async () => {
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo", "promessa"], log: fakeLog() });
  await reg.start(makeCtx);
  const m = reg.list().find((x) => x.id === "promessa");
  assert.equal(m.state, "error");
  assert.ok(m.reason instanceof Localized);
  assert.match(inEnglish(() => errorText(m.reason)), /right away, not a promise/);
  assert.deepEqual(reg.activeIds(), ["demo"]);
});

test("ModuleRegistry.families: un modulo che lancia è saltato, con un solo errore nel log", async () => {
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo", "famfail"], log });
  await reg.start(makeCtx);
  assert.deepEqual(reg.families().map((f) => f.name), ["lens_demo_total"]);
  assert.deepEqual(reg.families().map((f) => f.name), ["lens_demo_total"]);
  const errors = log.lines.error.filter((l) => /famfail/.test(l));
  assert.equal(errors.length, 1, "un errore per modulo, non uno per scrape");
  assert.deepEqual(reg.activeIds(), ["demo", "famfail"], "il modulo resta attivo");
});

test("ModuleRegistry: la stessa route in due moduli attivi → vince il primo per id, un avviso", async () => {
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo", "gemello"], log });
  await reg.start(makeCtx);
  assert.equal(reg.route("GET", "/api/demo").handler, demoRoute);
  const dup = log.lines.warn.filter((l) => /\/api\/demo/.test(l));
  assert.equal(dup.length, 1);
  assert.match(dup[0], /demo/);
  assert.match(dup[0], /gemello/);
});

test("ModuleRegistry.catalogs: unisce i cataloghi dei moduli trovati, anche spenti", async () => {
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog() });
  assert.equal((await reg.catalogs("en"))["Modulo di prova"], "Test module");
  assert.equal((await reg.catalogs("fr"))["Modulo di prova"], "Module de test");
  assert.equal((await reg.catalogs("en"))["Cartella della demo"], "Demo folder");
  assert.deepEqual(await reg.catalogs("de"), {});
});

test("moduleContext: meta con prefisso del modulo, log con prefisso, ctx congelato", () => {
  const store = memoryStore();
  const log = fakeLog();
  const collector = { state: "connected", status: () => ({ state: "connected" }), config: { scanIntervalMs: 5000 } };
  const ctx = moduleContext({ id: "demo", config: { dbPath: "/tmp/x.db", scanIntervalMs: 5000 }, store, collector, log });
  ctx.meta.set("x", 1);
  assert.equal(store.meta("module:demo:data:x"), "1", "i dati del modulo stanno sotto module:<id>:data:");
  ctx.meta.set("notice", "mio");
  assert.equal(store.meta("module:demo:notice"), undefined, "non tocca le chiavi del registro");
  assert.equal(ctx.meta.get("x"), "1");
  ctx.log.warn("attenzione");
  assert.deepEqual(log.lines.warn, ["[demo] attenzione"]);
  assert.equal(ctx.id, "demo");
  assert.equal(ctx.dbPath, "/tmp/x.db");
  assert.equal(ctx.collector.state, "connected");
  collector.state = "disconnected";
  assert.equal(ctx.collector.state, "disconnected", "lo stato è letto dal vivo");
  assert.deepEqual(ctx.collector.status(), { state: "connected" });
  assert.equal(ctx.collector.config.scanIntervalMs, 5000);
  assert.deepEqual(ctx.store.counts(), store.counts());
  assert.ok(Object.isFrozen(ctx));
  assert.ok(Object.isFrozen(ctx.meta));
  assert.throws(() => {
    ctx.store.db = 1;
  }, "il modulo non arriva allo store grezzo");
});

test("ModuleRegistry.files: i file dei moduli trovati, anche spenti; un files che lancia o un percorso fuori dalla cartella dei dati non danno voci", async () => {
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log });
  await reg.start(makeCtx);
  const files = await reg.files((id) => makeCtx(id, "/tmp/lens-moduli/lens.db"));
  assert.deepEqual(files, [
    { id: "demo", label: "Dati della demo", path: "/tmp/lens-moduli/demo.json", note: "scritti dalla demo", kind: "write", on: false },
    { id: "demo", label: "File caricati nella demo", path: "/tmp/lens-moduli/demo-files", note: "una cartella per file", kind: "dir", on: false },
    { id: "demo", label: "Cartella letta dalla demo", path: "/tmp/lens-moduli-letti/audit", note: "solo lettura", kind: "read", on: false },
    { id: "famfail", label: "Dentro", path: "/tmp/lens-moduli/famfail.json", note: null, kind: "write", on: false },
  ]);
  assert.equal(calls.create, 0, "files non avvia il modulo");
  assert.equal(log.lines.error.filter((l) => /crash/.test(l)).length, 1, "il files che lancia finisce nel log");
  // relative, ".." out of the folder (also through a subfolder), the folder itself, elsewhere: one warning each
  // a write file and a folder outside the data folder, the core's update/ and dashboard-v2.json
  assert.equal(log.lines.warn.filter((l) => /demo: file scartato/.test(l)).length, 4, log.lines.warn.join("\n"));
  assert.equal(log.lines.warn.filter((l) => /demo: file scartato.*del core/.test(l)).length, 2, "update/ e dashboard-v2.json sono del core");
  assert.equal(log.lines.warn.filter((l) => /famfail/.test(l)).length, 5, "le voci fuori dalla cartella dei dati sono scartate con un avviso");
  assert.deepEqual((await reg.files(makeCtx)).filter((f) => f.kind === "write"), [], "in memoria non c'è una cartella dei dati: nessuna voce da scrivere");
});

test("ModuleRegistry.files: la voce porta lo stato acceso del modulo", async () => {
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog() });
  await reg.start(makeCtx);
  const files = await reg.files((id) => makeCtx(id, "/tmp/lens-moduli/lens.db"));
  assert.equal(files.find((f) => f.kind === "read" && f.id === "demo").on, true);
  assert.equal(files.find((f) => f.id === "demo" && f.kind === "write").on, true);
});

/** A module found in memory whose files(ctx) returns `entries(dataDir)`. */
function filesModule(id, entries) {
  return {
    id,
    dir: path.join(dir, id),
    manifest: { id, name: id, description: "", lens: "0.1.0", menu: { group: "dati", order: 90, icon: "" }, page: { title: id }, server: async () => ({ create: () => ({}), files: (ctx) => entries(path.dirname(ctx.dbPath)) }) },
  };
}

test("ModuleRegistry.files: una cartella (kind dir) dentro la cartella dei dati; fuori, sulla cartella stessa, su un file o una cartella del core → scartata", async () => {
  const log = fakeLog();
  const mod = filesModule("cartelle", (data) => [
    { label: "Mia", path: path.join(data, "mia"), kind: "dir" },
    { label: "Fuori", path: path.join(data, "..", "altrove"), kind: "dir" },
    { label: "Dati", path: data, kind: "dir" },
    { label: "Aggiornamenti", path: path.join(data, "update"), kind: "dir" },
    { label: "Dentro gli aggiornamenti", path: path.join(data, "update", "mio"), kind: "dir" },
    { label: "File negli aggiornamenti", path: path.join(data, "update", "mio.json") },
    { label: "Database", path: path.join(data, "lens.db") },
    { label: "WAL", path: path.join(data, "lens.db-wal") },
    { label: "Dashboard", path: path.join(data, "dashboard-v2.json") },
    { label: "Preset rotti", path: path.join(data, "dashboard-presets.bad.json"), kind: "dir" },
    { label: "Database personale", path: path.join(data, "mio.sqlite") },
  ]);
  const reg = new ModuleRegistry({ found: [mod], enabled: [], log });
  await reg.start(makeCtx);
  const files = await reg.files((id) => makeCtx(id, "/tmp/lens-cartelle/mio.sqlite"));
  assert.deepEqual(files, [{ id: "cartelle", label: "Mia", path: "/tmp/lens-cartelle/mia", note: null, kind: "dir", on: false }]);
  assert.equal(log.lines.warn.filter((l) => /cartelle: file scartato/.test(l)).length, 10, log.lines.warn.join("\n"));
  assert.deepEqual(await reg.files(makeCtx), [], "in memoria nessuna cartella dei dati");
});

test("ModuleRegistry.files: una voce dentro <dataDir>/modules è scartata (è la cartella dei moduli dell'utente)", async () => {
  const log = fakeLog();
  const mod = filesModule("utente", (data) => [
    { label: "Mia", path: path.join(data, "mia"), kind: "dir" },
    { label: "Moduli", path: path.join(data, "modules"), kind: "dir" },
    { label: "Dentro i moduli", path: path.join(data, "modules", "x", "dati.json") },
    { label: "Maiuscole", path: path.join(data, "Modules", "x"), kind: "dir" },
  ]);
  const reg = new ModuleRegistry({ found: [mod], enabled: [], log });
  await reg.start(makeCtx);
  const files = await reg.files((id) => makeCtx(id, "/tmp/lens-utente/lens.db"));
  assert.deepEqual(files, [{ id: "utente", label: "Mia", path: "/tmp/lens-utente/mia", note: null, kind: "dir", on: false }]);
  assert.equal(log.lines.warn.filter((l) => /utente: file scartato.*del core/.test(l)).length, 3, log.lines.warn.join("\n"));
});

test("ModuleRegistry: list() porta origin, shadowed esposto", async () => {
  const core = modulesFolder(["alfa"]);
  const user = modulesFolder(["alfa", "beta"]);
  const { found, shadowed } = await discoverAll(core, { userDir: user, log: fakeLog() });
  const reg = new ModuleRegistry({ found, shadowed, enabled: [], log: fakeLog() });
  assert.deepEqual(reg.list().map((m) => [m.id, m.origin]), [["alfa", "core"], ["beta", "user"]]);
  assert.deepEqual(reg.shadowed, [{ id: "alfa", dir: path.join(user, "alfa") }]);
  // without the option: nothing shadowed, and a copy: the registry's own list cannot be changed from outside
  assert.deepEqual(new ModuleRegistry({ found, enabled: [], log: fakeLog() }).shadowed, []);
  reg.shadowed.push({ id: "x", dir: "/x" });
  assert.equal(reg.shadowed.length, 1);
  // an entry without origin (a hand-made one) is the app's own
  assert.equal(new ModuleRegistry({ found: [{ id: "x", dir: "/x", manifest: null, error: new Localized("e") }], enabled: [], log: fakeLog() }).list()[0].origin, "core");
});

test("ModuleRegistry.files: i nomi del core si riconoscono senza maiuscole/minuscole (APFS non le distingue)", async () => {
  const log = fakeLog();
  const mod = filesModule("maiuscole", (data) => [
    { label: "Aggiornamenti", path: path.join(data, "Update"), kind: "dir" },
    { label: "Dentro", path: path.join(data, "UPDATE", "mio.json") },
    { label: "Database", path: path.join(data, "LENS.DB") },
    { label: "Dashboard", path: path.join(data, "Dashboard-v2.json") },
    { label: "Database personale", path: path.join(data, "Mio.SQLite-WAL") },
    { label: "Mio", path: path.join(data, "Mio.json") },
  ]);
  const reg = new ModuleRegistry({ found: [mod], enabled: [], log });
  await reg.start(makeCtx);
  const files = await reg.files((id) => makeCtx(id, "/tmp/lens-maiuscole/mio.sqlite"));
  assert.deepEqual(
    files.map((f) => f.label),
    ["Mio"],
  );
  assert.equal(log.lines.warn.filter((l) => /maiuscole: file scartato/.test(l)).length, 5, log.lines.warn.join("\n"));
});

test("ModuleRegistry.files: due moduli con lo stesso percorso → un avviso, elencato una volta (resta il primo per id)", async () => {
  const log = fakeLog();
  const a = filesModule("aaa", (data) => [{ label: "Comune di A", path: path.join(data, "comune.json") }, { label: "Cartella di A", path: path.join(data, "cartella"), kind: "dir" }]);
  const b = filesModule("bbb", (data) => [{ label: "Comune di B", path: path.join(data, "sotto", "..", "comune.json") }, { label: "Cartella di B", path: path.join(data, "cartella"), kind: "dir" }, { label: "Solo di B", path: path.join(data, "b.json") }]);
  const reg = new ModuleRegistry({ found: [a, b], enabled: [], log });
  await reg.start(makeCtx);
  const files = await reg.files((id) => makeCtx(id, "/tmp/lens-doppi/lens.db"));
  assert.deepEqual(
    files.map((f) => [f.id, f.label, f.path]),
    [
      ["aaa", "Comune di A", "/tmp/lens-doppi/comune.json"],
      ["aaa", "Cartella di A", "/tmp/lens-doppi/cartella"],
      ["bbb", "Solo di B", "/tmp/lens-doppi/b.json"],
    ],
  );
  const dup = log.lines.warn.filter((l) => /dichiarato anche da/.test(l));
  assert.equal(dup.length, 2, log.lines.warn.join("\n"));
  assert.ok(dup.every((l) => l.includes("aaa") && l.includes("bbb")));
});

test("about: una cartella di modulo fra i file scritti e in rm -rf; i percorsi già del core o ripetuti una volta sola", () => {
  const config = loadConfig({ LENS_DB: "/altrove/dati/lens.db" });
  const store = memoryStore();
  const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };
  const moduleFiles = [
    { id: "demo", label: "File caricati nella demo", path: "/altrove/dati/demo-files", note: "una cartella per file", kind: "dir", on: false },
    // the core lists these already (the registry drops them; about() keeps the core's entry whatever reaches it)
    { id: "demo", label: "Libreria", path: "/altrove/dati/update", note: null, kind: "dir", on: false },
    { id: "demo", label: "Indice", path: "/altrove/dati/dashboard-v2.json", note: null, kind: "write", on: false },
    { id: "demo", label: "Dati della demo", path: "/altrove/dati/demo.json", note: null, kind: "write", on: false },
    { id: "demo", label: "Dati della demo, ancora", path: "/altrove/dati/demo.json", note: null, kind: "write", on: false },
  ];
  const dashboard = { path: "/altrove/dati/dashboard-v2.json" };
  const a = about({ config, store, collector, moduleFiles, dashboard, defaultDbPath: "/altrove/lens.db" });
  const dirEntry = a.files.written.find((x) => x.label === "File caricati nella demo");
  assert.equal(dirEntry.path, "/altrove/dati/demo-files");
  assert.equal(dirEntry.note, "una cartella per file");
  assert.match(a.uninstall, /^rm -rf '\/altrove\/dati\/demo-files'$/m);
  assert.doesNotMatch(a.uninstall, /rm -f [^\n]*demo-files/, "una cartella non va in rm -f");
  for (const p of ["/altrove/dati/update", "/altrove/dati/dashboard-v2.json", "/altrove/dati/demo.json"]) {
    assert.equal(a.files.written.filter((x) => x.path === p).length, 1, `${p} una volta fra i file scritti`);
    assert.equal(a.uninstall.split(`'${p}'`).length - 1, 1, `${p} una volta nella disinstallazione`);
  }
  assert.ok(!a.files.written.some((x) => x.label === "Libreria" || x.label === "Indice"), "resta la voce del core");
  store.close();
});

test("about: in memoria nessuna cartella di modulo", () => {
  const config = loadConfig({ LENS_DB: ":memory:" });
  const store = memoryStore();
  const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };
  const a = about({ config, store, collector, moduleFiles: [{ id: "demo", label: "Cartella", path: "/altrove/dati/demo-files", note: null, kind: "dir", on: true }], defaultDbPath: "/altrove/lens.db" });
  assert.ok(!a.uninstall.includes("demo-files"));
  store.close();
});

test("about: deprecatedEnv accanto a unknownEnv, per la pagina Impostazioni in sola lettura", () => {
  const config = loadConfig({ LENS_DB: ":memory:", LENS_BOB: "1", LENS_PROT: "1" });
  const store = memoryStore();
  const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };
  const a = about({ config, store, collector, defaultDbPath: "/altrove/lens.db" });
  assert.deepEqual([a.unknownEnv, a.deprecatedEnv], [["LENS_PROT"], ["LENS_BOB"]]);
  store.close();
});

test("about: i file dei moduli tra i file scritti e nei percorsi della disinstallazione", () => {
  const config = loadConfig({ LENS_DB: "/altrove/dati/lens.db" });
  const store = memoryStore();
  const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };
  const moduleFiles = [{ id: "demo", label: "Dati della demo", path: "/altrove/dati/demo.json", note: "scritti dalla demo", kind: "write", on: true }];
  const a = about({ config, store, collector, moduleFiles, defaultDbPath: "/altrove/lens.db" });
  const entry = a.files.written.find((x) => x.label === "Dati della demo");
  assert.equal(entry.path, "/altrove/dati/demo.json");
  assert.equal(entry.note, "scritti dalla demo");
  assert.match(a.uninstall, /rm -f [^\n]*'\/altrove\/dati\/demo\.json'/);
  store.close();
});

test("about: un percorso read compare fra i letti solo a modulo acceso e mai nella disinstallazione", () => {
  const config = loadConfig({ LENS_DB: "/altrove/dati/lens.db" });
  const store = memoryStore();
  const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };
  const mk = (on) => [{ id: "demo", label: "Audit letto", path: "/fuori/audit", note: "solo lettura", kind: "read", on }];
  const acceso = about({ config, store, collector, moduleFiles: mk(true), defaultDbPath: "/altrove/lens.db" });
  assert.equal(acceso.files.read.find((x) => x.label === "Audit letto").path, "/fuori/audit");
  assert.ok(!acceso.files.written.some((x) => x.label === "Audit letto"));
  assert.ok(!acceso.uninstall.includes("/fuori/audit"));
  const spento = about({ config, store, collector, moduleFiles: mk(false), defaultDbPath: "/altrove/lens.db" });
  assert.ok(!spento.files.read.some((x) => x.label === "Audit letto"));
  assert.ok(!spento.uninstall.includes("/fuori/audit"));
  store.close();
});

test("about: solo kind write arriva fra i file scritti e a rm -f; un kind sconosciuto o assente (fuori dal registro) mai", () => {
  const config = loadConfig({ LENS_DB: "/altrove/dati/lens.db" });
  const store = memoryStore();
  const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };
  const moduleFiles = [
    { id: "demo", label: "Futuro", path: "/fuori/futuro", note: "un kind che il registro non conosce", kind: "watch", on: true },
    { id: "demo", label: "Senza kind", path: "/fuori/senza-kind", note: "nessun kind", on: true },
  ];
  const a = about({ config, store, collector, moduleFiles, defaultDbPath: "/altrove/lens.db" });
  for (const p of ["/fuori/futuro", "/fuori/senza-kind"]) {
    assert.ok(!a.uninstall.includes(p), `${p} non va mai in rm -f`);
    assert.ok(!a.files.written.some((x) => x.path === p), `${p} non è fra i file scritti`);
  }
  store.close();
});

test("ModuleRegistry.notices: spento con dati → pending finché non lo si chiude", async () => {
  const store = memoryStore();
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log });
  await reg.start(makeCtx);
  assert.deepEqual(await reg.notices(makeCtx, store), ["demo"]);
  assert.equal(store.meta("module:demo:notice"), "pending");
  assert.equal(calls.hasData, 1);
  assert.equal(reg.list().find((m) => m.id === "demo").notice, true);
  // a module without hasData, or whose hasData throws, has nothing to point out
  assert.equal(store.meta("module:gemello:notice"), "seen");
  assert.equal(store.meta("module:crash:notice"), "seen");
  assert.ok(log.lines.error.some((l) => /crash/.test(l)), "l'hasData che lancia finisce nel log");
  assert.equal(store.meta("module:broken:notice"), undefined, "un manifesto rotto non si giudica");
  assert.equal(reg.list().find((m) => m.id === "gemello").notice, false);

  // the next start: still pending, hasData not asked again
  const again = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog() });
  await again.start(makeCtx);
  assert.deepEqual(await again.notices(makeCtx, store), ["demo"]);
  assert.equal(calls.hasData, 1);

  assert.equal(again.dismissNotice("demo", store), true);
  assert.equal(store.meta("module:demo:notice"), "dismissed");
  assert.equal(again.list().find((m) => m.id === "demo").notice, false, "subito, senza riavvio");
  assert.equal(again.dismissNotice("assente", store), false);
  assert.equal(again.dismissNotice("broken", store), false, "solo moduli con un manifesto");
  const third = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog() });
  assert.deepEqual(await third.notices(makeCtx, store), []);
});

test("ModuleRegistry.notices: un modulo attivo non ha avviso, e un pending diventa seen", async () => {
  const fresh = memoryStore();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog() });
  await reg.start(makeCtx);
  assert.deepEqual(await reg.notices(makeCtx, fresh), []);
  assert.equal(fresh.meta("module:demo:notice"), "seen");
  assert.equal(calls.hasData, 0, "un modulo attivo non è interrogato");

  const store = memoryStore();
  store.meta("module:demo:notice", "pending");
  const on = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog() });
  await on.start(makeCtx);
  assert.deepEqual(await on.notices(makeCtx, store), []);
  assert.equal(store.meta("module:demo:notice"), "seen");
});

/** A module found in memory whose create() returns `routes`. */
function inlineModule(id, routes) {
  return {
    id,
    dir: path.join(dir, id),
    manifest: { id, name: id, description: "", lens: "0.1.0", menu: { group: "dati", order: 90, icon: "" }, page: { title: id }, server: async () => ({ create: () => ({ routes }) }) },
  };
}

test("ModuleRegistry.start: route con chiave o valore non validi → un avviso ciascuna, scartate, il modulo resta on", async () => {
  const log = fakeLog();
  const ok = () => ({ ok: true });
  const body = { type: "json", max: 1024 };
  const routes = {
    "PUT /api/x": ok,
    "GET api/x": ok,
    "GET /api/X": ok,
    "POST /api/nuda": ok,
    "POST /api/zero": { handler: ok, body: { type: "json", max: 0 }, what: "le x" },
    "POST /api/enorme": { handler: ok, body: { type: "json", max: MAX_UPLOAD + 1 }, what: "le x" },
    "POST /api/zip": { handler: ok, body: { type: "zip", max: 1024 }, what: "le x" },
    "POST /api/senza-what": { handler: ok, body },
    "POST /api/senza-handler": { body, what: "le x" },
    // raw bodies: a list of content-types a browser cannot send cross-site without a preflight, never empty nor a wildcard
    "POST /api/grezza-senza-tipi": { handler: ok, body: { type: "raw", max: 1024 }, what: "le x" },
    "POST /api/grezza-vuota": { handler: ok, body: { type: "raw", max: 1024, types: [] }, what: "le x" },
    "POST /api/grezza-testo": { handler: ok, body: { type: "raw", max: 1024, types: ["application/zip", "text/plain"] }, what: "le x" },
    "POST /api/grezza-form": { handler: ok, body: { type: "raw", max: 1024, types: ["application/x-www-form-urlencoded"] }, what: "le x" },
    "POST /api/grezza-multipart": { handler: ok, body: { type: "raw", max: 1024, types: ["Multipart/Form-Data"] }, what: "le x" },
    "POST /api/grezza-jolly": { handler: ok, body: { type: "raw", max: 1024, types: ["application/*"] }, what: "le x" },
    "POST /api/grezza-tutto": { handler: ok, body: { type: "raw", max: 1024, types: ["*/*"] }, what: "le x" },
    "POST /api/grezza-stringa-vuota": { handler: ok, body: { type: "raw", max: 1024, types: [""] }, what: "le x" },
    "POST /api/grezza-parametri": { handler: ok, body: { type: "raw", max: 1024, types: ["application/zip; charset=utf-8"] }, what: "le x" },
    "POST /api/grezza-numero": { handler: ok, body: { type: "raw", max: 1024, types: [42] }, what: "le x" },
    "POST /api/grezza-testo-solo": { handler: ok, body: { type: "raw", max: 1024, types: "application/zip" }, what: "le x" },
    "POST /api/grezza-grande": { handler: ok, body: { type: "raw", max: MAX_UPLOAD + 1, types: ["application/zip"] }, what: "le x" },
    "POST /api/json-con-tipi": { handler: ok, body: { type: "json", max: 1024, types: ["application/zip"] }, what: "le x" },
    "GET /api/numero": 42,
    "GET /api/valida": ok,
    "POST /api/valida": { handler: ok, body, what: "le x" },
  };
  const reg = new ModuleRegistry({ found: [inlineModule("storto", routes)], enabled: ["storto"], log });
  await reg.start(makeCtx);
  assert.deepEqual(reg.activeIds(), ["storto"]);
  assert.equal(log.lines.warn.length, Object.keys(routes).length - 2, log.lines.warn.join("\n"));
  for (const key of Object.keys(routes).filter((k) => !k.includes("/api/valida"))) {
    assert.ok(log.lines.warn.some((l) => l.includes(key) && l.includes("storto")), key);
  }
  assert.equal(reg.route("GET", "/api/valida").handler, ok);
  assert.equal(reg.write("/api/valida").handler, ok);
  assert.equal(reg.route("GET", "/api/numero"), null);
  for (const p of ["/api/x", "/api/x/a", "/api/nuda", "/api/zero", "/api/enorme", "/api/zip", "/api/senza-what", "/api/senza-handler"]) assert.equal(reg.write(p), null, p);
  for (const p of Object.keys(routes).filter((k) => k.startsWith("POST /api/grezza") || k.startsWith("POST /api/json-con"))) assert.equal(reg.write(p.slice(5)), null, p);
  assert.equal(reg.write("/api/numero"), null);
});

test("ModuleRegistry: una POST grezza con i suoi content-type, una JSON senza type, una a prefisso col resto decodificato", async () => {
  const log = fakeLog();
  const ok = () => ({});
  const prefix = () => ({ prefix: true });
  const exact = () => ({ exact: true });
  const routes = {
    "POST /api/carica": { handler: ok, body: { type: "raw", max: 2048, types: ["Application/Zip", "text/markdown"] }, what: "le x" },
    "POST /api/implicita": { handler: ok, body: { max: 10 }, what: "le x" },
    "POST /api/cose/*": { handler: prefix, body: { type: "json", max: 64 }, what: "le cose" },
    "POST /api/cose/esatta": { handler: exact, body: { type: "json", max: 64 }, what: "le cose" },
  };
  const reg = new ModuleRegistry({ found: [inlineModule("grezzo", routes)], enabled: ["grezzo"], log });
  await reg.start(makeCtx);
  assert.deepEqual(log.lines.warn, []);
  assert.deepEqual(reg.write("/api/carica"), { id: "grezzo", handler: ok, body: { type: "raw", max: 2048, types: ["application/zip", "text/markdown"] }, what: "le x", rest: undefined });
  assert.deepEqual(reg.write("/api/implicita").body, { type: "json", max: 10 }, "type json di predefinito");
  assert.equal(reg.write("/api/cose/abc").rest, "abc");
  assert.equal(reg.write("/api/cose/abc").handler, prefix);
  assert.equal(reg.write("/api/cose/a%2Fb").rest, "a/b");
  assert.equal(reg.write("/api/cose/%2e%2e%2fx").rest, "../x");
  assert.equal(reg.write("/api/cose/%E0").rest, null);
  assert.equal(reg.write("/api/cose/").rest, "");
  assert.equal(reg.write("/api/cose"), null, "il prefisso è /api/cose/");
  assert.equal(reg.write("/api/cose/esatta").handler, exact, "l'esatta prima del prefisso");
  assert.equal(reg.write("/api/cose/esatta").rest, undefined);
  assert.equal(reg.route("GET", "/api/cose/abc"), null, "una POST non risponde a GET");
});

test("ModuleRegistry.serves: i percorsi delle route dei moduli attivi, GET o POST, esatti o a prefisso", async () => {
  const ok = () => ({});
  const post = { handler: ok, body: { type: "json", max: 64 }, what: "le x" };
  const routes = { "GET /api/leggi": ok, "GET /api/sotto/*": ok, "POST /api/scrivi": post, "POST /api/azioni/*": post };
  const on = new ModuleRegistry({ found: [inlineModule("servo", routes)], enabled: ["servo"], log: fakeLog() });
  await on.start(makeCtx);
  for (const p of ["/api/leggi", "/api/sotto/", "/api/sotto/x/y", "/api/scrivi", "/api/azioni/1", "/api/azioni/"]) assert.equal(on.serves(p), true, p);
  for (const p of ["/api/leggix", "/api/sotto", "/api/azioni", "/api/altro"]) assert.equal(on.serves(p), false, p);
  const off = new ModuleRegistry({ found: [inlineModule("servo", routes)], enabled: [], log: fakeLog() });
  await off.start(makeCtx);
  for (const p of ["/api/leggi", "/api/scrivi", "/api/azioni/1"]) assert.equal(off.serves(p), false, `spento: ${p}`);
});

test("ModuleRegistry.start: le route che toccano un percorso del core sono scartate, nei due versi, con un avviso", async () => {
  const log = fakeLog();
  const ok = () => ({ ok: true });
  const post = { handler: ok, body: { type: "json", max: 1024 }, what: "le x" };
  const clashes = {
    "GET /api/status": ok, // a core GET path
    "POST /api/status": post, // the same path with another method
    "GET /api/modules/notice": ok, // a core POST-only path, as a GET
    "POST /api/macos-app/install": post, // a core POST
    "GET /api/sessions/mie": ok, // inside a core prefix
    "GET /api/sessions/mie/*": ok, // a prefix inside a core prefix
    "GET /api/sessions/*": ok, // the core prefix itself
    "GET /api/mcp/*": ok, // a prefix covering /api/mcp/status
    "GET /api/runs/*": ok, // covering /api/runs/summary and /api/runs/live
    "GET /api/update/*": ok, // covering the POST /api/update/apply
    "POST /api/settings": post, // a core write
    "POST /api/sessions/*": post, // the core prefix, as a POST
    "POST /api/update/*": post, // a POST prefix covering the POST /api/update/apply
    "POST /api/sessions/mie/*": post, // a POST prefix inside a core prefix
  };
  const fine = {
    "GET /api/mcp": ok, // /api/mcp itself is not the core's
    "GET /api/sessionsx": ok, // not under /api/sessions/
    "GET /api/today/*": ok, // /api/today is exact: under it nothing is the core's
    "POST /api/statusx": post,
  };
  const reg = new ModuleRegistry({ found: [inlineModule("invasore", { ...clashes, ...fine })], enabled: ["invasore"], log });
  await reg.start(makeCtx);
  assert.deepEqual(reg.activeIds(), ["invasore"]);
  assert.equal(log.lines.warn.length, Object.keys(clashes).length, log.lines.warn.join("\n"));
  for (const key of Object.keys(clashes)) assert.ok(log.lines.warn.some((l) => l.includes(`route ${key} scartata`) && l.includes("invasore") && l.includes("percorso del core")), key);
  for (const p of ["/api/status", "/api/modules/notice", "/api/sessions/mie", "/api/sessions/mie/x", "/api/sessions/a", "/api/mcp/status", "/api/mcp/x", "/api/runs/summary", "/api/update/x"]) assert.equal(reg.route("GET", p), null, p);
  for (const p of ["/api/status", "/api/macos-app/install", "/api/settings", "/api/sessions/a", "/api/update/apply", "/api/update/x", "/api/sessions/mie/x"]) assert.equal(reg.write(p), null, p);
  assert.equal(reg.route("GET", "/api/mcp").handler, ok);
  assert.equal(reg.route("GET", "/api/sessionsx").handler, ok);
  assert.equal(reg.route("GET", "/api/today/x").handler, ok);
  assert.equal(reg.write("/api/statusx").handler, ok);
});

test("ModuleRegistry: MAX_UPLOAD è un massimo valido per una POST", async () => {
  const log = fakeLog();
  const ok = () => ({});
  const reg = new ModuleRegistry({ found: [inlineModule("grande", { "POST /api/grande": { handler: ok, body: { type: "json", max: MAX_UPLOAD }, what: "le x" } })], enabled: ["grande"], log });
  await reg.start(makeCtx);
  assert.deepEqual(log.lines.warn, []);
  assert.deepEqual(reg.write("/api/grande"), { id: "grande", handler: ok, body: { type: "json", max: MAX_UPLOAD }, what: "le x", rest: undefined });
});

test("ModuleRegistry.route: a prefisso, con il resto già decodificato; l'esatta prima del prefisso", async () => {
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog() });
  await reg.start(makeCtx);
  const hit = reg.route("GET", "/api/demo-files/a%2Fb");
  assert.equal(hit.id, "demo");
  assert.equal(typeof hit.handler, "function");
  assert.equal(hit.rest, "a/b");
  assert.equal(reg.route("HEAD", "/api/demo-files/a%2Fb").rest, "a/b");
  assert.equal(reg.route("GET", "/api/demo-files/").rest, "");
  assert.equal(reg.route("GET", "/api/demo-files/%2e%2e/x").rest, "../x");
  assert.equal(reg.route("GET", "/api/demo-files/%E0%A4%A").rest, null);
  assert.equal(reg.route("GET", "/api/demo-files"), null, "il prefisso è /api/demo-files/");
  assert.equal(reg.route("POST", "/api/demo-files/a"), null);
  assert.equal(reg.route("GET", "/api/demo").rest, undefined);

  const first = () => ({ first: true });
  const exact = () => ({ exact: true });
  const second = () => ({ second: true });
  const both = new ModuleRegistry({ found: [inlineModule("a", { "GET /api/p/*": first, "GET /api/p/esatta": exact }), inlineModule("b", { "GET /api/p/*": second })], enabled: ["a", "b"], log: fakeLog() });
  await both.start(makeCtx);
  assert.equal(both.route("GET", "/api/p/esatta").handler, exact);
  assert.equal(both.route("GET", "/api/p/altro").handler, first, "tra moduli vince il primo per id");
});

test("ModuleRegistry.write: solo le POST dei moduli attivi", async () => {
  const on = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog() });
  await on.start(makeCtx);
  const w = on.write("/api/demo-save");
  assert.equal(w.id, "demo");
  assert.equal(typeof w.handler, "function");
  assert.deepEqual(w.body, { type: "json", max: 1024 });
  assert.equal(typeof w.what, "string");
  assert.equal(on.write("/api/demo"), null);
  assert.equal(on.route("GET", "/api/demo-save"), null, "una POST non risponde a GET");

  const off = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog() });
  await off.start(makeCtx);
  assert.equal(off.write("/api/demo-save"), null);
});

test("ctx.reply: un Reply congelato; stato fuori da 200–599 o non intero → TypeError", () => {
  const ctx = makeCtx("demo");
  const r = ctx.reply(404, { error: "x" });
  assert.ok(r instanceof Reply);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: "x" });
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(Reply));
  assert.equal(ctx.reply(200, {}).status, 200);
  assert.equal(ctx.reply(599, {}).status, 599);
  for (const bad of [199, 600, 404.5, "404", Number.NaN, undefined]) assert.throws(() => ctx.reply(bad, {}), TypeError, String(bad));
  for (const bad of [undefined, null, "x", 5, [], new Map()]) assert.throws(() => ctx.reply(404, bad), TypeError, `corpo ${String(bad)}`);
});

/** A modules folder in a temp dir: { <id>: manifest source fields as text }, each a full manifest plus `extra`. */
function tempModules(defs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-moduli-set-"));
  for (const [id, extra] of Object.entries(defs)) {
    fs.mkdirSync(path.join(root, id));
    fs.writeFileSync(
      path.join(root, id, "module.js"),
      `export default { id: ${JSON.stringify(id)}, name: "N", description: "D", lens: "0.1.0", menu: { group: "dati", order: 1, icon: "" }, page: { title: "T" }, server: async () => ({}), ${extra} };\n`,
    );
  }
  return root;
}

test("manifesto: settings con un nome del core, senza LENS_, dichiarato da un modulo prima per id o malformato → errore di manifesto", async () => {
  const root = tempModules({
    aaa: 'settings: [{ name: "LENS_COMUNE", label: "Comune", help: "", kind: "text" }]',
    bbb: 'settings: [{ name: "LENS_COMUNE", label: "Comune", help: "", kind: "text" }]',
    ccc: 'settings: [{ name: "LENS_PORT", label: "Porta", help: "", kind: "num" }]',
    ddd: 'settings: [{ name: "FOO", label: "Foo", help: "", kind: "text" }]',
    eee: 'settings: [{ name: "LENS_EEE", label: "E", help: "", kind: "bool" }]',
    fff: 'settings: [{ name: "LENS_FFF", help: "", kind: "text" }]',
    ggg: 'settings: [{ name: "LENS_G", label: "G", help: "", kind: "text" }, { name: "LENS_G", label: "G", help: "", kind: "text" }]',
    hhh: 'settings: "LENS_H"',
    iii: 'settings: [{ name: "LENS_III", label: "I", help: "aiuto", kind: "secret", placeholder: "x" }, { name: "LENS_III_N", label: "N", help: "", kind: "num" }]',
  });
  try {
    const by = Object.fromEntries((await discoverModules(root)).map((m) => [m.id, m]));
    assert.equal(by.aaa.error, undefined);
    assert.equal(by.iii.error, undefined, "text, secret e num con placeholder facoltativo");
    for (const id of ["bbb", "ccc", "ddd", "eee", "fff", "ggg", "hhh"]) assert.ok(by[id].error instanceof Localized, id);
    assert.match(inEnglish(() => errorText(by.bbb.error)), /LENS_COMUNE.*aaa/);
    assert.match(by.ccc.error.message, /LENS_PORT/);
    assert.match(by.ddd.error.message, /FOO/);
    assert.deepEqual([...moduleVars(Object.values(by))].sort(), ["LENS_COMUNE", "LENS_III", "LENS_III_N"], "solo i manifesti validi");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("moduleVars: le variabili dichiarate dai moduli trovati, anche spenti", async () => {
  assert.deepEqual([...moduleVars(await discoverModules(dir))].sort(), ["LENS_DEMO_DIR", "LENS_DEMO_KEY", "LENS_DEMO_LIMIT"]);
  assert.deepEqual([...moduleVars([])], []);
});

test("impostazioni: acceso con un valore non valido → unconfigured col motivo tradotto, gli altri moduli partono", async () => {
  const log = fakeLog();
  const env = { HOME: "/casa", LENS_DEMO_DIR: "relativa" };
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo", "gemello"], log, env });
  addCatalogs({ en: await reg.catalogs("en") });
  await reg.start(ctxWith(env));
  const by = Object.fromEntries(reg.list().map((m) => [m.id, m]));
  assert.equal(by.demo.state, "unconfigured");
  assert.equal(calls.create, 0, "con impostazioni sbagliate il modulo non viene creato");
  assert.equal(inEnglish(() => errorText(by.demo.reason)), 'LENS_DEMO_DIR must be an absolute path, found "relativa"');
  assert.equal(by.gemello.state, "on");
  assert.ok(log.lines.warn.some((l) => /demo/.test(l)), "il motivo finisce nel log");
});

test("impostazioni: acceso con valori validi → create riceve ctx.settings; ctx.env solo con le variabili del modulo, HOME e XDG_*", async () => {
  const env = { HOME: "/casa", XDG_DATA_HOME: "/dati", XDG_CONFIG_HOME: "/conf", LENS_TOKEN: "segretissimo-0123456789", LENS_DEMO_DIR: "/qui", LENS_DEMO_KEY: "k", OPENCODE_SERVER_PASSWORD: "pw", PATH: "/bin" };
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog(), env });
  await reg.start(ctxWith(env));
  assert.equal(reg.list().find((m) => m.id === "demo").state, "on");
  assert.deepEqual(seen.create.settings, { dir: "/qui", key: true, limit: 60 });
  assert.ok(Object.isFrozen(seen.create.settings) && Object.isFrozen(seen.create.env));
  assert.deepEqual(seen.create.env, { HOME: "/casa", XDG_DATA_HOME: "/dati", XDG_CONFIG_HOME: "/conf", LENS_DEMO_DIR: "/qui", LENS_DEMO_KEY: "k" });
  assert.equal(seen.create.env.LENS_TOKEN, undefined);
  assert.deepEqual(seen.create.paths, { home: "/casa", opencodeConfigDir: "/conf/opencode", xdgData: "/dati", dataDir: null });
  // configure has the same narrow env and paths
  assert.equal(seen.configure.env.LENS_TOKEN, undefined);
  assert.equal(seen.configure.paths.xdgData, "/dati");
  assert.equal(calls.configure, 1, "configure una volta per avvio");
});

test("impostazioni: senza XDG_DATA_HOME xdgData è ~/.local/share della HOME", async () => {
  const env = { HOME: "/casa" };
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog(), env });
  await reg.start(ctxWith(env));
  assert.deepEqual(seen.create.settings, { dir: "/casa/.local/share/demo", key: false, limit: 60 });
});

test("impostazioni: spento con LENS_DEMO_DIR impostata → hasData e files vedono il valore impostato, non il predefinito", async () => {
  const env = { HOME: "/casa", LENS_DEMO_DIR: "/impostata" };
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog(), env });
  await reg.start(ctxWith(env));
  assert.equal(calls.configure, 1, "configure anche a modulo spento");
  assert.equal(calls.create, 0);
  assert.deepEqual(await reg.notices(ctxWith(env), memoryStore()), ["demo"]);
  assert.equal(seen.hasData.settings.dir, "/impostata");
  assert.equal(seen.hasData.env.LENS_DEMO_DIR, "/impostata");
  await reg.files(ctxWith(env));
  assert.equal(seen.files.settings.dir, "/impostata");
  assert.equal(calls.configure, 1, "configure non si ripete per hasData e files");
});

test("impostazioni: spento con un valore non valido → hasData falso (non chiamato), files saltato, nessun errore di stato", async () => {
  const env = { HOME: "/casa", LENS_DEMO_DIR: "relativa" };
  const store = memoryStore();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog(), env });
  await reg.start(ctxWith(env));
  assert.equal(reg.list().find((m) => m.id === "demo").state, "off", "spento resta spento");
  assert.deepEqual(await reg.notices(ctxWith(env), store), []);
  assert.equal(store.meta("module:demo:notice"), "seen");
  assert.equal(calls.hasData, 0);
  assert.deepEqual((await reg.files((id, extra) => makeCtx(id, "/tmp/lens-moduli/lens.db", { env, ...extra }))).filter((f) => f.id === "demo"), []);
  assert.equal(seen.files, null);
});

test("registry.validateEnv: errori dei soli moduli accesi nell'ambiente dato, senza effetti", async () => {
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log, env: { HOME: "/casa" } });
  addCatalogs({ en: await reg.catalogs("en") });
  await reg.start(ctxWith({ HOME: "/casa" }));
  const before = calls.configure;
  const errors = await reg.validateEnv({ HOME: "/casa", LENS_DEMO_DIR: "relativa" }, ["demo"]);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Localized);
  assert.match(inEnglish(() => errorText(errors[0])), /^LENS_DEMO_DIR must be an absolute path/);
  assert.deepEqual(await reg.validateEnv({ HOME: "/casa", LENS_DEMO_DIR: "relativa" }, []), [], "spento: non si valida");
  assert.deepEqual(await reg.validateEnv({ HOME: "/casa", LENS_DEMO_DIR: "/ok" }, ["demo", "nessuno", "broken"]), []);
  assert.equal(calls.configure, before + 2, "solo i moduli accesi con un manifesto");
  assert.equal(reg.list().find((m) => m.id === "demo").state, "off", "lo stato non cambia");
  assert.equal(calls.create, 0);
  assert.deepEqual([log.lines.warn.length, log.lines.error.length], [0, 0]);
});

test("ModuleRegistry.list: le impostazioni dichiarate e se il modulo ha strumenti MCP", async () => {
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog() });
  const demo = reg.list().find((m) => m.id === "demo");
  assert.deepEqual(demo.settings.map((s) => s.name), ["LENS_DEMO_DIR", "LENS_DEMO_KEY", "LENS_DEMO_LIMIT"]);
  assert.equal(demo.mcp, true);
  assert.deepEqual(demo.mcpExamples, ["Cosa dice la demo?"], "testi italiani: /api/modules li traduce");
  const broken = reg.list().find((m) => m.id === "broken");
  assert.deepEqual(broken.settings, []);
  assert.equal(broken.mcp, false);
  assert.deepEqual(broken.mcpExamples, []);
});

test("about: le variabili dei moduli accesi fra le impostazioni, segreti mai mostrati; quelle dei moduli spenti no", async () => {
  const config = loadConfig({ LENS_DB: ":memory:" });
  const store = memoryStore();
  const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };
  const env = { LENS_DEMO_DIR: "/qui", LENS_DEMO_KEY: "valore-nascosto" };
  const on = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo"], log: fakeLog(), env });
  await on.start(ctxWith(env));
  const a = about({ config, store, collector, modules: on.list(), env, defaultDbPath: "/altrove/lens.db" });
  const rows = Object.fromEntries(a.settings.filter((s) => s.module).map((s) => [s.name, s]));
  assert.deepEqual(rows.LENS_DEMO_DIR, { name: "LENS_DEMO_DIR", help: "percorso assoluto; vuoto = la cartella dei dati di XDG", fromEnv: true, secret: false, value: "/qui", module: "demo" });
  assert.equal(rows.LENS_DEMO_KEY.value, "impostato");
  assert.ok(!JSON.stringify(a).includes("valore-nascosto"));
  const off = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog(), env });
  assert.equal(about({ config, store, collector, modules: off.list(), env, defaultDbPath: "/altrove/lens.db" }).settings.some((s) => s.module), false);
  store.close();
});

/** Modules in a temp dir with a Node entry each: { <id>: { extra: manifest fields as text, server: source of server/index.js } }. */
function tempServerModules(defs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-moduli-srv-"));
  for (const [id, { extra = "", server }] of Object.entries(defs)) {
    fs.mkdirSync(path.join(root, id, "server"), { recursive: true });
    fs.writeFileSync(path.join(root, id, "server", "index.js"), server);
    fs.writeFileSync(
      path.join(root, id, "module.js"),
      `export default { id: ${JSON.stringify(id)}, name: "N", description: "D", lens: "0.1.0", menu: { group: "dati", order: 1, icon: "" }, page: { title: "T" }, server: () => import("./server/index.js"), ${extra} };\n`,
    );
  }
  return root;
}

test("configure con errori → unconfigured col motivo (anche errori stringa), configure che lancia o malformato → error", async () => {
  const root = tempServerModules({
    strerr: { server: 'export const configure = () => ({ values: {}, errors: ["manca la chiave"] }); export const create = () => ({ routes: { "GET /api/strerr": () => ({}) } });' },
    lancia: { server: 'export const configure = () => { throw new Error("boom"); }; export const create = () => ({});' },
    nonogg: { server: "export const configure = () => 5; export const create = () => ({});" },
    nonlista: { server: 'export const configure = () => ({ values: {}, errors: "no" }); export const create = () => ({});' },
    bene: { server: "export const create = () => ({});" },
  });
  try {
    const log = fakeLog();
    const reg = new ModuleRegistry({ found: await discoverModules(root), enabled: ["strerr", "lancia", "nonogg", "nonlista", "bene"], log });
    await reg.start(makeCtx);
    const by = Object.fromEntries(reg.list().map((m) => [m.id, m]));
    assert.equal(by.strerr.state, "unconfigured");
    assert.equal(by.strerr.reason.message, "manca la chiave");
    for (const id of ["lancia", "nonogg", "nonlista"]) assert.equal(by[id].state, "error", id);
    assert.equal(by.bene.state, "on");
    assert.deepEqual(reg.activeIds(), ["bene"], "un modulo da configurare conta come spento");
    assert.equal(reg.route("GET", "/api/strerr"), null, "nessuna route");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("start(): uno start asincrono che non finisce mai → error dopo START_TIMEOUT_MS, stop chiamato, registry.start torna", async () => {
  assert.equal(START_TIMEOUT_MS, 10_000);
  const root = tempServerModules({
    appeso: { server: 'export const calls = { stop: 0 }; export const create = () => ({ start: () => new Promise(() => {}), stop: () => { calls.stop++; } });' },
    bene: { server: "export const create = () => ({ start: async () => {} });" },
  });
  try {
    const reg = new ModuleRegistry({ found: await discoverModules(root), enabled: ["appeso", "bene"], log: fakeLog(), startTimeoutMs: 30 });
    await reg.start(makeCtx);
    const m = reg.list().find((x) => x.id === "appeso");
    assert.equal(m.state, "error");
    assert.match(m.reason.message, /start\(\) non ha finito entro/);
    assert.equal((await import(path.join(root, "appeso", "server", "index.js"))).calls.stop, 1);
    assert.deepEqual(reg.activeIds(), ["bene"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manifesto: min/max dei campi num (interi, min ≤ max), min/max su un campo text → errore di manifesto; notice e settingsPanel", async () => {
  const field = (extra) => `settings: [{ name: "LENS_X", label: "X", help: "", ${extra} }]`;
  const root = tempModules({
    aaa: field('kind: "num", min: 5, max: 3600'),
    bbb: field('kind: "num", min: 10, max: 3'),
    ccc: field('kind: "text", min: 1'),
    ddd: field('kind: "num", min: 1.5'),
    eee: field('kind: "num", max: "9"'),
    fff: 'notice: "avviso", settingsPanel: "settings-bob.js"',
    ggg: 'notice: ""',
    hhh: 'settingsPanel: "../x.js"',
    iii: "settingsPanel: 3",
    jjj: 'notice: 5',
  });
  try {
    const by = Object.fromEntries((await discoverModules(root)).map((m) => [m.id, m]));
    for (const id of ["aaa", "fff"]) assert.equal(by[id].error, undefined, id);
    for (const id of ["bbb", "ccc", "ddd", "eee", "ggg", "hhh", "iii", "jjj"]) assert.ok(by[id].error instanceof Localized, id);
    const reg = new ModuleRegistry({ found: Object.values(by), enabled: [], log: fakeLog() });
    const list = Object.fromEntries(reg.list().map((m) => [m.id, m]));
    assert.deepEqual([list.aaa.settings[0].min, list.aaa.settings[0].max], [5, 3600]);
    assert.equal(list.fff.noticeMessage, "avviso");
    assert.equal(list.fff.settingsPanel, "settings-bob.js");
    assert.equal(list.aaa.noticeMessage, null);
    assert.equal(list.aaa.settingsPanel, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manifesto: un id uguale a una chiave del corpo di /api/status o a un tipo di modifica del core è un errore di manifesto", async () => {
  const root = tempModules({ lens: "", counts: "", feed: "", step: "", sync: "", ok: "", okk: "" });
  try {
    const by = Object.fromEntries((await discoverModules(root)).map((m) => [m.id, m]));
    for (const id of ["lens", "counts", "feed", "step", "sync", "ok"]) assert.ok(by[id].error instanceof Localized, id);
    assert.equal(by.okk.error, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ModuleRegistry.tables: le tabelle dei moduli trovati, anche spenti; un tables.js che lancia all'import o rifiutato → error col motivo e il modulo non parte", async () => {
  const found = await discoverModules(dir);
  const demo = found.find((f) => f.id === "demo");
  const other = (id, tables) => ({ id, dir: path.join(dir, id), manifest: { ...demo.manifest, id, settings: [], tables } });
  const log = fakeLog();
  const reg = new ModuleRegistry({
    found: [
      ...found,
      other("zrotta", async () => {
        throw new Error("import fallito");
      }),
      other("zostile", async () => ({ default: { version: 1, sql: "DROP TABLE IF EXISTS steps" } })),
    ],
    enabled: ["zrotta", "zostile"],
    log,
  });
  const tables = await reg.tables();
  assert.deepEqual(tables, [{ id: "demo", version: 2, sql: demoTables.sql, columns: demoTables.columns }]);
  const by = Object.fromEntries(reg.list().map((m) => [m.id, m]));
  assert.equal(by.demo.state, "off", "spento: le tabelle ci sono lo stesso, il modulo resta spento");
  assert.equal(by.zrotta.state, "error");
  assert.ok(by.zrotta.reason instanceof Localized);
  assert.match(by.zrotta.reason.message, /tabelle non caricabili: import fallito/);
  assert.equal(by.zostile.state, "error");
  assert.match(by.zostile.reason.message, /DROP/);
  assert.equal(log.lines.error.length, 2, "una riga per modulo");
  await reg.start(makeCtx);
  assert.equal(calls.create, 0, "un modulo in errore per le tabelle non viene creato");
  assert.deepEqual(reg.activeIds(), []);
});

test("ModuleRegistry.tableErrors: un modulo le cui tabelle lo Store non crea va in error e non parte, gli altri sì", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-module-tables-"));
  const file = path.join(root, "lens.db");
  try {
    // a demo_items without the column the demo's index is on (and that its columns do not add)
    const old = new Store(file);
    old.db.exec("CREATE TABLE demo_items (id TEXT PRIMARY KEY, name TEXT)");
    old.close();
    const log = fakeLog();
    const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: ["demo", "famfail"], log });
    const store = new Store(file, { moduleTables: await reg.tables() });
    assert.deepEqual([...store.moduleTableErrors.keys()], ["demo"]);
    reg.tableErrors(store.moduleTableErrors);
    await reg.start(makeCtx);
    const by = Object.fromEntries(reg.list().map((m) => [m.id, m]));
    assert.equal(by.demo.state, "error");
    assert.match(by.demo.reason.message, /tabelle non create/);
    assert.equal(calls.create, 0);
    assert.equal(by.famfail.state, "on", "gli altri moduli non ne risentono");
    store.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ModuleRegistry: il ctx riceve le tabelle controllate (ctx.writer) e se il modulo dichiara una sorgente (ctx.live.feed)", async () => {
  const found = await discoverModules(dir);
  const demo = found.find((f) => f.id === "demo");
  const fonte = { id: "fonte", dir: path.join(dir, "fonte"), manifest: { ...demo.manifest, id: "fonte", settings: [], tables: undefined, source: { label: "Fonte" } } };
  const liscio = { id: "liscio", dir: path.join(dir, "liscio"), manifest: { ...demo.manifest, id: "liscio", settings: [], tables: undefined, source: undefined } };
  const extras = {};
  const spy = (id, extra) => {
    extras[id] = extra;
    return makeCtx(id, ":memory:", extra);
  };
  const reg = new ModuleRegistry({ found: [demo, fonte, liscio], enabled: ["demo", "fonte", "liscio"], log: fakeLog() });
  const store = memoryStore({ moduleTables: await reg.tables() });
  await reg.start(spy);
  assert.deepEqual(extras.demo.tables, { version: 2, sql: demoTables.sql, columns: demoTables.columns });
  assert.equal(extras.demo.source, true, "the demo declares a source too");
  assert.equal(extras.liscio.source, false);
  assert.equal(extras.fonte.tables, undefined);
  assert.equal(extras.fonte.source, true);
  assert.deepEqual(seen.create, { ...seen.create, writer: "undefined", feed: "undefined" }, "the last created: liscio, without tables nor a source");
  await reg.stop();
  store.close();
  // tables the Store could not create: no writer
  const again = new ModuleRegistry({ found: [demo], enabled: ["demo"], log: fakeLog() });
  await again.tables();
  again.tableErrors(new Map([["demo", new Localized("tabelle non create: prova")]]));
  await again.files(spy);
  assert.equal(extras.demo.tables, undefined);
});

test("manifesto: tables deve essere una funzione", async () => {
  const root = tempModules({ aaa: 'tables: () => import("./tables.js")', bbb: 'tables: "tables.js"' });
  try {
    const by = Object.fromEntries((await discoverModules(root)).map((m) => [m.id, m]));
    assert.equal(by.aaa.error, undefined);
    assert.ok(by.bbb.error instanceof Localized);
    assert.match(by.bbb.error.message, /tables/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manifesto: source vuole { label }; un id che è un parametro del core o una chiave di summary() non può essere una sorgente", async () => {
  const root = tempModules({
    aaa: 'source: { label: "A" }',
    bbb: "source: {}",
    ccc: 'source: "C"',
    from: 'source: { label: "F" }',
    token: 'source: { label: "T" }',
    steps: 'source: { label: "S" }',
    models: 'source: { label: "M" }',
    tools: "",
  });
  try {
    const by = Object.fromEntries((await discoverModules(root)).map((m) => [m.id, m]));
    assert.equal(by.aaa.error, undefined);
    assert.equal(by.tools.error, undefined, "an id of the summary is fine for a module without a source");
    for (const id of ["bbb", "ccc", "from", "token", "steps", "models"]) assert.ok(by[id].error instanceof Localized, id);
    assert.match(by.from.error.message, /parametro del core/);
    assert.match(by.steps.error.message, /parametro del core/, "steps: a parameter (runs?steps=1) before a key of the summary");
    assert.match(by.models.error.message, /chiave di \/api\/summary/);
    assert.match(inEnglish(() => errorText(by.bbb.error)), /^source must be \{ label \}/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A module of its own for the registry: `instance` is what create() returns. */
function withInstance(id, instance, extra = {}) {
  return {
    id,
    dir: path.join(dir, id),
    manifest: { id, name: id, description: "D", lens: "0.1.0", menu: { group: "dati", order: 1, icon: "" }, page: { title: id }, server: async () => ({ create: () => instance }), ...extra },
  };
}

test("ModuleRegistry: un modulo con source senza status() o source() va in error col motivo e non parte", async () => {
  const log = fakeLog();
  let started = 0;
  const start = () => {
    started++;
  };
  const reg = new ModuleRegistry({
    found: [withInstance("senzastato", { start, source: () => ({}) }, { source: { label: "A" } }), withInstance("senzasorgente", { start, status: () => ({}) }, { source: { label: "B" } }), withInstance("stato", { start, status: () => ({}) })],
    enabled: ["senzastato", "senzasorgente", "stato"],
    log,
  });
  await reg.start(makeCtx);
  const by = Object.fromEntries(reg.list().map((m) => [m.id, m]));
  for (const id of ["senzastato", "senzasorgente"]) {
    assert.equal(by[id].state, "error", id);
    assert.match(by[id].reason.message, /un modulo con source deve esporre status\(\) e source\(\)/);
  }
  assert.equal(by.stato.state, "on", "status() without a source is fine");
  assert.equal(started, 1);
  assert.equal(reg.source(), null);
});

test("ModuleRegistry.source: il primo per id fra gli attivi, un avviso con due; fail() lo ferma e lo mette in error", async () => {
  const log = fakeLog();
  const stops = [];
  const make = (id) => withInstance(id, { status: () => ({}), source: () => ({}), stop: () => stops.push(id), routes: { [`GET /api/${id}`]: () => ({ id }) } }, { source: { label: id.toUpperCase() } });
  const reg = new ModuleRegistry({ found: [make("alfa"), make("beta"), make("gamma")], enabled: ["beta", "gamma"], log });
  await reg.start(makeCtx);
  const src = reg.source();
  assert.equal(src.id, "beta");
  assert.equal(src.label, "BETA");
  assert.equal(typeof src.instance.source, "function");
  assert.equal(log.lines.warn.filter((l) => /una sola sorgente/.test(l)).length, 1);
  assert.match(log.lines.warn.find((l) => /una sola sorgente/.test(l)), /beta, gamma.*beta/);
  assert.ok(reg.route("GET", "/api/beta"));
  await reg.fail("beta", new Localized("sorgente non disponibile: {error}", { error: "prova" }));
  const by = Object.fromEntries(reg.list().map((m) => [m.id, m]));
  assert.equal(by.beta.state, "error");
  assert.match(by.beta.reason.message, /sorgente non disponibile: prova/);
  assert.deepEqual(stops, ["beta"]);
  assert.equal(reg.route("GET", "/api/beta"), null, "its routes are gone");
  assert.deepEqual(reg.activeIds(), ["gamma"]);
  assert.equal(log.lines.error.filter((l) => /beta/.test(l)).length, 1);
  // a module not on: nothing happens
  await reg.fail("alfa", new Localized("x"));
  assert.equal(Object.fromEntries(reg.list().map((m) => [m.id, m])).alfa.state, "off");
});

test("ModuleRegistry.statuses/states: una risposta non serializzabile (BigInt, ciclo) manca come un'eccezione, una riga nel log", async () => {
  const log = fakeLog();
  const cycle = {};
  cycle.self = cycle;
  const reg = new ModuleRegistry({
    found: [withInstance("bigint", { status: () => ({ n: 1n }) }), withInstance("ciclo", { state: () => cycle }), withInstance("buono", { status: () => ({ n: 1 }), state: () => "ok" })],
    enabled: ["bigint", "ciclo", "buono"],
    log,
  });
  await reg.start(makeCtx);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(reg.statuses(), { buono: { n: 1 } });
    assert.deepEqual(reg.states(), { buono: "ok" });
  }
  assert.equal(log.lines.error.filter((l) => /stato non disponibile/.test(l)).length, 1);
  assert.equal(log.lines.error.filter((l) => /stato per \/healthz non disponibile/.test(l)).length, 1);
});

test("ModuleRegistry.statuses/states: solo i moduli attivi che li hanno; uno che lancia manca, una riga nel log", async () => {
  const log = fakeLog();
  const reg = new ModuleRegistry({
    found: [
      withInstance("buono", { status: () => ({ n: 1 }), state: () => "ok" }),
      withInstance("rotto", {
        status: () => {
          throw new Error("stato rotto");
        },
        state: () => {
          throw new Error("rotto");
        },
      }),
      withInstance("muto", {}),
      withInstance("spento", { status: () => ({}), state: () => "ok" }),
    ],
    enabled: ["buono", "rotto", "muto"],
    log,
  });
  await reg.start(makeCtx);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(reg.statuses(), { buono: { n: 1 } });
    assert.deepEqual(reg.states(), { buono: "ok" });
  }
  assert.equal(log.lines.error.filter((l) => /rotto/.test(l)).length, 2, "one line for status(), one for state(), not one per request");
});

test("manifesto: campi MCP malformati → errore di manifesto tradotto; quelli giusti passano", async () => {
  const root = tempModules({
    aaa: 'mcp: () => import("./mcp/tools.js"), mcpTools: ["aaa"], mcpInstructions: ["- aaa: prova."], mcpExamples: ["Cosa fa aaa?"], mcpPrompts: true',
    bbb: 'mcp: "mcp/tools.js"',
    ccc: 'mcp: () => import("./x.js"), mcpTools: ["Con Spazi"]',
    ddd: 'mcp: () => import("./x.js"), mcpTools: ["d", "d"]',
    eee: 'mcp: () => import("./x.js"), mcpInstructions: ["due\\nrighe"]',
    fff: 'mcp: () => import("./x.js"), mcpExamples: "uno"',
    ggg: 'mcp: () => import("./x.js"), mcpPrompts: "sì"',
    hhh: "mcpPrompts: true",
    iii: 'mcpTools: ["iii"]',
  });
  try {
    const by = Object.fromEntries((await discoverModules(root)).map((m) => [m.id, m]));
    assert.equal(by.aaa.error, undefined);
    const expected = {
      bbb: "mcp deve essere una funzione che importa il file mcp/ del modulo",
      ccc: "mcpTools: Con Spazi non è un nome di strumento valido (minuscole, cifre, _ e -)",
      ddd: "mcpTools: d è ripetuto",
      eee: "mcpInstructions deve essere un elenco di testi non vuoti, su una riga ciascuno",
      fff: "mcpExamples deve essere un elenco di testi non vuoti, su una riga ciascuno",
      ggg: "mcpPrompts deve essere true o false",
      hhh: "mcpPrompts richiede anche mcp, la funzione che importa il file mcp/ del modulo",
      iii: "mcpTools richiede anche mcp, la funzione che importa il file mcp/ del modulo",
    };
    for (const [id, message] of Object.entries(expected)) {
      assert.ok(by[id].error instanceof Localized, id);
      assert.equal(by[id].error.message, message, id);
    }
    assert.equal(inEnglish(() => errorText(by.ddd.error)), "mcpTools: d is repeated");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ModuleRegistry.list: mcpPrompts dice se il modulo offre prompt al MCP", async () => {
  const reg = new ModuleRegistry({ found: await discoverModules(dir), enabled: [], log: fakeLog() });
  assert.equal(reg.list().find((m) => m.id === "demo").mcpPrompts, true);
  assert.equal(reg.list().find((m) => m.id === "broken").mcpPrompts, false);
});

/** The manifest text of one widget of module `id` (type `<id>-<name>`) reading `data`, plus the fields of `extra`. */
const widgetText = (id, name, data = ["/api/x"], extra = "") =>
  `{ type: "${id}-${name}", label: "L", description: "D", size: [6, 4], min: [3, 3], home: "both", data: ${JSON.stringify(data)}${extra} }`;

test("manifesto con widgets non validi: modulo in error", async () => {
  const root = tempModules({
    aaa: `widgetsFile: "widgets.js", widgets: [${widgetText("aaa", "uno")}, ${widgetText("aaa", "due")}]`,
    bbb: `widgets: [${widgetText("bbb", "uno")}]`,
    ccc: `widgetsFile: "widgets.js", widgets: [${widgetText("ddd", "uno")}]`,
    day: `widgetsFile: "widgets.js", widgets: [${widgetText("day", "x")}]`,
    model: `widgetsFile: "widgets.js", widgets: [${widgetText("model", "day")}]`,
    eee: `widgetsFile: "widgets.js", widgets: [${widgetText("eee", "uno", ["/status"])}]`,
    // a setting key some core widget uses (the union of WIDGET_TYPES[*].settings): refused (R20)
    fff: `widgetsFile: "widgets.js", widgets: [${widgetText("fff", "uno", ["/api/x"], ', settings: { metric: ["a"] }')}]`,
    ggg: `widgetsFile: "widgets.js", widgets: [${widgetText("ggg", "uno", ["/api/x"], ', settings: { title: null, range: ["day"], source: ["a"] }')}]`,
    hhh: `widgetsFile: "widgets.js", widgets: [${widgetText("hhh", "uno", ["/api/x"], ', settings: { title: null, range: ["dashboard", "day"], unita: ["a"] }')}]`,
  });
  try {
    const by = Object.fromEntries((await discoverModules(root)).map((m) => [m.id, m]));
    assert.equal(by.aaa.error, undefined);
    assert.equal(by.day.error, undefined, "a type that is no core type passes");
    assert.equal(by.hhh.error, undefined, "title, range and a key of its own pass");
    const expected = {
      bbb: "widgets richiede anche widgetsFile, il file .js della cartella public del modulo che li disegna",
      ccc: "widgets: il tipo ddd-uno non è valido: deve essere ccc-<nome> (minuscole, cifre e -)",
      model: "widgets: il tipo model-day è un tipo del core",
      eee: "widgets: eee-uno vuole data, un elenco da 1 a 4 percorsi /api/… (senza .., # né spazi, al più il segnaposto {from})",
      fff: "widgets: fff-uno: settings.metric è una chiave dei widget del core: usa title, range o un nome tuo",
      ggg: "widgets: ggg-uno: settings.source è una chiave dei widget del core: usa title, range o un nome tuo",
    };
    for (const [id, message] of Object.entries(expected)) {
      assert.ok(by[id].error instanceof Localized, id);
      assert.equal(by[id].error.message, message, id);
    }
    assert.match(inEnglish(() => errorText(by.model.error)), /^widgets: the type model-day is a core type$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("un tipo già dichiarato da un modulo precedente per id: error", async () => {
  // "a" and "a-b" can both build the type a-b-c: the first by id keeps it
  const core = tempModules({ a: `widgetsFile: "w.js", widgets: [${widgetText("a", "b-c")}]`, "a-b": `widgetsFile: "w.js", widgets: [${widgetText("a-b", "c")}]` });
  try {
    const by = Object.fromEntries((await discoverModules(core)).map((m) => [m.id, m]));
    assert.equal(by.a.error, undefined);
    assert.ok(by["a-b"].error instanceof Localized);
    assert.equal(by["a-b"].error.message, "widgets: il tipo a-b-c è già dichiarato dal modulo a");
    assert.equal(inEnglish(() => errorText(by["a-b"].error)), "widgets: the type a-b-c is already declared by the module a");
  } finally {
    fs.rmSync(core, { recursive: true, force: true });
  }
});

test("un tipo di un modulo interno già preso: quello dell'utente va in error", async () => {
  const core = tempModules({ a: `widgetsFile: "w.js", widgets: [${widgetText("a", "b-c")}]` });
  const user = tempModules({ "a-b": `widgetsFile: "w.js", widgets: [${widgetText("a-b", "c")}]` });
  try {
    const { found } = await discoverAll(core, { userDir: user });
    const beta = found.find((m) => m.id === "a-b");
    assert.equal(beta.origin, "user");
    assert.equal(beta.error.message, "widgets: il tipo a-b-c è già dichiarato dal modulo a");
  } finally {
    for (const d of [core, user]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("ModuleRegistry.list: widgets e widgetsFile del manifesto, [] e null senza", async () => {
  const widgets = [
    { type: "mio-uno", label: "Uno", description: "Il primo", size: [6, 4], min: [3, 3], home: "adesso", data: ["/api/mio/uno"] },
  ];
  const found = [withInstance("mio", {}, { widgetsFile: "widgets.js", widgets }), withInstance("nudo", {})];
  const reg = new ModuleRegistry({ found, enabled: [], log: fakeLog() });
  const by = Object.fromEntries(reg.list().map((m) => [m.id, m]));
  assert.deepEqual(by.mio.widgets, widgets, "off: the manifest's ones");
  assert.equal(by.mio.widgetsFile, "widgets.js");
  assert.deepEqual(by.nudo.widgets, []);
  assert.equal(by.nudo.widgetsFile, null);
});

test("start(): un widget che legge una route non sua è scartato con un avviso", async () => {
  const log = fakeLog();
  const ok = () => ({ ok: true });
  const w = (name, data) => ({ type: `mio-${name}`, label: name, description: name, size: [6, 4], min: [3, 3], home: "both", data });
  const widgets = [
    w("mia", ["/api/mio/mia"]), // its own exact route
    w("conquery", ["/api/mio/mia?from={from}", "/api/mio/sotto/qualcosa"]), // a query, {from}, and a path under its own prefix
    w("altrui", ["/api/mio/mia", "/api/altro/x"]), // one path of another module's
    w("nessuna", ["/api/mio/manca"]), // a route nobody has
    w("core", ["/api/status"]), // a core path: no module route
  ];
  const mio = withInstance("mio", { routes: { "GET /api/mio/mia": ok, "GET /api/mio/sotto/*": ok } }, { widgetsFile: "widgets.js", widgets });
  const altro = withInstance("altro", { routes: { "GET /api/altro/x": ok } });
  const reg = new ModuleRegistry({ found: [mio, altro], enabled: ["mio", "altro"], log });
  await reg.start(makeCtx);
  assert.deepEqual(reg.list().find((m) => m.id === "mio").widgets.map((x) => x.type), ["mio-mia", "mio-conquery"]);
  assert.deepEqual(log.lines.warn.sort(), [
    "[mio] widget mio-altrui: /api/altro/x non è una sua route GET, scartato",
    "[mio] widget mio-core: /api/status non è una sua route GET, scartato",
    "[mio] widget mio-nessuna: /api/mio/manca non è una sua route GET, scartato",
  ]);
  assert.deepEqual(reg.list().find((m) => m.id === "altro").widgets, []);
  // each dropped widget kept with the path that is not its module's GET route (R18)
  assert.deepEqual(
    reg.list().find((m) => m.id === "mio").droppedWidgets.map((x) => [x.type, x.dropped]),
    [
      ["mio-altrui", "/api/altro/x"],
      ["mio-nessuna", "/api/mio/manca"],
      ["mio-core", "/api/status"],
    ],
  );
  assert.deepEqual(reg.list().find((m) => m.id === "mio").droppedWidgets[0], { ...widgets[2], dropped: "/api/altro/x" }, "the whole entry, for the page's placeholder");
  assert.deepEqual(reg.list().find((m) => m.id === "altro").droppedWidgets, []);
});

test("list(): un modulo spento non ha droppedWidgets", async () => {
  const widgets = [{ type: "mio-a", label: "A", description: "A", size: [6, 4], min: [3, 3], home: "both", data: ["/api/mio/manca"] }];
  const reg = new ModuleRegistry({ found: [withInstance("mio", {}, { widgetsFile: "widgets.js", widgets })], enabled: [], log: fakeLog() });
  await reg.start(makeCtx);
  assert.deepEqual(reg.list()[0].droppedWidgets, []);
});

test("start(): i widget di un modulo spento o in error restano quelli del manifesto", async () => {
  const widgets = [{ type: "mio-a", label: "A", description: "A", size: [6, 4], min: [3, 3], home: "both", data: ["/api/mio/manca"] }];
  const log = fakeLog();
  const reg = new ModuleRegistry({ found: [withInstance("mio", {}, { widgetsFile: "widgets.js", widgets })], enabled: [], log });
  await reg.start(makeCtx);
  assert.deepEqual(reg.list()[0].widgets, widgets);
  assert.deepEqual(log.lines.warn, []);
});

// ---- checkUserModule: a user module judged without being activated ----

// the files whose top-level code the check runs: tables.js only for a module that declares tables
const W_SERVER = "a ogni controllo il codice di primo livello di module.js e server/index.js viene eseguito nel processo della lens; i file che server/index.js importa restano quelli caricati all'avvio";
const W_SERVER_TABLES = "a ogni controllo il codice di primo livello di module.js, tables.js e server/index.js viene eseguito nel processo della lens; i file che server/index.js importa restano quelli caricati all'avvio";
const W_ROUTES = "le route del modulo nascono in create() e non si controllano qui: una route già presa da un altro modulo si vede solo nel log all'avvio";
const W_DATA = "i percorsi nel campo data dei widget vengono verificati solo all'avvio";
const W_NEW = "il modulo non è ancora tra quelli scoperti: riavvia la lens";

/** What the server entries of the check tests record: every call that must never happen is a line in globalThis.__check. */
const checkCalls = () => (globalThis.__check ??= []);
const SERVER_OK = `
export function configure() { return { values: {}, errors: [] }; }
export function create() { (globalThis.__check ??= []).push("create"); throw new Error("create must not be called"); }
export function hasData() { (globalThis.__check ??= []).push("hasData"); return true; }
export function files() { (globalThis.__check ??= []).push("files"); return []; }
`;

/**
 * Module `id` in the user folder `root`: module.js with the minimal valid manifest (`lens`, plus the fields of `extra`)
 * and server/index.js with the text `server`; `tables` (when given) is tables.js and `files` other files by path.
 */
function writeUserModule(root, id, { lens = "0.1.0", extra = "", server = SERVER_OK, tables = null, files = {} } = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "module.js"),
    `export default { id: ${JSON.stringify(id)}, name: "Mio", description: "D", lens: ${JSON.stringify(lens)}, menu: { group: "dati", order: 90, icon: "" }, page: { title: "Mio" }, ${extra} server: () => import("./server/index.js") };\n`,
  );
  fs.writeFileSync(path.join(dir, "server", "index.js"), server);
  if (tables) fs.writeFileSync(path.join(dir, "tables.js"), tables);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const userRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "lens-check-user-"));
const texts = (list) => list.map((e) => e.message);

test("checkUserModule: modulo valido → ok, avviso di riavvio se non scoperto", async () => {
  checkCalls().length = 0;
  const userDir = userRoot();
  try {
    const moduleDir = writeUserModule(userDir, "mio-modulo");
    const r = await checkUserModule({ id: "mio-modulo", userDir, found: [] });
    assert.equal(r.ok, true);
    assert.equal(r.id, "mio-modulo");
    assert.equal(r.name, "Mio", "il nome del manifesto");
    assert.equal(r.dir, moduleDir);
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.every((w) => w instanceof Localized));
    assert.deepEqual(texts(r.warnings), [W_SERVER, W_ROUTES, W_NEW]);
    // discovered at startup: the standing warnings, and that a change needs a restart (R38)
    const { found } = await discoverAll(MODULES_DIR, { userDir, log: fakeLog() });
    assert.deepEqual(texts((await checkUserModule({ id: "mio-modulo", userDir, found })).warnings), [W_SERVER, W_ROUTES, "il modulo è già caricato: le modifiche valgono dopo un riavvio della lens"]);
    // the warnings follow the language of the request
    assert.equal(inEnglish(() => errorText(r.warnings[2])), "the module is not among the discovered ones yet: restart the lens");
    assert.equal(inEnglish(() => errorText(r.warnings[0])), "at every check the top-level code of module.js and server/index.js runs in the lens process; the files server/index.js imports stay the ones loaded at startup");
    assert.equal(inFrench(() => errorText(r.warnings[0])), "à chaque vérification, le code de premier niveau de module.js et server/index.js s'exécute dans le processus de la lens ; les fichiers que server/index.js importe restent ceux chargés au démarrage");
    assert.equal(inEnglish(() => errorText(r.warnings[1])), "the module's routes are born in create() and are not checked here: a route already taken by another module only shows in the startup log");
    assert.equal(inFrench(() => errorText(r.warnings[1])), "les routes du module naissent dans create() et ne sont pas vérifiées ici : une route déjà prise par un autre module ne se voit que dans le journal du démarrage");
    assert.deepEqual(checkCalls(), [], "neither create, nor hasData, nor files");
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: manifesto rotto → errori, nessun create", async () => {
  checkCalls().length = 0;
  const userDir = userRoot();
  try {
    writeUserModule(userDir, "rotto", { lens: "99.0.0" });
    const r = await checkUserModule({ id: "rotto", userDir, found: [], version: "0.50.0" });
    assert.equal(r.ok, false);
    assert.ok(r.errors[0] instanceof Localized);
    assert.equal(r.errors[0].message, "richiede la lens 99.0.0 o successiva (questa è la 0.50.0)");
    assert.equal(inEnglish(() => errorText(r.errors[0])), "requires lens 99.0.0 or later (this is 0.50.0)");
    assert.deepEqual(checkCalls(), []);
    // a module.js that does not even load
    fs.mkdirSync(path.join(userDir, "sintassi"));
    fs.writeFileSync(path.join(userDir, "sintassi", "module.js"), "export default {");
    const s = await checkUserModule({ id: "sintassi", userDir, found: [] });
    assert.equal(s.ok, false);
    assert.match(s.errors[0].message, /^manifesto non caricabile: /);
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: modulo corretto dopo un primo controllo: il secondo vede il module.js nuovo", async () => {
  const userDir = userRoot();
  try {
    const dir = writeUserModule(userDir, "mio", { lens: "99.0.0" });
    const first = await checkUserModule({ id: "mio", userDir, found: [], version: "0.50.0" });
    assert.equal(first.ok, false);
    // fixed on disk with another mtime, and its server changed: the second check reads both again
    fs.writeFileSync(path.join(dir, "module.js"), fs.readFileSync(path.join(dir, "module.js"), "utf8").replace("99.0.0", "0.1.0"));
    fs.writeFileSync(path.join(dir, "server", "index.js"), `export function configure() { return { values: {}, errors: ["manca la chiave"] }; }\nexport function create() { return {}; }\n`);
    const later = new Date(Date.now() + 5000);
    for (const f of ["module.js", path.join("server", "index.js")]) fs.utimesSync(path.join(dir, f), later, later);
    const second = await checkUserModule({ id: "mio", userDir, found: [], version: "0.50.0" });
    assert.deepEqual(texts(second.errors), ["manca la chiave"], "the new module.js and the new server/index.js");
    // and a third time, the file rewritten within the same mtime tick: still read again
    fs.writeFileSync(path.join(dir, "server", "index.js"), `export function create() { return {}; }\n`);
    fs.utimesSync(path.join(dir, "server", "index.js"), later, later);
    const third = await checkUserModule({ id: "mio", userDir, found: [], version: "0.50.0" });
    assert.equal(third.ok, true);
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: id ../x, a/b, Alfa → errore senza toccare il disco", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lens-check-id-"));
  try {
    const userDir = path.join(base, "user");
    fs.mkdirSync(userDir);
    // a module outside the user's folder that would leave a trace if it were imported
    fs.mkdirSync(path.join(base, "x"));
    fs.writeFileSync(path.join(base, "x", "module.js"), `(globalThis.__check ??= []).push("fuori"); export default {};\n`);
    checkCalls().length = 0;
    for (const id of ["../x", "a/b", "Alfa", "", "a b", "x\0", "-x", 5, null, undefined, { toString: () => "x" }]) {
      const r = await checkUserModule({ id, userDir, found: [] });
      assert.equal(r.ok, false, String(id));
      assert.deepEqual(texts(r.errors), ["id non valido"], String(id));
      assert.equal(r.dir, null);
      assert.deepEqual(r.warnings, []);
    }
    assert.deepEqual(checkCalls(), [], "nothing outside was imported");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("checkUserModule: cartella dell'utente assente, cartella del modulo assente, module.js assente", async () => {
  const userDir = userRoot();
  try {
    const none = await checkUserModule({ id: "mio", userDir: null, found: [] });
    assert.equal(none.ok, false);
    assert.equal(none.dir, null);
    assert.equal(none.errors.length, 1);
    const missing = await checkUserModule({ id: "mio", userDir, found: [] });
    assert.equal(missing.ok, false);
    assert.equal(missing.dir, path.join(userDir, "mio"));
    assert.equal(missing.errors[0].message, `nessuna cartella ${path.join(userDir, "mio")}`);
    assert.equal(inEnglish(() => errorText(missing.errors[0])), `no folder ${path.join(userDir, "mio")}`);
    fs.mkdirSync(path.join(userDir, "vuoto"));
    const empty = await checkUserModule({ id: "vuoto", userDir, found: [] });
    assert.equal(empty.errors[0].message, `nessun module.js in ${path.join(userDir, "vuoto")}`);
    // a file where the folder should be
    fs.writeFileSync(path.join(userDir, "file"), "x");
    assert.equal((await checkUserModule({ id: "file", userDir, found: [] })).errors[0].message, `nessuna cartella ${path.join(userDir, "file")}`);
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: l'id di un modulo interno è un errore, mai importato", async () => {
  checkCalls().length = 0;
  const userDir = userRoot();
  try {
    writeUserModule(userDir, "demo", { server: `(globalThis.__check ??= []).push("importato"); export function create() { return {}; }\n` });
    const { found } = await discoverAll(dir, { userDir, log: fakeLog() });
    const r = await checkUserModule({ id: "demo", userDir, found });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].message, `La cartella ${path.join(userDir, "demo")} ha l'id di un modulo della lens: rinominala`);
    assert.deepEqual(checkCalls(), []);
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: le variabili e i tipi di widget degli altri moduli sono occupati", async () => {
  const userDir = userRoot();
  try {
    const setting = (name) => `settings: [{ name: ${JSON.stringify(name)}, label: "x", help: "x", kind: "text" }],`;
    writeUserModule(userDir, "alfa", { extra: setting("LENS_DEMO_DIR") });
    const { found } = await discoverAll(dir, { userDir, log: fakeLog() });
    const r = await checkUserModule({ id: "alfa", userDir, found });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].message, "settings: LENS_DEMO_DIR è già dichiarata dal modulo demo");
    // a variable of another user module is taken only by the ones after it by id, as at startup
    writeUserModule(userDir, "beta", { extra: setting("LENS_COMUNE") });
    writeUserModule(userDir, "gamma", { extra: setting("LENS_COMUNE") });
    const both = (await discoverAll(MODULES_DIR, { userDir, log: fakeLog() })).found;
    assert.equal((await checkUserModule({ id: "beta", userDir, found: both })).ok, true);
    assert.equal((await checkUserModule({ id: "gamma", userDir, found: both })).errors[0].message, "settings: LENS_COMUNE è già dichiarata dal modulo beta");
    // widget types
    const widgets = (id, name) => `widgetsFile: "widgets.js", widgets: [${widgetText(id, name)}],`;
    writeUserModule(userDir, "w", { extra: widgets("w", "b-c") });
    writeUserModule(userDir, "w-b", { extra: widgets("w-b", "c") });
    const typed = (await discoverAll(MODULES_DIR, { userDir, log: fakeLog() })).found;
    assert.equal((await checkUserModule({ id: "w-b", userDir, found: typed })).errors[0].message, "widgets: il tipo w-b-c è già dichiarato dal modulo w");
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

const W_LOADED = "il modulo è già caricato: le modifiche valgono dopo un riavvio della lens";
const laterClash = (name, id) => `${name} è già del modulo ${id}: al riavvio quel modulo andrebbe in errore`;
const setting = (name) => `settings: [{ name: ${JSON.stringify(name)}, label: "x", help: "x", kind: "text" }],`;
const tools = (...names) => `mcp: () => import("./mcp/index.js"), mcpTools: ${JSON.stringify(names)},`;

test("checkUserModule: una variabile o un tipo di widget di un modulo dopo per id è un avviso (R38)", async () => {
  const userDir = userRoot();
  try {
    // gamma is there at startup; beta, written now, comes before it by id and declares the same variable
    writeUserModule(userDir, "gamma", { extra: setting("LENS_COMUNE") });
    const { found } = await discoverAll(MODULES_DIR, { userDir, log: fakeLog() });
    writeUserModule(userDir, "beta", { extra: setting("LENS_COMUNE") });
    const beta = await checkUserModule({ id: "beta", userDir, found });
    assert.equal(beta.ok, true, "all'avvio beta prende la variabile: non è un errore di beta");
    assert.ok(texts(beta.warnings).includes(laterClash("LENS_COMUNE", "gamma")), texts(beta.warnings).join("\n"));
    assert.ok(inEnglish(() => beta.warnings.map(errorText)).includes("LENS_COMUNE already belongs to the module gamma: at the restart that module would go to error"));
    assert.ok(inFrench(() => beta.warnings.map(errorText)).includes("LENS_COMUNE appartient déjà au module gamma : au redémarrage ce module passerait en erreur"));
    // widget types: w-b is there, w (before it) declares w-b-c too
    writeUserModule(userDir, "w-b", { extra: `widgetsFile: "widgets.js", widgets: [${widgetText("w-b", "c")}],` });
    const typed = (await discoverAll(MODULES_DIR, { userDir, log: fakeLog() })).found;
    writeUserModule(userDir, "w", { extra: `widgetsFile: "widgets.js", widgets: [${widgetText("w", "b-c")}],` });
    const w = await checkUserModule({ id: "w", userDir, found: typed });
    assert.equal(w.ok, true);
    assert.ok(texts(w.warnings).includes(laterClash("w-b-c", "w-b")), texts(w.warnings).join("\n"));
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: mcpTools contro gli strumenti del core e degli altri moduli (R38)", async () => {
  const userDir = userRoot();
  try {
    // a core tool name: an error, the core always wins
    writeUserModule(userDir, "nucleo", { extra: tools("usage") });
    const core = await checkUserModule({ id: "nucleo", userDir, found: [] });
    assert.equal(core.ok, false);
    assert.deepEqual(texts(core.errors), ["il nome dello strumento usage è del core"]);
    assert.equal(inEnglish(() => errorText(core.errors[0])), "the tool name usage belongs to the core");
    assert.equal(inFrench(() => errorText(core.errors[0])), "le nom d'outil usage appartient au cœur");
    // t1 and t2 both declare «uno»: the one earlier by id holds it
    writeUserModule(userDir, "t1", { extra: tools("uno") });
    writeUserModule(userDir, "t2", { extra: tools("uno", "due") });
    const { found } = await discoverAll(MODULES_DIR, { userDir, log: fakeLog() });
    const t2 = await checkUserModule({ id: "t2", userDir, found });
    assert.equal(t2.ok, false);
    assert.deepEqual(texts(t2.errors), ["mcpTools: uno è già dichiarato dal modulo t1"]);
    assert.equal(inEnglish(() => errorText(t2.errors[0])), "mcpTools: uno is already declared by the module t1");
    assert.equal(inFrench(() => errorText(t2.errors[0])), "mcpTools : uno est déjà déclaré par le module t1");
    // the other way round: t1 keeps «uno» at the restart, and t2 is not in error for it: the MCP process drops t2's tool
    const t1 = await checkUserModule({ id: "t1", userDir, found });
    assert.equal(t1.ok, true);
    assert.ok(texts(t1.warnings).includes("uno è già del modulo t2: al riavvio quel modulo perderebbe lo strumento"), texts(t1.warnings).join("\n"));
    assert.ok(inEnglish(() => t1.warnings.map(errorText)).includes("uno already belongs to the module t2: at the restart that module would lose the tool"));
    assert.ok(inFrench(() => t1.warnings.map(errorText)).includes("uno appartient déjà au module t2 : au redémarrage ce module perdrait l'outil"));
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: un modulo già caricato avvisa che le modifiche valgono dopo un riavvio (R38)", async () => {
  const userDir = userRoot();
  try {
    writeUserModule(userDir, "mio");
    const { found } = await discoverAll(MODULES_DIR, { userDir, log: fakeLog() });
    const r = await checkUserModule({ id: "mio", userDir, found });
    assert.deepEqual(texts(r.warnings), [W_SERVER, W_ROUTES, W_LOADED]);
    assert.equal(inEnglish(() => errorText(r.warnings[2])), "the module is already loaded: the changes apply after a restart of the lens");
    assert.equal(inFrench(() => errorText(r.warnings[2])), "le module est déjà chargé : les modifications s'appliquent après un redémarrage de la lens");
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: tables.js non valido e configure() con errori vanno negli errori", async () => {
  checkCalls().length = 0;
  const userDir = userRoot();
  try {
    writeUserModule(userDir, "tab", { extra: `tables: () => import("./tables.js"),`, tables: `export default { version: 1, sql: "DROP TABLE x" };\n` });
    const bad = await checkUserModule({ id: "tab", userDir, found: [] });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.length >= 1);
    assert.ok(bad.errors.every((e) => e instanceof Localized));
    writeUserModule(userDir, "tab-ok", { extra: `tables: () => import("./tables.js"),`, tables: `export default { version: 1, sql: "CREATE TABLE IF NOT EXISTS tabok_a (id INTEGER PRIMARY KEY)" };\n` });
    // the id "tab-ok" is no valid table prefix: refused with the reason of checkModuleTables
    assert.equal((await checkUserModule({ id: "tab-ok", userDir, found: [] })).ok, false);
    writeUserModule(userDir, "tabok", { extra: `tables: () => import("./tables.js"),`, tables: `export default { version: 1, sql: "CREATE TABLE IF NOT EXISTS tabok_a (id INTEGER PRIMARY KEY)" };\n` });
    const tabok = await checkUserModule({ id: "tabok", userDir, found: [] });
    assert.equal(tabok.ok, true);
    // a module with tables: the warning names tables.js too, whose top-level code the check runs as well
    assert.equal(texts(tabok.warnings)[0], W_SERVER_TABLES);
    assert.equal(inEnglish(() => errorText(tabok.warnings[0])), "at every check the top-level code of module.js, tables.js and server/index.js runs in the lens process; the files server/index.js imports stay the ones loaded at startup");
    // a tables.js that does not load
    writeUserModule(userDir, "tabx", { extra: `tables: () => import("./tables.js"),`, tables: "export default {" });
    assert.match((await checkUserModule({ id: "tabx", userDir, found: [] })).errors[0].message, /^tabelle non caricabili: /);
    // configure() errors, a bare string or a Localized; and one that throws
    const conf = (body) => `export function create() { return {}; }\nexport function configure(ctx) { ${body} }\n`;
    writeUserModule(userDir, "conf", { server: conf(`return { values: {}, errors: ["manca la chiave"] };`) });
    assert.deepEqual(texts((await checkUserModule({ id: "conf", userDir, found: [] })).errors), ["manca la chiave"]);
    writeUserModule(userDir, "confx", { server: conf(`throw new Error("rotto");`) });
    assert.deepEqual(texts((await checkUserModule({ id: "confx", userDir, found: [] })).errors), ["impostazioni non verificabili: rotto"]);
    // configure() sees the env it is given, only the variables the module declares
    writeUserModule(userDir, "confe", {
      extra: `settings: [{ name: "LENS_CONFE_KEY", label: "x", help: "x", kind: "text" }],`,
      server: conf(`return { values: {}, errors: ctx.env.LENS_CONFE_KEY ? [] : ["chiave vuota"] };`),
    });
    assert.deepEqual(texts((await checkUserModule({ id: "confe", userDir, found: [], env: {} })).errors), ["chiave vuota"]);
    assert.equal((await checkUserModule({ id: "confe", userDir, found: [], env: { LENS_CONFE_KEY: "k" } })).ok, true);
    // a server/index.js without create(), or that does not load
    writeUserModule(userDir, "nocreate", { server: "export const x = 1;\n" });
    assert.equal((await checkUserModule({ id: "nocreate", userDir, found: [] })).errors[0].message, "server/index.js deve esportare create(ctx)");
    writeUserModule(userDir, "noload", { server: "export default {" });
    assert.match((await checkUserModule({ id: "noload", userDir, found: [] })).errors[0].message, /^server\/index\.js non caricabile: /);
    assert.deepEqual(checkCalls(), []);
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: avvisi dei widget — percorsi data, widgetsFile mancante, prefissi dei tipi", async () => {
  const userDir = userRoot();
  try {
    const widgets = (id, ...names) => `widgetsFile: "widgets.js", widgets: [${names.map((n) => widgetText(id, n)).join(", ")}],`;
    writeUserModule(userDir, "foo", { extra: widgets("foo", "bar-x") });
    const noFile = await checkUserModule({ id: "foo", userDir, found: [] });
    assert.equal(noFile.ok, true);
    assert.deepEqual(texts(noFile.warnings), [W_SERVER, W_ROUTES, W_NEW, "widgetsFile widgets.js non c'è nella cartella public del modulo", W_DATA]);
    assert.equal(inEnglish(() => errorText(noFile.warnings.at(-1))), "the paths in the widgets' data field are verified only at startup");
    assert.equal(inFrench(() => errorText(noFile.warnings.at(-1))), "les chemins du champ data des widgets ne sont vérifiés qu'au démarrage");
    // with the file in place the warning about it goes
    writeUserModule(userDir, "foo", { extra: widgets("foo", "bar-x"), files: { "public/widgets.js": "export default {};\n" } });
    assert.ok(!texts((await checkUserModule({ id: "foo", userDir, found: [] })).warnings).some((w) => w.startsWith("widgetsFile")));
    // module foo declares foo-bar-x and module foo-bar exists: the type starts with that module's id
    writeUserModule(userDir, "foo-bar", {});
    const { found } = await discoverAll(MODULES_DIR, { userDir, log: fakeLog() });
    const mine = await checkUserModule({ id: "foo", userDir, found });
    assert.ok(texts(mine.warnings).includes("il tipo foo-bar-x comincia con l'id del modulo foo-bar: i widget dei due moduli potrebbero confondersi"));
    assert.ok(inEnglish(() => mine.warnings.map(errorText)).includes("the type foo-bar-x starts with the id of the module foo-bar: the two modules' widgets could be confused"));
    assert.ok(inFrench(() => mine.warnings.map(errorText)).includes("le type foo-bar-x commence par l'id du module foo-bar : les widgets des deux modules pourraient être confondus"));
    // and the other way round: foo-bar is checked while foo declares a type that starts with its id
    const theirs = await checkUserModule({ id: "foo-bar", userDir, found });
    assert.ok(texts(theirs.warnings).includes("il modulo foo dichiara il tipo foo-bar-x, che comincia con l'id di questo modulo: i widget dei due moduli potrebbero confondersi"));
    assert.ok(inEnglish(() => theirs.warnings.map(errorText)).includes("the module foo declares the type foo-bar-x, which starts with the id of this module: the two modules' widgets could be confused"));
    assert.ok(inFrench(() => theirs.warnings.map(errorText)).includes("le module foo déclare le type foo-bar-x, qui commence par l'id de ce module : les widgets des deux modules pourraient être confondus"));
    // no widgets, no widget warnings
    const plain = await checkUserModule({ id: "foo-bar", userDir, found: [] });
    assert.ok(!texts(plain.warnings).some((w) => w.includes("widget")));
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("checkUserModule: un modulo scoperto ma in errore all'avvio, ora corretto, chiede il riavvio", async () => {
  const userDir = userRoot();
  try {
    const dir = writeUserModule(userDir, "mio", { lens: "99.0.0" });
    const { found } = await discoverAll(MODULES_DIR, { userDir, log: fakeLog() });
    assert.ok(found.find((f) => f.id === "mio").error);
    fs.writeFileSync(path.join(dir, "module.js"), fs.readFileSync(path.join(dir, "module.js"), "utf8").replace("99.0.0", "0.1.0"));
    const r = await checkUserModule({ id: "mio", userDir, found });
    assert.equal(r.ok, true);
    assert.deepEqual(texts(r.warnings), [W_SERVER, W_ROUTES, "all'avvio della lens questo modulo non si era caricato: riavvia la lens per usarlo"]);
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
