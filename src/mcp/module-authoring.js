// The MCP's two tools for whoever writes a Lens module (module_guide, module_check; lens_module_guide and
// lens_module_check in OpenCode). They talk to the lens over HTTP only and read the guide, docs/moduli-custom.md,
// from the app: the process imports neither node:sqlite nor src/server.js. Their names are in CORE_TOOL_NAMES.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID } from "../config.js";
import { LensError, ToolError } from "./errors.js";
import { cleanBlock, cleanName, plural } from "./text.js";
import { argSpec, lensHelpers } from "./tools.js";

// the app's docs/moduli-custom.md, from this file's own location as MODULES_DIR is
export const GUIDE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "moduli-custom.md");

const GUIDE_MAX = 200_000; // characters of the guide handed to the model
const VALUES_TITLE = "Questa installazione";

/**
 * The `## ` sections of a Markdown text: [{ title, body }], the body being what follows the heading up to the next
 * one (its `###` subsections included). What comes before the first heading is in none; a `## ` line inside a code
 * fence is no heading.
 */
export function guideSections(text) {
  const sections = [];
  let fence = null; // the marker that opened the code fence we are in
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker) fence = fence === null ? marker : fence === marker ? null : fence;
    const heading = fence === null && !marker ? /^## +(.+?)\s*$/.exec(line) : null;
    if (heading) sections.push({ title: heading[1], lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  return sections.map((s) => ({ title: s.title, body: s.lines.join("\n").trim() }));
}

/** "a, b, c", or "nessuno": the names of a list from the lens, each on one line. */
const list = (items) => (Array.isArray(items) && items.length ? items.map((x) => cleanName(x, 200)).join(", ") : "nessuno");

/** The block with this installation's values, from GET /api/modules/authoring. */
function valuesBlock(a) {
  const paths = a.reservedPaths ?? {};
  return [
    `## ${VALUES_TITLE}`,
    "",
    `- Cartella dei moduli dell'utente: ${a.userDir ? cleanName(a.userDir, 400) : "non disponibile (questa lens non ne ha una)"}. Un modulo è una sottocartella: <id>/module.js.`,
    `- Versione di Lens (il campo lens del manifesto non può chiederne una più nuova): ${cleanName(a.lens) ?? "sconosciuta"}`,
    `- Id di modulo già presi: ${list(a.takenIds)}`,
    `- Id riservati dal nucleo (pagine, viste, chiavi di /api/status, tipi di cambiamento): ${list(a.reservedIds)}`,
    `- Variabili LENS_… già prese: ${list(a.takenVars)}`,
    `- Percorsi /api riservati, esatti: ${list(paths.exact)}`,
    `- Percorsi /api riservati, prefissi: ${list(paths.prefixes)}`,
    `- Percorsi /api riservati, scritture (POST): ${list(paths.writes)}`,
    `- Nomi di strumenti MCP già presi: ${list(a.takenTools)}`,
    `- Tipi di widget già presi: ${list(a.takenWidgetTypes)}`,
    `- Limiti dei widget: ${JSON.stringify(a.widgetLimits ?? null)}`,
  ].join("\n");
}

/** The two tools. `connect({ timeoutMs })` gives `{ lens, config }`; `guidePath` is the guide's file; `helpers` as for createTools. */
export function createModuleAuthoringTools({ connect, guidePath = GUIDE_PATH, helpers = lensHelpers({ connect }) }) {
  const { withLens } = helpers;

  /** The guide's text cleaned for the model, or null when the file is not there. */
  async function readGuide() {
    try {
      return cleanBlock(await fs.readFile(guidePath, "utf8"), GUIDE_MAX);
    } catch {
      return null;
    }
  }

  /** This installation's values, or why they are not there (the guide is still worth giving). */
  async function installation(signal) {
    try {
      return valuesBlock(await connect().lens.get("/api/modules/authoring", {}, signal));
    } catch (err) {
      if (signal?.aborted || !(err instanceof ToolError)) throw err;
      // a LensError with a status is the lens answering no; without one the lens could not be reached at all
      return `Valori di questa installazione non disponibili: ${err instanceof LensError && err.status ? "la lens ha rifiutato la richiesta: " : ""}${cleanName(err.message, 400)}`;
    }
  }

  const guideArgs = argSpec({ section: { description: "una parte della guida: il titolo di una sezione, o parte di esso (maiuscole ininfluenti), per esempio «widget» o «checklist»; senza, la guida intera" } });
  const moduleGuide = {
    name: "module_guide",
    title: "Guida ai moduli",
    description:
      "Prima di scrivere un modulo di Lens (una pagina, un widget, un'API o uno strumento in più, in una cartella dell'utente): la guida completa con il contratto del modulo, gli esempi e la checklist, più i valori di questa installazione (cartella dei moduli, id, variabili, percorsi, strumenti e tipi di widget già presi). Con section solo la parte che serve. Poi controlla il lavoro con module_check.",
    inputSchema: guideArgs.inputSchema,
    run: async (args, { signal }) => {
      const a = guideArgs.parse(args);
      const [guide, values] = await Promise.all([readGuide(), installation(signal)]);
      let head;
      if (guide === null) head = "Attenzione, guida non trovata: manca docs/moduli-custom.md nell'installazione di Lens (aggiorna Lens). Qui sotto i valori di questa installazione.";
      else if (a.section == null) head = guide;
      else {
        const sections = guideSections(guide);
        const wanted = a.section.trim().toLowerCase();
        const found = sections.filter((s) => s.title.toLowerCase().includes(wanted));
        head = found.length
          ? found.map((s) => `## ${s.title}\n\n${s.body}`).join("\n\n")
          : `Nessuna sezione della guida contiene «${cleanName(a.section, 80)}». Le sezioni (${sections.length}):\n${sections.map((s) => `- ${s.title}`).join("\n")}`;
      }
      return { text: `${head}\n\n${values}` };
    },
  };

  const checkArgs = argSpec({ id: { required: true, pattern: MODULE_ID.source, hint: "minuscole, cifre e trattini, comincia con una lettera", description: "l'id del modulo, cioè il nome della sua cartella nella cartella dei moduli dell'utente (minuscole, cifre e trattini, inizia con una lettera)" } });
  const lines = (title, items) => (items.length ? [`${title} (${items.length}):`, ...items.map((x) => `- ${cleanName(x, 500)}`)] : []);
  const moduleCheck = {
    name: "module_check",
    title: "Controllo di un modulo",
    description:
      "Dopo ogni modifica ai file del modulo: chiede alla lens di giudicare un modulo della cartella dell'utente come farebbe all'avvio (manifesto, widget, tabelle, impostazioni, nomi già presi) senza attivarlo e senza cambiare niente. Attenzione: esegue il codice del modulo nel processo della lens (module.js, tables.js, server/index.js al primo livello, e configure()), quindi non è una lettura. Risponde OK oppure gli errori e gli avvisi, uno per riga: correggi e richiama finché è OK. Funziona anche su un modulo nuovo che la lens non ha ancora scoperto.",
    inputSchema: checkArgs.inputSchema,
    // not read-only: it runs the module's code in the lens process, so a client must not auto-approve it as a read
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args, { signal }) => {
      const a = checkArgs.parse(args);
      let ok = true;
      const r = await withLens(signal, async (lens) => {
        const res = await lens.post("/api/modules/check", { id: a.id }, signal);
        const errors = Array.isArray(res.errors) ? res.errors : [];
        const warnings = Array.isArray(res.warnings) ? res.warnings : [];
        ok = res.ok === true;
        const where = res.dir ? ` (${cleanName(res.dir, 400)})` : "";
        const head = ok ? `OK: il modulo ${a.id} è valido${where}.${warnings.length ? " Gli avvisi sotto sono promemoria, non errori." : ""}` :`Il modulo ${a.id} non è valido${where}: ${plural(errors.length, "errore", "errori")}.`;
        return [head, ...lines("Errori", errors), ...lines("Avvisi", warnings)].join("\n");
      });
      return ok ? r : { ...r, isError: true };
    },
  };

  return [moduleGuide, moduleCheck];
}
