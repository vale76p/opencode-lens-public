// skill-presets.json next to the database: the logical groups of library skills, personal to this install. The core's
// SkillPresetStore on ctx.jsonStore; the rules are those the browser uses too (public/preset-rules.js).
import { createHash } from "node:crypto";
import { EMPTY_SKILL_PRESETS, validateSkillPresets } from "../public/preset-rules.js";

export const PRESETS = "skill-presets.json";
const SKILL_PRESETS_WHAT = Object.freeze({ broken: "i preset di skill sono ignorati", none: "non contiene preset di skill validi", dropped: "sono ignorati" });

/** The presets' JsonStore of `ctx` (":memory:" keeps them in memory until restart); building it touches nothing on disk. */
export function skillPresetStore(ctx) {
  const { t } = ctx.i18n;
  return ctx.jsonStore({ name: PRESETS, validate: (doc) => validateSkillPresets(doc, t), empty: () => structuredClone(EMPTY_SKILL_PRESETS), what: SKILL_PRESETS_WHAT });
}

/** The revision of a presets document a save must name: another tab or client saved in between when it differs. */
export function presetsRev(doc) {
  return createHash("sha256").update(JSON.stringify(doc)).digest("hex").slice(0, 16);
}
