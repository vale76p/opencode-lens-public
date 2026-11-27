# Security: i guard DLP

🌐 Italiano · [English](en/sicurezza.md) · [Français](fr/sicurezza.md)

Un **guard DLP** è un plugin di OpenCode che controlla ciò che i tool MCP esterni stanno per mandare fuori (per esempio il testo di una richiesta a un servizio di documentazione) e lo lascia passare, lo blocca o chiede a te. Quello che esiste oggi è **Context7 Guard**, ma la pagina **Security** (`#security`) non lo conosce per nome: legge i file che un guard lascia per conto suo, quindi un guard nuovo compare da solo.

La pagina risponde a tre domande:

1. **Cosa è passato e cosa è stato bloccato**, in un periodo a tua scelta.
2. **Perché**: quali categorie di dati il guard ha riconosciuto, in quale tool e su quale oggetto.
3. **Il guard funziona?** Se il suo audit è leggibile e recente, se la sua policy è valida e se registra tutte le chiamate che Lens ha visto.

La lens **non scrive niente** nei file del guard e non ne cambia il comportamento: apre in sola lettura i suoi file e basta. Nel database e in `/metrics` non finiscono mai né i testi né le anteprime: gli eventi si rileggono dal file a ogni richiesta (con una cache sulla data di modifica).

## Il modulo Security

Security è un **modulo** (`modules/security/`, vedi [moduli.md](moduli.md)) e di partenza è **spento**: si attiva da **Impostazioni › Moduli**. Spento non ha voce nel menu, `/api/security` e `/api/security/<guard>` rispondono 404, `/metrics` non ha la serie `opencode_lens_security_events` e il server MCP non offre lo strumento `security`. Con il modulo spento la lens non legge i file dei guard: guarda solo se c'è un audit, per l'avviso «era in uso: riattivalo da Impostazioni › Moduli» dopo un aggiornamento. Le cartelle che cerca sono due impostazioni del modulo (vedi [Cartelle cercate](#cartelle-cercate)).

## Come la lens trova un guard

Per convenzione di nome. Un guard `<nome>` lascia fino a tre tracce:

| Cosa | Dove | Obbligatorio |
|---|---|---|
| **Audit** | `<nome>.audit.jsonl` nella cartella dati di OpenCode (`$XDG_DATA_HOME/opencode`, di solito `~/.local/share/opencode`) o nella sua sottocartella `security/` | sì: è quello che fa esistere il guard |
| **Policy** | `<nome>.json` nella cartella di configurazione di OpenCode (`$XDG_CONFIG_HOME/opencode`, di solito `~/.config/opencode`) | no |
| **Plugin** | un file `plugins/<nome>.*` o `plugins/<nome>-*` con estensione `.ts`, `.js` o `.mjs` nella stessa cartella di configurazione: dopo il nome viene un punto o un trattino, così il guard `a` non prende `aws-tool.ts` | no |

Per Context7 Guard sono, per esempio, `context7-guard.audit.jsonl`, `context7-guard.json` e `plugins/context7-guard.v2.ts`.

**Per far comparire un guard nuovo basta che scriva un `<nome>.audit.jsonl`** in una di quelle cartelle. Non serve cambiare Lens, né registrarlo, né dichiararlo in un file: la policy e il plugin, se ci sono, si riconoscono dal nome.

Regole:

- `<nome>` è fatto di minuscole, cifre e trattini (`context7-guard`), al massimo 40 caratteri. Gli altri file `.audit.jsonl` sono ignorati.
- Le cartelle si scandiscono senza entrare nelle sottocartelle. Se lo stesso nome compare in due cartelle vince la prima. I guard mostrati sono al massimo 20, in ordine alfabetico.
- Si leggono solo file regolari: un link simbolico non viene mai seguito. Il plugin non viene mai aperto: la lens guarda solo che il file ci sia.
- L'etichetta del guard è il nome in forma leggibile (`context7-guard` diventa «Context7 guard»).

### Una riga dell'audit

Ogni riga è un oggetto JSON. Tutti i campi sono facoltativi tranne l'ora; ciò che manca resta vuoto, senza errori.

| Campo | Cosa è |
|---|---|
| `ts` | l'ora: testo ISO 8601 oppure millisecondi dall'epoca. Senza un'ora valida, o con un'ora più di un giorno nel futuro, la riga è scartata |
| `outcome` | l'esito. `allowed` (consentito), `blocked` (bloccato), `approved-by-user` e `rejected-by-user` sono tradotti; un altro valore (minuscole e trattini, fino a 40 caratteri) si mostra com'è, uno non valido diventa «?» |
| `tool` | il tool MCP chiamato |
| `kind` | il tipo di chiamata |
| oggetto | su cosa verteva la chiamata, preso dal **primo campo presente tra `object`, `library`, `target` e `resource`** (fino a 120 caratteri) |
| `findings` | fino a 20 rilevamenti `{ category, detail, field }`. `category` è un codice di maiuscole, cifre e `_` (`INFRA_INTERNA`); `detail` è il testo del guard (fino a 160 caratteri) |
| `chars`, `lines` | dimensione di ciò che si stava mandando |
| `sha256` | l'impronta (esadecimale) di ciò che si stava mandando; il tool MCP ne mostra i primi 12 caratteri, gli stessi del messaggio di blocco del guard |
| `sessionID` | la sessione di OpenCode: è il legame con le sessioni di Lens |
| `callID`, `partID`, `runtime` | identificativi che la pagina mostra nel dettaglio |
| `args` | l'anteprima: un oggetto fino a 4096 caratteri. Se il guard non lo scrive, il dettaglio dice «non registrata dal guard» |

Una riga che non si legge (JSON rotto, più di 8 KiB, senza ora valida o con un'ora più di un giorno nel futuro) non entra negli eventi ma viene contata come **riga illeggibile**. L'ultima riga, se non finisce con un a capo, è ancora in scrittura: si ignora senza contarla. Un audit più grande di **20 MiB** si legge solo in coda (gli ultimi 20 MiB): la salute lo segnala.

I codici di categoria si mostrano in forma leggibile (`INFRA_INTERNA` diventa «Infra interna») e ognuno prende un colore dalla tavolozza della pagina, sempre lo stesso per lo stesso codice. Le categorie sono 6 colori per un numero qualsiasi di codici: due categorie diverse possono avere lo stesso colore, quindi il nome conta più del colore.

## La pagina

Con il modulo attivo, `#security` sta nel gruppo *Lens* della barra laterale, dopo Sistema (se è attivo anche lui). È una pagina fissa (non un widget) in sola lettura, con un periodo suo: **7 giorni**, **30 giorni** (di partenza) o **Tutto**, ricordato dal browser. Si rilegge ogni 10 secondi mentre è aperta.

- Sotto il titolo, il guard scelto e il suo **verdetto** in parole; il pallino accanto all'ora dell'aggiornamento ne prende il colore.
- Un pulsante per ogni **guard**, con un pallino del colore del verdetto (verde, giallo, rosso).
- **In alto**, una fascia scura con sei tessere, ognuna col suo grafico:
  - *Stato del guard*: un anello con i controlli senza problemi (per esempio 5/5), il verdetto e una barretta colorata per ogni controllo;
  - *Chiamate* (con quante consentite) e *Blocchi*, con l'andamento nel periodo e la **variazione** rispetto al periodo prima della stessa durata (per i blocchi un aumento è rosso). La variazione manca con *Tutto* e quando l'audit non arriva fino all'inizio del periodo prima, perché lo farebbe sembrare più tranquillo di quanto era;
  - *Tasso di blocco*, con la sua media mobile su 7 punti. Compare solo se nel periodo c'è almeno una chiamata consentita: se il guard registra solo i blocchi, la tessera dice «solo blocchi registrati»;
  - *Rilevato*: la categoria più frequente e una barra con la ripartizione delle categorie;
  - *Ultimo blocco*: quando e in quale tool, con i blocchi delle ultime 24 ore su una riga.

  Un blocco è un `blocked` o un `rejected-by-user`; una consentita è un `allowed` o un `approved-by-user`.
- **Salute**: il verdetto con uno scudo e una riga per ogni controllo, con lo stato, il valore e una nota che dice perché conta o cosa guardare (vedi [sotto](#salute)).
- **Policy**, accanto alla salute: le protezioni accese o spente e le chiavi divise in gruppi, vedi [sotto](#la-policy).
- **Eventi**: sopra la tabella, chiamate e blocchi nel tempo. Le chiamate (consentite e approvate dall'utente) stanno sopra l'asse, i blocchi (bloccati e rifiutati dall'utente) sotto, su una scala loro, perché pochi blocchi su molte chiamate sarebbero altrimenti invisibili; un punto per ora con un periodo fino a 2 giorni, per giorno fino a 120 giorni, per settimana oltre. Passando sopra un punto si leggono i suoi conteggi. Poi la tabella, dal più recente, 50 per pagina (*Precedenti* e *Successivi*), con il filtro **Tutti** o **Solo blocchi**. Ogni riga ha ora, esito, tool, oggetto e categorie. Un clic su una riga apre il dettaglio: oggetto e tipo, campo, dimensione, sessione (titolo e cartella, se Lens la conosce), se Lens ha visto anche il tool, l'identificativo della chiamata, il runtime, l'impronta, i rilevamenti con il loro testo e l'**anteprima** (solo se il guard scrive `args`). Accanto all'identificativo e all'impronta c'è un pulsante **Copia**. Mentre il dettaglio è aperto, la rilettura ogni 10 secondi non lo ridisegna finché l'evento non cambia, quindi il testo selezionato resta.
- Accanto agli eventi: **Cosa è stato rilevato** (eventi per categoria, le prime 8), **Per tool** (eventi dei 10 tool più usati, con la parte bloccata) e **Quando succede** (i blocchi per giorno della settimana e ora, nell'ora locale del computer della lens).
- Senza nessun guard, la pagina dice quali cartelle ha cercato e rimanda a questo documento.

I totali, le tessere, i grafici e le categorie sono sempre quelli di **tutto il periodo**: il filtro dei blocchi e la paginazione cambiano solo la tabella.

## Salute

Per ogni guard la lens risponde a «posso fidarmi?» senza chiedere niente al guard:

| Controllo | Cosa guarda |
|---|---|
| Audit | che ci siano eventi; dimensione; righe illeggibili; se è stato letto solo in coda |
| Policy | che `<nome>.json` ci sia, sia un JSON valido (oggetto) e stia entro 1 MiB. Se contiene `auditLog`, che sia una stringa e punti proprio al file di audit trovato (si espande solo un `~/` iniziale, e i link simbolici delle cartelle si risolvono da entrambe le parti); un `auditLog` che non è una stringa conta come «punta a un altro file» |
| Plugin | che il file in `plugins/` ci sia |
| Ultimo evento | quando; **oltre 7 giorni** è «vecchio» |
| Confronto con Lens | vedi sotto |

Il **verdetto** è il peggiore dei controlli. È *guasto* (rosso) se la policy esiste ma non è valida. È *da controllare* (giallo) se l'ultimo evento è vecchio, ci sono righe illeggibili, l'audit è letto solo in coda, `auditLog` punta a un altro file, la policy è troppo grande o il confronto con Lens trova un divario. Altrimenti è *ok* (verde). Un plugin o una policy assenti non abbassano il verdetto: sono facoltativi.

### Confronto con Lens

È l'unico segnale «vivo» che non chiede niente al guard. I nomi distinti di `tool` che compaiono nell'audit (da sempre, non solo nel periodo) sono i tool che il guard sorveglia. Per il periodo scelto la lens conta nel suo database le chiamate a quei tool e le confronta con le righe dell'audit:

- uguali: «12 chiamate, come in Lens»;
- **più chiamate in Lens che nell'audit**: «Lens ha visto 12 chiamate, l'audit 0» è un divario (verdetto giallo). Vuol dire che il guard non sta registrando: è spento, non è caricato, è stato aggirato o non scrive le chiamate consentite;
- «Non verificabile» se l'audit non nomina ancora nessun tool.

Le chiamate di Lens si contano dall'evento più vecchio che l'audit contiene ancora, quando è più recente dell'inizio del periodo: le chiamate fatte prima che il guard cominciasse a scrivere, prima di una rotazione dell'audit o prima della parte letta di un audit oltre 20 MiB non sono un divario. Un guard che ha scritto in passato e nel periodo non scrive più niente dà invece un divario.

La pagina non decide al posto tuo cosa sia successo: dà le due cifre. Per un guard che registra **solo i blocchi** il confronto segnala un divario ogni volta che una chiamata passa, perché Lens la conta e l'audit no.

## La policy

Se `<nome>.json` esiste e vale, la pagina ne mostra tutte le chiavi di primo livello (fino a 100), divise in gruppi: *Applicazione*, *Rilevamento*, *Elenchi* e *Audit* per le chiavi dei guard che seguono la convenzione di Context7 Guard, *Altre* per tutte le altre, nell'ordine del file. Un percorso o un testo lungo occupa tutta la larghezza del suo gruppo.

Sopra i gruppi, le **protezioni** che la policy accende o spegne, solo per le chiavi note: *Blocca* (`mode` uguale a `block`), *Fail-closed* (`failClosed` vero), *Dati personali* (`detectPersonalData` vero), *Niente evidenze nel log* (`logEvidence` falso) e *Audit completo* (`auditAllowed` vero). Ognuna è verde se protegge e gialla se no, con il conteggio «n di m protezioni attive» accanto al titolo; i sì/no di queste chiavi prendono lo stesso colore. Una chiave che manca, che è mascherata o che ha un valore di un altro tipo non diventa una protezione. Un guard con altre chiavi non viene giudicato: le sue chiavi si vedono e basta.

Come si mostrano i valori:

- stringhe e numeri come testo; booleani come sì/no; elenchi di stringhe come etichette (le prime 5, poi «+n», che conta tutte le voci dell'elenco anche oltre le 50 che la lens manda); oggetti e altri elenchi come il loro numero di voci; i nomi delle chiavi sono tagliati a 60 caratteri;
- le chiavi il cui nome contiene, in maiuscole o minuscole, `secret`, `token`, `password` o `passwd`, `api_key`, `api-key` o `apikey`, `credential`, `private`, `auth`, `bearer` o `dsn` sono **omesse**, e la nota sotto i gruppi dice quante;
- una stringa è mascherata con `••••` se una qualsiasi delle sue parole (separate da spazi) è lunga 32 caratteri o più, ad alta entropia e non è un percorso: così anche `Bearer eyJ…` resta nascosta per intero;
- è un percorso, e si vede per intero, una parola che comincia con `~/`, `/`, `./` o `../`, non contiene `+` né `=` (li ha il base64) e ha almeno due parti separate da `/`, ognuna fatta solo di lettere, cifre e `.`, `_`, `~`, `@`, `%`, `-`. Un percorso con uno spazio si guarda parola per parola: se la parte dopo lo spazio è lunga e ad alta entropia, la stringa è mascherata.

La policy mostrata è **la policy globale**, quella nella cartella di configurazione di OpenCode: un progetto può renderla più restrittiva e Lens non lo vede. La nota sotto i gruppi lo ripete, con la data dell'ultima modifica del file.

## Chi vede cosa

Tre livelli, gli stessi per la pagina, per `/api/security` e per il tool MCP:

| Dove | Cosa vede |
|---|---|
| **Dashboard su questo computer** | tutto: oggetti, dettagli dei rilevamenti, sessioni, anteprime, policy, percorsi dei file, filtri per sessione e cartella |
| **Dashboard da rete** (con il token) | la «vista ridotta» (`restricted: true`): per ogni evento solo ora, esito, tool, tipo e codici delle categorie; poi totali, grafici, categorie e salute. Gli endpoint della Security non danno né oggetti, dettagli, sessioni e policy, né percorsi o cartelle cercate; la pagina Impostazioni, in *Dati e file*, elenca però le cartelle dei guard come elenca ogni altro percorso della lens. I filtri per sessione e cartella sono ignorati |
| **Tool MCP `security`** | eventi con ora, esito, tool, oggetto, categorie e impronta a 12 caratteri; mai il testo dei rilevamenti (`detail`) né le anteprime. Della policy chiavi e valori semplici (i numeri come sono scritti); gli elenchi diventano «N voci», con N il numero di tutte le voci, e i valori mascherati restano nascosti |

Dietro un reverse proxy che aggiunge i suoi header, anche chi arriva dalla stessa macchina conta come «da rete»: vedi [Dietro un reverse proxy](configurazione.md#dietro-un-reverse-proxy).

## Cartelle cercate

Due variabili, entrambe facoltative, che sono le **impostazioni del modulo**: si leggono solo a modulo attivo e si cambiano dalla sua scheda in **Impostazioni › Moduli** (non dalla tabella delle variabili del nucleo; vedi [moduli.md](moduli.md#le-impostazioni-di-un-modulo)). Un valore sbagliato mette il modulo in errore, con il motivo nella scheda.

| Variabile | Default | |
|---|---|---|
| `LENS_SECURITY_DIRS` | `$XDG_DATA_HOME/opencode:$XDG_DATA_HOME/opencode/security` (di solito `~/.local/share/opencode`, anche su macOS) | dove cercare i `<nome>.audit.jsonl`; più cartelle separate da `:` |
| `LENS_SECURITY_CONFIG_DIR` | la cartella di configurazione di OpenCode (`$XDG_CONFIG_HOME/opencode`, di solito `~/.config/opencode`) | dove cercare `<nome>.json` e `plugins/<nome>*` |

Con `LENS_SECURITY_DIRS` impostata si cercano **solo** le cartelle indicate. La pagina Impostazioni, nella sezione *Dati e file*, le elenca tra i file letti, come «solo lettura», finché il modulo è attivo; sono percorsi di sola lettura che la lens non scrive né cancella, e lo script di disinstallazione non li tocca mai.

## Tool MCP `security`

Per il modello che lavora in OpenCode: `lens_security`. Vedi [Server MCP per OpenCode](configurazione.md#server-mcp-per-opencode) per l'installazione.

**Serve riavviare OpenCode.** Lo strumento c'è solo con Security attivo. Quando la accendi o la spegni, l'MCP se ne accorge entro 30 secondi e avvisa OpenCode con `notifications/tools/list_changed`, ma OpenCode (verificato con la 2.0.26) **non rilegge** l'elenco degli strumenti né le istruzioni del server: continua a mostrare il vecchio elenco finché non lo riavvii. Se `lens_security` è già nell'elenco e il modulo è spento, chiamarlo risponde «Il modulo Security è spento in Lens: attivalo da Impostazioni › Moduli.»; se hai appena acceso il modulo, lo strumento compare dopo il riavvio. Se la lens non risponde, l'MCP tiene l'ultimo stato noto.

| Argomento | Valori | |
|---|---|---|
| `guard` | il nome del guard | senza, il guard trovato se ce n'è uno solo, altrimenti il riepilogo di tutti |
| `session` | `current` o un id `ses_…` | una sessione sola |
| `scope` | `project` (di partenza) o `all` | senza `session`: il progetto della sessione che chiede o tutti |
| `since` | `1h`, `6h`, `24h` (di partenza), `7d` | il periodo, fino a ora |
| `outcome` | `blocked`, `allowed`, `all` (di partenza) | solo bloccate, solo consentite o tutte |
| `limit` | 1–30, 10 di partenza | eventi al massimo |

Domande tipiche: «cosa hanno bloccato i guard DLP oggi?», «il guard Context7 sta funzionando?». Se un tool è fallito con un messaggio che comincia con «GUARD — invio bloccato» è un blocco DLP, non un guasto: le istruzioni del server lo dicono al modello, che lo chiede a `security` (con `session: "current"` e `outcome: "blocked"`; l'impronta a 12 caratteri è la stessa del messaggio).

La risposta dice quante chiamate ci sono state e quante bloccate (e il tasso, se l'audit registra anche le consentite), le categorie rilevate (fino a 10, poi quante altre), gli eventi più recenti, la salute (audit, policy, plugin, confronto con Lens, giudizio e, se non è ok, i suoi motivi: righe illeggibili, nessun evento da N giorni, audit letto solo in coda, `auditLog` che punta a un altro file, policy non valida o troppo grande, divario con Lens) e la policy globale. I totali in testa sono quelli del guard in tutto il periodo: `session` e `scope` restringono solo la riga degli eventi, che dice a chi si riferisce. Vale il solito taglio dei testi: sono ripuliti, accorciati e tra «».

## Su `/metrics`

Un gauge, scritto dalla scansione in cache, che **c'è solo con Security attivo**:

| Serie | Tipo | Etichette |
|---|---|---|
| `opencode_lens_security_events` | gauge | `guard`, `outcome` (`allowed`, `blocked`, `approved-by-user`, `rejected-by-user`, e `other` per ogni altro esito o per una riga senza esito): gli eventi presenti **in tutto l'audit** per ogni esito |

È un gauge, non un counter: se l'audit viene ruotato o ripulito scende, e un audit letto solo in coda conta solo quello che si è letto. Va anche nell'export OTLP (come gauge, con le altre metriche dei moduli attivi) e non ha periodo. Un esempio di allerta sui blocchi nell'ultima ora: `delta(opencode_lens_security_events{outcome="blocked"}[1h]) > 0`.

## Limiti e cosa la lens non fa

- **Non scrive e non crea niente** nelle cartelle del guard e non cambia il guard: legge e basta. I dati restano nei file del guard; la lens non li copia nel database.
- **La policy è quella globale.** Un progetto può averne una più restrittiva e Lens non lo sa.
- **L'anteprima c'è solo se il guard scrive `args`** (in Context7 Guard con `logEvidence` acceso nella policy). Senza, il dettaglio dice «non registrata dal guard».
- **Un audit oltre 20 MiB si legge dalla coda**: gli eventi più vecchi non si vedono, i totali valgono per la parte letta e il verdetto è giallo.
- **I colori delle categorie possono ripetersi** (sono 6 per qualsiasi numero di codici).
- **Il confronto con Lens vale per i tool che l'audit nomina.** Un guard che non ha ancora scritto nessuna riga non ha niente da confrontare («Non verificabile»), e il nome in `tool` deve essere quello con cui Lens registra la chiamata.
- La pagina vede quello che il guard ha scritto, non quello che avrebbe dovuto scrivere: se manca una riga, il confronto con Lens è l'unico indizio.
