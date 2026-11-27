// The dashboard layout: widget catalogue, default arrangement, validation and
// grid geometry. Pure module: the browser uses it to draw and edit the grid,
// the server to validate what it saves (src/dashboard.js).
//
// A layout (version 2) has three views, «Adesso», «Analisi» and «Monitor», each with its
// own 12-column grid (a v2 saved before «Monitor» gets the default one). Version 1 (one grid) is migrated by migrate.js; the import is
// circular and safe because neither module uses the other's bindings at load time.
import { GAUGE_SOURCES } from "./gauge.js";
import { N_, t } from "./i18n.js";
import { V1_TYPES, migrateLayout } from "./migrate.js";

export const COLS = 12;
export const ROW_PX = 40;
export const GAP_PX = 16;
/** Widgets per view at most. */
export const MAX_WIDGETS = 60;
export const MAX_TITLE = 80;
export const MAX_Y = 1000;
/** Errors returned by validateLayout at most, then a "… e altri N" line. */
export const MAX_ERRORS = 20;
const MAX_H = 60;

// "dashboard" = follow the filters at the top of the page (in Adesso: VIEW_GLOBALS.adesso);
// "day" = the budget day (from midnight or LENS_RESET_HOUR)
export const RANGES = ["dashboard", "day", "3600000", "28800000", "86400000", "604800000", "2592000000", "0"];
export const METRICS = ["dashboard", "tokens", "cost", "steps"];
export const BYS = ["dashboard", "model", "agent", "provider", "kind"];
export const SORTS = ["recent", "tokens", "duration"];
export const KPI_METRICS = ["tokens", "cache", "prompts", "cost", "toolErrors", "ttft", "retries"];
export const BUDGET_PERIODS = ["day", "week", "month"];
/** What a `budget` widget counts (absent = tokens, as before the setting). */
export const BUDGET_METRICS = ["tokens", "steps", "cost"];
/** Columns a `runs` table may show (`cols`: any subset, in any order). */
export const RUN_COLS = ["ora", "sessione", "progetto", "modello", "agente", "esito", "durata", "ttft", "tps", "step", "tool", "comp", "token", "costo", "cache", "quota"];
/**
 * Event kinds a `feed` may show (`kinds`: any subset). `step` is every step, the failed ones too (as
 * it always was: a list saved before `failed` keeps its meaning); `failed` the failed steps alone,
 * for a feed that hides the successful steps, and their cost, but not the errors.
 */
export const FEED_KINDS = ["run", "step", "failed", "tool", "compaction", "session", "warn"];
/** Row height of the tables (`runs`). */
export const DENSITIES = ["comoda", "compatta"];
/** Which prompts a `runs` table lists: all, or only those with a problem. */
export const ONLY = ["tutti", "problemi"];
/** Time of a `feed` event: relative («2 min fa») or the clock. */
export const FEED_TIMES = ["rel", "abs"];
/** Whether a `feed` event names its session. */
export const FEED_SESSION = ["si", "no"];
/** Whether `live` shows the cost of the prompt in progress (absent = shown). */
export const LIVE_COST = ["si", "no"];

/**
 * type → the `style` values it allows: the models of the catalogue, with the rendering of before
 * (`classic`, or `columns`/`line` and `semi`) first where the type has one. A widget
 * without `style` uses the first.
 */
export const STYLE_SETS = Object.freeze({
  hero: Object.freeze(["classic", "G1", "G4"]),
  kpi: Object.freeze(["B11", "B12", "C20"]),
  budget: Object.freeze(["C19", "B1", "B2", "B5", "B10", "C14", "C16", "C1"]),
  "model-day": Object.freeze(["classic", "B3", "C15", "B6", "C3", "G9"]),
  flow: Object.freeze(["G12", "G10", "C13", "B7"]),
  status: Object.freeze(["C18", "C17"]),
  feed: Object.freeze(["classic", "T1", "T4", "T3", "T2"]),
  runs: Object.freeze(["classic", "T5", "T6", "T7", "T8", "T9", "T12", "T10", "T11"]),
  trend: Object.freeze(["columns", "line", "G2", "C3", "G3", "G4", "C4", "C5"]),
  speed: Object.freeze(["C2", "B9", "B4"]),
  rhythm: Object.freeze(["G5", "C6"]),
  calendar: Object.freeze(["classic", "G6"]),
  "day-sessions": Object.freeze(["C7"]),
  breakdown: Object.freeze(["classic", "C21", "B6", "B7", "B8", "G9", "G11", "C9"]),
  "run-stats": Object.freeze(["classic", "G8", "C10", "C11", "C12", "G7", "C8"]),
  gauge: Object.freeze(["semi", "B1", "B2", "B10"]),
  summary: Object.freeze(["C22", "C23", "B13"]),
});
/** The style a widget is drawn with: its own, or the first of its type. */
export const styleOf = (widget) => widget.settings?.style ?? STYLE_SETS[widget.type]?.[0];
/**
 * The period a `budget` widget draws: its own (the day when absent), except C1, a burn-up over the
 * days of a week or a month: there no period, or the day (one point, nothing to project), is the
 * month. The title and the drawing both follow it.
 */
export const budgetPeriodOf = (widget) => {
  const period = widget.settings?.period ?? "day";
  return styleOf(widget) === "C1" && period !== "week" ? "month" : period;
};
/** The metric a `budget` widget counts: its own, tokens when absent (not the view's filter). */
export const budgetMetricOf = (widget) => widget.settings?.metric ?? "tokens";

export const VIEWS = ["adesso", "analisi", "monitor"];
export const VIEW_LABELS = Object.freeze({ adesso: N_("Adesso"), analisi: N_("Analisi"), monitor: N_("Monitor") });
const BUDGET_DAY = Object.freeze({ range: "day", metric: "tokens", by: "model" });
/** What «Dashboard» means for a widget of a view without filters: the budget day, in tokens, by model. */
export const VIEW_GLOBALS = Object.freeze({ adesso: BUDGET_DAY, monitor: BUDGET_DAY });
/** The types of Adesso that also suit the Monitor (docs/dashboard.md, Catalogo: «Adesso, Monitor»). */
const MONITOR_TYPES = Object.freeze(["hero", "model-day", "feed", "kpi", "budget", "flow", "status"]);
/** The views a type is offered for: its `home` ("both" = Adesso and Analisi), plus the Monitor for MONITOR_TYPES. */
export const typeViews = (type) => VIEWS.filter((v) => (v === "monitor" ? MONITOR_TYPES.includes(type) : [v, "both"].includes(WIDGET_TYPES[type]?.home)));

const T = { title: null }; // free text, every type has it
/** The `style` setting of a type with more than one model. */
const S = (type) => ({ style: STYLE_SETS[type] });

/**
 * type → label, description (catalogue), size and min as [w, h] (`size` is the first style's: the
 * other styles have their own in STYLE_SIZES), allowed settings (null = free text, { set: [...] } = a
 * list of distinct allowed values in any order, else one of the values), home: the view the catalogue
 * suggests it for ("adesso", "analisi" or "both").
 */
export const WIDGET_TYPES = {
  hero: { label: N_("Oggi"), description: N_("Token di oggi, composizione, budget del giorno con la proiezione e ora per ora"), size: [8, 9], min: [4, 6], home: "adesso", settings: { ...T, ...S("hero") } },
  "model-day": { label: N_("Per modello oggi"), description: N_("Token di oggi per modello, con il budget giornaliero e il ritmo"), size: [6, 5], min: [3, 4], home: "adesso", settings: { ...T, ...S("model-day") } },
  kpis: { label: N_("Indicatori di oggi"), description: N_("Prompt, costo, cache, latenza ed errori dei tool di oggi, con gli ultimi 7 giorni"), size: [12, 3], min: [4, 3], home: "adesso", settings: { ...T } },
  live: { label: N_("Prompt in corso"), description: N_("Il prompt che OpenCode sta eseguendo: tempo, step, tool, token e contesto"), size: [4, 5], min: [3, 4], home: "adesso", settings: { ...T, cost: LIVE_COST } },
  feed: {
    label: N_("Attività live"),
    description: N_("Step e tool appena registrati"),
    size: [6, 6],
    min: [3, 4],
    home: "adesso",
    settings: { ...T, ...S("feed"), kinds: { set: FEED_KINDS }, time: FEED_TIMES, session: FEED_SESSION },
  },
  runs: {
    label: N_("Prompt"),
    description: N_("Prompt del periodo, a pagine, con token, durata, step, tool ed esito"),
    size: [12, 8],
    min: [6, 5],
    home: "both",
    settings: { ...T, range: RANGES, sort: SORTS, ...S("runs"), cols: { set: RUN_COLS }, density: DENSITIES, only: ONLY },
  },
  "run-stats": { label: N_("Prompt: distribuzione"), description: N_("Quanti token per prompt: istogramma, mediana, p95 e durata media"), size: [6, 7], min: [4, 4], home: "analisi", settings: { ...T, range: RANGES, ...S("run-stats") } },
  trend: { label: N_("Andamento"), description: N_("Token, costo o step nel tempo, a colonne o a linea, per modello, agente o provider"), size: [12, 7], min: [4, 5], home: "analisi", settings: { ...T, range: RANGES, metric: METRICS, by: [...BYS, "total"], ...S("trend") } },
  interaction: { label: N_("Interazione"), description: N_("Prompt, permessi, commit e subagenti"), size: [5, 11], min: [4, 3], home: "analisi", settings: { ...T, range: RANGES } },
  summary: { label: N_("Riepilogo"), description: N_("Token, costo, step, cache, latenza e tool del periodo"), size: [12, 3], min: [4, 3], home: "analisi", settings: { ...T, range: RANGES, ...S("summary") } },
  calendar: { label: N_("Ultimo anno"), description: N_("Calendario giornaliero di 53 settimane"), size: [6, 4], min: [4, 4], home: "analisi", settings: { ...T, metric: METRICS, ...S("calendar") } },
  breakdown: { label: N_("Tabella per dimensione"), description: N_("Token, costo, cache e latenza per modello, agente, provider o cartella"), size: [12, 11], min: [4, 4], home: "analisi", settings: { ...T, range: RANGES, by: [...BYS, "directory"], ...S("breakdown") } },
  tools: { label: N_("Tool"), description: N_("Chiamate, errori e durata per tool"), size: [7, 11], min: [4, 4], home: "analisi", settings: { ...T, range: RANGES } },
  sessions: { label: N_("Sessioni"), description: N_("Sessioni del periodo, a pagine, con la timeline"), size: [12, 13], min: [6, 6], home: "analisi", settings: { ...T, range: RANGES } },
  gauge: { label: N_("Gauge"), description: N_("Un valore rispetto a un massimo: budget, cache, errori"), size: [3, 5], min: [2, 4], home: "analisi", settings: { ...T, range: RANGES, source: GAUGE_SOURCES, model: null, ...S("gauge") } },
  kpi: { label: N_("Indicatore"), description: N_("Un numero di oggi con il confronto: token, cache, prompt, costo, errori dei tool, primo token o retry"), size: [3, 4], min: [3, 3], home: "adesso", settings: { ...T, metric: KPI_METRICS, ...S("kpi") } },
  budget: {
    label: N_("Budget"),
    description: N_("Il budget di token, step o costo del giorno, della settimana o del mese: quanto ne resta e quando si azzera"),
    size: [3, 4],
    min: [3, 4],
    home: "adesso",
    settings: { ...T, period: BUDGET_PERIODS, metric: BUDGET_METRICS, ...S("budget") },
  },
  flow: { label: N_("Dove vanno i token"), description: N_("Token del periodo per modello e per tipo: input, output, cache"), size: [6, 6], min: [4, 5], home: "adesso", settings: { ...T, range: RANGES, ...S("flow") } },
  status: { label: N_("Stato"), description: N_("Collegamento con OpenCode, budget e avvisi"), size: [3, 4], min: [3, 4], home: "adesso", settings: { ...T, ...S("status") } },
  speed: { label: N_("Velocità"), description: N_("Primo token e token al secondo, nel tempo o per modello"), size: [6, 5], min: [3, 4], home: "analisi", settings: { ...T, range: RANGES, ...S("speed") } },
  rhythm: { label: N_("Quando lavori"), description: N_("Token per ora del giorno e giorno della settimana, nelle ultime 4 settimane"), size: [5, 4], min: [4, 4], home: "analisi", settings: { ...T, ...S("rhythm") } },
  "day-sessions": { label: N_("Sessioni nella giornata"), description: N_("Le sessioni di oggi su una linea del tempo, con i loro prompt"), size: [6, 6], min: [4, 5], home: "analisi", settings: { ...T } },
};

/**
 * type → style → [w, h]: the size a style is drawn at by default (the catalogue's «Aggiungi», the
 * Galleria's cards). A style not listed takes the type's `size`, which is its first style's. Rings
 * and gauges are near square, lines and columns wide and low, tables tall; a size never goes under
 * the type's `min`.
 */
export const STYLE_SIZES = Object.freeze({
  hero: Object.freeze({ G1: [6, 6], G4: [6, 6] }),
  budget: Object.freeze({ B1: [3, 5], B2: [3, 5], B5: [4, 4], B10: [4, 4], C14: [4, 5], C16: [4, 5], C1: [6, 5] }),
  "model-day": Object.freeze({ B3: [6, 6], C15: [3, 6], B6: [6, 5], C3: [6, 6], G9: [4, 5] }),
  flow: Object.freeze({ G10: [4, 5], C13: [4, 5], B7: [6, 5] }),
  status: Object.freeze({ C17: [6, 4] }),
  feed: Object.freeze({ T4: [8, 6] }),
  trend: Object.freeze({ G2: [6, 5], C3: [6, 6], G3: [6, 5], G4: [6, 5], C4: [6, 7], C5: [6, 5] }),
  speed: Object.freeze({ B9: [4, 5], B4: [3, 5] }),
  rhythm: Object.freeze({ C6: [4, 5] }),
  breakdown: Object.freeze({ C21: [6, 6], B6: [6, 5], B7: [6, 5], B8: [6, 5], G9: [4, 5], G11: [4, 5], C9: [6, 5] }),
  "run-stats": Object.freeze({ G8: [6, 5], C10: [6, 5], C11: [6, 4], C12: [6, 5], G7: [6, 6], C8: [4, 4] }),
  gauge: Object.freeze({ B1: [3, 5], B2: [3, 5], B10: [4, 4] }),
  summary: Object.freeze({ C22: [12, 3], C23: [12, 4], B13: [6, 5] }),
});
/** The default size of `type` drawn with `style` (absent = the type's first), as [w, h]. */
export const sizeOf = (type, style) => STYLE_SIZES[type]?.[style] ?? WIDGET_TYPES[type]?.size ?? [4, 4];

const frozen = (v) => (Array.isArray(v) ? Object.freeze([...v]) : v);
/** A frozen widget, its list settings (`cols`, `kinds`) too. */
const w = (id, type, x, y, wd, h, settings = {}) =>
  Object.freeze({ id, type, x, y, w: wd, h, settings: Object.freeze(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, frozen(v)]))) });
// the tables as the spec chose them: every kind of event, relative time, session shown; the columns of each `runs`
const FEED = { kinds: FEED_KINDS, time: "rel", session: "si" };
const RECENT = { sort: "recent", cols: ["ora", "sessione", "modello", "esito", "durata", "ttft", "comp", "token", "cache"], density: "comoda", only: "tutti" };
const HEAVY = { sort: "tokens", title: N_("I più pesanti"), cols: ["progetto", "modello", "esito", "durata", "token", "quota"], density: "comoda" };
/** The arrangement of a fresh install (and of a v1 left as it was installed); rows of ROW_PX. */
export const DEFAULT_LAYOUT = Object.freeze({
  version: 2,
  views: Object.freeze({
    // designed on a 1710×1112 screen (1430-px grid, ~18 rows visible); every row full, the cards of a row the same height
    adesso: Object.freeze({
      widgets: Object.freeze([
        w("w-kpi-tokens", "kpi", 0, 0, 3, 4, { style: "B11", metric: "tokens" }),
        w("w-kpi-cache", "kpi", 3, 0, 3, 4, { style: "B12", metric: "cache" }),
        w("w-budget-day", "budget", 6, 0, 3, 4, { style: "C19", period: "day" }),
        w("w-status", "status", 9, 0, 3, 4, { style: "C18" }),
        w("w-hero", "hero", 0, 4, 6, 6, { style: "G1" }),
        w("w-model-day", "model-day", 6, 4, 6, 6, { style: "B3" }),
        w("w-live", "live", 0, 10, 3, 6),
        w("w-feed", "feed", 3, 10, 5, 6, { style: "T1", ...FEED }),
        w("w-flow", "flow", 8, 10, 4, 6, { style: "G12" }),
        w("w-runs", "runs", 0, 16, 12, 8, { style: "T5", ...RECENT }),
      ]),
    }),
    analisi: Object.freeze({
      widgets: Object.freeze([
        w("w-summary", "summary", 0, 0, 12, 3, { style: "C22" }),
        w("w-trend", "trend", 0, 3, 6, 5, { style: "G2" }),
        w("w-trend-models", "trend", 6, 3, 6, 5, { style: "C3", title: N_("Ora per ora per modello") }),
        w("w-rhythm", "rhythm", 0, 8, 5, 4, { style: "G5" }),
        w("w-breakdown-share", "breakdown", 5, 8, 7, 4, { style: "B6", title: N_("Quota per modello") }),
        w("w-day-sessions", "day-sessions", 0, 12, 6, 6), // one model only (C7): no style setting
        w("w-breakdown", "breakdown", 6, 12, 6, 6, { style: "C21" }),
        w("w-heavy", "runs", 0, 18, 12, 9, { style: "T9", ...HEAVY }), // the whole top ten, one line each
      ]),
    }),
    // ids unlike the other views' defaults: a layout saved before «Monitor» gets this one next to its own.
    // Exactly 18 rows: one screen, no scrolling
    monitor: Object.freeze({
      widgets: Object.freeze([
        w("w-mon-kpi", "kpi", 0, 0, 6, 4, { style: "B11", metric: "tokens" }),
        w("w-mon-budget", "budget", 6, 0, 3, 4, { style: "C19", period: "day" }),
        w("w-mon-status", "status", 9, 0, 3, 4, { style: "C18" }),
        w("w-mon-model-day", "model-day", 0, 4, 3, 7, { style: "C15" }),
        w("w-mon-hero", "hero", 3, 4, 9, 7, { style: "G1" }),
        w("w-mon-feed", "feed", 0, 11, 8, 7, { style: "T4", ...FEED }),
        w("w-mon-flow", "flow", 8, 11, 4, 7, { style: "G12" }),
      ]),
    }),
  }),
});

/**
 * «Consigliata»: one role and one time horizon per view. Adesso is today up close (numbers against the
 * 7-day baseline, the three budgets, the pace per model, what is running, today's sessions and prompts);
 * Analisi follows its filters top to bottom (overview, time, where tokens and cost go, distribution,
 * outliers, waste) with the fixed windows grouped at the bottom; Monitor uses the HTML cards the monitor
 * CSS enlarges, to be read from afar. Same grid rules as DEFAULT_LAYOUT; Monitor is exactly 18 rows.
 */
const RECOMMENDED_LAYOUT = Object.freeze({
  version: 2,
  views: Object.freeze({
    adesso: Object.freeze({
      widgets: Object.freeze([
        w("w-kpi-tokens", "kpi", 0, 0, 3, 4, { style: "B11", metric: "tokens" }),
        w("w-kpi-cost", "kpi", 3, 0, 3, 4, { style: "B11", metric: "cost" }),
        w("w-kpi-cache", "kpi", 6, 0, 3, 4, { style: "B12", metric: "cache" }),
        w("w-budget", "budget", 9, 0, 3, 4, { style: "B5", period: "day" }),
        w("w-hero", "hero", 0, 4, 6, 6, { style: "G1" }),
        w("w-model-day", "model-day", 6, 4, 6, 6, { style: "classic" }), // the one model-day style with the pace
        w("w-live", "live", 0, 10, 4, 6),
        w("w-feed", "feed", 4, 10, 8, 6, { style: "T1", ...FEED }),
        w("w-day-sessions", "day-sessions", 0, 16, 12, 6),
        w("w-runs", "runs", 0, 22, 12, 8, { style: "T5", ...RECENT, cols: ["ora", "sessione", "modello", "esito", "durata", "ttft", "tps", "token", "costo", "cache"] }),
      ]),
    }),
    analisi: Object.freeze({
      widgets: Object.freeze([
        w("w-summary", "summary", 0, 0, 12, 3, { style: "C22" }),
        w("w-trend", "trend", 0, 3, 6, 6, { style: "G3" }),
        w("w-breakdown", "breakdown", 6, 3, 6, 6, { style: "C21" }),
        w("w-flow", "flow", 0, 9, 6, 6, { style: "G12" }),
        w("w-cost", "breakdown", 6, 9, 6, 6, { style: "C9", title: N_("Dove va il costo") }),
        w("w-run-stats", "run-stats", 0, 15, 6, 5, { style: "G8" }),
        w("w-speed", "speed", 6, 15, 6, 5, { style: "B9" }),
        w("w-heavy", "runs", 0, 20, 12, 9, { style: "T9", ...HEAVY, cols: ["progetto", "modello", "esito", "durata", "step", "tool", "token", "costo", "cache", "quota"] }),
        w("w-tools", "tools", 0, 29, 7, 9),
        w("w-interaction", "interaction", 7, 29, 5, 9),
        // the fixed windows (4 weeks, one year, the month, day by day): together at the bottom
        w("w-rhythm", "rhythm", 0, 38, 6, 4, { style: "G5" }),
        w("w-calendar", "calendar", 6, 38, 6, 4, { style: "G6" }),
        w("w-budget-month", "budget", 0, 42, 6, 5, { style: "C1", period: "month" }),
        w("w-status-history", "status", 6, 42, 6, 5, { style: "C17", title: N_("Affidabilità") }),
      ]),
    }),
    monitor: Object.freeze({
      widgets: Object.freeze([
        w("w-mon-hero", "hero", 0, 0, 8, 9, { style: "classic" }),
        w("w-mon-live", "live", 8, 0, 4, 9),
        w("w-mon-kpis", "kpis", 0, 9, 12, 3),
        w("w-mon-model-day", "model-day", 0, 12, 4, 6, { style: "B6" }),
        w("w-mon-feed", "feed", 4, 12, 5, 6, { style: "classic", ...FEED }),
        w("w-mon-status", "status", 9, 12, 3, 6, { style: "C18" }),
      ]),
    }),
  }),
});

// what the «Operativa» feeds show: no «step» (each step line carries its cost)
const OPS_FEED = { kinds: ["run", "failed", "tool", "warn", "compaction"], time: "rel", session: "si" };
/**
 * «Operativa»: for whoever works with the agent all day (ops, troubleshooting, code). Usage and the
 * day's budget only: no widget, style, column or metric that shows a cost or the week's and month's
 * budgets (kpis, summary, hero classic, interaction, sessions, budget B5/B10/C16/C1, breakdown
 * classic/C9/G11, runs classic and the `costo` column, feed classic or with «step» all do), and
 * every `metric` fixed, since the Analisi filter offers «Costo». `live` is there with `cost: "no"`, for
 * the permission wait and the context.
 */
const OPERATIONS_LAYOUT = Object.freeze({
  version: 2,
  prefs: Object.freeze({ costs: false }),
  views: Object.freeze({
    // «will I make it to the evening?»
    adesso: Object.freeze({
      widgets: Object.freeze([
        w("w-budget", "budget", 0, 0, 6, 4, { style: "C19", period: "day" }), // 6 columns: what is left and the tokens per hour
        w("w-kpi-tokens", "kpi", 6, 0, 3, 4, { style: "B11", metric: "tokens" }),
        w("w-kpi-prompts", "kpi", 9, 0, 3, 4, { style: "B11", metric: "prompts" }),
        w("w-hero", "hero", 0, 4, 6, 6, { style: "G1" }),
        w("w-model-day", "model-day", 6, 4, 6, 6, { style: "classic" }),
        w("w-day-sessions", "day-sessions", 0, 10, 6, 6),
        w("w-flow", "flow", 6, 10, 6, 6, { style: "G12" }),
        w("w-runs", "runs", 0, 16, 12, 8, { style: "T5", ...RECENT, cols: ["ora", "sessione", "modello", "agente", "esito", "durata", "ttft", "tps", "step", "tool", "token", "cache"] }),
      ]),
    }),
    // «where do I lose time?»: health, volume, who and where, speed, tools, the heaviest prompts
    analisi: Object.freeze({
      widgets: Object.freeze([
        w("w-gauge-cache", "gauge", 0, 0, 4, 5, { style: "B2", source: "cache" }),
        w("w-gauge-failed", "gauge", 4, 0, 4, 5, { style: "B2", source: "failed-steps" }),
        w("w-gauge-tools", "gauge", 8, 0, 4, 5, { style: "B2", source: "tool-errors" }),
        w("w-trend", "trend", 0, 5, 6, 6, { style: "G3", metric: "tokens" }),
        w("w-breakdown", "breakdown", 6, 5, 6, 6, { style: "C21" }),
        w("w-changes", "breakdown", 0, 11, 6, 5, { style: "B8", title: N_("Cosa è cambiato") }),
        w("w-projects", "breakdown", 6, 11, 6, 5, { style: "B6", by: "directory", title: N_("Per progetto") }),
        w("w-ttft", "speed", 0, 16, 6, 5, { style: "C2" }),
        w("w-speed", "speed", 6, 16, 6, 5, { style: "B9" }),
        w("w-tools", "tools", 0, 21, 7, 8),
        w("w-run-stats", "run-stats", 7, 21, 5, 8, { style: "G8" }),
        w("w-heavy", "runs", 0, 29, 12, 9, { style: "T9", ...HEAVY, cols: ["progetto", "modello", "agente", "esito", "durata", "ttft", "step", "tool", "token", "cache", "quota"] }),
        w("w-rhythm", "rhythm", 0, 38, 6, 4, { style: "G5" }),
        w("w-status-history", "status", 6, 38, 6, 4, { style: "C17", title: N_("Affidabilità") }),
      ]),
    }),
    // «is the agent healthy?»: four gauges in the same traffic-light language, then what runs now
    monitor: Object.freeze({
      widgets: Object.freeze([
        w("w-mon-budget", "gauge", 0, 0, 3, 5, { style: "semi", source: "budget-day-tokens" }),
        w("w-mon-failed", "gauge", 3, 0, 3, 5, { style: "semi", source: "failed-steps" }),
        w("w-mon-tools", "gauge", 6, 0, 3, 5, { style: "semi", source: "tool-errors" }),
        w("w-mon-speed", "speed", 9, 0, 3, 5, { style: "B4" }),
        w("w-mon-live", "live", 0, 5, 5, 7, { cost: "no" }),
        w("w-mon-feed", "feed", 5, 5, 7, 7, { style: "T4", ...OPS_FEED }),
        w("w-mon-model-day", "model-day", 0, 12, 4, 6, { style: "B6" }), // straight bars, read from afar
        w("w-mon-status", "status", 4, 12, 4, 6, { style: "C18" }),
        w("w-mon-hero", "hero", 8, 12, 4, 6, { style: "G4" }),
      ]),
    }),
  }),
});

/**
 * «Presidio» (designed by Codex with five independent sub-agents, Analisi shortened): the best of the
 * other three. Today's budget from Operativa, tokens and cache against the norm from Classica, the
 * hours, the pace per model, the sessions and prompts of today; Analisi follows its filter (every
 * metric fixed to tokens or steps) from the error rates down to volumes, outcomes, models, projects,
 * speed, tools and the heaviest prompts, then the fixed 7- and 30-day windows; Monitor is one screen
 * of large figures. The same rules as Operativa: no cost, no week's or month's budget.
 */
const PRESIDIO_LAYOUT = Object.freeze({
  version: 2,
  prefs: Object.freeze({ costs: false }),
  views: Object.freeze({
    adesso: Object.freeze({
      widgets: Object.freeze([
        w("w-pr-a-budget", "budget", 0, 0, 6, 4, { style: "C19", period: "day" }),
        w("w-pr-a-tokens", "kpi", 6, 0, 3, 4, { style: "B11", metric: "tokens" }),
        w("w-pr-a-cache", "kpi", 9, 0, 3, 4, { style: "B12", metric: "cache" }),
        w("w-pr-a-hours", "hero", 0, 4, 6, 6, { style: "G1" }),
        w("w-pr-a-models", "model-day", 6, 4, 6, 6, { style: "classic" }),
        w("w-pr-a-sessions", "day-sessions", 0, 10, 6, 6),
        w("w-pr-a-flow", "flow", 6, 10, 6, 6, { style: "B7", range: "day" }),
        w("w-pr-a-runs", "runs", 0, 16, 12, 8, { style: "T5", range: "day", ...RECENT, cols: ["ora", "sessione", "modello", "esito", "durata", "ttft", "tps", "step", "tool", "token", "cache"] }),
      ]),
    }),
    analisi: Object.freeze({
      widgets: Object.freeze([
        w("w-pr-n-cache", "gauge", 0, 0, 4, 5, { style: "semi", source: "cache" }),
        w("w-pr-n-failed", "gauge", 4, 0, 4, 5, { style: "semi", source: "failed-steps" }),
        w("w-pr-n-tool-errors", "gauge", 8, 0, 4, 5, { style: "semi", source: "tool-errors" }),
        w("w-pr-n-tokens", "trend", 0, 5, 6, 5, { style: "G3", metric: "tokens" }),
        w("w-pr-n-steps", "trend", 6, 5, 6, 5, { style: "G4", metric: "steps", by: "total" }),
        w("w-pr-n-funnel", "run-stats", 0, 10, 6, 6, { style: "C8" }),
        w("w-pr-n-dimension", "breakdown", 6, 10, 6, 6, { style: "C21" }),
        w("w-pr-n-change", "breakdown", 0, 16, 6, 5, { style: "B8", title: N_("Rispetto al periodo prima") }),
        w("w-pr-n-projects", "breakdown", 6, 16, 6, 5, { style: "B6", by: "directory", title: N_("Per progetto") }),
        w("w-pr-n-histogram", "run-stats", 0, 21, 6, 5, { style: "G8" }),
        w("w-pr-n-model-ttft", "speed", 6, 21, 6, 5, { style: "B9" }),
        w("w-pr-n-tools", "tools", 0, 26, 12, 7),
        w("w-pr-n-heavy", "runs", 0, 33, 12, 9, { style: "T9", ...HEAVY, title: N_("Prompt più pesanti"), cols: ["progetto", "modello", "esito", "durata", "ttft", "step", "tool", "cache", "quota"] }),
        // the fixed windows, apart from the widgets that follow the filter
        w("w-pr-n-seven-days", "run-stats", 0, 42, 6, 7, { style: "classic", range: "604800000", title: N_("Ultimi 7 giorni · prompt e durate") }),
        w("w-pr-n-thirty-days", "run-stats", 6, 42, 6, 7, { style: "classic", range: "2592000000", title: N_("Ultimi 30 giorni · prompt e durate") }),
        w("w-pr-n-ttft-history", "speed", 0, 49, 4, 5, { style: "C2", title: N_("Primo token · 30 giorni") }),
        w("w-pr-n-reliability", "status", 4, 49, 4, 5, { style: "C17", title: N_("Affidabilità · 30 giorni") }),
        w("w-pr-n-rhythm", "rhythm", 8, 49, 4, 5, { style: "G5", title: N_("Ritmo · 28 giorni") }),
      ]),
    }),
    // exactly 18 rows
    monitor: Object.freeze({
      widgets: Object.freeze([
        w("w-pr-m-tokens", "kpi", 0, 0, 3, 5, { style: "C20", metric: "tokens" }),
        w("w-pr-m-budget", "gauge", 3, 0, 3, 5, { style: "semi", source: "budget-day-tokens" }),
        w("w-pr-m-failed", "gauge", 6, 0, 3, 5, { style: "semi", source: "failed-steps" }),
        w("w-pr-m-tool-errors", "gauge", 9, 0, 3, 5, { style: "semi", source: "tool-errors" }),
        w("w-pr-m-live", "live", 0, 5, 4, 7, { cost: "no" }),
        w("w-pr-m-feed", "feed", 4, 5, 5, 7, { style: "T4", ...OPS_FEED }),
        w("w-pr-m-status", "status", 9, 5, 3, 7, { style: "C18" }),
        w("w-pr-m-hours", "hero", 0, 12, 6, 6, { style: "G4" }),
        w("w-pr-m-models", "model-day", 6, 12, 6, 6, { style: "B6" }),
      ]),
    }),
  }),
});

/**
 * The ready-made arrangements of the three views, chosen from the sidebar («Modello»): id → label, one
 * line on the whole and one per view (the popover next to the menu), the layout. The first is the one
 * the menu lists first; DEFAULT_LAYOUT (a fresh install) is «classica».
 */
export const TEMPLATES = Object.freeze({
  consigliata: Object.freeze({
    label: N_("Consigliata"),
    description: N_("Ogni vista ha un ruolo e un orizzonte suo: la giornata da vicino, il periodo dei filtri, la lettura da lontano."),
    views: Object.freeze({
      adesso: N_("Token, costo e cache di oggi contro la media, i tre budget, ora per ora e per modello con il ritmo, il prompt in corso, le sessioni e i prompt di oggi."),
      analisi: N_("Riepilogo, andamento e modelli, dove vanno token e costo, distribuzione e velocità, i prompt più pesanti, tool e permessi; in fondo ritmo, anno, mese e affidabilità."),
      monitor: N_("Cifre grandi da leggere a distanza: oggi con il budget, il prompt in corso, i cinque indicatori, i modelli, l'attività e lo stato."),
    }),
    layout: RECOMMENDED_LAYOUT,
  }),
  operativa: Object.freeze({
    label: N_("Operativa"),
    description: N_("Per chi lavora con l'agente tutto il giorno: utilizzo e budget del giorno, salute dell'agente, dove si perde tempo. Niente costi, settimane o mesi."),
    views: Object.freeze({
      adesso: N_("Quanto resta del budget del giorno e a che ritmo, token e prompt contro la media, ora per ora e per modello, dove vanno i token, le sessioni e i prompt di oggi."),
      analisi: N_("Cache, step falliti ed errori dei tool del periodo; token nel tempo, modelli e progetti, cosa è cambiato, primo token e velocità, tool, i prompt più pesanti; in fondo ritmo e affidabilità."),
      monitor: N_("Da lontano: budget del giorno, step falliti ed errori dei tool a semaforo, la velocità, il prompt in corso, esiti, errori, retry e permessi, i modelli, lo stato e le ore di oggi."),
    }),
    layout: OPERATIONS_LAYOUT,
  }),
  presidio: Object.freeze({
    label: N_("Presidio"),
    description: N_("Budget di oggi, diagnosi del periodo e segnali operativi leggibili a distanza, senza costi né budget di settimana e mese."),
    views: Object.freeze({
      adesso: N_("Residuo e ritmo del budget giornaliero, token e cache contro la norma, ore, modelli, sessioni e prompt di oggi."),
      analisi: N_("Con i filtri: errori, token e step, esiti, modelli e progetti, distribuzione, primo token, tool e i più pesanti; in fondo ultimi 7 e 30 giorni, primo token, affidabilità e ritmo."),
      monitor: N_("Una schermata: token, budget di oggi, step falliti ed errori dei tool, il prompt in corso, eventi, stato, ore e modelli leggibili da lontano."),
    }),
    layout: PRESIDIO_LAYOUT,
  }),
  classica: Object.freeze({
    label: N_("Classica"),
    description: N_("La disposizione delle versioni fino alla 0.20: le tessere di oggi in cima a ogni vista, Adesso e Monitor simili."),
    views: Object.freeze({
      adesso: N_("Indicatori di token e cache, budget e stato; oggi e per modello; prompt in corso, attività e flusso dei token; i prompt di oggi."),
      analisi: N_("Riepilogo, andamento e ora per ora per modello, ritmo e quota per modello, sessioni della giornata e tabella dei modelli, i più pesanti."),
      monitor: N_("Token, budget e stato; per modello e oggi; registro a terminale e flusso dei token."),
    }),
    layout: DEFAULT_LAYOUT,
  }),
});

// a widget as a template compares it: no id (a reset may rename it), the style spelled out, settings in key order
const shape = (wd) => {
  const settings = { ...wd.settings, style: styleOf(wd) };
  const sorted = Object.fromEntries(Object.keys(settings).filter((k) => settings[k] !== undefined).sort().map((k) => [k, settings[k]]));
  return JSON.stringify([wd.type, wd.x, wd.y, wd.w, wd.h, sorted]);
};
const viewShape = (view) => (Array.isArray(view?.widgets) ? view.widgets.map(shape).sort().join("\n") : null);

/**
 * Whether a widget shows nothing but a cost (an Indicatore, a Budget or a Gauge of cost, the cost waterfall
 * C9, a trend or calendar fixed on cost): with «Mostra i costi» off it draws an empty state instead.
 */
export const costOnly = (wd) => {
  const s = wd?.settings ?? {};
  return ((wd?.type === "kpi" || wd?.type === "budget") && s.metric === "cost") || (wd?.type === "gauge" && /-cost$/.test(s.source ?? "")) || (wd?.type === "breakdown" && styleOf(wd) === "C9") || ((wd?.type === "trend" || wd?.type === "calendar") && s.metric === "cost");
};

/** Whether `layout` shows costs: its `prefs.costs`, true when absent (every layout before the switch). */
export const costsShown = (layout) => layout?.prefs?.costs !== false;

/**
 * Whether two layouts show the same three views (ids, order and the implicit first style aside) and
 * agree on showing costs. A layout without views never matches.
 */
export function sameLayout(a, b) {
  if (!a?.views || typeof a.views !== "object" || !b?.views || typeof b.views !== "object") return false;
  return costsShown(a) === costsShown(b) && VIEWS.every((v) => viewShape(a.views[v]) !== null && viewShape(a.views[v]) === viewShape(b.views[v]));
}

/** The id of the template `layout` matches in all three views (ids aside) and in showing costs, or null: a personal arrangement. */
export function templateOf(layout) {
  for (const [id, t] of Object.entries(TEMPLATES)) if (sameLayout(layout, t.layout)) return id;
  return null;
}

/** Where a layout started from, saved in `prefs.origin`: «t:<template id>» or «p:<preset id>». */
export const ORIGIN = /^(t|p):[a-z0-9-]{1,40}$/i;

/** The valid `prefs.origin` of `layout`, or null. */
export const originOf = (layout) => (typeof layout?.prefs?.origin === "string" && ORIGIN.test(layout.prefs.origin) ? layout.prefs.origin : null);

/** A copy of `layout` with `prefs.origin` set (null removes it, and `prefs` too when nothing else is left). */
export function withOrigin(layout, origin) {
  const { origin: _old, ...rest } = layout?.prefs ?? {};
  const prefs = origin === null ? rest : { ...rest, origin };
  const { prefs: _prefs, ...others } = layout ?? {};
  return Object.keys(prefs).length ? { ...others, prefs } : others;
}

/**
 * `layout` with the three views of template `id`, as a fresh unfrozen copy; the views of a newer
 * version it may carry stay as they are.
 */
export function applyTemplate(layout, id) {
  const tpl = TEMPLATES[id];
  if (!tpl) throw new Error(t("modello sconosciuto «{id}»", { id }));
  const own = structuredClone(tpl.layout.views);
  // the template's choice on costs, and where the layout started from; other preferences (a newer version's) stay as they were
  const prefs = { ...(layout?.prefs ?? {}), costs: costsShown(tpl.layout), origin: `t:${id}` };
  return { version: 2, views: { ...(layout?.views ?? {}), ...own }, prefs };
}

const ID = /^[a-z0-9-]{1,40}$/i;
const TYPE = /^[a-z][a-z0-9-]{0,30}$/;
const known = (wd) => Object.hasOwn(WIDGET_TYPES, wd.type);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// settings deep: list settings (`cols`) must not be shared with the input, nor stay frozen as in DEFAULT_LAYOUT
const copy = (wd) => ({ id: wd.id, type: wd.type, x: wd.x, y: wd.y, w: wd.w, h: wd.h, settings: structuredClone(wd.settings) });

/** The shape problem of a widget list that stops validation early, if any. */
function listError(list, prefix) {
  if (!Array.isArray(list)) return t("{prefix}widgets deve essere una lista", { prefix });
  // stop here: the checks that follow are per widget and per pair, and the server runs them on any body it gets
  if (list.length > MAX_WIDGETS) return t("{prefix}al massimo {max} widget, trovati {n}", { prefix, max: MAX_WIDGETS, n: list.length });
  return null;
}

/**
 * The problems of one grid of widgets, each naming the widget and prefixed with `prefix`
 * ("Adesso · "); `seen` collects ids across views. Types not in `types` are kept untouched.
 */
function validateWidgets(list, prefix, seen, types = WIDGET_TYPES) {
  const errors = [];
  const isKnown = (wd) => Object.hasOwn(types, wd.type);
  const good = [];
  for (const [i, wd] of list.entries()) {
    if (!isObject(wd)) {
      errors.push(t("{prefix}widget {n}: deve essere un oggetto", { prefix, n: i + 1 }));
      continue;
    }
    const name = t("{prefix}widget {id}", { prefix, id: typeof wd.id === "string" ? wd.id : t("n. {n}", { n: i + 1 }) });
    const before = errors.length;
    if (typeof wd.id !== "string" || !ID.test(wd.id)) errors.push(t("{name}: id non valido (lettere, cifre e -, al massimo 40)", { name }));
    else if (seen.has(wd.id)) errors.push(t("{name}: id ripetuto", { name }));
    else seen.add(wd.id);
    if (typeof wd.type !== "string" || !TYPE.test(wd.type)) errors.push(t("{name}: tipo non valido", { name }));
    const ints = ["x", "y", "w", "h"].every((k) => Number.isInteger(wd[k]));
    if (!ints) errors.push(t("{name}: x, y, w e h devono essere interi", { name }));
    else if (wd.x < 0 || wd.w < 1 || wd.x + wd.w > COLS || wd.y < 0 || wd.y > MAX_Y || wd.h < 1 || wd.h > MAX_H) {
      errors.push(t("{name}: fuori dalla griglia ({cols} colonne, righe 0–{maxY}, altezza 1–{maxH})", { name, cols: COLS, maxY: MAX_Y, maxH: MAX_H }));
    }
    if (!isObject(wd.settings)) errors.push(t("{name}: settings deve essere un oggetto", { name }));
    else if (isKnown(wd)) {
      const ty = types[wd.type];
      if (ints && (wd.w < ty.min[0] || wd.h < ty.min[1])) errors.push(t("{name}: più piccolo del minimo {w} × {h}", { name, w: ty.min[0], h: ty.min[1] }));
      for (const [k, v] of Object.entries(wd.settings)) {
        const spec = ty.settings[k];
        if (!Object.hasOwn(ty.settings, k)) errors.push(t("{name}: impostazione sconosciuta «{key}»", { name, key: k }));
        else if (spec === null) {
          if (typeof v !== "string" || v.length > MAX_TITLE) errors.push(t("{name}: {key} deve essere un testo di al massimo {max} caratteri", { name, key: k, max: MAX_TITLE }));
        } else if (spec.set) {
          // a set: distinct allowed values, in any order
          const bad = Array.isArray(v) ? v.findIndex((x) => !spec.set.includes(x)) : -1;
          if (!Array.isArray(v)) errors.push(t("{name}: {key} deve essere un elenco", { name, key: k }));
          else if (bad >= 0) errors.push(t("{name}: {key} «{value}» non ammesso", { name, key: k, value: v[bad] }));
          else if (new Set(v).size !== v.length) errors.push(t("{name}: {key} ha dei doppioni", { name, key: k }));
        } else if (!spec.includes(v)) errors.push(t("{name}: {key} «{value}» non ammesso", { name, key: k, value: v }));
      }
    }
    if (errors.length === before) good.push(wd);
  }
  const placed = good.filter(isKnown);
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) if (hits(placed[i], placed[j])) errors.push(t("{prefix}widget sovrapposti: {a} e {b}", { prefix, a: placed[i].id, b: placed[j].id }));
  return errors;
}

const failed = (errors) =>
  errors.length > MAX_ERRORS ? { ok: false, errors: [...errors.slice(0, MAX_ERRORS), t("… e altri {n} errori", { n: errors.length - MAX_ERRORS })] } : { ok: false, errors };

/**
 * The views of a v2, with the default «Monitor» when it has none (saved before it existed): a
 * default id already used in another view gets a new one. Spread, not assignment: a "__proto__"
 * key from JSON stays an ordinary key.
 */
function withMonitor(views) {
  if (Object.hasOwn(views, "monitor")) return views;
  const taken = new Set(Object.values(views).flatMap((v) => (isObject(v) && Array.isArray(v.widgets) ? v.widgets.map((wd) => wd?.id) : [])));
  const widgets = DEFAULT_LAYOUT.views.monitor.widgets.map((wd) => (taken.has(wd.id) ? { ...wd, id: newId() } : wd));
  return { ...views, monitor: { widgets } };
}

/** The styles that no longer exist, by type, and the one a widget saved with them takes (the type's first, or the closest). */
const RETIRED_STYLES = Object.freeze({ summary: Object.freeze({ classic: "C22" }), gauge: Object.freeze({ ring: "B2" }), hero: Object.freeze({ C6: "G1" }) });

/** `settings` of a widget of `type` with a retired style replaced by its successor; the same object when there is none. */
export function withoutRetiredStyle(type, settings) {
  const table = Object.hasOwn(RETIRED_STYLES, type) ? RETIRED_STYLES[type] : null;
  const style = table && isObject(settings) ? settings.style : undefined;
  return typeof style === "string" && Object.hasOwn(table, style) ? { ...settings, style: table[style] } : settings;
}

/**
 * `views` with the widgets of a retired style moved to its replacement, in every view of VIEWS: a
 * layout saved before the style went is read as the new one. `views` and its widgets stay as they are.
 */
function retireStyles(views) {
  const out = { ...views };
  for (const v of VIEWS) {
    if (!isObject(out[v]) || !Array.isArray(out[v].widgets)) continue;
    const widgets = out[v].widgets.map((wd) => {
      const settings = isObject(wd) ? withoutRetiredStyle(wd.type, wd.settings) : null;
      return settings && settings !== wd.settings ? { ...wd, settings } : wd;
    });
    out[v] = { ...out[v], widgets };
  }
  return out;
}

function validateV2(doc) {
  if (!isObject(doc.views)) return failed([t("views deve essere un oggetto")]);
  const all = retireStyles(withMonitor(doc.views));
  const prefix = (v) => `${t(VIEW_LABELS[v])} · `;
  const heads = VIEWS.map((v) => (isObject(all[v]) ? listError(all[v].widgets, prefix(v)) : t("{prefix}vista mancante", { prefix: prefix(v) }))).filter(Boolean);
  if (heads.length) return failed(heads);
  const seen = new Set();
  const errors = VIEWS.flatMap((v) => validateWidgets(all[v].widgets, prefix(v), seen));
  // views of a newer version: kept as they are, the version that knows them validates them
  // (fromEntries, not assignment: a "__proto__" key from JSON stays an ordinary key);
  // only their ids are checked here, since ids are unique across all views
  const others = Object.entries(all).filter(([k]) => !VIEWS.includes(k));
  for (const [k, v] of others) {
    if (!isObject(v) || !Array.isArray(v.widgets)) continue;
    for (const wd of v.widgets) {
      if (!isObject(wd) || typeof wd.id !== "string") continue;
      if (seen.has(wd.id)) errors.push(t("{view} · widget {id}: id ripetuto", { view: k, id: wd.id }));
      else seen.add(wd.id);
    }
  }
  // the preferences saved with the layout: `costs` (show the costs, «Mostra i costi»), and any key of a
  // newer version kept as it is
  if (doc.prefs !== undefined) {
    if (!isObject(doc.prefs)) errors.push(t("prefs deve essere un oggetto"));
    else {
      if (doc.prefs.costs !== undefined && typeof doc.prefs.costs !== "boolean") errors.push(t("prefs.costs deve essere true o false"));
      // any text up to 80 characters: a format of a newer version is kept as it is (originOf says whether it names something here)
      if (doc.prefs.origin !== undefined && (typeof doc.prefs.origin !== "string" || doc.prefs.origin.length > 80)) errors.push(t("prefs.origin deve essere un testo di al massimo 80 caratteri"));
    }
  }
  if (errors.length) return failed(errors);
  const views = Object.fromEntries([...VIEWS.map((v) => [v, { widgets: all[v].widgets.map(copy) }]), ...others.map(([k, v]) => [k, structuredClone(v)])]);
  return { ok: true, layout: { version: 2, views, ...(doc.prefs === undefined ? {} : { prefs: structuredClone(doc.prefs) }) }, migrated: false };
}

/**
 * Every problem at once, in Italian, naming the view and the widget. Accepts v1 (checked against
 * the v1 catalogue, then migrated: `migrated: true`) and v2; `layout` is always v2, with the three
 * views (a v2 without «Monitor» gets the default one, and stays `migrated: false`).
 * Unknown widget types and unknown views are kept untouched.
 */
export function validateLayout(doc) {
  if (!isObject(doc)) return failed([t("la disposizione deve essere un oggetto")]);
  if (doc.version === 2) return validateV2(doc);
  if (doc.version !== 1) return failed([t("versione {version} non supportata (atteso 1 o 2)", { version: JSON.stringify(doc.version) })]);
  const head = listError(doc.widgets, "");
  if (head) return failed([head]);
  const errors = validateWidgets(doc.widgets, "", new Set(), V1_TYPES);
  if (errors.length) return failed(errors);
  const r = validateV2(migrateLayout(doc));
  return r.ok ? { ...r, migrated: true } : r;
}

const order = (a, b) => a.y - b.y || a.x - b.x;

/** Rebuilds the list in its original order from the id → widget map; unknown types stay as they are. */
const rebuild = (widgets, out) => widgets.map((wd) => out.get(wd.id) ?? { ...wd });

// Widgets of a type this version does not know (saved by a newer one) never move:
// the others flow around them, so the newer version finds its layout intact.
const obstacles = (widgets) => widgets.filter((x) => !known(x));

/** Moves `wd` down until it overlaps nothing in `placed`. */
function below(wd, placed) {
  for (let blocker = placed.find((p) => hits(wd, p)); blocker; blocker = placed.find((p) => hits(wd, p))) wd.y = blocker.y + blocker.h;
  return wd;
}

/** Places `fixed` where asked and pushes down, in (y, x) order, whatever it or a pushed widget overlaps. */
function pushDown(widgets, fixed) {
  // the widget being placed does not block itself: one of a type nobody here knows (a module's) is an obstacle at its old place
  const placed = obstacles(widgets).filter((x) => x.id !== fixed.id);
  const first = below({ ...fixed }, placed);
  placed.push(first);
  const out = new Map([[first.id, first]]);
  for (const wd of widgets.filter((x) => known(x) && x.id !== fixed.id).sort(order)) {
    const next = below({ ...wd }, placed);
    placed.push(next);
    out.set(wd.id, next);
  }
  return rebuild(widgets, out);
}

/** Every widget moves up, in (y, x) order, until it touches the top or a widget above it: never past one. */
export function compact(widgets) {
  const placed = obstacles(widgets);
  const out = new Map();
  for (const wd of widgets.filter(known).sort(order)) {
    const next = below({ ...wd }, placed); // a hand-edited file may already overlap
    while (next.y > 0 && !placed.some((p) => hits({ ...next, y: next.y - 1 }, p))) next.y--;
    placed.push(next);
    out.set(wd.id, next);
  }
  return rebuild(widgets, out);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fits = (widgets) => widgets.every((k) => !known(k) || k.y <= MAX_Y);

/**
 * The editing gestures (move, resize, add) refuse a result validateLayout would reject because a
 * widget got pushed past the last row: they return the input list itself, so callers can tell
 * (`result === widgets`). A layout that was already past it (hand-edited) is not held back.
 */
const withinGrid = (before, after) => (fits(after) || !fits(before) ? after : before);

// The gestures place freely, as the «float» grids do (Gridstack, Grafana's free layout): a widget
// stays where it is dropped, empty rows above it included; only what it overlaps is pushed down.
// Nothing floats up on its own: «Compatta» (compact) closes the gaps when asked.

export function moveWidget(widgets, id, x, y) {
  const wd = widgets.find((k) => k.id === id);
  if (!wd) return widgets.map((k) => ({ ...k }));
  const moved = { ...wd, x: clamp(Math.round(x), 0, COLS - wd.w), y: clamp(Math.round(y), 0, MAX_Y) };
  return withinGrid(widgets, pushDown(widgets, moved));
}

/** `min` is [w, h] for a type this file does not know (a module's, from its spec); the catalogue's by default. */
export function resizeWidget(widgets, id, w, h, min = null) {
  const wd = widgets.find((k) => k.id === id);
  if (!wd) return widgets.map((k) => ({ ...k }));
  const [minW, minH] = min ?? WIDGET_TYPES[wd.type]?.min ?? [1, 1];
  const resized = { ...wd, w: clamp(Math.round(w), minW, COLS - wd.x), h: clamp(Math.round(h), minH, MAX_H) };
  return withinGrid(widgets, pushDown(widgets, resized));
}

/** Whether one more widget still makes a layout validateLayout accepts. */
export const canAdd = (widgets) => widgets.length < MAX_WIDGETS;

/** Where «Aggiungi» puts a widget: a corner of the view (the top ones push the others down). */
export const PLACES = ["top-left", "top-right", "bottom-left", "bottom-right"];

/**
 * The cell where a new `w`-wide widget goes for `at`: a corner of PLACES, or { x, y } (a cell picked on
 * the grid, clamped to it). The bottom corners are under the lowest widget.
 */
export function placeFor(widgets, w, at = "bottom-left") {
  if (at && typeof at === "object") return { x: clamp(Math.round(at.x), 0, COLS - w), y: clamp(Math.round(at.y), 0, MAX_Y) };
  const bottom = widgets.reduce((m, k) => Math.max(m, k.y + k.h), 0);
  const right = at === "top-right" || at === "bottom-right";
  return { x: right ? COLS - w : 0, y: at === "top-left" || at === "top-right" ? 0 : bottom };
}

/**
 * A new widget at `at` (placeFor), with the size of its style; whatever it overlaps is pushed down.
 * At MAX_WIDGETS, or past the last row, `widgets` itself comes back (refused).
 */
export function addWidget(widgets, type, settings = {}, id = newId(), at = "bottom-left", size = null) {
  if (!canAdd(widgets)) return widgets;
  const [wd, h] = size ?? sizeOf(type, styleOf({ type, settings })); // `size`: a type this file does not know (a module's, from its spec); else the size of the style asked for
  const { x, y } = placeFor(widgets, wd, at);
  const added = { id, type, x, y, w: wd, h, settings: { ...settings } };
  return withinGrid(widgets, pushDown([...widgets, added], added));
}

/** The widget goes, its place stays empty (free layout: «Compatta» closes the gap). */
export function removeWidget(widgets, id) {
  return widgets.filter((k) => k.id !== id).map((k) => ({ ...k }));
}

/** Reading order for narrow screens: by row, then by column. */
export function stackOrder(widgets) {
  return [...widgets].sort(order).map((k) => k.id);
}

export function newId() {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `w-${[...bytes].map((b) => abc[b % abc.length]).join("")}`;
}

/** Sessions per page at most: a shorter `sessions` widget pages fewer, the ones that fit (sessionsPage). */
export const SESSIONS_PAGE = 10;
/** Prompts per page at most: a shorter `runs` widget pages fewer, the ones that fit (runsPage). */
export const RUNS_PAGE = 10;
// `runs` and `sessions` geometry: card padding, head, pager and table header around the rows, and
// one row at most (two text lines, or a count with its badge); compact rows are one line
const PAGED_CHROME_PX = 144;
const PAGED_ROW_PX = 56;
const RUNS_COMPACT_CHROME_PX = 120;
const RUNS_COMPACT_ROW_PX = 34;
// `runs` drawn by a table model (widgets-styled.js): card padding, head and pager around the
// figure, then per style [what sits over the rows (table header, T10's chart), one row at most],
// as drawn at density «comoda»
const STYLED_CHROME_PX = 120;
const STYLED_ROWS = Object.freeze({ T5: [30, 40], T7: [30, 42], T8: [30, 44], T11: [30, 44], T12: [30, 48], T6: [0, 92], T9: [0, 88], T10: [160, 40] });

/** Height in pixels of a widget of `type`, from its height in grid rows (the catalogue's if missing). */
function heightPx(widget, type) {
  const h = Number.isInteger(widget?.h) && widget.h > 0 ? widget.h : WIDGET_TYPES[type].size[1];
  return h * ROW_PX + (h - 1) * GAP_PX;
}
/** Two-line rows that fit `px` under the paged tables' chrome: 1 to `max`. */
const pagedRows = (px, max) => Math.min(max, Math.max(1, Math.floor((px - PAGED_CHROME_PX) / PAGED_ROW_PX)));

/**
 * Rows of a `runs` widget, from its height in grid rows (kept on narrow screens too): `size`
 * per page, the ones that fit up to RUNS_PAGE (rows of the style's height for a table model), so
 * the table never scrolls inside the widget.
 * `compact`: «Più pesanti» too short for a full page of RUNS_PAGE shows the top `size` (up to
 * RUNS_PAGE) on one line each, without pager; a taller widget never shows fewer rows.
 */
export function runsPage(widget) {
  const px = heightPx(widget, "runs");
  // the rows of the widget's style (a table model), or the classic two-line rows
  const rows = STYLED_ROWS[widget?.settings?.style];
  const size = rows ? Math.min(RUNS_PAGE, Math.max(1, Math.floor((px - STYLED_CHROME_PX - rows[0]) / rows[1]))) : pagedRows(px, RUNS_PAGE);
  if (widget?.settings?.sort === "tokens" && size < RUNS_PAGE) {
    return { size: Math.min(RUNS_PAGE, Math.max(3, Math.floor((px - RUNS_COMPACT_CHROME_PX) / RUNS_COMPACT_ROW_PX))), compact: true };
  }
  return { size, compact: false };
}

/** Sessions per page of a `sessions` widget: the ones that fit its height, up to SESSIONS_PAGE. */
export const sessionsPage = (widget) => pagedRows(heightPx(widget, "sessions"), SESSIONS_PAGE);

/** Rows per page of a paged widget (`runs`, `sessions`); null for the others. */
export function pageSize(widget) {
  if (widget?.type === "runs") return runsPage(widget).size;
  if (widget?.type === "sessions") return sessionsPage(widget);
  return null;
}

/** The page of `size` rows that shows row `row` (0-based): a resized widget keeps the row the user paged to in view. */
export const pageWithRow = (row, size) => (row > 0 && size > 0 ? Math.floor(row / size) : 0);

/** What requestsFor reads at page `page` with the cursors learned so far (cursors[n] opens page n; page 0 never has one). */
export const pageAt = (page = 0, cursors = null) => ({ page, cursor: page > 0 ? (cursors?.[page] ?? null) : null });

/** The cursors after a read of page `page` that sent `next` (x-next-cursor or null): kept up to `page`, plus page+1 when next is a non-empty string. */
export function learnCursor(cursors, page, next) {
  const out = Array.from({ length: page + 1 }, (_, i) => (i === 0 ? null : (cursors?.[i] ?? null)));
  if (typeof next === "string" && next !== "") out[page + 1] = next;
  return out;
}

/** A page past the first read by cursor that came back empty: the rows moved under the cursor, read it by offset. */
export const staleCursor = (at, rows) => Boolean(at.cursor) && at.page > 0 && Array.isArray(rows) && rows.length === 0;

const DAY_MS = 86_400_000;
/** `runs` styles of the heaviest prompts, and `run-stats` styles drawn from the prompts themselves. */
const HEAVY_STYLES = ["T9", "T10", "T11", "T12"];
const PROMPT_STYLES = ["C10", "C11", "C12", "G7"];

/**
 * API paths a widget needs, with its settings resolved against the view's filters (`global`:
 * the page filters in Analisi, VIEW_GLOBALS in Adesso and Monitor) at time `now`; the style
 * (absent = the first of the type) adds what its model needs. `at` is the page of a paged widget:
 * a number (read by offset) or `{ page, cursor }` (pageAt: by cursor when one is known).
 */
export function requestsFor(widget, global, now, at = 0) {
  const { page, cursor } = typeof at === "number" ? { page: at, cursor: null } : { page: at?.page ?? 0, cursor: at?.cursor ?? null };
  // the rows of the page: after the last one of the page before (x-next-cursor), or by their position
  const slice = (size) => (cursor ? `limit=${size}&cursor=${encodeURIComponent(cursor)}` : `limit=${size}&offset=${page * size}`);
  const { range, metric, by } = resolveSettings(widget, global);
  const from = range === "day" ? "from=day" : `from=${range === 0 ? 0 : now - range}`;
  const style = styleOf(widget);
  switch (widget.type) {
    case "kpi":
      return ["/api/summary?from=day", "/api/daily?days=14", "/api/hourly?days=7"];
    case "budget":
      return style === "C1" ? ["/api/budget", "/api/daily?days=31"] : ["/api/budget"];
    case "flow":
      return [`/api/breakdown?${from}&by=model`];
    case "status":
      return style === "C17" ? ["/api/daily?days=30"] : ["/api/status", "/api/budget"];
    case "speed":
      if (style === "B9") return [`/api/breakdown?${from}&by=model`];
      if (style === "B4") return [`/api/summary?${from}`];
      return ["/api/daily?days=30"];
    case "rhythm":
      return ["/api/rhythm?days=28"];
    case "day-sessions":
      // the most recent 1000 runs (the server's cap), drawn from the budget day's start (/api/budget)
      return ["/api/runs?from=day&limit=1000&steps=1", "/api/budget"];
    case "hero":
      return ["/api/budget", "/api/hourly?days=7", "/api/summary?from=day"];
    case "model-day":
      // C3: today hour by hour, one small chart per model
      if (style === "C3") return ["/api/timeseries?from=day&metric=tokens&by=model"];
      return ["/api/breakdown?from=day&by=model", "/api/budget", "/api/summary?from=day"];
    case "kpis":
      return ["/api/summary?from=day", "/api/daily?days=7", "/api/tools?from=day", "/api/runs/live"];
    case "live":
      return ["/api/runs/live"];
    case "runs": {
      const { size } = runsPage(widget);
      const steps = style === "T6" || style === "T11" ? "&steps=1" : ""; // their step strip and sparkline
      // «Solo con problemi» of the prompt tables (T5-T8): filtered by the server, before the page
      const only = style !== "classic" && !HEAVY_STYLES.includes(style) && widget.settings?.only === "problemi" ? "&only=problemi" : "";
      const list = `/api/runs?${from}&${slice(size)}&sort=${widget.settings?.sort ?? "recent"}${steps}${only}`;
      // the heaviest prompts (T9-T12) give each one's share of the period: its totals too
      return HEAVY_STYLES.includes(style) ? [list, `/api/summary?${from}`] : [list];
    }
    case "run-stats":
      // the per-prompt styles draw the prompts themselves, the most recent 1000 (the server's cap: past
      // it the model says it is a sample, from x-total-count); the others the summary of all of them
      return PROMPT_STYLES.includes(style) ? [`/api/runs?${from}&limit=1000`] : [`/api/runs/summary?${from}`];
    case "calendar":
      return [`/api/calendar?metric=${metric}`];
    case "summary":
      return [`/api/summary?${from}`];
    case "trend":
      // C5 compares yesterday with today: day buckets, which need more than two days (or the
      // server buckets by hour); the last two of the four are yesterday and today
      if (style === "C5") return [`/api/timeseries?from=${now - 3 * DAY_MS}&metric=${metric}&by=${by}`];
      return [`/api/timeseries?${from}&metric=${metric}&by=${by}`];
    case "interaction":
      return [`/api/activity?${from}`, `/api/summary?${from}`];
    case "breakdown": {
      const current = `/api/breakdown?${from}&by=${by}`;
      // B8 and C21 compare with the period before, of the same length: only a period of fixed
      // length has one (the server ignores `to` with from=day, and «tutto» has nothing before)
      if ((style !== "B8" && style !== "C21") || typeof range !== "number" || range <= 0) return [current];
      return [current, `/api/breakdown?from=${now - 2 * range}&to=${now - range}&by=${by}`];
    }
    case "tools":
      return [`/api/tools?${from}`];
    case "sessions": {
      const size = sessionsPage(widget);
      return [`/api/sessions?${from}&${slice(size)}`];
    }
    case "gauge":
      return (widget.settings?.source ?? "budget-day-tokens").startsWith("budget-") ? ["/api/budget"] : [`/api/summary?${from}`];
    case "feed":
      // the events come live (ctx.feed); the tables name their sessions, from today's list
      return style !== "classic" && widget.settings?.session !== "no" ? ["/api/sessions?from=day&limit=100"] : [];
    default:
      return []; // types this version does not know
  }
}

/**
 * Every path the widgets need, once: widgets with the same settings share a request. `pages[id]`: a number or
 * `{ page, cursor }`. `requests`: the paths of one widget (the grid passes one that also knows the modules' types).
 */
export function collectRequests(widgets, global, now, pages = {}, requests = requestsFor) {
  return [...new Set(widgets.flatMap((wd) => requests(wd, global, now, pages[wd.id] ?? 0)))];
}

/**
 * The widget's period, metric and grouping, falling back to the view's filters for "dashboard" or
 * missing. The period is milliseconds back from now (0 = everything) or "day", the budget day.
 */
export function resolveSettings(widget, global) {
  const s = widget.settings ?? {};
  const pick = (k) => (s[k] === undefined || s[k] === "dashboard" ? global[k] : s[k]);
  const range = s.range === undefined || s.range === "dashboard" ? global.range : s.range === "day" ? "day" : Number(s.range);
  return { range, metric: pick("metric"), by: pick("by") };
}
