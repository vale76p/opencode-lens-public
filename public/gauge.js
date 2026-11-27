// Gauge widget data: which value a gauge can show and how to read it.
// Pure module, shared by the dashboard and the server-side validation.

import { t } from "./i18n.js";

const PERIODS = ["day", "week", "month"];
const METRICS = ["tokens", "cost", "steps"];

export const GAUGE_SOURCES = [...PERIODS.flatMap((p) => METRICS.map((m) => `budget-${p}-${m}`)), "budget-model", "cache", "failed-steps", "tool-errors"];

const PERIOD_NAMES = { day: t("del giorno"), week: t("della settimana"), month: t("del mese") };
const METRIC_NAMES = { tokens: "token", cost: t("costo"), steps: "step" };
/** Human name of each source: catalogue, ⚙ panel and the widget's automatic title. */
export const GAUGE_LABELS = {
  ...Object.fromEntries(PERIODS.flatMap((p) => METRICS.map((m) => [`budget-${p}-${m}`, t("Budget {period} · {metric}", { period: PERIOD_NAMES[p], metric: METRIC_NAMES[m] })]))),
  "budget-model": t("Budget giornaliero di un modello"),
  cache: t("Prompt da cache"),
  "failed-steps": t("Step falliti"),
  "tool-errors": t("Chiamate tool con errore"),
};

/** How full a budget is: from 80% «warning», from 100% «critical». The gauges and the bars of Impostazioni read it. */
export const budgetLevel = (ratio) => (ratio == null ? "none" : ratio >= 1 ? "critical" : ratio >= 0.8 ? "warning" : "good");
// error rates: under 5% fine, up to 15% worth a look, beyond that a problem
const errorLevel = (ratio) => (ratio == null ? "neutral" : ratio < 0.05 ? "good" : ratio <= 0.15 ? "warning" : "critical");
const share = (part, whole) => (Number.isFinite(part) && whole > 0 ? part / whole : null);

/**
 * The gauge value of `source`: a budget from /api/budget ({ budget }) or a rate
 * from /api/summary ({ summary }) of the widget's period. ratio null = nothing to show.
 * "budget-model" reads `model` among periods.day.models; missing = not (or no longer) configured.
 */
export function gaugeReading(source, { budget = null, summary = null, model = null } = {}) {
  if (source === "budget-model") {
    const p = budget?.periods?.day?.models?.find((x) => x.model === model);
    if (!p) return { kind: "budget", ratio: null, used: 0, limit: null, projectedRatio: null, unit: "tokens", level: "none", missing: true, seen: false };
    // never seen = probably a typo in LENS_MODEL_LIMITS: no colour that says "all fine"
    const seen = p.seen !== false;
    return { kind: "budget", ratio: p.ratio, used: p.used, limit: p.limit, projectedRatio: p.projectedRatio ?? null, unit: "tokens", level: seen ? budgetLevel(p.ratio) : "none", missing: false, seen };
  }
  const m = /^budget-(day|week|month)-(tokens|cost|steps)$/.exec(source ?? "");
  if (m) {
    const p = budget?.periods?.[m[1]]?.[m[2]];
    if (!p) return { kind: "budget", ratio: null, used: 0, limit: null, projectedRatio: null, unit: m[2], level: "none" };
    const ratio = p.limit ? (p.ratio ?? p.used / p.limit) : null;
    return { kind: "budget", ratio, used: p.used, limit: p.limit ?? null, projectedRatio: p.projectedRatio ?? null, unit: m[2], level: budgetLevel(ratio) };
  }
  const percent = (ratio, level) => ({ kind: "percent", ratio, used: 0, limit: null, projectedRatio: null, unit: null, level });
  if (source === "cache") return percent(Number.isFinite(summary?.cacheRate) ? summary.cacheRate : null, "neutral");
  if (source === "failed-steps") {
    const r = share(summary?.failedSteps, summary?.steps);
    return percent(r, errorLevel(r));
  }
  if (source === "tool-errors") {
    const r = share(summary?.tools?.errors, summary?.tools?.calls);
    return percent(r, errorLevel(r));
  }
  return percent(null, "neutral");
}
