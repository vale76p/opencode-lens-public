# Troubleshooting

🌐 [Italiano](../troubleshooting.md) · English · [Français](../fr/troubleshooting.md)

## Common problems

First of all open the **Settings** page (`http://127.0.0.1:4777/#impostazioni`): it shows version, database and log paths, variables in use and the OpenCode status.

- **"servizio non registrato"** (service not registered): OpenCode V2 has never started, so `service.json` does not exist. Run `opencode2` once, or `opencode2 service start`. The expected path is printed by `npm run check`.
- **Empty dashboard with the service active**: run `npm run check` and see how many sessions it sees. Then `npm run resync` rebuilds everything from scratch.
- **Numbers not aligned**: run `npm run verify` with sessions idle. If it reports differences, `npm run resync` fixes them. A step in progress during the verify is always `BAD`. With the retention on the verify also counts the pruned steps, and the resync does not bring them back.
- **"401 dal servizio"** (401 from the service) in the log: OpenCode restarted with a new password. The lens rereads `service.json` by itself at the next reconnection; if the message repeats, check that `OPENCODE_SERVICE_FILE` points to the right file.
- **`install.sh` cannot download Node** (company network, proxy): if the proxy must be specified, export `https_proxy` before running it; if nodejs.org is blocked, use an internal mirror with the same structure (`LENS_NODE_MIRROR=https://…/dist bash install.sh`), or install Node ≥ 22.13 in the `PATH` in another way and run again.
- **The service does not load on a company Mac**: some policies (MDM) block user LaunchAgents. `opencode-lens service status` says so; in that case start the lens by hand, in a terminal: `~/Applications/opencode-lens/node/bin/node ~/Applications/opencode-lens/src/main.js` (or `node …` if Node is in the `PATH`).
- **The port is already used** (`opencode-lens service install`): choose another with `opencode-lens service install --port 4800`.
- **After extracting the new zip the dashboard still shows the old version**: the lens restarts by itself within a minute. If it does not, `opencode-lens service status` and the log (`aggiornata alla …: riavvio`, the lens's own Italian message); `opencode-lens service restart` restarts it right away.
- **The launchd service does not answer**: look at the log with `tail -f ~/Library/Logs/opencode-lens/lens.log` (past 10 MB, `opencode-lens service install`, which every update runs, shortens it to the last MB). The state is seen with `opencode-lens service status` (or `launchctl print gui/$(id -u)/local.opencode-lens`).
- **Node changed** (nvm, fnm, volta, asdf, installation from a clone): the LaunchAgent uses the Node path found at installation. Run `opencode-lens service install` (or `./install.sh`) again. With Homebrew's Node it is not needed: the plist uses the stable path `/opt/homebrew/opt/node`. Nor with the Node downloaded by `install.sh` in `~/Applications/opencode-lens/node`, which does not change with updates.
- **"host non consentito" (403)** (host not allowed): you are opening the dashboard with a name different from `127.0.0.1`/`localhost`. Add it to `LENS_ALLOWED_HOSTS`, port included.
- **The lens does not start with `LENS_HOST=0.0.0.0`**: `LENS_TOKEN` is missing or shorter than 16 characters. See [configurazione.md](configurazione.md#remote-exposure).

- **OTLP export failed**: the exact error is in the Settings page and in the log. `HTTP 401/403`: check `LENS_OTLP_HEADERS`. `HTTP 404`: the endpoint is the base URL, without `/v1/metrics`. `HTTP 415`: the collector does not accept OTLP in JSON. Spans not sent restart at the next attempt.
- **Update from the dashboard failed**: the **Settings › Update** section shows the state and the last lines of `install.sh` (all in `update/last.log`, next to the database). If `install.sh` stops before restarting, the lens stays the one it was. If the page says the lens does not answer after two minutes, run `bash ~/Applications/opencode-lens/install.sh` from the terminal. “Install” is off with the reason next to it when the lens was not started by launchd, runs from a clone or from another folder, or has plist variables to apply.
- **The dashboard only shows “opencode-lens non è partita: …”** (opencode-lens did not start): the lens cannot open the database and stays up with this page (and `/healthz` answers 503) instead of restarting over and over. The most common case is a database written by a newer version, after going back to an old one: reinstall the newer version, the lens restarts by itself. It happens for example when going back to 0.36 or earlier after a version with schema v6: to use it you need the safety copy made before the update (see [aggiornamento.md](aggiornamento.md#restoring-a-safety-copy)). In the other cases (damaged or unreadable file) the reason is on the page, visible from this computer, and in the log.
- **The lens does not start after the update** with “Configurazione non valida” (invalid configuration): a variable has a value out of range or badly written; the message lists them all.
- **The dashboard went back to the default layout**: `dashboard-v2.json` (or, if it is missing or not valid, the old `dashboard.json`, which is migrated) is not valid JSON or describes widgets outside the grid or overlapping, usually after a hand edit. The log says what is wrong (`grep 'dashboard' ~/Library/Logs/opencode-lens/lens.log`). Fix the file, or compose the layout again and save it: saving replaces it.
- **The “Customize dashboard” button is missing**: the dashboard is open from another computer (changes can be made only from the one where the lens runs) or the window is narrower than 700 px. See [dashboard.md](dashboard.md#when-the-button-is-missing).

## Known limits (OpenCode 2.0 is in beta)

- **Moving API.** At every event the lens checks that the fields it relies on exist. If they are missing it shows a warning (“the API changed”) and also reports it in `/metrics` (`opencode_lens_api_drift_events`) and in `/api/status` (`drift` field, with the missing fields and an example event). The backfill from messages keeps working even when live events change shape.
- **Endpoints documented but absent in OpenCode v2.0.26.** I do not use them:
  - `/api/info` answers 404 (I use `/api/health`);
  - `/api/experimental/session/stats` answers 404;
  - `/api/experimental/session/{id}/log` returns only `log.synced`.
- **Internal tasks**: the date is that of the synchronization, not the exact instant of the call.
- **Private servers**: the sessions of a `--standalone` do not go through the shared service. To see them `OPENCODE_SERVER_URL` is needed.
- **V1** (`opencode`) is not supported: it has a different server API.
- **Permissions only live**: OpenCode keeps only the pending requests, so those made with the lens off cannot be recovered.
- **Runs “without outcome”**: sessions before mid-October 2026 have no `idle` messages; their runs are inferred and have no outcome.
- **Prompt delivery** (`steer`/`queue`): known only for prompts seen live.
- **Very large database** (measured): above about 250,000 steps the “All” range takes more than 1 second, up to about 5 seconds with about 1 million steps (`/api/breakdown` reads everything in JavaScript and blocks the event loop: `/healthz` too can answer up to 6 seconds late). Memory (RSS) reaches about 1.3 GB with 1 million steps. `LENS_RETENTION_DAYS` keeps the database smaller.
- **Growing WAL**: if an external tool (for example `sqlite3`) holds a read transaction open, the `-wal` file cannot be reset and grows. It is now limited by `journal_size_limit` (64 MiB) and the lens runs a `TRUNCATE` checkpoint every 10 minutes; still, close the tool when you are done.
- **Full disk**: live events are lost, but the backfill repairs the history as soon as space is free again.
