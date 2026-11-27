// The names of the core's MCP tools. A leaf: it imports nothing, so the lens (src/server.js, src/modules.js) and the MCP
// process (src/mcp/tools.js) share it without one loading the other.

// The ones createTools() builds, plus module_guide and module_check, which the MCP process adds for whoever writes a
// module. A module's mcpTools never takes one (GET /api/modules/authoring lists them, the module check refuses them).
export const CORE_TOOL_NAMES = Object.freeze(["budget", "errors", "usage", "sessions", "module_guide", "module_check"]);
