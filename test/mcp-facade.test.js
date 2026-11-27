// src/mcp.js is a facade over src/mcp/: main.js, mcp-status.js, the tests and the OpenCode processes
// (`main.js mcp`) import from it, so it keeps exactly the names it had, each the module's own object (the presets' left
// with Skill's MCP side, now in modules/skill/mcp/tools.js).
import { test } from "node:test";
import assert from "node:assert/strict";

const NAMES = {
  "client.js": ["createLensClient"],
  "config.js": ["installArgs", "installLine", "lensConfig", "plistKey", "plistRead"],
  "errors.js": ["LensError", "PromptNotFoundError", "ToolError"],
  "instructions.js": ["INSTRUCTIONS"],
  "periods.js": ["ranges"],
  "prompts.js": ["createPromptAggregator", "createPromptWatcher"],
  "protocol.js": ["PROTOCOL", "createHandler"],
  "run.js": ["runMcp"],
  "stdio.js": ["serveStdio"],
  "text.js": ["cleanBlock", "cleanName", "cleanText"],
  "tools.js": ["createTools"],
};

test("mcp: la facciata esporta gli stessi 21 nomi", async () => {
  const names = Object.keys(await import("../src/mcp.js")).sort();
  assert.equal(names.length, 21);
  assert.deepEqual(names, Object.values(NAMES).flat().sort());
});

test("mcp: ogni nome della facciata è lo stesso oggetto del suo modulo in src/mcp/", async () => {
  const facade = await import("../src/mcp.js");
  for (const [file, names] of Object.entries(NAMES)) {
    const mod = await import(`../src/mcp/${file}`);
    for (const name of names) {
      assert.ok(name in mod, `${name} manca da src/mcp/${file}`);
      assert.equal(facade[name], mod[name], `${name} di src/mcp/${file}`);
    }
  }
});
