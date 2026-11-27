// Layout v1 → v2: the one-view dashboard of version 1 becomes the two views
// «Adesso» and «Analisi». Pure and deterministic: the browser and the server
// (through validateLayout) run it on any v1 they read or receive.
//
// The import from layout.js is circular (layout.js imports migrateLayout): it is
// safe because the bindings of layout.js are only used inside functions here.
import { GAUGE_SOURCES } from "./gauge.js";
import { COLS, DEFAULT_LAYOUT, MAX_TITLE, WIDGET_TYPES, compact, withoutRetiredStyle } from "./layout.js";

// The v1 catalogue, frozen: what a version-1 layout may contain. Only what validation
// needs (minimum size, allowed settings); local literals, never layout.js bindings,
// because this runs at module load time.
const V1_RANGES = ["dashboard", "3600000", "86400000", "604800000", "2592000000", "0"];
const V1_METRICS = ["dashboard", "tokens", "cost", "steps"];
const V1_BYS = ["dashboard", "model", "agent", "provider", "kind"];
const T = { title: null };
export const V1_TYPES = Object.freeze({
  today: { min: [3, 4], settings: { ...T } },
  budget: { min: [4, 4], settings: { ...T, metric: V1_METRICS } },
  models: { min: [4, 4], settings: { ...T } },
  calendar: { min: [4, 4], settings: { ...T, metric: V1_METRICS } },
  summary: { min: [4, 3], settings: { ...T, range: V1_RANGES } },
  bars: { min: [4, 5], settings: { ...T, range: V1_RANGES, metric: V1_METRICS, by: V1_BYS } },
  activity: { min: [4, 3], settings: { ...T, range: V1_RANGES } },
  breakdown: { min: [4, 4], settings: { ...T, range: V1_RANGES, by: [...V1_BYS, "directory"] } },
  tools: { min: [4, 4], settings: { ...T, range: V1_RANGES } },
  feed: { min: [3, 4], settings: { ...T } },
  sessions: { min: [6, 6], settings: { ...T, range: V1_RANGES } },
  gauge: { min: [2, 4], settings: { ...T, range: V1_RANGES, source: GAUGE_SOURCES, model: null, style: ["semi", "ring"] } },
  line: { min: [3, 4], settings: { ...T, range: V1_RANGES, metric: V1_METRICS, by: [...V1_BYS, "total"] } },
});

const w = (id, type, x, y, wd, h) => Object.freeze({ id, type, x, y, w: wd, h, settings: Object.freeze({}) });
/** The default arrangement of version 1: a v1 equal to it becomes the v2 default. */
export const OLD_DEFAULT_V1 = Object.freeze({
  version: 1,
  widgets: Object.freeze([
    w("w-today", "today", 0, 0, 6, 5),
    w("w-calendar", "calendar", 6, 0, 6, 5),
    w("w-budget", "budget", 0, 5, 12, 4),
    w("w-models", "models", 0, 9, 12, 5),
    w("w-summary", "summary", 0, 14, 12, 6),
    w("w-bars", "bars", 0, 20, 12, 8),
    w("w-activity", "activity", 0, 28, 12, 4),
    w("w-breakdown", "breakdown", 0, 32, 12, 6),
    w("w-tools", "tools", 0, 38, 7, 8),
    w("w-feed", "feed", 7, 38, 5, 8),
    w("w-sessions", "sessions", 0, 46, 12, 12),
  ]),
});

const key = (wd) => JSON.stringify([wd.id, wd.type, wd.x, wd.y, wd.w, wd.h]);
/** Same widgets as the old default, in any order, none with a setting. */
function isOldDefault(widgets) {
  if (widgets.length !== OLD_DEFAULT_V1.widgets.length) return false;
  if (widgets.some((wd) => Object.keys(wd.settings ?? {}).length > 0)) return false;
  const want = new Set(OLD_DEFAULT_V1.widgets.map(key));
  return widgets.every((wd) => want.delete(key(wd)));
}

/** v1 type → v2 type, view, settings it gains. Types not listed keep their type and go to Analisi. */
const MAP = {
  today: { type: "hero", view: "adesso" },
  budget: { type: "hero", view: "adesso" }, // absorbed when a hero exists
  models: { type: "model-day", view: "adesso" },
  feed: { type: "feed", view: "adesso" },
  bars: { type: "trend", view: "analisi", add: { style: "columns" } },
  line: { type: "trend", view: "analisi", add: { style: "line" } },
  activity: { type: "interaction", view: "analisi" },
};

function target(wd) {
  if (Object.hasOwn(MAP, wd.type)) return MAP[wd.type];
  // a gauge without a source shows the day's token budget
  if (wd.type === "gauge" && (wd.settings?.source ?? "budget-day-tokens").startsWith("budget-")) return { type: "gauge", view: "adesso" };
  return { type: wd.type, view: "analisi" };
}

// a set setting ({ set }) is newer than any v1 widget: a v1 value for it is dropped, never kept
const allowed = (spec, v) => (spec === null ? typeof v === "string" && v.length <= MAX_TITLE : spec.set ? false : spec.includes(v));

/** The widget as `type`: size up to the type's minimum and inside the grid, only the settings the type allows. */
function fit(wd, type, add = {}) {
  const t = WIDGET_TYPES[type];
  if (!t) return { id: wd.id, type, x: wd.x, y: wd.y, w: wd.w, h: wd.h, settings: { ...wd.settings } }; // unknown: untouched
  const width = Math.min(COLS, Math.max(wd.w, t.min[0]));
  // a style that no longer exists (a v1 gauge «ring») goes to its successor before the type's allowed settings are applied
  const settings = Object.fromEntries(Object.entries(withoutRetiredStyle(type, { ...wd.settings, ...add })).filter(([k, v]) => Object.hasOwn(t.settings, k) && allowed(t.settings[k], v)));
  return { id: wd.id, type, x: Math.min(wd.x, COLS - width), y: wd.y, w: width, h: Math.max(wd.h, t.min[1]), settings };
}

/**
 * A v1 layout (already valid for the v1 catalogue) as a v2 one: every widget keeps its id,
 * title and place in its new view, then each view is compacted. A v2 comes back as a copy.
 */
export function migrateLayout(doc) {
  if (doc?.version === 2) return structuredClone(doc);
  const widgets = doc.widgets;
  if (isOldDefault(widgets)) return structuredClone(DEFAULT_LAYOUT);
  const views = { adesso: [], analisi: [] };
  let hero = widgets.some((wd) => wd.type === "today");
  for (const wd of widgets) {
    if (wd.type === "budget") {
      if (hero) continue; // its numbers are in the hero
      hero = true;
    }
    const to = target(wd);
    views[to.view].push(fit(wd, to.type, to.add));
  }
  return { version: 2, views: { adesso: { widgets: compact(views.adesso) }, analisi: { widgets: compact(views.analisi) } } };
}
