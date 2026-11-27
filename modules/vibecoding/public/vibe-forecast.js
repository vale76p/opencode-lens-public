// Month-end forecast of cost, tokens and working time for a set of folders. Pure module (no DOM):
// the dashboard draws it, Node tests exercise it. Days are local calendar "YYYY-MM-DD" strings.
const WINDOW = 14;
const MIN_ACTIVE_DAYS = 3;
const WARN_RATIO = 0.85;
export const pad = (n) => String(n).padStart(2, "0");
// Noon local time keeps the date stable across daylight-saving changes.
export const atNoon = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
/** The local calendar day of an epoch-ms time, "YYYY-MM-DD". */
export const localDay = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function addDays(day, n) {
  const d = atNoon(day);
  d.setDate(d.getDate() + n);
  return localDay(d.getTime());
}

export function isWeekend(day) {
  const w = atNoon(day).getDay();
  return w === 0 || w === 6;
}

export const monthDays = (month) => Array.from({ length: month.days }, (_, i) => addDays(month.start, i));

/** The 14 days before today, today excluded. */
export const windowDays = (today) => Array.from({ length: WINDOW }, (_, i) => addDays(today, i - WINDOW));

/** Per-day totals of the given folders; a folder with no data counts as zero, and so does an estimate that is null (empty price list). */
export function sumDaily(byDirectory, folders) {
  const wanted = new Set(folders);
  const out = new Map();
  for (const dir of byDirectory) {
    if (!wanted.has(dir.directory)) continue;
    for (const d of dir.daily) {
      const acc = out.get(d.day) ?? { cost: 0, estimated: 0, unpriced: 0, tokens: 0, workingMs: 0, sessions: 0 };
      acc.cost += d.cost;
      acc.estimated += d.estimated ?? 0;
      acc.unpriced += d.unpriced ?? 0;
      acc.tokens += d.tokens;
      acc.workingMs += d.workingMs;
      acc.sessions += d.sessions;
      out.set(d.day, acc);
    }
  }
  return out;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

/** Forecast of one metric; `values` maps day to the metric, absent days count as zero. */
export function forecastMetric(values, { days, today, window }) {
  const val = (day) => values.get(day) ?? 0;
  const past = days.filter((d) => d <= today);
  const done = sum(past.map(val));
  const winValues = window.map(val);
  if (winValues.filter((v) => v > 0).length < MIN_ACTIVE_DAYS) {
    return {
      done,
      projected: null,
      band: null,
      byDay: past.map((day) => ({ day, value: val(day), counted: val(day), projected: false })),
      insufficient: true,
    };
  }
  const rates = {
    weekday: mean(window.filter((d) => !isWeekend(d)).map(val)),
    weekend: mean(window.filter(isWeekend).map(val)),
  };
  const rate = (day) => (isWeekend(day) ? rates.weekend : rates.weekday);
  // `value` is what happened (past, today) or the rate (future); `counted` is what the total uses:
  // today counts max(actual, rate), so the part of today not yet lived is not counted twice.
  const byDay = days.map((day) => {
    if (day < today) return { day, value: val(day), counted: val(day), projected: false };
    if (day === today) return { day, value: val(day), counted: Math.max(val(day), rate(day)), projected: false };
    return { day, value: rate(day), counted: rate(day), projected: true };
  });
  const projected = sum(byDay.map((x) => x.counted));
  const avg = mean(winValues);
  const std = Math.sqrt(mean(winValues.map((v) => (v - avg) ** 2)));
  const band = std * Math.sqrt(days.filter((d) => d >= today).length);
  return { done, projected, band, byDay, insufficient: false };
}

/** Cost (spent and estimated), tokens and working time forecasts for the folders of a project. */
export function forecastAll(month, folders) {
  const daily = sumDaily(month.byDirectory, folders);
  const days = monthDays(month);
  const window = windowDays(month.today);
  const one = (key) => {
    const values = new Map([...daily].map(([day, d]) => [day, d[key]]));
    return forecastMetric(values, { days, today: month.today, window });
  };
  return { cost: one("cost"), estimated: one("estimated"), tokens: one("tokens"), workingMs: one("workingMs") };
}

/** "over" above the budget, "warn" above 85% of it, "ok" otherwise; null without budget or forecast. */
export function budgetStatus(projected, budget) {
  if (projected == null || budget == null) return null;
  if (projected > budget) return "over";
  return projected > WARN_RATIO * budget ? "warn" : "ok";
}

/** First day on which the cumulative total passes the budget (also in the past), else null. */
export function exhaustionDay(byDay, budget) {
  if (budget == null || budget <= 0) return null;
  let total = 0;
  for (const { day, counted } of byDay) {
    total += counted;
    if (total > budget) return day;
  }
  return null;
}

/** Every day from start to due, both included. */
export function spanDays(start, due) {
  const out = [];
  for (let d = start; d <= due; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Start of a project: its own date, else the first step ever seen (server), else the first active day, else today. */
export function projectStart(project, daily, today, firstDay = null) {
  return project.start ?? firstDay ?? daily.find((d) => d.cost || d.tokens || d.workingMs || d.sessions)?.day ?? today;
}

/** Forecast to the delivery date of cost, estimate, tokens and working time; `after` is what happened past `due`. */
export function deliveryForecast(daily, { start, due, today }) {
  const days = spanDays(start, due);
  const closed = today > due && start <= due;
  // A start after the due date is a malformed span: treated as not started, never closed.
  const notStarted = today < start || start > due;
  // each part has an estimate only when its own days carry one: the span for the forecast, the days past due for `after`
  const hasEstimate = daily.some((d) => d.day >= start && d.day <= due && d.estimated != null);
  const afterEstimate = daily.some((d) => d.day > due && d.estimated != null);
  const window = windowDays(today).filter((d) => d >= start);
  const one = (key) => {
    const values = new Map(daily.filter((d) => d.day >= start && d.day <= due).map((d) => [d.day, d[key] ?? 0]));
    if (notStarted) return { done: 0, projected: 0, band: 0, byDay: [], insufficient: false };
    const r = forecastMetric(values, { days, today, window });
    // Past the due date the total is final: no forecast.
    return closed ? { ...r, projected: r.done, band: 0, insufficient: false } : r;
  };
  const afterSum = (key) => sum(daily.filter((d) => d.day > due).map((d) => d[key] ?? 0));
  return {
    cost: one("cost"),
    estimated: hasEstimate ? one("estimated") : null,
    tokens: one("tokens"),
    workingMs: one("workingMs"),
    closed,
    notStarted,
    after: { workingMs: afterSum("workingMs"), estimated: afterEstimate ? afterSum("estimated") : null, cost: afterSum("cost") },
  };
}

/** Daily rows grouped by calendar month; the estimate is null when no day of the month has one, `unpriced` the tokens it leaves out. */
export function monthlyOf(daily) {
  const by = new Map();
  for (const d of daily) {
    const month = d.day.slice(0, 7);
    const m = by.get(month) ?? { month, estimated: null, cost: 0, unpriced: 0, workingMs: 0, tokens: 0 };
    if (d.estimated != null) m.estimated = (m.estimated ?? 0) + d.estimated;
    m.cost += d.cost ?? 0;
    m.unpriced += d.unpriced ?? 0;
    m.workingMs += d.workingMs ?? 0;
    m.tokens += d.tokens ?? 0;
    by.set(month, m);
  }
  return [...by.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

export const addMonths = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** Last 3 calendar months against the 3 before, on `key` (default: the estimate, else cost); the month of today is left out, a month without data counts 0; null when the data start later than 6 months back or the base is 0. */
export function trend(monthly, today, key = null) {
  const cur = today.slice(0, 7);
  const first = monthly.find((m) => m.month < cur);
  if (!first || first.month > addMonths(cur, -6)) return null;
  const by = new Map(monthly.map((m) => [m.month, m]));
  const six = [-6, -5, -4, -3, -2, -1].map((n) => by.get(addMonths(cur, n)));
  const k = key ?? (six.some((m) => m && m.estimated == null) ? "cost" : "estimated");
  const total = (ms) => sum(ms.map((m) => m?.[k] ?? 0));
  const prev = total(six.slice(0, 3));
  return prev === 0 ? null : total(six.slice(3)) / prev - 1;
}
