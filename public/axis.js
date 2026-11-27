// Pure axis helpers (no DOM): "nice" 1-2-5 ticks and unique tick labels.
import { getLocale } from "./i18n.js";
import { compact } from "./ui.js";

/**
 * Nice ticks from 0 to >= max. `count` is the number of ticks (so count - 1
 * intervals). With `integer` the step is a whole number >= 1.
 */
export function niceTicks(max, { count = 4, integer = false } = {}) {
  const m = Number.isFinite(max) && max > 0 ? max : 0;
  if (m === 0) return { max: 1, step: 1, ticks: [0, 1], decimals: 0 };
  const intervals = Math.max(1, count - 1);
  const raw = m / intervals;
  const base = 10 ** Math.floor(Math.log10(raw));
  const f = raw / base;
  // small epsilon so an exact 1/2/5 multiple is not bumped to the next step
  let step = (f <= 1 + 1e-9 ? 1 : f <= 2 + 1e-9 ? 2 : f <= 5 + 1e-9 ? 5 : 10) * base;
  if (integer) step = Math.max(1, Math.ceil(step));
  const decimals = integer || step >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(step) - 1e-9));
  const round = (v) => Number(v.toFixed(Math.min(10, decimals + 2)));
  const n = Math.ceil(m / step - 1e-9);
  const ticks = [];
  for (let i = 0; i <= n; i++) ticks.push(round(i * step));
  return { max: ticks.at(-1), step: round(step), ticks, decimals };
}

const fixed = (v, d) => new Intl.NumberFormat(getLocale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

export function tickLabel(v, metric, decimals) {
  if (metric === "cost") {
    // one number of decimals for every tick of the axis (not «0 $ · 50,00 $ · 100 $»): none for
    // whole steps, cents for steps under 1 $, more for fine steps (0,005 $) or labels would repeat
    const d = decimals > 0 ? Math.max(2, decimals) : 0;
    return new Intl.NumberFormat(getLocale(), { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }
  if (metric === "tokens") return compact(v);
  return fixed(v, metric === "steps" || metric === "count" ? 0 : decimals);
}

export function labelWidth(labels, charPx = 6.5) {
  const longest = labels.reduce((m, l) => Math.max(m, String(l).length), 0);
  return Math.max(28, Math.ceil(longest * charPx));
}
