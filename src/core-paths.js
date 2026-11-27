// The /api paths the core serves (src/server.js): a module never declares a route on one of them, whatever the
// method (src/modules.js drops it with a warning). A leaf: it imports nothing, so any process can read it.
// test/core-paths.test.js reads server.js and fails when a path it serves is missing here, or one here is not served.

const list = (paths) => Object.freeze([...paths]);

export const CORE_PATHS = Object.freeze({
  // GET/HEAD on exactly these
  exact: list([
    "/api/status",
    "/api/dashboard",
    "/api/presets",
    "/api/modules",
    "/api/modules/authoring",
    "/api/lang",
    "/api/about",
    "/api/settings",
    "/api/update",
    "/api/macos-app",
    "/api/mcp/status",
    "/api/changelog",
    "/api/summary",
    "/api/timeseries",
    "/api/activity",
    "/api/today",
    "/api/budget",
    "/api/calendar",
    "/api/feed",
    "/api/slots",
    "/api/breakdown",
    "/api/tools",
    "/api/sessions",
    "/api/errors",
    "/api/signals",
    "/api/runs",
    "/api/runs/summary",
    "/api/runs/live",
    "/api/hourly",
    "/api/rhythm",
    "/api/daily",
    "/api/live",
  ]),
  // every path under these
  prefixes: list(["/api/sessions/"]),
  // POST on exactly these: the keys of server.js's `writes` table
  writes: list([
    "/api/settings",
    "/api/restart",
    "/api/dashboard",
    "/api/presets",
    "/api/update",
    "/api/update/apply",
    "/api/macos-app/install",
    "/api/modules/notice",
    "/api/modules/check",
  ]),
});

/** Whether the core serves `where` (a request path): one of CORE_PATHS' exact paths or writes, or a path under a prefix. */
export function coreServes(where) {
  return CORE_PATHS.exact.includes(where) || CORE_PATHS.writes.includes(where) || CORE_PATHS.prefixes.some((c) => where.startsWith(c));
}

// The files the core writes in the data folder (the database's directory), by name: the database under its default name
// with SQLite's two companions, the dashboard's layouts (src/dashboard.js: dashboard.json is the v1 one, only read, kept for
// an older lens) and its presets (src/presets.js). A module never takes one: ctx.jsonStore refuses the name, a files() entry
// on one is dropped. test/core-paths.test.js compares the list with what those files write.
export const CORE_FILES = list(["lens.db", "lens.db-wal", "lens.db-shm", "dashboard-v2.json", "dashboard-v2.prev.json", "dashboard.json", "dashboard-presets.json", "dashboard-presets.bad.json"]);

// The folders the core writes in the data folder: update/, where src/update.js prepares the zips and src/macos-app.js
// keeps the log of the app's build (src/main.js gives both the same folder), and modules/, where the user keeps their own
// modules (userModulesDir in src/modules.js). A files() entry on or inside one is dropped.
export const CORE_DIRS = list(["update", "modules"]);

// The kinds of store.changed() the core emits (src/collector.js, and "feed" for a module's source in src/module-kit.js;
// src/server.js forwards them in its live tick; test/core-paths.test.js scans every file of src/): a module id equal to one
// is a manifest error, so the kind a module announces with ctx.live.changed can never be taken for the core's.
export const CORE_CHANGE_KINDS = list(["feed", "step", "tool", "usage", "signal", "permission", "status", "session", "scan", "sync"]);

// The keys of the body of /api/status: collector.status()'s plus what the server adds. A module id equal to one is a
// manifest error: a module's status() lives under its id in that body.
export const CORE_STATUS_KEYS = list(["state", "server", "lastError", "lastEventAt", "connectedAt", "eventsSeen", "duplicateEvents", "scan", "drift", "lens", "counts", "ok", "opencode"]);

// The query parameters the core reads (src/server.js, and from/to of rangeOf in src/module-kit.js), plus `token`: a module's
// source is chosen with ?<id>=1|only, so a source id equal to one is a manifest error. test/core-paths.test.js scans server.js.
export const SOURCE_RESERVED = list(["by", "cursor", "days", "directory", "from", "limit", "metric", "model", "offset", "only", "session", "sort", "steps", "text", "to", "token"]);

// The keys of Queries.summary()'s answer: /api/summary adds a block under the source's id, which must never cover one of
// them (a manifest error). test/core-paths.test.js compares the list with a real summary().
export const SUMMARY_KEYS = list(["from", "to", "steps", "failedSteps", "runningSteps", "sessions", "models", "cost", "stepCost", "tokens", "cacheRate", "internal", "latencyMs", "speed", "tools", "retries", "rateLimited", "failedRuns", "compactions", "compactionsByReason"]);
