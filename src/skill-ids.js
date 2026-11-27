// The ids the core's skill_uses rows are checked with. A leaf: no imports, so src/skill-uses.js needs neither the
// Skill module nor public/. The module keeps its own copies (server/ids.js, and public/preset-rules.js for the
// browser, which cannot reach src/): its tests compare them with these through test/module-test-kit.js.
export const SKILL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_ID = 64;
export const PRESET_ID = /^[a-z0-9-]{1,40}$/;
