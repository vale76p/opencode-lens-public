# Updating from a previous version

🌐 [Italiano](../aggiornamento.md) · English · [Français](../fr/aggiornamento.md)

This guide is for switching to `install.sh` (from 0.12.0) starting from a lens installed in another way. It explains how to find out what is on the Mac, what `install.sh` does by itself and what can be removed by hand without losing the database, settings and dashboard layout.

## What does not change between versions

Since 0.1.0 the lens has always used the same paths. A new installation finds and reuses them:

| What | Path | Keep it |
|---|---|---|
| Service (LaunchAgent) | `~/Library/LaunchAgents/local.opencode-lens.plist` | yes: the `EnvironmentVariables` hold port, budgets, `LENS_TOKEN` and the other settings |
| Database | `~/Library/Application Support/opencode-lens/lens.db`, with `lens.db-wal` and `lens.db-shm` | yes |
| Dashboard layout | `dashboard-v2.json` in the same folder (v1 stays in `dashboard.json`; `dashboard-v2.prev.json` is the copy from before the new styles) | yes |
| Dashboard presets | `dashboard-presets.json` in the same folder | yes |
| `install.sh` safety copies | `backup/` in the same folder | yes, until you are sure everything is fine |
| Logs | `~/Library/Logs/opencode-lens/lens.log` | optional |

If the plist has `LENS_DB`, the database is at that path and not at the default one.

Between one version and the next only **where the app starts from** changes:

| Installation | App folder | Versions |
|---|---|---|
| extracted zip and `./install.sh` from its folder | where you extracted the zip, for example `~/Downloads/opencode-lens` | 0.1.0–0.6.x |
| Homebrew (`brew install vale76p/tap/opencode-lens`) | `/opt/homebrew/Cellar/opencode-lens/…` | 0.7.0–0.10.0 |
| release zip extracted in `~/Applications` | `~/Applications/opencode-lens` | 0.11.x |
| repository clone | the clone folder | all |
| `install.sh` from 0.12.0 | `~/Applications/opencode-lens`, with `node/` if it downloaded Node | 0.12.0 → |

## 1. Check what is installed

Extract the new zip and run `install.sh` with `--check`. It shows the situation and **changes nothing**:

```bash
bash ~/Downloads/opencode-lens/install.sh --check
```

```text
Versione da installare: 0.12.0 (/Users/tu/Downloads/opencode-lens)
Servizio: /Users/tu/Library/LaunchAgents/local.opencode-lens.plist
  app: /Users/tu/Downloads/opencode-lens-0.6.0 (0.6.0)
  node: /opt/homebrew/opt/node/bin/node
Database: /Users/tu/Library/Application Support/opencode-lens/lens.db (4.1M)
Altra copia, non usata dal servizio: /Users/tu/Desktop/opencode-lens (0.2.0)
Homebrew: formula opencode-lens in /opt/homebrew/Cellar
```

(The script's messages are in Italian: “Versione da installare” = version to install, “Servizio” = service, “Altra copia, non usata dal servizio” = other copy, not used by the service.)

- **app** is the folder the service starts from now, with its version.
- **Altra copia** (other copy) is an opencode-lens folder found in Downloads, Desktop, Documents or `~/Applications`, which the service does not use.
- **Homebrew** says that the formula or the tap are still there.

Without the new zip, the same checks can be done by hand:

```bash
plutil -extract WorkingDirectory raw ~/Library/LaunchAgents/local.opencode-lens.plist     # app folder
plutil -extract ProgramArguments.0 raw ~/Library/LaunchAgents/local.opencode-lens.plist   # Node in use
plutil -extract EnvironmentVariables.LENS_DB raw ~/Library/LaunchAgents/local.opencode-lens.plist  # «Could not extract» = database at the default path
find ~/Downloads ~/Desktop ~/Documents ~/Applications -maxdepth 3 -name package.json -path '*opencode-lens*' -exec grep -l '"name": *"opencode-lens"' {} \;
ls /opt/homebrew/Cellar/opencode-lens /usr/local/Cellar/opencode-lens 2>/dev/null           # Homebrew formula
pgrep -fl 'src/main.js'                                                                     # lenses started by hand
```

## 2. Install with `install.sh`

Before running it:

- if the lens runs **by hand** in a terminal (`npm start` or `node src/main.js`), stop it with Ctrl-C, otherwise the port is reported as busy;
- there is no need to stop the service: `install.sh` takes care of it.

```bash
bash ~/Downloads/opencode-lens/install.sh
```

Here is what it does, in this order:

1. It saves a copy of the database in `~/Library/Application Support/opencode-lens/backup/lens-<previous version>-<date>.db` and one of the plist next to it (permissions `600`: it holds `LENS_TOKEN`). It keeps the three most recent copies. The copy is consistent even with the lens running. If it fails, it stops before touching the app or the service.
2. It copies the app to `~/Applications/opencode-lens` and, if needed, downloads Node.
3. It reinstalls the service pointing it to the new folder. All the plist `EnvironmentVariables` stay, port included.
4. Only if the service answers, it takes care of the old installation:

| The service started from | `install.sh` |
|---|---|
| `~/Applications/opencode-lens` | replaces it, keeping `node/` |
| another folder extracted from a zip | moves it to the **Trash** (it can be put back) |
| a repository clone | leaves it where it is |
| Homebrew | leaves the formula and prints the commands to remove it |

The database, `dashboard-v2.json`, `dashboard.json`, the logs and the other copies found are not touched: the other copies are only listed.

The first start of a version with a newer database schema updates the database by itself. If the database was older than schema v5, it also rereads the sessions from OpenCode: it is normal that for a few minutes the numbers fill in. The step from v5 to v6 (after 0.36) is immediate and rereads nothing, but from then on a 0.36 or earlier lens no longer opens the database: going back needs the safety copy (see [Restoring a safety copy](#restoring-a-safety-copy)).

### From the dashboard

A lens already installed with `install.sh` (from 0.17.0) can also be updated from **Settings › Update**, without opening the terminal:

1. Download the release zip (`opencode-lens-X.Y.Z.zip`) from the [releases page](https://github.com/vale76p/opencode-lens-public/releases). If Safari extracts it by itself, compress the folder again from the Finder (right click › Compress): any name is fine. The release files are signed (`MANIFEST.json` and `MANIFEST.sig`): the lens refuses the “Source code (zip)”, zips with changed, missing or extra files, and those signed by someone else. From the terminal with `install.sh` the Source code can still be installed.
2. Choose it or drag it into the section. The lens reads it without running anything and shows the new and current version, the CHANGELOG news in between and the warnings (same version, older version, branch zip).
3. **Install and restart** runs the zip's `install.sh`, with the same steps as above: database and plist copy, app replaced, service reinstalled. The page waits for the new version and reloads.

What it checks before installing:

- **The zip:** a single folder with the opencode-lens `package.json`, `src/main.js`, `install.sh` and `public/index.html`. No `.git`, symbolic links or paths leaving the folder. At most 16 MiB, 64 MiB extracted.
- **The version:** at least 0.12.1, with the Node in use suited to that version. Going back to an older one needs explicit confirmation: the database schema may be newer, and a version without this section can no longer be updated from the dashboard.
- **The lens:** it runs as a service from `~/Applications/opencode-lens`, was started by launchd and has no plist variables still to apply. A lens running from a clone, from Homebrew or from another folder is updated from the terminal.

What stays the same and what does not compared with the terminal:

- **No network.** The lens does not look for updates and downloads nothing: you bring the zip. `install.sh` does not download Node: it uses the service's.
- **No search for copies.** `install.sh` does not look for other copies in Downloads, Desktop and Documents (`LENS_NO_SCAN=1`), so macOS does not ask for permissions.
- **Where the zip goes.** It is extracted in `update/`, next to the database, and deleted after the installation; one that is not installed disappears after 30 minutes or at restart. `update/last.log` keeps the output of the last `install.sh`, which the section shows if it did not succeed.
- **The lens and the macOS app.** When `~/Applications/OpenCode Lens.app` is there, `install.sh` rebuilds it at the same version ([app-macos.md](app-macos.md#update)). The Monitor app is updated with its own `install.sh`.

If after two minutes the page says the lens does not answer, the service did not restart: run `bash ~/Applications/opencode-lens/install.sh` from the terminal and look at `~/Library/Logs/opencode-lens/lens.log`.

### User modules from the dashboard

The same field of **Settings › Update** also takes a zip of **user modules** (see [moduli.md](moduli.md#your-own-modules)): one or more modules of yours compressed from the Finder. The lens recognizes it by its shape: at the root only folders named like an id (`my-module/`…), each with its own `module.js`, and no file. Any other zip goes the way of the lens's zip, with its errors.

1. **Preview.** The lens checks the zip like the app's (no paths leaving the folder, symbolic links, `.git`, at most 16 MiB and 64 MiB extracted) and extracts it in `update/`, **without running anything of the modules**: for each one it shows the id and whether it is **new** or **replaces the installed version** (or a symbolic link). Above them is the warning: **“Unsigned code: it runs in the lens process with your permissions. Only install modules you trust.”**, and that the modules are checked when you press **Install**.
2. **Refusals.** An id of a lens module (`sistema`, `skill`…), a lens without a modules folder (`LENS_DB=:memory:`) and an empty zip are refused at once.
3. **Check.** Press **Install** (or **Install and restart**) and confirm: only then does the lens judge each module like **Settings › Modules** and `lens_module_check`. The check runs the top-level code of each module's `module.js` and `server/index.js`, and its `configure()`: that is why it comes after the warning. If a module has errors nothing is installed: the section shows each module's name, errors and warnings, and the zip must be fixed and uploaded again.
4. **Installation.** For each module the new folder is copied next to its place and then renamed in place of the old one: never half a module. It is all or nothing: if a copy or a swap fails, the modules already replaced go back as they were, nothing is installed and the lens does not restart; the copies left by an interruption (`.staging-*`) are removed at restart. A `.backup` that is not a folder stops the install before any module is touched. The old folder goes to `<modules folder>/.backup/<id>-<date>/` (the leading dot keeps it out of the discovered modules); if it was a symbolic link, the link goes to `.backup/` and the folder it points to stays as it is. The modules' data, next to the database, is not touched.
5. **Restart.** If the lens runs as a launchd service, and the plist has no variables edited by hand and not applied yet, it restarts by itself (like **Restart the lens**) and the page reloads in the same section; otherwise the page says to restart it by hand. The modules already on stay on (`LENS_MODULES` does not change); a new module is off: turn it on from **Settings › Modules**.

This does not need the lens to run from `~/Applications/opencode-lens`: the user modules folder is enough. It is done only from this computer, with the same Origin, content-type and token rules as the other writes, and it **requires `LENS_TOKEN`**: without one the lens refuses the zip with 403 (“set LENS_TOKEN to install modules”), because it is unsigned code running in its process (installing as a service already generates one). The copies in `.backup/` stay until you remove them.

### The MCP server: restart OpenCode

The MCP server (`opencode-lens mcp`) is not part of the lens service: it is a child process of OpenCode, which starts it at launch and keeps it alive as long as it runs. An update replaces the files and restarts the lens, but the MCP already started keeps running the old code: new tools and prompts do not show up until OpenCode restarts.

Settings › MCP server points it out: every request of the MCP tells the lens its version (the `X-Lens-Mcp-Version` header) and, when it is not the lens's one, the section shows the “Restart OpenCode” notice with both versions. An MCP of a version before 0.29.0 does not send its version: the lens still recognizes it from its periodic read of the presets and marks it as “earlier version”. The notice goes away by itself after OpenCode restarts, at the first request of the new MCP (within half a minute, since the MCP rereads the presets every 30 seconds). `opencode2 reload` is not enough: it reloads the configuration, not the MCP servers.

## 3. Cleanup

When the dashboard at `http://127.0.0.1:4777` shows the new version and your data, you can remove what is no longer needed.

**Homebrew** (after `install.sh`, not before: until then the service starts from there). The formula has only the code: database and settings stay.

```bash
brew uninstall opencode-lens
brew untap vale76p/tap
```

**Other copies** listed by `--check`, **downloaded zips** and the **extracted folder** you ran `install.sh` from: they can be deleted. A clone is needed only if you work on it.

**Trash**: the old app folder (`opencode-lens-<date>`) can be emptied.

**Safety copies**: `backup/` takes as much as the database for each copy. Remove them when you are sure everything is fine:

```bash
rm -rf ~/Library/Application\ Support/opencode-lens/backup
```

### What not to do

- Do not use `service uninstall --purge` or `uninstall.sh --purge`: they delete database, layout and logs.
- Do not delete `~/Library/Application Support/opencode-lens`, nor `lens.db-wal` and `lens.db-shm` while the lens runs: they hold data not yet written to `lens.db`.
- Do not delete the plist before reinstalling: it holds your settings. If it already happened, recover the copy from `backup/` (see below).

The OpenCode Lens Monitor app keeps working unchanged: the service name and the port are the same.

## Restoring a safety copy

```bash
L=~/Applications/opencode-lens
N="$(command -v node || echo "$L/node/bin/node")"
"$N" "$L/src/main.js" service stop
cd ~/Library/Application\ Support/opencode-lens
mv lens.db lens.db.sostituito && rm -f lens.db-wal lens.db-shm
cp backup/lens-<version>-<date>.db lens.db
"$N" "$L/src/main.js" service start
```

For the service settings, put the saved plist back and reinstall. `service install` takes the variables from the plist it finds:

```bash
cp ~/Library/Application\ Support/opencode-lens/backup/local.opencode-lens-<date>.plist ~/Library/LaunchAgents/local.opencode-lens.plist
bash ~/Applications/opencode-lens/install.sh
```

To go back to a previous version, reinstall its zip and restore the copy that carries its version number. A lens that does not know the database schema does not open it: 0.36 or earlier, for example, refuse a database with schema v6 and stop with “opencode-lens non è partita” (see [troubleshooting.md](troubleshooting.md)). With the same schema the old lens opens it, but with no guarantee that the numbers add up: the copy made before the update is better anyway.

The dashboard layout needs no copy: the two-view version saves in `dashboard-v2.json` and never writes `dashboard.json`, so an older lens finds its previous layout intact (the changes made in the views, however, stay only in `dashboard-v2.json`). After the model styles an older lens discards `dashboard-v2.json` only if it holds new styles or settings, or a Today narrower than 6 columns (from this version it can go down to 4, and every `today` widget of a migrated v1 is 4 wide); then it uses `dashboard.json` or the default layout. At the first save the new lens keeps the previous copy in `dashboard-v2.prev.json`: how to go back is in [dashboard.md](dashboard.md#going-back-to-an-older-lens). If you then go back to the new version, you find the layout saved in `dashboard-v2.json`; if you had never saved it, it is derived again from `dashboard.json`.
