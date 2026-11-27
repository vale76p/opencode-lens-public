// IBM Bob's own database: Bob IDE 2.x and Bob Shell 2.x keep their tasks in one SQLite file, ~/.bob/db/bob.db (WAL,
// so it can be read while Bob runs). The one file of the module that opens it, always read-only, and the only one
// that uses node:sqlite; it gets a path, never the module's ctx, so nothing here can reach the lens's database.
//
// Bob's schema is private; this reader follows what scripts/bob-probe.mjs read from a real bob.db (user_version 10,
// October 2026), as test/fake-bob.js reproduces it:
//   - tasks: task_type normal | subagent | subtask, status active | completed | error, directory,
//     env.modeId, costs { input, output, cacheRead, cacheWrite, cost, contextTokens };
//   - an assistant message's model call in data._meta.spend (same keys), its tool calls in data.toolCalls;
//     a tool message answers data.toolUsage.signature.id, with isError and data._meta.durationMs;
//     a user message is a prompt, its mode in data._meta.mode.id.
// The fields are pulled out in SQL with json_extract, so titles, prompts, replies, tool arguments and outputs never
// even reach Node.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** What the lens needs from bob.db: a table or column missing here is API drift and stops the sync. */
export const BOB_CONTRACT = Object.freeze({
  tasks: Object.freeze(["id", "parent_id", "project_id", "status", "task_type", "costs", "created_at", "updated_at"]),
  messages: Object.freeze(["task_id", "role", "data", "created_at"]),
});

/** bob.db at `dbPath`, opened read-only on demand and opened again when the file is replaced (another inode). */
export class BobDb {
  #db = null;
  #ino = null;

  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  /** true when bob.db is open now (the same file), false when it is not there; throws when it cannot be opened. */
  open() {
    let ino;
    try {
      ino = fs.statSync(this.dbPath).ino;
    } catch {
      this.close();
      return false;
    }
    if (this.#db && ino === this.#ino) return true;
    this.close();
    const db = new DatabaseSync(this.dbPath, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 2000");
    } catch (err) {
      db.close();
      throw err;
    }
    this.#db = db;
    this.#ino = ino;
    return true;
  }

  close() {
    try {
      this.#db?.close();
    } catch {
      /* already closed */
    }
    this.#db = null;
    this.#ino = null;
  }

  #conn() {
    if (!this.#db) throw new Error("bob.db non è aperto");
    return this.#db;
  }

  /** PRAGMA user_version of bob.db. */
  schemaVersion() {
    return this.#conn().prepare("PRAGMA user_version").get().user_version;
  }

  /** The columns of a table of BOB_CONTRACT (an empty set when the table is missing). */
  columns(table) {
    if (!Object.hasOwn(BOB_CONTRACT, table)) throw new Error(`tabella fuori dal contratto: ${table}`);
    return new Set(
      this.#conn()
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name),
    );
  }

  /** Every task with its last update, oldest first. */
  taskTimes() {
    return this.#conn().prepare("SELECT id, updated_at FROM tasks ORDER BY updated_at").all();
  }

  /**
   * The reads of one pass, prepared for the columns bob.db has now: task(id) → the task's fields the lens keeps, or
   * undefined (Bob deleted it meanwhile); messages(id, since) → its messages from `since`, only the fields kept.
   */
  reads() {
    const db = this.#conn();
    const taskCols = this.columns("tasks");
    // a message's id: its own column when there is one (a WITHOUT ROWID table has no rowid)
    const msgId = this.columns("messages").has("id") ? "id" : "rowid";
    const task = db.prepare(`SELECT id, parent_id, project_id, status, task_type, costs, created_at, updated_at,
        ${taskCols.has("directory") ? "directory" : "NULL"} AS directory,
        ${taskCols.has("env") ? "CASE WHEN json_valid(env) THEN json_extract(env, '$.modeId') END" : "NULL"} AS mode
      FROM tasks WHERE id = ?`);
    // only the fields the lens keeps, pulled out by SQLite: no text of the message reaches Node
    const messages = db.prepare(`SELECT ${msgId} AS rid, role, created_at,
        json_extract(data, '$._meta.spend') AS spend,
        json_extract(data, '$._meta.mode.id') AS mode,
        json_extract(data, '$._meta.hide') AS hide,
        json_extract(data, '$.toolUsage.signature.id') AS call_id,
        json_extract(data, '$.toolUsage.signature.name') AS call_name,
        json_extract(data, '$.toolUsage.signature.isError') AS call_error,
        json_extract(data, '$._meta.durationMs') AS duration,
        (SELECT json_group_array(json_object('id', json_extract(c.value, '$.id'), 'name', json_extract(c.value, '$.name')))
           FROM json_each(data, '$.toolCalls') c) AS calls
      FROM messages WHERE task_id = ? AND created_at >= ? AND json_valid(data) ORDER BY created_at, ${msgId}`);
    return { task: (id) => task.get(id), messages: (id, since) => messages.all(id, since) };
  }
}
