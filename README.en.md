# OpenCode Lens

🌐 [Italiano](README.md) · English · [Français](README.fr.md)

**Version 0.51.1** <!-- x-release-please-version --> · [What's new](CHANGELOG.en.md) · [Releases](https://github.com/vale76p/opencode-lens-public/releases) · [MIT](LICENSE) licence

**Local observability for [OpenCode](https://opencode.ai) V2.** OpenCode Lens attaches read-only to the OpenCode service running in the background, counts the tokens, costs, models, tools, errors and timings of every session, and shows them in a dashboard at `http://127.0.0.1:4777`, in a JSON API and on `/metrics` for Prometheus.

It answers questions like: *how much have I used today? at this pace, will I go over this week's budget? which model or agent costs the most? why have requests been failing since this morning?* The models working in OpenCode can ask the same questions through the lens's MCP server.

Everything stays on your computer: no external service, no account, zero npm dependencies, no build.

## What it does

- **Today's budget and usage.** Today's tokens, cost and steps against the budgets you choose (`LENS_LIMIT_*`, also weekly, monthly and per model), with the end-of-day projection, hour by hour, and what is left.
- **What OpenCode is doing right now.** The running prompt with time, steps, tools, tokens and context fill.
- **Analysis of a period.** Trend over time, working rhythm, share by model, agent, provider or agent type, cache, latencies (p50/p95), the heaviest prompts, the calendar of the last year.
- **Prompts and sessions.** Every prompt with outcome, duration, steps, tools and tokens; every session with its subagents and a timeline of steps and tools, with the pauses highlighted; permissions, commits and waiting times.
- **Customizable dashboard.** Widgets on a 12-column grid to move, resize and configure, with gauges, column or line charts and different styles; three views (**Now**, **Analysis**, **Monitor** to keep full screen) and a **Gallery** of every widget with real data.
- **MCP server for OpenCode.** Models can ask Lens for budgets, aggregated errors, usage and sessions (“compare this week with last week”).
- **API, Prometheus and OTLP.** A local JSON API, `/metrics` with counters that never go down, and OTLP export to an OpenTelemetry collector.
- **Optional modules.** Extra pages to turn on when you need them: Vibe Coding, System, Security, IBM Bob and Skill, plus the ones you write (see [Modules](#modules)).
- **Extras.** The **lens-guard** OpenCode plugin, which switches to a fallback model when the provider runs out of quota or does not answer, an optional macOS app with the dashboard in a native window and, as a separate project, [OpenCode Lens Monitor](https://github.com/vale76p/opencode-lens-monitor-public), the menu bar app with budget, panel and widgets.

The interface is in Italian, English and French: language and the format of dates and numbers follow the browser, or are chosen in Settings.

## How it works

```
OpenCode service ──SSE (live)──┐
  (~/.local/state/opencode/    ├─► collector ─► local SQLite ─► dashboard · JSON API · /metrics · MCP
   service.json) ──backfill ───┘
```

1. **Discovery.** The lens reads `~/.local/state/opencode/service.json` for the address and password of the OpenCode service, and reads it again on every reconnection.
2. **Live and backfill.** It listens to the service's event stream and, at intervals, reads sessions and messages again: the assistant message is the authoritative source, so the numbers come out exact even after a disconnection.
3. **Store.** Every write is an idempotent upsert by ID into a local SQLite database (`node:sqlite`), and the totals are reconciled with OpenCode's (`npm run verify`).

**What it stores and what it does not.** It stores counts, timings and names (models, agents, tools), session titles (`LENS_STORE_TITLES=0` leaves them out), the working folder of each session and error messages, redacted (keys, tokens, home) and cut to 500 characters. It **does not store** the text of prompts, the responses or tool output. It does not touch sessions and does not proxy OpenCode's API.

**Security.** By default it listens only on `127.0.0.1`, checks the `Host` header and accepts few writes, only from this computer. To expose it on the network `LENS_TOKEN` is mandatory (see [docs/en/configurazione.md](docs/en/configurazione.md#remote-exposure)).

The details are in [docs/en/architettura.md](docs/en/architettura.md).

## Requirements

- **OpenCode V2** (`opencode2`), started at least once, so that the shared service writes `service.json`. Checked on OpenCode v2.0.26. OpenCode V1 (`opencode`) is not supported: it has a different server API.
- **Node ≥ 22.13** (it uses the built-in `node:sqlite`). If there is none, `install.sh` downloads Node 24 LTS into the app folder, without `sudo`.
- **macOS** to install it as a service (launchd). On **Linux** the lens is started by hand.

## Installation

On macOS the lens runs as a launchd service from `~/Applications/opencode-lens`. Everything stays in your user folder, without `sudo` or administrator rights.

1. From the [releases page](https://github.com/vale76p/opencode-lens-public/releases) download `opencode-lens-<version>.zip` (or “Source code (zip)”: both work).
2. Extract the zip (double-click it in the Downloads folder).
3. In Terminal run the `install.sh` of the extracted folder: type `bash `, drag `install.sh` into the window and press Return. Or:

   ```bash
   bash ~/Downloads/opencode-lens*/install.sh
   ```

4. Open `http://127.0.0.1:4777`.

With the [GitHub CLI](https://cli.github.com) steps 1-3 are a single command:

```bash
D="$(mktemp -d)" && gh release download -R vale76p/opencode-lens-public -p 'opencode-lens-[0-9]*.zip' -D "$D" && unzip -q "$D"/opencode-lens-[0-9]*.zip -d "$D" && bash "$D"/opencode-lens/install.sh
```

`install.sh` first saves a copy of the database and of the plist, copies only the files that are needed, uses or downloads Node (checking its checksum; behind a company proxy `LENS_NODE_MIRROR` points to an internal mirror), installs the service, which starts right away and at every login, and waits until it answers. For another port: `LENS_PORT=4800 bash …/install.sh`. To see what is already installed without changing anything: `bash …/install.sh --check`.

| What | Where |
|---|---|
| app | `~/Applications/opencode-lens` |
| service | `~/Library/LaunchAgents/local.opencode-lens.plist` |
| database and dashboard layout | `~/Library/Application Support/opencode-lens/` |
| log | `~/Library/Logs/opencode-lens/lens.log` |

**Updating**: the same steps with the new zip, or from the dashboard in **Settings › Update**. Database, layout and service variables (budgets, `LENS_TOKEN`, port) are kept. Details, and switching from versions installed in other ways: [docs/en/aggiornamento.md](docs/en/aggiornamento.md).

**Uninstalling**: `opencode-lens service uninstall` (with `--purge` also database, layout and log); to really remove everything, [docs/en/disinstallazione.md](docs/en/disinstallazione.md).

## Usage

### The dashboard

| Page | What it shows |
|---|---|
| **Now** | the budget day: usage, per-model budgets, the running prompt |
| **Analysis** | a period of your choice (7 days to start with): trend, rhythm, share by model or agent, heaviest prompts |
| **Monitor** | to keep open on a screen, also full screen; it refreshes by itself |
| **Prompts**, **Sessions** | the full lists, with the filters of Analysis and the timeline of each session |
| **Gallery** | every widget and its styles with your data, to add to the dashboard |
| **What's new** | the changelog of the installed version |
| **Settings** | paths, environment variables (editable from the dashboard when the lens runs as a service), language and format, modules, update |

With **Customize** every view becomes a grid of widgets to edit; the layout is saved in the lens and is personal. Full guide: [docs/en/dashboard.md](docs/en/dashboard.md).

### The command

The command is `opencode-lens`. To have it in the shell add to `~/.zshrc`:

```bash
alias opencode-lens='node ~/Applications/opencode-lens/src/main.js'
```

(if `install.sh` downloaded Node, use `~/Applications/opencode-lens/node/bin/node` instead of `node`).

```bash
opencode-lens                              # starts collector + dashboard (by hand, also on Linux)
opencode-lens --check                      # checks that it finds the OpenCode service, then exits
opencode-lens --resync                     # reads all sessions again from scratch, then keeps running
opencode-lens service status               # loaded? answering? paths
opencode-lens service stop | start | restart
opencode-lens service install --port 4800  # changes the port (the other variables stay)
opencode-lens service open                 # opens the dashboard in the browser, with the token
opencode-lens mcp install                  # prints the line that registers the MCP server in OpenCode
```

### Budgets and configuration

The lens is configured with environment variables, which as a service can also be changed from **Settings** (the lens restarts by itself). The most used:

| Variable | What it is for |
|---|---|
| `LENS_LIMIT_TOKENS`, `LENS_LIMIT_COST`, `LENS_LIMIT_STEPS` | daily budgets (with `_WEEKLY` and `_MONTHLY` for week and month) |
| `LENS_MODEL_LIMITS` | daily budget of single models |
| `LENS_MODEL_PRICES` | prices of local models or of models without a price list |
| `LENS_RESET_HOUR` | the hour the budget day starts (midnight to start with) |
| `LENS_PORT`, `LENS_HOST`, `LENS_TOKEN` | port, address and access token |
| `LENS_RETENTION_DAYS` | after how many days the details are summed up by day |
| `LENS_OTLP_ENDPOINT` | export to an OpenTelemetry collector |
| `LENS_MODULES` | the modules that are on |

The full list is in [docs/en/configurazione.md](docs/en/configurazione.md).

### The MCP server

`opencode-lens mcp install` gives you the `opencode2 mcp add …` line to run once. From then on the models in OpenCode have the tools `lens_budget`, `lens_errors`, `lens_usage` and `lens_sessions`, plus those of the modules that are on, and can answer “how much do I have left today on Opus?” or “which are the most expensive sessions of the month?”. Details: [docs/en/configurazione.md](docs/en/configurazione.md#mcp-server-for-opencode).

### API and metrics

The local JSON API (`/api/summary`, `/api/budget`, `/api/runs`, `/api/status`…) is described in [docs/en/metriche.md](docs/en/metriche.md#local-api); `/metrics` is ready for Prometheus and Grafana ([docs/en/metriche.md](docs/en/metriche.md#prometheus--grafana)), and so is the [OTLP export](docs/en/metriche.md#otlp-export).

## Modules

A **module** is an optional part of the lens: an extra page in the menu, with its own APIs, its own widgets for the dashboard and possibly its own MCP tools and tables. All modules start **off**: an off module has no menu entry, no routes, no background work and no metrics. Everything else (Now, Analysis, Monitor, Prompts, Sessions, Gallery, What's new, Settings) is the core and is always there.

Five modules are included:

| Module | What it adds |
|---|---|
| **Vibe Coding** | working time, costs and tokens by project and by folder |
| **System** | the computer the lens runs on: CPU, memory, battery, processes |
| **Security** | what OpenCode's DLP guards let through or blocked, read from their audit files; also as the MCP tool `lens_security` ([docs/en/sicurezza.md](docs/en/sicurezza.md)) |
| **IBM Bob** | the tasks of Bob IDE and Bob Shell, with a selector to see them next to OpenCode or on their own |
| **Skill** | the library of your skills with their versions and how much OpenCode uses them; it groups them into **presets** that the MCP offers to OpenCode as `/lens:<id>` commands |

**Turning them on.** From **Settings › Modules**, with the *Turn on* button of each card; or, with the lens started by hand, with `LENS_MODULES` (for example `LENS_MODULES=sistema,vibecoding`). A module that does not start goes into error on its own: the lens and the other modules keep working.

**Your own modules.** You can write your own and put them in the `modules/` folder next to the database (on macOS `~/Library/Application Support/opencode-lens/modules/`), which updates leave alone; they can also be installed from a zip in **Settings › Update**. A module reads the database read-only and writes only to its own tables. To get started:

- copy the example module [extras/module-template/](extras/module-template/);
- follow the step-by-step guide [docs/en/moduli-custom.md](docs/en/moduli-custom.md), written for an LLM too;
- or ask the model in OpenCode: the MCP tools `lens_module_guide` and `lens_module_check` give it the guide with your installation's values and check the module without turning it on.

The full contract (manifest, routes, widgets, tables, settings, MCP) is in [docs/en/moduli.md](docs/en/moduli.md).

## Development

```bash
git clone https://github.com/vale76p/opencode-lens-public.git opencode-lens && cd opencode-lens
npm run check             # checks that it finds the OpenCode service
npm start                 # collector + dashboard at http://127.0.0.1:4777
npm test                  # node:test tests, with a fake OpenCode service
npm run lint              # Biome via npx
npm run test:integration  # against a real opencode2 (skipped if there is none)
npm run verify            # compares the database with OpenCode's totals, session by session
npm run package           # tests + dist/opencode-lens-<version>.zip
```

There is nothing to install: no npm dependencies and no build. The dashboard is made of ES modules read from disk on every request, so reloading the browser is enough. To run it as a service from the clone: `node src/main.js service install` (the plist points to the clone folder).

The tests run against a fake OpenCode service (temporary `service.json`, Basic auth, SSE stream, pagination) and check that *Σ steps + Σ internal tasks* matches the session totals. `npm run test:integration` starts a real `opencode2 serve` in temporary folders, with a fake OpenAI-compatible model. `npm run test:macos` builds the optional macOS app ([docs/en/app-macos.md](docs/en/app-macos.md)).

```
opencode-lens/
├── src/                  # collector, SQLite store, queries, HTTP server, MCP server
├── public/               # dashboard in ES modules, no build
├── modules/              # the included modules (Vibe Coding, System, Security, IBM Bob, Skill)
├── docs/                 # documentation (Italian, translated in docs/en and docs/fr)
├── test/                 # node:test tests, with a fake OpenCode service
├── extras/
│   ├── opencode/         # lens-guard OpenCode plugin
│   ├── macos/            # optional macOS app (Swift)
│   └── module-template/  # example module to copy
├── scripts/              # package, changelog, check of the totals, release signing
├── install.sh            # installation as a service
└── uninstall.sh
```

## Versions and releases

[SemVer](https://semver.org) versions with a single source: `version` in `package.json`. Releases are prepared by [release-please](https://github.com/googleapis/release-please) from the [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) on `main`: `feat(opencode-lens): …` makes a *minor*, `fix(opencode-lens): …` a *patch*, `!` or `BREAKING CHANGE:` a *major*; `test`, `ci`, `build` and `chore` do not appear in the changelog. Merging the release PR creates the `opencode-lens-vX.Y.Z` tag with the GitHub release and the signed app zip.

The `local.opencode-lens` service, the plist, the data folder and the log have never changed path since 0.1.0, and `install.sh` updates from any previous version: changing them would be a *major* change.

## Documentation

The documents keep their Italian file names in every language.

| Document | Content |
|---|---|
| [docs/en/dashboard.md](docs/en/dashboard.md) | dashboard: views and pages, editing, widgets, catalog, styles, Gallery |
| [docs/en/configurazione.md](docs/en/configurazione.md) | environment variables, budgets, prices, MCP server, lens-guard plugin, remote access, security and privacy |
| [docs/en/metriche.md](docs/en/metriche.md) | meaning of the numbers, local API, `/metrics`, Prometheus, OTLP |
| [docs/en/moduli.md](docs/en/moduli.md) | modules: turning them on, states, API and full contract |
| [docs/en/moduli-custom.md](docs/en/moduli-custom.md) | writing a module of your own, step by step |
| [docs/en/sicurezza.md](docs/en/sicurezza.md) | the Security module and OpenCode's DLP guards |
| [docs/en/architettura.md](docs/en/architettura.md) | discovery, live + backfill flow, idempotency, components |
| [docs/en/aggiornamento.md](docs/en/aggiornamento.md) | updating and switching from previous versions |
| [docs/en/troubleshooting.md](docs/en/troubleshooting.md) | common problems and known limits |
| [docs/en/disinstallazione.md](docs/en/disinstallazione.md) | what the lens writes and how to remove it completely |
| [docs/en/app-macos.md](docs/en/app-macos.md) | the optional macOS app |
| [docs/en/traduzioni.md](docs/en/traduzioni.md) | languages, texts and glossary |
| [CHANGELOG.en.md](CHANGELOG.en.md) | versions, also in the **What's new** page of the dashboard ([it](CHANGELOG.md), [fr](CHANGELOG.fr.md)) |

## Licence

[MIT](LICENSE) © 2026 vale76p. OpenCode Lens is an independent project, not affiliated with OpenCode or IBM.
