// The «Vibe Coding» page's data, read through ctx.reader with the core's SQL fragments (ctx.sql), period helpers
// (ctx.time), token split (ctx.tokensOf) and monthly budget (ctx.budgets). Same answer as the vibeCoding the core
// had before the module (test/vibe-queries.expected.json).

// Between two events of a session, a pause of this length or more is not work
export const WORK_GAP_MS = 30 * 60_000;
const TOP_SESSIONS = 10;

/** The SQL day of a step's time for `reset` (the budget day: LENS_RESET_HOUR, local or UTC). */
const dayOfSql = (ctx, reset) => `date(${ctx.sql.TS} / 1000, 'unixepoch'${reset.utc ? "" : ", 'localtime'"}, '-${reset.hour} hours')`;

/**
 * Working time: per tree of sessions (a session and its subagents, at any depth), the union of its steps (each
 * from its start to its end, at most WORK_GAP_MS) and its prompts (a point), where a gap below WORK_GAP_MS between
 * two pieces is bridged. A subagent running next to its parent adds nothing, so the total is never longer than the
 * time that really went by. The time is credited to the session whose event extends the covered span, so the
 * per-session times add up to the total. Only the sessions of `sessions` (those with a step in the period) take part.
 * With `dayOf(ts) -> { key, end }` (the day containing ts and where it ends), every credited interval is also
 * split on the day boundaries into session.workingByDay (day -> ms), which adds back up to workingMs.
 */
function attributeWork(ctx, sessions, from, to, dayOf = null) {
  const { TS, STEP_START } = ctx.sql;
  const parents = new Map(ctx.reader.all("SELECT id, parent_id parent FROM sessions").map((r) => [r.id, r.parent]));
  const rootOf = (id) => {
    const seen = new Set([id]);
    let cur = id;
    // a missing parent ends the climb; so does a cycle in bad data
    for (let p = parents.get(cur); p != null && parents.has(p) && !seen.has(p); p = parents.get(cur)) {
      seen.add(p);
      cur = p;
    }
    return cur;
  };
  const events = ctx.reader.all(
    `SELECT session_id, s, e FROM (
      SELECT session_id, ${STEP_START} s, ended e FROM steps WHERE ${TS} >= ? AND ${TS} < ?
      UNION ALL SELECT session_id, created, created FROM prompts WHERE created >= ? AND created < ?)`,
    from,
    to,
    from,
    to,
  );
  const trees = new Map();
  for (const ev of events) {
    if (!sessions.has(ev.session_id)) continue;
    const end = ev.e != null && ev.e > ev.s ? Math.min(ev.e, ev.s + WORK_GAP_MS) : ev.s;
    if (end < from) continue; // nothing of it is inside the period
    const piece = { id: ev.session_id, s: Math.max(ev.s, from), e: Math.min(end, to) };
    piece.e = Math.max(piece.e, piece.s);
    const root = rootOf(ev.session_id);
    (trees.get(root) ?? trees.set(root, []).get(root)).push(piece);
  }
  const credit = (session, a, b) => {
    session.workingMs += b - a;
    if (!dayOf) return;
    session.workingByDay ??= new Map();
    while (a < b) {
      const { key, end } = dayOf(a);
      const cut = Math.min(b, end);
      session.workingByDay.set(key, (session.workingByDay.get(key) ?? 0) + (cut - a));
      a = cut;
    }
  };
  for (const pieces of trees.values()) {
    pieces.sort((a, b) => a.s - b.s || a.e - b.e);
    let covered = -Infinity;
    for (const { id, s, e } of pieces) {
      const session = sessions.get(id);
      if (s > covered) {
        if (s - covered < WORK_GAP_MS) credit(session, covered, s);
        credit(session, s, e);
        covered = e;
      } else if (e > covered) {
        credit(session, covered, e);
        covered = e;
      }
    }
  }
}

/** Cost, tokens, distinct sessions and working time of the steps in [from, to): the totals of vibeCoding, without the breakdowns. */
function totals(ctx, from, to) {
  const { ST_TS, ST_TOKENS } = ctx.sql;
  const rows = ctx.reader.all(
    `SELECT st.session_id id, COALESCE(SUM(st.cost), 0) cost,
      COALESCE(SUM(${ST_TOKENS}), 0) tokens
    FROM steps st
    WHERE ${ST_TS} >= ? AND ${ST_TS} < ? GROUP BY st.session_id`,
    from,
    to,
  );
  const bySession = new Map(rows.map((r) => [r.id, { ...r, workingMs: 0 }]));
  attributeWork(ctx, bySession, from, to);
  let cost = 0;
  let tokens = 0;
  let workingMs = 0;
  for (const s of bySession.values()) {
    cost += s.cost;
    tokens += s.tokens;
    workingMs += s.workingMs;
  }
  return { cost, tokens, workingMs, sessions: bySession.size, ...periodEstimate(ctx, from, to) };
}

/**
 * Per folder and budget day (same key as byDay, for `reset`): cost, tokens and sessions of the steps, and the
 * working time split on the day boundaries by its own attributeWork pass (so the days of a folder add up to its
 * workingMs for the same range). The caller picks the range and reset.
 * @returns {Map<string, Map<string, {cost:number,tokens:number,workingMs:number,sessions:number}>>}
 */
export function folderDays(ctx, from, to, reset) {
  const { TS, ST_TS, FOLDER, TOKENS } = ctx.sql;
  const out = new Map();
  const cell = (directory, day) => {
    const days = out.get(directory) ?? out.set(directory, new Map()).get(directory);
    return days.get(day) ?? days.set(day, { cost: 0, tokens: 0, workingMs: 0, sessions: 0 }).get(day);
  };
  const rows = ctx.reader.all(
    `SELECT ${FOLDER} directory, ${dayOfSql(ctx, reset)} day,
      COUNT(DISTINCT session_id) sessions, COALESCE(SUM(cost), 0) cost, COALESCE(SUM(${TOKENS}), 0) tokens
    FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY directory, day`,
    from,
    to,
  );
  for (const r of rows) Object.assign(cell(r.directory, r.day), { sessions: r.sessions, cost: r.cost, tokens: r.tokens });
  const sessions = new Map(
    ctx.reader
      .all(
        `SELECT st.session_id id, COALESCE(s.directory, '?') directory FROM steps st LEFT JOIN sessions s ON s.id = st.session_id
        WHERE ${ST_TS} >= ? AND ${ST_TS} < ? GROUP BY st.session_id`,
        from,
        to,
      )
      .map((r) => [r.id, { directory: r.directory, workingMs: 0 }]),
  );
  attributeWork(ctx, sessions, from, to, ctx.time.budgetDayOf(reset));
  for (const s of sessions.values()) for (const [day, ms] of s.workingByDay ?? []) cell(s.directory, day).workingMs += ms;
  return out;
}

/** A folder's days, sorted, as [{ day, cost, tokens, workingMs, sessions }]. */
const dailyOf = (days) => [...(days ?? [])].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, v]) => ({ day, ...v }));

/**
 * Per folder, day (of `reset`, keyed like folderDays) and model key: the estimated cost of the steps in [from, to)
 * at ctx.prices (USD, null for a model without a price) and their tokens without a price. A query of its own:
 * grouping the other ones by model would count a session once per model. Grouped by the MODEL_KEY expression: in
 * GROUP BY a bare `model` is the steps column (the model name alone), not the alias. Empty with an empty price list.
 * @returns {Map<string, Map<string, Map<string, {estimated:number|null, unpriced:number}>>>}
 */
export function estimateRows(ctx, from, to, reset) {
  const out = new Map();
  if (ctx.prices.empty) return out;
  const { TS, FOLDER, MODEL_KEY } = ctx.sql;
  for (const r of ctx.reader.all(
    `SELECT ${FOLDER} directory, ${dayOfSql(ctx, reset)} day, ${MODEL_KEY} model, ${KIND_SUMS}
    FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY directory, day, ${MODEL_KEY}`,
    from,
    to,
  )) {
    const days = out.get(r.directory) ?? out.set(r.directory, new Map()).get(r.directory);
    const models = days.get(r.day) ?? days.set(r.day, new Map()).get(r.day);
    models.set(r.model, estimateCell(ctx, r));
  }
  return out;
}

const KIND_SUMS = "SUM(t_in) t_in, SUM(t_out) t_out, SUM(t_reason) t_reason, SUM(t_cread) t_cread, SUM(t_cwrite) t_cwrite";

/** A row of model key and token sums at ctx.prices: estimated null and every token unpriced for a model without a price. */
function estimateCell(ctx, r) {
  const kinds = ctx.tokensOf(r);
  const estimated = ctx.prices.estimate(r.model, kinds);
  return { estimated, unpriced: estimated === null ? kinds.total : 0 };
}

/** The estimate of the whole period [from, to), grouped by model only (no folder or day needed). */
function periodEstimate(ctx, from, to) {
  if (ctx.prices.empty) return sumCells(ctx, []);
  const { TS, MODEL_KEY } = ctx.sql;
  const rows = ctx.reader.all(`SELECT ${MODEL_KEY} model, ${KIND_SUMS} FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY ${MODEL_KEY}`, from, to);
  return sumCells(ctx, rows.map((r) => estimateCell(ctx, r)));
}

/** The model cells under a folder's days (or a single day's models), flattened. */
const cellsOf = (map) => [...(map?.values() ?? [])].flatMap((v) => (v instanceof Map ? cellsOf(v) : [v]));

/** A sum of cells: estimated is a number with a price list (a model without a price adds 0 there and its tokens to unpriced), null without. */
function sumCells(ctx, cells) {
  if (ctx.prices.empty) return { estimated: null, unpriced: 0 };
  let estimated = 0;
  let unpriced = 0;
  for (const c of cells) {
    estimated += c.estimated ?? 0;
    unpriced += c.unpriced;
  }
  return { estimated, unpriced };
}

/** One model's sum: estimated stays null for a model without a price, so it never reads as free. */
const modelSum = (ctx, model, cells) => {
  const sum = sumCells(ctx, cells);
  return ctx.prices.of(model) ? sum : { ...sum, estimated: null };
};

/** The cells of `model` under a folder's days. */
const modelCells = (days, model) => [...(days?.values() ?? [])].map((models) => models.get(model)).filter(Boolean);

/** A folder's days with the estimate of each day (`est`: that folder's days from estimateRows, same keys). */
export const pricedDaily = (ctx, days, est) => dailyOf(days).map((d) => ({ ...d, ...sumCells(ctx, cellsOf(est?.get(d.day))) }));

/**
 * What the period [from, to) cost in time and tokens, and where. Tokens and cost are those of the steps, without
 * internal tasks. The working time is an estimate (see attributeWork): the time covered by steps and prompts,
 * where a pause of WORK_GAP_MS or more is a break. The days follow the budget day (LENS_RESET_HOUR).
 */
export function vibeCoding(ctx, from, to, now = Date.now()) {
  const { TS, ST_TS, TOOL_TS, FOLDER, TOKENS, MODEL_KEY } = ctx.sql;
  const { periodBounds, localDay, DAY_MS, MIDNIGHT, reset } = ctx.time;
  const { tokensOf, reader } = ctx;
  const rows = reader.all(
    `SELECT st.session_id id, COUNT(*) steps, COALESCE(SUM(st.cost), 0) cost,
      COALESCE(SUM(st.t_in), 0) t_in, COALESCE(SUM(st.t_out), 0) t_out, COALESCE(SUM(st.t_reason), 0) t_reason,
      COALESCE(SUM(st.t_cread), 0) t_cread, COALESCE(SUM(st.t_cwrite), 0) t_cwrite,
      s.title, COALESCE(s.directory, '?') directory, s.parent_id parentID
    FROM steps st LEFT JOIN sessions s ON s.id = st.session_id
    WHERE ${ST_TS} >= ? AND ${ST_TS} < ? GROUP BY st.session_id`,
    from,
    to,
  );
  const bySession = new Map(rows.map((r) => [r.id, { ...r, workingMs: 0 }]));
  attributeWork(ctx, bySession, from, to);
  const days = folderDays(ctx, from, to, reset);
  const est = estimateRows(ctx, from, to, reset);
  const folderModels = new Map();
  for (const r of reader.all(
    `SELECT ${FOLDER} directory, ${MODEL_KEY} model, COALESCE(SUM(${TOKENS}), 0) tokens, COALESCE(SUM(cost), 0) cost
    FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY directory, ${MODEL_KEY} ORDER BY directory, tokens DESC, model`,
    from,
    to,
  )) {
    (folderModels.get(r.directory) ?? folderModels.set(r.directory, []).get(r.directory)).push({ model: r.model, tokens: r.tokens, cost: r.cost, ...modelSum(ctx, r.model, modelCells(est.get(r.directory), r.model)) });
  }

  const sum = (list, key) => list.reduce((a, r) => a + r[key], 0);
  const all = [...bySession.values()];
  const tokens = tokensOf({ t_in: sum(all, "t_in"), t_out: sum(all, "t_out"), t_reason: sum(all, "t_reason"), t_cread: sum(all, "t_cread"), t_cwrite: sum(all, "t_cwrite") });
  const count = (sql, ...args) => reader.get(sql, ...args).n;
  const span = reader.get(`SELECT MIN(${TS}) first, MAX(${TS}) last FROM steps WHERE ${TS} >= ? AND ${TS} < ?`, from, to);
  const byDay = reader.all(
    `SELECT ${dayOfSql(ctx, reset)} day, COUNT(DISTINCT session_id) sessions, COALESCE(SUM(${TOKENS}), 0) tokens
    FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY day ORDER BY day`,
    from,
    to,
  );

  const folders = new Map();
  for (const s of all) {
    const f = folders.get(s.directory) ?? folders.set(s.directory, { directory: s.directory, sessions: 0, tokens: 0, workingMs: 0, cost: 0, kinds: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }).get(s.directory);
    f.sessions++;
    const k = tokensOf(s);
    for (const key of Object.keys(f.kinds)) f.kinds[key] += k[key];
    f.tokens += k.total;
    f.workingMs += s.workingMs;
    f.cost += s.cost;
  }
  // the previous period, same length; nothing to compare when no step precedes `from` (all time)
  const hasEarlier = from > 0 && reader.get(`SELECT EXISTS(SELECT 1 FROM steps WHERE ${TS} < ?) e`, from).e === 1;
  const length = to - from;
  // the calendar month of `now` (local days, no reset hour), with the 14 days before today so a
  // month-end forecast has a recent window even in the first days of the month
  const bounds = periodBounds("month", now);
  const startOfToday = periodBounds("day", now).from;
  const monthStart = new Date(bounds.from);
  const monthFrom = Math.min(bounds.from, startOfToday - 14 * DAY_MS);
  const monthFolders = folderDays(ctx, monthFrom, now, MIDNIGHT);
  const monthEst = estimateRows(ctx, monthFrom, now, MIDNIGHT);
  return {
    from,
    to,
    gapMs: WORK_GAP_MS,
    pricing: { empty: ctx.prices.empty },
    previous: hasEarlier ? { from: from - length, to: from, ...totals(ctx, from - length, from) } : null,
    month: {
      start: localDay(bounds.from),
      days: new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate(),
      today: localDay(now),
      from: bounds.from,
      to: bounds.to,
      byDirectory: [...monthFolders].map(([directory, d]) => ({ directory, daily: pricedDaily(ctx, d, monthEst.get(directory)) })).sort((a, b) => (a.directory < b.directory ? -1 : 1)),
    },
    monthBudget: ctx.budgets.month(now),
    totals: {
      sessions: all.length,
      subagents: all.filter((s) => s.parentID != null).length,
      tokens,
      steps: sum(all, "steps"),
      // the user's prompts only: a subagent's dispatch prompt is not one (same rule as the KPI and /metrics)
      prompts: count(`SELECT COUNT(*) n FROM prompts p JOIN sessions s ON s.id = p.session_id WHERE s.parent_id IS NULL AND p.created >= ? AND p.created < ?`, from, to),
      tools: count(`SELECT COUNT(*) n FROM tools WHERE ${TOOL_TS} >= ? AND ${TOOL_TS} < ?`, from, to),
      cost: sum(all, "cost"),
      workingMs: sum(all, "workingMs"),
      activeDays: byDay.length,
      first: span.first,
      last: span.last,
      ...sumCells(ctx, cellsOf(est)),
    },
    byDirectory: [...folders.values()]
      .map((f) => ({
        ...f,
        share: tokens.total > 0 ? f.tokens / tokens.total : 0,
        ...sumCells(ctx, cellsOf(est.get(f.directory))),
        daily: pricedDaily(ctx, days.get(f.directory), est.get(f.directory)),
        models: folderModels.get(f.directory) ?? [],
      }))
      .sort((a, b) => b.tokens - a.tokens || (a.directory < b.directory ? -1 : 1)),
    byModel: reader
      .all(
        `SELECT ${MODEL_KEY} model, COUNT(DISTINCT session_id) sessions, COUNT(*) steps, COALESCE(SUM(${TOKENS}), 0) tokens
      FROM steps WHERE ${TS} >= ? AND ${TS} < ? GROUP BY ${MODEL_KEY} ORDER BY COALESCE(SUM(${TOKENS}), 0) DESC, model`,
        from,
        to,
      )
      .map((m) => ({ ...m, ...modelSum(ctx, m.model, [...est.values()].flatMap((d) => modelCells(d, m.model))) })),
    byDay,
    topSessions: all
      .sort((a, b) => tokensOf(b).total - tokensOf(a).total || (a.id < b.id ? -1 : 1))
      .slice(0, TOP_SESSIONS)
      .map((s) => ({ id: s.id, title: s.title, directory: s.directory, tokens: tokensOf(s).total, steps: s.steps, workingMs: s.workingMs })),
  };
}
