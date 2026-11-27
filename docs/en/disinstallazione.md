# Complete uninstall

🌐 [Italiano](../disinstallazione.md) · English · [Français](../fr/disinstallazione.md)

This guide removes **every trace** of opencode-lens from the Mac: launchd service, database, logs, app folder and data saved by the browser. It applies to installations from a zip (`install.sh`) or from a clone (`service install` or `install.sh`) and to the manual start with `npm start`.

The lens does not touch OpenCode: it does not change its config, the sessions or `service.json` (it only reads it). It installs no global npm packages, does not write to `PATH`, does not use `sudo`. The Node that `install.sh` downloads when it is missing lives inside the app folder. What follows is everything there is to remove. The modules' files (today Vibe Coding's) live in the data folder, and appear in Settings' list of files and in its uninstall script even when the module is off. The paths a module **only reads** (Security's guard folders, `kind: "read"`) are not in the script and the lens never touches them: not even the uninstall deletes them.

The exact paths of your installation are in the **Settings** page of the dashboard (`http://127.0.0.1:4777/#impostazioni`), which also shows these commands already filled in. Open it and note them down **before** you begin: after step 1 the dashboard no longer answers.

## What the lens writes

| What | Default path | Created by |
|---|---|---|
| LaunchAgent | `~/Library/LaunchAgents/local.opencode-lens.plist` | `service install` (also through `install.sh`) |
| SQLite database | `~/Library/Application Support/opencode-lens/lens.db` | the lens, at the first start |
| Database WAL files | `lens.db-wal`, `lens.db-shm` in the same folder | SQLite, while the lens runs |
| Dashboard layout | `dashboard-v2.json` in the same folder (and `dashboard.json`, if it comes from a previous version) | the lens, when you save “Customize dashboard” (only `dashboard-v2.json`; at the first save with new styles or settings it also copies `dashboard-v2.prev.json`, the previous layout, see [dashboard.md](dashboard.md#going-back-to-an-older-lens)) |
| Safety copies | `backup/` in the same folder: database and plist | `install.sh`, before every installation |
| Updates | `update/` in the same folder: the uploaded zip extracted until you install it, the log of the last update | the lens, from **Settings › Update** |
| Dashboard presets | `dashboard-presets.json` in the same folder (and `dashboard-presets.bad.json`, the copy of an unreadable file) | the lens, when you save a preset from the “Layout” menu |
| Skill library | `skills/` in the same folder (`skills/<id>/<n>/`, one folder per version) and `skills.json`, the index (and `skills.bad.json`, the copy of an unreadable file) | the Skill module, when you import a skill from the **Skill** page (with the module off it is never rewritten; `skills/` is a folder, which is why the script uses `rm -rf`) |
| Skill presets | `skill-presets.json` in the same folder (and `skill-presets.bad.json`, the copy of an unreadable file) | the Skill module, when you save a preset from “Manage presets…” |
| Vibe Coding projects | `vibe-projects.json` in the same folder (and `vibe-projects.bad.json`, the copy of an unreadable file) | the Vibe Coding module, when you create or edit a project |
| Skill usage | the `skill_uses` table inside `lens.db` | the lens, even with Skill off (the loads OpenCode makes on its own); the MCP with Skill on. It is not Skill's: it stays with the module off and goes with the database |
| Module tables | `<id>_…` tables inside `lens.db` (for IBM Bob `bob_tasks`, `bob_requests`, `bob_tools`), created even with the module off | the modules with `tables`, see [moduli.md](moduli.md#a-modules-tables). Turning a module off does not delete them: they go with the database. IBM Bob's `bob.db` is not the lens's and is left alone |
| Files of other modules | the ones a module declares with `files()`, always inside the data folder | the module, see [moduli.md](moduli.md#the-node-entry) |
| Your modules | `modules/` in the same folder: one subfolder per module | you, see [moduli.md](moduli.md#your-own-modules). They survive upgrades; `uninstall.sh` without `--purge` does not touch them and, if the folder exists, tells you its path |
| Logs | `~/Library/Logs/opencode-lens/lens.log` | launchd (stdout and stderr of the lens) |
| App folder | `~/Applications/opencode-lens` for the installation from a zip, with `node/` if `install.sh` downloaded Node; or where you cloned the repository | `install.sh`, or you |
| Dashboard preferences | browser `localStorage`, `lens:*` keys, origin `http://127.0.0.1:4777` | the dashboard |
| `lens_token` cookie | browser, only if you use `LENS_TOKEN` | the lens |

On Linux (manual start) the database is in `$XDG_DATA_HOME/opencode-lens/lens.db`, that is `~/.local/share/opencode-lens/lens.db`; there is no LaunchAgent or log file (the lens writes to the terminal). With `LENS_DB` set, the database is where the variable says.

## 1. Note the app folder

The LaunchAgent knows which folder the lens starts from. Read it before deleting it:

```bash
plutil -extract WorkingDirectory raw ~/Library/LaunchAgents/local.opencode-lens.plist
```

If you changed `LENS_DB` by hand in the plist, read that too:

```bash
plutil -extract EnvironmentVariables.LENS_DB raw ~/Library/LaunchAgents/local.opencode-lens.plist
```

(“Could not extract value” means it is not set: the default path applies.)

## 2. Stop and remove the service, the database and the logs

```bash
bash ~/Applications/opencode-lens/uninstall.sh --purge
```

It uses the Node in the `PATH` or, if missing, the one downloaded by `install.sh`. From a clone, from its folder: `./uninstall.sh --purge` (it is the same command).

If the command is no longer there, the same steps by hand:

```bash
launchctl bootout "gui/$(id -u)/local.opencode-lens"
rm -f ~/Library/LaunchAgents/local.opencode-lens.plist
rm -rf ~/Library/Application\ Support/opencode-lens ~/Library/Logs/opencode-lens
```

`--purge` deletes only the default paths (and with them the `modules/` folder of your modules, if it is inside the data folder). The lines about your modules appear only if the `modules/` folder exists. Without `--purge` the script prints `I tuoi moduli restano in: <folder>` (“your modules stay in”). With `--purge`, if the folder was inside the data folder, the closing line becomes “Database, dati dei moduli, i tuoi moduli, disposizione della dashboard e log eliminati.”; if it is outside (with `LENS_DB`) `--purge` does not touch it, the closing line does not name your modules and the script prints `I tuoi moduli restano in: <folder>` (the script's messages stay in Italian). If you used `LENS_DB`, also delete that file with its WAL companions:

```bash
rm -f /path/lens.db /path/lens.db-wal /path/lens.db-shm /path/dashboard-v2.json /path/dashboard-v2.prev.json /path/dashboard.json /path/dashboard-presets.json /path/dashboard-presets.bad.json /path/skills.json /path/skills.bad.json /path/skill-presets.json /path/skill-presets.bad.json /path/vibe-projects.json /path/vibe-projects.bad.json
rm -rf /path/update /path/skills /path/modules
```

If the lens was running by hand (`npm start` in a terminal), stop it with Ctrl-C before deleting the database.

## 3. Delete the app

If you installed the optional macOS app ([app-macos.md](app-macos.md)), remove it before deleting the lens's folder, because the script lives inside it:

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh uninstall
```

It removes `~/Applications/OpenCode Lens.app`, its login item, the build cache, the WebKit data and the app's preferences ([details](app-macos.md#uninstall)). Without the app installed it does no harm.

It is the folder noted at step 1. If it is `~/Applications/opencode-lens`, delete it: inside there is also the Node possibly downloaded by `install.sh`. If it is a repository clone, you can delete it or keep it: without a LaunchAgent it does not start by itself.

## 4. Clean the browser

The dashboard saves period, grouping, metric, theme, widget size (`lens:size`), the last version seen (`lens:seenVersion`), “Show model ids” (`lens:show-style-ids`) in the `localStorage` of `http://127.0.0.1:4777` (keys starting with `lens:`). With `LENS_TOKEN` there is also the `lens_token` cookie.

- **Chrome / Edge / Arc**: open `http://127.0.0.1:4777`, icon to the left of the address → *Site settings* → *Delete data*. It also works with the lens already off.
- **Safari**: *Settings* → *Privacy* → *Manage Website Data*, search `127.0.0.1` and remove.
- **Firefox**: *Settings* → *Privacy & Security* → *Cookies and Site Data* → *Manage Data*, search `127.0.0.1`.

If you changed the port (`LENS_PORT`), the origin is `http://127.0.0.1:<port>`.

## 5. External integrations

If you had connected `/metrics` to Prometheus, Grafana or something else, remove the scrape job (the `127.0.0.1:4777` target) and the linked dashboards. If you used the OTLP export (`LENS_OTLP_ENDPOINT`), the metrics and traces already sent stay in the collector or in the destination service: delete them from there, according to its retention. If you used `LENS_TOKEN`, the token is no longer needed: delete it from the password manager or from Prometheus' config.

## 6. Check

Every line must print `ok`:

```bash
launchctl print "gui/$(id -u)/local.opencode-lens" >/dev/null 2>&1 && echo "servizio ancora registrato" || echo "ok: servizio"
lsof -nP -iTCP:4777 -sTCP:LISTEN >/dev/null && echo "porta 4777 ancora in ascolto" || echo "ok: porta"
pgrep -f opencode-lens/src/main.js >/dev/null && echo "processo ancora attivo" || echo "ok: processo"
for p in ~/Library/LaunchAgents/local.opencode-lens.plist ~/Library/Application\ Support/opencode-lens ~/Library/Logs/opencode-lens; do
  [ -e "$p" ] && echo "esiste ancora: $p" || echo "ok: $p"
done
```

(The messages are in Italian: “servizio ancora registrato” = service still registered, “porta … ancora in ascolto” = port still listening, “processo ancora attivo” = process still running, “esiste ancora” = still exists.)

OpenCode keeps working as before: the lens was a read-only client of its service (the only new write is Lens's own MCP reporting preset deliveries to the lens, not to OpenCode).
