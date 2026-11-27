// Query-plan checks shared by the core and the modules: the range indexes of the database, the SQL a call prepares,
// and whether its plan SEARCHes each index. Used by query-plans.test.js and, via test/module-test-kit.js, by module tests.

// words that may follow a table name in FROM/JOIN without being its alias
const KEYWORDS = new Set(["WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "CROSS", "NATURAL", "ON", "USING", "GROUP", "ORDER", "LIMIT", "UNION", "EXCEPT", "INTERSECT", "WINDOW", "HAVING", "AS", "SELECT", "INDEXED", "NOT"]);

/** The indexes on a COALESCE(...) of the database: name, table and the columns in order. */
export function rangeKeys(db) {
  return db
    .prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql LIKE '%COALESCE(%'`)
    .all()
    .map((r) => {
      const m = /\(\s*COALESCE\(([^)]*)\)\s*\)\s*$/.exec(r.sql);
      return m && { index: r.name, table: r.tbl_name, cols: m[1].split(",").map((c) => c.trim()) };
    })
    .filter(Boolean)
    .sort((a, b) => a.index.localeCompare(b.index));
}

/** A range predicate on a key, with or without a table alias: COALESCE(x.a, x.b) >= ? and the like. */
export const predicate = (key) => new RegExp(`COALESCE\\(${key.cols.map((c) => `(?:\\w+\\.)?${c}`).join(",\\s*")}\\)\\s*(?:>=|<=|<|>)\\s*\\?`);

/** The names a table goes by in `sql`: itself and every alias it is given. */
export function namesOf(sql, table) {
  const names = new Set([table]);
  for (const m of sql.matchAll(new RegExp(`(?:FROM|JOIN)\\s+${table}\\b(?:\\s+(?:AS\\s+)?(\\w+))?`, "gi"))) {
    if (m[1] && !KEYWORDS.has(m[1].toUpperCase())) names.add(m[1]);
  }
  return names;
}

/** Problems of one SQL against the keys, and how many of the keys it filters a range on. */
export function check(db, sql, keys) {
  const problems = [];
  let found = 0;
  let plan = null;
  for (const key of keys) {
    if (!predicate(key).test(sql)) continue;
    found++;
    plan ??= db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((r) => r.detail);
    if (!plan.some((d) => new RegExp(`^SEARCH \\w+ USING (COVERING )?INDEX ${key.index}\\b`).test(d))) problems.push(`${key.index} non cercato`);
    for (const name of namesOf(sql, key.table)) {
      if (plan.some((d) => new RegExp(`^SCAN ${name}\\b`).test(d))) problems.push(`SCAN ${name} (${key.table})`);
    }
  }
  return { problems, found, plan };
}

/** Every SQL `fn` prepares on a fresh connection wrapper over `db`. */
export function recorded(db, fn) {
  const sqls = [];
  const proxy = new Proxy(db, {
    get: (t, k) => (k === "prepare" ? (sql) => (sqls.push(sql), t.prepare(sql)) : typeof t[k] === "function" ? t[k].bind(t) : t[k]),
  });
  fn(proxy);
  return [...new Set(sqls)];
}
