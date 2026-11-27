// The only core file a module's tests may import (besides "/module-kit.js"): a real Store (in memory, or on a file) with its
// builders, the module context, the Queries a context is built on (and that a module ported from the core is
// compared with), the query-plan check, the MCP tools' test kit and the page's language for the tests of a module's
// browser code. Nothing else is exported on purpose.
import coreEn from "../public/lang-en.js";
import coreFr from "../public/lang-fr.js";
import { withModuleCatalogs } from "../public/module-list.js";
export { addInternal, addPrompt, addRun, addSession, addStep, addTool, fileStore, memoryStore } from "./helpers.js";
// moduleContext({ …, tables }): with the default export of the module's tables.js (and a memoryStore({ moduleTables })
// that created them) the ctx has ctx.writer on those tables, as the registry gives it; `source: true` adds ctx.live.feed
export { moduleContext } from "../src/module-kit.js";
export { Queries } from "../src/queries.js";
// the ids of the core's skill_uses rows (src/skill-ids.js): a module keeps its own copy and a test compares them
export { MAX_ID, PRESET_ID, SKILL_ID } from "../src/skill-ids.js";
// a module's source() through the core's views: sourceQueries(store.dbPath, options, source()) on a fileStore gives
// { only, add } Queries, as the dashboard's selector reads them (null in memory)
export { sourceQueries } from "../src/source-views.js";
export { check, rangeKeys, recorded } from "./query-plan-check.js";
// The test kit for a module's MCP tools and prompts: the frozen kit the MCP process hands to tools(kit) and prompts(kit),
// the JSON-RPC handler that lists and calls them, the aggregator and watcher that serve a module's PromptSource, the
// instructions with a module's mcpInstructions and prompt lines, and the error classes the kit carries (kit.LensError,
// kit.ToolError, kit.PromptNotFoundError) for fake lenses.
export { createToolKit } from "../src/mcp/module-kit.js";
export { createHandler } from "../src/mcp/protocol.js";
export { createPromptAggregator, createPromptWatcher } from "../src/mcp/prompts.js";
export { instructionsWith } from "../src/mcp/instructions.js";
export { LensError, PromptNotFoundError, ToolError } from "../src/mcp/errors.js";
// The language of the dashboard for the tests of a module's browser code: configure (public/i18n.js, the same module
// "/module-kit.js" reads t() from), rebuildFormats (public/ui.js: the number and date formats after a change of locale)
// and catalogs(), the core's catalogs with the module's own added (catalogs({ en, fr }), as boot.js does).
export { configure } from "../public/i18n.js";
export { rebuildFormats } from "../public/ui.js";
// The ctx a module's widgets.js gets from the dashboard: widgetContext(spec, gridCtx) with the manifest's widget entry as
// `spec` and { widget, title, settings, paths, data, inst } as the grid's ctx gives it — the frozen { widget, title,
// settings, data, inst } that mount() and update() receive.
export { widgetContext } from "../public/module-widgets.js";
/** The core's catalogs with a module's own (`own`: { en, fr }) added, as boot.js loads them for an active module: the core's keys win. */
export const catalogs = (own = {}) => ({ en: withModuleCatalogs(coreEn, [own.en]), fr: withModuleCatalogs(coreFr, [own.fr]) });
