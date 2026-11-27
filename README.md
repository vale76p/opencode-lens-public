# OpenCode Lens

🌐 Italiano · [English](README.en.md) · [Français](README.fr.md)

**Versione 0.51.0** <!-- x-release-please-version --> · [Novità](CHANGELOG.md) · [Release](https://github.com/vale76p/opencode-lens-public/releases)

Osservabilità locale per **OpenCode V2**: token, modelli chiamati, costi, latenze, tool ed errori, letti dal servizio OpenCode in background e mostrati in una dashboard su `http://127.0.0.1:4777`.

La dashboard mostra:

- **Oggi**: token del giorno con la composizione, il budget `LENS_LIMIT_*` con la proiezione a fine giornata, l'ora per ora e, con i budget settimanali e mensili, settimana e mese (anche su `/api/budget` per l'app OpenCode Lens Monitor); il giorno parte a mezzanotte o all'ora di `LENS_RESET_HOUR`;
- **Per modello oggi**: token di oggi di ogni modello con un budget giornaliero proprio, quanto resta e quando si azzera, anche come gauge di un singolo modello; i modelli arrivano dalla configurazione di OpenCode e i budget si impostano nelle Impostazioni;
- **Prompt in corso**: il prompt che OpenCode sta eseguendo, con tempo, step, tool, token e riempimento del contesto;
- token, costo, cache, latenza e tool del periodo, per modello, agente, provider o tipo di agente (primario o subagente);
- **Prompt**: la lista dei prompt del periodo con esito, durata, step, tool e token, e la loro **distribuzione** (mediana, p95, durata media); e l'**interazione**: permessi con il tempo di attesa, commit e peso dei subagenti;
- **Ultimo anno**: calendario giornaliero di 53 settimane;
- sessioni a pagine, con il totale dei subagenti e una **timeline** di step e tool, con le pause in evidenza;
- **Personalizza dashboard**: i blocchi sono widget su una griglia di 12 colonne; si spostano trascinandoli, si ridimensionano dall'angolo, si configurano (periodo, metrica, raggruppamento, titolo), si tolgono o si aggiungono dal catalogo, anche più volte lo stesso, compresi i **gauge** e l'andamento a colonne o a linea. La navigazione sta in una **barra laterale**. La dashboard ha tre viste, **Adesso** (il giorno dei budget, il prompt in corso), **Analisi** (periodo, distribuzione dei token per prompt, lista dei prompt) e **Monitor** (da tenere su uno schermo, anche a schermo intero); ogni widget con più modelli grafici ha uno **stile** da scegliere in modifica, e la **Galleria** li mostra tutti con i dati veri; la disposizione si salva nella lens (`dashboard-v2.json` accanto al database), è personale e non finisce nel pacchetto. Guida: [docs/dashboard.md](docs/dashboard.md);
- **Impostazioni** (percorsi, database, variabili d'ambiente modificabili dalla dashboard con il LaunchAgent, **lingua** e **formato** di date, ore e numeri) e **Novità** (changelog). La dashboard è in italiano, inglese e francese: la lingua e il formato seguono il browser, oppure si scelgono nelle Impostazioni (`LENS_LANG`, `LENS_LOCALE`; vedi [docs/traduzioni.md](docs/traduzioni.md));

Con il **server MCP** (`opencode-lens mcp`) anche i modelli che lavorano in OpenCode possono chiedere a Lens budget, errori aggregati, uso e sessioni: «perché le richieste vanno in errore?», «confronta questa settimana con la scorsa». Si registra con la riga stampata da `opencode-lens mcp install`: vedi [docs/configurazione.md](docs/configurazione.md#server-mcp-per-opencode). Le skill che importi nella pagina **Skill** si raggruppano in **preset**: l'MCP li offre a OpenCode come comandi `/lens:<id>` e come strumento `preset`, con il testo di `SKILL.md`, la cartella base e i file ([dettagli](docs/configurazione.md#prompt)).

La lens non tocca le sessioni: ascolta lo stream eventi del servizio condiviso, rilegge i messaggi per avere numeri esatti e salva conteggi, tempi e nomi in un database SQLite locale, più i titoli delle sessioni (`LENS_STORE_TITLES=0` li esclude), la cartella di lavoro di ogni sessione e i messaggi d'errore, redatti (chiavi, token, home) e troncati a 500 caratteri. Il testo dei prompt, le risposte e l'output dei tool non vengono salvati.

## Requisiti

- **Node ≥ 22.13**: usa `node:sqlite` integrato. Zero dipendenze npm, nessuna build. Se non c'è, `install.sh` scarica Node 24 LTS nella cartella dell'app, senza `sudo`.
- **OpenCode V2** (`opencode2`), partito almeno una volta, così che il servizio condiviso scriva `~/.local/state/opencode/service.json`. Verificato su OpenCode v2.0.26.
- macOS per l'installazione come servizio (launchd). Avvio manuale anche su Linux.
- Accesso al repository, che è privato: dal browser con il tuo account GitHub, oppure con la [GitHub CLI](https://cli.github.com) autenticata (`gh auth login`).

OpenCode V1 (`opencode`) non è supportato: ha un'API server diversa.

## Installazione

Su macOS la lens gira come servizio launchd da `~/Applications/opencode-lens`. Tutto resta nella tua cartella utente, senza `sudo` né permessi di amministratore: va bene anche su un Mac aziendale.

1. Dalla [pagina della release](https://github.com/vale76p/opencode-lens-public/releases) scarica `opencode-lens-<versione>.zip`, oppure «Source code (zip)»: funzionano tutti e due.
2. Fai doppio clic sullo zip nella cartella Download (Safari di solito lo estrae da solo).
3. Apri il Terminale e lancia `install.sh` della cartella estratta. Il comando è uno solo: scrivi `bash `, trascina `install.sh` nella finestra e premi Invio. Oppure:

   ```bash
   bash ~/Downloads/opencode-lens*/install.sh
   ```

   Se in Download ci sono più versioni, il comando si ferma: indica la cartella giusta, cioè `opencode-lens` per lo zip della release oppure `opencode-lens-opencode-lens-v<versione>` per il Source code.

Per vedere prima cosa c'è già installato (servizio, versione, database, vecchie copie, Homebrew) senza cambiare niente: `bash …/install.sh --check`.

`install.sh`:

- salva una copia del database e del plist in `~/Library/Application Support/opencode-lens/backup/` (tiene le ultime tre);
- copia in `~/Applications/opencode-lens` solo i file che servono a far girare la lens (niente test né file di sviluppo, a parte il test kit dei moduli in `test/`, per provare i tuoi: vedi [docs/moduli.md](docs/moduli.md#provare-un-modulo)) e toglie la quarantena del download;
- usa il Node ≥ 22.13 del `PATH`; se non c'è, o è più vecchio, scarica Node 24 LTS da nodejs.org in `~/Applications/opencode-lens/node`, controllandone il checksum. Se nodejs.org non è raggiungibile (proxy aziendale), indica un mirror interno con `LENS_NODE_MIRROR=https://…/dist bash …/install.sh`;
- installa il servizio con `opencode-lens service install`, che parte subito e a ogni login, e attende che risponda. Per un'altra porta: `LENS_PORT=4800 bash …/install.sh`;
- se il servizio partiva da un'altra cartella estratta da uno zip, la sposta nel Cestino. Un clone resta dove si trova; per Homebrew stampa i comandi per toglierlo.

Database, disposizione della dashboard e variabili del servizio non vengono mai toccati. Per passare da una versione installata in un altro modo (zip in un'altra cartella, Homebrew, clone), e per ripristinare una copia, vedi [docs/aggiornamento.md](docs/aggiornamento.md).

Dashboard su `http://127.0.0.1:4777`. L'app sta in `~/Applications/opencode-lens`, il servizio in `~/Library/LaunchAgents/local.opencode-lens.plist`, database e disposizione della dashboard in `~/Library/Application Support/opencode-lens/`, log in `~/Library/Logs/opencode-lens/lens.log`. Lo zip scaricato e la cartella estratta si possono cancellare.

**Aggiornamento**: stessi passi con lo zip nuovo. `install.sh` sostituisce l'app e tiene il Node già scaricato, il database e le variabili del servizio (budget, `LENS_TOKEN`, porta). Dalla 0.17.0 lo stesso si fa anche dalla dashboard: **Impostazioni › Aggiornamento**, carichi lo zip e la lens lancia il suo `install.sh` (vedi [docs/aggiornamento.md](docs/aggiornamento.md#dalla-dashboard)).

Con la GitHub CLI i passi 1-3 diventano:

```bash
D="$(mktemp -d)" && gh release download -R vale76p/opencode-lens-public -p 'opencode-lens-[0-9]*.zip' -D "$D" && unzip -q "$D"/opencode-lens-[0-9]*.zip -d "$D" && bash "$D"/opencode-lens/install.sh
```

Senza tag `gh release download` scarica l'ultima release.

Il comando della lens è `opencode-lens`, il nome che usano anche i suoi messaggi e questa documentazione; per averlo nella shell aggiungi a `~/.zshrc`:

```bash
alias opencode-lens='node ~/Applications/opencode-lens/src/main.js'
```

Se il Node l'ha scaricato `install.sh`, al posto di `node` usa `~/Applications/opencode-lens/node/bin/node`.

Gestione del servizio:

```bash
opencode-lens service status               # caricato? risponde? percorsi
opencode-lens service install --port 4800  # cambia porta (le altre variabili restano)
opencode-lens service stop | start | restart
opencode-lens service open                 # apre la dashboard nel browser, con il token
opencode-lens service uninstall [--purge]  # con --purge anche database, disposizione e log
```

Per dare Lens ai modelli di OpenCode come server MCP: `opencode-lens mcp install` stampa la riga `opencode2 mcp add …` da eseguire ([dettagli](docs/configurazione.md#server-mcp-per-opencode)).

`service install` controlla la versione di Node e che la porta sia libera, prova la connessione a OpenCode (se non è attivo va bene: la lens si collega quando parte), scrive il plist e attende che `/healthz` risponda. Rilanciato su un'installazione esistente ne conserva le `EnvironmentVariables`, come budget e `LENS_TOKEN`, e cambia la porta solo con `--port`. Se Node viene da Homebrew, nel plist c'è il suo percorso stabile (`/opt/homebrew/opt/node/…`), che resta valido dopo ogni aggiornamento di Node.

Per togliere davvero tutto (anche dati del browser e integrazioni) segui [docs/disinstallazione.md](docs/disinstallazione.md). La pagina **Impostazioni** della dashboard mostra gli stessi comandi già compilati con i tuoi percorsi.

## Da un clone (sviluppo)

```bash
git clone https://github.com/vale76p/opencode-lens-public.git opencode-lens && cd opencode-lens
npm run check     # verifica che trovi il servizio OpenCode
npm start         # collector + dashboard su http://127.0.0.1:4777
npm run resync    # rilegge tutte le sessioni da zero, poi resta attivo
npm run verify    # confronta il DB con i totali di OpenCode, sessione per sessione (-v per il dettaglio)
node src/main.js --help
```

Come servizio dal clone: `node src/main.js service install` (o `./install.sh`, che dentro un clone non copia niente e usa il Node del `PATH`; con `LENS_PORT=4800 ./install.sh` per la porta; `./uninstall.sh [--purge]` per toglierlo). Sono lo stesso comando: il plist punta alla cartella del clone. Se usi un version manager (nvm, fnm, volta, asdf) e cambi versione di Node, rilancialo.

Per passare da un clone allo zip, o al contrario, basta `service install` dalla nuova cartella: riscrive il plist e conserva variabili, database e disposizione.

## Documentazione

| Documento | Contenuto |
|---|---|
| [docs/dashboard.md](docs/dashboard.md) | dashboard personalizzabile: barra laterale, viste e pagine, modifica, tastiera, impostazioni dei widget, catalogo, stili, Galleria, dove si salva e come tornare a una lens più vecchia |
| [docs/sicurezza.md](docs/sicurezza.md) | pagina Security: guard DLP di OpenCode, come Lens li trova (basta un `<nome>.audit.jsonl`), salute, cosa si vede da rete, tool MCP `security` (del modulo Security) e serie `/metrics` |
| [docs/architettura.md](docs/architettura.md) | discovery, flusso live + backfill, idempotenza, stili e modelli della dashboard, componenti |
| [docs/metriche.md](docs/metriche.md) | significato dei numeri, API locale, `/metrics` e Prometheus |
| [docs/configurazione.md](docs/configurazione.md) | variabili d'ambiente, prezzi dei modelli locali, server MCP per OpenCode, accesso remoto, sicurezza e privacy |
| [docs/aggiornamento.md](docs/aggiornamento.md) | passare da versioni precedenti (zip, Homebrew, clone): controllo, pulizia, copie del database |
| [docs/troubleshooting.md](docs/troubleshooting.md) | problemi comuni e limiti noti della beta |
| [docs/disinstallazione.md](docs/disinstallazione.md) | cosa scrive la lens e come eliminarla del tutto |
| [docs/app-macos.md](docs/app-macos.md) | app macOS facoltativa: la dashboard in una finestra nativa con Dock, notifiche e avvio al login; costruzione, installazione, disinstallazione |
| [docs/moduli.md](docs/moduli.md) | i moduli (Vibe Coding, Sistema, Security, IBM Bob, Skill) e i tuoi: attivarli, stati, API e il contratto completo di un modulo |
| [docs/moduli-custom.md](docs/moduli-custom.md) | scrivere un modulo tuo, passo per passo (la guida che dà lo strumento MCP `lens_module_guide`): cartella, manifesto, route, pagina, widget, verifica, errori tipici |
| [docs/traduzioni.md](docs/traduzioni.md) | lingue (italiano, inglese, francese), come si aggiungono e si cambiano i testi, glossario |
| [CHANGELOG.md](CHANGELOG.md) | versioni (anche nella pagina **Novità** della dashboard); tradotto in [CHANGELOG.en.md](CHANGELOG.en.md) e [CHANGELOG.fr.md](CHANGELOG.fr.md) |

Il resto della documentazione è tradotto in [docs/en/](docs/en/) (inglese) e [docs/fr/](docs/fr/) (francese), con gli stessi nomi di file.

## Struttura

```
opencode-lens/
├── src/                  # collector, store SQLite, query, server HTTP, server MCP, about/changelog
├── public/               # dashboard in moduli ES senza build: barra laterale, griglia di widget, modelli dei grafici, editor, Galleria, Impostazioni, Novità
├── docs/                 # documentazione
├── test/                 # test node:test, con un finto servizio OpenCode
├── extras/
│   ├── opencode/         # plugin OpenCode lens-guard
│   ├── macos/            # app macOS facoltativa (Swift, si compila con app.sh)
│   └── module-template/  # modulo d'esempio da copiare per scrivere i tuoi (docs/moduli-custom.md)
├── scripts/
│   ├── package.sh        # test + dist/opencode-lens-<versione>.zip
│   ├── changelog.mjs     # coerenza versione/changelog/tag, note di rilascio
│   └── verify.mjs        # riconciliazione con i totali di OpenCode
├── dist/                 # pacchetto creato da npm run package (non committato)
├── install.sh            # da un clone: opencode-lens service install
├── uninstall.sh          # da un clone: opencode-lens service uninstall
├── CHANGELOG.md
└── package.json
```

## Sviluppo

```bash
npm test                  # node:test, nessuna dipendenza
npm run test:integration  # contro un opencode2 vero (si salta se non c'è)
npm run lint              # Biome via npx, nessuna dipendenza nel progetto
npm run test:macos        # costruisce davvero l'app macOS facoltativa (solo su macOS, si salta senza Command Line Tools)
npm run package           # test + dist/opencode-lens-<versione>.zip, verificato estraendolo
```

I test girano contro un finto servizio OpenCode (server HTTP locale con `service.json` temporaneo, Basic auth, stream SSE e paginazione a cursore) e controllano che *Σ step + Σ task interni* coincida con i totali di sessione. Il workflow `.github/workflows/opencode-lens.yml` li esegue con Node 22 a ogni push su `main` e a ogni pull request (tranne quelle che toccano solo i file della PR di rilascio di release-please: manifest, `CHANGELOG.md`, `README.md`, `package.json`), insieme a lint e `npm run changelog:check`.

`npm run test:integration` avvia un `opencode2 serve` vero in cartelle temporanee (HOME e XDG propri, nessuna credenziale) con un finto modello compatibile OpenAI: i tool girano davvero (`read`, `shell` con un `git commit`, un permesso chiesto e risposto) e il test controlla che step, costi, run, prompt, commit e permessi registrati dalla lens coincidano con OpenCode. In CI non gira perché richiede `opencode2`: lancialo prima di un rilascio e dopo ogni aggiornamento di OpenCode (`OPENCODE_BIN` per un binario diverso).

`npm run test:macos` costruisce e firma davvero l'app macOS facoltativa di `extras/macos/` senza avviarla; si salta fuori da macOS o senza Command Line Tools. In CI girano solo i suoi controlli statici, dentro `npm test`. Vedi [docs/app-macos.md](docs/app-macos.md#sviluppo).

## Versioni e rilasci

Versioni [SemVer](https://semver.org/lang/it/) con una sola fonte: `version` in `package.json`. Da lì la leggono `--version`, `/api/status`, `/api/about`, la metrica `opencode_lens_build_info` e la dashboard (accanto al titolo e nella pagina **Novità**).

| Cambia | Quando |
|---|---|
| *major* | API locale, schema del database o installazione incompatibili con la versione prima |
| *minor* | funzioni nuove compatibili |
| *patch* | correzioni |

I rilasci li prepara [release-please](https://github.com/googleapis/release-please) dai [commit convenzionali](https://www.conventionalcommits.org/it/v1.0.0/) su `main`:

| Commit | Sezione del changelog | Versione |
|---|---|---|
| `feat(opencode-lens): …` | Aggiunto | *minor* |
| `fix(opencode-lens): …` | Corretto | *patch* |
| `perf:` / `refactor:` | Modificato | *patch* |
| `docs:` | Documentazione | *patch* |
| `!` dopo il tipo, o `BREAKING CHANGE:` nel corpo | | *major* |
| `test:`, `ci:`, `build:`, `chore:` | non compaiono | |

A ogni push su `main` il workflow `.github/workflows/release-please.yml` tiene aggiornata una PR «chore(main): release opencode-lens X.Y.Z» con la versione in `package.json`, la voce nuova in `CHANGELOG.md` e `.release-please-manifest.json`. Le voci si possono rifinire a mano nella PR prima del merge, e nella stessa PR si aggiungono le traduzioni della nuova versione in `CHANGELOG.en.md` e `CHANGELOG.fr.md` (se mancano, la pagina **Novità** mostra quella versione in italiano; `npm run changelog:check` le segnala). Al merge release-please crea il tag `opencode-lens-vX.Y.Z` e la release GitHub; il secondo job controlla tag e changelog (`npm run changelog:check`), rilancia test e pacchetto e allega lo zip dell'app, `opencode-lens-X.Y.Z.zip`.

Per installare la lens servono lo zip dell'app o il «Source code» che GitHub aggiunge a ogni release, e `install.sh` installa da tutti e due allo stesso modo:

| Zip | Cartella estratta | Contenuto |
|---|---|---|
| `opencode-lens-X.Y.Z.zip` (allegato dal workflow) | `opencode-lens/` | solo i file che servono a far girare la lens, provati dal job che costruisce il pacchetto |
| «Source code (zip)» (generato da GitHub sul tag) | `opencode-lens-opencode-lens-vX.Y.Z/` | tutto il repository, test e file di sviluppo compresi; `install.sh` copia solo quello che serve |

Per provare `main` prima di una release va bene anche «Download ZIP» del branch (`opencode-lens-main/`): la versione mostrata resta quella dell'ultimo rilascio finché release-please non la aggiorna.

L'installazione fa parte della compatibilità. Servizio `local.opencode-lens`, plist, cartella dei dati (`~/Library/Application Support/opencode-lens`) e log non hanno mai cambiato percorso dalla 0.1.0, e `install.sh` aggiorna da qualsiasi versione precedente ([docs/aggiornamento.md](docs/aggiornamento.md)). Cambiare uno di questi percorsi, o richiedere un passo a mano per aggiornare, è una modifica *major*.

Prima del merge di una PR di rilascio: `npm run test:integration` e `npm run test:macos` in locale e, da uno zip estratto, `bash install.sh --check` per vedere che riconosca l'installazione esistente. La PR di release-please, creata con il token delle Actions, non fa partire da sola la CI; i test girano comunque nel job che costruisce lo zip, dopo il tag.

Il workflow ha bisogno di «Allow GitHub Actions to create and approve pull requests» in *Settings → Actions → General → Workflow permissions* del repository.
