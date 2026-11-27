// type → renderer, for every widget module. Types without one (from a newer version) stay in
// the layout, undrawn. Kept apart from widgets.js, which the other widget modules import: no cycle.
// The types with styles (layout.js STYLE_SETS) go through styled(): their classic styles keep the
// renderer of before, the others draw a model of the catalogue.
import { breakdown, calendar, feed, gauge, sessions, tools, trend } from "./widgets.js";
import { hero, kpis, live, modelDay } from "./widgets-adesso.js";
import { interaction, runStats, runs } from "./widgets-runs.js";
import { styled } from "./widgets-styled.js";

export const WIDGETS = {
  hero: styled("hero", hero),
  "model-day": styled("model-day", modelDay),
  kpis,
  live,
  feed: styled("feed", feed),
  runs: styled("runs", runs),
  "run-stats": styled("run-stats", runStats),
  trend: styled("trend", trend),
  interaction,
  summary: styled("summary"),
  calendar: styled("calendar", calendar),
  breakdown: styled("breakdown", breakdown),
  tools,
  sessions,
  gauge: styled("gauge", gauge),
  kpi: styled("kpi"),
  budget: styled("budget"),
  flow: styled("flow"),
  status: styled("status"),
  speed: styled("speed"),
  rhythm: styled("rhythm"),
  "day-sessions": styled("day-sessions"),
};
