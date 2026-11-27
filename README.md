# OpenCode Lens

🌐 Italiano · [English](README.en.md) · [Français](README.fr.md)

**Versione 0.51.1** <!-- x-release-please-version --> · [Novità](CHANGELOG.md) · [Release](https://github.com/vale76p/opencode-lens-public/releases) · Licenza [MIT](LICENSE)

**Osservabilità locale per [OpenCode](https://opencode.ai) V2.** OpenCode Lens si collega in sola lettura al servizio di OpenCode che gira in background, conta token, costi, modelli, tool, errori e tempi di ogni sessione, e li mostra in una dashboard su `http://127.0.0.1:4777`, in un'API JSON e su `/metrics` per Prometheus.

Serve a rispondere a domande come: *quanto ho consumato oggi? a questo ritmo sforo il budget della settimana? quale modello o agente costa di più? perché le richieste vanno in errore da stamattina?* Le stesse risposte le possono chiedere anche i modelli che lavorano in OpenCode, tramite il server MCP della lens.

Tutto resta sul tuo computer: nessun servizio esterno, nessun account, zero dipendenze npm, nessuna build.

## Cosa fa

- **Budget e consumi del giorno.** Token, costo e step di oggi contro i budget che scegli (`LENS_LIMIT_*`, anche settimanali, mensili e per singolo modello), con la proiezione a fine giornata, l'ora per ora e quanto resta.
- **Cosa sta facendo OpenCode adesso.** Il prompt in corso con tempo, step, tool, token e riempimento del contesto.
- **Analisi di un periodo.** Andamento nel tempo, ritmo di lavoro, quota per modello, agente, provider o tipo di agente, cache, latenze (p50/p95), i prompt più pesanti, il calendario dell'ultimo anno.
- **Prompt e sessioni.** Ogni prompt con esito, durata, step, tool e token; ogni sessione con i suoi subagenti e una timeline di step e tool, con le pause in evidenza; permessi, commit e tempi di attesa.
- **Dashboard personalizzabile.** Widget su una griglia di 12 colonne da spostare, ridimensionare e configurare, con gauge, grafici a colonne o a linea e stili diversi; tre viste (**Adesso**, **Analisi**, **Monitor** da tenere a schermo intero) e una **Galleria** di tutti i widget con i dati veri.
- **Server MCP per OpenCode.** I modelli possono chiedere a Lens budget, errori aggregati, uso e sessioni («confronta questa settimana con la scorsa»).
- **API, Prometheus e OTLP.** Un'API JSON locale, `/metrics` con contatori che non calano mai, e l'export OTLP verso un collector OpenTelemetry.
- **Moduli facoltativi.** Pagine in più da accendere quando servono: Vibe Coding, Sistema, Security, IBM Bob e Skill, più quelli che scrivi tu (vedi [Moduli](#moduli)).
- **Extra.** Il plugin OpenCode **lens-guard**, che passa a un modello di riserva quando il provider esaurisce la quota o non risponde, un'app macOS facoltativa con la dashboard in una finestra nativa e, come progetto a parte, [OpenCode Lens Monitor](https://github.com/vale76p/opencode-lens-monitor-public), l'app nella barra dei menu con budget, pannello e widget.

L'interfaccia è in italiano, inglese e francese: la lingua e il formato di date e numeri seguono il browser o si scelgono nelle Impostazioni.

## Come funziona

```
servizio OpenCode ──SSE (dal vivo)──┐
  (~/.local/state/opencode/         ├─► collector ─► SQLite locale ─► dashboard · API JSON · /metrics · MCP
   service.json)  ──backfill ───────┘
```

1. **Discovery.** La lens legge `~/.local/state/opencode/service.json` per sapere indirizzo e password del servizio OpenCode, e lo rilegge a ogni riconnessione.
2. **Dal vivo e backfill.** Ascolta lo stream di eventi del servizio e, a intervalli, rilegge sessioni e messaggi: il messaggio dell'assistente è la fonte autorevole, quindi i numeri tornano esatti anche dopo una disconnessione.
3. **Store.** Ogni scrittura è un upsert idempotente per ID in un database SQLite locale (`node:sqlite`), e i totali si riconciliano con quelli di OpenCode (`npm run verify`).

**Cosa salva e cosa no.** Salva conteggi, tempi e nomi (modelli, agenti, tool), i titoli delle sessioni (`LENS_STORE_TITLES=0` li esclude), la cartella di lavoro di ogni sessione e i messaggi d'errore, redatti (chiavi, token, home) e troncati a 500 caratteri. **Non salva** il testo dei prompt, le risposte né l'output dei tool. Non tocca le sessioni e non fa da proxy all'API di OpenCode.

**Sicurezza.** Di partenza ascolta solo su `127.0.0.1`, controlla l'header `Host` e accetta poche scritture, solo da questo computer. Per esporla in rete `LENS_TOKEN` è obbligatorio (vedi [docs/configurazione.md](docs/configurazione.md#esposizione-remota)).

Il dettaglio è in [docs/architettura.md](docs/architettura.md).

## Requisiti

- **OpenCode V2** (`opencode2`), avviato almeno una volta, così che il servizio condiviso scriva `service.json`. Verificato su OpenCode v2.0.26. OpenCode V1 (`opencode`) non è supportato: ha un'API server diversa.
- **Node ≥ 22.13** (usa `node:sqlite` integrato). Se non c'è, `install.sh` scarica Node 24 LTS nella cartella dell'app, senza `sudo`.
- **macOS** per l'installazione come servizio (launchd). Su **Linux** la lens si avvia a mano.

## Installazione

Su macOS la lens gira come servizio launchd da `~/Applications/opencode-lens`. Tutto resta nella tua cartella utente, senza `sudo` né permessi di amministratore.

1. Dalla [pagina delle release](https://github.com/vale76p/opencode-lens-public/releases) scarica `opencode-lens-<versione>.zip` (oppure «Source code (zip)»: funzionano tutti e due).
2. Estrai lo zip (doppio clic nella cartella Download).
3. Nel Terminale lancia `install.sh` della cartella estratta: scrivi `bash `, trascina `install.sh` nella finestra e premi Invio. Oppure:

   ```bash
   bash ~/Downloads/opencode-lens*/install.sh
   ```

4. Apri `http://127.0.0.1:4777`.

Con la [GitHub CLI](https://cli.github.com) i passi 1-3 sono un comando solo:

```bash
D="$(mktemp -d)" && gh release download -R vale76p/opencode-lens-public -p 'opencode-lens-[0-9]*.zip' -D "$D" && unzip -q "$D"/opencode-lens-[0-9]*.zip -d "$D" && bash "$D"/opencode-lens/install.sh
```

`install.sh` salva prima una copia del database e del plist, copia solo i file che servono, usa o scarica Node (con controllo del checksum; dietro un proxy aziendale `LENS_NODE_MIRROR` indica un mirror interno), installa il servizio, che parte subito e a ogni login, e aspetta che risponda. Per un'altra porta: `LENS_PORT=4800 bash …/install.sh`. Per vedere cosa c'è già installato senza cambiare niente: `bash …/install.sh --check`.

| Cosa | Dove |
|---|---|
| app | `~/Applications/opencode-lens` |
| servizio | `~/Library/LaunchAgents/local.opencode-lens.plist` |
| database e disposizione della dashboard | `~/Library/Application Support/opencode-lens/` |
| log | `~/Library/Logs/opencode-lens/lens.log` |

**Aggiornare**: stessi passi con lo zip nuovo, oppure dalla dashboard in **Impostazioni › Aggiornamento**. Database, disposizione e variabili del servizio (budget, `LENS_TOKEN`, porta) restano. Dettagli e passaggio da versioni installate in altri modi: [docs/aggiornamento.md](docs/aggiornamento.md).

**Disinstallare**: `opencode-lens service uninstall` (con `--purge` anche database, disposizione e log); per togliere davvero tutto, [docs/disinstallazione.md](docs/disinstallazione.md).

## Uso

### La dashboard

| Pagina | Cosa mostra |
|---|---|
| **Adesso** | il giorno dei budget: consumi, budget per modello, prompt in corso |
| **Analisi** | un periodo a scelta (7 giorni di partenza): andamento, ritmo, quote per modello o agente, prompt più pesanti |
| **Monitor** | da tenere aperta su uno schermo, anche a schermo intero; si aggiorna da sola |
| **Prompt**, **Sessioni** | le liste complete, con i filtri di Analisi e la timeline di ogni sessione |
| **Galleria** | tutti i widget e i loro stili con i tuoi dati, da aggiungere alla dashboard |
| **Novità** | il changelog della versione installata |
| **Impostazioni** | percorsi, variabili d'ambiente (modificabili dalla dashboard quando la lens gira come servizio), lingua e formato, moduli, aggiornamento |

Con **Personalizza** ogni vista diventa una griglia di widget da modificare; la disposizione si salva nella lens ed è personale. Guida completa: [docs/dashboard.md](docs/dashboard.md).

### Il comando

Il comando è `opencode-lens`. Per averlo nella shell aggiungi a `~/.zshrc`:

```bash
alias opencode-lens='node ~/Applications/opencode-lens/src/main.js'
```

(se il Node l'ha scaricato `install.sh`, al posto di `node` usa `~/Applications/opencode-lens/node/bin/node`).

```bash
opencode-lens                              # avvia collector + dashboard (avvio a mano, anche su Linux)
opencode-lens --check                      # verifica che trovi il servizio OpenCode, poi esce
opencode-lens --resync                     # rilegge tutte le sessioni da zero, poi resta attivo
opencode-lens service status               # caricato? risponde? percorsi
opencode-lens service stop | start | restart
opencode-lens service install --port 4800  # cambia porta (le altre variabili restano)
opencode-lens service open                 # apre la dashboard nel browser, con il token
opencode-lens mcp install                  # stampa la riga per registrare il server MCP in OpenCode
```

### Budget e configurazione

La lens si configura con variabili d'ambiente, che da servizio si cambiano anche da **Impostazioni** (la lens si riavvia da sola). Le più usate:

| Variabile | A cosa serve |
|---|---|
| `LENS_LIMIT_TOKENS`, `LENS_LIMIT_COST`, `LENS_LIMIT_STEPS` | budget giornalieri (con `_WEEKLY` e `_MONTHLY` per settimana e mese) |
| `LENS_MODEL_LIMITS` | budget giornaliero di singoli modelli |
| `LENS_MODEL_PRICES` | prezzi dei modelli locali o senza listino |
| `LENS_RESET_HOUR` | ora in cui parte il giorno dei budget (di partenza mezzanotte) |
| `LENS_PORT`, `LENS_HOST`, `LENS_TOKEN` | porta, indirizzo e token di accesso |
| `LENS_RETENTION_DAYS` | dopo quanti giorni i dettagli si riassumono per giorno |
| `LENS_OTLP_ENDPOINT` | export verso un collector OpenTelemetry |
| `LENS_MODULES` | i moduli accesi |

L'elenco completo è in [docs/configurazione.md](docs/configurazione.md).

### Il server MCP

Con `opencode-lens mcp install` ottieni la riga `opencode2 mcp add …` da eseguire una volta. Da lì i modelli in OpenCode hanno gli strumenti `lens_budget`, `lens_errors`, `lens_usage` e `lens_sessions`, più quelli dei moduli accesi, e possono rispondere a «quanto mi resta oggi su Opus?» o «quali sono le sessioni più care del mese?». Dettagli: [docs/configurazione.md](docs/configurazione.md#server-mcp-per-opencode).

### API e metriche

L'API JSON locale (`/api/summary`, `/api/budget`, `/api/runs`, `/api/status`…) è descritta in [docs/metriche.md](docs/metriche.md#api-locale); `/metrics` è pronto per Prometheus e Grafana ([docs/metriche.md](docs/metriche.md#prometheus--grafana)), e lo stesso vale per l'[export OTLP](docs/metriche.md#export-otlp).

## Moduli

Un **modulo** è una parte facoltativa della lens: una pagina in più nel menu, con le sue API, i suoi widget per la dashboard ed eventualmente i suoi strumenti MCP e le sue tabelle. I moduli partono tutti **spenti**: un modulo spento non ha voce nel menu, né route, né lavoro in background, né metriche. Tutto il resto (Adesso, Analisi, Monitor, Prompt, Sessioni, Galleria, Novità, Impostazioni) è il nucleo e c'è sempre.

Cinque moduli sono inclusi:

| Modulo | Cosa aggiunge |
|---|---|
| **Vibe Coding** | tempo di lavoro, costi e token per progetto e per cartella |
| **Sistema** | il computer su cui gira la lens: CPU, memoria, batteria, processi |
| **Security** | cosa i guard DLP di OpenCode hanno lasciato passare o bloccato, letto dai loro file di audit; anche come strumento MCP `lens_security` ([docs/sicurezza.md](docs/sicurezza.md)) |
| **IBM Bob** | i task di Bob IDE e Bob Shell, con un selettore per vederli accanto a OpenCode o da soli |
| **Skill** | la libreria delle tue skill con le versioni e quanto OpenCode le usa; le raggruppa in **preset** che l'MCP offre a OpenCode come comandi `/lens:<id>` |

**Accenderli.** Da **Impostazioni › Moduli**, con il pulsante *Attiva* di ogni scheda; oppure, con la lens avviata a mano, con `LENS_MODULES` (per esempio `LENS_MODULES=sistema,vibecoding`). Un modulo che non parte va in errore da solo: la lens e gli altri moduli continuano a funzionare.

**I tuoi moduli.** Puoi scriverne di tuoi e metterli nella cartella `modules/` accanto al database (su macOS `~/Library/Application Support/opencode-lens/modules/`), che gli aggiornamenti non toccano; si installano anche da uno zip in **Impostazioni › Aggiornamento**. Un modulo legge il database solo in sola lettura e scrive solo nelle sue tabelle. Per cominciare:

- copia il modulo d'esempio [extras/module-template/](extras/module-template/);
- segui la guida passo per passo [docs/moduli-custom.md](docs/moduli-custom.md), scritta anche per un LLM;
- oppure chiedi al modello in OpenCode: gli strumenti MCP `lens_module_guide` e `lens_module_check` gli danno la guida con i valori della tua installazione e controllano il modulo senza accenderlo.

Il contratto completo (manifesto, route, widget, tabelle, impostazioni, MCP) è in [docs/moduli.md](docs/moduli.md).

## Sviluppo

```bash
git clone https://github.com/vale76p/opencode-lens-public.git opencode-lens && cd opencode-lens
npm run check             # verifica che trovi il servizio OpenCode
npm start                 # collector + dashboard su http://127.0.0.1:4777
npm test                  # test node:test, con un finto servizio OpenCode
npm run lint              # Biome via npx
npm run test:integration  # contro un opencode2 vero (si salta se non c'è)
npm run verify            # confronta il database con i totali di OpenCode, sessione per sessione
npm run package           # test + dist/opencode-lens-<versione>.zip
```

Non c'è niente da installare: nessuna dipendenza npm e nessuna build. La dashboard è fatta di moduli ES letti dal disco a ogni richiesta, quindi basta ricaricare il browser. Per farla girare come servizio dal clone: `node src/main.js service install` (il plist punta alla cartella del clone).

I test girano contro un finto servizio OpenCode (`service.json` temporaneo, Basic auth, stream SSE, paginazione) e controllano che *Σ step + Σ task interni* coincida con i totali di sessione. `npm run test:integration` avvia un `opencode2 serve` vero in cartelle temporanee, con un finto modello compatibile OpenAI. `npm run test:macos` costruisce l'app macOS facoltativa ([docs/app-macos.md](docs/app-macos.md)).

```
opencode-lens/
├── src/                  # collector, store SQLite, query, server HTTP, server MCP
├── public/               # dashboard in moduli ES senza build
├── modules/              # i moduli inclusi (Vibe Coding, Sistema, Security, IBM Bob, Skill)
├── docs/                 # documentazione (tradotta in docs/en e docs/fr)
├── test/                 # test node:test, con un finto servizio OpenCode
├── extras/
│   ├── opencode/         # plugin OpenCode lens-guard
│   ├── macos/            # app macOS facoltativa (Swift)
│   └── module-template/  # modulo d'esempio da copiare
├── scripts/              # pacchetto, changelog, verifica dei totali, firma delle release
├── install.sh            # installazione come servizio
└── uninstall.sh
```

## Versioni e rilasci

Versioni [SemVer](https://semver.org/lang/it/) con una sola fonte: `version` in `package.json`. I rilasci li prepara [release-please](https://github.com/googleapis/release-please) dai [commit convenzionali](https://www.conventionalcommits.org/it/v1.0.0/) su `main`: `feat(opencode-lens): …` fa una *minor*, `fix(opencode-lens): …` una *patch*, `!` o `BREAKING CHANGE:` una *major*; `test`, `ci`, `build` e `chore` non compaiono nel changelog. Al merge della PR di rilascio nasce il tag `opencode-lens-vX.Y.Z` con la release GitHub e lo zip dell'app firmato.

Servizio `local.opencode-lens`, plist, cartella dei dati e log non hanno mai cambiato percorso dalla 0.1.0, e `install.sh` aggiorna da qualsiasi versione precedente: cambiarli sarebbe una modifica *major*.

## Documentazione

| Documento | Contenuto |
|---|---|
| [docs/dashboard.md](docs/dashboard.md) | dashboard: viste e pagine, modifica, widget, catalogo, stili, Galleria |
| [docs/configurazione.md](docs/configurazione.md) | variabili d'ambiente, budget, prezzi, server MCP, plugin lens-guard, accesso remoto, sicurezza e privacy |
| [docs/metriche.md](docs/metriche.md) | significato dei numeri, API locale, `/metrics`, Prometheus, OTLP |
| [docs/moduli.md](docs/moduli.md) | i moduli: attivarli, stati, API e contratto completo |
| [docs/moduli-custom.md](docs/moduli-custom.md) | scrivere un modulo tuo, passo per passo |
| [docs/sicurezza.md](docs/sicurezza.md) | il modulo Security e i guard DLP di OpenCode |
| [docs/architettura.md](docs/architettura.md) | discovery, flusso live + backfill, idempotenza, componenti |
| [docs/aggiornamento.md](docs/aggiornamento.md) | aggiornare e passare da versioni precedenti |
| [docs/troubleshooting.md](docs/troubleshooting.md) | problemi comuni e limiti noti |
| [docs/disinstallazione.md](docs/disinstallazione.md) | cosa scrive la lens e come eliminarla del tutto |
| [docs/app-macos.md](docs/app-macos.md) | l'app macOS facoltativa |
| [docs/traduzioni.md](docs/traduzioni.md) | lingue, testi e glossario |
| [CHANGELOG.md](CHANGELOG.md) | versioni, anche nella pagina **Novità** della dashboard ([en](CHANGELOG.en.md), [fr](CHANGELOG.fr.md)) |

## Licenza

[MIT](LICENSE) © 2026 vale76p. OpenCode Lens è un progetto indipendente, non affiliato a OpenCode né a IBM.
