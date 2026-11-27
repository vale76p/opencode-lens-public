// The projects' history (GET /api/vibe-coding/history): per project, its calendar days (local midnight, not the
// budget day) over a window of the last 11 months, stretched back to the oldest deadline project's start and never
// beyond 24 months; with the first day of activity in its folders and the day the kept data begins.
import { estimateRows, folderDays, pricedDaily } from "./vibe-queries.js";

const MONTHS = 11;
const MAX_MONTHS = 24;
/** Local midnight of "YYYY-MM-DD". */
const dayMs = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

/**
 * Folder days and estimates of [fromMs, now) at midnight. With `cache` (an object kept by the caller) the closed days
 * [fromMs, today) are read once and only today is read on each call; they are read again when today or fromMs moves,
 * or when the closed days' fingerprint does (count, latest time, cost and tokens of their steps, count of their
 * prompts): a late or rewritten step, pruning, a step whose time moved into today. Approximate with the cache: today
 * is a pass of its own, so a pause bridged across midnight (under WORK_GAP_MS) and the part of a step running across
 * it that falls before midnight are clipped at midnight; a session moved to another folder is seen only at a rebuild.
 */
function windowDays(ctx, fromMs, now, cache) {
  const { MIDNIGHT, periodBounds } = ctx.time;
  if (!cache) return { days: folderDays(ctx, fromMs, now, MIDNIGHT), est: estimateRows(ctx, fromMs, now, MIDNIGHT) };
  const today = periodBounds("day", now).from;
  const { TS, TOKENS } = ctx.sql;
  const mark = ctx.reader.get(
    `SELECT COUNT(*) n, MAX(${TS}) m, TOTAL(cost) c, TOTAL(${TOKENS}) t,
      (SELECT COUNT(*) FROM prompts WHERE created >= ? AND created < ?) p
    FROM steps WHERE ${TS} >= ? AND ${TS} < ?`,
    fromMs,
    today,
    fromMs,
    today,
  );
  const key = JSON.stringify([fromMs, today, mark]);
  if (cache.key !== key) Object.assign(cache, { key, days: folderDays(ctx, fromMs, today, MIDNIGHT), est: estimateRows(ctx, fromMs, today, MIDNIGHT), firstKey: null });
  const join = (closed, open) => {
    const out = new Map(closed);
    for (const [dir, d] of open) out.set(dir, new Map([...(closed.get(dir) ?? []), ...d]));
    return out;
  };
  return { days: join(cache.days, folderDays(ctx, today, now, MIDNIGHT)), est: join(cache.est, estimateRows(ctx, today, now, MIDNIGHT)), today };
}

/**
 * The first step time of each folder, Map(folder → ms). It scans every step: with `cache` the part before `today` is
 * read again only when windowDays rebuilt the closed days (it resets firstKey), the folders or the pruning
 * (`retained`) change, and only today's steps are read on each call. Approximate like windowDays: a step written
 * late before fromMs, or a session moved to another folder, is seen at the next rebuild.
 */
function firstSteps(ctx, folders, cache, today, retained) {
  const { TS, FOLDER } = ctx.sql;
  if (!folders.length) return new Map();
  const marks = folders.map(() => "?").join(", ");
  const read = (where, ...args) => ctx.reader.all(`SELECT ${FOLDER} d, MIN(${TS}) t FROM steps WHERE ${FOLDER} IN (${marks})${where} GROUP BY d`, ...folders, ...args);
  if (!cache) return new Map(read("").map((r) => [r.d, r.t]));
  const firstKey = JSON.stringify([cache.key, folders, retained]);
  if (cache.firstKey !== firstKey) Object.assign(cache, { firstKey, firsts: new Map(read(` AND ${TS} < ?`, today).map((r) => [r.d, r.t])) });
  const out = new Map(cache.firsts);
  for (const r of read(` AND ${TS} >= ?`, today)) if (!out.has(r.d)) out.set(r.d, r.t);
  return out;
}

/** The history of the projects of `doc` (the normalized vibe-projects document) as of `now`; `cache`: see windowDays. */
export function projectHistory(ctx, doc, now, cache = null) {
  const { localDay, periodBounds } = ctx.time;
  const month = new Date(periodBounds("month", now).from);
  const monthsBack = (k) => new Date(month.getFullYear(), month.getMonth() - k, 1).getTime();
  const starts = doc.projects.filter((p) => p.kind === "deadline" && p.start).map((p) => dayMs(p.start));
  const fromMs = Math.max(monthsBack(MAX_MONTHS), Math.min(monthsBack(MONTHS), ...starts));
  const from = localDay(fromMs);
  // steps before retention_until were pruned (epoch ms in meta; absent when nothing was)
  const retained = Number(ctx.reader.get("SELECT value FROM meta WHERE key = 'retention_until'")?.value) || 0;
  const dataFrom = retained ? [from, localDay(retained)].sort().at(-1) : from;
  // shortcut: every folder's days are computed and the projects' picked; filter by folder if the DB grows large
  const { days, est, today } = windowDays(ctx, fromMs, now, cache);
  const folders = [...new Set(doc.projects.flatMap((p) => p.folders))].sort();
  const firstOf = firstSteps(ctx, folders, cache, today, retained);
  return {
    from,
    pricing: { empty: ctx.prices.empty },
    projects: doc.projects.map((p) => {
      if (!p.folders.length) return { id: p.id, firstDay: null, dataFrom, daily: [] };
      const firsts = p.folders.map((f) => firstOf.get(f)).filter((t) => t != null);
      const first = firsts.length ? Math.min(...firsts) : null;
      const byDay = new Map();
      for (const f of new Set(p.folders)) {
        for (const d of pricedDaily(ctx, days.get(f), est.get(f))) {
          const sum = byDay.get(d.day);
          if (!sum) {
            byDay.set(d.day, d);
            continue;
          }
          for (const k of ["cost", "tokens", "workingMs", "sessions", "unpriced"]) sum[k] += d[k];
          // null without a price list, a number with one
          if (sum.estimated !== null) sum.estimated += d.estimated;
        }
      }
      return { id: p.id, firstDay: first == null ? null : localDay(first), dataFrom, daily: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)) };
    }),
  };
}
