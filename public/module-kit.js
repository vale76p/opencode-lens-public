// The core's API for the browser side of modules, imported by them as the absolute specifier "/module-kit.js".
export { esc } from "./draw.js";
export { getLang, getLocale, N_, t, tc, tn } from "./i18n.js";
export { canApply, createChoice, createPrefs, createRedraw, createSaveGate } from "./kit.js";
export { bindRadio } from "./kit-dom.js";
export { MODELS as GAUGE_MODELS } from "./models-gauges.js";
export { MODELS as TIME_MODELS } from "./models-time.js";
export { showCosts } from "./prefs.js";
export { onActivate, swapRows } from "./session-detail.js";
export {
  $,
  ago,
  basename,
  bytes,
  clock,
  compact,
  copyText,
  dur,
  el,
  emptyState,
  facts,
  fmtDateTime,
  fmtDayMonth,
  fmtTime,
  fmtWeekday,
  full,
  get,
  hideTip,
  money,
  nf,
  pct,
  send,
  setContext,
  setStale,
  setText,
  showTip,
  slotClass,
  stateBox,
  statusBadge,
  svg,
  table,
  WEEKDAYS,
} from "./ui.js";
export { barSpark, delta, f1, ring, slotColor, sparkSvg } from "./spark.js";
