// Disposizione della dashboard salvata nella lens: dashboard-v2.json (dashboard.json solo letto) e /api/dashboard.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createServer, isLoopbackPeer } from "../src/server.js";
import { DashboardStore, usesNewSettings } from "../src/dashboard.js";
import { Queries } from "../src/queries.js";
import { about } from "../src/about.js";
import { setLogLevel } from "../src/log.js";
import { DEFAULT_LAYOUT } from "../public/layout.js";
import { memoryStore } from "./helpers.js";

setLogLevel("error");

const LAYOUT = { version: 1, widgets: [{ id: "w-oggi", type: "today", x: 0, y: 0, w: 6, h: 5, settings: { title: "Il mio oggi" } }] };
const LAYOUT_V2 = {
  version: 2,
  views: {
    adesso: { widgets: [{ id: "w-hero", type: "hero", x: 0, y: 0, w: 8, h: 8, settings: { title: "Il mio oggi" } }] },
    analisi: { widgets: [{ id: "w-trend", type: "trend", x: 0, y: 0, w: 12, h: 8, settings: {} }] },
    monitor: { widgets: [] }, // without it validateLayout adds the default Monitor
  },
};
const collector = { state: "connected", status: () => ({ state: "connected", server: null, scan: {}, drift: [] }) };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lens-dash-"));
}

test("DashboardStore: scrive, rilegge, resetta; nessun .tmp rimasto", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    assert.equal(d.path, path.join(dir, "dashboard-v2.json"));
    assert.equal(d.legacyFile, path.join(dir, "dashboard.json"));
    assert.equal(d.read(), null);
    d.write(LAYOUT_V2);
    assert.deepEqual(d.read(), { layout: LAYOUT_V2, migrated: false });
    assert.deepEqual(fs.readdirSync(dir), ["dashboard-v2.json"]);
    assert.equal(fs.statSync(d.path).mode & 0o777, 0o600, "leggibile solo dal proprietario");
    d.reset();
    assert.equal(d.read(), null);
    assert.equal(fs.existsSync(d.path), false);
    d.reset(); // già assente: nessun errore
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DashboardStore: in memoria con LENS_DB=:memory:", () => {
  const d = new DashboardStore({ dbPath: ":memory:" });
  assert.equal(d.path, null);
  d.write(LAYOUT_V2);
  assert.deepEqual(d.read(), { layout: LAYOUT_V2, migrated: false });
  d.reset();
  assert.equal(d.read(), null);
});

test("DashboardStore: file rotto o non valido → null", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    fs.writeFileSync(d.path, "{");
    assert.equal(d.read(), null);
    fs.writeFileSync(d.path, JSON.stringify({ version: 2, views: { adesso: { widgets: [] } } }));
    assert.equal(d.read(), null, "v2 senza la vista analisi");
    const over = { version: 1, widgets: [LAYOUT.widgets[0], { id: "b", type: "feed", x: 3, y: 2, w: 6, h: 5, settings: {} }] };
    fs.writeFileSync(d.path, JSON.stringify(over));
    assert.equal(d.read(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DashboardStore: tipo sconosciuto conservato a ogni salvataggio", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    const future = structuredClone(LAYOUT_V2);
    future.views.analisi.widgets.push({ id: "w-futuro", type: "heatmap-3d", x: 0, y: 8, w: 4, h: 4, settings: { colori: 7 } });
    d.write(future);
    assert.deepEqual(d.read().layout, future);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DashboardStore: il Riepilogo classico salvato da una lens precedente si rilegge come C22", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    const old = structuredClone(LAYOUT_V2);
    old.views.analisi.widgets.push({ id: "w-riep", type: "summary", x: 0, y: 8, w: 12, h: 5, settings: { style: "classic" } });
    fs.writeFileSync(d.file, JSON.stringify(old));
    const read = d.read().layout.views.analisi.widgets.find((w) => w.id === "w-riep");
    assert.equal(read.settings.style, "C22");
    assert.equal(old.views.analisi.widgets.at(-1).settings.style, "classic", "il file letto non è stato toccato in memoria");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("isLoopbackPeer: solo connessioni da questo computer", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isLoopbackPeer({ socket: { remoteAddress: a } }), true, a);
  for (const a of ["192.168.1.20", "::ffff:10.0.0.2", undefined]) assert.equal(isLoopbackPeer({ socket: { remoteAddress: a } }), false, String(a));
});

async function startLens(env = {}) {
  const dir = tmpDir();
  const config = loadConfig({ LENS_PORT: "0", LENS_DB: path.join(dir, "lens.db"), ...env });
  const store = memoryStore();
  const dashboard = new DashboardStore({ dbPath: config.dbPath });
  const server = createServer({ config, store, queries: new Queries(store), collector, dashboard });
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

function request(port, { path: p = "/api/dashboard", method = "GET", headers = {}, body } = {}) {
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
const post = (port, body, headers = {}) =>
  request(port, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("GET /api/dashboard: null e canSave all'inizio, la disposizione dopo il POST", async () => {
  const lens = await startLens();
  try {
    assert.deepEqual(JSON.parse((await request(lens.port)).body), { layout: null, canSave: true, migrated: false });
    const r = await post(lens.port, LAYOUT_V2, { origin: `http://127.0.0.1:${lens.port}` });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(JSON.parse(r.body), { ok: true });
    assert.deepEqual(JSON.parse((await request(lens.port)).body), { layout: LAYOUT_V2, canSave: true, migrated: false });
    assert.ok(fs.existsSync(path.join(lens.dir, "dashboard-v2.json")));
    assert.equal(fs.existsSync(path.join(lens.dir, "dashboard.json")), false);
  } finally {
    lens.close();
  }
});

test("POST /api/dashboard: 400 con errors, reset, protezioni", async () => {
  const lens = await startLens();
  try {
    const bad = await post(lens.port, { version: 1, widgets: [{ id: "a", type: "bars", x: 10, y: 0, w: 4, h: 8, settings: {} }] });
    assert.equal(bad.status, 400);
    assert.ok(JSON.parse(bad.body).errors.length > 0);
    await post(lens.port, DEFAULT_LAYOUT);
    assert.equal((await post(lens.port, { reset: true })).status, 200);
    assert.equal(JSON.parse((await request(lens.port)).body).layout, null);
    assert.equal((await post(lens.port, LAYOUT, { origin: "http://evil.example" })).status, 403);
    assert.equal((await post(lens.port, LAYOUT, { "content-type": "text/plain" })).status, 415);
    const put = await request(lens.port, { method: "PUT" });
    assert.equal(put.status, 405);
    assert.equal(put.headers.allow, "GET, HEAD, POST");
  } finally {
    lens.close();
  }
  const secured = await startLens({ LENS_TOKEN: "0123456789abcdef" });
  try {
    assert.equal((await post(secured.port, LAYOUT)).status, 401);
    assert.equal((await request(secured.port)).status, 401);
  } finally {
    secured.close();
  }
});

test("/api/about elenca dashboard-v2.json e dashboard.json tra i file scritti e la disinstallazione lo cancella con LENS_DB personalizzato", () => {
  const dir = tmpDir();
  try {
    const config = loadConfig({ LENS_DB: path.join(dir, "lens.db") });
    const store = memoryStore();
    const dashboard = new DashboardStore({ dbPath: config.dbPath });
    const a = about({ config, store, collector, dashboard, defaultDbPath: "/altrove/lens.db" });
    const f = a.files.written.find((x) => x.label === "Disposizione della dashboard");
    assert.equal(f.path, path.join(dir, "dashboard-v2.json"));
    const old = a.files.written.find((x) => x.path === path.join(dir, "dashboard.json"));
    assert.ok(old, "anche dashboard.json tra i file scritti");
    assert.match(a.uninstall, /dashboard-v2\.json/);
    assert.match(a.uninstall, /dashboard\.json/);
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("read: v2 se c'è, altrimenti migra dashboard.json", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    fs.writeFileSync(d.legacyFile, JSON.stringify(LAYOUT));
    const m = d.read();
    assert.equal(m.migrated, true);
    assert.equal(m.layout.version, 2);
    assert.ok(m.layout.views.adesso && m.layout.views.analisi);
    d.write(LAYOUT_V2);
    assert.deepEqual(d.read(), { layout: LAYOUT_V2, migrated: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard-v2.json non valido → si migra dashboard.json", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    fs.writeFileSync(d.legacyFile, JSON.stringify(LAYOUT));
    fs.writeFileSync(d.file, "{ rotto");
    assert.equal(d.read().migrated, true);
    fs.writeFileSync(d.file, JSON.stringify({ version: 2, views: { adesso: { widgets: [{ id: "a", type: "hero", x: 99, y: 0, w: 4, h: 4, settings: {} }] }, analisi: { widgets: [] } } }));
    assert.equal(d.read().migrated, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("write non tocca dashboard.json; reset cancella solo dashboard-v2.json", async () => {
  const lens = await startLens();
  try {
    const legacy = path.join(lens.dir, "dashboard.json");
    const bytes = `${JSON.stringify(LAYOUT, null, 4)}\n`;
    fs.writeFileSync(legacy, bytes);
    const r = await post(lens.port, LAYOUT_V2);
    assert.equal(r.status, 200, r.body);
    assert.equal(fs.readFileSync(legacy, "utf8"), bytes, "dashboard.json identico byte per byte");
    const saved = JSON.parse(fs.readFileSync(path.join(lens.dir, "dashboard-v2.json"), "utf8"));
    assert.equal(saved.version, 2);
    assert.deepEqual(saved, LAYOUT_V2);
    assert.equal((await post(lens.port, { reset: true })).status, 200);
    assert.equal(fs.existsSync(path.join(lens.dir, "dashboard-v2.json")), false);
    assert.equal(fs.readFileSync(legacy, "utf8"), bytes);
    // with no v2 file the old one is migrated again
    assert.equal(JSON.parse((await request(lens.port)).body).migrated, true);
  } finally {
    lens.close();
  }
});

test("POST v1 viene migrata e salvata come v2", async () => {
  const lens = await startLens();
  try {
    const r = await post(lens.port, LAYOUT);
    assert.equal(r.status, 200, r.body);
    const saved = JSON.parse(fs.readFileSync(path.join(lens.dir, "dashboard-v2.json"), "utf8"));
    assert.equal(saved.version, 2);
    assert.ok(saved.views.adesso && saved.views.analisi);
    assert.equal(fs.existsSync(path.join(lens.dir, "dashboard.json")), false);
  } finally {
    lens.close();
  }
});

test("POST v2 non valida → 400 con errori per vista", async () => {
  const lens = await startLens();
  try {
    const bad = structuredClone(LAYOUT_V2);
    bad.views.analisi.widgets[0].x = 10;
    const r = await post(lens.port, bad);
    assert.equal(r.status, 400);
    assert.ok(JSON.parse(r.body).errors.some((e) => e.startsWith("Analisi")), r.body);
    assert.equal(fs.existsSync(path.join(lens.dir, "dashboard-v2.json")), false);
  } finally {
    lens.close();
  }
});

test(":memory: resta in memoria (nessun file) anche via POST", async () => {
  const config = loadConfig({ LENS_PORT: "0", LENS_DB: ":memory:" });
  const store = memoryStore();
  const dashboard = new DashboardStore({ dbPath: config.dbPath });
  const server = createServer({ config, store, queries: new Queries(store), collector, dashboard });
  const addr = await server.listen();
  config.allowedHosts.add(`127.0.0.1:${addr.port}`);
  try {
    assert.equal(dashboard.legacyFile, null);
    assert.equal((await post(addr.port, LAYOUT_V2)).status, 200);
    assert.deepEqual(JSON.parse((await request(addr.port)).body).layout, LAYOUT_V2);
  } finally {
    server.close();
    store.close();
  }
});

// a v2 saved by a lens before the styles: no `style` on the hero (that lens refused one, «classic» too)
const OLD_V2 = { version: 2, views: { adesso: { widgets: [{ id: "w-hero", type: "hero", x: 0, y: 0, w: 8, h: 8, settings: {} }] }, analisi: { widgets: [] } } };
const NEW_STYLES = { version: 2, views: { ...LAYOUT_V2.views, adesso: { widgets: [{ id: "w-hero", type: "hero", x: 0, y: 0, w: 8, h: 8, settings: { style: "G1" } }] } } };

test("prima scrittura con stili nuovi copia la disposizione in dashboard-v2.prev.json", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    fs.writeFileSync(d.file, JSON.stringify(OLD_V2));
    d.write(NEW_STYLES);
    assert.equal(fs.readFileSync(path.join(dir, "dashboard-v2.prev.json"), "utf8"), JSON.stringify(OLD_V2));
    assert.equal(JSON.parse(fs.readFileSync(d.file, "utf8")).views.adesso.widgets[0].settings.style, "G1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("la copia non si sovrascrive", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    const prev = path.join(dir, "dashboard-v2.prev.json");
    fs.writeFileSync(d.file, JSON.stringify(OLD_V2));
    fs.writeFileSync(prev, "originale");
    d.write(NEW_STYLES);
    assert.equal(fs.readFileSync(prev, "utf8"), "originale");
    // the file on disk is now new: a further save makes no copy either
    fs.rmSync(prev);
    d.write(NEW_STYLES);
    assert.equal(fs.existsSync(prev), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("senza impostazioni nuove nessuna copia", () => {
  const dir = tmpDir();
  try {
    const d = new DashboardStore({ dbPath: path.join(dir, "lens.db") });
    fs.writeFileSync(d.file, JSON.stringify(OLD_V2));
    d.write(OLD_V2);
    assert.equal(fs.existsSync(path.join(dir, "dashboard-v2.prev.json")), false);
    assert.equal(usesNewSettings(OLD_V2), false);
    assert.equal(usesNewSettings({ version: 2, views: { adesso: { widgets: [{ type: "budget", settings: {} }] } } }), true);
    assert.equal(usesNewSettings({ version: 2, views: { analisi: { widgets: [{ type: "runs", settings: { cols: ["ora"] } }] } } }), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("usesNewSettings: «classic» è nuovo sui tipi che prima non avevano style", () => {
  const one = (type, style) => usesNewSettings({ version: 2, views: { analisi: { widgets: [{ type, settings: { style } }] } } });
  // a lens before the styles refused any `style` on these types, «classic» too
  for (const type of ["hero", "model-day", "feed", "runs", "run-stats", "calendar", "breakdown"]) assert.equal(one(type, "classic"), true, type);
  // and accepted only its own values on the two that had one
  for (const [type, style] of [["trend", "columns"], ["trend", "line"], ["gauge", "semi"], ["gauge", "ring"]]) assert.equal(one(type, style), false, `${type} ${style}`);
  for (const [type, style] of [["trend", "classic"], ["trend", "G2"], ["gauge", "B1"], ["gauge", "columns"]]) assert.equal(one(type, style), true, `${type} ${style}`);
});

test("about elenca dashboard-v2.prev.json", () => {
  const dir = tmpDir();
  try {
    const config = loadConfig({ LENS_DB: path.join(dir, "lens.db") });
    const store = memoryStore();
    const a = about({ config, store, collector, dashboard: new DashboardStore({ dbPath: config.dbPath }), defaultDbPath: "/altrove/lens.db" });
    const f = a.files.written.find((x) => x.label === "Disposizione della dashboard (prima degli stili)");
    assert.equal(f.path, path.join(dir, "dashboard-v2.prev.json"));
    assert.match(a.uninstall, /dashboard-v2\.prev\.json/);
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/dashboard: «Mostra i costi» (prefs.costs) si salva e torna con la disposizione", async () => {
  const lens = await startLens();
  try {
    const withPrefs = { ...structuredClone(LAYOUT_V2), prefs: { costs: false } };
    const r = await post(lens.port, withPrefs, { origin: `http://127.0.0.1:${lens.port}` });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(JSON.parse((await request(lens.port)).body).layout.prefs, { costs: false });
    const bad = await post(lens.port, { ...structuredClone(LAYOUT_V2), prefs: { costs: "no" } }, { origin: `http://127.0.0.1:${lens.port}` });
    assert.equal(bad.status, 400);
    assert.match(bad.body, /prefs\.costs deve essere true o false/);
  } finally {
    lens.close();
  }
});
