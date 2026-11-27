# Disinstallazione completa

🌐 Italiano · [English](en/disinstallazione.md) · [Français](fr/disinstallazione.md)

Questa guida elimina **ogni traccia** di opencode-lens dal Mac: servizio launchd, database, log, cartella dell'app e dati salvati dal browser. Vale per le installazioni da uno zip (`install.sh`) o da un clone (`service install` o `install.sh`) e per l'avvio manuale con `npm start`.

La lens non tocca OpenCode: non modifica la sua config, le sessioni né `service.json` (lo legge soltanto). Non installa pacchetti npm globali, non scrive in `PATH`, non usa `sudo`. Il Node che `install.sh` scarica quando manca sta dentro la cartella dell'app. Quello che segue è tutto ciò che c'è da togliere. I file dei moduli (oggi quelli di Vibe Coding) stanno nella cartella dei dati, e compaiono nell'elenco dei file e nello script di disinstallazione di Impostazioni anche a modulo spento. I percorsi che un modulo **legge soltanto** (le cartelle dei guard di Security, `kind: "read"`) non sono nello script e la lens non li tocca mai: nemmeno la disinstallazione li cancella.

I percorsi esatti della tua installazione sono nella pagina **Impostazioni** della dashboard (`http://127.0.0.1:4777/#impostazioni`), che mostra anche questi comandi già compilati. Aprila e annotali **prima** di cominciare: dopo il passo 1 la dashboard non risponde più.

## Cosa scrive la lens

| Cosa | Percorso di default | Creato da |
|---|---|---|
| LaunchAgent | `~/Library/LaunchAgents/local.opencode-lens.plist` | `service install` (anche tramite `install.sh`) |
| Database SQLite | `~/Library/Application Support/opencode-lens/lens.db` | la lens, al primo avvio |
| File WAL del database | `lens.db-wal`, `lens.db-shm` nella stessa cartella | SQLite, mentre la lens gira |
| Disposizione della dashboard | `dashboard-v2.json` nella stessa cartella (e `dashboard.json`, se viene da una versione precedente) | la lens, quando salvi «Personalizza dashboard» (solo `dashboard-v2.json`; al primo salvataggio con stili o impostazioni nuove copia anche `dashboard-v2.prev.json`, la disposizione di prima, vedi [dashboard.md](dashboard.md#tornare-a-una-lens-più-vecchia)) |
| Preset della dashboard | `dashboard-presets.json` nella stessa cartella (e `dashboard-presets.bad.json`, la copia di un file non leggibile) | la lens, quando salvi un preset dal menu «Modello» |
| Libreria delle skill | `skills/` nella stessa cartella (`skills/<id>/<n>/`, una cartella per versione) e `skills.json`, l'indice (e `skills.bad.json`, la copia di un file non leggibile) | il modulo Skill, quando importi una skill dalla pagina **Skill** (con il modulo spento non viene riscritta; `skills/` è una cartella, per questo lo script usa `rm -rf`) |
| Preset di skill | `skill-presets.json` nella stessa cartella (e `skill-presets.bad.json`, la copia di un file non leggibile) | il modulo Skill, quando salvi un preset da «Gestisci preset…» |
| Progetti di Vibe Coding | `vibe-projects.json` nella stessa cartella (e `vibe-projects.bad.json`, la copia di un file non leggibile) | il modulo Vibe Coding, quando crei o modifichi un progetto |
| Uso delle skill | la tabella `skill_uses` dentro `lens.db` | la lens, anche a Skill spento (i caricamenti che OpenCode fa da sé); il MCP con Skill acceso. Non è di Skill: resta a modulo spento e se ne va con il database |
| Tabelle dei moduli | tabelle `<id>_…` dentro `lens.db` (per IBM Bob `bob_tasks`, `bob_requests`, `bob_tools`), create anche a modulo spento | i moduli con `tables`, vedi [moduli.md](moduli.md#le-tabelle-di-un-modulo). Spegnere un modulo non le cancella: spariscono con il database. Il `bob.db` di IBM Bob non è della lens e non si tocca |
| File di altri moduli | quelli che un modulo dichiara con `files()`, sempre dentro la cartella dei dati | il modulo, vedi [moduli.md](moduli.md#lentrata-node) |
| I tuoi moduli | `modules/` nella stessa cartella: una sottocartella per modulo | tu, vedi [moduli.md](moduli.md#i-moduli-dellutente). Sopravvivono agli aggiornamenti; `uninstall.sh` senza `--purge` non li tocca e, se la cartella esiste, ne dice il percorso |
| Copie di sicurezza | `backup/` nella stessa cartella: database e plist | `install.sh`, prima di ogni installazione |
| Aggiornamenti | `update/` nella stessa cartella: lo zip caricato ed estratto finché non lo installi, il log dell'ultimo aggiornamento | la lens, da **Impostazioni › Aggiornamento** |
| Log | `~/Library/Logs/opencode-lens/lens.log` | launchd (stdout e stderr della lens) |
| Cartella dell'app | `~/Applications/opencode-lens` per l'installazione da zip, con `node/` se Node l'ha scaricato `install.sh`; oppure dove hai clonato il repository | `install.sh`, o tu |
| Preferenze della dashboard | `localStorage` del browser, chiavi `lens:*`, origine `http://127.0.0.1:4777` | la dashboard |
| Cookie `lens_token` | browser, solo se usi `LENS_TOKEN` | la lens |

Su Linux (avvio manuale) il database sta in `$XDG_DATA_HOME/opencode-lens/lens.db`, cioè `~/.local/share/opencode-lens/lens.db`; non ci sono LaunchAgent né file di log (la lens scrive sul terminale). Con `LENS_DB` impostata il database è dove dice la variabile.

## 1. Annota la cartella dell'app

Il LaunchAgent sa da quale cartella parte la lens. Leggila prima di eliminarlo:

```bash
plutil -extract WorkingDirectory raw ~/Library/LaunchAgents/local.opencode-lens.plist
```

Se hai cambiato `LENS_DB` a mano nel plist, leggi anche quella:

```bash
plutil -extract EnvironmentVariables.LENS_DB raw ~/Library/LaunchAgents/local.opencode-lens.plist
```

(«Could not extract value» vuol dire che non è impostata: vale il percorso di default.)

## 2. Ferma e rimuovi il servizio, il database e i log

```bash
bash ~/Applications/opencode-lens/uninstall.sh --purge
```

Usa il Node del `PATH` o, se manca, quello scaricato da `install.sh`. Da un clone, dalla sua cartella: `./uninstall.sh --purge` (è lo stesso comando).

Se il comando non c'è più, gli stessi passi a mano:

```bash
launchctl bootout "gui/$(id -u)/local.opencode-lens"
rm -f ~/Library/LaunchAgents/local.opencode-lens.plist
rm -rf ~/Library/Application\ Support/opencode-lens ~/Library/Logs/opencode-lens
```

`--purge` elimina solo i percorsi di default (e con essi la cartella `modules/` dei tuoi moduli, se sta nella cartella dei dati). Le righe sui tuoi moduli compaiono solo se la cartella `modules/` esiste. Senza `--purge` lo script stampa `I tuoi moduli restano in: <cartella>`. Con `--purge`, se la cartella stava nella cartella dei dati, la riga finale diventa «Database, dati dei moduli, i tuoi moduli, disposizione della dashboard e log eliminati.»; se sta fuori (con `LENS_DB`) `--purge` non la tocca, la riga finale non nomina i tuoi moduli e lo script stampa `I tuoi moduli restano in: <cartella>`. Se usavi `LENS_DB`, cancella anche quel file con i suoi compagni WAL:

```bash
rm -f /percorso/lens.db /percorso/lens.db-wal /percorso/lens.db-shm /percorso/dashboard-v2.json /percorso/dashboard-v2.prev.json /percorso/dashboard.json /percorso/dashboard-presets.json /percorso/dashboard-presets.bad.json /percorso/skills.json /percorso/skills.bad.json /percorso/skill-presets.json /percorso/skill-presets.bad.json /percorso/vibe-projects.json /percorso/vibe-projects.bad.json
rm -rf /percorso/update /percorso/skills /percorso/modules
```

Se la lens girava a mano (`npm start` in un terminale), fermala con Ctrl-C prima di cancellare il database.

## 3. Elimina l'app

Se hai installato l'app macOS facoltativa ([app-macos.md](app-macos.md)), toglila prima di cancellare la cartella della lens, perché lo script sta lì dentro:

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh uninstall
```

Toglie `~/Applications/OpenCode Lens.app`, il suo elemento di login, la cache di build, i dati WebKit e le preferenze dell'app ([dettagli](app-macos.md#disinstallazione)). Senza l'app installata non fa danni.

È la cartella annotata al passo 1. Se è `~/Applications/opencode-lens`, cancellala: dentro c'è anche l'eventuale Node scaricato da `install.sh`. Se è un clone del repository, puoi cancellarlo o tenerlo: senza LaunchAgent non parte da solo.

## 4. Pulisci il browser

La dashboard salva periodo, raggruppamento, metrica, tema, dimensione dei widget (`lens:size`), l'ultima versione vista (`lens:seenVersion`), «Mostra gli id dei modelli» (`lens:show-style-ids`) nel `localStorage` di `http://127.0.0.1:4777` (chiavi che iniziano con `lens:`). Con `LENS_TOKEN` c'è anche il cookie `lens_token`.

- **Chrome / Edge / Arc**: apri `http://127.0.0.1:4777`, icona a sinistra dell'indirizzo → *Impostazioni sito* → *Elimina dati*. Funziona anche a lens già spenta.
- **Safari**: *Impostazioni* → *Privacy* → *Gestisci dati siti web*, cerca `127.0.0.1` e rimuovi.
- **Firefox**: *Impostazioni* → *Privacy e sicurezza* → *Cookie e dati dei siti* → *Gestisci dati*, cerca `127.0.0.1`.

Se avevi cambiato porta (`LENS_PORT`), l'origine è `http://127.0.0.1:<porta>`.

## 5. Integrazioni esterne

Se avevi collegato `/metrics` a Prometheus, Grafana o altro, togli il job di scrape (il target `127.0.0.1:4777`) e le dashboard collegate. Se usavi l'export OTLP (`LENS_OTLP_ENDPOINT`), le metriche e le tracce già inviate restano nel collector o nel servizio di destinazione: si eliminano da lì, secondo la sua retention. Se usavi `LENS_TOKEN`, il token non serve più: eliminalo dal gestore di password o dalla config di Prometheus.

## 6. Verifica

Ogni riga deve stampare `ok`:

```bash
launchctl print "gui/$(id -u)/local.opencode-lens" >/dev/null 2>&1 && echo "servizio ancora registrato" || echo "ok: servizio"
lsof -nP -iTCP:4777 -sTCP:LISTEN >/dev/null && echo "porta 4777 ancora in ascolto" || echo "ok: porta"
pgrep -f opencode-lens/src/main.js >/dev/null && echo "processo ancora attivo" || echo "ok: processo"
for p in ~/Library/LaunchAgents/local.opencode-lens.plist ~/Library/Application\ Support/opencode-lens ~/Library/Logs/opencode-lens; do
  [ -e "$p" ] && echo "esiste ancora: $p" || echo "ok: $p"
done
```

OpenCode continua a funzionare come prima: la lens era un client in sola lettura del suo servizio (la sola scrittura nuova è l'MCP di Lens che riporta alla lens le consegne dei preset, non a OpenCode).
