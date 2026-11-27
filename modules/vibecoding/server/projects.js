// The Vibe Coding projects: vibe-projects.json next to the database (name, colour, budget, folders), personal to
// this install. Read and written through the core's JsonStore; hasData only reads the file and never reports it.
import fs from "node:fs";
import { EMPTY_VIBE_PROJECTS, validateVibeProjects } from "../public/vibe-projects.js";

const NAME = "vibe-projects.json";
// how the warnings of an unusable file word it
const WHAT = Object.freeze({ broken: "i progetti sono ignorati", none: "non contiene progetti validi", dropped: "sono ignorati" });

/** The projects store of `ctx` (":memory:" keeps them in memory until restart); building it touches nothing on disk. */
export function projectStore(ctx) {
  const { t } = ctx.i18n;
  return ctx.jsonStore({ name: NAME, validate: (doc) => validateVibeProjects(doc, t), empty: () => structuredClone(EMPTY_VIBE_PROJECTS), what: WHAT });
}

/**
 * Whether vibe-projects.json holds at least one valid project. Read straight from the file, unlike the store's read:
 * an unusable file is neither copied aside (.bad.json) nor logged, and nothing is written.
 */
export function hasData(ctx) {
  const file = projectStore(ctx).path;
  if (!file) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  const v = validateVibeProjects(parsed);
  return v.ok && v.doc.projects.length > 0;
}

/** The files the projects live in, for /api/about and the uninstall: none with ":memory:". */
export function files(ctx) {
  const { N_ } = ctx.i18n;
  const store = projectStore(ctx);
  if (!store.path) return [];
  return [
    { label: N_("Progetti di Vibe Coding"), path: store.path, note: N_("i progetti che crei da «Vibe Coding»: nomi, colori, budget e cartelle, configurazione tua, mai prompt o risposte") },
    { label: N_("Progetti di Vibe Coding (file non valido)"), path: store.badFile, note: N_("copia di vibe-projects.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse") },
  ];
}
