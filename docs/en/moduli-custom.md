# Writing a Lens module

🌐 [Italiano](../moduli-custom.md) · English · [Français](../fr/moduli-custom.md)

This guide is for whoever writes a module of **their own**, nearly always a model (in OpenCode or elsewhere) that does not know the lens's code. Follow the sections in order: they are the order of the work. Each rule says which file of the lens enforces it; the full details of the contract are in [moduli.md](moduli.md#writing-a-module), here there is only what is needed to build. Whoever reads this guide through `lens_module_guide` cannot open the links to moduli.md: the file is on disk, in `<app>/docs/moduli.md` (`<app>` is `~/Applications/opencode-lens`, or the copy of the lens's repository). The MCP tool `lens_module_guide` returns the Italian text of this guide plus this installation's values (folder, version, names already taken); with `section` it returns every section whose title contains that text (case does not matter), for example `section: "widget"`. **`section` matches the titles of the Italian guide**, not the titles of this translation: `Persistenza`, `Pagina del browser`, `Widget della dashboard`, `Lavoro lungo`, `Verifica`, `Checklist`… The tool's labels and answers are in Italian, like everything the MCP sends to OpenCode. In this guide an Italian label quoted verbatim from the tool is in «…», with a short translation at its first use; “…” marks an English gloss or a text of the English interface.

All the examples come from the example module `extras/module-template/` (id `mio-modulo`, widget `mio-modulo-conteggio`, setting `LENS_MIO_MODULO_NOTE`): a page with a notepad, a widget, a `GET`, a JSON `POST`, a JSON file, a setting and the tests. **Always start from a copy of it.**

## Before you write

- **Do you really need a module?** A module adds to the lens a page, widgets for the dashboard, `/api` routes, MCP tools or metrics, on data the lens does not already have. To see data the lens already has in another way, first try the core's widgets and their ⚙ (see [dashboard.md](dashboard.md)); to ask Lens something from OpenCode the core's MCP tools are enough (`lens_usage`, `lens_sessions`…).
- **What you will not find.** The lens does not store the text of prompts nor the models' answers (see [configurazione.md](configurazione.md#security-and-privacy)): no module can read them from the database. A module does not open the database, does not write to the core's tables, does not import files of the lens's `src/` or `public/` and does not read `process.env`: everything comes from `ctx` (Node), from `"/module-kit.js"` (browser) and from `kit` (MCP).
- **No hot reload.** The lens looks for modules only at startup: a new module, or a changed module file, counts after a restart of the lens (`src/modules.js`, `discoverAll`). A module's MCP tools appear in OpenCode only after a restart of OpenCode.
- **No sandbox.** A module's code is trusted Node code: it runs inside the lens's process, with its permissions, and can read and write any of the user's files. The browser code runs in the dashboard page with no isolation. The limits of `ctx` prevent mistakes, they do not stop a hostile module. Do not write a module that does more than the user asked.
- **The order of the work**: `lens_module_guide` (this guide and the values) → copy of the example module into the user's folder → manifest → Node side → page and widgets → `lens_module_check` until it answers OK → restart of the lens → **Settings › Modules** › *Turn on* → the module's tests.

## Where to save the module

- **In the user's modules folder**, next to the lens's database (`<folder of lens.db>/modules/<id>/`), never in the app folder. The exact value is given by `lens_module_guide` («Cartella dei moduli dell'utente», “the user's modules folder”) and by `GET /api/modules/authoring` (field `userDir`, from this computer only). By default:

  | Where it runs | User's modules folder |
  |---|---|
  | macOS | `~/Library/Application Support/opencode-lens/modules/` |
  | Linux | `$XDG_DATA_HOME/opencode-lens/modules/` (by default `~/.local/share/opencode-lens/modules/`) |
  | `LENS_DB` set | the `modules/` folder next to the database file |
  | `LENS_DB=:memory:` | none: no user modules |

- **Do not save it in `~/Applications/opencode-lens/modules/`**: every upgrade deletes and recreates the app folder. The data folder survives upgrades (`install.sh` does not touch it), and so do the modules in it.
- **If the `modules/` folder is not there, create it.** The lens does not create it; if it is missing nothing happens.
- **The subfolder's name is the module's id**: lowercase letters, digits and hyphen, starting with a letter (`^[a-z][a-z0-9-]*$`, `MODULE_ID` of `src/config.js`). A folder with another name (`mio modulo`, `Mio-Modulo`, `demo 2`) is not a module and is silently ignored. If the module is going to have tables, no hyphen in the id (see [Persistence](#persistence)).
- **A free id.** Do not use an id already taken (list «Id di modulo già presi», “module ids already taken”, of `lens_module_guide`) nor an id reserved by the core (pages, views, keys of `/api/status`, kinds of change: list «Id riservati», “reserved ids”). An id equal to a lens module (`sistema`, `skill`…) is never imported: the lens sets it aside (`shadowed`) and **Settings › Modules** asks to rename the folder.
- **A symbolic link is fine**: in the user's folder a subfolder may be a link to a folder elsewhere (for example a working copy under git).

## Folders and files

Copy the example module with the name of your id, then rename `mio-modulo` everywhere: folder name, the manifest's `id`, the `/api/mio-modulo` paths, the widget type `mio-modulo-conteggio`, the `id` of `page.js`, `id="view-mio-modulo"` and `data-ico` of `page.html`, the prefix of the CSS classes and HTML ids (`mm-`), the name of the JSON file and the name of the setting `LENS_MIO_MODULO_NOTE`.

```bash
# the installed app carries the example module; <modules folder> is the one from lens_module_guide
cp -R ~/Applications/opencode-lens/extras/module-template "<modules folder>/mio-modulo"
```

```
<id>/
  module.js          the manifest (required)
  server/index.js    the Node entry (required): configure, files, hasData, create
  public/            the browser files, all in this folder, flat, lowercase names
    page.js          the page: exports page and title
    page.html        the page's markup: <section id="view-<id>">
    widgets.js       the dashboard widgets (with widgets and widgetsFile)
    style.css        optional
    lang-en.js       the module's catalogs (an Italian text → the translation)
    lang-fr.js
  tables.js          optional: the module's tables in the database
  server/writes.js   optional, with tables.js: the write SQL
  mcp/tools.js       optional: the MCP tools
  test/              the module's tests
```

- **`module.js` has no imports** and does nothing: the lens imports it at startup even for a module that is off, to know it exists.
- **`server/index.js` has no side effects at import**: no timers, connections or reads at the top level. The lens imports it even for a module that is off (for `files` and `hasData`) and `lens_module_check` runs it at every check. The work is done in `create(ctx)` and in `start()`.
- **Imports**: inside the module's folder, `node:*` and, only in the files of `public/` and `test/`, `"/module-kit.js"`; in the tests also `"/module-test-kit.js"`. Nothing else (the rules are those of `test/module-boundaries.test.js` for the lens's modules; for yours they are checked by the example module's «gli import» (“the imports”) test: keep it).
- **`public/` is flat**: the lens serves `/modules/<id>/<file>` with `<file>` made of lowercase letters, digits, `.`, `_` and `-`, with no subfolders (`MODULE_FILE` of `src/server.js`), and only with the module on.

## The manifest

`module.js` exports an object by default. The lens judges it with `manifestError` of `src/modules.js` (plus `src/module-mcp-fields.js` and `src/module-widget-fields.js`): a wrong field sends the module to `error` with the reason, visible in **Settings › Modules** and in `lens_module_check`. These are **all** the fields it reads (the list is `MANIFEST_FIELDS` of `src/modules.js`):

| Field | Required | Valid values |
|---|---|---|
| `id` | yes | equal to the folder's name; not a page or view of the core, a key of `/api/status` or a kind of change (see [Reserved ids](moduli.md#reserved-ids)) |
| `name` | yes | non-empty Italian text, translated by the module's catalogs |
| `description` | yes | non-empty Italian text, translated like `name` |
| `lens` | yes | `x.y.z`, the oldest lens version that can run the module: put the one `lens_module_guide` gives. Newer than the running lens → `error` |
| `menu` | yes | `{ group, order, icon }`: `group` is `"dati"` or `"lens"`, `order` a number (sorts inside the group; modules go last), `icon` a text, the inside of an `<svg viewBox="0 0 24 24">` |
| `page` | yes | `{ title }`: the title of the menu entry, non-empty Italian text |
| `server` | yes | `() => import("./server/index.js")` |
| `settings` | no | the module's `LENS_…` variables, see below |
| `widgets` | no | 1 to 12 dashboard widgets; requires `widgetsFile` (see [Dashboard widgets](#dashboard-widgets)) |
| `widgetsFile` | with `widgets` | the name of a `.js` file of `public/` (`^[a-z0-9-]+\.js$`), for example `"widgets.js"` |
| `mcp` | no | `() => import("./mcp/tools.js")` (see [The module's MCP](#the-modules-mcp)) |
| `mcpTools` | with `mcp` | the tools' names, `^[a-z][a-z0-9_-]{0,63}$`, not repeated |
| `mcpInstructions` | no, with `mcp` | lines (one line each, non-empty) added to the MCP server's instructions |
| `mcpExamples` | no, with `mcp` | example questions for Settings › MCP server, one line each |
| `mcpPrompts` | no, with `mcp` | `true` if the `mcp` file also exports `prompts(kit)` (see [moduli.md](moduli.md#a-modules-mcp-prompts)) |
| `notice` | no | Italian text of the “was in use” notice after an upgrade |
| `settingsPanel` | no | a `.js` file of `public/` with the card's panel (see [moduli.md](moduli.md#the-panel-in-the-card)) |
| `tables` | no | `() => import("./tables.js")` (see [Persistence](#persistence)) |
| `source` | no | `{ label }`: the module is a data source alternative to OpenCode. Advanced: a new module does not need it (see [moduli.md](moduli.md#an-alternative-source)) |

The example module's manifest:

```js
export default {
  id: "mio-modulo",
  name: "Il mio modulo",
  description: "Un modulo d'esempio da copiare: un blocco di note con la sua pagina, un widget per la dashboard e un'impostazione",
  lens: "0.51.0", // x-release-please-version
  menu: { group: "dati", order: 90, icon: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h6"/>' },
  page: { title: "Il mio modulo" },
  server: () => import("./server/index.js"),
  settings: [{ name: "LENS_MIO_MODULO_NOTE", label: "Nota di benvenuto", help: "mostrata in cima alla pagina; vuoto = nessuna", kind: "text", placeholder: "Ciao!" }],
  widgetsFile: "widgets.js",
  widgets: [{
    type: "mio-modulo-conteggio", label: "Note del mio modulo", description: "Quante note hai scritto nel periodo, e l'ultima",
    size: [3, 4], min: [3, 3], home: "adesso",
    settings: { title: null, range: ["dashboard", "day", "604800000", "2592000000", "0"] },
    data: ["/api/mio-modulo?from={from}"],
  }],
};
```

**`settings`** (`settingsError` of `src/modules.js`): a list of `{ name, label, help, kind, placeholder? }`.

- `name`: `LENS_` plus uppercase letters, digits and `_` (`^LENS_[A-Z0-9_]+$`); not a core variable, not already declared by another module (list «Variabili LENS_… già prese», “LENS_… variables already taken”, of `lens_module_guide`), not repeated. Use `LENS_<ID>_…`, like `LENS_MIO_MODULO_NOTE`.
- `label` and `help`: Italian texts (`help` may be empty). `kind`: `"text"`, `"num"` or `"secret"`. `placeholder`: optional text, the default value shown in the field.
- With `kind: "num"`, optional `min` and `max`, integers, `min ≤ max`; with another `kind` they are an error.
- A list of paths is a `kind: "text"` setting with the paths separated by `:`, like `LENS_SECURITY_DIRS` (`modules/security/server/settings.js`).
- Each setting is a field of the module's card in **Settings › Modules**; saving it restarts the lens, if `configure` accepts the value (see the next section). The value reaches the module only through `configure`.

**The manifest's texts** (`name`, `description`, `page.title`, `label`, `help` and `placeholder` of the settings, `label` and `description` of the widgets, `notice`) are written in Italian and have an entry in the module's `public/lang-en.js` and `public/lang-fr.js`.

## Node entry and ctx

`server/index.js` exports up to four functions. Only `create` is required (`lens_module_check` says «server/index.js deve esportare create(ctx)», “server/index.js must export create(ctx)”).

- **`configure(ctx)`**: reads the settings. The lens calls it at startup for every module found, on or off, and at every save from Settings. It gets only `{ id, env, paths, i18n }` (`settingsContext` of `src/module-kit.js`): `env` holds **only** the variables declared in `settings`, plus `HOME` and `XDG_*`. It returns `{ values, errors }`: `values` is the object the module will see as `ctx.settings` (already converted: numbers as numbers, absolute paths), `errors` a list of texts or `Localized`. What `errors` do: **from the dashboard a wrong value is not saved**: at every save from Settings the lens runs `configure` of the modules that will stay on with the environment after the save (`validateEnv` of `src/modules.js`, called by `src/settings.js`) and, on an error, answers 400 with the errors, writing nothing and not restarting (an error that starts with the variable's name, like the example module's, is marked on the field by the page). The module is “to configure” (`unconfigured`), and does not start, only when the environment is already wrong at startup: a folder gone, the plist written by hand. If `configure` throws or does not return `{ values, errors }` the module goes to `error`. **Without `configure`, `ctx.settings` is `{}`**: the variable's value never reaches the module.

  ```js
  export function configure(ctx) {
    const { Localized } = ctx.i18n;
    const note = (ctx.env.LENS_MIO_MODULO_NOTE ?? "").trim();
    const errors = note.length > MAX_TEXT ? [new Localized("LENS_MIO_MODULO_NOTE è troppo lunga: al più {max} caratteri", { max: MAX_TEXT })] : [];
    return { values: { note }, errors };
  }
  ```

  **The empty value must be valid.** `lens_module_check` runs `configure` with the lens's current environment (`process.env`, `src/main.js`), where a new module's variable does not exist yet; and *Turn on* is a save like the others, which runs `configure` of the module just turned on. If empty is an error, the check never answers «OK» and *Turn on* with the field empty is refused (400). For empty use a default value, or a “not configured” state inside the module that the page explains: in the example module empty = no welcome note.

  A setting that is a path: empty = a default built from `ctx.paths` (or “not configured”); when set, accept only absolute paths. A path that does not exist you may report in `errors` (the save is refused with the reason; if the folder disappears later, at the restart the module is “to configure”), or skip it and say so in the page, as Security does.
- **`files(ctx)`**: optional, the files the module writes, `[{ label, path, note?, kind? }]` (`label` and `note` with `N_`). The lens shows them in **Settings › Data and files** and the uninstall script deletes them. `kind` is `"write"` (the default: a file **inside the data folder**), `"dir"` (a folder inside the data folder) or `"read"` (any absolute path the module **only reads**: never deleted). An entry outside these rules, or on a core file, is dropped with a warning in the log (`files()` of `ModuleRegistry`, `src/modules.js`). With invalid settings `files` is not asked.
- **`hasData(ctx)`**: optional, `true` if the module already has saved data (it decides the “was in use” notice after an upgrade). If it throws it counts as `false`. Like `files`, it writes nothing: so **it does not call the store's `read()`**, which on a broken file makes a `<name>.bad.json` copy of it and writes to the log (`JsonStore` of `src/presets.js`). It takes only the store's `path` (making the store touches no disk) and reads the file itself, with `fs.readFileSync` and `JSON.parse` inside a `try` (`false` if it is missing or not valid), like `hasData` of `modules/vibecoding/server/projects.js`.
- **`create(ctx)`**: called only for a module that is on and configured. It returns **at once** (never a promise: that is an error) an object, all optional: `routes` (see [GET and POST routes](#get-and-post-routes)), `start()` and `stop()` (async too), `families()` (metrics for `/metrics`), `status()` and `state()` (blocks of `/api/status` and `/healthz`). If `create` or `start` throw, the module goes to `error` and the others carry on.

**The `ctx`** of `create`, `files` and `hasData` (`moduleContext` of `src/module-kit.js`) is frozen and is the only door to the lens. What is needed to build:

| Field | |
|---|---|
| `ctx.id` | the module's id |
| `ctx.settings` | the `values` of `configure` (frozen); `{}` without `configure` |
| `ctx.env`, `ctx.paths` | as in `configure`; `ctx.paths` has `home`, `opencodeConfigDir`, `xdgData` and `dataDir` (the database's folder, `null` with `:memory:`) |
| `ctx.i18n` | `t`, `N_`, `Localized`, `errorText` |
| `ctx.reply(status, body)` | an answer with a status other than 200 (status from 200 to 599, body a plain object) |
| `ctx.range(searchParams, { earliest }?)` | the period `{ from, to }` of a request, as the core's endpoints read it |
| `ctx.jsonStore({ name, validate, empty, what })` | a JSON file of the module next to the database (see [Persistence](#persistence)) |
| `ctx.reader` | `get(sql, …)` and `all(sql, …)`: reads of the lens's database, `SELECT` only |
| `ctx.writer` | only with `tables`: writes to the module's tables |
| `ctx.live.changed(payload)` | tells the open dashboards: the module's widgets read their data again |
| `ctx.meta` | `get(key)` and `set(key, value)`: small values of the module in the database (keys `module:<id>:data:…`) |
| `ctx.log` | `info`, `warn`, `error`, with the `[<id>]` prefix |
| `ctx.time`, `ctx.sql`, `ctx.budgets`, `ctx.tokensOf` | periods, SQL fragments and budgets of the core, to read OpenCode's data |
| `ctx.prices` | the per-model price list: `empty`, `of(model)` and `estimate(model, kinds)` (see [moduli.md](moduli.md#the-node-entry)) |

Not there: `process.env` (use `ctx.env`), the database (use `ctx.reader`/`ctx.writer`), the core's configuration, the token. **`ctx.store` is not a place for your data**: it has only `counts()`, the lens's counters. The full list, with `readers`, `zip`, `skillLoads` and `collector`, is in [moduli.md](moduli.md#the-node-entry).

**The texts** the Node code shows go through `const { t, N_ } = ctx.i18n` and **bare** calls, `t("…")` and `N_("…")`: never `ctx.i18n.t("…")`, which the translation scanner does not see. Every text has an entry in the module's catalogs.

## GET and POST routes

`create(ctx)` returns `routes`, an object `{ "<METHOD> <path>": … }` (`routeError` and `#buildRoutes` of `src/modules.js`):

| Key | Value |
|---|---|
| `"GET /api/x"` | `(req, { url, local }) => answer`; also answers `HEAD` |
| `"GET /api/x/*"` | as above, for every path **under** `/api/x/`, with `rest` (the remainder, already decoded) |
| `"POST /api/x"` | `{ handler, body: { type: "json", max }, what }`; `handler(req, { url, local, body })` gets the JSON already read |
| `"POST /api/x/*"` | as above, with `rest` |

- **The path** starts with `/api/`, has only lowercase letters, digits, `/`, `_` and `-` (`[a-z0-9/_-]`, `ROUTE_KEY` of `src/modules.js`), and does not touch a core path (lists «Percorsi /api riservati», “reserved /api paths”, of `lens_module_guide`) nor another module's route: such a route is dropped with a warning in the log, and the module stays on. Use `/api/<id>` and `/api/<id>/…`. `lens_module_check` does not see the routes (they are born in `create`): clashes show only in the log at startup.
- **`url`** is a `URL`: parameters are read from `url.searchParams`. **`local`** is `true` for a client of this computer: a `GET` also answers from the network (with the token), so do not give the network what is meant for this computer only. **`rest`** may contain `/` and `..`: never use it as is as a file path; it is `null` for a broken encoding.
- **A `POST` declares its body**: `body: { type: "json", max }` with `max` an integer in bytes, from 1 to 16 MiB; there are no other types for JSON (no `empty`: a `POST` with no data still sends a JSON object, `{}` at least). Before the `handler` the lens applies the checks of every write (from this computer only, `Origin`, `content-type: application/json`, token) and the `max` limit. `what` is required: what is modified, with a bare `N_`, for the refusal messages. For a non-JSON body (`type: "raw"`) see [moduli.md](moduli.md#routes).
- **The answer**: a plain object is a JSON `200`; another status is `return ctx.reply(400, { errors: [t("…")] })`. Anything else, or an exception, is a generic `500` with the error in the log. The page reads the `errors` of a refusal (see [Browser page](#browser-page)).
- **A handler may be `async`**: the lens awaits the promise (`moduleAnswer` of `src/server.js`) and the rules of the answer apply to the resolved value; a rejected promise is a `500`. Awaiting short, bounded work is fine; long work is not (see [Long work](#long-work)).
- **The period**: `ctx.range(url.searchParams, { earliest })` reads `?from=` and `?to=` like the core: `from=day` is the budget day, `from=0` is “everything” (with `earliest`, a function giving the module's oldest data in ms or `null`, it starts there), otherwise milliseconds. It is what arrives from a widget's `{from}`.

The example module's routes:

```js
"GET /api/mio-modulo": (_req, { url, local }) => {
  const all = notes.read().notes;
  const { from, to } = ctx.range(url.searchParams, { earliest: () => all[0]?.at ?? null });
  const inPeriod = all.filter((n) => n.at >= from && n.at <= to);
  return {
    note: ctx.settings.note ?? "",
    notes: [...all].reverse(),
    count: inPeriod.length,
    last: inPeriod.at(-1) ?? null,
    from,
    to,
    canSave: local,
  };
},
"POST /api/mio-modulo": {
  body: { type: "json", max: 4096 },
  what: N_("le note del modulo d'esempio"),
  handler: (_req, { body }) => {
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text === "" || text.length > MAX_TEXT) return ctx.reply(400, { errors: [t("La nota deve avere da 1 a {max} caratteri", { max: MAX_TEXT })] });
    const doc = notes.read();
    notes.write({ version: 1, notes: [...doc.notes, { text, at: Date.now() }].slice(-MAX_NOTES) });
    ctx.live.changed({ notes: Math.min(doc.notes.length + 1, MAX_NOTES) });
    return { ok: true };
  },
},
```

Always check a `POST`'s body field by field: it may be `null`, a list or anything.

## Persistence

Choose one of the two ways. When in doubt, the first.

**`ctx.jsonStore`: a JSON file next to the database.** For small documents (settings, notes, a short history). `ctx.jsonStore({ name, validate, empty, what })` (`src/module-kit.js`, on the `JsonStore` of `src/presets.js`):

- `name`: a file name, `^[a-z0-9][a-z0-9._-]*\.json$`, no folders, not a core file (otherwise it throws `TypeError`). Use `<id>.json`.
- `validate(doc)`: returns `{ ok: true, doc }` with the document cleaned up or `{ ok: false, errors }`. The file can be edited by hand: check everything.
- `empty()`: the document when there is nothing yet.
- `what`: `{ broken, none, dropped }`, the three Italian phrases the log uses to say the file is not usable (`<file> non è JSON valido: <broken>`, `<file> <none> (reasons): <dropped>`), agreeing with each other.
- It gives `read()`, `write(doc)` (atomic: temporary file and rename), `path` and `badFile`. An unreadable file gives `empty()`, a warning in the log and a `<name>.bad.json` copy that a save does not destroy: `read()` too may write, which is why `hasData` does not use it (see [Node entry and ctx](#node-entry-and-ctx)). With `LENS_DB=:memory:` the document stays in memory until restart and `path` is `null`.
- `read()` and `write()` are **synchronous and uncached**: every `read()` reads and validates the file again. Keep the document small (the example module keeps at most 50 notes of 200 characters) and do not call them in a loop.
- Make the store **in a variable of the module**, in `create` (and, for `files`, with the same function), and declare it in `files()`:

```js
const FILE = "mio-modulo.json";
const WHAT = { broken: "le note sono ignorate", none: "non contiene note valide", dropped: "sono ignorate" };
const notesStore = (ctx) => ctx.jsonStore({ name: FILE, validate, empty, what: WHAT });

export function files(ctx) {
  const { N_ } = ctx.i18n;
  const store = notesStore(ctx);
  if (!store.path) return [];
  return [
    { label: N_("Note del mio modulo"), path: store.path, note: N_("le note scritte nella pagina del modulo d'esempio") },
    { label: N_("Note del mio modulo (file non valido)"), path: store.badFile, note: N_("copia di mio-modulo.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse") },
  ];
}
```

**`tables` + `ctx.writer`: tables in the lens's database.** For many rows, queries by period, data that grows. The manifest has `tables: () => import("./tables.js")`; `tables.js`, with no imports, exports `{ version, sql, columns? }` with only `CREATE TABLE IF NOT EXISTS <id>_…` and `CREATE [UNIQUE] INDEX IF NOT EXISTS <id>_… ON <id>_…`. **A module with tables has an id of lowercase letters and digits only** (`^[a-z][a-z0-9]*$`), because `<id>_` is the prefix of SQL names: with the id `mio-modulo` the tables are refused. They are checked by `src/module-tables.js`; the full rules are in [A module's tables](moduli.md#a-modules-tables). You write with `ctx.writer.statement(sql).run(…)` and `ctx.writer.tx(fn)` (fn synchronous): only `INSERT` and `UPDATE` on your own tables, never `DELETE` or `REPLACE` ([Writing to your own tables](moduli.md#writing-to-your-own-tables)). Tables are never deleted, not even when the module is turned off.

**Reading the database** (OpenCode's data too): `ctx.reader.get(sql, …values)` and `ctx.reader.all(sql, …values)`, only `SELECT` and `WITH … SELECT`, one statement. In the SQL text **only constants**: values go as `?` parameters, lists as one JSON parameter (`IN (SELECT value FROM json_each(?))`). At most 256 different SQL texts per module. The rules are in [Reading the database](moduli.md#reading-the-database-ctxreader).

**Never**: `ctx.store` for your data, files written outside the data folder without declaring them, `node:sqlite` opened by hand on the lens's database.

## Browser page

The page is the file `public/page.js` plus `public/page.html` (and, if needed, `public/style.css`). The lens loads them only for a module that is on (`loadModulePage` of `public/app.js`, `src/module-html.js`).

- **`page.js`** exports `title` (the title, `t("…")`) and `page`, a page of the director (`createDirector` of `public/kit.js`): `{ id, refreshMs?, setup?(ctx), show?(ctx), refresh?(ctx), hide?(ctx) }`. `page.id` is the module's id, otherwise the page does not load. `setup` runs once and gets `report(err)`, which shows an error in the banner; `show` runs when the page opens; `refresh` every `refreshMs` while it is on screen.
- **`page.html`** is a `<section class="page-view hidden" id="view-<id>">`. No `style` attributes nor `<script>`: the page's CSP blocks them. Texts are Italian with `data-i18n` (or `data-i18n-placeholder`, `data-i18n-aria-label`). HTML ids are shared with the whole dashboard: give them a prefix (the example module uses `mm-`). In the title bar (below), `data-ico="<id>"` copies the menu icon.
- **Import from the lens only `"/module-kit.js"`** (`public/module-kit.js`): `t`, `tn`, `N_`, `el`, `$`, `get`, `send`, `table`, `stateBox`, the formatters (`fmtDateTime`, `nf`, `money`, `dur`…), the helpers for small charts (below) and a few more. The rest with relative paths, inside `public/`.
- **Small charts** (`public/spark.js` and `public/ui.js`, from the kit), each returns an element to put in the DOM:
  - `barSpark(values, slot, { highlightLast, title, label })`: a bar `<svg class="spark">` (`viewBox` 120×30). `slot` is the colour, from `1` to `7` or `"other"`; the last `highlightLast` bars (7 by default) are full, the earlier ones dimmed; `title(value, index)` gives the hover text; `label` is the `aria-label`.
  - `sparkSvg(w, h, label)`: an empty `<svg class="spark">`, to draw on with `svg(tag, attributes)` (an SVG element with those attributes).
  - `ring(ratio, label, { size, stroke, title })`: a ring filled up to `ratio` (at most 1), with `label` in the middle; green, amber over 0.85, red over 1.
  - `facts(box, [[label, value, mono], …])`: fills a strip of facts (`box` is an id or an element; `null` or `false` entries are skipped, a missing value is “–”, `mono` writes it in a fixed-width font). `ago(ms)`: the time elapsed, “5 min ago” (“never” without a date).
  - `barSpark`, `sparkSvg`, `ring` and `svg` use `document.createElementNS`: the fake DOM of the module's tests must have it. The example module's has only `createElement` and `createTextNode`: add it before testing a widget or a page that draws a chart.

**The title bar** of `page.html`, with an action and a strip of facts (as in `modules/skill/public/page.html`):

```html
<header class="topbar">
  <div class="tb-row">
    <div class="slot s-ident">
      <span class="tb-ico" data-ico="mio-modulo" aria-hidden="true"></span>
      <div class="tb-title">
        <h1 id="mm-title" data-i18n>Il mio modulo</h1>
        <p class="ctx" data-i18n>Un blocco di note, per vedere come è fatto un modulo</p>
      </div>
    </div>
    <span class="spacer"></span>
    <div class="slot s-actions">
      <button class="primary" type="button" id="mm-scan" data-i18n>Scansiona</button>
      <button class="ghost" type="button" id="mm-export" data-i18n>Esporta…</button>
    </div>
    <div class="slot s-action"></div>
  </div>
</header>
<div class="view-body">
  <div class="facts" id="mm-facts"></div>
  …
</div>
```

Action buttons go in the `s-actions` slot: `primary` for the main action, `ghost` for the others. The strip of facts is a `<div class="facts">` that `page.js` fills with `facts("mm-facts", [[t("Ultima scansione"), ago(d.at)], [t("Cartella"), d.dir, true]])`. `mm-scan`, `mm-export` and `mm-facts` are examples: the example module does not have them.
- **Read with `get(path)` and write with `send(path, body)`**, never with a raw `fetch`: they send the language, `get` times out after 30 seconds, and they throw on an error status. `send` throws an `Error` with `errors`, the texts of the server's refusal.
- **Never `innerHTML` with data**: what comes from the server or from a file goes into the DOM with `el(tag, { text })` or `textContent`.
- **No work at import** (neither DOM nor timers): the tests import the page without a DOM.
- **One write at a time**: turn off the field and the button while `send` is in flight, and do not let a `refresh` arriving meanwhile turn them back on (the example module keeps a `saving` flag).

The heart of the example module's `page.js`:

```js
import { $, el, fmtDateTime, get, send, stateBox, t, table } from "/module-kit.js";

const API = "/api/mio-modulo";
export const title = t("Il mio modulo");

function draw(d) {
  $("mm-welcome").textContent = d.note || t("Nessuna nota di benvenuto: scrivila da Impostazioni › Moduli.");
  $("mm-list").replaceChildren(
    d.notes.length
      ? table([t("Quando"), t("Nota")], d.notes.map((n) => el("tr", {}, el("td", { text: fmtDateTime(n.at) }), el("td", { class: "key", text: n.text }))))
      : stateBox("empty", t("Nessuna nota ancora: scrivine una qui sopra.")),
  );
}

async function refresh() {
  draw(await get(API));
}

export const page = { id: "mio-modulo", refreshMs: 30_000, setup, show: refresh, refresh };
```

**The catalogs.** `public/lang-en.js` and `public/lang-fr.js` export by default an object `{ "Italian text": "translation" }`, with the same keys; a plural (`tn`) has the key of the “many” form and the value `{ one, other }`. The key is the exact Italian text of `t("…")`, `N_("…")`, `Localized("…")`, `data-i18n` and of the manifest's texts. A text the core already translates (`Salva`, `Annulla`…) is not needed: in the tests, `catalogs({ en, fr })` of the test kit gives the core's catalogs with the module's added, as the dashboard loads them (the example module's «lang-en.js e lang-fr.js» test uses them that way). The rules are in [traduzioni.md](traduzioni.md).

## Dashboard widgets

A module's widget appears in **Customize › Add** next to the core's ones, can be moved, resized and has its own ⚙. The manifest has `widgets` and `widgetsFile`, judged by `widgetFieldsError` of `src/module-widget-fields.js`.

**Each entry of `widgets`:**

- `type`: `<id>-<name>` (`mio-modulo-conteggio`), all of it in `^[a-z][a-z0-9-]*$`, at most 31 characters; not a type of the core nor of another module (list «Tipi di widget già presi», “widget types already taken”), not repeated.
- `label` and `description`: non-empty Italian texts, with an entry in the catalogs.
- `size` and `min`: `[width, height]` integers, width from 1 to 12 columns, height from 1 to 40 rows, `min` never larger than `size`.
- `home`: where the editor offers it, `"adesso"`, `"analisi"` or `"both"`. Never in the Monitor view.
- `settings` (optional): the choices of the ⚙. `title: null` makes the title editable. `range` offers the dashboard's periods, only among `"dashboard"` (follows the view), `"day"`, `"3600000"`, `"28800000"`, `"86400000"`, `"604800000"`, `"2592000000"` and `"0"` (“everything”). Any other key is yours: it starts with a lowercase letter, letters and digits only, and is not a key of the core's widgets (`metric`, `by`, `source`, `model`, `sort`, `style`…); the value is a list of 1 to 20 distinct non-empty texts, without `"dashboard"`. The ⚙ shows the key as `t(key)` and each value as `t(value)`: write key and values as Italian words and put them in the catalogs.
- `data`: 1 to 4 paths the widget reads, each a `GET` route **of the module itself** (query aside), starting with `/api/`, with no `..`, `#`, spaces nor `%2e`/`%2f`/`%5c`, with at most one `{from}` placeholder and no other braces. `{from}` is optional: if the widget has a period, put it in the query, `"/api/mio-modulo?from={from}"`; a widget without a period reads `"/api/<id>"` and offers no `range`.

**The limits**, the same `lens_module_guide` gives in «Limiti dei widget», “widget limits” (`WIDGET_LIMITS` of `src/module-widget-fields.js`, `widgetLimits` of `GET /api/modules/authoring`):

| Limit | Value | |
|---|---|---|
| `maxWidgets` | 12 | entries of `widgets` |
| `maxDataPaths` | 4 | paths of `data` per widget |
| `maxValues` | 20 | values of one key of `settings` |
| `maxWidth` | 12 | width of `size` and `min`, in columns |
| `maxHeight` | 40 | height of `size` and `min`, in rows |
| `maxTypeLength` | 31 | characters of `type` |
| `fromPlaceholder` | `{from}` | the only placeholder of `data` |
| `homes` | `adesso`, `analisi`, `both` | the values of `home` |

**`{from}`** becomes the start of the widget's period: `day` for the budget day, otherwise milliseconds, `0` for “everything”. The period is the ⚙'s or, with `dashboard`, the view's. The route reads it with `ctx.range` (see [GET and POST routes](#get-and-post-routes)). At startup a widget with a path that is not a `GET` route of the module is dropped, and in its place the dashboard says which path is wrong; `lens_module_check` does not see it.

**The widgets file** (`widgetsFile`) exports by default an object with one renderer per type, `export default { "<type>": { mount, update, resize? } }`, and imports from the lens only `"/module-kit.js"`:

```js
import { el, full, tn, t } from "/module-kit.js";

const DATA = "/api/mio-modulo?from={from}";

const conteggio = {
  mount(root, ctx) {
    root.replaceChildren(
      el("div", { class: "card-head" }, el("div", { class: "head-text" }, el("h2", {}, el("span", { "data-part": "title", text: ctx.title })))),
      el("div", { class: "kpi-main" }, el("span", { class: "kpi-value", "data-part": "value", text: "–" })),
      el("div", { class: "kpi-label", "data-part": "label" }),
      el("div", { class: "kpi-note", "data-part": "note" }),
    );
  },
  update(root, ctx) {
    const d = ctx.data(DATA);
    const count = d?.count ?? 0;
    root.querySelector('[data-part="value"]').textContent = full(count);
    root.querySelector('[data-part="label"]').textContent = tn(count, "nota nel periodo", "note nel periodo");
    root.querySelector('[data-part="note"]').textContent = d?.last?.text ?? t("Nessuna nota nel periodo");
  },
};

export default { "mio-modulo-conteggio": conteggio };
```

- **`mount(root, ctx)`** runs once, on an empty card: it builds the markup. Draw an element with `data-part="title"`: the dashboard rewrites its text when the title changes.
- **`update(root, ctx)`** runs at every refresh of the dashboard, once all the paths of `data` have arrived.
- **`resize`** is optional: if it is there (a function), the dashboard watches the card's size and, when it changes, calls `update` again. The function itself is not called.
- **The widget's `ctx`** (`widgetContext` of `public/module-widgets.js`) is frozen and has only `{ widget, title, settings, data, inst }`: `widget` is the saved widget (`id`, `type`, position, `settings`); `title` the title already decided (the user's or the `label`); `settings` the ⚙'s choices plus `range`, `metric` and `by` already resolved, with the view's when the widget follows it (`range` is `"day"` or milliseconds, `0` = “everything”); a key of yours never chosen is `undefined`, and the code picks the default itself (`ctx.settings.modo ?? "primo"`); `data(path)` the JSON of a path of `data`, written **as in the manifest** (with `{from}`), `undefined` for any other; `inst` an object of yours that lasts as long as the card, to keep state in.
- **Do not change** `ctx.settings`, `ctx.widget` nor the data: freezing is one level deep and the objects are shared with the other cards.
- **No timers nor reads of your own** (`setInterval`, `setTimeout`, `fetch`): the dashboard reads the data and calls `update`. To refresh the widgets right after a write, the route calls `ctx.live.changed(…)`.
- **Never `innerHTML` with data**: `el(…, { text })` or `textContent`. Use the core's classes (`card-head`, `kpi-value`…) and colour tokens (`--border`, `--text-primary`…).

**When it is not drawn** (`public/module-widgets.js`, `public/dashboard-grid.js`):

- The widgets file loads only for a module that is on, within **5 seconds** (`LOAD_TIMEOUT_MS`): a syntax error, a 404, a delay or a type without `mount` and `update` leave “Widget of the {name} module not loaded” in its cards, with the error in the console. The dashboard and the other modules go on.
- A `mount` or an `update` that throws shows “Data unavailable” in that card, with the message in the tooltip; after a failed `mount` reload the page.
- With the module off, in error or to configure, the widget **stays in the saved layout** and in its place says “The {name} module is off: turn it on in Settings › Modules”, “The {name} module has an error: see Settings › Modules” or “The {name} module needs configuring: see Settings › Modules”, with no requests. Turned back on, it is as it was. The same holds for a module whose manifest does not load (a wrong `widgets`, a `lens` newer than the running lens, a `module.js` that throws): there is no manifest to read the name from, and in place of `{name}` is the module's id.
- In the layout the modules' widgets are **fixed obstacles**: the core's flow around them, “Compact” does not move them up; they move only by hand.

## The module's MCP

Optional. A module can offer tools to the lens's MCP server, which OpenCode shows with the `lens_` prefix (the tool `note` would become `lens_note`). The rules: `src/module-mcp-fields.js` and `src/mcp/modules.js`; the details in [A module's MCP tools](moduli.md#a-modules-mcp-tools).

- The manifest declares `mcp: () => import("./mcp/tools.js")` and `mcpTools: ["<name>"]`; a name already taken (list «Nomi di strumenti MCP già presi», “MCP tool names already taken”, `module_guide` and `module_check` included) is dropped, and `lens_module_check` reports it as an error.
- `mcp/tools.js` **imports nothing**: it exports `tools(kit)`, which returns `[{ name, title, description, inputSchema, run(args, ctx) }]`. Everything comes from `kit` (`createToolKit` of `src/mcp/module-kit.js`): `argSpec`, `withLens`, `ToolError`, `LensError`, `SINCE`, `now`, `text` (`cleanName`, `cleanText`, `num`, `plural`…).
- **`kit.argSpec({ … })`** gives `{ inputSchema, parse(args) }`. Each argument has `description` and one of `enum: [...]`, `int: [min, max]`, `bool: true` or nothing (a non-empty text); plus `default`, `required: true` (missing → error), and for a text `pattern` (a regular expression, as text) with `hint` (the phrase the error shows instead of the expression). `parse` refuses unknown arguments.
- The tool talks to the lens **over HTTP only**, with the module's routes: `return withLens(signal, async (lens) => { const d = await lens.get("/api/mio-modulo", {}, signal); return "…"; })`. The texts that reach the model are in Italian and are not translated.
- **OpenCode does not reread the list of tools**: a new tool, or one of a module just turned on, appears only after a **restart of OpenCode**. A tool of a module that is off answers «Il modulo … è spento in Lens», “the … module is off in Lens”.

## Long work

- **Never block the process**: the lens serves the dashboard and the MCP from the same thread. A read of many files, a scan of folders, a long computation go in pieces, with asynchronous APIs (`node:fs/promises`) and pauses (`await new Promise((r) => setImmediate(r))`) between one piece and the next.
- **Put limits** on everything read from outside: number of files, size of a file, depth, total time. Past the limit stop and say so (a field in the answer, a warning in the log), do not go on.
- **`start()` has 10 seconds** (`START_TIMEOUT_MS` of `src/modules.js`): an asynchronous `start()` that does not finish in time sends the module to `error`, and the lens calls `stop()`. The time limit does not stop synchronous code. Heavy work is scheduled (`setTimeout(…, 0)`) and `start()` returns at once.
- **Periodic work** starts in `start()` (a `setInterval`) and stops in `stop()` (`clearInterval`): `stop()` is called when the lens stops and restarts. After updating the data, `ctx.live.changed(…)` makes the widgets on screen read again.
- **`stop()` closes everything the module opened**, in `start()` or in a route: every timer, watcher, subscription or socket, and the work a request started (a scan begun by a `POST`). The lens calls `stop()` for every module that is on when it stops and restarts, even one without `start()` (`stop()` of `ModuleRegistry`, `src/modules.js`). It never deletes nor truncates the module's data: turning a module off is not uninstalling it. The routes and `families()` exist only while the module is on.
- **A route does not wait for long work**: it answers with the last ready result, or starts the work and answers at once, and a later `GET` reads its progress. It may wait (`await`) for bounded work that does not block: a scan capped at a few seconds, in pieces with `setImmediate`, well under the 30 seconds after which the page's `get` gives up.
- **Metrics** (`families()`) are a fast read of what the module already has: `[{ name, type: "gauge", help, samples: [{ labels, value }] }]`, with `name` `opencode_lens_<id with _>_…` and labels with bounded values (like `modules/security/server/audit.js`). A metric without labels has `labels: {}` (like `opencode_lens_bob_up` of `modules/bob/server/source.js`).

## Verification

After every change, in this order.

1. **`lens_module_check` with `id`** (`POST /api/modules/check`, `checkUserModule` of `src/modules.js`). It judges the module in the user's folder as at startup, without turning it on: manifest, widgets, tables, `configure` with the lens's current environment (where a new module's variable does not exist yet: empty must be valid), names already taken. It works also on a module the lens has not discovered yet, and reads `module.js`, `tables.js` (if the manifest has `tables`) and `server/index.js` again at every call; the other files `server/index.js` imports stay the ones loaded the first time, until the lens restarts. **It is not a read**: it runs the top-level code of those files, and `configure()`, in the lens's process (which is why `server/index.js` must have no side effects at import). It answers «OK» or the errors: fix and call again until it is «OK». The **warnings** under an «OK» are reminders, not errors: that the code runs at every check, that routes and the widgets' `data` paths are verified only at startup, that the module is not yet among those discovered (restart the lens) or that it is already loaded (the changes apply after a restart of the lens), that `widgetsFile` is missing from `public/`, that a widget type starts with another module's id, that a variable, a widget type or an MCP tool of the module already belongs to a module that comes after it by id (at the restart that module would go to error, or lose the tool). The last three must be fixed.
2. **Restart the lens** (`opencode-lens service restart`), which discovers modules only at startup. The log (`~/Library/Logs/opencode-lens/lens.log` on macOS) tells the dropped routes and widgets.
3. **Settings › Modules** › the module's card (label “your own” and the folder) › *Turn on*: the lens restarts with the module on. If `configure` refuses the value of the fields (empty ones too), *Turn on* is not saved and the page shows the errors. If the state is `error` or `unconfigured`, the card says why. Check the menu entry, the page, the widget in **Customize › Add** and, if any, the MCP tools after a restart of OpenCode.
4. **The module's tests**, in its `test/` folder (the example module has a complete one: `test/template.test.js`). They import from the lens only `"/module-test-kit.js"` (and `"/module-kit.js"` for the browser code), which the app's `test/module-hooks.mjs` resolves:

   ```bash
   # <app> is ~/Applications/opencode-lens (or a copy of the lens's repository)
   node --disable-warning=ExperimentalWarning --import <app>/test/module-hooks.mjs --test "<modules folder>/mio-modulo/test/"*.test.js
   ```

   The test kit needs Node 22.13 or later, like the lens. If `install.sh` downloaded Node, use `~/Applications/opencode-lens/node/bin/node` instead of `node`.

   `"/module-test-kit.js"` gives `memoryStore()` and `moduleContext(…)` (a real `ctx` on an in-memory database), `Queries`, `createToolKit` and `createHandler` for the MCP tools, `widgetContext(spec, ctx)`, the frozen `ctx` the dashboard hands to `mount` and `update`, and `catalogs({ en, fr })`, the core's catalogs with the module's. The full list is in [Trying a module](moduli.md#trying-a-module). Test at least: the manifest, `configure` (empty, valid, wrong value), every route (the refusals of a `POST` too), the JSON file (unreadable → empty), the widget with `widgetContext`, the page, the catalogs (every text translated, by the module or by the core; no orphan entry) and the imports.

   The test kit does not give the `ctx` of `configure` (`{ id, env, paths, i18n }`): build it with `paths` and `i18n` of a `moduleContext` `ctx`, as the example module does (its `setup()` makes the `ctx` with `moduleContext`):

   ```js
   const { ctx } = setup();
   const given = (env) => configure({ id: ID, env, paths: ctx.paths, i18n: ctx.i18n });
   assert.deepEqual(given({}), { values: { note: "" }, errors: [] });
   ```

## Updating a module

- **On the same computer** you edit the files in the user modules folder and go through the [Verification](#verification) again: `lens_module_check`, restart, tests.
- **From a zip** (a module written elsewhere, or the new version of a module you already have): compress the module's folder, not its content, so that the zip holds `<id>/module.js`; several modules go in the same zip, one folder each, no file at the root. Upload it in **Settings › Update** (`src/module-update.js`); `LENS_TOKEN` must be set, otherwise the lens answers 403.
- **The preview** runs nothing of the module: it only says whether it is new or replaces the installed one, and warns that it is unsigned code. An id of a lens module is refused.
- **Install**, after the confirmation, first judges each module with the same check as `lens_module_check` (so it runs its top-level code and `configure()`). A module with errors blocks the whole zip, nothing is installed and the section shows each module's errors: fix them and upload the zip again. Make `lens_module_check` pass before compressing.
- **Then** it puts the old folder in `<modules folder>/.backup/<id>-<date>/` and the new one in its place with a `rename`: never half a module, and all or nothing (if a swap fails, the modules already replaced go back as they were). If the module was a symbolic link to a working copy, the link goes to `.backup/` and the working copy stays as it is, but from then on the module is no longer a link. The module's files in the data folder (`files()`, `ctx.jsonStore`, the tables) are not touched.
- **Finally** the lens restarts by itself if it runs as a service, otherwise restart it yourself. A module already on stays on; a new one is turned on from **Settings › Modules**. Changed MCP tools appear after a restart of OpenCode.

## Checklist

- [ ] The folder is `<user's modules folder>/<id>/`, not inside `~/Applications/opencode-lens`.
- [ ] The id is the same in folder, `id`, `page.id`, `view-<id>`, prefix of the `/api/<id>` paths and of the widget types; it is not already taken nor reserved.
- [ ] `module.js` has no imports; `server/index.js` does nothing at import and exports `create`.
- [ ] `lens` is the version `lens_module_guide` gives, not a newer one.
- [ ] Each setting has `LENS_<ID>_…`, `label`, `help`, `kind`, and is read by `configure`, which returns `{ values, errors }` and accepts the empty value.
- [ ] Each file written is declared in `files()`; paths only read have `kind: "read"`.
- [ ] The data are in `ctx.jsonStore` or in `tables`, never in `ctx.store`; with `tables` the id has only lowercase letters and digits.
- [ ] Each `POST` has `body: { type: "json", max }` and `what` with `N_`; each refusal goes through `ctx.reply`.
- [ ] The browser imports only `"/module-kit.js"`, reads with `get`, writes with `send`, puts data in with `text`/`textContent`.
- [ ] Each widget reads only `GET` routes of the module, has `data-part="title"`, no timers, and does not change the `ctx`.
- [ ] Each Italian text has its entry in `lang-en.js` and `lang-fr.js`, with the same keys.
- [ ] No long work blocks the process; every read from outside has limits.
- [ ] `lens_module_check` says OK; after the restart and *Turn on* the state is `on`; the module's tests pass.

## Typical mistakes

The mistakes made by whoever writes a module reading only the documentation, and the fix.

1. **The module in the app folder** (`~/Applications/opencode-lens/modules/`): it disappears at the first upgrade. It goes in the user's modules folder (see [Where to save the module](#where-to-save-the-module)).
2. **A setting read from `process.env`, or without `configure`**: `ctx.settings` stays `{}` and the variable never arrives. Declare the variable in `settings` (`kind: "text"` for a list of paths, separated by `:`), read it in `configure(ctx)` from `ctx.env`, accept the empty value (a default or “not configured”: otherwise `lens_module_check` never says «OK» and *Turn on* is refused), otherwise only valid values (for paths: absolute), and return `{ values, errors }`.
3. **The data in `ctx.store`**: those are the lens's counters, not a storage. Use `ctx.jsonStore({ name, validate, empty, what })` in a variable of the module and declare the file in `files()`, together with the folders the module only reads (`kind: "read"`).
4. **A `POST` with no declared body, or with a made-up type** (`body: { type: "empty" }`): the route is dropped. It needs `body: { type: "json", max }` and a `what` with a bare `N_`.
5. **The page with a raw `fetch`, `innerHTML` or imports from the lens outside the kit**: use `page` and `title`, only `"/module-kit.js"` (`get`, `send`, `el`, `table`…), and the data's text as text.
6. **A scan with no limits, in the lens's thread**: the dashboard freezes. Put limits on number and size of the files and on time, and work in pieces without blocking (see [Long work](#long-work)).
7. **`families()` with a made-up shape**: metrics are `[{ name, type, help, samples: [{ labels, value }] }]`, as in `modules/security/server/audit.js`.
8. **A widget that reads something other than its own routes, or that refreshes itself**: `data` lists `GET` routes of the module itself, with `{from}` in the query if the widget has a period; `update` draws what the dashboard read, without timers.
9. **No tests, or tests that import the lens by path**: tests import `"/module-test-kit.js"` and run with `--import <app>/test/module-hooks.mjs` (see [Verification](#verification)).

Other frequent mistakes: an `async` `create` (it returns a promise: `error`); a `widgetsFile` that is not in `public/`; a widget type without the `<id>-` prefix; a ⚙ key that is a core key (`metric`, `by`…); `t` called as `ctx.i18n.t("…")` (the text stays untranslated); a `ctx.data` asked with the path resolved differently from the manifest's.
