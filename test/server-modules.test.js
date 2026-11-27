import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { CORE_PATHS } from "../src/core-paths.js";
import { VERSION } from "../src/version.js";
import { Queries } from "../src/queries.js";
import { setLogLevel } from "../src/log.js";
import { addCatalogs } from "../src/i18n-request.js";
import { checkUserModule, discoverAll, discoverModules, ModuleRegistry } from "../src/modules.js";
import { Settings } from "../src/settings.js";
import { moduleContext } from "../src/module-kit.js";
import { openSource } from "../src/source-views.js";
import { OtlpExporter } from "../src/otlp.js";
import { SECRET, writeFakeBob } from "../modules/bob/test/fake-bob.js";
import { addPrompt, addSession, addStep, fileStore, makeZip, memoryStore, tokens } from "./helpers.js";
import { behave, resetCalls, saved, seen, uploads } from "./fixtures/modules/demo/server/index.js";

setLogLevel("error");

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "modules");
const LENS_VARS = ["LENS_LANG", "LENS_LOCALE", "LENS_HOST", "LENS_PORT", "LENS_TOKEN", "LENS_ALLOWED_HOSTS", "LENS_DB", "LENS_MODULES", "LENS_DEMO_LIMIT", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_URL"];

function withEnv(vars, fn) {
  const saved = Object.fromEntries(LENS_VARS.map((k) => [k, process.env[k]]));
  for (const k of LENS_VARS) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const fakeCollector = {
  state: "connected",
  status: () => ({ state: "connected", server: null, lastError: null, lastEventAt: null, connectedAt: null, eventsSeen: 0, scan: {}, drift: [] }),
};
const quiet = { info() {}, warn() {}, error() {} };

// a module that claims a core path: it must never answer in the core's place
const ombra = {
  id: "ombra",
  dir: path.join(FIXTURES, "ombra"),
  manifest: {
    id: "ombra",
    name: "Ombra",
    description: "Modulo che dichiara una route del core",
    lens: "0.1.0",
    menu: { group: "dati", order: 80, icon: "" },
    page: { title: "Ombra" },
    server: async () => ({ create: () => ({ routes: ombraRoutes }) }),
  },
};
// what ombra declares: every one touches a core path, so the registry drops them all with a warning
const ombraCalls = [];
const ombraRoutes = {
  "GET /api/status": () => ({ ombra: true }),
  "POST /api/status": {
    handler: () => {
      ombraCalls.push("POST /api/status");
      return { ombra: true };
    },
    body: { type: "json", max: 1024 },
    what: "lo stato",
  },
  "GET /api/mcp/*": () => {
    ombraCalls.push("GET /api/mcp/*");
    return { ombra: true };
  },
};

// where the modules' defaults point (Security: OpenCode's data and config folders), never this computer's real ones
const NO_XDG = path.join(os.tmpdir(), "lens-server-modules-assente");

/**
 * A lens with the fixture modules (and ombra, and `more`), or with the real modules/ when `real` is set. `file`: the
 * database on a file of its own, so a module's source opens (src/source-views.js); `seed(store)` writes before the start.
 * `userDir`: the folder of the user's own modules, found after the fixtures as src/main.js does.
 */
async function startLens(modules, { real = false, env = {}, settings = null, log = quiet, file = false, seed = null, more = [], userDir = null, checkModule = null } = {}) {
  const config = withEnv({ LENS_PORT: "0", LENS_DB: ":memory:", LENS_MODULES: modules, ...env }, loadConfig);
  let found, shadowed;
  if (real) found = await discoverModules();
  else if (userDir) ({ found, shadowed } = await discoverAll(FIXTURES, { userDir, log: quiet }));
  else found = await discoverModules(FIXTURES);
  if (!real) found = [...found, ombra, ...more];
  // the modules read their variables from this environment, as from the lens's at startup
  const moduleEnv = { ...process.env, XDG_DATA_HOME: NO_XDG, XDG_CONFIG_HOME: NO_XDG, LENS_SECURITY_DIRS: "", LENS_SECURITY_CONFIG_DIR: "", ...env };
  const registry = new ModuleRegistry({ found, shadowed, enabled: config.modules, log, env: moduleEnv });
  // as in src/main.js: the modules' tables before the Store, the ones it could not create back to the registry
  const moduleTables = await registry.tables();
  const store = file ? fileStore({ moduleTables }) : memoryStore({ moduleTables });
  if (file) config.dbPath = store.dbPath;
  registry.tableErrors(store.moduleTableErrors);
  seed?.(store);
  addCatalogs({ en: await registry.catalogs("en"), fr: await registry.catalogs("fr") });
  const queries = new Queries(store);
  // `extra`: what the registry adds for the module (its environment, variables and settings), as in src/main.js
  const makeCtx = (id, extra) => moduleContext({ id, config, store, collector: fakeCollector, queries, log: quiet, ...extra });
  await registry.start(makeCtx);
  // as in src/main.js: the source of the active modules, none in memory
  const source = await openSource({ registry, dbPath: config.dbPath, options: {} });
  await registry.notices(makeCtx, store);
  const moduleFiles = await registry.files(makeCtx);
  const server = createServer({ config, store, queries, collector: fakeCollector, modules: registry, settings, moduleFiles, source, userDir, checkModule });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  return {
    config,
    store,
    registry,
    queries,
    port: addr.port,
    async close() {
      server.close();
      await registry.stop();
      source?.views.close();
      store.close();
    },
  };
}

function request(port, { path = "/healthz", method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function withLens(modules, fn, opts) {
  const lens = await startLens(modules, opts);
  try {
    await fn(lens);
  } finally {
    await lens.close();
  }
}

test("GET / e /index.html: la voce del modulo solo quando è attivo", async () => {
  await withLens("demo", async ({ port }) => {
    for (const p of ["/", "/index.html"]) {
      const r = await request(port, { path: p });
      assert.equal(r.status, 200);
      assert.match(r.body, /data-page="demo"/);
      assert.match(r.body, /<meta name="lens-modules" content="demo">/);
      assert.match(r.body, /<section class="demo">/);
      assert.match(r.headers["content-security-policy"], /script-src 'self'/);
      assert.doesNotMatch(r.body, /lens:modules/);
    }
  });
  await withLens("", async ({ port }) => {
    for (const p of ["/", "/index.html"]) {
      const r = await request(port, { path: p });
      assert.doesNotMatch(r.body, /data-page="demo"|lens-modules|lens:modules/);
    }
  });
});

test("tabelle dei moduli: quelle della demo ci sono anche a modulo spento, e la demo resta spenta", async () => {
  await withLens("", async ({ port, store }) => {
    const names = store.db.prepare("SELECT name FROM sqlite_schema WHERE tbl_name = 'demo_items' ORDER BY name").all().map((r) => r.name);
    assert.deepEqual(names, ["demo_items", "demo_items_at", "sqlite_autoindex_demo_items_1"]);
    assert.equal(store.meta("module:demo:schema"), "2");
    const demo = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "demo");
    assert.equal(demo.state, "off");
  });
});

test("route di modulo: GET/HEAD 200 da attivo, 404 da spento; POST 405", async () => {
  await withLens("demo", async ({ port }) => {
    const r = await request(port, { path: "/api/demo" });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { demo: true });
    assert.equal((await request(port, { path: "/api/demo", method: "HEAD" })).status, 200);
    assert.equal((await request(port, { path: "/api/demo", method: "POST" })).status, 405);
  });
  await withLens("", async ({ port }) => {
    assert.equal((await request(port, { path: "/api/demo" })).status, 404);
    assert.equal((await request(port, { path: "/api/demo", method: "HEAD" })).status, 404);
  });
});

/** console.error lines written while `fn` runs (where src/log.js sends errors), kept off the test output. */
async function capturingErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test("POST di un modulo: JSON valido → l'handler riceve il corpo, 200", async () => {
  resetCalls();
  await withLens("demo", async ({ port }) => {
    const r = await request(port, { path: "/api/demo-save", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true, local: true });
    assert.equal(r.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(r.headers["cache-control"], "no-store");
    assert.deepEqual(saved, [{ a: 1 }]);
  });
});

test("un modulo con tabelle scrive con ctx.writer sulle sue e avvisa la dashboard con ctx.live", async () => {
  resetCalls();
  await withLens("demo", async ({ port, store }) => {
    assert.deepEqual({ writer: seen.create.writer, feed: seen.create.feed }, { writer: "function", feed: "function" }, "tables and a source in the manifest");
    const changes = [];
    store.onChange((kind, item) => changes.push([kind, item]));
    const post = (item) => request(port, { path: "/api/demo-item", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
    assert.deepEqual(JSON.parse((await post({ id: "item:1", name: "uno", created: 1000 })).body), { n: 1 });
    assert.deepEqual(JSON.parse((await post({ id: "item:1", name: "primo", created: 5, ended: 2000 })).body), { n: 1 }, "an upsert: the same row");
    assert.deepEqual(JSON.parse((await post({ id: "item:2", name: "due", created: 3000 })).body), { n: 2 });
    assert.deepEqual(JSON.parse((await request(port, { path: "/api/demo-items" })).body).items, [
      { id: "item:1", name: "primo", created: 1000, ended: 2000 },
      { id: "item:2", name: "due", created: 3000, ended: null },
    ]);
    assert.deepEqual(changes, [
      ["demo", { n: 1 }],
      ["demo", { n: 1 }],
      ["demo", { n: 2 }],
    ]);
  });
});

test("POST di un modulo: rifiutata come le scritture JSON del core, l'handler non è chiamato", async () => {
  resetCalls();
  await withLens("demo", async ({ port }) => {
    const post = (body, headers = {}) => request(port, { path: "/api/demo-save", method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    const core = (body, headers = {}) => request(port, { path: "/api/modules/notice", method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    const ok = JSON.stringify({ a: 1 });
    const proxied = await post(ok, { "x-forwarded-for": "10.0.0.2" });
    assert.equal(proxied.status, (await core(ok, { "x-forwarded-for": "10.0.0.2" })).status);
    assert.equal(proxied.status, 403);
    assert.deepEqual(JSON.parse(proxied.body), { errors: ["i dati della demo non si modificano attraverso un proxy: collegati direttamente da questo computer"] });
    const foreign = await post(ok, { origin: "http://evil.example" });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.status, (await core(ok, { origin: "http://evil.example" })).status);
    const plain = await request(port, { path: "/api/demo-save", method: "POST", headers: { "content-type": "text/plain" }, body: ok });
    assert.equal(plain.status, 415);
    assert.equal(plain.body, (await request(port, { path: "/api/modules/notice", method: "POST", headers: { "content-type": "text/plain" }, body: ok })).body);
    const big = await post(JSON.stringify({ a: "x".repeat(2000) }));
    assert.equal(big.status, 413, "oltre il max dichiarato (1 KiB)");
    assert.equal((await post("{")).status, 400);
    assert.deepEqual(saved, []);
  });
});

test("POST di un modulo: senza token (con LENS_TOKEN) → 401, col token → 200", async () => {
  resetCalls();
  await withLens(
    "demo",
    async ({ port }) => {
      const headers = { "content-type": "application/json" };
      const body = JSON.stringify({ a: 1 });
      assert.equal((await request(port, { path: "/api/demo-save", method: "POST", headers, body })).status, 401);
      assert.deepEqual(saved, []);
      const r = await request(port, { path: "/api/demo-save", method: "POST", headers: { ...headers, authorization: "Bearer segreto-di-prova" }, body });
      assert.equal(r.status, 200);
      assert.deepEqual(saved, [{ a: 1 }]);
    },
    { env: { LENS_TOKEN: "segreto-di-prova" } },
  );
});

test("senza token (con LENS_TOKEN) un metodo sbagliato su un percorso di un modulo acceso risponde come su uno inesistente: 401, non 405", async () => {
  await withLens(
    "demo",
    async ({ port }) => {
      for (const p of ["/api/demo", "/api/demo-save", "/api/demo/items/abc", "/api/inesistente"]) {
        const r = await request(port, { path: p, method: "PUT" });
        assert.equal(r.status, 401, p);
        assert.equal(r.headers.allow, undefined, p);
      }
      // the core's own paths keep their 405 before the token
      assert.equal((await request(port, { path: "/api/status", method: "PUT" })).status, 405);
      // with the token, a module's path is a 405 again and a path nobody serves a 404
      const auth = { authorization: "Bearer segreto-di-prova" };
      const save = await request(port, { path: "/api/demo-save", method: "PUT", headers: auth });
      assert.equal(save.status, 405);
      assert.equal(save.headers.allow, "GET, HEAD, POST");
      assert.equal((await request(port, { path: "/api/demo", method: "PUT", headers: auth })).headers.allow, "GET, HEAD");
      assert.equal((await request(port, { path: "/api/inesistente", method: "PUT", headers: auth })).status, 404);
    },
    { env: { LENS_TOKEN: "segreto-di-prova" } },
  );
});

test("POST grezza di un modulo: il Buffer arriva intatto, anche con byte non UTF-8; il content-type si confronta senza parametri né maiuscole", async () => {
  resetCalls();
  await withLens("demo", async ({ port }) => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0xe0, 0x80, 0xc3]);
    const r = await request(port, { path: "/api/demo/upload", method: "POST", headers: { "content-type": "application/zip" }, body: bytes });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { bytes: bytes.length, buffer: true });
    assert.ok(Buffer.isBuffer(uploads[0].body));
    assert.ok(uploads[0].body.equals(bytes), "gli stessi byte");
    assert.equal(uploads[0].rest, undefined, "una POST esatta non ha resto");
    const md = await request(port, { path: "/api/demo/upload", method: "POST", headers: { "content-type": "Text/Markdown; charset=utf-8" }, body: "# ciao" });
    assert.equal(md.status, 200);
    assert.equal(uploads[1].body.toString("utf8"), "# ciao");
    const empty = await request(port, { path: "/api/demo/upload", method: "POST", headers: { "content-type": "application/zip" } });
    assert.equal(empty.status, 200);
    assert.equal(uploads[2].body.length, 0);
  });
});

test("POST grezza di un modulo: content-type non dichiarato → 415 generico, oltre il limite → 413 con connection: close, proxy e Origin estraneo → 403", async () => {
  resetCalls();
  await withLens("demo", async ({ port }) => {
    const post = (headers, body = "PK") => request(port, { path: "/api/demo/upload", method: "POST", headers, body });
    for (const type of ["application/json", "text/plain", "multipart/form-data; boundary=x", "application/x-www-form-urlencoded", "application/zipx", ""]) {
      const r = await post(type ? { "content-type": type } : {});
      assert.equal(r.status, 415, type);
      assert.deepEqual(JSON.parse(r.body), { errors: ["serve content-type: application/zip, text/markdown"] }, type);
    }
    const english = await post({ "content-type": "application/json", "x-lens-lang": "en" });
    assert.deepEqual(JSON.parse(english.body), { errors: ["content-type: application/zip, text/markdown is required"] });
    const big = await post({ "content-type": "application/zip" }, Buffer.alloc(65, 1));
    assert.equal(big.status, 413, "oltre i 64 byte dichiarati");
    assert.equal(big.headers.connection, "close");
    const proxied = await post({ "content-type": "application/zip", "x-forwarded-for": "10.0.0.2" });
    assert.equal(proxied.status, 403);
    assert.deepEqual(JSON.parse(proxied.body), { errors: ["i file della demo non si modificano attraverso un proxy: collegati direttamente da questo computer"] });
    assert.equal((await post({ "content-type": "application/zip", origin: "http://evil.example" })).status, 403);
    assert.deepEqual(uploads, [], "l'handler non è chiamato");
    // a JSON POST past its limit closes the connection too: the body was not read
    const json = await request(port, { path: "/api/demo-save", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "x".repeat(2000) }) });
    assert.equal(json.status, 413);
    assert.equal(json.headers.connection, "close");
  });
});

test("POST a prefisso di un modulo: il resto decodificato come per le GET (null per un escape malformato, vuoto per il prefisso)", async () => {
  resetCalls();
  await withLens("demo", async ({ port }) => {
    const post = (p) => request(port, { path: p, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "x" }) });
    const rest = async (p) => {
      const r = await post(p);
      assert.equal(r.status, 200, p);
      return JSON.parse(r.body).rest;
    };
    assert.equal(await rest("/api/demo/items/abc"), "abc");
    assert.equal(await rest("/api/demo/items/a%2Fb"), "a/b");
    assert.equal(await rest("/api/demo/items/%2e%2e%2fx"), "../x");
    assert.equal(await rest("/api/demo/items/%E0"), null);
    assert.equal(await rest("/api/demo/items/"), "");
    assert.deepEqual(JSON.parse((await post("/api/demo/items/abc")).body).body, { action: "x" });
    assert.equal((await request(port, { path: "/api/demo/items/abc", method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status, 415);
    const get = await request(port, { path: "/api/demo/items/abc" });
    assert.equal(get.status, 404, "una POST a prefisso non risponde a GET");
  });
});

test("POST di un modulo spento: 404, non 405 (le sue route non entrano nella tabella del 405); i percorsi del core restano 405", async () => {
  resetCalls();
  await withLens("", async ({ port }) => {
    for (const p of ["/api/demo/upload", "/api/demo-save", "/api/demo/items/abc", "/api/demo"]) {
      const r = await request(port, { path: p, method: "POST", headers: { "content-type": "application/zip" }, body: "PK" });
      assert.equal(r.status, 404, p);
      assert.equal(r.headers.allow, undefined, p);
      assert.equal((await request(port, { path: p, method: "PUT" })).status, 404, `PUT ${p}`);
    }
    assert.deepEqual(uploads, []);
    assert.equal((await request(port, { path: "/api/status", method: "POST" })).status, 405);
    assert.equal((await request(port, { path: "/api/sessions/x", method: "PUT" })).status, 405);
    assert.equal((await request(port, { path: "/", method: "POST" })).status, 405);
    assert.equal((await request(port, { path: "/metrics", method: "POST" })).status, 405);
  });
  await withLens(
    "",
    async ({ port }) => {
      assert.equal((await request(port, { path: "/api/demo/upload", method: "POST", headers: { "content-type": "application/zip" }, body: "PK" })).status, 401, "senza token, come una GET");
    },
    { env: { LENS_TOKEN: "segreto-di-prova" } },
  );
});

test("POST di un modulo: altri metodi → 405 con allow GET, HEAD, POST; spento → 404", async () => {
  await withLens("demo", async ({ port }) => {
    const r = await request(port, { path: "/api/demo-save", method: "PUT" });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, "GET, HEAD, POST");
    // the core's own paths answer as before
    assert.equal((await request(port, { path: "/api/settings", method: "PUT" })).headers.allow, "GET, HEAD, POST");
    assert.equal((await request(port, { path: "/api/status", method: "POST" })).headers.allow, "GET, HEAD");
    assert.equal((await request(port, { path: "/api/demo", method: "POST" })).headers.allow, "GET, HEAD");
  });
  await withLens("", async ({ port }) => {
    const r = await request(port, { path: "/api/demo-save", method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 404);
    assert.equal(r.headers.allow, undefined);
  });
});

test("route di modulo: a prefisso col resto decodificato, ctx.reply con il suo stato", async () => {
  await withLens("demo", async ({ port }) => {
    assert.deepEqual(JSON.parse((await request(port, { path: "/api/demo-files/a%2Fb" })).body), { rest: "a/b" });
    assert.deepEqual(JSON.parse((await request(port, { path: "/api/demo-files/" })).body), { rest: "" });
    assert.deepEqual(JSON.parse((await request(port, { path: "/api/demo-files/%E0%A4%A" })).body), { rest: null });
    const missing = await request(port, { path: "/api/demo-missing" });
    assert.equal(missing.status, 404);
    assert.deepEqual(JSON.parse(missing.body), { error: "non trovato" });
    assert.equal(missing.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(JSON.parse((await request(port, { path: "/api/demo-count" })).body), { n: 0 }, "ctx.reader legge il database della lens");
  });
  await withLens("", async ({ port }) => {
    assert.equal((await request(port, { path: "/api/demo-files/a" })).status, 404);
  });
});

test("route di modulo: undefined o un'eccezione → 500 JSON, log col nome del modulo, la lens resta su", async () => {
  await withLens("demo", async ({ port }) => {
    let nothing;
    let thrown;
    const lines = await capturingErrors(async () => {
      nothing = await request(port, { path: "/api/demo-nothing", headers: { "x-lens-lang": "en" } });
      thrown = await request(port, { path: "/api/demo-throw" });
    });
    assert.equal(nothing.status, 500);
    assert.deepEqual(JSON.parse(nothing.body), { error: "internal error" });
    assert.equal(thrown.status, 500);
    assert.deepEqual(JSON.parse(thrown.body), { error: "errore interno" });
    assert.equal(lines.length, 2, lines.join("\n"));
    assert.ok(lines.every((l) => /modulo demo/.test(l)), lines.join("\n"));
    assert.match(lines[0], /\/api\/demo-nothing/);
    assert.match(lines[1], /\/api\/demo-throw.*rotto/);
    const after = await request(port, { path: "/api/demo" });
    assert.equal(after.status, 200);
    assert.deepEqual(JSON.parse(after.body), { demo: true });
  });
});

test("file del modulo: 200 da attivo con gli header del core, 404 da spento", async () => {
  await withLens("demo", async ({ port }) => {
    const r = await request(port, { path: "/modules/demo/page.js" });
    assert.equal(r.status, 200);
    assert.match(r.body, /export function mount/);
    assert.equal(r.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.match(r.headers["content-security-policy"], /script-src 'self'/);
    assert.equal(r.headers["cache-control"], "no-cache");
    const head = await request(port, { path: "/modules/demo/style.css", method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal((await request(port, { path: "/modules/demo/manca.js" })).status, 404);
    assert.equal((await request(port, { path: "/modules/crash/page.js" })).status, 404);
  });
  await withLens("", async ({ port }) => {
    assert.equal((await request(port, { path: "/modules/demo/page.js" })).status, 404);
  });
});

test("file del modulo: percorsi codificati, maiuscole e annidati → 404", async () => {
  await withLens("demo", async ({ port }) => {
    for (const p of ["/modules/demo/..%2fx.js", "/modules/demo/%2e%2e%2fx.js", "/modules/demo/%2E%2E/module.js", "/modules/demo/a%5cb.js", "/modules/Demo/page.js", "/modules/demo/page.JS", "/modules/demo/../demo/page.js", "/modules/demo/sub/page.js", "/modules/demo/", "/modules/demo/module"]) {
      assert.equal((await request(port, { path: p })).status, 404, p);
    }
  });
});

/** A folder of the user's own modules: «beta» (usable, with a public/ folder) and «demo» (the id of a module of the lens). */
function userModules() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-user-modules-"));
  for (const id of ["beta", "demo"]) fs.mkdirSync(path.join(root, id, "public"), { recursive: true });
  fs.mkdirSync(path.join(root, "beta", "server"));
  fs.writeFileSync(path.join(root, "beta", "module.js"), `export default { id: "beta", name: "Beta", description: "Un modulo mio", lens: "0.1.0", menu: { group: "dati", order: 95, icon: "" }, page: { title: "Beta" }, server: () => import("./server/index.js") };\n`);
  fs.writeFileSync(path.join(root, "beta", "server", "index.js"), "export function create() { return { routes: {} }; }\n");
  fs.writeFileSync(path.join(root, "beta", "public", "page.js"), "export function mount() {}\n");
  fs.writeFileSync(path.join(root, "demo", "module.js"), "export default {};\n");
  return root;
}

test("GET /api/modules: origin, dir e userDir solo in locale", async () => {
  const userDir = userModules();
  try {
    await withLens("beta", async ({ port }) => {
      const local = JSON.parse((await request(port, { path: "/api/modules" })).body);
      assert.equal(local.userDir, userDir);
      const beta = local.modules.find((m) => m.id === "beta");
      assert.equal(beta.origin, "user");
      assert.equal(beta.dir, path.join(userDir, "beta"));
      const demo = local.modules.find((m) => m.id === "demo");
      assert.equal(demo.origin, "core");
      assert.equal(demo.dir, null, "la cartella di un modulo della lens non serve a nessuno");
      assert.deepEqual(local.shadowed, [{ id: "demo", dir: path.join(userDir, "demo") }]);

      const remote = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-forwarded-for": "10.0.0.2" } })).body);
      assert.equal(remote.userDir, null);
      assert.deepEqual(remote.shadowed, []);
      // the origin is no secret; the folder names the user's home
      assert.equal(remote.modules.find((m) => m.id === "beta").origin, "user");
      for (const m of remote.modules) assert.equal(m.dir, null, m.id);
      assert.doesNotMatch(JSON.stringify(remote), new RegExp(userDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }, { userDir });
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test("GET /api/modules: senza cartella dell'utente userDir è null e shadowed vuoto", async () => {
  await withLens("", async ({ port }) => {
    const body = JSON.parse((await request(port, { path: "/api/modules" })).body);
    assert.equal(body.userDir, null);
    assert.deepEqual(body.shadowed, []);
    assert.ok(body.modules.every((m) => m.origin === "core"));
  });
});

test("/modules/<id>/<file> di un modulo dell'utente: servito dalla sua public/, ../ e sottocartelle rifiutati", async () => {
  const userDir = userModules();
  try {
    await withLens("beta", async ({ port }) => {
      const r = await request(port, { path: "/modules/beta/page.js" });
      assert.equal(r.status, 200);
      assert.match(r.body, /export function mount/);
      assert.equal((await request(port, { path: "/modules/beta/..%2Fmodule.js" })).status, 404);
      assert.equal((await request(port, { path: "/modules/beta/server/index.js" })).status, 404);
    }, { userDir });
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

/**
 * A user module «gamma» with a page, a GET and a POST route and a metric; its files append to `marker` when they run.
 * One folder per use: a module.js is imported once per process, whatever the folder it is found in again.
 */
function userModuleWithEverything(marker) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-user-gamma-"));
  fs.mkdirSync(path.join(root, "gamma", "public"), { recursive: true });
  fs.mkdirSync(path.join(root, "gamma", "server"));
  const note = (what) => `fs.appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(what)});`;
  fs.writeFileSync(path.join(root, "gamma", "module.js"), `import fs from "node:fs";\n${note("manifest;")}\nexport default { id: "gamma", name: "Gamma", description: "Un modulo mio", lens: "0.1.0", menu: { group: "dati", order: 96, icon: "" }, page: { title: "Gamma" }, server: () => import("./server/index.js") };\n`);
  fs.writeFileSync(
    path.join(root, "gamma", "server", "index.js"),
    `import fs from "node:fs";\n${note("server;")}\nexport function create() {
  ${note("create;")}
  return {
    routes: {
      "GET /api/gamma": () => ({ gamma: true }),
      "POST /api/gamma-save": { handler: () => ({ ok: true }), body: { type: "json", max: 1024 }, what: "i dati di gamma" },
    },
    families: () => [{ name: "lens_gamma_total", type: "counter", help: "Gamma", samples: [{ value: 1 }] }],
  };
}\n`,
  );
  fs.writeFileSync(path.join(root, "gamma", "public", "page.js"), "export function mount() {}\n");
  return root;
}

test("modulo dell'utente trovato ma non in LENS_MODULES: nessuna route, pagina, metrica né menu; il manifesto è letto, create mai chiamata", async () => {
  const marker = path.join(os.tmpdir(), `lens-gamma-marker-${process.pid}-${Date.now()}`);
  const markerOn = `${marker}-on`;
  const onDir = userModuleWithEverything(markerOn);
  const userDir = userModuleWithEverything(marker);
  const get = (port, p) => request(port, { path: p });
  const post = (port) => request(port, { path: "/api/gamma-save", method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  try {
    // on: the same requests are answered, so a 404 below is the off state and nothing else
    await withLens("gamma", async ({ port }) => {
      assert.equal((await get(port, "/api/gamma")).status, 200);
      assert.equal((await post(port)).status, 200);
      assert.equal((await get(port, "/modules/gamma/page.js")).status, 200);
      assert.match((await get(port, "/metrics")).body, /lens_gamma_total 1/);
      assert.match((await get(port, "/")).body, /<meta name="lens-modules" content="gamma">/);
    }, { userDir: onDir });
    assert.equal(fs.readFileSync(markerOn, "utf8"), "manifest;server;create;", "da acceso gira tutto");

    await withLens("", async ({ port, registry }) => {
      assert.equal(registry.list().find((m) => m.id === "gamma").state, "off");
      assert.equal((await get(port, "/api/gamma")).status, 404);
      assert.equal((await post(port)).status, 404);
      assert.equal((await get(port, "/modules/gamma/page.js")).status, 404);
      assert.doesNotMatch((await get(port, "/metrics")).body, /lens_gamma/);
      const page = (await get(port, "/")).body;
      assert.doesNotMatch(page, /gamma|lens-modules/i);
    }, { userDir });
    // the manifest is read to judge it (the registry also loads the server file of an off module, for its settings and
    // its «was in use» check); create() is what starts a module, and it never ran
    const ran = fs.readFileSync(marker, "utf8");
    assert.match(ran, /^manifest;/);
    assert.doesNotMatch(ran, /create;/);
  } finally {
    for (const d of [userDir, onDir]) fs.rmSync(d, { recursive: true, force: true });
    for (const f of [marker, markerOn]) fs.rmSync(f, { force: true });
  }
});

test("GET /api/modules: stati, motivo solo da questo computer, enabled come LENS_MODULES, nomi tradotti", async () => {
  await withLens("demo,crash,assente", async ({ port, config }) => {
    const local = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-lens-lang": "en" } })).body);
    assert.deepEqual(local.enabled, config.modules);
    assert.deepEqual(local.enabled, ["demo", "crash", "assente"]);
    const byId = Object.fromEntries(local.modules.map((m) => [m.id, m]));
    assert.equal(byId.demo.state, "on");
    assert.equal(byId.demo.description, "Test module");
    assert.equal(byId.demo.reason, null);
    assert.equal(byId.crash.state, "error");
    assert.match(byId.crash.reason, /avvio fallito/);
    assert.equal(byId.gemello.state, "off");
    assert.equal(byId.broken.state, "error");
    assert.deepEqual(Object.keys(byId.demo).sort(), ["description", "dir", "id", "mcp", "mcpExamples", "name", "notice", "noticeMessage", "origin", "reason", "settings", "settingsPanel", "state"]);
    assert.equal(byId.demo.mcp, true);
    assert.deepEqual(byId.demo.mcpExamples, ["What does the demo say?"], "esempi tradotti nella lingua di chi legge");
    assert.equal(byId.gemello.mcp, false);
    assert.deepEqual(byId.gemello.mcpExamples, []);
    // no settings in this lens: nothing can be saved, and no reason to give
    assert.equal(local.canSave, false);
    assert.equal(local.reason, null);

    const remote = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-forwarded-for": "10.0.0.2" } })).body);
    const crash = remote.modules.find((m) => m.id === "crash");
    assert.equal(crash.state, "error");
    assert.equal(crash.reason, null);
    assert.equal(remote.canSave, false);
  });
});

test("GET /api/modules: gli esempi MCP solo per i moduli accesi", async () => {
  await withLens("", async ({ port }) => {
    const { modules } = JSON.parse((await request(port, { path: "/api/modules" })).body);
    const demo = modules.find((m) => m.id === "demo");
    assert.equal(demo.state, "off");
    assert.equal(demo.mcp, true, "ha strumenti anche da spento: la scheda lo dice");
    assert.deepEqual(demo.mcpExamples, []);
  });
});

test("GET /api/modules: hint «shell» solo da locale e fuori da launchd (tutti e tre i casi)", async () => {
  const fake = (kind) => ({ blockedKind: () => kind, blocked: () => (kind ? `bloccato ${kind}` : null) });
  for (const kind of ["platform", "no-plist", "manual"]) {
    await withLens("demo", async ({ port }) => {
      const local = JSON.parse((await request(port, { path: "/api/modules" })).body);
      assert.equal(local.hint, "shell", kind);
      assert.equal(local.canSave, false);
      const remote = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-forwarded-for": "10.0.0.2" } })).body);
      assert.equal(remote.hint, null, `${kind}: un client remoto non può usare LENS_MODULES`);
    }, { settings: fake(kind) });
  }
  await withLens("demo", async ({ port }) => {
    const local = JSON.parse((await request(port, { path: "/api/modules" })).body);
    assert.equal(local.hint, null, "sotto launchd si salva da qui");
    assert.equal(local.canSave, true);
  }, { settings: fake(null) });
});

test("GET /api/modules: le impostazioni del modulo, valore dal plist solo da locale e mai per un segreto", async () => {
  const settings = { blockedKind: () => null, blocked: () => null, values: () => ({ LENS_DEMO_DIR: "/dal-plist", LENS_DEMO_KEY: "segreta" }) };
  await withLens("", async ({ port }) => {
    const local = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-lens-lang": "en" } })).body);
    const demo = local.modules.find((m) => m.id === "demo");
    assert.deepEqual(demo.settings, [
      { name: "LENS_DEMO_DIR", label: "Demo folder", help: "percorso assoluto; vuoto = la cartella dei dati di XDG", kind: "text", placeholder: "/percorso/della/demo", min: null, max: null, value: "/dal-plist", isSet: true },
      { name: "LENS_DEMO_KEY", label: "Chiave della demo", help: "segreta: mai mostrata", kind: "secret", placeholder: "", min: null, max: null, value: null, isSet: true },
      { name: "LENS_DEMO_LIMIT", label: "Demo limit", help: "seconds, from 5 to 3600; empty = 60", kind: "num", placeholder: "60", min: 5, max: 3600, value: "", isSet: false },
    ]);
    assert.deepEqual(local.modules.find((m) => m.id === "gemello").settings, []);
    const remote = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-forwarded-for": "10.0.0.2" } })).body);
    const far = remote.modules.find((m) => m.id === "demo");
    assert.deepEqual(far.settings.map((x) => [x.name, x.value, x.isSet]), [["LENS_DEMO_DIR", null, null], ["LENS_DEMO_KEY", null, null], ["LENS_DEMO_LIMIT", null, null]], "da rete né valori né isSet: il plist non si legge");
    assert.doesNotMatch(JSON.stringify(local) + JSON.stringify(remote), /"segreta"/);
  }, { settings });
  // without Settings nothing is set and no value is known
  await withLens("", async ({ port }) => {
    const demo = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "demo");
    assert.deepEqual(demo.settings.map((x) => [x.value, x.isSet]), [["", false], [null, false], ["", false]]);
  });
});

test("GET /api/modules: il plist si legge solo per i client locali, e una volta finché non cambia", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-modules-plist-"));
  const plistPath = path.join(dir, "local.opencode-lens.plist");
  fs.writeFileSync(plistPath, "<plist/>");
  let reads = 0;
  const io = {
    read: () => {
      reads++;
      return { LENS_DEMO_DIR: "/dal-plist" };
    },
    write() {},
  };
  const config = withEnv({ LENS_PORT: "0", LENS_DB: ":memory:" }, loadConfig);
  const settings = new Settings({ config, env: { XPC_SERVICE_NAME: "local.opencode-lens" }, plistPath, platform: "darwin", io, reload() {} });
  try {
    await withLens("", async ({ port }) => {
      const remote = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-forwarded-for": "10.0.0.2" } })).body);
      assert.equal(reads, 0, "un client remoto non fa leggere il plist");
      assert.deepEqual(remote.modules.find((m) => m.id === "demo").settings.map((x) => [x.value, x.isSet]), [[null, null], [null, null], [null, null]]);
      for (let i = 0; i < 2; i++) {
        const local = JSON.parse((await request(port, { path: "/api/modules" })).body);
        assert.equal(local.modules.find((m) => m.id === "demo").settings[0].value, "/dal-plist");
      }
      assert.equal(reads, 1, "plist invariato: letto una volta sola");
    }, { settings });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ctx.env di un modulo attivo non contiene LENS_TOKEN né le altre variabili del processo", async () => {
  const before = process.env.LENS_TOKEN;
  process.env.LENS_TOKEN = "un-token-lungo-abbastanza-123"; // in the lens's process environment, as under launchd
  resetCalls();
  try {
    await withLens("demo", async () => {
      assert.ok(seen.create, "demo creato");
      assert.equal(seen.create.env.LENS_TOKEN, undefined);
      assert.equal(seen.create.env.PATH, undefined);
      assert.equal(seen.create.env.HOME, process.env.HOME);
    });
  } finally {
    if (before === undefined) delete process.env.LENS_TOKEN;
    else process.env.LENS_TOKEN = before;
  }
});

test("/metrics: la famiglia del modulo solo da attivo", async () => {
  await withLens("demo", async ({ port }) => {
    assert.match((await request(port, { path: "/metrics" })).body, /lens_demo_total 1/);
  });
  await withLens("", async ({ port }) => {
    assert.doesNotMatch((await request(port, { path: "/metrics" })).body, /lens_demo_total/);
  });
});

test("una route del core non è oscurata da un modulo che dichiara lo stesso percorso", async () => {
  await withLens("ombra", async ({ port }) => {
    const list = JSON.parse((await request(port, { path: "/api/modules" })).body);
    assert.equal(list.modules.find((m) => m.id === "ombra").state, "on");
    const r = await request(port, { path: "/api/status" });
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.ombra, undefined);
    assert.equal(body.state, "connected");
  });
});

test("un modulo che dichiara percorsi del core: route scartate con un avviso, il core risponde come senza moduli", async () => {
  const warned = [];
  const log = { ...quiet, warn: (m) => warned.push(m) };
  ombraCalls.length = 0;
  await withLens(
    "ombra",
    async ({ port }) => {
      for (const key of Object.keys(ombraRoutes)) assert.ok(warned.some((l) => l.includes(`route ${key} scartata`) && l.includes("ombra")), key);
      const post = await request(port, { path: "/api/status", method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(post.status, 405);
      assert.equal(post.headers.allow, "GET, HEAD");
      assert.equal((await request(port, { path: "/api/status", method: "PUT" })).headers.allow, "GET, HEAD");
      const mcp = await request(port, { path: "/api/mcp/status" });
      assert.notEqual(JSON.parse(mcp.body).ombra, true);
      assert.equal((await request(port, { path: "/api/mcp/altro" })).status, 404, "il prefisso del modulo non serve nemmeno i percorsi liberi");
      assert.deepEqual(ombraCalls, [], "gli handler del modulo non sono mai chiamati");
    },
    { log },
  );
});

test("POST /api/modules/notice: chiude l'avviso di un modulo spento con dati, subito", async () => {
  await withLens("", async ({ port, store }) => {
    const list = async () => Object.fromEntries(JSON.parse((await request(port, { path: "/api/modules" })).body).modules.map((m) => [m.id, m]));
    let byId = await list();
    assert.equal(byId.demo.notice, true);
    // crash's hasData throws: no notice, and the lens answers
    assert.equal(byId.crash.notice, false);
    const post = (body, headers = {}) => request(port, { path: "/api/modules/notice", method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    const ok = await post(JSON.stringify({ id: "demo" }));
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { ok: true });
    assert.equal(store.meta("module:demo:notice"), "dismissed");
    byId = await list();
    assert.equal(byId.demo.notice, false);
  });
});

test("POST /api/modules/notice: rifiutato come le altre scritture, id non valido o sconosciuto → 400", async () => {
  await withLens("", async ({ port, store }) => {
    const post = (body, headers = {}) => request(port, { path: "/api/modules/notice", method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    const id = JSON.stringify({ id: "demo" });
    assert.equal((await post(id, { "x-forwarded-for": "10.0.0.2" })).status, 403, "non da questo computer");
    assert.equal((await post(id, { origin: "http://evil.example" })).status, 403, "origine estranea");
    assert.equal((await request(port, { path: "/api/modules/notice", method: "POST", headers: { "content-type": "text/plain" }, body: id })).status, 415);
    assert.equal((await post(JSON.stringify({ id: "x".repeat(2000) }))).status, 413, "oltre 1 KiB");
    assert.equal((await post(JSON.stringify({ id: "x y" }))).status, 400);
    assert.equal((await post(JSON.stringify({ id: "assente" }))).status, 400);
    assert.equal((await post("{")).status, 400);
    assert.equal(store.meta("module:demo:notice"), "pending", "niente è stato scritto");
    assert.equal((await request(port, { path: "/api/modules/notice", method: "PUT" })).status, 405);
  });
});

test("POST /api/modules/check: da remoto rifiutato, da locale risponde", async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-server-check-"));
  const calls = [];
  try {
    fs.mkdirSync(path.join(userDir, "mio", "server"), { recursive: true });
    fs.writeFileSync(path.join(userDir, "mio", "module.js"), `export default { id: "mio", name: "Mio", description: "D", lens: "0.1.0", menu: { group: "dati", order: 90, icon: "" }, page: { title: "Mio" }, server: () => import("./server/index.js") };\n`);
    fs.writeFileSync(path.join(userDir, "mio", "server", "index.js"), `export function create() { return {}; }\n`);
    const { found } = await discoverAll(FIXTURES, { userDir, log: quiet });
    const checkModule = (id) => {
      calls.push(id);
      return checkUserModule({ id, userDir, found, env: {}, dbPath: ":memory:" });
    };
    await withLens(
      "",
      async ({ port }) => {
        const post = (body, headers = {}) => request(port, { path: "/api/modules/check", method: "POST", headers: { "content-type": "application/json", ...headers }, body });
        const id = JSON.stringify({ id: "mio" });
        const proxied = await post(id, { "x-forwarded-for": "10.0.0.2" });
        assert.equal(proxied.status, 403, "non da questo computer");
        // a check is run, not changed: the refusal says so (the other routes keep «si modificano»)
        assert.deepEqual(JSON.parse(proxied.body), { errors: ["i controlli dei moduli non si eseguono attraverso un proxy: collegati direttamente da questo computer"] });
        const proxiedEn = await post(id, { "x-forwarded-for": "10.0.0.2", "x-lens-lang": "en" });
        assert.deepEqual(JSON.parse(proxiedEn.body), { errors: ["the module checks don't run through a proxy: connect directly from this computer"] });
        const proxiedFr = await post(id, { "x-forwarded-for": "10.0.0.2", "x-lens-lang": "fr" });
        assert.deepEqual(JSON.parse(proxiedFr.body), { errors: ["les vérifications des modules ne s'exécutent pas via un proxy : connectez-vous directement depuis cet ordinateur"] });
        assert.equal((await post(id, { origin: "http://evil.example" })).status, 403, "origine estranea");
        assert.equal((await request(port, { path: "/api/modules/check", method: "POST", headers: { "content-type": "text/plain" }, body: id })).status, 415);
        assert.equal((await post(JSON.stringify({ id: "x".repeat(2000) }))).status, 413, "oltre 1 KiB");
        assert.equal((await post("{")).status, 400);
        for (const bad of ["../x", "a/b", "Alfa", "", 5, null]) assert.equal((await post(JSON.stringify({ id: bad }))).status, 400, String(bad));
        assert.equal((await post(JSON.stringify({}))).status, 400);
        assert.deepEqual(calls, [], "nothing was judged, nothing read");
        assert.equal((await request(port, { path: "/api/modules/check", method: "PUT" })).status, 405);

        const ok = await post(id);
        assert.equal(ok.status, 200);
        assert.equal(ok.headers["cache-control"], "no-store");
        assert.deepEqual(JSON.parse(ok.body), {
          ok: true,
          id: "mio",
          name: "Mio",
          dir: path.join(userDir, "mio"),
          errors: [],
          warnings: [
            "a ogni controllo il codice di primo livello di module.js e server/index.js viene eseguito nel processo della lens; i file che server/index.js importa restano quelli caricati all'avvio",
            "le route del modulo nascono in create() e non si controllano qui: una route già presa da un altro modulo si vede solo nel log all'avvio",
            "il modulo è già caricato: le modifiche valgono dopo un riavvio della lens",
          ],
        });
        // texts in the language of the request
        const en = await post(id, { "x-lens-lang": "en", "x-lens-locale": "en-US" });
        assert.deepEqual(JSON.parse(en.body).warnings, [
          "at every check the top-level code of module.js and server/index.js runs in the lens process; the files server/index.js imports stay the ones loaded at startup",
          "the module's routes are born in create() and are not checked here: a route already taken by another module only shows in the startup log",
          "the module is already loaded: the changes apply after a restart of the lens",
        ]);
        const missing = JSON.parse((await post(JSON.stringify({ id: "assente" }), { "x-lens-lang": "en" })).body);
        assert.equal(missing.ok, false);
        assert.deepEqual(missing.errors, [`no folder ${path.join(userDir, "assente")}`]);
        assert.deepEqual(calls, ["mio", "mio", "assente"]);
      },
      { userDir, checkModule },
    );
    // a lens built without the check: 404
    await withLens("", async ({ port }) => {
      assert.equal((await request(port, { path: "/api/modules/check", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "mio" }) })).status, 404);
    });
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

// the spec's success criterion, on the real modules/: Sistema exists only when LENS_MODULES enables it
test("moduli veri: con LENS_MODULES vuota niente Sistema, con LENS_MODULES=sistema tutto come prima", async () => {
  await withLens(
    "",
    async ({ port }) => {
      assert.equal((await request(port, { path: "/api/system" })).status, 404);
      assert.equal((await request(port, { path: "/api/system/live" })).status, 404);
      assert.equal((await request(port, { path: "/modules/sistema/page.js" })).status, 404);
      const page = await request(port, { path: "/" });
      assert.equal(page.status, 200);
      assert.doesNotMatch(page.body, /data-page="sistema"/);
      assert.doesNotMatch(page.body, /id="view-sistema"/);
    },
    { real: true },
  );
  await withLens(
    "sistema",
    async ({ port }) => {
      const page = await request(port, { path: "/" });
      assert.match(page.body, /<a href="#sistema" data-page="sistema" data-label="Sistema"[^>]*><svg class="ico"/);
      assert.match(page.body, /id="view-sistema"/);
      assert.match(page.body, /<link rel="stylesheet" href="\/modules\/sistema\/style\.css">/);
      // processes, ports and agents only for this computer, not behind a proxy
      const local = await request(port, { path: "/api/system" });
      assert.equal(local.status, 200);
      assert.equal(local.headers["cache-control"], "no-store");
      assert.equal(JSON.parse(local.body).restricted, false);
      assert.ok(JSON.parse(local.body).host.hostname);
      const proxied = await request(port, { path: "/api/system", headers: { "x-forwarded-for": "203.0.113.7" } });
      assert.equal(JSON.parse(proxied.body).restricted, true);
      // CPU and memory are summary data: a proxied client gets them too
      const live = await request(port, { path: "/api/system/live", headers: { "x-forwarded-for": "203.0.113.7" } });
      assert.equal(live.status, 200);
      assert.ok(Array.isArray(JSON.parse(live.body).history));
      assert.equal((await request(port, { path: "/api/system", method: "POST" })).status, 405);
      assert.equal((await request(port, { path: "/modules/sistema/page.js" })).status, 200);
    },
    { real: true },
  );
});

// Vibe Coding on the real modules/: off, nothing of it answers; on, its page, its data and its projects, written
// with the core's rules for writes. Its projects live in vibe-projects.json in the data folder, so LENS_DB is a file.
const ONE_PROJECT = { version: 1, projects: [{ id: "p_casa", name: "Casa", color: 1, budget: null, folders: ["/w/casa"], kind: "ongoing", start: null, due: null }] };

/** A temporary data folder for LENS_DB, removed after `fn`. */
async function withDataDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-vibe-mod-"));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("moduli veri: con LENS_MODULES vuota niente Vibe Coding (404 per GET, HEAD e POST, né voce né sezione)", async () => {
  await withLens(
    "",
    async ({ port }) => {
      for (const p of ["/api/vibe-coding?from=0", "/api/vibe-coding/history", "/api/vibe-projects"]) {
        assert.equal((await request(port, { path: p })).status, 404, `GET ${p}`);
        assert.equal((await request(port, { path: p, method: "HEAD" })).status, 404, `HEAD ${p}`);
      }
      const post = await request(port, { path: "/api/vibe-projects", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ONE_PROJECT) });
      assert.equal(post.status, 404);
      assert.equal(post.headers.allow, undefined);
      assert.equal((await request(port, { path: "/modules/vibecoding/page.js" })).status, 404);
      const page = await request(port, { path: "/" });
      assert.equal(page.status, 200);
      assert.doesNotMatch(page.body, /data-page="vibecoding"/);
      assert.doesNotMatch(page.body, /id="view-vibecoding"/);
      assert.doesNotMatch(page.body, /vibecoding\/style\.css/);
      const about = JSON.parse((await request(port, { path: "/api/about" })).body);
      assert.equal(about.files.written.filter((f) => f.label === "Progetti di Vibe Coding").length, 0, "database in memoria: nessun file di progetti");
    },
    { real: true },
  );
});

test("moduli veri: con LENS_MODULES=vibecoding la pagina, i dati e i progetti come prima", async () => {
  await withDataDir(async (dir) => {
    await withLens(
      "vibecoding",
      async ({ port }) => {
        const page = await request(port, { path: "/" });
        assert.match(page.body, /<a href="#vibecoding" data-page="vibecoding" data-label="Vibe Coding"[^>]*><svg class="ico"/);
        assert.match(page.body, /id="view-vibecoding"/);
        assert.match(page.body, /<link rel="stylesheet" href="\/modules\/vibecoding\/style\.css">/);
        for (const f of ["page.js", "vibe-page.js", "vibe-projects.js", "style.css"]) assert.equal((await request(port, { path: `/modules/vibecoding/${f}` })).status, 200, f);

        const vibe = await request(port, { path: "/api/vibe-coding?from=0" });
        assert.equal(vibe.status, 200);
        const d = JSON.parse(vibe.body);
        assert.equal(d.gapMs, 30 * 60_000);
        assert.equal(d.totals.sessions, 0);
        assert.equal(d.previous, null, "da sempre: niente periodo precedente");
        assert.equal((await request(port, { path: "/api/vibe-coding?from=0", method: "HEAD" })).status, 200);

        // projects: canSave only for this computer, not behind a proxy
        assert.deepEqual(JSON.parse((await request(port, { path: "/api/vibe-projects" })).body), { version: 1, projects: [], canSave: true });
        assert.equal(JSON.parse((await request(port, { path: "/api/vibe-projects", headers: { "x-forwarded-for": "203.0.113.7" } })).body).canSave, false);

        const json = { "content-type": "application/json", origin: `http://127.0.0.1:${port}` };
        const post = (body, headers = json) => request(port, { path: "/api/vibe-projects", method: "POST", headers, body });
        const ok = await post(JSON.stringify(ONE_PROJECT));
        assert.equal(ok.status, 200, ok.body);
        assert.deepEqual(JSON.parse(ok.body), { ok: true });
        assert.deepEqual(JSON.parse((await request(port, { path: "/api/vibe-projects" })).body), { ...ONE_PROJECT, canSave: true });
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "vibe-projects.json"), "utf8")), ONE_PROJECT);

        // Review Focus 2: refused as the core's JSON writes, with the same statuses; the file stays as it was
        const proxied = await post(JSON.stringify(ONE_PROJECT), { ...json, "x-forwarded-for": "10.0.0.2" });
        assert.equal(proxied.status, 403);
        assert.deepEqual(JSON.parse(proxied.body), { errors: ["i progetti non si modificano attraverso un proxy: collegati direttamente da questo computer"] });
        assert.equal((await post(JSON.stringify(ONE_PROJECT), { ...json, origin: "http://evil.example" })).status, 403);
        assert.equal((await post("{}", { ...json, "content-type": "text/plain" })).status, 415);
        assert.equal((await post(JSON.stringify({ ...ONE_PROJECT, pad: "x".repeat(300 * 1024) }))).status, 413, "oltre 256 KiB");
        assert.equal((await post("{")).status, 400);
        const p = ONE_PROJECT.projects[0];
        const dup = await post(JSON.stringify({ version: 1, projects: [p, { ...p, id: "p_altro", name: "Altro" }] }));
        assert.equal(dup.status, 400);
        assert.ok(JSON.parse(dup.body).errors.length > 0);
        assert.equal((await request(port, { path: "/api/vibe-projects", method: "PUT" })).status, 405);
        assert.equal((await request(port, { path: "/api/vibe-coding", method: "POST" })).status, 405);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "vibe-projects.json"), "utf8")), ONE_PROJECT, "i rifiuti non toccano il file");

        // /api/about: the projects files once, from the module
        const about = JSON.parse((await request(port, { path: "/api/about" })).body);
        assert.deepEqual(
          about.files.written.filter((f) => /Vibe Coding/.test(f.label)).map((f) => [f.label, f.path]),
          [
            ["Progetti di Vibe Coding", path.join(dir, "vibe-projects.json")],
            ["Progetti di Vibe Coding (file non valido)", path.join(dir, "vibe-projects.bad.json")],
          ],
        );
      },
      { real: true, env: { LENS_DB: path.join(dir, "lens.db") } },
    );
  });
});

test("moduli veri (Review Focus 1): vibe-projects.json pieno e Vibe spento → avviso, il file resta com'era; riacceso i progetti ci sono", async () => {
  await withDataDir(async (dir) => {
    const file = path.join(dir, "vibe-projects.json");
    const text = JSON.stringify(ONE_PROJECT);
    fs.writeFileSync(file, text);
    const env = { LENS_DB: path.join(dir, "lens.db") };
    await withLens(
      "",
      async ({ port, store }) => {
        const vibe = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "vibecoding");
        assert.equal(vibe.state, "off");
        assert.equal(vibe.notice, true);
        assert.equal(store.meta("module:vibecoding:notice"), "pending");
        // off, its files are still listed for the uninstall
        const about = JSON.parse((await request(port, { path: "/api/about" })).body);
        assert.equal(about.files.written.filter((f) => f.label === "Progetti di Vibe Coding").length, 1);
      },
      { real: true, env },
    );
    assert.deepEqual(fs.readdirSync(dir), ["vibe-projects.json"]);
    assert.equal(fs.readFileSync(file, "utf8"), text);
    await withLens(
      "vibecoding",
      async ({ port }) => {
        assert.deepEqual(JSON.parse((await request(port, { path: "/api/vibe-projects" })).body), { ...ONE_PROJECT, canSave: true });
      },
      { real: true, env },
    );
  });
  // an unusable file: no notice, and it is not copied aside (.bad.json) while Vibe is off
  await withDataDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "vibe-projects.json"), "{non json");
    await withLens(
      "",
      async ({ port }) => {
        const vibe = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "vibecoding");
        assert.equal(vibe.notice, false);
      },
      { real: true, env: { LENS_DB: path.join(dir, "lens.db") } },
    );
    assert.deepEqual(fs.readdirSync(dir), ["vibe-projects.json"]);
  });
});

// Security on the real modules/: off, nothing of it answers and a folder with guards only brings the notice; on, its
// page and its data as the core served them. The guards' folders come from LENS_SECURITY_DIRS, never the real ones.

/** A temp folder with one guard `g` (three events, one of them blocked), removed after `fn`. */
async function withGuards(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-security-mod-"));
  const ev = (ts, outcome, extra = {}) => JSON.stringify({ ts, outcome, tool: "ctx_query", kind: "query-docs", library: "/org/lib", findings: [], sessionID: "ses_1", ...extra });
  const lines = [
    ev("2026-10-18T10:00:00.000Z", "allowed"),
    ev("2026-10-18T11:00:00.000Z", "blocked", { findings: [{ category: "INTERNAL_DOMAIN", detail: "azienda.it" }] }),
    ev("2026-10-18T12:00:00.000Z", "allowed"),
  ];
  fs.writeFileSync(path.join(dir, "g.audit.jsonl"), `${lines.join("\n")}\n`);
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const T0 = Date.parse("2026-10-18T00:00:00.000Z");
const T1 = Date.parse("2026-10-19T00:00:00.000Z");

test("moduli veri: con LENS_MODULES vuota niente Security (404 per GET e HEAD, né voce né sezione né famiglie), le sue variabili non sono un errore", async () => {
  await withGuards(async (dir) => {
    await withLens(
      "",
      async ({ port, store }) => {
        for (const p of ["/api/security", "/api/security/g", "/api/security/x?from=0"]) {
          assert.equal((await request(port, { path: p })).status, 404, `GET ${p}`);
          assert.equal((await request(port, { path: p, method: "HEAD" })).status, 404, `HEAD ${p}`);
        }
        assert.equal((await request(port, { path: "/modules/security/page.js" })).status, 404);
        const page = await request(port, { path: "/" });
        assert.doesNotMatch(page.body, /data-page="security"|id="view-security"|security\/style\.css/);
        assert.doesNotMatch((await request(port, { path: "/metrics" })).body, /opencode_lens_security_events/);
        // a folder of LENS_SECURITY_DIRS holds a guard: the notice, the audit untouched
        const sec = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "security");
        assert.equal(sec.state, "off");
        assert.equal(sec.notice, true);
        assert.equal(store.meta("module:security:notice"), "pending");
        const about = JSON.parse((await request(port, { path: "/api/about" })).body);
        assert.equal(about.files.read.filter((f) => f.path === dir).length, 0, "spento: le sue cartelle non sono tra quelle lette");
      },
      { real: true, env: { LENS_SECURITY_DIRS: dir, LENS_SECURITY_CONFIG_DIR: dir } },
    );
    assert.deepEqual(fs.readdirSync(dir), ["g.audit.jsonl"]);
  });
  // no guard anywhere: no notice
  await withLens(
    "",
    async ({ port }) => {
      const sec = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "security");
      assert.equal(sec.notice, false);
    },
    { real: true },
  );
});

test("moduli veri: con LENS_MODULES=security la pagina, l'elenco, il dettaglio, /metrics e /api/about come prima", async () => {
  await withGuards(async (dir) => {
    const before = { dirs: process.env.LENS_SECURITY_DIRS, cfg: process.env.LENS_SECURITY_CONFIG_DIR };
    // /api/about shows the module's variables from the lens's environment
    process.env.LENS_SECURITY_DIRS = dir;
    process.env.LENS_SECURITY_CONFIG_DIR = dir;
    try {
      await withLens(
        "security",
        async ({ port }) => {
          const page = await request(port, { path: "/" });
          assert.match(page.body, /<a href="#security" data-page="security" data-label="Security" data-i18n-data-label><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4\.5-3\.2 8-8 9-4\.8-1-8-4\.5-8-9V6z"\/><path d="M9 12l2 2 4-4"\/><\/svg><span class="nav-text" data-i18n>Security<\/span><\/a>/);
          assert.ok(page.body.indexOf('data-page="security"') > page.body.indexOf('data-page="novita"') && page.body.indexOf('data-page="security"') < page.body.indexOf('data-page="impostazioni"'), "dopo Novità, prima di Impostazioni, come prima");
          assert.match(page.body, /id="view-security"/);
          assert.match(page.body, /<link rel="stylesheet" href="\/modules\/security\/style\.css">/);
          for (const f of ["page.js", "security-page.js", "security-model.js", "security-charts.js", "style.css"]) assert.equal((await request(port, { path: `/modules/security/${f}` })).status, 200, f);

          const list = await request(port, { path: "/api/security" });
          assert.equal(list.status, 200);
          assert.equal(list.headers["cache-control"], "no-store");
          const body = JSON.parse(list.body);
          assert.equal(body.restricted, false);
          assert.deepEqual(body.dirs, [dir]);
          assert.equal(body.guards.length, 1);
          assert.equal(body.guards[0].name, "g");
          assert.equal(body.guards[0].totals.events, 3);
          assert.equal(body.guards[0].totals.blocked, 1);
          assert.ok(body.guards[0].health);
          assert.equal(JSON.parse((await request(port, { path: `/api/security?from=${T1}&to=${T1 + 1000}` })).body).guards[0].totals.events, 0);
          assert.equal((await request(port, { path: "/api/security", method: "HEAD" })).status, 200);
          assert.equal((await request(port, { path: "/api/security", method: "POST" })).status, 405);

          const get = async (qs) => JSON.parse((await request(port, { path: `/api/security/g${qs}` })).body);
          const all = await get("");
          assert.equal(all.guard.name, "g");
          assert.deepEqual([all.events.total, all.events.limit, all.events.offset, all.events.rows.length], [3, 50, 0, 3]);
          assert.equal((await get(`?from=${T0}&to=${T1}`)).events.total, 3);
          assert.equal((await get(`?from=${T1}&to=${T1 + 1000}`)).events.total, 0);
          const blocked = await get("?outcome=blocked");
          assert.equal(blocked.events.total, 1);
          assert.equal(blocked.events.rows[0].outcome, "blocked");
          const pageOf = await get("?limit=1&offset=1");
          assert.deepEqual([pageOf.events.total, pageOf.events.limit, pageOf.events.offset, pageOf.events.rows.length], [3, 1, 1, 1]);
          assert.equal((await get("?category=INTERNAL_DOMAIN")).events.total, 1);
          const odd = await get("?limit=abc&offset=-5");
          assert.deepEqual([odd.events.limit, odd.events.offset], [50, 0]);
          assert.equal((await get("?limit=0")).events.limit, 1);
          assert.equal((await get("?from=abc")).events.total, 3);
          assert.equal((await get(`?from=${T1}&to=${T0}`)).events.total, 3);
          assert.equal((await request(port, { path: "/api/security/g", method: "POST" })).status, 405);

          // Review Focus 4: hostile names never reach the disk, the 404 says which guard (decoded, at most 80 characters)
          // «..» is normalised away by the URL parser before any route, and never reaches the module
          assert.equal((await request(port, { path: "/api/security/.." })).status, 404);
          assert.equal((await request(port, { path: "/api/security/%2e%2e" })).status, 404);
          for (const name of ["Maiuscola", "a%2Fb", "a%2e%2e", "%E0%A4%A", "a".repeat(41), "-x", "x--y", "x_y", "assente", "a".repeat(40)]) {
            const r = await request(port, { path: `/api/security/${name}` });
            assert.equal(r.status, 404, name);
            assert.equal(JSON.parse(r.body).errors.length, 1, name);
          }
          assert.deepEqual(JSON.parse((await request(port, { path: "/api/security/assente" })).body), { errors: ["guard sconosciuto: assente"] });
          assert.deepEqual(JSON.parse((await request(port, { path: "/api/security/a%2Fb" })).body), { errors: ["guard sconosciuto: a/b"] });
          assert.deepEqual(JSON.parse((await request(port, { path: `/api/security/${"b".repeat(100)}` })).body), { errors: [`guard sconosciuto: ${"b".repeat(80)}`] });
          assert.deepEqual(JSON.parse((await request(port, { path: "/api/security/assente", headers: { "x-lens-lang": "en" } })).body), { errors: ["unknown guard: assente"] });

          const m = (await request(port, { path: "/metrics" })).body;
          assert.match(m, /^opencode_lens_security_events\{guard="g",outcome="blocked"\} 1$/m);
          assert.match(m, /^opencode_lens_security_events\{guard="g",outcome="allowed"\} 2$/m);
          assert.equal(m.match(/^# TYPE opencode_lens_security_events gauge$/gm).length, 1, "una famiglia sola");

          // /api/about: its folders once, read only, and its variables in its own rows
          const about = JSON.parse((await request(port, { path: "/api/about" })).body);
          assert.deepEqual(
            about.files.read.filter((f) => f.path === dir).map((f) => f.label),
            ["Audit dei guard", "Policy dei guard"],
          );
          assert.equal(about.files.written.filter((f) => f.path === dir).length, 0, "mai tra i file scritti");
          assert.deepEqual(
            about.settings.filter((s) => s.name.startsWith("LENS_SECURITY_")).map((s) => [s.name, s.value, s.module]),
            [
              ["LENS_SECURITY_DIRS", dir, "security"],
              ["LENS_SECURITY_CONFIG_DIR", dir, "security"],
            ],
          );
          // /api/modules: its fields for the Moduli card, and its MCP tool
          const sec = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((x) => x.id === "security");
          assert.equal(sec.state, "on");
          assert.equal(sec.mcp, true);
          assert.deepEqual(
            sec.settings.map((s) => [s.name, s.label, s.help, s.kind]),
            [
              ["LENS_SECURITY_DIRS", "Cartelle degli audit dei guard", "separate da :, in sola lettura", "text"],
              ["LENS_SECURITY_CONFIG_DIR", "Cartella delle policy dei guard", "configurazione di OpenCode, in sola lettura", "text"],
            ],
          );
          assert.deepEqual(sec.mcpExamples, ["Cosa hanno bloccato i guard DLP oggi?", "Il guard Context7 sta funzionando?"]);
        },
        { real: true, env: { LENS_SECURITY_DIRS: dir, LENS_SECURITY_CONFIG_DIR: dir } },
      );
    } finally {
      for (const [k, v] of [["LENS_SECURITY_DIRS", before.dirs], ["LENS_SECURITY_CONFIG_DIR", before.cfg]]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

test("moduli veri: Security da rete (token) restricted, senza policy, file, confronto né cartelle; righe senza oggetto né dettaglio", async () => {
  const token = "t0ken-di-prova-abcdef";
  await withGuards(async (dir) => {
    await withLens(
      "security",
      async ({ port }) => {
        assert.equal((await request(port, { path: "/api/security" })).status, 401);
        const proxied = { authorization: `Bearer ${token}`, "x-forwarded-for": "203.0.113.7" };
        const list = JSON.parse((await request(port, { path: "/api/security", headers: proxied })).body);
        assert.equal(list.restricted, true);
        assert.equal(list.dirs, null);
        assert.equal(list.guards[0].totals.events, 3);
        const d = JSON.parse((await request(port, { path: "/api/security/g?session=ses_x&directory=%2Fx", headers: proxied })).body);
        assert.equal(d.restricted, true);
        assert.equal(d.policy, null);
        assert.equal(d.files, null);
        assert.equal(d.cross, null);
        assert.equal(d.events.total, 3, "i filtri session/directory sono ignorati da rete");
        for (const row of d.events.rows) {
          assert.equal(row.object, undefined);
          assert.equal(row.detail, undefined);
          assert.equal(row.session, undefined);
        }
        assert.doesNotMatch(JSON.stringify(d), /\/org\/lib|azienda\.it|ses_1/);
      },
      { real: true, env: { LENS_TOKEN: token, LENS_SECURITY_DIRS: dir, LENS_SECURITY_CONFIG_DIR: dir } },
    );
  });
});

test("moduli veri: una LENS_SECURITY_DIRS relativa, accettata dal core, arriva assoluta a Security e a /api/about", async () => {
  await withGuards(async (dir) => {
    const rel = path.relative(process.cwd(), dir);
    assert.ok(!path.isAbsolute(rel));
    await withLens(
      "security",
      async ({ port }) => {
        assert.deepEqual(JSON.parse((await request(port, { path: "/api/security" })).body).dirs, [dir]);
        const about = JSON.parse((await request(port, { path: "/api/about" })).body);
        assert.deepEqual(
          about.files.read.filter((f) => f.label === "Audit dei guard").map((f) => f.path),
          [dir],
        );
      },
      { real: true, env: { LENS_SECURITY_DIRS: rel, LENS_SECURITY_CONFIG_DIR: rel } },
    );
  });
});

test("GET /api/modules: da configurare col motivo (solo da locale), senza route né voce di menu; avviso e pannello del modulo", async () => {
  await withLens("demo", async ({ port }) => {
    const local = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-lens-lang": "en" } })).body);
    const demo = local.modules.find((m) => m.id === "demo");
    assert.equal(demo.state, "unconfigured");
    assert.match(demo.reason, /LENS_DEMO_LIMIT must be an integer between 5 and 3600/);
    assert.equal(demo.settingsPanel, null, "il pannello solo a modulo acceso");
    assert.equal(demo.noticeMessage, "The demo was in use: it is no longer read until you switch it back on");
    assert.deepEqual(demo.settings.find((x) => x.name === "LENS_DEMO_LIMIT").min, 5);
    const remote = JSON.parse((await request(port, { path: "/api/modules", headers: { "x-forwarded-for": "10.0.0.2" } })).body);
    assert.equal(remote.modules.find((m) => m.id === "demo").reason, null);
    assert.equal((await request(port, { path: "/api/demo" })).status, 404, "nessuna route");
    const page = await request(port, { path: "/" });
    assert.doesNotMatch(page.body, /data-page="demo"/, "nessuna voce di menu");
    assert.equal((await request(port, { path: "/healthz" })).status, 200, "la lens resta su");
  }, { env: { LENS_DEMO_LIMIT: "1" } });
  await withLens("demo", async ({ port }) => {
    const demo = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "demo");
    assert.equal(demo.state, "on");
    assert.equal(demo.settingsPanel, "settings.js");
  });
});

// --- the demo's source: the dashboard's selector over views of its items (src/source-views.js) ---

const NOW = Date.now();
const RANGE = `from=0&to=${NOW + 60_000}`;

/** OpenCode: one session with a step and a prompt in the last minutes (a live run); the demo: an item ended, one still open. */
function seedSource(store) {
  addSession(store, { id: "ses_1", created: NOW - 600_000 });
  addPrompt(store, { id: "prm_1", created: NOW - 300_000 });
  addStep(store, { id: "msg_1", started: NOW - 200_000, ended: NOW - 190_000, cost: 0.02, tokens: tokens(1000, 200) });
  const ins = store.db.prepare("INSERT INTO demo_items (id, name, created, ended) VALUES (?, 'x', ?, ?)");
  ins.run("a", NOW - 7_200_000, NOW - 7_100_000);
  ins.run("b", NOW - 60_000, null);
}

const getJson = async (port, p) => {
  const r = await request(port, { path: p });
  assert.equal(r.status, 200, p);
  return JSON.parse(r.body);
};
// what may change between two reads of the same period: the time of the answer and the projections made from it
const MOVING = new Set(["now", "elapsed", "projected", "projectedRatio"]);
const steady = (x) => JSON.stringify(x, (k, v) => (MOVING.has(k) ? undefined : v));

test("sorgente della demo: ?demo=only e ?demo=1 su summary, budget, runs/live e le altre letture; stato in /api/status e /healthz", async () => {
  resetCalls();
  await withLens(
    "demo",
    async ({ port }) => {
      const base = await getJson(port, `/api/summary?${RANGE}`);
      const only = await getJson(port, `/api/summary?${RANGE}&demo=only`);
      const plus = await getJson(port, `/api/summary?${RANGE}&demo=1`);
      assert.equal(base.demo, undefined);
      assert.deepEqual(Object.keys(only), [...Object.keys(base), "demo"], "OpenCode's shape, with how much is the source's (as ?bob=only today)");
      assert.equal(only.steps, 2);
      assert.equal(only.sessions, 2);
      assert.equal(only.cost, 1);
      assert.deepEqual(only.tokens, { ...only.tokens, input: 200, output: 20 });
      assert.equal(base.steps, 1);
      assert.deepEqual(Object.keys(plus), [...Object.keys(base), "demo"]);
      assert.equal(plus.steps, base.steps + only.steps);
      assert.equal(plus.demo.items, 2, "how much of it is the demo's: its totals()");
      assert.deepEqual(only.demo, plus.demo);
      // another value of the parameter: OpenCode's answer
      assert.equal(steady(await getJson(port, `/api/summary?${RANGE}&demo=2`)), steady(base));

      const budget = await getJson(port, "/api/budget");
      const budgetOnly = await getJson(port, "/api/budget?demo=only");
      assert.equal(budget.periods.day.cost.limit, null);
      assert.equal(budgetOnly.periods.day.cost.limit, 2, "the demo's limits with it alone");
      assert.equal(budgetOnly.periods.month.cost.limit, 60);
      assert.equal(steady(await getJson(port, "/api/budget?demo=1")), steady(budget), "with both the budgets stay OpenCode's");

      const live = await getJson(port, "/api/runs/live");
      const liveOnly = await getJson(port, "/api/runs/live?demo=only");
      const livePlus = await getJson(port, "/api/runs/live?demo=1");
      assert.deepEqual(live.runs.map((r) => r.sessionID), ["ses_1"]);
      assert.deepEqual(liveOnly.runs.map((r) => r.sessionID), ["demo:b"]);
      assert.deepEqual(livePlus.runs.map((r) => r.sessionID).sort(), ["demo:b", "ses_1"], "the two lists put together");

      const sessions = await getJson(port, `/api/sessions?${RANGE}&demo=only`);
      assert.deepEqual(sessions.map((x) => x.id).sort(), ["demo:a", "demo:b"]);
      const runs = await getJson(port, `/api/runs?${RANGE}&demo=only`);
      assert.deepEqual(runs.map((x) => x.sessionID), ["demo:a"]);

      const status = await getJson(port, "/api/status");
      assert.deepEqual(status.demo, { items: 2, problem: null });
      assert.equal((await getJson(port, "/healthz")).demo, "ok");
    },
    { file: true, seed: seedSource },
  );
});

test("sorgente della demo: un valore ereditato come ?demo=constructor|toString|__proto__ dà la risposta di OpenCode, non un 500", async () => {
  resetCalls();
  await withLens(
    "demo",
    async ({ port }) => {
      const base = steady(await getJson(port, `/api/summary?${RANGE}`));
      for (const v of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
        const res = await request(port, { path: `/api/summary?${RANGE}&demo=${v}` });
        assert.equal(res.status, 200, v);
        assert.equal(steady(JSON.parse(res.body)), base, v);
      }
    },
    { file: true, seed: seedSource },
  );
});

test("sorgente della demo: uno status() non serializzabile non dà un 500: la chiave manca", async () => {
  resetCalls();
  await withLens(
    "demo",
    async ({ port }) => {
      behave.statusUnserializable = true;
      const res = await request(port, { path: "/api/status" });
      assert.equal(res.status, 200);
      assert.equal(JSON.parse(res.body).demo, undefined);
    },
    { file: true },
  );
});

test("sorgente della demo: problem di status() nella lingua di chi legge", async () => {
  resetCalls();
  await withLens(
    "demo",
    async ({ port }) => {
      assert.equal((await getJson(port, "/api/status")).demo.problem, "La demo non ha elementi");
      const en = JSON.parse((await request(port, { path: "/api/status", headers: { "x-lens-lang": "en" } })).body);
      assert.equal(en.demo.problem, "The demo has no items");
    },
    { file: true },
  );
});

test("sorgente della demo: a modulo spento ?demo=only dà la risposta di OpenCode, e /api/status e /healthz non hanno demo", async () => {
  resetCalls();
  await withLens(
    "",
    async ({ port }) => {
      for (const p of [`/api/summary?${RANGE}`, "/api/budget", `/api/sessions?${RANGE}`, "/api/runs/live"]) {
        const sep = p.includes("?") ? "&" : "?";
        assert.equal(steady(await getJson(port, `${p}${sep}demo=only`)), steady(await getJson(port, p)), p);
        assert.equal(steady(await getJson(port, `${p}${sep}demo=1`)), steady(await getJson(port, p)), p);
      }
      assert.equal((await getJson(port, "/api/status")).demo, undefined);
      assert.equal((await getJson(port, "/healthz")).demo, undefined);
    },
    { file: true, seed: seedSource },
  );
});

test("sorgente della demo: in memoria nessuna sorgente (?demo=only ignorato), lo stato del modulo c'è", async () => {
  resetCalls();
  await withLens(
    "demo",
    async ({ port }) => {
      assert.equal(steady(await getJson(port, `/api/summary?${RANGE}&demo=only`)), steady(await getJson(port, `/api/summary?${RANGE}`)));
      assert.deepEqual((await getJson(port, "/api/status")).demo, { items: 2, problem: null });
      assert.equal((await getJson(port, "/healthz")).demo, "ok");
    },
    { seed: seedSource },
  );
});

/** A log that keeps its lines, for the registry. */
// A module that declares widgets, with the catalog of its texts in a temp folder: id `id`, its one widget reading /api/<id>.
function widgetModule(id, dir, { data = [`/api/${id}`], widgetsFile = "widgets.js" } = {}) {
  const manifest = {
    id,
    name: `Nome ${id}`,
    description: "Modulo con widget",
    lens: "0.1.0",
    menu: { group: "dati", order: 70, icon: "" },
    page: { title: `Nome ${id}` },
    widgetsFile,
    widgets: [{ type: `${id}-uno`, label: `Etichetta ${id}`, description: `Descrizione </script> ${id}`, size: [6, 4], min: [3, 3], home: "both", data }],
    server: async () => ({ create: () => ({ routes: { [`GET /api/${id}`]: () => ({ ok: true }) } }) }),
  };
  return { id, dir, manifest };
}

test("GET /: il file dei widget solo per i moduli accesi, i testi in italiano (li traduce il browser)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-widget-html-"));
  fs.mkdirSync(path.join(dir, "public"));
  fs.writeFileSync(path.join(dir, "public", "lang-en.js"), 'export default { "Nome wuno": "Name wuno", "Etichetta wuno": "Label wuno", "Descrizione </script> wuno": "Description </script> wuno" };\n');
  const read = async (port, headers = {}) => {
    const html = (await request(port, { path: "/", headers })).body;
    const m = /<script type="application\/json" id="lens-module-widgets">(.*)<\/script>/.exec(html);
    return { html, list: m && JSON.parse(m[1]), raw: m?.[1] };
  };
  try {
    // wuno is on, wdue is found but off, wtre is on but its one widget reads a path that is not its route (dropped), demo has none
    const more = [widgetModule("wuno", dir), widgetModule("wdue", path.join(dir, "assente")), widgetModule("wtre", path.join(dir, "assente"), { data: ["/api/altro"] })];
    await withLens(
      "demo,wuno,wtre",
      async ({ port }) => {
        // a navigation to / sends no x-lens-lang: whatever the server would pick, the page gets the Italian sources
        const { list, raw } = await read(port);
        assert.deepEqual(
          list.map((m) => [m.id, m.state, m.file]).sort(),
          [
            // the fixtures that fail to load: their id alone (R35)
            ["broken", "error", null],
            ["impostazioni", "error", null],
            ["sbagliato", "error", null],
            ["wdue", "off", null],
            ["wtre", "on", null],
            ["wuno", "on", "/modules/wuno/widgets.js"],
          ],
          "wtre (every widget dropped: listed, no file to load) and demo (none: not listed)",
        );
        assert.doesNotMatch(raw, /[<>&]/, "the tag cannot be closed from inside");
        const wuno = list.find((m) => m.id === "wuno");
        assert.equal(wuno.name, "Nome wuno");
        assert.deepEqual(wuno.types[0], { type: "wuno-uno", label: "Etichetta wuno", description: "Descrizione </script> wuno", size: [6, 4], min: [3, 3], home: "both", data: ["/api/wuno"] });
        assert.equal(list.find((m) => m.id === "wdue").types.length, 1, "the off module still lists its widgets");
        // a dropped widget says which path is not a GET route of its module (R18)
        assert.deepEqual(list.find((m) => m.id === "wtre").types, [{ type: "wtre-uno", label: "Etichetta wtre", description: "Descrizione </script> wtre", size: [6, 4], min: [3, 3], home: "both", data: ["/api/altro"], dropped: "/api/altro" }]);

        // even a request that names a language gets the sources: the browser translates them with the module's catalog
        const en = (await read(port, { "x-lens-lang": "en" })).list.find((m) => m.id === "wuno");
        assert.equal(en.name, "Nome wuno");
        assert.equal(en.types[0].label, "Etichetta wuno");
        assert.equal(en.types[0].description, "Descrizione </script> wuno");
      },
      { more, settings: null },
    );
    // no module with widgets: only the fixtures in error (R35); none of them either, no tag (test/module-html.test.js)
    await withLens("demo", async ({ port }) => assert.deepEqual((await read(port)).list.map((m) => m.state), ["error", "error", "error"]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /: un modulo in errore senza manifesto c'è tra i moduli dei widget, col suo id e nessun tipo (R35)", async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-widget-error-"));
  fs.mkdirSync(path.join(userDir, "futuro", "public"), { recursive: true });
  // a manifest for a lens to come, with a widget the user saved on the dashboard while it worked
  fs.writeFileSync(
    path.join(userDir, "futuro", "module.js"),
    `export default { id: "futuro", name: "Futuro", description: "Per una lens futura", lens: "99.0.0", menu: { group: "dati", order: 95, icon: "" }, page: { title: "Futuro" }, widgetsFile: "widgets.js", widgets: [{ type: "futuro-w", label: "W", description: "W", size: [4, 4], min: [2, 2], home: "adesso", data: ["/api/futuro"] }], server: () => import("./server/index.js") };\n`,
  );
  try {
    await withLens(
      "futuro",
      async ({ port }) => {
        const html = (await request(port, { path: "/" })).body;
        const list = JSON.parse(/<script type="application\/json" id="lens-module-widgets">(.*)<\/script>/.exec(html)[1]);
        assert.deepEqual(
          list.find((m) => m.id === "futuro"),
          { id: "futuro", name: "futuro", state: "error", file: null, types: [] },
          "il nome è l'id: non c'è un manifesto da cui leggerlo",
        );
        // the fixtures that fail to load are listed the same way; demo, which works and declares none, is not
        assert.deepEqual(list.find((m) => m.id === "broken"), { id: "broken", name: "broken", state: "error", file: null, types: [] });
        assert.equal(list.find((m) => m.id === "demo"), undefined);
        assert.doesNotMatch(JSON.stringify(list), new RegExp(userDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "nessun percorso");
      },
      { userDir },
    );
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

function keepLog() {
  const lines = { info: [], warn: [], error: [] };
  return { lines, info: (m) => lines.info.push(m), warn: (m) => lines.warn.push(m), error: (m) => lines.error.push(m) };
}

test("status() della demo che lancia: /api/status 200 senza demo, una riga nel log; /healthz resta su", async () => {
  resetCalls();
  behave.statusThrows = true;
  const log = keepLog();
  try {
    await withLens(
      "demo",
      async ({ port }) => {
        for (let i = 0; i < 3; i++) {
          const r = await request(port, { path: "/api/status" });
          assert.equal(r.status, 200);
          assert.equal(JSON.parse(r.body).demo, undefined);
        }
        assert.equal((await getJson(port, "/healthz")).demo, "ok");
        assert.equal(log.lines.error.filter((l) => /demo/.test(l)).length, 1);
      },
      { log },
    );
  } finally {
    resetCalls();
  }
});

test("sorgente della demo che non va (due istruzioni, una colonna in meno, source() che lancia): niente sorgente, demo in error col motivo, la lens parte", async () => {
  const cases = {
    "due istruzioni": () => {
      behave.steps = "SELECT * FROM demo_items; SELECT 1";
    },
    "una colonna in meno": () => {
      behave.steps = "SELECT 'x', 'y', 'demo'";
    },
    "source() che lancia": () => {
      behave.sourceThrows = true;
    },
  };
  for (const [why, set] of Object.entries(cases)) {
    resetCalls();
    set();
    const log = keepLog();
    try {
      await withLens(
        "demo",
        async ({ port }) => {
          assert.equal((await request(port, { path: "/healthz" })).status, 200, why);
          const demo = (await getJson(port, "/api/modules")).modules.find((m) => m.id === "demo");
          assert.equal(demo.state, "error", why);
          assert.match(demo.reason, /^sorgente non disponibile: /, why);
          assert.equal(steady(await getJson(port, `/api/summary?${RANGE}&demo=only`)), steady(await getJson(port, `/api/summary?${RANGE}`)), why);
          assert.equal((await getJson(port, "/api/status")).demo, undefined, why);
          assert.equal((await getJson(port, "/healthz")).demo, undefined, why);
          assert.equal((await request(port, { path: "/api/demo" })).status, 404, `${why}: a module in error has no routes`);
          assert.equal(log.lines.error.filter((l) => /sorgente non disponibile/.test(l)).length, 1, why);
        },
        { file: true, seed: seedSource, log },
      );
    } finally {
      resetCalls();
    }
  }
});

test("due moduli con una sorgente: vale il primo per id, l'altro è ignorato con un avviso", async () => {
  resetCalls();
  const found = await discoverModules(FIXTURES);
  const demo = found.find((f) => f.id === "demo");
  // a second module with the demo's server, no tables (its prefix would be zeta_) and a source of its own
  const zeta = { id: "zeta", dir: path.join(FIXTURES, "zeta"), manifest: { ...demo.manifest, id: "zeta", settings: [], tables: undefined, source: { label: "Zeta" } } };
  const log = keepLog();
  await withLens(
    "demo,zeta",
    async ({ port }) => {
      assert.equal((await getJson(port, `/api/summary?${RANGE}&demo=only`)).steps, 2);
      assert.equal(steady(await getJson(port, `/api/summary?${RANGE}&zeta=only`)), steady(await getJson(port, `/api/summary?${RANGE}`)));
      assert.equal(log.lines.warn.filter((l) => /una sola sorgente/.test(l)).length, 1);
      const states = Object.fromEntries((await getJson(port, "/api/modules")).modules.map((m) => [m.id, m.state]));
      assert.deepEqual([states.demo, states.zeta], ["on", "on"], "the other module stays on, without its source");
    },
    { file: true, seed: seedSource, log, more: [zeta] },
  );
});

// IBM Bob on the real modules/ (plan D, Task 6a: the core's Bob is gone). Off, nothing of it answers, runs or counts and
// ?bob= is ignored; on, its page, its probes, its status and state, its source for the dashboard's selector and its
// /metrics, while OpenCode's answers stay the same. bob.db is a fake one, never this computer's.

// the last Friday at 15:00 (never later than now): /api/daily counts back from the real clock, and a Friday keeps
// the same fake month of Bob on every run
const BOB_NOW = (() => {
  const d = new Date();
  d.setHours(15, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 2) % 7));
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 7);
  return d.getTime();
})();

/** A temp folder with a fake bob.db (a month of Bob ending at BOB_NOW), removed after `fn(file)`. */
async function withFakeBob(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-bob-server-"));
  const file = path.join(dir, "bob.db");
  const counts = writeFakeBob(file, { now: BOB_NOW });
  try {
    await fn(file, counts.tasks + counts.subagents);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// OpenCode's own rows, the same in every lens of these tests
function seedOpenCode(store) {
  addSession(store, { id: "ses_1", directory: "/Users/dev/gestionale", created: BOB_NOW - 3_600_000 });
  addStep(store, { id: "msg_1", started: BOB_NOW - 3_000_000, ended: BOB_NOW - 2_990_000, cost: 0.02, tokens: tokens(1000, 200, 0, 500) });
}

/** Waits until module bob has read `tasks` tasks (its first pass is scheduled by start()). */
async function bobRead(port, tasks) {
  for (let i = 0; i < 500; i++) {
    const st = JSON.parse((await request(port, { path: "/api/status" })).body).bob;
    if (st?.state === "connected" && st.tasks === tasks) return st;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("IBM Bob non ha letto bob.db");
}

test("moduli veri: con LENS_MODULES vuota niente IBM Bob (404, ?bob= ignorato, né stato né famiglie né OTLP), bob.db mai aperto", async () => {
  await withFakeBob(async (file) => {
    await withLens(
      "",
      async ({ port, store, registry, queries, config }) => {
        for (const p of ["/api/bob", "/api/bob/probe"]) {
          assert.equal((await request(port, { path: p })).status, 404, `GET ${p}`);
          assert.equal((await request(port, { path: p, method: "HEAD" })).status, 404, `HEAD ${p}`);
        }
        const probe = await request(port, { path: "/api/bob/probe", method: "POST", headers: { "content-type": "application/json" }, body: '{"kind":"schema"}' });
        assert.equal(probe.status, 404);
        const range = `from=${BOB_NOW - 86_400_000}&to=${BOB_NOW + 1}`;
        // (no /api/budget nor /api/hourly here: their `now` is the instant of each request)
        for (const q of [`/api/summary?${range}`, `/api/runs?${range}`, "/api/daily?days=7", `/api/tools?${range}`]) {
          const [plain, only, plus] = await Promise.all(["", "&bob=only", "&bob=1"].map(async (x) => (await request(port, { path: `${q}${x}` })).body));
          assert.equal(only, plain, `${q} bob=only`);
          assert.equal(plus, plain, `${q} bob=1`);
        }
        assert.equal(JSON.parse((await request(port, { path: "/api/status" })).body).bob, undefined);
        assert.deepEqual(JSON.parse((await request(port)).body), { ok: true, opencode: "connected" });
        assert.doesNotMatch((await request(port, { path: "/metrics" })).body, /opencode_lens_bob_/);
        const otlp = new OtlpExporter({ config: { ...config, otlp: { endpoint: "http://127.0.0.1:4318", headers: {}, intervalMs: 60_000, temporality: "cumulative", traces: false } }, store, queries, collector: fakeCollector, extraFamilies: () => registry.families() });
        assert.doesNotMatch(JSON.stringify(otlp.metricsPayload(Date.now()).payload), /opencode_lens_bob_/);
        // the module never ran: bob.db is not read, whatever time passes
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(store.db.prepare("SELECT COUNT(*) n FROM bob_tasks").get().n, 0);
        // its tables are there all the same, created by the core for the module
        assert.equal(store.meta("module:bob:schema"), "1");
        // the browser side: no menu entry, no page, no stylesheet, a source selector without a source, no panel
        const html = (await request(port, { path: "/" })).body;
        assert.doesNotMatch(html, /data-page="bob"|id="view-bob"|modules\/bob\/|data-source-id/);
        assert.match(html, /id="source-select"[^>]*\shidden/);
        for (const f of ["page.js", "bob-page.js", "settings.js", "style.css"]) assert.equal((await request(port, { path: `/modules/bob/${f}` })).status, 404, f);
        const card = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "bob");
        assert.equal(card.state, "off");
        assert.equal(card.settingsPanel, null, "il pannello solo a modulo acceso");
      },
      { real: true, file: true, env: { LENS_BOB_DB: file } },
    );
  });
});

test("moduli veri: con LENS_MODULES=bob le risposte di OpenCode restano identiche; pagina, selettore, stato, /healthz e /metrics di Bob", async () => {
  await withFakeBob(async (file, tasks) => {
    const opts = { real: true, file: true, env: { LENS_BOB_DB: file }, seed: seedOpenCode };
    const off = await startLens("", opts);
    const on = await startLens("bob", opts);
    const get = async (lens, p) => {
      const r = await request(lens.port, { path: p });
      return { ...r, json: () => JSON.parse(r.body) };
    };
    try {
      await bobRead(on.port, tasks);
      const range = `from=${BOB_NOW - 86_400_000}&to=${BOB_NOW + 1}`;
      for (const p of [`/api/summary?${range}`, `/api/breakdown?${range}`, `/api/sessions?${range}`, `/api/activity?${range}`, "/api/feed"]) {
        const [a, b] = [await get(off, p), await get(on, p)];
        assert.equal(b.status, 200, p);
        assert.equal(b.body, a.body, p);
      }
      const [sa, sb] = [(await get(off, "/api/status")).json(), (await get(on, "/api/status")).json()];
      assert.equal(sa.bob, undefined);
      // the module's status(): the fields of the core's Bob (enabled as before), the banner's sentence as text
      assert.equal(sb.bob.enabled, true);
      assert.equal(sb.bob.state, "connected");
      assert.equal(sb.bob.db, file);
      assert.equal(sb.bob.problem, null);
      delete sb.bob;
      sa.lens.db = sb.lens.db = "lens.db"; // each lens of the test has its own temporary folder
      assert.deepEqual(sb, sa);
      // /metrics: every OpenCode series is the same, Bob only adds opencode_lens_bob_*
      const [ma, mb] = [(await get(off, "/metrics")).body, (await get(on, "/metrics")).body];
      const lines = (m) => m.split("\n").filter((l) => !l.includes("opencode_lens_bob_"));
      assert.deepEqual(lines(mb), lines(ma));
      assert.match(mb, /^opencode_lens_bob_up 1$/m);
      assert.match(mb, /^opencode_lens_bob_tasks_total\{kind="subagent"\} \d+$/m);
      assert.deepEqual((await get(on, "/healthz")).json(), { ok: true, opencode: "connected", bob: "connected" });
      // the browser side: the menu entry in the group Dati (where the core's was), its page and stylesheet, the
      // dashboard's selector with Bob as its source, the panel in Impostazioni › Moduli and the fields with their bounds
      const html = (await get(on, "/")).body;
      const entry = html.indexOf('data-page="bob"');
      assert.ok(entry > html.indexOf('data-page="sessioni"') && entry < html.indexOf('id="nav-g-lens"'), "nel gruppo Dati, dopo Sessioni");
      assert.match(html, /<meta name="lens-modules" content="bob">/);
      assert.match(html, /id="view-bob"/);
      assert.match(html, /<link rel="stylesheet" href="\/modules\/bob\/style\.css">/);
      assert.match(html, /id="source-select" data-source-id="bob" data-source-label="Bob"/);
      assert.doesNotMatch(html, /id="sec-bob"|id="nav-bob"|id="bob-source"/, "nothing of the core's Bob");
      for (const f of ["page.js", "page.html", "bob-page.js", "bob-model.js", "settings.js", "settings-bob.js", "style.css", "lang-en.js", "lang-fr.js"]) assert.equal((await get(on, `/modules/bob/${f}`)).status, 200, f);
      const card = (await get(on, "/api/modules")).json().modules.find((m) => m.id === "bob");
      assert.equal(card.state, "on");
      assert.equal(card.settingsPanel, "settings.js");
      const bounds = Object.fromEntries(card.settings.map((x) => [x.name, [x.min ?? null, x.max ?? null]]));
      assert.deepEqual(bounds, { LENS_BOB_DB: [null, null], LENS_BOB_INTERVAL: [5, 3600], LENS_BOB_COIN_USD: [null, null], LENS_BOB_COINS_MONTHLY: [1, null] });
      // the page
      const page = (await get(on, `/api/bob?${range}`)).json();
      assert.equal(page.enabled, true);
      assert.equal(page.status.state, "connected");
      assert.ok(page.totals.tasks > 0);
      assert.ok(!(await get(on, `/api/bob?from=0&to=${BOB_NOW + 1}`)).body.includes(SECRET));
      // «+ Bob»: OpenCode plus Bob, with how much of it is Bob's
      const plus = (await get(on, `/api/summary?${range}&bob=1`)).json();
      const base = (await get(on, `/api/summary?${range}`)).json();
      assert.ok(plus.bob && plus.bob.coins > 0);
      assert.ok(Math.abs(plus.cost - base.cost - plus.bob.cost) < 1e-9);
      // «Solo Bob»: the same shapes, Bob's numbers only
      const only = (await get(on, `/api/summary?${range}&bob=only`)).json();
      assert.deepEqual(Object.keys(only).sort(), [...Object.keys(base), "bob"].sort());
      assert.ok(Math.abs(only.cost - plus.bob.cost) < 1e-9);
      assert.equal(only.tokens.total, plus.bob.tokens.total);
      assert.equal(only.steps, plus.bob.requests);
      // OpenCode's budgets with «+ Bob»; Bob's plan with «Solo Bob» (none set here)
      const usedOf = (b) => JSON.stringify(Object.values(JSON.parse(b).periods).map((x) => [x.tokens, x.cost, x.steps].map((m) => [m.used, m.limit])));
      assert.equal(usedOf((await get(on, "/api/budget?bob=1")).body), usedOf((await get(off, "/api/budget")).body));
      const [d, dOnly, dPlus] = await Promise.all(["", "&bob=only", "&bob=1"].map(async (x) => (await get(on, `/api/daily?days=8${x}`)).json()));
      for (let i = 0; i < d.days.length; i++) assert.equal(dPlus.days[i].tokens, d.days[i].tokens + dOnly.days[i].tokens);
      assert.ok(dOnly.days.some((x) => x.prompts > 0 && x.runs > 0));
      const all = `from=0&to=${BOB_NOW + 1}`;
      const runs = (await get(on, `/api/runs?${all}&limit=5&bob=only`)).json();
      assert.ok(runs.length === 5 && runs.every((r) => r.title === null && ["succeeded", "failed"].includes(r.outcome)));
      const sessions = (await get(on, `/api/sessions?${all}&limit=10&bob=only`)).json();
      assert.equal(sessions.length, 10);
      assert.equal((await get(on, `/api/sessions/${encodeURIComponent(sessions[0].id)}?bob=only`)).status, 200);
      assert.equal((await get(on, `/api/sessions/${encodeURIComponent(sessions[0].id)}`)).status, 404, "a Bob task is not an OpenCode session");
      assert.ok(!JSON.stringify([runs, sessions]).includes(SECRET));
    } finally {
      await off.close();
      await on.close();
    }
  });
});

test("moduli veri: con LENS_MODULES=bob e bob.db assente lo stato dice missing con la frase del banner, OpenCode risponde come sempre", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-bob-missing-"));
  const file = path.join(dir, "bob.db");
  try {
    await withLens(
      "bob",
      async ({ port }) => {
        let st;
        for (let i = 0; i < 100 && st?.state !== "missing"; i++) {
          st = JSON.parse((await request(port, { path: "/api/status" })).body).bob;
          if (st?.state !== "missing") await new Promise((r) => setTimeout(r, 20));
        }
        assert.equal(st.state, "missing");
        // the sentence the shell puts in the banner (shell-status.js: status[<id>].problem), as text in the reader's language
        assert.equal(typeof st.problem, "string");
        assert.ok(st.problem.includes(file), st.problem);
        assert.deepEqual(JSON.parse((await request(port)).body), { ok: true, opencode: "connected", bob: "missing" });
        assert.equal((await request(port, { path: "/api/summary" })).status, 200);
        assert.ok(!fs.existsSync(file), "bob.db is never created");
      },
      { real: true, env: { LENS_BOB_DB: file } },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("moduli veri: POST /api/bob/probe passa dai controlli delle scritture del core, poi la sonda", async () => {
  await withFakeBob(async (file) => {
    await withLens(
      "bob",
      async ({ port }) => {
        const post = (body, headers = {}) => request(port, { path: "/api/bob/probe", method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
        const ok = await post({ kind: "checks" });
        assert.equal(ok.status, 200, ok.body);
        const r = JSON.parse(ok.body);
        assert.equal(r.kind, "checks");
        assert.equal(r.ok, true, r.error);
        assert.match(r.output, /# Verifiche su bob\.db/);
        assert.equal((await post({ kind: "../../etc" })).status, 400);
        assert.equal((await post({ kind: "checks" }, { "content-type": "text/plain" })).status, 415);
        assert.equal((await post({ kind: "checks" }, { origin: "http://evil.example" })).status, 403);
      },
      { real: true, env: { LENS_BOB_DB: file } },
    );
  });
});

// Skill on the real modules/ (plan E, Task 6a): off, none of its paths answers, and the library, its index and the
// presets stay as they were (content and mtime); skill_uses and its two metrics stay the core's. On, the answers the
// core gave. The library lives in a temporary data folder (LENS_DB), never the real one.

const SKILL_ON = "skill";
const skillMd = (name, desc, body = "# corpo\n") => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;
const tlsZip = (body = "# uno\n") =>
  makeZip([
    { name: "tls/SKILL.md", data: skillMd("tls", "Debug TLS", body) },
    { name: "tls/scripts/check.sh", data: "#!/bin/sh\n", mode: 0o100755 },
  ]);
const SKILL_FILE_LABELS = ["Libreria delle skill", "Indice delle skill", "Indice delle skill (file non valido)", "Preset di skill", "Preset di skill (file non valido)"];

/** Every file and folder under `dir` with its content (files) and mtime: what «left as it was» compares. */
function tree(dir) {
  const out = {};
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out[path.relative(dir, p)] = { mtime: fs.lstatSync(p).mtimeMs, data: e.isFile() ? fs.readFileSync(p, "utf8") : null };
      if (e.isDirectory()) visit(p);
    }
  };
  visit(dir);
  return out;
}

/** Every file and folder under `dir` moved a day back: a rewrite after it cannot keep the mtime by chance. */
function ageTree(dir) {
  const past = (Date.now() - 86_400_000) / 1000;
  for (const p of Object.keys(tree(dir))) fs.utimesSync(path.join(dir, p), past, past);
}

// when the seeded loads happened: the same instant for every lens of a test, so a restarted lens reads the same history
const SKILL_USES_AT = Date.now() - 60_000;

/** The rows the collector writes in skill_uses whatever Skill's state (one of them native), on their session. */
function seedSkillUses(store) {
  addSession(store, { id: "ses_skill", directory: "/p", created: 100 });
  const at = SKILL_USES_AT;
  store.skillUse({ id: "u1", session_id: "ses_skill", at, channel: "skill", skill_id: "tls", status: "completed", origin: "lens" });
  store.skillUse({ id: "u2", session_id: "ses_skill", at: at + 1, channel: "skill", skill_id: "tls", status: "completed", origin: "native" });
  store.skillUse({ id: "u3", session_id: "ses_skill", at: at + 2, channel: "lens-preset", preset_id: "web", status: "completed", origin: "lens" });
}

// the browser side of Skill (plan E, Task 6c): every file of modules/skill/public/ the page loads
const SKILL_PAGE_FILES = ["page.js", "skills-page.js", "skills-board.js", "skills-drawer.js", "skills-hero.js", "skill-figures.js", "skill-import.js", "skill-presets-dialog.js", "skill-presets.js", "preset-rules.js", "zip-writer.js", "style.css", "lang-en.js", "lang-fr.js"];

test("moduli veri: con LENS_MODULES vuota niente pagina di Skill (né voce, sezione, dialogo dei preset, foglio di stile né file serviti)", async () => {
  await withLens(
    "",
    async ({ port }) => {
      const page = await request(port, { path: "/" });
      assert.equal(page.status, 200);
      assert.doesNotMatch(page.body, /data-page="skill"/);
      assert.doesNotMatch(page.body, /id="view-skill"/);
      assert.doesNotMatch(page.body, /id="skill-presets-dialog"/);
      assert.doesNotMatch(page.body, /skill\/style\.css/);
      assert.doesNotMatch(page.body, /id="skill-/, "nessun elemento della pagina di Skill");
      for (const f of SKILL_PAGE_FILES) assert.equal((await request(port, { path: `/modules/skill/${f}` })).status, 404, f);
      for (const f of ["skills-page.js", "skill-presets.js", "zip-writer.js"]) assert.equal((await request(port, { path: `/${f}` })).status, 404, `/${f} non è più del core`);
    },
    { real: true },
  );
});

test("moduli veri: con LENS_MODULES=skill la voce, la sezione, il dialogo dei preset, il foglio di stile e i file della pagina", async () => {
  await withLens(
    SKILL_ON,
    async ({ port }) => {
      const page = await request(port, { path: "/" });
      assert.match(page.body, /<a href="#skill" data-page="skill" data-label="Skill"[^>]*><svg class="ico"/);
      assert.match(page.body, /id="view-skill"/);
      assert.match(page.body, /<dialog class="presets-dialog skill-dialog" id="skill-presets-dialog" aria-labelledby="skill-presets-title"><\/dialog>/);
      assert.match(page.body, /<link rel="stylesheet" href="\/modules\/skill\/style\.css">/);
      // the entry keeps its place in the Lens group: after Galleria and Novità, before Sistema (below) and Impostazioni
      const at = (p) => page.body.indexOf(`data-page="${p}"`);
      assert.ok(at("galleria") < at("skill") && at("novita") < at("skill") && at("skill") < at("impostazioni"));
      for (const f of SKILL_PAGE_FILES) assert.equal((await request(port, { path: `/modules/skill/${f}` })).status, 200, f);
    },
    { real: true },
  );
  await withLens(
    `${SKILL_ON},sistema`,
    async ({ port }) => {
      const page = await request(port, { path: "/" });
      const at = (p) => page.body.indexOf(`data-page="${p}"`);
      assert.ok(at("sistema") > 0 && at("skill") < at("sistema") && at("sistema") < at("impostazioni"), "Skill prima di Sistema");
    },
    { real: true },
  );
});

test("moduli veri: con LENS_MODULES=skill la libreria via HTTP come la serviva il core (import, dettaglio, rollback, markdown, guardie)", async () => {
  await withDataDir(async (dir) => {
    await withLens(
      SKILL_ON,
      async ({ port }) => {
        const origin = `http://127.0.0.1:${port}`;
        const post = (p, headers, body) => request(port, { path: p, method: "POST", headers: { origin, ...headers }, body });
        const zip = { "content-type": "application/zip" };
        const getJson = async (p, headers) => JSON.parse((await request(port, { path: p, headers })).body);

        assert.deepEqual(await getJson("/api/skills"), { version: 1, skills: [], canSave: true, reason: null });
        const one = await post("/api/skills", zip, tlsZip());
        assert.equal(one.status, 200, one.body);
        assert.deepEqual(JSON.parse(one.body), { ok: true, id: "tls", version: 1 });
        assert.ok(fs.existsSync(path.join(dir, "skills", "tls", "1", "scripts", "check.sh")));
        const got = await getJson("/api/skills/tls");
        assert.deepEqual([got.id, got.description, got.body, got.version, got.dir], ["tls", "Debug TLS", "# uno\n", 1, path.join(dir, "skills", "tls", "1")]);
        assert.deepEqual(got.files, [path.join(dir, "skills", "tls", "1", "scripts", "check.sh")]);
        // the same zip again changes nothing, and the answer says so
        for (const mode of ["version", "overwrite"]) assert.deepEqual(JSON.parse((await post(`/api/skills?mode=${mode}`, zip, tlsZip())).body), { ok: true, id: "tls", version: 1, unchanged: true }, mode);
        assert.deepEqual(JSON.parse((await post("/api/skills", zip, tlsZip("# due\n"))).body), { ok: true, id: "tls", version: 2 });
        const rb = await post("/api/skills/tls", { "content-type": "application/json" }, JSON.stringify({ action: "rollback", version: 1 }));
        assert.equal(rb.status, 200, rb.body);
        assert.equal((await getJson("/api/skills/tls")).body, "# uno\n", "dopo il rollback la corrente è la 1");
        // a lone SKILL.md without a name takes its id from x-lens-filename
        const named = await post("/api/skills", { "content-type": "text/markdown; charset=utf-8", "x-lens-filename": "Mia Nota.md" }, "---\ndescription: Una nota\n---\n# nota\n");
        assert.deepEqual(JSON.parse(named.body), { ok: true, id: "mia-nota", version: 1 });
        const badMode = await post("/api/skills?mode=bogus", zip, tlsZip());
        assert.equal(badMode.status, 400);
        assert.deepEqual(JSON.parse(badMode.body).errors, ['modalità di import non valida: "bogus" (ammesse: version, overwrite, new)']);

        // Review Focus 3, the core's guards in front of the module: CSRF content-types 415, a foreign Origin or a proxy
        // 403, past the limit 413 with connection: close, ids that are no skill id 400, other methods 405
        for (const type of ["multipart/form-data; boundary=x", "text/plain", "application/x-www-form-urlencoded", "application/json"]) {
          const r = await post("/api/skills", { "content-type": type }, "PK");
          assert.equal(r.status, 415, type);
          assert.match(JSON.parse(r.body).errors[0], /application\/zip.*text\/markdown/);
        }
        assert.equal((await post("/api/skills", { ...zip, origin: "http://evil.example" }, tlsZip())).status, 403);
        assert.equal((await post("/api/skills", { ...zip, "x-forwarded-for": "1.2.3.4" }, tlsZip())).status, 403);
        assert.equal((await post("/api/skills/tls", { "content-type": "application/json", origin: "http://evil.example" }, '{"action":"delete"}')).status, 403);
        const big = await post("/api/skills", { ...zip, "content-length": String(17 * 1024 * 1024) });
        assert.equal(big.status, 413);
        assert.equal(big.headers.connection, "close");
        for (const id of ["%2e%2e%2f", "..%2Fx", "%E0%A4%A", "%E0", "Maiuscola"]) {
          assert.equal((await request(port, { path: `/api/skills/${id}` })).status, 400, `GET ${id}`);
          assert.equal((await post(`/api/skills/${id}`, { "content-type": "application/json" }, '{"action":"delete"}')).status, 400, `POST ${id}`);
        }
        for (const p of ["/api/skills", "/api/skills/tls"]) {
          const put = await request(port, { path: p, method: "PUT", headers: zip, body: "PK" });
          assert.equal(put.status, 405, p);
          assert.equal(put.headers.allow, "GET, HEAD, POST");
        }
        assert.equal((await post("/api/skills/tls", zip, "{}")).status, 415);
        assert.deepEqual((await getJson("/api/skills")).skills.map((s) => [s.id, s.current, s.versions.length]).sort(), [["mia-nota", 1, 1], ["tls", 1, 2]], "no refused write reached the library");
        // from behind a proxy nothing can be saved
        const proxied = await getJson("/api/skills", { via: "1.1 nginx" });
        assert.equal(proxied.canSave, false);
        assert.match(proxied.reason, /da questo computer/);
        assert.equal((await getJson("/api/skill-presets", { via: "1.1 nginx" })).canSave, false);
      },
      { real: true, env: { LENS_DB: path.join(dir, "lens.db") } },
    );
  });
});

test("moduli veri: con LENS_MODULES=skill preset col rev, consegne del MCP in skill_uses, uso delle skill e /api/about con le voci di Skill una volta sola", async () => {
  await withDataDir(async (dir) => {
    await withLens(
      SKILL_ON,
      async ({ port, store }) => {
        const origin = `http://127.0.0.1:${port}`;
        const json = { "content-type": "application/json", origin };
        const post = (p, body, headers = json) => request(port, { path: p, method: "POST", headers, body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
        const getJson = async (p) => JSON.parse((await request(port, { path: p })).body);
        assert.equal((await post("/api/skills", tlsZip(), { "content-type": "application/zip", origin })).status, 200);

        // presets: missing and rev in the GET, a stale rev 409 with the current one, the right one saves
        const first = await getJson("/api/skill-presets");
        assert.deepEqual(first, { version: 1, presets: [], canSave: true, rev: first.rev });
        assert.match(first.rev, /^[0-9a-f]{16}$/);
        const web = { version: 1, presets: [{ id: "web", name: "Web", brief: "", skills: ["tls", "assente"] }] };
        const stale = await post("/api/skill-presets", { ...web, rev: "0000000000000000" });
        assert.equal(stale.status, 409);
        assert.equal(JSON.parse(stale.body).rev, first.rev);
        assert.equal((await post("/api/skill-presets", { ...web, rev: first.rev })).status, 200);
        const second = await getJson("/api/skill-presets");
        assert.notEqual(second.rev, first.rev);
        assert.deepEqual(second.presets, [{ ...web.presets[0], missing: ["assente"] }]);
        assert.equal((await post("/api/skill-presets", { ...web, rev: null })).status, 409, "an explicit null rev is not «no rev»");
        assert.equal((await post("/api/skill-presets", { version: 2, presets: [] })).status, 400);
        assert.equal((await post("/api/skill-presets", { ...web, pad: "x".repeat(300 * 1024) })).status, 413);

        // the MCP's deliveries: twice the same id stays one row per skill
        const load = { id: "123e4567-e89b-42d3-a456-426614174000", channel: "lens-prompt", preset: "web", sessionId: null, at: Date.now() - 1000, skills: [{ id: "tls", full: true, version: 1 }] };
        for (let i = 0; i < 2; i++) assert.deepEqual(JSON.parse((await post("/api/skill-loads", load)).body), { ok: true });
        assert.deepEqual(
          store.db.prepare("SELECT skill_id, preset_id, version, origin FROM skill_uses ORDER BY id").all().map((r) => ({ ...r })),
          [
            { skill_id: null, preset_id: "web", version: null, origin: "lens" },
            { skill_id: "tls", preset_id: "web", version: 1, origin: "lens" },
          ],
        );
        const bad = await post("/api/skill-loads", { id: "x", channel: "lens-prompt", skills: [] });
        assert.equal(bad.status, 400);
        assert.ok(JSON.parse(bad.body).errors.length > 0);
        assert.equal((await post("/api/skill-loads", "{}", { "content-type": "text/plain", origin })).status, 415);
        assert.equal((await post("/api/skill-loads", { pad: "x".repeat(17 * 1024) })).status, 413);
        assert.equal((await post("/api/skill-loads", "{}", { ...json, via: "1.1 nginx" })).status, 403);

        // their use: the library's skill and the preset, by id
        const usage = await getJson("/api/skill-usage");
        assert.deepEqual(usage.skills.map((s) => [s.id, s.n]), [["tls", 1]]);
        assert.deepEqual(usage.presets.map((p) => [p.id, p.n]), [["web", 1]]);
        assert.equal((await request(port, { path: "/api/skill-usage", method: "POST", headers: json, body: "{}" })).status, 405);

        // /api/about: the library, its index and the presets once each, from the module, removed by the uninstall
        const about = await getJson("/api/about");
        const skillFiles = about.files.written.filter((f) => SKILL_FILE_LABELS.includes(f.label));
        assert.deepEqual(
          skillFiles.map((f) => [f.label, f.path]),
          [
            ["Libreria delle skill", path.join(dir, "skills")],
            ["Indice delle skill", path.join(dir, "skills.json")],
            ["Indice delle skill (file non valido)", path.join(dir, "skills.bad.json")],
            ["Preset di skill", path.join(dir, "skill-presets.json")],
            ["Preset di skill (file non valido)", path.join(dir, "skill-presets.bad.json")],
          ],
        );
        assert.equal(about.uninstall.split(`rm -rf '${path.join(dir, "skills")}'`).length - 1, 1);
        for (const f of ["skills.json", "skills.bad.json", "skill-presets.json", "skill-presets.bad.json"]) assert.equal(about.uninstall.split(`'${path.join(dir, f)}'`).length - 1, 1, f);
      },
      { real: true, env: { LENS_DB: path.join(dir, "lens.db") } },
    );
  });
});

test("moduli veri: con LENS_MODULES=skill un indice illeggibile dà il motivo nella lingua della richiesta; import e azioni 409 e il file non si tocca", async () => {
  await withDataDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "skills.json"), "{ rotto");
    await withLens(
      SKILL_ON,
      async ({ port }) => {
        const origin = `http://127.0.0.1:${port}`;
        const post = (p, headers, body) => request(port, { path: p, method: "POST", headers: { origin, ...headers }, body });
        const reason = "L'indice delle skill (skills.json) non è leggibile: la libreria non viene mostrata e gli import sono sospesi finché non lo ripari o lo sposti.";
        assert.deepEqual(JSON.parse((await request(port, { path: "/api/skills" })).body), { version: 1, skills: [], canSave: false, reason, unusable: true });
        const upload = await post("/api/skills", { "content-type": "application/zip" }, tlsZip());
        assert.equal(upload.status, 409, upload.body);
        assert.deepEqual(JSON.parse(upload.body).errors, [reason]);
        const action = await post("/api/skills/tls", { "content-type": "application/json" }, JSON.stringify({ action: "delete" }));
        assert.equal(action.status, 409, action.body);
        assert.deepEqual(JSON.parse(action.body).errors, [reason]);
        assert.equal(fs.readFileSync(path.join(dir, "skills.json"), "utf8"), "{ rotto", "il file non si tocca");
        assert.equal(fs.existsSync(path.join(dir, "skills")), false, "niente cartelle create");
        const en = JSON.parse((await request(port, { path: "/api/skills", headers: { "x-lens-lang": "en" } })).body);
        assert.match(en.reason, /^The skills index \(skills\.json\) cannot be read/);
        const fr = JSON.parse((await request(port, { path: "/api/skills/tls", headers: { "x-lens-lang": "fr" } })).body);
        assert.notEqual(fr.errors[0], "skill sconosciuta: tls", "the module's texts follow the request's language too");
      },
      { real: true, env: { LENS_DB: path.join(dir, "lens.db") } },
    );
  });
});

test("moduli veri: con LENS_MODULES=skill e il database in memoria la libreria non si salva", async () => {
  await withLens(
    SKILL_ON,
    async ({ port }) => {
      const s = JSON.parse((await request(port, { path: "/api/skills" })).body);
      assert.equal(s.canSave, false);
      assert.match(s.reason, /in memoria/);
      assert.equal(JSON.parse((await request(port, { path: "/api/about" })).body).files.written.filter((f) => SKILL_FILE_LABELS.includes(f.label)).length, 0);
    },
    { real: true },
  );
});

test("moduli veri (Review Focus 1 e 2): libreria e preset con Skill spento → 404 su ogni percorso, avviso, file intatti, skill_uses e le sue metriche restano; riacceso è tutto com'era", async () => {
  await withDataDir(async (dir) => {
    const opts = { real: true, env: { LENS_DB: path.join(dir, "lens.db") }, seed: seedSkillUses };
    const origin = (port) => `http://127.0.0.1:${port}`;
    const answers = async (port) => ({
      library: JSON.parse((await request(port, { path: "/api/skills" })).body),
      detail: JSON.parse((await request(port, { path: "/api/skills/tls?version=1" })).body),
      presets: JSON.parse((await request(port, { path: "/api/skill-presets" })).body),
      // since.lens is the database's creation (meta skill_loads_since): each lens of this test has a database in memory
      usage: (({ since, ...rest }) => ({ ...rest, since: { ...since, lens: typeof since.lens } }))(JSON.parse((await request(port, { path: "/api/skill-usage?from=0" })).body)),
    });
    // a library with two versions and a preset, saved through Skill
    let before;
    await withLens(
      SKILL_ON,
      async ({ port }) => {
        const zip = { "content-type": "application/zip", origin: origin(port) };
        for (const body of ["# uno\n", "# due\n"]) assert.equal((await request(port, { path: "/api/skills", method: "POST", headers: zip, body: tlsZip(body) })).status, 200);
        const { rev } = JSON.parse((await request(port, { path: "/api/skill-presets" })).body);
        const web = { version: 1, presets: [{ id: "web", name: "Web", brief: "per il web", skills: ["tls"] }], rev };
        assert.equal((await request(port, { path: "/api/skill-presets", method: "POST", headers: { "content-type": "application/json", origin: origin(port) }, body: JSON.stringify(web) })).status, 200);
        before = await answers(port);
        assert.deepEqual(before.usage.skills.map((s) => [s.id, s.n]), [["tls", 1]]);
      },
      opts,
    );
    ageTree(dir);
    const files = tree(dir);
    assert.deepEqual(Object.keys(files).sort(), ["skill-presets.json", "skills", "skills.json", "skills/tls", "skills/tls/1", "skills/tls/1/SKILL.md", "skills/tls/1/scripts", "skills/tls/1/scripts/check.sh", "skills/tls/2", "skills/tls/2/SKILL.md", "skills/tls/2/scripts", "skills/tls/2/scripts/check.sh"]);

    await withLens(
      "",
      async ({ port, store }) => {
        // Review Focus 2, HTTP: every path of Skill is a 404, for GET, HEAD and POST, never a 405
        for (const p of ["/api/skills", "/api/skills/tls", "/api/skill-presets", "/api/skill-loads", "/api/skill-usage"]) {
          assert.equal((await request(port, { path: p })).status, 404, `GET ${p}`);
          assert.equal((await request(port, { path: p, method: "HEAD" })).status, 404, `HEAD ${p}`);
        }
        const posts = [
          ["/api/skills", "application/zip", tlsZip("# tre\n")],
          ["/api/skills/tls", "application/json", '{"action":"delete"}'],
          ["/api/skill-presets", "application/json", '{"version":1,"presets":[]}'],
          ["/api/skill-loads", "application/json", '{"id":"123e4567-e89b-42d3-a456-426614174001","channel":"lens-prompt","preset":"web","sessionId":null,"at":1,"skills":[]}'],
        ];
        for (const [p, type, body] of posts) {
          const r = await request(port, { path: p, method: "POST", headers: { "content-type": type, origin: origin(port) }, body });
          assert.equal(r.status, 404, `POST ${p}`);
          assert.equal(r.headers.allow, undefined, `POST ${p}`);
        }
        // the notice, generic: Skill was in use
        const card = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "skill");
        assert.equal(card.state, "off");
        assert.equal(card.notice, true);
        assert.equal(card.noticeMessage, null, "the generic «Skill era in uso…»");
        assert.equal(store.meta("module:skill:notice"), "pending");
        // skill_uses stays the core's (the collector writes it whatever Skill's state) and so do its two metrics
        assert.equal(store.db.prepare("SELECT COUNT(*) n FROM skill_uses").get().n, 3);
        const metrics = (await request(port, { path: "/metrics" })).body;
        assert.match(metrics, /^opencode_lens_skill_loads_total\{skill="tls",channel="skill",origin="lens"\} 1$/m);
        assert.match(metrics, /^opencode_lens_skill_loads_total\{skill="tls",channel="skill",origin="native"\} 1$/m);
        assert.match(metrics, /^opencode_lens_skill_preset_loads_total\{preset="web",channel="lens-preset"\} 1$/m);
        // off, its files are still listed for the uninstall, once each
        const about = JSON.parse((await request(port, { path: "/api/about" })).body);
        assert.deepEqual(about.files.written.filter((f) => SKILL_FILE_LABELS.includes(f.label)).map((f) => f.label), SKILL_FILE_LABELS);
      },
      opts,
    );
    assert.deepEqual(tree(dir), files, "Skill spento: contenuto e mtime come prima");

    await withLens(
      SKILL_ON,
      async ({ port }) => {
        assert.deepEqual(await answers(port), before, "riacceso: libreria, versioni, preset e uso come prima");
      },
      opts,
    );
  });
});

test("moduli veri (Review Focus 1): Skill spento con skills.json rotto, una cartella non indicizzata e skill-presets.json rotto → avviso, niente scritto né copiato", async () => {
  await withDataDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "skills.json"), "{ rotto");
    fs.writeFileSync(path.join(dir, "skill-presets.json"), "{ rotto anche questo");
    fs.mkdirSync(path.join(dir, "skills", "orfana", "1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", "orfana", "1", "SKILL.md"), skillMd("orfana", "Sul disco"));
    fs.mkdirSync(path.join(dir, "skills", "orfana", "2.tmp-abc"));
    ageTree(dir);
    const files = tree(dir);
    await withLens(
      "",
      async ({ port }) => {
        const card = JSON.parse((await request(port, { path: "/api/modules" })).body).modules.find((m) => m.id === "skill");
        assert.equal(card.notice, true, "a version folder is a library, whatever the index");
        assert.equal((await request(port, { path: "/api/skills" })).status, 404);
        await request(port, { path: "/api/about" });
      },
      { real: true, env: { LENS_DB: path.join(dir, "lens.db") } },
    );
    assert.deepEqual(tree(dir), files);
  });
});

test("GET /api/modules/authoring: i nomi presi di questa lens", async () => {
  const wid = {
    id: "wid",
    dir: path.join(FIXTURES, "wid"),
    manifest: {
      id: "wid",
      name: "Wid",
      description: "Modulo con widget, strumenti e variabili",
      lens: "0.1.0",
      menu: { group: "dati", order: 81, icon: "" },
      page: { title: "Wid" },
      settings: [{ name: "LENS_WID_KEY", label: "Chiave", help: "h", kind: "text" }],
      mcp: () => import("./fixtures/modules/demo/mcp/tools.js"),
      mcpTools: ["wid_tool"],
      widgets: [{ type: "wid-box", label: "Box", description: "d", size: [3, 3], min: [2, 2], home: "both", data: ["/api/wid/box"] }],
      server: async () => ({ create: () => ({ routes: {} }) }),
    },
  };
  await withLens("", async ({ port }) => {
    const r = await request(port, { path: "/api/modules/authoring" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["cache-control"], "no-store");
    const a = JSON.parse(r.body);
    assert.deepEqual(Object.keys(a).sort(), ["lens", "reservedIds", "reservedPaths", "takenIds", "takenTools", "takenVars", "takenWidgetTypes", "userDir", "widgetLimits"]);
    assert.equal(a.lens, VERSION);
    assert.equal(a.userDir, null, "this lens has no folder for the user's modules");
    assert.ok(a.takenIds.includes("demo") && a.takenIds.includes("wid"), "the ids of the modules, on or off");
    for (const id of ["dashboard", "adesso", "monitor", "state", "usage"]) assert.ok(a.reservedIds.includes(id), `reserved id ${id}`);
    assert.ok(a.takenVars.includes("LENS_PORT"), "a variable of the core");
    assert.ok(a.takenVars.includes("LENS_DEMO_LIMIT") && a.takenVars.includes("LENS_WID_KEY"), "the modules' variables");
    assert.ok(a.reservedPaths.exact.includes("/api/summary"));
    assert.ok(a.reservedPaths.prefixes.includes("/api/sessions/"));
    assert.ok(a.reservedPaths.writes.includes("/api/settings"));
    assert.deepEqual(a.reservedPaths, JSON.parse(JSON.stringify(CORE_PATHS)));
    assert.ok(["budget", "errors", "usage", "sessions", "module_guide", "module_check"].every((n) => a.takenTools.includes(n)));
    assert.ok(a.takenTools.includes("demo") && a.takenTools.includes("wid_tool"), "the mcpTools of the modules");
    assert.ok(a.takenWidgetTypes.includes("hero") && a.takenWidgetTypes.includes("wid-box"));
    assert.deepEqual(a.widgetLimits, { homes: ["adesso", "analisi", "both"], maxWidgets: 12, maxDataPaths: 4, maxValues: 20, maxWidth: 12, maxHeight: 40, maxTypeLength: 31, fromPlaceholder: "{from}" });
    for (const k of ["takenIds", "reservedIds", "takenVars", "takenTools", "takenWidgetTypes"]) assert.deepEqual(a[k], [...new Set(a[k])], `${k}: no duplicates`);

    const remote = await request(port, { path: "/api/modules/authoring", headers: { "x-forwarded-for": "10.0.0.2" } });
    assert.equal(remote.status, 403, "from the network");
    assert.doesNotMatch(remote.body, /takenIds|LENS_PORT/);
    assert.equal((await request(port, { path: "/api/modules/authoring", method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 405);
  }, { more: [wid] });
});

test("GET /api/modules/authoring: userDir è la cartella dell'utente, in locale", async () => {
  const userDir = userModules();
  try {
    await withLens("", async ({ port }) => {
      const a = JSON.parse((await request(port, { path: "/api/modules/authoring" })).body);
      assert.equal(a.userDir, userDir);
      assert.ok(a.takenIds.includes("beta"));
    }, { userDir });
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
