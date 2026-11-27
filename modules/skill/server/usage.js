// The use of the skill library, read from the core's skill_uses through ctx.reader: the core's Queries.skillUsage
// (src/queries.js) with fixed SQL texts. The budget day's shift is a bound parameter; only whether the day is local
// or UTC picks between two texts.
const SKILL_DAY_KEYS = 91;

// rows of the period [from, to): lens-origin only, through the skill_uses_at index; the session's folder by its key
const PERIOD_SQL = (mod) => `SELECT date(u.at / 1000, 'unixepoch'${mod}, ?) day, u.channel, u.skill_id, u.preset_id, u.version, u.status, s.directory
        FROM skill_uses u LEFT JOIN sessions s ON s.id = u.session_id
        WHERE u.origin = 'lens' AND u.at >= ? AND u.at < ?`;
export const SQL = Object.freeze({
  periodLocal: PERIOD_SQL(", 'localtime'"),
  periodUtc: PERIOD_SQL(""),
  // the last completed load over the whole history, by skill or preset: every lens row (no index on origin), as the core reads it
  last: "SELECT skill_id, preset_id, MAX(at) at FROM skill_uses WHERE origin = 'lens' AND status = 'completed' GROUP BY 1, 2",
  opencodeSince: "SELECT MIN(created) m FROM sessions",
  lensSince: "SELECT value FROM meta WHERE key = 'skill_loads_since'",
});

/**
 * Use of the skill library in [from, to): lens-origin rows only (native loads stay out), skills restricted to `skills`
 * ids, preset rows resolved against `presets` by id or case-insensitive name (unresolved rows dropped). Only a
 * `completed` row is a load (an `error` one counts in `errors`); `days` counts the skill rows only (so the bars add up
 * to the skills' total) and `dayKeys` lists every budget day of the period for them. `last` is the last completed
 * load over the whole history.
 */
export function skillUsage(ctx, from, to, { skills = [], presets = [] } = {}) {
  const { reader } = ctx;
  const { reset, periodBounds, budgetDayOf } = ctx.time;
  const known = new Set(skills);
  const channels = () => ({ skill: 0, activated: 0, "lens-preset": 0, "lens-prompt": 0 });
  const byId = new Map();
  const byName = new Map();
  for (const p of presets) {
    byId.set(String(p.id).toLowerCase(), p.id);
    byName.set(String(p.name).toLowerCase(), p.id);
  }
  const resolve = (raw) => (raw == null ? null : (byId.get(String(raw).toLowerCase()) ?? byName.get(String(raw).toLowerCase()) ?? null));
  const num = (v) => (v == null || v === "" ? null : Number(v));
  const since = {
    opencode: reader.get(SQL.opencodeSince).m ?? null,
    lens: num(reader.get(SQL.lensSince)?.value),
  };
  const period = reader.all(reset.utc ? SQL.periodUtc : SQL.periodLocal, `-${reset.hour} hours`, from, to);
  const lastOf = new Map();
  const bump = (key, at) => lastOf.set(key, Math.max(lastOf.get(key) ?? 0, at));
  for (const r of reader.all(SQL.last)) {
    if (r.skill_id != null) bump(`s:${r.skill_id}`, r.at);
    else if (resolve(r.preset_id) != null) bump(`p:${resolve(r.preset_id)}`, r.at);
  }
  const days = new Map();
  const sk = new Map();
  const pr = new Map();
  for (const r of period) {
    let presetId = null;
    if (r.skill_id != null) {
      if (!known.has(r.skill_id)) continue;
    } else {
      presetId = resolve(r.preset_id);
      if (presetId == null) continue;
    }
    // one predicate everywhere (here, `last`, the metrics): only a completed row is a load
    const ok = r.status === "completed";
    // the days count skill rows only, as the hero's total does: a preset row is not a skill load
    if (ok && r.skill_id != null) {
      const d = days.get(r.day) ?? { day: r.day, n: 0, byChannel: channels() };
      d.n++;
      if (r.channel in d.byChannel) d.byChannel[r.channel]++;
      days.set(r.day, d);
    }
    if (presetId != null) {
      if (!ok) continue;
      const e = pr.get(presetId) ?? { id: presetId, n: 0, byChannel: channels(), last: lastOf.get(`p:${presetId}`) ?? null };
      e.n++;
      if (r.channel in e.byChannel) e.byChannel[r.channel]++;
      pr.set(presetId, e);
      continue;
    }
    const e = sk.get(r.skill_id) ?? { id: r.skill_id, n: 0, errors: 0, last: lastOf.get(`s:${r.skill_id}`) ?? null, byChannel: channels(), byPreset: {}, byVersion: {}, dirs: new Map(), dayN: new Map() };
    sk.set(r.skill_id, e);
    if (!ok) {
      if (r.status === "error") e.errors++;
      continue;
    }
    e.n++;
    e.dayN.set(r.day, (e.dayN.get(r.day) ?? 0) + 1);
    if (r.channel in e.byChannel) e.byChannel[r.channel]++;
    if (r.preset_id != null) e.byPreset[r.preset_id] = (e.byPreset[r.preset_id] ?? 0) + 1;
    if (r.version != null) e.byVersion[r.version] = (e.byVersion[r.version] ?? 0) + 1;
    if (r.directory) e.dirs.set(r.directory, (e.dirs.get(r.directory) ?? 0) + 1);
  }
  // every budget day overlapping [from, to), oldest first, at most SKILL_DAY_KEYS: walked by calendar day
  // (periodBounds), so a 23- or 25-hour day is neither skipped nor repeated; keys as the SQL `day` above
  const dayKeys = [];
  const keyOf = budgetDayOf(reset);
  for (let cur = periodBounds("day", Math.max(from, to - 1), reset); cur.to > from && dayKeys.length < SKILL_DAY_KEYS; cur = periodBounds("day", cur.from - 1, reset)) {
    dayKeys.unshift(keyOf(cur.from).key);
  }
  return {
    since,
    dayKeys,
    days: [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    skills: [...sk.values()]
      .map(({ dirs, dayN, ...e }) => ({ ...e, days: [...dayN].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, n]) => ({ day, n })), projects: [...dirs].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([directory, n]) => ({ directory, n })) }))
      .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1)),
    presets: [...pr.values()].sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1)),
  };
}
