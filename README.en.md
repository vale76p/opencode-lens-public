# OpenCode Lens

🌐 [Italiano](README.md) · English · [Français](README.fr.md)

**Version 0.51.0** <!-- x-release-please-version --> · [What's new](CHANGELOG.en.md) · [Releases](https://github.com/vale76p/opencode-lens-public/releases)

Local observability for **OpenCode V2**: tokens, models called, costs, latencies, tools and errors, read from the OpenCode background service and shown in a dashboard at `http://127.0.0.1:4777`.

The dashboard shows:

- **Today**: the day's tokens with the breakdown, the `LENS_LIMIT_*` budget with the end-of-day projection, hour by hour and, with weekly and monthly budgets, week and month (also on `/api/budget` for the OpenCode Lens Monitor app); the day starts at midnight or at the hour of `LENS_RESET_HOUR`;
- **Per model today**: each model's tokens of today with its own daily budget, how much is left and when it resets, also as a single-model gauge; the models come from the OpenCode configuration and the budgets are set in Settings;
- **Running prompts**: the prompt OpenCode is executing, with time, steps, tools, tokens and context fill;
- tokens, cost, cache, latency and tools of the period, per model, agent, provider or agent type (primary or subagent);
- **Prompts**: the list of the period's prompts with outcome, duration, steps, tools and tokens, and their **distribution** (median, p95, average duration); and the **interaction**: permissions with the wait time, commits and the weight of subagents;
- **Last year**: a daily calendar of 53 weeks;
- paged sessions, with the total of the subagents and a **timeline** of steps and tools, with the pauses highlighted;
- **Customize dashboard**: the blocks are widgets on a 12-column grid; they move by dragging, resize from the corner, are configured (period, metric, grouping, title), removed or added from the catalog, even the same one several times, including the **gauges** and the trend as columns or line. Navigation is in a **sidebar**. The dashboard has three views, **Now** (the budget day, the running prompt), **Analysis** (period, token distribution per prompt, list of prompts) and **Monitor** (to keep on a screen, also full screen); every widget with several chart models has a **style** to choose while editing, and the **Gallery** shows them all with real data; the layout is saved in the lens (`dashboard-v2.json` next to the database), is personal and does not end up in the package. Guide: [docs/en/dashboard.md](docs/en/dashboard.md);
- **Settings** (paths, database, environment variables editable from the dashboard with the LaunchAgent, **language** and **format** of dates, times and numbers) and **What's new** (changelog). The dashboard is in Italian, English and French: language and format follow the browser, or are chosen in Settings (`LENS_LANG`, `LENS_LOCALE`; see [docs/en/traduzioni.md](docs/en/traduzioni.md));

With the **MCP server** (`opencode-lens mcp`) the models working in OpenCode can also ask Lens for budget, aggregated errors, usage and sessions: “why are the requests failing?”, “compare this week with the last one”. It is registered with the line printed by `opencode-lens mcp install`: see [docs/en/configurazione.md](docs/en/configurazione.md#mcp-server-for-opencode). The skills you import in the **Skill** page are grouped into **presets**: the MCP offers them to OpenCode as `/lens:<id>` commands and as a `preset` tool, with the text of `SKILL.md`, the base folder and the files ([details](docs/en/configurazione.md#prompts)).

The lens does not touch the sessions: it listens to the event stream of the shared service, rereads the messages to get exact numbers and saves counts, timings and names in a local SQLite database, plus the session titles (`LENS_STORE_TITLES=0` excludes them), each session's working folder and the error messages, redacted (keys, tokens, home folder) and truncated to 500 characters. The text of prompts, answers and tool output is not saved.

## Requirements

- **Node ≥ 22.13**: it uses the built-in `node:sqlite`. Zero npm dependencies, no build. If it is not there, `install.sh` downloads Node 24 LTS into the app folder, without `sudo`.
- **OpenCode V2** (`opencode2`), started at least once, so that the shared service writes `~/.local/state/opencode/service.json`. Checked on OpenCode v2.0.26.
- macOS for the installation as a service (launchd). Manual start on Linux too.
- Access to the repository, which is private: from the browser with your GitHub account, or with the authenticated [GitHub CLI](https://cli.github.com) (`gh auth login`).

OpenCode V1 (`opencode`) is not supported: it has a different server API.

## Installation

On macOS the lens runs as a launchd service from `~/Applications/opencode-lens`. Everything stays in your user folder, without `sudo` or administrator permissions: it is fine on a company Mac too.

1. From the [release page](https://github.com/vale76p/opencode-lens-public/releases) download `opencode-lens-<version>.zip`, or “Source code (zip)”: both work.
2. Double-click the zip in the Downloads folder (Safari usually extracts it by itself).
3. Open the Terminal and run the `install.sh` of the extracted folder. It is a single command: type `bash `, drag `install.sh` into the window and press Enter. Or:

   ```bash
   bash ~/Downloads/opencode-lens*/install.sh
   ```

   If there are several versions in Downloads, the command stops: name the right folder, that is `opencode-lens` for the release zip or `opencode-lens-opencode-lens-v<version>` for the Source code.

To see first what is already installed (service, version, database, old copies, Homebrew) without changing anything: `bash …/install.sh --check`.

`install.sh`:

- saves a copy of the database and of the plist in `~/Library/Application Support/opencode-lens/backup/` (it keeps the last three);
- copies into `~/Applications/opencode-lens` only the files needed to run the lens (no tests or development files, except the module test kit in `test/`, to try your own modules: see [docs/en/moduli.md](docs/en/moduli.md#trying-a-module)) and removes the download quarantine;
- uses the Node ≥ 22.13 in the `PATH`; if there is none, or it is older, it downloads Node 24 LTS from nodejs.org into `~/Applications/opencode-lens/node`, checking its checksum. If nodejs.org is not reachable (company proxy), point to an internal mirror with `LENS_NODE_MIRROR=https://…/dist bash …/install.sh`;
- installs the service with `opencode-lens service install`, which starts right away and at every login, and waits for it to answer. For another port: `LENS_PORT=4800 bash …/install.sh`;
- if the service was starting from another folder extracted from a zip, it moves it to the Trash. A clone stays where it is; for Homebrew it prints the commands to remove it.

Database, dashboard layout and service variables are never touched. To switch from a version installed in another way (zip in another folder, Homebrew, clone), and to restore a copy, see [docs/en/aggiornamento.md](docs/en/aggiornamento.md).

Dashboard at `http://127.0.0.1:4777`. The app is in `~/Applications/opencode-lens`, the service in `~/Library/LaunchAgents/local.opencode-lens.plist`, database and dashboard layout in `~/Library/Application Support/opencode-lens/`, logs in `~/Library/Logs/opencode-lens/lens.log`. The downloaded zip and the extracted folder can be deleted.

**Update**: the same steps with the new zip. `install.sh` replaces the app and keeps the Node already downloaded, the database and the service variables (budgets, `LENS_TOKEN`, port). Since 0.17.0 the same can be done from the dashboard: **Settings › Update**, you upload the zip and the lens runs its `install.sh` (see [docs/en/aggiornamento.md](docs/en/aggiornamento.md#from-the-dashboard)).

With the GitHub CLI steps 1-3 become:

```bash
D="$(mktemp -d)" && gh release download -R vale76p/opencode-lens-public -p 'opencode-lens-[0-9]*.zip' -D "$D" && unzip -q "$D"/opencode-lens-[0-9]*.zip -d "$D" && bash "$D"/opencode-lens/install.sh
```

Without a tag `gh release download` downloads the latest release.

The lens command is `opencode-lens`, the name its messages and this documentation also use; to have it in the shell add to `~/.zshrc`:

```bash
alias opencode-lens='node ~/Applications/opencode-lens/src/main.js'
```

If `install.sh` downloaded Node, use `~/Applications/opencode-lens/node/bin/node` instead of `node`.

Service management:

```bash
opencode-lens service status               # loaded? answering? paths
opencode-lens service install --port 4800  # change port (the other variables stay)
opencode-lens service stop | start | restart
opencode-lens service open                 # opens the dashboard in the browser, with the token
opencode-lens service uninstall [--purge]  # with --purge also database, layout and logs
```

To give Lens to OpenCode models as an MCP server: `opencode-lens mcp install` prints the `opencode2 mcp add …` line to run ([details](docs/en/configurazione.md#mcp-server-for-opencode)).

`service install` checks the Node version and that the port is free, tries the connection to OpenCode (if it is not running, fine: the lens connects when it starts), writes the plist and waits for `/healthz` to answer. Run again on an existing installation it keeps its `EnvironmentVariables`, such as budgets and `LENS_TOKEN`, and changes the port only with `--port`. If Node comes from Homebrew, the plist holds its stable path (`/opt/homebrew/opt/node/…`), which stays valid after every Node update.

To really remove everything (browser data and integrations too) follow [docs/en/disinstallazione.md](docs/en/disinstallazione.md). The **Settings** page of the dashboard shows the same commands already filled in with your paths.

## From a clone (development)

```bash
git clone https://github.com/vale76p/opencode-lens-public.git opencode-lens && cd opencode-lens
npm run check     # checks that it finds the OpenCode service
npm start         # collector + dashboard at http://127.0.0.1:4777
npm run resync    # rereads all sessions from scratch, then stays active
npm run verify    # compares the DB with OpenCode's totals, session by session (-v for the detail)
node src/main.js --help
```

As a service from the clone: `node src/main.js service install` (or `./install.sh`, which inside a clone copies nothing and uses the Node in the `PATH`; with `LENS_PORT=4800 ./install.sh` for the port; `./uninstall.sh [--purge]` to remove it). They are the same command: the plist points to the clone folder. If you use a version manager (nvm, fnm, volta, asdf) and change Node version, run it again.

To switch from a clone to the zip, or the other way round, `service install` from the new folder is enough: it rewrites the plist and keeps variables, database and layout.

## Documentation

| Document | Content |
|---|---|
| [docs/en/dashboard.md](docs/en/dashboard.md) | customizable dashboard: sidebar, views and pages, editing, keyboard, widget settings, catalog, styles, Gallery, where it is saved and how to go back to an older lens |
| [docs/en/sicurezza.md](docs/en/sicurezza.md) | Security page: OpenCode's DLP guards, how Lens finds them (a `<name>.audit.jsonl` is enough), health, what is visible over the network, the `security` MCP tool (from the Security module) and the `/metrics` series |
| [docs/en/architettura.md](docs/en/architettura.md) | discovery, live flow + backfill, idempotency, dashboard styles and models, components |
| [docs/en/metriche.md](docs/en/metriche.md) | meaning of the numbers, local API, `/metrics` and Prometheus |
| [docs/en/configurazione.md](docs/en/configurazione.md) | environment variables, prices of local models, MCP server for OpenCode, remote access, security and privacy |
| [docs/en/aggiornamento.md](docs/en/aggiornamento.md) | switching from previous versions (zip, Homebrew, clone): check, cleanup, database copies |
| [docs/en/troubleshooting.md](docs/en/troubleshooting.md) | common problems and known limits of the beta |
| [docs/en/disinstallazione.md](docs/en/disinstallazione.md) | what the lens writes and how to remove it completely |
| [docs/en/app-macos.md](docs/en/app-macos.md) | optional macOS app: the dashboard in a native window with Dock, notifications and launch at login; build, installation, uninstall |
| [docs/en/moduli.md](docs/en/moduli.md) | the modules (Vibe Coding, System, Security, IBM Bob, Skill) and your own: turning them on, states, API and the full contract of a module |
| [docs/en/moduli-custom.md](docs/en/moduli-custom.md) | writing a module of your own, step by step (the guide the `lens_module_guide` MCP tool gives): folder, manifest, routes, page, widgets, verification, typical mistakes |
| [docs/en/traduzioni.md](docs/en/traduzioni.md) | languages (Italian, English, French), how texts are added and changed, glossary |
| [CHANGELOG.en.md](CHANGELOG.en.md) | versions (also in the **What's new** page of the dashboard); Italian original in [CHANGELOG.md](CHANGELOG.md), French in [CHANGELOG.fr.md](CHANGELOG.fr.md) |

The rest of the documentation exists in [Italian](docs/) (the original), [English](docs/en/) and [French](docs/fr/), with the same file names.

## Structure

```
opencode-lens/
├── src/                  # collector, SQLite store, queries, HTTP server, MCP server, about/changelog
├── public/               # dashboard in ES modules without build: sidebar, widget grid, chart models, editor, Gallery, Settings, What's new, language catalogs
├── docs/                 # documentation (Italian; en/ and fr/ translated)
├── test/                 # node:test tests, with a fake OpenCode service
├── extras/
│   ├── opencode/         # OpenCode plugin lens-guard
│   ├── macos/            # optional macOS app (Swift, built with app.sh)
│   └── module-template/  # example module to copy when writing your own (docs/en/moduli-custom.md)
├── scripts/
│   ├── package.sh        # tests + dist/opencode-lens-<version>.zip
│   ├── changelog.mjs     # version/changelog/tag consistency, release notes
│   └── verify.mjs        # reconciliation with OpenCode's totals
├── dist/                 # package created by npm run package (not committed)
├── install.sh            # from a clone: opencode-lens service install
├── uninstall.sh          # from a clone: opencode-lens service uninstall
├── CHANGELOG.md          # with CHANGELOG.en.md and CHANGELOG.fr.md
└── package.json
```

## Development

```bash
npm test                  # node:test, no dependencies
npm run test:integration  # against a real opencode2 (skipped if absent)
npm run lint              # Biome via npx, no dependency in the project
npm run test:macos        # really builds the optional macOS app (macOS only, skipped without the Command Line Tools)
npm run package           # tests + dist/opencode-lens-<version>.zip, checked by extracting it
```

The tests run against a fake OpenCode service (a local HTTP server with a temporary `service.json`, Basic auth, SSE stream and cursor pagination) and check that *Σ steps + Σ internal tasks* matches the session totals. The `.github/workflows/opencode-lens.yml` workflow runs them with Node 22 on every push to `main` and every pull request (except those touching only the files of the release-please release PR: manifest, `CHANGELOG.md`, `README.md`, `package.json`), together with lint and `npm run changelog:check`.

`npm run test:integration` starts a real `opencode2 serve` in temporary folders (its own HOME and XDG, no credentials) with a fake OpenAI-compatible model: the tools really run (`read`, `shell` with a `git commit`, a permission asked and answered) and the test checks that steps, costs, runs, prompts, commits and permissions recorded by the lens match OpenCode. It does not run in CI because it requires `opencode2`: run it before a release and after every OpenCode update (`OPENCODE_BIN` for a different binary).

`npm run test:macos` really builds and signs the optional macOS app in `extras/macos/` without starting it; it is skipped off macOS or without the Command Line Tools. CI runs only its static checks, inside `npm test`. See [docs/en/app-macos.md](docs/en/app-macos.md#development).

## Versions and releases

[SemVer](https://semver.org/) versions with a single source: `version` in `package.json`. From there `--version`, `/api/status`, `/api/about`, the `opencode_lens_build_info` metric and the dashboard (next to the title and in the **What's new** page) read it.

| Changes | When |
|---|---|
| *major* | local API, database schema or installation incompatible with the previous version |
| *minor* | new compatible features |
| *patch* | fixes |

Releases are prepared by [release-please](https://github.com/googleapis/release-please) from the [conventional commits](https://www.conventionalcommits.org/) on `main`:

| Commit | Changelog section | Version |
|---|---|---|
| `feat(opencode-lens): …` | Added | *minor* |
| `fix(opencode-lens): …` | Fixed | *patch* |
| `perf:` / `refactor:` | Changed | *patch* |
| `docs:` | Documentation | *patch* |
| `!` after the type, or `BREAKING CHANGE:` in the body | | *major* |
| `test:`, `ci:`, `build:`, `chore:` | do not appear | |

(The changelog sections are written in Italian in `CHANGELOG.md`: Aggiunto, Corretto, Modificato, Documentazione.)

At every push to `main` the `.github/workflows/release-please.yml` workflow keeps a “chore(main): release opencode-lens X.Y.Z” PR up to date with the version in `package.json`, the new entry in `CHANGELOG.md` and `.release-please-manifest.json`. The entries can be polished by hand in the PR before the merge, and in the same PR the translations of the new version are added to `CHANGELOG.en.md` and `CHANGELOG.fr.md` (if they are missing, the **What's new** page shows that version in Italian; `npm run changelog:check` reports them). On merge release-please creates the tag `opencode-lens-vX.Y.Z` and the GitHub release; the second job checks tag and changelog (`npm run changelog:check`), reruns tests and package and attaches the app zip, `opencode-lens-X.Y.Z.zip`.

To install the lens you use the app zip or the “Source code” GitHub adds to every release, and `install.sh` installs from both in the same way:

| Zip | Extracted folder | Content |
|---|---|---|
| `opencode-lens-X.Y.Z.zip` (attached by the workflow) | `opencode-lens/` | only the files needed to run the lens, tested by the job that builds the package |
| “Source code (zip)” (generated by GitHub on the tag) | `opencode-lens-opencode-lens-vX.Y.Z/` | the whole repository, tests and development files included; `install.sh` copies only what is needed |

To try `main` before a release the branch's “Download ZIP” (`opencode-lens-main/`) also works: the version shown stays that of the last release until release-please updates it.

The installation is part of the compatibility. The `local.opencode-lens` service, plist, data folder (`~/Library/Application Support/opencode-lens`) and logs have never changed path since 0.1.0, and `install.sh` updates from any previous version ([docs/en/aggiornamento.md](docs/en/aggiornamento.md)). Changing one of these paths, or requiring a manual step to update, is a *major* change.

Before merging a release PR: `npm run test:integration` and `npm run test:macos` locally and, from an extracted zip, `bash install.sh --check` to see that it recognizes the existing installation. The release-please PR, created with the Actions token, does not start the CI by itself; the tests run anyway in the job that builds the zip, after the tag.

The workflow needs “Allow GitHub Actions to create and approve pull requests” in the repository's *Settings → Actions → General → Workflow permissions*.
