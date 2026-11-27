// What the lens's database is: tables, indexes, schema version, the columns migrations add, and the
// expressions the indexes are on. A leaf: it imports nothing. src/store.js runs it (exec, migrations,
// writes); the reader (src/queries.js) takes the expressions from here, so a query can never drift from its
// index into a full scan. A module's tables are its own (modules/<id>/tables.js, src/module-tables.js).

const qualify = (alias, cols) => cols.map((c) => (alias ? `${alias}.${c}` : c)).join(", ");

// The time of a step and of a tool call that range reads filter on (steps_ts, tools_ts); with an alias for a
// query that joins the table under another name.
export const stepTs = (alias) => `COALESCE(${qualify(alias, ["ended", "last_started", "started"])})`;
export const toolTs = (alias) => `COALESCE(${qualify(alias, ["ended", "ran", "created"])})`;
// when a step started: its first attempt, else its last one, else its end
export const stepStart = (alias) => `COALESCE(${qualify(alias, ["started", "last_started", "ended"])})`;
export const STEP_TS = stepTs();
export const TOOL_TS = toolTs();
// a permission prompt: when it was asked, else when it was answered (permissions_asked)
export const PERMISSION_TS = `COALESCE(${qualify(null, ["asked", "replied"])})`;
export const STEP_START = stepStart();
// a model as the dashboard groups it: provider/model, and #variant when it is not the default one
export const MODEL_KEY = `COALESCE(provider, '?') || '/' || COALESCE(model, '?') ||
  CASE WHEN variant IS NOT NULL AND variant <> 'default' THEN '#' || variant ELSE '' END`;

export const SCHEMA_VERSION = 6;
// a database older than this schema re-reads its sessions from OpenCode: the migrations up to v5 change what
// is read from the messages
export const REREAD_BELOW = 5;

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA journal_size_limit = 67108864;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  project_id TEXT,
  directory TEXT,
  title TEXT,
  cost REAL NOT NULL DEFAULT 0,
  t_in INTEGER NOT NULL DEFAULT 0,
  t_out INTEGER NOT NULL DEFAULT 0,
  t_reason INTEGER NOT NULL DEFAULT 0,
  t_cread INTEGER NOT NULL DEFAULT 0,
  t_cwrite INTEGER NOT NULL DEFAULT 0,
  created INTEGER,
  updated INTEGER,
  deleted INTEGER,
  last_activity INTEGER,
  synced_cost REAL,          -- session totals seen at last message sync
  synced_tokens INTEGER,
  synced_updated INTEGER,
  msg_watermark INTEGER      -- where the next message sync resumes: the newest finished message, or the start of the oldest one still open (src/reader.js)
);

-- one row per assistant message (= one provider step; retries reuse the id)
-- databases from older versions also have an unused "source" column: harmless, left there
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent TEXT,
  provider TEXT,
  model TEXT,
  variant TEXT,
  started INTEGER,
  last_started INTEGER,
  ended INTEGER,
  attempts INTEGER NOT NULL DEFAULT 1,
  finish TEXT,
  error_type TEXT,
  error_msg TEXT,
  cost REAL,
  t_in INTEGER, t_out INTEGER, t_reason INTEGER, t_cread INTEGER, t_cwrite INTEGER,
  requested INTEGER,         -- start of the last attempt: the request to the provider
  first_output INTEGER,      -- first text, reasoning or tool input of the last attempt
  streamed INTEGER           -- end of the provider stream (tools may still run after it)
);
CREATE INDEX IF NOT EXISTS steps_ts ON steps (${STEP_TS});
CREATE INDEX IF NOT EXISTS steps_session ON steps (session_id);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,       -- messageID:callID
  session_id TEXT NOT NULL,
  message_id TEXT,
  call_id TEXT,
  name TEXT,
  status TEXT,               -- pending | running | completed | error
  error_type TEXT,
  error_msg TEXT,
  created INTEGER,
  ran INTEGER,
  ended INTEGER
);
CREATE INDEX IF NOT EXISTS tools_ts ON tools (${TOOL_TS});

-- usage not attributable to a step: exact rows (title, compaction) from
-- OpenCode, plus the estimate (kind NULL): session total minus steps minus
-- the rows already recorded, as deltas when it grows
CREATE TABLE IF NOT EXISTS internal_usage (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  t_in INTEGER NOT NULL DEFAULT 0,
  t_out INTEGER NOT NULL DEFAULT 0,
  t_reason INTEGER NOT NULL DEFAULT 0,
  t_cread INTEGER NOT NULL DEFAULT 0,
  t_cwrite INTEGER NOT NULL DEFAULT 0,
  kind TEXT,                 -- title | compaction | NULL = estimate ("altro")
  provider TEXT, model TEXT, variant TEXT,
  reason TEXT                -- auto | manual (compaction)
);
CREATE INDEX IF NOT EXISTS internal_created ON internal_usage (created);
CREATE INDEX IF NOT EXISTS internal_session ON internal_usage (session_id);

-- notable live-only signals: retries, failed executions, compactions
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,       -- OpenCode event id
  type TEXT NOT NULL,
  session_id TEXT,
  message_id TEXT,
  created INTEGER NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS signals_created ON signals (created);

-- one row per user prompt (user message); never the text, only its size
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,       -- message id
  session_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  chars INTEGER NOT NULL DEFAULT 0,
  files INTEGER NOT NULL DEFAULT 0,
  agents INTEGER NOT NULL DEFAULT 0,
  delivery TEXT              -- queue | steer, only when seen live
);
CREATE INDEX IF NOT EXISTS prompts_created ON prompts (created);

-- one row per run: from the prompt to the idle message that closes it
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,       -- idle message id
  session_id TEXT NOT NULL,
  started INTEGER,
  ended INTEGER NOT NULL,
  outcome TEXT,              -- succeeded | failed | interrupted | ...
  reason TEXT                -- why it was interrupted (user | superseded | inactivity | shutdown), live only
);
CREATE INDEX IF NOT EXISTS runs_ended ON runs (ended);
CREATE INDEX IF NOT EXISTS runs_session ON runs (session_id);

-- permission prompts, live only (OpenCode keeps only the pending ones)
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,       -- request id
  session_id TEXT,
  action TEXT,
  resources INTEGER,
  asked INTEGER,
  replied INTEGER,
  reply TEXT                 -- once | always | reject
);
CREATE INDEX IF NOT EXISTS permissions_asked ON permissions (${PERMISSION_TS});

CREATE TABLE IF NOT EXISTS skill_uses (
  id TEXT PRIMARY KEY,   -- msg:call (skill), msg:call:i (execute toolCalls), msg (skill message),
                         -- msg:skill:<id> (skills[] of a user message), mcp:<uuid> (prompt)
  session_id TEXT,       -- NULL for lens-prompt
  message_id TEXT,
  at INTEGER NOT NULL,
  channel TEXT NOT NULL, -- skill | activated | lens-preset | lens-prompt
  skill_id TEXT,         -- NULL for a preset's own row
  preset_id TEXT,
  version INTEGER,       -- library skill version delivered (origin lens); NULL otherwise
  status TEXT,           -- completed | error
  origin TEXT            -- lens | native
);
CREATE INDEX IF NOT EXISTS skill_uses_at ON skill_uses (at);
-- what /metrics keeps of rows the lens deleted (retention, a future migration): Queries.families() adds it to
-- counters and summaries so none of them goes down; written only by Store.deleteCompensated
CREATE TABLE IF NOT EXISTS counter_offsets (
  name TEXT NOT NULL,        -- a counter, or a summary's <name>_sum / <name>_count
  labels TEXT NOT NULL,      -- its labels: JSON of the [key, value] pairs sorted by key
  value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (name, labels)
);
-- steps and tool calls the retention deleted (LENS_RETENTION_DAYS), summed per local day: what the totals of
-- «Tutto» and each session's reconciliation still count
CREATE TABLE IF NOT EXISTS daily_steps (
  day INTEGER NOT NULL,      -- local midnight of the day of the steps (STEP_TS)
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,    -- '?' when unknown, as the dashboard groups them
  model TEXT NOT NULL,
  variant TEXT NOT NULL,     -- 'default' when none (MODEL_KEY then adds no suffix)
  agent TEXT NOT NULL,
  steps INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  cost REAL NOT NULL,
  t_in INTEGER NOT NULL, t_out INTEGER NOT NULL, t_reason INTEGER NOT NULL, t_cread INTEGER NOT NULL, t_cwrite INTEGER NOT NULL,
  PRIMARY KEY (day, session_id, provider, model, variant, agent)
);
CREATE INDEX IF NOT EXISTS daily_steps_session ON daily_steps (session_id);
CREATE TABLE IF NOT EXISTS daily_tools (
  day INTEGER NOT NULL,      -- local midnight of the day of the calls (TOOL_TS)
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,        -- '?' when unknown
  calls INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  PRIMARY KEY (day, session_id, name)
);
`;

// columns migrations add to tables of older databases
export const TOOL_COLUMNS = Object.freeze({ child_session: "TEXT", out_bytes: "INTEGER", provider_exec: "INTEGER", is_commit: "INTEGER" });
export const V4_COLUMNS = Object.freeze({
  steps: Object.freeze({ requested: "INTEGER", first_output: "INTEGER", streamed: "INTEGER" }),
  runs: Object.freeze({ reason: "TEXT" }),
  internal_usage: Object.freeze({ kind: "TEXT", provider: "TEXT", model: "TEXT", variant: "TEXT", reason: "TEXT" }),
});
// indexes each migration creates, by the schema version it brings
export const MIGRATION_INDEXES = Object.freeze({
  2: Object.freeze(["CREATE INDEX IF NOT EXISTS tools_child ON tools (child_session)"]),
  3: Object.freeze(["CREATE INDEX IF NOT EXISTS tools_message ON tools (message_id)", "CREATE INDEX IF NOT EXISTS tools_session ON tools (session_id)"]),
  4: Object.freeze(["CREATE INDEX IF NOT EXISTS internal_session ON internal_usage (session_id)"]),
});

// the columns of OpenCode's tables, in their order (the views of src/source-views.js have exactly these)
export const TABLE_COLUMNS = Object.freeze({
  steps: "id, session_id, agent, provider, model, variant, started, last_started, ended, attempts, finish, error_type, error_msg, cost, t_in, t_out, t_reason, t_cread, t_cwrite, requested, first_output, streamed",
  sessions: "id, parent_id, project_id, directory, title, cost, t_in, t_out, t_reason, t_cread, t_cwrite, created, updated, deleted, last_activity, synced_cost, synced_tokens, synced_updated, msg_watermark",
  tools: "id, session_id, message_id, call_id, name, status, error_type, error_msg, created, ran, ended, child_session, out_bytes, provider_exec, is_commit",
  prompts: "id, session_id, created, chars, files, agents, delivery",
  runs: "id, session_id, started, ended, outcome, reason",
  internal_usage: "id, session_id, created, cost, t_in, t_out, t_reason, t_cread, t_cwrite, kind, provider, model, variant, reason",
  signals: "id, type, session_id, message_id, created, detail",
  permissions: "id, session_id, action, resources, asked, replied, reply",
  daily_steps: "day, session_id, provider, model, variant, agent, steps, failed, cost, t_in, t_out, t_reason, t_cread, t_cwrite",
  daily_tools: "day, session_id, name, calls, errors",
});
// OpenCode's tables, as Impostazioni counts their rows
export const OPENCODE_TABLES = Object.freeze(["sessions", "steps", "tools", "internal_usage", "signals", "prompts", "runs", "permissions"]);
