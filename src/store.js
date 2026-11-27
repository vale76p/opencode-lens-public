// Local SQLite store. All writes are idempotent upserts keyed by OpenCode IDs,
// so live events and backfill can overlap without double counting.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { log } from "./log.js";
import { applyModuleTables } from "./module-tables.js";
import {
  MIGRATION_INDEXES,
  MODEL_KEY,
  OPENCODE_TABLES,
  REREAD_BELOW,
  SCHEMA,
  SCHEMA_VERSION,
  STEP_START,
  STEP_TS,
  TOOL_COLUMNS,
  TOOL_TS,
  V4_COLUMNS,
} from "./schema.js";

// kept here for the modules and tests that import them from store.js
export { MODEL_KEY, SCHEMA_VERSION, STEP_TS, TOOL_TS };

const SKILL_USE_DEFAULTS = { session_id: null, message_id: null, skill_id: null, preset_id: null, version: null, status: null, origin: null };
const TOOL_DEFAULTS = { name: null, status: null, error_type: null, error_msg: null, created: null, ran: null, ended: null, child_session: null, out_bytes: null, provider_exec: null, is_commit: null };

const TOKEN_COLS = ["t_in", "t_out", "t_reason", "t_cread", "t_cwrite"];

/**
 * The feed item of a compaction that ended or failed: reason (auto, manual) and model, never the summary.
 * `model` is "provider/id" as the signal stores it.
 */
export function compactionFeedItem({ at, sessionID, failed, reason, model }) {
  const cut = typeof model === "string" ? model.indexOf("/") : -1;
  return {
    at,
    kind: "compaction",
    sessionID: sessionID ?? null,
    failed: !!failed,
    reason: reason ?? null,
    provider: cut > 0 ? model.slice(0, cut) : null,
    model: cut > 0 ? model.slice(cut + 1) : null,
  };
}

export function tokensToCols(t) {
  return {
    t_in: num(t?.input),
    t_out: num(t?.output),
    t_reason: num(t?.reasoning),
    t_cread: num(t?.cache?.read),
    t_cwrite: num(t?.cache?.write),
  };
}

/**
 * Session titles and project folders are personal: the database is readable by
 * its owner only. SQLite gives -wal/-shm the mode of the database when it
 * creates them; existing ones, written 0644 by older versions, are fixed here.
 */
function ownerOnly(dbPath) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.chmodSync(f, 0o600);
    } catch (err) {
      // a database the lens can use but not chmod (another owner, odd filesystem) still works
      if (err.code !== "ENOENT") log.warn(`impossibile restringere i permessi di ${f}: ${err.message}`);
    }
  }
}

// the next double above x (x finite): an offset raised by one ulp at a time
const F64 = new Float64Array(1);
const U64 = new BigUint64Array(F64.buffer);
function nextUp(x) {
  if (x === 0) return Number.MIN_VALUE;
  F64[0] = x;
  U64[0] += x > 0 ? 1n : -1n;
  return F64[0];
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export class Store {
  #del = null; // the DELETE statements, prepared on the first deleteCompensated()
  #retainedUntil = 0; // meta retention_until: steps and tools older than this were pruned
  #checkpointTimer = null;

  /**
   * `moduleTables`: the tables the modules declare ({ id, version, sql, columns }, from registry.tables()), created
   * after the core's migration; the modules they could not be created for are in `moduleTableErrors` (id → Localized).
   */
  constructor(dbPath, { moduleTables = [], checkpointEveryMs = 600_000 } = {}) {
    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        // mkdir leaves an existing folder (0755 from older versions) as it is
        fs.chmodSync(dir, 0o700);
      } catch (err) {
        log.warn(`impossibile restringere i permessi di ${dir}: ${err.message}`);
      }
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") ownerOnly(dbPath);
    this.db.exec(SCHEMA);
    this.migrated = this.#migrate();
    this.moduleTableErrors = applyModuleTables(this.db, moduleTables);
    this.listeners = new Set();
    this.st = this.#prepare();
    this.#retainedUntil = Number(this.meta("retention_until") ?? 0) || 0;
    // an external reader holding a transaction open keeps the WAL from being reset: truncate it from time to time
    if (dbPath !== ":memory:" && checkpointEveryMs > 0) this.#checkpointTimer = setInterval(() => this.checkpoint(), checkpointEveryMs).unref();
  }

  /** Throws when the database does not answer (for /healthz). */
  ping() {
    this.db.prepare("SELECT 1").get();
  }

  /** WAL checkpoint that also truncates the file; never throws (a busy reader just means it is retried later). */
  checkpoint() {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (err) {
      log.debug("checkpoint del WAL non riuscito", err);
    }
  }

  /**
   * Schema migrations, each in its own step, all in one transaction.
   * v2: tool details (subagent, output size, provider-executed, commit), prompts
   *     and runs. Those come from the messages, so every session is marked for
   *     one full re-read; the next scan fills the history without losing anything.
   * v3: runs wrongly derived in 0.3.0 for current OpenCode (a prompt sent during
   *     a run split it) are removed, the start of idle-based runs is recomputed
   *     by a new full re-read, and tools get the indexes the session view needs.
   * v4: request, first output and stream end of the steps, reason of interrupted
   *     runs, kind and model of internal usage; the full re-read fills them.
   * v5: skill_uses (table and index come from SCHEMA); the full re-read fills the
   *     skill / activated / lens-preset history, and skill_loads_since records
   *     when counting started.
   * v6: counter_offsets, daily_steps and daily_tools (tables from SCHEMA, nothing
   *     to move): no re-read from v5. The version bump keeps an older lens out,
   *     which would ignore the offsets and bring pruned rows back.
   * Only a database older than REREAD_BELOW re-reads its sessions.
   */
  #migrate() {
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    // a newer schema means an older lens over a newer database: refuse instead of
    // crash-looping on unknown columns or silently writing degraded rows
    if (version > SCHEMA_VERSION) {
      throw new Error(`database con schema ${version}, più nuovo di questa lens (${SCHEMA_VERSION}): aggiorna opencode-lens, non tornare alla versione precedente`);
    }
    if (version === SCHEMA_VERSION) return false;
    const have = this.#columns("tools");
    const reread = version < REREAD_BELOW;
    this.db.exec("BEGIN");
    try {
      if (version < 2) {
        for (const [col, type] of Object.entries(TOOL_COLUMNS)) {
          if (!have.has(col)) this.db.exec(`ALTER TABLE tools ADD COLUMN ${col} ${type}`);
        }
        for (const sql of MIGRATION_INDEXES[2]) this.db.exec(sql);
      }
      if (version < 3) {
        const era = this.db.prepare(`SELECT MIN(ended) e FROM runs WHERE id NOT LIKE '%:derived'`).get().e;
        // the earliest idle-based run marks the current OpenCode: derived runs after it were wrong
        if (era != null) this.db.prepare(`DELETE FROM runs WHERE id LIKE '%:derived' AND ended >= ?`).run(era);
        for (const sql of MIGRATION_INDEXES[3]) this.db.exec(sql);
      }
      if (version < 4) {
        for (const [table, list] of Object.entries(V4_COLUMNS)) {
          const present = this.#columns(table);
          for (const [col, type] of Object.entries(list)) {
            if (!present.has(col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
          }
        }
        for (const sql of MIGRATION_INDEXES[4]) this.db.exec(sql);
      }
      if (version < 5) {
        this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('skill_loads_since', ?)").run(String(Date.now()));
      }
      if (reread) this.resetOpencodeReader();
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return reread && (version > 0 || this.db.prepare("SELECT COUNT(*) n FROM sessions").get().n > 0);
  }

  /** Marks every session for a full re-read of its messages from OpenCode (a new schema or reader). */
  resetOpencodeReader() {
    this.db.exec("UPDATE sessions SET synced_cost = NULL, msg_watermark = NULL");
  }

  /** The column names of a table. */
  #columns(table) {
    return new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  }

  /** Upsert a skill load; newer non-null values win (the backfill is authoritative over the live event). */
  skillUse(row) {
    this.st.skillUseUpsert.run({ ...SKILL_USE_DEFAULTS, ...row });
  }

  /** Insert a skill load delivered by the MCP process; a repeated delivery changes nothing. */
  skillUseOnce(row) {
    this.st.skillUseInsert.run({ ...SKILL_USE_DEFAULTS, ...row });
  }

  /** Upsert a tool call; missing fields keep what is already stored. One older than the retention is not written back. */
  tool(row) {
    if (this.#retainedUntil && (row.ended ?? row.ran ?? row.created ?? Infinity) < this.#retainedUntil) return;
    this.st.toolUpsert.run({ ...TOOL_DEFAULTS, ...row });
  }

  /** Upsert a step read from its message; one older than the retention is not written back (a re-read would count it twice). */
  stepFromMessage(row) {
    if (this.#retainedUntil && (row.ended ?? row.started ?? Infinity) < this.#retainedUntil) return false;
    this.st.stepFromMessage.run(row);
    return true;
  }

  /** Until when steps and tools were pruned (meta retention_until); 0 when nothing was. */
  retainedUntil() {
    return this.#retainedUntil;
  }

  /** The time (STEP_TS, TOOL_TS) of the oldest step or tool call kept, null when there is none. */
  oldestRow() {
    return this.st.oldestRow.get().t ?? null;
  }

  /**
   * Prunes the steps and tool calls of one slice [from, to) of a local day `from` (src/retention.js), in one
   * transaction: their sums go to daily_steps / daily_tools first, what they counted to counter_offsets
   * (deleteCompensated, with `snapshot` = scope => Queries.counterSnapshot(scope) and `margins` =
   * () => Queries.counterMargins(), both required), and retention_until moves
   * to `to`, so a re-read never writes them back.
   * @returns {{ steps: number, tools: number }}
   */
  pruneSlice({ from, to }, snapshot, margins) {
    if (typeof snapshot !== "function" || typeof margins !== "function") throw new TypeError("pruneSlice: servono snapshot e margini");
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to) throw new RangeError(`pruneSlice: intervallo non valido ${from}…${to}`);
    const out = this.deleteCompensated(
      () => snapshot({ from, to }),
      (del) => {
        // where «Tutto» starts (range(0)) does not move: the earliest start of the rows pruned stays in meta
        const first = this.st.prunedStart.get({ from, to }).m;
        const known = Number(this.meta("retention_from") ?? Number.NaN);
        if (first != null) this.st.setMeta.run("retention_from", String(Number.isFinite(known) ? Math.min(known, first) : first));
        this.st.rollupSteps.run({ day: from, from, to });
        this.st.rollupTools.run({ day: from, from, to });
        const tools = Number(del.toolsBetween.run(from, to).changes);
        const steps = Number(del.stepsBetween.run(from, to).changes);
        this.st.setMeta.run("retention_until", String(Math.max(this.#retainedUntil, to)));
        return { steps, tools };
      },
      margins,
    );
    this.#retainedUntil = Math.max(this.#retainedUntil, to); // only after the COMMIT
    return out;
  }

  #prepare() {
    const p = (sql) => this.db.prepare(sql);
    return {
      getMeta: p(`SELECT value FROM meta WHERE key = ?`),
      setMeta: p(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
      getSession: p(`SELECT * FROM sessions WHERE id = ?`),
      upsertSessionFromInfo: p(`
        INSERT INTO sessions (id, parent_id, project_id, directory, title, cost, t_in, t_out, t_reason, t_cread, t_cwrite, created, updated, last_activity)
        VALUES (:id, :parent_id, :project_id, :directory, :title, :cost, :t_in, :t_out, :t_reason, :t_cread, :t_cwrite, :created, :updated, :updated)
        ON CONFLICT(id) DO UPDATE SET
          parent_id = COALESCE(excluded.parent_id, parent_id),
          project_id = COALESCE(excluded.project_id, project_id),
          directory = COALESCE(excluded.directory, directory),
          title = COALESCE(excluded.title, title),
          cost = excluded.cost, t_in = excluded.t_in, t_out = excluded.t_out, t_reason = excluded.t_reason,
          t_cread = excluded.t_cread, t_cwrite = excluded.t_cwrite,
          created = COALESCE(created, excluded.created),
          updated = MAX(COALESCE(updated, 0), COALESCE(excluded.updated, 0)),
          last_activity = MAX(COALESCE(last_activity, 0), COALESCE(excluded.updated, 0))`),
      sessionCreated: p(`
        INSERT INTO sessions (id, parent_id, project_id, directory, created, updated, last_activity)
        VALUES (:id, :parent_id, :project_id, :directory, :created, :created, :created)
        ON CONFLICT(id) DO UPDATE SET
          parent_id = COALESCE(parent_id, excluded.parent_id),
          project_id = COALESCE(project_id, excluded.project_id),
          directory = COALESCE(directory, excluded.directory),
          created = COALESCE(created, excluded.created)`),
      sessionTitle: p(`
        INSERT INTO sessions (id, title, updated, last_activity) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title`),
      sessionUsage: p(`
        INSERT INTO sessions (id, cost, t_in, t_out, t_reason, t_cread, t_cwrite, last_activity)
        VALUES (:id, :cost, :t_in, :t_out, :t_reason, :t_cread, :t_cwrite, :at)
        ON CONFLICT(id) DO UPDATE SET
          cost = excluded.cost, t_in = excluded.t_in, t_out = excluded.t_out, t_reason = excluded.t_reason,
          t_cread = excluded.t_cread, t_cwrite = excluded.t_cwrite,
          last_activity = MAX(COALESCE(last_activity, 0), excluded.last_activity)`),
      sessionTouch: p(`
        INSERT INTO sessions (id, last_activity) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET last_activity = MAX(COALESCE(last_activity, 0), excluded.last_activity)`),
      sessionDeleted: p(`UPDATE sessions SET deleted = ? WHERE id = ?`),
      sessionSynced: p(`
        UPDATE sessions SET synced_cost = :cost, synced_tokens = :tokens, synced_updated = :updated,
          msg_watermark = :watermark
        WHERE id = :id`),

      // a later request is a new attempt: its output and stream end are not known yet
      stepStarted: p(`
        INSERT INTO steps (id, session_id, agent, provider, model, variant, started, last_started, attempts, requested)
        VALUES (:id, :session_id, :agent, :provider, :model, :variant, :at, :at, 1, :requested)
        ON CONFLICT(id) DO UPDATE SET
          first_output = CASE WHEN excluded.requested > COALESCE(requested, 0) THEN NULL ELSE first_output END,
          streamed = CASE WHEN excluded.requested > COALESCE(requested, 0) THEN NULL ELSE streamed END,
          requested = CASE WHEN excluded.requested > COALESCE(requested, 0) THEN excluded.requested ELSE requested END,
          agent = COALESCE(excluded.agent, agent),
          provider = COALESCE(excluded.provider, provider),
          model = COALESCE(excluded.model, model),
          variant = COALESCE(excluded.variant, variant),
          started = COALESCE(started, excluded.started),
          attempts = CASE WHEN ended IS NULL AND excluded.last_started > COALESCE(last_started, 0) THEN attempts + 1 ELSE attempts END,
          last_started = MAX(COALESCE(last_started, 0), excluded.last_started)`),
      // without a live step.started the start is unknown: left NULL (not the end
      // time, which would give a 0 ms duration forever) for the backfill to fill
      stepEnded: p(`
        INSERT INTO steps (id, session_id, ended, finish, error_type, error_msg, cost, t_in, t_out, t_reason, t_cread, t_cwrite)
        VALUES (:id, :session_id, :at, :finish, :error_type, :error_msg, :cost, :t_in, :t_out, :t_reason, :t_cread, :t_cwrite)
        ON CONFLICT(id) DO UPDATE SET
          ended = excluded.ended, finish = excluded.finish,
          error_type = excluded.error_type, error_msg = excluded.error_msg,
          cost = COALESCE(excluded.cost, cost),
          t_in = COALESCE(excluded.t_in, t_in), t_out = COALESCE(excluded.t_out, t_out), t_reason = COALESCE(excluded.t_reason, t_reason),
          t_cread = COALESCE(excluded.t_cread, t_cread), t_cwrite = COALESCE(excluded.t_cwrite, t_cwrite)`),
      // first output and stream end of the last attempt; an earlier attempt's event (before the request) is ignored
      stepOutput: p(`UPDATE steps SET first_output = MIN(COALESCE(first_output, :at), :at) WHERE id = :id AND (requested IS NULL OR :at >= requested)`),
      stepStreamed: p(`UPDATE steps SET streamed = :at WHERE id = :id AND (requested IS NULL OR :at >= requested)`),
      // authoritative state from GET /api/session/{id}/message. The request is the
      // later of the two: a retry may keep the first attempt's time.created while
      // the live step.started saw the last one. A first output read there wins if
      // it belongs to that last request, a live one stays on the same terms
      stepFromMessage: p(`
        INSERT INTO steps (id, session_id, agent, provider, model, variant, started, last_started, ended, finish, error_type, error_msg, cost, t_in, t_out, t_reason, t_cread, t_cwrite, requested, first_output, streamed)
        VALUES (:id, :session_id, :agent, :provider, :model, :variant, :started, :started, :ended, :finish, :error_type, :error_msg, :cost, :t_in, :t_out, :t_reason, :t_cread, :t_cwrite, :requested, :first_output, :streamed)
        ON CONFLICT(id) DO UPDATE SET
          first_output = CASE WHEN excluded.first_output >= COALESCE(MAX(excluded.requested, requested), excluded.requested, requested, 0) THEN excluded.first_output
                              WHEN first_output >= COALESCE(MAX(excluded.requested, requested), excluded.requested, requested, 0) THEN first_output
                              ELSE NULL END,
          requested = COALESCE(MAX(excluded.requested, requested), excluded.requested, requested),
          streamed = COALESCE(excluded.streamed, streamed),
          session_id = excluded.session_id,
          agent = COALESCE(excluded.agent, agent), provider = COALESCE(excluded.provider, provider),
          model = COALESCE(excluded.model, model), variant = COALESCE(excluded.variant, variant),
          started = COALESCE(started, excluded.started),
          last_started = COALESCE(last_started, excluded.last_started),
          ended = COALESCE(excluded.ended, ended),
          finish = COALESCE(excluded.finish, finish),
          error_type = COALESCE(excluded.error_type, error_type), error_msg = COALESCE(excluded.error_msg, error_msg),
          cost = COALESCE(excluded.cost, cost),
          t_in = COALESCE(excluded.t_in, t_in), t_out = COALESCE(excluded.t_out, t_out),
          t_reason = COALESCE(excluded.t_reason, t_reason), t_cread = COALESCE(excluded.t_cread, t_cread),
          t_cwrite = COALESCE(excluded.t_cwrite, t_cwrite)`),
      stepsSum: p(`
        SELECT COALESCE(SUM(cost),0) cost, COALESCE(SUM(t_in),0) t_in, COALESCE(SUM(t_out),0) t_out,
               COALESCE(SUM(t_reason),0) t_reason, COALESCE(SUM(t_cread),0) t_cread, COALESCE(SUM(t_cwrite),0) t_cwrite
        FROM steps WHERE session_id = ?`),
      // the steps the retention pruned, per session (daily_steps): still in the session's totals
      prunedSum: p(`
        SELECT COALESCE(SUM(steps),0) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(t_in),0) t_in, COALESCE(SUM(t_out),0) t_out,
               COALESCE(SUM(t_reason),0) t_reason, COALESCE(SUM(t_cread),0) t_cread, COALESCE(SUM(t_cwrite),0) t_cwrite
        FROM daily_steps WHERE session_id = ?`),
      oldestRow: p(`SELECT MIN(t) t FROM (SELECT MIN(${STEP_TS}) t FROM steps UNION ALL SELECT MIN(${TOOL_TS}) FROM tools)`),
      // the earliest start of the steps and tool calls of [from, to), as Queries.range(0) reads it
      prunedStart: p(`SELECT MIN(m) m FROM (
        SELECT MIN(${STEP_START}) m FROM steps WHERE ${STEP_TS} >= :from AND ${STEP_TS} < :to
        UNION ALL SELECT MIN(COALESCE(created, ran, ended)) FROM tools WHERE ${TOOL_TS} >= :from AND ${TOOL_TS} < :to)`),
      // the sums of the steps and tool calls of [from, to), kept under the local day `day` before they are pruned
      rollupSteps: p(`
        INSERT INTO daily_steps (day, session_id, provider, model, variant, agent, steps, failed, cost, t_in, t_out, t_reason, t_cread, t_cwrite)
        SELECT :day, session_id, COALESCE(provider, '?'), COALESCE(model, '?'), COALESCE(variant, 'default'), COALESCE(agent, '?'),
          COUNT(*), COALESCE(SUM(finish = 'error'), 0), COALESCE(SUM(cost), 0), COALESCE(SUM(t_in), 0), COALESCE(SUM(t_out), 0),
          COALESCE(SUM(t_reason), 0), COALESCE(SUM(t_cread), 0), COALESCE(SUM(t_cwrite), 0)
        FROM steps WHERE ${STEP_TS} >= :from AND ${STEP_TS} < :to GROUP BY 2, 3, 4, 5, 6
        ON CONFLICT (day, session_id, provider, model, variant, agent) DO UPDATE SET steps = steps + excluded.steps, failed = failed + excluded.failed,
          cost = cost + excluded.cost, t_in = t_in + excluded.t_in, t_out = t_out + excluded.t_out, t_reason = t_reason + excluded.t_reason,
          t_cread = t_cread + excluded.t_cread, t_cwrite = t_cwrite + excluded.t_cwrite`),
      rollupTools: p(`
        INSERT INTO daily_tools (day, session_id, name, calls, errors)
        SELECT :day, session_id, COALESCE(name, '?'), COUNT(*), COALESCE(SUM(status = 'error'), 0)
        FROM tools WHERE ${TOOL_TS} >= :from AND ${TOOL_TS} < :to GROUP BY 2, 3
        ON CONFLICT (day, session_id, name) DO UPDATE SET calls = calls + excluded.calls, errors = errors + excluded.errors`),
      internalSum: p(`
        SELECT COUNT(*) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(t_in),0) t_in, COALESCE(SUM(t_out),0) t_out,
               COALESCE(SUM(t_reason),0) t_reason, COALESCE(SUM(t_cread),0) t_cread, COALESCE(SUM(t_cwrite),0) t_cwrite
        FROM internal_usage WHERE session_id = ?`),
      internalInsert: p(`
        INSERT OR IGNORE INTO internal_usage (id, session_id, created, cost, t_in, t_out, t_reason, t_cread, t_cwrite)
        VALUES (:id, :session_id, :created, :cost, :t_in, :t_out, :t_reason, :t_cread, :t_cwrite)`),
      skillUseUpsert: p(`
        INSERT INTO skill_uses (id, session_id, message_id, at, channel, skill_id, preset_id, version, status, origin)
        VALUES (:id, :session_id, :message_id, :at, :channel, :skill_id, :preset_id, :version, :status, :origin)
        ON CONFLICT(id) DO UPDATE SET
          session_id = COALESCE(excluded.session_id, session_id), message_id = COALESCE(excluded.message_id, message_id),
          at = COALESCE(excluded.at, at), channel = COALESCE(excluded.channel, channel),
          skill_id = COALESCE(excluded.skill_id, skill_id), preset_id = COALESCE(excluded.preset_id, preset_id),
          version = COALESCE(excluded.version, version), status = COALESCE(excluded.status, status),
          origin = COALESCE(excluded.origin, origin)`),
      skillUseInsert: p(`
        INSERT INTO skill_uses (id, session_id, message_id, at, channel, skill_id, preset_id, version, status, origin)
        VALUES (:id, :session_id, :message_id, :at, :channel, :skill_id, :preset_id, :version, :status, :origin)
        ON CONFLICT(id) DO NOTHING`),
      internalExists: p(`SELECT 1 FROM internal_usage WHERE id = ?`),
      residualCount: p(`SELECT COUNT(*) n FROM internal_usage WHERE session_id = ? AND kind IS NULL`),
      // estimates recorded at or after a consumption: the only ones that can contain it
      residualAfter: p(`SELECT * FROM internal_usage WHERE session_id = ? AND kind IS NULL AND created >= ? ORDER BY created, id`),
      residualSet: p(`
        UPDATE internal_usage SET cost = :cost, t_in = :t_in, t_out = :t_out, t_reason = :t_reason, t_cread = :t_cread, t_cwrite = :t_cwrite
        WHERE id = :id`),
      internalDelete: p(`DELETE FROM internal_usage WHERE id = ?`),
      // what /metrics keeps of deleted rows (Store.deleteCompensated)
      offsetAdd: p(`
        INSERT INTO counter_offsets (name, labels, value) VALUES (:name, :labels, :value)
        ON CONFLICT(name, labels) DO UPDATE SET value = value + excluded.value`),
      // an exact row never shrinks: its columns feed the internal_usage_* counters
      exactUpsert: p(`
        INSERT INTO internal_usage (id, session_id, created, cost, t_in, t_out, t_reason, t_cread, t_cwrite, kind, provider, model, variant, reason)
        VALUES (:id, :session_id, :created, :cost, :t_in, :t_out, :t_reason, :t_cread, :t_cwrite, :kind, :provider, :model, :variant, :reason)
        ON CONFLICT(id) DO UPDATE SET
          cost = MAX(excluded.cost, cost), t_in = MAX(excluded.t_in, t_in), t_out = MAX(excluded.t_out, t_out),
          t_reason = MAX(excluded.t_reason, t_reason), t_cread = MAX(excluded.t_cread, t_cread), t_cwrite = MAX(excluded.t_cwrite, t_cwrite),
          kind = COALESCE(excluded.kind, kind), provider = COALESCE(excluded.provider, provider),
          model = COALESCE(excluded.model, model), variant = COALESCE(excluded.variant, variant),
          reason = COALESCE(excluded.reason, reason)`),

      toolUpsert: p(`
        INSERT INTO tools (id, session_id, message_id, call_id, name, status, error_type, error_msg, created, ran, ended,
                           child_session, out_bytes, provider_exec, is_commit)
        VALUES (:id, :session_id, :message_id, :call_id, :name, :status, :error_type, :error_msg, :created, :ran, :ended,
                :child_session, :out_bytes, :provider_exec, :is_commit)
        ON CONFLICT(id) DO UPDATE SET
          name = COALESCE(excluded.name, name),
          status = CASE
            WHEN excluded.status IN ('completed','error') THEN excluded.status
            WHEN status IN ('completed','error') THEN status
            ELSE COALESCE(excluded.status, status) END,
          error_type = COALESCE(excluded.error_type, error_type),
          error_msg = COALESCE(excluded.error_msg, error_msg),
          created = COALESCE(created, excluded.created),
          ran = COALESCE(ran, excluded.ran),
          ended = COALESCE(excluded.ended, ended),
          child_session = COALESCE(excluded.child_session, child_session),
          out_bytes = COALESCE(excluded.out_bytes, out_bytes),
          provider_exec = COALESCE(excluded.provider_exec, provider_exec),
          is_commit = COALESCE(excluded.is_commit, is_commit)`),

      toolById: p(`SELECT name, is_commit FROM tools WHERE id = ?`),
      stepById: p(`SELECT provider, model, agent, last_started FROM steps WHERE id = ?`),
      toolChildByCall: p(`UPDATE tools SET child_session = COALESCE(child_session, ?) WHERE call_id = ?`),
      promptDelivery: p(`UPDATE prompts SET delivery = COALESCE(?, delivery) WHERE id = ?`),
      promptUpsert: p(`
        INSERT INTO prompts (id, session_id, created, chars, files, agents, delivery)
        VALUES (:id, :session_id, :created, :chars, :files, :agents, :delivery)
        ON CONFLICT(id) DO UPDATE SET
          chars = excluded.chars, files = excluded.files, agents = excluded.agents,
          delivery = COALESCE(excluded.delivery, delivery)`),
      runById: p(`SELECT started, ended, outcome FROM runs WHERE id = ?`),
      runReason: p(`UPDATE runs SET reason = :reason WHERE id = :id AND outcome = 'interrupted'`),
      runUpsert: p(`
        INSERT INTO runs (id, session_id, started, ended, outcome, reason) VALUES (:id, :session_id, :started, :ended, :outcome, :reason)
        ON CONFLICT(id) DO UPDATE SET
          reason = COALESCE(excluded.reason, reason),
          started = CASE WHEN started IS NULL THEN excluded.started
                         WHEN excluded.started IS NULL THEN started
                         ELSE MIN(started, excluded.started) END,
          outcome = COALESCE(excluded.outcome, outcome)`),
      // earliest known activity of the run closed at :idle: first prompt or step
      // after the previous run of the session (when the sync did not re-read it)
      runStartFromDb: p(`
        WITH prev AS (SELECT COALESCE(MAX(ended), 0) e FROM runs WHERE session_id = :session_id AND ended < :idle)
        SELECT MIN(t) started FROM (
          SELECT created t FROM prompts WHERE session_id = :session_id AND created > (SELECT e FROM prev) AND created <= :idle
          UNION ALL
          SELECT ${STEP_START} t FROM steps
            WHERE session_id = :session_id AND ${STEP_START} > (SELECT e FROM prev)
              AND ${STEP_START} <= :idle)`),
      permissionAsked: p(`
        INSERT INTO permissions (id, session_id, action, resources, asked) VALUES (:id, :session_id, :action, :resources, :at)
        ON CONFLICT(id) DO UPDATE SET
          action = COALESCE(excluded.action, action), resources = COALESCE(excluded.resources, resources),
          asked = COALESCE(asked, excluded.asked)`),
      permissionReplied: p(`
        INSERT INTO permissions (id, session_id, replied, reply) VALUES (:id, :session_id, :at, :reply)
        ON CONFLICT(id) DO UPDATE SET replied = COALESCE(replied, excluded.replied), reply = COALESCE(reply, excluded.reply)`),

      signal: p(`
        INSERT OR IGNORE INTO signals (id, type, session_id, message_id, created, detail)
        VALUES (:id, :type, :session_id, :message_id, :created, :detail)`),

      // rows recorded, as /api/status and Sistema show them
      counts: p(`SELECT (SELECT COUNT(*) FROM sessions) sessions, (SELECT COUNT(*) FROM steps) steps, (SELECT COUNT(*) FROM tools) tools`),
      // the OTLP traces (src/otlp.js): runs in insertion order, their sessions' lineage, their finished steps and tools
      runsAfterRowid: p(`SELECT rowid, * FROM runs WHERE rowid > ? ORDER BY rowid LIMIT ?`),
      runsEndedSince: p(`SELECT rowid, * FROM runs WHERE ended >= ? ORDER BY rowid LIMIT ?`),
      maxRunRowid: p(`SELECT MAX(rowid) r FROM runs`),
      sessionParents: p(`SELECT id, parent_id p FROM sessions`),
      toolDispatch: p(`SELECT child_session c, id FROM tools WHERE child_session IS NOT NULL`),
      finishedSteps: p(
        `SELECT * FROM steps WHERE session_id = ? AND ended IS NOT NULL
        AND COALESCE(started, last_started) >= ? AND COALESCE(started, last_started) <= ? ORDER BY ended`,
      ),
      finishedTools: p(`SELECT * FROM tools WHERE message_id = ? AND ended IS NOT NULL`),
    };
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(kind, item) {
    for (const fn of this.listeners) {
      try {
        fn(kind, item);
      } catch {
        /* listener errors must not break ingestion */
      }
    }
  }

  meta(key, value) {
    if (value === undefined) return this.st.getMeta.get(key)?.value;
    this.st.setMeta.run(key, String(value));
  }

  tx(fn) {
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (err) {
      // SQLite may have rolled back already (disk full, I/O error, OR ROLLBACK): the error to report is still `err`
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw err;
    }
  }

  /** Rows of sessions, steps and tools: the row node:sqlite returns, as it is. */
  counts() {
    return this.st.counts.get();
  }

  /** SQLite version, journal mode, size in bytes and the rows of each of OpenCode's tables (in OPENCODE_TABLES order). */
  databaseInfo() {
    const pragma = (name) => Object.values(this.db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
    const count = (t) => this.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    const tables = Object.fromEntries(OPENCODE_TABLES.map((t) => [t, count(t)]));
    return {
      sqlite: this.db.prepare("SELECT sqlite_version() v").get().v,
      journalMode: pragma("journal_mode"),
      bytes: pragma("page_count") * pragma("page_size"),
      tables,
    };
  }

  /** Runs inserted after `rowid`, at most `limit`, in insertion order (with their rowid). */
  runsAfterRowid(rowid, limit) {
    return this.st.runsAfterRowid.all(rowid, limit);
  }

  /** Runs ended at or after `since`, at most `limit`, in insertion order (with their rowid). */
  runsEndedSince(since, limit) {
    return this.st.runsEndedSince.all(since, limit);
  }

  /** The rowid of the last run inserted, null without runs. */
  maxRunRowid() {
    return this.st.maxRunRowid.get().r;
  }

  /** Each session's parent, and the tool call that spawned each subagent session. */
  lineage() {
    return { parents: this.st.sessionParents.all(), dispatch: this.st.toolDispatch.all() };
  }

  /** A session's finished steps that started between `from` and `to` (both included), by end. */
  finishedSteps(sessionId, from, to) {
    return this.st.finishedSteps.all(sessionId, from, to);
  }

  /** The finished tool calls of a step (assistant message). */
  finishedTools(messageId) {
    return this.st.finishedTools.all(messageId);
  }

  /**
   * Record session usage that no step accounts for (title, compaction...):
   * delta = session total − Σ steps − Σ internal already recorded.
   * `totals` must be a snapshot taken BEFORE the messages were fetched, so the
   * steps can only be ahead of it, never behind: a negative column is then
   * transient (a live step not yet in the snapshot) and is skipped on its own,
   * the positive columns are still recorded, and the next sync picks up whatever
   * is left. Internal usage is never overcounted by the snapshot.
   */
  reconcileInternal(sessionId, at, totals) {
    const steps = this.st.stepsSum.get(sessionId);
    const pruned = this.st.prunedSum.get(sessionId); // steps the retention pruned: still in the totals
    const internal = this.st.internalSum.get(sessionId);
    const delta = { cost: round(totals.cost - steps.cost - pruned.cost - internal.cost) };
    for (const c of TOKEN_COLS) delta[c] = totals[c] - steps[c] - pruned[c] - internal[c];
    // a negative column adds nothing (a step ahead of the snapshot, or a stale estimate) but must not
    // discard the columns that are positive: they are real usage whatever the other columns do
    if (delta.cost < 0) delta.cost = 0;
    for (const c of TOKEN_COLS) if (delta[c] < 0) delta[c] = 0;
    if (delta.cost < 1e-9 && TOKEN_COLS.every((c) => delta[c] === 0)) return null;
    // estimates are numbered among themselves; an id already taken is skipped
    let k = this.st.residualCount.get(sessionId).n + 1;
    while (this.st.internalExists.get(`${sessionId}:${k}`)) k++;
    const row = { id: `${sessionId}:${k}`, session_id: sessionId, created: at, ...delta };
    this.st.internalInsert.run(row);
    return row;
  }

  /**
   * Record exact internal usage (title, compaction) reported by OpenCode.
   * Run it inside a transaction. A new row absorbs the estimate that may
   * already contain it: an estimate recorded at or after the consumption,
   * preferably one that covers it entirely, otherwise column by column from
   * the oldest, never below zero; estimates left empty are deleted. What
   * cannot be absorbed was not in the totals yet (reconcileInternal then
   * skips the transient negative delta). Returns true when the row is new.
   */
  recordInternal(row) {
    const fresh = !this.st.internalExists.get(row.id);
    if (fresh) {
      const cands = this.st.residualAfter.all(row.session_id, row.created);
      const COLS = ["cost", ...TOKEN_COLS];
      const need = Object.fromEntries(COLS.map((c) => [c, row[c] ?? 0]));
      const whole = cands.find((r) => COLS.every((c) => r[c] + 1e-9 >= need[c]));
      for (const r of whole ? [whole] : cands) {
        const next = { id: r.id };
        for (const c of COLS) {
          const take = Math.min(r[c], need[c]);
          next[c] = c === "cost" ? Math.max(0, round(r[c] - take)) : r[c] - take;
          need[c] = c === "cost" ? round(need[c] - take) : need[c] - take;
        }
        if (COLS.every((c) => next[c] <= 1e-12)) this.st.internalDelete.run(r.id);
        else this.st.residualSet.run(next);
      }
    }
    this.st.exactUpsert.run({ provider: null, model: null, variant: null, reason: null, ...row });
    return fresh;
  }

  /**
   * The only way rows leave the database: `remove(del)` runs the DELETE statements of `del` in one
   * transaction between two `snapshot()`s (Queries.counterSnapshot, which this module cannot import), and
   * what each counter and summary series lost goes to counter_offsets, which /metrics adds back: no
   * counter goes down. `margins()` gives the rounding margin of each REAL series by key (Queries.counterMargins,
   * computed on these rows: Retention recomputes it when anything else wrote). Both are required. Returns what `remove` returned; if it throws, nothing changes.
   * @param {() => Map<string, number>} snapshot
   * @param {(del: { stepsBetween: import("node:sqlite").StatementSync, toolsBetween: import("node:sqlite").StatementSync }) => any} remove
   * @param {() => Map<string, number>} margins
   */
  deleteCompensated(snapshot, remove, margins) {
    if (typeof snapshot !== "function" || typeof remove !== "function" || typeof margins !== "function") {
      throw new TypeError("deleteCompensated: servono snapshot, remove e margini");
    }
    const del = (this.#del ??= this.#prepareDeletes());
    return this.tx(() => {
      const margin = margins();
      const before = snapshot();
      const out = remove(del);
      const after = snapshot();
      for (const [key, value] of before) {
        const drop = value - (after.get(key) ?? 0);
        // a series that is gone keeps an offset even at 0: /metrics never drops a series it showed
        if (drop > 1e-12 || !after.has(key)) {
          const [name, labels] = JSON.parse(key);
          // a REAL series gets its rounding margin and one ulp more; one with no margin (an integer series) or
          // a margin of 0 (a sum of zeros) is exact
          const m = margin.get(key);
          this.st.offsetAdd.run({ name, labels, value: m ? nextUp(Math.max(drop, 0) + m) : Math.max(drop, 0) });
        }
      }
      return out;
    });
  }

  /** Changes when anything was written: this connection's changes, another process's commits. */
  writeStamp() {
    return `${this.db.prepare("SELECT total_changes() n").get().n}|${this.db.prepare("PRAGMA data_version").get().data_version}`;
  }

  /** The DELETE statements of the lens, reachable only through deleteCompensated (test/db-owner.test.js R6). */
  #prepareDeletes() {
    return Object.freeze({
      stepsBetween: this.db.prepare(`DELETE FROM steps WHERE ${STEP_TS} >= ? AND ${STEP_TS} < ?`),
      toolsBetween: this.db.prepare(`DELETE FROM tools WHERE ${TOOL_TS} >= ? AND ${TOOL_TS} < ?`),
    });
  }

  close() {
    clearInterval(this.#checkpointTimer);
    this.db.close();
  }
}

function round(x) {
  return Math.round(x * 1e12) / 1e12;
}
