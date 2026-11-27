# Moduli

🌐 Italiano · [English](en/moduli.md) · [Français](fr/moduli.md)

Un modulo è una parte facoltativa della lens, in una cartella `modules/<id>/`. Di partenza sono tutti **spenti**: un modulo spento non ha voce nel menu, né route, né lavoro in background, né metriche. Il resto (Adesso, Analisi, Monitor, Prompt, Sessioni, Galleria, Novità, Impostazioni) è il nucleo e c'è sempre.

Oggi i moduli sono cinque: **Vibe Coding**, tempo di lavoro, costi e token per progetto e cartella (vedi [dashboard.md](dashboard.md#vibe-coding)); **Sistema**, il computer su cui gira la lens (vedi [dashboard.md](dashboard.md#sistema)); **Security**, cosa i guard DLP di OpenCode hanno lasciato passare o bloccato (vedi [sicurezza.md](sicurezza.md)); **IBM Bob**, i task di Bob IDE e Bob Shell (vedi [dashboard.md](dashboard.md#ibm-bob)); **Skill**, la libreria delle tue skill, con le versioni, i preset e quanto OpenCode le usa (vedi [Skill](#skill) e [dashboard.md](dashboard.md#skill)).

## Attivare un modulo

- **Dalla dashboard**: **Impostazioni › Moduli** ha una scheda per ogni modulo trovato, con nome, descrizione, stato e il pulsante *Attiva* (o *Disattiva*). Attivare o spegnere un modulo cambia `LENS_MODULES`: si salva come le altre impostazioni e la lens si riavvia (vedi [configurazione.md](configurazione.md#modifica-dalla-dashboard)).
- **Da shell**, quando la lens non gira come servizio (avviata a mano con `npm start`) e la pagina Impostazioni è in sola lettura: `LENS_MODULES` è un elenco di id separati da virgola, per esempio `LENS_MODULES=sistema`.

Le regole di `LENS_MODULES`:

- un id è fatto di minuscole, cifre e trattino, e comincia con una lettera (`sistema`, `demo-2`); gli spazi attorno alla virgola non contano;
- un id scritto male o ripetuto è un errore di configurazione, e la lens non parte (come per le altre variabili);
- un id ben formato ma che non corrisponde a nessun modulo è ignorato, con un avviso nel log.

### Stati

`GET /api/modules` dice per ogni modulo uno stato:

| Stato | Significato |
|---|---|
| `off` | trovato e non attivato |
| `on` | attivo e avviato |
| `unconfigured` | attivato ma da configurare: le sue impostazioni sono incomplete o non valide (`configure` restituisce degli `errors`; il motivo è in `reason`). Conta come spento: niente route, lavoro in background o metriche. Si sistema dalla scheda del modulo |
| `error` | non utilizzabile: manifesto non valido, lens troppo vecchia per il modulo, avvio fallito (anche un `start()` asincrono che non finisce entro 10 secondi: il registro chiama `stop()` e il server parte lo stesso), `configure` che lancia. Gli altri moduli e la lens vanno avanti |

Il motivo dell'errore (`reason`) lo vedono solo i client di questo computer, perché può nominare file del computer. Lo stesso vale per `unconfigured`.

### Dopo un aggiornamento

Dopo l'aggiornamento che introduce i moduli, quelli non elencati in `LENS_MODULES` restano spenti. Per ognuno che ha già dati compare, in ogni pagina, un avviso: «era in uso: riattivalo da Impostazioni › Moduli». L'avviso si chiude per sempre, uno per modulo; la chiusura è `POST /api/modules/notice`. Sistema non lo mostra mai: non salva niente. Security lo mostra quando trova l'audit di un guard nelle sue cartelle (`hasData` si limita a guardare quali file ci sono). Il testo dell'avviso è il campo `notice` del manifesto, se il modulo ne ha uno (`noticeMessage` in `GET /api/modules`); senza, una frase generica «{nome} era in uso…». IBM Bob lo mostra quando trova task nella sua tabella `bob_tasks` e dice che, finché non lo riattivi, non viene più letto e ciò che Bob cancella nel frattempo è perso. Skill mostra l'avviso generico («Skill era in uso: riattivalo da Impostazioni › Moduli») quando trova una skill nell'indice, una cartella di versione nella libreria o una consegna dell'MCP di Lens in `skill_uses`; finché non lo riattivi i suoi file restano com'erano, mai riscritti dalla lens.

## Skill

Skill (`modules/skill/`, menu *Lens*, prima di Sistema e Security) è la libreria delle tue skill con le versioni, i preset di skill e quanto OpenCode le usa (vedi [dashboard.md](dashboard.md#skill)). Con il modulo spento:

- **Niente route né pagina.** `/api/skills`, `/api/skills/<id>`, `/api/skill-presets`, `/api/skill-loads` e `/api/skill-usage` rispondono 404, anche le `POST`; la voce di menu e la pagina `#skill` non ci sono.
- **MCP.** Lo strumento `preset` e i comandi `/lens:<id>` ci sono solo con Skill acceso. I comandi seguono `notifications/prompts/list_changed`; lo strumento sparisce da OpenCode solo dopo un riavvio di OpenCode (vedi [Gli strumenti MCP di un modulo](#gli-strumenti-mcp-di-un-modulo)). Un MCP rimasto in esecuzione dopo l'aggiornamento riceve 404 su `/api/skill-loads`: la consegna arriva al modello, ma non è contata.
- **Resta del nucleo.** La tabella `skill_uses` con `src/skill-uses.js` e `src/skill-ids.js`, le metriche `opencode_lens_skill_loads_total` e `opencode_lens_skill_preset_loads_total` e la cartella `skills/` che il collector guarda per distinguere le skill della libreria da quelle native continuano a riempirsi anche con Skill spento: è l'unica eccezione al «niente metriche da un modulo spento». Resta nel nucleo anche il riconoscimento di un MCP vecchio dalle richieste a `/api/skill-presets` (`noteMcp`: un percorso osservato, non servito). I modelli della dashboard, che si chiamano preset anch'essi, non c'entrano: sono del nucleo.
- **I suoi file.** `skills/` (una cartella: `kind: "dir"`), `skills.json`, `skill-presets.json` e le copie `.bad.json` sono del modulo. Spento non li riscrive mai (né `hasData` né `files()` scrivono), e lo script di disinstallazione li toglie (vedi [disinstallazione.md](disinstallazione.md)).
- **Dopo un aggiornamento.** Vedi [sopra](#dopo-un-aggiornamento): `hasData` guarda l'indice, le cartelle di versione e le consegne dell'MCP di Lens (`origin = 'lens'` in `skill_uses`).

## I moduli dell'utente

Oltre ai moduli della lens puoi tenerne di tuoi. Stanno in una cartella `modules/` **accanto al database**, fuori dalla cartella dell'app:

| Dove gira | Cartella dei moduli dell'utente |
|---|---|
| macOS | `~/Library/Application Support/opencode-lens/modules/` |
| Linux | `$XDG_DATA_HOME/opencode-lens/modules/` (di default `~/.local/share/opencode-lens/modules/`) |
| `LENS_DB` impostata | la cartella `modules/` accanto al file del database |
| `LENS_DB=:memory:` | nessuna: senza cartella dei dati non ci sono moduli dell'utente |

- **Come è fatta.** Ogni modulo è una sottocartella `<id>/` fatta come uno della lens (vedi [Scrivere un modulo](#scrivere-un-modulo)). La lens non crea la cartella: se non c'è, non succede niente; se non si può leggere, scrive un avviso nel log e va avanti senza moduli dell'utente. Le sottocartelle il cui nome non è un id (una copia del Finder come `demo 2`) non sono moduli. Una sottocartella può essere un link simbolico a una cartella (comodo per un modulo che sviluppi altrove): nella cartella dell'utente conta come modulo, nella cartella `modules/` della lens no.
- **Da uno zip.** Un modulo (o uno zip con più moduli) si installa e si aggiorna anche da **Impostazioni › Aggiornamento**: un'anteprima che non esegue niente, il controllo di ogni modulo solo dopo l'avviso e la conferma (**Installa**), poi la cartella vecchia in `.backup/` e la nuova al suo posto (vedi [aggiornamento.md](aggiornamento.md#i-moduli-dellutente-dalla-dashboard)).
- **Sopravvive agli aggiornamenti.** `install.sh` cancella e ricrea la cartella dell'app (`~/Applications/opencode-lens`) quando installi dallo zip di una release, e lo stesso fa l'aggiornamento dall'app, che esegue quell'`install.sh`; la cartella dei dati non la tocca: i tuoi moduli restano dove sono. Per lo stesso motivo i file che un modulo scrive con `files()` stanno nella cartella dei dati, e `modules` è un nome riservato al nucleo (`CORE_DIRS`): nessun modulo può dichiararlo.
- **Le stesse regole.** Il manifesto, l'id, la versione minima della lens, le variabili e gli stati sono giudicati come per i moduli della lens (vedi [Il manifesto](#il-manifesto) e [Stati](#stati)); un modulo dell'utente è spento di partenza e si attiva da **Impostazioni › Moduli** o con `LENS_MODULES`. Una variabile di `settings` già dichiarata da un modulo della lens è un errore di manifesto.
- **Se l'id è già di un modulo della lens** (`sistema`, `skill`…) vince la lens: la cartella dell'utente non viene mai importata, la lens scrive un avviso nel log e **Impostazioni › Moduli** mostra «La cartella … ha l'id di un modulo della lens: rinominala». Rinomina la cartella e l'`id` del manifesto.
- **Un modulo nuovo vuole un riavvio.** La lens cerca i moduli solo all'avvio: un modulo aggiunto, o un `module.js` modificato, si vede dopo aver riavviato la lens. Lo stesso per il server MCP, che calcola la cartella dell'utente dal plist del servizio (`LENS_DB`, non da `GET /api/modules`) e la legge una volta sola, all'avvio: per i suoi strumenti serve riavviare OpenCode (vedi [Gli strumenti MCP di un modulo](#gli-strumenti-mcp-di-un-modulo)).
- **Dove si vede.** La scheda del modulo in **Impostazioni › Moduli** mostra l'etichetta «tuo» e la cartella; `GET /api/modules` dà `origin` e, solo ai client di questo computer, `dir` (solo per i moduli dell'utente), `userDir` e `shadowed` (vedi [API](#api)).
- **Nessuna sandbox.** Un modulo dell'utente è codice Node di cui la lens si fida: gira dentro il suo processo, con gli stessi permessi, e può leggere e scrivere qualsiasi tuo file, aprire connessioni di rete e usare il database. Mettici solo moduli che hai scritto o letto tu.
- **Disinstallazione.** Le righe sui tuoi moduli compaiono solo se la cartella esiste. `uninstall.sh` senza `--purge` lascia i tuoi moduli dove sono e ne dice la cartella; con `--purge` li elimina insieme ai dati se stanno nella cartella dei dati, altrimenti restano dove sono e lo script lo dice (vedi [disinstallazione.md](disinstallazione.md)).

## API

| Endpoint | Contenuto |
|---|---|
| `GET /api/modules` | `modules` (`id`, `name`, `description`, `state`, `reason`, `notice`, `settings` con `name`, `label`, `help`, `kind`, `placeholder`, `value` e `isSet`, `mcp`, `mcpExamples`), `enabled` (gli id di `LENS_MODULES`), `canSave` e, se non si può salvare, il `reason` |
| `GET /api/modules` (altri campi) | `noticeMessage` (il `notice` del manifesto o `null`; `notice` resta il booleano «avviso da mostrare»), `settingsPanel` (il file del pannello o `null`), `min` e `max` in ogni impostazione `num`; `reason` c'è anche per `unconfigured` |
| `GET /api/modules` (moduli dell'utente) | `origin` (`core` per i moduli della lens, `user` per quelli della cartella `modules/` accanto al database) in ogni modulo; da questo computer anche `dir` (la cartella di un modulo dell'utente; `null` per quelli della lens), `userDir` (la cartella dei moduli dell'utente, `null` con il database in memoria) e `shadowed` (le cartelle dell'utente ignorate perché hanno l'id di un modulo della lens: `{ id, dir }`). Da rete `dir` e `userDir` sono `null` e `shadowed` è `[]`. La scheda mostra «tuo» e la cartella per i moduli dell'utente, e una riga per ogni cartella ignorata |
| `POST /api/modules/notice` | `{ "id": "…" }`: chiude per sempre l'avviso del modulo. Solo da questo computer, con le stesse regole di Origin, content-type e token delle altre scritture (vedi [metriche.md](metriche.md#api-locale)) |
| `POST /api/modules/check` | `{ "id": "…" }`: giudica il modulo `id` della cartella dell'utente come all'avvio, senza attivarlo, e risponde `{ ok, id, name, dir, errors, warnings }` (`name` è quello del manifesto, `null` se non si carica). Solo da questo computer, con le stesse regole di Origin, content-type e token delle altre scritture. Lo usa lo strumento MCP `module_check` |
| `GET /api/modules/authoring` | i valori di questa installazione per chi scrive un modulo (cartella dell'utente, versione della lens, id, variabili, percorsi, strumenti e tipi di widget già presi, tetti dei widget). Solo da questo computer: agli altri risponde 403. Lo usa lo strumento MCP `module_guide` |
| `/api/system`, `/api/system/live` | ci sono solo con Sistema attivo; spento, rispondono 404 |
| `/api/vibe-coding`, `/api/vibe-coding/history`, `/api/vibe-projects` | ci sono solo con Vibe Coding attivo (la `GET` di tutte e tre, la `POST` di `/api/vibe-projects`); spento, rispondono 404 (anche la `POST`) |
| `/api/security`, `/api/security/<guard>` | ci sono solo con Security attivo (la `GET` di entrambe); spento, rispondono 404. Vedi [metriche.md](metriche.md#api-locale) |
| `/api/bob`, `/api/bob/probe` | ci sono solo con IBM Bob attivo (`GET /api/bob`, `POST /api/bob/probe`); spento, rispondono 404 (anche la `POST`). Vedi [metriche.md](metriche.md#api-locale) |
| `/api/skills`, `/api/skills/<id>`, `/api/skill-presets`, `/api/skill-loads`, `/api/skill-usage` | ci sono solo con Skill attivo (le `GET`, e le `POST` delle prime quattro); spento, rispondono 404, anche le `POST`: l'MCP di Lens che riporta una consegna a una lens con Skill spento riceve 404 e la consegna non è contata. Vedi [metriche.md](metriche.md#api-locale) |
| `/api/status`, `/healthz` | un modulo attivo con `status()` aggiunge `<id>` a `/api/status`, con `state()` a `/healthz`; vedi [Stato in /api/status e /healthz](#stato-in-apistatus-e-healthz) |
| `/modules/<id>/<file>` | i file della cartella `public/` di un modulo **attivo**: piatta, nomi in minuscolo; per un modulo spento è 404 |

## Scrivere un modulo

Per scrivere un modulo tuo, nella cartella dei moduli dell'utente, segui la guida [moduli-custom.md](moduli-custom.md): l'ordine del lavoro, il modulo d'esempio `extras/module-template/`, la verifica e gli errori tipici. Questa sezione è il contratto completo.

Un modulo vive in `modules/<id>/`. L'id è anche il nome della cartella e l'id della pagina, e rispetta `^[a-z][a-z0-9-]*$`. Il modulo più completo da cui partire è `modules/vibecoding/` (route `GET` e `POST`, lettura del database, file propri); `modules/sistema/` è il più piccolo.

```
modules/<id>/
  module.js          manifesto
  tables.js          le tabelle del modulo: { version, sql, columns } (facoltativo)
  server/index.js    entrata Node: create(ctx), hasData(ctx), files(ctx)
  server/writes.js   gli SQL di scrittura per ctx.writer (solo con tables.js)
  mcp/tools.js       strumenti MCP del modulo: tools(kit) (facoltativo)
  scripts/           script da terminale del modulo (facoltativo)
  public/            file del browser, tutti nella stessa cartella
    page.js          esporta page e title
    page.html        il markup della pagina
    settings.js      il pannello nella scheda (facoltativo)
    widgets.js       i widget per la dashboard (facoltativo)
    style.css        facoltativo
    lang-en.js       cataloghi del modulo
    lang-fr.js
  test/              test del modulo
```

L'entrata Node non deve avere effetti collaterali all'import: la lens la importa anche per un modulo spento, per chiedere `hasData` e `files`. Quello che serve al modulo si fa in `create(ctx)` e in `start()`. Un id uguale a una pagina o a una vista del core (`dashboard`, `impostazioni`, `adesso`…) è riservato: il modulo va in errore.

### Il manifesto

`module.js` esporta per default un oggetto, senza import statici. La lens lo giudica con `src/modules.js`; un manifesto non valido manda il modulo in `error` con il motivo.

| Campo | |
|---|---|
| `id` | uguale alla cartella |
| `name`, `description` | testi in italiano, tradotti dai cataloghi del modulo; lo stesso vale per `label`, `help` e `placeholder` di `settings` e per `mcpExamples` |
| `lens` | versione minima della lens, `x.y.z`; con una lens più vecchia il modulo resta in `error` |
| `menu` | `group` (`dati` o `lens`), `order` (numero: dentro il gruppo le voci vanno per `order`, poi per id) e `icon` (l'interno di un `<svg viewBox="0 0 24 24">`) |
| `page.title` | il titolo della voce di menu |
| `server` | funzione che importa l'entrata Node: `() => import("./server/index.js")` |
| `settings` | facoltativo: le variabili `LENS_…` del modulo, `[{ name, label, help, kind, placeholder? }]`; vedi [Le impostazioni di un modulo](#le-impostazioni-di-un-modulo). Per `num`: `min` e `max`, interi |
| `mcp` | facoltativo: funzione che importa gli strumenti MCP, `() => import("./mcp/tools.js")`; vedi [Gli strumenti MCP di un modulo](#gli-strumenti-mcp-di-un-modulo) |
| `mcpTools` | con `mcp`: i nomi degli strumenti che il modulo offre, per esempio `["security"]` |
| `mcpInstructions` | con `mcp`: le righe che si aggiungono alle istruzioni del server MCP finché il modulo è attivo. Arrivano a OpenCode in italiano e non si traducono: le loro voci nei cataloghi en/fr esistono solo per lo scanner dei testi |
| `mcpExamples` | con `mcp`: le domande che Impostazioni › Server MCP suggerisce per i suoi strumenti, solo a modulo attivo |
| `mcpPrompts` | con `mcp`: `true` se il file `mcp` esporta anche `prompts(kit)`, i prompt del modulo (in OpenCode, comandi `/lens:<id>`); vedi [I prompt MCP di un modulo](#i-prompt-mcp-di-un-modulo) |
| `notice` | facoltativo: il testo (italiano, tradotto come `description`) dell'avviso «dopo un aggiornamento»; la scheda e il banner lo usano al posto della frase generica. In `GET /api/modules` è `noticeMessage` |
| `settingsPanel` | facoltativo: il nome di un file `.js` della cartella `public/` del modulo (`^[a-z0-9-]+\.js$`); vedi [Il pannello nella scheda](#il-pannello-nella-scheda) |
| `widgets` | facoltativo: da 1 a 12 widget che il modulo offre alla dashboard, `[{ type, label, description, size, min, home, settings?, data }]`; richiede `widgetsFile`; vedi [I widget di un modulo](#i-widget-di-un-modulo) |
| `widgetsFile` | facoltativo: il nome di un file `.js` della cartella `public/` del modulo (`^[a-z0-9-]+\.js$`) che disegna i widget; vedi [I widget di un modulo](#i-widget-di-un-modulo) |
| `tables` | facoltativo: funzione che importa le tabelle del modulo, `() => import("./tables.js")`; vedi [Le tabelle di un modulo](#le-tabelle-di-un-modulo) |
| `source` | facoltativo: `{ label }`, il modulo offre un'altra sorgente di dati alla dashboard; vedi [Una sorgente alternativa](#una-sorgente-alternativa) |

Nel menu le voci dei moduli stanno in fondo al proprio gruppo; nel gruppo *Lens* vengono prima di Impostazioni.

### L'entrata Node

`server/index.js` esporta:

- `create(ctx)`: restituisce subito (non una promessa) un oggetto con quello che serve al modulo, tutto facoltativo: `routes` (vedi sotto), `start()` e `stop()` (anche asincroni), `families()` (le famiglie di metriche per `/metrics`). Se `create` o `start` lanciano, il modulo va in `error`;
- `hasData(ctx)`: facoltativa, dice se il modulo ha già dati salvati e decide l'avviso dopo un aggiornamento. Se lancia vale `false`;
- `files(ctx)`: facoltativa, elenca i file che il modulo scrive, `[{ label, path, note }]` (`label` e `note` in italiano, per `N_()`, `note` facoltativa). La lens li chiede una volta all'avvio, anche per un modulo spento, e li mostra in **Impostazioni › Dati e file** e nello script di disinstallazione (vedi [disinstallazione.md](disinstallazione.md)). Poiché il percorso finisce in un `rm -f`, deve stare **dentro la cartella dei dati** (quella del database): una voce senza `label`, con un percorso relativo, fuori dalla cartella o uguale alla cartella stessa è scartata con un avviso nel log. Con `LENS_DB=:memory:` non c'è una cartella dei dati e nessun file è accettato; un `files()` che lancia non dà niente. Un'entrata con `kind: "read"` dichiara invece un percorso che il modulo **legge soltanto** (Security, le cartelle dei guard): può essere **qualsiasi percorso assoluto**, anche fuori dalla cartella dei dati, perché la lens non lo scrive né lo cancella mai. Compare in **Dati e file**, tra i file letti e solo a modulo attivo, e **non** entra nello script di disinstallazione. Un `kind` diverso da `write`, `read` e `dir` scarta l'entrata, con un avviso nel log. Se le impostazioni del modulo non sono valide (vedi [Le impostazioni di un modulo](#le-impostazioni-di-un-modulo)) `files()` non viene chiesta. Un'entrata con `kind: "dir"` dichiara una **cartella** dentro la cartella dei dati (Skill: la libreria `skills/`): compare in **Dati e file** e lo script di disinstallazione la toglie con `rm -rf`; fuori dalla cartella dei dati è scartata con un avviso, come una `write`. Il nucleo si tiene alcuni file e cartelle (`CORE_FILES` e `CORE_DIRS` in `src/core-paths.js`: il database con `-wal` e `-shm`, i file della disposizione e dei modelli della dashboard, `update/`): una voce, anche `dir`, che coincide con uno di essi, o sta dentro una cartella del nucleo, è scartata con un avviso. Se due moduli dichiarano lo stesso percorso la lens avvisa e lo elenca una volta sola.
- **`start()` ha un tempo massimo.** Un `start()` asincrono ha 10 secondi (`START_TIMEOUT_MS`): oltre, il modulo va in `error` («start() non ha finito entro 10 s»), il registro chiama `stop()` e il server parte lo stesso. Un tempo massimo non ferma codice sincrono: il lavoro pesante si pianifica (`setTimeout(…, 0)`) e `start()` torna subito, come fa Bob con la sua prima lettura.
- Oltre a questi, l'oggetto di `create` può avere `status()`, `state()` e `source()`: vedi [Una sorgente alternativa](#una-sorgente-alternativa) e [Stato in /api/status e /healthz](#stato-in-apistatus-e-healthz).

#### Le route

`routes` è un oggetto `{ "<METODO> <percorso>": … }`. Il percorso comincia con `/api/`, e le route passano dal controllo dell'host, del token e del metodo come ogni route del nucleo. Una route già presa dal nucleo o da un altro modulo non si sovrascrive; una chiave non valida o con il valore sbagliato è scartata con un avviso, senza fermare il modulo. Tre forme:

| Chiave | Valore | |
|---|---|---|
| `GET /api/x` | `(req, { url, local, rest }) => risposta` | percorso esatto; `rest` è `undefined`. Risponde anche a `HEAD` |
| `GET /api/x/*` | come sopra | prefisso: ogni percorso **sotto** `/api/x/` (non `/api/x`). Un percorso esatto vince sul prefisso |
| `POST /api/x` | `{ handler, body: { type: "json", max }, what }` | percorso esatto. `handler(req, { url, local, body })` riceve il JSON già letto |
| `POST /api/x/*` | come sopra | prefisso, con `rest` come per le `GET` (già decodificato; `null` per una codifica rotta, che il modulo rifiuta; `""` per `POST /api/x/`) |
| `POST /api/x` con `body: { type: "raw", types, max }` | `handler(req, { url, local, body, rest })` | corpo non JSON: `body` è un `Buffer`; vedi sotto |

- **`rest`** è quello che segue il prefisso, **già decodificato**: può contenere `/` e `..`, quindi non va mai usato così com'è come percorso di un file. Per `/api/x/` vale `""`; con una codifica rotta (`%zz`) vale `null`.
- **`what`** dice cosa si modifica (`N_("i progetti")`), per i messaggi di rifiuto. `body.max` è il limite del corpo in byte, un intero tra 1 e 16 MiB: lo impone il nucleo, non il modulo. Prima del `handler` la POST passa dagli stessi controlli delle altre scritture: solo da loopback, `Origin`, `content-type: application/json`, token. Con `body: { type: "raw", types: [...], max }` il corpo non è JSON ma byte (Skill: lo zip di una skill o un `SKILL.md`): `types` elenca i content-type ammessi; `type` vale `"json"` se manca. Il registro rifiuta in `types` i tipi che un browser manda senza preflight (`text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`), i caratteri jolly e i valori vuoti, così la difesa contro le richieste di altri siti resta «content-type non ammesso da CORS». Il nucleo confronta solo il media type, senza distinguere maiuscole e minuscole e senza parametri; un tipo diverso è un 415 con un testo tradotto, un corpo oltre `max` un 413 con `connection: close`, e `writeRefusal` (loopback, `Origin`, token) viene prima della lettura del corpo. Le regole dei percorsi del nucleo valgono anche per le `POST`, a prefisso o no.
- **La risposta**: un oggetto semplice è un `200` in JSON; per un altro stato si restituisce `ctx.reply(stato, corpo)` (`ctx.reply(404, { error })`, `ctx.reply(400, { errors })`). Qualunque altra cosa (o un'eccezione) è un `500` generico, con l'errore nel log sotto l'id del modulo.
- **Modulo spento**: una `GET`, `HEAD` o `POST` sulle sue route dà 404: le route di un modulo trovato ma non acceso stanno fuori dalla tabella del 405. Una richiesta diversa da `GET` su un percorso `/api` che né il nucleo né un modulo attivo serve dà 404 (un percorso del nucleo con un metodo sbagliato resta 405).
- **I testi**: una `what` e ogni testo che il codice Node del modulo mostra passano da `const { t, N_ } = ctx.i18n` e dalle chiamate **nude** `t("…")` e `N_("…")`, mai `ctx.i18n.t("…")`: lo scanner delle traduzioni vede solo le chiamate nude.

Il `ctx` è la sola porta verso il nucleo (`src/module-kit.js`) ed è congelato:

| Campo | |
|---|---|
| `id` | l'id del modulo |
| `env` | le variabili d'ambiente **che il modulo dichiara in `settings`**, più `HOME` e `XDG_*`; mai le altre del nucleo (`LENS_TOKEN`, password) |
| `paths` | le cartelle da cui partono i default: `home`, `opencodeConfigDir` (la configurazione di OpenCode) e `xdgData` (`$XDG_DATA_HOME` o `~/.local/share`); `dataDir`, la cartella dei dati (quella del database; `null` con `:memory:`), anche nel `ctx` di `configure`: la libreria di Skill è `path.join(ctx.paths.dataDir, "skills")` |
| `settings` | i `values` che ha restituito `configure(ctx)` all'avvio (vedi [Le impostazioni di un modulo](#le-impostazioni-di-un-modulo)); `{}` senza `configure` |
| `dbPath` | il percorso del database |
| `collector` | `state`, `status()` e `config.scanIntervalMs` |
| `store` | `counts()` |
| `meta` | `get(chiave)` e `set(chiave, valore)`: piccoli valori del modulo, salvati sotto `module:<id>:data:`, così non toccano le chiavi del registro |
| `log` | `info`, `warn`, `error`, con il prefisso `[<id>]` |
| `reader` | `get(sql, …valori)` e `all(sql, …valori)`: letture del database, vedi sotto |
| `sql` | i frammenti SQL del nucleo, da comporre nelle proprie query: `TS` (il momento di uno step, `COALESCE` di fine, ultimo avvio e avvio: la forma su cui sono gli indici di periodo) e `ST_TS` (lo stesso con l'alias `st`), `TOOL_TS` (il momento di una chiamata tool), `STEP_START` (l'avvio di uno step), `FOLDER` (la cartella della sessione di uno step), `TOKENS` e `ST_TOKENS` (la somma dei token, senza e con l'alias `st`), `MODEL_KEY` (`provider/modello`, con `#variante` se non è quella di base), e `COLUMNS` (`steps`, `sessions`, `tools`, `prompts`, `runs`: le colonne di quelle tabelle, nell'ordine del nucleo, perché le `SELECT` di un modulo che le presenta lo rispettino) |
| `time` | `periodBounds(tipo, ora, reset)`, `localDay(ts)`, `budgetDayOf(reset)`, `DAY_MS`, `MIDNIGHT` e `reset`, l'ora di cambio giorno configurata (`LENS_RESET_HOUR`) |
| `tokensOf` | la funzione che somma i token di una riga, la stessa del nucleo |
| `budgets.month(ora?)` | il consumo del mese contro `LENS_LIMIT_COST_MONTHLY`: `{ used, limit, ratio, projected, projectedRatio, pace }`, `null` se il limite non è impostato |
| `range(searchParams, { earliest }?)` | il periodo di una richiesta `{ from, to }` come lo leggono gli endpoint del nucleo: `from=day` è il giorno di budget (`to` è ignorato), altrimenti `from`/`to` in ms; `from=0` è «tutto», dal dato più vecchio di OpenCode o, con `earliest` (una funzione che restituisce ms o `null`), da quello del modulo |
| `i18n` | `t`, `N_`, `Localized`, `errorText`: le traduzioni del nucleo, nella lingua della richiesta |
| `jsonStore({ name, validate, empty, what })` | un file JSON del modulo accanto al database, sullo stesso meccanismo dei preset: `read()`, `write(doc)`, `path` e `badFile`. `name` è un nome che finisce in `.json`, come `progetti.json` (`^[a-z0-9][a-z0-9._-]*\.json$`: minuscole, cifre, `.`, `_`, `-`; mai cartelle), altrimenti lancia `TypeError`. Un file illeggibile dà `empty()`, un avviso nel log e una copia `.bad.json` che un salvataggio non distrugge; con `:memory:` il documento resta in memoria fino al riavvio. `what` è `{ broken, none, dropped }`, le tre frasi (concordate fra loro) con cui l'avviso nomina il contenuto: «<file> non è JSON valido: <broken>» e «<file> <none> (motivi): <dropped>». `read()` e `write()` sono sincroni e senza cache: ogni `read()` rilegge e rivalida il file, quindi va bene per documenti piccoli. Dichiaralo in `files()`. Rifiuta anche i file del nucleo (`CORE_FILES`: la disposizione e i modelli della dashboard, il database): lancia `TypeError` |
| `writer` | solo con `tables`: `statement(sql) → { run, get, all }` e `tx(fn)`; vedi [Scrivere sulle proprie tabelle](#scrivere-sulle-proprie-tabelle) |
| `readers` | i lettori incrementali del nucleo: `define`, `Watermark`, `contractMisses` e `adopt(reader, reset)`, che tiene la versione del lettore in `ctx.meta` (`module:<id>:data:<metaKey>`): al primo avvio di un modulo che adotta un lettore la sua sorgente si rilegge una volta (gli upsert sono idempotenti) |
| `live` | `changed(payload)`: avvisa le dashboard aperte di un cambiamento del modulo (il tipo di modifica è l'id del modulo); `feed(item)`, solo con `source`: una riga di «attività recente», marcata con la sorgente |
| `reply(stato, corpo)` | (il corpo è un oggetto semplice) la risposta con uno stato diverso da 200 |
| `zip` | `readEntries`, `entryData`, `extractPlan`, `planEntries` e `ZipError`: la lettura degli zip e il piano di estrazione del nucleo (le funzioni di `src/zip.js` e `src/update.js`, con le stesse firme), per un modulo che importa archivi. `CORE_FILES` e `CORE_DIRS` valgono per ciò che un modulo dichiara (`files()`, `ctx.jsonStore`), non per le scritture: `extractPlan` scrive dove gli viene detto |
| `skillLoads` | `record(payload) → { rows }`: valida una consegna dell'MCP (`{ id, channel, preset, sessionId?, skills, at }`) e la scrive in `skill_uses`, senza contare due volte lo stesso `id`. Un payload non valido lancia un errore con `errors` (un elenco di testi: il modulo risponde 400). Lo ha ogni modulo, ma la tabella resta del nucleo, che continua a riempirla anche con Skill spento. Il nucleo non controlla l'id del modulo che la usa: il codice di un modulo è codice Node fidato |
| `prices` | il listino prezzi globale (`LENS_MODEL_PRICES`), congelato e sempre presente: `empty` (`true` senza prezzi), `of(modello) → { input, output, cacheRead, cacheWrite }` o `null` (una variante `provider/modello#variante` ha il prezzo del modello base) e `estimate(modello, tipi) → numero` o `null`, con `tipi` come li dà `tokensOf` (`{ input, output, reasoning, cacheRead, cacheWrite }`). I prezzi sono in dollari per milione di token; il ragionamento si paga come l'output; senza prezzo il risultato è `null`. Conta solo gli step, come lo speso, senza i task interni |

#### Leggere il database: `ctx.reader`

Un modulo non apre il database e non chiama `.prepare(` né usa `store.db` (lo controlla `test/db-owner.test.js` su `modules/<id>/server/`): legge con `ctx.reader.get(sql, …valori)` e `ctx.reader.all(sql, …valori)`, in sola lettura sulla connessione della lens. Le regole:

- **Accetta solo `SELECT` e `WITH … SELECT`**, un'istruzione sola. Rifiuta un testo che comincia con altro (`INSERT`, `UPDATE`, `DELETE`, `ATTACH`, `PRAGMA …`), che contiene un `;` fuori da una stringa (anche in un commento: SQLite compilerebbe solo la prima istruzione) o la cui compilazione apre una tabella in scrittura (per esempio un `WITH … INSERT`, controllato con `EXPLAIN` prima di eseguirlo). Il rifiuto è un `Error` normale, «ctx.reader: solo letture», e il database resta com'era.
- **Ogni esecuzione è sotto `PRAGMA query_only`**, rimesso a 0 subito dopo anche se lancia: qualche istruzione scrive senza che `EXPLAIN` lo mostri (le funzioni a tabella dei pragma, come `pragma_optimize`, eseguono un `ANALYZE`) e SQLite la rifiuta. Anche questo rifiuto è «ctx.reader: solo letture».
- **Nel testo SQL solo costanti**: i valori variabili si passano come parametri (`?`), mai concatenati. Ogni testo diverso è preparato una volta e tenuto in cache, fino a **256 testi** per `ctx.reader`; oltre, un testo nuovo lancia «ctx.reader: troppe istruzioni diverse». Interpolare un valore nel testo (un id, una data) riempirebbe la cache e sarebbe un'iniezione SQL.
- **Le liste di valori** (id, nomi) si passano come **un solo parametro JSON**: `WHERE name IN (SELECT value FROM json_each(?))` con `JSON.stringify(lista)`. Mai un `IN (?, ?, …)` della lunghezza della lista: ogni lunghezza sarebbe un testo diverso e riempirebbe la cache. Il testo SQL di ogni query è **uno solo, fisso**.
- **Per i periodi** si usano `ctx.range`, `ctx.time` e i frammenti di `ctx.sql`: così le query leggono con gli stessi indici del nucleo (nei test, `check`, `rangeKeys` e `recorded` di `test/module-test-kit.js` controllano che il piano di una query usi quegli indici).

### Le tabelle di un modulo

Un modulo che salva dati propri nel database della lens dichiara le sue tabelle: il manifesto ha `tables: () => import("./tables.js")` e `tables.js` (nessun import, come il manifesto) esporta per default `{ version, sql, columns? }`.

- **`version`**: un intero ≥ 1.
- **`sql`**: le istruzioni che creano le tabelle. L'elenco è chiuso: `CREATE TABLE IF NOT EXISTS <id>_…` e `CREATE [UNIQUE] INDEX IF NOT EXISTS <id>_… ON <id>_…`, nient'altro. Fuori da letterali e commenti sono rifiutate le parole `REPLACE`, `REFERENCES`, `TEMP`, `TEMPORARY`, `VIRTUAL`, `AS SELECT`, `AUTOINCREMENT`, `TRIGGER`, `VIEW`, `PRAGMA`, `ATTACH`, `DROP`, `DELETE`, `UPDATE` e `INSERT`. Tabelle e indici portano il prefisso `<id>_` (con l'id `bob`: `bob_`) e non possono essere tabelle o indici del nucleo, qualunque prefisso abbiano. Per questo un modulo con tabelle ha un id di sole minuscole e cifre (`^[a-z][a-z0-9]*$`): un id con il trattino non può fare da prefisso e le tabelle sono rifiutate.
- **`columns`**: `{ tabella: { colonna: "TEXT" | "INTEGER" | "REAL" | "BLOB" } }`, le colonne che una versione precedente delle tabelle non aveva: si aggiungono prima degli indici che le usano. Solo tabelle create da `sql` e colonne presenti nella loro `CREATE TABLE`.

Il controllo (`src/module-tables.js`, con lo scanner di letterali e commenti di `src/sql-text.js`) esegue `sql` due volte su un database in memoria vuoto: nessun errore, `sqlite_temp_schema` vuoto, `user_version` 0, nessuna chiave esterna, e ogni oggetto di `sqlite_schema` è una tabella o un indice col prefisso (gli indici automatici sono ammessi). Un `tables.js` che non passa manda il modulo in `error`, col motivo.

Le tabelle si creano all'avvio, **anche con il modulo spento** (così i dati e lo schema seguono la lens), dopo la migrazione del nucleo e con un `SAVEPOINT` per modulo: prima le `columns` mancanti delle tabelle già esistenti, poi `sql`, poi la `meta` `module:<id>:schema` = `version` (una versione salvata maggiore, per esempio dopo il ritorno a una lens precedente, resta com'è). Un errore annulla solo quel modulo, che va in `error`. Righe e tabelle non si cancellano mai: spegnere il modulo, o toglierlo, lascia le sue tabelle nel database (vedi [disinstallazione.md](disinstallazione.md)).

#### Scrivere sulle proprie tabelle

`ctx.writer` c'è solo per un modulo con `tables`. È una rete contro gli errori, non una sandbox: il codice di un modulo gira nel processo della lens e potrebbe fare altro.

- **`statement(sql)`** restituisce `{ run, get, all }` per un'istruzione. **`tx(fn)`** esegue `fn` in una transazione dello Store (rollback se lancia). `fn` deve essere sincrona: se restituisce una promessa (un thenable) la transazione è annullata e `tx` lancia, perché la promessa scriverebbe fuori dalla transazione.
- **Rifiuti** (un `Error` «ctx.writer: …»): più di un'istruzione; un testo che non comincia con `INSERT` o `UPDATE` (quindi niente `DELETE`, `CREATE`, `PRAGMA`, né `WITH … INSERT`); `REPLACE` (anche `INSERT OR REPLACE`, che cancella le righe che sostituisce); `pragma_` ovunque nel testo, anche dentro un letterale (`pragma_optimize` esegue un `ANALYZE` che `EXPLAIN` non mostra).
- **Controllo sul programma.** La lens compila l'`EXPLAIN` del testo e rifiuta ogni `OpenWrite` che non sia sul database `main` (`p3 = 0`), su una pagina radice data come tale (`p5 & 0x10` spento) o fuori dalle tabelle create dal `sql` del modulo e dai loro indici, e gli opcode `VUpdate`, `Program` e quelli di schema (trigger, azioni delle chiavi esterne, tabelle virtuali).
- Come per `ctx.reader`: solo costanti nel testo, i valori come parametri, al massimo 256 testi diversi. Gli SQL di scrittura stanno in `modules/<id>/server/writes.js`, il solo file di un modulo esentato dalla regola R5 di `test/db-owner.test.js` (e solo per i moduli con `tables.js`).

### Le impostazioni di un modulo

Un modulo che ha bisogno di variabili d'ambiente le dichiara nel manifesto:

```js
settings: [{ name: "LENS_SECURITY_DIRS", label: "Cartelle degli audit dei guard", help: "separate da :, in sola lettura", kind: "text" }],
```

- **`name`** è una variabile `LENS_…` (maiuscole, cifre, `_`). Non può essere una variabile del nucleo né una già dichiarata da un altro modulo, né ripetuta: il manifesto non è valido e il modulo va in `error`. `label`, `help` e `kind` sono obbligatori (testi in italiano, per `N_()`); `kind` è `text`, `num` o `secret`; `placeholder` è facoltativo.
- **Limiti dei numeri.** Un'impostazione `num` accetta `min` e `max` (interi, `min ≤ max`): `GET /api/modules` li passa alla scheda, che li controlla come gli intervalli del nucleo, e `configure` li ricontrolla lato server. Il valore predefinito si mostra con `placeholder`.
- **Dichiarata, la variabile è nota alla lens** anche a modulo spento: non è mai un «errore di battitura» nel log e nella pagina Impostazioni. Non compare nella tabella delle variabili del nucleo (e `--help` non le elenca: stanno nel manifesto del modulo e nella sua card **Impostazioni › Moduli**, dove si modificano).
- **`configure(ctx)`** è un export dell'entrata Node (`server/index.js`), facoltativo. Riceve `{ id, env, paths, i18n }` e non può leggere né scrivere altro: `env` ha solo le variabili dichiarate dal modulo più `HOME` e `XDG_*`, `paths` ha `home`, `opencodeConfigDir`, `xdgData` e `dataDir` (la cartella del database, `null` con `:memory:`). Restituisce `{ values, errors }`: `values` è un oggetto semplice (i percorsi già assoluti, i numeri già numeri), `errors` un elenco di testi o di `Localized`. Un `configure` che lancia, o che non restituisce `{ values, errors }`, è un errore.
- **Chi la chiama.** La lens la chiama una volta all'avvio per **ogni modulo trovato, acceso o spento**, e a ogni controllo di un salvataggio da Impostazioni (con l'ambiente dopo il salvataggio, solo per i moduli attivi): un valore sbagliato si vede subito, come per le variabili del nucleo, senza toccare niente. `ctx.settings` in `create`, `hasData` e `files` è proprio quell'oggetto `values` (congelato), non `{ values, errors }`. Con errori, **il modulo è `unconfigured`** (il motivo è nella card; un `configure` che lancia, o che non restituisce `{ values, errors }`, lo manda invece in `error`), non parte, `hasData` vale `false` e `files()` non viene chiesta.
- **Nella card.** Ogni impostazione ha un campo nella card del modulo in **Impostazioni › Moduli** (`text`, `num` o `secret`) e si salva come le altre variabili: la lens si riavvia. `GET /api/modules` dà il `value` e `isSet` solo ai client di questo computer (da rete sono `null`, e il plist non viene nemmeno letto); di un `secret` dà soltanto se è impostato (`isSet`), mai il valore. Il plist si rilegge solo quando cambia. Un campo vuoto toglie la variabile e torna il default.
- **Leggere i valori solo da `ctx`.** Il modulo non guarda `process.env`, che ha anche le variabili del nucleo: tutto ciò che serve (cartelle di default comprese) sta in `ctx.env` e `ctx.paths` (con `dataDir`).

L'esempio completo è `modules/security/server/settings.js`.

### Il pannello nella scheda

Un modulo acceso può avere un pannello suo nella scheda di **Impostazioni › Moduli**, sotto i campi (IBM Bob: lo stato della lettura, i fatti e le sonde). Il manifesto dichiara `settingsPanel: "settings.js"`, un file di `public/` (`^[a-z0-9-]+\.js$`) che esporta `mount(el, { status }) → { update(status) }`. La scheda lo importa da `/modules/<id>/settings.js` e lo monta una volta: l'elemento resta lo stesso fra un render e l'altro, e a ogni `/api/status` la scheda chiama `update(status[<id>])`, il blocco del modulo (vedi sotto). Se l'import o `mount` falliscono, la scheda dice «pannello non disponibile».

### I widget di un modulo

Un modulo può offrire widget alla dashboard: compaiono in **Aggiungi** dell'editor accanto a quelli del nucleo (vedi [dashboard.md](dashboard.md#modificare-la-disposizione)) e si dispongono, si ridimensionano e si configurano come gli altri. Il manifesto ha due campi, `widgets` e `widgetsFile`, che una foglia senza import (`src/module-widget-fields.js`) giudica insieme al resto: un campo sbagliato è un errore di manifesto e il modulo va in `error`, col motivo.

```js
widgetsFile: "widgets.js",
widgets: [{
  type: "mio-modulo-oggi", label: "Il mio indicatore", description: "Un numero del modulo, con il periodo",
  size: [4, 4], min: [3, 3], home: "both",
  settings: { title: null, range: ["dashboard", "day", "86400000"] },
  data: ["/api/mio-modulo/stato?from={from}"],
}],
```

- **`widgetsFile`** è obbligatorio con `widgets`: il nome di un file `.js` della cartella `public/` del modulo (`^[a-z0-9-]+\.js$`), servito da `/modules/<id>/<file>`.
- **`widgets`** è un elenco da 1 a 12 voci. Ogni voce ha:
  - `type`: `<id>-<nome>`, cioè l'id del modulo, un `-` e un nome; il tipo intero, prefisso `<id>-` compreso, segue `^[a-z][a-z0-9-]*$` ed è lungo al più 31 caratteri (il limite che la disposizione salvata mette a un tipo); non è un tipo del nucleo, non è dichiarato da un altro modulo e non si ripete;
  - `label` e `description`: due testi non vuoti, in italiano. La pagina li riceve così come sono, insieme al `name` del modulo, e li traduce nel browser con il catalogo del modulo (`public/lang-<lingua>.js`, unito a quello del nucleo), come i propri testi: l'apertura della pagina non dice al server la lingua. Il catalogo di un modulo spento non si carica (`/modules/<id>/…` è servito solo a modulo acceso): il suo nome resta in italiano;
  - `size` e `min`: `[larghezza, altezza]` interi, larghezza da 1 a 12 e altezza da 1 a 40, con `min` non maggiore di `size` in nessuna delle due misure. `size` è la misura di un widget appena aggiunto, `min` la più piccola a cui si può ridurre;
  - `home`: la vista in cui l'editor lo propone, `adesso`, `analisi` o `both`;
  - `settings` (facoltativo): le impostazioni del ⚙. `title: null` dà il titolo modificabile; ogni altra chiave (lettere e cifre, comincia con una minuscola) è un elenco da 1 a 20 testi distinti non vuoti, i valori che l'utente può scegliere. Oltre a `title` e `range`, una chiave non può essere una di quelle che usa un widget del nucleo (`metric`, `by`, `source`, `model`, `sort`, `style`…): per il ⚙ e per la griglia vogliono già dire altro. La chiave `range` ammette solo i periodi della dashboard (`dashboard`, `day`, `3600000`, `28800000`, `86400000`, `604800000`, `2592000000`, `0`), e `dashboard` non vale in nessun'altra chiave. Il pannello ⚙ mostra le chiavi nell'ordine dichiarato, col nome `t(chiave)` e ogni valore come `t(valore)`: chiavi e valori si traducono con il catalogo del modulo;
  - `data`: da 1 a 4 percorsi `/api/…` che il widget legge, senza `..`, `#` né spazi, con al più un segnaposto `{from}`; ogni altra graffa è rifiutata, e così `%2e`, `%2f` e `%5c` (un punto, una barra o una barra inversa codificati), in maiuscolo o minuscolo.
- **`data` e le route del modulo.** Un widget legge l'API del suo modulo: all'avvio, un widget con un percorso che non è una route `GET` del modulo stesso (la query e `{from}` a parte) è scartato con un avviso nel log, e il modulo resta acceso. `GET /api/modules` dà per un modulo attivo i widget rimasti. Un widget scartato resta nella disposizione e al suo posto dice «Il widget {tipo} legge {percorso}, che non è una route GET del modulo», senza nessuna richiesta. I percorsi dei widget passano dal controllo dell'host e del token come ogni route.
- **`{from}`** si sostituisce con l'inizio del periodo del widget, come il `from` degli endpoint del nucleo: `day` per il giorno di budget, altrimenti i millisecondi dell'istante iniziale, e `0` per «tutto». Il periodo è quello scelto nel ⚙ del widget o, con `dashboard`, quello della vista. La route lo legge con `ctx.range` ([Le route](#le-route)).

**Il file dei widget.** Esporta i disegnatori per tipo, `{ mount(root, ctx), update(root, ctx) }`: di preferenza come `export default { "mio-modulo-oggi": { mount, update } }`; vanno bene anche gli export con nome (`export { disegno as "mio-modulo-oggi" }`), ma se c'è un `export default` vince quello. Il file importa dal nucleo solo `"/module-kit.js"` (vedi [I file del browser](#i-file-del-browser)).

- `mount(root, ctx)` si chiama una volta, a riquadro vuoto: costruisce il markup dentro `root`. `update(root, ctx)` si chiama a ogni aggiornamento, quando i dati dichiarati in `data` sono tutti arrivati.
- `resize(root, ctx)` è facoltativo: con lui la dashboard osserva la misura del riquadro, come per un widget del nucleo, e quando cambia lo ridisegna con `update`. La funzione non viene chiamata: conta che ci sia.
- **Niente timer.** Un widget del modulo non avvia timer né letture sue: la griglia chiama `update` a ogni aggiornamento della dashboard. Un `ctx.live.changed()` del modulo fa rileggere i percorsi dei suoi widget sullo schermo (in Adesso solo quelli, con gli altri del cambiamento), e poi la griglia chiama `update`.
- Il `ctx` è congelato e ha cinque campi: `widget` (una copia congelata del widget salvato, con `id`, `type`, posizione e `settings`), `title` (il titolo già deciso: quello scelto dall'utente o la `label`), `settings` (le impostazioni del widget, più il `range`, la `metric` e il `by` già risolti con quelli della vista: `range` è `"day"` o un numero di millisecondi, `0` per «tutto»), `data(percorso)` e `inst`, un oggetto del riquadro che resta lo stesso tra un `update` e l'altro (per tenerci lo stato). Il titolo lo disegna il modulo: un elemento con `data-part="title"` nel markup di `mount` è aggiornato dalla dashboard quando `title` cambia.
- `ctx.data(percorso)` risponde solo ai percorsi dichiarati in `data`, scritti uguali al manifesto (con `{from}`) oppure già risolti; per ogni altro percorso dà `undefined`. Il corpo restituito è il JSON della risposta.
- **Valori per riferimento.** `settings`, `widget` e i dati non vanno modificati: il congelamento è superficiale e i dati sono gli stessi oggetti che leggono gli altri riquadri.

**Quando non si disegna.**

- **Un file che non si carica.** La pagina riceve in un tag JSON (`lens-module-widgets`, nell'intestazione) l'elenco dei widget di ogni modulo che ne dichiara, e importa il file solo dei moduli **accesi**, tutti insieme. Un file che non si importa (errore di sintassi, 404) o che non si completa entro 5 secondi lascia quei tipi «non caricati», con l'errore solo nella console: la dashboard parte lo stesso e i riquadri di quel modulo dicono «Widget del modulo {nome} non caricato». Lo stesso vale per un tipo che il file non disegna con `mount` e `update`. Gli altri moduli non ne risentono.
- **Un `mount` o un `update` che lancia** mostra «Dati non disponibili» in quel riquadro, con il messaggio nel tooltip; gli altri riquadri continuano. «riprova» ricarica i dati ma non rimonta il riquadro: dopo un `mount` fallito si ricarica la pagina.
- **Una lettura che fallisce.** Se la richiesta di un percorso dichiarato fallisce, il riquadro mostra «Dati non disponibili» con l'errore nel tooltip e `update` non si chiama.
- **Un widget scartato all'avvio** (vedi `data` sopra) dice quale percorso non è una route `GET` del modulo.
- **«Solo {sorgente}».** Con la sorgente di un altro modulo scelta da sola, i widget del nucleo senza dati di quella sorgente lo dicono; un widget di un modulo no: i suoi dati sono del modulo, non di OpenCode, e si disegna come sempre.
- **Modulo spento, in errore o da configurare.** Il widget resta nella disposizione salvata, con posizione e impostazioni, e al suo posto mostra «Il modulo {nome} è spento: attivalo da Impostazioni › Moduli» (o «è in errore» / «è da configurare: vedi Impostazioni › Moduli»), senza nessuna richiesta. Riaccendendo il modulo il widget torna com'era; salvare la disposizione dall'editor non lo toglie. Anche un modulo il cui manifesto non si carica (per esempio chiede una lens più recente) dice «è in errore»: senza un manifesto da cui leggere il nome, al posto del nome c'è l'id del modulo.
- **Un modulo tolto.** Il tipo che nessuno dichiara più resta nella disposizione, non disegnato, come un tipo sconosciuto di una versione più nuova.
- **Nell'editor** «Aggiungi» elenca i widget dei soli moduli accesi e con il file caricato, dopo quelli del nucleo, con l'etichetta «modulo {nome}», nella vista indicata da `home`; nella vista Monitor nessuno. I widget del nucleo scorrono attorno a quelli dei moduli, che restano dove sono: nel calcolo della disposizione sono ostacoli fissi e «Compatta» non li fa salire. Si spostano e si ridimensionano solo direttamente.

**Fuori ambito.** Stili multipli, Galleria, la vista Monitor e i modelli di dashboard con widget di moduli non ci sono ancora.

**Nessuna sandbox.** Il codice del browser di un modulo gira nella pagina, senza isolamento: i limiti del `ctx` sono del livello dell'API (un modulo non riceve per sbaglio i dati degli altri), non un confine di sicurezza. Vale quanto detto per il codice Node dei moduli: il codice di un modulo è codice fidato.

### Gli strumenti MCP di un modulo

Un modulo può offrire strumenti al server MCP (`opencode-lens mcp`), che OpenCode mostra con il prefisso `lens_` (lo strumento `security` diventa `lens_security`).

- **Il manifesto** dichiara `mcp: () => import("./mcp/tools.js")`, `mcpTools` (i nomi), `mcpInstructions` (le righe per le istruzioni del server) e `mcpExamples` (le domande suggerite in Impostazioni › Server MCP). I campi `mcp`, `mcpTools`, `mcpInstructions`, `mcpExamples` e `mcpPrompts` li valida una foglia senza import, `src/module-mcp-fields.js`: il registro (un campo sbagliato è un errore di manifesto e il modulo va in `error`) e il processo MCP (il modulo è ignorato con un avviso su stderr, mai con il testo «spento»).
- **`mcp/tools.js`** esporta `tools(kit)`, che restituisce l'elenco degli strumenti `{ name, title, description, inputSchema, run(args, ctx) }`, fatti come quelli del nucleo. I file di `mcp/` non importano **niente**: tutto ciò che serve viene dal `kit` che riceve il processo MCP (`argSpec`, `SINCE`, `SINCE_LABEL`, `withLens`, `resolve`, `project`, `LensError`, `ToolError`, `now` e `text` con `cleanName`, `cleanText`, `num`, `pct`, `plural`, `when`; `createToolKit` in `src/mcp/module-kit.js`). Il processo MCP non carica `node:sqlite` né `src/server.js`, e lo strumento parla con la lens solo attraverso la sua API HTTP (nel caso di Security, `/api/security`). Un nome già usato da uno strumento del nucleo, o dichiarato in `mcpTools` da un altro modulo, viene scartato con un avviso su stderr (vince il nucleo, poi il primo modulo per id); uno strumento non dichiarato in `mcpTools` è scartato.
- **Quali strumenti si vedono.** Il processo MCP legge i manifesti da `modules/` e dalla cartella dei moduli dell'utente (la cartella `modules/` accanto al `LENS_DB` del plist del servizio, calcolata dal processo MCP e non presa dalla risposta di `GET /api/modules`; letta una volta sola, all'avvio: un modulo dell'utente nuovo si vede riavviando OpenCode; con una lens avviata a mano e `LENS_DB` solo nella shell il plist non lo dice e vale la cartella di default. Un id uguale a quello di una cartella di `modules/` della lens è scartato con un avviso su stderr prima di importarne il `module.js`, e un id in `shadowed` perde i suoi strumenti. Un link simbolico a una cartella conta come modulo), chiede alla lens `GET /api/modules` all'avvio (`initialize` aspetta al massimo un secondo) e poi ogni 30 secondi, ed elenca solo gli strumenti dei moduli **attivi**. Finché non ha avuto una risposta non elenca nessuno strumento dei moduli; dopo la prima, se la lens non risponde più **resta l'ultimo stato noto**. Quando l'elenco cambia manda `notifications/tools/list_changed`.
- **Uno strumento di un modulo non acceso** non sparisce con un errore generico: risponde con un testo che dice perché: «Il modulo <Nome> è spento in Lens: attivalo da Impostazioni › Moduli.», «Il modulo <Nome> è in errore in Lens: vedi Impostazioni › Moduli.» o «Il modulo <Nome> è da configurare in Lens: vedi Impostazioni › Moduli.» (i testi restano in italiano, come tutto ciò che l'MCP manda a OpenCode). Lo stesso vale per `prompts/get`.
- **OpenCode non rilegge l'elenco.** Verificato con OpenCode 2.0.26: dopo `notifications/tools/list_changed` OpenCode **non** chiede di nuovo gli strumenti, e legge le istruzioni del server una volta sola. Attivando o spegnendo un modulo con strumenti, OpenCode continua quindi a mostrare **il vecchio elenco e le vecchie istruzioni finché non lo riavvii**. Chiamare uno strumento di un modulo che nel frattempo si è spento dà il testo qui sopra; uno strumento di un modulo appena acceso compare in OpenCode solo dopo il riavvio. La card del modulo lo ricorda con una nota, e sta qui di proposito: la notifica serve ai client che la rispettano.

### I prompt MCP di un modulo

Un modulo può offrire al server MCP anche dei **prompt**, che OpenCode mostra come comandi `/lens:<id>`. Il manifesto dichiara `mcpPrompts: true` e il file `mcp` del modulo (lo stesso degli strumenti) esporta, oltre a `tools(kit)`, `prompts(kit)`, che restituisce una `PromptSource`:

| Metodo | |
|---|---|
| `list(signal)` | `{ prompts: [{ id, name, brief }], snapshot }`: i prompt del modulo, più un testo che cambia quando cambia ciò che il client ha letto |
| `get({ name, skill }, signal, ctx)` | `{ description, text }`: il prompt scelto. Per un nome sconosciuto lancia `kit.PromptNotFoundError`, che il nucleo risponde con `-32602` |
| `instructions(signal)` | `string[]`: le righe che il modulo aggiunge in fondo alle istruzioni del server |
| `snapshot(signal)` | solo lo `snapshot` di oggi, per la sorveglianza, senza elencare i prompt |

Il `kit` ha in più `PromptNotFoundError`, `connect`, `randomUUID`, `PROMPT_BRIEF_MAX` (il tetto del brief nel protocollo) e, in `text`, `cleanBlock` e `safePath`. Il nucleo (`src/mcp/prompts.js`) unisce le sorgenti dei moduli accesi:

- Un nome già preso da un modulo precedente (per id) è scartato con un avviso su stderr; un modulo che fallisce non svuota gli altri.
- Ogni 30 secondi il processo MCP aggiorna prima i moduli, poi confronta lo `snapshot` dell'ultimo `list` servito al client con `snapshot(signal)` e manda `notifications/prompts/list_changed` se sono diversi. La notifica parte anche quando cambia l'insieme dei moduli con prompt. Una lens ferma mentre il client leggeva viene annunciata quando torna; una lens che torna con zero preset può mandare una notifica in più.
- Un `prompts/get` di un modulo spento, in errore o da configurare risponde con gli stessi tre testi degli strumenti.
- **Le istruzioni** hanno quest'ordine: l'intestazione e gli strumenti del nucleo, le `mcpInstructions` dei moduli accesi, il resto del nucleo e, dopo una riga vuota, le righe di `instructions(signal)` dei moduli accesi. Queste ultime sono asincrone: `initialize` le aspetta poco (al più 3 secondi) e non fallisce mai per una lens ferma. Con una lens ferma all'avvio a freddo le righe dei moduli compaiono solo da quando se ne conosce lo stato.

A differenza degli strumenti, i prompt seguono `prompts/list_changed`: accendere o spegnere Skill fa comparire o sparire i comandi `/lens:<id>` in OpenCode senza riavvio.

### Una sorgente alternativa

Un modulo può offrire alla dashboard un'altra sorgente di dati (oggi IBM Bob): il manifesto ha `source: { label: "Bob" }` e l'istanza di `create` espone `status()` (obbligatoria con `source`) e `source() → { selects, only?, add?, totals, earliest }`:

- **`selects`**: `{ steps, sessions, tools, prompts, runs }`, una `SELECT` (o `WITH … SELECT`) per ciascuna, che presenta i dati del modulo con le colonne delle tabelle del nucleo, nello stesso ordine (`ctx.sql.COLUMNS`). In «+» il nucleo mette ogni `select` in una sottoquery (`SELECT * FROM (<select>)`) prima di unirla alle righe di OpenCode: un `ORDER BY` o un `LIMIT` al livello più esterno vale solo per le righe del modulo, mai per quelle di OpenCode.
- **`only`** (facoltativo): `{ limits, weeklyLimits, monthlyLimits, contextLimits }`, i budget di «Solo»; **`add`**: `{ contextLimits }`, aggiunti a quelli di OpenCode in «+».
- **`totals(from, to)`**: il blocco `<id>` che si aggiunge a `/api/summary`. **`earliest()`**: il dato più vecchio in ms o `null`, per `from=0`.

Il nucleo (`src/source-views.js`) controlla ogni `select` con lo scanner (una sola `SELECT` o `WITH`), apre due connessioni in sola lettura con viste TEMP e prova ogni vista con `SELECT * FROM <vista> LIMIT 0`. Un errore (in `source()`, in una `select` o in una vista) significa niente sorgente, un avviso nel log e il modulo in `error` col motivo: mai un avvio fallito. Al più una sorgente: con due moduli accesi vale la prima per id, l'altra è ignorata con un avviso.

Il parametro dell'URL è l'id del modulo: `?bob=1` per «+ Bob», `?bob=only` per «Solo Bob», sugli endpoint che lavorano sulle viste (l'elenco è in [metriche.md](metriche.md#api-locale)); senza la sorgente accesa il parametro è ignorato. Restano del nucleo: quali endpoint ne sono capaci, il blocco `<id>` di `/api/summary`, il budget di «Solo», l'unione di `/api/runs/live` e le viste vuote per ciò che la sorgente non ha (`internal_usage`, `signals`, `permissions`, `daily_steps`, `daily_tools`). In «Solo» `meta` non ha `retention_from` (i giorni potati di OpenCode non entrano nei numeri della sorgente), `modelLimits` è `[]` e `opencodeModels` è `null`. `ctx.live.feed(item)` dà alla sorgente le righe di «attività recente».

Nel browser il selettore è generico, «OpenCode · + {label} · Solo {label}», e compare solo se `/api/status` ha il blocco della sorgente (vedi [dashboard.md](dashboard.md#ibm-bob)).

### Stato in `/api/status` e `/healthz`

Un modulo acceso la cui istanza ha `status()` aggiunge `<id>: status()` al corpo di `/api/status`; con `state()` (una lettura senza query) aggiunge `<id>: state()` a `/healthz`. Il `problem` di `status()` (un `Localized` o `null`) è la frase del banner. Il registro cattura per modulo: un'eccezione si scrive una volta nel log e la chiave manca, mai un 500. Spento o `unconfigured`, il modulo non aggiunge niente.

### Gli id riservati

Un id non può essere (il modulo va in `error`, col motivo): una pagina o una vista del nucleo; una chiave del corpo di `/api/status` (`CORE_STATUS_KEYS`: le chiavi di `collector.status()` più `lens`, `counts`, `ok`, `opencode`), perché lì il modulo mette il suo blocco; un tipo di modifica del nucleo (`CORE_CHANGE_KINDS`: `feed`, `step`, `tool`, `usage`, `signal`, `permission`, `status`, `session`, `scan`, `sync`), perché `ctx.live.changed` lo usa come tipo; e, per un modulo con `source`, un parametro che il nucleo legge (`SOURCE_RESERVED`) o una chiave di `/api/summary`. Gli elenchi sono in `src/core-paths.js` e i test li verificano contro il codice.

### I percorsi del nucleo

`src/core-paths.js` (`CORE_PATHS`) elenca i percorsi `/api` che il nucleo serve: `exact` (le `GET`), `prefixes` (tutto ciò che sta sotto) e `writes` (le `POST`). Un modulo non dichiara una route su uno di questi percorsi, con **qualunque metodo**, nemmeno dentro un prefisso del nucleo o con un prefisso che ne copre uno: la route è scartata con un avviso nel log. `test/core-paths.test.js` legge `src/server.js` e fallisce se un percorso servito manca nell'elenco, o se un percorso dell'elenco non è servito. Lo stesso file elenca `CORE_FILES` e `CORE_DIRS`, i file e le cartelle che il nucleo scrive nella cartella dei dati (vedi [l'entrata Node](#lentrata-node)); lo stesso test li confronta con quelli che il nucleo scrive davvero.

### I file del browser

Le pagine dei moduli attivi sono servite da `/modules/<id>/<file>`. Nella cartella `public/` del modulo, piatta (niente sottocartelle):

- `page.js` esporta `page` (la pagina come le altre del director, vedi [architettura.md](architettura.md#5-la-dashboard-stili-modelli-e-adattatori)) e `title`;
- `page.html` è inserito nella dashboard al posto del segnaposto dei moduli; `style.css`, se c'è, è collegato nell'intestazione;
- `lang-en.js` e `lang-fr.js` esportano per default il catalogo del modulo, unito a quello del nucleo; un modulo senza cataloghi mostra l'italiano. Le regole sono quelle di [traduzioni.md](traduzioni.md).

Il codice del browser importa dal nucleo **solo** da `"/module-kit.js"` (`t`, `tn`, `N_`, `esc`, `el`, `$`, `get`, `send`, `table`, `stateBox`, i formattatori e pochi altri). Il resto dei file si importa con percorsi relativi. Ci sono anche `getLang` e `getLocale` (la lingua e il locale della dashboard). Un file di `public/` che anche il lato Node del modulo importa non ha import: ciò che gli serve, come `t`, gli arriva come parametro (`modules/vibecoding/public/vibe-projects.js`, `modules/skill/public/preset-rules.js`). Le regole CSS usate da almeno due moduli (Skill e Vibe Coding: `danger`, `fmenu`, `mix`, `vhero`, `vk`…) restano nel CSS del nucleo; quelle di un modulo solo stanno nel suo `style.css`.

### Le regole dei confini

`test/module-boundaries.test.js` le controlla:

- il nucleo (`src/`, `public/`) non importa niente da `modules/` e non contiene i marcatori di un modulo (se ne restano, stanno in un elenco che può solo accorciarsi);
- un modulo importa solo da dentro la propria cartella, da `node:*` e, soltanto nei file di `public/` e `test/`, da `/module-kit.js`; `module.js` non ha import statici;
- il codice `server/` non importa un file di `public/` che usa `/module-kit.js`;
- i test di un modulo importano dal nucleo solo `/module-kit.js` e `test/module-test-kit.js`.

### Provare un modulo

I test di un modulo stanno in `modules/<id>/test/` e importano dal nucleo solo `/module-kit.js` e `test/module-test-kit.js`. I test di un modulo dell'utente, che sta fuori dall'app, importano il test kit con lo specificatore assoluto `"/module-test-kit.js"` (come `"/module-kit.js"`, lo risolve `test/module-hooks.mjs`; vedi sotto), mai con un percorso relativo verso l'app. Il test kit esporta quello che serve a provare un modulo su dati veri: `memoryStore()` e i costruttori `addSession`, `addStep`, `addTool`, `addPrompt`, `addRun`, `addInternal` (uno store SQLite in memoria), `moduleContext` (il `ctx` vero, da costruire con `{ id, config, store, collector, queries, log }`), `Queries`, il controllo dei piani (`check`, `rangeKeys`, `recorded`) e, per gli strumenti MCP, `createToolKit` (il `kit` che riceve `tools(kit)`), `createHandler` (il gestore JSON-RPC che li elenca e li chiama) e le classi `LensError` e `ToolError`. Per le pagine del browser e i prompt MCP aggiunge `configure` e `rebuildFormats` (la lingua nei test del browser), `catalogs()` (i cataloghi del nucleo uniti a quelli del modulo), `createPromptAggregator`, `createPromptWatcher`, `instructionsWith` e `PromptNotFoundError`, più `MAX_ID`, `PRESET_ID` e `SKILL_ID` per confrontare gli id di un modulo con quelli del nucleo. Per i widget aggiunge `widgetContext(spec, ctx)`, che costruisce il `ctx` congelato che la dashboard dà a `mount` e `update` (`spec` è la voce di `widgets` del manifesto, `ctx` quello della griglia con `widget`, `title`, `settings`, `paths`, `data` e `inst`). Niente altro del nucleo è raggiungibile, di proposito.

Un test di modulo si lancia da solo, ma **serve** `--import ./test/module-hooks.mjs`: fa risolvere `/module-kit.js` e `/module-test-kit.js` anche sotto Node, come fa il browser. Senza, l'import fallisce. `npm test` lo passa già. Il test kit viaggia anche con l'app installata (`test/module-test-kit.js`, `test/module-hooks.mjs` e i file che importa, sotto `~/Applications/opencode-lens/test/`): i test di un modulo dell'utente girano anche lì, con `--import <cartella dell'app>/test/module-hooks.mjs`.

```bash
node --disable-warning=ExperimentalWarning --import ./test/module-hooks.mjs --test modules/vibecoding/test/vibecoding-module.test.js
```
