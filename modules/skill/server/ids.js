// The ids of the skill library and of its presets, the module's own copy of the core's src/skill-ids.js (the rows of
// skill_uses are checked with that one): a leaf with no imports. A test compares the two through test/module-test-kit.js.
export const SKILL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_ID = 64;
export const PRESET_ID = /^[a-z0-9-]{1,40}$/;
