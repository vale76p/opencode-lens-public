# Modules

🌐 [Italiano](../moduli.md) · English · [Français](../fr/moduli.md)

A module is an optional part of the lens, in a `modules/<id>/` folder. All of them are **off** by default: an off module has no menu entry, no routes, no background work and no metrics. The rest (Now, Analysis, Monitor, Prompts, Sessions, Gallery, What's new, Settings) is the core and is always there.

Today there are five modules: **Vibe Coding**, working time, costs and tokens by project and folder (see [dashboard.md](dashboard.md#vibe-coding)); **System**, the computer the lens runs on (see [dashboard.md](dashboard.md#system)); **Security**, what OpenCode's DLP guards let through or blocked (see [sicurezza.md](sicurezza.md)); **IBM Bob**, the tasks of Bob IDE and Bob Shell (see [dashboard.md](dashboard.md#ibm-bob)); **Skill**, the library of your skills, with versions, presets and how much OpenCode uses them (see [Skill](#skill) and [dashboard.md](dashboard.md#skill)).

## Turning a module on

- **From the dashboard**: **Settings › Modules** has one card per module found, with name, description, state and the *Turn on* (or *Turn off*) button. Turning a module on or off changes `LENS_MODULES`: it is saved like the other settings and the lens restarts (see [configurazione.md](configurazione.md#editing-from-the-dashboard)).
- **From the shell**, when the lens does not run as a service (started by hand with `npm start`) and the Settings page is read-only: `LENS_MODULES` is a comma-separated list of ids, for example `LENS_MODULES=sistema`.

The rules for `LENS_MODULES`:

- an id is made of lowercase letters, digits and hyphens, and starts with a letter (`sistema`, `demo-2`); spaces around the comma do not matter;
- a malformed or repeated id is a configuration error, and the lens does not start (as with the other variables);
- a well-formed id that matches no module is ignored, with a warning in the log.

### States

`GET /api/modules` gives each module a state:

| State | Meaning |
|---|---|
| `off` | found and not turned on |
| `on` | active and started |
| `unconfigured` | turned on but to be configured: its settings are incomplete or invalid (`configure` returns `errors`; the reason is in `reason`). It counts as off: no routes, background work or metrics. Fixed from the module's card |
| `error` | not usable: invalid manifest, lens too old for the module, failed start (also an async `start()` that does not finish within 10 seconds: the registry calls `stop()` and the server starts anyway), a `configure` that throws. The other modules and the lens carry on |

The reason for the error (`reason`) is shown only to clients of this computer, because it may name files of the computer. The same goes for `unconfigured`.

### After an upgrade

After the upgrade that introduces modules, those not listed in `LENS_MODULES` stay off. For each one that already has data, a notice appears on every page: «was in use: turn it back on from Settings › Modules». The notice is closed for good, one per module; closing it is `POST /api/modules/notice`. System never shows it: it stores nothing. Security shows it when it finds a guard's audit in its folders (`hasData` only looks at which files are there). The text of the notice is the manifest's `notice` field, if the module has one (`noticeMessage` in `GET /api/modules`); without it, a generic sentence “{name} was in use…”. IBM Bob shows it when it finds tasks in its `bob_tasks` table, and says that until you turn it back on it is no longer read and what Bob deletes in the meantime is lost. Skill shows the generic notice (“Skill was in use: turn it back on from Settings › Modules”) when it finds a skill in the index, a version folder in the library or a delivery of Lens's MCP in `skill_uses`; until you turn it back on its files stay as they were, never rewritten by the lens.

## Skill

Skill (`modules/skill/`, *Lens* menu, before System and Security) is the library of your skills with versions, the skill presets and how much OpenCode uses them (see [dashboard.md](dashboard.md#skill)). With the module off:

- **No routes, no page.** `/api/skills`, `/api/skills/<id>`, `/api/skill-presets`, `/api/skill-loads` and `/api/skill-usage` answer 404, the `POST`s too; the menu entry and the `#skill` page are gone.
- **MCP.** The `preset` tool and the `/lens:<id>` commands exist only with Skill on. The commands follow `notifications/prompts/list_changed`; the tool disappears from OpenCode only after OpenCode is restarted (see [A module's MCP tools](#a-modules-mcp-tools)). An MCP still running after the upgrade gets 404 on `/api/skill-loads`: the delivery reaches the model, but is not counted.
- **What stays in the core.** The `skill_uses` table with `src/skill-uses.js` and `src/skill-ids.js`, the metrics `opencode_lens_skill_loads_total` and `opencode_lens_skill_preset_loads_total` and the `skills/` folder the collector looks at to tell library skills from native ones keep filling even with Skill off: it is the only exception to “no metrics from an off module”. Recognising an old MCP from the requests to `/api/skill-presets` (`noteMcp`: a path observed, not served) also stays in the core. The dashboard layouts, which are also called presets, have nothing to do with it: they belong to the core.
- **Its files.** `skills/` (a folder: `kind: "dir"`), `skills.json`, `skill-presets.json` and the `.bad.json` copies belong to the module. While it is off it never rewrites them (neither `hasData` nor `files()` write), and the uninstall script removes them (see [disinstallazione.md](disinstallazione.md)).
- **After an upgrade.** See [above](#after-an-upgrade): `hasData` looks at the index, the version folders and the deliveries of Lens's MCP (`origin = 'lens'` in `skill_uses`).

## Your own modules

Besides the lens's modules you can keep modules of your own. They live in a `modules/` folder **next to the database**, outside the app folder:

| Where it runs | The folder of the user's modules |
|---|---|
| macOS | `~/Library/Application Support/opencode-lens/modules/` |
| Linux | `$XDG_DATA_HOME/opencode-lens/modules/` (by default `~/.local/share/opencode-lens/modules/`) |
| `LENS_DB` set | the `modules/` folder next to the database file |
| `LENS_DB=:memory:` | none: without a data folder there are no user modules |

- **What it looks like.** Each module is a `<id>/` subfolder made like one of the lens's (see [Writing a module](#writing-a-module)). The lens does not create the folder: if it is not there, nothing happens; if it cannot be read, the lens writes a warning in the log and goes on without user modules. Subfolders whose name is not an id (a Finder copy such as `demo 2`) are not modules. A subfolder may be a symlink to a folder (handy for a module you develop elsewhere): in the user's folder it counts as a module, in the lens's `modules/` folder it does not.
- **From a zip.** A module (or a zip with several modules) can also be installed and updated from **Settings › Update**: a preview that runs nothing, the check of each module only after the warning and the confirmation (**Install**), then the old folder in `.backup/` and the new one in its place (see [aggiornamento.md](aggiornamento.md#user-modules-from-the-dashboard)).
- **It survives upgrades.** `install.sh` deletes and recreates the app folder (`~/Applications/opencode-lens`) when you install from a release zip, and so does the in-app update, which runs that `install.sh`; it does not touch the data folder: your modules stay where they are. For the same reason the files a module writes with `files()` live in the data folder, and `modules` is a name reserved to the core (`CORE_DIRS`): no module can declare it.
- **The same rules.** The manifest, the id, the lens's minimum version, the variables and the states are judged as for the lens's modules (see [The manifest](#the-manifest) and [States](#states)); a user module is off by default and is turned on from **Settings › Modules** or with `LENS_MODULES`. A `settings` variable already declared by a lens module is a manifest error.
- **If the id already belongs to a lens module** (`sistema`, `skill`…) the lens wins: the user's folder is never imported, the lens writes a warning in the log and **Settings › Modules** shows “The folder … has the id of a lens module: rename it”. Rename the folder and the manifest's `id`.
- **A new module needs a restart.** The lens looks for modules only at startup: a module you add, or a `module.js` you change, shows up after you restart the lens. The same goes for the MCP server, which works out the user's folder from the service's plist (`LENS_DB`, not from `GET /api/modules`) and reads it only once, at startup: for its tools you must restart OpenCode (see [A module's MCP tools](#a-modules-mcp-tools)).
- **Where you see it.** The module's card in **Settings › Modules** shows the “your own” label and the folder; `GET /api/modules` gives `origin` and, only to clients of this computer, `dir` (only for the user's modules), `userDir` and `shadowed` (see [API](#api)).
- **No sandbox.** A user module is Node code the lens trusts: it runs inside its process, with the same permissions, and can read and write any file of yours, open network connections and use the database. Put in it only modules you wrote or read yourself.
- **Uninstall.** The lines about your modules appear only if the folder exists. `uninstall.sh` without `--purge` leaves your modules where they are and tells you the folder; with `--purge` it deletes them together with the data if they are inside the data folder, otherwise they stay where they are and the script says so (see [disinstallazione.md](disinstallazione.md)).

## API

| Endpoint | Content |
|---|---|
| `GET /api/modules` | `modules` (`id`, `name`, `description`, `state`, `reason`, `notice`, `settings` with `name`, `label`, `help`, `kind`, `placeholder`, `value` and `isSet`, `mcp`, `mcpExamples`), `enabled` (the ids of `LENS_MODULES`), `canSave` and, when it cannot save, the `reason` |
| `GET /api/modules` (other fields) | `noticeMessage` (the manifest's `notice` or `null`; `notice` stays the boolean “notice to show”), `settingsPanel` (the panel file or `null`), `min` and `max` in every `num` setting; `reason` is also there for `unconfigured` |
| `GET /api/modules` (the user's modules) | `origin` (`core` for the lens's modules, `user` for those in the `modules/` folder next to the database) on every module; from this computer also `dir` (the folder of a user module; `null` for the lens's own), `userDir` (the folder of the user's modules, `null` with the database in memory) and `shadowed` (the user's folders left out because they have the id of a lens module: `{ id, dir }`). From the network `dir` and `userDir` are `null` and `shadowed` is `[]`. The card shows “your own” and the folder for the user's modules, and one line for each folder left out |
| `POST /api/modules/notice` | `{ "id": "…" }`: closes the module's notice for good. From this computer only, with the same Origin, content-type and token rules as the other writes (see [metriche.md](metriche.md#local-api)) |
| `POST /api/modules/check` | `{ "id": "…" }`: judges the module `id` of the user's folder as at startup, without activating it, and answers `{ ok, id, name, dir, errors, warnings }` (`name` is the manifest's, `null` if it does not load). From this computer only, with the same Origin, content-type and token rules as the other writes. Used by the `module_check` MCP tool |
| `GET /api/modules/authoring` | the values of this installation for whoever writes a module (user folder, lens version, the ids, variables, paths, tools and widget types already taken, the widget limits). From this computer only: others get 403. Used by the `module_guide` MCP tool |
| `/api/system`, `/api/system/live` | exist only with System on; off, they answer 404 |
| `/api/vibe-coding`, `/api/vibe-coding/history`, `/api/vibe-projects` | exist only with Vibe Coding on (the `GET` of all three, the `POST` of `/api/vibe-projects`); off, they answer 404 (the `POST` too) |
| `/api/security`, `/api/security/<guard>` | exist only with Security on (the `GET` of both); off, they answer 404. See [metriche.md](metriche.md#local-api) |
| `/api/bob`, `/api/bob/probe` | exist only with IBM Bob on (`GET /api/bob`, `POST /api/bob/probe`); off, they answer 404 (the `POST` too). See [metriche.md](metriche.md#local-api) |
| `/api/skills`, `/api/skills/<id>`, `/api/skill-presets`, `/api/skill-loads`, `/api/skill-usage` | exist only with Skill on (the `GET`s, and the `POST`s of the first four); off, they answer 404, the `POST`s too: Lens's MCP reporting a delivery to a lens with Skill off gets 404 and the delivery is not counted. See [metriche.md](metriche.md#local-api) |
| `/api/status`, `/healthz` | an active module with `status()` adds `<id>` to `/api/status`, with `state()` to `/healthz`; see [Status in /api/status and /healthz](#status-in-apistatus-and-healthz) |
| `/modules/<id>/<file>` | the files in the `public/` folder of an **active** module: flat, lowercase names; for an off module it is 404 |

## Writing a module

To write a module of your own, in the user's modules folder, follow the guide [moduli-custom.md](moduli-custom.md): the order of the work, the example module `extras/module-template/`, the verification and the typical mistakes. This section is the full contract.

A module lives in `modules/<id>/`. The id is also the folder name and the page id, and matches `^[a-z][a-z0-9-]*$`. The fullest module to start from is `modules/vibecoding/` (`GET` and `POST` routes, database reads, files of its own); `modules/sistema/` is the smallest.

```
modules/<id>/
  module.js          manifest
  tables.js          the module's tables: { version, sql, columns } (optional)
  server/index.js    Node entry: create(ctx), hasData(ctx), files(ctx)
  server/writes.js   the write SQL for ctx.writer (only with tables.js)
  mcp/tools.js       the module's MCP tools: tools(kit) (optional)
  scripts/           the module's terminal scripts (optional)
  public/            browser files, all in the same folder
    page.js          exports page and title
    page.html        the page markup
    settings.js      the panel in the card (optional)
    widgets.js       the widgets for the dashboard (optional)
    style.css        optional
    lang-en.js       the module's catalogs
    lang-fr.js
  test/              the module's tests
```

The Node entry must have no side effects at import time: the lens imports it even for an off module, to ask `hasData` and `files`. What the module needs is done in `create(ctx)` and `start()`. An id equal to a core page or view (`dashboard`, `impostazioni`, `adesso`…) is reserved: the module goes to `error`.

### The manifest

`module.js` default-exports an object, with no static imports. The lens judges it with `src/modules.js`; an invalid manifest puts the module in `error` with the reason.

| Field | |
|---|---|
| `id` | equal to the folder |
| `name`, `description` | texts in Italian, translated by the module's catalogs; the same holds for `label`, `help` and `placeholder` of `settings` and for `mcpExamples` |
| `lens` | minimum lens version, `x.y.z`; with an older lens the module stays in `error` |
| `menu` | `group` (`dati` or `lens`), `order` (a number: within the group entries go by `order`, then by id) and `icon` (the inside of an `<svg viewBox="0 0 24 24">`) |
| `page.title` | the title of the menu entry |
| `server` | a function that imports the Node entry: `() => import("./server/index.js")` |
| `settings` | optional: the module's `LENS_…` variables, `[{ name, label, help, kind, placeholder? }]`; see [A module's settings](#a-modules-settings). For `num`: `min` and `max`, integers |
| `mcp` | optional: a function that imports the MCP tools, `() => import("./mcp/tools.js")`; see [A module's MCP tools](#a-modules-mcp-tools) |
| `mcpTools` | with `mcp`: the names of the tools the module offers, for example `["security"]` |
| `mcpInstructions` | with `mcp`: the lines added to the MCP server's instructions while the module is on. They reach OpenCode in Italian and are not translated: their entries in the en/fr catalogs exist only for the text scanner |
| `mcpExamples` | with `mcp`: the questions Settings › MCP server suggests for its tools, only while the module is on |
| `mcpPrompts` | with `mcp`: `true` if the `mcp` file also exports `prompts(kit)`, the module's prompts (in OpenCode, `/lens:<id>` commands); see [A module's MCP prompts](#a-modules-mcp-prompts) |
| `notice` | optional: the text (Italian, translated like `description`) of the “after an upgrade” notice; the card and the banner use it in place of the generic sentence. In `GET /api/modules` it is `noticeMessage` |
| `settingsPanel` | optional: the name of a `.js` file in the module's `public/` folder (`^[a-z0-9-]+\.js$`); see [The panel in the card](#the-panel-in-the-card) |
| `widgets` | optional: 1 to 12 widgets the module offers the dashboard, `[{ type, label, description, size, min, home, settings?, data }]`; requires `widgetsFile`; see [A module's widgets](#a-modules-widgets) |
| `widgetsFile` | optional: the name of a `.js` file in the module's `public/` folder (`^[a-z0-9-]+\.js$`) that draws the widgets; see [A module's widgets](#a-modules-widgets) |
| `tables` | optional: a function that imports the module's tables, `() => import("./tables.js")`; see [A module's tables](#a-modules-tables) |
| `source` | optional: `{ label }`, the module offers the dashboard another data source; see [An alternative source](#an-alternative-source) |

In the menu, module entries sit at the end of their group; in the *Lens* group they come before Settings.

### The Node entry

`server/index.js` exports:

- `create(ctx)`: returns at once (not a promise) an object with what the module needs, all optional: `routes` (see below), `start()` and `stop()` (possibly async), `families()` (the metric families for `/metrics`). If `create` or `start` throws, the module goes to `error`;
- `hasData(ctx)`: optional, says whether the module already has stored data and decides the notice after an upgrade. If it throws it counts as `false`;
- `files(ctx)`: optional, lists the files the module writes, `[{ label, path, note }]` (`label` and `note` in Italian, through `N_()`, `note` optional). The lens asks for them once at startup, even for an off module, and shows them in **Settings › Data and files** and in the uninstall script (see [disinstallazione.md](disinstallazione.md)). Because the path ends up in an `rm -f`, it must be **inside the data folder** (the database's): an entry without a `label`, with a relative path, outside the folder or equal to the folder itself is dropped with a warning in the log. With `LENS_DB=:memory:` there is no data folder and no file is accepted; a `files()` that throws gives nothing. An entry with `kind: "read"` instead declares a path the module **only reads** (Security, the guards' folders): it may be **any absolute path**, even outside the data folder, because the lens never writes or deletes it. It shows in **Data and files**, among the files read and only while the module is on, and does **not** enter the uninstall script. A `kind` other than `write`, `read` or `dir` drops the entry, with a warning in the log. If the module's settings are not valid (see [A module's settings](#a-modules-settings)) `files()` is not asked. An entry with `kind: "dir"` declares a **folder** inside the data folder (Skill: the `skills/` library): it shows in **Data and files** and the uninstall script removes it with `rm -rf`; outside the data folder it is dropped with a warning, like a `write`. The core keeps some files and folders for itself (`CORE_FILES` and `CORE_DIRS` in `src/core-paths.js`: the database with `-wal` and `-shm`, the files of the dashboard layout and layouts' presets, `update/`): an entry, `dir` included, that equals one of them, or sits inside a core folder, is dropped with a warning. If two modules declare the same path the lens warns and lists it once.
- **`start()` has a time limit.** An async `start()` has 10 seconds (`START_TIMEOUT_MS`): beyond that the module goes to `error` (“start() did not finish within 10 s”), the registry calls `stop()` and the server starts anyway. A time limit cannot stop synchronous code: heavy work is scheduled (`setTimeout(…, 0)`) and `start()` returns at once, as Bob does with its first read.
- Besides these, the object `create` returns may have `status()`, `state()` and `source()`: see [An alternative source](#an-alternative-source) and [Status in /api/status and /healthz](#status-in-apistatus-and-healthz).

#### Routes

`routes` is an object `{ "<METHOD> <path>": … }`. The path starts with `/api/`, and routes go through the host, token and method checks like every core route. A route already taken by the core or by another module is not overwritten; an invalid key or value is dropped with a warning, without stopping the module. Three forms:

| Key | Value | |
|---|---|---|
| `GET /api/x` | `(req, { url, local, rest }) => answer` | exact path; `rest` is `undefined`. Also answers `HEAD` |
| `GET /api/x/*` | same | prefix: every path **under** `/api/x/` (not `/api/x`). An exact path wins over a prefix |
| `POST /api/x` | `{ handler, body: { type: "json", max }, what }` | exact path. `handler(req, { url, local, body })` gets the JSON already read |
| `POST /api/x/*` | as above | prefix, with `rest` as for the `GET`s (already decoded; `null` for a broken encoding, which the module refuses; `""` for `POST /api/x/`) |
| `POST /api/x` with `body: { type: "raw", types, max }` | `handler(req, { url, local, body, rest })` | non-JSON body: `body` is a `Buffer`; see below |

- **`rest`** is what follows the prefix, **already decoded**: it may hold `/` and `..`, so never use it as a file path as it is. For `/api/x/` it is `""`; with broken encoding (`%zz`) it is `null`.
- **`what`** says what is being changed (`N_("i progetti")`), for the refusal messages. `body.max` is the body limit in bytes, an integer from 1 to 16 MiB: the core imposes it, not the module. Before the `handler` the POST goes through the same checks as the other writes: loopback only, `Origin`, `content-type: application/json`, token. With `body: { type: "raw", types: [...], max }` the body is bytes, not JSON (Skill: a skill's zip or a `SKILL.md`): `types` lists the content-types accepted; `type` is `"json"` when missing. The registry refuses in `types` the types a browser sends without a preflight (`text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`), wildcards and empty values, so the defence against cross-site requests stays “content-type not allowed by CORS”. The core compares only the media type, case-insensitively and without parameters; any other type gets a 415 with a translated text, a body over `max` a 413 with `connection: close`, and `writeRefusal` (loopback, `Origin`, token) runs before the body is read. The core-path rules apply to the `POST`s too, prefix or not.
- **The answer**: a plain object is a `200` in JSON; for another status return `ctx.reply(status, body)` (`ctx.reply(404, { error })`, `ctx.reply(400, { errors })`). Anything else (or an exception) is a generic `500`, with the error in the log under the module's id.
- **Off module**: a `GET`, `HEAD` or `POST` on its routes gives 404: the routes of a module that was found but is not on sit outside the 405 table. A non-`GET` request on an `/api` path that neither the core nor an active module serves gives 404 (a core path with the wrong method stays 405).
- **Texts**: a `what` and every text the module's Node code shows go through `const { t, N_ } = ctx.i18n` and **bare** calls `t("…")` and `N_("…")`, never `ctx.i18n.t("…")`: the translations scanner only sees bare calls.

The `ctx` is the only door to the core (`src/module-kit.js`) and is frozen:

| Field | |
|---|---|
| `id` | the module id |
| `env` | the environment variables **the module declares in `settings`**, plus `HOME` and `XDG_*`; never the core's others (`LENS_TOKEN`, passwords) |
| `paths` | the folders defaults start from: `home`, `opencodeConfigDir` (OpenCode's configuration) and `xdgData` (`$XDG_DATA_HOME` or `~/.local/share`); `dataDir`, the data folder (the database's; `null` with `:memory:`), also in the `ctx` of `configure`: Skill's library is `path.join(ctx.paths.dataDir, "skills")` |
| `settings` | the `values` `configure(ctx)` returned at startup (see [A module's settings](#a-modules-settings)); `{}` without `configure` |
| `dbPath` | the database path |
| `collector` | `state`, `status()` and `config.scanIntervalMs` |
| `store` | `counts()` |
| `meta` | `get(key)` and `set(key, value)`: small values of the module, saved under `module:<id>:data:`, so they never touch the registry's keys |
| `log` | `info`, `warn`, `error`, with the `[<id>]` prefix |
| `reader` | `get(sql, …values)` and `all(sql, …values)`: reads of the database, see below |
| `sql` | the core's SQL fragments, to compose into your own queries: `TS` (the moment of a step, a `COALESCE` of end, last start and start: the shape the period indexes are on) and `ST_TS` (the same with the `st` alias), `TOOL_TS` (the moment of a tool call), `STEP_START` (a step's start), `FOLDER` (the folder of a step's session), `TOKENS` and `ST_TOKENS` (the token sum, without and with the `st` alias), `MODEL_KEY` (`provider/model`, with `#variant` when it is not the base one), and `COLUMNS` (`steps`, `sessions`, `tools`, `prompts`, `runs`: the columns of those tables, in the core's order, so that a module's `SELECT`s presenting them respect it) |
| `time` | `periodBounds(kind, now, reset)`, `localDay(ts)`, `budgetDayOf(reset)`, `DAY_MS`, `MIDNIGHT` and `reset`, the configured day-change hour (`LENS_RESET_HOUR`) |
| `tokensOf` | the function that sums a row's tokens, the core's own |
| `budgets.month(now?)` | the month's consumption against `LENS_LIMIT_COST_MONTHLY`: `{ used, limit, ratio, projected, projectedRatio, pace }`, `null` when the limit is not set |
| `range(searchParams, { earliest }?)` | a request's period `{ from, to }` as the core's endpoints read it: `from=day` is the budget day (`to` is ignored), otherwise `from`/`to` in ms; `from=0` is “all”, from OpenCode's oldest data or, with `earliest` (a function returning ms or `null`), from the module's |
| `i18n` | `t`, `N_`, `Localized`, `errorText`: the core's translations, in the language of the request |
| `jsonStore({ name, validate, empty, what })` | a JSON file of the module next to the database, on the same mechanism as the presets: `read()`, `write(doc)`, `path` and `badFile`. `name` is a name ending in `.json`, like `projects.json` (`^[a-z0-9][a-z0-9._-]*\.json$`: lowercase, digits, `.`, `_`, `-`; never folders), otherwise it throws `TypeError`. An unreadable file gives `empty()`, a warning in the log and a `.bad.json` copy that a save does not destroy; with `:memory:` the document stays in memory until restart. `what` is `{ broken, none, dropped }`, the three Italian phrases (agreeing with each other) the warning uses to name the content: «<file> non è JSON valido: <broken>» and «<file> <none> (reasons): <dropped>». `read()` and `write()` are synchronous and uncached: every `read()` reads and validates the file again, so it suits small documents. Declare it in `files()`. It refuses the core's files too (`CORE_FILES`: the dashboard layout and presets, the database): it throws `TypeError` |
| `writer` | only with `tables`: `statement(sql) → { run, get, all }` and `tx(fn)`; see [Writing to your own tables](#writing-to-your-own-tables) |
| `readers` | the core's incremental readers: `define`, `Watermark`, `contractMisses` and `adopt(reader, reset)`, which keeps the reader's version in `ctx.meta` (`module:<id>:data:<metaKey>`): the first time a module that adopts a reader starts, its source is reread once (the upserts are idempotent) |
| `live` | `changed(payload)`: tells the open dashboards the module changed something (the kind of change is the module id); `feed(item)`, only with `source`: a row of “recent activity”, marked with the source |
| `reply(status, body)` | (the body is a plain object) the answer with a status other than 200 |
| `zip` | `readEntries`, `entryData`, `extractPlan`, `planEntries` and `ZipError`: the core's zip reading and extraction plan (the functions of `src/zip.js` and `src/update.js`, same signatures), for a module that imports archives. `CORE_FILES` and `CORE_DIRS` apply to what a module declares (`files()`, `ctx.jsonStore`), not to writes: `extractPlan` writes where it is told |
| `skillLoads` | `record(payload) → { rows }`: validates an MCP delivery (`{ id, channel, preset, sessionId?, skills, at }`) and writes it into `skill_uses`, never counting the same `id` twice. An invalid payload throws an error with `errors` (a list of texts: the module answers 400). Every module has it, but the table stays the core's, which keeps filling it even with Skill off. The core does not check the id of the module that uses it: a module's code is trusted Node code |
| `prices` | the global price list (`LENS_MODEL_PRICES`), frozen and always present: `empty` (`true` without prices), `of(model) → { input, output, cacheRead, cacheWrite }` or `null` (a `provider/model#variant` variant gets the base model's price) and `estimate(model, kinds) → number` or `null`, with `kinds` as `tokensOf` gives them (`{ input, output, reasoning, cacheRead, cacheWrite }`). Prices are in dollars per million tokens; reasoning is billed like output; without a price the result is `null`. It counts only steps, like the spent cost, without internal tasks |

#### Reading the database: `ctx.reader`

A module does not open the database, does not call `.prepare(` and does not use `store.db` (`test/db-owner.test.js` enforces this on `modules/<id>/server/`): it reads with `ctx.reader.get(sql, …values)` and `ctx.reader.all(sql, …values)`, read-only on the lens's connection. The rules:

- **Only `SELECT` and `WITH … SELECT`**, a single statement. It refuses a text that starts with anything else (`INSERT`, `UPDATE`, `DELETE`, `ATTACH`, `PRAGMA …`), that holds a `;` outside a string (in a comment too: SQLite would compile only the first statement) or whose compilation opens a table for writing (for example a `WITH … INSERT`, checked with `EXPLAIN` before it runs). The refusal is a plain `Error`, “ctx.reader: solo letture”, and the database stays as it was.
- **Every run is under `PRAGMA query_only`**, put back to 0 right after even if it throws: some statements write without `EXPLAIN` showing it (the pragma table-valued functions, such as `pragma_optimize`, run an `ANALYZE`) and SQLite refuses that. This refusal too is “ctx.reader: solo letture”.
- **Only constants in the SQL text**: variable values go in as parameters (`?`), never concatenated. Every distinct text is prepared once and cached, up to **256 texts** per `ctx.reader`; beyond that a new text throws “ctx.reader: troppe istruzioni diverse”. Interpolating a value into the text (an id, a date) would fill the cache and be an SQL injection.
- **Lists of values** (ids, names) go in as **a single JSON parameter**: `WHERE name IN (SELECT value FROM json_each(?))` with `JSON.stringify(list)`. Never an `IN (?, ?, …)` as long as the list: every length would be a different text and would fill the cache. The SQL text of each query is **one, fixed**.
- **For periods** use `ctx.range`, `ctx.time` and the `ctx.sql` fragments, so queries read through the same indexes as the core (in tests, `check`, `rangeKeys` and `recorded` from `test/module-test-kit.js` verify that a query's plan uses those indexes).

### A module's tables

A module that stores data of its own in the lens's database declares its tables: the manifest has `tables: () => import("./tables.js")` and `tables.js` (no imports, like the manifest) default-exports `{ version, sql, columns? }`.

- **`version`**: an integer ≥ 1.
- **`sql`**: the statements that create the tables. The list is closed: `CREATE TABLE IF NOT EXISTS <id>_…` and `CREATE [UNIQUE] INDEX IF NOT EXISTS <id>_… ON <id>_…`, nothing else. Outside literals and comments the words `REPLACE`, `REFERENCES`, `TEMP`, `TEMPORARY`, `VIRTUAL`, `AS SELECT`, `AUTOINCREMENT`, `TRIGGER`, `VIEW`, `PRAGMA`, `ATTACH`, `DROP`, `DELETE`, `UPDATE` and `INSERT` are refused. Tables and indexes carry the `<id>_` prefix (with the id `bob`: `bob_`) and cannot be core tables or indexes, whatever their prefix. That is why a module with tables has an id of lowercase letters and digits only (`^[a-z][a-z0-9]*$`): an id with a hyphen cannot be a prefix and the tables are refused.
- **`columns`**: `{ table: { column: "TEXT" | "INTEGER" | "REAL" | "BLOB" } }`, the columns an earlier version of the tables did not have: they are added before the indexes that use them. Only tables created by `sql` and columns present in their `CREATE TABLE`.

The check (`src/module-tables.js`, with the literal and comment scanner of `src/sql-text.js`) runs `sql` twice on an empty in-memory database: no error, `sqlite_temp_schema` empty, `user_version` 0, no foreign keys, and every object of `sqlite_schema` is a table or an index with the prefix (automatic indexes are allowed). A `tables.js` that does not pass sends the module to `error`, with the reason.

The tables are created at startup, **even with the module off** (so its data and schema follow the lens), after the core's migration and with one `SAVEPOINT` per module: first the missing `columns` of tables that already exist, then `sql`, then the `meta` `module:<id>:schema` = `version` (a stored higher version, for example after going back to an older lens, is left as it is). An error rolls back only that module, which goes to `error`. Rows and tables are never deleted: turning the module off, or removing it, leaves its tables in the database (see [disinstallazione.md](disinstallazione.md)).

#### Writing to your own tables

`ctx.writer` exists only for a module with `tables`. It is a safety net against mistakes, not a sandbox: a module's code runs in the lens process and could do anything else.

- **`statement(sql)`** returns `{ run, get, all }` for one statement. **`tx(fn)`** runs `fn` in a Store transaction (rollback if it throws). `fn` must be synchronous: if it returns a promise (a thenable) the transaction is rolled back and `tx` throws, because the promise would write outside the transaction.
- **Refusals** (an `Error` “ctx.writer: …”): more than one statement; a text that does not start with `INSERT` or `UPDATE` (so no `DELETE`, `CREATE`, `PRAGMA`, nor `WITH … INSERT`); `REPLACE` (also `INSERT OR REPLACE`, which deletes the rows it replaces); `pragma_` anywhere in the text, also inside a literal (`pragma_optimize` runs an `ANALYZE` that `EXPLAIN` does not show).
- **Check on the program.** The lens compiles the text's `EXPLAIN` and refuses any `OpenWrite` that is not on the `main` database (`p3 = 0`), on a root page given as such (`p5 & 0x10` off) or outside the tables created by the module's `sql` and their indexes, and the opcodes `VUpdate`, `Program` and the schema ones (triggers, foreign-key actions, virtual tables).
- As for `ctx.reader`: only constants in the text, values as parameters, at most 256 different texts. The write SQL lives in `modules/<id>/server/writes.js`, the only file of a module exempt from rule R5 of `test/db-owner.test.js` (and only for modules with `tables.js`).

### A module's settings

A module that needs environment variables declares them in the manifest:

```js
settings: [{ name: "LENS_SECURITY_DIRS", label: "Cartelle degli audit dei guard", help: "separate da :, in sola lettura", kind: "text" }],
```

- **`name`** is a `LENS_…` variable (capitals, digits, `_`). It cannot be one of the core's variables, nor one another module already declares, nor repeated: the manifest is not valid and the module goes to `error`. `label`, `help` and `kind` are required (Italian texts, for `N_()`); `kind` is `text`, `num` or `secret`; `placeholder` is optional.
- **Limits of numbers.** A `num` setting accepts `min` and `max` (integers, `min ≤ max`): `GET /api/modules` hands them to the card, which checks them like the core's ranges, and `configure` checks them again on the server. The default is shown as the `placeholder`.
- **Once declared, the variable is known to the lens** even with the module off: it is never a "typo" in the log and on the Settings page. It does not appear in the table of the core's variables (and `--help` does not list them: they are in the module's manifest and in its card in **Settings › Modules**, where they are edited).
- **`configure(ctx)`** is an optional export of the Node entry (`server/index.js`). It receives `{ id, env, paths, i18n }` and can read or write nothing else: `env` has only the variables the module declares plus `HOME` and `XDG_*`, `paths` has `home`, `opencodeConfigDir`, `xdgData` and `dataDir` (the database's folder, `null` with `:memory:`). It returns `{ values, errors }`: `values` is a plain object (paths already absolute, numbers already numbers), `errors` a list of texts or `Localized`. A `configure` that throws, or that does not return `{ values, errors }`, is an error.
- **Who calls it.** The lens calls it once at startup for **every module found, on or off**, and at each check of a save from Settings (with the environment after the save, only for the modules that are on): a wrong value shows at once, as for the core's variables, without touching anything. `ctx.settings` in `create`, `hasData` and `files` is that `values` object itself (frozen), not `{ values, errors }`. With errors, **the module is `unconfigured`** (the reason is in the card; a `configure` that throws, or that does not return `{ values, errors }`, sends it to `error` instead), does not start, `hasData` is `false` and `files()` is not asked.
- **In the card.** Each setting has a field in the module's card in **Settings › Modules** (`text`, `num` or `secret`) and is saved like the other variables: the lens restarts. `GET /api/modules` gives the `value` and `isSet` only to clients on this computer (from the network they are `null`, and the plist is not even read); of a `secret` it gives only whether it is set (`isSet`), never the value. The plist is read again only when it changes. An empty field removes the variable and the default comes back.
- **Read the values only from `ctx`.** The module does not look at `process.env`, which also holds the core's variables: everything needed (default folders included) is in `ctx.env` and `ctx.paths` (with `dataDir`).

The full example is `modules/security/server/settings.js`.

### The panel in the card

An active module can have a panel of its own in its card in **Settings › Modules**, under the fields (IBM Bob: the state of the reading, the facts and the probes). The manifest declares `settingsPanel: "settings.js"`, a file in `public/` (`^[a-z0-9-]+\.js$`) that exports `mount(el, { status }) → { update(status) }`. The card imports it from `/modules/<id>/settings.js` and mounts it once: the element stays the same between renders, and at every `/api/status` the card calls `update(status[<id>])`, the module's block (see below). If the import or `mount` fail, the card says “panel not available”.

### A module's widgets

A module can offer widgets to the dashboard: they appear in the editor's **Add** next to the core's (see [dashboard.md](dashboard.md#editing-the-layout)) and are placed, resized and configured like the others. The manifest has two fields, `widgets` and `widgetsFile`, which an import-free leaf (`src/module-widget-fields.js`) judges along with the rest: a wrong field is a manifest error and the module goes to `error`, with the reason.

```js
widgetsFile: "widgets.js",
widgets: [{
  type: "mio-modulo-oggi", label: "Il mio indicatore", description: "Un numero del modulo, con il periodo",
  size: [4, 4], min: [3, 3], home: "both",
  settings: { title: null, range: ["dashboard", "day", "86400000"] },
  data: ["/api/mio-modulo/stato?from={from}"],
}],
```

- **`widgetsFile`** is required with `widgets`: the name of a `.js` file in the module's `public/` folder (`^[a-z0-9-]+\.js$`), served from `/modules/<id>/<file>`.
- **`widgets`** is a list of 1 to 12 entries. Each entry has:
  - `type`: `<id>-<name>`, that is the module's id, a `-` and a name; the whole type, `<id>-` prefix included, follows `^[a-z][a-z0-9-]*$` and is at most 31 characters long (the limit a saved layout puts on a type); it is not a core type, is not declared by another module and is not repeated;
  - `label` and `description`: two non-empty texts, in Italian. The page receives them as they are, along with the module's `name`, and translates them in the browser with the module's catalog (`public/lang-<language>.js`, merged into the core's), like its own texts: opening the page does not tell the server the language. The catalog of a module that is off is not loaded (`/modules/<id>/…` is served only while the module is on): its name stays in Italian;
  - `size` and `min`: `[width, height]` integers, width from 1 to 12 and height from 1 to 40, with `min` no larger than `size` in either dimension. `size` is the size of a newly added widget, `min` the smallest it can be shrunk to;
  - `home`: the view where the editor offers it, `adesso`, `analisi` or `both`;
  - `settings` (optional): the ⚙ settings. `title: null` gives the editable title; every other key (letters and digits, starting with a lowercase letter) is a list of 1 to 20 distinct non-empty texts, the values the user can choose. Besides `title` and `range`, a key cannot be one a core widget uses (`metric`, `by`, `source`, `model`, `sort`, `style`…): to the ⚙ and to the grid they already mean something else. The `range` key only allows the dashboard's periods (`dashboard`, `day`, `3600000`, `28800000`, `86400000`, `604800000`, `2592000000`, `0`), and `dashboard` is allowed in no other key. The ⚙ panel shows the keys in the declared order, named `t(key)` and each value as `t(value)`: keys and values are translated with the module's catalog;
  - `data`: 1 to 4 `/api/…` paths the widget reads, without `..`, `#` or spaces, with at most one `{from}` placeholder; any other brace is refused, and so are `%2e`, `%2f` and `%5c` (an encoded dot, slash or backslash), in upper or lower case.
- **`data` and the module's routes.** A widget reads its module's own API: at start, a widget with a path that is not a `GET` route of the module itself (query and `{from}` aside) is dropped with a warning in the log, and the module stays on. For an active module, `GET /api/modules` gives the widgets that remain. A dropped widget stays in the layout and in its place says “The {type} widget reads {path}, which is not a GET route of its module”, with no request at all. Widget paths go through the host and token checks like any route.
- **`{from}`** is replaced with the start of the widget's period, like the `from` of the core's endpoints: `day` for the budget day, otherwise the milliseconds of the starting instant, and `0` for “everything”. The period is the one chosen in the widget's ⚙ or, with `dashboard`, the view's. The route reads it with `ctx.range` ([Routes](#routes)).

**The widgets file.** It exports the renderers by type, `{ mount(root, ctx), update(root, ctx) }`: preferably as `export default { "mio-modulo-oggi": { mount, update } }`; named exports (`export { draw as "mio-modulo-oggi" }`) also work, but if there is an `export default` it wins. The file imports from the core only `"/module-kit.js"` (see [The browser files](#the-browser-files)).

- `mount(root, ctx)` is called once, on an empty card: it builds the markup inside `root`. `update(root, ctx)` is called at every refresh, once all the data declared in `data` has arrived.
- `resize(root, ctx)` is optional: with it the dashboard watches the card's size, as for a core widget, and redraws it with `update` when it changes. The function is not called: what counts is that it is there.
- **No timers.** A module's widget starts no timers nor reads of its own: the grid calls `update` at every dashboard refresh. A `ctx.live.changed()` of the module has the paths of its widgets on screen read again (in Now only those, with the others of the change), and then the grid calls `update`.
- The `ctx` is frozen and has five fields: `widget` (a frozen copy of the saved widget, with `id`, `type`, position and `settings`), `title` (the title already decided: the user's or the `label`), `settings` (the widget's settings, plus the `range`, `metric` and `by` already resolved against the view's: `range` is `"day"` or a number of milliseconds, `0` for “everything”), `data(path)` and `inst`, a per-card object that stays the same between `update` calls (to keep state in). The module draws the title: an element with `data-part="title"` in the `mount` markup is updated by the dashboard when `title` changes.
- `ctx.data(path)` answers only the paths declared in `data`, written as in the manifest (with `{from}`) or already resolved; for any other path it gives `undefined`. The body returned is the response's JSON.
- **Values by reference.** `settings`, `widget` and the data must not be modified: the freeze is shallow and the data are the same objects the other cards read.

**When it is not drawn.**

- **A file that fails to load.** The page receives in a JSON tag (`lens-module-widgets`, in the head) the list of the widgets of every module that declares some, and imports the file of the **on** modules only, all at once. A file that fails to import (syntax error, 404) or does not settle within 5 seconds leaves those types “not loaded”, with the error only in the console: the dashboard starts anyway and that module's cards say “Widget of the {name} module not loaded”. The same goes for a type the file does not draw with `mount` and `update`. Other modules are unaffected.
- **A `mount` or `update` that throws** shows “Data unavailable” in that card, with the message in the tooltip; the other cards carry on. “retry” reloads the data but does not re-mount the card: after a failed `mount`, reload the page.
- **A read that fails.** If the request for a declared path fails, the card shows “Data unavailable” with the error in the tooltip and `update` is not called.
- **A widget dropped at start** (see `data` above) says which path is not a `GET` route of its module.
- **“{source} only”.** With another module's source chosen alone, the core widgets with no data of that source say so; a module's widget does not: its data is its module's, not OpenCode's, and it draws as always.
- **Module off, in error or to configure.** The widget stays in the saved layout, with its position and settings, and in its place shows “The {name} module is off: turn it on in Settings › Modules” (or “has an error” / “needs configuring: see Settings › Modules”), with no request at all. Turning the module back on, the widget returns as it was; saving the layout from the editor does not remove it. A module whose manifest does not load (for instance it asks for a newer lens) also says “has an error”: with no manifest to read the name from, in place of the name is the module's id.
- **A module that was removed.** A type nobody declares any more stays in the layout, undrawn, like an unknown type from a newer version.
- **In the editor**, “Add” lists the widgets of modules that are on and whose file loaded, after the core's, with the “{name} module” badge, in the view given by `home`; in the Monitor view, none. Core widgets flow around module widgets, which stay where they are: in the layout calculation they are fixed obstacles and “Compact” does not move them up. They move and resize only directly.

**Out of scope.** Multiple styles, the Gallery, the Monitor view and dashboard templates with module widgets are not there yet.

**No sandbox.** A module's browser code runs in the page, unisolated: the `ctx` limits are at the API level (a module does not receive other modules' data by accident), not a security boundary. The same holds as for modules' Node code: a module's code is trusted code.

### A module's MCP tools

A module can offer tools to the MCP server (`opencode-lens mcp`), which OpenCode shows with the `lens_` prefix (the `security` tool becomes `lens_security`).

- **The manifest** declares `mcp: () => import("./mcp/tools.js")`, `mcpTools` (the names), `mcpInstructions` (the lines for the server's instructions) and `mcpExamples` (the questions suggested in Settings › MCP server). The fields `mcp`, `mcpTools`, `mcpInstructions`, `mcpExamples` and `mcpPrompts` are validated by a leaf with no imports, `src/module-mcp-fields.js`: by the registry (a wrong field is a manifest error and the module goes to `error`) and by the MCP process (the module is ignored with a warning on stderr, never with the “off” text).
- **`mcp/tools.js`** exports `tools(kit)`, which returns the list of tools `{ name, title, description, inputSchema, run(args, ctx) }`, made like the core's. The files in `mcp/` import **nothing**: everything they need comes from the `kit` the MCP process passes in (`argSpec`, `SINCE`, `SINCE_LABEL`, `withLens`, `resolve`, `project`, `LensError`, `ToolError`, `now` and `text` with `cleanName`, `cleanText`, `num`, `pct`, `plural`, `when`; `createToolKit` in `src/mcp/module-kit.js`). The MCP process loads neither `node:sqlite` nor `src/server.js`, and the tool talks to the lens only through its HTTP API (for Security, `/api/security`). A name already used by a core tool, or declared in `mcpTools` by another module, is dropped with a warning on stderr (the core wins, then the first module by id); a tool not declared in `mcpTools` is dropped.
- **Which tools show.** The MCP process reads the manifests from `modules/` and from the user's modules folder (the `modules/` folder next to the `LENS_DB` of the service's plist, worked out by the MCP process and not taken from the answer of `GET /api/modules`; read only once, at startup: a new user module shows up after restarting OpenCode; with a lens started by hand and `LENS_DB` only in the shell, the plist does not say it and the default folder applies. An id equal to that of a folder in the lens's `modules/` is dropped with a warning on stderr before its `module.js` is imported, and an id in `shadowed` loses its tools. A symlink to a folder counts as a module), asks the lens `GET /api/modules` at startup (`initialize` waits at most one second) and then every 30 seconds, and lists only the tools of the modules that are **on**. Until it has had an answer it lists no module tools; after the first, if the lens stops answering, **the last known state stays**. When the list changes it sends `notifications/tools/list_changed`.
- **A tool of a module that is not on** does not vanish with a generic error: it answers with a text that says why: “Il modulo <Name> è spento in Lens: attivalo da Impostazioni › Moduli.”, “Il modulo <Name> è in errore in Lens: vedi Impostazioni › Moduli.” or “Il modulo <Name> è da configurare in Lens: vedi Impostazioni › Moduli.” (the texts stay in Italian, like everything the MCP sends to OpenCode). The same goes for `prompts/get`.
- **OpenCode does not reread the list.** Verified with OpenCode 2.0.26: after `notifications/tools/list_changed` OpenCode does **not** ask for the tools again, and reads the server's instructions only once. So when you turn a module with tools on or off, OpenCode keeps showing **the old list and the old instructions until you restart it**. Calling a tool of a module that has been turned off in the meantime gives the text above; a tool of a module just turned on shows up in OpenCode only after the restart. The module's card reminds you with a note; the notification is there for clients that honour it.

### A module's MCP prompts

A module can also offer **prompts** to the MCP server, which OpenCode shows as `/lens:<id>` commands. The manifest declares `mcpPrompts: true` and the module's `mcp` file (the one with the tools) exports, besides `tools(kit)`, `prompts(kit)`, which returns a `PromptSource`:

| Method | |
|---|---|
| `list(signal)` | `{ prompts: [{ id, name, brief }], snapshot }`: the module's prompts, plus a text that changes when what the client has read changes |
| `get({ name, skill }, signal, ctx)` | `{ description, text }`: the chosen prompt. For an unknown name it throws `kit.PromptNotFoundError`, which the core answers with `-32602` |
| `instructions(signal)` | `string[]`: the lines the module adds at the end of the server's instructions |
| `snapshot(signal)` | only today's `snapshot`, for the watch, without listing the prompts |

The `kit` also has `PromptNotFoundError`, `connect`, `randomUUID`, `PROMPT_BRIEF_MAX` (the brief cap in the protocol) and, in `text`, `cleanBlock` and `safePath`. The core (`src/mcp/prompts.js`) merges the sources of the modules that are on:

- A name already taken by an earlier module (by id) is dropped with a warning on stderr; a module that fails does not empty the others.
- Every 30 seconds the MCP process first refreshes the modules, then compares the `snapshot` of the last `list` served to the client with `snapshot(signal)` and sends `notifications/prompts/list_changed` if they differ. The notification also goes out when the set of modules with prompts changes. A lens that was down while the client was reading is announced when it comes back; a lens coming back with zero presets may send one extra notification.
- A `prompts/get` for a module that is off, in error or unconfigured answers with the same three texts as the tools.
- **The instructions** go in this order: the core's header and tools, the `mcpInstructions` of the modules that are on, the rest of the core's and, after a blank line, the lines from `instructions(signal)` of the modules that are on. The latter are asynchronous: `initialize` waits for them only briefly (3 seconds at most) and never fails because a lens is down. With a lens down at a cold start the modules' lines show only from the moment their state is known.

Unlike tools, prompts follow `prompts/list_changed`: turning Skill on or off makes the `/lens:<id>` commands appear or disappear in OpenCode without a restart.

### An alternative source

A module can offer the dashboard another data source (today IBM Bob): the manifest has `source: { label: "Bob" }` and the instance `create` returns exposes `status()` (required with `source`) and `source() → { selects, only?, add?, totals, earliest }`:

- **`selects`**: `{ steps, sessions, tools, prompts, runs }`, one `SELECT` (or `WITH … SELECT`) each, presenting the module's data with the columns of the core's tables, in the same order (`ctx.sql.COLUMNS`). In “+” the core puts every `select` in a subquery (`SELECT * FROM (<select>)`) before the union with OpenCode's rows: an outermost `ORDER BY` or `LIMIT` applies to the module's rows only, never to OpenCode's.
- **`only`** (optional): `{ limits, weeklyLimits, monthlyLimits, contextLimits }`, the budgets of “Only”; **`add`**: `{ contextLimits }`, added to OpenCode's in “+”.
- **`totals(from, to)`**: the `<id>` block added to `/api/summary`. **`earliest()`**: the oldest data in ms or `null`, for `from=0`.

The core (`src/source-views.js`) checks every `select` with the scanner (one `SELECT` or `WITH` only), opens two read-only connections with TEMP views and tries every view with `SELECT * FROM <view> LIMIT 0`. An error (in `source()`, in a `select` or in a view) means no source, a warning in the log and the module in `error` with the reason: never a failed start. At most one source: with two modules on, the first by id wins and the other is ignored with a warning.

The URL parameter is the module id: `?bob=1` for “+ Bob”, `?bob=only` for “Bob only”, on the endpoints that work on the views (the list is in [metriche.md](metriche.md#local-api)); without the source on, the parameter is ignored. What stays with the core: which endpoints are capable of it, the `<id>` block of `/api/summary`, the budget of “Only”, the union of `/api/runs/live` and the empty views for what the source does not have (`internal_usage`, `signals`, `permissions`, `daily_steps`, `daily_tools`). In “Only” `meta` has no `retention_from` (OpenCode's pruned days do not enter the source's numbers), `modelLimits` is `[]` and `opencodeModels` is `null`. `ctx.live.feed(item)` gives the source's rows of “recent activity”.

In the browser the selector is generic, “OpenCode · + {label} · {label} only”, and appears only if `/api/status` has the source's block (see [dashboard.md](dashboard.md#ibm-bob)).

### Status in `/api/status` and `/healthz`

An active module whose instance has `status()` adds `<id>: status()` to the body of `/api/status`; with `state()` (a read without a query) it adds `<id>: state()` to `/healthz`. The `problem` of `status()` (a `Localized` or `null`) is the banner's sentence. The registry catches per module: an exception is written once in the log and the key is missing, never a 500. Off or `unconfigured`, the module adds nothing.

### Reserved ids

An id cannot be (the module goes to `error`, with the reason): a core page or view; a key of the body of `/api/status` (`CORE_STATUS_KEYS`: the keys of `collector.status()` plus `lens`, `counts`, `ok`, `opencode`), because that is where the module puts its block; a core kind of change (`CORE_CHANGE_KINDS`: `feed`, `step`, `tool`, `usage`, `signal`, `permission`, `status`, `session`, `scan`, `sync`), because `ctx.live.changed` uses it as the kind; and, for a module with `source`, a parameter the core reads (`SOURCE_RESERVED`) or a key of `/api/summary`. The lists are in `src/core-paths.js` and the tests check them against the code.

### The core's paths

`src/core-paths.js` (`CORE_PATHS`) lists the `/api` paths the core serves: `exact` (the `GET`s), `prefixes` (everything under them) and `writes` (the `POST`s). A module does not declare a route on one of these paths, with **any method**, nor inside a core prefix or with a prefix that covers one: the route is dropped with a warning in the log. `test/core-paths.test.js` reads `src/server.js` and fails if a path it serves is missing from the list, or a path on the list is not served. The same file lists `CORE_FILES` and `CORE_DIRS`, the files and folders the core writes in the data folder (see [the Node entry](#the-node-entry)); the same test compares them with what the core really writes.

### The browser files

The pages of active modules are served from `/modules/<id>/<file>`. In the module's `public/` folder, flat (no subfolders):

- `page.js` exports `page` (the page, like the others in the director, see [architettura.md](architettura.md#5-the-dashboard-styles-models-and-adapters)) and `title`;
- `page.html` is inserted into the dashboard in place of the modules placeholder; `style.css`, if present, is linked in the head;
- `lang-en.js` and `lang-fr.js` default-export the module's catalog, merged with the core's; a module without catalogs shows Italian. The rules are those of [traduzioni.md](traduzioni.md).

Browser code imports from the core **only** from `"/module-kit.js"` (`t`, `tn`, `N_`, `esc`, `el`, `$`, `get`, `send`, `table`, `stateBox`, the formatters and a few more). The other files are imported with relative paths. `getLang` and `getLocale` (the dashboard's language and locale) are there too. A `public/` file that the module's Node side also imports has no imports: what it needs, like `t`, comes in as a parameter (`modules/vibecoding/public/vibe-projects.js`, `modules/skill/public/preset-rules.js`). The CSS rules used by at least two modules (Skill and Vibe Coding: `danger`, `fmenu`, `mix`, `vhero`, `vk`…) stay in the core's CSS; those of a single module live in its `style.css`.

### The boundary rules

`test/module-boundaries.test.js` checks them:

- the core (`src/`, `public/`) imports nothing from `modules/` and holds no marker of a module (if any remain, they are in a list that can only get shorter);
- a module imports only from inside its own folder, from `node:*` and, only in the `public/` and `test/` files, from `/module-kit.js`; `module.js` has no static imports;
- `server/` code does not import a `public/` file that uses `/module-kit.js`;
- a module's tests import from the core only `/module-kit.js` and `test/module-test-kit.js`.

### Trying a module

A module's tests live in `modules/<id>/test/` and import from the core only `/module-kit.js` and `test/module-test-kit.js`. The tests of a user module, which lives outside the app, import the test kit with the absolute specifier `"/module-test-kit.js"` (like `"/module-kit.js"`, `test/module-hooks.mjs` resolves it; see below), never with a relative path into the app. The test kit exports what is needed to try a module on real data: `memoryStore()` and the builders `addSession`, `addStep`, `addTool`, `addPrompt`, `addRun`, `addInternal` (an in-memory SQLite store), `moduleContext` (the real `ctx`, built with `{ id, config, store, collector, queries, log }`), `Queries`, the plan check (`check`, `rangeKeys`, `recorded`) and, for MCP tools, `createToolKit` (the `kit` that `tools(kit)` receives), `createHandler` (the JSON-RPC handler that lists and calls them) and the classes `LensError` and `ToolError`. For browser pages and MCP prompts it adds `configure` and `rebuildFormats` (the language in browser tests), `catalogs()` (the core's catalogs merged with the module's), `createPromptAggregator`, `createPromptWatcher`, `instructionsWith` and `PromptNotFoundError`, plus `MAX_ID`, `PRESET_ID` and `SKILL_ID` to compare a module's ids with the core's. For widgets it adds `widgetContext(spec, ctx)`, which builds the frozen `ctx` the dashboard gives to `mount` and `update` (`spec` is the entry of the manifest's `widgets`, `ctx` the grid's, with `widget`, `title`, `settings`, `paths`, `data` and `inst`). Nothing else of the core is reachable, on purpose.

A module's test runs on its own, but it **needs** `--import ./test/module-hooks.mjs`: it makes `/module-kit.js` and `/module-test-kit.js` resolve under Node too, as the browser does. Without it the import fails. `npm test` already passes it. The test kit also travels with the installed app (`test/module-test-kit.js`, `test/module-hooks.mjs` and the files they import, under `~/Applications/opencode-lens/test/`): a user module's tests run there too, with `--import <app folder>/test/module-hooks.mjs`.

```bash
node --disable-warning=ExperimentalWarning --import ./test/module-hooks.mjs --test modules/vibecoding/test/vibecoding-module.test.js
```
