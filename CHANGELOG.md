# Changelog

Tutte le modifiche rilevanti di opencode-lens. Formato [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/): *major* per cambi incompatibili (API locale, schema del DB, installazione), *minor* per funzioni nuove, *patch* per correzioni.

Dalla 0.3.0 le voci le scrive [release-please](https://github.com/googleapis/release-please) dai commit convenzionali (`feat:` → Aggiunto, `fix:` → Corretto, …) nella PR di rilascio, dove si possono rifinire prima del merge. Ogni versione ha un tag git `opencode-lens-vX.Y.Z` e una [release su GitHub](https://github.com/vale76p/opencode-lens-public/releases) con lo zip. La dashboard mostra lo stesso changelog nella pagina **Novità**. Come si rilascia: [README](README.md#versioni-e-rilasci).

## [0.51.0] (2026-11-21)


### Aggiunto

* **opencode-lens:** cifre del dettaglio e della panoramica dei progetti
* **opencode-lens:** costo stimato in Vibe Coding
* **opencode-lens:** KPI e grafici dei progetti in Vibe Coding
* **opencode-lens:** previsione alla consegna e tendenza mensile
* **opencode-lens:** progetti a scadenza in Vibe Coding
* **opencode-lens:** stimato e speso nella striscia e nella board
* **opencode-lens:** storico dei progetti di Vibe Coding
* **opencode-lens:** Vibe Coding con costo stimato, progetti a scadenza e KPI per progetto


### Corretto

* **opencode-lens:** date e tipo dei progetti a scadenza validati, budget azzerato al ripiego
* **opencode-lens:** note brevi nella striscia, lavoro dopo la consegna e stima incompleta su tutte le cifre di Vibe Coding
* **opencode-lens:** stimato per modello raggruppato per chiave di modello
* **opencode-lens:** storico dei progetti riletto quando cambiano i giorni chiusi
* **opencode-lens:** storico di Vibe Coding aggiornato oggi e dopo un cambio di listino, documentazione allineata
* **opencode-lens:** tendenza su mesi di calendario e start dopo la consegna
* **opencode-lens:** totali della panoramica su tutti i progetti, stima incompleta sullo stesso orizzonte dello stato
* **opencode-lens:** Vibe Coding disegna senza aspettare lo storico, meno letture ripetute


### Modificato

* **opencode-lens:** il budget dei progetti ora si confronta con il costo stimato dal listino; con il listino vuoto resta sul costo di OpenCode

### Documentazione

* **opencode-lens:** Vibe Coding con progetti a scadenza e costo stimato

## [0.50.0] (2026-11-18)


### Aggiunto

* **opencode-lens:** card «Listino prezzi» nelle Impostazioni
* **opencode-lens:** ctx.prices per i moduli
* **opencode-lens:** LENS_MODEL_PRICES nella configurazione
* **opencode-lens:** listino prezzi per milione di token (src/prices.js)
* **opencode-lens:** listino prezzi per modello nelle Impostazioni e ctx.prices per i moduli
* **opencode-lens:** listino prezzi scritto dalle Impostazioni


### Corretto

* **opencode-lens:** errori del listino riconoscibili in ogni lingua e tabella più stretta
* **opencode-lens:** listino prezzi, chiavi, testi e documentazione dopo la revisione
* **opencode-lens:** listino prezzi, una sola regola per le chiavi e limiti sui numeri

## [0.49.3] (2026-11-06)


### Corretto

* **opencode-lens:** l'MCP non dà più «tool sconosciuto» a uno strumento di modulo chiamato prima che i moduli siano letti
* **opencode-lens:** uno step fallito o interrotto non è più un drift di message:assistant
* **opencode-lens:** uno step fallito o interrotto non è più un drift di message:assistant

## [0.49.2] (2026-11-03)


### Corretto

* **opencode-lens:** il riavvio dalle Impostazioni funziona anche con il job disabilitato
* **opencode-lens:** il riavvio dalle Impostazioni funziona anche con il job disabilitato

## [0.49.1] (2026-11-03)


### Corretto

* **opencode-lens:** /healthz risponde 503 se il database non risponde e segnala degraded; nuova metrica start_time_seconds
* **opencode-lens:** correzioni dalla revisione avversaria (sicurezza, dati, operatività)
* **opencode-lens:** error_msg redatto prima del troncamento (chiavi, Bearer, stringhe lunghe, home)
* **opencode-lens:** i moduli utente si installano dalla dashboard solo con LENS_TOKEN
* **opencode-lens:** il backfill non azzera cost e token live quando mancano nel messaggio
* **opencode-lens:** il contratto API copre anche le risposte REST di sessioni e messaggi
* **opencode-lens:** il WAL ha un limite di 64 MiB e un checkpoint TRUNCATE ogni 10 minuti
* **opencode-lens:** l'integrazione MCP attende anche module_guide e module_check
* **opencode-lens:** la cartella dati esistente passa a 0700 e la copia di backup nasce 0600
* **opencode-lens:** la documentazione dice con esattezza cosa si salva (titoli, cartella, error_msg redatto)
* **opencode-lens:** la scansione segnala i sync falliti in scan.error con una sola riga di log
* **opencode-lens:** più header di reverse proxy riconosciuti come non locali
* **opencode-lens:** traduzione francese del messaggio sul token dei moduli, forma di cortesia
* **opencode-lens:** un campo negativo non scarta più l'usage interna positiva
* **opencode-lens:** un crash lascia lo stack nel log prima di uscire


### Documentazione

* **opencode-lens:** versione di OpenCode verificata v2.0.26 e limiti noti misurati

## [0.49.0] (2026-11-01)


### Aggiunto

* **opencode-lens:** Ponytail esce dalla distribuzione, restano il modulo d'esempio e la guida
* **opencode-lens:** Ponytail esce dalla distribuzione, restano il modulo d'esempio e la guida

## [0.48.1] (2026-11-01)


### Corretto

* **opencode-lens:** due export OTLP insieme non mandano due volte lo stesso aumento
* **opencode-lens:** export OTLP sovrapposti, limit di /api/sessions, errore vero di Store.tx
* **opencode-lens:** limit di /api/sessions intero da 1 a 500, come /api/runs
* **opencode-lens:** una transazione già annullata da SQLite non nasconde l'errore vero

## [0.48.0] (2026-11-01)


### Aggiunto

* **opencode-lens:** aggiorna i moduli dell'utente da uno zip in Impostazioni › Aggiornamento
* **opencode-lens:** i moduli di uno zip si controllano solo a «Installa», dopo l'avviso
* **opencode-lens:** riavvia la lens dalla dashboard (POST /api/restart, riquadro Servizio)
* **opencode-lens:** riavvio dalla dashboard, moduli dell'utente da zip e Impostazioni più comode
* **opencode-lens:** schede dei moduli con separatore e pulsante Attiva/Disattiva a larghezza fissa


### Corretto

* **opencode-lens:** «Riavvia la lens» non ricarica un plist modificato a mano e non applicato
* **opencode-lens:** dopo un salvataggio Impostazioni resta nella sezione in cui eri
* **opencode-lens:** il riavvio dalla dashboard non parte con un plist che non si legge
* **opencode-lens:** installazione dei moduli tutto o niente, 409 a metà controllo, pulizia delle .staging-*


### Documentazione

* **opencode-lens:** il controllo dei moduli di uno zip si fa a «Installa», dopo l'avviso (it/en/fr)
* **opencode-lens:** installazione dei moduli tutto o niente, riavvio rifiutato con un plist non applicato (it/en/fr)
* **opencode-lens:** moduli dell'utente da uno zip in Impostazioni › Aggiornamento (it/en/fr)
* **opencode-lens:** riavvio dalla dashboard in configurazione, metriche e architettura (it/en/fr)

## [0.47.0] (2026-11-01)


### Aggiunto

* **opencode-lens:** cartella extras/modules per i moduli extra e il loro zip nella release
* **opencode-lens:** moduli extra in extras/modules e il loro zip nella release


### Documentazione

* **opencode-lens:** i moduli extra, il loro zip nella release e come installarli

## [0.46.1] (2026-11-01)


### Corretto

* **opencode-lens:** lo zip della release contiene il test kit dei moduli: la 0.46.0 è uscita senza zip, questa è la versione da installare

## [0.46.0] (2026-11-01)


### Aggiunto

* **opencode-lens:** moduli dell'utente: una cartella accanto al database (su macOS `~/Library/Application Support/opencode-lens/modules/`) che gli aggiornamenti non toccano, letta dalla lens e dall'MCP con le stesse regole dei moduli della lens; in Impostazioni › Moduli hanno il badge «tuo» e la loro cartella
* **opencode-lens:** widget dei moduli nella griglia: un modulo dichiara i suoi widget nel manifesto, «+ Aggiungi widget» li offre con il nome del modulo, e un modulo spento o in errore lascia al loro posto un riquadro che lo dice
* **opencode-lens:** strumenti MCP `lens_module_guide` e `lens_module_check` per scrivere un modulo: la guida con i valori di questa installazione e il controllo di un modulo senza attivarlo (`POST /api/modules/check`, `GET /api/modules/authoring`); in OpenCode compaiono dopo averlo riavviato
* **opencode-lens:** un modulo d'esempio da copiare (`extras/module-template/`) e il test kit dei moduli installato con l'app


### Documentazione

* **opencode-lens:** guida per scrivere un modulo, pensata anche per un LLM: `docs/moduli-custom.md`

## [0.45.0] (2026-10-29)


### Aggiunto

* **opencode-lens:** Impostazioni mostra una sezione alla volta, con l'icona a ingranaggio
* **opencode-lens:** Impostazioni mostra una sezione alla volta, con l'icona a ingranaggio

## [0.44.1] (2026-10-29)


### Corretto

* **opencode-lens:** rifiniture di sicurezza e comportamento dopo il refactor a moduli


### Modificato

* **opencode-lens:** ritocchi dopo le revisioni dei moduli

## [0.44.0] (2026-10-29)

**Da leggere prima di aggiornare.** Anche Skill diventa un modulo, come Vibe Coding, Security e IBM Bob nella 0.43.0: dopo l'aggiornamento è spento. Chi ha una libreria trova un avviso che porta a Impostazioni › Moduli, da dove si riaccende; libreria e preset restano intatti. A Skill spento lo strumento MCP `preset` e i comandi `/lens:<id>` non ci sono; il conteggio delle skill che OpenCode carica (`skill_uses` e le metriche delle skill) continua anche a Skill spento. Dopo averlo acceso o spento riavvia OpenCode.


### Aggiunto

* **opencode-lens:** i moduli dichiarano POST grezze e a prefisso, cartelle di dati e non prendono file e percorsi del core
* **opencode-lens:** i moduli registrano le consegne delle skill, leggono gli zip e conoscono la cartella dei dati
* **opencode-lens:** il lato server di Skill come modulo, verificato contro il core
* **opencode-lens:** il server MCP offre i prompt e le istruzioni dei moduli accesi
* **opencode-lens:** lo strumento preset e i prompt delle skill come strumenti del modulo


### Corretto

* **opencode-lens:** hasData di Skill ignora le cartelle di una cancellazione interrotta e il MCP avvisa dei campi mcp malformati
* **opencode-lens:** il MCP controlla i prompt dopo aver riletto i moduli, nello stesso giro


### Modificato

* **opencode-lens:** il cassetto di Skill riceve dalla pagina ciò che usa, senza ciclo di import
* **opencode-lens:** il lato server di Skill esce dal core
* **opencode-lens:** lo strumento preset e i prompt delle skill escono dal core
* **opencode-lens:** Skill diventa un modulo


### Documentazione

* **opencode-lens:** rifiniture di docs, traduzioni e messaggio dei campi MCP dopo la revisione di E
* **opencode-lens:** Skill come modulo, POST grezze, prompt dei moduli e consegne delle skill

## [0.43.0] (2026-10-26)

**Da leggere prima di aggiornare.** Vibe Coding, Security e IBM Bob diventano moduli, come Sistema nella 0.42.0: dopo l'aggiornamento sono spenti, anche IBM Bob con `LENS_BOB=1`. Chi li usava trova un avviso che porta a Impostazioni › Moduli, da dove si riaccendono; i dati restano. `LENS_BOB` non serve più: viene ignorata e si può rimuovere da Impostazioni. Il selettore «OpenCode / + Bob / Solo Bob» della dashboard riparte da «OpenCode». Skill resta nel core per ora.


### Aggiunto

* **opencode-lens:** i moduli dichiarano anche i percorsi che leggono soltanto
* **opencode-lens:** i moduli dichiarano le loro impostazioni, modificabili dalla scheda Moduli
* **opencode-lens:** i moduli dichiarano route POST e a prefisso, protette dal core
* **opencode-lens:** i moduli scrivono sulle loro tabelle, leggono sorgenti incrementali e avvisano la dashboard
* **opencode-lens:** il core crea le tabelle dichiarate dai moduli
* **opencode-lens:** il ctx dei moduli legge il database in sola lettura e dichiara file e dati
* **opencode-lens:** il lato server di IBM Bob come modulo, verificato contro il core
* **opencode-lens:** il lato server di Security come modulo, verificato contro il core
* **opencode-lens:** il lato server di Vibe Coding come modulo, verificato contro il core
* **opencode-lens:** il selettore della dashboard per le sorgenti dei moduli
* **opencode-lens:** il server MCP offre gli strumenti dei moduli accesi e avvisa OpenCode quando cambiano
* **opencode-lens:** lo strumento MCP security come strumento del modulo
* **opencode-lens:** moduli da configurare, start con un tempo massimo, limiti dei campi, avviso e pannello dei moduli
* **opencode-lens:** sorgenti alternative e stato dei moduli in /api/status e /healthz


### Corretto

* **opencode-lens:** ctx.reader legge con query_only e i file dei moduli restano nella cartella dei dati
* **opencode-lens:** fra i file scritti e nella disinstallazione solo i file dei moduli di tipo write
* **opencode-lens:** GET /api/modules legge il plist solo per i client locali e solo quando cambia
* **opencode-lens:** guardia query_only più sicura e i moduli non possono prendere i percorsi del core
* **opencode-lens:** i pannelli dei moduli seguono ogni stato e restano montati fra i render
* **opencode-lens:** la nota della card dice di riavviare OpenCode per strumenti e istruzioni
* **opencode-lens:** la prima lettura di IBM Bob non trattiene l'avvio del server
* **opencode-lens:** le tabelle di un modulo non possono essere tabelle del core
* **opencode-lens:** meta dei moduli sotto module:&lt;id&gt;:data:, reply con corpo obbligatorio e guardia query_only rientrante
* **opencode-lens:** nella sezione Moduli il suggerimento della shell solo a chi può usarlo e l'avviso porta alla sezione
* **opencode-lens:** ritocchi finali del modulo IBM Bob dopo la revisione


### Modificato

* **opencode-lens:** i grafici che Skill e Vibe Coding condividono passano nel core
* **opencode-lens:** IBM Bob diventa un modulo
* **opencode-lens:** il CSS che serve solo a Vibe Coding passa nel modulo
* **opencode-lens:** il lato server di IBM Bob esce dal core
* **opencode-lens:** Security diventa un modulo
* **opencode-lens:** Vibe Coding diventa un modulo


### Documentazione

* **opencode-lens:** chi tocca il database include il lettore dei moduli, nome di jsonStore e regola di db-owner
* **opencode-lens:** didascalia delle sonde di Bob, tabella delle variabili, riferimenti al lettore del modulo e spazi francesi
* **opencode-lens:** IBM Bob come modulo, tabelle, scritture e sorgenti dei moduli
* **opencode-lens:** OTLP con le serie di Security, strumento security del modulo, testi dei manifesti tradotti e no
* **opencode-lens:** Security come modulo, impostazioni e strumenti MCP dei moduli
* **opencode-lens:** Vibe Coding come modulo e contratto dei moduli esteso

## [0.42.0] (2026-10-25)


### Aggiunto

* **opencode-lens:** il server serve route, file, metriche e menu dei moduli attivi
* **opencode-lens:** la dashboard carica pagine e traduzioni dei moduli attivi
* **opencode-lens:** moduli attivabili da Impostazioni, Sistema è il primo
* **opencode-lens:** registro dei moduli con stati e avvio isolato
* **opencode-lens:** sezione Moduli in Impostazioni e avviso per i moduli spenti con dati
* **opencode-lens:** variabile LENS_MODULES per i moduli attivi


### Corretto

* **opencode-lens:** l'export OTLP non rimanda intere le serie che ricompaiono e include Security e IBM Bob come /metrics
* **opencode-lens:** rifiniture dei moduli dalla review finale
* **opencode-lens:** uno start asincrono che fallisce manda il modulo in errore senza fermare la lens


### Modificato

* **opencode-lens:** Sistema diventa il primo modulo


### Documentazione

* **opencode-lens:** moduli, LENS_MODULES e Sistema come modulo
* **opencode-lens:** righe vuote in moduli.md

## [0.41.2] (2026-10-24)


### Corretto

* **opencode-lens:** nella pagina Skill nomi e descrizioni lunghi non escono più dalle colonne
* **opencode-lens:** nella pagina Skill nomi e descrizioni lunghi non escono più dalle colonne

## [0.41.1] (2026-10-24)


### Corretto

* **opencode-lens:** l'app macOS si chiude come con ⌘Q prima di essere reinstallata e si riapre con open -a
* **opencode-lens:** l'app macOS si chiude come con ⌘Q prima di essere reinstallata e si riapre con open -a

## [0.41.0] (2026-10-24)


### Aggiunto

* **opencode-lens:** Sistema con CPU e memoria dal vivo ogni 2 secondi e i widget della Galleria
* **opencode-lens:** Sistema con CPU e memoria dal vivo ogni 2 secondi e i widget della Galleria

## [0.40.0] (2026-10-24)


### Aggiunto

* **opencode-lens:** «Vista» raccoglie raggruppamento e metrica di Analisi, il periodo in forma corta
* **opencode-lens:** controlli neutri nella barra, periodo corto ovunque, Personalizza e Schermo intero solo icona
* **opencode-lens:** l'ora dell'ultimo aggiornamento nella barra di Adesso e Analisi
* **opencode-lens:** la barra da strumento, con cornice e foglio, gli stessi posti in ogni barra e i controlli neutri
* **opencode-lens:** la dashboard su un foglio dentro una cornice grigia, il menu senza colore d'accento
* **opencode-lens:** ogni barra in alto ha gli stessi posti, ogni controllo sempre nello stesso punto


### Corretto

* **opencode-lens:** barra sopra la barra di modifica, ora in rosso con OpenCode scollegato, azione sola a destra, stamp leggibile dagli screen reader
* **opencode-lens:** conteggi del menu e secondi dell'orologio sopra 4.5:1
* **opencode-lens:** il badge «beta» della barra laterale non scende sotto 11px
* **opencode-lens:** le etichette di gruppo del menu «Vista» sopra 4.5:1 in chiaro

## [0.39.0] (2026-10-24)


### Aggiunto

* **opencode-lens:** API per lo stato e l'installazione dell'app macOS
* **opencode-lens:** app macOS installabile dalla dashboard e sempre alla versione della lens
* **opencode-lens:** app.sh check e update, con la firma dell'app conservata
* **opencode-lens:** blocco App macOS in Impostazioni › Aggiornamento
* **opencode-lens:** install.sh ricompila l'app macOS quando è installata
* **opencode-lens:** stato e installazione dell'app macOS nella lens


### Corretto

* **opencode-lens:** mai due compilazioni dell'app dopo il riavvio, né compilazioni eterne


### Documentazione

* **opencode-lens:** app macOS installabile e allineata dalla dashboard

## [0.38.3] (2026-10-24)


### Corretto

* **opencode-lens:** «Apri nel browser» dell'app macOS apre la dashboard con il token
* **opencode-lens:** «Apri nel browser» dell'app macOS apre la dashboard con il token

## [0.38.2] (2026-10-24)


### Corretto

* **opencode-lens:** lo zip arriva alla release anche senza l'attestazione di provenienza
* **opencode-lens:** lo zip arriva alla release anche senza l'attestazione di provenienza

## [0.38.1] (2026-10-24)


### Corretto

* **opencode-lens:** i test di package.sh girano senza la chiave di firma
* **opencode-lens:** i test di package.sh girano senza la chiave di firma

## [0.38.0] (2026-10-24)


### ⚠ BREAKING CHANGES

* **opencode-lens:** dalla dashboard non si installano più il «Source code (zip)» né zip non firmati (da terminale con install.sh sì). Dopo service install la dashboard chiede il token: aprila con opencode-lens service open, dall'app macOS o dal Monitor.

### Aggiunto

* **opencode-lens:** release firmate, token di default e licenza proprietaria

## [0.37.0] (2026-10-24)


### Aggiunto

* **opencode-lens:** Fasi 2–4 del refactor su main: lettore unico, contatori, page-kit, MCP in src/mcp/, app macOS

## [0.36.1] (2026-10-24)


### Modificato

* **opencode-lens:** conteggi, info del database e letture OTLP dietro lo Store
* **opencode-lens:** Fase 1, un solo proprietario dello schema
* **opencode-lens:** periodBounds in src/period.js, MCP e Impostazioni senza il read-side
* **opencode-lens:** schema ed espressioni chiave in src/schema.js
* **opencode-lens:** scritture e letture di Bob sulla lens dietro lo Store
* **opencode-lens:** VERSION e redactUrl in moduli foglia, chiuso il ciclo about↔otlp↔queries


### Documentazione

* **opencode-lens:** architettura, chi possiede lo schema

## [0.36.0] (2026-10-23)


### Aggiunto

* **opencode-lens:** aggregati e metriche dell'uso delle skill
* **opencode-lens:** bacheca dei preset con trascinamento, menu da tastiera e Annulla
* **opencode-lens:** da quando è in uso la versione corrente di una skill
* **opencode-lens:** dettaglio della skill in un pannello laterale con l'uso
* **opencode-lens:** i numeri della pagina Skill in un modulo puro
* **opencode-lens:** il collector conta i caricamenti delle skill e dei preset della lens
* **opencode-lens:** il MCP riporta alla lens le consegne dei preset di skill
* **opencode-lens:** pagina Skill come bacheca dei preset, con hero e uso delle skill
* **opencode-lens:** pagina Skill con hero, periodo e import dalla barra in alto
* **opencode-lens:** POST /api/skill-loads e protezione dei preset da salvataggi concorrenti
* **opencode-lens:** spostamenti delle skill tra i preset in un modulo puro
* **opencode-lens:** tabella skill_uses e schema v5 per l'uso delle skill


### Corretto

* **opencode-lens:** barre per giorno complete, il dialogo dei preset salva col rev e mini-card più pulite
* **opencode-lens:** contatori e last dell'uso delle skill solo sui completati
* **opencode-lens:** currentSince segue la corrente anche in reconcile e non cambia con un rollback sulla corrente
* **opencode-lens:** il pannello della skill ignora le risposte tardive, rilegge le caselle e mostra l'uso per giorno
* **opencode-lens:** in sola lettura niente import e nuovo preset, e un errore di lettura non lascia hero né caricamento
* **opencode-lens:** l'uso delle skill non blocca più la lettura di una sessione e conta le attivazioni
* **opencode-lens:** la bacheca rifà la mossa sul documento attuale, Annulla solo se sicuro e niente «null» nelle card
* **opencode-lens:** la libreria è null nelle mosse della bacheca e il tetto riusa il testo esistente
* **opencode-lens:** origine lens per i preset, deriva delle skill contata una volta per parte
* **opencode-lens:** uso normalizzato, «Tutto» comincia dall'inizio e predicato unico per «mai usate»
* **opencode-lens:** validazione più stretta dei caricamenti skill e scrittura in transazione


### Documentazione

* **opencode-lens:** limite del corpo di skill-loads, ultimo caricamento completato e sola lettura verso OpenCode
* **opencode-lens:** mockup della pagina Skill con hero, bacheca dei preset e uso
* **opencode-lens:** pagina Skill, uso delle skill e nuove metriche
* **opencode-lens:** uso delle skill come lo fa il codice

## [0.35.0] (2026-10-23)


### Aggiunto

* **opencode-lens:** sonde di IBM Bob dalle impostazioni e stima del cambio Bobcoin ↔ token
* **opencode-lens:** sonde di IBM Bob dalle impostazioni e stima del cambio Bobcoin ↔ token

## [0.34.1] (2026-10-23)


### Corretto

* **opencode-lens:** con IBM Bob il cambio di sorgente e il refresh dei widget non rallentano più
* **opencode-lens:** con IBM Bob il cambio di sorgente e il refresh dei widget non rallentano più

## [0.34.0] (2026-10-23)


### Aggiunto

* **opencode-lens:** budget, prompt in corso, interazione e attività dal vivo anche per IBM Bob
* **opencode-lens:** budget, prompt in corso, interazione e attività dal vivo anche per IBM Bob

## [0.33.0] (2026-10-23)


### Aggiunto

* **opencode-lens:** la sonda cerca dove Bob tiene il consumo dell'account
* **opencode-lens:** la sonda cerca dove Bob tiene il consumo dell'account

## [0.32.2] (2026-10-23)


### Corretto

* **opencode-lens:** il widget Tool non si rompe con un errore senza messaggio
* **opencode-lens:** il widget Tool non si rompe con un errore senza messaggio

## [0.32.1] (2026-10-23)


### Corretto

* **opencode-lens:** IBM Bob letto con lo schema reale di bob.db e sonda installata con l'app
* **opencode-lens:** IBM Bob letto con lo schema reale di bob.db e sonda installata con l'app

## [0.32.0] (2026-10-23)


### Aggiunto

* **opencode-lens:** «Solo Bob» e «+ Bob» su tutte le viste di analisi, con le query di OpenCode
* **opencode-lens:** IBM Bob come seconda sorgente, facoltativa (LENS_BOB)
* **opencode-lens:** IBM Bob come seconda sorgente, pagina e «Includi Bob»
* **opencode-lens:** pagina IBM Bob e interruttore «Includi Bob» nella dashboard
* **opencode-lens:** selettore OpenCode · + Bob · Solo Bob al posto di «Includi Bob»

## [0.31.1] (2026-10-23)


### Documentazione

* **opencode-lens:** changelog 0.31.0 e 0.30.1 tradotti in inglese e francese
* **opencode-lens:** changelog 0.31.0 e 0.30.1 tradotti in inglese e francese

## [0.31.0] (2026-10-23)


### Aggiunto

* **opencode-lens:** board dei progetti di Vibe Coding con trascinamento delle cartelle
* **opencode-lens:** dettaglio del progetto con tempo di lavoro e proiezione
* **opencode-lens:** documento dei progetti di Vibe Coding
* **opencode-lens:** pagina Security come dashboard: hero con grafici, salute e policy in evidenza, eventi nel tempo
* **opencode-lens:** pagina Security come dashboard: hero con grafici, salute e policy in evidenza, eventi nel tempo
* **opencode-lens:** progetti di Vibe Coding salvati in vibe-projects.json
* **opencode-lens:** proiezione a fine mese di costo, token e tempo
* **opencode-lens:** striscia di riepilogo grafica di Vibe Coding
* **opencode-lens:** Vibe Coding con periodo «Mese» e tabelle compatte
* **opencode-lens:** Vibe Coding con progetti, KPI grafici e proiezione a fine mese
* **opencode-lens:** Vibe Coding divide token, costo e tempo per cartella e per giorno
* **opencode-lens:** Vibe Coding porta il periodo precedente e i giorni del mese corrente


### Corretto

* **opencode-lens:** «Fine mese» della striscia coerente con l'anello dei progetti, etichette dei grafici senza sovrapposizioni
* **opencode-lens:** budget con virgola decimale senza cancellazioni accidentali, fuoco della tastiera nella board, rollback all'ultimo salvato, + Nuovo progetto sempre presente
* **opencode-lens:** proiezione e fine budget contano lo stesso valore di oggi
* **opencode-lens:** stato del budget coerente tra scheda, dettaglio e anello; nota di Fine mese dall'anello; rimosso il codice morto di from=0
* **opencode-lens:** striscia Vibe Coding senza stili inline, etichette e totali dei grafici corretti
* **opencode-lens:** tabelle di Vibe Coding a 3 colonne senza scorrimento, testo dei grafici leggibile su schermi stretti
* **opencode-lens:** Vibe Coding non applica progetti vecchi dopo un salvataggio
* **opencode-lens:** vibe-projects.json tra i file scritti di /api/about


### Documentazione

* **opencode-lens:** campi di /api/vibe-coding e /api/vibe-projects, ritmo a 7 giorni, variazione solo su costo, token e tempo, valuta dei costi
* **opencode-lens:** mockup della pagina Security con hero, salute, policy e grafici
* **opencode-lens:** mockup della pagina Vibe Coding con progetti e proiezione
* **opencode-lens:** Vibe Coding con progetti e proiezione

## [0.30.1] (2026-10-22)


### Documentazione

* **opencode-lens:** changelog 0.30.0 tradotto in inglese e francese
* **opencode-lens:** changelog 0.30.0 tradotto in inglese e francese

## [0.30.0] (2026-10-22)


### Aggiunto

* **opencode-lens:** dashboard senza «pulso», tick selettivo e pausa degli aggiornamenti
* **opencode-lens:** dashboard senza «pulso», tick selettivo e pausa degli aggiornamenti live
* **opencode-lens:** pausa degli aggiornamenti live, «Aggiorna» e niente letture in una scheda in background
* **opencode-lens:** un tick live rilegge solo i dati che le sue modifiche possono aver cambiato


### Corretto

* **opencode-lens:** /metrics e OTLP riusano gli aggregati di sempre finché nulla cambia e al più per 10 s mentre il collector scrive (F-13)
* **opencode-lens:** backpressure sui client SSE lenti e pulizia dei timer (PER-01, ARC-06)
* **opencode-lens:** colori della dashboard e run di un periodo riusati per qualche secondo mentre il collector scrive (F-14)
* **opencode-lens:** il sync scrive i messaggi a blocchi di 500 invece che in una transazione per sessione (F-15)
* **opencode-lens:** la dashboard non si attenua più a ogni aggiornamento e il banner interrompe solo quando è critico
* **opencode-lens:** le espressioni di tempo e di modello su cui stanno gli indici hanno un solo proprietario, store.js (F-25)
* **opencode-lens:** nei contatori di /metrics uno step senza provider e modello aspetta il backfill invece di contare sotto «?» (F-18)
* **opencode-lens:** remediation della security review del 22/10/2026
* **opencode-lens:** rifiuta un database con schema più nuovo invece di crash-loopare (DAT-01)
* **opencode-lens:** se il database non si apre la lens resta su con una pagina che dice perché, invece di riavviarsi ogni 10 secondi (F-16)
* **opencode-lens:** service install accorcia all'ultimo MB un log di launchd oltre i 10 MB (F-29)
* **opencode-lens:** task interni del periodo e prompt senza subagenti (COR-02, COR-03)
* **opencode-lens:** timeout sulle fetch del refresh e header di lingua su ogni POST (CLI-01, CLI-02)
* **opencode-lens:** token non regressivi, commit flag sulle stringhe quotate, nessun leak di listener (COR-01, DAT-03, COR-06, PER-06)


### Documentazione

* **opencode-lens:** aggiornamenti dal vivo, pausa e tick con i kind, in italiano, inglese e francese
* **opencode-lens:** i contatori di /metrics possono scendere dopo una migrazione o una correzione del backfill, ora è scritto (F-17, mitigazione)

## [0.29.1] (2026-10-22)


### Documentazione

* **opencode-lens:** changelog 0.29.0 tradotto in inglese e francese
* **opencode-lens:** changelog 0.29.0 tradotto in inglese e francese

## [0.29.0] (2026-10-22)


### Aggiunto

* **opencode-lens:** aggregati dei guard DLP, controllo incrociato con le chiamate viste da Lens e serie su /metrics
* **opencode-lens:** avviso in Impostazioni › Server MCP quando l'MCP di OpenCode è più vecchio della lens
* **opencode-lens:** avviso in Impostazioni › Server MCP quando l'MCP di OpenCode è più vecchio della lens
* **opencode-lens:** discovery dei guard DLP per convenzione di nome, salute e variabili LENS_SECURITY_*
* **opencode-lens:** endpoint /api/security con vista ridotta da rete e gauge su /metrics
* **opencode-lens:** pagina Security con KPI, eventi, salute e policy dei guard DLP
* **opencode-lens:** pagina Security e tool MCP security
* **opencode-lens:** parsing e sanitizzazione degli audit dei guard DLP
* **opencode-lens:** preset di skill con ordine scelto e peso contro il tetto, import di più file e cartelle dal browser con elenco degli esiti, «già aggiornata» per un contenuto identico e righe di stato sempre presenti
* **opencode-lens:** preset di skill: copia /lens:id, Modifica diretto, skill assenti a parole con «Togli dal preset», errori sotto il campo e avviso per un preset senza skill
* **opencode-lens:** scrittore zip puro e raggruppamento dei file in skill per importare più file e cartelle dal browser
* **opencode-lens:** tool MCP security per l'audit dei guard DLP
* **opencode-lens:** un import identico alla versione corrente non crea una versione; hash e mdChars per versione


### Corretto

* **opencode-lens:** docs dell'MCP: tre tetti sul testo dei preset, percorsi, skill assenti, nome visualizzato e linea di base del watcher (it, en, fr)
* **opencode-lens:** elenco dei preset nelle istruzioni con tetto, skill assenti segnate, name accetta il nome visualizzato, riga su quando chiedere un preset
* **opencode-lens:** i dieci file elencati da detail() scelti per ruolo
* **opencode-lens:** i numeri dell'ordine dei preset si vedono: contatore CSS sulle righe al posto del marcatore di lista, che una riga flex non mostra
* **opencode-lens:** i percorsi della policy non vengono mascherati
* **opencode-lens:** il controllo incrociato cerca i tool di tutto l'audit, non solo del periodo
* **opencode-lens:** il peso di un preset segue l'MCP: corpo più descrizione, cartella, percorsi e cornice, skill scorse in ordine con la forma senza testo e quelle più piccole che ci stanno ancora, «probabilmente» senza testo
* **opencode-lens:** il testo di preset non supera mai i budget, il watcher riannuncia dopo un secondo guasto del client, nota di taglio corretta e confronti dei nomi sullo stesso testo che vede il modello
* **opencode-lens:** il testo di preset rispetta anche 48 KiB e 1900 righe; con skill= il corpo oltre il budget è tagliato a fine riga
* **opencode-lens:** istruzioni MCP: security prima di preset, la frase sui preset resta accanto alla sua riga
* **opencode-lens:** l'adozione delle cartelle non segue i collegamenti; hash con lunghezze; indice illeggibile mai riscritto; rimozioni a prova di interruzione
* **opencode-lens:** l'MCP dà descrizioni fino a 1024 caratteri, percorsi identici a quelli su disco e toglie selettori di variante e riempitivi Hangul
* **opencode-lens:** MCP: le forme di una skill nel preset si costruiscono una alla volta, solo se la precedente non ci sta
* **opencode-lens:** negozio delle skill robusto: errori di scrittura, reconcile che non ferma l'avvio e adotta le cartelle, import di SKILL.md sulla skill giusta
* **opencode-lens:** nomi nello zip decodificati bene, zip di PowerShell accettati, messaggi chiari per gli zip annidati
* **opencode-lens:** pagina Security: confronto con Lens, chiavi della policy, nota sulla policy e righe rifiutate
* **opencode-lens:** pagina Security: niente «null» nel dettaglio degli eventi senza rilevamenti
* **opencode-lens:** pagina Security: verdetto nel sottotitolo, Copia per SHA-256 e call ID, dettaglio stabile al refresh
* **opencode-lens:** pagina Skill: niente scroll di lato su telefono, schede sotto 900 px, feedback con errori distinti, dettaglio sotto la riga, ricerca, ordinamento, contatore e colonna «Nei preset»
* **opencode-lens:** policy e plugin dei guard accettano solo nomi di guard validi
* **opencode-lens:** revisione della libreria di skill: import robusto, MCP nei budget di OpenCode, pagina Skill rifatta
* **opencode-lens:** Security: confronto dal primo evento dell'audit, mascheramento per token, limiti su categorie, esiti e liste
* **opencode-lens:** tool MCP security: totali senza ambito, motivi del giudizio, categorie e liste con il totale
* **opencode-lens:** un indice delle skill illeggibile non sembra una libreria vuota: la pagina mostra il motivo, canSave è falso e import e azioni rispondono 409 finché non lo si ripara
* **opencode-lens:** una skill con gli stessi percorsi e byte ma altri bit di esecuzione è «già aggiornata» e tiene i suoi modi; «SKILL copia 2.md» e «SKILL copy 2.md» non nominano una skill
* **opencode-lens:** una skill illeggibile non ferma il preset, prompts/list dice perché è vuoto, il watcher parte da ciò che il client ha ricevuto, skill lette in parallelo


### Documentazione

* **opencode-lens:** «Skill» nella dashboard: modalità di import con spiegazione, ricerca, ordinamento, «Nei preset», pannello di dettaglio, schede su telefono, copia /lens:id e avvisi dei preset (it, en, fr)
* **opencode-lens:** «Skill»: import di cartelle e più file, ordine e peso dei preset, «già aggiornata», hash e adozione all'avvio, zip-writer e nome o id del preset (it, en, fr)
* **opencode-lens:** pagina Security, contratto dei guard DLP e tool MCP security (it, en, fr)
* **opencode-lens:** Security: regole di mascheramento, confronto con Lens, esiti su /metrics e cosa si vede da rete (it, en, fr)

## [0.28.1] (2026-10-22)


### Corretto

* **opencode-lens:** skill con name da vetrina importata con l'id della cartella o dello slug
* **opencode-lens:** una skill con un name da vetrina prende l'id dalla cartella o dallo slug, come OpenCode

## [0.28.0] (2026-10-22)


### Aggiunto

* **opencode-lens:** frontmatter, id e piano dello zip di una skill
* **opencode-lens:** libreria di skill e preset via MCP
* **opencode-lens:** libreria di skill su disco accanto al database, con versioni
* **opencode-lens:** pagina Skill con libreria, versioni e preset
* **opencode-lens:** preset di skill con validatore condiviso
* **opencode-lens:** rotte /api/skills e /api/skill-presets, Informazioni e disinstallazione
* **opencode-lens:** tool preset, prompt MCP e istruzioni dinamiche con le skill dei preset


### Corretto

* **opencode-lens:** dialogo dei preset senza riga «null», focus dopo il ridisegno, errori in italiano e intestazione Azioni
* **opencode-lens:** pattern dell'id del preset valido per il flag v dei browser
* **opencode-lens:** prompts/get distingue il preset ignoto dai guasti, tetto del testo rigido, brief interi e escape \u nel sorgente
* **opencode-lens:** revisione finale di skill e preset: caratteri invisibili, id, .git, lingua dei rifiuti
* **opencode-lens:** rollback e removeVersion della libreria di skill richiedono una versione
* **opencode-lens:** un import non sovrascrive mai cartelle su disco, versione e avvio più rigorosi


### Modificato

* **opencode-lens:** planEntries e JsonStore riusabili per la libreria di skill


### Documentazione

* **opencode-lens:** libreria di skill, preset e tool preset dell'MCP

## [0.27.1] (2026-10-20)


### Documentazione

* **opencode-lens:** changelog 0.27.0 tradotto in inglese e francese

## [0.27.0] (2026-10-20)


### Aggiunto

* **opencode-lens:** pagina Vibe Coding con tempo di lavoro, token e ripartizioni del periodo
* **opencode-lens:** pagina Vibe Coding con tempo di lavoro, token e ripartizioni del periodo

## [0.26.0] (2026-10-20)


### Aggiunto

* **opencode-lens:** /api/system con core, ripartizione della memoria, rete, salute della lens e andamento recente
* **opencode-lens:** il badge del collegamento con OpenCode passa in fondo al menu, sopra il tema; a icone resta il pallino
* **opencode-lens:** il tema «sistema» ha l'icona di un portatile al posto del mezzo disco
* **opencode-lens:** l'icona del pulsante del tema cambia con la modalità: mezzo disco, sole, luna
* **opencode-lens:** la pagina Sistema cerca processi per PID, porta TCP o UDP e nome; fra le porte in ascolto ci sono anche i socket UDP
* **opencode-lens:** menu laterale, icone del tema e pagina Sistema più completa con ricerca
* **opencode-lens:** pagina Sistema riordinata: salute, prestazioni con i modelli della Galleria, andamento, core, rete e servizi


### Documentazione

* **opencode-lens:** pagina Sistema, badge del collegamento e icone del tema (it, en, fr), con il design

## [0.25.0] (2026-10-20)


### Aggiunto

* **opencode-lens:** aggiungere un widget alla vista dalla Galleria, dentro la sessione di modifica
* **opencode-lens:** confrontare da due a quattro stili dello stesso tipo nella Galleria
* **opencode-lens:** funzioni pure per aggiungere e confrontare dalla Galleria
* **opencode-lens:** Galleria a schede, con Confronta e Aggiungi alla vista
* **opencode-lens:** la Galleria ha una scheda per vista, con ricerca, filtro e indice dei tipi


### Corretto

* **opencode-lens:** l'istogramma di Prompt: distribuzione non si disegnava, una variabile locale copriva la traduzione


### Modificato

* **opencode-lens:** tolti Riepilogo classico, Gauge ad anello pieno e orologio del Hero, migrati a C22, B2 e G1
* **opencode-lens:** tolto il Gauge ad anello pieno; chi l'aveva salvato lo ritrova come B2
* **opencode-lens:** tolto il Riepilogo classico; chi l'aveva salvato lo ritrova come C22
* **opencode-lens:** tolto l'orologio delle ore del Hero; chi l'aveva salvato lo ritrova come G1


### Documentazione

* **opencode-lens:** Aggiungi e Confronta nella Galleria
* **opencode-lens:** design di Confronta e Aggiungi dalla Galleria
* **opencode-lens:** piano di Confronta e Aggiungi dalla Galleria

## [0.24.1] (2026-10-20)


### Corretto

* **opencode-lens:** 0.24.0 tradotta nei CHANGELOG e test che non blocca più il rilascio
* **opencode-lens:** 0.24.0 tradotta nei CHANGELOG e test che non blocca più il rilascio

## [0.24.0] (2026-10-20)


### Aggiunto

* **opencode-lens:** dashboard, server, Novità e documenti in italiano, inglese e francese
* **opencode-lens:** dashboard, server, Novità e documenti in italiano, inglese e francese


### Corretto

* **opencode-lens:** breakdown ordinato e MCP più robusto
* **opencode-lens:** breakdown ordinato per i token totali di ogni gruppo
* **opencode-lens:** MCP: totale di usage coerente, errori della lens tradotti, nomi su una riga

## [0.23.0] (2026-10-19)


### Aggiunto

* **opencode-lens:** file e API dei preset di dashboard
* **opencode-lens:** finestra per gestire i preset di dashboard
* **opencode-lens:** il file dei preset tra i file scritti e nella disinstallazione
* **opencode-lens:** la disposizione ricorda da quale modello parte
* **opencode-lens:** logica dei preset di dashboard
* **opencode-lens:** preset personalizzati dei modelli di dashboard
* **opencode-lens:** preset personalizzati nel menu Modello


### Corretto

* **opencode-lens:** finestra e menu dei preset: chiusura durante il salvataggio, conferma prima di salvare, focus, rinomina e gruppo accessibile
* **opencode-lens:** i preset si rileggono prima di ogni modifica, il modulo non si svuota e il menu scorre su schermi bassi
* **opencode-lens:** il menu Modello scorre in una finestra bassa
* **opencode-lens:** prefs.origin di una versione più nuova si conserva e l'avviso sul file dei preset non si ripete
* **opencode-lens:** un file di preset non valido si conserva prima che un salvataggio lo sostituisca


### Documentazione

* **opencode-lens:** note sui preset dopo le correzioni della revisione
* **opencode-lens:** preset personalizzati dei modelli di dashboard

## [0.22.0] (2026-10-19)


### Aggiunto

* **opencode-lens:** «Mostra i costi», un interruttore unico per nascondere i costi
* **opencode-lens:** Analisi parte dagli ultimi 7 giorni
* **opencode-lens:** i grafici dei singoli prompt leggono fino a 1000 prompt del periodo
* **opencode-lens:** i retry di oggi come Indicatore, con quelli per limite di frequenza
* **opencode-lens:** il primo token si può scegliere come metrica dell'Indicatore
* **opencode-lens:** il widget Budget conta anche step e costo
* **opencode-lens:** periodo «8 ore» nei filtri di Analisi e nei widget


### Corretto

* **opencode-lens:** compaction e nuove sessioni nell'Attività live
* **opencode-lens:** i filtri di Analisi non si spostano quando cambia la frase sotto il titolo
* **opencode-lens:** l'Attività live classica rispetta «Eventi mostrati»
* **opencode-lens:** la nota piccola di «Luci di stato» va a capo invece di tagliarsi
* **opencode-lens:** nel Monitor di Operativa i modelli di oggi sono barre diritte
* **opencode-lens:** nel registro T4 la colonna della sessione è larga quanto il nome più lungo
* **opencode-lens:** tipo «Step falliti» nell'Attività live
* **opencode-lens:** «Modello» mostra il nome del modello per intero, su due righe
* **opencode-lens:** «Prompt in corso» può nascondere il costo
* **opencode-lens:** «Prompt in corso» senza costo in Operativa e Presidio
* **opencode-lens:** «Solo con problemi» filtra i prompt sul server

## [0.21.0] (2026-10-19)


### Aggiunto

* **opencode-lens:** modelli di dashboard scelti dal menu laterale


### Corretto

* **opencode-lens:** scritte di modelli e prompt intere quando lo spazio c'è

## [0.20.0] (2026-10-19)


### Aggiunto

* **opencode-lens:** dimensione dei widget in base allo schermo (Auto, Piccola, Normale, Grande)


### Corretto

* **opencode-lens:** il logo resta fermo quando si riduce il menu a icone
* **opencode-lens:** riquadri di Impostazioni e Sistema su una o due righe, senza troncamenti


### Documentazione

* **opencode-lens:** progetto della dimensione dei widget in base allo schermo

## [0.19.2] (2026-10-19)


### Corretto

* **opencode-lens:** «beta» e versione sotto il nome nel menu, menu laterale più stretto
* **opencode-lens:** «Per modello oggi» classico: badge del ritmo senza testo, con il significato nel tooltip
* **opencode-lens:** «Riduci a icone» in cima al menu, sopra le viste
* **opencode-lens:** «Ultimo anno» in verde, per non confonderlo con «Quando lavori» che resta blu
* **opencode-lens:** barre per modello (B6): nome intero su due righe e barra sul budget del giorno
* **opencode-lens:** l'ultimo evento ricevuto non è più scritto nella dashboard, solo nel tooltip
* **opencode-lens:** nessun avviso di API cambiata se session.step.started non ha data.started
* **opencode-lens:** valori dei riquadri di Impostazioni e Sistema a capo, senza puntini

## [0.19.1] (2026-10-18)


### Corretto

* **opencode-lens:** serie oraria con 25 bucket nel giorno del ritorno all'ora solare

## [0.19.0] (2026-10-18)


### Aggiunto

* **opencode-lens:** pagina «Sistema» con CPU, memoria, processi e servizi in ascolto

## [0.18.0] (2026-10-18)


### Aggiunto

* **opencode-lens:** misure per stile, Riepilogo con stili e carte senza spazio vuoto
* **opencode-lens:** misure per stile, Riepilogo con stili e carte senza spazio vuoto
* **opencode-lens:** posizione libera dei widget, barre del titolo e barra laterale riducibile
* **opencode-lens:** posizione libera dei widget, barre del titolo e barra laterale riducibile


### Documentazione

* **opencode-lens:** mockup delle barre del titolo in quattro direzioni

## [0.17.1] (2026-10-18)


### Corretto

* **opencode-lens:** le istruzioni dell'MCP indicano lens-guard per il cambio di modello
* **opencode-lens:** le istruzioni dell'MCP indicano lens-guard per il cambio di modello

## [0.17.0] (2026-10-18)


### Aggiunto

* **opencode-lens:** aggiornamento della lens da zip in Impostazioni
* **opencode-lens:** lettura e verifica dello zip di aggiornamento
* **opencode-lens:** POST /api/update e /api/update/apply, aggiornamento con install.sh
* **opencode-lens:** sezione Aggiornamento in Impostazioni


### Documentazione

* **opencode-lens:** aggiornamento dalla dashboard
* **opencode-lens:** spec e piano dell'aggiornamento da zip in Impostazioni

## [0.16.0] (2026-10-18)


### Aggiunto

* **opencode-lens:** GET /api/mcp/status, stato del server MCP letto da OpenCode
* **opencode-lens:** Server MCP, nome lens indicato nella pagina e stati più precisi
* **opencode-lens:** sezione Server MCP in Impostazioni
* **opencode-lens:** sezione Server MCP in Impostazioni
* **opencode-lens:** stato e collegamento del server MCP, logica pura


### Documentazione

* **opencode-lens:** piano della sezione Server MCP in Impostazioni
* **opencode-lens:** spec della sezione Server MCP approvata

## [0.15.0] (2026-10-18)


### Aggiunto

* **opencode-lens:** /api/errors e server MCP opencode-lens mcp per OpenCode
* **opencode-lens:** /api/errors raggruppa step, tool, retry ed esecuzioni fallite per modello, tipo e status
* **opencode-lens:** barra laterale, vista Monitor e stili dei modelli selezionabili
* **opencode-lens:** extras/ nel pacchetto e nell'installazione, documentazione di lens-guard
* **opencode-lens:** l'MCP legge porta e token dal plist; opencode-lens mcp install stampa la riga per opencode2
* **opencode-lens:** plugin lens-guard, cambio di modello quando il provider non risponde
* **opencode-lens:** plugin lens-guard, cambio di modello su quota esaurita, rate limit lungo o provider irraggiungibile
* **opencode-lens:** server MCP stdio con le revisioni 2025-11-25 e 2026-07-28, scritto a mano
* **opencode-lens:** tool MCP budget, errors, usage e sessions con testo degli errori solo quando permesso


### Corretto

* **opencode-lens:** gli orari dell'MCP seguono il fuso corrente
* **opencode-lens:** l'MCP non lascia chiudere le «» dal testo, legge tutte le sessioni e rilegge il plist a ogni chiamata
* **opencode-lens:** lens-guard si fida del tipo d'errore di OpenCode, cambia solo se la connessione non parte e non riparte la catena a metà turno


### Documentazione

* **opencode-lens:** piano del ramo reattivo di lens-guard
* **opencode-lens:** piano di /api/errors e del server MCP opencode-lens mcp
* **opencode-lens:** server MCP per OpenCode in configurazione, metriche, README e architettura
* **opencode-lens:** valutazione MCP e plugin OpenCode sopra le API di Lens
* **opencode-lens:** valutazione MCP e plugin OpenCode sopra le API di Lens
* **opencode-lens:** valutazione MCP e plugin OpenCode sopra le API di Lens

## [0.14.1] (2026-10-17)


### Corretto

* **opencode-lens:** Adesso rilegge il giorno dei budget appena si azzera
* **opencode-lens:** gli id dei widget di una vista sconosciuta contano nell'unicità tra le viste
* **opencode-lens:** gli spazi tra i segmenti della barra di composizione hanno il colore della superficie
* **opencode-lens:** i run in corso escludono le sessioni eliminate
* **opencode-lens:** il test del contratto con OpenCode Monitor verifica lo stato 200
* **opencode-lens:** la data del calendario usa fmtLongDate come le altre date
* **opencode-lens:** la riga di dettaglio aggiorna il colspan quando il widget Prompt cambia larghezza
* **opencode-lens:** rimanenze minori delle review della dashboard v2
* **opencode-lens:** test, l'idle di un subagente non manda eventi run nel feed
* **opencode-lens:** una sola regola per i limiti dei modelli, intero positivo sicuro o nessuno
* **opencode-lens:** unità sugli assi di distribuzione e ora per ora, didascalia di Andamento nascosta senza dati

## [0.14.0] (2026-10-17)


### Aggiunto

* **opencode-lens:** eventi dal vivo per primo token, fine dello stream, interruzioni, titoli e compaction
* **opencode-lens:** metriche e span OTLP per primo token, tok/s, interruzioni e task interni
* **opencode-lens:** orari degli step e compaction esatte dalla lettura dei messaggi
* **opencode-lens:** primo token, tok/s, motivi delle interruzioni e task interni per tipo nella dashboard
* **opencode-lens:** schema v4 — primo token, tok/s, motivo delle interruzioni e task interni esatti
* **opencode-lens:** schema v4 con orari degli step, motivo dei run e tipo dei task interni
* **opencode-lens:** task interni esatti che assorbono la stima senza contare due volte
* **opencode-lens:** velocità degli step, motivi delle interruzioni e task interni per tipo nelle API


### Corretto

* **opencode-lens:** «Prompt in corso» senza durate assurde né ritardi
* **opencode-lens:** /api/timeseries accetta di nuovo il parametro model usato da OpenCode Monitor
* **opencode-lens:** /api/timeseries accetta di nuovo il parametro model usato da OpenCode Monitor
* **opencode-lens:** /metrics somma primo token e tok/s degli step in SQL
* **opencode-lens:** compaction dal vivo solo con l'id del suo started, e la lettura non riporta la richiesta al primo tentativo
* **opencode-lens:** durate sotto i 10 minuti con i secondi («1 min 30 s»)
* **opencode-lens:** i prompt del periodo intero si calcolano una volta per aggiornamento
* **opencode-lens:** Inizio, Fine e Spazio sulle schede «Adesso | Analisi»
* **opencode-lens:** la fine dello stream di un tentativo precedente non sovrascrive quella dell'ultimo
* **opencode-lens:** nel dettaglio della sessione i task interni sono raggruppati per tipo e modello
* **opencode-lens:** prompt e sessioni a pagine seguono l'altezza del widget
* **opencode-lens:** rifiniture della dashboard v2
* **opencode-lens:** rifiniture dello schema v4 dopo la review
* **opencode-lens:** test che ogni tipo del catalogo ha il suo widget, niceMax tolto
* **opencode-lens:** un trascinamento non finisce nell'altra vista se la vista cambia
* **opencode-lens:** una riga esatta dei task interni non scende più a una rilettura
* **opencode-lens:** una risposta vuota non resta «in attesa del primo token» fino alla fine dello step


### Documentazione

* **opencode-lens:** design dello schema v4 (velocità degli step, motivo delle interruzioni, task interni esatti)
* **opencode-lens:** documentazione dello schema v4
* **opencode-lens:** lo span di un run si invia una volta, senza un motivo d'interruzione arrivato dopo
* **opencode-lens:** piano di implementazione dello schema v4

## [0.13.0] (2026-10-17)


### Aggiunto

* **opencode-lens:** «prompt concluso» nell'attività live
* **opencode-lens:** Andamento a colonne o linea, feed e calendario che si adattano al widget
* **opencode-lens:** calcoli puri per i widget di Adesso
* **opencode-lens:** dashboard a due viste, Adesso e Analisi, con i prompt e il prompt in corso
* **opencode-lens:** disposizione a due viste con migrazione automatica
* **opencode-lens:** elenco dei prompt con token per tipo, durata e tool (/api/runs)
* **opencode-lens:** elenco e distribuzione dei prompt nella dashboard
* **opencode-lens:** hero di oggi, modelli, indicatori e prompt in corso
* **opencode-lens:** la disposizione v2 in dashboard-v2.json, quella v1 resta intatta
* **opencode-lens:** limite di contesto dei modelli dalla config e dal catalogo di OpenCode
* **opencode-lens:** periodo «day» (giorno dei budget) per gli endpoint con from
* **opencode-lens:** prompt in corso dal vivo (/api/runs/live)
* **opencode-lens:** stati vuoto, errore e caricamento uguali per tutti i widget
* **opencode-lens:** token ora per ora di oggi e indicatori per giorno (/api/hourly, /api/daily)
* **opencode-lens:** viste Adesso e Analisi nella dashboard


### Corretto

* **opencode-lens:** assi dei grafici senza etichette ripetute
* **opencode-lens:** con la lens irraggiungibile i widget mostrano l'errore invece di restare fermi
* **opencode-lens:** formati it-IT di costi, durate e date
* **opencode-lens:** il catalogo dei modelli non segnala un cambio di API per i modelli senza contesto
* **opencode-lens:** la distribuzione dei prompt si ridisegna alla sua misura tornando dalla tabella al grafico
* **opencode-lens:** ora corrente nel fuso del server e widget di Adesso senza scroll interni a 900 px
* **opencode-lens:** soFarAvg conta i giorni precedenti solo fino allo stesso scostamento di now
* **opencode-lens:** widget predefiniti senza scroll interni, da 375 a 1440 px


### Modificato

* **opencode-lens:** i run dal vivo cercano negli indici della finestra invece di leggere tutti gli step e i tool


### Documentazione

* **opencode-lens:** corrette le forme di runs/summary e runs/live e il ritorno a una versione vecchia
* **opencode-lens:** dashboard a due viste, prompt e nuove API
* **opencode-lens:** design e piano della dashboard a due viste
* **opencode-lens:** documentazione allineata alla dashboard v2

## [0.12.2] (2026-10-17)


### Corretto

* **opencode-lens:** correzioni dalla revisione del codice
* **opencode-lens:** gli step interrotti non restano «in corso» per sempre nel Riepilogo e nelle sessioni
* **opencode-lens:** OPENCODE_SERVER_URL con utente e password è rifiutato invece di finire negli errori
* **opencode-lens:** plist, database e dashboard.json leggibili solo dal proprietario


### Modificato

* **opencode-lens:** tolto il codice mai usato segnalato dalla revisione

## [0.12.1] (2026-10-17)


### Corretto

* **opencode-lens:** install.sh si fermava con «APP…: unbound variable» nel Terminale di macOS

## [0.12.0] (2026-10-17)


### Aggiunto

* **opencode-lens:** install.sh controlla e pulisce le installazioni precedenti
* **opencode-lens:** installazione da zip con un solo comando, senza sudo


### Documentazione

* **opencode-lens:** versioni e rilasci con i due zip e la compatibilità dell'installazione

## [0.11.0] (2026-10-17)


### ⚠ BREAKING CHANGES

* **opencode-lens:** niente più formula Homebrew né tap vale76p/tap. Chi aveva installato con brew passa allo zip: estrarlo in ~/Applications, lanciare node ~/Applications/opencode-lens/src/main.js service install (conserva variabili, database e disposizione), poi brew uninstall opencode-lens e brew untap vale76p/tap.

### Modificato

* **opencode-lens:** installazione dallo zip della release, senza Homebrew

## [0.10.0] (2026-10-17)


### ⚠ BREAKING CHANGES

* **opencode-lens:** in /metrics e nell'export OTLP opencode_lens_steps_total non ha più finish="running" (gli step finiti senza motivo hanno finish="unknown") e opencode_lens_tool_calls_total, opencode_lens_tool_output_bytes_total e opencode_lens_tool_duration_seconds non hanno più status="pending"/"running"/"?". Per ciò che è in corso usare opencode_lens_steps_running e opencode_lens_tool_calls_running (vedi docs/metriche.md).

### Aggiunto

* **opencode-lens:** conteggi corretti e gauge per step e tool in corso


### Corretto

* **opencode-lens:** catena di rilascio più sicura
* **opencode-lens:** dashboard più affidabile con lens ferma e sessioni attive
* **opencode-lens:** server e impostazioni più robusti, niente segreti negli errori

## [0.9.0] (2026-10-16)


### Aggiunto

* **opencode-lens:** budget attivi solo per i modelli della configurazione di OpenCode
* **opencode-lens:** budget per modello dalle Impostazioni, con lo storico
* **opencode-lens:** card «Budget per modello» nelle Impostazioni
* **opencode-lens:** gauge del budget di un modello e tipo di widget models
* **opencode-lens:** lettura dei modelli dalla configurazione globale di OpenCode
* **opencode-lens:** widget «Budget per modello» e gauge per modello


### Corretto

* **opencode-lens:** budget con il punto delle migliaia rifiutati e LENS_MODEL_LIMITS scritta a mano non più bloccante
* **opencode-lens:** giorno dei budget nel cambio all'ora legale e modelli mai visti senza «via libera»


### Documentazione

* **opencode-lens:** budget per modello dalla configurazione di OpenCode
* **opencode-lens:** budget per modello e ora di reset
* **opencode-lens:** design dei budget per modello dalla configurazione di OpenCode
* **opencode-lens:** piano dei budget per modello dalla configurazione di OpenCode

## [0.8.1] (2026-10-16)


### Modificato

* **opencode-lens:** «Oggi» senza la barra della fascia 7–19

## [0.8.0] (2026-10-16)


### Aggiunto

* **Widget «Budget e reset»**: giorno, settimana e mese per la metrica scelta, con uso sul budget `LENS_LIMIT_*`, proiezione al reset e **quando si azzerano**, cioè conto alla rovescia («si azzera tra 2 g 9 h») e data e ora («lun 19/10 00:00»). I periodi seguono il calendario in ora locale: il giorno da mezzanotte, la settimana da lunedì, il mese dal giorno 1. È nella disposizione predefinita, sotto «Oggi» e «Ultimo anno», e nel catalogo per chi ha già personalizzato la dashboard
* I gauge di budget dicono anche fra quanto si azzera il loro periodo


### Documentazione

* `/api/budget`: `from` e `to` sono inizio e reset del periodo (ms epoch, ora locale), `elapsed` la frazione trascorsa

## [0.7.1] (2026-10-16)


### Corretto

* **opencode-lens:** la formula Homebrew scarica l'archivio del tag con HOMEBREW_GITHUB_API_TOKEN

## [0.7.0] (2026-10-16)


### Aggiunto

* **Installazione con Homebrew** dal tap privato vale76p/homebrew-tap: `brew tap vale76p/tap`, `brew install vale76p/tap/opencode-lens`, `opencode-lens service install`. Tutto nella cartella utente, senza `sudo`; guida nel [README](README.md#installazione-con-homebrew)
* **`opencode-lens service install | uninstall [--purge] | start | stop | restart | status`**: gestisce il LaunchAgent `local.opencode-lens` al posto di `install.sh` e `uninstall.sh`, che restano come involucri per chi lavora da un clone. Conserva le variabili del plist (budget, `LENS_TOKEN`…), usa i percorsi stabili di Homebrew (`/opt/homebrew/opt/…`), riabilita il servizio spento dal Monitor e ritenta il bootstrap
* **Riavvio automatico dopo un aggiornamento**: partita da launchd, la lens nota la versione nuova (per esempio dopo `brew upgrade`) e si riavvia da sola entro un minuto
* A ogni release il workflow aggiorna la formula del tap (secret `HOMEBREW_TAP_TOKEN`, vedi [README](README.md#versioni-e-rilasci))


### Documentazione

* README, disinstallazione, troubleshooting e configurazione per l'installazione con Homebrew; design e piano in `docs/superpowers/`

## [0.6.0] (2026-10-16)


### Aggiunto

* **Dashboard personalizzabile**: con «Personalizza dashboard» i blocchi diventano widget su una griglia di 12 colonne. Si spostano trascinandoli (o con le frecce), si ridimensionano dall'angolo, si tolgono e si aggiungono dal catalogo, anche più volte lo stesso. La disposizione si salva in `dashboard.json` accanto al database: è personale e non finisce nel pacchetto. Guida: [docs/dashboard.md](docs/dashboard.md)
* **Impostazioni per widget** (⚙): periodo, metrica, raggruppamento e titolo propri, oppure «Dashboard» per seguire i filtri in alto
* **Widget gauge**, a semicerchio o ad anello: budget del giorno, della settimana o del mese con la proiezione, prompt da cache, step falliti, chiamate tool con errore
* **Widget linea** con curve morbide e area sfumata, una linea per modello, agente o provider, oppure il totale (`/api/timeseries?by=total`)
* **Variabili d'ambiente modificabili dalla pagina Impostazioni** con il LaunchAgent di `install.sh`: validate come all'avvio, scritte nel plist, lens ricaricata
* **«Oggi»**: barra dei token 0–24 (blu) e della fascia 7–19 (verde) con gli orari, data e budget nel pulsante «i», accanto al calendario annuale
* Statistiche dei run su una sola riga; sessioni del periodo 10 per pagina (`/api/sessions` con `offset` e il totale nell'header `x-total-count`)


### Corretto

* `install.sh` riprova il bootstrap se launchd non ha ancora finito di scaricare il servizio: prima poteva lasciare la lens ferma con «Bootstrap failed: 5»


### Modificato

* La dashboard è in moduli ES: `ui.js`, `layout.js` (condiviso con il server per validare), `widgets.js`, `editor.js`, `gauge.js`, `curves.js`


### Documentazione

* Nuova guida [docs/dashboard.md](docs/dashboard.md); design e piano della dashboard personalizzabile in `docs/superpowers/`

## [0.5.0] (2026-10-16)


### Aggiunto

* **opencode-lens-monitor:** app nella barra dei menu con pannello e widget


### Corretto

* **opencode-lens:** install.sh conserva le EnvironmentVariables del plist esistente
* **opencode-lens:** install.sh conserva le EnvironmentVariables del plist esistente

## [0.4.0] (2026-10-16)


### Aggiunto

* **opencode-lens:** budget settimanali e mensili e /api/budget
* **opencode-lens:** budget settimanali e mensili LENS_LIMIT_*_WEEKLY e _MONTHLY
* **opencode-lens:** endpoint /api/budget per l'app monitor e i widget
* **opencode-lens:** periodi di calendario con proiezione e ritmo per giorno, settimana e mese

## [0.3.1] (2026-10-15)


### Corretto

* **opencode-lens:** export OTLP in delta senza reinvio dello storico al riavvio e senza perdita dopo un invio fallito
* **opencode-lens:** gli span in errore portano solo il tipo dell'errore, l'endpoint OTLP compare senza credenziali
* **opencode-lens:** la serie attuale del calendario non si azzera a inizio giornata
* **opencode-lens:** permessi in attesa come gauge, LENS_PORT=0 accettata anche nel controllo Host, --help con tutte le variabili anche se l'ambiente non è valido
* **opencode-lens:** prompt e run dei subagenti esclusi da Run e interazione e dalle metriche, il loro costo resta nel run della sessione padre
* **opencode-lens:** tracce OTLP esportate run per run in ordine di registrazione, con ogni step sotto il suo run e senza span persi
* **opencode-lens:** un prompt inviato a run in corso non spezza più il run

## [0.3.0] (2026-10-15)


### Aggiunto

* **opencode-lens:** barra Oggi con budget giornalieri e calendario annuale
* **opencode-lens:** dimensione dell'output e tool eseguiti dal provider nella tabella Tool
* **opencode-lens:** export facoltativo OTLP/HTTP JSON di metriche (cumulative o delta) e tracce run, step e tool
* **opencode-lens:** LENS_LABELS su ogni serie di /metrics e nuove metriche per run, prompt, permessi, commit, subagenti, budget e durata dei tool
* **opencode-lens:** prompt (solo lunghezza e allegati), permessi con risposta e tempo di attesa, git commit riusciti e costo per commit
* **opencode-lens:** run dal prompt alla risposta con esito, durata e costo compresi i subagenti, ricostruiti anche per le sessioni senza messaggi idle
* **opencode-lens:** subagenti collegati alla chiamata task che li lancia, totale delle sessioni con i subagenti e raggruppamento per tipo di agente
* **opencode-lens:** timeline della sessione con step, tool e run, pause oltre il minuto accorciate


### Corretto

* **opencode-lens:** eventi con id già visto scartati, così il feed live non li mostra due volte
* **opencode-lens:** validazione delle variabili d'ambiente, colonna esecuzione dei tool

## [0.2.0] — 2026-10-15

### Aggiunto

- **Pagina Impostazioni** nella dashboard (`#impostazioni`): versione e processo, file scritti dalla lens con stato, dimensione e data (database, WAL, log, LaunchAgent), file letti, dati salvati nel browser, stato del database, variabili d'ambiente effettive con la loro origine (i segreti non vengono mai mostrati) e i comandi di disinstallazione completa già compilati con i percorsi di questa installazione.
- **Pagina Novità** (`#novita`): questo changelog, con la versione installata evidenziata e un indicatore nella navigazione quando la versione cambia.
- Versione accanto al titolo della dashboard, `--version` da riga di comando, metrica `opencode_lens_build_info` in `/metrics`.
- Endpoint `/api/about` e `/api/changelog`.
- Guida [docs/disinstallazione.md](docs/disinstallazione.md): eliminazione completa di servizio, database, log, cartella dell'app e dati del browser, con i comandi di verifica.
- Versioning: tag `opencode-lens-vX.Y.Z`, workflow `opencode-lens-release` che verifica tag, versione e changelog, crea lo zip e pubblica la release su GitHub; `scripts/changelog.mjs` per controllare il changelog ed estrarre le note.

### Modificato

- La versione ha una sola fonte, `package.json`: `/api/status` la legge da lì invece di averla scritta nel codice.
- Lo zip non è più committato in `dist/`: è allegato alla release GitHub. `npm run package` lo crea ancora in locale.

## [0.1.0] — 2026-10-15

Prima versione. Verificata contro OpenCode V2 beta 17823.

### Aggiunto

- **Collector**: discovery del servizio condiviso da `service.json` (rilettura a ogni riconnessione, Basic auth), stream live da `/api/event` con riconnessione e backoff, backfill autorevole da `/api/session` e `/api/session/{id}/message` alla connessione, ogni 2 minuti e a fine run.
- **Numeri esatti**: upsert idempotenti per ID, retry contati come tentativi dello stesso step, task interni (titolo, compaction) ricavati come *totale sessione − Σ step* senza doppi conteggi; `npm run verify` riconcilia il DB con i totali di OpenCode.
- **Dashboard** su `http://127.0.0.1:4777`: token per tipo, costo, cache, latenza p50/p95, output tok/s, serie per ora/giorno/settimana in ora locale, breakdown per modello, agente, provider e cartella, tool con errori più frequenti, sessioni con dettaglio degli step, feed live. Colori stabili per i 6 modelli più usati di sempre.
- **API locale** JSON, `/api/live` (SSE) e `/metrics` in formato Prometheus.
- **Sicurezza e privacy**: solo `127.0.0.1` per default, controllo dell'header `Host`, solo GET, CSP restrittiva, nessun proxy verso l'API di OpenCode; `LENS_TOKEN` obbligatorio per esporla in rete. Nessun prompt, risposta o output dei tool salvato; titoli opzionali (`LENS_STORE_TITLES=0`).
- **Segnalazione del drift dell'API** beta: avviso in dashboard, `/api/status` e `/metrics` quando gli eventi cambiano forma.
- **Installazione** come LaunchAgent macOS con `install.sh` / `uninstall.sh` (`--purge` per eliminare DB e log).
- **Test** `node:test` senza dipendenze, con un finto servizio OpenCode; pacchetto `dist/opencode-lens-0.1.0.zip` creato da `scripts/package.sh`.

