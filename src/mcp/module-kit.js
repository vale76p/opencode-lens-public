// The kit a module's MCP file receives (modules/<id>/mcp/tools.js exports tools(kit) → Tool[] and, with mcpPrompts,
// prompts(kit) → PromptSource): everything they may use of the MCP process, so their files import nothing. The same
// helpers, and session cache, as the core's tools.
import { randomUUID } from "node:crypto";
import { LensError, PromptNotFoundError, ToolError } from "./errors.js";
import { PROMPT_BRIEF_MAX } from "./prompts.js";
import { cleanBlock, cleanName, cleanText, num, pct, plural, safePath, when } from "./text.js";
import { argSpec, lensHelpers, SINCE, SINCE_LABEL } from "./tools.js";

const TEXT = Object.freeze({ cleanBlock, cleanName, cleanText, num, pct, plural, safePath, when });

/**
 * The frozen kit. `connect` and `now` as for createTools (`connect({ timeoutMs })` gives `{ lens, config }`, for a
 * prompt source's own requests); `helpers` (lensHelpers) is the instance the core's tools use, so both share the
 * cache of the sessions' directories.
 */
export function createToolKit({ connect, now = Date.now, helpers = lensHelpers({ connect, now }) }) {
  const { withLens, project, resolve } = helpers;
  return Object.freeze({ argSpec, SINCE, SINCE_LABEL, withLens, resolve, project, connect, randomUUID, LensError, ToolError, PromptNotFoundError, PROMPT_BRIEF_MAX, now: helpers.now, text: TEXT });
}
