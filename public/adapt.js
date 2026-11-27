// Pure adapters: API bodies -> the inputs the chart models draw from. No DOM, no fetch; the
// colour-slot lookup (`slotFor`) is passed in by the caller.
import { outcomeLabel, outcomeOf } from "./derive.js";
import { t, tn } from "./i18n.js";
import { clock, compact, dur, full, money, pct, quantile } from "./ui.js";

const HOUR_MS = 3_600_000;
const fin = (v) => (Number.isFinite(v) ? v : null);
const num = (v) => (Number.isFinite(v) ? v : 0);
const lastOf = (a) => a[a.length - 1];

/** «provider/model#variant» -> «model#variant»: the model name without the provider. */
export const modelLabel = (key) => {
  const s = String(key ?? "");
  const i = s.indexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
};
const baseModel = (key) => String(key ?? "").split("#")[0];

/** Today's tokens per hour up to the current hour (later hours are null) against the 7-day average. */
export function hoursInput(hourly, now) {
  const tokens = hourly?.tokens ?? [];
  const n = Math.max(1, hourly?.labels?.length ?? 24);
  const nowIdx = Math.min(n - 1, Math.max(0, Math.floor((now - (hourly?.from ?? now)) / HOUR_MS)));
  const labels = hourly?.labels ?? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  return {
    labels,
    today: labels.map((_, i) => (i <= nowIdx ? num(tokens[i]) : null)),
    avg: labels.map((_, i) => num(hourly?.avg?.[i])),
    nowIdx,
    soFarAvg: num(hourly?.soFarAvg),
  };
}

/** The name of the «altri» series of a grouping: what it holds («altri modelli», «altri agenti»…). */
const OTHERS = { model: t("altri modelli"), agent: t("altri agenti"), provider: t("altri provider"), kind: t("altri tipi di agente"), directory: t("altre cartelle") };
export const othersLabel = (by) => OTHERS[by] ?? t("altre voci");
/** A series' name as shown: its key, or what «altri» groups for this grouping. */
/** A group key as shown: the agent kinds the server names in Italian are translated. */
export const displayKey = (key) => (key === "primario" ? t("primario") : key === "subagente" ? t("subagente") : key);
export const seriesName = (key, by) => (key === "altri" ? othersLabel(by) : displayKey(key));

/** A /api/timeseries body: its series with a label (the model name for by=model) and a colour slot. */
export function seriesInput(timeseries, slotFor) {
  const by = timeseries?.by ?? "model";
  return {
    labels: timeseries?.labels ?? [],
    unit: timeseries?.unit ?? "day",
    series: (timeseries?.series ?? []).map((s) => ({
      key: s.key,
      label: s.key === "altri" ? othersLabel(by) : s.key === "task interni" ? t("task interni") : by === "model" && s.slot !== "other" && s.slot !== 7 ? modelLabel(s.key) : displayKey(s.key),
      // «altri» and «task interni» have fixed slots (the server's); the rest follows the global lookup
      slot: s.key === "altri" ? "other" : s.key === "task interni" ? (s.slot ?? 7) : slotFor(by, s.key),
      values: (s.values ?? []).map(num),
    })),
  };
}

/** A /api/daily body, one entry per day, oldest first. */
export function daysInput(daily) {
  return (daily?.days ?? []).map((d) => ({
    date: d.date,
    from: d.from,
    tokens: num(d.tokens),
    cost: num(d.cost),
    cacheRate: fin(d.cacheRate),
    runs: num(d.runs),
    failedRuns: num(d.failedRuns),
    ttft: { p50: fin(d.ttft?.p50), p95: fin(d.ttft?.p95) },
    tools: { calls: num(d.tools?.calls), errors: num(d.tools?.errors) },
    retries: num(d.retries),
    rateLimited: num(d.rateLimited),
  }));
}

/**
 * One budget period (day, week or month) of one metric: «tokens» (the default), «steps» or «cost».
 * `daily` (a /api/daily body) adds the days that fall inside the period. timeLeftMs/spanMs let a model
 * draw the countdown without a clock; `metric` tells it the unit.
 */
export function budgetInput(budget, period, now, daily, metric = "tokens") {
  const p = budget?.periods?.[period];
  const m = p?.[metric];
  const out = {
    period,
    metric,
    used: num(m?.used),
    limit: m?.limit ?? null,
    projected: fin(m?.projected),
    resetAt: p?.to ?? null,
    ratio: fin(m?.ratio),
    projectedRatio: fin(m?.projectedRatio),
    timeLeftMs: p ? Math.max(0, p.to - now) : 0,
    spanMs: p ? p.to - p.from : 0,
  };
  if (daily && p) {
    out.days = (daily.days ?? []).filter((d) => d.from >= p.from && d.from < p.to).map((d) => ({ date: d.date, used: num(d[metric]) }));
  }
  return out;
}

export function budgetAllInput(budget, now, metric = "tokens") {
  return { day: budgetInput(budget, "day", now, null, metric), week: budgetInput(budget, "week", now, null, metric), month: budgetInput(budget, "month", now, null, metric) };
}

/**
 * A /api/breakdown?by=model body (array), by tokens. The day's model budgets give limit and ratio (of the
 * model's total, so variants of one model share them); `prev`, the same breakdown of the period before,
 * gives deltaRatio (null when prev is missing or the model was not there).
 */
export function modelsInput(breakdown, budget, slotFor, prev) {
  const limits = new Map((budget?.periods?.day?.models ?? []).map((m) => [m.model, m]));
  const before = Array.isArray(prev) ? new Map(prev.map((r) => [r.key, num(r.tokens?.total)])) : null;
  return (Array.isArray(breakdown) ? breakdown : [])
    .map((r) => {
      const total = num(r.tokens?.total);
      const b = limits.get(baseModel(r.key));
      const was = before?.get(r.key) ?? 0;
      const hasSpeed = fin(r.speed?.ttftMs?.p50) !== null || fin(r.speed?.tokensPerSec?.p50) !== null;
      return {
        key: r.key,
        label: modelLabel(r.key),
        slot: slotFor("model", r.key),
        tokens: {
          input: num(r.tokens?.input),
          output: num(r.tokens?.output),
          reasoning: num(r.tokens?.reasoning),
          cacheRead: num(r.tokens?.cacheRead),
          cacheWrite: num(r.tokens?.cacheWrite),
          total,
        },
        cost: num(r.cost),
        cacheRate: fin(r.cacheRate),
        steps: num(r.steps),
        failed: num(r.failed),
        speed: hasSpeed ? r.speed : null,
        limit: b?.limit ?? null,
        ratio: fin(b?.ratio),
        deltaRatio: before && was > 0 ? (total - was) / was : null,
      };
    })
    .sort((a, b) => b.tokens.total - a.tokens.total);
}

const DELTA_FLAT = 0.005;
const deltaOf = (value, base) => {
  if (!Number.isFinite(value) || !(base > 0)) return null;
  const ratio = (value - base) / base;
  return { ratio, dir: ratio > DELTA_FLAT ? "up" : ratio < -DELTA_FLAT ? "down" : "flat" };
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

const KPI = {
  tokens: { pick: (d) => d.tokens, value: (s) => s.tokens?.total, show: compact, caption: t("token oggi") },
  cost: { pick: (d) => d.cost, value: (s) => s.cost, show: money, caption: t("costo oggi") },
  cache: { pick: (d) => d.cacheRate, value: (s) => s.cacheRate, show: pct, caption: t("del prompt da cache") },
  runs: { pick: (d) => d.runs, value: (s) => s.runs ?? null, show: full, caption: t("prompt di oggi") },
  ttft: { pick: (d) => d.ttft?.p50, value: (s) => s.speed?.ttftMs?.p50, show: dur, caption: t("primo token (mediana)") },
  // a day without calls has no rate (null, left out of the series)
  toolErrors: { pick: (d) => (d.tools.calls > 0 ? d.tools.errors / d.tools.calls : null), value: (s) => (s.tools?.calls > 0 ? num(s.tools.errors) / s.tools.calls : null), show: pct, caption: t("chiamate tool con errore") },
  // the caption says how many of today's were for a rate limit (429), the short one too
  retries: {
    pick: (d) => d.retries,
    value: (s) => s.retries,
    show: full,
    caption: (s) => t("retry di oggi · di cui {n} per limite di frequenza", { n: full(num(s.rateLimited)) }),
    short: (s) => t("retry, di cui {n} per 429", { n: full(num(s.rateLimited)) }),
  },
};
// the kpi widget's names (layout.js KPI_METRICS) for the entries above
const KPI_ALIAS = { prompts: "runs" };
// Metrics that add up over the day. Today so far is compared with the same part of the earlier days:
// tokens with the 7-day mean up to this hour (hourly.soFarAvg); cost, prompts and retries with the mean of the
// earlier days scaled by the share of a typical day's tokens done by this hour (soFarAvg / dayAvg,
// the token profile standing in for theirs). Without that share (no earlier hours with tokens) they
// get no delta and no verdict: a morning must never read as «down» against whole days. The rates
// (cache, ttft, tool errors) do not grow with the hour and compare with the earlier days as they are.
const ADDITIVE = new Set(["tokens", "cost", "runs", "retries"]);

/**
 * A headline figure from today's summary, its delta and the daily series behind it (oldest first, the
 * last entry being today). `band` is p25-p75 of the earlier days (today, still partial, left out);
 * `bandNow` the same band at this hour, what today's value is judged against (null when there is no
 * such baseline). `baseline` says what the delta compares with: «hour» (the same hour of the earlier
 * days) or «days» (the earlier days); null without a delta.
 */
export function kpiInput(metric, summary, daily, hourly) {
  const alias = KPI_ALIAS[metric] ?? metric;
  const key = KPI[alias] ? alias : "tokens";
  const k = KPI[key];
  const days = daysInput(daily);
  const series = days.map(k.pick).filter(Number.isFinite);
  const earlier = days.slice(0, -1).map(k.pick).filter(Number.isFinite);
  // «runs» is not in a summary: today's value comes from the last day of the series
  const raw = key === "runs" ? lastOf(days)?.runs : k.value(summary ?? {});
  const value = fin(raw);
  const soFar = fin(hourly?.soFarAvg);
  // 0 by this hour is no baseline either: a band of {0, 0} would call any value «sopra la norma»
  const share = soFar > 0 && hourly?.dayAvg > 0 ? soFar / hourly.dayAvg : null;
  const additive = ADDITIVE.has(key);
  let base = null;
  if (key === "tokens") base = soFar;
  else if (earlier.length) base = additive ? (share === null ? null : mean(earlier) * share) : mean(earlier);
  const sorted = [...earlier].sort((a, b) => a - b);
  const band = sorted.length >= 3 ? { lo: quantile(sorted, 0.25), hi: quantile(sorted, 0.75) } : null;
  const scale = additive ? share : 1;
  const delta = deltaOf(value, base);
  return {
    metric: key,
    value,
    display: value === null ? "–" : k.show(value),
    caption: typeof k.caption === "function" ? k.caption(summary ?? {}) : k.caption,
    // the caption for a narrow card; null: the models shorten the caption themselves
    short: k.short ? k.short(summary ?? {}) : null,
    delta,
    baseline: delta ? (additive ? "hour" : "days") : null,
    series,
    band,
    bandNow: band && scale !== null ? { lo: band.lo * scale, hi: band.hi * scale } : null,
  };
}

/** Connection, sync, API drift (only if any) and the over-budget models, as lights. */
/** «12 s fa», relative to `now` (ui.ago reads the clock itself). */
function agoAt(ts, now) {
  if (!ts) return t("mai");
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return t("adesso");
  if (s < 60) return t("{n} s fa", { n: s });
  if (s < 3600) return t("{n} min fa", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} h fa", { n: Math.round(s / 3600) });
  return t("{n} g fa", { n: Math.round(s / 86400) });
}

export function statusInput(status, budget, now = Date.now()) {
  const items = [];
  const s = status ?? {};
  if (s.state === "connected") {
    items.push({ level: "good", title: t("Collegato a OpenCode {version}", { version: s.server?.version ?? "?" }), tip: s.lastEventAt ? t("ultimo evento {ago}", { ago: agoAt(s.lastEventAt, now) }) : t("nessun evento ricevuto finora") });
  } else if (s.state === "connecting" || s.state === "starting") {
    items.push({ level: "warn", title: t("Connessione a OpenCode…"), sub: s.lastError ?? t("in corso") });
  } else {
    items.push({ level: "bad", title: t("OpenCode non raggiungibile"), sub: s.lastError ?? t("motivo sconosciuto") });
  }
  const sessions = s.counts?.sessions;
  if (s.scan?.error) items.push({ level: "bad", title: t("Sincronizzazione fallita"), sub: String(s.scan.error) });
  else if (s.scan?.running) items.push({ level: "good", title: t("Sincronizzazione in corso"), sub: t("{n} sessioni", { n: full(sessions) }) });
  else if (!s.scan?.lastEnd) items.push({ level: "warn", title: t("In attesa della prima sincronizzazione"), sub: t("{n} sessioni", { n: full(sessions) }) });
  else items.push({ level: "good", title: t("Sincronizzazione completa"), sub: t("{n} sessioni, ultima alle {time}", { n: full(sessions), time: clock(s.scan.lastEnd) }) });
  const drift = s.drift ?? [];
  if (drift.length) {
    const fields = drift.reduce((n, d) => n + (d.missing?.length ?? 0), 0);
    items.push({
      level: "warn",
      title: t("Deriva dell'API"),
      sub: `${tn(fields, "1 campo mancante", "{n} campi mancanti")} ${t("in {type}", { type: drift[0].type })}${drift.length > 1 ? ` ${t("e altri {n}", { n: drift.length - 1 })}` : ""}`,
    });
  }
  for (const m of budget?.periods?.day?.models ?? []) {
    if (Number.isFinite(m.ratio) && m.ratio >= 1) {
      items.push({ level: "bad", title: t("Budget di {model} superato", { model: modelLabel(m.model) }), sub: t("{pct} · {used} di {limit}", { pct: pct(m.ratio), used: compact(m.used), limit: compact(m.limit) }) });
    }
  }
  return { items };
}

/** A /api/rhythm body (weekday 0 = Monday) with the maximum cell and the sum of each hour over the weekdays. */
export function rhythmInput(rhythm) {
  const cells = rhythm?.cells ?? [];
  const prompts = rhythm?.prompts ?? [];
  const sum = (grid) => Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + num(row?.[h]), 0));
  return {
    days: rhythm?.days ?? 0,
    cells,
    prompts,
    max: Math.max(0, ...cells.flat().map(num)),
    maxPrompts: Math.max(0, ...prompts.flat().map(num)),
    hourSums: sum(cells),
    promptHourSums: sum(prompts),
  };
}

/**
 * A /api/summary body as the summary models read it (models-summary.js): the token kinds with the
 * internal tasks added (as the classic Riepilogo counts them), costs, counts, rates, latency and
 * tool figures, every number finite. null when nothing came back.
 */
export function summaryInput(sum) {
  if (!sum || typeof sum !== "object") return null;
  const t = sum.tokens ?? {};
  const it = sum.internal?.tokens ?? {};
  const kinds = Object.fromEntries(["input", "output", "reasoning", "cacheRead", "cacheWrite"].map((k) => [k, num(t[k]) + num(it[k])]));
  return {
    tokens: num(t.total) + num(it.total),
    kinds,
    internalTokens: num(it.total),
    cost: num(sum.cost),
    internalCost: num(sum.internal?.cost),
    steps: num(sum.steps),
    failedSteps: num(sum.failedSteps),
    retries: num(sum.retries),
    runningSteps: num(sum.runningSteps),
    sessions: num(sum.sessions),
    models: num(sum.models),
    cacheRate: fin(sum.cacheRate),
    latency: { p50: fin(sum.latencyMs?.p50), p95: fin(sum.latencyMs?.p95), n: num(sum.latencyMs?.n) },
    tools: { calls: num(sum.tools?.calls), errors: num(sum.tools?.errors) },
    // generation speed of the period's steps: time to the first token (median, p95), tokens/s (median)
    speed: { ttft: { p50: fin(sum.speed?.ttftMs?.p50), p95: fin(sum.speed?.ttftMs?.p95) }, tps: fin(sum.speed?.tokensPerSec?.p50) },
  };
}

/** The /api/runs rows plus the outcome as a status kind and a label («interrotto · da te»). */
export function runsInput(rows) {
  return (rows ?? []).map((r) => ({ ...r, outcomeKind: outcomeOf(r.outcome)[0], outcomeLabel: outcomeLabel(r.outcome, r.reason) }));
}

/**
 * The prompts a distribution style draws (one /api/runs page: at most the server's cap of 200) with
 * the period's count, its x-total-count. `total` above runs.length means the runs are only the most
 * recent of the period, and the model says so; it is never less than what came back.
 */
export function promptsInput(rows, total = 0) {
  const runs = runsInput(rows);
  return { runs, total: Math.max(runs.length, num(total)) };
}

const LANE_SLOTS = 6;

/**
 * Runs (from /api/runs?steps=1) as one lane per session, ordered by their first start. A run without
 * a known start is a point at its end. `now` is passed through for the model's «adesso» line.
 * `from` (the budget day's start) anchors the axis there, so a day whose earlier runs did not come
 * back does not look as if it began with the first one that did. `total` is the day's count of runs
 * (x-total-count): above `shown` when the page was capped.
 */
export function lanesInput(runs, now, { from: start = null, total = 0 } = {}) {
  const lanes = new Map();
  let from = Number.isFinite(start) ? start : Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const r of [...(runs ?? [])].sort((a, b) => (a.started ?? a.ended) - (b.started ?? b.ended))) {
    const started = r.started ?? r.ended;
    from = Math.min(from, started);
    to = Math.max(to, r.ended);
    const lane = lanes.get(r.sessionID) ?? lanes.set(r.sessionID, { sessionID: r.sessionID, title: r.title ?? r.sessionID, slot: (lanes.size % LANE_SLOTS) + 1, runs: [] }).get(r.sessionID);
    lane.runs.push({ started, ended: r.ended, steps: (r.stepSeries ?? []).map((s) => s.started).filter((t) => t >= started && t <= r.ended) });
  }
  const shown = runs?.length ?? 0;
  return { from: lanes.size ? from : now, to: lanes.size ? to : now, now, lanes: [...lanes.values()], shown, total: Math.max(shown, num(total)) };
}
