// An alternative source through OpenCode's queries. A second read-only connection to the lens's database gets TEMP
// views named like OpenCode's tables (steps, sessions, tools, prompts, runs…): SQLite resolves an unqualified name
// to the temp schema first, so every query of src/queries.js run on that connection reads the source's rows in
// OpenCode's columns and answers in exactly the same shape. Two connections:
//   only — the views hold the source alone («Solo …»)
//   add  — OpenCode's rows plus the source's («+ …»)
// The lens's own connection is never touched: OpenCode's answers, budgets and /metrics stay as they are.
//
// The source gives one SELECT per view, in the columns of TABLE_COLUMNS (ctx.sql.COLUMNS for a module); what it
// does not have (internal usage, signals, permissions, OpenCode's pruned rows) is empty with the source alone.
import { DatabaseSync } from "node:sqlite";
import { Localized } from "../public/i18n.js";
import { Queries } from "./queries.js";
import { TABLE_COLUMNS } from "./schema.js";
import { selectText } from "./sql-text.js";

// the views a source fills, with the columns its SELECTs follow
export const SOURCE_VIEWS = Object.freeze(["steps", "sessions", "tools", "prompts", "runs"]);

const EMPTY = {
  internal_usage: TABLE_COLUMNS.internal_usage,
  signals: TABLE_COLUMNS.signals,
  permissions: TABLE_COLUMNS.permissions,
  // OpenCode's pruned steps and tools (src/retention.js): never the source's
  daily_steps: TABLE_COLUMNS.daily_steps,
  daily_tools: TABLE_COLUMNS.daily_tools,
};

const NO_LIMITS = { tokens: null, cost: null, steps: null };

/** Why `selects` cannot be the views' SELECTs, or null: one SELECT or WITH per view, nothing else. */
function selectsError(selects) {
  if (!selects || typeof selects !== "object") return `servono le select di ${SOURCE_VIEWS.join(", ")}`;
  for (const view of SOURCE_VIEWS) if (!selectText(selects[view])) return `la select di ${view} deve essere una sola SELECT o WITH`;
  return null;
}

/**
 * A read-only connection to `dbPath` whose OpenCode tables are views over the source ("only") or both ("add"),
 * `selects` the source's SELECT per view. Every view is tried once: a SELECT SQLite refuses, or one with the wrong
 * columns, throws with SQLite's reason and leaves no connection open.
 */
export function sourceConnection(dbPath, mode, selects) {
  const error = selectsError(selects);
  if (error) throw new Error(error);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    for (const view of SOURCE_VIEWS) {
      const cols = TABLE_COLUMNS[view];
      const select = selects[view];
      // with OpenCode's rows every select goes in a subquery, closed on its own line after a trailing comment: a WITH
      // cannot follow UNION ALL, and an outermost ORDER BY or LIMIT would apply to the whole union, OpenCode's rows too
      const own = mode === "add" ? `SELECT ${cols} FROM main.${view} UNION ALL ` : "";
      const body = own ? `SELECT * FROM (${select}\n)` : select;
      db.exec(`CREATE TEMP VIEW ${view} (${cols}) AS ${own}${body}`);
    }
    // what only OpenCode has: empty with the source alone, OpenCode's own with both
    if (mode === "only") {
      for (const [table, cols] of Object.entries(EMPTY)) db.exec(`CREATE TEMP VIEW ${table} (${cols}) AS SELECT ${cols} FROM main.${table} WHERE 0`);
      // the lens's meta, without where OpenCode's pruned rows started: «Tutto» of the source alone starts from its data
      db.exec("CREATE TEMP VIEW meta (key, value) AS SELECT key, value FROM main.meta WHERE key <> 'retention_from'");
    }
    // a view is compiled when it is read: try each one now, not on the first request
    for (const view of SOURCE_VIEWS) db.exec(`SELECT * FROM ${view} LIMIT 0`);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/**
 * OpenCode's Queries over the source alone and over both, sharing the options of the lens's own (budget day,
 * catalog…). `src` is what the source gives: { selects, only?: { limits, weeklyLimits, monthlyLimits, contextLimits },
 * add?: { contextLimits } }. The source alone has its own budgets (none unless it says), no per-model budget and no
 * OpenCode models; both keep OpenCode's. null for a database in memory, which a second connection cannot open; throws
 * with the reason when the source or one of its views is not usable.
 */
export function sourceQueries(dbPath, options, src) {
  if (!src || typeof src !== "object") throw new Error("source() deve restituire { selects, totals }");
  const error = selectsError(src.selects);
  if (error) throw new Error(error);
  if (!dbPath || dbPath === ":memory:") return null;
  const only = src.only ?? {};
  const onlyOptions = {
    ...options,
    limits: only.limits ?? NO_LIMITS,
    weeklyLimits: only.weeklyLimits ?? NO_LIMITS,
    monthlyLimits: only.monthlyLimits ?? NO_LIMITS,
    modelLimits: [],
    opencodeModels: null,
    contextLimits: { ...options?.contextLimits, ...only.contextLimits },
  };
  const addOptions = { ...options, contextLimits: { ...options?.contextLimits, ...src.add?.contextLimits } };
  const onlyDb = sourceConnection(dbPath, "only", src.selects);
  let addDb;
  try {
    addDb = sourceConnection(dbPath, "add", src.selects);
  } catch (err) {
    onlyDb.close();
    throw err;
  }
  return {
    only: new Queries({ db: onlyDb }, onlyOptions),
    add: new Queries({ db: addDb }, addOptions),
    close() {
      this.only.db.close();
      this.add.db.close();
    },
  };
}

/**
 * The source of the active modules, as the server takes it: { id, label, views, totals(from, to) }, or null (none,
 * a database in memory, or a source that is not usable). The module's source() is asked once; whatever goes wrong
 * there, in a SELECT or in a view leaves the lens without the source and puts the module in "error" with the
 * reason, one line in the log (registry.fail, which stops it): never a failed start.
 */
export async function openSource({ registry, dbPath, options }) {
  const src = registry.source();
  if (!src) return null;
  try {
    const given = src.instance.source();
    if (typeof given?.totals !== "function") throw new Error("source() deve restituire { selects, totals }");
    const views = sourceQueries(dbPath, options, given);
    if (!views) return null;
    return { id: src.id, label: src.label, views, totals: (from, to) => given.totals(from, to) };
  } catch (err) {
    await registry.fail(src.id, new Localized("sorgente non disponibile: {error}", { error: err?.message ?? String(err) }));
    return null;
  }
}
