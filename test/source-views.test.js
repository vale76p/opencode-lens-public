// src/source-views.js: OpenCode's queries over TEMP views of an alternative source, here the demo module's items.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Localized } from "../public/i18n.js";
import { openSource, sourceConnection, sourceQueries } from "../src/source-views.js";
import { moduleContext } from "../src/module-kit.js";
import { Queries } from "../src/queries.js";
import { TABLE_COLUMNS } from "../src/schema.js";
import demoTables from "./fixtures/modules/demo/tables.js";
import { create, DEMO_LIMITS } from "./fixtures/modules/demo/server/index.js";
import { addPrompt, addSession, addStep, fileStore, memoryStore, tokens } from "./helpers.js";

const NOW = Date.now();
const quiet = { info() {}, warn() {}, error() {} };

/** A lens database on file with the demo's tables, one OpenCode step and two demo items (one ended); the demo's source(). */
function setup() {
  const store = fileStore({ moduleTables: [{ id: "demo", ...demoTables }] });
  addSession(store, { id: "ses_1", created: NOW - 3_600_000 });
  addStep(store, { id: "msg_1", started: NOW - 3_000_000, ended: NOW - 2_990_000, cost: 0.02, tokens: tokens(1000, 200) });
  addPrompt(store, { id: "prm_1", created: NOW - 3_100_000 });
  store.meta("retention_from", String(NOW - 86_400_000 * 30));
  const ins = store.db.prepare("INSERT INTO demo_items (id, name, created, ended) VALUES (?, 'x', ?, ?)");
  ins.run("a", NOW - 7_200_000, NOW - 7_100_000);
  ins.run("b", NOW - 60_000, null);
  const ctx = moduleContext({ id: "demo", config: { dbPath: store.dbPath, scanIntervalMs: 120_000 }, store, collector: null, queries: new Queries(store), log: quiet, tables: demoTables, source: true });
  return { store, src: create(ctx).source() };
}

test("sourceConnection only: le viste hanno le sole righe della sorgente, vuote quelle che non ha, meta senza retention_from", () => {
  const { store, src } = setup();
  const db = sourceConnection(store.dbPath, "only", src.selects);
  try {
    assert.deepEqual(db.prepare("SELECT id FROM steps ORDER BY id").all().map((r) => r.id), ["demo:a", "demo:b"]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM runs").get().n, 1, "only the ended item");
    for (const t of ["internal_usage", "signals", "permissions", "daily_steps", "daily_tools", "tools"]) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM meta WHERE key = 'retention_from'").get().n, 0);
    assert.ok(db.prepare("SELECT COUNT(*) n FROM meta").get().n > 0, "the rest of meta stays");
    // the columns are OpenCode's, in its order
    assert.deepEqual(Object.keys(db.prepare("SELECT * FROM steps LIMIT 1").get()), TABLE_COLUMNS.steps.split(", "));
  } finally {
    db.close();
    store.close();
  }
});

test("sourceConnection add: OpenCode più la sorgente; una select con WITH funziona anche dopo UNION ALL", () => {
  const { store, src } = setup();
  const withSteps = `WITH x AS (SELECT * FROM demo_items) -- a comment at the end
    ${src.selects.steps.replace("FROM demo_items", "FROM x")} -- and another`;
  const db = sourceConnection(store.dbPath, "add", { ...src.selects, steps: withSteps });
  try {
    assert.deepEqual(db.prepare("SELECT id FROM steps ORDER BY id").all().map((r) => r.id), ["demo:a", "demo:b", "msg_1"]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM meta WHERE key = 'retention_from'").get().n, 1, "OpenCode's meta with both");
  } finally {
    db.close();
    store.close();
  }
});

test("sourceConnection add: ORDER BY e LIMIT in cima a una select tagliano solo le righe della sorgente, non quelle di OpenCode", () => {
  const { store, src } = setup();
  const db = sourceConnection(store.dbPath, "add", { ...src.selects, steps: `${src.selects.steps} ORDER BY 1 DESC LIMIT 1 -- the newest only` });
  try {
    assert.deepEqual(db.prepare("SELECT id FROM steps ORDER BY id").all().map((r) => r.id), ["demo:b", "msg_1"]);
  } finally {
    db.close();
    store.close();
  }
});

test("sourceConnection: una select che non è una sola SELECT, con una colonna in meno o che SQLite rifiuta → lancia col motivo", () => {
  const { store, src } = setup();
  try {
    const bad = {
      "due istruzioni": "SELECT 1; SELECT 2",
      "non una select": "DELETE FROM demo_items",
      vuota: "",
      "una colonna in meno": src.selects.runs.replace(", NULL AS reason", ""),
      "tabella che non c'è": "SELECT * FROM assente",
    };
    for (const [why, sql] of Object.entries(bad)) {
      for (const mode of ["only", "add"]) {
        const view = why === "una colonna in meno" ? "runs" : "steps";
        assert.throws(() => sourceConnection(store.dbPath, mode, { ...src.selects, [view]: sql }), Error, `${why} (${mode})`);
      }
    }
    assert.throws(() => sourceConnection(store.dbPath, "only", { ...src.selects, steps: "SELECT 1; SELECT 2" }), /la select di steps deve essere una sola SELECT o WITH/);
    assert.throws(() => sourceConnection(store.dbPath, "only", { ...src.selects, tools: undefined }), /tools/);
    assert.throws(() => sourceConnection(store.dbPath, "only", null), /servono le select/);
  } finally {
    store.close();
  }
});

test("sourceQueries: null in memoria; «only» con i limiti della sorgente, senza budget per modello né modelli di OpenCode; «add» con quelli di OpenCode", () => {
  const { store, src } = setup();
  const memory = memoryStore();
  assert.equal(sourceQueries(":memory:", {}, src), null);
  memory.close();
  const options = { limits: { tokens: 1, cost: 1, steps: 1 }, modelLimits: [{ model: "x", tokens: 1 }], opencodeModels: { fake: true }, contextLimits: { "a/b": 5 } };
  const q = sourceQueries(store.dbPath, options, src);
  try {
    assert.deepEqual(q.only.limits, DEMO_LIMITS.limits);
    assert.deepEqual(q.only.weeklyLimits, DEMO_LIMITS.weeklyLimits);
    assert.deepEqual(q.only.monthlyLimits, DEMO_LIMITS.monthlyLimits);
    assert.deepEqual(q.only.modelLimits, []);
    assert.equal(q.only.opencodeModels, null);
    assert.deepEqual(q.only.contextLimits, { "a/b": 5, "demo/demo": 1000 });
    assert.deepEqual(q.add.limits, options.limits);
    assert.deepEqual(q.add.contextLimits, { "a/b": 5, "demo/demo": 1000 });
    const r = q.only.range(0);
    assert.equal(q.only.summary(r.from, r.to).steps, 2);
    assert.equal(q.add.summary(r.from, r.to).steps, 3);
    // «Tutto» of the source alone starts from its data, not from OpenCode's retention_from
    assert.ok(r.from > NOW - 86_400_000, "range(0) of «only» from the oldest demo item");
  } finally {
    q.close();
    store.close();
  }
});

test("sourceQueries: senza limiti la sorgente da sola non ha budget; source senza selects → lancia", () => {
  const { store, src } = setup();
  const q = sourceQueries(store.dbPath, { limits: { tokens: 1, cost: 1, steps: 1 } }, { selects: src.selects });
  try {
    const none = { tokens: null, cost: null, steps: null };
    assert.deepEqual([q.only.limits, q.only.weeklyLimits, q.only.monthlyLimits], [none, none, none]);
  } finally {
    q.close();
  }
  assert.throws(() => sourceQueries(store.dbPath, {}, null), /source\(\) deve restituire/);
  assert.throws(() => sourceQueries(store.dbPath, {}, { selects: { ...src.selects, prompts: "SELECT 1; SELECT 2" } }), /prompts/);
  store.close();
});

test("sourceQueries: le connessioni sono in sola lettura, una scrittura lancia", () => {
  const { store, src } = setup();
  const q = sourceQueries(store.dbPath, {}, src);
  try {
    for (const db of [q.only.db, q.add.db]) {
      assert.throws(() => db.exec("INSERT INTO main.meta (key, value) VALUES ('x', 'y')"), /readonly/);
      assert.throws(() => db.exec("DELETE FROM main.demo_items"), /readonly/);
    }
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM demo_items").get().n, 2);
  } finally {
    q.close();
    store.close();
  }
});

test("openSource: senza sorgente null; una sorgente che non va → null e registry.fail col motivo", async () => {
  const { store, src } = setup();
  const failed = [];
  const registry = (given) => ({ source: () => given, fail: async (id, reason) => failed.push([id, reason]) });
  try {
    assert.equal(await openSource({ registry: registry(null), dbPath: store.dbPath, options: {} }), null);
    const ok = await openSource({ registry: registry({ id: "demo", label: "Demo", instance: { source: () => src } }), dbPath: store.dbPath, options: {} });
    assert.equal(ok.id, "demo");
    assert.equal(ok.label, "Demo");
    assert.equal(ok.totals(0, NOW + 1).items, 2);
    ok.views.close();
    assert.deepEqual(failed, []);
    const broken = [
      () => {
        throw new Error("rotta");
      },
      () => ({ ...src, totals: undefined }),
      () => ({ ...src, selects: { ...src.selects, sessions: "SELECT 1" } }),
    ];
    for (const source of broken) assert.equal(await openSource({ registry: registry({ id: "demo", label: "Demo", instance: { source } }), dbPath: store.dbPath, options: {} }), null);
    assert.equal(failed.length, 3);
    for (const [id, reason] of failed) {
      assert.equal(id, "demo");
      assert.ok(reason instanceof Localized);
      assert.match(reason.message, /^sorgente non disponibile: /);
    }
    assert.match(failed[0][1].message, /rotta/);
  } finally {
    store.close();
  }
});
