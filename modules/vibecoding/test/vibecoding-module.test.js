// Vibe Coding seen from the core: its routes on a real ctx, its projects file, hasData (which only reads) and files.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addSession, addStep, memoryStore, moduleContext, Queries } from "../../../test/module-test-kit.js";
import { EMPTY_VIBE_PROJECTS, addProject, validateVibeProjects } from "../public/vibe-projects.js";
import { create, files, hasData } from "../server/index.js";
import { vibeCoding } from "../server/vibe-queries.js";

const COLLECTOR = { state: "connected", status: () => ({ state: "connected" }) };
const QUIET = { info() {}, warn() {}, error() {} };
const ONE = addProject(EMPTY_VIBE_PROJECTS, "Lavoro", "p_lavoro");

/** A ctx on an in-memory store whose data folder is `dbPath`'s directory (":memory:" by default). */
function setup(dbPath = ":memory:") {
  const store = memoryStore();
  const queries = new Queries(store);
  const ctx = moduleContext({ id: "vibecoding", config: { dbPath, scanIntervalMs: 60_000 }, store, collector: COLLECTOR, queries, log: QUIET });
  return { store, queries, ctx };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lens-vibe-"));
}

test("create(ctx): le quattro route, la POST con corpo JSON limitato a 256 KiB e «i progetti»", () => {
  const { store, ctx } = setup();
  try {
    const { routes } = create(ctx);
    assert.deepEqual(Object.keys(routes).sort(), ["GET /api/vibe-coding", "GET /api/vibe-coding/history", "GET /api/vibe-projects", "POST /api/vibe-projects"]);
    const post = routes["POST /api/vibe-projects"];
    assert.deepEqual(post.body, { type: "json", max: 256 * 1024 });
    assert.equal(post.what, "i progetti");
    assert.equal(typeof post.handler, "function");
  } finally {
    store.close();
  }
});

test("GET /api/vibe-coding: il periodo da ctx.range, la risposta di vibeCoding", (t) => {
  const now = new Date(2026, 9, 20, 15, 30).getTime();
  t.mock.timers.enable({ apis: ["Date"], now });
  const { store, ctx } = setup();
  try {
    addSession(store, { id: "ses_1", directory: "/w/alpha" });
    addStep(store, { id: "s1", started: now - 3_600_000, ended: now - 3_000_000, cost: 1 });
    const url = new URL(`http://lens/api/vibe-coding?from=${now - 86_400_000}&to=${now + 60_000}`);
    const mod = create(ctx);
    const got = mod.routes["GET /api/vibe-coding"]({}, { url, local: true });
    const r = ctx.range(url.searchParams);
    const { rev } = got.pricing;
    assert.deepEqual(got, { ...vibeCoding(ctx, r.from, r.to, now), pricing: { empty: ctx.prices.empty, rev } });
    assert.equal(got.totals.steps, 1);
    // the same price stamp on the history, so the page can tell a history read on other prices
    assert.equal(typeof rev, "string");
    assert.deepEqual(mod.routes["GET /api/vibe-coding/history"]().pricing, { empty: ctx.prices.empty, rev });
    t.mock.timers.tick(5);
    assert.notEqual(create(ctx).routes["GET /api/vibe-coding"]({}, { url, local: true }).pricing.rev, rev, "a new instance (the lens restarted after a price list save) has another stamp");
    // from=day: the budget day
    const day = create(ctx).routes["GET /api/vibe-coding"]({}, { url: new URL("http://lens/api/vibe-coding?from=day"), local: true });
    assert.deepEqual([day.from, day.to], [ctx.range(new URLSearchParams("from=day")).from, ctx.range(new URLSearchParams("from=day")).to]);
  } finally {
    store.close();
  }
});

test("GET e POST /api/vibe-projects: canSave dal client locale, POST validata, 400 con gli errori", async () => {
  const dir = tempDir();
  const { store, ctx } = setup(path.join(dir, "lens.db"));
  try {
    const { routes } = create(ctx);
    assert.deepEqual(routes["GET /api/vibe-projects"]({}, { local: true }), { ...EMPTY_VIBE_PROJECTS, projects: [], canSave: true });
    assert.equal(routes["GET /api/vibe-projects"]({}, { local: false }).canSave, false);
    const save = routes["POST /api/vibe-projects"].handler;
    assert.deepEqual(await save({}, { body: ONE, local: true }), { ok: true });
    assert.deepEqual(routes["GET /api/vibe-projects"]({}, { local: true }), { ...ONE, canSave: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "vibe-projects.json"), "utf8")), ONE);
    const bad = await save({}, { body: { version: 2, projects: [] }, local: true });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body, { errors: validateVibeProjects({ version: 2, projects: [] }).errors });
    assert.deepEqual(routes["GET /api/vibe-projects"]({}, { local: true }), { ...ONE, canSave: true }, "un rifiuto non tocca il file");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validateVibeProjects senza t: il testo italiano con i segnaposto riempiti", () => {
  assert.deepEqual(validateVibeProjects({ version: 2, projects: [] }).errors, ["versione 2 non supportata (atteso 1)"]);
  assert.deepEqual(validateVibeProjects({ version: 3, projects: [] }, (text, params) => `${text}|${params.version}`).errors, ["versione {version} non supportata (atteso 1)|3"]);
});

test("hasData: vero con almeno un progetto valido; falso senza file, vuoto, non JSON, non valido o senza progetti; la cartella resta com'era", async () => {
  const dir = tempDir();
  const { store, ctx } = setup(path.join(dir, "lens.db"));
  const file = path.join(dir, "vibe-projects.json");
  try {
    assert.equal(await hasData(ctx), false, "senza file");
    assert.deepEqual(fs.readdirSync(dir), []);
    const cases = [
      ["", false, "file vuoto"],
      ["{non json", false, "non JSON"],
      [JSON.stringify({ version: 1, projects: [{ id: "x" }] }), false, "non valido"],
      [JSON.stringify(EMPTY_VIBE_PROJECTS), false, "senza progetti"],
      [JSON.stringify(ONE), true, "un progetto"],
    ];
    for (const [text, expected, label] of cases) {
      fs.writeFileSync(file, text);
      assert.equal(await hasData(ctx), expected, label);
      assert.deepEqual(fs.readdirSync(dir), ["vibe-projects.json"], `${label}: nessun file nuovo (né .bad.json)`);
      assert.equal(fs.readFileSync(file, "utf8"), text, `${label}: il file non cambia`);
    }
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const memory = setup();
  try {
    assert.equal(await hasData(memory.ctx), false, "database in memoria: nessun file");
  } finally {
    memory.store.close();
  }
});

test("files: vibe-projects.json e la sua copia .bad.json nella cartella dei dati; niente con il database in memoria", () => {
  const dir = tempDir();
  const { store, ctx } = setup(path.join(dir, "lens.db"));
  try {
    assert.deepEqual(files(ctx), [
      { label: "Progetti di Vibe Coding", path: path.join(dir, "vibe-projects.json"), note: "i progetti che crei da «Vibe Coding»: nomi, colori, budget e cartelle, configurazione tua, mai prompt o risposte" },
      { label: "Progetti di Vibe Coding (file non valido)", path: path.join(dir, "vibe-projects.bad.json"), note: "copia di vibe-projects.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse" },
    ]);
    assert.deepEqual(fs.readdirSync(dir), [], "elencare i file non ne crea");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const memory = setup();
  try {
    assert.deepEqual(files(memory.ctx), []);
  } finally {
    memory.store.close();
  }
});
