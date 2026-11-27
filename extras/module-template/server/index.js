// The Node side of the example module: GET and POST /api/mio-modulo (a notepad), the setting LENS_MIO_MODULO_NOTE and
// the file mio-modulo.json the notes live in.
//
// Rules of this file:
// - NO side effects at import. The lens imports it even when the module is off (to ask `files`), so anything the
//   module needs (a store, a timer, a connection) is made in create(ctx) or in start(), never at the top level.
// - It imports only from inside this folder or from node:*. Everything from the lens comes in through `ctx`.
// - The user texts go through `const { t, N_ } = ctx.i18n` and are called BARE: t("…"), N_("…"). The translation
//   scanner only sees bare calls, never ctx.i18n.t("…").

// the longest note, and how many the notepad keeps (the oldest goes first)
const MAX_TEXT = 200;
const MAX_NOTES = 50;
// the file next to the database: lowercase letters, digits, . _ - and ending in .json. The lens refuses its own names.
const FILE = "mio-modulo.json";
// how the warnings of the lens word an unusable file: «<file> <none> …»; the three phrases agree in gender and number
const WHAT = { broken: "le note sono ignorate", none: "non contiene note valide", dropped: "sono ignorate" };

/** What a document of the file looks like when there is nothing yet. */
const empty = () => ({ version: 1, notes: [] });

/**
 * The validator the file store asks of every document it reads. Answers `{ ok: true, doc }` with the document
 * cleaned up, or `{ ok: false, errors }`. A file edited by hand can say anything, so check everything.
 * The notes come back oldest first: the GET route counts on that order (`earliest` is the first note, `last` the
 * last one in the period, and the cap drops from the front), and a hand-edited file may have them shuffled.
 */
function validate(doc) {
  if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.notes)) return { ok: false, errors: ["atteso { version: 1, notes: [] }"] };
  const notes = doc.notes.filter((n) => n && typeof n.text === "string" && n.text.trim() !== "" && Number.isFinite(n.at)).map((n) => ({ text: n.text.slice(0, MAX_TEXT), at: n.at }));
  notes.sort((a, b) => a.at - b.at);
  return { ok: true, doc: { version: 1, notes: notes.slice(-MAX_NOTES) } };
}

/**
 * The JSON file of the notes: ctx.jsonStore gives read() and write(doc) on <folder of lens.db>/mio-modulo.json,
 * written atomically, with a copy of an unreadable file kept aside (mio-modulo.bad.json). With LENS_DB=:memory: the
 * document stays in memory until the lens restarts. Making the store touches no disk.
 * read() and write() are synchronous and uncached: every read() reads and validates the whole file again, on the
 * lens's only thread. That is fine for a small document like this one (the caps MAX_NOTES and MAX_TEXT keep it a few
 * KB, so a request stays cheap); for many rows or a growing history use tables (docs/moduli-custom.md).
 * (Do not use `ctx.store`: that is the lens's own counters, not a place for your data.)
 */
const notesStore = (ctx) => ctx.jsonStore({ name: FILE, validate, empty, what: WHAT });

/**
 * configure(ctx) is called by the lens at startup for every module it finds, on or off, and again when someone saves
 * the settings. It gets { id, env, paths, i18n } and nothing else: `env` holds only the variables declared in the
 * manifest (plus HOME and XDG_*), never process.env. Answer { values, errors }: `values` is what the module will see
 * as ctx.settings (already parsed: numbers as numbers, paths absolute); with `errors` a save from Impostazioni is
 * refused (400, no restart), and at startup the module is «da configurare» and does not start. An error is a Localized:
 * an Italian text with {placeholders}, translated for whoever reads it; starting with the variable's name, the page
 * marks it on the field.
 * The EMPTY value must be valid (here: no welcome note): lens_module_check runs configure on the lens's environment,
 * where a new module's variable does not exist yet, and «Attiva» with the field empty would be refused.
 */
export function configure(ctx) {
  const { Localized } = ctx.i18n;
  const note = (ctx.env.LENS_MIO_MODULO_NOTE ?? "").trim();
  const errors = note.length > MAX_TEXT ? [new Localized("LENS_MIO_MODULO_NOTE è troppo lunga: al più {max} caratteri", { max: MAX_TEXT })] : [];
  return { values: { note }, errors };
}

/**
 * files(ctx): the files the module writes, so the lens can list them in Impostazioni › Dati e file and the uninstall
 * script can remove them. Each is { label, path, note } (Italian texts, marked with N_). The path must be inside the
 * folder of the database. Optional, but a module that writes a file should declare it.
 */
export function files(ctx) {
  const { N_ } = ctx.i18n;
  const store = notesStore(ctx);
  // with LENS_DB=:memory: there is no folder, hence no file
  if (!store.path) return [];
  return [
    { label: N_("Note del mio modulo"), path: store.path, note: N_("le note scritte nella pagina del modulo d'esempio") },
    { label: N_("Note del mio modulo (file non valido)"), path: store.badFile, note: N_("copia di mio-modulo.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse") },
  ];
}

/**
 * create(ctx): returns SYNCHRONOUSLY (not a promise) what the module offers: `routes`, and optionally `start()` and
 * `stop()` (for timers and connections), `families()` (metrics) and `status()`. If it throws the module is «error».
 */
export function create(ctx) {
  const { t, N_ } = ctx.i18n;
  // the notepad's file, in a variable of this module (not ctx.store)
  const notes = notesStore(ctx);

  return {
    routes: {
      // "<METHOD> <path>": the path starts with /api/ and must not be taken by the lens or by another module. The
      // handler gets (req, { url, local }): `local` is true for a client on this computer. A plain object is a 200.
      "GET /api/mio-modulo": (_req, { url, local }) => {
        const all = notes.read().notes;
        // ctx.range reads ?from= and ?to= like the lens's own endpoints: `from=day` is the budget day, `from=0` is
        // «everything» (here: from the oldest note), anything else is a start in ms. The widget's {from} ends up here.
        const { from, to } = ctx.range(url.searchParams, { earliest: () => all[0]?.at ?? null });
        const inPeriod = all.filter((n) => n.at >= from && n.at <= to);
        return {
          // what configure() read from LENS_MIO_MODULO_NOTE (ctx.settings is {} for a module without configure)
          note: ctx.settings.note ?? "",
          // all the notes, the newest first, and how many (and which the last) fall in the period
          notes: [...all].reverse(),
          count: inPeriod.length,
          last: inPeriod.at(-1) ?? null,
          from,
          to,
          // the page may write only when it is open on this computer
          canSave: local,
        };
      },

      // A write: `body: { type: "json", max }` makes the lens read the JSON (at most `max` bytes) and apply the checks
      // every write has (this computer only, Origin, content-type, token) BEFORE calling the handler. `what` says
      // what is being modified, for the refusals.
      "POST /api/mio-modulo": {
        body: { type: "json", max: 4096 },
        what: N_("le note del modulo d'esempio"),
        handler: (_req, { body }) => {
          const text = typeof body?.text === "string" ? body.text.trim() : "";
          // an answer with a status other than 200 goes through ctx.reply(status, body)
          if (text === "" || text.length > MAX_TEXT) return ctx.reply(400, { errors: [t("La nota deve avere da 1 a {max} caratteri", { max: MAX_TEXT })] });
          const doc = notes.read();
          notes.write({ version: 1, notes: [...doc.notes, { text, at: Date.now() }].slice(-MAX_NOTES) });
          // tells the dashboards that are open: the widgets of this module read their data again
          ctx.live.changed({ notes: Math.min(doc.notes.length + 1, MAX_NOTES) });
          return { ok: true };
        },
      },
    },
  };
}
