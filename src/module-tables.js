// The tables a module declares in tables.js ({ version, sql, columns? }), created by the core: the module never runs
// DDL itself. checkModuleTables judges a definition on a closed list of statements, then runs it on an empty database
// in memory; applyModuleTables (called by the Store after its own migration) creates what passes, one SAVEPOINT per
// module. Never imported by the MCP process (node:sqlite).
import { DatabaseSync } from "node:sqlite";
import { Localized } from "../public/i18n.js";
import { MIGRATION_INDEXES, SCHEMA } from "./schema.js";
import { sqlStatements } from "./sql-text.js";

// the id of a module with tables: `<id>_` prefixes its SQL names, so no hyphen (docs/moduli-custom.md quotes it)
export const TABLES_ID = /^[a-z][a-z0-9]*$/;
// the types a column of `columns` may have (ALTER TABLE … ADD COLUMN <name> <type>)
const COLUMN_TYPES = ["TEXT", "INTEGER", "REAL", "BLOB"];
const COLUMN_NAME = /^[A-Za-z_]\w*$/;
// words no statement may hold outside literals, quoted names and comments
const REFUSED = /\b(REPLACE|REFERENCES|TEMP|TEMPORARY|VIRTUAL|AUTOINCREMENT|TRIGGER|VIEW|PRAGMA|ATTACH|DROP|DELETE|UPDATE|INSERT)\b|\bAS\s+SELECT\b/i;

/** The only two statements a module may declare, for the tables prefixed `pfx` (its id and "_"). */
const shapes = (pfx) => [
  new RegExp(String.raw`^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+${pfx}\w+\s*\(`, "i"),
  new RegExp(String.raw`^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+${pfx}\w+\s+ON\s+${pfx}\w+\s*\(`, "i"),
];

const errorMessage = (err) => err?.message ?? String(err);

let coreNames = null; // the names of the core's tables and indexes, computed once

/** The names of every table and index of the core: those SCHEMA creates on a database in memory, and the indexes of its migrations. */
function coreObjects() {
  if (coreNames) return coreNames;
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(SCHEMA);
    // the migrations' indexes are on columns SCHEMA leaves to the migrations: their names are enough
    const migrated = Object.values(MIGRATION_INDEXES).flatMap((list) => list.map((sql) => /INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/i.exec(sql)[1]));
    coreNames = new Set([...db.prepare("SELECT name FROM sqlite_schema").all().map((r) => r.name), ...migrated]);
  } finally {
    db.close();
  }
  return coreNames;
}

// whether `name` is a table or index of the core, which no module may declare whatever its prefix (skill_ covers
// skill_uses, daily_ daily_steps)
const coreName = (name) => coreObjects().has(name);
// a statement in a reason: its code on one line, cut
const shown = (code) => {
  const one = code.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
};

/** Whether object `o` is a plain object (not an array, not null). */
const plain = (o) => !!o && typeof o === "object" && !Array.isArray(o);

/** What is wrong with the statements of `sql` for module `id` (a Localized), or null: { statements } when they pass. */
function statementsOf(id, sql) {
  if (typeof sql !== "string") return { error: new Localized("tabelle: sql deve essere un testo") };
  const statements = sqlStatements(sql);
  if (!statements) return { error: new Localized("tabelle: un letterale o un nome fra virgolette non è chiuso") };
  if (!statements.length) return { error: new Localized("tabelle: sql non contiene istruzioni") };
  const allowed = shapes(`${id}_`);
  for (const s of statements) {
    const word = REFUSED.exec(s.code);
    if (word) return { error: new Localized("tabelle: parola rifiutata {word} in «{statement}»", { word: word[0].toUpperCase().replace(/\s+/g, " "), statement: shown(s.code) }) };
    if (!allowed.some((re) => re.test(s.code))) {
      return { error: new Localized("tabelle: istruzione non ammessa «{statement}» (solo CREATE TABLE IF NOT EXISTS {prefix}… e CREATE [UNIQUE] INDEX IF NOT EXISTS {prefix}… ON {prefix}…)", { statement: shown(s.code), prefix: `${id}_` }) };
    }
  }
  return { statements };
}

/** What running `statements` twice on an empty database in memory shows wrong (a Localized), or null; `columns` is checked against what they create. */
function inMemoryError(id, statements, columns) {
  const db = new DatabaseSync(":memory:");
  try {
    try {
      for (let round = 0; round < 2; round++) for (const s of statements) db.exec(s.text);
    } catch (err) {
      return new Localized("tabelle: sql non eseguibile: {error}", { error: errorMessage(err) });
    }
    const pfx = `${id}_`;
    if (db.prepare("SELECT COUNT(*) n FROM sqlite_temp_schema").get().n > 0) return new Localized("tabelle: sql crea oggetti temporanei");
    if (db.prepare("PRAGMA user_version").get().user_version !== 0) return new Localized("tabelle: sql cambia user_version");
    const objects = db.prepare("SELECT type, name, tbl_name FROM sqlite_schema").all();
    for (const o of objects) {
      if (coreName(o.name) || coreName(o.tbl_name)) return new Localized("tabelle: {name} è una tabella o un indice del core", { name: coreName(o.name) ? o.name : o.tbl_name });
      const named = o.name.startsWith(pfx) || (o.type === "index" && o.name.startsWith(`sqlite_autoindex_${pfx}`));
      if ((o.type !== "table" && o.type !== "index") || !o.tbl_name.startsWith(pfx) || !named) {
        return new Localized("tabelle: sql crea {type} {name}, non una tabella o un indice di {prefix}…", { type: o.type, name: o.name, prefix: pfx });
      }
    }
    const tables = new Set(objects.filter((o) => o.type === "table").map((o) => o.name));
    for (const t of tables) {
      if (db.prepare(`PRAGMA foreign_key_list(${t})`).all().length) return new Localized("tabelle: {table} ha una chiave esterna", { table: t });
    }
    for (const [table, cols] of Object.entries(columns ?? {})) {
      if (coreName(table)) return new Localized("tabelle: {name} è una tabella o un indice del core", { name: table });
      if (!tables.has(table)) return new Localized("tabelle: columns nomina {table}, che sql non crea", { table });
      if (!plain(cols)) return new Localized("tabelle: columns.{table} deve essere un oggetto { colonna: tipo }", { table });
      const declared = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      for (const [col, type] of Object.entries(cols)) {
        if (!COLUMN_NAME.test(col) || !declared.has(col)) return new Localized("tabelle: columns.{table}.{column} non è una colonna della sua CREATE TABLE", { table, column: col });
        if (!COLUMN_TYPES.includes(type)) return new Localized("tabelle: columns.{table}.{column} ha tipo {type} (ammessi TEXT, INTEGER, REAL, BLOB)", { table, column: col, type: String(type) });
      }
    }
    return null;
  } finally {
    db.close();
  }
}

/**
 * What is wrong with the default export `def` of module `id`'s tables.js (a Localized), or null. `sql` holds only
 * CREATE TABLE IF NOT EXISTS <id>_… and CREATE [UNIQUE] INDEX IF NOT EXISTS <id>_… ON <id>_…, none of the refused
 * words outside literals, and runs twice on an empty database in memory leaving only tables and indexes of its own
 * (sqlite_autoindex_<id>_… included) and none of the core's, nothing temporary, no foreign key, user_version 0. `columns` names only tables
 * `sql` creates and columns of their CREATE TABLE, with an allowed type; `version` is an integer ≥ 1.
 */
export function checkModuleTables(id, def) {
  if (!plain(def)) return new Localized("tables.js non esporta { version, sql, columns }");
  if (!TABLES_ID.test(id)) return new Localized("tabelle: l'id {id} non può fare da prefisso di una tabella (solo minuscole e cifre)", { id });
  if (!Number.isSafeInteger(def.version) || def.version < 1) return new Localized("tabelle: version deve essere un intero maggiore di zero");
  if (def.columns !== undefined && !plain(def.columns)) return new Localized("tabelle: columns deve essere un oggetto { tabella: { colonna: tipo } }");
  const { statements, error } = statementsOf(id, def.sql);
  return error ?? inMemoryError(id, statements, def.columns);
}

/** Every row of sqlite_schema (main and temp) not of module `id`'s tables (prefixed, never the core's), and user_version: what a module may not change. */
function outside(db, id) {
  const pfx = `${id}_`;
  const theirs = (r) => !r.tbl_name.startsWith(pfx) || coreName(r.tbl_name) || coreName(r.name);
  const rows = (table) => db.prepare(`SELECT type, name, tbl_name, sql FROM ${table} ORDER BY type, name`).all().filter(theirs);
  return JSON.stringify([rows("sqlite_schema"), rows("sqlite_temp_schema"), db.prepare("PRAGMA user_version").get().user_version]);
}

/**
 * Creates the tables of each module of `list` ({ id, version, sql, columns }) on `db`, checked again first: in one
 * SAVEPOINT per module the missing `columns` of tables that already exist (added before the indexes that may use
 * them), then `sql`, then meta module:<id>:schema = version (a greater saved version stays: a return to an older
 * lens). A failure, or anything outside the module's tables changed, undoes only that module. Returns id → Localized
 * of the modules that failed.
 */
export function applyModuleTables(db, list) {
  const errors = new Map();
  for (const m of list) {
    const def = { version: m.version, sql: m.sql, columns: m.columns };
    const invalid = checkModuleTables(m.id, def);
    if (invalid) {
      errors.set(m.id, invalid);
      continue;
    }
    const before = outside(db, m.id);
    try {
      db.exec("SAVEPOINT module_tables");
    } catch (err) {
      errors.set(m.id, new Localized("tabelle non create: {error}", { error: errorMessage(err) }));
      continue;
    }
    try {
      for (const [table, cols] of Object.entries(def.columns ?? {})) {
        const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
        if (!have.size) continue; // created below by sql, with every column
        // the name in double quotes: a column called like a keyword (order, group) is valid in the CREATE TABLE too
        for (const [col, type] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN "${col}" ${type}`);
      }
      for (const s of sqlStatements(def.sql)) db.exec(s.text);
      const key = `module:${m.id}:schema`;
      const saved = Number(db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value);
      if (!(saved > def.version)) db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(def.version));
      if (outside(db, m.id) !== before) throw new Localized("tabelle non create: sql ha cambiato il database fuori dalle tabelle del modulo");
      db.exec("RELEASE module_tables");
    } catch (err) {
      db.exec("ROLLBACK TO module_tables");
      db.exec("RELEASE module_tables");
      errors.set(m.id, err instanceof Localized ? err : new Localized("tabelle non create: {error}", { error: errorMessage(err) }));
    }
  }
  return errors;
}
