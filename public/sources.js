// The dashboard's selector for the data source a module declares (manifest `source`), the pure side (no
// DOM: tested in Node). «OpenCode», «+ {label}», «Solo {label}» change the reads that have a source side
// (SOURCE_PATH) at fetch time (ui.js getWithTotal): <id>=1 adds the source, <id>=only puts it in OpenCode's
// place, in the same shape (src/source-views.js), so no widget changes; one that needs any other read has no
// data of the source and, with «Solo», says so. It imports nothing: ui.js reads it, and boot.js loads ui.js before
// the language is set (a module with texts evaluated on import would keep them in Italian).

// this browser's choice, under lens: (kit.js createPrefs)
export const SOURCE_PREF = "source";
/** The selector's states: OpenCode alone (the dashboard as it always was), both, the source alone. */
export const CHOICES = Object.freeze(["opencode", "both", "only"]);

/**
 * The source of the active modules (`id`, `label`, from the selector's data-source-*), whether it is on in
 * the lens (`on`: /api/status carries its block) and what this browser shows (`choice`, one of CHOICES).
 * Set by app.js and shell-status.js, read by getWithTotal and by the widgets' state.
 */
export const sourceState = { id: null, label: null, on: false, choice: "opencode" };

// the reads that have a side of the source on the server, with both «+» and «Solo»: not errors nor Vibe Coding
// (slots: the colours of the models and agents of the source shown)
const SOURCE_PATH = /^\/api\/(summary|daily|hourly|tools|breakdown|timeseries|rhythm|calendar|activity|feed|runs|runs\/summary|runs\/live|sessions|sessions\/[^/?]+|slots)(\?|$)/;
// with «Solo» only: the budgets become the source's; with «+» they stay OpenCode's
const ONLY_PATH = /^\/api\/budget(\?|$)/;
// the lens's own state, the same whatever the source
const NEUTRAL_PATH = /^\/api\/status(\?|$)/;

/**
 * Whether the source is on in the lens: /api/status carries its module's block (the module is on and answers). Off
 * (the module switched off, here or in another tab, or no module with a source), every read is OpenCode's again,
 * whatever the stored choice, which comes back with the module.
 */
export const sourceOn = (status, s = sourceState) => !!s.id && !!status?.[s.id];

/** A stored choice, "opencode" for anything else. */
export const readChoice = (v) => (CHOICES.includes(v) ? v : "opencode");

const active = (s) => !!s.id && s.on && s.choice !== "opencode";

/** The path actually fetched: <id>=1 or <id>=only on the reads that have a side of the source, anything else as it is. */
export function fetchPath(path, s = sourceState) {
  if (!active(s)) return path;
  const only = s.choice === "only";
  if (!SOURCE_PATH.test(path) && !(only && ONLY_PATH.test(path))) return path;
  // never the same parameter twice (a path that already names the source is left as it is)
  if (new RegExp(`[?&]${s.id}=`).test(path)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${s.id}=${only ? "only" : "1"}`;
}

/**
 * With «Solo», whether a widget reading `paths` has nothing of the source to show: one that reads something
 * only OpenCode has. The feed reads nothing for its classic style: its events are filtered (feedAccepts).
 */
export function unsupported(paths, s = sourceState, type = null) {
  if (!s.id || !s.on || s.choice !== "only") return false;
  if (!paths.length) return type !== "feed";
  return paths.some((p) => !SOURCE_PATH.test(p) && !ONLY_PATH.test(p) && !NEUTRAL_PATH.test(p));
}

/** Whether a live feed event belongs on screen: the source's (item.source = its id) only with it, OpenCode's only without «Solo». */
export function feedAccepts(item, s = sourceState) {
  const own = !!s.id && item?.source === s.id;
  if (!s.id || !s.on || s.choice === "opencode") return !own;
  return s.choice === "only" ? own : true;
}

/**
 * The endpoints a live change of `kind` reaches, for a kind that is not the core's: the source's numbers
 * reach the summary only with «+» or «Solo»; an active module's changes reach the endpoints its widgets on
 * screen read (`widgetPaths`: module-widgets.js moduleLivePaths of that kind, passed in by dashboard-live.js),
 * nothing else of the dashboard's (its page reads itself); undefined for a kind that is none of them (read everything).
 */
export function kindPaths(kind, s = sourceState, moduleIds = [], widgetPaths = []) {
  if (!moduleIds.includes(kind)) return undefined;
  return kind === s.id && active(s) ? ["/api/summary", ...widgetPaths] : [...widgetPaths];
}
