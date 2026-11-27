// I preset di dashboard nella lens: dashboard-presets.json (PresetStore) e /api/presets.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { PresetStore } from "../src/presets.js";
import { Queries } from "../src/queries.js";
import { about } from "../src/about.js";
import { setLogLevel } from "../src/log.js";
import { TEMPLATES } from "../public/layout.js";
import { EMPTY_PRESETS, addPreset } from "../public/presets.js";
import { memoryStore } from "./helpers.js";

setLogLevel("error");

const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "lens-presets-"));
const sample = (name = "Casa") => addPreset(EMPTY_PRESETS, { name, layout: TEMPLATES.consigliata.layout, base: "consigliata" }).doc;

test("PresetStore: scrive, rilegge; modo 0600 e nessun .tmp rimasto", () => {
  const dir = tmpDir();
  try {
    const s = new PresetStore({ dbPath: path.join(dir, "lens.db") });
    assert.equal(s.path, path.join(dir, "dashboard-presets.json"));
    assert.deepEqual(s.read(), EMPTY_PRESETS);
    const doc = sample();
    s.write(doc);
    assert.deepEqual(s.read(), doc);
    assert.deepEqual(fs.readdirSync(dir), ["dashboard-presets.json"]);
    assert.equal(fs.statSync(s.path).mode & 0o777, 0o600, "leggibile solo dal proprietario");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PresetStore: in memoria con LENS_DB=:memory:", () => {
  const s = new PresetStore({ dbPath: ":memory:" });
  assert.equal(s.path, null);
  assert.deepEqual(s.read(), EMPTY_PRESETS);
  const doc = sample();
  s.write(doc);
  assert.deepEqual(s.read(), doc);
});

test("PresetStore: un file rotto o con un preset non valido dà un elenco vuoto, senza eccezioni", () => {
  const dir = tmpDir();
  try {
    const s = new PresetStore({ dbPath: path.join(dir, "lens.db") });
    fs.writeFileSync(s.path, "{");
    assert.deepEqual(s.read(), EMPTY_PRESETS);
    const doc = sample();
    fs.writeFileSync(s.path, JSON.stringify({ ...doc, presets: [...doc.presets, ...doc.presets] }));
    assert.deepEqual(s.read(), EMPTY_PRESETS, "preset duplicato");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PresetStore: un file non valido viene copiato in dashboard-presets.bad.json prima di essere sovrascritto, una volta sola", () => {
  const dir = tmpDir();
  try {
    const s = new PresetStore({ dbPath: path.join(dir, "lens.db") });
    assert.equal(s.badFile, path.join(dir, "dashboard-presets.bad.json"));
    const doc = sample();
    const broken = JSON.stringify({ ...doc, presets: [...doc.presets, ...doc.presets] });
    fs.writeFileSync(s.path, broken);
    assert.deepEqual(s.read(), EMPTY_PRESETS);
    assert.equal(fs.readFileSync(s.badFile, "utf8"), broken, "la copia ha il contenuto originale");
    s.write(sample("Altro")); // the next save replaces the file…
    fs.writeFileSync(s.path, "{"); // …and a second bad file must not replace the first copy
    assert.deepEqual(s.read(), EMPTY_PRESETS);
    assert.equal(fs.readFileSync(s.badFile, "utf8"), broken, "la prima copia non si sovrascrive");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PresetStore: lo stesso file non valido si segnala una volta sola, uno diverso di nuovo", (t) => {
  const dir = tmpDir();
  const lines = [];
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  setLogLevel("warn");
  try {
    const s = new PresetStore({ dbPath: path.join(dir, "lens.db") });
    fs.writeFileSync(s.path, "{");
    for (let i = 0; i < 3; i++) s.read(); // every page load reads it again
    assert.equal(lines.filter((l) => l.includes("non è JSON valido")).length, 1);
    fs.writeFileSync(s.path, "[1");
    s.read();
    assert.equal(lines.filter((l) => l.includes("non è JSON valido")).length, 2, "un contenuto diverso si segnala di nuovo");
  } finally {
    setLogLevel("error");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function startLens({ withStore = true } = {}) {
  const dir = tmpDir();
  const config = loadConfig({ LENS_PORT: "0", LENS_DB: path.join(dir, "lens.db") });
  const store = memoryStore();
  const presets = withStore ? new PresetStore({ dbPath: config.dbPath }) : null;
  const server = createServer({ config, store, queries: new Queries(store), collector, presets });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  return {
    port: addr.port,
    dir,
    close() {
      server.close();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function request(port, { path: p = "/api/presets", method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const post = (port, body, headers = {}) => request(port, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("GET /api/presets: vuoto e canSave all'inizio, i preset dopo il POST", async () => {
  const lens = await startLens();
  try {
    assert.deepEqual(JSON.parse((await request(lens.port)).body), { version: 1, presets: [], canSave: true });
    const doc = sample();
    const r = await post(lens.port, doc, { origin: `http://127.0.0.1:${lens.port}` });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(JSON.parse(r.body), { ok: true });
    assert.deepEqual(JSON.parse((await request(lens.port)).body), { ...doc, canSave: true });
    assert.ok(fs.existsSync(path.join(lens.dir, "dashboard-presets.json")));
  } finally {
    lens.close();
  }
});

test("POST /api/presets: un nome doppio è 400 con gli errori, e il file non cambia", async () => {
  const lens = await startLens();
  try {
    const doc = sample();
    const dup = { ...doc, presets: [...doc.presets, { ...doc.presets[0], id: "p-altro", name: " casa " }] };
    const r = await post(lens.port, dup);
    assert.equal(r.status, 400);
    assert.match(JSON.parse(r.body).errors.join(), /nome già in uso/);
    assert.equal(fs.existsSync(path.join(lens.dir, "dashboard-presets.json")), false);
  } finally {
    lens.close();
  }
});

test("POST /api/presets: dietro un proxy è 403 e canSave è falso; text/plain è 415", async () => {
  const lens = await startLens();
  try {
    assert.equal((await post(lens.port, sample(), { via: "1.1 nginx" })).status, 403);
    assert.equal(JSON.parse((await request(lens.port, { headers: { via: "1.1 nginx" } })).body).canSave, false);
    assert.equal((await request(lens.port, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status, 415);
  } finally {
    lens.close();
  }
});

test("POST /api/presets: accetta corpi oltre i 64 KB di /api/dashboard, ma non oltre 1 MiB", async () => {
  const lens = await startLens();
  try {
    // too big for the layout endpoint, fine for presets; past 1 MiB it is refused by size (413)
    assert.equal((await post(lens.port, { version: 1, presets: [], pad: "x".repeat(100 * 1024) })).status, 200);
    assert.equal((await post(lens.port, { version: 1, presets: [], pad: "x".repeat(1100 * 1024) })).status, 413);
  } finally {
    lens.close();
  }
});

test("/api/about elenca dashboard-presets.json tra i file scritti e la disinstallazione lo cancella", () => {
  const dir = tmpDir();
  try {
    const config = loadConfig({ LENS_DB: path.join(dir, "lens.db") });
    const store = memoryStore();
    const a = about({ config, store, collector, presets: new PresetStore({ dbPath: config.dbPath }), defaultDbPath: "/altrove/lens.db" });
    const f = a.files.written.find((x) => x.label === "Preset della dashboard");
    assert.equal(f.path, path.join(dir, "dashboard-presets.json"));
    assert.match(a.uninstall, /dashboard-presets\.json/);
    assert.equal(a.files.written.find((x) => x.label === "Preset della dashboard (file non valido)").path, path.join(dir, "dashboard-presets.bad.json"));
    assert.match(a.uninstall, /dashboard-presets\.bad\.json/);
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/presets senza il file dei preset: 404", async () => {
  const lens = await startLens({ withStore: false });
  try {
    assert.equal((await request(lens.port)).status, 404);
  } finally {
    lens.close();
  }
});
