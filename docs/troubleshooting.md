# Troubleshooting

🌐 Italiano · [English](en/troubleshooting.md) · [Français](fr/troubleshooting.md)

## Problemi comuni

Prima di tutto apri la pagina **Impostazioni** (`http://127.0.0.1:4777/#impostazioni`): mostra versione, percorsi di database e log, variabili in uso e stato di OpenCode.

- **"servizio non registrato"**: OpenCode V2 non è mai partito, quindi `service.json` non esiste. Lancia `opencode2` una volta, oppure `opencode2 service start`. Il percorso atteso è stampato da `npm run check`.
- **Dashboard vuota con servizio attivo**: lancia `npm run check` e guarda quante sessioni vede. Poi `npm run resync` ricostruisce tutto da zero.
- **Numeri non allineati**: lancia `npm run verify` a sessioni ferme. Se segnala differenze, `npm run resync` le corregge. Uno step in corso durante il verify risulta sempre `BAD`. Con la retention attiva il verify conta anche gli step potati, e il resync non li riporta.
- **"401 dal servizio"** nel log: OpenCode è ripartito con una nuova password. La lens rilegge `service.json` da sola alla riconnessione successiva; se il messaggio si ripete, controlla che `OPENCODE_SERVICE_FILE` punti al file giusto.
- **`install.sh` non riesce a scaricare Node** (rete aziendale, proxy): se il proxy va indicato, esporta `https_proxy` prima di lanciarlo; se nodejs.org è bloccato, usa un mirror interno con la stessa struttura (`LENS_NODE_MIRROR=https://…/dist bash install.sh`), oppure installa Node ≥ 22.13 nel `PATH` in un altro modo e rilancia.
- **Il servizio non si carica su un Mac aziendale**: alcune policy (MDM) bloccano i LaunchAgent utente. Lo dice `opencode-lens service status`; in quel caso avvia la lens a mano, in un terminale: `~/Applications/opencode-lens/node/bin/node ~/Applications/opencode-lens/src/main.js` (o `node …` se Node è nel `PATH`).
- **La porta è già occupata** (`opencode-lens service install`): scegline un'altra con `opencode-lens service install --port 4800`.
- **Dopo aver estratto lo zip nuovo la dashboard mostra ancora la versione vecchia**: la lens si riavvia da sola entro un minuto. Se non succede, `opencode-lens service status` e il log (`aggiornata alla …: riavvio`); `opencode-lens service restart` la riavvia subito.
- **Il servizio launchd non risponde**: guarda il log con `tail -f ~/Library/Logs/opencode-lens/lens.log` (oltre 10 MB `opencode-lens service install`, che ogni aggiornamento esegue, lo accorcia all'ultimo MB). Lo stato si vede con `opencode-lens service status` (o `launchctl print gui/$(id -u)/local.opencode-lens`).
- **Node cambiato** (nvm, fnm, volta, asdf, installazione da un clone): il LaunchAgent usa il percorso di Node trovato all'installazione. Rilancia `opencode-lens service install` (o `./install.sh`). Con Node di Homebrew non serve: il plist usa il percorso stabile `/opt/homebrew/opt/node`. Nemmeno con il Node scaricato da `install.sh` in `~/Applications/opencode-lens/node`, che non cambia con gli aggiornamenti.
- **"host non consentito" (403)**: stai aprendo la dashboard con un nome diverso da `127.0.0.1`/`localhost`. Aggiungilo a `LENS_ALLOWED_HOSTS`, porta compresa.
- **La lens non parte con `LENS_HOST=0.0.0.0`**: manca `LENS_TOKEN` o è più corto di 16 caratteri. Vedi [configurazione.md](configurazione.md#esposizione-remota).

- **Export OTLP fallito**: l'errore esatto è nella pagina Impostazioni e nel log. `HTTP 401/403`: controlla `LENS_OTLP_HEADERS`. `HTTP 404`: l'endpoint è l'URL base, senza `/v1/metrics`. `HTTP 415`: il collector non accetta OTLP in JSON. Gli span non inviati ripartono al tentativo successivo.
- **Aggiornamento dalla dashboard non riuscito**: la sezione **Impostazioni › Aggiornamento** mostra lo stato e le ultime righe di `install.sh` (tutto in `update/last.log`, accanto al database). Se `install.sh` si ferma prima di riavviare, la lens resta quella di prima. Se la pagina dice che la lens non risponde dopo due minuti, lancia `bash ~/Applications/opencode-lens/install.sh` da terminale. «Installa» è spento con il motivo accanto quando la lens non è avviata da launchd, gira da un clone o da un'altra cartella, o ha variabili del plist da applicare.
- **La dashboard mostra solo «opencode-lens non è partita: …»**: la lens non riesce ad aprire il database e resta su con questa pagina (e `/healthz` risponde 503) invece di riavviarsi di continuo. Il caso più comune è un database scritto da una versione più nuova, dopo essere tornati a una vecchia: reinstalla la versione nuova, la lens riparte da sola. Succede per esempio tornando alla 0.36 o precedente dopo una versione con lo schema v6: per usarla serve la copia di sicurezza fatta prima dell'aggiornamento (vedi [aggiornamento.md](aggiornamento.md#ripristinare-una-copia-di-sicurezza)). Negli altri casi (file danneggiato o illeggibile) il motivo è nella pagina, visibile da questo computer, e nel log.
- **La lens non parte dopo l'aggiornamento** con «Configurazione non valida»: una variabile ha un valore fuori intervallo o mal scritto; il messaggio le elenca tutte.
- **La dashboard è tornata alla disposizione predefinita**: `dashboard-v2.json` (o, se manca o non è valido, il vecchio `dashboard.json`, che viene migrato) non è JSON valido o descrive widget fuori griglia o sovrapposti, di solito dopo una modifica a mano. Il log dice cosa non va (`grep 'dashboard' ~/Library/Logs/opencode-lens/lens.log`). Correggi il file, oppure ricomponi la disposizione e salvala: il salvataggio lo sostituisce.
- **Manca il pulsante «Personalizza dashboard»**: la dashboard è aperta da un altro computer (le modifiche si fanno solo da quello dove gira la lens) oppure la finestra è più stretta di 700 px. Vedi [dashboard.md](dashboard.md#quando-il-pulsante-non-cè).

## Limiti noti (OpenCode 2.0 è in beta)

- **API in movimento.** La lens controlla a ogni evento che i campi su cui si basa esistano. Se mancano mostra un avviso ("l'API è cambiata") e lo segnala anche in `/metrics` (`opencode_lens_api_drift_events`) e in `/api/status` (campo `drift`, con i campi mancanti e un esempio di evento). Il backfill dai messaggi continua a funzionare anche quando gli eventi live cambiano forma.
- **Endpoint documentati ma assenti in OpenCode v2.0.26.** Non li uso:
  - `/api/info` risponde 404 (uso `/api/health`);
  - `/api/experimental/session/stats` risponde 404;
  - `/api/experimental/session/{id}/log` restituisce solo `log.synced`.
- **Task interni**: la data è quella della sincronizzazione, non l'istante esatto della chiamata.
- **Server privati**: le sessioni di un `--standalone` non passano dal servizio condiviso. Per vederle serve `OPENCODE_SERVER_URL`.
- **V1** (`opencode`) non è supportata: ha un'API server diversa.
- **Permessi solo dal vivo**: OpenCode tiene solo le richieste in sospeso, quindi quelle fatte a lens spenta non si recuperano.
- **Run «senza esito»**: le sessioni precedenti a metà ottobre 2026 non hanno i messaggi `idle`; i loro run sono dedotti e non hanno un esito.
- **Consegna dei prompt** (`steer`/`queue`): nota solo per i prompt visti dal vivo.
- **Database molto grande** (misurato): oltre circa 250.000 step l'intervallo «Tutto» impiega più di 1 secondo, fino a circa 5 secondi con circa 1 milione di step (`/api/breakdown` legge tutto in JavaScript e blocca il ciclo degli eventi: anche `/healthz` può rispondere con fino a 6 secondi di ritardo). La memoria (RSS) arriva a circa 1,3 GB con 1 milione di step. `LENS_RETENTION_DAYS` tiene il database più piccolo.
- **WAL che cresce**: se uno strumento esterno (per esempio `sqlite3`) tiene aperta una transazione di lettura, il file `-wal` non può essere azzerato e cresce. Ora è limitato da `journal_size_limit` (64 MiB) e la lens esegue un checkpoint `TRUNCATE` ogni 10 minuti; chiudi comunque lo strumento quando hai finito.
- **Disco pieno**: gli eventi live si perdono, ma il backfill ripara lo storico appena torna spazio libero.
