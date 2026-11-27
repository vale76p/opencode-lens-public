// `opencode-lens mcp`: an MCP server on stdio for OpenCode V2, a thin client of
// the lens's HTTP API. It never opens the database (the Store migrates, i.e.
// writes) and stdout carries only JSON-RPC frames: diagnostics go to stderr.
// The modules are in src/mcp/: this facade keeps the names that main.js, mcp-status.js and the tests import.
import { createLensClient } from "./mcp/client.js";
import { installArgs, installLine, lensConfig, plistKey, plistRead } from "./mcp/config.js";
import { LensError, PromptNotFoundError, ToolError } from "./mcp/errors.js";
import { INSTRUCTIONS } from "./mcp/instructions.js";
import { ranges } from "./mcp/periods.js";
import { createPromptAggregator, createPromptWatcher } from "./mcp/prompts.js";
import { PROTOCOL, createHandler } from "./mcp/protocol.js";
import { runMcp } from "./mcp/run.js";
import { serveStdio } from "./mcp/stdio.js";
import { cleanBlock, cleanName, cleanText } from "./mcp/text.js";
import { createTools } from "./mcp/tools.js";

export { INSTRUCTIONS, LensError, PROTOCOL, PromptNotFoundError, ToolError, cleanBlock, cleanName, cleanText, createHandler, createLensClient, createPromptAggregator, createPromptWatcher, createTools, installArgs, installLine, lensConfig, plistKey, plistRead, ranges, runMcp, serveStdio };
