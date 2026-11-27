// Budget periods: the day (from the reset hour), the week and the month that contain a time. A leaf: it
// imports nothing, so the MCP process and the Impostazioni page can use it without the read side.

export const DAY_MS = 86_400_000;
export const MIDNIGHT = Object.freeze({ hour: 0, utc: false });

/**
 * Bounds of the period containing `now`. The day starts at the reset hour
 * (LENS_RESET_HOUR: local, or UTC); week (from Monday) and month (from the 1st)
 * stay on the local calendar.
 */
export function periodBounds(kind, now, reset = MIDNIGHT) {
  if (kind === "day" && reset.utc) {
    const d = new Date(now);
    let from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), reset.hour);
    if (from > now) from -= DAY_MS;
    return { from, to: from + DAY_MS };
  }
  if (kind === "day" && reset.hour) {
    // both bounds from calendar fields, never from a normalized start: when the reset
    // hour falls in the spring-forward gap, Date moves it to the instant of the jump
    const d = new Date(now);
    const at = (days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, reset.hour).getTime();
    const today = at(0);
    return today > now ? { from: at(-1), to: today } : { from: today, to: at(1) };
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (kind === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (kind === "month") start.setDate(1);
  const end = new Date(start);
  if (kind === "day") end.setDate(end.getDate() + 1);
  else if (kind === "week") end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);
  return { from: start.getTime(), to: end.getTime() };
}

const pad2 = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the local calendar day containing `ts`. */
export function localDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Day lookup for splitting time on budget days: the budget day (same key as the SQL byDay) containing a timestamp. */
export const budgetDayOf = (reset) => (ts) => {
  const { from, to } = periodBounds("day", ts, reset);
  return { key: reset.utc ? new Date(from).toISOString().slice(0, 10) : localDay(from), end: to };
};
