// IBM Bob's tables in the lens's database, created by the core (src/module-tables.js): never joined to OpenCode's,
// so OpenCode's numbers cannot change. No titles, prompts or outputs: Bob's titles are the first words of the prompt.
// `columns`: what a bob_tools of an older lens (0.32.0) lacks, added before the indexes. Imports nothing.
export default {
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS bob_tasks (
  id TEXT PRIMARY KEY,       -- Bob's task id (UUID)
  parent_id TEXT,            -- the task that spawned this subagent
  kind TEXT,                 -- task | subagent
  directory TEXT,            -- from project_id file:<cwd>
  status TEXT,               -- running | completed | ...
  mode TEXT,                 -- code | plan | ask | advanced | ...
  coins REAL,                -- Bobcoins, Bob's own total for the task
  t_in INTEGER, t_out INTEGER, t_cread INTEGER, t_cwrite INTEGER,
  requests INTEGER,          -- model calls seen in the messages
  created INTEGER,
  updated INTEGER,           -- Bob's updated_at: a task is read again when it moves
  msg_watermark INTEGER      -- created_at of the last message read
);
CREATE INDEX IF NOT EXISTS bob_tasks_created ON bob_tasks (created);

-- one row per model call (an assistant message with usage)
CREATE TABLE IF NOT EXISTS bob_requests (
  id TEXT PRIMARY KEY,       -- task:message
  task_id TEXT NOT NULL,
  model TEXT,
  coins REAL,
  t_in INTEGER, t_out INTEGER, t_cread INTEGER, t_cwrite INTEGER,
  created INTEGER
);
CREATE INDEX IF NOT EXISTS bob_requests_created ON bob_requests (created);
CREATE INDEX IF NOT EXISTS bob_requests_task ON bob_requests (task_id);

CREATE TABLE IF NOT EXISTS bob_tools (
  id TEXT PRIMARY KEY,       -- task:call
  task_id TEXT NOT NULL,
  name TEXT,
  status TEXT,               -- pending | completed | error
  created INTEGER,
  ended INTEGER,
  child_task TEXT,           -- the subagent a spawn_subagent call started
  message_id TEXT            -- the model call (bob_requests.id) that asked for it
);
CREATE INDEX IF NOT EXISTS bob_tools_ts ON bob_tools (COALESCE(ended, created));

-- one row per user message of a Bob task: when it was sent, never the text
CREATE TABLE IF NOT EXISTS bob_prompts (
  id TEXT PRIMARY KEY,       -- task:message
  task_id TEXT NOT NULL,
  created INTEGER
);
CREATE INDEX IF NOT EXISTS bob_prompts_created ON bob_prompts (created);

-- one row per prompt of a main task: what Bob did after it, up to the next prompt (server/source.js computes
-- it when it reads a task, so the runs view of server/views.js is a plain read)
CREATE TABLE IF NOT EXISTS bob_runs (
  id TEXT PRIMARY KEY,       -- the prompt (bob_prompts.id)
  task_id TEXT NOT NULL,
  started INTEGER,           -- the prompt
  ended INTEGER,             -- the last model call or tool before the next prompt; NULL: nothing yet
  last INTEGER               -- 1 for the task's latest prompt, which may still be running
);
CREATE INDEX IF NOT EXISTS bob_runs_ended ON bob_runs (ended);
CREATE INDEX IF NOT EXISTS bob_runs_task ON bob_runs (task_id);
CREATE INDEX IF NOT EXISTS bob_tools_task ON bob_tools (task_id);
`,
  columns: { bob_tools: { message_id: "TEXT" } },
};
