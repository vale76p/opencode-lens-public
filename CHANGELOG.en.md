# Changelog

All the relevant changes of opencode-lens. Format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions [SemVer](https://semver.org/): *major* for incompatible changes (local API, DB schema, installation), *minor* for new features, *patch* for fixes.

Since 0.3.0 the entries are written by [release-please](https://github.com/googleapis/release-please) from conventional commits (`feat:` → Added, `fix:` → Fixed, …) in the release PR, where they can be polished before the merge. Every version has a git tag `opencode-lens-vX.Y.Z` and a [GitHub release](https://github.com/vale76p/opencode-lens-public/releases) with the zip. The dashboard shows the same changelog in the **What's new** page. How to release: [README](README.en.md#versions-and-releases). This is the English translation of [CHANGELOG.md](CHANGELOG.md), the Italian source: versions not translated yet are shown in Italian.

## [0.51.1](https://github.com/vale76p/opencode-lens-public/compare/opencode-lens-v0.51.0...opencode-lens-v0.51.1) (2026-11-27)


### Documentation

* **opencode-lens:** links to OpenCode Lens Monitor, now public (it/en/fr) ([8be0509](https://github.com/vale76p/opencode-lens-public/commit/8be05097cadd0496b70f0cf93fed93ff47961bcc))
* **opencode-lens:** README for the public repository: what it does, how it works, usage and modules (it/en/fr) ([7de6ff6](https://github.com/vale76p/opencode-lens-public/commit/7de6ff646e1f20c8ad03b5497bcc7f965562e395))

## [0.51.0] (2026-11-21)


### Added

* **opencode-lens:** figures of the project detail and of the overview
* **opencode-lens:** estimated cost in Vibe Coding
* **opencode-lens:** project KPIs and charts in Vibe Coding
* **opencode-lens:** forecast to delivery and monthly trend
* **opencode-lens:** projects with a deadline in Vibe Coding
* **opencode-lens:** estimated and spent in the strip and on the board
* **opencode-lens:** history of the Vibe Coding projects
* **opencode-lens:** Vibe Coding with estimated cost, projects with a deadline and KPIs per project


### Fixed

* **opencode-lens:** dates and kind of deadline projects validated, budget cleared on fallback
* **opencode-lens:** short notes in the strip, work after delivery and incomplete estimate on every Vibe Coding figure
* **opencode-lens:** estimate per model grouped by model key
* **opencode-lens:** project history read again when closed days change
* **opencode-lens:** Vibe Coding history updated for today and after a price list change, documentation aligned
* **opencode-lens:** trend on calendar months, and a start after the delivery
* **opencode-lens:** overview totals over every project, incomplete estimate on the same horizon as the status
* **opencode-lens:** Vibe Coding draws without waiting for the history, fewer repeated reads


### Changed

* **opencode-lens:** project budgets are now compared with the cost estimated from the price list; with an empty price list they stay on OpenCode's cost


### Documentation

* **opencode-lens:** Vibe Coding with projects with a deadline and estimated cost

## [0.50.0] (2026-11-18)


### Added

* **opencode-lens:** «Price list» card in Settings
* **opencode-lens:** ctx.prices for modules
* **opencode-lens:** LENS_MODEL_PRICES in the configuration
* **opencode-lens:** price list per million tokens (src/prices.js)
* **opencode-lens:** per-model price list in Settings and ctx.prices for modules
* **opencode-lens:** price list written from Settings


### Fixed

* **opencode-lens:** price list errors recognised in every language, and a narrower table
* **opencode-lens:** price list: keys, texts and documentation after the review
* **opencode-lens:** price list: a single rule for keys and limits on numbers

## [0.49.3] (2026-11-06)


### Fixed

* **opencode-lens:** MCP no longer answers «unknown tool» to a module tool called before the modules are read
* **opencode-lens:** a failed or interrupted step is no longer a message:assistant drift
* **opencode-lens:** a failed or interrupted step is no longer a message:assistant drift

## [0.49.2] (2026-11-03)


### Fixed

* **opencode-lens:** restarting from Settings also works when the job is disabled
* **opencode-lens:** restarting from Settings also works when the job is disabled

## [0.49.1] (2026-11-03)


### Fixed

* **opencode-lens:** /healthz answers 503 when the database does not respond and reports degraded; new start_time_seconds metric
* **opencode-lens:** fixes from the adversarial review (security, data, operations)
* **opencode-lens:** error_msg redacted before truncation (keys, Bearer, long strings, home)
* **opencode-lens:** user modules are installed from the dashboard only with LENS_TOKEN
* **opencode-lens:** backfill no longer resets live cost and tokens when the message lacks them
* **opencode-lens:** the API contract also covers the REST answers for sessions and messages
* **opencode-lens:** the WAL has a 64 MiB limit and a TRUNCATE checkpoint every 10 minutes
* **opencode-lens:** the MCP integration also waits for module_guide and module_check
* **opencode-lens:** an existing data folder becomes 0700 and the backup copy is created 0600
* **opencode-lens:** the documentation says exactly what is stored (titles, folder, redacted error_msg)
* **opencode-lens:** the scan reports failed syncs in scan.error with a single log line
* **opencode-lens:** more reverse proxy headers recognised as non-local
* **opencode-lens:** French translation of the message about the modules token, polite form
* **opencode-lens:** a negative field no longer discards positive internal usage
* **opencode-lens:** a crash leaves the stack in the log before exiting


### Documentation

* **opencode-lens:** verified OpenCode version v2.0.26 and measured known limits

## [0.49.0] (2026-11-01)


### Added

* **opencode-lens:** Ponytail leaves the distribution; the example module and the guide stay
* **opencode-lens:** Ponytail leaves the distribution; the example module and the guide stay

## [0.48.1] (2026-11-01)


### Fixed

* **opencode-lens:** two OTLP exports at once no longer send the same increase twice
* **opencode-lens:** overlapping OTLP exports, limit of /api/sessions, the real error of Store.tx
* **opencode-lens:** limit of /api/sessions is an integer from 1 to 500, as in /api/runs
* **opencode-lens:** a transaction SQLite has already rolled back no longer hides the real error

## [0.48.0] (2026-11-01)


### Added

* **opencode-lens:** update the user's modules from a zip in Settings › Update
* **opencode-lens:** the modules of a zip are checked only at «Install», after the warning
* **opencode-lens:** restart the lens from the dashboard (POST /api/restart, Service panel)
* **opencode-lens:** restart from the dashboard, the user's modules from a zip and a handier Settings
* **opencode-lens:** module cards with a separator and a fixed-width Turn on/Turn off button


### Fixed

* **opencode-lens:** «Restart the lens» does not reload a plist edited by hand and not applied
* **opencode-lens:** after a save, Settings stays in the section you were in
* **opencode-lens:** the restart from the dashboard does not start with a plist that cannot be read
* **opencode-lens:** installing modules is all or nothing, 409 during a check, cleanup of .staging-*


### Documentation

* **opencode-lens:** the modules of a zip are checked at «Install», after the warning (it/en/fr)
* **opencode-lens:** installing modules is all or nothing, restart refused with a plist not applied (it/en/fr)
* **opencode-lens:** the user's modules from a zip in Settings › Update (it/en/fr)
* **opencode-lens:** restart from the dashboard in configuration, metrics and architecture (it/en/fr)

## [0.47.0] (2026-11-01)


### Added

* **opencode-lens:** extras/modules folder for the extra modules, and their zip in the release
* **opencode-lens:** extra modules in extras/modules and their zip in the release


### Documentation

* **opencode-lens:** the extra modules, their zip in the release and how to install them

## [0.46.1] (2026-11-01)


### Fixed

* **opencode-lens:** the release zip contains the modules' test kit: 0.46.0 shipped without a zip, this is the version to install

## [0.46.0] (2026-11-01)


### Added

* **opencode-lens:** your own modules: a folder next to the database (on macOS `~/Library/Application Support/opencode-lens/modules/`) that updates leave alone, read by the lens and by the MCP with the same rules as the lens's modules; in Settings › Modules they have the «your own» badge and their folder
* **opencode-lens:** module widgets in the grid: a module declares its widgets in its manifest, «+ Add widget» offers them with the module's name, and a module that is off or in error leaves a box in their place that says so
* **opencode-lens:** MCP tools `lens_module_guide` and `lens_module_check` to write a module: the guide with this installation's values, and a check of a module without turning it on (`POST /api/modules/check`, `GET /api/modules/authoring`); OpenCode shows them after a restart
* **opencode-lens:** an example module to copy (`extras/module-template/`) and the modules' test kit installed with the app


### Documentation

* **opencode-lens:** guide to writing a module, written for an LLM too: `docs/en/moduli-custom.md`

## [0.45.0] (2026-10-29)


### Added

* **opencode-lens:** Settings shows one section at a time, with the gear icon
* **opencode-lens:** Settings shows one section at a time, with the gear icon

## [0.44.1] (2026-10-29)


### Fixed

* **opencode-lens:** security and behaviour touch-ups after the modules refactor


### Changed

* **opencode-lens:** touch-ups after the module reviews

## [0.44.0] (2026-10-29)

**Read before upgrading.** Skill becomes a module too, like Vibe Coding, Security and IBM Bob in 0.43.0: after the update it is off. Whoever has a library finds a notice leading to Settings › Modules, where it is turned back on; library and presets stay intact. With Skill off the `preset` MCP tool and the `/lens:<id>` commands are not there; the count of the skills OpenCode loads (`skill_uses` and the skill metrics) goes on with Skill off too. After turning it on or off, restart OpenCode.

### Added

* **opencode-lens:** modules declare raw and prefix POSTs and data folders, and cannot take the core's files and paths
* **opencode-lens:** modules record skill deliveries, read zips and know the data folder
* **opencode-lens:** the server side of Skill as a module, checked against the core
* **opencode-lens:** the MCP server offers the prompts and instructions of the active modules
* **opencode-lens:** the preset tool and the skill prompts as tools of the module


### Fixed

* **opencode-lens:** Skill's hasData ignores the folders of an interrupted deletion and the MCP warns about malformed mcp fields
* **opencode-lens:** the MCP checks the prompts after reading the modules again, in the same round


### Changed

* **opencode-lens:** Skill's drawer receives what it uses from the page, without an import cycle
* **opencode-lens:** the server side of Skill leaves the core
* **opencode-lens:** the preset tool and the skill prompts leave the core
* **opencode-lens:** Skill becomes a module


### Documentation

* **opencode-lens:** polish of docs, translations and the MCP fields message after the review of E
* **opencode-lens:** Skill as a module, raw POSTs, module prompts and skill deliveries

## [0.43.0] (2026-10-26)

**Read before upgrading.** Vibe Coding, Security and IBM Bob become modules, like System in 0.42.0: after the update they are off, IBM Bob included, even with `LENS_BOB=1`. Whoever used them finds a notice leading to Settings › Modules, where they are turned back on; the data stays. `LENS_BOB` is no longer needed: it is ignored and can be removed from Settings. The dashboard's “OpenCode / + Bob / Bob only” selector starts again from “OpenCode”. Skill stays in the core for now.


### Added

* **opencode-lens:** modules also declare the paths they only read
* **opencode-lens:** modules declare their settings, editable from the Modules tab
* **opencode-lens:** modules declare POST and prefix routes, guarded by the core
* **opencode-lens:** modules write to their own tables, read incremental sources and notify the dashboard
* **opencode-lens:** the core creates the tables that modules declare
* **opencode-lens:** the modules' ctx reads the database read-only and declares files and data
* **opencode-lens:** the server side of IBM Bob as a module, checked against the core
* **opencode-lens:** the server side of Security as a module, checked against the core
* **opencode-lens:** the server side of Vibe Coding as a module, checked against the core
* **opencode-lens:** the dashboard selector for the sources of modules
* **opencode-lens:** the MCP server offers the tools of the modules that are on and notifies OpenCode when they change
* **opencode-lens:** the MCP security tool as a tool of the module
* **opencode-lens:** modules to configure, start with a time limit, field limits, notice and panel of modules
* **opencode-lens:** alternative sources and module state in /api/status and /healthz


### Fixed

* **opencode-lens:** ctx.reader reads with query_only and module files stay in the data folder
* **opencode-lens:** only the files of write-type modules count among the written files and in uninstall
* **opencode-lens:** GET /api/modules reads the plist only for local clients and only when it changes
* **opencode-lens:** safer query_only guard, and modules cannot take the core's paths
* **opencode-lens:** module panels follow every state and stay mounted between renders
* **opencode-lens:** the card's note says to restart OpenCode for tools and instructions
* **opencode-lens:** the first read of IBM Bob no longer holds back the server start
* **opencode-lens:** a module's tables cannot be core tables
* **opencode-lens:** module meta under module:&lt;id&gt;:data:, reply with a mandatory body and a re-entrant query_only guard
* **opencode-lens:** in the Modules section the shell hint only for those who can use it, and the notice leads to the section
* **opencode-lens:** final touches to the IBM Bob module after the review


### Changed

* **opencode-lens:** the charts that Skill and Vibe Coding share move into the core
* **opencode-lens:** IBM Bob becomes a module
* **opencode-lens:** the CSS only Vibe Coding needs moves into the module
* **opencode-lens:** the server side of IBM Bob leaves the core
* **opencode-lens:** Security becomes a module
* **opencode-lens:** Vibe Coding becomes a module


### Documentation

* **opencode-lens:** whoever touches the database includes the modules' reader, the name of jsonStore and the db-owner rule
* **opencode-lens:** caption of Bob's probes, variables table, references to the module reader and French spacing
* **opencode-lens:** IBM Bob as a module, tables, writes and sources of modules
* **opencode-lens:** OTLP with the Security series, the module's security tool, translated and untranslated manifest texts
* **opencode-lens:** Security as a module, settings and MCP tools of modules
* **opencode-lens:** Vibe Coding as a module and the extended module contract

## [0.42.0] (2026-10-25)


### Added

* **opencode-lens:** the server serves routes, files, metrics and menu of the active modules
* **opencode-lens:** the dashboard loads pages and translations of the active modules
* **opencode-lens:** modules can be turned on from Settings, System is the first
* **opencode-lens:** module registry with states and isolated start
* **opencode-lens:** Modules section in Settings and a notice for off modules that have data
* **opencode-lens:** LENS_MODULES variable for the active modules


### Fixed

* **opencode-lens:** the OTLP export no longer resends whole series that reappear and includes Security and IBM Bob like /metrics
* **opencode-lens:** module polish from the final review
* **opencode-lens:** an async start that fails puts the module in error without stopping the lens


### Changed

* **opencode-lens:** System becomes the first module


### Documentation

* **opencode-lens:** modules, LENS_MODULES and System as a module
* **opencode-lens:** blank lines in moduli.md

## [0.41.2] (2026-10-24)


### Fixed

* **opencode-lens:** in the Skill page long names and descriptions no longer overflow the columns
* **opencode-lens:** in the Skill page long names and descriptions no longer overflow the columns

## [0.41.1] (2026-10-24)


### Fixed

* **opencode-lens:** the macOS app quits as with ⌘Q before being reinstalled and reopens with open -a
* **opencode-lens:** the macOS app quits as with ⌘Q before being reinstalled and reopens with open -a

## [0.41.0] (2026-10-24)


### Added

* **opencode-lens:** System with live CPU and memory every 2 seconds and the Gallery widgets
* **opencode-lens:** System with live CPU and memory every 2 seconds and the Gallery widgets

## [0.40.0] (2026-10-24)


### Added

* **opencode-lens:** “View” gathers the grouping and metric of Analysis, with the period in short form
* **opencode-lens:** neutral controls in the bar, short period everywhere, Customize and Full screen icon-only
* **opencode-lens:** the time of the last update in the bar of Now and Analysis
* **opencode-lens:** the toolbar-style bar, with frame and sheet, the same places in every bar and neutral controls
* **opencode-lens:** the dashboard on a sheet inside a grey frame, the menu without accent colour
* **opencode-lens:** every top bar has the same places, every control always in the same spot


### Fixed

* **opencode-lens:** bar above the edit bar, now red when OpenCode is disconnected, lone action on the right, stamp readable by screen readers
* **opencode-lens:** menu counts and clock seconds above 4.5:1
* **opencode-lens:** the sidebar's “beta” badge does not go below 11px
* **opencode-lens:** the group labels of the “View” menu above 4.5:1 in light

## [0.39.0] (2026-10-24)


### Added

* **opencode-lens:** API for the status and installation of the macOS app
* **opencode-lens:** macOS app installable from the dashboard and always at the lens's version
* **opencode-lens:** app.sh check and update, keeping the app's signature
* **opencode-lens:** macOS app block in Settings › Update
* **opencode-lens:** install.sh rebuilds the macOS app when it is installed
* **opencode-lens:** status and installation of the macOS app in the lens


### Fixed

* **opencode-lens:** never two builds of the app after the restart, nor endless builds


### Documentation

* **opencode-lens:** macOS app installable and kept aligned from the dashboard

## [0.38.3] (2026-10-24)


### Fixed

* **opencode-lens:** “Open in Browser” of the macOS app opens the dashboard with the token
* **opencode-lens:** “Open in Browser” of the macOS app opens the dashboard with the token

## [0.38.2] (2026-10-24)


### Fixed

* **opencode-lens:** the zip reaches the release even without the provenance attestation
* **opencode-lens:** the zip reaches the release even without the provenance attestation

## [0.38.1] (2026-10-24)


### Fixed

* **opencode-lens:** the tests of package.sh run without the signing key
* **opencode-lens:** the tests of package.sh run without the signing key

## [0.38.0] (2026-10-24)


### ⚠ BREAKING CHANGES

* **opencode-lens:** from the dashboard the “Source code (zip)” and unsigned zips can no longer be installed (from the terminal with install.sh they still can). After service install the dashboard asks for the token: open it with opencode-lens service open, from the macOS app or from the Monitor.

### Added

* **opencode-lens:** signed releases, token by default and proprietary licence

## [0.37.0] (2026-10-24)


### Added

* **opencode-lens:** Phases 2–4 of the refactor on main: single reader, counters, page-kit, MCP in src/mcp/, macOS app

## [0.36.1] (2026-10-24)


### Changed

* **opencode-lens:** counts, database info and OTLP reads behind the Store
* **opencode-lens:** Phase 1, a single owner of the schema
* **opencode-lens:** periodBounds in src/period.js, MCP and Settings without the read side
* **opencode-lens:** schema and key expressions in src/schema.js
* **opencode-lens:** Bob's writes and reads on the lens behind the Store
* **opencode-lens:** VERSION and redactUrl in leaf modules, the about↔otlp↔queries cycle closed


### Documentation

* **opencode-lens:** architecture, who owns the schema

## [0.36.0] (2026-10-23)


### Added

* **opencode-lens:** aggregates and metrics of skill usage
* **opencode-lens:** preset board with drag and drop, keyboard menu and Undo
* **opencode-lens:** since when the current version of a skill is in use
* **opencode-lens:** skill detail in a side panel with its usage
* **opencode-lens:** the numbers of the Skills page in a pure module
* **opencode-lens:** the collector counts the loads of skills and of the lens's presets
* **opencode-lens:** the MCP reports the deliveries of skill presets back to the lens
* **opencode-lens:** Skills page as a preset board, with hero and skill usage
* **opencode-lens:** Skills page with hero, period and import from the top bar
* **opencode-lens:** POST /api/skill-loads and protection of presets from concurrent saves
* **opencode-lens:** moves of skills between presets in a pure module
* **opencode-lens:** skill_uses table and schema v5 for skill usage


### Fixed

* **opencode-lens:** complete per-day bars, the preset dialog saves with the rev and cleaner mini-cards
* **opencode-lens:** skill usage counters and last only on completed ones
* **opencode-lens:** currentSince follows the current version in reconcile too and does not change with a rollback onto the current one
* **opencode-lens:** the skill panel ignores late answers, rereads the boxes and shows usage per day
* **opencode-lens:** in read-only mode no import and no new preset, and a read error leaves neither hero nor loading
* **opencode-lens:** skill usage no longer blocks reading a session and counts the activations
* **opencode-lens:** the board redoes the move on the current document, Undo only when safe and no “null” in the cards
* **opencode-lens:** the library is null in the board's moves and the cap reuses the existing text
* **opencode-lens:** lens origin for presets, skill drift counted once per side
* **opencode-lens:** normalized usage, “All” starts from the beginning and a single predicate for “never used”
* **opencode-lens:** stricter validation of skill loads and writes in a transaction


### Documentation

* **opencode-lens:** size limit of the skill-loads body, last completed load and read-only towards OpenCode
* **opencode-lens:** mockup of the Skills page with hero, preset board and usage
* **opencode-lens:** Skills page, skill usage and new metrics
* **opencode-lens:** skill usage as the code does it

## [0.35.0] (2026-10-23)


### Added

* **opencode-lens:** IBM Bob probes from the settings and an estimate of the Bobcoin ↔ token conversion
* **opencode-lens:** IBM Bob probes from the settings and an estimate of the Bobcoin ↔ token conversion

## [0.34.1] (2026-10-23)


### Fixed

* **opencode-lens:** with IBM Bob, switching the source and refreshing the widgets are no longer slow
* **opencode-lens:** with IBM Bob, switching the source and refreshing the widgets are no longer slow

## [0.34.0] (2026-10-23)


### Added

* **opencode-lens:** budgets, running prompts, interaction and live activity for IBM Bob too
* **opencode-lens:** budgets, running prompts, interaction and live activity for IBM Bob too

## [0.33.0] (2026-10-23)


### Added

* **opencode-lens:** the probe looks for where Bob keeps the account's consumption
* **opencode-lens:** the probe looks for where Bob keeps the account's consumption

## [0.32.2] (2026-10-23)


### Fixed

* **opencode-lens:** the Tool widget no longer breaks on an error without a message
* **opencode-lens:** the Tool widget no longer breaks on an error without a message

## [0.32.1] (2026-10-23)


### Fixed

* **opencode-lens:** IBM Bob read with the real schema of bob.db, and the probe installed with the app
* **opencode-lens:** IBM Bob read with the real schema of bob.db, and the probe installed with the app

## [0.32.0] (2026-10-23)


### Added

* **opencode-lens:** «Bob only» and «+ Bob» on every analysis view, with OpenCode's queries
* **opencode-lens:** IBM Bob as an optional second source (LENS_BOB)
* **opencode-lens:** IBM Bob as a second source, page and «Include Bob»
* **opencode-lens:** IBM Bob page and «Include Bob» toggle in the dashboard
* **opencode-lens:** OpenCode · + Bob · Bob only selector in place of «Include Bob»

## [0.31.1] (2026-10-23)


### Documentation

* **opencode-lens:** changelog 0.31.0 and 0.30.1 translated into English and French
* **opencode-lens:** changelog 0.31.0 and 0.30.1 translated into English and French

## [0.31.0] (2026-10-23)


### Added

* **opencode-lens:** Vibe Coding project board with drag and drop of folders
* **opencode-lens:** project detail with working time and forecast
* **opencode-lens:** document of the Vibe Coding projects
* **opencode-lens:** Security page as a dashboard: hero with charts, health and policy up front, events over time
* **opencode-lens:** Security page as a dashboard: hero with charts, health and policy up front, events over time
* **opencode-lens:** Vibe Coding projects saved in vibe-projects.json
* **opencode-lens:** end-of-month forecast of cost, tokens and time
* **opencode-lens:** graphic summary strip of Vibe Coding
* **opencode-lens:** Vibe Coding with the «Month» period and compact tables
* **opencode-lens:** Vibe Coding with projects, graphic KPIs and end-of-month forecast
* **opencode-lens:** Vibe Coding splits tokens, cost and time by folder and by day
* **opencode-lens:** Vibe Coding brings the previous period and the days of the current month


### Fixed

* **opencode-lens:** the strip's «End of month» matches the projects' ring, chart labels without overlaps
* **opencode-lens:** budget with a decimal comma without accidental deletions, keyboard focus in the board, rollback to the last saved, + New project always there
* **opencode-lens:** forecast and end of budget count today the same way
* **opencode-lens:** budget state consistent across card, detail and ring; End of month note from the ring; dead code of from=0 removed
* **opencode-lens:** Vibe Coding strip without inline styles, chart labels and totals fixed
* **opencode-lens:** Vibe Coding tables with 3 columns and no scrolling, chart text readable on narrow screens
* **opencode-lens:** Vibe Coding does not apply stale projects after a save
* **opencode-lens:** vibe-projects.json among the files written in /api/about


### Documentation

* **opencode-lens:** fields of /api/vibe-coding and /api/vibe-projects, 7-day pace, change only on cost, tokens and time, currency of costs
* **opencode-lens:** mockup of the Security page with hero, health, policy and charts
* **opencode-lens:** mockup of the Vibe Coding page with projects and forecast
* **opencode-lens:** Vibe Coding with projects and forecast

## [0.30.1] (2026-10-22)


### Documentation

* **opencode-lens:** changelog 0.30.0 translated into English and French
* **opencode-lens:** changelog 0.30.0 translated into English and French

## [0.30.0] (2026-10-22)


### Added

* **opencode-lens:** dashboard without the «pulse», selective tick and pause of updates
* **opencode-lens:** dashboard without the «pulse», selective tick and pause of live updates
* **opencode-lens:** pause of live updates, «Refresh» and no reads in a background tab
* **opencode-lens:** a live tick rereads only the data its changes may have changed


### Fixed

* **opencode-lens:** /metrics and OTLP reuse the all-time aggregates as long as nothing changes, and for at most 10 s while the collector writes (F-13)
* **opencode-lens:** backpressure on slow SSE clients and cleanup of the timers (PER-01, ARC-06)
* **opencode-lens:** dashboard colors and the runs of a period reused for a few seconds while the collector writes (F-14)
* **opencode-lens:** the sync writes messages in blocks of 500 instead of one transaction per session (F-15)
* **opencode-lens:** the dashboard no longer dims at every update and the banner interrupts only when it is critical
* **opencode-lens:** the time and model expressions the indexes are built on have a single owner, store.js (F-25)
* **opencode-lens:** in the /metrics counters a step without provider and model waits for the backfill instead of counting under «?» (F-18)
* **opencode-lens:** remediation of the security review of 22/10/2026
* **opencode-lens:** refuses a database with a newer schema instead of crash-looping (DAT-01)
* **opencode-lens:** if the database does not open the lens stays up with a page that says why, instead of restarting every 10 seconds (F-16)
* **opencode-lens:** service install shortens a launchd log over 10 MB to its last MB (F-29)
* **opencode-lens:** internal tasks of the period and prompts without subagents (COR-02, COR-03)
* **opencode-lens:** timeout on the refresh fetches and language header on every POST (CLI-01, CLI-02)
* **opencode-lens:** non-regressing tokens, commit flag on quoted strings, no listener leak (COR-01, DAT-03, COR-06, PER-06)


### Documentation

* **opencode-lens:** live updates, pause and tick with the kinds, in Italian, English and French
* **opencode-lens:** the /metrics counters can drop after a migration or a backfill correction, now it is written down (F-17, mitigation)

## [0.29.1] (2026-10-22)


### Documentation

* **opencode-lens:** changelog 0.29.0 translated into English and French
* **opencode-lens:** changelog 0.29.0 translated into English and French

## [0.29.0] (2026-10-22)


### Added

* **opencode-lens:** aggregates of the DLP guards, cross-check against the calls seen by Lens and series on /metrics
* **opencode-lens:** warning in Settings › MCP server when OpenCode's MCP is older than the lens
* **opencode-lens:** warning in Settings › MCP server when OpenCode's MCP is older than the lens
* **opencode-lens:** discovery of the DLP guards by naming convention, health and LENS_SECURITY_* variables
* **opencode-lens:** /api/security endpoint with a reduced view from the network and gauges on /metrics
* **opencode-lens:** Security page with KPIs, events, health and policy of the DLP guards
* **opencode-lens:** Security page and security MCP tool
* **opencode-lens:** parsing and sanitization of the DLP guards' audits
* **opencode-lens:** skill presets with a chosen order and weight against the cap, import of several files and folders from the browser with a list of outcomes, "already up to date" for identical content and status lines always present
* **opencode-lens:** skill presets: copy /lens:id, direct Edit, missing skills spelled out with "Remove from preset", errors under the field and a warning for a preset without skills
* **opencode-lens:** pure zip writer and grouping of files into skills, to import several files and folders from the browser
* **opencode-lens:** security MCP tool for the DLP guards' audit
* **opencode-lens:** an import identical to the current version does not create a version; hash and mdChars per version


### Fixed

* **opencode-lens:** MCP docs: three caps on the presets' text, paths, missing skills, display name and the watcher's baseline (it, en, fr)
* **opencode-lens:** list of presets in the instructions with the cap, missing skills marked, name accepts the display name, a line on when to ask for a preset
* **opencode-lens:** the ten files listed by detail() picked by role
* **opencode-lens:** the numbers of the presets' order are visible: a CSS counter on the rows instead of the list marker, which a flex row does not show
* **opencode-lens:** the policy's paths are not masked
* **opencode-lens:** the cross-check looks for the tools of the whole audit, not only of the period
* **opencode-lens:** a preset's weight follows the MCP: body plus description, folder, paths and frame, skills walked in order with the form without text and the smaller ones that still fit, "probably" without text
* **opencode-lens:** the preset text never exceeds the budgets, the watcher announces again after a second client failure, correct truncation note and name comparisons on the same text the model sees
* **opencode-lens:** the preset text also respects 48 KiB and 1900 lines; with skill= the body over budget is cut at the end of a line
* **opencode-lens:** MCP instructions: security before preset, the sentence on presets stays next to its line
* **opencode-lens:** adopting folders does not follow links; hashes with lengths; an unreadable index is never rewritten; removals safe against interruptions
* **opencode-lens:** the MCP gives descriptions up to 1024 characters and paths identical to those on disk, and strips variation selectors and Hangul fillers
* **opencode-lens:** MCP: the forms of a skill in the preset are built one at a time, only if the previous one does not fit
* **opencode-lens:** robust skill store: write errors, a reconcile that does not stop the startup and adopts the folders, import of SKILL.md onto the right skill
* **opencode-lens:** names in the zip decoded correctly, PowerShell zips accepted, clear messages for nested zips
* **opencode-lens:** Security page: comparison with Lens, policy keys, note on the policy and rejected rows
* **opencode-lens:** Security page: no "null" in the detail of events without findings
* **opencode-lens:** Security page: verdict in the subtitle, Copy for SHA-256 and call ID, detail stable on refresh
* **opencode-lens:** Skill page: no sideways scrolling on phones, cards below 900 px, feedback with distinct errors, detail under the row, search, sorting, counter and "In presets" column
* **opencode-lens:** the guards' policy and plugins accept only valid guard names
* **opencode-lens:** review of the skill library: robust import, MCP within OpenCode's budgets, Skill page redone
* **opencode-lens:** Security: comparison from the audit's first event, masking per token, limits on categories, outcomes and lists
* **opencode-lens:** security MCP tool: totals without scope, reasons for the verdict, categories and lists with the total
* **opencode-lens:** an unreadable skill index does not look like an empty library: the page shows the reason, canSave is false and import and actions answer 409 until it is repaired
* **opencode-lens:** a skill with the same paths and bytes but other execute bits is "already up to date" and keeps its modes; "SKILL copia 2.md" and "SKILL copy 2.md" do not name a skill
* **opencode-lens:** an unreadable skill does not stop the preset, prompts/list says why it is empty, the watcher starts from what the client received, skills read in parallel


### Documentation

* **opencode-lens:** "Skill" in the dashboard: import modes with an explanation, search, sorting, "In presets", detail panel, cards on phones, copy /lens:id and preset warnings (it, en, fr)
* **opencode-lens:** "Skill": import of folders and several files, order and weight of presets, "already up to date", hash and adoption at startup, zip-writer and the preset's name or id (it, en, fr)
* **opencode-lens:** Security page, contract of the DLP guards and security MCP tool (it, en, fr)
* **opencode-lens:** Security: masking rules, comparison with Lens, outcomes on /metrics and what is visible from the network (it, en, fr)

## [0.28.1] (2026-10-22)


### Fixed

* **opencode-lens:** a skill with a display name is imported with the id of its folder or of the slug
* **opencode-lens:** a skill with a display name takes its id from the folder or from the slug, as OpenCode does

## [0.28.0] (2026-10-22)


### Added

* **opencode-lens:** frontmatter, id and zip plan of a skill
* **opencode-lens:** skill library and presets through the MCP
* **opencode-lens:** skill library on disk next to the database, with versions
* **opencode-lens:** Skill page with library, versions and presets
* **opencode-lens:** skill presets with a shared validator
* **opencode-lens:** /api/skills and /api/skill-presets routes, About and uninstall
* **opencode-lens:** preset tool, MCP prompts and dynamic instructions with the presets' skills


### Fixed

* **opencode-lens:** presets dialog without the "null" line, focus after the redraw, errors in Italian and the Actions header
* **opencode-lens:** preset id pattern valid for the browsers' v flag
* **opencode-lens:** prompts/get tells an unknown preset from failures, hard text cap, whole briefs and \u escapes in the source
* **opencode-lens:** final review of skills and presets: invisible characters, ids, .git, language of the refusals
* **opencode-lens:** rollback and removeVersion of the skill library require a version
* **opencode-lens:** an import never overwrites folders on disk; stricter version and startup


### Changed

* **opencode-lens:** planEntries and JsonStore reusable for the skill library


### Documentation

* **opencode-lens:** skill library, presets and the MCP's preset tool

## [0.27.1] (2026-10-20)


### Documentation

* **opencode-lens:** changelog 0.27.0 translated into English and French

## [0.27.0] (2026-10-20)


### Added

* **opencode-lens:** Vibe Coding page with working time, tokens and breakdowns of the period
* **opencode-lens:** Vibe Coding page with working time, tokens and breakdowns of the period

## [0.26.0] (2026-10-20)


### Added

* **opencode-lens:** /api/system with cores, memory breakdown, network, lens health and recent trend
* **opencode-lens:** the OpenCode connection badge moves to the bottom of the menu, above the theme; with icons only the dot stays
* **opencode-lens:** the «system» theme has a laptop icon instead of the half disc
* **opencode-lens:** the theme button's icon follows the mode: half disc, sun, moon
* **opencode-lens:** the System page searches processes by PID, TCP or UDP port and name; UDP sockets are among the listening ports too
* **opencode-lens:** side menu, theme icons and a more complete System page with search
* **opencode-lens:** System page reorganised: health, performance with the Gallery's models, trend, cores, network and services


### Documentation

* **opencode-lens:** System page, connection badge and theme icons (it, en, fr), with the design

## [0.25.0] (2026-10-20)


### Added

* **opencode-lens:** add a widget to the view from the Gallery, inside the edit session
* **opencode-lens:** compare two to four styles of the same type in the Gallery
* **opencode-lens:** pure functions to add and compare from the Gallery
* **opencode-lens:** tabbed Gallery, with Compare and Add to the view
* **opencode-lens:** the Gallery has one tab per view, with search, filter and an index of the types


### Fixed

* **opencode-lens:** the Prompt: distribution histogram was not drawn, a local variable shadowed the translation


### Changed

* **opencode-lens:** removed the classic Summary, the full-ring Gauge and the Hero's hours clock, migrated to C22, B2 and G1
* **opencode-lens:** removed the full-ring Gauge; whoever had saved it finds it as B2
* **opencode-lens:** removed the classic Summary; whoever had saved it finds it as C22
* **opencode-lens:** removed the Hero's hours clock; whoever had saved it finds it as G1


### Documentation

* **opencode-lens:** Add and Compare in the Gallery
* **opencode-lens:** design of Compare and Add from the Gallery
* **opencode-lens:** plan of Compare and Add from the Gallery

## [0.24.1] (2026-10-20)


### Fixed

* **opencode-lens:** 0.24.0 translated in the CHANGELOGs and a test that no longer blocks the release
* **opencode-lens:** 0.24.0 translated in the CHANGELOGs and a test that no longer blocks the release

## [0.24.0] (2026-10-20)


### Added

* **opencode-lens:** dashboard, server, What's new and documents in Italian, English and French
* **opencode-lens:** dashboard, server, What's new and documents in Italian, English and French


### Fixed

* **opencode-lens:** breakdown sorted and MCP more robust
* **opencode-lens:** breakdown sorted by the total tokens of each group
* **opencode-lens:** MCP: consistent usage total, lens errors translated, names on one line

## [0.23.0] (2026-10-19)


### Added

* **opencode-lens:** files and API of the dashboard presets
* **opencode-lens:** window to manage the dashboard presets
* **opencode-lens:** the presets file among the written files and in the uninstall
* **opencode-lens:** the layout remembers which layout it starts from
* **opencode-lens:** logic of the dashboard presets
* **opencode-lens:** personal presets of the dashboard layouts
* **opencode-lens:** personal presets in the Layout menu


### Fixed

* **opencode-lens:** presets window and menu: closing during the save, confirmation before saving, focus, rename and accessible group
* **opencode-lens:** presets are reread before every change, the form is not emptied and the menu scrolls on short screens
* **opencode-lens:** the Layout menu scrolls in a short window
* **opencode-lens:** prefs.origin of a newer version is kept and the warning about the presets file is not repeated
* **opencode-lens:** an invalid presets file is kept before a save replaces it


### Documentation

* **opencode-lens:** notes on the presets after the review fixes
* **opencode-lens:** personal presets of the dashboard layouts

## [0.22.0] (2026-10-19)


### Added

* **opencode-lens:** “Show costs”, a single switch to hide all costs
* **opencode-lens:** Analysis starts from the last 7 days
* **opencode-lens:** the charts of single prompts read up to 1000 prompts of the period
* **opencode-lens:** today's retries as an Indicator, including those for rate limits
* **opencode-lens:** the first token can be chosen as the Indicator's metric
* **opencode-lens:** the Budget widget also counts steps and cost
* **opencode-lens:** “8 hours” period in the Analysis filters and in the widgets


### Fixed

* **opencode-lens:** compaction and new sessions in the Live activity
* **opencode-lens:** the Analysis filters no longer move when the sentence under the title changes
* **opencode-lens:** the classic Live activity respects “Events shown”
* **opencode-lens:** the small note of “Status lights” wraps instead of being cut
* **opencode-lens:** in the Operativa Monitor, today's models are straight bars
* **opencode-lens:** in the T4 log the session column is as wide as the longest name
* **opencode-lens:** “Failed steps” type in the Live activity
* **opencode-lens:** “Model” shows the full model name, on two lines
* **opencode-lens:** “Running prompts” can hide the cost
* **opencode-lens:** “Running prompts” without cost in Operativa and Presidio
* **opencode-lens:** “Only with problems” filters the prompts on the server

## [0.21.0] (2026-10-19)


### Added

* **opencode-lens:** dashboard layouts chosen from the side menu


### Fixed

* **opencode-lens:** model and prompt labels shown in full when there is room

## [0.20.0] (2026-10-19)


### Added

* **opencode-lens:** widget size based on the screen (Auto, Small, Normal, Large)


### Fixed

* **opencode-lens:** the logo stays still when the menu is reduced to icons
* **opencode-lens:** Settings and System tiles on one or two lines, without truncation


### Documentation

* **opencode-lens:** design of the widget size based on the screen

## [0.19.2] (2026-10-19)


### Fixed

* **opencode-lens:** “beta” and version under the name in the menu, narrower side menu
* **opencode-lens:** classic “Per model today”: pace badge without text, with the meaning in the tooltip
* **opencode-lens:** “Collapse to icons” at the top of the menu, above the views
* **opencode-lens:** “Last year” in green, to avoid confusing it with “When you work”, which stays blue
* **opencode-lens:** bars per model (B6): full name on two lines and bar on the day budget
* **opencode-lens:** the last event received is no longer written in the dashboard, only in the tooltip
* **opencode-lens:** no API-changed warning if session.step.started has no data.started
* **opencode-lens:** values of the Settings and System tiles wrap, without ellipses

## [0.19.1] (2026-10-18)


### Fixed

* **opencode-lens:** hourly series with 25 buckets on the day of the return to standard time

## [0.19.0] (2026-10-18)


### Added

* **opencode-lens:** “System” page with CPU, memory, processes and listening services

## [0.18.0] (2026-10-18)


### Added

* **opencode-lens:** measures per style, Summary with styles and cards without empty space
* **opencode-lens:** measures per style, Summary with styles and cards without empty space
* **opencode-lens:** free widget position, title bars and collapsible side bar
* **opencode-lens:** free widget position, title bars and collapsible side bar


### Documentation

* **opencode-lens:** mockup of the title bars in four directions

## [0.17.1] (2026-10-18)


### Fixed

* **opencode-lens:** the MCP instructions point to lens-guard for the model switch
* **opencode-lens:** the MCP instructions point to lens-guard for the model switch

## [0.17.0] (2026-10-18)


### Added

* **opencode-lens:** lens update from a zip in Settings
* **opencode-lens:** reading and checking of the update zip
* **opencode-lens:** POST /api/update and /api/update/apply, update with install.sh
* **opencode-lens:** Update section in Settings


### Documentation

* **opencode-lens:** update from the dashboard
* **opencode-lens:** spec and plan of the update from a zip in Settings

## [0.16.0] (2026-10-18)


### Added

* **opencode-lens:** GET /api/mcp/status, state of the MCP server read from OpenCode
* **opencode-lens:** MCP server, lens name shown in the page and more precise states
* **opencode-lens:** MCP server section in Settings
* **opencode-lens:** MCP server section in Settings
* **opencode-lens:** state and connection of the MCP server, pure logic


### Documentation

* **opencode-lens:** plan of the MCP server section in Settings
* **opencode-lens:** spec of the MCP server section approved

## [0.15.0] (2026-10-18)


### Added

* **opencode-lens:** /api/errors and the opencode-lens mcp MCP server for OpenCode
* **opencode-lens:** /api/errors groups failed steps, tools, retries and runs by model, type and status
* **opencode-lens:** side bar, Monitor view and selectable model styles
* **opencode-lens:** extras/ in the package and in the installation, lens-guard documentation
* **opencode-lens:** the MCP reads port and token from the plist; opencode-lens mcp install prints the line for opencode2
* **opencode-lens:** lens-guard plugin, model switch when the provider does not answer
* **opencode-lens:** lens-guard plugin, model switch on exhausted quota, long rate limit or unreachable provider
* **opencode-lens:** stdio MCP server with the 2025-11-25 and 2026-07-28 revisions, hand-written
* **opencode-lens:** MCP tools budget, errors, usage and sessions with error text only when allowed


### Fixed

* **opencode-lens:** the MCP times follow the current time zone
* **opencode-lens:** the MCP does not let «» be closed by the text, reads all sessions and rereads the plist at every call
* **opencode-lens:** lens-guard trusts OpenCode's error type, switches only if the connection does not start and does not restart the chain mid-turn


### Documentation

* **opencode-lens:** plan of lens-guard's reactive branch
* **opencode-lens:** plan of /api/errors and of the opencode-lens mcp MCP server
* **opencode-lens:** MCP server for OpenCode in configuration, metrics, README and architecture
* **opencode-lens:** evaluation of MCP and OpenCode plugins on top of the Lens APIs
* **opencode-lens:** evaluation of MCP and OpenCode plugins on top of the Lens APIs
* **opencode-lens:** evaluation of MCP and OpenCode plugins on top of the Lens APIs

## [0.14.1] (2026-10-17)


### Fixed

* **opencode-lens:** Now rereads the budget day as soon as it resets
* **opencode-lens:** the widget ids of an unknown view count for uniqueness across views
* **opencode-lens:** the gaps between the segments of the composition bar have the surface color
* **opencode-lens:** running runs exclude deleted sessions
* **opencode-lens:** the contract test with OpenCode Monitor checks the 200 status
* **opencode-lens:** the calendar date uses fmtLongDate like the other dates
* **opencode-lens:** the detail row updates the colspan when the Prompt widget changes width
* **opencode-lens:** minor leftovers of the dashboard v2 reviews
* **opencode-lens:** test, a subagent's idle sends no run events to the feed
* **opencode-lens:** a single rule for model limits, safe positive integer or none
* **opencode-lens:** units on the distribution and hour-by-hour axes, Trend caption hidden without data

## [0.14.0] (2026-10-17)


### Added

* **opencode-lens:** live events for first token, end of stream, interruptions, titles and compaction
* **opencode-lens:** OTLP metrics and spans for first token, tok/s, interruptions and internal tasks
* **opencode-lens:** exact step and compaction times from reading the messages
* **opencode-lens:** first token, tok/s, interruption reasons and internal tasks by type in the dashboard
* **opencode-lens:** schema v4 — exact first token, tok/s, interruption reason and internal tasks
* **opencode-lens:** schema v4 with step times, run reason and internal task type
* **opencode-lens:** exact internal tasks that absorb the estimate without double counting
* **opencode-lens:** step speed, interruption reasons and internal tasks by type in the APIs


### Fixed

* **opencode-lens:** “Running prompts” without absurd durations or delays
* **opencode-lens:** /api/timeseries accepts again the model parameter used by OpenCode Monitor
* **opencode-lens:** /api/timeseries accepts again the model parameter used by OpenCode Monitor
* **opencode-lens:** /metrics sums first token and tok/s of the steps in SQL
* **opencode-lens:** live compaction only with the id of its started, and reading does not bring the request back to the first attempt
* **opencode-lens:** durations under 10 minutes with seconds (“1 min 30 s”)
* **opencode-lens:** the prompts of the whole period are computed once per refresh
* **opencode-lens:** Home, End and Space on the “Now | Analysis” tabs
* **opencode-lens:** the end of the stream of a previous attempt does not overwrite that of the last one
* **opencode-lens:** in the session detail, internal tasks are grouped by type and model
* **opencode-lens:** paged prompts and sessions follow the widget height
* **opencode-lens:** polish of the dashboard v2
* **opencode-lens:** polish of schema v4 after the review
* **opencode-lens:** test that every catalog type has its widget, niceMax removed
* **opencode-lens:** a drag does not end up in the other view if the view changes
* **opencode-lens:** an exact internal-task row no longer falls back to a re-read
* **opencode-lens:** an empty answer does not stay “waiting for the first token” until the end of the step


### Documentation

* **opencode-lens:** design of schema v4 (step speed, interruption reason, exact internal tasks)
* **opencode-lens:** documentation of schema v4
* **opencode-lens:** a run's span is sent once, without an interruption reason that arrived later
* **opencode-lens:** implementation plan of schema v4

## [0.13.0] (2026-10-17)


### Added

* **opencode-lens:** “prompt completed” in the live activity
* **opencode-lens:** Trend as columns or line, feed and calendar that adapt to the widget
* **opencode-lens:** pure calculations for the Now widgets
* **opencode-lens:** two-view dashboard, Now and Analysis, with the prompts and the running prompt
* **opencode-lens:** two-view layout with automatic migration
* **opencode-lens:** list of prompts with tokens by type, duration and tools (/api/runs)
* **opencode-lens:** prompt list and distribution in the dashboard
* **opencode-lens:** today's hero, models, indicators and running prompt
* **opencode-lens:** the v2 layout in dashboard-v2.json, the v1 one stays untouched
* **opencode-lens:** model context limit from the OpenCode config and catalog
* **opencode-lens:** “day” period (budget day) for the endpoints with from
* **opencode-lens:** live running prompts (/api/runs/live)
* **opencode-lens:** empty, error and loading states the same for all widgets
* **opencode-lens:** today's tokens hour by hour and indicators per day (/api/hourly, /api/daily)
* **opencode-lens:** Now and Analysis views in the dashboard


### Fixed

* **opencode-lens:** chart axes without repeated labels
* **opencode-lens:** with the lens unreachable the widgets show the error instead of staying frozen
* **opencode-lens:** it-IT formats of costs, durations and dates
* **opencode-lens:** the model catalog does not report an API change for models without context
* **opencode-lens:** the prompt distribution redraws at its size when going back from the table to the chart
* **opencode-lens:** current hour in the server's time zone and Now widgets without inner scrolling at 900 px
* **opencode-lens:** soFarAvg counts the previous days only up to the same offset as now
* **opencode-lens:** default widgets without inner scrolling, from 375 to 1440 px


### Changed

* **opencode-lens:** live runs look in the window's indexes instead of reading all steps and tools


### Documentation

* **opencode-lens:** fixed the shapes of runs/summary and runs/live and the return to an old version
* **opencode-lens:** two-view dashboard, prompts and new APIs
* **opencode-lens:** design and plan of the two-view dashboard
* **opencode-lens:** documentation aligned with the dashboard v2

## [0.12.2] (2026-10-17)


### Fixed

* **opencode-lens:** fixes from the code review
* **opencode-lens:** interrupted steps do not stay “running” forever in the Summary and in the sessions
* **opencode-lens:** OPENCODE_SERVER_URL with user and password is rejected instead of ending up in the errors
* **opencode-lens:** plist, database and dashboard.json readable only by the owner


### Changed

* **opencode-lens:** removed the never-used code flagged by the review

## [0.12.1] (2026-10-17)


### Fixed

* **opencode-lens:** install.sh stopped with “APP…: unbound variable” in the macOS Terminal

## [0.12.0] (2026-10-17)


### Added

* **opencode-lens:** install.sh checks and cleans previous installations
* **opencode-lens:** installation from a zip with a single command, without sudo


### Documentation

* **opencode-lens:** versions and releases with the two zips and installation compatibility

## [0.11.0] (2026-10-17)


### ⚠ BREAKING CHANGES

* **opencode-lens:** no more Homebrew formula or vale76p/tap tap. Whoever installed with brew switches to the zip: extract it in ~/Applications, run node ~/Applications/opencode-lens/src/main.js service install (it keeps variables, database and layout), then brew uninstall opencode-lens and brew untap vale76p/tap.

### Changed

* **opencode-lens:** installation from the release zip, without Homebrew

## [0.10.0] (2026-10-17)


### ⚠ BREAKING CHANGES

* **opencode-lens:** in /metrics and in the OTLP export opencode_lens_steps_total no longer has finish="running" (steps finished without a reason have finish="unknown") and opencode_lens_tool_calls_total, opencode_lens_tool_output_bytes_total and opencode_lens_tool_duration_seconds no longer have status="pending"/"running"/"?". For what is in progress use opencode_lens_steps_running and opencode_lens_tool_calls_running (see docs/en/metriche.md).

### Added

* **opencode-lens:** corrected counts and gauges for running steps and tools


### Fixed

* **opencode-lens:** safer release chain
* **opencode-lens:** dashboard more reliable with the lens stopped and sessions active
* **opencode-lens:** more robust server and settings, no secrets in the errors

## [0.9.0] (2026-10-16)


### Added

* **opencode-lens:** budgets active only for the models of the OpenCode configuration
* **opencode-lens:** per-model budgets from Settings, with the history
* **opencode-lens:** “Budget per model” card in Settings
* **opencode-lens:** budget gauge of a model and models widget type
* **opencode-lens:** reading of the models from the global OpenCode configuration
* **opencode-lens:** “Budget per model” widget and per-model gauge


### Fixed

* **opencode-lens:** budgets with the thousands dot rejected and a hand-written LENS_MODEL_LIMITS no longer blocking
* **opencode-lens:** budget day at the switch to daylight saving time and never-seen models without “green light”


### Documentation

* **opencode-lens:** per-model budgets from the OpenCode configuration
* **opencode-lens:** per-model budgets and reset hour
* **opencode-lens:** design of the per-model budgets from the OpenCode configuration
* **opencode-lens:** plan of the per-model budgets from the OpenCode configuration

## [0.8.1] (2026-10-16)


### Changed

* **opencode-lens:** “Today” without the 7–19 band bar

## [0.8.0] (2026-10-16)


### Added

* **“Budget and reset” widget**: day, week and month for the chosen metric, with use against the `LENS_LIMIT_*` budget, projection at the reset and **when they reset**, that is a countdown (“resets in 2 d 9 h”) and date and time (“Mon 19/10 00:00”). The periods follow the calendar in local time: the day from midnight, the week from Monday, the month from day 1. It is in the default layout, under “Today” and “Last year”, and in the catalog for those who already customized the dashboard
* The budget gauges also say how long until their period resets


### Documentation

* `/api/budget`: `from` and `to` are the start and the reset of the period (epoch ms, local time), `elapsed` the fraction elapsed

## [0.7.1] (2026-10-16)


### Fixed

* **opencode-lens:** the Homebrew formula downloads the tag archive with HOMEBREW_GITHUB_API_TOKEN

## [0.7.0] (2026-10-16)


### Added

* **Installation with Homebrew** from the private tap vale76p/homebrew-tap: `brew tap vale76p/tap`, `brew install vale76p/tap/opencode-lens`, `opencode-lens service install`. All in the user folder, without `sudo`; guide in the [README](README.en.md)
* **`opencode-lens service install | uninstall [--purge] | start | stop | restart | status`**: manages the `local.opencode-lens` LaunchAgent in place of `install.sh` and `uninstall.sh`, which stay as wrappers for those who work from a clone. It keeps the plist variables (budgets, `LENS_TOKEN`…), uses Homebrew's stable paths (`/opt/homebrew/opt/…`), re-enables the service turned off by the Monitor and retries the bootstrap
* **Automatic restart after an update**: started by launchd, the lens notices the new version (for instance after `brew upgrade`) and restarts by itself within a minute
* At every release the workflow updates the tap's formula (secret `HOMEBREW_TAP_TOKEN`, see the [README](README.en.md#versions-and-releases))


### Documentation

* README, uninstall, troubleshooting and configuration for the Homebrew installation; design and plan in `docs/superpowers/`

## [0.6.0] (2026-10-16)


### Added

* **Customizable dashboard**: with “Customize dashboard” the blocks become widgets on a 12-column grid. They move by dragging (or with the arrows), resize from the corner, are removed and added from the catalog, even the same one several times. The layout is saved in `dashboard.json` next to the database: it is personal and does not end up in the package. Guide: [docs/en/dashboard.md](docs/en/dashboard.md)
* **Per-widget settings** (⚙): own period, metric, grouping and title, or “Dashboard” to follow the filters at the top
* **Gauge widget**, semicircle or ring: budget of the day, week or month with the projection, prompts from cache, failed steps, tool calls with errors
* **Line widget** with smooth curves and gradient area, one line per model, agent or provider, or the total (`/api/timeseries?by=total`)
* **Environment variables editable from the Settings page** with the `install.sh` LaunchAgent: validated as at startup, written to the plist, lens reloaded
* **“Today”**: 0–24 token bar (blue) and 7–19 band bar (green) with the times, date and budget in the “i” button, next to the yearly calendar
* Run statistics on a single line; sessions of the period 10 per page (`/api/sessions` with `offset` and the total in the `x-total-count` header)


### Fixed

* `install.sh` retries the bootstrap if launchd has not finished unloading the service yet: before, it could leave the lens stopped with “Bootstrap failed: 5”


### Changed

* The dashboard is in ES modules: `ui.js`, `layout.js` (shared with the server to validate), `widgets.js`, `editor.js`, `gauge.js`, `curves.js`


### Documentation

* New guide [docs/en/dashboard.md](docs/en/dashboard.md); design and plan of the customizable dashboard in `docs/superpowers/`

## [0.5.0] (2026-10-16)


### Added

* **opencode-lens-monitor:** menu bar app with panel and widgets


### Fixed

* **opencode-lens:** install.sh keeps the EnvironmentVariables of the existing plist
* **opencode-lens:** install.sh keeps the EnvironmentVariables of the existing plist

## [0.4.0] (2026-10-16)


### Added

* **opencode-lens:** weekly and monthly budgets and /api/budget
* **opencode-lens:** weekly and monthly budgets LENS_LIMIT_*_WEEKLY and _MONTHLY
* **opencode-lens:** /api/budget endpoint for the monitor app and the widgets
* **opencode-lens:** calendar periods with projection and pace per day, week and month

## [0.3.1] (2026-10-15)


### Fixed

* **opencode-lens:** delta OTLP export without resending the history at restart and without loss after a failed send
* **opencode-lens:** error spans carry only the error type, the OTLP endpoint appears without credentials
* **opencode-lens:** the calendar's current streak does not reset at the start of the day
* **opencode-lens:** pending permissions as a gauge, LENS_PORT=0 accepted also in the Host check, --help with all the variables even if the environment is not valid
* **opencode-lens:** subagent prompts and runs excluded from Run and interaction and from the metrics, their cost stays in the parent session's run
* **opencode-lens:** OTLP traces exported run by run in recording order, with each step under its run and no lost spans
* **opencode-lens:** a prompt sent while a run is in progress no longer splits the run

## [0.3.0] (2026-10-15)


### Added

* **opencode-lens:** Today bar with daily budgets and yearly calendar
* **opencode-lens:** output size and tools executed by the provider in the Tools table
* **opencode-lens:** optional OTLP/HTTP JSON export of metrics (cumulative or delta) and of run, step and tool traces
* **opencode-lens:** LENS_LABELS on every /metrics series and new metrics for runs, prompts, permissions, commits, subagents, budgets and tool duration
* **opencode-lens:** prompts (length and attachments only), permissions with answer and wait time, successful git commits and cost per commit
* **opencode-lens:** runs from the prompt to the answer with outcome, duration and cost including subagents, rebuilt also for sessions without idle messages
* **opencode-lens:** subagents linked to the task call that launches them, total of the sessions with the subagents and grouping by agent type
* **opencode-lens:** session timeline with steps, tools and runs, pauses over a minute shortened


### Fixed

* **opencode-lens:** events with an already seen id discarded, so the live feed does not show them twice
* **opencode-lens:** validation of the environment variables, tool execution column

## [0.2.0] — 2026-10-15

### Added

- **Settings page** in the dashboard (`#impostazioni`): version and process, files written by the lens with status, size and date (database, WAL, log, LaunchAgent), files read, data saved in the browser, database status, effective environment variables with their origin (secrets are never shown) and the complete uninstall commands already filled in with the paths of this installation.
- **What's new page** (`#novita`): this changelog, with the installed version highlighted and an indicator in the navigation when the version changes.
- Version next to the dashboard title, `--version` from the command line, `opencode_lens_build_info` metric in `/metrics`.
- `/api/about` and `/api/changelog` endpoints.
- Guide [docs/en/disinstallazione.md](docs/en/disinstallazione.md): complete removal of service, database, logs, app folder and browser data, with the verification commands.
- Versioning: `opencode-lens-vX.Y.Z` tags, `opencode-lens-release` workflow that checks tag, version and changelog, creates the zip and publishes the release on GitHub; `scripts/changelog.mjs` to check the changelog and extract the notes.

### Changed

- The version has a single source, `package.json`: `/api/status` reads it from there instead of having it written in the code.
- The zip is no longer committed in `dist/`: it is attached to the GitHub release. `npm run package` still creates it locally.

## [0.1.0] — 2026-10-15

First version. Checked against OpenCode V2 beta 17823.

### Added

- **Collector**: discovery of the shared service from `service.json` (re-read at every reconnection, Basic auth), live stream from `/api/event` with reconnection and backoff, authoritative backfill from `/api/session` and `/api/session/{id}/message` at connection, every 2 minutes and at the end of a run.
- **Exact numbers**: idempotent upserts by ID, retries counted as attempts of the same step, internal tasks (title, compaction) derived as *session total − Σ steps* without double counting; `npm run verify` reconciles the DB with OpenCode's totals.
- **Dashboard** on `http://127.0.0.1:4777`: tokens by type, cost, cache, p50/p95 latency, output tok/s, series per hour/day/week in local time, breakdown by model, agent, provider and folder, tools with the most frequent errors, sessions with step detail, live feed. Stable colors for the 6 most used models of all time.
- **Local API** JSON, `/api/live` (SSE) and `/metrics` in Prometheus format.
- **Security and privacy**: `127.0.0.1` only by default, `Host` header check, GET only, restrictive CSP, no proxy to OpenCode's API; `LENS_TOKEN` mandatory to expose it on the network. No prompt, answer or tool output saved; optional titles (`LENS_STORE_TITLES=0`).
- **API drift reporting** beta: warning in the dashboard, `/api/status` and `/metrics` when the events change shape.
- **Installation** as a macOS LaunchAgent with `install.sh` / `uninstall.sh` (`--purge` to delete DB and logs).
- **Tests** `node:test` without dependencies, with a fake OpenCode service; `dist/opencode-lens-0.1.0.zip` package created by `scripts/package.sh`.

