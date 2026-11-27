// The numbers of the Vibe Coding page behind the summary strip: period series, change against the previous
// period, the six tiles and the end-of-month ring. Pure module (no DOM): the dashboard draws it, Node tests
// exercise it. Days are local calendar "YYYY-MM-DD" strings.
import { compact, delta, fmtDayMonth, money, nf, pct, t } from "/module-kit.js";
import { addDays, addMonths, atNoon, budgetStatus, deliveryForecast, exhaustionDay, forecastAll, isWeekend, localDay, monthlyOf, projectStart, spanDays, sumDaily, trend, windowDays } from "./vibe-forecast.js";

const HOUR_MS = 3_600_000;
const PACE_DAYS = 7;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Which cost the figures count: the estimate from the price list, or OpenCode's cost (spent) when the list is empty. */
export const costKey = (data) => (data.pricing && !data.pricing.empty ? "estimated" : "cost");

/** Tokens without a price over the month to today for these folders (not the window days before it the data also holds). */
const monthUnpriced = (month, folders) => sum([...sumDaily(month.byDirectory, folders)].filter(([day]) => day >= month.start && day <= month.today).map(([, d]) => d.unpriced));

/** «14 ott» in it-IT, with the year when it is not the year of `today` («15 dic 2025»). */
export const dayText = (day, today = localDay(Date.now())) => {
  const text = fmtDayMonth(atNoon(day).getTime());
  return day.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${day.slice(0, 4)}`;
};
/** The Monday of the week of `day`. */
const mondayOf = (day) => addDays(day, -((atNoon(day).getDay() + 6) % 7));
const isDeadline = (project) => project.kind === "deadline";
// a delivery forecast has no estimate when its days have none: an empty metric then, never the spent cost under its label
const NO_METRIC = { done: 0, projected: null, band: null, byDay: [], insufficient: true };
const metricOf = (fc, key) => fc[key] ?? NO_METRIC;

/**
 * A project's calendar days: its history (`history`, GET /api/vibe-coding/history) before today and today from the
 * month data, read every minute (the history is read once a day); without history, the days of the month data. The
 * estimate stays null, as the history has it, when the page or the history has no price list.
 */
function projectDays(data, history, project, today = data.month.today) {
  const h = history?.projects.find((p) => p.id === project.id) ?? null;
  const priced = costKey(data) === "estimated" && !(h && history.pricing?.empty);
  const live = [...sumDaily(data.month.byDirectory, project.folders)].map(([day, d]) => ({ day, ...d, estimated: priced ? d.estimated : null })).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (!h) return { h, daily: live };
  return { h, daily: [...h.daily.filter((d) => d.day < today), ...live.filter((d) => d.day === today)] };
}

/**
 * A deadline project's delivery forecast from its start, with that start, its tokens without a price from the start
 * to today (or to the delivery) and `dataFrom`, the day the kept data begin when that is after the start (else null).
 */
function deadlineOf(data, history, project, today = data.month.today) {
  const { h, daily } = projectDays(data, history, project, today);
  // no start, no activity and the delivery passed: the start is the delivery, so the project reads as closed
  const start = [projectStart(project, daily, today, h?.firstDay ?? null), project.due].sort()[0];
  const fc = deliveryForecast(daily, { start, due: project.due, today });
  const end = today < project.due ? today : project.due;
  // a day without an estimate leaves all its tokens out of it
  const unpriced = sum(daily.filter((d) => d.day >= start && d.day <= end).map((d) => (d.estimated == null ? (d.tokens ?? 0) : (d.unpriced ?? 0))));
  const dataFrom = h?.dataFrom && start < h.dataFrom ? h.dataFrom : null;
  return { h, daily, start, fc, unpriced, dataFrom };
}

/** A note that says the estimate leaves tokens out, so a missing price never reads as free. */
const incompleteNote = (note, incomplete) => (incomplete ? t("stima incompleta · {note}", { note }) : note);

/** The budget statuses as a badge: [tone, label]. One map for the board, the overview and the detail. */
export const STATUS = () => ({ over: ["err", t("budget superato")], warn: ["warn", t("vicino al limite")], ok: ["ok", t("entro il budget")] });

/** A cost with what it is: «12 $ stimati» (from the price list) or «12 $ spesi» (OpenCode's cost). */
export const costText = (value, basis) => (basis === "estimated" ? t("{cost} stimati", { cost: money(value) }) : t("{cost} spesi", { cost: money(value) }));

/** What stands next to a status or figure whose estimate leaves tokens out: with their count, or alone when it is 0. */
export const unpricedText = (n) => (n > 0 ? t("stima incompleta · {note}", { note: t("{tokens} token senza prezzo", { tokens: compact(n) }) }) : t("stima incompleta"));

/** A strip tile's note when its estimate leaves `missing` tokens out: that is what it says, the usual note goes in the hover (`title`). */
const gapNote = (note, missing) => (missing > 0 ? { note: unpricedText(missing), title: note } : { note });

/**
 * Cost, tokens and working time of every day of the period, days without activity as zero. `folders = null`
 * is every folder. The server resolves «da sempre» to the first step, so `from` is always a real time; days the
 * data holds outside the bounds widen them.
 */
export function periodSeries(data, folders = null) {
  const dirs = data.byDirectory ?? [];
  const daily = sumDaily(dirs, folders ?? dirs.map((d) => d.directory));
  const known = [...daily.keys()].sort();
  const first = [localDay(data.from), known[0]].filter(Boolean).sort()[0];
  const last = [localDay(Math.max(data.from, data.to - 1)), known.at(-1)].filter(Boolean).sort().at(-1);
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const pick = (key) => days.map((d) => daily.get(d)?.[key] ?? 0);
  return { days, cost: pick("cost"), estimated: pick("estimated"), unpriced: pick("unpriced"), tokens: pick("tokens"), workingMs: pick("workingMs") };
}

/** The budget status of a month-end cost: the forecast, or what is already spent when there is too little data to forecast. */
const costStatus = (cost, budget) => budgetStatus(cost.projected ?? cost.done, budget);

/**
 * Projection of the folders of the ongoing projects that have a budget, against the sum of those budgets, on
 * `key` (costKey). A deadline project's budget is a total for the whole project, not a monthly one: left out.
 */
function projectsRing(month, projects, key) {
  const budgeted = projects.filter((p) => p.budget > 0 && p.kind !== "deadline");
  if (!budgeted.length) return null;
  const projected = sum(
    budgeted.map((p) => {
      const c = forecastAll(month, p.folders)[key];
      // without enough recent activity there is no forecast: what was spent is all there is to count
      return c.projected ?? c.done;
    }),
  );
  const limit = sum(budgeted.map((p) => p.budget));
  // the uncertainty of that same set of folders
  const folders = budgeted.flatMap((p) => p.folders);
  const band = forecastAll(month, folders)[key].band;
  return { label: t("Progetti a fine mese"), projected, limit, ratio: projected / limit, band, projects: true, folders };
}

/**
 * The tiles of the strip, in order: { key, value (a number or null), format ("money"|"compact"|"time"|"count"),
 * note, delta, kind ("area"|"mix"|"bars"|"ring"), series, days (the day of each
 * point of a series) }; money tiles also carry `basis` ("estimated"|"cost", what the figure is), `incomplete`
 * (tokens without a price left out of the estimate) and `unpriced` (those tokens). Without costs there is no cost
 * tile, the pace and the end of month are in tokens and there is no ring. With the core monthly budget
 * (`data.monthBudget`, on OpenCode's cost) the whole end-of-month tile is on what is spent, as Adesso shows it.
 * `doc` is the projects document (null when unreadable).
 */
export function heroFigures(data, doc, { costs }) {
  const { totals, previous, month } = data;
  const projects = doc?.projects ?? [];
  const series = periodSeries(data);
  const tok = totals.tokens;
  const activeDays = totals.activeDays || 0;
  const hours = totals.workingMs / HOUR_MS;

  // the pace looks at the 14 days before today, as the forecast does; the last 7 of them are the figure
  const all = sumDaily(month.byDirectory, month.byDirectory.map((d) => d.directory));
  const window = windowDays(month.today);
  const winOf = (key) => window.map((d) => all.get(d)?.[key] ?? 0);
  const perDay = (key) => sum(winOf(key).slice(-PACE_DAYS)) / PACE_DAYS;

  const key = costKey(data);
  const est = costs && key === "estimated";
  const mb = data.monthBudget;
  // the core monthly budget is on OpenCode's cost: the end-of-month tile stays on what is spent
  const monthKey = mb ? "cost" : key;
  const allFolders = month.byDirectory.map((d) => d.directory);
  const forecasts = forecastAll(month, allFolders);
  const metric = costs ? forecasts[monthKey] : forecasts.tokens;
  const fmt = costs ? money : compact;
  let ring = null;
  let projected = metric.projected;
  if (costs && mb) {
    ring = { label: t("Budget del mese"), projected: mb.projected ?? mb.used, limit: mb.limit, ratio: mb.limit > 0 ? (mb.projected ?? mb.used) / mb.limit : 0 };
    // Adesso shows this very number for the same limit: the strip must not give another «fine mese»
    projected = ring.projected;
  } else if (costs) {
    ring = projectsRing(month, projects, key);
    // the ring covers the projects with a budget: the tile says the same, not the all-folders forecast
    if (ring) projected = ring.projected;
  }
  const bandValue = ring?.projects ? ring.band : metric.band;
  const band = bandValue == null ? null : fmt(bandValue);
  let monthNote;
  if (metric.insufficient && !ring) monthNote = t("dati insufficienti");
  else if (costs && mb) monthNote = t("speso · ± {band} · budget {limit}", { band: band ?? "–", limit: money(ring.limit) });
  // the limit is in the ring and its hover: the note stays short
  else if (ring?.projects) monthNote = t("progetti con budget · ± {band}", { band: band ?? "–" });
  else monthNote = t("± {band}", { band: band ?? "–" });
  const monthEst = est && !mb;
  const monthMissing = monthEst ? monthUnpriced(month, ring?.folders ?? allFolders) : 0;

  const tiles = [];
  if (costs) {
    const value = totals[key];
    const perHour = t("{cost} / ora di lavoro", { cost: hours > 0 ? money(value / hours) : "–" });
    const missing = est ? totals.unpriced : 0;
    // one short note: the rate per hour, or what the estimate leaves out (the rate then in the hover); what was spent
    // stands smaller next to the estimate (`spent`)
    tiles.push({ key: "cost", value, format: "money", basis: key, spent: est ? totals.cost : null, incomplete: missing > 0, unpriced: missing, ...gapNote(perHour, missing), delta: delta(value, previous?.[key]), kind: "area", series: series[key], days: series.days });
  }
  const paceMissing = est ? sum(winOf("unpriced").slice(-PACE_DAYS)) : 0;
  tiles.push(
    {
      key: "tokens",
      value: tok.total,
      format: "compact",
      note: t("cache {share} · {tokens} / sessione", { share: pct(tok.total > 0 ? tok.cacheRead / tok.total : 0), tokens: compact(totals.sessions > 0 ? tok.total / totals.sessions : 0) }),
      delta: delta(tok.total, previous?.tokens),
      kind: "mix",
      series: { cacheRead: tok.cacheRead, input: tok.input, cacheWrite: tok.cacheWrite, output: tok.output, reasoning: tok.reasoning },
    },
    {
      key: "working",
      value: totals.workingMs,
      format: "time",
      note: t("{hours} h/giorno · {n} giorni attivi", { hours: nf(1).format(activeDays > 0 ? hours / activeDays : 0), n: activeDays }),
      delta: delta(totals.workingMs, previous?.workingMs),
      kind: "bars",
      series: series.workingMs,
      days: series.days,
    },
    {
      key: "sessions",
      value: totals.sessions,
      format: "count",
      note: t("di cui subagenti {sub} · {prompts} prompt", { sub: totals.subagents, prompts: totals.prompts }),
      delta: null,
      kind: "bars",
      series: data.byDay.map((d) => d.tokens),
      days: data.byDay.map((d) => d.day),
    },
    costs
      ? { key: "pace", value: perDay(key), format: "money", basis: key, incomplete: paceMissing > 0, unpriced: paceMissing, ...gapNote(t("{tokens} token/giorno", { tokens: compact(perDay("tokens")) }), paceMissing), delta: null, kind: "area", series: winOf(key), days: window }
      : { key: "pace", value: perDay("tokens"), format: "compact", note: t("ultimi 7 giorni"), delta: null, kind: "area", series: winOf("tokens"), days: window },
    costs
      ? { key: "month", value: projected ?? null, format: "money", basis: monthKey, incomplete: monthMissing > 0, unpriced: monthMissing, ...gapNote(monthNote, monthMissing), delta: null, kind: "ring", series: [], days: [] }
      : { key: "month", value: projected ?? null, format: "compact", note: monthNote, delta: null, kind: "ring", series: [], days: [] },
  );
  const endOfMonth = { projected: metric.projected, band: metric.band, insufficient: metric.insufficient, status: ring ? budgetStatus(ring.projected, ring.limit) : null, incomplete: monthMissing > 0 };
  return { tiles, ring, endOfMonth };
}

/**
 * The columns of the project board: «Senza progetto» (the folders active in the period that no project holds,
 * «?» included) and one per project in document order. A folder a project holds shows up there even without
 * activity, at zero. Each folder carries its token series over the period days; each project its month-end
 * forecast of the cost costKey picks (the estimate, or what is spent with an empty price list), its budget status
 * and `incomplete` (the estimate behind that status leaves out `statusUnpriced` tokens without a price; `unpriced` is
 * the period's count, like the other sums). A deadline project's `forecast` is the one at delivery (from `history`,
 * else from the month data) against its total budget, its `statusUnpriced` counts from its start to today and its
 * `dataFrom` says the data kept begin after the start; an ongoing project's counts the month, as its status does.
 * `doc` is the projects document (null when unreadable: all unassigned).
 */
export function boardColumns(data, doc, history = null) {
  const key = costKey(data);
  const byDir = new Map((data.byDirectory ?? []).map((d) => [d.directory, d]));
  const days = periodSeries(data).days.length;
  const folder = (directory) => {
    const d = byDir.get(directory);
    const series = days ? periodSeries(data, [directory]).tokens : [];
    return { directory, sessions: d?.sessions ?? 0, tokens: d?.tokens ?? 0, cost: d?.cost ?? 0, estimated: d?.estimated ?? 0, unpriced: d?.unpriced ?? 0, workingMs: d?.workingMs ?? 0, series };
  };
  const projects = doc?.projects ?? [];
  const held = new Set(projects.flatMap((p) => p.folders));
  const loose = [...byDir.keys()].filter((dir) => !held.has(dir)).map(folder);
  return {
    unassigned: { folders: loose, cost: sum(loose.map((f) => f.cost)), estimated: sum(loose.map((f) => f.estimated)), unpriced: sum(loose.map((f) => f.unpriced)) },
    projects: projects.map((project) => {
      const folders = project.folders.map(folder);
      const dl = isDeadline(project) ? deadlineOf(data, history, project) : null;
      const forecast = dl ? metricOf(dl.fc, key) : forecastAll(data.month, project.folders)[key];
      const statusUnpriced = key !== "estimated" ? 0 : dl ? dl.unpriced : monthUnpriced(data.month, project.folders);
      return {
        project,
        folders,
        sessions: sum(folders.map((f) => f.sessions)),
        tokens: sum(folders.map((f) => f.tokens)),
        cost: sum(folders.map((f) => f.cost)),
        estimated: sum(folders.map((f) => f.estimated)),
        unpriced: sum(folders.map((f) => f.unpriced)),
        workingMs: sum(folders.map((f) => f.workingMs)),
        forecast,
        status: costStatus(forecast, project.budget),
        statusUnpriced,
        incomplete: statusUnpriced > 0,
        dataFrom: dl?.dataFrom ?? null,
      };
    }),
  };
}

const DAY_MS = 86_400_000;
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const daysInMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

/** A row of the deadline table: to date, at delivery, against `budget` (null on rows the budget is not about). */
const lifeRow = (key, m, budget) => ({ key, done: m.done, atDelivery: m.projected, budget, deviation: budget && m.projected != null ? m.projected / budget - 1 : null });

/** What a deadline project shows over its life, start → due: the strip, the cumulative chart, the weeks and the table. */
function deadlineLife(dl, project, { costs, key, today }) {
  const { fc, start } = dl;
  const budget = costs ? (project.budget ?? null) : null;
  const m = costs ? metricOf(fc, key) : fc.tokens;
  const span = spanDays(start, project.due);
  const elapsed = span.filter((d) => d <= today).length;
  const workingMs = fc.workingMs.done;
  const unpriced = costs && key === "estimated" ? dl.unpriced : 0;
  const life = {
    basis: costs ? key : "tokens",
    start,
    due: project.due,
    done: m.done,
    spent: costs ? fc.cost.done : null,
    atDelivery: m.projected,
    band: m.band,
    workingMs,
    workingAtDelivery: fc.workingMs.projected,
    activeDays: dl.daily.filter((d) => d.day >= start && d.day <= project.due && d.day <= today && d.workingMs > 0).length,
    perHour: workingMs > 0 ? m.done / (workingMs / HOUR_MS) : null,
    budget,
    budgetShare: costs && budget ? m.done / budget : null,
    timeShare: span.length ? elapsed / span.length : 0,
    daysLeft: span.length - elapsed,
    closed: fc.closed,
    notStarted: fc.notStarted,
    after: costs ? fc.after : { workingMs: fc.after.workingMs, estimated: null, cost: null },
    // the history begins after the start: the total from the start is partial («dati dal …»)
    dataFrom: dl.dataFrom,
    unpriced,
    incomplete: unpriced > 0,
  };
  // the cumulative of `basis` (done, then forecast) with what is spent next to it up to today
  const spentOf = new Map(fc.cost.byDay.map((x) => [x.day, x.value]));
  let total = 0;
  let spent = 0;
  const cumulative = m.byDay.map((x) => {
    total += x.counted;
    if (!x.projected) spent += spentOf.get(x.day) ?? 0;
    return { day: x.day, value: total, spent: costs && !x.projected ? spent : null, projected: x.projected };
  });
  // working time by week (Monday first); `projected`: the week still has days to come
  const weekly = [];
  for (const x of fc.workingMs.byDay) {
    const week = mondayOf(x.day);
    const last = weekly.at(-1);
    if (last?.week === week) {
      last.workingMs += x.counted;
      last.projected ||= x.projected;
    } else weekly.push({ week, workingMs: x.counted, projected: x.projected });
  }
  const moneyRows = costs ? [...(key === "estimated" ? [lifeRow("estimated", metricOf(fc, "estimated"), budget)] : []), lifeRow("cost", fc.cost, key === "cost" ? budget : null)] : [];
  const table = [...moneyRows, lifeRow("working", fc.workingMs, null), lifeRow("tokens", fc.tokens, null)];
  return { life, cumulative, weekly, table };
}

/**
 * What an ongoing project shows over the last 12 months: the months (the current one last), the mean month and week
 * of the complete ones (with the tokens without a price they leave out) and the trend, on the figure's basis, with
 * `trendUnpriced`, the tokens without a price of the six months it compares.
 */
function ongoingLife(dl, { costs, key, today }) {
  const { h, daily } = dl;
  const cur = today.slice(0, 7);
  const by = new Map(monthlyOf(daily).map((m) => [m.month, m]));
  const months = Array.from({ length: 12 }, (_, i) => addMonths(cur, i - 11)).map((month) => by.get(month) ?? { month, estimated: key === "estimated" ? 0 : null, cost: 0, unpriced: 0, workingMs: 0, tokens: 0 });
  // a month counts when the data cover it whole: from its 1st, after the first activity and the start of the data kept
  const first = h?.firstDay ?? daily.find((d) => d.workingMs || d.tokens)?.day;
  const since = [first, h?.dataFrom].filter(Boolean).sort().at(-1);
  const complete = since ? months.slice(0, -1).filter((m) => `${m.month}-01` >= since) : [];
  const valueKey = costs ? key : "tokens";
  const totalOf = (k) => sum(complete.map((m) => m[k] ?? 0));
  const weeks = sum(complete.map((m) => daysInMonth(m.month))) / 7;
  const n = complete.length;
  const unpriced = costs && key === "estimated" ? totalOf("unpriced") : 0;
  const gap = { unpriced, incomplete: unpriced > 0 };
  return {
    months,
    avgMonth: n ? { value: totalOf(valueKey) / n, workingMs: totalOf("workingMs") / n, months: n, ...gap } : null,
    avgWeek: n ? { value: totalOf(valueKey) / weeks, workingMs: totalOf("workingMs") / weeks, ...gap } : null,
    trend: trend(monthlyOf(daily), today, valueKey),
    // the tokens without a price in the six months the trend compares
    trendUnpriced: costs && key === "estimated" ? sum([-6, -5, -4, -3, -2, -1].map((n) => by.get(addMonths(cur, n))?.unpriced ?? 0)) : 0,
  };
}

/**
 * Everything the detail of a project shows: `{ project, kind, empty, kpis, hours, cost, table, folders, models,
 * status, exhaustion }` plus, for a deadline project, `life`, `cumulative`, `weekly` (start → due, from `history`)
 * and, for an ongoing one, `months`, `avgMonth`, `avgWeek`, `trend`; null when `id` is not a project of `doc`.
 * The indicators, folder and model shares are over the chosen period (the «al giorno» notes divide by its days), the
 * month charts over the calendar month. Money figures, status, margin and exhaustion are on costKey; status, margin
 * and exhaustion are on the month end for an ongoing project, on the delivery for a deadline one; `incomplete` says the
 * estimate behind them leaves out `statusUnpriced` tokens without a price (the cost and margin indicators carry
 * their own `incomplete`/`unpriced`). `today` (default the data's) moves every figure. `table` is the
 * month-end forecast for an ongoing project, the to date / at delivery / budget / deviation table for a deadline one.
 * kpis: { key, value (number, a day for the alert margin, or null), format ("money"|"compact"|"time"|"day"), note,
 * alert }. Without costs there is no `cost` or `margin` indicator and no money row. `labels` (Map: folder → name) is optional.
 */
export function detailFigures(data, doc, id, { costs, labels = null, history = null, today = data.month.today }) {
  const project = doc?.projects.find((p) => p.id === id) ?? null;
  if (!project) return null;
  const kind = isDeadline(project) ? "deadline" : "ongoing";
  const none = { project, kind, empty: true, kpis: [], hours: null, cost: null, table: [], folders: [], models: [], status: null, statusUnpriced: 0, incomplete: false, exhaustion: null };
  if (!project.folders.length) return none;

  const key = costKey(data);
  const wanted = new Set(project.folders);
  const dirs = (data.byDirectory ?? []).filter((d) => wanted.has(d.directory));
  const total = (k) => sum(dirs.map((d) => d[k] ?? 0));
  const cost = total(key);
  const tokens = total("tokens");
  const workingMs = total("workingMs");
  const sessions = total("sessions");
  const hours = workingMs / HOUR_MS;
  const activeDays = [...sumDaily(dirs, project.folders).values()].filter((d) => d.workingMs > 0).length;
  const periodDays = Math.max(1, Math.round((data.to - data.from) / DAY_MS));

  const month = { ...data.month, today };
  const fc = forecastAll(month, project.folders);
  const dl = kind === "deadline" ? deadlineOf(data, history, project, today) : null;
  // the figure the budget is judged on: the month end, or the delivery
  const judged = dl ? metricOf(dl.fc, key) : fc[key];
  const budget = project.budget;
  const exhaustion = costs && budget ? exhaustionDay(judged.byDay, budget) : null;
  const status = costs ? costStatus(judged, budget) : null;
  const priced = costs && key === "estimated";
  const statusUnpriced = !priced ? 0 : dl ? dl.unpriced : monthUnpriced(month, project.folders);
  const statusNote = (note) => incompleteNote(note, statusUnpriced > 0);

  const kpis = [];
  if (costs) {
    const share = pct(data.totals[key] > 0 ? cost / data.totals[key] : 0);
    const note = key === "estimated" ? t("speso {spent} · {share} del totale", { spent: money(total("cost")), share }) : t("{share} del totale", { share });
    const unpriced = priced ? total("unpriced") : 0;
    kpis.push({ key: "cost", value: cost, format: "money", note: incompleteNote(note, unpriced > 0), alert: false, incomplete: unpriced > 0, unpriced });
  }
  kpis.push(
    { key: "tokens", value: tokens, format: "compact", note: t("{tokens} al giorno", { tokens: compact(tokens / periodDays) }), alert: false },
    { key: "working", value: workingMs, format: "time", note: t("{n} giorni attivi", { n: activeDays }), alert: false },
    costs
      ? { key: "perHour", value: hours > 0 ? cost / hours : null, format: "money", note: t("{tokens} token/ora", { tokens: compact(hours > 0 ? tokens / hours : 0) }), alert: false }
      : { key: "perHour", value: hours > 0 ? tokens / hours : null, format: "compact", note: t("token per ora di lavoro"), alert: false },
    {
      key: "perSession",
      value: sessions > 0 ? (costs ? cost : tokens) / sessions : null,
      format: costs ? "money" : "compact",
      note: t("{n} sessioni al giorno", { n: nf(1).format(sessions / periodDays) }),
      alert: false,
    },
  );
  if (costs) {
    const projected = judged.projected;
    // a budget already gone is an alert even when the forecast has too little data to say more
    const gone = budget && (projected === null ? judged.done > budget : projected > budget);
    const gap = { incomplete: statusUnpriced > 0, unpriced: statusUnpriced };
    if (!budget) kpis.push({ key: "margin", value: null, format: "money", note: t("imposta un budget"), alert: false, ...gap });
    else if (gone) kpis.push({ key: "margin", value: exhaustion, format: "day", note: statusNote(projected === null ? t("speso {spent} su {budget}", { spent: money(judged.done), budget: money(budget) }) : t("previsti {projected} su {budget}", { projected: money(projected), budget: money(budget) })), alert: true, ...gap });
    else if (projected === null) kpis.push({ key: "margin", value: null, format: "money", note: statusNote(t("dati insufficienti")), alert: false, ...gap });
    else kpis.push({ key: "margin", value: budget - projected, format: "money", note: statusNote(t("previsti {projected} su {budget}", { projected: money(projected), budget: money(budget) })), alert: false, ...gap });
  }

  // the weekday rate of the working-time forecast: the mean of the weekdays of the 14-day window
  const monthDaily = sumDaily(month.byDirectory, project.folders);
  const weekdayAvg = fc.workingMs.insufficient ? null : mean(windowDays(today).filter((d) => !isWeekend(d)).map((d) => monthDaily.get(d)?.workingMs ?? 0));

  const row = (k, m) => ({ key: k, done: m.done, projected: m.projected, more: m.projected === null ? null : m.projected - m.done });
  const moneyRows = costs ? [...(key === "estimated" ? [row("estimated", fc.estimated)] : []), row("cost", fc.cost)] : [];

  const shareKey = costs ? key : "tokens";
  const shareTotal = sum(project.folders.map((f) => dirs.find((d) => d.directory === f)?.[shareKey] ?? 0));
  const folders = project.folders.map((directory) => {
    const d = dirs.find((x) => x.directory === directory);
    const v = d?.[shareKey] ?? 0;
    return { directory, label: labels?.get(directory) ?? directory, cost: d?.cost ?? 0, estimated: d ? (d.estimated ?? null) : 0, share: shareTotal > 0 ? v / shareTotal : 0, sessions: d?.sessions ?? 0, workingMs: d?.workingMs ?? 0 };
  });

  // per model over the period: the estimate stays null for a model without a price
  const perModel = new Map();
  for (const d of dirs) {
    for (const m of d.models ?? []) {
      const acc = perModel.get(m.model) ?? { model: m.model, tokens: 0, estimated: null, cost: 0, unpriced: 0 };
      acc.tokens += m.tokens;
      acc.cost += m.cost ?? 0;
      acc.unpriced += m.unpriced ?? 0;
      if (m.estimated != null) acc.estimated = (acc.estimated ?? 0) + m.estimated;
      perModel.set(m.model, acc);
    }
  }
  const modelTotal = sum([...perModel.values()].map((m) => m.tokens));
  // how it is paid, derived: nothing spent for an estimate is a subscription; no price, no estimate
  const pay = (m) => (key !== "estimated" ? null : m.estimated === null ? "unpriced" : m.cost === 0 && m.estimated > 0 ? "subscription" : "metered");
  const models = [...perModel.values()].sort((a, b) => b.tokens - a.tokens).map((m) => ({ ...m, share: modelTotal > 0 ? m.tokens / modelTotal : 0, pay: pay(m) }));

  const base = {
    project,
    kind,
    empty: false,
    kpis,
    hours: { byDay: fc.workingMs.byDay, done: fc.workingMs.done, projected: fc.workingMs.projected, weekdayAvg },
    cost: { basis: key, byDay: fc[key].byDay, done: fc[key].done, projected: fc[key].projected, band: fc[key].band, budget: kind === "ongoing" ? budget : null },
    table: [...moneyRows, row("tokens", fc.tokens), row("working", fc.workingMs)],
    folders,
    models,
    status,
    statusUnpriced,
    incomplete: statusUnpriced > 0,
    exhaustion,
  };
  if (dl) return { ...base, ...deadlineLife(dl, project, { costs, key, today }) };
  return { ...base, ...ongoingLife(projectDays(data, history, project, today), { costs, key, today }) };
}

/**
 * The overview of all projects: `month` sums every project's folders over the calendar month to today (`estimated`
 * null without a price list; `projected`/`band` on `basis`, costKey or tokens without costs), with `budget` the sum
 * of the ongoing projects' monthly budgets (null without any); and `rows`, one per project in document order with
 * the closed ones last: an ongoing project counts the current month and is judged at month end, a deadline one counts
 * from its start (`history`) and is judged at delivery, as the board does. Without costs every dollar figure, budget,
 * status and count without a price is null (0 for the counts).
 */
export function overviewFigures(data, doc, history, { costs }) {
  const key = costKey(data);
  const basis = costs ? key : "tokens";
  const priced = costs && key === "estimated";
  const projects = doc?.projects ?? [];
  const folders = projects.flatMap((p) => p.folders);
  const mf = forecastAll(data.month, folders);
  const budgets = projects.filter((p) => !isDeadline(p) && p.budget > 0).map((p) => p.budget);
  const month = {
    basis,
    estimated: priced ? mf.estimated.done : null,
    cost: costs ? mf.cost.done : null,
    projected: mf[basis].projected,
    band: mf[basis].band,
    workingMs: mf.workingMs.done,
    workingProjected: mf.workingMs.projected,
    unpriced: priced ? monthUnpriced(data.month, folders) : 0,
    budget: costs && budgets.length ? sum(budgets) : null,
  };
  const judge = (project, fc, unpriced) => {
    const m = metricOf(fc, key);
    const budget = costs ? project.budget : null;
    return {
      workingMs: fc.workingMs.done,
      estimated: priced ? metricOf(fc, "estimated").done : null,
      cost: costs ? fc.cost.done : null,
      projected: (costs ? m : fc.tokens).projected,
      budget,
      status: costs ? costStatus(m, budget) : null,
      unpriced: priced ? unpriced : 0,
      incomplete: priced && unpriced > 0,
      exhaustion: costs && budget ? exhaustionDay(m.byDay, budget) : null,
    };
  };
  const rows = projects.map((project) => {
    if (!isDeadline(project)) {
      const fc = forecastAll(data.month, project.folders);
      return { project, kind: "ongoing", closed: false, notStarted: false, label: t("continuativo"), dataFrom: null, ...judge(project, fc, monthUnpriced(data.month, project.folders)) };
    }
    const dl = deadlineOf(data, history, project);
    const { closed, notStarted } = dl.fc;
    const label = closed ? t("chiuso il {day}", { day: dayText(project.due, data.month.today) }) : t("consegna il {day}", { day: dayText(project.due, data.month.today) });
    return { project, kind: "deadline", closed, notStarted, label, dataFrom: dl.dataFrom, ...judge(project, dl.fc, dl.unpriced) };
  });
  rows.sort((a, b) => Number(a.closed) - Number(b.closed));
  return { month, rows };
}
