// Reads of the bob_* tables with ctx.reader: the «IBM Bob» page (GET /api/bob), Bob's share of a period that the
// dashboard's source selector adds to /api/summary (totals) and where Bob's data starts (earliest, for «Tutto»).
// The selector's answers themselves come from OpenCode's queries over views of Bob (server/views.js). Never
// OpenCode's tables.
//
// When a Bob task was used is taken from its model calls (bob_requests.created), as OpenCode's steps; a task whose
// calls carry no Bobcoins counts its own total at its last update, and one with no calls at all counts its tokens
// there too. Bob's totals per task stay the reference.

// one row per piece of usage, with the time it counts at: see the comment above
const USAGE = `
WITH rc AS (SELECT task_id, COUNT(coins) n FROM bob_requests GROUP BY task_id),
usage AS (
  SELECT r.task_id, r.model, CASE WHEN rc.n > 0 THEN r.coins END coins,
    r.t_in, r.t_out, r.t_cread, r.t_cwrite, r.created ts, 1 calls
  FROM bob_requests r JOIN rc ON rc.task_id = r.task_id
  UNION ALL
  SELECT t.id, NULL, t.coins,
    CASE WHEN t.requests = 0 THEN t.t_in ELSE 0 END, CASE WHEN t.requests = 0 THEN t.t_out ELSE 0 END,
    CASE WHEN t.requests = 0 THEN t.t_cread ELSE 0 END, CASE WHEN t.requests = 0 THEN t.t_cwrite ELSE 0 END,
    COALESCE(t.updated, t.created), 0
  FROM bob_tasks t LEFT JOIN rc ON rc.task_id = t.id WHERE COALESCE(rc.n, 0) = 0
)`;
const SUMS = `COALESCE(SUM(u.coins), 0) coins, COALESCE(SUM(u.t_in), 0) t_in, COALESCE(SUM(u.t_out), 0) t_out,
  COALESCE(SUM(u.t_cread), 0) t_cread, COALESCE(SUM(u.t_cwrite), 0) t_cwrite, COALESCE(SUM(u.calls), 0) calls`;
// the time of a tool call (the bob_tools_ts index)
const TOOL_TS = "COALESCE(ended, created)";
// Bob leaves its main tasks «active» after the work is done: one counts as running only while it moves
export const RUNNING_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const TOP = 12;

// every SQL text the queries run, one fixed text each (exported for the query-plan test)
export const SQL = Object.freeze({
  totals: `${USAGE} SELECT ${SUMS}, COUNT(DISTINCT u.task_id) tasks FROM usage u WHERE u.ts >= ? AND u.ts < ?`,
  toolTotals: `SELECT COUNT(*) calls, COALESCE(SUM(status = 'error'), 0) errors FROM bob_tools WHERE ${TOOL_TS} >= ? AND ${TOOL_TS} < ?`,
  tasks: `SELECT COALESCE(SUM(kind = 'task'), 0) roots, COALESCE(SUM(kind = 'subagent'), 0) subagents FROM bob_tasks WHERE created >= ? AND created < ?`,
  running: `SELECT COUNT(*) n FROM bob_tasks WHERE kind = 'task' AND status = 'active' AND updated >= ?`,
  usageRows: `${USAGE} SELECT u.ts, u.coins, u.t_in, u.t_out, u.t_cread, u.t_cwrite FROM usage u WHERE u.ts >= ? AND u.ts < ? ORDER BY u.ts`,
  taskStarts: `SELECT created FROM bob_tasks WHERE kind = 'task' AND created >= ? AND created < ?`,
  byDirectory: `${USAGE} SELECT COALESCE(t.directory, '?') directory, ${SUMS}, COUNT(DISTINCT CASE WHEN t.kind = 'task' THEN t.id END) tasks, MAX(u.ts) last
    FROM usage u JOIN bob_tasks t ON t.id = u.task_id WHERE u.ts >= ? AND u.ts < ? GROUP BY 1 ORDER BY coins DESC, directory`,
  byModel: `SELECT COALESCE(model, 'auto') model, COUNT(*) requests, COALESCE(SUM(coins), 0) coins,
      COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out, COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite
    FROM bob_requests WHERE created >= ? AND created < ? GROUP BY 1 ORDER BY requests DESC, model`,
  byMode: `${USAGE} SELECT COALESCE(t.mode, '?') mode, ${SUMS}, COUNT(DISTINCT t.id) tasks
    FROM usage u JOIN bob_tasks t ON t.id = u.task_id WHERE u.ts >= ? AND u.ts < ? GROUP BY 1 ORDER BY coins DESC, mode`,
  tools: `SELECT COALESCE(name, '?') name, COUNT(*) calls, COALESCE(SUM(status = 'error'), 0) errors,
      AVG(CASE WHEN ended IS NOT NULL AND created IS NOT NULL AND ended >= created THEN ended - created END) avg_ms
    FROM bob_tools WHERE ${TOOL_TS} >= ? AND ${TOOL_TS} < ? GROUP BY 1 ORDER BY calls DESC, name LIMIT ${TOP}`,
  recent: `SELECT t.id, t.directory, t.mode, t.status, t.coins, t.t_in, t.t_out, t.t_cread, t.t_cwrite, t.requests, t.created, t.updated,
      (SELECT COUNT(*) FROM bob_tasks s WHERE s.parent_id = t.id) subagents,
      (SELECT COALESCE(SUM(s.coins), 0) FROM bob_tasks s WHERE s.parent_id = t.id) sub_coins,
      (SELECT COUNT(*) FROM bob_tools x WHERE x.task_id = t.id) tools,
      (SELECT COUNT(*) FROM bob_tools x WHERE x.task_id = t.id AND x.status = 'error') tool_errors
    FROM bob_tasks t WHERE t.kind = 'task' AND COALESCE(t.updated, t.created) >= ? AND t.created < ?
    ORDER BY COALESCE(t.updated, t.created) DESC LIMIT 25`,
  // the oldest of Bob's data: a model call, a tool call, a task (each MIN on its own index)
  earliest: `SELECT MIN(m) m FROM (
      SELECT MIN(created) m FROM bob_requests
      UNION ALL SELECT MIN(${TOOL_TS}) FROM bob_tools
      UNION ALL SELECT MIN(created) FROM bob_tasks)`,
  any: `SELECT 1 FROM bob_tasks LIMIT 1`,
});

/** A task's state for people: running (active and moving), idle (active, still), completed or error. */
export function taskState(status, updated, now = Date.now()) {
  if (status === "active") return updated != null && now - updated < RUNNING_MS ? "running" : "idle";
  return status ?? null;
}

/** Tokens as /api/summary shapes them: Bob has no reasoning tokens apart. */
export function bobTokens(r) {
  const input = r?.t_in ?? 0;
  const output = r?.t_out ?? 0;
  const cacheRead = r?.t_cread ?? 0;
  const cacheWrite = r?.t_cwrite ?? 0;
  return { input, output, reasoning: 0, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/** Local calendar day "YYYY-MM-DD" of a time. */
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whether module bob has recorded at least one task (hasData). */
export const hasTasks = (reader) => !!reader.get(SQL.any);

export class BobQueries {
  /** @param {object} ctx the module's ctx: reader, and settings { coinUsd, monthlyCoins } */
  constructor(ctx) {
    this.reader = ctx.reader;
    this.coinUsd = ctx.settings.coinUsd ?? 0.5;
    this.monthlyCoins = ctx.settings.monthlyCoins ?? null;
  }

  usd(coins) {
    return coins * this.coinUsd;
  }

  /** The time of Bob's oldest row (a model call, a tool call or a task), null without any: «Tutto» starts there. */
  earliest() {
    return this.reader.get(SQL.earliest).m ?? null;
  }

  /**
   * Bob in a period, as the source selector adds it to /api/summary (`bob`): Bobcoins and their USD, tokens, the
   * tasks used in it (subagents included, as OpenCode's child sessions) and the tool calls.
   */
  totals(from, to) {
    const u = this.reader.get(SQL.totals, from, to);
    const tools = this.reader.get(SQL.toolTotals, from, to);
    return {
      coins: u.coins,
      cost: this.usd(u.coins),
      tokens: bobTokens(u),
      sessions: u.tasks,
      requests: u.calls,
      tools: { calls: tools.calls, errors: tools.errors },
    };
  }

  /** The «IBM Bob» page for a period. */
  page(from, to, now = Date.now()) {
    const { reader } = this;
    const totals = this.totals(from, to);
    const tasks = reader.get(SQL.tasks, from, to);
    // running now, whenever it started
    const running = reader.get(SQL.running, now - RUNNING_MS).n;

    // per day: from the first day of the period (or of the data, for «Da sempre») to the last
    const rows = reader.all(SQL.usageRows, from, to);
    const days = new Map();
    const start = from > 0 ? from : (rows[0]?.ts ?? now);
    for (let d = new Date(start).setHours(0, 0, 0, 0); d < Math.min(to, now + 1); d = new Date(d + DAY_MS * 1.5).setHours(0, 0, 0, 0)) {
      days.set(dayKey(d), { day: dayKey(d), at: d, coins: 0, tokens: 0, tasks: 0 });
    }
    for (const r of rows) {
      const k = dayKey(r.ts);
      const b = days.get(k) ?? days.set(k, { day: k, at: new Date(r.ts).setHours(0, 0, 0, 0), coins: 0, tokens: 0, tasks: 0 }).get(k);
      b.coins += r.coins ?? 0;
      b.tokens += (r.t_in ?? 0) + (r.t_out ?? 0) + (r.t_cread ?? 0) + (r.t_cwrite ?? 0);
    }
    for (const r of reader.all(SQL.taskStarts, from, to)) {
      const b = days.get(dayKey(r.created));
      if (b) b.tasks++;
    }
    const byDay = [...days.values()].sort((a, b) => a.at - b.at).map((d) => ({ ...d, cost: this.usd(d.coins) }));

    const byDirectory = reader
      .all(SQL.byDirectory, from, to)
      .map((r) => ({ directory: r.directory, tasks: r.tasks, coins: r.coins, cost: this.usd(r.coins), tokens: bobTokens(r).total, lastAt: r.last }));
    const byModel = reader.all(SQL.byModel, from, to).map((r) => ({ model: r.model, requests: r.requests, coins: r.coins, tokens: bobTokens(r).total }));
    const byMode = reader.all(SQL.byMode, from, to).map((r) => ({ mode: r.mode, tasks: r.tasks, coins: r.coins, tokens: bobTokens(r).total }));
    const tools = reader.all(SQL.tools, from, to).map((r) => ({ name: r.name, calls: r.calls, errors: r.errors, avgMs: r.avg_ms === null ? null : Math.round(r.avg_ms) }));
    const recent = reader.all(SQL.recent, from, to).map((r) => ({
      id: r.id,
      directory: r.directory,
      mode: r.mode,
      status: r.status,
      state: taskState(r.status, r.updated, now),
      coins: r.coins ?? 0,
      subagentCoins: r.sub_coins,
      cost: this.usd((r.coins ?? 0) + r.sub_coins),
      tokens: bobTokens(r).total,
      requests: r.requests ?? 0,
      subagents: r.subagents,
      tools: r.tools,
      toolErrors: r.tool_errors,
      created: r.created,
      updated: r.updated,
      durationMs: r.updated && r.created ? Math.max(0, r.updated - r.created) : null,
    }));

    return {
      from,
      to,
      coinUsd: this.coinUsd,
      totals: { ...totals, tasks: tasks.roots, subagents: tasks.subagents, running },
      byDay,
      byDirectory,
      byModel,
      byMode,
      tools,
      recent,
      month: this.month(now),
    };
  }

  /** This month's Bobcoins against LENS_BOB_COINS_MONTHLY, with the pace to the end of the month. */
  month(now = Date.now()) {
    const d = new Date(now);
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const { coins } = this.totals(from, to);
    const elapsed = Math.max(1, now - from);
    const projected = (coins * (to - from)) / elapsed;
    return {
      from,
      to,
      coins,
      cost: this.usd(coins),
      limit: this.monthlyCoins,
      ratio: this.monthlyCoins ? coins / this.monthlyCoins : null,
      projected,
      projectedRatio: this.monthlyCoins ? projected / this.monthlyCoins : null,
    };
  }
}
