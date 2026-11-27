// Finto bob.db di IBM Bob (Bob IDE 2.x e Bob Shell 2.x) per i test e per la lens di sviluppo, con lo
// schema che scripts/bob-probe.mjs ha letto da un bob.db vero (user_version 10, ottobre 2026):
//   - tasks: task_type normal | subagent | subtask, status active | completed | error, directory,
//     env JSON (modeId), costs JSON { input, output, cacheRead, cacheWrite, cost, contextTokens };
//   - messages: id testuale, role user | assistant | tool | system, data JSON:
//       user       { _meta: { mode: { id, name }, timestamp } }
//       assistant  { _meta: { timestamp, spend: { input, output, cacheRead, cacheWrite, cost, contextTokens,
//                    reasoningTokens } }, toolCalls: [{ id, name, arguments }] }
//       tool       { toolUsage: { signature: { id, name, arguments, isError } }, _meta: { durationMs, timestamp } }
//   - `input` di spend comprende i token letti e scritti in cache (contextTokens ≈ input).
// Bob non salva il modello usato. Titoli, contenuti e argomenti contengono "SEGRETO": la lens non deve
// mai salvarli.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const BOB_SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT REFERENCES tasks(id), title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', first_message TEXT, directory TEXT NOT NULL, version TEXT, git_sha TEXT, git_branch TEXT,
  env TEXT, costs TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, time_archived INTEGER, locked_by TEXT,
  lock_lease_until INTEGER, approval_config TEXT, message_queue TEXT,
  task_type TEXT NOT NULL DEFAULT 'normal' CHECK (task_type IN ('normal', 'subtask', 'subagent')), last_error TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, role TEXT NOT NULL, data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task_pending_approvals (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, request_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY (task_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, created_at);
PRAGMA user_version = 10;
`;

export const SECRET = "SEGRETO";

/** Opens (and creates) a fake bob.db with the schema above. */
export function openFakeBob(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(BOB_SCHEMA);
  return db;
}

// The ids come from fixed sequences: the same calls give the same ids, and resetFakeIds() starts them again, so a
// recording of what the lens reads from a fake bob.db (bob-regression.test.js) is the same from run to run.
let idRand = rng(1);
let uuidN = 0;
let msgN = 0;

/** Starts the sequences of the fake ids again. */
export function resetFakeIds() {
  idRand = rng(1);
  uuidN = 0;
  msgN = 0;
}

/** A UUID-shaped id, deterministic within a run. */
export function fakeUuid(rand = idRand) {
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
  uuidN++;
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${(uuidN % 1e12).toString(16).padStart(12, "0")}`;
}

const msgId = () => `msg_${(++msgN).toString(36).padStart(8, "0")}`;

/**
 * Adds one task with its messages. `requests` are the model calls: each one an assistant message with its
 * spend and tool calls, followed by a tool message per call; `prompt` (a time) puts a new user message
 * before it, as a new prompt of the task. Token counts are the fresh ones: the spend's `input` gets the
 * cache added, as Bob writes it. Returns the task id.
 * @param {DatabaseSync} db
 * @param {{ id?: string, parent?: string|null, cwd?: string, type?: string, mode?: string, status?: string, created: number,
 *   error?: boolean, requests?: { at: number, prompt?: number, mode?: string, input?: number, output?: number, cacheRead?: number,
 *   cacheWrite?: number, cost?: number, cancelled?: boolean, tools?: { name: string, error?: boolean, ms?: number }[] }[] }} t
 */
export function addTask(db, t) {
  const id = t.id ?? fakeUuid();
  const mode = t.mode ?? "code";
  const requests = t.requests ?? [];
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 };
  const cwd = t.cwd ?? "/Users/dev/progetto";
  // the task first (messages reference it), its totals and last update once the messages are in
  db.prepare(
    `INSERT INTO tasks (id, project_id, parent_id, title, status, first_message, directory, env, costs, created_at, updated_at, task_type, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(
    id,
    `file:${cwd}`,
    t.parent ?? null,
    `${SECRET}: titolo del task`,
    t.status ?? (t.parent ? "completed" : "active"),
    `${SECRET}: primo messaggio`,
    cwd,
    JSON.stringify({ id, workspace: cwd, modeId: mode }),
    t.created,
    t.created,
    t.type ?? (t.parent ? "subagent" : "normal"),
    t.error ? JSON.stringify({ name: "ApiError", message: SECRET }) : null,
  );
  const insert = db.prepare("INSERT INTO messages (id, task_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)");
  const user = (at, m) =>
    insert.run(msgId(), id, "user", JSON.stringify({ role: "user", content: `${SECRET}: il prompt dell'utente`, _meta: { mode: { id: m, name: m, roleDefinition: SECRET }, timestamp: at } }), at);
  user(t.created, mode);
  let last = t.created;
  for (const r of requests) {
    if (r.prompt) user(r.prompt, r.mode ?? mode);
    const fresh = r.input ?? 0;
    const spend = {
      input: fresh + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0),
      output: r.output ?? 0,
      cacheRead: r.cacheRead ?? 0,
      cacheWrite: r.cacheWrite ?? 0,
      cost: r.cost ?? 0,
      reasoningTokens: 0,
    };
    spend.contextTokens = spend.input + spend.output;
    for (const k of ["input", "output", "cacheRead", "cacheWrite", "cost"]) sum[k] += spend[k];
    sum.contextTokens = spend.contextTokens;
    const calls = (r.tools ?? []).map((tool) => ({ id: `toolu_${msgId()}`, name: tool.name, arguments: { path: `/Users/${SECRET}/file.js` } }));
    const meta = { timestamp: r.at, spend, ...(r.cancelled ? { stopReason: "user_cancelled" } : {}) };
    insert.run(msgId(), id, "assistant", JSON.stringify({ role: "assistant", content: `${SECRET}: la risposta`, id: msgId(), _meta: meta, ...(calls.length ? { toolCalls: calls } : {}) }), r.at);
    let at = r.at;
    (r.tools ?? []).forEach((tool, i) => {
      const ms = tool.ms ?? 400;
      at += ms;
      const signature = { ...calls[i], isError: !!tool.error };
      insert.run(msgId(), id, "tool", JSON.stringify({ role: "tool", content: `${SECRET}: output del tool`, id: msgId(), toolUsage: { signature, permission: "auto" }, _meta: { durationMs: ms, timestamp: at } }), at);
    });
    last = Math.max(last, at);
  }
  sum.cost = Math.round(sum.cost * 1e6) / 1e6;
  db.prepare("UPDATE tasks SET costs = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(sum), last, id);
  return id;
}

/** Deterministic pseudo-random numbers (mulberry32). */
export function rng(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = ["/Users/dev/gestionale", "/Users/dev/api-ordini", "/Users/dev/sito-vetrina", "/Users/dev/legacy-rpg"];
const MODES = ["code", "code", "code", "plan", "ask", "advanced"];
const TOOLS = ["read_file", "read_file", "read_file", "grep", "glob", "list_files", "apply_diff", "write_file", "execute_command", "update_todo_list"];

/**
 * A month of Bob usage ending at `now`: a few tasks a day on working days, each with one to three prompts,
 * some with a subagent, one task in progress at the end. Same `seed`, same data.
 * @returns {{ tasks: number, subagents: number, prompts: number, messages: number }}
 */
export function seedFakeBob(db, { now = Date.now(), days = 30, seed = 7 } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const day = 86_400_000;
  let tasks = 0;
  let subagents = 0;
  let prompts = 0;
  const call = (at) => {
    const input = 1500 + Math.floor(rand() * 6000);
    return {
      at,
      input,
      output: 60 + Math.floor(rand() * 4000),
      cacheRead: Math.floor(20_000 + rand() * 180_000),
      cacheWrite: Math.floor(rand() * 8000),
      cost: Math.round((0.03 + rand() * 0.4) * 1e6) / 1e6,
      tools: Array.from({ length: Math.floor(rand() * 3) }, () => ({ name: pick(TOOLS), error: rand() < 0.06, ms: 50 + Math.floor(rand() * 3000) })),
    };
  };
  db.exec("BEGIN");
  try {
    for (let d = days; d >= 0; d--) {
      const date = new Date(now - d * day);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const n = weekend ? (rand() < 0.3 ? 1 : 0) : 2 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const start = now - d * day - Math.floor(rand() * 9 * 3_600_000);
        if (start > now - 3_600_000) continue;
        const cwd = pick(DIRS);
        const mode = pick(MODES);
        const requests = [];
        let at = start + 3000;
        const turns = 1 + Math.floor(rand() * 3);
        let spawn = false;
        for (let k = 0; k < turns; k++) {
          if (k > 0) {
            at += 60_000 + Math.floor(rand() * 600_000); // the next prompt, after a pause
            requests.push({ ...call(at), prompt: at - 2000, mode: rand() < 0.3 ? pick(MODES) : mode });
          } else requests.push(call(at));
          prompts++;
          const steps = 1 + Math.floor(rand() * 5);
          for (let s = 1; s < steps; s++) {
            at += 5000 + Math.floor(rand() * 40_000);
            requests.push(call(at));
          }
          at += 10_000;
          if (!spawn && rand() < 0.3) spawn = at;
        }
        const id = addTask(db, { cwd, mode, created: start, status: rand() < 0.1 ? "completed" : rand() < 0.03 ? "error" : "active", requests });
        tasks++;
        if (spawn) {
          addTask(db, {
            parent: id,
            cwd,
            mode: "code",
            type: rand() < 0.1 ? "subtask" : "subagent",
            created: spawn,
            requests: [call(spawn + 2000), call(spawn + 20_000)],
          });
          subagents++;
        }
      }
    }
    // one task in progress, a few minutes ago
    addTask(db, { cwd: DIRS[0], mode: "code", created: now - 240_000, requests: [{ ...call(now - 230_000), tools: [{ name: "read_file" }] }] });
    tasks++;
    prompts++;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  const messages = db.prepare("SELECT COUNT(*) n FROM messages").get().n;
  return { tasks, subagents, prompts, messages };
}

/** Writes a fresh fake bob.db at `file` (deleting the old one and its -wal/-shm). */
export function writeFakeBob(file, opts) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  const db = openFakeBob(file);
  try {
    return seedFakeBob(db, opts);
  } finally {
    db.close();
  }
}
