// The manifest of the example module «Il mio modulo»: a notepad with its own page, a widget for the dashboard and
// one setting. Copy this whole folder to <the folder of lens.db>/modules/mio-modulo/ and make it yours (README.md).
//
// The lens reads this file at startup, even when the module is off, to know the module exists. So it is a plain
// object with NO import at the top: everything the module does is imported lazily, from `server` below.
//
// The id is also the name of the folder, and it is the page id (#mio-modulo). Lowercase letters, digits and
// hyphens, first character a letter (^[a-z][a-z0-9-]*$); no hyphen if the module will have tables
// (^[a-z][a-z0-9]*$). If you rename the module, change it here, in the folder name, in the API paths
// (/api/mio-modulo), in the widget type and in the tests.
export default {
  id: "mio-modulo",

  // `name` and `description` are Italian texts: the lens shows them in Impostazioni › Moduli, translated with
  // public/lang-en.js and public/lang-fr.js. Every Italian text you add needs an entry in both catalogs.
  name: "Il mio modulo",
  description: "Un modulo d'esempio da copiare: un blocco di note con la sua pagina, un widget per la dashboard e un'impostazione",

  // The oldest lens that can run this module (x.y.z). With an older lens the module stays in «error» and says so.
  // Set it to the version of the lens you wrote the module on: this example needs the widgets of the modules.
  // (The marker at the end of the line lets the lens's releases keep this example on their own version.)
  lens: "0.51.1", // x-release-please-version

  // The menu entry. `group` is "dati" (Data) or "lens"; `order` sorts inside the group (the modules go last);
  // `icon` is the inside of an <svg viewBox="0 0 24 24">, drawn with the page's colours.
  menu: {
    group: "dati",
    order: 90,
    icon: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h6"/>',
  },

  // The title of the menu entry.
  page: { title: "Il mio modulo" },

  // The Node side of the module: a function that imports server/index.js. It runs at startup.
  server: () => import("./server/index.js"),

  // The variables the module reads, one entry each. `name` must start with LENS_ and must not be taken by the lens
  // or by another module; `kind` is "text", "num" (add `min` and `max`, integers) or "secret" (never shown again).
  // They appear as fields in the module's card in Impostazioni › Moduli, and are read in `configure` (server/index.js).
  settings: [
    {
      name: "LENS_MIO_MODULO_NOTE",
      label: "Nota di benvenuto",
      help: "mostrata in cima alla pagina; vuoto = nessuna",
      kind: "text",
      placeholder: "Ciao!",
    },
  ],

  // The widgets the module offers to the dashboard (Personalizza › Aggiungi), drawn by the file below.
  widgetsFile: "widgets.js",
  widgets: [
    {
      // <id>-<name>, at most 31 characters, lowercase letters, digits and hyphens.
      type: "mio-modulo-conteggio",
      label: "Note del mio modulo",
      description: "Quante note hai scritto nel periodo, e l'ultima",
      // The size of a new widget and the smallest it can be shrunk to, [width in columns (1-12), height in rows (1-40)].
      size: [3, 4],
      min: [3, 3],
      // Where the editor offers it: "adesso", "analisi" or "both".
      home: "adesso",
      // The ⚙ of the widget. `title: null` lets the user rename it; `range` lets them pick the period (some of
      // "dashboard" = follow the view, "day" = the budget day, or a length in ms, "0" = everything).
      settings: { title: null, range: ["dashboard", "day", "604800000", "2592000000", "0"] },
      // The API the widget reads: 1 to 4 GET routes of THIS module. `{from}` becomes the start of the period.
      data: ["/api/mio-modulo?from={from}"],
    },
  ],
};
