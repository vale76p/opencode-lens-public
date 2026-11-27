// Test fixture: the demo module's writes on its own tables, through ctx.writer (the only file of a module with SQL that writes).
export const UPSERT_ITEM = `
  INSERT INTO demo_items (id, name, created) VALUES (:id, :name, :created)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name`;
export const END_ITEM = `UPDATE demo_items SET ended = :ended WHERE id = :id`;
