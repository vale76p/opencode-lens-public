# App macOS

🌐 Italiano · [English](en/app-macos.md) · [Français](fr/app-macos.md)

**OpenCode Lens** (`~/Applications/OpenCode Lens.app`) è un'app macOS facoltativa che mostra la dashboard della lens in una finestra nativa, con l'icona nel Dock, le notifiche e l'avvio al login. È un involucro sottile: una `WKWebView` che carica la stessa dashboard di `http://127.0.0.1:4777`, più quello che a una pagina web manca (menu, Dock, notifiche). I sorgenti sono in `extras/macos/` e si compilano sul Mac che la usa.

## Cos'è

- **Facoltativa.** La lens funziona identica senza: stesso servizio, stessa dashboard nel browser, stessi dati. `install.sh` copia i sorgenti dell'app in `~/Applications/opencode-lens/extras/macos/`. L'app si installa da **Impostazioni › Aggiornamento** o con il comando qui sotto; da lì in poi `install.sh` la tiene alla versione della lens.
- **Un client HTTP della lens.** Non apre il database e non legge i file della lens: sa dov'è la lens dal plist del LaunchAgent e le parla in HTTP su loopback. Nessuna API nuova: usa la dashboard, `/healthz` e `/api/budget`.
- **Accanto a OpenCode Lens Monitor, non al suo posto.** Monitor tiene la barra dei menu: la percentuale del budget, il pannello, i widget, Avvia e Ferma del LaunchAgent e il suo avvio al login. L'app tiene la finestra della dashboard, l'icona nel Dock, le notifiche e l'avvio al login della finestra. Non ha un'icona nella barra dei menu e non avvia né ferma la lens. Le due app hanno nomi e bundle id diversi (`local.opencode-lens-monitor`, `local.opencode-lens.app`) e convivono; nessuna delle due serve all'altra.

## Requisiti

- macOS 13 o successivo.
- I Command Line Tools con Swift 6 o successivo: `xcode-select --install`. Xcode non serve.
- La lens installata (lo script sta nella sua cartella, `~/Applications/opencode-lens/extras/macos/app.sh`) oppure un clone del repository.
- Un utente normale: lo script si rifiuta di girare come root e non chiede `sudo`.

Lo script controlla tutto prima di compilare e si ferma con un messaggio se manca qualcosa (`Serve swiftc: xcode-select --install (Xcode non serve).`, `Serve macOS 13 o successivo`, `Serve Swift 6 o successivo`).

## Installazione

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh install
```

Da un clone: `bash extras/macos/app.sh install`.

**Dalla dashboard.** **Impostazioni › Aggiornamento › App macOS** mostra la versione dell'app accanto a quella della lens e, con **Installa l'app** (o **Aggiorna l'app**), lancia lo stesso comando in un processo che sopravvive a un riavvio della lens; il log della compilazione resta nella pagina. Il pulsante c'è solo quando la lens gira dal LaunchAgent nella sua cartella `~/Applications/opencode-lens`, come per l'aggiornamento da zip: una lens di sviluppo mostra lo stato ma non può sostituire l'app. Senza Command Line Tools il pulsante non c'è e la pagina dice cosa installare (`xcode-select --install`). Se la stai usando dall'app, l'app si chiude e si riapre.

Il comando compila l'app per l'architettura del Mac (`arm64` o `x86_64`) in `~/Library/Caches/opencode-lens-app`, la firma, chiude un'eventuale copia aperta, la copia in `~/Applications/OpenCode Lens.app`, controlla la firma e la apre. Al primo avvio macOS chiede il permesso per le notifiche. La versione dell'app è quella della lens da cui la compili (`version` di `package.json`).

**Perché si compila su ogni Mac.** Lo zip della release contiene solo i sorgenti. Un'app scaricata avrebbe la quarantena e una firma ad-hoc non notarizzata, e Gatekeeper la bloccherebbe; un'app compilata sul Mac stesso non ha quarantena. Per lo stesso motivo non copiare `OpenCode Lens.app` su un altro Mac: lancia lì `app.sh install`.

L'app non sta mai dentro `~/Applications/opencode-lens`, che ogni aggiornamento della lens sostituisce.

## La finestra

La finestra mostra la dashboard: 1280×840 al primo avvio, almeno 760×520, e ricorda posizione e dimensioni. Se la lens non è su `127.0.0.1:4777`, il sottotitolo della finestra mostra `host:porta`.

- **⌘W** chiude la finestra e libera la pagina (processo web e stream `/api/live`); l'app resta nel Dock per le notifiche. Un clic sull'icona del Dock o **⌘1** riaprono la dashboard.
- Lo zoom della pagina (⌘+, ⌘-, ⌘0) va da 50% a 200% e resta tra un avvio e l'altro.
- Le funzioni del browser che la dashboard usa ci sono anche qui: le conferme prima delle azioni distruttive (`confirm()`, come foglio della finestra), la scelta di file e cartelle (Skill › Importa), il salvataggio dei file (pannello su Download), lo schermo intero di Monitor, i gesti a due dita per indietro e avanti.
- Se la lens non risponde, al posto della dashboard compare una pagina d'errore nativa: «La lens non risponde», «Token mancante o errato» o «Indirizzo non supportato». Riprova da sola dopo 2, 4, 8 e 16 secondi, poi ogni 30, con il conto alla rovescia; **Riprova** (o ⏎) e ⌘R riprovano subito. A ogni tentativo l'app rilegge il plist, così trova la lens anche se nel frattempo ha cambiato porta o token.

La dashboard nell'app e quella nel browser sono due client indipendenti, come due schede: le preferenze del browser (tema, chiavi `lens:*`) sono separate; disposizione e preset stanno nella lens e vince l'ultimo salvataggio.

### Menu e scorciatoie

| Menu | Voci |
|---|---|
| OpenCode Lens | Informazioni su OpenCode Lens · Impostazioni… ⌘, (apre la pagina Impostazioni della dashboard) · Apri al login · Nascondi OpenCode Lens ⌘H · Nascondi altre ⌥⌘H · Mostra tutte · Esci da OpenCode Lens ⌘Q |
| Modifica | Annulla ⌘Z · Ripristina ⇧⌘Z · Taglia ⌘X · Copia ⌘C · Incolla ⌘V · Seleziona tutto ⌘A |
| Vista | Ricarica ⌘R · Indietro ⌘[ · Avanti ⌘] · Dimensioni reali ⌘0 · Ingrandisci ⌘+ (anche ⌘=) · Riduci ⌘- · Apri nel browser |
| Finestra | Contrai ⌘M · Zoom · Dashboard ⌘1 · Chiudi ⌘W |
| Aiuto | Guida di OpenCode Lens (questa pagina su GitHub, nella lingua dell'app) · Invia una notifica di prova |

**Apri nel browser** apre la stessa pagina nel browser di sistema. Con un token, l'indirizzo porta `?token=`: la lens lo scambia con un cookie e lo toglie dall'indirizzo con un redirect, ma il primo indirizzo può restare nella cronologia del browser.

La lingua dei menu e delle notifiche è `LENS_LANG` del plist se è `it`, `en` o `fr`; altrimenti la prima di queste tra le lingue preferite di macOS; altrimenti l'inglese.

## Dock

- **Badge**: `!` quando la lens non risponde da due controlli di fila; altrimenti il numero di budget superati in quel momento; niente se va tutto bene.
- **Menu dell'icona** (clic destro): una riga di stato («La lens risponde (127.0.0.1:4777)», «La lens non risponde (…)» o «Controllo della lens in corso…»), «Budget superati: N» se ce ne sono, poi **Ricarica** e **Apri nel browser**.

## Notifiche

L'app controlla la lens 5 secondi dopo l'avvio e poi una volta al minuto, anche con la finestra chiusa: `GET /healthz` e poi `GET /api/budget`, con una sessione HTTP propria (senza cookie né cache) e il token nell'header `Authorization`. Non legge la pagina della dashboard. Al risveglio dal sonno i controlli falliti prima non contano e il controllo successivo arriva dopo 10 secondi. macOS può ritardare un controllo di qualche minuto per risparmiare energia (App Nap): una notifica può arrivare in ritardo.

| Evento | Titolo | Testo |
|---|---|---|
| Un budget è al 100% o oltre (giorno, settimana o mese; token, costo o step) | Budget superato | «Oggi, token: 120% del budget» (anche «Questa settimana», «Questo mese»; «costo», «step») |
| Un modello ha superato il suo budget giornaliero (`LENS_MODEL_LIMITS`) | Budget superato | «openai/gpt-5.5: 104% del budget di oggi» |
| Più di tre budget nuovi insieme (per esempio al primo avvio) | Budget superati: N | i primi tre, poi «e altri N» |
| La lens non risponde a due controlli di fila (circa 2 minuti), dopo aver risposto almeno una volta da quando l'app è partita | La lens non risponde | «Nessuna risposta da 127.0.0.1:4777 negli ultimi controlli.» |
| La lens torna a rispondere | La lens risponde di nuovo | «127.0.0.1:4777 risponde.»; la notifica precedente si toglie |

- Conta come «non risponde» anche il 503 della modalità diagnostica.
- **Deduplica.** Ogni budget si notifica una volta per periodo: «Oggi, token» al massimo una volta al giorno, «Questa settimana» una volta a settimana. Quelli già notificati restano in `notified.<porta>` nelle preferenze dell'app (`local.opencode-lens.app`); quando il periodo finisce si dimenticano. Riaprire l'app non ripete le notifiche.
- **Ricordate solo se consegnate.** Se una notifica non parte (permesso negato, errore del centro notifiche), quel budget non si segna e si riprova al controllo successivo.
- Un clic su una notifica porta la finestra davanti sulla vista **Adesso**. Le notifiche compaiono anche quando l'app è in primo piano.
- **Aiuto › Invia una notifica di prova** manda una notifica; se non può comparire, un avviso dice perché (notifiche disattivate o l'errore del sistema).

Per vedere di nuovo le notifiche di budget già mandate (porta 4777): `defaults delete local.opencode-lens.app notified.4777`.

### Se le notifiche non arrivano

Con la firma ad-hoc che `app.sh` usa di default, macOS può rifiutare le notifiche dell'app: il centro notifiche non la riconosce e nel log di sistema compare «Failed to find or validate client». Per abilitarle:

1. Apri la copia in `~/Applications` e rispondi **Consenti** alla richiesta, se compare.
2. **Impostazioni di Sistema › Notifiche › OpenCode Lens**: attiva «Consenti notifiche», stile «Banner».
3. **Aiuto › Invia una notifica di prova**.
4. Se l'app non compare nell'elenco o la prova dà errore, firmala con un certificato di firma del codice (per esempio quello che usi già per Monitor). Trova il nome esatto:

   ```bash
   security find-identity -v -p codesigning
   ```

   Reinstalla con quel certificato e controlla la firma:

   ```bash
   LENS_APP_SIGN="<nome esatto del certificato>" bash ~/Applications/opencode-lens/extras/macos/app.sh install
   codesign -dv ~/Applications/"OpenCode Lens.app" 2>&1 | grep Authority
   ```

   Riapri l'app e ripeti i passi 2 e 3.

Per la diagnosi, il log degli ultimi 5 minuti (in zsh serve `/usr/bin/log`: `log` da solo è un comando della shell):

```bash
/usr/bin/log show --last 5m --predicate 'eventMessage CONTAINS "local.opencode-lens.app"' | grep -iE "validate client|hasError"
```

I budget non consegnati non sono stati ricordati: arrivano da soli al primo controllo riuscito.

## Apri al login

**OpenCode Lens › Apri al login** apre l'app (e la finestra) a ogni login. La voce è attiva solo con l'app in `~/Applications` o `/Applications`, dove la mette `app.sh install`; da un'altra cartella (per esempio una build di prova) è disattivata e un tooltip spiega perché. Spegnerla si può sempre.

Se macOS chiede un'approvazione, la voce diventa «Apri al login (da approvare in Impostazioni di Sistema)» e un clic apre **Impostazioni di Sistema › Generali › Elementi login**. Dopo una reinstallazione macOS può mostrare di nuovo l'avviso «Elemento di login aggiunto».

È indipendente dall'avvio della lens, che resta compito del LaunchAgent (e di Monitor per Avvia/Ferma).

## Porta, token e host

L'app legge porta, token, host e lingua dalle `EnvironmentVariables` del plist del LaunchAgent, `~/Library/LaunchAgents/local.opencode-lens.plist`, come il server MCP. Lo rilegge a ogni caricamento e a ogni controllo: se cambi la porta dalle Impostazioni, l'app segue la lens al nuovo indirizzo.

| Variabile | Uso nell'app |
|---|---|
| `LENS_PORT` | porta della lens; vuota, `0` o non valida → 4777 |
| `LENS_TOKEN` | token per la dashboard e per i controlli; **vale solo sulla porta del plist** |
| `LENS_HOST` | `127.0.0.1`, `0.0.0.0`, `::`, `[::]` → l'app usa `127.0.0.1`; `localhost` → `localhost`; ogni altro valore (`::1`, un indirizzo di rete, un nome) → pagina «Indirizzo non supportato» |
| `LENS_LANG` | lingua dell'app (`it`, `en`, `fr`) |

- `LENS_PORT` e `LENS_TOKEN` nell'ambiente dell'app (per esempio `open -n --env LENS_PORT=4800 …`) hanno la precedenza sul plist. Se la porta viene dall'ambiente ed è diversa da quella del plist, il token del plist non si usa: il token della lens reale non va a una lens di sviluppo.
- Un host non loopback è rifiutato: l'app non si collega mai a un altro computer e non manda il token in chiaro sulla rete. Per una lens raggiungibile da rete usa il browser.
- Un `401` rilegge il plist e rimette il token una volta; se la lens rifiuta ancora, compare la pagina «Token mancante o errato».

## Sicurezza

- **Solo l'origine della lens.** Nella finestra resta solo `http://<host>:<porta>` della lens, senza credenziali nell'indirizzo; `about:blank` è ammesso. Un file creato dalla dashboard (`blob:` della lens) si può solo salvare. Tutto il resto si annulla: `file:`, `javascript:`, `data:` come pagina, frame e redirect verso altri siti.
- **Link esterni nel browser, solo se cliccati.** Un clic su un link `http`, `https` o `mailto` verso un altro sito (anche `target="_blank"`) lo apre nel browser di sistema. Un `window.open` lanciato da uno script non apre niente: gli script non possono aprire finestre e l'app non crea mai una seconda pagina.
- **Nessun JavaScript iniettato.** Niente script utente né ponti tra pagina e app; la pagina d'errore è nativa; la Content-Security-Policy della lens resta intatta. Un test (`test/macos-app.test.js`) lo fa rispettare.
- **Il token** va alla dashboard in un cookie di sessione `lens_token` (HttpOnly, SameSite Strict, senza scadenza: non finisce su disco), messo dall'app prima del caricamento; ai controlli va nell'header `Authorization`. Mai nell'indirizzo, mai nei log. Se lo passi con `open --env LENS_TOKEN=…` è visibile in `ps eww`, come per l'MCP.
- **Rete**: App Transport Security ammette solo la rete locale (`NSAllowsLocalNetworking`). Firma con hardened runtime; niente App Sandbox.
- **Dati**: le preferenze della dashboard (`localStorage`) stanno nei dati WebKit dell'app, `~/Library/WebKit/local.opencode-lens.app`.
- **Limite noto.** Un `a.click()` chiamato da uno script su un link senza `target` arriva a WebKit come un clic vero: un link esterno così aperto andrebbe nel browser. Nella finestra girano solo gli script della lens (lo garantisce la sua Content-Security-Policy), quindi servirebbe un difetto della dashboard stessa.

## Aggiornamento

Dopo ogni installazione della lens (zip nuovo da terminale, o **Impostazioni › Aggiornamento**, anche dall'app) `install.sh` lancia `app.sh update`: se l'app è installata e ha una versione diversa da quella della lens, la ricompila e la reinstalla. La riapre solo se era aperta. La compilazione dura circa un minuto e parte dopo il riavvio della lens, che intanto è già su; il suo log finisce in quello dell'aggiornamento.

Se la compilazione non riesce (per esempio mancano i Command Line Tools), la lens resta aggiornata e **Impostazioni › Aggiornamento › App macOS** dice che l'app è rimasta indietro, con il pulsante per riprovare. Da terminale:

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh update
```

`LENS_SKIP_APP=1 bash <cartella estratta>/install.sh` salta il passo.

**Con un certificato.** Senza `LENS_APP_SIGN`, `app.sh` riusa il certificato con cui era firmata l'app installata, se è ancora nel portachiavi. La prima volta che `codesign` usa la sua chiave, macOS può chiedere il permesso con una finestra: rispondi **Consenti sempre**. Se non c'è nessuno davanti allo schermo, la compilazione lanciata dalla dashboard resta in attesa; la lens è già aggiornata comunque.

## Disinstallazione

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh uninstall
```

Toglie, in quest'ordine: l'elemento di login (lo deregistra l'app stessa, con `OpenCodeLens --unregister-login-item`), l'app aperta, `~/Applications/OpenCode Lens.app`, la cache di build `~/Library/Caches/opencode-lens-app`, i dati WebKit (`~/Library/WebKit/local.opencode-lens.app`, `~/Library/Caches/local.opencode-lens.app`, `~/Library/HTTPStorages/local.opencode-lens.app` e `.binarycookies`), lo stato salvato delle finestre e le preferenze dell'app (`defaults delete local.opencode-lens.app`: dimensioni della finestra, zoom, budget notificati).

Lascia la lens, il suo LaunchAgent, il database e tutti i suoi dati, e Monitor. Per togliere anche la lens segui [disinstallazione.md](disinstallazione.md), lanciando prima questo comando: lo script sta nella cartella della lens.

## Sviluppo

```bash
bash extras/macos/app.sh test                 # test della parte pura (Sources/Core), «OK N checks»
bash extras/macos/app.sh build --out /tmp/olapp   # costruisce senza installare
npm run test:macos                            # build vera, firma, versione e icona; prima di un rilascio
```

- `app.sh build` senza `--out` costruisce nella cache, `~/Library/Caches/opencode-lens-app`. Scegli una cartella `--out` fuori da iCloud (`~/Documents` può esserlo): gli attributi estesi rompono la firma e lo script lo segnala. La compilazione stessa avviene in una cartella temporanea.
- `npm run test:macos` (`test/macos/app.test.js`) costruisce l'app davvero e controlla bundle, firma ad-hoc con hardened runtime, versione, icona e architettura, senza mai avviarla. Si salta fuori da macOS o senza Command Line Tools. Fa parte dei controlli prima di un rilascio; in CI non gira.
- In `npm test` (anche in CI) ci sono i controlli statici `test/macos-app.test.js` (script, `Info.plist`, sorgenti senza JavaScript iniettato, nessun file della lens che dipenda dall'app) e `test/macos-app-contract.test.js` (le API della lens che l'app usa).
- Variabili per le prove, da passare con `open -n --env …`:

  | Variabile | Effetto |
  |---|---|
  | `LENS_APP_PLIST` | un altro plist al posto di quello del LaunchAgent, per esempio il `dev/data/dev.plist` della lens di sviluppo (copialo fuori da `~/Documents`: lì l'app può restare bloccata dai permessi di macOS) |
  | `LENS_APP_INSPECTABLE=1` | la pagina diventa ispezionabile da Safari › Sviluppo (macOS 13.3 o successivo) |
  | `LENS_PORT`, `LENS_TOKEN` | porta e token al posto di quelli del plist |
  | `LENS_APP_SIGN` | per `app.sh build` e `install`: il certificato con cui firmare al posto della firma ad-hoc |

  ```bash
  open -n --env LENS_APP_PLIST=/tmp/dev.plist --env LENS_APP_INSPECTABLE=1 "/tmp/olapp/OpenCode Lens.app"
  ```

- Struttura: `Sources/Core` (logica pura, solo Foundation, con i test in `Tests/CoreTests.swift`), `Sources/App` (AppKit, WebKit, notifiche, elementi di login), `Tools/MakeIcon.swift` (l'icona, generata dal marchio della dashboard a ogni build), `Info.plist`, `app.sh`. Niente progetto Xcode né SwiftPM.

## Limiti

- Non è integrata con `uninstall.sh` né con **Impostazioni › Disinstallazione**: si toglie solo con `app.sh uninstall`.
- Niente icona nella barra dei menu (c'è Monitor), niente opzione per nascondere l'icona del Dock, niente avvio nascosto al login.
- Le notifiche non coprono la proiezione «a fine giornata oltre il budget», i drift dell'API e il motivo della modalità diagnostica; l'intervallo di un minuto non si cambia.
- Con un token sbagliato i controlli falliscono come se la lens non rispondesse: il Dock dice «non risponde», mentre la finestra mostra la pagina del token.
- `LENS_HOST=::1`, indirizzi di rete e nomi `.local` non sono supportati.
- Solo l'architettura del Mac che compila; firma ad-hoc di default (le notifiche possono richiedere un certificato); niente App Sandbox.
- **Guida di OpenCode Lens** apre questa pagina su GitHub: serve l'accesso al repository.
- `prompt()` non è supportato (la dashboard non lo usa).
