// The tables a module declares in tables.js: the closed check (checkModuleTables) and how the Store creates them
// (applyModuleTables): columns first, then sql, then meta module:<id>:schema, one SAVEPOINT per module.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { errorText, Localized } from "../public/i18n.js";
import { requestContext } from "../src/i18n-request.js";
import { setLogLevel } from "../src/log.js";
import { applyModuleTables, checkModuleTables } from "../src/module-tables.js";
import { SCHEMA } from "../src/schema.js";
import { sqlStatements } from "../src/sql-text.js";
import { Store } from "../src/store.js";
import bobTables from "../modules/bob/tables.js";
import demoTables from "./fixtures/modules/demo/tables.js";
import { memoryStore } from "./helpers.js";

setLogLevel("error");

const demo = { id: "demo", ...demoTables };
// a second module, created next to a refused one
const altro = { id: "altro", version: 1, sql: "CREATE TABLE IF NOT EXISTS altro_rows (id TEXT PRIMARY KEY, at INTEGER)", columns: undefined };

// what IBM Bob declares (modules/bob/tables.js): TEXT keys, plain indexes, one on an expression, comments with ";" and "'"
const BOB_LIKE = {
  version: 1,
  sql: `
-- IBM Bob's tables; nothing else
CREATE TABLE IF NOT EXISTS bob_tasks (
  id TEXT PRIMARY KEY,       -- Bob's task id (UUID)
  updated INTEGER,           -- a task is read again when it moves
  created INTEGER
);
CREATE INDEX IF NOT EXISTS bob_tasks_created ON bob_tasks (created);
CREATE TABLE IF NOT EXISTS bob_tools (
  id TEXT PRIMARY KEY,       -- task:call
  task_id TEXT NOT NULL,
  created INTEGER,
  ended INTEGER,             -- the last model call before the next prompt; NULL: nothing yet
  message_id TEXT
);
CREATE INDEX IF NOT EXISTS bob_tools_ts ON bob_tools (COALESCE(ended, created));
CREATE UNIQUE INDEX IF NOT EXISTS bob_tools_msg ON bob_tools (message_id, id) WHERE message_id IS NOT NULL;
`,
  columns: { bob_tools: { message_id: "TEXT" } },
};

/** Everything of the database a module must not touch: sqlite_schema (main and temp) and user_version, minus `except` prefixes. */
function snapshot(db, except = []) {
  const keep = (r) => !except.some((p) => r.tbl_name.startsWith(p));
  return {
    main: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").all().filter(keep),
    temp: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_temp_schema ORDER BY name").all(),
    version: db.prepare("PRAGMA user_version").get().user_version,
  };
}

const names = (db, prefix) =>
  db
    .prepare("SELECT name FROM sqlite_schema WHERE tbl_name LIKE ? ORDER BY name")
    .all(`${prefix}%`)
    .map((r) => r.name);
const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const metaOf = (db, key) => db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value;

test("checkModuleTables: le tabelle della demo e quelle che userà IBM Bob passano", () => {
  assert.equal(checkModuleTables("demo", demoTables), null);
  assert.equal(checkModuleTables("bob", BOB_LIKE), null);
});

test("Store: le tabelle di un modulo (anche spento) ci sono dopo l'apertura, con l'indice automatico, e module:<id>:schema = version", () => {
  const store = memoryStore({ moduleTables: [demo] });
  assert.deepEqual(names(store.db, "demo_"), ["demo_items", "demo_items_at", "sqlite_autoindex_demo_items_1"]);
  assert.equal(metaOf(store.db, "module:demo:schema"), "2");
  assert.equal(store.meta("module:demo:schema"), "2");
  assert.equal(store.moduleTableErrors.size, 0);
  store.close();
});

test("Store: senza moduleTables nessuna tabella di modulo e nessun errore", () => {
  const store = memoryStore();
  assert.ok(store.moduleTableErrors instanceof Map);
  assert.equal(store.moduleTableErrors.size, 0);
  assert.deepEqual(names(store.db, "demo_"), []);
  store.close();
});

test("Store: una seconda apertura dello stesso database non cambia niente", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lens-module-tables-"));
  const file = path.join(dir, "lens.db");
  try {
    const first = new Store(file, { moduleTables: [demo, altro] });
    first.db.prepare("INSERT INTO demo_items (id, name, created) VALUES ('a', 'x', 1)").run();
    const before = snapshot(first.db);
    first.close();
    const second = new Store(file, { moduleTables: [demo, altro] });
    assert.deepEqual(snapshot(second.db), before);
    assert.equal(second.moduleTableErrors.size, 0);
    assert.equal(second.meta("module:demo:schema"), "2");
    assert.equal(second.db.prepare("SELECT COUNT(*) n FROM demo_items").get().n, 1, "le righe restano");
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyModuleTables: una demo_items di una versione precedente riceve la colonna di columns prima dell'indice", () => {
  const store = memoryStore();
  store.db.exec("CREATE TABLE demo_items (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)");
  store.db.prepare("INSERT INTO demo_items (id, created) VALUES ('vecchio', 5)").run();
  store.meta("module:demo:schema", "1");
  const errors = applyModuleTables(store.db, [demo]);
  assert.equal(errors.size, 0);
  assert.deepEqual(columnsOf(store.db, "demo_items"), ["id", "name", "created", "ended"]);
  assert.ok(names(store.db, "demo_").includes("demo_items_at"));
  assert.equal(store.meta("module:demo:schema"), "2");
  assert.equal(store.db.prepare("SELECT created FROM demo_items WHERE id = 'vecchio'").get().created, 5);
  store.close();
});

test("applyModuleTables: una colonna di columns con il nome di una parola chiave (order) si aggiunge fra virgolette", () => {
  const store = memoryStore();
  store.db.exec("CREATE TABLE demo_rows (id TEXT PRIMARY KEY)");
  const mod = { id: "demo", version: 2, sql: 'CREATE TABLE IF NOT EXISTS demo_rows (id TEXT PRIMARY KEY, "order" INTEGER)', columns: { demo_rows: { order: "INTEGER" } } };
  assert.equal(checkModuleTables(mod.id, mod), null);
  const errors = applyModuleTables(store.db, [mod]);
  assert.deepEqual([...errors.entries()], []);
  assert.deepEqual(columnsOf(store.db, "demo_rows"), ["id", "order"]);
  store.close();
});

test("applyModuleTables: «sql ha cambiato il database fuori dalle tabelle del modulo» si traduce", () => {
  const store = memoryStore();
  // a database that, past the module's sql, also finds a table of someone else: what outside() must catch
  const db = {
    prepare: (sql) => store.db.prepare(sql),
    exec(sql) {
      store.db.exec(sql);
      if (sql.startsWith("CREATE TABLE IF NOT EXISTS altro_rows")) store.db.exec("CREATE TABLE intrusa (x)");
    },
  };
  const errors = applyModuleTables(db, [altro]);
  const err = errors.get("altro");
  assert.ok(err instanceof Localized);
  assert.match(err.message, /fuori dalle tabelle del modulo/);
  assert.match(requestContext.run({ lang: "en", locale: "en-US" }, () => errorText(err)), /^tables not created: sql changed the database outside the module's tables$/);
  assert.match(requestContext.run({ lang: "fr", locale: "fr-FR" }, () => errorText(err)), /^tables non créées : /);
  assert.deepEqual(names(store.db, "intrusa"), [], "annullato");
  store.close();
});

test("applyModuleTables: una versione salvata maggiore resta com'è (ritorno a una lens precedente)", () => {
  const store = memoryStore();
  store.meta("module:demo:schema", "9");
  assert.equal(applyModuleTables(store.db, [demo]).size, 0);
  assert.equal(store.meta("module:demo:schema"), "9");
  assert.deepEqual(names(store.db, "demo_"), ["demo_items", "demo_items_at", "sqlite_autoindex_demo_items_1"]);
  store.close();
});

test("applyModuleTables: un indice su una colonna che la tabella esistente non ha (e columns non aggiunge) → errore solo per quel modulo, annullato", () => {
  const store = memoryStore();
  store.db.exec("CREATE TABLE demo_items (id TEXT PRIMARY KEY, name TEXT, created INTEGER)");
  const before = snapshot(store.db, ["altro_"]);
  const errors = applyModuleTables(store.db, [{ ...demo, columns: undefined }, altro]);
  assert.deepEqual([...errors.keys()], ["demo"]);
  assert.ok(errors.get("demo") instanceof Localized);
  assert.deepEqual(snapshot(store.db, ["altro_"]), before, "niente della demo, nemmeno a metà");
  assert.equal(store.meta("module:demo:schema"), undefined);
  assert.deepEqual(names(store.db, "altro_"), ["altro_rows", "sqlite_autoindex_altro_rows_1"]);
  store.close();
});

const table = "CREATE TABLE IF NOT EXISTS demo_x (id TEXT PRIMARY KEY, n INTEGER)";

// every definition must be refused with its reason (a regex on the Italian message)
const HOSTILE = {
  "DROP TABLE": [{ version: 1, sql: "DROP TABLE IF EXISTS steps" }, /DROP/],
  "PRAGMA user_version": [{ version: 1, sql: "PRAGMA user_version = 99" }, /PRAGMA/],
  "CREATE TEMP TABLE": [{ version: 1, sql: "CREATE TEMP TABLE steps (id TEXT)" }, /TEMP/],
  "CREATE TEMPORARY TABLE col prefisso": [{ version: 1, sql: "CREATE TEMPORARY TABLE IF NOT EXISTS demo_x (id TEXT)" }, /TEMPORARY/],
  "ON CONFLICT REPLACE": [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS demo_x (id TEXT PRIMARY KEY ON CONFLICT REPLACE)" }, /REPLACE/],
  REFERENCES: [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS demo_x (id TEXT PRIMARY KEY, s TEXT REFERENCES steps(id))" }, /REFERENCES/],
  "AS SELECT": [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS demo_x AS SELECT * FROM steps" }, /AS SELECT/],
  "nome senza prefisso": [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS altro_x (id TEXT)" }, /istruzione non ammessa/],
  "nome che contiene il prefisso": [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS xdemo_x (id TEXT)" }, /istruzione non ammessa/],
  "nome fra virgolette": [{ version: 1, sql: 'CREATE TABLE IF NOT EXISTS "steps" (id TEXT)' }, /istruzione non ammessa/],
  "schema main.": [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS main.demo_x (id TEXT)" }, /istruzione non ammessa/],
  "schema temp. per l'indice": [{ version: 1, sql: `${table}; CREATE INDEX IF NOT EXISTS temp.demo_i ON demo_x (n)` }, /TEMP/],
  trigger: [{ version: 1, sql: `${table}; CREATE TRIGGER IF NOT EXISTS demo_t AFTER INSERT ON demo_x BEGIN SELECT 1; END` }, /TRIGGER/],
  "senza IF NOT EXISTS": [{ version: 1, sql: "CREATE TABLE demo_x (id TEXT)" }, /istruzione non ammessa/],
  "indice senza IF NOT EXISTS": [{ version: 1, sql: `${table}; CREATE INDEX demo_i ON demo_x (n)` }, /istruzione non ammessa/],
  "indice su una tabella del core": [{ version: 1, sql: "CREATE INDEX IF NOT EXISTS demo_i ON steps (id)" }, /istruzione non ammessa/],
  vista: [{ version: 1, sql: "CREATE VIEW IF NOT EXISTS demo_v AS SELECT 1" }, /VIEW/],
  "CREATE VIRTUAL TABLE": [{ version: 1, sql: "CREATE VIRTUAL TABLE IF NOT EXISTS demo_f USING fts5(a)" }, /VIRTUAL/],
  AUTOINCREMENT: [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS demo_x (id INTEGER PRIMARY KEY AUTOINCREMENT)" }, /AUTOINCREMENT/],
  "ATTACH dopo un commento": [{ version: 1, sql: `${table}; -- e poi\nATTACH DATABASE ':memory:' AS altro` }, /ATTACH/],
  "INSERT nel core": [{ version: 1, sql: `${table}; INSERT INTO meta (key, value) VALUES ('x', 'y')` }, /INSERT/],
  "UPDATE nel core": [{ version: 1, sql: `${table}; UPDATE meta SET value = 'x'` }, /UPDATE/],
  "DELETE nel core": [{ version: 1, sql: `${table}; DELETE FROM steps` }, /DELETE/],
  "parola rifiutata in minuscolo": [{ version: 1, sql: "create table if not exists demo_x (id text primary key on conflict replace)" }, /REPLACE/],
  "letterale non chiuso": [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS demo_x (id TEXT DEFAULT 'aperto)" }, /letterale/],
  "sql vuoto": [{ version: 1, sql: "  -- niente\n" }, /sql/],
  "sql non testo": [{ version: 1, sql: 3 }, /sql/],
  "SQL non valido": [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS demo_x (id TEXT,)" }, /non eseguibile/],
  "FOREIGN KEY della tabella": [{ version: 1, sql: "CREATE TABLE IF NOT EXISTS demo_x (id TEXT, FOREIGN KEY (id) REFERENCES steps)" }, /REFERENCES/],
  "columns su una tabella non creata da sql": [{ version: 1, sql: table, columns: { demo_y: { n: "INTEGER" } } }, /demo_y/],
  "columns su una tabella del core": [{ version: 1, sql: table, columns: { steps: { x: "TEXT" } } }, /steps/],
  "columns con una colonna assente dalla CREATE TABLE": [{ version: 1, sql: table, columns: { demo_x: { nope: "TEXT" } } }, /nope/],
  "columns con tipo VARCHAR": [{ version: 1, sql: table, columns: { demo_x: { n: "VARCHAR" } } }, /VARCHAR/],
  "columns non oggetto": [{ version: 1, sql: table, columns: ["demo_x"] }, /columns/],
  "version 0": [{ version: 0, sql: table }, /version/],
  "version decimale": [{ version: 1.5, sql: table }, /version/],
  "version testo": [{ version: "1", sql: table }, /version/],
  "version negativa": [{ version: -1, sql: table }, /version/],
  "version assente": [{ sql: table }, /version/],
  "nessun export": [null, /tables\.js/],
};

for (const [name, [def, reason]] of Object.entries(HOSTILE)) {
  test(`checkModuleTables rifiuta: ${name}`, () => {
    const err = checkModuleTables("demo", def);
    assert.ok(err instanceof Localized, "un motivo traducibile");
    assert.match(err.message, reason);
  });

  // a tables.js without a default export never reaches the Store: the registry refuses it
  if (def === null) continue;
  test(`applyModuleTables: ${name} → errore col motivo, database intatto, gli altri moduli creati`, () => {
    const store = memoryStore();
    const before = snapshot(store.db, ["altro_"]);
    const errors = applyModuleTables(store.db, [altro, { id: "demo", ...def }]);
    assert.deepEqual([...errors.keys()], ["demo"]);
    assert.match(errors.get("demo").message, reason);
    assert.deepEqual(snapshot(store.db, ["altro_"]), before);
    assert.equal(store.meta("module:demo:schema"), undefined);
    assert.deepEqual(names(store.db, "altro_"), ["altro_rows", "sqlite_autoindex_altro_rows_1"]);
    assert.equal(store.meta("module:altro:schema"), "1");
    store.close();
  });
}

test("checkModuleTables: le parole rifiutate dentro letterali, nomi fra virgolette e commenti non contano", () => {
  const sql = `CREATE TABLE IF NOT EXISTS demo_x (
    id TEXT PRIMARY KEY DEFAULT 'drop table steps; pragma x', -- DELETE FROM steps; REPLACE
    "update" TEXT, /* ATTACH; TRIGGER */ deleted INTEGER, replaced INTEGER
  )`;
  assert.equal(checkModuleTables("demo", { version: 1, sql }), null);
});

test("checkModuleTables: un id con il trattino non può avere tabelle", () => {
  const err = checkModuleTables("my-mod", { version: 1, sql: "CREATE TABLE IF NOT EXISTS my-mod_x (id TEXT)" });
  assert.ok(err instanceof Localized);
  assert.match(err.message, /my-mod/);
});

test("checkModuleTables: il motivo si traduce", () => {
  const err = checkModuleTables("demo", { version: 1, sql: "DROP TABLE steps" });
  const en = requestContext.run({ lang: "en", locale: "en-US" }, () => errorText(err));
  assert.doesNotMatch(en, /non ammessa|rifiutata/);
});

test("checkModuleTables: non tocca nessun database vero (lavora in memoria)", () => {
  const store = memoryStore();
  const before = snapshot(store.db);
  checkModuleTables("demo", demoTables);
  checkModuleTables("demo", HOSTILE["DROP TABLE"][0]);
  assert.deepEqual(snapshot(store.db), before);
  store.close();
});

// a module's tables are never the core's, whatever its id (a prefix like skill_ or daily_ covers core tables)
const SKILL_USES = "CREATE TABLE IF NOT EXISTS skill_uses (id TEXT PRIMARY KEY, x TEXT)";
const CORE_TABLES = {
  "skill: CREATE TABLE skill_uses": ["skill", { version: 1, sql: SKILL_USES }, /skill_uses/],
  "skill: indice su skill_uses": ["skill", { version: 1, sql: `${SKILL_USES}; CREATE INDEX IF NOT EXISTS skill_evil ON skill_uses (id)` }, /skill_uses/],
  "skill: columns su skill_uses": ["skill", { version: 1, sql: SKILL_USES, columns: { skill_uses: { x: "TEXT" } } }, /skill_uses/],
  "daily: columns su daily_steps": ["daily", { version: 1, sql: "CREATE TABLE IF NOT EXISTS daily_steps (day TEXT PRIMARY KEY, x TEXT)", columns: { daily_steps: { x: "TEXT" } } }, /daily_steps/],
  "daily: columns su daily_steps senza crearla": ["daily", { version: 1, sql: "CREATE TABLE IF NOT EXISTS daily_x (a TEXT)", columns: { daily_steps: { x: "TEXT" } } }, /daily_steps/],
  "internal: un indice col nome di un indice del core": ["internal", { version: 1, sql: "CREATE TABLE IF NOT EXISTS internal_x (a TEXT); CREATE INDEX IF NOT EXISTS internal_session ON internal_x (a)" }, /internal_session/],
  "tools: un indice col nome di un indice di una migrazione": ["tools", { version: 1, sql: "CREATE TABLE IF NOT EXISTS tools_x (a TEXT); CREATE INDEX IF NOT EXISTS tools_child ON tools_x (a)" }, /tools_child/],
};

for (const [name, [id, def, reason]] of Object.entries(CORE_TABLES)) {
  test(`checkModuleTables rifiuta una tabella del core: ${name}`, () => {
    const err = checkModuleTables(id, def);
    assert.ok(err instanceof Localized, "un motivo traducibile");
    assert.match(err.message, reason);
  });

  test(`applyModuleTables: ${name} → errore, il core non cambia`, () => {
    const store = memoryStore();
    const before = snapshot(store.db);
    const columnsBefore = columnsOf(store.db, "skill_uses").concat(columnsOf(store.db, "daily_steps"));
    const errors = applyModuleTables(store.db, [{ id, ...def }]);
    assert.deepEqual([...errors.keys()], [id]);
    assert.deepEqual(snapshot(store.db), before);
    assert.deepEqual(columnsOf(store.db, "skill_uses").concat(columnsOf(store.db, "daily_steps")), columnsBefore);
    assert.equal(store.meta(`module:${id}:schema`), undefined);
    store.close();
  });
}

test("tabelle di bob: modules/bob/tables.js passa come ogni modulo, e lo SCHEMA del core non ha più bob_*", () => {
  // no exception for module bob: the core no longer creates its tables (plan D, Task 6a)
  assert.deepEqual(sqlStatements(SCHEMA).filter((s) => /\bbob_/.test(s.code)), []);
  assert.equal(checkModuleTables("bob", bobTables), null);
  const store = memoryStore({ moduleTables: [{ id: "bob", ...bobTables }] });
  assert.equal(store.moduleTableErrors.size, 0);
  assert.equal(store.meta("module:bob:schema"), "1");
  store.close();
});
