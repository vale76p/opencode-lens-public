// What a live tick reads again (pure, no DOM: tested in Node). The server's tick names the kinds of
// change of its debounce window (src/server.js); a kind reads again only the endpoints its tables
// feed, and each endpoint at most once per PATH_MIN_MS, the reads it skips owed until then.

/** The read that drives the header and the banner: in every refresh, whatever the kinds. */
export const STATUS = "/api/status";

// every endpoint that reads steps, where the tokens, the cost and the step counts are
const STEPS = Object.freeze([
  "/api/budget",
  "/api/summary",
  "/api/daily",
  "/api/hourly",
  "/api/rhythm",
  "/api/calendar",
  "/api/timeseries",
  "/api/breakdown",
  "/api/activity",
  "/api/runs",
  "/api/runs/live",
  "/api/runs/summary",
  "/api/sessions",
]);

/**
 * Kind of change (store.changed in src/collector.js) → the endpoints whose data it can change.
 * `step` is a step started and `feed` mostly a step ended, with its tokens and cost: both reach
 * everything that reads steps. `usage` is the session totals and the internal tasks (titles,
 * summaries); `signal` the retries, interruptions and compactions, and the reason of a run.
 * `session`, `scan` and `sync` are not here: sessions are joined by nearly every query, and a scan
 * or a sync rewrites prompts and runs, so they read everything, as does a kind this version does not
 * know (a newer server).
 */
export const KIND_PATHS = Object.freeze({
  status: Object.freeze([]),
  step: STEPS,
  feed: STEPS,
  usage: Object.freeze(["/api/budget", "/api/summary", "/api/daily", "/api/hourly", "/api/rhythm", "/api/calendar", "/api/timeseries", "/api/activity", "/api/sessions"]),
  tool: Object.freeze(["/api/tools", "/api/summary", "/api/daily", "/api/activity", "/api/runs", "/api/runs/live", "/api/runs/summary"]),
  permission: Object.freeze(["/api/runs/live", "/api/activity"]),
  signal: Object.freeze(["/api/summary", "/api/daily", "/api/activity", "/api/runs", "/api/runs/live", "/api/runs/summary"]),
});

/**
 * The least time between two live reads of an endpoint: a busy session ticks every second or two,
 * and the totals of the day or of the hour do not need to be read that often. Not for the status,
 * nor for the reads that are not live (page load, a view shown, the 60 s refresh), which read all.
 */
export const PATH_MIN_MS = Object.freeze({
  "/api/runs/live": 5000,
  "/api/runs": 10_000,
  "/api/runs/summary": 10_000,
  "/api/budget": 15_000,
  "/api/summary": 15_000,
  "/api/breakdown": 15_000,
  "/api/tools": 15_000,
  "/api/timeseries": 15_000,
  "/api/activity": 15_000,
  "/api/sessions": 30_000,
  "/api/daily": 60_000,
  "/api/hourly": 60_000,
  "/api/rhythm": 60_000,
  "/api/calendar": 60_000,
});

/** A path's endpoint: `/api/runs?from=day&limit=5` → `/api/runs`. */
export const endpointOf = (path) => String(path).split("?")[0];

/** The kinds of a tick's data: a list of names, or null (= everything) for anything else, `{}` of an older server included. */
export function parseTick(data) {
  let kinds;
  try {
    kinds = JSON.parse(data)?.kinds;
  } catch {
    return null;
  }
  return Array.isArray(kinds) && kinds.length && kinds.every((k) => typeof k === "string") ? new Set(kinds) : null;
}

/** Two requests for a read as one: a set of kinds each, or null (everything), which wins; `undefined` = none yet. */
export function mergeKinds(a, b) {
  if (a === undefined) return b === null ? null : new Set(b);
  if (a === null || b === null) return null;
  return new Set([...a, ...b]);
}

/** The paths among `paths` the changes `kinds` can touch (all of them for null or a kind neither in KIND_PATHS nor known to `extra`, a module's kindPaths). */
export function touchedBy(paths, kinds, extra = () => undefined) {
  const of = (k) => (Object.hasOwn(KIND_PATHS, k) ? KIND_PATHS[k] : extra(k));
  if (kinds === null || [...kinds].some((k) => of(k) === undefined)) return [...paths];
  const hit = new Set([...kinds].flatMap(of));
  return paths.filter((p) => hit.has(endpointOf(p)));
}

const minMs = (path) => PATH_MIN_MS[endpointOf(path)] ?? 0;

/**
 * One read of a view's `paths`. `kinds` null is a full read: every path. Otherwise the paths the
 * kinds touch join `owed`, and the read takes the status, the paths with no data yet (`have` lacks
 * them: a new widget, a period that moved) or whose last read failed (`failed`), and the owed ones
 * whose PATH_MIN_MS has passed since `readAt`. Returns what to read, what stays owed and in how many
 * ms the first of those is due (null when nothing is).
 */
export function planRead(paths, { kinds = null, have = new Set(), failed = new Set(), owed = new Set(), readAt = new Map(), now = Date.now(), extra } = {}) {
  if (kinds === null) return { read: [...paths], owed: new Set(), wait: null };
  const inView = new Set(paths);
  const due = new Set([...owed].filter((p) => inView.has(p)));
  for (const p of touchedBy(paths, kinds, extra)) due.add(p);
  const sinceRead = (p) => now - (readAt.get(p) ?? Number.NEGATIVE_INFINITY);
  const read = paths.filter((p) => p === STATUS || !have.has(p) || failed.has(p) || (due.has(p) && sinceRead(p) >= minMs(p)));
  for (const p of read) due.delete(p);
  const wait = due.size ? Math.max(0, Math.min(...[...due].map((p) => minMs(p) - sinceRead(p)))) : null;
  return { read, owed: due, wait };
}
