// The usage periods of the tools, in budget days (LENS_RESET_HOUR).
import { periodBounds } from "../period.js";
import { ToolError } from "./errors.js";

export const RANGES = ["today", "yesterday", "7d", "30d", "month"];
const RANGE_LABEL = { today: "oggi", yesterday: "ieri", "7d": "negli ultimi 7 giorni", "30d": "negli ultimi 30 giorni", month: "nel mese" };

/**
 * A usage period in budget days (LENS_RESET_HOUR) and the one right before it, cut to the
 * same elapsed time, so that "today until 10:40" compares with "yesterday until 10:40".
 * `days`: budget days from the start of the period up to today, for /api/daily.
 */
export function ranges(name, now, reset) {
  const day = (t) => periodBounds("day", t, reset);
  const today = day(now);
  const back = (from, n) => {
    let f = from;
    for (let i = 0; i < n; i++) f = day(f - 1).from;
    return f;
  };
  let from;
  let to = now;
  let prevFrom;
  let days;
  if (name === "today") {
    from = today.from;
    prevFrom = back(from, 1);
    days = 1;
  } else if (name === "yesterday") {
    const y = day(today.from - 1);
    ({ from, to } = y);
    prevFrom = back(from, 1);
    days = 2;
  } else if (name === "7d" || name === "30d") {
    const n = name === "7d" ? 7 : 30;
    from = back(today.from, n - 1);
    prevFrom = back(from, n);
    days = n;
  } else if (name === "month") {
    from = periodBounds("month", now, reset).from;
    prevFrom = periodBounds("month", from - 1, reset).from;
    days = 1;
    for (let f = today.from; f > from; f = day(f - 1).from) days++;
  } else {
    throw new ToolError(`range deve essere uno tra ${RANGES.join(", ")}; trovato "${name}"`);
  }
  return { from, to, prev: { from: prevFrom, to: Math.min(from, prevFrom + (to - from)) }, days, label: RANGE_LABEL[name] };
}
