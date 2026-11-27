// Widgets drawn with the models of the catalogue: the SVG models (models-time, -dist, -gauges,
// -models, -summary.js) and the table models (models-tables.js, rendered by widgets-tables.js). styled(type,
// classic) wraps a type: its classic styles (`classic`, `columns`/`line`, `semi`) are the
// type's own renderer, every other style is a model fed by an adapter (adapt.js) from the paths
// requestsFor asked for that style. Same contract as widgets.js (mount, update, resize).
// The model's SVG string is inserted with innerHTML: models escape every text (draw.js esc) and
// write no style attribute (CSP), and the HTML parser puts <svg> in the SVG namespace.
import { budgetAllInput, budgetInput, daysInput, hoursInput, kpiInput, lanesInput, modelsInput, promptsInput, rhythmInput, runsInput, seriesInput, statusInput, summaryInput } from "./adapt.js";
import { gaugeReading } from "./gauge.js";
import { N_, t } from "./i18n.js";
import { STYLE_SETS, budgetMetricOf, budgetPeriodOf, runsPage, styleOf } from "./layout.js";
import { MODELS as DIST } from "./models-dist.js";
import { MODELS as GAUGES } from "./models-gauges.js";
import { MODELS as PER_MODEL } from "./models-models.js";
import { MODELS as SUMMARY } from "./models-summary.js";
import { TABLE_DEFAULTS, TABLES } from "./models-tables.js";
import { MODELS as TIME } from "./models-time.js";
import { basename, el, hideTip, showTip, stateBox } from "./ui.js";
import { head, pager, part, syncPager } from "./widgets.js";
import { renderSpec } from "./widgets-tables.js";

const SVG_MODELS = { ...TIME, ...DIST, ...GAUGES, ...PER_MODEL, ...SUMMARY };
/** The styles drawn by the type's own renderer, with their names. */
const CLASSIC_NAMES = { classic: N_("Classico"), columns: N_("Colonne"), line: N_("Linea"), semi: N_("Semicerchio") };
const CLASSIC = new Set(Object.keys(CLASSIC_NAMES));
/**
 * style → its name: the classic renderings' label, or the model's own name (a model drawn under
 * several types, G4 or B6, has one name). The editor's «Stile» menu and the Galleria read it.
 */
export const STYLE_NAMES = Object.freeze({
  ...CLASSIC_NAMES,
  ...Object.fromEntries([...Object.entries(SVG_MODELS), ...Object.entries(TABLES)].map(([id, m]) => [id, m.name])),
});
/** «G1 · Area con gradiente» for a model, «Classico» for a classic rendering (it has no id). */
export const styleLabel = (style) => (CLASSIC.has(style) ? t(STYLE_NAMES[style]) : `${style} · ${t(STYLE_NAMES[style] ?? "?")}`);
const num = (v) => (Number.isFinite(v) ? v : 0);
const fin = (v) => (Number.isFinite(v) ? v : null);

// ---------- what the adapters read ----------
const pathsOf = (ctx, prefix) => ctx.paths.filter((p) => p === prefix || p.startsWith(`${prefix}?`));
/** The body of the widget's `n`-th path under `prefix`: a path its style did not ask for is a bug. */
function body(ctx, prefix, n = 0) {
  const path = pathsOf(ctx, prefix)[n];
  if (path === undefined) throw new Error(t("{type}: {prefix} non richiesto", { type: ctx.widget.type, prefix }));
  return ctx.data(path);
}
/** The same, for a path that only some settings ask for (undefined without it). */
const optional = (ctx, prefix, n = 0) => {
  const path = pathsOf(ctx, prefix)[n];
  return path === undefined ? undefined : ctx.data(path);
};
/** The x-total-count of the widget's first path under `prefix` (0 when unknown). */
const totalOf = (ctx, prefix) => {
  const path = pathsOf(ctx, prefix)[0];
  return path === undefined ? 0 : (ctx.total?.(path) ?? 0);
};

// ---------- adapters: (ctx, now) -> the model's input ----------
const hours = (ctx, now) => hoursInput(body(ctx, "/api/hourly"), now);
const series = (ctx) => seriesInput(body(ctx, "/api/timeseries"), ctx.slotFor);
const days = (ctx) => daysInput(body(ctx, "/api/daily"));
const rhythm = (ctx) => rhythmInput(body(ctx, "/api/rhythm"));
const lanes = (ctx, now) => lanesInput(body(ctx, "/api/runs"), now, { from: body(ctx, "/api/budget")?.periods?.day?.from, total: totalOf(ctx, "/api/runs") });
const runRows = (ctx) => runsInput(body(ctx, "/api/runs"));
// run-stats C10, C11, C12, G7: the most recent prompts of the period, and how many it has
const prompts = (ctx) => promptsInput(body(ctx, "/api/runs"), totalOf(ctx, "/api/runs"));
const runSummary = (ctx) => body(ctx, "/api/runs/summary") ?? {};
const calendarBody = (ctx) => body(ctx, "/api/calendar") ?? { days: [] };
const speed = (ctx) => body(ctx, "/api/summary")?.speed ?? null;
// summary C22, C23, B13: the period's totals, internal tasks included
const summaryAll = (ctx) => summaryInput(body(ctx, "/api/summary"));
const status = (ctx, now) => statusInput(body(ctx, "/api/status"), body(ctx, "/api/budget"), now);
// the kpi widget's metric, «tokens» when absent
const kpi = (ctx) => kpiInput(ctx.widget.settings?.metric ?? "tokens", body(ctx, "/api/summary"), body(ctx, "/api/daily"), body(ctx, "/api/hourly"));
// the period the widget draws: its own, the month for C1 with the day (layout.js budgetPeriodOf); its metric, tokens when absent
const period = (ctx) => budgetPeriodOf(ctx.widget);
const budgetOne = (ctx, now) => budgetInput(body(ctx, "/api/budget"), period(ctx), now, null, budgetMetricOf(ctx.widget));
// C1 is a burn-up over the days of a week or a month (budgetPeriodOf: the day draws the month)
const budgetDays = (ctx, now) => budgetInput(body(ctx, "/api/budget"), period(ctx), now, body(ctx, "/api/daily"), budgetMetricOf(ctx.widget));
const budgetAll = (ctx, now) => budgetAllInput(body(ctx, "/api/budget"), now, budgetMetricOf(ctx.widget));
// model-day: today's breakdown with the day's model budgets (B3, C15 draw the budget rings)
const dayModels = (ctx) => modelsInput(body(ctx, "/api/breakdown"), body(ctx, "/api/budget"), ctx.slotFor);
const periodModels = (ctx) => modelsInput(body(ctx, "/api/breakdown"), null, ctx.slotFor);

/**
 * breakdown: the rows of its grouping, with the period before when the style asked for it (B8,
 * C21: deltaRatio). Grouped by something else than the model, a row keeps its own key and colour.
 */
function grouped(ctx) {
  const rows = modelsInput(body(ctx, "/api/breakdown"), null, ctx.slotFor, optional(ctx, "/api/breakdown", 1));
  const by = ctx.settings.by ?? "model";
  if (by === "model") return rows;
  // directories have no colour slots of their own: one per row, in order
  return rows.map((r, i) => ({ ...r, label: by === "directory" ? basename(r.key) || r.key : r.key, slot: by === "directory" ? (i % 6) + 1 : ctx.slotFor(by, r.key) }));
}

const KINDS = ["input", "output", "reasoning", "cacheRead", "cacheWrite"];
/** flow G10, C13: the token kinds of the period, summed over its models (they read `tokens` only). */
function kinds(ctx) {
  const tokens = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const r of body(ctx, "/api/breakdown") ?? []) for (const k of KINDS) tokens[k] += num(r.tokens?.[k]);
  return { tokens };
}

const SOURCE = /^budget-(day|week|month)-(tokens|cost|steps)$/;
const sourceOf = (ctx) => ctx.widget.settings?.source ?? "budget-day-tokens";

/**
 * gauge B1, B2: its source as one budget. A model's day budget comes from gaugeReading; a rate
 * (cache, failed steps, tool errors) is a share of 100.
 */
function gaugeOne(ctx, now) {
  const source = sourceOf(ctx);
  const isBudget = source.startsWith("budget-");
  const data = body(ctx, isBudget ? "/api/budget" : "/api/summary");
  const m = SOURCE.exec(source);
  if (m) return budgetInput(data, m[1], now, null, m[2]);
  const g = gaugeReading(source, isBudget ? { budget: data, model: ctx.widget.settings?.model ?? null } : { summary: data });
  if (g.kind === "budget") return { ...budgetInput(data, "day", now), used: num(g.used), limit: g.limit, ratio: fin(g.ratio), projected: null, projectedRatio: fin(g.projectedRatio) };
  const ratio = fin(g.ratio);
  return { period: null, used: ratio === null ? 0 : ratio * 100, limit: ratio === null ? null : 100, projected: null, resetAt: null, ratio, projectedRatio: null, timeLeftMs: 0, spanMs: 0 };
}
/** gauge B10: the three periods of a budget source, or the one value of the others. */
function gaugeAll(ctx, now) {
  const m = SOURCE.exec(sourceOf(ctx));
  if (!m) return { day: gaugeOne(ctx, now) };
  return budgetAllInput(body(ctx, "/api/budget"), now, m[2]);
}

/** feed T1-T4: the live events (ctx.feed, newest first) named after today's sessions. */
function feedInput(ctx, now) {
  const sessions = {};
  for (const s of optional(ctx, "/api/sessions") ?? []) sessions[s.id] = { title: s.title || basename(s.directory) || s.id };
  return { items: ctx.feed ?? [], now, sessions };
}
/** runs T9-T12: the page of prompts with the period's totals, each one's share of it («quota»). */
function heavyInput(ctx) {
  const sum = optional(ctx, "/api/summary");
  return { runs: runRows(ctx), ...(sum ? { period: { token: num(sum.tokens?.total), costo: num(sum.cost), step: num(sum.steps) } } : {}) };
}

// type -> style -> [model id, adapter]; the classic styles are not here (the type's own renderer)
const MAP = {
  hero: { G1: ["G1", hours], G4: ["G4", hours] },
  kpi: { B11: ["B11", kpi], B12: ["B12", kpi], C20: ["C20", kpi] },
  budget: { C19: ["C19", budgetOne], B1: ["B1", budgetOne], B2: ["B2", budgetOne], C14: ["C14", budgetOne], B5: ["B5", budgetAll], B10: ["B10", budgetAll], C16: ["C16", budgetAll], C1: ["C1", budgetDays] },
  "model-day": { B3: ["B3", dayModels], C15: ["C15", dayModels], B6: ["B6", dayModels], G9: ["G9", dayModels], C3: ["C3", series] },
  flow: { G12: ["G12", periodModels], B7: ["B7", periodModels], G10: ["G10", kinds], C13: ["C13", kinds] },
  status: { C18: ["C18", status], C17: ["C17", days] },
  feed: { T1: ["T1", feedInput], T2: ["T2", feedInput], T3: ["T3", feedInput], T4: ["T4", feedInput] },
  runs: { T5: ["T5", runRows], T6: ["T6", runRows], T7: ["T7", runRows], T8: ["T8", runRows], T9: ["T9", heavyInput], T10: ["T10", heavyInput], T11: ["T11", heavyInput], T12: ["T12", heavyInput] },
  trend: { G2: ["G2", series], C3: ["C3", series], G3: ["G3", series], G4: ["G4", series], C4: ["C4", series], C5: ["C5", series] },
  speed: { C2: ["C2", days], B9: ["B9", periodModels], B4: ["B4", speed] },
  rhythm: { G5: ["G5", rhythm], C6: ["C6", rhythm] },
  calendar: { G6: ["G6", calendarBody] },
  "day-sessions": { C7: ["C7", lanes] },
  breakdown: { C21: ["C21", grouped], B6: ["B6", grouped], B7: ["B7", grouped], B8: ["B8", grouped], G9: ["G9", grouped], G11: ["G11", grouped], C9: ["C9", grouped] },
  "run-stats": { G8: ["G8", runSummary], C8: ["C8", runSummary], C10: ["C10", prompts], C11: ["C11", prompts], C12: ["C12", prompts], G7: ["G7", prompts] },
  gauge: { B1: ["B1", gaugeOne], B2: ["B2", gaugeOne], B10: ["B10", gaugeAll] },
  summary: { C22: ["C22", summaryAll], C23: ["C23", summaryAll], B13: ["B13", summaryAll] },
};

/**
 * How a style of a type is drawn: { kind: "classic" } (the type's own renderer), { kind: "svg",
 * id, name, draw, adapter } or { kind: "table", id, name, family, build, adapter }; null for a
 * style the type does not have.
 */
export function modelFor(type, style) {
  if (!STYLE_SETS[type]?.includes(style)) return null;
  if (CLASSIC.has(style)) return { kind: "classic" };
  const entry = MAP[type]?.[style];
  if (!entry) return null;
  const [id, adapter] = entry;
  const t = TABLES[id];
  if (t) return { kind: "table", id, name: t.name, family: t.kind, build: t.build, adapter };
  const m = SVG_MODELS[id];
  return m ? { kind: "svg", id, name: m.name, draw: m.draw, adapter } : null;
}

// ---------- drawing ----------
/** The style's id next to the title: shown while editing, or always with localStorage lens:show-style-ids = "1". */
function styleTag(m) {
  let on = false;
  try {
    on = localStorage.getItem("lens:show-style-ids") === "1";
  } catch {
    /* storage may be unavailable */
  }
  return el("span", { class: on ? "style-id on" : "style-id", text: m.id, title: m.name });
}

/** One delegated tooltip for the model's hit areas (their data-tip text). */
function wireTips(fig) {
  fig.addEventListener("pointermove", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
    if (t && fig.contains(t)) showTip(el("div", { class: "tt-row", text: t.getAttribute("data-tip") }), e.clientX, e.clientY);
    else hideTip();
  });
  fig.addEventListener("pointerleave", hideTip);
}

function drawSvg(fig, ctx, m) {
  // the figure's real size, after layout; a hidden view measures 0 × 0 and draws when shown (resize)
  const w = Math.floor(fig.clientWidth);
  const h = Math.floor(fig.clientHeight);
  if (!w || !h) return;
  const out = m.draw(m.adapter(ctx, Date.now()), { w, h, uid: ctx.widget.id, label: ctx.title });
  if (typeof out === "string") fig.innerHTML = out;
  else fig.replaceChildren(stateBox("empty", out?.empty ?? t("Nessun dato")));
}

// first guess of a feed row's height per style (the log is one text line); fewer rows when they overflow
const FEED_ROW_PX = { T1: 26, T2: 26, T3: 26, T4: 16 };

/** Renders `rows` rows, then one fewer while they overflow the figure's height (never under one). */
function fitRows(fig, rows, render) {
  const room = fig.clientHeight;
  render(rows);
  while (room && rows > 1 && fig.scrollHeight > room + 1) render(--rows);
}

function drawTable(root, fig, ctx, m) {
  const now = Date.now();
  // the raw settings over the family's defaults: an empty `cols` or `kinds` falls back to the
  // defaults in the builder itself
  const cfg = { ...TABLE_DEFAULTS[m.family], ...ctx.widget.settings, expanded: ctx.inst.expanded ?? null };
  const box = (rows) => ({ rows, slotFor: ctx.slotFor, uid: ctx.widget.id, w: fig.clientWidth, now });
  if (ctx.widget.type === "runs") {
    // as many rows as the page asked for (runsPage: the widget's height), with the same pager
    const { size, compact } = runsPage(ctx.widget);
    if (compact) {
      if (ctx.page() > 0) return ctx.setPage(0); // the top N: always the first page
      part(root, "pager").classList.add("hidden");
    } else if (!syncPager(root, ctx, ctx.total(ctx.paths[0]), size, "prompt")) return;
    const opts = {
      inst: ctx.inst,
      slotFor: ctx.slotFor,
      width: Math.max(320, fig.clientWidth - 40),
      onExpand: (id) => {
        ctx.inst.expanded = ctx.inst.expanded === id ? null : id;
        drawTable(root, fig, ctx, m);
      },
    };
    const input = m.adapter(ctx, now);
    const render = (rows) => renderSpec(fig, m.build(input, cfg, box(rows)), opts);
    // a page shows all its rows (the pager counts them); the top N without pager only those that fit
    return compact ? fitRows(fig, size, render) : render(size);
  }
  // feed: the newest events that fit the figure
  const input = m.adapter(ctx, now);
  fitRows(fig, Math.max(1, Math.ceil(fig.clientHeight / (FEED_ROW_PX[m.id] ?? 26))), (rows) => renderSpec(fig, m.build(input, cfg, box(rows)), {}));
}

/**
 * The renderer of a type with styles: `classic` (the type's own renderer, for its classic styles)
 * or the model of the widget's style. The widget key includes the settings: a new style remounts.
 */
export function styled(type, classic = null) {
  const resolve = (ctx) => {
    const m = modelFor(type, styleOf(ctx.widget));
    if (m && (m.kind !== "classic" || classic)) return m;
    return classic ? { kind: "classic" } : modelFor(type, STYLE_SETS[type][0]);
  };
  return {
    mount(root, ctx) {
      const m = resolve(ctx);
      // a T7 detail row of another style must not be reused by this one
      if (ctx.inst.style !== styleOf(ctx.widget)) ctx.inst.detail = null;
      ctx.inst.style = styleOf(ctx.widget);
      if (m.kind === "classic") {
        delete root.dataset.style;
        return classic.mount(root, ctx);
      }
      root.dataset.style = m.id;
      const fig = el("figure", { class: m.kind === "table" ? "model model-table" : "model", "data-part": "model" });
      if (m.kind === "svg") wireTips(fig);
      root.replaceChildren(head(ctx, { extras: [styleTag(m)] }), fig, ...(type === "runs" ? [pager(ctx, t("Pagine dei prompt"))] : []));
    },
    update(root, ctx) {
      const m = resolve(ctx);
      if (m.kind === "classic") return classic.update(root, ctx);
      const fig = part(root, "model");
      if (m.kind === "table") return drawTable(root, fig, ctx, m);
      drawSvg(fig, ctx, m);
    },
    resize: true,
  };
}
