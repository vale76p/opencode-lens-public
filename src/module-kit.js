// The core's stable Node API for modules: the ctx a module receives in configure(), create(), hasData() and files().
// A module reaches the core only through this object, never by importing src/ files, so what is here is the contract.
import os from "node:os";
import path from "node:path";
import { errorText, Localized, N_, t } from "../public/i18n.js";
import { CORE_FILES } from "./core-paths.js";
import { opencodeConfigDir } from "./opencode-config.js";
import { budgetDayOf, DAY_MS, localDay, MIDNIGHT, periodBounds } from "./period.js";
import { JsonStore } from "./presets.js";
import { priceList } from "./prices.js";
import { FOLDER, ST_TOKENS, ST_TS, TOKENS, tokensOf } from "./queries.js";
import { adoptReader, contractMisses, defineReader, Watermark } from "./reader.js";
import { MODEL_KEY, STEP_START, STEP_TS, TABLE_COLUMNS, TOOL_TS } from "./schema.js";
import { validateSkillLoad } from "./skill-uses.js";
import { selectText, sqlStatements } from "./sql-text.js";
import { extractPlan, planEntries } from "./update.js";
import { entryData, readZipEntries, ZipError } from "./zip.js";

// distinct SQL texts one ctx.reader (or ctx.writer) prepares: modules put only constants in their SQL, never values
const READER_TEXTS = 256;
// a module's own JSON file next to the database: a plain name, never a path (docs/moduli-custom.md quotes it)
export const JSON_NAME = /^[a-z0-9][a-z0-9._-]*\.json$/;

/** The names in the data folder a module never takes as a file: CORE_FILES plus the database at `dbPath` and its companions. */
export function coreFileNames(dbPath) {
  if (typeof dbPath !== "string" || dbPath === ":memory:") return [...CORE_FILES];
  const db = path.basename(dbPath);
  return [...CORE_FILES, db, `${db}-wal`, `${db}-shm`];
}

const ZIP = Object.freeze({ readEntries: readZipEntries, entryData, extractPlan, planEntries, ZipError });

// the column order of the core's tables a module's SELECTs for the views follow
const COLUMNS = Object.freeze({ steps: TABLE_COLUMNS.steps, sessions: TABLE_COLUMNS.sessions, tools: TABLE_COLUMNS.tools, prompts: TABLE_COLUMNS.prompts, runs: TABLE_COLUMNS.runs });
const SQL = Object.freeze({ TS: STEP_TS, ST_TS, TOOL_TS, FOLDER, TOKENS, ST_TOKENS, MODEL_KEY, STEP_START, COLUMNS });
// the core's collector reads with the same Watermark: a module gets it frozen, so it cannot change the core's
Object.freeze(Watermark);
Object.freeze(Watermark.prototype);
const I18N = Object.freeze({ t, N_, Localized, errorText });

/**
 * A module route's answer with its own HTTP status: `ctx.reply(404, { error })`. The server recognises it
 * with instanceof and sends `body` (a plain object, required) as JSON; a plain object returned by a route is a 200.
 */
export class Reply {
  constructor(status, body) {
    if (!Number.isInteger(status) || status < 200 || status > 599) throw new TypeError(`stato HTTP non valido: ${status} (serve un intero tra 200 e 599)`);
    const proto = body === null || typeof body !== "object" ? undefined : Object.getPrototypeOf(body);
    if (proto !== Object.prototype && proto !== null) throw new TypeError("ctx.reply: il corpo deve essere un oggetto semplice");
    this.status = status;
    this.body = body;
    Object.freeze(this);
  }
}
Object.freeze(Reply);
Object.freeze(Reply.prototype);

/** Whether the program SQLite compiles for `sql` opens a table for writing or starts a write transaction. EXPLAIN only compiles it. */
function compilesToWrite(db, sql) {
  return db.prepare(`EXPLAIN ${sql}`).all().some((op) => op.opcode === "OpenWrite" || (op.opcode === "Transaction" && op.p2 !== 0));
}

/**
 * ctx.reader: get/all on the lens's database for SELECT and WITH … SELECT only. A text is judged the first time
 * it is seen (selectText, then its compiled program), before it ever runs; then its statement is kept, up to
 * READER_TEXTS texts. Every run happens under PRAGMA query_only, put back to 0 right after (also when it throws):
 * a statement can write without showing it in EXPLAIN (the pragma_optimize table function runs an ANALYZE of
 * its own), and SQLite refuses that write. Refusals are plain Errors and leave the database as it was.
 */
function readerOf(store) {
  const prepared = new Map(); // sql -> StatementSync
  const statement = (sql) => {
    const known = prepared.get(sql);
    if (known) return known;
    if (!selectText(sql)) throw new Error("ctx.reader: solo letture");
    if (prepared.size >= READER_TEXTS) throw new Error("ctx.reader: troppe istruzioni diverse");
    if (compilesToWrite(store.db, sql)) throw new Error("ctx.reader: solo letture");
    const st = store.db.prepare(sql);
    prepared.set(sql, st);
    return st;
  };
  // exec, not a prepared statement: SQLite applies a flag pragma while compiling it, so preparing
  // "query_only = 0" would already switch it off, and running a prepared one again may do nothing
  const queryOnly = (on) => store.db.exec(`PRAGMA query_only = ${on ? 1 : 0}`);
  // re-entrant: a nested call (from a function SQLite runs inside the outer statement) never switches the guard off early.
  // depth counts only once the guard is on: an exec that throws leaves it at 0, and the next call tries again
  let depth = 0;
  const run = (method, sql, args) => {
    if (depth === 0) queryOnly(true);
    depth++;
    try {
      return statement(sql)[method](...args);
    } catch (err) {
      // SQLITE_READONLY (8): the statement tried to write
      if (err?.errcode === 8 || /readonly database/.test(err?.message)) throw new Error("ctx.reader: solo letture", { cause: err });
      throw err;
    } finally {
      if (--depth === 0) queryOnly(false); // the Store writes on this same connection
    }
  };
  return Object.freeze({
    get: (sql, ...args) => run("get", sql, args),
    all: (sql, ...args) => run("all", sql, args),
  });
}

// OpenWrite's P5 flag that makes P2 a register instead of a root page (OPFLAG_P2ISREG in SQLite's sqliteInt.h).
// Not 0x02: that is OPFLAG_SEEKEQ, which an UPDATE through an index sets on a cursor of the module's own table
const P2_IS_REGISTER = 0x10;
// opcodes that write where no OpenWrite shows it: a trigger or a foreign key action (Program), a virtual table
// (VUpdate), the schema and the file. INSERT and UPDATE never compile to the last ones: they are refused in case
const WRITE_ELSEWHERE = new Set(["Program", "VUpdate", "Clear", "Destroy", "CreateBtree", "ParseSchema", "SetCookie", "SqlExec", "VCreate", "VDestroy", "Vacuum", "IncrVacuum", "JournalMode"]);

/**
 * The tables module `id`'s tables.js `def` creates: the names of its CREATE TABLE statements (checkModuleTables
 * admits no other kind of table, nor one of the core's), with the module's prefix in case `def` was not checked.
 */
function ownTables(id, def) {
  const statements = typeof def?.sql === "string" ? (sqlStatements(def.sql) ?? []) : [];
  const names = statements.map((s) => /^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i.exec(s.code)?.[1]);
  return new Set(names.filter((n) => n?.startsWith(`${id}_`)));
}

/**
 * Why `sql` is not a write of the module's own tables (a message for "ctx.writer: …"), or null. On the text: one
 * statement, starting with INSERT or UPDATE, no REPLACE outside literals (INSERT OR REPLACE deletes the rows it
 * replaces), no pragma_ anywhere (pragma_optimize runs an ANALYZE no EXPLAIN shows); on the program EXPLAIN
 * compiles: every OpenWrite on database main (P3 = 0), on a root page given as such, among `roots` (those of the
 * module's tables and of their indexes); none of WRITE_ELSEWHERE. Delete is not looked at: upserts and UPDATEs emit it.
 */
function writeRefusal(db, sql, roots) {
  if (typeof sql !== "string") return "serve un testo SQL";
  const statements = sqlStatements(sql);
  if (!statements) return "un letterale o un nome fra virgolette non è chiuso";
  if (statements.length !== 1) return "una sola istruzione";
  const { code } = statements[0];
  if (!/^\s*(insert|update)\b/i.test(code)) return "solo INSERT o UPDATE";
  if (/\breplace\b/i.test(code)) return "REPLACE non è ammesso (cancella le righe che sostituisce)";
  // anywhere, literals too: SQLite also takes 'pragma_optimize' for a name where a name is expected
  if (/\bpragma_/i.test(sql)) return "le funzioni pragma_… non sono ammesse";
  let ops;
  try {
    ops = db.prepare(`EXPLAIN ${sql}`).all();
  } catch (err) {
    return err?.message ?? String(err);
  }
  for (const op of ops) {
    if (WRITE_ELSEWHERE.has(op.opcode)) return `il programma usa ${op.opcode} (trigger, chiavi esterne, tabelle virtuali o schema)`;
    if (op.opcode === "OpenWrite" && (op.p3 !== 0 || (op.p5 & P2_IS_REGISTER) !== 0 || !roots.has(op.p2))) return "scrive fuori dalle tabelle del modulo";
  }
  return null;
}

/**
 * ctx.writer, for a module whose tables.js declared `tables` (the names its sql creates): statement(sql) → { run,
 * get, all } for INSERT and UPDATE on those tables and their indexes only, judged by writeRefusal the first time a
 * text is seen (before it ever runs), then kept, up to READER_TEXTS texts; tx(fn) runs fn in one transaction of
 * the Store. The root pages are read at each judgement: they change only when tables are made (or the file is
 * rebuilt), and a kept statement SQLite prepares again by name. Refusals are Errors "ctx.writer: …".
 */
function writerOf(store, tables) {
  const prepared = new Map(); // sql -> { run, get, all }
  const roots = () =>
    new Set(
      store.db
        .prepare("SELECT rootpage, tbl_name FROM sqlite_schema WHERE type IN ('table', 'index')")
        .all()
        .filter((r) => tables.has(r.tbl_name))
        .map((r) => r.rootpage),
    );
  const statement = (sql) => {
    const known = prepared.get(sql);
    if (known) return known;
    if (prepared.size >= READER_TEXTS) throw new Error("ctx.writer: troppe istruzioni diverse");
    const refusal = writeRefusal(store.db, sql, roots());
    if (refusal) throw new Error(`ctx.writer: ${refusal}`);
    const st = store.db.prepare(sql);
    const out = Object.freeze({ run: (...args) => st.run(...args), get: (...args) => st.get(...args), all: (...args) => st.all(...args) });
    prepared.set(sql, out);
    return out;
  };
  const tx = (fn) =>
    store.tx(() => {
      const result = fn();
      if (typeof result?.then === "function") {
        result.then(null, () => {}); // its rejection is this error, not an unhandled one
        throw new Error("ctx.writer: tx(fn) vuole una funzione sincrona: una promessa scriverebbe fuori dalla transazione");
      }
      return result;
    });
  return Object.freeze({ statement, tx });
}

/** What a module sees of the environment: the variables it declares (`vars`), HOME and XDG_*; never the core's (LENS_TOKEN, passwords). */
function moduleEnv(env, vars) {
  const own = new Set(vars);
  return Object.freeze(Object.fromEntries(Object.entries(env).filter(([k, v]) => typeof v === "string" && (own.has(k) || k === "HOME" || k.startsWith("XDG_")))));
}

/**
 * The folders a module's defaults start from, read from `env` like the core reads them. `dataDir` is the folder of the
 * database (where the module's own files and folders live), null for ":memory:" or when the database is unknown.
 */
function modulePaths(env, dbPath) {
  const home = env.HOME || os.homedir();
  const dataDir = typeof dbPath === "string" && dbPath !== ":memory:" ? path.dirname(path.resolve(dbPath)) : null;
  return Object.freeze({ home, opencodeConfigDir: opencodeConfigDir(env), xdgData: env.XDG_DATA_HOME || path.join(home, ".local", "share"), dataDir });
}

/**
 * The ctx of configure(ctx): { id, env, paths, i18n }, nothing that reads or writes. The registry builds it for every
 * module found, on or off, at startup and for each check of a save (`env` is then the environment after the save).
 */
export function settingsContext({ id, env = process.env, vars = [], dbPath = null }) {
  return Object.freeze({ id, env: moduleEnv(env, vars), paths: modulePaths(env, dbPath), i18n: I18N });
}

/**
 * The period of a request on `q` (a Queries), as the core's endpoints read it: from=day is the budget day (`to` ignored),
 * otherwise from/to in ms. from=0 is «all time»: from just before OpenCode's earliest data or, with `earliest` (a
 * function → ms or null, a module's own), before the module's; without any data, the last day.
 */
export function rangeOf(searchParams, q, { earliest } = {}) {
  if (searchParams.get("from") === "day") return q.dayRange();
  const n = (k) => (searchParams.has(k) ? Number(searchParams.get(k)) : NaN);
  const from = n("from");
  if (from === 0 && typeof earliest === "function") {
    const { to } = q.range(NaN, n("to"));
    const first = earliest();
    return { from: Number.isFinite(first) ? first - 60_000 : Date.now() - 86_400_000, to };
  }
  return q.range(from, n("to"));
}

/**
 * Frozen ctx for module `id`: narrow views of collector, store and log; meta keys namespaced "module:<id>:data:" (the registry owns the other "module:<id>:" keys);
 * a read-only SQL reader with the core's SQL fragments, period helpers and monthly budget; JSON files of its
 * own next to the database; the period of a request; the core's i18n. `env` and `paths` as in configure(), where
 * `vars` are the variables the module declares; `settings` the values its configure() returned. `tables`, the
 * default export of the module's tables.js ({ version, sql, columns? }, checked), gives it ctx.writer on the tables
 * its sql creates; `source` (the manifest declares one) gives it ctx.live.feed. ctx.readers: the incremental reader
 * protocol of src/reader.js, its versions kept in the module's meta keys.
 */
export function moduleContext({ id, config, store, collector, queries, log, env = process.env, vars = [], settings = {}, tables, source = false }) {
  const prefix = `[${id}] `;
  const meta = Object.freeze({
    get: (key) => store.meta(`module:${id}:data:${key}`),
    set: (key, value) => store.meta(`module:${id}:data:${key}`, value),
  });
  const live = { changed: (payload) => store.changed(id, payload) };
  if (source) live.feed = (item) => store.changed("feed", { ...item, source: id });
  return Object.freeze({
    id,
    env: moduleEnv(env, vars),
    paths: modulePaths(env, config.dbPath),
    settings: Object.freeze({ ...settings }),
    dbPath: config.dbPath,
    collector: Object.freeze({
      get state() {
        return collector.state;
      },
      status: () => collector.status(),
      config: Object.freeze({ scanIntervalMs: config.scanIntervalMs }),
    }),
    store: Object.freeze({ counts: () => store.counts() }),
    meta,
    log: Object.freeze({
      info: (m, e) => log.info(prefix + m, e),
      warn: (m, e) => log.warn(prefix + m, e),
      error: (m, e) => log.error(prefix + m, e),
    }),
    reply: (status, body) => new Reply(status, body),
    reader: readerOf(store),
    writer: tables ? writerOf(store, ownTables(id, tables)) : undefined,
    readers: Object.freeze({
      define: defineReader,
      Watermark,
      contractMisses,
      // the version of `reader` in meta module:<id>:data:<name>_reader: another one calls reset() once
      adopt: (reader, reset) => adoptReader({ meta: (key, value) => (value === undefined ? meta.get(key) : meta.set(key, value)) }, reader, reset),
    }),
    live: Object.freeze(live),
    sql: SQL,
    time: Object.freeze({ periodBounds, localDay, budgetDayOf, DAY_MS, MIDNIGHT, reset: config.reset ?? MIDNIGHT }),
    tokensOf,
    budgets: Object.freeze({
      // the month's cost against LENS_LIMIT_COST_MONTHLY ({ used, limit, ratio, projected, projectedRatio, pace }), null without one
      month: (now = Date.now()) => (queries.monthlyLimits?.cost != null ? queries.period("month", queries.monthlyLimits, now).cost : null),
    }),
    // the global per-model price list (LENS_MODEL_PRICES): of(model), estimate(model, kinds), empty; frozen, empty without prices
    prices: priceList(config.modelPrices ?? []),
    i18n: I18N,
    // the zip reading and extraction helpers of the core (the same functions as src/zip.js and src/update.js)
    zip: ZIP,
    // the MCP's deliveries into the core's skill_uses (written also while a module is off): record(payload) → { rows },
    // an Error with `errors: string[]` for a payload that is not valid (the module answers 400)
    skillLoads: Object.freeze({
      record: (payload) => {
        const v = validateSkillLoad(payload);
        if (!v.ok) throw Object.assign(new Error(v.errors.join("; ")), { errors: v.errors });
        store.tx(() => {
          for (const row of v.rows) store.skillUseOnce(row);
        });
        return { rows: v.rows.length };
      },
    }),
    jsonStore: ({ name, validate, empty, what }) => {
      if (typeof name !== "string" || !JSON_NAME.test(name)) throw new TypeError(`ctx.jsonStore: nome di file non valido: ${name} (atteso un nome come «progetti.json», senza cartelle)`);
      // the core's own files, and the database under whatever name LENS_DB gives it, are never a module's
      if (coreFileNames(config.dbPath).includes(name)) throw new TypeError(`ctx.jsonStore: ${name} è un file del core`);
      return new JsonStore({ dbPath: config.dbPath, name, validate, empty, what });
    },
    // { earliest }: «all time» (from=0) starts from the module's own oldest data
    range: (searchParams, options) => rangeOf(searchParams, queries, options),
  });
}
