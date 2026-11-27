// The SQL of IBM Bob's source on the module's tables (tables.js): the writes it hands to ctx.writer.statement, and
// the reads that go with them, run with ctx.reader. One fixed text each: values are always parameters.

// a task, upserted by Bob's id: Bob's own totals, its last update and the last message read (never moving back)
export const TASK = `
  INSERT INTO bob_tasks (id, parent_id, kind, directory, status, mode, coins, t_in, t_out, t_cread, t_cwrite, requests, created, updated, msg_watermark)
  VALUES (:id, :parent_id, :kind, :directory, :status, :mode, :coins, :t_in, :t_out, :t_cread, :t_cwrite, :requests, :created, :updated, :msg_watermark)
  ON CONFLICT(id) DO UPDATE SET
    parent_id = COALESCE(excluded.parent_id, parent_id), kind = excluded.kind,
    directory = COALESCE(excluded.directory, directory), status = excluded.status, mode = COALESCE(excluded.mode, mode),
    coins = excluded.coins, t_in = excluded.t_in, t_out = excluded.t_out, t_cread = excluded.t_cread, t_cwrite = excluded.t_cwrite,
    requests = excluded.requests, created = COALESCE(created, excluded.created), updated = excluded.updated,
    msg_watermark = MAX(COALESCE(msg_watermark, 0), COALESCE(excluded.msg_watermark, 0))`;

// a model call
export const REQUEST = `
  INSERT INTO bob_requests (id, task_id, model, coins, t_in, t_out, t_cread, t_cwrite, created)
  VALUES (:id, :task_id, :model, :coins, :t_in, :t_out, :t_cread, :t_cwrite, :created)
  ON CONFLICT(id) DO UPDATE SET model = COALESCE(excluded.model, model), coins = excluded.coins,
    t_in = excluded.t_in, t_out = excluded.t_out, t_cread = excluded.t_cread, t_cwrite = excluded.t_cwrite`;

// a prompt: when, never what
export const PROMPT = `INSERT OR IGNORE INTO bob_prompts (id, task_id, created) VALUES (?, ?, ?)`;

// a main task's runs: each prompt, ended by the last model call or tool before the next prompt
export const RUNS = `
  INSERT INTO bob_runs (id, task_id, started, ended, last)
  SELECT q.id, q.task_id, q.created,
    (SELECT MAX(e) FROM (
      SELECT MAX(r.created) e FROM bob_requests r WHERE r.task_id = q.task_id AND r.created >= q.created AND (q.nxt IS NULL OR r.created < q.nxt)
      UNION ALL
      SELECT MAX(COALESCE(o.ended, o.created)) FROM bob_tools o
      WHERE o.task_id = q.task_id AND COALESCE(o.ended, o.created) >= q.created AND (q.nxt IS NULL OR COALESCE(o.ended, o.created) < q.nxt))),
    q.nxt IS NULL
  FROM (SELECT id, task_id, created, LEAD(created) OVER (ORDER BY created, id) nxt FROM bob_prompts WHERE task_id = ?) q
  WHERE true
  ON CONFLICT(id) DO UPDATE SET started = excluded.started, ended = excluded.ended, last = excluded.last`;

// a tool call asked by a model call
export const TOOL_CALL = `
  INSERT INTO bob_tools (id, task_id, name, status, created, message_id) VALUES (:id, :task_id, :name, 'pending', :created, :message_id)
  ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, name), created = COALESCE(created, excluded.created), message_id = excluded.message_id`;

// the result of a call: its start is its end minus Bob's durationMs when there is one, else the assistant message
export const TOOL_RESULT = `
  INSERT INTO bob_tools (id, task_id, name, status, created, ended) VALUES (:id, :task_id, :name, :status, :created, :ended)
  ON CONFLICT(id) DO UPDATE SET name = COALESCE(name, excluded.name), status = excluded.status, ended = excluded.ended,
    created = CASE WHEN :timed THEN excluded.created ELSE COALESCE(created, excluded.created) END`;

// a new reader: every task is read again on its next pass (nothing is deleted)
export const RESET_READER = `UPDATE bob_tasks SET updated = NULL, msg_watermark = NULL`;

// the reads of a pass: each task's last update and last message read, and the sums of its model calls
export const KNOWN = `SELECT id, updated FROM bob_tasks`;
export const WATERMARK = `SELECT msg_watermark w FROM bob_tasks WHERE id = ?`;
export const REQUEST_SUM = `SELECT COUNT(*) n, COALESCE(SUM(coins), 0) coins, COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out,
  COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite FROM bob_requests WHERE task_id = ?`;

// the tasks recorded and the last update among them, for status()
export const STATUS = `SELECT COUNT(*) tasks, MAX(updated) last FROM bob_tasks`;

// what the /metrics counters count: tasks and Bobcoins by kind, tokens, model calls by model, tool calls by tool and status
export const COUNTERS = Object.freeze({
  kinds: `SELECT COALESCE(kind, 'task') kind, COUNT(*) n, COALESCE(SUM(coins), 0) coins FROM bob_tasks GROUP BY 1`,
  tokens: `SELECT COALESCE(SUM(t_in),0) i, COALESCE(SUM(t_out),0) o, COALESCE(SUM(t_cread),0) r, COALESCE(SUM(t_cwrite),0) w FROM bob_tasks`,
  models: `SELECT COALESCE(model, 'auto') model, COUNT(*) n FROM bob_requests GROUP BY 1`,
  tools: `SELECT COALESCE(name, '?') tool, COALESCE(status, 'pending') status, COUNT(*) n FROM bob_tools GROUP BY 1, 2`,
});
