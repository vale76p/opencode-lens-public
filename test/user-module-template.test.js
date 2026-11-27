// End to end: the example module (extras/module-template) installed as a user module, in a temporary data folder, on a
// real lens (real Store on a file, real registry and server). Then a simulated update of the app, which must not touch
// the user's modules, and the module's own tests run with the test kit the updated app carries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, userModulesDir } from "../src/config.js";
import { createServer } from "../src/server.js";
import { Queries } from "../src/queries.js";
import { setLogLevel } from "../src/log.js";
import { addCatalogs } from "../src/i18n-request.js";
import { checkUserModule, discoverAll, ModuleRegistry } from "../src/modules.js";
import { moduleContext } from "../src/module-kit.js";
import { Store } from "../src/store.js";

setLogLevel("error");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "extras", "module-template");
const ID = "mio-modulo";

const quiet = { info() {}, warn() {}, error() {} };
const collector = {
  state: "connected",
  status: () => ({ state: "connected", server: null, lastError: null, lastEventAt: null, connectedAt: null, eventsSeen: 0, scan: {}, drift: [] }),
};

const request = (port, { path: p = "/healthz", method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
const json = async (port, p, opts) => JSON.parse((await request(port, { path: p, ...opts })).body);

/** A temporary data folder with the template copied to modules/mio-modulo, removed after `fn(dir)`. */
async function withDataFolder(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-user-template-"));
  try {
    fs.cpSync(TEMPLATE, path.join(dir, "modules", ID), { recursive: true });
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A lens as src/main.js starts it, on `<dir>/lens.db`, with the modules of `<dir>/modules` found next to an empty
 * built-in folder; `modules` is LENS_MODULES. If a step throws, what was already opened (store, modules, server) is
 * closed before the error goes on, so a failed start leaves no database open nor port listening.
 */
async function startLens(dir, modules) {
  // how to close what is open, in the order it was opened: closed the other way round
  const opened = [];
  const close = async () => {
    for (const fn of opened.splice(0).reverse()) await fn();
  };
  try {
    const env = { LENS_PORT: "0", LENS_DB: path.join(dir, "lens.db"), LENS_MODULES: modules };
    const { found, shadowed } = await discoverAll(path.join(dir, "no-builtin"), { userDir: userModulesDir(env), log: quiet });
    const config = loadConfig(env);
    const userDir = userModulesDir(env);
    assert.equal(userDir, path.join(dir, "modules"), "the user's modules sit next to the database");
    const registry = new ModuleRegistry({ found, shadowed, enabled: config.modules, log: quiet, env });
    const moduleTables = await registry.tables();
    const store = new Store(config.dbPath, { moduleTables });
    opened.push(() => store.close());
    registry.tableErrors(store.moduleTableErrors);
    addCatalogs({ en: await registry.catalogs("en"), fr: await registry.catalogs("fr") });
    const queries = new Queries(store);
    const makeCtx = (id, extra) => moduleContext({ id, config, store, collector, queries, log: quiet, ...extra });
    // stopped also after a start that threw halfway: the modules it did start get their stop()
    opened.push(() => registry.stop());
    await registry.start(makeCtx);
    await registry.notices(makeCtx, store);
    const moduleFiles = await registry.files(makeCtx);
    const checkModule = (id) => checkUserModule({ id, userDir, found, env, dbPath: config.dbPath });
    const server = createServer({ config, store, queries, collector, modules: registry, moduleFiles, userDir, checkModule });
    const addr = await server.listen();
    opened.push(() => server.close());
    config.allowedHosts.add(`127.0.0.1:${addr.port}`);
    return { port: addr.port, close };
  } catch (err) {
    await close();
    throw err;
  }
}

async function withLens(dir, modules, fn) {
  const lens = await startLens(dir, modules);
  try {
    await fn(lens);
  } finally {
    await lens.close();
  }
}

/** Every file under `dir` (relative path → sha256), to tell an untouched folder from a changed one. */
function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

test("il modulo d'esempio come modulo dell'utente: acceso, con route, pagina, widget e controllo", async () => {
  await withDataFolder(async (dir) => {
    await withLens(dir, ID, async ({ port }) => {
      const { modules, userDir } = await json(port, "/api/modules");
      assert.equal(userDir, path.join(dir, "modules"));
      const mine = modules.find((m) => m.id === ID);
      assert.equal(mine.state, "on");
      assert.equal(mine.origin, "user");
      assert.equal(mine.dir, path.join(dir, "modules", ID));

      // the route: empty at first (the note of the setting is not set), then a note written and read back
      const empty = await request(port, { path: `/api/${ID}?from=0` });
      assert.equal(empty.status, 200);
      assert.equal(JSON.parse(empty.body).count, 0);
      const write = await request(port, { path: `/api/${ID}`, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "una nota" }) });
      assert.equal(write.status, 200, write.body);
      assert.equal(JSON.parse((await request(port, { path: `/api/${ID}?from=0` })).body).last.text, "una nota");
      assert.ok(fs.existsSync(path.join(dir, `${ID}.json`)), "the notes are a file next to the database");

      // the page's script, served from the module's own public/
      const page = await request(port, { path: `/modules/${ID}/page.js` });
      assert.equal(page.status, 200);
      assert.match(page.body, /export/);
      assert.equal((await request(port, { path: `/modules/${ID}/widgets.js` })).status, 200, "and the widgets file");

      // the page of the dashboard carries the widget in the JSON tag (the Italian source texts: no x-lens-lang header)
      const html = await request(port, { path: "/" });
      assert.equal(html.status, 200);
      const tag = /<script type="application\/json" id="lens-module-widgets">(.*?)<\/script>/s.exec(html.body);
      assert.ok(tag, "the widgets tag is in the page");
      const entry = JSON.parse(tag[1]).find((m) => m.id === ID);
      assert.equal(entry.state, "on");
      assert.deepEqual(entry.types.map((w) => w.type), [`${ID}-conteggio`]);
      assert.match(html.body, new RegExp(`data-page="${ID}"`));

      // the check, as the dashboard and the MCP tool call it
      const check = JSON.parse((await request(port, { path: "/api/modules/check", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ID }) })).body);
      assert.equal(check.ok, true, JSON.stringify(check));
      assert.deepEqual(check.errors, []);
      assert.equal(check.dir, path.join(dir, "modules", ID));
    });
  });
});

test("senza LENS_MODULES il modulo d'esempio è trovato ma spento: nessuna route, widget solo nell'elenco", async () => {
  await withDataFolder(async (dir) => {
    await withLens(dir, "", async ({ port }) => {
      const mine = (await json(port, "/api/modules")).modules.find((m) => m.id === ID);
      assert.equal(mine.state, "off");
      assert.equal(mine.origin, "user");
      assert.equal((await request(port, { path: `/api/${ID}` })).status, 404);
      assert.doesNotMatch((await request(port, { path: "/" })).body, new RegExp(`data-page="${ID}"`));
    });
  });
});

test("aggiornamento simulato: la cartella dell'app si rifà come fa install.sh, i moduli dell'utente restano com'erano e i suoi test girano col test kit dell'app nuova", async () => {
  await withDataFolder(async (dir) => {
    const modules = path.join(dir, "modules");
    // a note in the data folder too: that is the user's, it must survive as well
    await withLens(dir, ID, async ({ port }) => {
      const r = await request(port, { path: `/api/${ID}`, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "resta" }) });
      assert.equal(r.status, 200, r.body);
    });
    const before = { modules: tree(modules), data: tree(dir) };
    assert.ok(Object.keys(before.modules).length >= 5, "the module's files are there");

    // install.sh: stage next to the app, copy the FILES list, keep the private Node, rm -rf the app, move the stage in
    const files = /^FILES=\((.*)\)$/m.exec(fs.readFileSync(path.join(ROOT, "install.sh"), "utf8"))[1].split(/\s+/);
    const applications = path.join(dir, "Applications");
    const app = path.join(applications, "opencode-lens");
    fs.mkdirSync(path.join(app, "node"), { recursive: true });
    fs.writeFileSync(path.join(app, "node", "marker"), "node");
    fs.mkdirSync(path.join(app, "src"), { recursive: true });
    fs.writeFileSync(path.join(app, "src", "stale.js"), "// from the old version\n");
    const stage = fs.mkdtempSync(path.join(applications, ".opencode-lens."));
    for (const f of files) {
      if (!fs.existsSync(path.join(ROOT, f))) continue;
      fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
      fs.cpSync(path.join(ROOT, f), path.join(stage, f), { recursive: true });
    }
    fs.renameSync(path.join(app, "node"), path.join(stage, "node"));
    fs.rmSync(app, { recursive: true, force: true });
    fs.renameSync(stage, app);

    assert.equal(fs.existsSync(path.join(app, "src", "stale.js")), false, "the old app is gone");
    assert.equal(fs.readFileSync(path.join(app, "node", "marker"), "utf8"), "node");
    assert.deepEqual(tree(modules), before.modules, "the user's modules are untouched");
    const after = tree(dir);
    assert.ok(Object.hasOwn(before.data, `${ID}.json`), "the note file was written");
    for (const [rel, hash] of Object.entries(before.data)) assert.equal(after[rel], hash, `${rel} is untouched`);

    // the updated app carries the test kit, and the module's tests run on it from where the module is
    for (const f of ["test/module-test-kit.js", "test/module-hooks.mjs", "test/helpers.js", "test/query-plan-check.js"]) assert.ok(fs.existsSync(path.join(app, f)), `${f} is in the updated app`);
    // the reporter is named: its default changes with the Node version (tap on 22 without a TTY, spec on newer ones)
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", path.join(app, "test", "module-hooks.mjs"), "--test", "--test-reporter=tap", path.join(modules, ID, "test", "template.test.js")], {
      cwd: dir,
      encoding: "utf8",
      // a hung child must fail this test, not the whole run
      timeout: 60_000,
      // under `node --test` this variable makes a child report to its parent in a binary format instead of printing
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /^# fail 0$/m);
    assert.match(run.stdout, /^# pass [1-9]/m);
  });
});
