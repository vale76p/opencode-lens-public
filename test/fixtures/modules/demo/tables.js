// Test fixture: the demo module's tables. A TEXT primary key (SQLite adds sqlite_autoindex_demo_items_1), an index
// on an expression of a column that `columns` adds to a demo_items of an older version, before the index is made.
export default {
  version: 2,
  sql: `
    -- one row per item; the name is the user's, never read by the lens
    CREATE TABLE IF NOT EXISTS demo_items (
      id TEXT PRIMARY KEY,   -- 'item:n'; the key
      name TEXT NOT NULL DEFAULT 'senza nome; drop table steps',
      created INTEGER NOT NULL,
      ended INTEGER          -- added in version 2
    );
    CREATE INDEX IF NOT EXISTS demo_items_at ON demo_items (COALESCE(ended, created));
  `,
  columns: { demo_items: { ended: "INTEGER" } },
};
