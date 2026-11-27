// Read-side aggregations for the dashboard and /metrics.
import { splitLimits } from "./opencode-config.js";
import { MODEL_KEY, PERMISSION_TS, STEP_START, STEP_TS as TS, TOOL_TS, stepStart, stepTs, toolTs } from "./schema.js";
import { compactionFeedItem } from "./store.js";
import { VERSION } from "./version.js";
import { localDay, MIDNIGHT, periodBounds } from "./period.js";

// kept here for the modules and tests that import it from queries.js
export { periodBounds };

/** A series' labels in one canonical form, whatever order they were built in: JSON of the [key, value] pairs sorted by key. */
export function labelKey(labels) {
  return JSON.stringify(Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** SQL expression of a dimension; anything unknown (also "constructor", "__proto__") is the model. */
function dimOf(by) {
  return Object.hasOwn(DIMS, by) ? DIMS[by] : DIMS.model;
}

const DIMS = {
  model: MODEL_KEY,
  provider: "COALESCE(provider, '?')",
  agent: "COALESCE(agent, '?')",
  directory: "COALESCE((SELECT directory FROM sessions WHERE sessions.id = steps.session_id), '?')",
  kind: "CASE WHEN (SELECT parent_id FROM sessions WHERE sessions.id = steps.session_id) IS NULL THEN 'primario' ELSE 'subagente' END",
  total: "'totale'", // one series: the whole period
};

// A session and all its descendants (subagents of subagents too). UNION, not
// UNION ALL: a parent cycle in bad data must not loop forever.
const TREE = `tree(root, id) AS (
  SELECT id, id FROM sessions WHERE id IN (SELECT value FROM json_each(?))
  UNION SELECT tree.root, s.id FROM sessions s JOIN tree ON s.parent_id = tree.id)`;
// SQL fragments also handed to the modules (ctx.sql)
export const ST_TS = stepTs("st");
export const ST_TOKENS = "COALESCE(st.t_in,0)+COALESCE(st.t_out,0)+COALESCE(st.t_reason,0)+COALESCE(st.t_cread,0)+COALESCE(st.t_cwrite,0)";

// the folder of a step (unknown when the session has none), as the `directory` dimension
export const FOLDER = "COALESCE((SELECT directory FROM sessions WHERE sessions.id = steps.session_id), '?')";
export const TOKENS = "COALESCE(t_in,0)+COALESCE(t_out,0)+COALESCE(t_reason,0)+COALESCE(t_cread,0)+COALESCE(t_cwrite,0)";
const NO_LIMITS = Object.freeze({ tokens: null, cost: null, steps: null });
// working hours of today (local), kept in /api/today next to the budget day
const WORK_HOURS = [7, 19];
// steps and tool calls without an end count as "in progress" only this long after they started
const RUNNING_WINDOW_MS = 30 * 60_000;
const MARGIN_ROWS = 10_000; // rows per block of counterMarginsAsync()
// a run with nothing in flight stays "in progress" this long after its newest step ended
export const LIVE_IDLE_GAP_MS = 5 * 60_000;
/**
 * Candidates of liveRuns(), run on every dashboard tick (params: three times the
 * window start): primary roots of the sessions with a step, tool or permission in
 * the window, with what the per-tree queries need. The context is the root's newest
 * finished step, also from an earlier run (it carries over).
 * `active` must join its arms with UNION ALL: a UNION is planned as a merge of
 * inputs sorted by session, which scans steps and tools in full instead of
 * searching steps_ts / tools_ts (pinned by a test); `up`'s UNION de-duplicates.
 */
export const LIVE_CANDIDATES_SQL = `WITH RECURSIVE active(id) AS (
    SELECT session_id FROM steps WHERE ${TS} >= ?
    UNION ALL SELECT session_id FROM tools WHERE ${TOOL_TS} >= ?
    UNION ALL SELECT session_id FROM permissions WHERE ${PERMISSION_TS} >= ?),
  up(id, parent) AS (
    SELECT s.id, s.parent_id FROM sessions s JOIN active ON active.id = s.id
    UNION SELECT s.id, s.parent_id FROM sessions s JOIN up ON s.id = up.parent)
  SELECT x.*,
    (SELECT MIN(created) FROM prompts WHERE session_id = x.id AND (x.lastEnded IS NULL OR created > x.lastEnded)) firstPrompt,
    (SELECT COALESCE(t_in,0)+COALESCE(t_cread,0)+COALESCE(t_cwrite,0) FROM steps
      WHERE session_id = x.id AND ended IS NOT NULL AND t_in IS NOT NULL ORDER BY ended DESC, id DESC LIMIT 1) ctxUsed,
    (SELECT ${MODEL_KEY} FROM steps
      WHERE session_id = x.id AND ended IS NOT NULL AND t_in IS NOT NULL ORDER BY ended DESC, id DESC LIMIT 1) ctxModel
  FROM (SELECT s.id, s.title, s.directory, (SELECT MAX(ended) FROM runs WHERE session_id = s.id) lastEnded
    FROM sessions s WHERE s.id IN (SELECT id FROM up WHERE parent IS NULL) AND s.deleted IS NULL) x`;
// upper bounds of the tokens-per-prompt histogram bands: [0,10k) [10k,30k) ... [1M,3M) [3M,∞)
export const RUN_TOKEN_BUCKETS = [10_000, 30_000, 100_000, 300_000, 1_000_000, 3_000_000];
const RUN_OUTCOMES = ["succeeded", "failed", "interrupted"];

/** "exceeded" at the limit, "over" when the projection passes it, "none" without a limit. */
function pace(ratio, projectedRatio) {
  if (ratio == null) return "none";
  if (ratio >= 1) return "exceeded";
  if (projectedRatio != null && projectedRatio > 1) return "over";
  return "under";
}

/** Elapsed fraction of a period and the factor that projects its use to the end (null = too early). */
function projection(kind, from, to, now) {
  const span = to - from;
  const elapsed = Math.min(Math.max(0, now - from), span);
  // before 1 h of a day (also on 23/25 h days) or 1/24 of a week or month a linear projection is noise
  const threshold = kind === "day" ? 3_600_000 : span / 24;
  return { elapsed: elapsed / span, factor: elapsed > 0 && elapsed >= threshold ? span / elapsed : null };
}

/** Use against a limit, with the linear projection to the end of the period (factor null = too early). */
function measure(used, limit, factor) {
  const projected = factor ? used * factor : null;
  const ratio = limit ? used / limit : null;
  const projectedRatio = limit && projected != null ? projected / limit : null;
  return { used, limit, ratio, projected, projectedRatio, pace: pace(ratio, projectedRatio) };
}

function sorted(values) {
  return values.filter((v) => typeof v === "number" && v >= 0).sort((a, b) => a - b);
}
function dist(values) {
  const v = sorted(values);
  return { p50: quantile(v, 0.5), p95: quantile(v, 0.95), n: v.length };
}

/** p50, p95 and mean of the non-negative values (null when there are none). */
function stats(values) {
  const v = sorted(values);
  return { p50: quantile(v, 0.5), p95: quantile(v, 0.95), avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: v.length };
}

/** Index of the first element of the ascending `values` that is >= x (values.length when none). */
function firstAtOrAfter(values, x) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Keys of a Map key -> tokens, heaviest first. */
function byTokens(map) {
  return [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
}

/** A run with a problem («Solo con problemi» of the `runs` tables): failed, interrupted, or with a tool error. */
export const hasProblem = (r) => r.outcome === "failed" || r.outcome === "interrupted" || r.tools.errors > 0;

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// a tokens/s rate needs a long enough window and enough tokens, or it is noise
export const SPEED_MIN_WINDOW_MS = 500;
export const SPEED_MIN_TOKENS = 20;
// step columns stepSpeed() reads
const SPEED_COLS = "requested, first_output, streamed, ended, finish, t_out, t_reason";
// A retry caused by a rate limit: a 429 standing alone in its message (errorFields appends « (HTTP 429)»;
// not the digits of 14290) or a message or type saying so (LIKE ignores ASCII case)
const RETRY_MSG = "json_extract(detail, '$.error.error_msg')";
const RATE_LIMITED = `((' ' || ${RETRY_MSG} || ' ') GLOB '*[^0-9]429[^0-9]*' OR ${RETRY_MSG} LIKE '%rate limit%'
  OR ${RETRY_MSG} LIKE '%rate_limit%' OR json_extract(detail, '$.error.error_type') LIKE '%rate_limit%')`;
const RETRIES_SQL = `SELECT COUNT(*) retries, COALESCE(SUM(${RATE_LIMITED}), 0) rateLimited
  FROM signals WHERE type = 'session.retry.scheduled' AND created >= ? AND created < ?`;
const ST_SPEED_COLS = "st.requested, st.first_output, st.streamed, st.ended, st.finish, st.t_out, st.t_reason";
// stepSpeed() as SQL expressions over a steps row (same thresholds, same arithmetic)
const SQL_OUT_TOKENS = "(COALESCE(t_out, 0) + COALESCE(t_reason, 0))";
const SQL_TTFT_MS = "CASE WHEN first_output >= requested THEN first_output - requested END";
const SQL_TOKENS_PER_SEC = `CASE WHEN streamed - first_output >= ${SPEED_MIN_WINDOW_MS} AND ${SQL_OUT_TOKENS} >= ${SPEED_MIN_TOKENS} AND finish IS NOT 'error'
  THEN ${SQL_OUT_TOKENS} / ((streamed - first_output) / 1000.0) END`;
const INTERRUPT_REASONS = ["user", "superseded", "inactivity", "shutdown"];
const INTERNAL_KINDS = { title: "title", compaction: "compaction" }; // anything else is the estimate ("other")

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Speed of one step from its v4 times: time to first output (from the request),
 * output rate over the stream (first output to stream end) and the wait for
 * tools after the stream. Each value is null when its times are missing or
 * implausible; the rate also needs SPEED_MIN_WINDOW_MS, SPEED_MIN_TOKENS and a
 * step that did not fail.
 */
export function stepSpeed(r) {
  const out = (r.t_out ?? 0) + (r.t_reason ?? 0);
  const ttft = isNum(r.requested) && isNum(r.first_output) && r.first_output >= r.requested ? r.first_output - r.requested : null;
  const win = isNum(r.first_output) && isNum(r.streamed) ? r.streamed - r.first_output : null;
  const rate = win != null && win >= SPEED_MIN_WINDOW_MS && out >= SPEED_MIN_TOKENS && r.finish !== "error" ? out / (win / 1000) : null;
  const tail = isNum(r.streamed) && isNum(r.ended) && r.ended >= r.streamed ? r.ended - r.streamed : null;
  return { ttftMs: ttft, tokensPerSec: rate, toolTailMs: tail };
}

/** Percentiles of stepSpeed() over steps; n = steps with a rate. */
export function speedStats(rows) {
  const ttft = [];
  const rate = [];
  const tail = [];
  for (const r of rows) {
    const v = stepSpeed(r);
    if (v.ttftMs != null) ttft.push(v.ttftMs);
    if (v.tokensPerSec != null) rate.push(v.tokensPerSec);
    if (v.toolTailMs != null) tail.push(v.toolTailMs);
  }
  for (const a of [ttft, rate, tail]) a.sort((x, y) => x - y);
  return {
    ttftMs: { p50: quantile(ttft, 0.5), p95: quantile(ttft, 0.95) },
    tokensPerSec: { p50: quantile(rate, 0.5) },
    toolTailMs: { p50: quantile(tail, 0.5) },
    n: rate.length,
  };
}

export function tokensOf(r) {
  return {
    input: r.t_in ?? 0,
    output: r.t_out ?? 0,
    reasoning: r.t_reason ?? 0,
    cacheRead: r.t_cread ?? 0,
    cacheWrite: r.t_cwrite ?? 0,
    total: (r.t_in ?? 0) + (r.t_out ?? 0) + (r.t_reason ?? 0) + (r.t_cread ?? 0) + (r.t_cwrite ?? 0),
  };
}

const STEP_SERIES_CAP = 100;

/** A run's steps by start as { started, tokens, toolErrors }; beyond STEP_SERIES_CAP the rest is summed into the last entry. */
function stepSeries(series) {
  const out = [];
  for (const e of [...series].sort((a, b) => a.started - b.started || (a.id < b.id ? -1 : 1))) {
    const last = out[STEP_SERIES_CAP - 1];
    if (last) {
      last.tokens += e.tokens;
      last.toolErrors += e.toolErrors;
    } else out.push({ started: e.started, tokens: e.tokens, toolErrors: e.toolErrors });
  }
  return out;
}

function tokensRow() {
  return { cost: 0, t_in: 0, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 };
}

/** Share of the prompt served from cache: read / (fresh input + read + write). */
function cacheRate(r) {
  const prompt = (r.t_in ?? 0) + (r.t_cread ?? 0) + (r.t_cwrite ?? 0);
  return prompt ? (r.t_cread ?? 0) / prompt : null;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * Bucket labels in local time, matching the SQLite bucket expressions below. Hourly labels are
 * one per real hour, so the day of the fall-back DST change has 25 and the label of the repeated
 * hour appears twice: the dashboard reads labels by index, and `hourBuckets` keys the rows by UTC
 * hour, so the two hours stay apart. Day and week labels are deduplicated (a DST day is still one day).
 */
function bucketLabels(from, to, unit) {
  const out = [];
  const d = new Date(from);
  if (unit === "hour") d.setMinutes(0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  let guard = 0;
  while (d.getTime() < to && guard++ < 5000) {
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    out.push(unit === "hour" ? `${day} ${pad(d.getHours())}:00` : day);
    if (unit === "hour") d.setTime(d.getTime() + 3_600_000);
    else d.setDate(d.getDate() + (unit === "week" ? 7 : 1));
  }
  return unit === "hour" ? out : [...new Set(out)];
}

/** Day and week buckets: the local date, same as the labels. */
function bucketExpr(col, unit) {
  const t = `${col} / 1000, 'unixepoch', 'localtime'`;
  if (unit === "week") return `date(${t}, 'weekday 0', '-6 days')`;
  return `date(${t})`;
}

/**
 * Labels, SQL bucket expression and row → index mapping for a time series. Hourly buckets are
 * keyed by UTC hour number, not by the local label: the local label of the repeated hour of the
 * fall-back DST day is the same for two different hours, and grouping by it would merge them.
 */
function buckets(from, to, unit) {
  const labels = bucketLabels(from, to, unit);
  if (unit !== "hour") {
    const index = new Map(labels.map((l, i) => [l, i]));
    return { labels, expr: (col) => bucketExpr(col, unit), indexOf: (b) => index.get(b) };
  }
  const start = new Date(from);
  start.setMinutes(0, 0, 0);
  const first = Math.floor(start.getTime() / 3_600_000);
  return {
    labels,
    expr: (col) => `CAST(${col} / 3600000 AS INTEGER)`,
    indexOf: (b) => (b >= first && b < first + labels.length ? b - first : undefined),
  };
}

function bucketUnit(from, to) {
  const span = to - from;
  if (span <= 2 * 86_400_000) return "hour";
  if (span <= 120 * 86_400_000) return "day";
  return "week";
}

export class Queries {
  /**
   * @param {{ labels?: Record<string,string>, limits?: {tokens:number|null,cost:number|null,steps:number|null}, weeklyLimits?: object, monthlyLimits?: object,
   *   modelLimits?: {model:string,provider:string,name:string,limit:number}[], reset?: {hour:number,utc:boolean},
   *   opencodeModels?: { current(): { available: boolean, models: {model:string}[] } } | null }} [options]
   */
  constructor(store, { labels = {}, limits = NO_LIMITS, weeklyLimits = NO_LIMITS, monthlyLimits = NO_LIMITS, modelLimits = [], reset = MIDNIGHT, opencodeModels = null, catalog = null, metricsMaxAgeMs = 0, dashboardMaxAgeMs = 0, contextLimits = {} } = {}) {
    this.db = store.db;
    this.labels = labels;
    this.limits = limits;
    this.weeklyLimits = weeklyLimits;
    this.monthlyLimits = monthlyLimits;
    this.modelLimits = modelLimits;
    this.reset = reset;
    // OpenCode's configured models ({ current() }): null = no config to filter by, every budget counts
    this.opencodeModels = opencodeModels;
    this.catalog = catalog;
    // how long families() may reuse its all-time aggregates while the collector writes (0: only while nothing was written)
    this.metricsMaxAgeMs = metricsMaxAgeMs;
    // the same for the dashboard's whole-table reads: color slots and a period's runs
    this.dashboardMaxAgeMs = dashboardMaxAgeMs;
    // context windows of models neither OpenCode's config nor its catalog knows, by model key (a module's source, src/source-views.js)
    this.contextLimits = contextLimits;
  }

  /** The budget day (follows LENS_RESET_HOUR) containing `now`. */
  dayRange(now = Date.now()) {
    return periodBounds("day", now, this.reset);
  }

  range(from, to) {
    const now = Date.now();
    const t = Number.isFinite(to) && to > 0 ? to : now + 60_000;
    let f = Number.isFinite(from) && from >= 0 ? from : now - 7 * 86_400_000;
    if (f === 0) {
      // "all time": start just before the earliest thing we know about
      const first = this.db
        .prepare(
          `SELECT MIN(m) m FROM (
            SELECT MIN(${STEP_START}) m FROM steps
            UNION ALL SELECT MIN(COALESCE(created, ran, ended)) FROM tools
            UNION ALL SELECT MIN(created) FROM internal_usage
            UNION ALL SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'retention_from')`,
        )
        .get().m;
      f = first != null ? first - 60_000 : now - 86_400_000;
    }
    return { from: f, to: t };
  }

  summary(from, to, now = Date.now()) {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) steps,
          COALESCE(SUM(finish = 'error'), 0) failed,
          COALESCE(SUM(ended IS NULL AND COALESCE(last_started, started) >= ?), 0) running,
          COALESCE(SUM(cost), 0) cost,
          COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out, COALESCE(SUM(t_reason), 0) t_reason,
          COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite,
          COUNT(DISTINCT session_id) sessions,
          COUNT(DISTINCT ${MODEL_KEY}) models
        FROM steps WHERE ${TS} >= ? AND ${TS} < ?`,
      )
      .get(now - RUNNING_WINDOW_MS, from, to);
    // the days the retention pruned (daily_steps, daily_tools) still count in the totals: those whose midnight
    // falls in [from, to), so adjacent periods never count one twice. The period that holds the earliest start
    // pruned (meta retention_from), as «Tutto» does, may start after the midnight of the first pruned day: from
    // its local day then; of adjacent periods only one holds it. Running steps, latency and speed come from
    // the steps kept only
    const prunedFrom = Number(this.db.prepare(`SELECT value FROM meta WHERE key = 'retention_from'`).get()?.value);
    const fromDay = Number.isFinite(prunedFrom) && from <= prunedFrom && prunedFrom < to ? new Date(from).setHours(0, 0, 0, 0) : from;
    const pruned = this.db
      .prepare(
        `SELECT COALESCE(SUM(steps), 0) steps, COALESCE(SUM(failed), 0) failed, COALESCE(SUM(cost), 0) cost,
          COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out, COALESCE(SUM(t_reason), 0) t_reason,
          COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite
        FROM daily_steps WHERE day >= ? AND day < ?`,
      )
      .get(fromDay, to);
    const prunedTools = this.db.prepare(`SELECT COALESCE(SUM(calls), 0) calls, COALESCE(SUM(errors), 0) errors FROM daily_tools WHERE day >= ? AND day < ?`).get(fromDay, to);
    if (pruned.steps > 0) {
      for (const c of ["steps", "failed", "cost", "t_in", "t_out", "t_reason", "t_cread", "t_cwrite"]) r[c] += pruned[c];
      const distinct = this.db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) sessions, COUNT(DISTINCT k) models FROM (
            SELECT session_id, ${MODEL_KEY} k FROM steps WHERE ${TS} >= ? AND ${TS} < ?
            UNION ALL SELECT session_id, ${MODEL_KEY} k FROM daily_steps WHERE day >= ? AND day < ?)`,
        )
        .get(from, to, fromDay, to);
      r.sessions = distinct.sessions;
      r.models = distinct.models;
    }
    const internal = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost), 0) cost, COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out,
          COALESCE(SUM(t_reason), 0) t_reason, COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite
        FROM internal_usage WHERE created >= ? AND created < ?`,
      )
      .get(from, to);
    const byKind = { title: tokensRow(), compaction: tokensRow(), other: tokensRow() };
    for (const k of this.db
      .prepare(
        `SELECT kind, COALESCE(SUM(cost), 0) cost, COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out,
          COALESCE(SUM(t_reason), 0) t_reason, COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite
        FROM internal_usage WHERE created >= ? AND created < ? GROUP BY kind`,
      )
      .all(from, to)) {
      const b = byKind[INTERNAL_KINDS[k.kind] ?? "other"];
      for (const c of Object.keys(b)) b[c] += k[c];
    }
    const byModel = this.db
      .prepare(
        `SELECT ${MODEL_KEY} k, COALESCE(SUM(cost), 0) cost, COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out,
          COALESCE(SUM(t_reason), 0) t_reason, COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite
        FROM internal_usage WHERE model IS NOT NULL AND created >= ? AND created < ? GROUP BY k`,
      )
      .all(from, to)
      .map((m) => ({ key: m.k, cost: m.cost, tokens: tokensOf(m) }))
      .sort((a, b) => b.tokens.total - a.tokens.total || (a.key < b.key ? -1 : 1));
    const tools = this.db
      .prepare(
        `SELECT COUNT(*) calls, COALESCE(SUM(status = 'error'), 0) errors
        FROM tools WHERE ${TOOL_TS} >= ? AND ${TOOL_TS} < ?`,
      )
      .get(from, to);
    const signals = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(type = 'session.retry.scheduled'), 0) retries,
          COALESCE(SUM(type = 'session.execution.failed'), 0) execFailed,
          COALESCE(SUM(type = 'session.compaction.ended'), 0) compactions,
          COALESCE(SUM(type = 'session.compaction.ended' AND json_extract(detail, '$.reason') = 'auto'), 0) cAuto,
          COALESCE(SUM(type = 'session.compaction.ended' AND json_extract(detail, '$.reason') = 'manual'), 0) cManual
        FROM signals WHERE created >= ? AND created < ?`,
      )
      .get(from, to);
    const { rateLimited } = this.db.prepare(RETRIES_SQL).get(from, to);
    const speed = speedStats(this.db.prepare(`SELECT ${SPEED_COLS} FROM steps WHERE requested IS NOT NULL AND ${TS} >= ? AND ${TS} < ?`).all(from, to));
    const durations = this.db
      .prepare(
        `SELECT ended - last_started d FROM steps
        WHERE ended IS NOT NULL AND last_started IS NOT NULL AND finish IS NOT 'error'
          AND ${TS} >= ? AND ${TS} < ? ORDER BY d`,
      )
      .all(from, to)
      .map((x) => x.d)
      .filter((d) => d >= 0);
    return {
      from,
      to,
      steps: r.steps,
      failedSteps: r.failed,
      runningSteps: r.running,
      sessions: r.sessions,
      models: r.models,
      cost: r.cost + internal.cost,
      stepCost: r.cost,
      tokens: tokensOf(r),
      cacheRate: cacheRate(r),
      internal: {
        cost: internal.cost,
        tokens: tokensOf(internal),
        byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { cost: v.cost, tokens: tokensOf(v) }])),
        byModel,
      },
      latencyMs: { p50: quantile(durations, 0.5), p95: quantile(durations, 0.95), n: durations.length },
      speed,
      tools: { calls: tools.calls + prunedTools.calls, errors: tools.errors + prunedTools.errors },
      retries: signals.retries,
      rateLimited,
      failedRuns: signals.execFailed,
      compactions: signals.compactions,
      compactionsByReason: { auto: signals.cAuto, manual: signals.cManual, unknown: signals.compactions - signals.cAuto - signals.cManual },
    };
  }

  /** Changes when anything was written: total_changes() counts this connection's writes, data_version another process's. */
  #stamp() {
    return `${this.db.prepare("SELECT total_changes() n").get().n}|${this.db.prepare("PRAGMA data_version").get().data_version}`;
  }

  #memos = new Map();

  /**
   * A Map for the results of whole-table reads, kept while nothing was written (#stamp()) and, with
   * a max age, for that long while the collector writes: they are then paid once every few seconds.
   */
  #memo(name, maxAgeMs) {
    const stamp = this.#stamp();
    const at = Date.now();
    const m = this.#memos.get(name);
    if (m && (m.stamp === stamp || at - m.at < maxAgeMs)) return m.rows;
    const fresh = { stamp, at, rows: new Map() };
    this.#memos.set(name, fresh);
    return fresh.rows;
  }

  /**
   * Stable color slots: the top N keys of a dimension by ALL-TIME tokens, so a
   * model keeps its color whatever period is selected (color follows the entity).
   */
  slots(by = "model", top = 6) {
    const dim = dimOf(by);
    // a scan of every step, asked for by each refresh and each chart: reused like the metrics
    const memo = this.#memo("slots", this.dashboardMaxAgeMs);
    const key = `${dim}\u0000${top}`;
    if (!memo.has(key)) {
      const keys = this.db
        .prepare(
          `SELECT ${dim} k FROM steps GROUP BY k
          ORDER BY SUM(COALESCE(t_in,0)+COALESCE(t_out,0)+COALESCE(t_reason,0)+COALESCE(t_cread,0)+COALESCE(t_cwrite,0)) DESC, COUNT(*) DESC, k
          LIMIT ?`,
        )
        .all(top)
        .map((r) => r.k);
      memo.set(key, keys);
    }
    return [...memo.get(key)];
  }

  timeseries(from, to, { metric = "tokens", by = "model", top = 6, model = null } = {}) {
    const unit = bucketUnit(from, to);
    const dim = dimOf(by);
    const value =
      metric === "cost" ? "COALESCE(cost, 0)" : metric === "steps" ? "1" : "COALESCE(t_in,0)+COALESCE(t_out,0)+COALESCE(t_reason,0)+COALESCE(t_cread,0)+COALESCE(t_cwrite,0)";
    const { labels, expr, indexOf } = buckets(from, to, unit);
    if (model) return this.modelTimeseries(from, to, unit, metric, value, model, { labels, expr, indexOf });
    const rows = this.db
      .prepare(
        `SELECT ${expr(TS)} b, ${dim} k, SUM(${value}) v
        FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY b, k`,
      )
      .all(from, to);
    if (metric !== "steps") {
      const iv = metric === "cost" ? "cost" : "t_in+t_out+t_reason+t_cread+t_cwrite";
      const irows = this.db
        .prepare(
          `SELECT ${expr("created")} b, 'task interni' k, SUM(${iv}) v
          FROM internal_usage WHERE created >= ? AND created < ? GROUP BY b`,
        )
        .all(from, to);
      rows.push(...irows.filter((r) => r.v > 0));
    }
    const slots = this.slots(by, top);
    const present = new Set(rows.map((r) => r.k));
    const order = slots.filter((k) => present.has(k));
    const keep = new Set(order);
    if ([...present].some((k) => k !== "task interni" && !keep.has(k))) order.push("altri");
    if (present.has("task interni")) order.push("task interni");
    const series = new Map();
    for (const k of order) series.set(k, new Array(labels.length).fill(0));
    for (const r of rows) {
      const i = indexOf(r.b);
      if (i === undefined) continue;
      const k = r.k === "task interni" ? r.k : keep.has(r.k) ? r.k : "altri";
      series.get(k)[i] += r.v;
    }
    return {
      unit,
      metric,
      by,
      labels,
      slots,
      series: order.map((k) => ({
        key: k,
        slot: k === "altri" ? "other" : k === "task interni" ? 7 : slots.indexOf(k) + 1,
        values: series.get(k),
        total: series.get(k).reduce((a, b) => a + b, 0),
      })),
    };
  }

  /**
   * One "provider/model" (all variants together, like the daily budgets) as a single series,
   * also when it is not among the top models: a widget follows a model of the user's choice.
   */
  modelTimeseries(from, to, unit, metric, value, model, { labels, expr, indexOf } = buckets(from, to, unit)) {
    const values = new Array(labels.length).fill(0);
    for (const r of this.db
      .prepare(
        `SELECT ${expr(TS)} b, SUM(${value}) v FROM steps
        WHERE ${TS} >= ? AND ${TS} < ? AND COALESCE(provider, '?') || '/' || COALESCE(model, '?') = ? GROUP BY b`,
      )
      .all(from, to, model)) {
      const i = indexOf(r.b);
      if (i !== undefined) values[i] += r.v;
    }
    return {
      unit,
      metric,
      by: "model",
      labels,
      slots: [model],
      series: [{ key: model, slot: 1, values, total: values.reduce((a, b) => a + b, 0) }],
    };
  }

  breakdown(from, to, by = "model") {
    const dim = dimOf(by);
    // the ORDER BY repeats the SUMs: inside an expression SQLite resolves t_in & co. to the
    // table's columns (one arbitrary row of the group), not to the SELECT aliases
    const rows = this.db
      .prepare(
        `SELECT ${dim} k, COUNT(*) steps, COALESCE(SUM(finish = 'error'), 0) failed,
          COALESCE(SUM(cost), 0) cost,
          COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_out), 0) t_out, COALESCE(SUM(t_reason), 0) t_reason,
          COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite,
          COUNT(DISTINCT session_id) sessions, MAX(${TS}) last
        FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY k
        ORDER BY COALESCE(SUM(t_in), 0) + COALESCE(SUM(t_out), 0) + COALESCE(SUM(t_reason), 0) + COALESCE(SUM(t_cread), 0) + COALESCE(SUM(t_cwrite), 0) DESC`,
      )
      .all(from, to);
    const perf = new Map();
    for (const p of this.db
      .prepare(
        `SELECT ${dim} k, ended - last_started d, COALESCE(t_out, 0) + COALESCE(t_reason, 0) o FROM steps
        WHERE ended IS NOT NULL AND last_started IS NOT NULL AND finish IS NOT 'error' AND ${TS} >= ? AND ${TS} < ?`,
      )
      .all(from, to)) {
      // outputTokensPerSec: the old rate, over the whole step (waiting and tools included)
      if (p.d < 0) continue;
      const e = perf.get(p.k) ?? { d: [], tps: [] };
      e.d.push(p.d);
      if (p.d > 0 && p.o > 0) e.tps.push(p.o / (p.d / 1000));
      perf.set(p.k, e);
    }
    const speeds = new Map();
    for (const p of this.db.prepare(`SELECT ${dim} k, ${SPEED_COLS} FROM steps WHERE requested IS NOT NULL AND ${TS} >= ? AND ${TS} < ?`).all(from, to)) {
      const list = speeds.get(p.k) ?? speeds.set(p.k, []).get(p.k);
      list.push(p);
    }
    return rows.map((r) => {
      const e = perf.get(r.k) ?? { d: [], tps: [] };
      e.d.sort((a, b) => a - b);
      e.tps.sort((a, b) => a - b);
      return {
        key: r.k,
        steps: r.steps,
        failed: r.failed,
        sessions: r.sessions,
        cost: r.cost,
        tokens: tokensOf(r),
        cacheRate: cacheRate(r),
        latencyMs: { p50: quantile(e.d, 0.5), p95: quantile(e.d, 0.95) },
        outputTokensPerSec: quantile(e.tps, 0.5),
        speed: speedStats(speeds.get(r.k) ?? []),
        last: r.last,
      };
    });
  }

  tools(from, to, now = Date.now()) {
    const rows = this.db
      .prepare(
        `SELECT COALESCE(name, '?') name, COUNT(*) calls, COALESCE(SUM(status = 'error'), 0) errors,
          COALESCE(SUM((status IS NULL OR status NOT IN ('completed', 'error')) AND COALESCE(ran, created) >= ?), 0) open,
          AVG(out_bytes) avgOut, COALESCE(SUM(provider_exec = 1), 0) providerExecuted,
          COALESCE(SUM(is_commit = 1 AND status = 'completed'), 0) commits
        FROM tools WHERE ${TOOL_TS} >= ? AND ${TOOL_TS} < ?
        GROUP BY name ORDER BY calls DESC`,
      )
      .all(now - RUNNING_WINDOW_MS, from, to);
    // Execution time. Since OpenCode added `time.ran` (Oct 2026), `created` is
    // when the model starts writing the arguments, so `ran` is the start. Older
    // parts have no `ran` and their `created` is already the execution start.
    const dur = new Map();
    for (const d of this.db
      .prepare(
        `SELECT COALESCE(name, '?') name, ended - COALESCE(ran, created) d FROM tools
        WHERE ended IS NOT NULL AND COALESCE(ran, created) IS NOT NULL
          AND ${TOOL_TS} >= ? AND ${TOOL_TS} < ?`,
      )
      .all(from, to)) {
      if (d.d < 0) continue;
      (dur.get(d.name) ?? dur.set(d.name, []).get(d.name)).push(d.d);
    }
    const errs = this.db.prepare(
      `SELECT error_msg msg, COUNT(*) n FROM tools
      WHERE status = 'error' AND error_msg IS NOT NULL AND COALESCE(name, '?') = ? AND ${TOOL_TS} >= ? AND ${TOOL_TS} < ?
      GROUP BY substr(error_msg, 1, 160) ORDER BY n DESC LIMIT 3`,
    );
    return rows.map((r) => {
      const d = (dur.get(r.name) ?? []).sort((a, b) => a - b);
      return {
        name: r.name,
        calls: r.calls,
        errors: r.errors,
        open: r.open,
        errorRate: r.calls ? r.errors / r.calls : 0,
        avgOutputBytes: r.avgOut,
        providerExecuted: r.providerExecuted,
        commits: r.commits,
        durationMs: { p50: quantile(d, 0.5), p95: quantile(d, 0.95), n: d.length },
        topErrors: r.errors ? errs.all(r.name, from, to).map((e) => ({ message: e.msg, count: e.n })) : [],
      };
    });
  }

  /** Sessions with steps in the period, for paging /api/sessions. */
  sessionCount(from, to) {
    return this.db
      .prepare(`SELECT COUNT(*) n FROM (SELECT session_id FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY session_id) a JOIN sessions s ON s.id = a.session_id`)
      .get(from, to).n;
  }

  sessions(from, to, limit = 50, offset = 0, after = null) {
    // after { last, id }: the page after that session in the order (keyset), instead of an offset
    const page = after
      ? ["WHERE (a.last < ? OR (a.last = ? AND s.id > ?)) ORDER BY a.last DESC, s.id LIMIT ?", [after.last, after.last, after.id, limit]]
      : ["ORDER BY a.last DESC, s.id LIMIT ? OFFSET ?", [limit, offset]];
    const rows = this.db
      .prepare(
        `SELECT s.id, s.title, s.directory, s.parent_id parentID, s.deleted,
          s.cost totalCost, (s.t_in + s.t_out + s.t_reason + s.t_cread + s.t_cwrite) totalTokens,
          a.steps, a.failed, a.cost, a.tokens, a.models, a.last,
          (SELECT COALESCE(SUM(cost), 0) FROM internal_usage i WHERE i.session_id = s.id AND i.created >= ? AND i.created < ?) internalCost,
          (SELECT COALESCE(SUM(t_in + t_out + t_reason + t_cread + t_cwrite), 0) FROM internal_usage i WHERE i.session_id = s.id AND i.created >= ? AND i.created < ?) internalTokens
        FROM (
          SELECT session_id, COUNT(*) steps, COALESCE(SUM(finish = 'error'), 0) failed, COALESCE(SUM(cost), 0) cost,
            COALESCE(SUM(COALESCE(t_in,0) + COALESCE(t_out,0) + COALESCE(t_reason,0) + COALESCE(t_cread,0) + COALESCE(t_cwrite,0)), 0) tokens,
            GROUP_CONCAT(DISTINCT ${MODEL_KEY}) models, MAX(${TS}) last
          FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY session_id
        ) a JOIN sessions s ON s.id = a.session_id
        ${page[0]}`,
      )
      .all(from, to, from, to, from, to, ...page[1])
      .map((r) => ({ ...r, models: r.models ? r.models.split(",") : [] }));
    // the same period including subagent sessions, for sessions that have them
    const roll = new Map(
      this.db
        .prepare(
          `WITH RECURSIVE ${TREE}
          SELECT tree.root root, COUNT(DISTINCT CASE WHEN tree.id <> tree.root THEN tree.id END) children,
            COALESCE(SUM(st.cost), 0) cost, COALESCE(SUM(${ST_TOKENS}), 0) tokens
          FROM tree JOIN steps st ON st.session_id = tree.id
          WHERE ${ST_TS} >= ? AND ${ST_TS} < ? GROUP BY tree.root`,
        )
        .all(JSON.stringify(rows.map((r) => r.id)), from, to)
        .map((r) => [r.root, r]),
    );
    return rows.map((r) => {
      const t = roll.get(r.id);
      return t?.children ? { ...r, subagents: { sessions: t.children, cost: t.cost, tokens: t.tokens } } : { ...r, subagents: null };
    });
  }

  session(id, now = Date.now()) {
    const s = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
    if (!s) return null;
    const steps = this.db
      .prepare(
        `SELECT id, agent, ${MODEL_KEY} model, started, last_started lastStarted, ended, attempts, finish,
          error_type errorType, error_msg errorMessage, cost, t_in, t_out, t_reason, t_cread, t_cwrite,
          requested, first_output, streamed,
          (SELECT COUNT(*) FROM tools t WHERE t.message_id = steps.id) tools,
          (SELECT GROUP_CONCAT(name) FROM tools t WHERE t.message_id = steps.id) toolNames
        FROM steps WHERE session_id = ? ORDER BY COALESCE(started, ${TS})`,
      )
      .all(id)
      .map((r) => ({
        id: r.id,
        agent: r.agent,
        model: r.model,
        started: r.started,
        ended: r.ended,
        durationMs: r.ended && r.lastStarted ? r.ended - r.lastStarted : null,
        // same window as /metrics: an interrupted step never gets an end
        running: r.ended == null && (r.lastStarted ?? r.started ?? 0) >= now - RUNNING_WINDOW_MS,
        attempts: r.attempts,
        finish: r.finish,
        error: r.errorMessage,
        cost: r.cost,
        tokens: tokensOf(r),
        tools: r.toolNames ? r.toolNames.split(",") : [],
        requested: r.requested,
        firstOutput: r.first_output,
        streamed: r.streamed,
        ...stepSpeed(r),
      }));
    const internal = this.db
      .prepare(
        `SELECT id, created, cost, t_in, t_out, t_reason, t_cread, t_cwrite, kind, reason,
          CASE WHEN model IS NULL THEN NULL ELSE ${MODEL_KEY} END model
        FROM internal_usage WHERE session_id = ? ORDER BY created, id`,
      )
      .all(id)
      .map((r) => ({ id: r.id, created: r.created, kind: r.kind, model: r.model, reason: r.reason, cost: r.cost, tokens: tokensOf(r) }));
    const calls = new Map();
    for (const t of this.db
      .prepare(
        `SELECT message_id, name, status, created, ran, ended, out_bytes, child_session, provider_exec, is_commit, error_msg
        FROM tools WHERE session_id = ? ORDER BY COALESCE(created, ran, ended)`,
      )
      .all(id)) {
      const list = calls.get(t.message_id) ?? calls.set(t.message_id, []).get(t.message_id);
      list.push({
        name: t.name,
        status: t.status,
        created: t.created,
        ran: t.ran,
        ended: t.ended,
        outBytes: t.out_bytes,
        childSession: t.child_session,
        providerExecuted: t.provider_exec === 1,
        commit: t.is_commit === 1 && t.status === "completed",
        error: t.error_msg,
      });
    }
    for (const st of steps) st.calls = calls.get(st.id) ?? [];
    const runs = this.db
      .prepare(`SELECT started, ended, outcome, reason FROM runs WHERE session_id = ? ORDER BY ended`)
      .all(id)
      .map((r) => ({ ...r, durationMs: r.started != null ? r.ended - r.started : null }));
    const children = this.db
      .prepare(
        `SELECT s.id, s.title, s.cost, s.created, (SELECT agent FROM steps WHERE session_id = s.id LIMIT 1) agent,
          s.t_in, s.t_out, s.t_reason, s.t_cread, s.t_cwrite
        FROM sessions s WHERE s.parent_id = ? ORDER BY s.created`,
      )
      .all(id)
      .map((c) => ({ id: c.id, title: c.title, agent: c.agent, created: c.created, cost: c.cost, tokens: tokensOf(c) }));
    return {
      id: s.id,
      title: s.title,
      directory: s.directory,
      parentID: s.parent_id,
      created: s.created,
      lastActivity: s.last_activity,
      deleted: s.deleted,
      cost: s.cost,
      tokens: tokensOf(s),
      steps,
      internal,
      runs,
      children,
    };
  }

  /**
   * Runs, prompts, permissions, commits and subagents in the period. Runs and
   * prompts are the user's: those of subagent sessions (the dispatch prompt
   * the parent writes, the subagent's own runs) are left out, while their
   * steps count in the cost and tokens of the parent run.
   */
  activity(from, to) {
    const runs = this.db
      .prepare(
        `WITH RECURSIVE ${TREE}
        SELECT r.started, r.ended, r.outcome,
          (SELECT COUNT(*) FROM tree JOIN steps st ON st.session_id = tree.id
            WHERE tree.root = r.session_id AND ${ST_TS} >= r.started AND ${ST_TS} <= r.ended) steps,
          (SELECT COALESCE(SUM(st.cost), 0) FROM tree JOIN steps st ON st.session_id = tree.id
            WHERE tree.root = r.session_id AND ${ST_TS} >= r.started AND ${ST_TS} <= r.ended) cost,
          (SELECT COALESCE(SUM(${ST_TOKENS}), 0) FROM tree JOIN steps st ON st.session_id = tree.id
            WHERE tree.root = r.session_id AND ${ST_TS} >= r.started AND ${ST_TS} <= r.ended) tokens
        FROM runs r JOIN sessions s ON s.id = r.session_id
        WHERE s.parent_id IS NULL AND r.ended >= ? AND r.ended < ?`,
      )
      .all(
        JSON.stringify(this.db.prepare(`SELECT DISTINCT session_id id FROM runs WHERE ended >= ? AND ended < ?`).all(from, to).map((r) => r.id)),
        from,
        to,
      );
    const outcomes = {};
    for (const r of runs) outcomes[r.outcome ?? "unknown"] = (outcomes[r.outcome ?? "unknown"] ?? 0) + 1;
    const timed = runs.filter((r) => r.started != null);

    const p = this.db
      .prepare(
        `SELECT COUNT(*) n, COALESCE(AVG(chars), 0) avgChars, COALESCE(SUM(files > 0), 0) withFiles,
          COALESCE(SUM(delivery = 'steer'), 0) steer
        FROM prompts p JOIN sessions s ON s.id = p.session_id
        WHERE s.parent_id IS NULL AND p.created >= ? AND p.created < ?`,
      )
      .get(from, to);

    const perms = this.db
      .prepare(`SELECT action, asked, replied, reply FROM permissions WHERE ${PERMISSION_TS} >= ? AND ${PERMISSION_TS} < ?`)
      .all(from, to);
    const byAction = new Map();
    for (const x of perms) {
      const a = byAction.get(x.action ?? "?") ?? { action: x.action ?? "?", asked: 0, rejected: 0, always: 0, pending: 0, waits: [] };
      a.asked++;
      if (x.reply === "reject") a.rejected++;
      if (x.reply === "always") a.always++;
      if (!x.replied) a.pending++;
      if (x.asked && x.replied) a.waits.push(x.replied - x.asked);
      byAction.set(a.action, a);
    }
    const waits = perms.filter((x) => x.asked && x.replied).map((x) => x.replied - x.asked);

    const commits = this.db
      .prepare(`SELECT COUNT(*) n FROM tools WHERE is_commit = 1 AND status = 'completed' AND ${TOOL_TS} >= ? AND ${TOOL_TS} < ?`)
      .get(from, to).n;
    const cost =
      this.db.prepare(`SELECT COALESCE(SUM(cost), 0) c FROM steps WHERE ${TS} >= ? AND ${TS} < ?`).get(from, to).c +
      this.db.prepare(`SELECT COALESCE(SUM(cost), 0) c FROM internal_usage WHERE created >= ? AND created < ?`).get(from, to).c;
    const tokens =
      this.db.prepare(`SELECT COALESCE(SUM(COALESCE(t_in,0)+COALESCE(t_out,0)+COALESCE(t_reason,0)+COALESCE(t_cread,0)+COALESCE(t_cwrite,0)), 0) t FROM steps WHERE ${TS} >= ? AND ${TS} < ?`).get(from, to).t;

    const sub = this.db
      .prepare(
        `SELECT COUNT(DISTINCT st.session_id) sessions, COALESCE(SUM(st.cost), 0) cost, COALESCE(SUM(${ST_TOKENS}), 0) tokens
        FROM steps st JOIN sessions s ON s.id = st.session_id
        WHERE s.parent_id IS NOT NULL AND ${ST_TS} >= ? AND ${ST_TS} < ?`,
      )
      .get(from, to);

    return {
      runs: {
        count: runs.length,
        outcomes,
        durationMs: dist(timed.map((r) => r.ended - r.started)),
        // steps, cost and tokens only for runs with a known start: the others cannot be attributed
        steps: dist(timed.map((r) => r.steps)),
        cost: dist(timed.map((r) => r.cost)),
        tokens: dist(timed.map((r) => r.tokens)),
      },
      prompts: { count: p.n, avgChars: p.avgChars, withFiles: p.withFiles, steer: p.steer },
      permissions: {
        asked: perms.length,
        rejected: perms.filter((x) => x.reply === "reject").length,
        always: perms.filter((x) => x.reply === "always").length,
        pending: perms.filter((x) => !x.replied).length,
        waitMs: dist(waits),
        byAction: [...byAction.values()]
          .map(({ waits: w, ...a }) => ({ ...a, waitMs: dist(w) }))
          .sort((a, b) => b.asked - a.asked),
      },
      commits: { count: commits, costPerCommit: commits ? cost / commits : null, tokensPerCommit: commits ? tokens / commits : null },
      subagents: { sessions: sub.sessions, cost: sub.cost, tokens: sub.tokens, costShare: cost ? sub.cost / cost : null },
    };
  }

  /**
   * Runs ("prompts") of primary sessions closed in [from, to), newest first, each
   * with what happened on its session tree in (previous run's end in the same
   * session, its end]: a superset of [started, ended] that also covers runs
   * stored without a start. `page` ({ limit, offset }, or { limit, after: { ended, id } } for the runs after
   * that one in the order) pages the runs in SQL.
   */
  #runRows(from, to, page = null, withSteps = false) {
    const order = page?.after
      ? [" AND (ended < ? OR (ended = ? AND id < ?))\n        ORDER BY ended DESC, id DESC LIMIT ?", [page.after.ended, page.after.ended, page.after.id, page.limit]]
      : [`\n        ORDER BY ended DESC, id DESC${page ? " LIMIT ? OFFSET ?" : ""}`, page ? [page.limit, page.offset] : []];
    const base = this.db
      .prepare(
        `SELECT * FROM (
          SELECT r.id, r.session_id, r.started, r.ended, r.outcome, r.reason, s.title, s.directory,
            LAG(r.ended) OVER (PARTITION BY r.session_id ORDER BY r.ended, r.id) prev
          FROM runs r JOIN sessions s ON s.id = r.session_id
          WHERE s.parent_id IS NULL AND r.session_id IN (SELECT session_id FROM runs WHERE ended >= ? AND ended < ?)
        ) WHERE ended >= ? AND ended < ?${order[0]}`,
      )
      .all(from, to, from, to, ...order[1]);
    if (!base.length) return [];

    const runs = base.map((r) => ({
      r,
      prompts: 0,
      steps: 0,
      failed: 0,
      cost: 0,
      t: { t_in: 0, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 },
      models: new Map(),
      agents: new Map(),
      subs: new Set(),
      subTokens: 0,
      subCost: 0,
      tools: { calls: 0, errors: 0, execMs: 0 },
      speed: [],
      series: [],
    }));
    // per session, its runs by ascending end: a timestamp belongs to the first run ending at or after it,
    // if it is past that run's window start (gaps between selected runs belong to runs not on this page)
    const bySession = new Map();
    for (const run of [...runs].reverse()) {
      const list = bySession.get(run.r.session_id) ?? { ends: [], runs: [] };
      list.ends.push(run.r.ended);
      list.runs.push(run);
      bySession.set(run.r.session_id, list);
    }
    const runAt = (session, ts) => {
      const list = bySession.get(session);
      if (!list || ts == null) return null;
      const run = list.runs[firstAtOrAfter(list.ends, ts)];
      return run && (run.r.prev == null || ts > run.r.prev) ? run : null;
    };
    const roots = JSON.stringify([...bySession.keys()]);
    // not Math.min(...rows): "all time" can mean more runs than a call takes arguments
    const lo = base.reduce((m, r) => Math.min(m, r.prev ?? Number.MIN_SAFE_INTEGER), Number.POSITIVE_INFINITY);
    const hi = base.reduce((m, r) => Math.max(m, r.ended), Number.NEGATIVE_INFINITY);

    const steps = this.db
      .prepare(
        `WITH RECURSIVE ${TREE}
        SELECT tree.root, st.id step_id, st.started step_started, st.session_id, st.agent, ${MODEL_KEY} mk, st.cost,
          st.t_in, st.t_cread, st.t_cwrite, ${ST_SPEED_COLS}, ${ST_TS} ts
        FROM tree JOIN steps st ON st.session_id = tree.id
        WHERE ${ST_TS} > ? AND ${ST_TS} <= ?`,
      )
      .all(roots, lo, hi);
    for (const s of steps) {
      const run = runAt(s.root, s.ts);
      if (!run) continue;
      const tok = tokensOf(s).total;
      run.steps++;
      if (s.finish === "error") run.failed++;
      run.cost += s.cost ?? 0;
      for (const k of Object.keys(run.t)) run.t[k] += s[k] ?? 0;
      run.models.set(s.mk, (run.models.get(s.mk) ?? 0) + tok);
      if (s.agent) run.agents.set(s.agent, (run.agents.get(s.agent) ?? 0) + tok);
      if (s.requested != null) run.speed.push(s);
      if (withSteps) run.series.push({ id: s.step_id, started: s.step_started ?? s.ts, tokens: tok, toolErrors: 0 });
      if (s.session_id !== s.root) {
        run.subs.add(s.session_id);
        run.subTokens += tok;
        run.subCost += s.cost ?? 0;
      }
    }

    // tool calls of the attributed steps (tools.message_id = step id), placed by their step's timestamp
    const tools = this.db
      .prepare(
        `WITH RECURSIVE ${TREE}
        SELECT tree.root, st.id step_id, ${ST_TS} ts, t.status, t.created, t.ran, t.ended
        FROM tree JOIN steps st ON st.session_id = tree.id JOIN tools t ON t.message_id = st.id
        WHERE ${ST_TS} > ? AND ${ST_TS} <= ?`,
      )
      .all(roots, lo, hi);
    for (const t of tools) {
      const run = runAt(t.root, t.ts);
      if (!run) continue;
      run.tools.calls++;
      if (t.status === "error") {
        run.tools.errors++;
        if (withSteps) run.series.find((e) => e.id === t.step_id).toolErrors++;
      }
      const start = t.ran ?? t.created;
      if (t.ended != null && start != null && t.ended >= start) run.tools.execMs += t.ended - start;
    }

    // the user's prompts: those of the primary session only (a subagent's prompt is written by its parent)
    const prompts = this.db
      .prepare(`SELECT session_id, created FROM prompts WHERE session_id IN (SELECT value FROM json_each(?)) AND created > ? AND created <= ?`)
      .all(roots, lo, hi);
    for (const p of prompts) {
      const run = runAt(p.session_id, p.created);
      if (run) run.prompts++;
    }

    return runs.map(({ r, ...a }) => ({
      id: r.id,
      sessionID: r.session_id,
      title: r.title ?? null,
      directory: r.directory ?? null,
      started: r.started,
      ended: r.ended,
      durationMs: r.started != null ? r.ended - r.started : null,
      outcome: r.outcome ?? null,
      reason: r.reason ?? null,
      prompts: a.prompts,
      steps: a.steps,
      failedSteps: a.failed,
      tools: a.tools,
      models: byTokens(a.models),
      agents: byTokens(a.agents),
      tokens: tokensOf(a.t),
      cost: a.cost,
      cacheRate: cacheRate(a.t),
      subagents: { sessions: a.subs.size, tokens: a.subTokens, cost: a.subCost },
      speed: speedStats(a.speed),
      ...(withSteps ? { stepSeries: stepSeries(a.series) } : {}),
    }));
  }

  // the last unpaged #runRows results, by `from`: an Analisi refresh asks for the same period twice
  // (/api/runs sorted by tokens, /api/runs/summary), each a full pass over the period's runs
  #runCache = new Map();

  /**
   * #runRows(from, to) without a page, reused while nothing was written (#stamp()) or, with
   * dashboardMaxAgeMs, for that long while the collector writes, and the runs selected are the same:
   * `to` is usually "now + 1 min" and moves between requests, so a different `to` is still a hit
   * when no run ended between the two.
   */
  #allRuns(from, to) {
    const stamp = this.#stamp();
    const at = Date.now();
    const hit = this.#runCache.get(from);
    if (hit && (hit.stamp === stamp || at - hit.at < this.dashboardMaxAgeMs)) {
      const [lo, hi] = hit.to < to ? [hit.to, to] : [to, hit.to];
      if (lo === hi || !this.db.prepare("SELECT 1 FROM runs WHERE ended >= ? AND ended < ? LIMIT 1").get(lo, hi)) return hit.rows;
    }
    const rows = this.#runRows(from, to);
    this.#runCache.delete(from);
    this.#runCache.set(from, { stamp, at, to, rows });
    if (this.#runCache.size > 4) this.#runCache.delete(this.#runCache.keys().next().value);
    return rows;
  }

  /**
   * Runs of primary sessions closed in [from, to): `sort` recent (default), tokens or duration, heaviest/longest first;
   * `steps` adds each run's stepSeries (uncached); `problems` keeps only the runs with a problem (hasProblem), before
   * the page: the last N problems, not the problems among the last N runs. `after` ({ ended, id }, and `v`, the
   * value of the sort key, when ranked) gives the page after that run in the order instead of an offset.
   */
  runs(from, to, { limit = 20, offset = 0, sort = "recent", steps = false, problems = false, after = null } = {}) {
    const n = Math.max(1, Math.floor(Number(limit)) || 20);
    const skip = Math.max(0, Math.floor(Number(offset)) || 0);
    const ranked = sort === "tokens" || sort === "duration";
    if (!ranked && !problems) return this.#runRows(from, to, after ? { limit: n, after } : { limit: n, offset: skip }, steps);
    const all = steps ? this.#runRows(from, to, null, true) : this.#allRuns(from, to);
    const rows = problems ? all.filter(hasProblem) : all;
    const key = sort === "tokens" ? (r) => r.tokens.total : (r) => r.durationMs ?? -1;
    // the recent order is ended DESC, id DESC: a run comes after `after` when it is older, or as old with a lower id
    const older = (r) => r.ended < after.ended || (r.ended === after.ended && r.id < after.id);
    if (!ranked) return after ? rows.filter(older).slice(0, n) : rows.slice(skip, skip + n);
    // ties: the most recent first, as in the recent order
    const sorted = rows
      .map((r, i) => [r, i])
      .sort(([a, i], [b, j]) => key(b) - key(a) || i - j)
      .map(([r]) => r);
    return after ? sorted.filter((r) => key(r) < after.v || (key(r) === after.v && older(r))).slice(0, n) : sorted.slice(skip, skip + n);
  }

  /** How many runs runs() pages through: with `problems`, only those with a problem. */
  runCount(from, to, { problems = false } = {}) {
    if (problems) return this.#allRuns(from, to).filter(hasProblem).length;
    return this.db
      .prepare(`SELECT COUNT(*) n FROM runs r JOIN sessions s ON s.id = r.session_id WHERE s.parent_id IS NULL AND r.ended >= ? AND r.ended < ?`)
      .get(from, to).n;
  }

  /** Outcomes, duration and tokens-per-prompt distribution of the runs closed in [from, to) (same attribution as runs()). */
  runSummary(from, to) {
    const rows = this.#allRuns(from, to);
    const outcomes = { succeeded: 0, failed: 0, interrupted: 0, unknown: 0 };
    const interruptions = { user: 0, superseded: 0, inactivity: 0, shutdown: 0, unknown: 0 };
    const histogram = [0, ...RUN_TOKEN_BUCKETS].map((lo, i) => ({ lo, hi: RUN_TOKEN_BUCKETS[i] ?? null, count: 0 }));
    for (const r of rows) {
      outcomes[RUN_OUTCOMES.includes(r.outcome) ? r.outcome : "unknown"]++;
      if (r.outcome === "interrupted") interruptions[INTERRUPT_REASONS.includes(r.reason) ? r.reason : "unknown"]++;
      histogram[RUN_TOKEN_BUCKETS.filter((b) => r.tokens.total >= b).length].count++;
    }
    return {
      count: rows.length,
      outcomes,
      interruptions,
      durationMs: stats(rows.map((r) => r.durationMs)),
      tokens: stats(rows.map((r) => r.tokens.total)),
      histogram,
    };
  }

  /**
   * Runs in progress, one per primary session tree, oldest first. Runs and prompts
   * are written only by the message sync, so a live run is recognized from steps,
   * tools and permissions: on the tree after the root's last run end, something in
   * flight within RUNNING_WINDOW_MS (step, tool, pending permission) or a step ended
   * less than LIVE_IDLE_GAP_MS ago. Called on every dashboard tick: one indexed
   * query when nothing happened in the last RUNNING_WINDOW_MS, four otherwise.
   */
  liveRuns(now = Date.now()) {
    const since = now - RUNNING_WINDOW_MS;
    const roots = this.db.prepare(LIVE_CANDIDATES_SQL).all(since, since, since);
    if (!roots.length) return { now, runs: [] };

    // each root's tree, with the end of its last run as the lower bound (exclusive)
    const bounds = JSON.stringify(roots.map((r) => [r.id, r.lastEnded]));
    const TREE_AFTER = `bound(root, after) AS (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)),
      tree(root, id) AS (SELECT root, root FROM bound UNION SELECT tree.root, s.id FROM sessions s JOIN tree ON s.parent_id = tree.id)`;
    const after = (col) => `(bound.after IS NULL OR ${col} > bound.after)`;
    const steps = this.db
      .prepare(
        `WITH RECURSIVE ${TREE_AFTER}
        SELECT tree.root, st.session_id, st.agent, ${MODEL_KEY} mk, st.started, st.last_started, st.ended, st.cost,
          st.t_in, st.t_out, st.t_reason, st.t_cread, st.t_cwrite, st.requested, st.first_output, st.streamed, st.finish, ${ST_TS} ts
        FROM tree JOIN bound ON bound.root = tree.root JOIN steps st ON st.session_id = tree.id
        WHERE ${after(ST_TS)}`,
      )
      .all(bounds);
    const tools = this.db
      .prepare(
        `WITH RECURSIVE ${TREE_AFTER}
        SELECT tree.root, t.session_id, t.name, t.status, t.created, t.ran
        FROM tree JOIN bound ON bound.root = tree.root JOIN tools t ON t.session_id = tree.id
        WHERE ${after(toolTs("t"))}`,
      )
      .all(bounds);
    const pending = this.db
      .prepare(
        `WITH RECURSIVE ${TREE_AFTER}
        SELECT tree.root, p.asked
        FROM tree JOIN bound ON bound.root = tree.root JOIN permissions p ON p.session_id = tree.id
        WHERE p.replied IS NULL AND p.asked >= ? AND ${after("p.asked")}`,
      )
      .all(bounds, since);

    const min = (a, b) => (b == null ? a : a == null ? b : Math.min(a, b));
    const live = new Map(
      roots.map((r) => [
        r.id,
        {
          r,
          first: r.firstPrompt,
          steps: 0,
          cost: 0,
          t: { t_in: 0, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0 },
          subs: new Set(),
          calls: 0,
          errors: 0,
          busy: false, // a step or tool in flight within the window
          waiting: false,
          lastEnd: null, // newest step end
          head: null, // step that gives agent and model
          tool: null,
          fast: null, // newest finished step with a speed: { ended, ttftMs, tokensPerSec }
          pendingStep: null, // root's newest step in flight: { start, requested, firstOutput, streamed }
        },
      ]),
    );
    for (const s of steps) {
      const a = live.get(s.root);
      const start = s.last_started ?? s.started ?? s.ts;
      a.steps++;
      a.cost += s.cost ?? 0;
      for (const k of Object.keys(a.t)) a.t[k] += s[k] ?? 0;
      if (s.session_id !== s.root) a.subs.add(s.session_id);
      a.first = min(a.first, s.started ?? s.ts);
      if (s.ended == null) a.busy ||= start >= since;
      else a.lastEnd = Math.max(a.lastEnd ?? s.ended, s.ended);
      if (s.ended != null) {
        const v = stepSpeed(s);
        if ((v.ttftMs != null || v.tokensPerSec != null) && (!a.fast || s.ended >= a.fast.ended)) a.fast = { ended: s.ended, ttftMs: v.ttftMs, tokensPerSec: v.tokensPerSec };
      } else if (s.session_id === s.root && start >= since && (!a.pendingStep || start >= a.pendingStep.start)) {
        a.pendingStep = { start, requested: s.requested, firstOutput: s.first_output, streamed: s.streamed };
      }
      // agent and model: the root's newest step, a subagent's only when the root has none
      const rank = [s.session_id === s.root ? 1 : 0, start];
      if (!a.head || rank[0] > a.head.rank[0] || (rank[0] === a.head.rank[0] && rank[1] >= a.head.rank[1])) a.head = { rank, s };
    }
    for (const t of tools) {
      const a = live.get(t.root);
      const start = t.ran ?? t.created;
      a.calls++;
      if (t.status === "error") a.errors++;
      a.first = min(a.first, start);
      if (t.status === "completed" || t.status === "error" || start == null || start < since) continue;
      a.busy = true;
      // the tool shown: the root's (e.g. "task" while a subagent works), then the newest
      const rank = [t.session_id === t.root ? 1 : 0, start];
      if (!a.tool || rank[0] > a.tool.rank[0] || (rank[0] === a.tool.rank[0] && rank[1] >= a.tool.rank[1])) a.tool = { rank, name: t.name, startedAt: start };
    }
    for (const p of pending) {
      const a = live.get(p.root);
      a.waiting = true;
      a.first = min(a.first, p.asked);
    }

    const runs = [];
    for (const a of live.values()) {
      if (!a.busy && !a.waiting && !(a.lastEnd != null && a.lastEnd >= now - LIVE_IDLE_GAP_MS)) continue;
      const model = a.head?.s.mk ?? null;
      const used = a.r.ctxUsed ?? null;
      const limit = this.contextLimit(model ?? a.r.ctxModel);
      runs.push({
        sessionID: a.r.id,
        title: a.r.title ?? null,
        directory: a.r.directory ?? null,
        started: a.first,
        agent: a.head?.s.agent ?? null,
        model,
        steps: a.steps,
        toolCalls: a.calls,
        toolErrors: a.errors,
        subagents: a.subs.size,
        tokens: tokensOf(a.t),
        cost: a.cost,
        context: { used, limit, ratio: used != null && limit ? used / limit : null },
        tool: a.tool ? { name: a.tool.name, startedAt: a.tool.startedAt } : null,
        waiting: a.waiting ? "permission" : null,
        speed: { ttftMs: a.fast?.ttftMs ?? null, tokensPerSec: a.fast?.tokensPerSec ?? null },
        // the root's step in flight has not produced output yet and its stream is still open
        // (an empty reply ends the stream without output): waiting for the first token
        waitingSince:
          a.pendingStep && a.pendingStep.firstOutput == null && a.pendingStep.streamed == null && a.pendingStep.requested != null && a.pendingStep.requested >= since
            ? a.pendingStep.requested
            : null,
      });
    }
    return { now, runs: runs.sort((x, y) => (x.started ?? Infinity) - (y.started ?? Infinity) || (x.sessionID < y.sessionID ? -1 : 1)) };
  }

  /** Tokens per budget-day hour (index 0 = the reset hour), internal usage included. DST: repeated hours share one bucket. */
  hourTotals(from, to) {
    const mod = this.reset.utc ? "" : ", 'localtime'";
    const out = new Array(24).fill(0);
    const sources = [
      [TS, TOKENS, "steps"],
      ["created", "t_in+t_out+t_reason+t_cread+t_cwrite", "internal_usage"],
    ];
    for (const [col, value, table] of sources) {
      const rows = this.db
        .prepare(
          `SELECT CAST(strftime('%H', ${col} / 1000, 'unixepoch'${mod}) AS INTEGER) h, COALESCE(SUM(${value}), 0) v
          FROM ${table} WHERE ${col} >= ? AND ${col} < ? GROUP BY h`,
        )
        .all(from, to);
      for (const r of rows) out[(r.h - this.reset.hour + 24) % 24] += r.v;
    }
    return out;
  }

  /** Tokens per hour of today's budget day, with the mean of the previous `days` days to compare against. */
  hourly(days = 7, now = Date.now()) {
    const n = Math.min(31, Math.max(1, Math.floor(Number(days)) || 7));
    const { from, to } = this.dayRange(now);
    const tokens = this.hourTotals(from, to);
    const avg = new Array(24).fill(0);
    let soFarAvg = 0;
    let cur = from;
    for (let k = 0; k < n; k++) {
      const b = periodBounds("day", cur - 1, this.reset);
      this.hourTotals(b.from, b.to).forEach((v, i) => {
        avg[i] += v / n;
      });
      // exact: each previous day up to the same offset from its start as `now` is from today's start
      soFarAvg += this.usage(b.from, Math.min(b.to, b.from + Math.max(0, now - from))).tokens / n;
      cur = b.from;
    }
    const labels = Array.from({ length: 24 }, (_, i) => `${pad((this.reset.hour + i) % 24)}:00`);
    const total = (a) => a.reduce((x, y) => x + y, 0);
    return { from, to, now, days: n, labels, tokens, avg, soFarAvg, dayAvg: total(avg) };
  }

  /**
   * Tokens (internal usage included, as hourTotals) and primary-session prompts by weekday (0 = Monday) and
   * clock hour over the last `days` budget days. Local time, or UTC with reset.utc.
   */
  rhythm(days = 28, now = Date.now()) {
    const n = Math.min(90, Math.max(1, Math.floor(Number(days)) || 28));
    const to = this.dayRange(now).to;
    let from = this.dayRange(now).from;
    for (let k = 1; k < n; k++) from = periodBounds("day", from - 1, this.reset).from;
    const mod = this.reset.utc ? "" : ", 'localtime'";
    const cells = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const prompts = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const sources = [
      [cells, TS, TOKENS, "steps", ""],
      [cells, "created", "t_in+t_out+t_reason+t_cread+t_cwrite", "internal_usage", ""],
      [prompts, "created", "1", "prompts", "WHERE session_id IN (SELECT id FROM sessions WHERE parent_id IS NULL) AND"],
    ];
    for (const [grid, col, value, table, where] of sources) {
      const rows = this.db
        .prepare(
          `SELECT CAST(strftime('%w', ${col} / 1000, 'unixepoch'${mod}) AS INTEGER) d, CAST(strftime('%H', ${col} / 1000, 'unixepoch'${mod}) AS INTEGER) h,
            COALESCE(SUM(${value}), 0) v
          FROM ${table} ${where || "WHERE"} ${col} >= ? AND ${col} < ? GROUP BY d, h`,
        )
        .all(from, to);
      for (const r of rows) grid[(r.d + 6) % 7][r.h] += r.v;
    }
    return { from, to, days: n, cells, prompts };
  }

  /** One entry per budget day, oldest first, the last being the current one. */
  daily(days = 7, now = Date.now()) {
    const n = Math.min(31, Math.max(1, Math.floor(Number(days)) || 7));
    const bounds = [];
    let cur = this.dayRange(now);
    for (let k = 0; k < n; k++) {
      bounds.unshift(cur);
      cur = periodBounds("day", cur.from - 1, this.reset);
    }
    return {
      days: bounds.map(({ from, to }) => {
        const u = this.usage(from, to);
        const c = this.db
          .prepare(
            `SELECT COALESCE(SUM(t_in), 0) t_in, COALESCE(SUM(t_cread), 0) t_cread, COALESCE(SUM(t_cwrite), 0) t_cwrite
            FROM steps WHERE ${TS} >= ? AND ${TS} < ?`,
          )
          .get(from, to);
        const durations = this.db
          .prepare(
            `SELECT ended - last_started d FROM steps
            WHERE ended IS NOT NULL AND last_started IS NOT NULL AND finish IS NOT 'error' AND ${TS} >= ? AND ${TS} < ? ORDER BY d`,
          )
          .all(from, to)
          .map((x) => x.d)
          .filter((d) => d >= 0);
        const tools = this.db
          .prepare(
            `SELECT COUNT(*) calls, COALESCE(SUM(status = 'error'), 0) errors
            FROM tools WHERE ${TOOL_TS} >= ? AND ${TOOL_TS} < ?`,
          )
          .get(from, to);
        const runs = this.db
          .prepare(`SELECT COUNT(*) n, COALESCE(SUM(r.outcome = 'failed'), 0) failed FROM runs r JOIN sessions s ON s.id = r.session_id WHERE s.parent_id IS NULL AND r.ended >= ? AND r.ended < ?`)
          .get(from, to);
        const speed = speedStats(this.db.prepare(`SELECT ${SPEED_COLS} FROM steps WHERE requested IS NOT NULL AND ${TS} >= ? AND ${TS} < ?`).all(from, to));
        const prompts = this.db
          .prepare(`SELECT COUNT(*) n FROM prompts p JOIN sessions s ON s.id = p.session_id WHERE s.parent_id IS NULL AND p.created >= ? AND p.created < ?`)
          .get(from, to).n;
        const retries = this.db.prepare(RETRIES_SQL).get(from, to);
        return {
          date: this.reset.utc ? new Date(from).toISOString().slice(0, 10) : localDay(from),
          from,
          to,
          tokens: u.tokens,
          cost: u.cost,
          steps: u.steps,
          runs: runs.n,
          failedRuns: runs.failed,
          prompts,
          cacheRate: cacheRate(c),
          latencyMs: { p50: quantile(durations, 0.5), p95: quantile(durations, 0.95) },
          ttft: speed.ttftMs,
          tools: { calls: tools.calls, errors: tools.errors },
          retries: retries.retries,
          rateLimited: retries.rateLimited,
        };
      }),
    };
  }

  /** Tokens, cost and steps between from and to, internal usage (titles, summaries) included. */
  usage(from, to) {
    const s = this.db
      .prepare(`SELECT COUNT(*) steps, COALESCE(SUM(cost), 0) cost, COALESCE(SUM(${TOKENS}), 0) tokens FROM steps WHERE ${TS} >= ? AND ${TS} < ?`)
      .get(from, to);
    const i = this.db
      .prepare(`SELECT COALESCE(SUM(cost), 0) cost, COALESCE(SUM(t_in+t_out+t_reason+t_cread+t_cwrite), 0) tokens FROM internal_usage WHERE created >= ? AND created < ?`)
      .get(from, to);
    return { tokens: s.tokens + i.tokens, cost: s.cost + i.cost, steps: s.steps };
  }

  /** The calendar period containing `now` against `limits`, with a linear projection to its end. */
  period(kind, limits, now = Date.now()) {
    const { from, to } = periodBounds(kind, now, this.reset);
    const used = this.usage(from, to);
    const { elapsed, factor } = projection(kind, from, to, now);
    const metric = (k) => measure(used[k], limits?.[k] ?? null, factor);
    return { from, to, elapsed, tokens: metric("tokens"), cost: metric("cost"), steps: metric("steps") };
  }

  /** Context window of "provider/model[#variant]": OpenCode's config first, then its model catalog; null if unknown. */
  contextLimit(model) {
    const key = String(model ?? "").split("#")[0];
    const fromConfig = this.opencodeModels?.current()?.models?.find((m) => m.model === key)?.context;
    return fromConfig ?? this.catalog?.limit(key)?.context ?? (Object.hasOwn(this.contextLimits, key) ? this.contextLimits[key] : null);
  }

  /**
   * Tokens of each LENS_MODEL_LIMITS model in the budget day `day` (a period()),
   * all variants together; internal usage has no model and stays out.
   */
  modelBudgets(day, now) {
    // only the models still in OpenCode's configuration count; the others are history
    const { active } = splitLimits(this.modelLimits, this.opencodeModels?.current());
    if (!active.length) return [];
    const { factor } = projection("day", day.from, day.to, now);
    const used = this.modelTokens(day.from, day.to);
    this.seenModels ??= new Set(); // once seen, always seen: skip the lookup
    const ever = this.db.prepare(`SELECT EXISTS(SELECT 1 FROM steps WHERE provider = ? AND model = ?) seen`);
    return active.map(({ model, provider, name, limit }) => {
      if (!this.seenModels.has(model) && ever.get(provider, name).seen) this.seenModels.add(model);
      return { model, ...measure(used.get(model) ?? 0, limit, factor), seen: this.seenModels.has(model) };
    });
  }

  /** Step tokens per "provider/model" between from and to, all variants together. */
  modelTokens(from, to) {
    const used = new Map();
    for (const r of this.db
      .prepare(`SELECT provider, model, COALESCE(SUM(${TOKENS}), 0) tokens FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY provider, model`)
      .all(from, to)) {
      used.set(`${r.provider}/${r.model}`, r.tokens);
    }
    return used;
  }

  /**
   * The budget day (from LENS_RESET_HOUR) against the configured daily limits, with a linear
   * projection to its end, plus the tokens of the budget day and of working hours (7–19, local time).
   */
  today(now = Date.now()) {
    const p = this.period("day", this.limits, now);
    const legacy = (m) => ({ used: m.used, limit: m.limit, ratio: m.ratio, projected: m.projected, projectedRatio: m.projectedRatio });
    // the first bar is the budget day (LENS_RESET_HOUR), labelled with its local hours;
    // working hours stay on the calendar day of `now`, also on 23/25 h days
    const at = (h) => new Date(now).setHours(h, 0, 0, 0);
    const startHour = new Date(p.from).getHours();
    const endHour = new Date(p.to).getHours();
    const windows = [
      { startHour, endHour: startHour === 0 && endHour === 0 ? 24 : endHour, from: p.from, to: p.to, tokens: p.tokens.used },
      { startHour: WORK_HOURS[0], endHour: WORK_HOURS[1], from: at(WORK_HOURS[0]), to: at(WORK_HOURS[1]), tokens: this.usage(at(WORK_HOURS[0]), at(WORK_HOURS[1])).tokens },
    ];
    return { day: localDay(p.from), from: p.from, to: p.to, now, tokens: legacy(p.tokens), cost: legacy(p.cost), steps: legacy(p.steps), windows };
  }

  /** Day, calendar week (from Monday) and calendar month against their budgets, for the monitor app and its widgets. */
  budget(now = Date.now()) {
    const week = this.period("week", this.weeklyLimits, now);
    const days = new Map(bucketLabels(week.from, week.to, "day").map((date) => [date, { date, tokens: 0, cost: 0, steps: 0 }]));
    for (const r of this.db
      .prepare(`SELECT ${bucketExpr(TS, "day")} d, COUNT(*) steps, COALESCE(SUM(cost), 0) cost, COALESCE(SUM(${TOKENS}), 0) tokens FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY d`)
      .all(week.from, week.to)) {
      const e = days.get(r.d);
      if (!e) continue;
      e.steps += r.steps;
      e.cost += r.cost;
      e.tokens += r.tokens;
    }
    for (const r of this.db
      .prepare(`SELECT ${bucketExpr("created", "day")} d, COALESCE(SUM(cost), 0) cost, COALESCE(SUM(t_in+t_out+t_reason+t_cread+t_cwrite), 0) tokens FROM internal_usage WHERE created >= ? AND created < ? GROUP BY d`)
      .all(week.from, week.to)) {
      const e = days.get(r.d);
      if (!e) continue;
      e.cost += r.cost;
      e.tokens += r.tokens;
    }
    const day = this.period("day", this.limits, now);
    return {
      now,
      periods: {
        day: { ...day, models: this.modelBudgets(day, now) },
        week: { ...week, days: [...days.values()] },
        month: this.period("month", this.monthlyLimits, now),
      },
    };
  }

  /** One value per local day for the last 53 weeks (Monday-aligned), for the calendar heat map. */
  calendar(metric = "tokens", now = Date.now()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 52 * 7);
    const end = new Date(today);
    end.setDate(end.getDate() + 1);
    const from = start.getTime();
    const to = end.getTime();
    const value =
      metric === "cost" ? "COALESCE(cost, 0)" : metric === "steps" ? "1" : "COALESCE(t_in,0)+COALESCE(t_out,0)+COALESCE(t_reason,0)+COALESCE(t_cread,0)+COALESCE(t_cwrite,0)";
    const byDay = new Map();
    for (const r of this.db.prepare(`SELECT ${bucketExpr(TS, "day")} d, SUM(${value}) v, COUNT(*) n FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY d`).all(from, to)) {
      byDay.set(r.d, { v: r.v, n: r.n });
    }
    if (metric !== "steps") {
      const iv = metric === "cost" ? "cost" : "t_in+t_out+t_reason+t_cread+t_cwrite";
      for (const r of this.db.prepare(`SELECT ${bucketExpr("created", "day")} d, SUM(${iv}) v FROM internal_usage WHERE created >= ? AND created < ? GROUP BY d`).all(from, to)) {
        const e = byDay.get(r.d) ?? { v: 0, n: 0 };
        e.v += r.v;
        byDay.set(r.d, e);
      }
    }
    const days = bucketLabels(from, to, "day").map((date) => ({ date, value: byDay.get(date)?.v ?? 0, steps: byDay.get(date)?.n ?? 0 }));
    // the current streak: consecutive active days up to today, or up to
    // yesterday while today has no activity yet
    let streak = 0;
    let k = days.length - 1;
    if (k >= 0 && days[k].steps === 0) k--;
    for (; k >= 0 && days[k].steps > 0; k--) streak++;
    let longest = 0;
    let run = 0;
    for (const d of days) {
      run = d.steps > 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const active = days.filter((d) => d.steps > 0);
    return {
      metric,
      days,
      total: days.reduce((a, d) => a + d.value, 0),
      max: Math.max(0, ...days.map((d) => d.value)),
      activeDays: active.length,
      streak,
      longestStreak: longest,
    };
  }

  /** Recent activity, same shape as the live feed items, to seed the dashboard. */
  feed(limit = 40) {
    const steps = this.db
      .prepare(
        `SELECT ended at, CASE WHEN finish = 'error' THEN 'step-failed' ELSE 'step' END kind, session_id sessionID,
          provider, model, agent, finish, cost,
          COALESCE(t_in,0)+COALESCE(t_out,0)+COALESCE(t_reason,0)+COALESCE(t_cread,0)+COALESCE(t_cwrite,0) tokens,
          CASE WHEN last_started IS NOT NULL THEN ended - last_started END durationMs, error_msg error
        FROM steps WHERE ended IS NOT NULL ORDER BY ended DESC LIMIT ?`,
      )
      .all(limit);
    const tools = this.db
      .prepare(`SELECT ended at, 'tool-failed' kind, session_id sessionID, name tool, error_msg error FROM tools WHERE status = 'error' AND ended IS NOT NULL ORDER BY ended DESC LIMIT ?`)
      .all(limit);
    const retries = this.db
      .prepare(`SELECT created at, 'retry' kind, session_id sessionID, detail FROM signals WHERE type = 'session.retry.scheduled' ORDER BY created DESC LIMIT ?`)
      .all(limit)
      .map((r) => {
        const d = safeJson(r.detail) ?? {};
        return { at: r.at, kind: r.kind, sessionID: r.sessionID, attempt: d.attempt, error: d.error?.error_msg ?? null };
      });
    const runs = this.db
      .prepare(
        `SELECT r.ended at, 'run' kind, r.session_id sessionID, r.outcome,
          CASE WHEN r.started IS NOT NULL THEN r.ended - r.started END durationMs
        FROM runs r JOIN sessions s ON s.id = r.session_id WHERE s.parent_id IS NULL ORDER BY r.ended DESC LIMIT ?`,
      )
      .all(limit);
    // compactions: live-only signals, like the retries
    const compactions = this.db
      .prepare(
        `SELECT created, type, session_id, detail FROM signals
        WHERE type IN ('session.compaction.ended', 'session.compaction.failed') ORDER BY created DESC LIMIT ?`,
      )
      .all(limit)
      .map((r) => {
        const d = safeJson(r.detail) ?? {};
        return compactionFeedItem({ at: r.created, sessionID: r.session_id, failed: r.type === "session.compaction.failed", reason: d.reason, model: d.model });
      });
    // new primary sessions (a subagent's session is part of its parent's prompt, not news)
    const sessions = this.db
      .prepare(
        `SELECT created at, 'session' kind, id sessionID FROM sessions
        WHERE parent_id IS NULL AND deleted IS NULL AND created IS NOT NULL ORDER BY created DESC LIMIT ?`,
      )
      .all(limit);
    return [...steps, ...tools, ...retries, ...runs, ...compactions, ...sessions].sort((a, b) => b.at - a.at).slice(0, limit);
  }

  /**
   * Failed steps, failed tools, retries and failed executions in [from, to), grouped by
   * source, model, error type, HTTP status and tool. Tools and signals take provider and
   * model from their step; a signal without one falls back to the session's last step
   * started before it. Retries and executions exist only while the lens was running live.
   */
  errors(from, to, { sessionID = null, directory = null, text = false, limit = 30 } = {}) {
    const n = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 30));
    const scope = [];
    if (sessionID != null) scope.push("IN (SELECT id FROM tree)");
    if (directory != null) scope.push("IN (SELECT id FROM sessions WHERE directory = ?)");
    const where = (col) => scope.map((c) => ` AND ${col} ${c}`).join("");
    const cte = sessionID != null ? `WITH RECURSIVE ${TREE} ` : "";
    // placeholders: the tree's roots (in the CTE), the time range, then the directory
    const args = [...(sessionID != null ? [JSON.stringify([sessionID])] : []), from, to, ...(directory != null ? [directory] : [])];
    const all = (sql) => this.db.prepare(cte + sql).all(...args);
    const rows = [];
    for (const r of all(
      `SELECT session_id, ${TS} at, provider, model, error_type type, error_msg msg, attempts FROM steps
        WHERE finish = 'error' AND ${TS} >= ? AND ${TS} < ?${where("session_id")}`,
    )) {
      rows.push({ source: "step", ...r, tool: null, attempt: r.attempts });
    }
    const T_TS = toolTs("t");
    for (const r of all(
      `SELECT t.session_id, ${T_TS} at, st.provider, st.model, t.error_type type, t.error_msg msg, t.name tool
        FROM tools t LEFT JOIN steps st ON st.id = t.message_id
        WHERE t.status = 'error' AND ${T_TS} >= ? AND ${T_TS} < ?${where("t.session_id")}`,
    )) {
      rows.push({ source: "tool", ...r, tool: r.tool ?? "?", attempt: null });
    }
    const S2_START = stepStart("s2");
    for (const r of all(
      `SELECT sg.type kind, sg.session_id, sg.created at, sg.detail, st.provider, st.model
        FROM signals sg LEFT JOIN steps st ON st.id = COALESCE(
          (SELECT id FROM steps WHERE id = sg.message_id),
          (SELECT s2.id FROM steps s2 WHERE s2.session_id = sg.session_id AND ${S2_START} <= sg.created ORDER BY ${S2_START} DESC LIMIT 1))
        WHERE sg.type IN ('session.retry.scheduled', 'session.execution.failed') AND sg.created >= ? AND sg.created < ?${where("sg.session_id")}`,
    )) {
      const d = safeJson(r.detail) ?? {};
      rows.push({
        source: r.kind === "session.retry.scheduled" ? "retry" : "run",
        session_id: r.session_id,
        at: r.at,
        provider: r.provider,
        model: r.model,
        type: d.error?.error_type ?? null,
        msg: d.error?.error_msg ?? null,
        tool: null,
        attempt: typeof d.attempt === "number" ? d.attempt : null,
      });
    }
    const totals = { steps: 0, tools: 0, retries: 0, runs: 0 };
    const TOTAL = { step: "steps", tool: "tools", retry: "retries", run: "runs" };
    const groups = new Map();
    for (const r of rows) {
      totals[TOTAL[r.source]]++;
      const model = r.provider == null && r.model == null ? "?" : `${r.provider ?? "?"}/${r.model ?? "?"}`;
      const type = r.type ?? "?";
      const status = httpStatus(r.msg);
      const key = JSON.stringify([r.source, model, type, status, r.tool]);
      let g = groups.get(key);
      if (!g) {
        g = { source: r.source, provider: r.provider ?? null, model, type, status, tool: r.tool, count: 0, ids: new Set(), first: null, last: null, maxAttempt: null, texts: new Map() };
        groups.set(key, g);
      }
      g.count++;
      if (r.session_id != null) g.ids.add(r.session_id);
      if (r.at != null) {
        g.first = g.first == null ? r.at : Math.min(g.first, r.at);
        g.last = g.last == null ? r.at : Math.max(g.last, r.at);
      }
      if (r.attempt != null) g.maxAttempt = Math.max(g.maxAttempt ?? r.attempt, r.attempt);
      if (text && r.msg) {
        const m = String(r.msg).slice(0, 160);
        g.texts.set(m, (g.texts.get(m) ?? 0) + 1);
      }
    }
    const signalsSince = this.db.prepare(`SELECT MIN(created) m FROM signals`).get().m ?? null;
    return {
      from,
      to,
      scope: { sessionID, directory },
      totals,
      groups: [...groups.values()]
        .sort((a, b) => b.count - a.count || (b.last ?? 0) - (a.last ?? 0))
        .slice(0, n)
        .map(({ ids, texts, ...g }) => {
          const out = { ...g, sessions: ids.size };
          if (text) {
            out.samples = [...texts]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([message, count]) => ({ message, count }));
          }
          return out;
        }),
      coverage: { signalsSince, partial: signalsSince == null || signalsSince > from },
    };
  }

  signals(from, to, limit = 50) {
    return this.db
      .prepare(`SELECT type, session_id sessionID, message_id messageID, created, detail FROM signals WHERE created >= ? AND created < ? ORDER BY created DESC LIMIT ?`)
      .all(from, to, limit)
      .map((r) => ({ ...r, detail: safeJson(r.detail) }));
  }

  /**
   * Every metric as structured families, shared by /metrics (Prometheus text)
   * and the OTLP export. Counters are all-time and stay monotonic when the lens deletes rows: what the
   * deleted rows counted is kept in counter_offsets (Store.deleteCompensated) and added back here. A
   * correction downwards (the backfill over a live value: docs/metriche.md) can still lower one.
   * @returns {{name: string, type: "counter"|"gauge"|"summary", help: string, samples: {labels: object, value?: number, sum?: number, count?: number}[]}[]}
   */
  families(collector, now = Date.now(), extra = []) {
    return this.#families(collector, now, extra, {});
  }

  /**
   * The value of every counter and summary series families() computes from the rows, without the offsets
   * and without the memo: key JSON.stringify([name, labelKey(labels)]), a summary as <name>_sum and
   * <name>_count. With `scope` { from, to } only the series made of steps and tools, from the rows in
   * [from, to): what deleting them takes away (Store.deleteCompensated).
   * @param {{ from: number, to: number } | null} scope
   * @returns {Map<string, number>}
   */
  counterSnapshot(scope = null) {
    const out = new Map();
    for (const f of this.#families(null, Date.now(), [], { snapshot: true, scope })) {
      if (f.type === "gauge") continue; // permissions_pending comes with the counters of its read
      for (const smp of f.samples) {
        const labels = labelKey(smp.labels);
        if (f.type === "summary") {
          out.set(JSON.stringify([`${f.name}_sum`, labels]), smp.sum);
          out.set(JSON.stringify([`${f.name}_count`, labels]), smp.count);
        } else out.set(JSON.stringify([f.name, labels]), smp.value);
      }
    }
    return out;
  }

  /**
   * The rounding margin of each REAL series families() makes of steps and tools (cost, the sums of the
   * duration, ttft and speed summaries), by series key as counterSnapshot() gives it: what
   * Store.deleteCompensated adds to the offset of such a series so that, rounded as families() computes it,
   * it never ends up below its value before the deletion. The integer series (counts, bytes, tokens) have
   * none: their sums are exact.
   *
   * A series' value sums n <= N terms (N rows with its labels), each the result of at most two roundings
   * (SQL arithmetic, /1000), with SQLite's SUM (Kahan-Babuska-Neumaier, within the bound of recursive
   * summation), a JS sum over at most N groups and one addition of the offset. With u = 2^-53 each such value
   * is within g*A of its exact sum, g = gamma(3N + 4) <= 1.01*(3N + 4)*u, A = sum of |term| + |offset| (Higham,
   * Accuracy and Stability, 4.2): the bound holds for terms of any sign, on their absolute values. Before and
   * after the deletion, the drop (a difference of two such values) and two last additions give at most
   * 4g*A + 3u*A, so the margin is A*(13N + 21)*u, with A and N of the series itself. A = 0 is a sum of
   * zeros, exact: margin 0. Reading every row grouped by those labels, A and N are upper bounds also after
   * the deletions of a retention run: a deletion takes its rows' |terms| out of the sum and puts at most
   * (1 + g) of them, plus the margin, into the offset, a growth the factor 1 + 2^-20 covers; rows written
   * meanwhile need new margins (src/retention.js).
   * @returns {Map<string, number>}
   */
  counterMargins() {
    const parts = this.#marginParts();
    while (!parts.next().done);
    return this.#margins;
  }

  /** counterMargins() a block of rows at a time, giving the event loop back between two blocks. */
  async counterMarginsAsync() {
    for (const parts = this.#marginParts(); !parts.next().done; ) await new Promise(setImmediate);
    return this.#margins;
  }

  #margins = null;

  /** Reads the steps and the tool calls MARGIN_ROWS rows at a time (by rowid), yielding after each block. */
  *#marginParts() {
    const sums = new Map(); // series key -> { a: sum of |term|, n: rows }
    const add = (name, labels, a, n) => {
      const key = JSON.stringify([name, labelKey(labels)]);
      const s = sums.get(key) ?? sums.set(key, { a: 0, n: 0 }).get(key);
      s.a += a;
      s.n += n;
    };
    const steps = this.db.prepare(
      `SELECT COALESCE(provider,'?') provider, COALESCE(model,'?') model, COALESCE(agent,'?') agent, COUNT(*) n,
        COALESCE(SUM(ABS(cost)), 0) cost, COALESCE(SUM(ABS(ended - last_started)), 0) / 1000.0 dur,
        COALESCE(SUM(ABS(${SQL_TTFT_MS})), 0) / 1000.0 ttft, COALESCE(SUM(ABS(${SQL_TOKENS_PER_SEC})), 0) rate
      FROM steps WHERE rowid > ? AND rowid <= ? GROUP BY 1, 2, 3`,
    );
    const tools = this.db.prepare(
      `SELECT COALESCE(name,'?') tool, COALESCE(status,'?') status, COUNT(*) n,
        COALESCE(SUM(ABS(ended - COALESCE(ran, created))), 0) / 1000.0 dur
      FROM tools WHERE rowid > ? AND rowid <= ? GROUP BY 1, 2`,
    );
    for (const [table, read] of [["steps", steps], ["tools", tools]]) {
      const last = this.db.prepare(`SELECT COALESCE(MAX(rowid), 0) m FROM ${table}`).get().m;
      for (let lo = 0; lo < last; lo += MARGIN_ROWS) {
        for (const r of read.all(lo, lo + MARGIN_ROWS)) {
          if (table === "tools") add("opencode_lens_tool_duration_seconds_sum", { tool: r.tool, status: r.status }, r.dur, r.n);
          else {
            const labels = { provider: r.provider, model: r.model, agent: r.agent };
            add("opencode_lens_cost_usd_total", labels, r.cost, r.n);
            add("opencode_lens_step_duration_seconds_sum", labels, r.dur, r.n);
            add("opencode_lens_step_ttft_seconds_sum", labels, r.ttft, r.n);
            add("opencode_lens_step_output_tokens_per_second_sum", labels, r.rate, r.n);
          }
        }
        yield;
      }
    }
    const offsets = new Map(this.db.prepare(`SELECT name, labels, ABS(value) v FROM counter_offsets`).all().map((o) => [JSON.stringify([o.name, o.labels]), o.v]));
    const u = 2 ** -53;
    this.#margins = new Map(
      [...sums].map(([key, { a, n }]) => {
        const abs = a + (offsets.get(key) ?? 0);
        return [key, abs === 0 ? 0 : abs * (1 + 2 ** -20) * (13 * (n + 1) + 21) * u];
      }),
    );
  }

  /**
   * families() and counterSnapshot(): a snapshot leaves out the gauges, the collector's counter, the memo
   * and the offsets; with a scope it also leaves out every family not made of steps and tools, and reads
   * those tables only in [scope.from, scope.to). Without one the SQL is the same text as families()'s.
   */
  #families(collector, now, extra, { snapshot = false, scope = null }) {
    const fams = [];
    const fam = (name, type, help) => {
      const f = { name, type, help, samples: [] };
      fams.push(f);
      return f.samples;
    };
    // whole-table aggregates come from the memo; what depends on `now` or on the collector is read every time
    const memo = snapshot ? null : this.#memo("metrics", this.metricsMaxAgeMs);
    const rows = (sql, args = []) => (memo ? (memo.get(sql) ?? memo.set(sql, this.db.prepare(sql).all()).get(sql)) : this.db.prepare(sql).all(...args));
    // the rowid stays visible: the ttft read orders by it
    const S = scope ? `(SELECT rowid AS rowid, * FROM steps WHERE ${TS} >= ? AND ${TS} < ?) steps` : "steps";
    const T = scope ? `(SELECT rowid AS rowid, * FROM tools WHERE ${TOOL_TS} >= ? AND ${TOOL_TS} < ?) tools` : "tools";
    const args = scope ? [scope.from, scope.to] : [];
    if (!snapshot) {
      const st = collector.status();
      fam("opencode_lens_build_info", "gauge", "Version of the lens and of Node, always 1").push({ labels: { version: VERSION, node: process.versions.node }, value: 1 });
      fam("opencode_lens_up", "gauge", "1 when the lens is connected to the OpenCode event stream").push({ labels: {}, value: st.state === "connected" ? 1 : 0 });
      fam("opencode_lens_start_time_seconds", "gauge", "Unix time the lens process started: it changes on every restart").push({ labels: {}, value: Math.round(Date.now() / 1000 - process.uptime()) });
      fam("opencode_lens_last_event_timestamp_seconds", "gauge", "Unix time of the last event received").push({ labels: {}, value: st.lastEventAt ? st.lastEventAt / 1000 : 0 });
      fam("opencode_lens_api_drift_events", "gauge", "Events whose shape no longer matches what the lens expects").push({ labels: {}, value: st.drift.reduce((a, d) => a + d.count, 0) });
      fam("opencode_lens_duplicate_events_total", "counter", "Events received twice (same id) and applied once").push({ labels: {}, value: st.duplicateEvents ?? 0 });
    }

    const g = rows(
      `SELECT COALESCE(provider,'?') provider, COALESCE(model,'?') model, COALESCE(agent,'?') agent,
        CASE WHEN ended IS NULL THEN NULL ELSE COALESCE(finish, 'unknown') END finish, COUNT(*) n, COALESCE(SUM(cost),0) cost,
        COALESCE(SUM(t_in),0) t_in, COALESCE(SUM(t_out),0) t_out, COALESCE(SUM(t_reason),0) t_reason,
        COALESCE(SUM(t_cread),0) t_cread, COALESCE(SUM(t_cwrite),0) t_cwrite,
        COALESCE(SUM(CASE WHEN ended IS NOT NULL AND last_started IS NOT NULL AND finish IS NOT 'error' THEN ended - last_started END),0) dsum,
        COALESCE(SUM(ended IS NOT NULL AND last_started IS NOT NULL AND finish IS NOT 'error'),0) dn
      FROM ${S} WHERE provider IS NOT NULL AND model IS NOT NULL GROUP BY 1,2,3,4`,
      args,
    );
    // Counters carry only final states: a label that changes when the step ends
    // (the old finish="running") makes a series shrink, read as a reset, and an
    // OTLP delta export then counts the step twice. Steps in flight are a gauge.
    // For the same reason a step whose provider and model are not known yet (only
    // its end seen live) waits for the backfill instead of counting under "?".
    const steps = fam("opencode_lens_steps_total", "counter", "Finished provider steps (assistant messages) by finish reason");
    for (const r of g) {
      if (r.finish !== null) steps.push({ labels: { provider: r.provider, model: r.model, agent: r.agent, finish: r.finish }, value: r.n });
    }
    // An interrupted step never gets an end: only recent ones count as in progress.
    const since = now - RUNNING_WINDOW_MS;
    if (!snapshot) {
      const running = fam("opencode_lens_steps_running", "gauge", "Provider steps in progress (started in the last 30 minutes)");
      for (const r of this.db
        .prepare(
          `SELECT COALESCE(provider,'?') provider, COALESCE(model,'?') model, COALESCE(agent,'?') agent, COUNT(*) n
        FROM steps WHERE ended IS NULL AND COALESCE(last_started, started) >= ? GROUP BY 1,2,3`,
        )
        .all(since)) {
        running.push({ labels: { provider: r.provider, model: r.model, agent: r.agent }, value: r.n });
      }
    }
    const agg = new Map();
    for (const r of g) {
      const key = `${r.provider}\u0000${r.model}\u0000${r.agent}`;
      const a = agg.get(key) ?? { provider: r.provider, model: r.model, agent: r.agent, cost: 0, t_in: 0, t_out: 0, t_reason: 0, t_cread: 0, t_cwrite: 0, dsum: 0, dn: 0 };
      for (const k of ["cost", "t_in", "t_out", "t_reason", "t_cread", "t_cwrite", "dsum", "dn"]) a[k] += r[k];
      agg.set(key, a);
    }
    const KINDS = [["input", "t_in"], ["output", "t_out"], ["reasoning", "t_reason"], ["cache_read", "t_cread"], ["cache_write", "t_cwrite"]];
    const tokens = fam("opencode_lens_tokens_total", "counter", "Tokens by kind (input excludes cache; output excludes reasoning)");
    const cost = fam("opencode_lens_cost_usd_total", "counter", "Cost in USD as computed by OpenCode from model pricing");
    const dur = fam("opencode_lens_step_duration_seconds", "summary", "Duration of successful steps (last attempt)");
    for (const a of agg.values()) {
      const base = { provider: a.provider, model: a.model, agent: a.agent };
      for (const [kind, col] of KINDS) tokens.push({ labels: { ...base, kind }, value: a[col] });
      cost.push({ labels: base, value: a.cost });
      dur.push({ labels: base, sum: a.dsum / 1000, count: a.dn });
    }
    // internal usage, skills, prompts, runs, permissions, sessions and signals are not made of steps and
    // tools: a scoped snapshot leaves them out
    if (!scope) {
      const i = rows(`SELECT COALESCE(SUM(cost),0) cost, COALESCE(SUM(t_in),0) t_in, COALESCE(SUM(t_out),0) t_out, COALESCE(SUM(t_reason),0) t_reason, COALESCE(SUM(t_cread),0) t_cread, COALESCE(SUM(t_cwrite),0) t_cwrite FROM internal_usage`)[0];
      fam("opencode_lens_internal_cost_usd_total", "counter", "Usage not tied to a step: title generation, compaction").push({ labels: {}, value: i.cost });
      const itok = fam("opencode_lens_internal_tokens_total", "counter", "Tokens not tied to a step, by kind");
      for (const [kind, col] of KINDS) itok.push({ labels: { kind }, value: i[col] });
      // exact internal usage only: the estimate ("other") shrinks when a row becomes exact, so it has no counter
      const xtok = fam("opencode_lens_internal_usage_tokens_total", "counter", "Exact internal usage reported by OpenCode, by source (title, compaction) and token kind");
      const xcost = fam("opencode_lens_internal_usage_cost_usd_total", "counter", "Cost of the exact internal usage reported by OpenCode, by source");
      for (const r of rows(
        `SELECT kind, SUM(cost) cost, SUM(t_in) t_in, SUM(t_out) t_out, SUM(t_reason) t_reason, SUM(t_cread) t_cread, SUM(t_cwrite) t_cwrite
      FROM internal_usage WHERE kind IN ('title', 'compaction') GROUP BY kind ORDER BY kind DESC`,
      )) {
        for (const [kind, col] of KINDS) xtok.push({ labels: { source: r.kind, kind }, value: r[col] });
        xcost.push({ labels: { source: r.kind }, value: r.cost });
      }
    }
    const ttft = fam("opencode_lens_step_ttft_seconds", "summary", "Time from the request to the first output of a step (last attempt)");
    const rate = fam("opencode_lens_step_output_tokens_per_second", "summary", "Output tokens per second over the provider stream (sum of per-step rates)");
    // stepSpeed() in SQL, summed per label set in the order the steps were inserted
    for (const a of rows(
      `WITH v AS (
        SELECT rowid rid, provider, model, agent, ${SQL_TTFT_MS} ttft, ${SQL_TOKENS_PER_SEC} rate
        FROM ${S} WHERE requested IS NOT NULL AND ended IS NOT NULL)
      SELECT provider, model, agent, SUM(ttft / 1000.0) ts, COUNT(ttft) tn, SUM(rate) rs, COUNT(rate) rn
      FROM v WHERE ttft IS NOT NULL OR rate IS NOT NULL
      GROUP BY provider, model, agent ORDER BY MIN(rid)`,
      args,
    )) {
      const labels = { provider: a.provider ?? "?", model: a.model ?? "?", agent: a.agent ?? "?" };
      if (a.tn) ttft.push({ labels, sum: a.ts, count: a.tn });
      if (a.rn) rate.push({ labels, sum: a.rs, count: a.rn });
    }

    // final states only (completed | error), as for steps; calls in flight are a gauge
    if (!scope) {
      const skillLoads = fam("opencode_lens_skill_loads_total", "counter", "Completed skill loads by skill, channel (skill, activated, lens-preset, lens-prompt) and origin (lens, native)");
      for (const r of rows(`SELECT skill_id, COALESCE(channel,'?') channel, COALESCE(origin,'?') origin, COUNT(*) n FROM skill_uses WHERE skill_id IS NOT NULL AND status = 'completed' GROUP BY 1,2,3`)) {
        skillLoads.push({ labels: { skill: r.skill_id, channel: r.channel, origin: r.origin }, value: r.n });
      }
      const presetLoads = fam("opencode_lens_skill_preset_loads_total", "counter", "Completed skill preset loads by preset and channel");
      for (const r of rows(`SELECT COALESCE(preset_id,'?') preset, COALESCE(channel,'?') channel, COUNT(*) n FROM skill_uses WHERE skill_id IS NULL AND status = 'completed' GROUP BY 1,2`)) {
        presetLoads.push({ labels: { preset: r.preset, channel: r.channel }, value: r.n });
      }
    }
    const tools = fam("opencode_lens_tool_calls_total", "counter", "Finished tool calls by status");
    const outBytes = fam("opencode_lens_tool_output_bytes_total", "counter", "Bytes of text returned by tools");
    const tdur = fam("opencode_lens_tool_duration_seconds", "summary", "Execution time of finished tool calls");
    if (!snapshot) {
      const topen = fam("opencode_lens_tool_calls_running", "gauge", "Tool calls not finished yet (pending or running, started in the last 30 minutes)");
      for (const r of this.db
        .prepare(
          `SELECT COALESCE(name,'?') name, COUNT(*) n FROM tools
        WHERE (status IS NULL OR status NOT IN ('completed','error')) AND COALESCE(ran, created) >= ? GROUP BY 1`,
        )
        .all(since)) {
        topen.push({ labels: { tool: r.name }, value: r.n });
      }
    }
    for (const r of rows(
      `SELECT COALESCE(name,'?') name, COALESCE(status,'?') status, COUNT(*) n, COALESCE(SUM(out_bytes),0) bytes,
        COALESCE(SUM(CASE WHEN ended IS NOT NULL AND COALESCE(ran, created) IS NOT NULL AND ended >= COALESCE(ran, created) THEN ended - COALESCE(ran, created) END),0) dsum,
        COALESCE(SUM(ended IS NOT NULL AND COALESCE(ran, created) IS NOT NULL AND ended >= COALESCE(ran, created)),0) dn
      FROM ${T} WHERE status IN ('completed','error') GROUP BY 1,2`,
      args,
    )) {
      tools.push({ labels: { tool: r.name, status: r.status }, value: r.n });
      outBytes.push({ labels: { tool: r.name, status: r.status }, value: r.bytes });
      tdur.push({ labels: { tool: r.name, status: r.status }, sum: r.dsum / 1000, count: r.dn });
    }
    fam("opencode_lens_commits_total", "counter", "git commit run by successful shell tool calls")
      .push({ labels: {}, value: rows(`SELECT COUNT(*) n FROM ${T} WHERE is_commit = 1 AND status = 'completed'`, args)[0].n });
    if (!scope) {
      fam("opencode_lens_prompts_total", "counter", "User prompts (primary sessions; subagent dispatch prompts excluded)")
        .push({ labels: {}, value: rows(`SELECT COUNT(*) n FROM prompts p JOIN sessions s ON s.id = p.session_id WHERE s.parent_id IS NULL`)[0].n });
      const runs = fam("opencode_lens_runs_total", "counter", "Runs (prompt to idle) of primary sessions by outcome; dropped once by the v3 schema migration, which removed wrongly derived runs");
      const rdur = fam("opencode_lens_run_duration_seconds", "summary", "Wall-clock time from prompt to idle");
      for (const r of rows(
        `SELECT COALESCE(r.outcome,'unknown') outcome, COUNT(*) n, COALESCE(SUM(CASE WHEN r.started IS NOT NULL THEN r.ended - r.started END),0) dsum,
        COALESCE(SUM(r.started IS NOT NULL),0) dn
      FROM runs r JOIN sessions s ON s.id = r.session_id WHERE s.parent_id IS NULL GROUP BY 1`,
      )) {
        runs.push({ labels: { outcome: r.outcome }, value: r.n });
        rdur.push({ labels: { outcome: r.outcome }, sum: r.dsum / 1000, count: r.dn });
      }
      const intr = fam("opencode_lens_runs_interrupted_total", "counter", "Interrupted runs of primary sessions by reason (only those seen live)");
      for (const r of rows(
        `SELECT r.reason, COUNT(*) n FROM runs r JOIN sessions s ON s.id = r.session_id
      WHERE s.parent_id IS NULL AND r.outcome = 'interrupted' AND r.reason IS NOT NULL GROUP BY 1 ORDER BY 1`,
      )) {
        intr.push({ labels: { reason: r.reason }, value: r.n });
      }
      const perms = fam("opencode_lens_permissions_total", "counter", "Answered permission prompts by action and reply");
      const pending = fam("opencode_lens_permissions_pending", "gauge", "Permission prompts waiting for an answer, by action");
      const pwait = fam("opencode_lens_permission_wait_seconds", "summary", "Time the agent waited for the user to answer a permission prompt");
      for (const r of rows(
        `SELECT COALESCE(action,'?') action, COALESCE(reply,'pending') reply, COUNT(*) n,
        COALESCE(SUM(CASE WHEN asked IS NOT NULL AND replied IS NOT NULL THEN replied - asked END),0) wsum,
        COALESCE(SUM(asked IS NOT NULL AND replied IS NOT NULL),0) wn FROM permissions GROUP BY 1,2`,
      )) {
        if (r.reply === "pending") pending.push({ labels: { action: r.action }, value: r.n });
        else perms.push({ labels: { action: r.action, reply: r.reply }, value: r.n });
        if (r.wn) pwait.push({ labels: { action: r.action, reply: r.reply }, sum: r.wsum / 1000, count: r.wn });
      }
      fam("opencode_lens_subagent_sessions_total", "counter", "Sessions started by a subagent")
        .push({ labels: {}, value: rows(`SELECT COUNT(*) n FROM sessions WHERE parent_id IS NOT NULL`)[0].n });
      const sig = fam("opencode_lens_signals_total", "counter", "Retries, failed runs, compactions");
      for (const r of rows(`SELECT type, COUNT(*) n FROM signals GROUP BY type`)) sig.push({ labels: { type: r.type }, value: r.n });
    }

    if (!snapshot) {
      const t = this.today();
      const today = fam("opencode_lens_today", "gauge", "Usage of the current budget day (from LENS_RESET_HOUR, default local midnight) by kind (tokens, cost_usd, steps)");
      const limit = fam("opencode_lens_daily_limit", "gauge", "Daily limit configured with LENS_LIMIT_* by kind");
      for (const [kind, k] of [["tokens", "tokens"], ["cost_usd", "cost"], ["steps", "steps"]]) {
        today.push({ labels: { kind }, value: t[k].used });
        if (t[k].limit != null) limit.push({ labels: { kind }, value: t[k].limit });
      }
      // what deleted rows counted (Store.deleteCompensated): a series whose rows are all gone stays, with it
      const byName = new Map(fams.filter((f) => f.type !== "gauge").map((f) => [f.name, f]));
      // each family's samples by labelKey, built once per call when an offset first needs it: the merge is linear
      const index = new Map();
      const samplesOf = (f) => {
        let m = index.get(f);
        if (!m) {
          m = new Map();
          for (const x of f.samples) {
            const k = labelKey(x.labels);
            if (!m.has(k)) m.set(k, x); // the first one, as a search in order would find
          }
          index.set(f, m);
        }
        return m;
      };
      for (const o of rows(`SELECT name, labels, value FROM counter_offsets`)) {
        const part = /_(sum|count)$/.exec(o.name);
        const f = byName.get(o.name)?.type === "counter" ? byName.get(o.name) : part && byName.get(o.name.slice(0, part.index))?.type === "summary" ? byName.get(o.name.slice(0, part.index)) : null;
        if (!f) continue; // a family the lens no longer has
        const known = samplesOf(f);
        let smp = known.get(o.labels);
        if (!smp) {
          smp = f.type === "summary" ? { labels: Object.fromEntries(JSON.parse(o.labels)), sum: 0, count: 0 } : { labels: Object.fromEntries(JSON.parse(o.labels)), value: 0 };
          f.samples.push(smp);
          known.set(o.labels, smp);
        }
        if (f.type === "counter") smp.value += o.value;
        else smp[part[1]] += o.value;
      }
    }
    return [...fams, ...extra].filter((f) => f.samples.length);
  }

  /** Prometheus text exposition, with LENS_LABELS on every series. */
  metrics(collector, now = Date.now(), extra = []) {
    const out = [];
    const esc = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const lbl = (o) => {
      const all = { ...this.labels, ...o };
      const keys = Object.keys(all);
      return keys.length ? "{" + keys.map((k) => `${k}="${esc(all[k])}"`).join(",") + "}" : "";
    };
    for (const f of this.families(collector, now, extra)) {
      out.push(`# HELP ${f.name} ${f.help}`, `# TYPE ${f.name} ${f.type}`);
      for (const smp of f.samples) {
        if (f.type === "summary") out.push(`${f.name}_sum${lbl(smp.labels)} ${smp.sum}`, `${f.name}_count${lbl(smp.labels)} ${smp.count}`);
        else out.push(`${f.name}${lbl(smp.labels)} ${smp.value}`);
      }
    }
    return out.join("\n") + "\n";
  }
}

/** The HTTP status that errorFields() appends to a message as " (HTTP n)", or null. */
export function httpStatus(msg) {
  const m = /\(HTTP (\d{3})\)$/.exec(msg ?? "");
  return m ? Number(m[1]) : null;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
