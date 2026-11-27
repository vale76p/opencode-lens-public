// What the core asks of Skill even while it is off: whether it has data (the notice after an update) and which files
// and folders it keeps (/api/about, the uninstall). Both only read: never a SkillStore (building one reconciles the
// index and may rewrite it) nor a JsonStore's read (on a broken file it makes a copy).
import fs from "node:fs";
import path from "node:path";
import { SKILL_ID } from "./ids.js";
import { INDEX, LIBRARY, validateSkillIndex } from "./library.js";
import { PRESETS } from "./presets.js";

// the lens's own deliveries: the collector writes the native ones whether or not the library was ever used
export const HAS_LENS_USES = "SELECT 1 FROM skill_uses WHERE origin = 'lens' LIMIT 1";

/** Whether skills.json, read straight from the file, is a valid index with at least one skill. */
function indexHasSkill(file) {
  try {
    const v = validateSkillIndex(JSON.parse(fs.readFileSync(file, "utf8")));
    return v.ok && v.doc.skills.length > 0;
  } catch {
    return false;
  }
}

/** Whether the library's folder holds a version folder, skills/<id>/<n>, indexed or not. */
function hasVersionFolder(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).some((e) => {
      // leftovers of an interrupted delete or an interrupted unzip (.removed-…, .tmp-…) are not skills
      if (!e.isDirectory() || !SKILL_ID.test(e.name)) return false;
      try {
        return fs.readdirSync(path.join(root, e.name), { withFileTypes: true }).some((v) => v.isDirectory() && /^[1-9]\d*$/.test(v.name));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** A skill in the index or a version folder in the library, or a delivery of the lens's MCP in skill_uses. */
export function hasData(ctx) {
  const dir = ctx.paths.dataDir;
  if (dir !== null && (indexHasSkill(path.join(dir, INDEX)) || hasVersionFolder(path.join(dir, LIBRARY)))) return true;
  return ctx.reader.get(HAS_LENS_USES) !== undefined;
}

/** The library, its index and the presets, as the core's /api/about listed them: paths only, none with ":memory:". */
export function files(ctx) {
  const { N_ } = ctx.i18n;
  const dir = ctx.paths.dataDir;
  if (dir === null) return [];
  const at = (name) => path.join(dir, name);
  const bad = (name) => at(name.replace(/\.json$/, ".bad.json"));
  return [
    { label: N_("Libreria delle skill"), path: at(LIBRARY), note: N_("le skill che importi da «Skill», una cartella per versione: configurazione tua, mai prompt o risposte"), kind: "dir" },
    { label: N_("Indice delle skill"), path: at(INDEX), note: N_("elenco e versioni delle skill della libreria: configurazione tua, mai prompt o risposte"), kind: "write" },
    { label: N_("Indice delle skill (file non valido)"), path: bad(INDEX), note: N_("copia di skills.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse"), kind: "write" },
    { label: N_("Preset di skill"), path: at(PRESETS), note: N_("i gruppi di skill che crei da «Skill»: configurazione tua, mai prompt o risposte"), kind: "write" },
    { label: N_("Preset di skill (file non valido)"), path: bad(PRESETS), note: N_("copia di skill-presets.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse"), kind: "write" },
  ];
}
