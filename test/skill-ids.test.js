// The ids of skill_uses (src/skill-ids.js) and the files that must not depend on the Skill module or on the browser.
// The module's own copies of the ids (server/ids.js, public/preset-rules.js and the PRESET_ID public/skill-presets.js
// re-exports) are compared with these by its tests (modules/skill/test/skill-module.test.js, skill-presets-page.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const imports = (text) => [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);

test("src/skill-ids.js non importa nulla; src/skill-uses.js né il modulo Skill né i preset del browser", () => {
  assert.deepEqual(imports(source("../src/skill-ids.js")), []);
  assert.doesNotMatch(source("../src/skill-ids.js"), /^\s*import\b/m);
  const uses = imports(source("../src/skill-uses.js"));
  assert.ok(uses.includes("./skill-ids.js"));
  assert.ok(!uses.some((i) => /modules\/|skill-presets/.test(i)), uses.join(","));
});
