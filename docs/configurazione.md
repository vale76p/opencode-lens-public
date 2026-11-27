# Configurazione

🌐 Italiano · [English](en/configurazione.md) · [Français](fr/configurazione.md)

La lens non ha un file di configurazione: tutto passa da variabili d'ambiente. I valori in uso, con la loro origine (variabile o default), i percorsi dei file e il database si vedono nella pagina **Impostazioni** della dashboard (`http://127.0.0.1:4777/#impostazioni`). Con `opencode-lens service install` (o `install.sh` da un clone) l'unica impostata nel LaunchAgent è `LENS_PORT`; le altre si cambiano dalla stessa pagina (vedi [Modifica dalla dashboard](#modifica-dalla-dashboard)) oppure a mano in `~/Library/LaunchAgents/local.opencode-lens.plist` (sezione `EnvironmentVariables`), ricaricando poi il servizio. Avviata a mano con `npm start`, la lens prende le variabili dalla shell e la pagina resta in sola lettura. Rilanciare `opencode-lens service install` (per esempio dopo un cambio di versione di Node in un clone) le conserva: riscrive il resto del plist ma tiene le `EnvironmentVariables` che trova, elencandone i nomi nell'output, e cambia `LENS_PORT` solo con `--port 4800`; altrimenti resta la porta già nel plist. Gli aggiornamenti (lo zip nuovo estratto sopra la cartella dell'app) non toccano il plist.

## Variabili d'ambiente

| Variabile | Default | |
|---|---|---|
| `LENS_PORT` / `LENS_HOST` | `4777` / `127.0.0.1` | dove ascolta la dashboard; porta intera 0–65535 (0 = scelta dal sistema) |
| `LENS_TOKEN` | generato da `service install` | protegge dashboard e API; obbligatorio se `LENS_HOST` non è locale (almeno 16 caratteri). Nel browser: `opencode-lens service open` |
| `LENS_ALLOWED_HOSTS` | – | header `Host` aggiuntivi accettati, separati da virgola, sempre come `nome:porta` |
| `LENS_DB` | `~/Library/Application Support/opencode-lens/lens.db` | su Linux `$XDG_DATA_HOME/opencode-lens/lens.db` |
| `LENS_SCAN_INTERVAL` | `120` | secondi tra un sync completo e il successivo, intero tra 10 e 86400 |
| `LENS_STORE_TITLES` | `1` | `0` (o `false`) per non salvare i titoli |
| `LENS_LANG` | `auto` | lingua della dashboard e dei testi del server destinati alle persone: `auto` (la lingua del browser, inglese se non è supportata), `it`, `en` o `fr`. Vedi [Lingua e formato](#lingua-e-formato) |
| `LENS_LOCALE` | `auto` | formato di date, ore e numeri: `auto` (quello del browser, se tra quelli offerti, altrimenti quello della lingua), `it-IT`, `en-US`, `en-GB` o `fr-FR` |
| `LENS_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LENS_RETENTION_DAYS` | – | giorni di step e tool di OpenCode da conservare, intero tra 400 e 36500; non impostata (o vuota) = per sempre. Vedi [Retention dei dettagli](#retention-dei-dettagli) |
| `OPENCODE_SERVICE_FILE` | `~/.local/state/opencode/service.json` | rispetta `$XDG_STATE_HOME` |
| `OPENCODE_SERVER_URL` / `OPENCODE_SERVER_PASSWORD` | – | per un server esplicito (es. `opencode2 serve` o `--standalone`) invece del servizio condiviso; URL completo di schema (`http://…`), senza utente e password dentro l'URL. La password senza URL è un errore |
| `OPENCODE_SERVER_USERNAME` | `opencode` | utente Basic per `OPENCODE_SERVER_URL` |
| `LENS_LIMIT_TOKENS` / `LENS_LIMIT_COST` / `LENS_LIMIT_STEPS` | – | budget giornalieri per la barra «Oggi» (token e step interi, costo in USD); ognuno è facoltativo |
| `LENS_LIMIT_TOKENS_WEEKLY` / `LENS_LIMIT_COST_WEEKLY` / `LENS_LIMIT_STEPS_WEEKLY` | – | budget della settimana di calendario, da lunedì 00:00 (stesse regole dei giornalieri) |
| `LENS_LIMIT_TOKENS_MONTHLY` / `LENS_LIMIT_COST_MONTHLY` / `LENS_LIMIT_STEPS_MONTHLY` | – | budget del mese di calendario, dal giorno 1 |
| `LENS_MODEL_LIMITS` | – | budget giornaliero di token per modello (`provider/modello=token`, separati da virgola): si imposta dalla card «Budget per modello» delle Impostazioni, con i modelli della configurazione di OpenCode (vedi [Budget per modello](#budget-per-modello)) |
| `LENS_MODEL_PRICES` | – | listino prezzi per modello, in dollari per milione di token (`provider/modello=input:output[:cacheLetta[:cacheScritta]]`, separati da virgola): si imposta dalla card «Listino prezzi» delle Impostazioni (vedi [Listino prezzi](#listino-prezzi)) |
| `LENS_RESET_HOUR` | `0` | ora in cui inizia il giorno dei budget: `0`–`23` in ora locale, oppure con `Z` in UTC (`0Z`) |
| `LENS_LABELS` | – | etichette `chiave=valore,…` aggiunte a ogni serie di `/metrics` e all'export OTLP (nomi: lettere, cifre, `_`) |
| `LENS_OTLP_ENDPOINT` | – | URL base di un collector OTLP/HTTP, es. `http://127.0.0.1:4318`: attiva l'export |
| `LENS_OTLP_HEADERS` | – | header `chiave=valore,…` per l'autenticazione del collector (segreto) |
| `LENS_OTLP_INTERVAL` | `60` | secondi tra un export e il successivo, tra 10 e 3600 |
| `LENS_OTLP_TEMPORALITY` | `cumulative` | `delta` per Datadog |
| `LENS_OTLP_TRACES` | `1` | `0` per inviare solo le metriche |
| `LENS_SECURITY_DIRS` | `$XDG_DATA_HOME/opencode` e la sua sottocartella `security/` (di solito `~/.local/share/opencode`) | cartelle in cui cercare gli audit dei guard DLP (`<nome>.audit.jsonl`), separate da `:`; solo lettura. Vedi [sicurezza.md](sicurezza.md#cartelle-cercate). **Impostazione del modulo Security**: si legge solo a modulo attivo e si cambia dalla scheda del modulo in Impostazioni › Moduli. |
| `LENS_SECURITY_CONFIG_DIR` | la cartella di configurazione di OpenCode (`$XDG_CONFIG_HOME/opencode`, di solito `~/.config/opencode`) | dove cercare le policy dei guard (`<nome>.json`) e i loro plugin (`plugins/<nome>*`); solo lettura. **Impostazione del modulo Security**: si legge solo a modulo attivo e si cambia dalla scheda del modulo in Impostazioni › Moduli. |
| `LENS_BOB` | – | **deprecata**: IBM Bob è un modulo (vedi [IBM Bob](#ibm-bob)). La lens la ignora, qualunque valore abbia, e scrive una riga nel log solo se ha un valore non vuoto; Impostazioni offre «Rimuovi» e rifiuta di impostarla |
| `LENS_BOB_DB` | `~/.bob/db/bob.db` | il database dei task di Bob, letto in sola lettura. **Impostazione del modulo IBM Bob**: si legge solo a modulo attivo e si cambia dalla scheda del modulo in Impostazioni › Moduli. |
| `LENS_BOB_INTERVAL` | `30` | secondi tra una lettura di Bob e la successiva, tra 5 e 3600. **Impostazione del modulo IBM Bob**: si legge solo a modulo attivo e si cambia dalla scheda del modulo in Impostazioni › Moduli. |
| `LENS_BOB_COIN_USD` | `0.5` | valore in USD di un Bobcoin, per sommare i costi di Bob a quelli di OpenCode. **Impostazione del modulo IBM Bob**: si legge solo a modulo attivo e si cambia dalla scheda del modulo in Impostazioni › Moduli. |
| `LENS_BOB_COINS_MONTHLY` | – | Bobcoin inclusi nel piano ogni mese (50 Pro, 180 Pro+, 1000 Ultra), per la barra del mese della pagina Bob. **Impostazione del modulo IBM Bob**: si legge solo a modulo attivo e si cambia dalla scheda del modulo in Impostazioni › Moduli. |
| `LENS_MODULES` | – | moduli da attivare, id separati da virgola (per esempio `sistema`); spenti di partenza. Un id non valido o ripetuto è un errore, uno sconosciuto è ignorato con un avviso nel log. Si cambia da Impostazioni › Moduli, oppure da shell fuori da launchd. Vedi [moduli.md](moduli.md) |
| `LENS_MCP_ERROR_TEXT` | – | solo nell'ambiente del server MCP, non nel plist: `1` per dare al modello il testo degli errori anche fuori da una sessione singola (vedi [Server MCP per OpenCode](#server-mcp-per-opencode)) |

I valori vengono controllati all'avvio: se uno non è valido la lens non parte e stampa **tutti** gli errori insieme (anche `npm run check`). Le variabili `LENS_*` che la lens non conosce, di solito errori di battitura come `LENS_PROT`, non bloccano l'avvio: finiscono come avviso nel log e nella pagina Impostazioni.

Le variabili che dichiara un modulo (oggi `LENS_SECURITY_DIRS` e `LENS_SECURITY_CONFIG_DIR`, del modulo Security) sono **impostazioni del modulo**: la lens le conosce anche a modulo spento, ma le legge solo a modulo attivo, e si modificano dalla sua scheda in **Impostazioni › Moduli**, mai dai file dei moduli; i valori si vedono solo da questo computer e un segreto non si vede mai. `--help` non le elenca: stanno nel manifesto del modulo (vedi [moduli.md](moduli.md#le-impostazioni-di-un-modulo)).

## Modifica dalla dashboard

Con la lens installata come servizio (`opencode-lens service install`, LaunchAgent di macOS) la tabella **Variabili d'ambiente** della pagina Impostazioni è un modulo: ogni variabile ha il valore scritto nel plist accanto a quello in uso. *Salva e riavvia*:

1. controlla i valori con le stesse regole dell'avvio e, se qualcosa non va, mostra **tutti** gli errori senza toccare niente;
2. se cambiano porta o interfaccia, verifica che la nuova porta sia libera;
3. riscrive solo `EnvironmentVariables` del plist (su una copia controllata con `plutil -lint`, poi sostituita);
4. ricarica il servizio (`launchctl bootout` + `bootstrap`, perché launchd legge l'ambiente solo al caricamento); la pagina aspetta che la lens riparta, o porta al nuovo indirizzo se è cambiata la porta.

Un campo vuoto toglie la variabile (torna il default). I segreti (`LENS_TOKEN`, `OPENCODE_SERVER_PASSWORD`, `LENS_OTLP_HEADERS`) non vengono mai mostrati: un campo vuoto li lascia come sono, *rimuovi* li cancella. Le variabili `LENS_*` sconosciute trovate nel plist si possono togliere con un pulsante; lo stesso vale per `LENS_BOB`, che la lens non legge più (pulsante «Rimuovi»). Se il plist è stato modificato a mano e non ancora ricaricato, la pagina lo segnala e un salvataggio senza modifiche lo applica.

Le modifiche si accettano solo da questo computer (connessione da `127.0.0.1` o `::1`), anche quando la dashboard è raggiungibile da rete, e con `LENS_TOKEN` serve il token come per il resto. Se cambi `LENS_TOKEN` dovrai riaprire la dashboard con `?token=` nuovo. Se la lens non riparte (per esempio porta occupata nel frattempo), il motivo è nel log.

Per riavviare la lens senza cambiare nessuna variabile (per esempio dopo aver aggiunto a mano un modulo nella cartella dei moduli) c'è il riquadro **Servizio** in fondo a Impostazioni › Generale, con il pulsante *Riavvia la lens*: chiede conferma, ricarica il servizio come *Salva e riavvia* ma senza toccare il plist, aspetta che la lens riparta e resta nella stessa sezione. Valgono le stesse regole delle altre modifiche (solo da questo computer, solo con la lens installata come servizio): in caso contrario il pulsante è disabilitato e ne dice il motivo. È disabilitato anche quando il plist non si legge (ricaricarlo lascerebbe la lens ferma) o ha variabili modificate a mano e non ancora applicate: ricaricarlo le applicherebbe senza le verifiche di *Salva e riavvia*, che è il modo di applicarle. Dietro c'è `POST /api/restart` (vedi [metriche](metriche.md)).

Esempio, per seguire un server standalone:

```bash
OPENCODE_SERVER_URL=http://127.0.0.1:4096 OPENCODE_SERVER_PASSWORD=… npm start
```

## Lingua e formato

La dashboard esiste in italiano, inglese e francese. Le due scelte sono indipendenti e si fanno nella pagina **Impostazioni**, card **Lingua e formato**:

- **Lingua** (`LENS_LANG`): `Automatico` segue la prima lingua del browser tra italiano, inglese e francese; se nessuna è supportata, l'interfaccia è in inglese. Una lingua forzata vale per tutti i browser che aprono la dashboard.
- **Formato** (`LENS_LOCALE`): date, ore e numeri. `Automatico` usa il primo formato con regione del browser, se è tra quelli offerti (`it-IT`, `en-US`, `en-GB`, `fr-FR`), altrimenti quello abituale della lingua scelta (`it-IT`, `en-US`, `fr-FR`). Si può avere la dashboard in inglese con date e ore all'italiana, o il contrario.

Il salvataggio ricarica la pagina nella nuova lingua. Le scelte stanno nel plist come le altre variabili, non nel browser. Il browser manda la lingua scelta al server (`X-Lens-Lang`, `X-Lens-Locale`) e anche i testi che il server scrive per le persone (errori, descrizioni, stato) la seguono; senza queste intestazioni sono in italiano. Restano in italiano il log, i `HELP` di `/metrics` e l'output dello strumento MCP.

Alcuni termini tecnici non si traducono in nessuna delle tre lingue (token, prompt, cache, budget, step, tool, retry, agent, provider, widget, dashboard…). Come aggiungere o correggere una traduzione: [traduzioni.md](traduzioni.md).

## Budget

La barra «Oggi» in cima alla dashboard confronta il giorno corrente con i budget che imposti. Senza budget mostra solo l'uso. Per esempio, 5 milioni di token e 300 step al giorno:

```bash
LENS_LIMIT_TOKENS=5000000 LENS_LIMIT_STEPS=300 npm start
```

Con il LaunchAgent aggiungili in `EnvironmentVariables` del plist e ricarica il servizio; una nuova esecuzione di `opencode-lens service install` non li cancella. Gli stessi valori sono in `/metrics` (`opencode_lens_daily_limit`) per costruirci un'allerta.

Settimana e mese hanno budget propri, a calendario in ora locale (settimana da lunedì 00:00, mese dal giorno 1). Li usa l'app [OpenCode Lens Monitor](https://github.com/vale76p/opencode-lens-monitor-public) per la percentuale nella barra, le card e i widget, leggendoli da `/api/budget`. Esempio, 50 milioni di token a settimana e 200 milioni al mese:

```bash
LENS_LIMIT_TOKENS_WEEKLY=50000000 LENS_LIMIT_TOKENS_MONTHLY=200000000 npm start
```

Per ogni periodo e metrica `/api/budget` riporta usato, limite, rapporto, proiezione lineare a fine periodo (solo dopo 1 ora per il giorno, anche nei giorni del cambio d'ora, e dopo 1/24 del periodo per settimana e mese: 7 ore per la settimana) e il ritmo: `none` senza limite, `under`, `over` se la proiezione supera il limite, `exceeded` se il limite è già superato.

### Budget per modello

Quando ogni modello ha una quota propria, per esempio un server aziendale con 4 modelli locali e 100 milioni di token al giorno ciascuno, imposta i budget dalla pagina **Impostazioni**, card **«Budget per modello»**.

I modelli arrivano dalla **configurazione globale di OpenCode**: i file `opencode.jsonc`, `opencode.json` e `config.json` in `~/.config/opencode` (o `$XDG_CONFIG_HOME/opencode`), sezione `providers` → `<provider>` → `models` (anche `provider` dello schema precedente). Ogni modello diventa `provider/modello`, il nome della tabella per modello della dashboard; il suo `name`, se c'è, compare accanto. Per esempio:

```jsonc
{
  "providers": {
    "azienda": {
      "package": "aisdk:@ai-sdk/openai-compatible",
      "settings": { "baseURL": "http://llm.azienda.lan/v1" },
      "models": {
        "qwen3-coder": { "name": "Qwen3 Coder" },
        "llama-4": { "name": "Llama 4" }
      }
    }
  }
}
```

- Accanto a ogni modello scrivi i **token al giorno**: un intero, oppure `100M`, `1,5M`, `500k`, `2G`. Vuoto = nessun budget. «Salva e riavvia» scrive `LENS_MODEL_LIMITS` nel LaunchAgent e riavvia la lens; il pulsante salva insieme anche le modifiche della card «Variabili d'ambiente».
- `LENS_MODEL_LIMITS` non si modifica più a mano: nella tabella delle variabili è in sola lettura, e la pagina rifiuta di cambiarla da lì.
- **Storico**: un modello che sparisce o cambia nome nella configurazione di OpenCode non conta più (sparisce dal widget e dai gauge), ma il suo budget resta in fondo alla card, in sola lettura, come «non più nella configurazione». Se il modello torna, ritrova il budget.
- La configurazione si rilegge quando cambia, senza riavviare la lens.
- **Configurazione non disponibile** (nessun file, JSON non valido, file non leggibile): la card lo segnala con il percorso e l'errore, i budget restano tutti attivi e non si possono cambiare finché la configurazione non torna leggibile.
- Tutte le varianti di un modello (`#high` e simili) consumano lo stesso budget.
- Un modello che la lens non ha mai visto viene segnalato nel widget e nel gauge («mai visto»).
- Contano gli step del modello. I task interni di OpenCode (titoli, compaction) non hanno un modello nel database e restano fuori, mentre il server li conta: tieni un po' di margine.
- Senza il LaunchAgent (lens avviata a mano o dashboard aperta da un altro computer) la card è in sola lettura; in quel caso `LENS_MODEL_LIMITS` si passa ancora come variabile d'ambiente, nel formato `provider/modello=token,…`.

Si vedono nel widget «Per modello oggi» e nei gauge «Budget giornaliero di un modello» (vedi [dashboard.md](dashboard.md)), e in `/api/budget` sotto `periods.day.models`.

### Listino prezzi

La card «Listino prezzi» (Impostazioni › Budget) è il listino dei prezzi per modello: i moduli lo usano per stimare un costo. Non cambia il costo che mostra la lens, che resta quello calcolato da OpenCode.

- Le righe sono i modelli della configurazione di OpenCode, quelli usati negli step degli ultimi 90 giorni e quelli già col prezzo, con i token degli ultimi 30 giorni.
- Per ogni modello scrivi i dollari per milione di token: **input** e **output**, e a scelta **cache letta** e **cache scritta**. Se non li scrivi, la cache letta vale il 10% dell'input e la cache scritta quanto l'input. Il ragionamento si paga come l'output.
- «Salva e riavvia» scrive `LENS_MODEL_PRICES` nel LaunchAgent, nel formato `provider/modello=input:output[:cacheLetta[:cacheScritta]],…` (per esempio `anthropic/claude-sonnet=3:15`). Come `LENS_MODEL_LIMITS`, non si modifica a mano. Le chiavi con spazi, `?` o `#` sono rifiutate.
- Le varianti di un modello (`provider/modello#variante`) hanno il prezzo del modello base. Un modello senza prezzo resta senza prezzo: la lens non lo inventa.
- Lo stimato conta solo gli step, come lo speso, senza i task interni di OpenCode.

### Ora di reset

Il giorno dei budget parte a mezzanotte. Se il server che applica la quota azzera a un'altra ora, impostala in `LENS_RESET_HOUR`:

```bash
LENS_RESET_HOUR=2     # dalle 02:00 locali alle 02:00 del giorno dopo
LENS_RESET_HOUR=0Z    # da mezzanotte UTC: le 02:00 in Italia d'estate, le 01:00 d'inverno
```

Con la `Z` l'ora resta giusta anche quando cambia l'ora legale. Vale per tutti i budget giornalieri (`LENS_LIMIT_*` e `LENS_MODEL_LIMITS`), per «Oggi», per il giorno di «Oggi», per i gauge del giorno, per `/api/today` e per `opencode_lens_today` in `/metrics` e OTLP. Settimana e mese restano a calendario (lunedì 00:00 e giorno 1 00:00, ora locale), come i grafici per giorno e il calendario dell'ultimo anno: con un'ora di reset diversa da 0 la somma dei giorni dei budget può non coincidere esattamente con la settimana.

## Retention dei dettagli

Di default la lens tiene tutto per sempre. Con `LENS_RETENTION_DAYS`, un intero tra 400 e 36500, cancella gli step e le chiamate tool di OpenCode più vecchi di quel numero di giorni, contati dalla mezzanotte locale; non impostata, o vuota, la retention è spenta. Si imposta anche da **Impostazioni › Generale › Conserva i dettagli**. Il minimo di 400 giorni lascia esatte tutte le finestre fisse della dashboard, nessuna delle quali va oltre i 370 giorni del calendario: giorni, ore, ritmo, budget di giorno, settimana e mese.

- **Cosa cancella**: solo le righe `steps` e `tools` di OpenCode.
- **Cosa resta**: sessioni, prompt, run, task interni, segnali (retry, compaction, esecuzioni fallite), permessi, uso delle skill e tutti i dati di IBM Bob.
- **Cosa resta nei numeri**: prima di cancellare un giorno la lens ne somma step e tool in un riepilogo giornaliero (`daily_steps` per sessione, modello e agente; `daily_tools` per nome del tool) e salva in `counter_offsets` quanto contavano in `/metrics` (vedi [Contatori che non calano](metriche.md#contatori-che-non-calano)). Così i totali del riepilogo di «Tutto», i contatori di `/metrics` e dell'export OTLP e il controllo *Σ step + Σ task interni = totali di OpenCode* (anche `npm run verify`) non cambiano. Un resync non rimette le righe potate: la lens non riscrive step e tool più vecchi del limite.
- **Quando**: 60 secondi dopo l'avvio e poi ogni 6 ore, un giorno per transazione; tra un giorno e l'altro il collector e la dashboard continuano a lavorare. Nel log: `retention: N giorni potati (… step, … tool) prima del …`.
- **Il file non si restringe**: la lens non fa `VACUUM`. Lo spazio liberato si riusa per le righe nuove.

Limiti:

- In «Tutto» grafici, ripartizioni (per modello, agente, cartella…), sessioni, prompt, dettaglio della sessione, latenza e velocità mostrano solo le righe conservate; solo i totali del riepilogo (`/api/summary`: step, step falliti, costo, token, sessioni e modelli distinti, chiamate ed errori dei tool) comprendono i giorni potati.
- Un prompt (run) di un giorno potato resta, con esito e durata, ma senza step, token e costo; un retry di quei giorni resta, ma senza il modello.
- In un periodo scelto a mano un giorno potato conta nei totali solo se il periodo ne contiene la mezzanotte, così due periodi adiacenti non lo contano due volte. Fa eccezione il periodo che contiene l'inizio della riga potata più vecchia, come «Tutto»: conta anche il giorno in cui comincia.
- IBM Bob non è potato: le sue tabelle crescono come prima.
- Impostazioni e `/api/status` non mostrano lo stato della retention: c'è solo la riga del log.

## Export OTLP

Per mandare metriche e tracce a un collector OpenTelemetry, a Grafana Cloud o a Datadog:

```bash
# OpenTelemetry Collector locale
LENS_OTLP_ENDPOINT=http://127.0.0.1:4318 npm start

# Grafana Cloud
LENS_OTLP_ENDPOINT=https://otlp-gateway-prod-eu-west-2.grafana.net/otlp \
LENS_OTLP_HEADERS="Authorization=Basic <base64 istanza:token>" npm start

# Datadog: solo delta
LENS_OTLP_ENDPOINT=https://otlp.datadoghq.eu LENS_OTLP_HEADERS="dd-api-key=<chiave>" LENS_OTLP_TEMPORALITY=delta npm start
```

Nella pagina Impostazioni e nel log l'endpoint compare senza credenziali (`utente:password@` e query string nascosti). La lens usa OTLP/HTTP con codifica JSON, senza SDK: l'endpoint deve accettarla (il Collector e i servizi citati la accettano su `/v1/metrics` e `/v1/traces`). `LENS_OTLP_HEADERS` contiene di solito un segreto: tienilo fuori dal controllo di versione. Cosa viene inviato: [metriche.md](metriche.md#export-otlp).

## Prezzi per i modelli locali

Il costo lo calcola OpenCode, non la lens, dai prezzi per milione di token dichiarati nella config del modello. Per i modelli locali è 0, a meno che tu non dichiari un prezzo nella config di OpenCode:

```jsonc
{
  "providers": {
    "lmstudio-local": {
      "package": "aisdk:@ai-sdk/openai-compatible",
      "settings": { "baseURL": "http://127.0.0.1:1234/v1" },
      "models": {
        "qwen3.5-9b": { "cost": { "input": 0.1, "output": 0.4, "cache": { "read": 0.01, "write": 0 } } }
      }
    }
  }
}
```

## Server MCP per OpenCode

`opencode-lens mcp` è un server [MCP](https://modelcontextprotocol.io) su stdio: i modelli che lavorano in OpenCode V2 possono chiedere a Lens budget, errori, uso, sessioni e cosa hanno fatto i guard DLP, e ricevere le skill di un preset che scegli tu (vedi [Prompt](#prompt)). Parla solo con l'API HTTP della lens su `127.0.0.1`, non apre il database e non cambia né i modelli né la configurazione di OpenCode. Non è di sola lettura: quando consegna un preset (`prompts/get` o lo strumento `preset`) lo riporta alla lens con `POST /api/skill-loads` (id del preset e delle skill consegnate, mai testi), per contare l'uso. Con una lens spenta o vecchia la consegna arriva comunque al modello e il conteggio si perde in silenzio. Lo strumento `preset`, i comandi `/lens:<id>` e il conteggio delle consegne ci sono solo con il modulo **Skill** attivo (vedi [moduli.md](moduli.md#skill)); spento, `/api/skill-loads` risponde 404 e la consegna non è contata.

### Installazione

Il modo più semplice è la sezione **Server MCP** di Impostazioni nella dashboard. Ha tre schede, tutte già compilate con i percorsi di questa installazione e con il pulsante «Copia»:

- il comando da eseguire;
- lo stesso server come blocco per `opencode.jsonc`;
- un prompt da incollare in OpenCode perché sia il modello ad aggiungere il server. Il prompt modifica solo `mcp.servers.lens` e non tocca né agenti né permessi.

Nella stessa sezione si vede se il server gira. Lo stato lo legge da OpenCode (`GET /api/mcp`, per la cartella di default del servizio) e dalla configurazione globale: Lens riconosce il server dal nome `lens` e non scrive mai nella configurazione di OpenCode. Per accenderlo o spegnerlo si usa OpenCode (`"disabled": true`, oppure togliendo il permesso `lens_*` agli agenti), poi `opencode2 reload`.

La riga «MCP in esecuzione» dice quale versione dell'MCP ha chiamato la lens per ultima e quando. Se non è quella della lens (tipico dopo un aggiornamento: l'MCP è un processo figlio di OpenCode e resta quello vecchio), compare l'avviso «OpenCode da riavviare»: vedi [Il server MCP: riavvia OpenCode](aggiornamento.md#il-server-mcp-riavvia-opencode).

Da terminale:

```bash
opencode-lens mcp install
```

Il comando stampa la riga da eseguire, con percorsi assoluti: il `node` e il `main.js` del LaunchAgent, oppure, senza servizio, quelli del processo che l'ha lanciato. Per esempio:

```bash
opencode2 mcp add --global lens -- /opt/homebrew/opt/node/bin/node /Users/tu/Applications/opencode-lens/src/main.js mcp
```

La riga aggiunge `mcp.servers.lens` alla configurazione globale di OpenCode. OpenCode avvia il comando senza shell, quindi niente `~`. Un aggiornamento della lens non richiede di ripeterla, perché il percorso resta lo stesso. Va rifatta solo se l'app cambia cartella o se cambia il Node del plist.

Porta e token vengono dalle `EnvironmentVariables` del LaunchAgent, quindi il token non finisce in chiaro in `opencode.jsonc`. Nell'ambiente del server MCP (`--env` di `opencode2 mcp add`) `LENS_PORT`, `LENS_TOKEN` e `LENS_RESET_HOUR` prevalgono sul plist. Senza plist valgono i default (`4777`, nessun token). L'MCP si collega sempre a `127.0.0.1`: se la lens ascolta solo su un indirizzo di rete (`LENS_HOST` diverso da `0.0.0.0` e dalla loopback), l'MCP non la raggiunge.

### Strumenti

OpenCode li mostra con il prefisso del server: `lens_budget`, `lens_errors`, `lens_usage`, `lens_sessions`, `lens_module_guide`, `lens_module_check`, `lens_security` (solo con il modulo Security attivo) e `lens_preset` (solo con il modulo Skill attivo). I permessi per agente si danno su queste azioni. Leggono tutti dalla lens; l'unica scrittura è il conteggio delle consegne di `preset` (vedi sopra), che non cambia niente di ciò che il modello riceve. `module_check` fa una `POST /api/modules/check`, ma è solo una domanda: la lens giudica il modulo senza attivarlo né cambiare niente. Per giudicarlo, però, ne esegue il codice nel processo della lens: per questo `module_check` non è dichiarato di sola lettura.

Dopo l'aggiornamento della lens che li porta, `lens_module_guide` e `lens_module_check` compaiono in OpenCode solo dopo averlo riavviato (vedi [Il server MCP: riavvia OpenCode](aggiornamento.md#il-server-mcp-riavvia-opencode)).

| Strumento | Argomenti | Domande tipiche |
|---|---|---|
| `budget` | – | «quanto mi resta oggi su Opus?», «a questo ritmo sforo la settimana?» |
| `errors` | `since` (`1h`, `6h`, `24h`, `7d`; default `24h`), `session` (`current` o un id), `scope` (`project` o `all`), `limit` (1–30) | «perché le richieste vanno in errore da stamattina?», «cosa è successo a questa sessione?» |
| `usage` | `range` (`today`, `yesterday`, `7d`, `30d`, `month`; default `7d`), `by` (`model`, `provider`, `agent`, `tool`, `day`), `compare` | «confronta questa settimana con la scorsa», «quale agente costa di più?» |
| `sessions` | `range`, `sort` (`cost`, `tokens`, `errors`, `recent`), `limit` (1–20), `scope`, `id` (`current` o un id) | «le sessioni più care del mese», «dettaglio di questa sessione» |
| `module_guide` | `section` (facoltativo: il titolo, o parte del titolo, di una sezione della guida) | «scrivi un modulo di Lens che mostra i file di una cartella», «cosa devo sapere dei widget di un modulo?» |
| `module_check` | `id` (il modulo, cioè il nome della sua cartella: minuscole, cifre e trattini) | «controlla il modulo mio-modulo» |
| `security` | `guard` (il nome), `session` (`current` o un id), `scope` (`project` o `all`), `since` (`1h`, `6h`, `24h`, `7d`; default `24h`), `outcome` (`blocked`, `allowed`, `all`), `limit` (1–30) | «cosa hanno bloccato i guard DLP oggi?», «il guard Context7 sta funzionando?» |
| `preset` | `name` (l'id o il nome di un preset; l'id è quello di `/lens:<id>`), `skill` (l'id di una skill della libreria) | «quali preset di skill ho in Lens?», «usa il preset angular-security per questo lavoro» |

Come lavorano:
- **Sessione chiamante.** Viene da `_meta["ai.opencode/sessionID"]`, che OpenCode aggiunge a ogni chiamata. `errors` e `sessions` stanno per default nel progetto (la cartella) di quella sessione; con `scope: "all"` si vedono tutte.
- **Errori.** Sono raggruppati per fonte (step, tool, retry, esecuzione fallita), modello, tipo e status HTTP. I retry e le esecuzioni fallite esistono solo da quando Lens li vede dal vivo: la risposta dice da quando li conta. Se un errore ha interrotto la sessione corrente, la domanda si fa nel turno successivo.
- **Confronti.** `compare` confronta con il periodo immediatamente precedente, alla stessa durata trascorsa (oggi fino alle 10:40 contro ieri fino alle 10:40). Le differenze le calcola l'MCP, il modello le riporta e basta. I giorni sono quelli dei budget, come in dashboard (`LENS_RESET_HOUR`).
- **Budget.** Sono i limiti che hai scelto tu (`LENS_LIMIT_*`, `LENS_MODEL_LIMITS`), non le quote del provider: Lens non vede quanto resta presso il provider. Con una sessione in corso c'è anche il riempimento del contesto.
- **Cambio di modello.** L'MCP non cambia modello né configurazione. Le sue istruzioni dicono al modello che il passaggio automatico a un modello di riserva, quando il provider esaurisce la quota o non risponde, lo fa il [plugin lens-guard](#plugin-lens-guard-cambio-di-modello-quando-il-provider-non-risponde), e che i budget di Lens per ora non fanno cambiare modello.
- **Security.** Solo con il modulo Security attivo. Dice cosa i guard DLP trovati nelle cartelle di OpenCode (oggi Context7 Guard) hanno lasciato passare o bloccato, con le categorie rilevate, la salute del guard e la sua policy globale; senza `guard` e con più guard dà il riepilogo. Mai il testo dei rilevamenti né le anteprime, e gli elenchi della policy solo come «N voci». Un tool fallito con «GUARD — invio bloccato» è un blocco DLP, non un guasto: si chiede qui. Dettagli in [sicurezza.md](sicurezza.md#tool-mcp-security).
- **Moduli e riavvio di OpenCode.** Gli strumenti di un modulo (oggi `security` e `preset` di Skill) e le righe che aggiungono alle istruzioni del server ci sono solo con il modulo attivo. L'MCP se ne accorge entro 30 secondi e lo comunica a OpenCode con `notifications/tools/list_changed`, ma OpenCode (verificato con la 2.0.26) non rilegge né gli strumenti né le istruzioni: dopo aver acceso o spento un modulo con strumenti **riavvia OpenCode**. Fino ad allora vede il vecchio elenco, e uno strumento di un modulo spento risponde «Il modulo <Nome> è spento in Lens: attivalo da Impostazioni › Moduli.». Vedi [moduli.md](moduli.md#gli-strumenti-mcp-di-un-modulo).
- **Preset.** Senza argomenti `preset` dà l'elenco aggiornato dei preset (id, nome, brief, skill). Con `name` dà le skill di quel preset; con `skill` (e `name` omesso) una sola skill della libreria, utile quando il testo di un preset è stato abbreviato (se ci sono entrambi vale `skill`); un corpo oltre 48 KiB o 1900 righe è tagliato a fine riga, con una nota che rimanda a `SKILL.md`. `name` è l'id o il nome del preset: vale prima l'id, poi il nome visualizzato (senza distinzione di maiuscole né spazi ai bordi; se più preset hanno lo stesso nome si chiede l'id). Un `name` che non esiste è un errore in italiano che elenca gli id validi (al massimo 30) e rimanda all'elenco. Ogni consegna riuscita viene contata (vedi [Uso delle skill](metriche.md#uso-delle-skill)). Non è un'osservazione di OpenCode: sono istruzioni tue, vedi [Prompt](#prompt) e [Cosa arriva al modello](#cosa-arriva-al-modello). Solo con il modulo Skill attivo: OpenCode non rilegge l'elenco degli strumenti, quindi lo strumento compare o sparisce solo dopo un riavvio di OpenCode; con Skill spento risponde «Il modulo Skill è spento in Lens: attivalo da Impostazioni › Moduli.»
- **Scrivere un modulo.** `module_guide` e `module_check` sono strumenti del nucleo, sempre presenti (nessun modulo li accende), per far scrivere a un modello un modulo nella cartella dei moduli dell'utente (vedi [moduli.md](moduli.md)). `module_guide` dà la guida dell'app (`docs/moduli-custom.md`) o, con `section`, solo la sezione il cui titolo contiene quel testo (maiuscole ininfluenti; senza corrispondenze elenca i titoli), più i valori di questa installazione letti da `GET /api/modules/authoring`: cartella dei moduli dell'utente, versione della lens, id, variabili `LENS_…`, percorsi `/api`, strumenti MCP e tipi di widget già presi, tetti dei widget. Se la guida manca lo dice e dà comunque i valori; se la lens non risponde dà la guida e dice che i valori mancano. `module_check` chiede a `POST /api/modules/check` di giudicare il modulo nella cartella dell'utente come all'avvio, senza attivarlo (ne esegue però il codice di primo livello, `module.js`, `tables.js` e `server/index.js`, e `configure()`, nel processo della lens): risponde «OK» oppure gli errori e gli avvisi, uno per riga (con `isError` se ci sono errori), anche per un modulo nuovo che la lens non ha ancora scoperto; il modello corregge e richiama finché è «OK». Un modulo non può dichiarare strumenti con questi nomi. Come per gli altri strumenti nuovi, compaiono in OpenCode dopo un suo riavvio. Funzionano solo da questo computer: i due percorsi della lens rifiutano chi non è in locale.
- **Freschezza.** Ogni risposta finisce con una riga sullo stato del collector, sull'ultimo evento visto e sul drift dell'API di OpenCode.
- **Errori dell'MCP.** Se Lens è spenta o il token è sbagliato, lo strumento risponde con un errore in italiano che dice cosa controllare (`opencode-lens service status`, `LENS_TOKEN`).

Supporta le revisioni MCP 2025-11-25 (`initialize`) e 2026-07-28 (`server/discover`). OpenCode 2.0.26 usa la prima.

### Prompt

Un **preset** raggruppa skill della libreria di Lens (pagina **Skill**, vedi [dashboard.md](dashboard.md#skill)) sotto un id che scegli tu, un nome e un brief. L'MCP li offre in tre modi: Sono una funzione del modulo Skill: i comandi, lo strumento e le istruzioni qui sotto ci sono solo con il modulo attivo (Impostazioni › Moduli).

- **Prompt.** Uno per preset: `name` è l'id del preset, `title` il nome, `description` il brief, su una riga e senza virgolette «». In OpenCode diventano i comandi `/lens:<id>`: scrivere `/lens:api-docs` seguito dal compito consegna al modello le skill del preset. `prompts/get` risponde con un messaggio che comincia con «Usa queste skill per il compito che segue.» e prosegue con il testo del preset (vedi [Cosa arriva al modello](#cosa-arriva-al-modello)). I comandi seguono `notifications/prompts/list_changed`: accendere o spegnere Skill li fa comparire o sparire in OpenCode senza riavvio (lo strumento `preset`, invece, cambia solo dopo un riavvio di OpenCode).
- **Strumento.** `preset` (vedi [Strumenti](#strumenti)), per quando è il modello a decidere: «usa il preset angular-security per questo lavoro».
- **Istruzioni.** A `initialize` l'elenco dei preset (id, nome, brief e id delle skill) viene aggiunto alle istruzioni del server, così il modello sa che esistono e quando usarli: se il compito corrisponde al brief di un preset, deve chiederlo con `preset` prima di cominciare. L'elenco ha un tetto di circa 3000 caratteri: brief tagliati a 160, al massimo 300 caratteri di id di skill per preset, e se i preset non ci stanno tutti una riga finale dice quanti mancano («… e altri N preset: chiedi preset senza argomenti per l'elenco completo»). Una skill sparita dalla libreria è segnata «(assente)». Le istruzioni si leggono una volta per connessione, con 3 secondi di tempo: con Lens spenta o lenta restano quelle di sempre, senza elenco. L'elenco aggiornato e completo lo dà `preset` senza argomenti. L'elenco sta in coda alle istruzioni, dopo una riga vuota, e lo scrive il modulo Skill; le sue righe fisse (preset e consegne) seguono quelle degli strumenti del nucleo.

Se i preset cambiano (uno nuovo o tolto, o un nome, un brief o le skill di uno diverse), l'MCP lo vede entro 30 secondi, perché controlla ogni 30, e manda `notifications/prompts/list_changed`: il client rilegge `prompts/list`. Il punto di partenza è ciò che il client ha davvero ricevuto con l'ultimo `prompts/list` (un elenco vuoto se era fallito): una Lens che torna disponibile dopo quel fallimento viene annunciata subito, e lo stesso cambiamento non è annunciato a ogni controllo. Finché il client non ha chiesto niente, la prima lettura dopo l'avvio fissa solo il punto di partenza. Cambiare il testo di una skill non è un cambio dei preset: ogni richiesta rilegge la libreria, quindi arriva alla richiesta successiva.

Errori di `prompts/get`: senza `name`, o con un preset che non esiste, è `-32602` (richiesta non valida); con Lens spenta, token sbagliato o configurazione non valida è `-32603` (errore interno). Con Lens spenta, con un token sbagliato o con una configurazione non valida `prompts/list` risponde con un elenco vuoto e scrive il motivo su stderr, una volta per motivo. Con il modulo Skill spento, in errore o da configurare `prompts/get` risponde con un testo che lo dice (spento, in errore, da configurare), non con un errore generico.

### Cosa arriva al modello

Lens non salva prompt né output, ma alcuni campi possono contenerne dei pezzi:
- i messaggi d'errore dei provider possono citare la richiesta;
- gli errori dei tool sono output dei tool (stderr, pagine web);
- i titoli delle sessioni riassumono i prompt.

Mandarli a un modello, anche da una sessione all'altra, è un'uscita di dati e un possibile canale di prompt injection. Per questo l'MCP:
- per default manda solo classe d'errore, status HTTP e conteggi;
- manda il testo degli errori solo per una sessione (`session`, o `sessions` con `id`), oppure ovunque con `LENS_MCP_ERROR_TEXT=1`:

  ```bash
  opencode2 mcp add --global --env LENS_MCP_ERROR_TEXT=1 lens -- <node> <main.js> mcp
  ```
- da `security` non passano mai il testo dei rilevamenti (`detail`) né le anteprime degli argomenti, e i valori della policy che sembrano chiavi sono mascherati; gli oggetti delle chiamate, i nomi dei tool e le categorie sì, ripuliti come gli altri testi;
- ripulisce testi e titoli da a capo, caratteri di controllo, caratteri bidi e caratteri invisibili (larghezza zero, selettori di variante, riempitivi Hangul), li taglia a 160 caratteri (80 i titoli) e li mette tra «».

Il `preset` (strumento e prompt) è l'eccezione voluta: manda **testo**, quello delle tue skill, perché è il suo scopo. Non sono dati di OpenCode ma configurazione tua, che hai importato e scelto nella pagina Skill, e per questo il testo arriva così com'è, senza il taglio a 160 caratteri: l'MCP ripulisce soltanto i caratteri di controllo (a capo e tabulazioni restano, gli altri diventano uno spazio) e toglie quelli invisibili (larghezza zero) e quelli bidi; i selettori di variante restano, perché emoji come ✔️ li usano. Il nome e il brief del preset, nella prima riga, restano invece ripuliti su una riga e tra «», seguiti dall'elenco delle sue skill. Per ogni skill del preset arriva:

```
Preset «Documentare le API» (api-docs): «Mappa e documenta le API HTTP di un progetto, poi verifica a runtime.» · skill: api-explore, sparita (assente)
<skill_content name="api-explore">
# API Explore
…
Cartella base di questa skill: /Users/…/Application Support/opencode-lens/skills/api-explore/2
I percorsi relativi (scripts/, references/…) partono da lì.
<skill_files>
<file>/Users/…/skills/api-explore/2/references/discovery-heuristics.md</file>
</skill_files>
</skill_content>
Skill «sparita» assente dalla libreria di Lens.
```

- il corpo di `SKILL.md`, senza il frontmatter, dentro `<skill_content name="…">`;
- la **cartella base** assoluta della versione in uso («Cartella base di questa skill: …»): i percorsi relativi del testo (`scripts/`, `references/`…) partono da lì, e il modello li legge con i suoi strumenti;
- la descrizione della skill, intera fino a 1024 caratteri («Descrizione: …»);
- i percorsi assoluti degli altri file della skill, in `<skill_files>` (i primi 10), com'è su disco: spazi e virgolette restano, e un percorso con caratteri di controllo, bidi o invisibili non viene alterato ma omesso, con la nota «(N file con nomi non sicuri omessi)»;
- se una skill del preset non è più nella libreria, una riga che lo dice («Skill «sparita» assente dalla libreria di Lens.»);
- se una skill non si legge (Lens risponde con un errore diverso da «non trovata»), una riga «Skill «id» non leggibile ora: …» al suo posto: le altre arrivano lo stesso.

Il testo di tutte le skill di una risposta ha **tre tetti, che valgono insieme**: 40 000 caratteri, 48 KiB di byte UTF-8 e 1900 righe. OpenCode taglia il risultato di uno strumento a 50 KiB o 2000 righe, e un testo non latino pesa più byte che caratteri. Una skill che non ci sta nel totale arriva senza corpo, con la sua cartella e i suoi file e la nota di leggere `SKILL.md` con il tool `read` o di chiedere `preset` con `skill="<id>"`; una successiva più piccola può starci ancora, e se nemmeno quella forma ci sta arriva una riga sola; quando nemmeno le righe ci stanno, le ultime skill si riuniscono in una riga contata («… e altre N skill non incluse: …»). Con `skill` non c'è il tetto dei 40 000 caratteri ma restano i 48 KiB e le 1900 righe: un corpo che li supera è tagliato all'ultima riga intera che ci sta, con una nota che rimanda a `SKILL.md` nella cartella base, dove il modello legge il resto.

Lens non esegue mai una skill né i suoi script: li legge o li lancia il modello, con gli strumenti e i permessi che ha in OpenCode.

I file stanno in `~/Library/Application Support/opencode-lens/skills/`, fuori dal progetto su cui lavora OpenCode. Se `read` o `bash` chiedono conferma per i file di quella cartella, si può provare ad aggiungere in `permissions` della configurazione di OpenCode una regola che consenta `read` su quella cartella (Lens non scrive mai nella configurazione di OpenCode). È una possibilità, non ancora verificata.

## Esposizione remota

Per farla leggere da un Prometheus su un'altra macchina servono tre variabili. Senza token la lens si rifiuta di partire su un'interfaccia non locale.

```bash
LENS_HOST=0.0.0.0 LENS_TOKEN="$(openssl rand -hex 24)" LENS_ALLOWED_HOSTS="macbook.local:4777" npm start
```

Il token si può passare in tre modi:

- header `Authorization: Bearer <token>` (Prometheus: `authorization: { credentials: <token> }`);
- `?token=<token>` una volta nel browser: la lens risponde con un redirect che toglie il token dall'URL e imposta il cookie `lens_token` (`HttpOnly`, `SameSite=Strict`);
- cookie `lens_token`.

`LENS_ALLOWED_HOSTS` deve contenere il nome con cui la lens viene raggiunta, porta compresa: le richieste con un altro `Host` ricevono 403.

### Dietro un reverse proxy

Se la lens è pubblicata da un reverse proxy sullo stesso Mac (nginx, Caddy, `ngrok`, `cloudflared`, Tailscale Serve o Funnel), per la lens ogni richiesta arriva da `127.0.0.1`, anche quelle che vengono dalla rete. Se il proxy riscrive anche l'`Host`, il controllo sull'`Host` non basta più: in questo caso **imposta sempre `LENS_TOKEN`**, anche con `LENS_HOST=127.0.0.1`, altrimenti chiunque raggiunga il proxy legge tutti i dati.

Le modifiche (impostazioni, disposizione della dashboard, skill e preset, aggiornamento) non passano mai dal proxy: le richieste `POST` con header da proxy (`Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP`, `Via`, `CF-Connecting-IP`, `Tailscale-*`) ricevono 403, anche con il token giusto. Per modificarle apri la dashboard direttamente da questo Mac (`http://127.0.0.1:4777`). Ai client dietro un proxy `GET /api/settings` mostra `LENS_OTLP_ENDPOINT` oscurato, come `/api/about`. Il controllo vale solo per proxy che aggiungono almeno uno di questi header: verifica che il tuo lo faccia.

## Plugin lens-guard: cambio di modello quando il provider non risponde

`extras/opencode/lens-guard.v2.ts` è un plugin per OpenCode 2.x. Quando il provider non può rispondere, il turno continua su un modello di riserva: non serve rimandare il prompt. Lavora dentro OpenCode e non ha bisogno della lens: la lens vede solo il risultato, cioè lo step contato sul modello di riserva.

Il plugin cambia modello in tre casi:

- **quota esaurita**: 429 con `insufficient_quota`, `billing` o simili, errori che OpenCode non ritenta;
- **rate limit con un `Retry-After` lungo**: OpenCode aspetterebbe almeno `minRetryDelayMs` (60 secondi per default, fino a 15 minuti) prima di riprovare;
- **provider non raggiungibile**: connessione rifiutata, nome del server non risolto, rete assente. Una connessione che si interrompe a metà risposta non conta: OpenCode la ritenta sullo stesso modello.

Gli altri errori (autenticazione, content policy, rate limit brevi, errori interni del provider) restano a OpenCode, che li gestisce come sempre. Un rate limit breve resta tale anche quando il provider scrive «quota» nel messaggio, come fa Gemini per i limiti al minuto.

### Installazione

Con la lens installata dallo zip, il plugin è in `~/Applications/opencode-lens/extras/opencode/`:

```bash
cp ~/Applications/opencode-lens/extras/opencode/lens-guard.v2.ts ~/.config/opencode/plugins/
```

```bash
cp ~/Applications/opencode-lens/extras/opencode/lens-guard.example.json ~/.config/opencode/lens-guard.json
```

Modifica `lens-guard.json` e riavvia OpenCode. Gli aggiornamenti della lens non toccano la copia in `plugins/`: dopo un aggiornamento ripeti il primo comando se vuoi la versione nuova. Anche la disinstallazione della lens la lascia al suo posto.

### Configurazione

```json
{
  "fallback": {
    "anthropic/claude-opus-4-1": ["anthropic/claude-sonnet-4-5", "openai/gpt-5"]
  },
  "minRetryDelayMs": 60000
}
```

- `fallback`: per ogni modello, la catena di riserva in ordine. I modelli si scrivono `provider/modello`, come in `opencode2 models`; tutto quello che segue la prima `/` è l'id del modello (`openrouter/anthropic/claude-sonnet`).
- `minRetryDelayMs`: da quale attesa in millisecondi un rate limit fa cambiare modello. Default `60000`.

Il file è **JSON puro**: niente commenti né virgole finali. Un file con commenti o non valido, oppure un `fallback` che non è un oggetto, spegne il plugin senza errori e OpenCode continua come se non ci fosse. Le singole voci non valide vengono scartate: una senza `/`, un modello che rimanda a sé stesso, i doppioni.

Il file sta in `${XDG_CONFIG_HOME:-~/.config}/opencode/lens-guard.json`. `LENS_GUARD_CONFIG=/percorso/file.json` ne indica un altro, `LENS_GUARD=off` spegne il plugin. Sono variabili d'ambiente di OpenCode, non della lens.

### Come si comporta

- Il cambio avviene dentro il turno: OpenCode ritenta lo stesso step sul modello di riserva, senza attesa. Nella TUI compare la riga «Switched model from … to …», l'unico avviso: il plugin non aggiunge messaggi alla conversazione, che costerebbero uno step in più.
- Nella lens lo step ritentato compare una volta sola, sul modello di riserva, con 2 tentativi. L'errore del primo tentativo resta nei retry registrati dal vivo.
- La sessione **resta** sul modello di riserva anche nei turni successivi. Il plugin non torna indietro da solo: per tornare al modello di prima sceglilo di nuovo in OpenCode.
- Ogni catena si percorre **una sola volta per turno** e nessun modello viene riprovato nello stesso turno. La catena è quella del primo modello che fallisce: con `A → [B]` e `B → [A]`, se falliscono tutti e due c'è un solo cambio, poi l'errore resta a OpenCode. Al prompt successivo si riparte.
- Cambiare provider a metà conversazione fa perdere la prompt cache del provider di prima: il primo step sul modello di riserva paga di nuovo tutto il contesto.

## IBM Bob

Il modulo **IBM Bob**, da accendere in Impostazioni › Moduli (vedi [moduli.md](moduli.md)), legge i task di **IBM Bob** (Bob IDE 2.x e Bob Shell 2.x), che li tengono nello stesso database SQLite, `~/.bob/db/bob.db`. Bob non ha un'API né uno stream di eventi: la lens apre il file in sola lettura ogni `LENS_BOB_INTERVAL` secondi, rilegge i task che si sono mossi e li salva in tabelle sue (`bob_tasks`, `bob_requests`, `bob_tools`), create dal modulo e mai potate. Non tocca la configurazione di Bob e non salva mai titoli, prompt, testo dei messaggi, argomenti o output dei tool: solo cartella, modo, stato, tempi, costo, token e nomi dei tool (Bob non registra il modello che sceglie). Bob cancella i task dopo 30 giorni; la lens li tiene.

I numeri di OpenCode non cambiano: le tabelle di Bob sono separate, `/api/summary` resta quello di sempre e le serie `/metrics` di OpenCode sono identiche. Bob compare nella dashboard solo dove lo chiedi, con il selettore **OpenCode · + Bob · Solo Bob** (vedi [dashboard.md](dashboard.md#ibm-bob)); i Bobcoin diventano dollari con `LENS_BOB_COIN_USD`.

Le quattro variabili `LENS_BOB_*` della tabella sono **impostazioni del modulo**: si cambiano dalla sua scheda in Impostazioni › Moduli (`LENS_BOB_INTERVAL` tra 5 e 3600, `LENS_BOB_COINS_MONTHLY` almeno 1) e valgono solo a modulo attivo. **`LENS_BOB` non serve più**: chi la usava trova Bob spento dopo l'aggiornamento, perché la lens la ignora (una riga nel log), e un avviso in ogni pagina dice che Bob non viene più letto finché non lo riattivi da Impostazioni › Moduli e che ciò che Bob cancella nel frattempo è perso. «Rimuovi», in Impostazioni, toglie la variabile dal LaunchAgent. La scelta «+ Bob» o «Solo Bob» del selettore riparte da «OpenCode». Le tabelle `bob_*` restano nel database anche a modulo spento: righe e tabelle non si cancellano mai (vedi [disinstallazione.md](disinstallazione.md)).

Lo schema di bob.db non è documentato da IBM. Se cambia (manca una tabella o una colonna attesa) la lettura di Bob si sospende e la dashboard lo dice; OpenCode continua come prima. `node modules/bob/scripts/bob-probe.mjs` mostra lo schema del bob.db di questo computer e la forma dei suoi campi, senza testo. `node modules/bob/scripts/bob-probe.mjs --account` cerca invece dove Bob tiene il consumo del tuo account (Bobcoin usati, piano, rinnovo): lo stato salvato di Bob IDE, `~/.bob` e il codice di Bob IDE e Bob Shell; anche qui solo forme e nomi, mai testo né token. `--checks` verifica ciò che la lens dà per scontato: stima quanti Bobcoin costa un milione di token di ogni tipo (input nuovo, cache letta, cache scritta, output, con una regressione sulle chiamate: IBM non pubblica il cambio), controlla che `input` comprenda la cache, che il costo di un task sia la somma delle sue chiamate e se comprende i subagenti, conta i prompt nascosti e i giorni coperti e misura i messaggi che Bob scrive in ritardo: quanti ne scrive dopo uno più recente dello stesso task, il ritardo massimo e quanti superano i 60 secondi che la lens rilegge a ogni passata (in più conta i messaggi dell'assistente senza `_meta.spend`). Le tre sonde si lanciano anche dal pannello di IBM Bob in **Impostazioni › Moduli**, solo da questo computer e solo con il modulo acceso: il risultato si copia o si scarica come file di testo.

## Sicurezza e privacy

- Ascolta solo su `127.0.0.1` per default. Accetta solo richieste con `Host` locale, come protezione dal DNS rebinding. Solo GET (e HEAD), CSP restrittiva, nessun CORS. Le uniche eccezioni sono `POST /api/settings` (modifica delle variabili), `POST /api/dashboard` (disposizione della dashboard), `POST /api/presets` (i suoi preset), `POST /api/skills` e `POST /api/skills/<id>` (libreria di skill), `POST /api/skill-presets` (i loro preset), `POST /api/vibe-projects` (i progetti di Vibe Coding) e `POST /api/update` con `POST /api/update/apply` (aggiornamento da zip): solo da loopback, solo `content-type: application/json`, oppure `application/zip` per lo zip di aggiornamento e `application/zip` o `text/markdown` per una skill (una pagina di un altro sito non può inviarli senza un preflight CORS a cui la lens non risponde; `multipart/form-data` è rifiutato proprio perché non lo richiede), con `Origin`, se presente, uguale all'indirizzo della dashboard e senza header da reverse proxy.
- Le skill importate sono dati, non programmi: lo zip (o il `SKILL.md`) si controlla (nomi sicuri, niente symlink, limiti di numero di file e di dimensione, estrazione in una cartella sempre nuova) e si copia nella libreria accanto al database, mai eseguito. Sono configurazione tua, non dati di OpenCode, e come i preset si modificano solo da questo computer.
- L'aggiornamento da zip esegue l'`install.sh` dello zip caricato, con i permessi dell'utente: è la stessa cosa che lanciarlo da terminale, e si può chiedere solo da questo computer. Lo zip si legge e si estrae senza eseguire niente finché non confermi; la lens non scarica mai niente da internet.
- **Non fa da proxy all'API di OpenCode** e non espone mai la sua password. L'API di OpenCode include endpoint sensibili, come l'elenco delle credenziali con i segreti in chiaro, e restano fuori dalla dashboard.
- Non salva prompt, risposte, input o output dei tool: solo conteggi, tempi, nomi di modelli e tool, e messaggi d'errore. Prima di salvarli li redige: chiavi `sk-…`, `Bearer <token>` e stringhe lunghe da token (32 caratteri o più) diventano `[redatto]`, la cartella home diventa `~`; poi li tronca a 500 caratteri. È un filtro euristico: un segreto corto o di un'altra forma può passare.
- Salva i **titoli** delle sessioni, che sono riassunti generati del tuo prompt. `LENS_STORE_TITLES=0` li esclude.
- Salva la cartella di lavoro di ogni sessione, usata per il breakdown per directory.
- Il token viene confrontato in tempo costante.
- Un errore interno risponde con un 500 generico; nel log finiscono solo metodo e percorso della richiesta, mai la query (che può contenere `?token=`).
- `GET /api/settings` non restituisce mai i segreti; `LENS_OTLP_ENDPOINT` arriva per intero solo ai client di questo computer, agli altri oscurato (credenziali e query tolte).
- Dei prompt salva solo lunghezza e numero di allegati; dei comandi shell solo se erano un `git commit`; dei permessi l'azione e il numero di risorse, non le risorse.
- L'export OTLP, se attivo, invia gli stessi dati del database (conteggi, tempi, nomi), mai testi.
- La pagina Security legge, in sola lettura, gli audit e le policy dei guard DLP nelle cartelle di OpenCode (`LENS_SECURITY_DIRS`, `LENS_SECURITY_CONFIG_DIR`, solo con il modulo Security attivo) senza scrivere niente e senza copiarli nel database; da rete mostra solo esiti, tool e categorie. Vedi [sicurezza.md](sicurezza.md#chi-vede-cosa).
- Il server MCP (`opencode-lens mcp`) parla solo con l'API HTTP della lens (legge, e riporta le consegne dei preset: id, mai testi) e per default passa al modello conteggi e classi d'errore, non testi, con l'eccezione del testo delle skill dei preset, che è tuo: vedi [Cosa arriva al modello](#cosa-arriva-al-modello).
