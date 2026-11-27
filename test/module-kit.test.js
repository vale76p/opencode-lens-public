// The ctx a module receives (src/module-kit.js): the read-only SQL reader, the SQL fragments and period helpers
// of the core, the monthly budget, its own JSON files and the period of a request.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { errorText, Localized, N_, t } from "../public/i18n.js";
import { CORE_FILES } from "../src/core-paths.js";
import { moduleContext, settingsContext } from "../src/module-kit.js";
import { budgetDayOf, DAY_MS, localDay, MIDNIGHT, periodBounds } from "../src/period.js";
import { FOLDER, Queries, ST_TOKENS, ST_TS, TOKENS, tokensOf } from "../src/queries.js";
import { contractMisses, defineReader, Watermark } from "../src/reader.js";
import { MODEL_KEY, STEP_START, STEP_TS, TABLE_COLUMNS, TOOL_TS } from "../src/schema.js";
import demoTables from "./fixtures/modules/demo/tables.js";
import { extractPlan, planEntries } from "../src/update.js";
import { ZipError, entryData, readZipEntries } from "../src/zip.js";
import { addStep, makeZip, memoryStore } from "./helpers.js";

const quiet = { info() {}, warn() {}, error() {} };
const collector = { state: "connected", status: () => ({ state: "connected" }) };

function setup({ config = {}, queryOptions = {} } = {}) {
  const store = memoryStore();
  const queries = new Queries(store, queryOptions);
  const ctx = moduleContext({ id: "demo", config: { dbPath: ":memory:", scanIntervalMs: 120_000, ...config }, store, collector, queries, log: quiet });
  return { store, queries, ctx };
}

/** Counts of the store plus what a rejected statement could have touched outside them. */
function snapshot(store) {
  return {
    counts: store.counts(),
    steps: store.db.prepare("SELECT COUNT(*) n FROM steps").get().n,
    meta: store.db.prepare("SELECT COUNT(*) n FROM meta").get().n,
    version: store.db.prepare("PRAGMA user_version").get().user_version,
    databases: store.db.prepare("PRAGMA database_list").all().length,
    objects: store.db.prepare("SELECT COUNT(*) n FROM sqlite_master").get().n,
    schema: store.db.prepare("PRAGMA schema_version").get().schema_version,
    queryOnly: store.db.prepare("PRAGMA query_only").get().query_only,
  };
}

test("ctx.reader: all e get leggono il database dello Store", () => {
  const { store, ctx } = setup();
  addStep(store, { id: "msg_1", started: 1000, ended: 2000 });
  addStep(store, { id: "msg_2", started: 3000, ended: 4000 });
  assert.equal(ctx.reader.all("SELECT COUNT(*) n FROM steps")[0].n, 2);
  assert.equal(ctx.reader.get("WITH x AS (SELECT id FROM steps WHERE started > ?) SELECT COUNT(*) n FROM x", 1500).n, 1);
  assert.equal(ctx.reader.get("/* commento */ -- riga\n  select ';' AS s").s, ";", "commenti iniziali, minuscole, ; dentro una stringa");
  assert.ok(Object.isFrozen(ctx.reader));
});

test("ctx.reader: rifiuta ogni scrittura e il database resta com'era (Review Focus 4)", () => {
  const { store, ctx } = setup();
  // enough rows that pragma_optimize would really run ANALYZE
  for (let i = 0; i < 30; i++) addStep(store, { id: `msg_${i}`, started: 1000 * i, ended: 1000 * i + 500 });
  const before = snapshot(store);
  const writes = [
    "INSERT INTO meta (key, value) VALUES ('x', 'y')",
    "DELETE FROM steps",
    "WITH x AS (SELECT 1) DELETE FROM steps",
    "WITH x AS (SELECT 1) DELETE FROM steps RETURNING id",
    "PRAGMA user_version = 1",
    "ATTACH DATABASE ':memory:' AS altro",
    "SELECT 1; DELETE FROM steps",
    // more of the same kind
    "WITH x AS (SELECT 1) UPDATE steps SET model = 'x'",
    "WITH x(a) AS (SELECT 1) INSERT INTO meta (key, value) SELECT 'k', 'v' FROM x",
    // writes that EXPLAIN does not show: the ANALYZE of pragma_optimize is a statement of its own
    "SELECT * FROM pragma_optimize",
    'SELECT * FROM "pragma_optimize"(0x10002)',
    "SELECT * FROM 'pragma_optimize'(65538)",
    "WITH x AS (SELECT 1) SELECT * FROM x, pragma_optimize(-1)",
    "SELECT 1 /* ; */",
    "SELECT 1 -- '\n; DELETE FROM steps --'",
    "",
  ];
  for (const sql of writes) {
    for (const method of ["get", "all"]) {
      assert.throws(() => ctx.reader[method](sql), { message: "ctx.reader: solo letture" }, `${method}(${JSON.stringify(sql)})`);
    }
    assert.deepEqual(snapshot(store), before, sql);
  }
});

test("ctx.reader: dopo una lettura rifiutata o fallita lo Store scrive ancora", () => {
  const { store, ctx } = setup();
  for (let i = 0; i < 30; i++) addStep(store, { id: `msg_${i}`, started: 1000 * i, ended: 1000 * i + 500 });
  assert.throws(() => ctx.reader.all("SELECT * FROM pragma_optimize(0x10002)"), { message: "ctx.reader: solo letture" });
  assert.throws(() => ctx.reader.get("SELECT nessuna_colonna FROM steps"), /nessuna_colonna/);
  assert.equal(ctx.reader.get("SELECT COUNT(*) n FROM steps").n, 30);
  assert.equal(store.db.prepare("PRAGMA query_only").get().query_only, 0);
  addStep(store, { id: "msg_dopo", started: 99_000, ended: 99_500 });
  store.meta("prova", "1");
  assert.equal(store.counts().steps, 31);
  assert.equal(store.meta("prova"), "1");
});

test("ctx.reader: una lettura annidata non spegne query_only a metà della esterna", () => {
  const { store, ctx } = setup();
  const seen = [];
  // a test-only function on the test database: it runs inside the outer statement and reads through the reader again
  store.db.function("annidata", () => {
    seen.push(store.db.prepare("PRAGMA query_only").get().query_only);
    ctx.reader.get("SELECT 1 AS n");
    seen.push(store.db.prepare("PRAGMA query_only").get().query_only);
    return 1;
  });
  assert.equal(ctx.reader.get("SELECT annidata() AS n").n, 1);
  assert.deepEqual(seen, [1, 1], "dopo la lettura interna la esterna è ancora in sola lettura");
  assert.equal(store.db.prepare("PRAGMA query_only").get().query_only, 0, "alla fine lo Store scrive di nuovo");
});

test("ctx.reader: se l'accensione di query_only fallisce, la lettura seguente la riprova", () => {
  const { store, ctx } = setup();
  const exec = store.db.exec.bind(store.db);
  const execs = [];
  let fail = true;
  store.db.exec = (sql) => {
    execs.push(sql);
    if (fail && sql === "PRAGMA query_only = 1") {
      fail = false;
      throw new Error("exec finto: accensione fallita");
    }
    return exec(sql);
  };
  const seen = [];
  store.db.function("guardia", () => {
    seen.push(store.db.prepare("PRAGMA query_only").get().query_only);
    return 1;
  });
  assert.throws(() => ctx.reader.get("SELECT guardia() AS n"), /accensione fallita/);
  assert.deepEqual(seen, [], "la lettura non gira senza la guardia");
  execs.length = 0;
  assert.equal(ctx.reader.get("SELECT guardia() AS n").n, 1);
  assert.deepEqual(execs, ["PRAGMA query_only = 1", "PRAGMA query_only = 0"]);
  assert.deepEqual(seen, [1], "la lettura seguente gira in sola lettura");
  assert.equal(store.db.prepare("PRAGMA query_only").get().query_only, 0);
});

test("ctx.reader: lo stesso testo si prepara una volta sola", () => {
  const { store, ctx } = setup();
  const prepare = store.db.prepare.bind(store.db);
  const prepared = [];
  store.db.prepare = (sql) => {
    prepared.push(sql);
    return prepare(sql);
  };
  const sql = "SELECT COUNT(*) n FROM steps";
  ctx.reader.get(sql);
  ctx.reader.all(sql);
  ctx.reader.get(sql);
  assert.equal(prepared.filter((s) => s === sql).length, 1);
  assert.equal(prepared.filter((s) => s.startsWith("EXPLAIN ")).length, 1, "il controllo gira solo la prima volta");
});

test("ctx.reader: oltre 256 testi diversi è un errore esplicito", () => {
  const { ctx } = setup();
  for (let i = 0; i < 256; i++) assert.equal(ctx.reader.get(`SELECT ${i} AS n`).n, i);
  assert.throws(() => ctx.reader.get("SELECT 256 AS n"), { message: "ctx.reader: troppe istruzioni diverse" });
  assert.equal(ctx.reader.get("SELECT 7 AS n").n, 7, "i testi già preparati restano usabili");
});

test("ctx.sql, ctx.time, ctx.tokensOf, ctx.i18n: quelli del core, congelati", () => {
  const { ctx } = setup();
  assert.deepEqual({ ...ctx.sql }, { TS: STEP_TS, ST_TS, TOOL_TS, FOLDER, TOKENS, ST_TOKENS, MODEL_KEY, STEP_START, COLUMNS: ctx.sql.COLUMNS });
  assert.ok(Object.isFrozen(ctx.sql));
  // the column order of the core's tables, which a module's SELECTs for the views follow
  assert.deepEqual(Object.keys(ctx.sql.COLUMNS), ["steps", "sessions", "tools", "prompts", "runs"]);
  for (const k of Object.keys(ctx.sql.COLUMNS)) assert.equal(ctx.sql.COLUMNS[k], TABLE_COLUMNS[k], k);
  assert.ok(ctx.sql.COLUMNS.steps === TABLE_COLUMNS.steps);
  assert.ok(Object.isFrozen(ctx.sql.COLUMNS));
  assert.equal(ctx.time.periodBounds, periodBounds);
  assert.equal(ctx.time.localDay, localDay);
  assert.equal(ctx.time.budgetDayOf, budgetDayOf);
  assert.equal(ctx.time.DAY_MS, DAY_MS);
  assert.equal(ctx.time.MIDNIGHT, MIDNIGHT);
  assert.equal(ctx.time.reset, MIDNIGHT, "senza reset nel config");
  assert.ok(Object.isFrozen(ctx.time));
  assert.equal(ctx.tokensOf, tokensOf);
  assert.deepEqual(ctx.tokensOf({ t_in: 1, t_out: 2 }), { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 3 });
  assert.deepEqual({ ...ctx.i18n }, { t, N_, Localized, errorText });
  assert.ok(Object.isFrozen(ctx.i18n));
  const reset = { hour: 4, utc: true };
  assert.equal(setup({ config: { reset } }).ctx.time.reset, reset);
});

test("ctx.budgets.month: null senza budget mensile di costo, altrimenti la misura del mese", () => {
  const now = Date.now();
  assert.equal(setup().ctx.budgets.month(now), null);
  assert.equal(setup({ queryOptions: { monthlyLimits: { tokens: 1000, cost: null, steps: null } } }).ctx.budgets.month(now), null);
  const { store, queries, ctx } = setup({ queryOptions: { monthlyLimits: { tokens: null, cost: 50, steps: null } } });
  addStep(store, { id: "msg_1", started: now - 1000, ended: now - 500, cost: 5 });
  const month = ctx.budgets.month(now);
  assert.deepEqual(month, queries.period("month", queries.monthlyLimits, now).cost);
  assert.equal(month.limit, 50);
  assert.equal(month.used, 5);
});

test("ctx.jsonStore: un file del modulo accanto al database; il nome non esce dalla cartella", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-kit-"));
  try {
    const { ctx } = setup({ config: { dbPath: path.join(dir, "lens.db") } });
    const options = { validate: (doc) => ({ ok: true, doc }), empty: () => ({ items: [] }) };
    for (const name of ["../x.json", "a/b.json", "x.txt", "Demo.json", ".x.json", "", undefined]) {
      assert.throws(() => ctx.jsonStore({ name, ...options }), TypeError, String(name));
    }
    const store = ctx.jsonStore({ name: "demo-1.json", ...options });
    assert.equal(store.path, path.join(dir, "demo-1.json"));
    assert.deepEqual(store.read(), { items: [] });
    store.write({ items: [1, 2] });
    assert.deepEqual(ctx.jsonStore({ name: "demo-1.json", ...options }).read(), { items: [1, 2] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ctx.jsonStore: i file del core e un database chiamato .json sono rifiutati, nulla viene scritto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-kit-"));
  try {
    const options = { validate: (doc) => ({ ok: true, doc }), empty: () => ({ items: [] }) };
    const { ctx } = setup({ config: { dbPath: path.join(dir, "lens.db") } });
    const reserved = CORE_FILES.filter((f) => f.endsWith(".json"));
    assert.ok(reserved.includes("dashboard-v2.json"));
    for (const name of reserved) assert.throws(() => ctx.jsonStore({ name, ...options }), /del core/, name);
    const { ctx: odd } = setup({ config: { dbPath: path.join(dir, "dati.json") } });
    assert.throws(() => odd.jsonStore({ name: "dati.json", ...options }), /del core/, "il database stesso");
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ctx.range: il periodo di una richiesta, come le API del core", () => {
  const { store, queries, ctx } = setup();
  assert.deepEqual(ctx.range(new URLSearchParams("from=day&to=5")), queries.dayRange());
  assert.deepEqual(ctx.range(new URLSearchParams("from=1000&to=2000")), { from: 1000, to: 2000 });
  addStep(store, { id: "msg_1", started: 10_000_000, ended: 10_001_000 });
  assert.deepEqual(ctx.range(new URLSearchParams("from=0&to=20000000")), queries.range(0, 20_000_000));
});

test("ctx.range con earliest: «tutto» (from=0) parte dal dato più vecchio del modulo; gli altri periodi non lo chiedono", () => {
  const { store, queries, ctx } = setup();
  addStep(store, { id: "msg_1", started: 10_000_000, ended: 10_001_000 });
  let asked = 0;
  const earliest = (value) => () => (asked++, value);
  assert.deepEqual(ctx.range(new URLSearchParams("from=0&to=20000000"), { earliest: earliest(5_000_000) }), { from: 5_000_000 - 60_000, to: 20_000_000 });
  assert.equal(asked, 1);
  // without data of its own: the last day, as Queries.range without data
  const before = Date.now();
  const none = ctx.range(new URLSearchParams("from=0"), { earliest: earliest(null) });
  assert.ok(none.from >= before - 86_400_000 && none.from <= Date.now() - 86_400_000);
  assert.ok(none.to > Date.now() && none.to <= Date.now() + 60_000, "no to: a minute ahead, as Queries.range");
  // any other period: earliest is never called
  asked = 0;
  assert.deepEqual(ctx.range(new URLSearchParams("from=1000&to=2000"), { earliest: earliest(1) }), { from: 1000, to: 2000 });
  assert.deepEqual(ctx.range(new URLSearchParams("from=day"), { earliest: earliest(1) }), queries.dayRange());
  assert.equal(asked, 0);
  // no earliest: OpenCode's, as before
  assert.deepEqual(ctx.range(new URLSearchParams("from=0&to=20000000"), {}), queries.range(0, 20_000_000));
});

/** A ctx whose module (`id`, default demo) declares `tables` (default the demo fixture's), created by the Store as at startup. */
function writerSetup({ id = "demo", tables = demoTables, source } = {}) {
  const store = memoryStore({ moduleTables: tables ? [{ id, ...tables }] : [] });
  assert.equal(store.moduleTableErrors.size, 0);
  const ctx = moduleContext({ id, config: { dbPath: ":memory:", scanIntervalMs: 120_000 }, store, collector, queries: new Queries(store), log: quiet, tables, source });
  return { store, ctx };
}

const ITEMS = "SELECT id, name, created, ended FROM demo_items ORDER BY id";
const items = (store) => store.db.prepare(ITEMS).all().map((r) => ({ ...r }));
const UPSERT = "INSERT INTO demo_items (id, name, created) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name";

/** What a refused write could have touched: the store's snapshot, the module's rows, both schemas whole. */
function writerSnapshot(store) {
  return {
    ...snapshot(store),
    items: items(store),
    schema: store.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").all().map((r) => ({ ...r })),
    temp: store.db.prepare("SELECT type, name, sql FROM sqlite_temp_schema ORDER BY name").all().map((r) => ({ ...r })),
    tempRows: store.db.prepare("SELECT COUNT(*) n FROM temp.x").get().n,
  };
}

test("ctx.writer: rifiuta alla preparazione ciò che non scrive solo sulle tabelle del modulo (Review Focus 3)", () => {
  const { store, ctx } = writerSetup();
  addStep(store, { id: "msg_1", started: 1000, ended: 2000, cost: 1 });
  ctx.writer.statement(UPSERT).run("item:1", "uno", 1000);
  store.db.exec("CREATE TEMP TABLE x (a)"); // a temporary table of the connection: writing it is writing outside main
  const before = writerSnapshot(store);
  const refused = [
    ["UPDATE steps SET cost = 0", /fuori dalle tabelle del modulo/],
    ["UPDATE main.steps SET cost = 0 WHERE id IN (SELECT id FROM demo_items)", /fuori dalle tabelle del modulo/],
    ["INSERT INTO meta (key, value) VALUES ('module:demo:schema', '99')", /fuori dalle tabelle del modulo/],
    ["DELETE FROM demo_items", /solo INSERT o UPDATE/],
    ["INSERT OR REPLACE INTO demo_items (id, created) VALUES ('item:1', 5)", /REPLACE/],
    ["REPLACE INTO demo_items (id, created) VALUES ('item:1', 5)", /solo INSERT o UPDATE|REPLACE/],
    ["UPDATE OR REPLACE demo_items SET id = 'item:2'", /REPLACE/],
    ["UPDATE demo_items SET name = replace(name, 'u', 'x')", /REPLACE/],
    ["INSERT INTO temp.x VALUES (1)", /fuori dalle tabelle del modulo/],
    ["INSERT INTO temp.nessuna VALUES (1)", /no such table/],
    ["CREATE TABLE demo_altra (id TEXT)", /solo INSERT o UPDATE/],
    ["INSERT INTO demo_items (id, created) VALUES ('item:9', 9); DELETE FROM steps", /una sola istruzione/],
    ["UPDATE demo_items SET ended = 1; UPDATE demo_items SET ended = 2", /una sola istruzione/],
    ["WITH x AS (SELECT 1) INSERT INTO demo_items (id, created) SELECT 'item:9', 9 FROM x", /solo INSERT o UPDATE/],
    ["SELECT * FROM demo_items", /solo INSERT o UPDATE/],
    ["PRAGMA user_version = 99", /solo INSERT o UPDATE/],
    ["ATTACH DATABASE ':memory:' AS altro", /solo INSERT o UPDATE/],
    // an ANALYZE run by pragma_optimize writes sqlite_stat1 without an OpenWrite in the program
    ["INSERT INTO demo_items (id, created) SELECT 'item:9', 9 FROM pragma_optimize(0x10002)", /pragma_/],
    ["INSERT INTO demo_items (id, created) SELECT 'item:9', 9 FROM \"pragma_optimize\"", /pragma_/],
    ["INSERT INTO demo_items (id, name, created) VALUES ('item:9', 'unclosed, 9)", /non è chiuso/],
    ["-- solo un commento", /una sola istruzione/],
    ["", /una sola istruzione/],
  ];
  for (const [sql, reason] of refused) {
    assert.throws(
      () => ctx.writer.statement(sql),
      (err) => err instanceof Error && err.message.startsWith("ctx.writer: ") && reason.test(err.message),
      sql,
    );
    assert.deepEqual(writerSnapshot(store), before, sql);
  }
  for (const sql of [undefined, null, 42]) assert.throws(() => ctx.writer.statement(sql), /^Error: ctx\.writer: /, String(sql));
});

test("ctx.writer: una tabella del modulo con un trigger o una tabella virtuale si rifiutano", () => {
  const { store, ctx } = writerSetup();
  // made on the test database by hand: tables.js could never declare them
  store.db.exec("CREATE TRIGGER demo_items_copia AFTER INSERT ON demo_items BEGIN UPDATE steps SET cost = 0; END");
  assert.throws(() => ctx.writer.statement("INSERT INTO demo_items (id, created) VALUES ('item:1', 1)"), /^Error: ctx\.writer: .*Program/);
  store.db.exec("DROP TRIGGER demo_items_copia");
  store.db.exec("CREATE VIRTUAL TABLE demo_fts USING fts5(x)");
  const virtual = writerSetup({ tables: { version: 1, sql: `${demoTables.sql}\nCREATE TABLE IF NOT EXISTS demo_fts (x TEXT);` } });
  virtual.store.db.exec("DROP TABLE demo_fts");
  virtual.store.db.exec("CREATE VIRTUAL TABLE demo_fts USING fts5(x)");
  assert.throws(() => virtual.ctx.writer.statement("INSERT INTO demo_fts (x) VALUES ('a')"), /^Error: ctx\.writer: .*VUpdate/);
  assert.equal(virtual.store.db.prepare("SELECT COUNT(*) n FROM demo_fts").get().n, 0);
});

test("ctx.writer: solo le tabelle create dal sql del modulo, non quelle del core né di un altro modulo col prefisso", () => {
  // a module called daily: daily_steps is the core's, though it carries its prefix
  const daily = writerSetup({ id: "daily", tables: { version: 1, sql: "CREATE TABLE IF NOT EXISTS daily_notes (id TEXT PRIMARY KEY, n INTEGER)" } });
  assert.throws(
    () => daily.ctx.writer.statement("INSERT INTO daily_steps (day, session_id, provider, model, variant, agent) VALUES ('2026-10-26', 's', 'p', 'm', '', 'a')"),
    /^Error: ctx\.writer: .*fuori dalle tabelle del modulo/,
  );
  daily.ctx.writer.statement("INSERT INTO daily_notes (id, n) VALUES (?, ?)").run("a", 1);
  assert.equal(daily.store.db.prepare("SELECT n FROM daily_notes").get().n, 1);
  // two modules on one database: demo cannot write other's table
  const store = memoryStore({ moduleTables: [{ id: "demo", ...demoTables }, { id: "other", version: 1, sql: "CREATE TABLE IF NOT EXISTS other_rows (id TEXT PRIMARY KEY)" }] });
  const ctx = moduleContext({ id: "demo", config: { dbPath: ":memory:", scanIntervalMs: 120_000 }, store, collector, queries: new Queries(store), log: quiet, tables: demoTables });
  assert.throws(() => ctx.writer.statement("INSERT INTO other_rows (id) VALUES ('x')"), /^Error: ctx\.writer: .*fuori dalle tabelle del modulo/);
  // a definition never checked that names a core table: only the module's prefix counts
  const unchecked = moduleContext({ id: "demo", config: { dbPath: ":memory:", scanIntervalMs: 120_000 }, store, collector, queries: new Queries(store), log: quiet, tables: { sql: "CREATE TABLE IF NOT EXISTS steps (id TEXT)" } });
  assert.throws(() => unchecked.writer.statement("UPDATE steps SET cost = 0"), /^Error: ctx\.writer: .*fuori dalle tabelle del modulo/);
});

test("ctx.writer: gli upsert, gli UPDATE su colonne indicizzate e un INSERT … SELECT con LEAD() OVER passano", () => {
  const { store, ctx } = writerSetup();
  const upsert = ctx.writer.statement(UPSERT);
  upsert.run("item:1", "uno", 1000);
  upsert.run("item:2", "due", 3000);
  upsert.run("item:1", "primo", 9999); // the conflict: only the name changes
  assert.deepEqual(items(store), [
    { id: "item:1", name: "primo", created: 1000, ended: null },
    { id: "item:2", name: "due", created: 3000, ended: null },
  ]);
  // through the primary key's automatic index (an OpenWrite with OPFLAG_SEEKEQ) and on the expression index's column
  ctx.writer.statement("UPDATE demo_items SET ended = :ended WHERE id = :id").run({ ended: 2000, id: "item:1" });
  ctx.writer.statement("UPDATE demo_items SET created = created + 1 WHERE COALESCE(ended, created) >= ?").run(2500);
  // Bob's runs: each row ended by the next one's start
  ctx.writer
    .statement(
      `INSERT INTO demo_items (id, name, created, ended)
       SELECT q.id || ':run', 'run', q.created, q.nxt
       FROM (SELECT id, created, LEAD(created) OVER (ORDER BY created, id) nxt FROM demo_items WHERE id NOT LIKE '%:run') q
       WHERE true
       ON CONFLICT(id) DO UPDATE SET ended = excluded.ended`,
    )
    .run();
  assert.deepEqual(items(store), [
    { id: "item:1", name: "primo", created: 1000, ended: 2000 },
    { id: "item:1:run", name: "run", created: 1000, ended: 3001 },
    { id: "item:2", name: "due", created: 3001, ended: null },
    { id: "item:2:run", name: "run", created: 3001, ended: null },
  ]);
  // RETURNING through get and all; INSERT OR IGNORE; REPLACE inside a literal is a value
  assert.deepEqual({ ...ctx.writer.statement("UPDATE demo_items SET name = 'REPLACE' WHERE id = ? RETURNING name").get("item:2") }, { name: "REPLACE" });
  assert.equal(ctx.writer.statement("INSERT OR IGNORE INTO demo_items (id, created) VALUES (?, ?) RETURNING id").all("item:3", 5).length, 1);
  assert.equal(ctx.writer.statement("INSERT OR IGNORE INTO demo_items (id, created) VALUES (?, ?)").run("item:3", 6).changes, 0);
  assert.ok(Object.isFrozen(ctx.writer));
  assert.ok(Object.isFrozen(upsert));
});

test("ctx.writer: scrive subito dopo una lettura di ctx.reader, anche dentro ctx.writer.tx", () => {
  const { store, ctx } = writerSetup();
  assert.equal(ctx.reader.get("SELECT COUNT(*) n FROM demo_items").n, 0);
  ctx.writer.statement(UPSERT).run("item:1", "uno", 1000);
  const n = ctx.writer.tx(() => {
    const seen = ctx.reader.get("SELECT COUNT(*) n FROM demo_items").n;
    ctx.writer.statement(UPSERT).run("item:2", "due", 2000);
    return seen + ctx.reader.get("SELECT COUNT(*) n FROM demo_items").n;
  });
  assert.equal(n, 3, "the function's value");
  assert.equal(items(store).length, 2);
  assert.equal(store.db.prepare("PRAGMA query_only").get().query_only, 0);
  assert.equal(store.db.isTransaction, false);
});

test("ctx.writer.tx: un errore o una funzione asincrona annullano tutto", async () => {
  const { store, ctx } = writerSetup();
  ctx.writer.statement(UPSERT).run("item:1", "uno", 1000);
  assert.throws(
    () =>
      ctx.writer.tx(() => {
        ctx.writer.statement(UPSERT).run("item:2", "due", 2000);
        throw new Error("rotto");
      }),
    /rotto/,
  );
  let after = false;
  assert.throws(
    () =>
      ctx.writer.tx(async () => {
        ctx.writer.statement(UPSERT).run("item:3", "tre", 3000); // before the first await: inside the transaction
        await null;
        after = true;
      }),
    /^Error: ctx\.writer: /,
  );
  assert.deepEqual(
    items(store).map((r) => r.id),
    ["item:1"],
    "rolled back",
  );
  assert.equal(store.db.isTransaction, false);
  await null;
  assert.equal(after, true, "the rest of the function still runs, outside any transaction");
});

test("ctx.writer: lo stesso testo si prepara e si controlla una volta sola; oltre 256 testi è un errore", () => {
  const { store, ctx } = writerSetup();
  const prepare = store.db.prepare.bind(store.db);
  const prepared = [];
  store.db.prepare = (sql) => {
    prepared.push(sql);
    return prepare(sql);
  };
  const first = ctx.writer.statement(UPSERT);
  assert.equal(ctx.writer.statement(UPSERT), first);
  first.run("item:1", "uno", 1);
  ctx.writer.statement(UPSERT).run("item:1", "uno", 1);
  assert.equal(prepared.filter((s) => s === UPSERT).length, 1);
  assert.equal(prepared.filter((s) => s.startsWith("EXPLAIN ")).length, 1, "il controllo gira solo la prima volta");
  store.db.prepare = prepare;
  for (let i = 1; i < 256; i++) ctx.writer.statement(`UPDATE demo_items SET ended = ${i} WHERE id = ?`);
  assert.throws(() => ctx.writer.statement("UPDATE demo_items SET ended = 256 WHERE id = ?"), { message: "ctx.writer: troppe istruzioni diverse" });
  assert.equal(ctx.writer.statement(UPSERT), first, "i testi già preparati restano usabili");
});

test("ctx.writer solo per un modulo con tabelle; ctx.live.feed solo per uno con source", () => {
  const plain = setup().ctx;
  assert.equal(plain.writer, undefined);
  assert.equal(plain.live.feed, undefined);
  assert.equal(typeof plain.live.changed, "function");
  assert.ok(Object.isFrozen(plain.live));
  const { store, ctx } = writerSetup({ source: true });
  assert.equal(typeof ctx.writer.statement, "function");
  const got = [];
  store.onChange((kind, item) => got.push([kind, item]));
  ctx.live.changed({ n: 1 });
  ctx.live.feed({ at: 5, kind: "run", source: "altro" });
  assert.deepEqual(got, [
    ["demo", { n: 1 }],
    ["feed", { at: 5, kind: "run", source: "demo" }],
  ]);
});

test("ctx.readers: le funzioni di src/reader.js; adopt tiene la versione nei meta del modulo", () => {
  const { store, ctx } = setup();
  assert.equal(ctx.readers.define, defineReader);
  assert.equal(ctx.readers.Watermark, Watermark);
  assert.equal(ctx.readers.contractMisses, contractMisses);
  assert.ok(Object.isFrozen(ctx.readers));
  assert.ok(Object.isFrozen(Watermark.prototype), "a module cannot change the core's Watermark");
  const reader = ctx.readers.define({ name: "items", version: 2, marginMs: 0, contract: { items: ["id"] } });
  let resets = 0;
  assert.equal(ctx.readers.adopt(reader, () => resets++), true);
  assert.equal(resets, 1);
  assert.equal(store.meta("module:demo:data:items_reader"), "2");
  assert.equal(store.meta("items_reader"), undefined, "never a key of the core");
  assert.equal(ctx.readers.adopt(reader, () => resets++), false);
  assert.equal(resets, 1);
  assert.deepEqual(ctx.readers.contractMisses(reader, "items", () => false), ["id"]);
  assert.equal(new ctx.readers.Watermark(reader, 100).since, 100);
});

test("ctx.paths.dataDir: la cartella del database, null in memoria, anche nel ctx di configure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-kit-"));
  try {
    assert.equal(setup({ config: { dbPath: path.join(dir, "lens.db") } }).ctx.paths.dataDir, path.resolve(dir));
    assert.equal(setup().ctx.paths.dataDir, null);
    assert.equal(settingsContext({ id: "demo", dbPath: path.join(dir, "lens.db") }).paths.dataDir, path.resolve(dir));
    assert.equal(settingsContext({ id: "demo", dbPath: ":memory:" }).paths.dataDir, null);
    assert.equal(settingsContext({ id: "demo" }).paths.dataDir, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ctx.zip: le funzioni di src/zip.js e src/update.js", () => {
  const { ctx } = setup();
  assert.equal(ctx.zip.readEntries, readZipEntries);
  assert.equal(ctx.zip.entryData, entryData);
  assert.equal(ctx.zip.extractPlan, extractPlan);
  assert.equal(ctx.zip.planEntries, planEntries);
  assert.equal(ctx.zip.ZipError, ZipError);
  const buf = makeZip([{ name: "a/uno.txt", data: "ciao" }]);
  const entries = ctx.zip.readEntries(buf);
  assert.deepEqual(entries.map((e) => e.name), ["a/uno.txt"]);
  assert.equal(ctx.zip.entryData(buf, entries[0]).toString(), "ciao");
  assert.throws(() => ctx.zip.readEntries(Buffer.from("non è uno zip")), ctx.zip.ZipError);
  assert.ok(Object.isFrozen(ctx.zip));
});

const LOAD = { id: "123e4567-e89b-42d3-a456-426614174000", channel: "lens-prompt", preset: "web", sessionId: null, at: 1700000000000, skills: [{ id: "my-skill", full: true, version: 2 }] };
const loadRows = (store) => store.db.prepare("SELECT id, channel, skill_id, preset_id, version, origin, status FROM skill_uses ORDER BY id").all().map((r) => ({ ...r }));

test("ctx.skillLoads.record: le righe di POST /api/skill-loads, ripetuto non cambia nulla", () => {
  const { store, ctx } = setup();
  assert.deepEqual(ctx.skillLoads.record(LOAD), { rows: 2 });
  const first = loadRows(store);
  assert.deepEqual(first, [
    { id: `mcp:${LOAD.id}`, channel: "lens-prompt", skill_id: null, preset_id: "web", version: null, origin: "lens", status: "completed" },
    { id: `mcp:${LOAD.id}:my-skill`, channel: "lens-prompt", skill_id: "my-skill", preset_id: "web", version: 2, origin: "lens", status: "completed" },
  ]);
  assert.deepEqual(ctx.skillLoads.record(LOAD), { rows: 2 });
  assert.deepEqual(loadRows(store), first);
});

test("ctx.skillLoads.record: un payload non valido lancia con i motivi e non scrive nulla", () => {
  const { store, ctx } = setup();
  for (const bad of [null, { ...LOAD, id: "x" }, { ...LOAD, channel: "altro" }, { ...LOAD, skills: [{ id: "Bad Id", full: true }] }]) {
    assert.throws(
      () => ctx.skillLoads.record(bad),
      (err) => Array.isArray(err.errors) && err.errors.length > 0 && err.errors.every((e) => typeof e === "string"),
    );
  }
  assert.deepEqual(loadRows(store), []);
});

test("ctx.jsonStore: read, write, state, badFile e path, quelli che una libreria usa", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-kit-"));
  try {
    const { ctx } = setup({ config: { dbPath: path.join(dir, "lens.db") } });
    const options = { name: "lib.json", validate: (doc) => (Array.isArray(doc?.items) ? { ok: true, doc } : { ok: false, errors: ["items?"] }), empty: () => ({ items: [] }), what: { broken: "x", none: "y", dropped: "z" } };
    const store = ctx.jsonStore(options);
    assert.equal(store.path, path.join(dir, "lib.json"));
    assert.equal(store.badFile, path.join(dir, "lib.bad.json"));
    assert.equal(store.state, "absent");
    assert.deepEqual(store.read(), { items: [] });
    store.write({ items: [1] });
    assert.deepEqual(store.read(), { items: [1] });
    assert.equal(store.state, "ok");
    fs.writeFileSync(store.path, "{rotto");
    assert.deepEqual(store.read(), { items: [] });
    assert.equal(store.state, "corrupt");
    assert.equal(fs.readFileSync(store.badFile, "utf8"), "{rotto");
    fs.writeFileSync(store.path, '{"items":"no"}');
    store.read();
    assert.equal(store.state, "unusable");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ctx.prices: frozen, empty without a price list, base model price for a variant", () => {
  const empty = setup().ctx.prices;
  assert.equal(empty.empty, true);
  assert.equal(empty.estimate("a/b", { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 }), null);
  assert.ok(Object.isFrozen(empty));
  const { ctx } = setup({ config: { modelPrices: [{ model: "a/b", provider: "a", name: "b", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 }] } });
  assert.equal(ctx.prices.empty, false);
  assert.equal(ctx.prices.of("a/b#v").input, 3);
  assert.ok(Object.isFrozen(ctx.prices));
});
