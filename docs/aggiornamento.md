# Aggiornare da una versione precedente

🌐 Italiano · [English](en/aggiornamento.md) · [Français](fr/aggiornamento.md)

Questa guida serve per passare a `install.sh` (dalla 0.12.0) partendo da una lens installata in un altro modo. Spiega come scoprire cosa c'è sul Mac, cosa fa da solo `install.sh` e cosa si può togliere a mano senza perdere database, impostazioni e disposizione della dashboard.

## Cosa non cambia tra le versioni

Dalla 0.1.0 in poi la lens ha sempre usato gli stessi percorsi. Un'installazione nuova li ritrova e li riusa:

| Cosa | Percorso | Da tenere |
|---|---|---|
| Servizio (LaunchAgent) | `~/Library/LaunchAgents/local.opencode-lens.plist` | sì: le `EnvironmentVariables` contengono porta, budget, `LENS_TOKEN` e le altre impostazioni |
| Database | `~/Library/Application Support/opencode-lens/lens.db`, con `lens.db-wal` e `lens.db-shm` | sì |
| Disposizione della dashboard | `dashboard-v2.json` nella stessa cartella (la v1 resta in `dashboard.json`; `dashboard-v2.prev.json` è la copia di prima degli stili nuovi) | sì |
| Preset della dashboard | `dashboard-presets.json` nella stessa cartella | sì |
| Copie di sicurezza di `install.sh` | `backup/` nella stessa cartella | sì, finché non sei sicuro che vada tutto bene |
| Log | `~/Library/Logs/opencode-lens/lens.log` | facoltativo |

Se nel plist c'è `LENS_DB`, il database è in quel percorso e non in quello di default.

Tra una versione e l'altra cambia solo **da dove parte l'app**:

| Installazione | Cartella dell'app | Versioni |
|---|---|---|
| zip estratto e `./install.sh` dalla sua cartella | dove avevi estratto lo zip, per esempio `~/Downloads/opencode-lens` | 0.1.0–0.6.x |
| Homebrew (`brew install vale76p/tap/opencode-lens`) | `/opt/homebrew/Cellar/opencode-lens/…` | 0.7.0–0.10.0 |
| zip della release estratto in `~/Applications` | `~/Applications/opencode-lens` | 0.11.x |
| clone del repository | la cartella del clone | tutte |
| `install.sh` dalla 0.12.0 | `~/Applications/opencode-lens`, con `node/` se ha scaricato Node | 0.12.0 → |

## 1. Controlla cosa c'è installato

Estrai lo zip nuovo e lancia `install.sh` con `--check`. Mostra la situazione e **non cambia niente**:

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

- **app** è la cartella da cui parte il servizio adesso, con la sua versione.
- **Altra copia** è una cartella di opencode-lens trovata in Download, Scrivania, Documenti o `~/Applications`, che il servizio non usa.
- **Homebrew** indica che sono rimasti la formula o il tap.

Senza lo zip nuovo, gli stessi controlli si fanno a mano:

```bash
plutil -extract WorkingDirectory raw ~/Library/LaunchAgents/local.opencode-lens.plist     # cartella dell'app
plutil -extract ProgramArguments.0 raw ~/Library/LaunchAgents/local.opencode-lens.plist   # Node usato
plutil -extract EnvironmentVariables.LENS_DB raw ~/Library/LaunchAgents/local.opencode-lens.plist  # «Could not extract» = database nel percorso di default
find ~/Downloads ~/Desktop ~/Documents ~/Applications -maxdepth 3 -name package.json -path '*opencode-lens*' -exec grep -l '"name": *"opencode-lens"' {} \;
ls /opt/homebrew/Cellar/opencode-lens /usr/local/Cellar/opencode-lens 2>/dev/null           # formula Homebrew
pgrep -fl 'src/main.js'                                                                     # lens avviate a mano
```

## 2. Installa con `install.sh`

Prima di lanciarlo:

- se la lens gira **a mano** in un terminale (`npm start` o `node src/main.js`), fermala con Ctrl-C, altrimenti la porta risulta occupata;
- non serve fermare il servizio: ci pensa `install.sh`.

```bash
bash ~/Downloads/opencode-lens/install.sh
```

Ecco cosa fa, in quest'ordine:

1. Salva una copia del database in `~/Library/Application Support/opencode-lens/backup/lens-<versione precedente>-<data>.db` e una del plist accanto (permessi `600`: contiene `LENS_TOKEN`). Tiene le tre copie più recenti. La copia è coerente anche con la lens in funzione. Se non riesce, si ferma prima di toccare l'app o il servizio.
2. Copia l'app in `~/Applications/opencode-lens` e, se serve, scarica Node.
3. Reinstalla il servizio puntandolo alla cartella nuova. Le `EnvironmentVariables` del plist restano tutte, porta compresa.
4. Solo se il servizio risponde, sistema la vecchia installazione:

| Il servizio partiva da | `install.sh` |
|---|---|
| `~/Applications/opencode-lens` | la sostituisce, tenendo `node/` |
| un'altra cartella estratta da uno zip | la sposta nel **Cestino** (si può rimettere a posto) |
| un clone del repository | lo lascia dove si trova |
| Homebrew | lascia la formula e stampa i comandi per toglierla |

Il database, `dashboard-v2.json`, `dashboard.json`, i log e le altre copie trovate non vengono toccati: le altre copie vengono solo elencate.

Il primo avvio di una versione con uno schema del database più nuovo aggiorna il database da solo. Se il database era più vecchio dello schema v5, rilegge anche le sessioni da OpenCode: è normale che per qualche minuto i numeri si completino. Il passaggio dalla v5 alla v6 (dopo la 0.36) è immediato e non rilegge nulla, ma da lì una lens 0.36 o precedente non apre più il database: per tornare indietro serve la copia di sicurezza (vedi [Ripristinare una copia di sicurezza](#ripristinare-una-copia-di-sicurezza)).

### Dalla dashboard

Una lens già installata con `install.sh` (dalla 0.17.0) si aggiorna anche da **Impostazioni › Aggiornamento**, senza aprire il terminale:

1. Scarica lo zip della release (`opencode-lens-X.Y.Z.zip`) dalla [pagina delle release](https://github.com/vale76p/opencode-lens-public/releases). Se Safari lo estrae da solo, comprimi di nuovo la cartella dal Finder (tasto destro › Comprimi): va bene qualunque nome. I file della release sono firmati (`MANIFEST.json` e `MANIFEST.sig`): la lens rifiuta il «Source code (zip)», gli zip con file modificati, mancanti o in più, e quelli firmati da altri. Da terminale con `install.sh` il Source code resta installabile.
2. Sceglilo o trascinalo nella sezione. La lens lo legge senza eseguire niente e mostra versione nuova e attuale, le novità del CHANGELOG nel mezzo e gli avvisi (stessa versione, versione più vecchia, zip di un branch).
3. **Installa e riavvia** lancia l'`install.sh` dello zip, con gli stessi passi di sopra: copia del database e del plist, app sostituita, servizio reinstallato. La pagina aspetta la versione nuova e si ricarica.

Cosa controlla prima di installare:

- **Lo zip:** una sola cartella con `package.json` di opencode-lens, `src/main.js`, `install.sh` e `public/index.html`. Niente `.git`, collegamenti simbolici o percorsi che escono dalla cartella. Al massimo 16 MiB, 64 MiB estratto.
- **La versione:** almeno la 0.12.1, con il Node in uso adatto a quella versione. Per tornare a una più vecchia serve la conferma esplicita: lo schema del database potrebbe essere più nuovo, e una versione senza questa sezione non si aggiorna più dalla dashboard.
- **La lens:** gira come servizio da `~/Applications/opencode-lens`, è stata avviata da launchd e non ha variabili del plist ancora da applicare. Una lens che gira da un clone, da Homebrew o da un'altra cartella si aggiorna da terminale.

Cosa resta uguale e cosa no rispetto al terminale:

- **Niente rete.** La lens non cerca aggiornamenti e non scarica niente: lo zip lo porti tu. `install.sh` non scarica Node: usa quello del servizio.
- **Niente ricerca di copie.** `install.sh` non cerca altre copie in Download, Scrivania e Documenti (`LENS_NO_SCAN=1`), così macOS non chiede permessi.
- **Dove finisce lo zip.** Viene estratto in `update/`, accanto al database, e cancellato dopo l'installazione; uno non installato sparisce dopo 30 minuti o al riavvio. In `update/last.log` resta l'output dell'ultimo `install.sh`, che la sezione mostra se non è andato a buon fine.
- **La lens e l'app macOS.** Se `~/Applications/OpenCode Lens.app` c'è, `install.sh` la ricompila alla stessa versione ([app-macos.md](app-macos.md#aggiornamento)). L'app Monitor si aggiorna con il suo `install.sh`.

Se la pagina dopo due minuti dice che la lens non risponde, il servizio non è ripartito: lancia `bash ~/Applications/opencode-lens/install.sh` da terminale e guarda `~/Library/Logs/opencode-lens/lens.log`.

### I moduli dell'utente dalla dashboard

Lo stesso campo di **Impostazioni › Aggiornamento** accetta anche uno zip di **moduli dell'utente** (vedi [moduli.md](moduli.md#i-moduli-dellutente)): uno o più tuoi moduli compressi dal Finder. La lens lo riconosce da com'è fatto: alla radice solo cartelle con il nome di un id (`mio-modulo/`…), ognuna con il suo `module.js`, e nessun file. Ogni altro zip segue la strada dello zip della lens, con i suoi errori.

1. **Anteprima.** La lens controlla lo zip come quello dell'app (niente percorsi che escono dalla cartella, collegamenti simbolici, `.git`, al massimo 16 MiB e 64 MiB estratto) e lo estrae in `update/`, **senza eseguire niente dei moduli**: per ognuno mostra l'id e se è **nuovo** o **sostituisce la versione installata** (o un collegamento simbolico). Sopra c'è l'avviso: **«Codice non firmato: gira nel processo della lens con i tuoi permessi. Installa solo moduli di cui ti fidi.»**, e che i moduli si controllano quando premi **Installa**.
2. **Rifiuti.** Un id di un modulo della lens (`sistema`, `skill`…), una lens senza cartella dei moduli (`LENS_DB=:memory:`) e uno zip vuoto sono rifiutati subito.
3. **Controllo.** Premi **Installa** (o **Installa e riavvia**) e conferma: solo allora la lens giudica ogni modulo come **Impostazioni › Moduli** e `lens_module_check`. Il controllo esegue il codice di primo livello di `module.js` e `server/index.js` di ogni modulo, e la sua `configure()`: per questo viene dopo l'avviso. Se un modulo ha errori non si installa niente: la sezione mostra nome, errori e avvisi di ogni modulo, e lo zip va corretto e caricato di nuovo.
4. **Installazione.** Per ogni modulo la cartella nuova viene copiata accanto al suo posto e poi rinominata al posto della vecchia: non resta mai un modulo a metà. È tutto o niente: se una copia o uno scambio non riesce, i moduli già sostituiti tornano com'erano, non si installa niente e la lens non si riavvia; le copie lasciate da un'interruzione (`.staging-*`) si tolgono al riavvio. Un `.backup` che non è una cartella blocca l'installazione prima di toccare qualunque modulo. La cartella vecchia va in `<cartella dei moduli>/.backup/<id>-<data>/` (il punto iniziale la tiene fuori dai moduli scoperti); se era un collegamento simbolico, in `.backup/` va il collegamento e la cartella a cui punta resta com'è. I dati dei moduli, accanto al database, non si toccano.
5. **Riavvio.** Se la lens gira come servizio di launchd, e il plist non ha variabili modificate a mano e non ancora applicate, si riavvia da sola (come **Riavvia la lens**) e la pagina si ricarica nella stessa sezione; altrimenti la pagina dice di riavviarla a mano. I moduli già accesi restano accesi (`LENS_MODULES` non cambia); un modulo nuovo è spento: attivalo da **Impostazioni › Moduli**.

Questo non richiede che la lens giri da `~/Applications/opencode-lens`: basta la cartella dei moduli dell'utente. Si fa solo da questo computer, con le stesse regole di Origin, content-type e token delle altre scritture, e **richiede `LENS_TOKEN`**: senza, la lens rifiuta lo zip con 403 («imposta LENS_TOKEN per installare moduli»), perché è codice non firmato che gira nel suo processo (l'installazione come servizio ne genera già uno). Le copie in `.backup/` restano finché non le togli tu.

### Il server MCP: riavvia OpenCode

Il server MCP (`opencode-lens mcp`) non fa parte del servizio della lens: è un processo figlio di OpenCode, che lo avvia quando parte e lo tiene in vita finché gira. Un aggiornamento sostituisce i file e riavvia la lens, ma l'MCP già lanciato continua con il codice vecchio: strumenti e prompt nuovi non compaiono finché OpenCode non riparte.

Impostazioni › Server MCP lo segnala: ogni richiesta dell'MCP dice alla lens la sua versione (header `X-Lens-Mcp-Version`) e, se non è quella della lens, la sezione mostra l'avviso «OpenCode da riavviare» con le due versioni. Un MCP di una versione precedente alla 0.29.0 non manda la versione: la lens lo riconosce comunque dalla lettura periodica dei preset e lo indica come «versione precedente». L'avviso sparisce da solo dopo il riavvio di OpenCode, alla prima richiesta dell'MCP nuovo (entro mezzo minuto, perché l'MCP rilegge i preset ogni 30 secondi). `opencode2 reload` non basta: ricarica la configurazione, non i server MCP.

## 3. Pulizia

Quando la dashboard su `http://127.0.0.1:4777` mostra la versione nuova e i tuoi dati, puoi togliere quello che non serve più.

**Homebrew** (dopo `install.sh`, non prima: fino a quel momento il servizio parte da lì). La formula ha solo il codice: database e impostazioni restano.

```bash
brew uninstall opencode-lens
brew untap vale76p/tap
```

**Altre copie** elencate da `--check`, **zip scaricati** e la **cartella estratta** da cui hai lanciato `install.sh`: si possono cancellare. Un clone ti serve solo se ci lavori.

**Cestino**: la vecchia cartella dell'app (`opencode-lens-<data>`) si può svuotare.

**Copie di sicurezza**: `backup/` occupa quanto il database per ogni copia. Toglile quando sei sicuro che vada tutto bene:

```bash
rm -rf ~/Library/Application\ Support/opencode-lens/backup
```

### Da non fare

- Non usare `service uninstall --purge` né `uninstall.sh --purge`: eliminano database, disposizione e log.
- Non cancellare `~/Library/Application Support/opencode-lens`, né `lens.db-wal` e `lens.db-shm` mentre la lens gira: contengono dati non ancora scritti in `lens.db`.
- Non cancellare il plist prima di aver reinstallato: contiene le tue impostazioni. Se è già successo, recupera la copia in `backup/` (vedi sotto).

L'app OpenCode Lens Monitor continua a funzionare senza modifiche: il nome del servizio e la porta sono gli stessi.

## Ripristinare una copia di sicurezza

```bash
L=~/Applications/opencode-lens
N="$(command -v node || echo "$L/node/bin/node")"
"$N" "$L/src/main.js" service stop
cd ~/Library/Application\ Support/opencode-lens
mv lens.db lens.db.sostituito && rm -f lens.db-wal lens.db-shm
cp backup/lens-<versione>-<data>.db lens.db
"$N" "$L/src/main.js" service start
```

Per le impostazioni del servizio, rimetti il plist salvato e reinstalla. `service install` riprende le variabili dal plist che trova:

```bash
cp ~/Library/Application\ Support/opencode-lens/backup/local.opencode-lens-<data>.plist ~/Library/LaunchAgents/local.opencode-lens.plist
bash ~/Applications/opencode-lens/install.sh
```

Per tornare a una versione precedente, reinstalla il suo zip e ripristina la copia che porta il suo numero di versione. Una lens che non conosce lo schema del database non lo apre: la 0.36 o precedenti, per esempio, rifiutano un database a schema v6 e si fermano con «opencode-lens non è partita» (vedi [troubleshooting.md](troubleshooting.md)). Con lo stesso schema la lens vecchia lo apre, ma senza garanzie che i numeri tornino: meglio comunque la copia fatta prima dell'aggiornamento.

La disposizione della dashboard non richiede nessuna copia: la versione con le due viste salva in `dashboard-v2.json` e non scrive mai `dashboard.json`, quindi una lens più vecchia ritrova la sua disposizione di prima intatta (le modifiche fatte nelle viste, però, restano solo in `dashboard-v2.json`). Dopo gli stili dei modelli una lens più vecchia scarta `dashboard-v2.json` solo se contiene stili o impostazioni nuove, o un Oggi più stretto di 6 colonne (da questa versione può scendere a 4, ed è largo 4 ogni widget `today` di una v1 migrata); allora usa `dashboard.json` o la disposizione predefinita. Al primo salvataggio la lens nuova tiene la copia di prima in `dashboard-v2.prev.json`: come tornare indietro è in [dashboard.md](dashboard.md#tornare-a-una-lens-più-vecchia). Se poi torni alla versione nuova, ritrovi la disposizione salvata in `dashboard-v2.json`; se non l'avevi mai salvata, viene di nuovo ricavata da `dashboard.json`.
