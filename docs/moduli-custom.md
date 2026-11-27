# Scrivere un modulo di Lens

🌐 Italiano · [English](en/moduli-custom.md) · [Français](fr/moduli-custom.md)

Questa guida è per chi scrive un modulo **suo**, quasi sempre un modello (in OpenCode o altrove) che non conosce il codice della lens. Segui le sezioni in ordine: sono l'ordine del lavoro. Ogni regola dice quale file della lens la impone; i dettagli completi del contratto sono in [moduli.md](moduli.md#scrivere-un-modulo), qui c'è solo quello che serve per costruire. Chi legge questa guida da `lens_module_guide` non può aprire i link a moduli.md: il file è sul disco, in `<app>/docs/moduli.md` (`<app>` è `~/Applications/opencode-lens`, o la copia del repository della lens). Lo strumento MCP `lens_module_guide` restituisce questo testo più i valori di questa installazione (cartella, versione, nomi già presi); con `section` restituisce ogni sezione il cui titolo contiene quel testo (maiuscole ininfluenti), per esempio `section: "widget"`.

Tutti gli esempi vengono dal modulo d'esempio `extras/module-template/` (id `mio-modulo`, widget `mio-modulo-conteggio`, impostazione `LENS_MIO_MODULO_NOTE`): una pagina con un blocco di note, un widget, una `GET`, una `POST` JSON, un file JSON, un'impostazione e i test. **Parti sempre da una sua copia.**

## Prima di scrivere

- **Ti serve davvero un modulo?** Un modulo aggiunge alla lens una pagina, dei widget per la dashboard, delle route `/api`, degli strumenti MCP o delle metriche, su dati che la lens non ha già. Per vedere in altro modo dati che la lens ha già, prima prova i widget del nucleo e il loro ⚙ (vedi [dashboard.md](dashboard.md)); per chiedere qualcosa a Lens da OpenCode bastano gli strumenti MCP del nucleo (`lens_usage`, `lens_sessions`…).
- **Cosa non trovi.** La lens non salva il testo dei prompt né le risposte dei modelli (vedi [configurazione.md](configurazione.md#sicurezza-e-privacy)): nessun modulo può leggerli dal database. Un modulo non apre il database, non scrive nelle tabelle del nucleo, non importa file di `src/` o `public/` della lens e non legge `process.env`: tutto arriva da `ctx` (Node), da `"/module-kit.js"` (browser) e da `kit` (MCP).
- **Niente ricarica a caldo.** La lens cerca i moduli solo all'avvio: un modulo nuovo, o un file del modulo cambiato, vale dopo un riavvio della lens (`src/modules.js`, `discoverAll`). Gli strumenti MCP di un modulo compaiono in OpenCode solo dopo un riavvio di OpenCode.
- **Nessuna sandbox.** Il codice di un modulo è codice Node fidato: gira dentro il processo della lens, con i suoi permessi, e può leggere e scrivere qualsiasi file dell'utente. Il codice del browser gira nella pagina della dashboard senza isolamento. I limiti di `ctx` evitano gli errori, non fermano un modulo ostile. Non scrivere un modulo che fa più di quanto l'utente ha chiesto.
- **L'ordine del lavoro**: `lens_module_guide` (questa guida e i valori) → copia del modulo d'esempio nella cartella dell'utente → manifesto → lato Node → pagina e widget → `lens_module_check` finché risponde OK → riavvio della lens → **Impostazioni › Moduli** › *Attiva* → i test del modulo.

## Dove salvare il modulo

- **Nella cartella dei moduli dell'utente**, accanto al database della lens (`<cartella di lens.db>/modules/<id>/`), mai nella cartella dell'app. Il valore esatto lo danno `lens_module_guide` («Cartella dei moduli dell'utente») e `GET /api/modules/authoring` (campo `userDir`, solo da questo computer). Di default:

  | Dove gira | Cartella dei moduli dell'utente |
  |---|---|
  | macOS | `~/Library/Application Support/opencode-lens/modules/` |
  | Linux | `$XDG_DATA_HOME/opencode-lens/modules/` (di default `~/.local/share/opencode-lens/modules/`) |
  | `LENS_DB` impostata | la cartella `modules/` accanto al file del database |
  | `LENS_DB=:memory:` | nessuna: niente moduli dell'utente |

- **Non salvarlo in `~/Applications/opencode-lens/modules/`**: ogni aggiornamento cancella e ricrea la cartella dell'app. La cartella dei dati sopravvive agli aggiornamenti (`install.sh` non la tocca), e così i moduli che ci stanno.
- **Se la cartella `modules/` non c'è, creala.** La lens non la crea; se manca non succede niente.
- **Il nome della sottocartella è l'id del modulo**: minuscole, cifre e trattino, comincia con una lettera (`^[a-z][a-z0-9-]*$`, `MODULE_ID` di `src/config.js`). Una cartella con un altro nome (`mio modulo`, `Mio-Modulo`, `demo 2`) non è un modulo e viene ignorata in silenzio. Se il modulo avrà tabelle, niente trattino nell'id (vedi [Persistenza](#persistenza)).
- **Un id libero.** Non usare un id già preso (elenco «Id di modulo già presi» di `lens_module_guide`) né un id riservato dal nucleo (pagine, viste, chiavi di `/api/status`, tipi di cambiamento: elenco «Id riservati»). Un id uguale a un modulo della lens (`sistema`, `skill`…) non viene mai importato: la lens lo mette da parte (`shadowed`) e **Impostazioni › Moduli** chiede di rinominare la cartella.
- **Un link simbolico va bene**: nella cartella dell'utente una sottocartella può essere un link a una cartella altrove (per esempio una copia di lavoro sotto git).

## Cartelle e file

Copia il modulo d'esempio con il nome del tuo id, poi rinomina `mio-modulo` dappertutto: nome della cartella, `id` del manifesto, percorsi `/api/mio-modulo`, tipo del widget `mio-modulo-conteggio`, `id` di `page.js`, `id="view-mio-modulo"` e `data-ico` di `page.html`, prefisso delle classi CSS e degli id HTML (`mm-`), nome del file JSON e nome dell'impostazione `LENS_MIO_MODULO_NOTE`.

```bash
# l'app installata porta il modulo d'esempio; <cartella dei moduli> è quella di lens_module_guide
cp -R ~/Applications/opencode-lens/extras/module-template "<cartella dei moduli>/mio-modulo"
```

```
<id>/
  module.js          il manifesto (obbligatorio)
  server/index.js    l'entrata Node (obbligatoria): configure, files, hasData, create
  public/            i file del browser, tutti in questa cartella, piatta, nomi in minuscolo
    page.js          la pagina: esporta page e title
    page.html        il markup della pagina: <section id="view-<id>">
    widgets.js       i widget della dashboard (con widgets e widgetsFile)
    style.css        facoltativo
    lang-en.js       i cataloghi del modulo (un testo italiano → la traduzione)
    lang-fr.js
  tables.js          facoltativo: le tabelle del modulo nel database
  server/writes.js   facoltativo, con tables.js: gli SQL di scrittura
  mcp/tools.js       facoltativo: gli strumenti MCP
  test/              i test del modulo
```

- **`module.js` non ha import** e non fa niente: la lens lo importa all'avvio anche per un modulo spento, per sapere che esiste.
- **`server/index.js` non ha effetti all'import**: niente timer, connessioni o letture al primo livello. La lens lo importa anche per un modulo spento (per `files` e `hasData`) e `lens_module_check` lo esegue a ogni controllo. Il lavoro si fa in `create(ctx)` e in `start()`.
- **Gli import**: dentro la cartella del modulo, `node:*` e, solo nei file di `public/` e `test/`, `"/module-kit.js"`; nei test anche `"/module-test-kit.js"`. Nient'altro (le regole sono quelle di `test/module-boundaries.test.js` per i moduli della lens; per il tuo le controlla il test «gli import» del modulo d'esempio: tienilo).
- **`public/` è piatta**: la lens serve `/modules/<id>/<file>` con `<file>` fatto di minuscole, cifre, `.`, `_` e `-`, senza sottocartelle (`MODULE_FILE` di `src/server.js`), e solo con il modulo acceso.

## Il manifesto

`module.js` esporta per default un oggetto. La lens lo giudica con `manifestError` di `src/modules.js` (più `src/module-mcp-fields.js` e `src/module-widget-fields.js`): un campo sbagliato manda il modulo in `error` col motivo, visibile in **Impostazioni › Moduli** e in `lens_module_check`. Questi sono **tutti** i campi che legge (l'elenco è `MANIFEST_FIELDS` di `src/modules.js`):

| Campo | Obbligatorio | Valori validi |
|---|---|---|
| `id` | sì | uguale al nome della cartella; non una pagina o vista del nucleo, una chiave di `/api/status` o un tipo di cambiamento (vedi [Gli id riservati](moduli.md#gli-id-riservati)) |
| `name` | sì | testo italiano non vuoto, tradotto dai cataloghi del modulo |
| `description` | sì | testo italiano non vuoto, tradotto come `name` |
| `lens` | sì | `x.y.z`, la versione più vecchia della lens che regge il modulo: metti quella che dà `lens_module_guide`. Più nuova della lens in uso → `error` |
| `menu` | sì | `{ group, order, icon }`: `group` è `"dati"` o `"lens"`, `order` un numero (ordina dentro il gruppo; i moduli vanno in fondo), `icon` un testo, l'interno di un `<svg viewBox="0 0 24 24">` |
| `page` | sì | `{ title }`: il titolo della voce di menu, testo italiano non vuoto |
| `server` | sì | `() => import("./server/index.js")` |
| `settings` | no | le variabili `LENS_…` del modulo, vedi sotto |
| `widgets` | no | da 1 a 12 widget della dashboard; richiede `widgetsFile` (vedi [Widget della dashboard](#widget-della-dashboard)) |
| `widgetsFile` | con `widgets` | il nome di un file `.js` di `public/` (`^[a-z0-9-]+\.js$`), per esempio `"widgets.js"` |
| `mcp` | no | `() => import("./mcp/tools.js")` (vedi [MCP del modulo](#mcp-del-modulo)) |
| `mcpTools` | con `mcp` | i nomi degli strumenti, `^[a-z][a-z0-9_-]{0,63}$`, non ripetuti |
| `mcpInstructions` | no, con `mcp` | righe (una riga ciascuna, non vuote) aggiunte alle istruzioni del server MCP |
| `mcpExamples` | no, con `mcp` | domande d'esempio per Impostazioni › Server MCP, una riga ciascuna |
| `mcpPrompts` | no, con `mcp` | `true` se il file `mcp` esporta anche `prompts(kit)` (vedi [moduli.md](moduli.md#i-prompt-mcp-di-un-modulo)) |
| `notice` | no | testo italiano dell'avviso «era in uso» dopo un aggiornamento |
| `settingsPanel` | no | un file `.js` di `public/` con il pannello della scheda (vedi [moduli.md](moduli.md#il-pannello-nella-scheda)) |
| `tables` | no | `() => import("./tables.js")` (vedi [Persistenza](#persistenza)) |
| `source` | no | `{ label }`: il modulo è una sorgente di dati alternativa a OpenCode. Avanzato: non serve a un modulo nuovo (vedi [moduli.md](moduli.md#una-sorgente-alternativa)) |

Il manifesto del modulo d'esempio:

```js
export default {
  id: "mio-modulo",
  name: "Il mio modulo",
  description: "Un modulo d'esempio da copiare: un blocco di note con la sua pagina, un widget per la dashboard e un'impostazione",
  lens: "0.51.0", // x-release-please-version
  menu: { group: "dati", order: 90, icon: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h6"/>' },
  page: { title: "Il mio modulo" },
  server: () => import("./server/index.js"),
  settings: [{ name: "LENS_MIO_MODULO_NOTE", label: "Nota di benvenuto", help: "mostrata in cima alla pagina; vuoto = nessuna", kind: "text", placeholder: "Ciao!" }],
  widgetsFile: "widgets.js",
  widgets: [{
    type: "mio-modulo-conteggio", label: "Note del mio modulo", description: "Quante note hai scritto nel periodo, e l'ultima",
    size: [3, 4], min: [3, 3], home: "adesso",
    settings: { title: null, range: ["dashboard", "day", "604800000", "2592000000", "0"] },
    data: ["/api/mio-modulo?from={from}"],
  }],
};
```

**`settings`** (`settingsError` di `src/modules.js`): un elenco di `{ name, label, help, kind, placeholder? }`.

- `name`: `LENS_` più maiuscole, cifre e `_` (`^LENS_[A-Z0-9_]+$`); non una variabile del nucleo, non già dichiarata da un altro modulo (elenco «Variabili LENS_… già prese» di `lens_module_guide`), non ripetuta. Usa `LENS_<ID>_…`, come `LENS_MIO_MODULO_NOTE`.
- `label` e `help`: testi italiani (`help` può essere vuoto). `kind`: `"text"`, `"num"` o `"secret"`. `placeholder`: testo facoltativo, il valore predefinito mostrato nel campo.
- Con `kind: "num"`, `min` e `max` facoltativi, interi, `min ≤ max`; con un altro `kind` sono un errore.
- Un elenco di percorsi è un'impostazione `kind: "text"` con i percorsi separati da `:`, come `LENS_SECURITY_DIRS` (`modules/security/server/settings.js`).
- Ogni impostazione è un campo della scheda del modulo in **Impostazioni › Moduli**; salvarla riavvia la lens, se `configure` accetta il valore (vedi la sezione dopo). Il valore arriva al modulo solo attraverso `configure`.

**I testi del manifesto** (`name`, `description`, `page.title`, `label`, `help` e `placeholder` delle impostazioni, `label` e `description` dei widget, `notice`) si scrivono in italiano e hanno una voce in `public/lang-en.js` e `public/lang-fr.js` del modulo.

## Entrata Node e ctx

`server/index.js` esporta fino a quattro funzioni. Solo `create` è obbligatoria (`lens_module_check` dice «server/index.js deve esportare create(ctx)»).

- **`configure(ctx)`**: legge le impostazioni. La lens la chiama all'avvio per ogni modulo trovato, acceso o spento, e a ogni salvataggio da Impostazioni. Riceve solo `{ id, env, paths, i18n }` (`settingsContext` di `src/module-kit.js`): `env` ha **solo** le variabili dichiarate in `settings`, più `HOME` e `XDG_*`. Restituisce `{ values, errors }`: `values` è l'oggetto che il modulo vedrà come `ctx.settings` (già convertito: numeri come numeri, percorsi assoluti), `errors` un elenco di testi o di `Localized`. Cosa fanno gli `errors`: **dalla dashboard un valore sbagliato non si salva**: a ogni salvataggio da Impostazioni la lens esegue `configure` dei moduli che resteranno accesi con l'ambiente dopo il salvataggio (`validateEnv` di `src/modules.js`, chiamato da `src/settings.js`) e, se c'è un errore, risponde 400 con gli errori, senza scrivere niente e senza riavviarsi (un errore che comincia con il nome della variabile, come quello del modulo d'esempio, la pagina lo segna sul campo). Il modulo è «da configurare» (`unconfigured`), e non parte, solo quando l'ambiente è già sbagliato all'avvio: una cartella sparita, il plist scritto a mano. Se `configure` lancia o non restituisce `{ values, errors }` il modulo va in `error`. **Senza `configure`, `ctx.settings` è `{}`**: il valore della variabile non arriva mai al modulo.

  ```js
  export function configure(ctx) {
    const { Localized } = ctx.i18n;
    const note = (ctx.env.LENS_MIO_MODULO_NOTE ?? "").trim();
    const errors = note.length > MAX_TEXT ? [new Localized("LENS_MIO_MODULO_NOTE è troppo lunga: al più {max} caratteri", { max: MAX_TEXT })] : [];
    return { values: { note }, errors };
  }
  ```

  **Il valore vuoto deve essere valido.** `lens_module_check` esegue `configure` con l'ambiente attuale della lens (`process.env`, `src/main.js`), dove la variabile di un modulo nuovo non c'è ancora; e *Attiva* è un salvataggio come gli altri, che esegue `configure` del modulo appena acceso. Se il vuoto è un errore, il controllo non risponde mai «OK» e *Attiva* con il campo vuoto è rifiutato (400). Per il vuoto usa un valore predefinito, o uno stato «non configurato» dentro il modulo che la pagina spiega: nel modulo d'esempio vuoto = nessuna nota di benvenuto.

  Un'impostazione che è un percorso: vuoto = un default costruito da `ctx.paths` (o «non configurato»); se c'è, accetta solo percorsi assoluti. Un percorso che non esiste puoi dirlo in `errors` (il salvataggio è rifiutato con il motivo; se la cartella sparisce più tardi, al riavvio il modulo è «da configurare»), oppure saltarlo e dirlo nella pagina, come fa Security.
- **`files(ctx)`**: facoltativa, i file che il modulo scrive, `[{ label, path, note?, kind? }]` (`label` e `note` con `N_`). La lens li mostra in **Impostazioni › Dati e file** e lo script di disinstallazione li cancella. `kind` è `"write"` (il default: un file **dentro la cartella dei dati**), `"dir"` (una cartella dentro la cartella dei dati) o `"read"` (un percorso assoluto qualsiasi che il modulo **legge soltanto**: mai cancellato). Una voce fuori da queste regole, o su un file del nucleo, è scartata con un avviso nel log (`files()` di `ModuleRegistry`, `src/modules.js`). Con impostazioni non valide `files` non viene chiesta.
- **`hasData(ctx)`**: facoltativa, `true` se il modulo ha già dati salvati (decide l'avviso «era in uso» dopo un aggiornamento). Se lancia vale `false`. Come `files`, non scrive niente: quindi **non chiama `read()` dello store**, che su un file rotto ne fa una copia `<nome>.bad.json` e scrive nel log (`JsonStore` di `src/presets.js`). Prende solo `path` dello store (costruirlo non tocca il disco) e legge il file da sé, con `fs.readFileSync` e `JSON.parse` dentro un `try` (`false` se non c'è o non è valido), come `hasData` di `modules/vibecoding/server/projects.js`.
- **`create(ctx)`**: chiamata solo per un modulo acceso e configurato. Restituisce **subito** (mai una promessa: è un errore) un oggetto, tutto facoltativo: `routes` (vedi [Route GET e POST](#route-get-e-post)), `start()` e `stop()` (anche asincroni), `families()` (metriche per `/metrics`), `status()` e `state()` (blocchi di `/api/status` e `/healthz`). Se `create` o `start` lanciano, il modulo va in `error` e gli altri continuano.

**Il `ctx`** di `create`, `files` e `hasData` (`moduleContext` di `src/module-kit.js`) è congelato ed è la sola porta verso la lens. Quello che serve per costruire:

| Campo | |
|---|---|
| `ctx.id` | l'id del modulo |
| `ctx.settings` | i `values` di `configure` (congelati); `{}` senza `configure` |
| `ctx.env`, `ctx.paths` | come in `configure`; `ctx.paths` ha `home`, `opencodeConfigDir`, `xdgData` e `dataDir` (la cartella del database, `null` con `:memory:`) |
| `ctx.i18n` | `t`, `N_`, `Localized`, `errorText` |
| `ctx.reply(stato, corpo)` | una risposta con uno stato diverso da 200 (stato da 200 a 599, corpo un oggetto semplice) |
| `ctx.range(searchParams, { earliest }?)` | il periodo `{ from, to }` di una richiesta, come lo leggono gli endpoint del nucleo |
| `ctx.jsonStore({ name, validate, empty, what })` | un file JSON del modulo accanto al database (vedi [Persistenza](#persistenza)) |
| `ctx.reader` | `get(sql, …)` e `all(sql, …)`: letture del database della lens, solo `SELECT` |
| `ctx.writer` | solo con `tables`: scritture sulle tabelle del modulo |
| `ctx.live.changed(payload)` | avvisa le dashboard aperte: i widget del modulo rileggono i loro dati |
| `ctx.meta` | `get(chiave)` e `set(chiave, valore)`: piccoli valori del modulo nel database (chiavi `module:<id>:data:…`) |
| `ctx.log` | `info`, `warn`, `error`, con il prefisso `[<id>]` |
| `ctx.time`, `ctx.sql`, `ctx.budgets`, `ctx.tokensOf` | periodi, frammenti SQL e budget del nucleo, per leggere i dati di OpenCode |
| `ctx.prices` | il listino prezzi per modello: `empty`, `of(modello)` ed `estimate(modello, tipi)` (vedi [moduli.md](moduli.md#lentrata-node)) |

Non c'è: `process.env` (usa `ctx.env`), il database (usa `ctx.reader`/`ctx.writer`), la configurazione del nucleo, il token. **`ctx.store` non è un posto per i tuoi dati**: ha solo `counts()`, i contatori della lens. L'elenco completo, con `readers`, `zip`, `skillLoads` e `collector`, è in [moduli.md](moduli.md#lentrata-node).

**I testi** che il codice Node mostra passano da `const { t, N_ } = ctx.i18n` e da chiamate **nude**, `t("…")` e `N_("…")`: mai `ctx.i18n.t("…")`, che lo scanner delle traduzioni non vede. Ogni testo ha una voce nei cataloghi del modulo.

## Route GET e POST

`create(ctx)` restituisce `routes`, un oggetto `{ "<METODO> <percorso>": … }` (`routeError` e `#buildRoutes` di `src/modules.js`):

| Chiave | Valore |
|---|---|
| `"GET /api/x"` | `(req, { url, local }) => risposta`; risponde anche a `HEAD` |
| `"GET /api/x/*"` | come sopra, per ogni percorso **sotto** `/api/x/`, con `rest` (il resto, già decodificato) |
| `"POST /api/x"` | `{ handler, body: { type: "json", max }, what }`; `handler(req, { url, local, body })` riceve il JSON già letto |
| `"POST /api/x/*"` | come sopra, con `rest` |

- **Il percorso** comincia con `/api/`, ha solo minuscole, cifre, `/`, `_` e `-` (`[a-z0-9/_-]`, `ROUTE_KEY` di `src/modules.js`), e non tocca un percorso del nucleo (elenchi «Percorsi /api riservati» di `lens_module_guide`) né la route di un altro modulo: una route così è scartata con un avviso nel log, e il modulo resta acceso. Usa `/api/<id>` e `/api/<id>/…`. `lens_module_check` non vede le route (nascono in `create`): i conflitti compaiono solo nel log all'avvio.
- **`url`** è un `URL`: i parametri si leggono da `url.searchParams`. **`local`** è `true` per un client di questo computer: una `GET` risponde anche da rete (con il token), quindi non dare da rete ciò che vale solo in locale. **`rest`** può contenere `/` e `..`: mai usarlo così com'è come percorso di un file; vale `null` per una codifica rotta.
- **Una `POST` dichiara il corpo**: `body: { type: "json", max }` con `max` intero in byte, da 1 a 16 MiB; non esistono altri tipi per un JSON (niente `empty`: una `POST` senza dati manda comunque un oggetto JSON, anche `{}`). Prima del `handler` la lens applica i controlli di ogni scrittura (solo da questo computer, `Origin`, `content-type: application/json`, token) e il limite `max`. `what` è obbligatorio: cosa si modifica, con `N_` nudo, per i messaggi di rifiuto. Per un corpo non JSON (`type: "raw"`) vedi [moduli.md](moduli.md#le-route).
- **La risposta**: un oggetto semplice è un `200` in JSON; un altro stato è `return ctx.reply(400, { errors: [t("…")] })`. Qualsiasi altra cosa, o un'eccezione, è un `500` generico con l'errore nel log. La pagina legge `errors` di un rifiuto (vedi [Pagina del browser](#pagina-del-browser)).
- **Un handler può essere `async`**: la lens aspetta la promessa (`moduleAnswer` di `src/server.js`) e le regole della risposta valgono per il valore risolto; una promessa rifiutata è un `500`. Aspettare un lavoro breve e limitato va bene; un lavoro lungo no (vedi [Lavoro lungo](#lavoro-lungo)).
- **Il periodo**: `ctx.range(url.searchParams, { earliest })` legge `?from=` e `?to=` come il nucleo: `from=day` è il giorno di budget, `from=0` è «tutto» (con `earliest`, una funzione che dà il dato più vecchio del modulo in ms o `null`, parte da lì), altrimenti millisecondi. È quello che arriva da `{from}` di un widget.

Le route del modulo d'esempio:

```js
"GET /api/mio-modulo": (_req, { url, local }) => {
  const all = notes.read().notes;
  const { from, to } = ctx.range(url.searchParams, { earliest: () => all[0]?.at ?? null });
  const inPeriod = all.filter((n) => n.at >= from && n.at <= to);
  return {
    note: ctx.settings.note ?? "",
    notes: [...all].reverse(),
    count: inPeriod.length,
    last: inPeriod.at(-1) ?? null,
    from,
    to,
    canSave: local,
  };
},
"POST /api/mio-modulo": {
  body: { type: "json", max: 4096 },
  what: N_("le note del modulo d'esempio"),
  handler: (_req, { body }) => {
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text === "" || text.length > MAX_TEXT) return ctx.reply(400, { errors: [t("La nota deve avere da 1 a {max} caratteri", { max: MAX_TEXT })] });
    const doc = notes.read();
    notes.write({ version: 1, notes: [...doc.notes, { text, at: Date.now() }].slice(-MAX_NOTES) });
    ctx.live.changed({ notes: Math.min(doc.notes.length + 1, MAX_NOTES) });
    return { ok: true };
  },
},
```

Controlla sempre il corpo di una `POST` campo per campo: può essere `null`, un elenco o qualsiasi cosa.

## Persistenza

Scegli uno dei due modi. Nel dubbio, il primo.

**`ctx.jsonStore`: un file JSON accanto al database.** Per documenti piccoli (impostazioni, note, uno storico corto). `ctx.jsonStore({ name, validate, empty, what })` (`src/module-kit.js`, sul `JsonStore` di `src/presets.js`):

- `name`: un nome di file, `^[a-z0-9][a-z0-9._-]*\.json$`, senza cartelle, non un file del nucleo (altrimenti lancia `TypeError`). Usa `<id>.json`.
- `validate(doc)`: restituisce `{ ok: true, doc }` con il documento ripulito o `{ ok: false, errors }`. Il file si può modificare a mano: controlla tutto.
- `empty()`: il documento quando non c'è ancora niente.
- `what`: `{ broken, none, dropped }`, le tre frasi con cui il log dice che il file non va (`<file> non è JSON valido: <broken>`, `<file> <none> (motivi): <dropped>`), concordate tra loro.
- Dà `read()`, `write(doc)` (atomico: file temporaneo e rinomina), `path` e `badFile`. Un file illeggibile dà `empty()`, un avviso nel log e una copia `<nome>.bad.json` che un salvataggio non distrugge: anche `read()` può scrivere, per questo `hasData` non lo usa (vedi [Entrata Node e ctx](#entrata-node-e-ctx)). Con `LENS_DB=:memory:` il documento resta in memoria fino al riavvio e `path` è `null`.
- `read()` e `write()` sono **sincroni e senza cache**: ogni `read()` rilegge e rivalida il file. Tieni il documento piccolo (il modulo d'esempio tiene al più 50 note di 200 caratteri) e non chiamarli in un ciclo.
- Crea lo store **in una variabile del modulo**, in `create` (e, per `files`, con la stessa funzione), e dichiaralo in `files()`:

```js
const FILE = "mio-modulo.json";
const WHAT = { broken: "le note sono ignorate", none: "non contiene note valide", dropped: "sono ignorate" };
const notesStore = (ctx) => ctx.jsonStore({ name: FILE, validate, empty, what: WHAT });

export function files(ctx) {
  const { N_ } = ctx.i18n;
  const store = notesStore(ctx);
  if (!store.path) return [];
  return [
    { label: N_("Note del mio modulo"), path: store.path, note: N_("le note scritte nella pagina del modulo d'esempio") },
    { label: N_("Note del mio modulo (file non valido)"), path: store.badFile, note: N_("copia di mio-modulo.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse") },
  ];
}
```

**`tables` + `ctx.writer`: tabelle nel database della lens.** Per molte righe, query per periodo, dati che crescono. Il manifesto ha `tables: () => import("./tables.js")`; `tables.js`, senza import, esporta `{ version, sql, columns? }` con solo `CREATE TABLE IF NOT EXISTS <id>_…` e `CREATE [UNIQUE] INDEX IF NOT EXISTS <id>_… ON <id>_…`. **Un modulo con tabelle ha un id di sole minuscole e cifre** (`^[a-z][a-z0-9]*$`), perché `<id>_` è il prefisso dei nomi SQL: con l'id `mio-modulo` le tabelle sono rifiutate. Le controlla `src/module-tables.js`; le regole complete sono in [Le tabelle di un modulo](moduli.md#le-tabelle-di-un-modulo). Si scrive con `ctx.writer.statement(sql).run(…)` e `ctx.writer.tx(fn)` (fn sincrona): solo `INSERT` e `UPDATE` sulle proprie tabelle, mai `DELETE` né `REPLACE` ([Scrivere sulle proprie tabelle](moduli.md#scrivere-sulle-proprie-tabelle)). Le tabelle non si cancellano mai, nemmeno spegnendo il modulo.

**Leggere il database** (anche i dati di OpenCode): `ctx.reader.get(sql, …valori)` e `ctx.reader.all(sql, …valori)`, solo `SELECT` e `WITH … SELECT`, un'istruzione sola. Nel testo SQL **solo costanti**: i valori vanno come parametri `?`, le liste come un parametro JSON (`IN (SELECT value FROM json_each(?))`). Al più 256 testi SQL diversi per modulo. Le regole sono in [Leggere il database](moduli.md#leggere-il-database-ctxreader).

**Mai**: `ctx.store` per i tuoi dati, file scritti fuori dalla cartella dei dati senza dichiararli, `node:sqlite` aperto a mano sul database della lens.

## Pagina del browser

La pagina è il file `public/page.js` più `public/page.html` (e, se serve, `public/style.css`). La lens li carica solo per un modulo acceso (`loadModulePage` di `public/app.js`, `src/module-html.js`).

- **`page.js`** esporta `title` (il titolo, `t("…")`) e `page`, una pagina del director (`createDirector` di `public/kit.js`): `{ id, refreshMs?, setup?(ctx), show?(ctx), refresh?(ctx), hide?(ctx) }`. `page.id` è l'id del modulo, altrimenti la pagina non si carica. `setup` gira una volta e riceve `report(err)`, che mostra un errore nel banner; `show` gira quando la pagina si apre; `refresh` ogni `refreshMs` mentre è a schermo.
- **`page.html`** è una `<section class="page-view hidden" id="view-<id>">`. Niente attributi `style` né `<script>`: la CSP della pagina li blocca. I testi sono italiani con `data-i18n` (o `data-i18n-placeholder`, `data-i18n-aria-label`). Gli id HTML sono condivisi con tutta la dashboard: mettici un prefisso (il modulo d'esempio usa `mm-`). Nella barra del titolo (sotto), `data-ico="<id>"` copia l'icona del menu.
- **Importa dalla lens solo `"/module-kit.js"`** (`public/module-kit.js`): `t`, `tn`, `N_`, `el`, `$`, `get`, `send`, `table`, `stateBox`, i formattatori (`fmtDateTime`, `nf`, `money`, `dur`…), gli aiuti per i piccoli grafici (sotto) e pochi altri. Il resto con percorsi relativi, dentro `public/`.
- **I piccoli grafici** (`public/spark.js` e `public/ui.js`, dal kit), ognuno restituisce un elemento da mettere nel DOM:
  - `barSpark(valori, serie, { highlightLast, title, label })`: un `<svg class="spark">` a barre (`viewBox` 120×30). `serie` è il colore, da `1` a `7` o `"other"`; le ultime `highlightLast` barre (7 di default) sono piene, le altre attenuate; `title(valore, indice)` dà il testo al passaggio del mouse; `label` è l'`aria-label`.
  - `sparkSvg(w, h, label)`: un `<svg class="spark">` vuoto, su cui disegnare con `svg(tag, attributi)` (un elemento SVG con quegli attributi).
  - `ring(rapporto, etichetta, { size, stroke, title })`: un anello pieno fino a `rapporto` (al più 1), con `etichetta` in mezzo; verde, ambra oltre 0,85, rosso oltre 1.
  - `facts(box, [[etichetta, valore, mono], …])`: riempie una striscia di fatti (`box` è un id o un elemento; le voci `null` o `false` si saltano, un valore mancante è «–», `mono` lo scrive a spaziatura fissa). `ago(ms)`: il tempo passato, «5 min fa» (`mai` senza data).
  - `barSpark`, `sparkSvg`, `ring` e `svg` usano `document.createElementNS`: il DOM finto dei test del modulo deve averlo. Quello del modulo d'esempio ha solo `createElement` e `createTextNode`: aggiungilo prima di provare un widget o una pagina che disegna un grafico.

**La barra del titolo** di `page.html`, con un'azione e una striscia di fatti (come in `modules/skill/public/page.html`):

```html
<header class="topbar">
  <div class="tb-row">
    <div class="slot s-ident">
      <span class="tb-ico" data-ico="mio-modulo" aria-hidden="true"></span>
      <div class="tb-title">
        <h1 id="mm-title" data-i18n>Il mio modulo</h1>
        <p class="ctx" data-i18n>Un blocco di note, per vedere come è fatto un modulo</p>
      </div>
    </div>
    <span class="spacer"></span>
    <div class="slot s-actions">
      <button class="primary" type="button" id="mm-scan" data-i18n>Scansiona</button>
      <button class="ghost" type="button" id="mm-export" data-i18n>Esporta…</button>
    </div>
    <div class="slot s-action"></div>
  </div>
</header>
<div class="view-body">
  <div class="facts" id="mm-facts"></div>
  …
</div>
```

I pulsanti d'azione stanno nello slot `s-actions`: `primary` per l'azione principale, `ghost` per le altre. La striscia di fatti è un `<div class="facts">` che `page.js` riempie con `facts("mm-facts", [[t("Ultima scansione"), ago(d.at)], [t("Cartella"), d.dir, true]])`. `mm-scan`, `mm-export` e `mm-facts` sono esempi: il modulo d'esempio non li ha.
- **Leggi con `get(percorso)` e scrivi con `send(percorso, corpo)`**, mai con un `fetch` grezzo: mandano la lingua, `get` ha un tempo massimo di 30 secondi, e lanciano su uno stato di errore. `send` lancia un `Error` con `errors`, i testi del rifiuto del server.
- **Mai `innerHTML` con dati**: ciò che viene dal server o da un file va nel DOM con `el(tag, { text })` o `textContent`.
- **Niente lavoro all'import** (né DOM né timer): i test importano la pagina senza DOM.
- **Una scrittura alla volta**: spegni il campo e il pulsante mentre `send` è in corso, e non lasciare che un `refresh` arrivato nel frattempo li riaccenda (il modulo d'esempio tiene un flag `saving`).

Il cuore di `page.js` del modulo d'esempio:

```js
import { $, el, fmtDateTime, get, send, stateBox, t, table } from "/module-kit.js";

const API = "/api/mio-modulo";
export const title = t("Il mio modulo");

function draw(d) {
  $("mm-welcome").textContent = d.note || t("Nessuna nota di benvenuto: scrivila da Impostazioni › Moduli.");
  $("mm-list").replaceChildren(
    d.notes.length
      ? table([t("Quando"), t("Nota")], d.notes.map((n) => el("tr", {}, el("td", { text: fmtDateTime(n.at) }), el("td", { class: "key", text: n.text }))))
      : stateBox("empty", t("Nessuna nota ancora: scrivine una qui sopra.")),
  );
}

async function refresh() {
  draw(await get(API));
}

export const page = { id: "mio-modulo", refreshMs: 30_000, setup, show: refresh, refresh };
```

**I cataloghi.** `public/lang-en.js` e `public/lang-fr.js` esportano per default un oggetto `{ "testo italiano": "traduzione" }`, con le stesse chiavi; un plurale (`tn`) ha la chiave della forma «molti» e il valore `{ one, other }`. La chiave è il testo italiano esatto di `t("…")`, `N_("…")`, `Localized("…")`, `data-i18n` e dei testi del manifesto. Un testo che il nucleo traduce già (`Salva`, `Annulla`…) non serve: nei test, `catalogs({ en, fr })` del test kit dà i cataloghi del nucleo con quelli del modulo, come li carica la dashboard (il test «lang-en.js e lang-fr.js» del modulo d'esempio li usa così). Le regole sono in [traduzioni.md](traduzioni.md).

## Widget della dashboard

Un widget del modulo compare in **Personalizza › Aggiungi** accanto a quelli del nucleo, si sposta, si ridimensiona e ha il suo ⚙. Il manifesto ha `widgets` e `widgetsFile`, giudicati da `widgetFieldsError` di `src/module-widget-fields.js`.

**Ogni voce di `widgets`:**

- `type`: `<id>-<nome>` (`mio-modulo-conteggio`), tutto in `^[a-z][a-z0-9-]*$`, al più 31 caratteri; non un tipo del nucleo né di un altro modulo (elenco «Tipi di widget già presi»), non ripetuto.
- `label` e `description`: testi italiani non vuoti, con voce nei cataloghi.
- `size` e `min`: `[larghezza, altezza]` interi, larghezza da 1 a 12 colonne, altezza da 1 a 40 righe, `min` mai più grande di `size`.
- `home`: dove l'editor lo propone, `"adesso"`, `"analisi"` o `"both"`. Mai nella vista Monitor.
- `settings` (facoltativo): le scelte del ⚙. `title: null` rende il titolo modificabile. `range` offre i periodi della dashboard, solo fra `"dashboard"` (segue la vista), `"day"`, `"3600000"`, `"28800000"`, `"86400000"`, `"604800000"`, `"2592000000"` e `"0"` («tutto»). Ogni altra chiave è tua: comincia con una minuscola, solo lettere e cifre, e non è una chiave dei widget del nucleo (`metric`, `by`, `source`, `model`, `sort`, `style`…); il valore è un elenco da 1 a 20 testi distinti non vuoti, senza `"dashboard"`. Il ⚙ mostra la chiave come `t(chiave)` e ogni valore come `t(valore)`: scrivi chiave e valori come parole italiane e mettile nei cataloghi.
- `data`: da 1 a 4 percorsi che il widget legge, ognuno una route `GET` **del modulo stesso** (la query a parte), che comincia con `/api/`, senza `..`, `#`, spazi né `%2e`/`%2f`/`%5c`, con al più un segnaposto `{from}` e nessun'altra graffa. `{from}` è facoltativo: se il widget ha un periodo, mettilo nella query, `"/api/mio-modulo?from={from}"`; un widget senza periodo legge `"/api/<id>"` e non offre `range`.

**I limiti**, gli stessi che `lens_module_guide` dà in «Limiti dei widget» (`WIDGET_LIMITS` di `src/module-widget-fields.js`, `widgetLimits` di `GET /api/modules/authoring`):

| Limite | Valore | |
|---|---|---|
| `maxWidgets` | 12 | voci di `widgets` |
| `maxDataPaths` | 4 | percorsi di `data` per widget |
| `maxValues` | 20 | valori di una chiave di `settings` |
| `maxWidth` | 12 | larghezza di `size` e `min`, in colonne |
| `maxHeight` | 40 | altezza di `size` e `min`, in righe |
| `maxTypeLength` | 31 | caratteri di `type` |
| `fromPlaceholder` | `{from}` | l'unico segnaposto di `data` |
| `homes` | `adesso`, `analisi`, `both` | i valori di `home` |

**`{from}`** diventa l'inizio del periodo del widget: `day` per il giorno di budget, altrimenti millisecondi, `0` per «tutto». Il periodo è quello del ⚙ o, con `dashboard`, quello della vista. La route lo legge con `ctx.range` (vedi [Route GET e POST](#route-get-e-post)). All'avvio un widget con un percorso che non è una route `GET` del modulo è scartato, e al suo posto la dashboard dice quale percorso non va; `lens_module_check` non lo vede.

**Il file dei widget** (`widgetsFile`) esporta per default un oggetto con un disegnatore per tipo, `export default { "<type>": { mount, update, resize? } }`, e importa dalla lens solo `"/module-kit.js"`:

```js
import { el, full, tn, t } from "/module-kit.js";

const DATA = "/api/mio-modulo?from={from}";

const conteggio = {
  mount(root, ctx) {
    root.replaceChildren(
      el("div", { class: "card-head" }, el("div", { class: "head-text" }, el("h2", {}, el("span", { "data-part": "title", text: ctx.title })))),
      el("div", { class: "kpi-main" }, el("span", { class: "kpi-value", "data-part": "value", text: "–" })),
      el("div", { class: "kpi-label", "data-part": "label" }),
      el("div", { class: "kpi-note", "data-part": "note" }),
    );
  },
  update(root, ctx) {
    const d = ctx.data(DATA);
    const count = d?.count ?? 0;
    root.querySelector('[data-part="value"]').textContent = full(count);
    root.querySelector('[data-part="label"]').textContent = tn(count, "nota nel periodo", "note nel periodo");
    root.querySelector('[data-part="note"]').textContent = d?.last?.text ?? t("Nessuna nota nel periodo");
  },
};

export default { "mio-modulo-conteggio": conteggio };
```

- **`mount(root, ctx)`** gira una volta, a riquadro vuoto: costruisce il markup. Disegna un elemento con `data-part="title"`: la dashboard ne riscrive il testo quando il titolo cambia.
- **`update(root, ctx)`** gira a ogni aggiornamento della dashboard, quando tutti i percorsi di `data` sono arrivati.
- **`resize`** è facoltativo: se c'è (una funzione), la dashboard osserva la misura del riquadro e, quando cambia, richiama `update`. La funzione stessa non viene chiamata.
- **Il `ctx` del widget** (`widgetContext` di `public/module-widgets.js`) è congelato e ha solo `{ widget, title, settings, data, inst }`: `widget` è il widget salvato (`id`, `type`, posizione, `settings`); `title` il titolo già deciso (quello dell'utente o la `label`); `settings` le scelte del ⚙ più `range`, `metric` e `by` già risolti, con quelli della vista quando il widget la segue (`range` è `"day"` o millisecondi, `0` = «tutto»); una tua chiave mai scelta è `undefined`, e il valore predefinito lo sceglie il codice (`ctx.settings.modo ?? "primo"`); `data(percorso)` il JSON di un percorso di `data`, scritto **uguale al manifesto** (con `{from}`), `undefined` per ogni altro; `inst` un oggetto tuo che dura quanto il riquadro, per tenere uno stato.
- **Non modificare** `ctx.settings`, `ctx.widget` né i dati: il congelamento è di un livello solo e gli oggetti sono condivisi con gli altri riquadri.
- **Niente timer né letture tue** (`setInterval`, `setTimeout`, `fetch`): la dashboard legge i dati e chiama `update`. Per aggiornare subito i widget dopo una scrittura, la route chiama `ctx.live.changed(…)`.
- **Mai `innerHTML` con dati**: `el(…, { text })` o `textContent`. Usa le classi del nucleo (`card-head`, `kpi-value`…) e i token di colore (`--border`, `--text-primary`…).

**Quando non si disegna** (`public/module-widgets.js`, `public/dashboard-grid.js`):

- Il file dei widget si carica solo per un modulo acceso, entro **5 secondi** (`LOAD_TIMEOUT_MS`): un errore di sintassi, un 404, un ritardo o un tipo senza `mount` e `update` lasciano «Widget del modulo {name} non caricato» nei suoi riquadri, con l'errore nella console. La dashboard e gli altri moduli vanno avanti.
- Un `mount` o un `update` che lancia mostra «Dati non disponibili» in quel riquadro, con il messaggio nel tooltip; dopo un `mount` fallito si ricarica la pagina.
- Con il modulo spento, in errore o da configurare il widget **resta nella disposizione salvata** e al suo posto dice «Il modulo {name} è spento: attivalo da Impostazioni › Moduli», «Il modulo {name} è in errore: vedi Impostazioni › Moduli» o «Il modulo {name} è da configurare: vedi Impostazioni › Moduli», senza richieste. Riacceso, torna com'era. Vale anche per un modulo il cui manifesto non si carica (un `widgets` sbagliato, un `lens` più recente della lens che gira, un `module.js` che lancia): non c'è un manifesto da cui leggere il nome, e al posto di `{name}` c'è l'id del modulo.
- Nella disposizione i widget dei moduli sono **ostacoli fissi**: quelli del nucleo scorrono attorno, «Compatta» non li fa salire; si spostano solo a mano.

## MCP del modulo

Facoltativo. Un modulo può offrire strumenti al server MCP della lens, che OpenCode mostra con il prefisso `lens_` (lo strumento `note` diventerebbe `lens_note`). Le regole: `src/module-mcp-fields.js` e `src/mcp/modules.js`; i dettagli in [Gli strumenti MCP di un modulo](moduli.md#gli-strumenti-mcp-di-un-modulo).

- Il manifesto dichiara `mcp: () => import("./mcp/tools.js")` e `mcpTools: ["<nome>"]`; un nome già preso (elenco «Nomi di strumenti MCP già presi», compresi `module_guide` e `module_check`) è scartato, e `lens_module_check` lo dà come errore.
- `mcp/tools.js` **non importa niente**: esporta `tools(kit)`, che restituisce `[{ name, title, description, inputSchema, run(args, ctx) }]`. Tutto arriva da `kit` (`createToolKit` di `src/mcp/module-kit.js`): `argSpec`, `withLens`, `ToolError`, `LensError`, `SINCE`, `now`, `text` (`cleanName`, `cleanText`, `num`, `plural`…).
- **`kit.argSpec({ … })`** dà `{ inputSchema, parse(args) }`. Ogni argomento ha `description` e uno fra `enum: [...]`, `int: [min, max]`, `bool: true` o niente (un testo non vuoto); in più `default`, `required: true` (manca → errore), e per un testo `pattern` (un'espressione regolare, come testo) con `hint` (la frase che l'errore mostra al posto dell'espressione). `parse` rifiuta gli argomenti sconosciuti.
- Lo strumento parla con la lens **solo via HTTP**, con le route del modulo: `return withLens(signal, async (lens) => { const d = await lens.get("/api/mio-modulo", {}, signal); return "…"; })`. I testi che arrivano al modello sono in italiano e non si traducono.
- **OpenCode non rilegge l'elenco degli strumenti**: uno strumento nuovo, o di un modulo appena acceso, compare solo dopo un **riavvio di OpenCode**. Uno strumento di un modulo spento risponde «Il modulo … è spento in Lens».

## Lavoro lungo

- **Mai bloccare il processo**: la lens serve la dashboard e l'MCP dallo stesso thread. Una lettura di molti file, una scansione di cartelle, un calcolo lungo vanno a pezzi, con API asincrone (`node:fs/promises`) e pause (`await new Promise((r) => setImmediate(r))`) fra un pezzo e l'altro.
- **Metti dei limiti** a tutto ciò che legge da fuori: numero di file, dimensione di un file, profondità, tempo totale. Oltre il limite fermati e dillo (un campo nella risposta, un avviso nel log), non continuare.
- **`start()` ha 10 secondi** (`START_TIMEOUT_MS` di `src/modules.js`): un `start()` asincrono che non finisce in tempo manda il modulo in `error`, e la lens chiama `stop()`. Il tempo massimo non ferma codice sincrono. Il lavoro pesante si pianifica (`setTimeout(…, 0)`) e `start()` torna subito.
- **Un lavoro periodico** si avvia in `start()` (un `setInterval`) e si ferma in `stop()` (`clearInterval`): `stop()` è chiamata allo spegnimento e al riavvio. Dopo aver aggiornato i dati, `ctx.live.changed(…)` fa rileggere i widget a schermo.
- **`stop()` chiude tutto ciò che il modulo ha aperto**, in `start()` o in una route: ogni timer, watcher, sottoscrizione o socket, e il lavoro avviato da una richiesta (una scansione partita da una `POST`). La lens chiama `stop()` per ogni modulo acceso allo spegnimento e al riavvio, anche se non ha `start()` (`stop()` di `ModuleRegistry`, `src/modules.js`). Non cancella né tronca mai i dati del modulo: spegnere un modulo non è disinstallarlo. Le route e `families()` esistono solo mentre il modulo è acceso.
- **Una route non aspetta un lavoro lungo**: risponde con l'ultimo risultato pronto, o avvia il lavoro e risponde subito, e una `GET` successiva ne legge l'avanzamento. Può aspettare (`await`) un lavoro limitato che non blocca: una scansione con un tempo massimo di pochi secondi, a pezzi con `setImmediate`, ben sotto i 30 secondi dopo cui `get` della pagina rinuncia.
- **Le metriche** (`families()`) sono una lettura veloce di ciò che il modulo ha già: `[{ name, type: "gauge", help, samples: [{ labels, value }] }]`, con `name` `opencode_lens_<id con _>_…` ed etichette dai valori limitati (come `modules/security/server/audit.js`). Una metrica senza etichette ha `labels: {}` (come `opencode_lens_bob_up` di `modules/bob/server/source.js`).

## Verifica

Dopo ogni modifica, in quest'ordine.

1. **`lens_module_check` con `id`** (`POST /api/modules/check`, `checkUserModule` di `src/modules.js`). Giudica il modulo della cartella dell'utente come all'avvio, senza attivarlo: manifesto, widget, tabelle, `configure` con l'ambiente attuale della lens (dove la variabile di un modulo nuovo non c'è ancora: il vuoto deve essere valido), nomi già presi. Funziona anche su un modulo che la lens non ha ancora scoperto, e rilegge `module.js`, `tables.js` (se il manifesto ha `tables`) e `server/index.js` a ogni chiamata; gli altri file che `server/index.js` importa restano quelli caricati la prima volta, fino al riavvio della lens. **Non è una lettura**: esegue il codice di primo livello di quei file, e `configure()`, nel processo della lens (per questo `server/index.js` non deve avere effetti all'import). Risponde «OK» oppure gli errori: correggi e richiama finché è «OK». Gli **avvisi** sotto un «OK» sono promemoria, non errori: che il codice viene eseguito a ogni controllo, che le route e i percorsi `data` dei widget si verificano solo all'avvio, che il modulo non è ancora tra quelli scoperti (riavvia la lens) o che è già caricato (le modifiche valgono dopo un riavvio della lens), che `widgetsFile` manca in `public/`, che un tipo di widget comincia con l'id di un altro modulo, che una variabile, un tipo di widget o uno strumento MCP del modulo è già di un modulo che viene dopo per id (al riavvio quel modulo andrebbe in errore, o perderebbe lo strumento). Gli ultimi tre vanno risolti.
2. **Riavvia la lens** (`opencode-lens service restart`), che scopre i moduli solo all'avvio. Il log (`~/Library/Logs/opencode-lens/lens.log` su macOS) dice le route e i widget scartati.
3. **Impostazioni › Moduli** › la scheda del modulo (etichetta «tuo» e la cartella) › *Attiva*: la lens si riavvia con il modulo acceso. Se `configure` rifiuta il valore dei campi (anche vuoti), *Attiva* non si salva e la pagina mostra gli errori. Se lo stato è `error` o `unconfigured`, la scheda dice perché. Controlla la voce di menu, la pagina, il widget in **Personalizza › Aggiungi** e, se ci sono, gli strumenti MCP dopo un riavvio di OpenCode.
4. **I test del modulo**, nella sua cartella `test/` (il modulo d'esempio ne ha uno completo: `test/template.test.js`). Importano dalla lens solo `"/module-test-kit.js"` (e `"/module-kit.js"` per il codice del browser), che risolve `test/module-hooks.mjs` dell'app:

   ```bash
   # <app> è ~/Applications/opencode-lens (o una copia del repository della lens)
   node --disable-warning=ExperimentalWarning --import <app>/test/module-hooks.mjs --test "<cartella dei moduli>/mio-modulo/test/"*.test.js
   ```

   Il test kit vuole Node 22.13 o successivo, come la lens. Se il Node l'ha scaricato `install.sh`, al posto di `node` usa `~/Applications/opencode-lens/node/bin/node`.

   `"/module-test-kit.js"` dà `memoryStore()` e `moduleContext(…)` (un `ctx` vero su un database in memoria), `Queries`, `createToolKit` e `createHandler` per gli strumenti MCP, `widgetContext(spec, ctx)`, il `ctx` congelato che la dashboard passa a `mount` e `update`, e `catalogs({ en, fr })`, i cataloghi del nucleo con quelli del modulo. L'elenco completo è in [Provare un modulo](moduli.md#provare-un-modulo). Prova almeno: il manifesto, `configure` (valore vuoto, valido, sbagliato), ogni route (anche i rifiuti di una `POST`), il file JSON (illeggibile → vuoto), il widget con `widgetContext`, la pagina, i cataloghi (ogni testo tradotto, dal modulo o dal nucleo; nessuna voce orfana) e gli import.

   Il test kit non dà il `ctx` di `configure` (`{ id, env, paths, i18n }`): costruiscilo con `paths` e `i18n` di un `ctx` di `moduleContext`, come il modulo d'esempio (il suo `setup()` fa il `ctx` con `moduleContext`):

   ```js
   const { ctx } = setup();
   const given = (env) => configure({ id: ID, env, paths: ctx.paths, i18n: ctx.i18n });
   assert.deepEqual(given({}), { values: { note: "" }, errors: [] });
   ```

## Aggiornare un modulo

- **Sullo stesso computer** modifichi i file nella cartella dei moduli dell'utente e rifai la [Verifica](#verifica): `lens_module_check`, riavvio, test.
- **Da uno zip** (un modulo scritto altrove, o la versione nuova di un modulo che hai già): comprimi la cartella del modulo, non il suo contenuto, così nello zip c'è `<id>/module.js`; più moduli vanno nello stesso zip, una cartella ciascuno, niente file alla radice. Caricalo in **Impostazioni › Aggiornamento** (`src/module-update.js`); serve `LENS_TOKEN` impostato, altrimenti la lens risponde 403.
- **L'anteprima** non esegue niente del modulo: dice solo se è nuovo o se sostituisce quello installato, e avvisa che è codice non firmato. Un id di un modulo della lens è rifiutato.
- **Installa**, dopo la conferma, giudica prima ogni modulo con lo stesso controllo di `lens_module_check` (quindi ne esegue il codice di primo livello e `configure()`). Un modulo con errori blocca tutto lo zip, non si installa niente e la sezione mostra gli errori di ogni modulo: correggi e carica di nuovo lo zip. Fai passare `lens_module_check` prima di comprimere.
- **Poi** mette la cartella vecchia in `<cartella dei moduli>/.backup/<id>-<data>/` e la nuova al suo posto con un `rename`: mai un modulo a metà, e tutto o niente (se uno scambio non riesce, i moduli già sostituiti tornano com'erano). Se il modulo era un link simbolico a una copia di lavoro, in `.backup/` va il link e la copia di lavoro resta com'è, ma da lì il modulo non è più un link. I file del modulo nella cartella dei dati (`files()`, `ctx.jsonStore`, le tabelle) non si toccano.
- **Infine** la lens si riavvia da sola se gira come servizio, altrimenti riavviala tu. Un modulo già acceso resta acceso; uno nuovo si attiva da **Impostazioni › Moduli**. Gli strumenti MCP cambiati compaiono dopo un riavvio di OpenCode.

## Checklist

- [ ] La cartella è `<cartella dei moduli dell'utente>/<id>/`, non dentro `~/Applications/opencode-lens`.
- [ ] L'id è lo stesso in cartella, `id`, `page.id`, `view-<id>`, prefisso dei percorsi `/api/<id>` e dei tipi di widget; non è già preso né riservato.
- [ ] `module.js` non ha import; `server/index.js` non fa niente all'import ed esporta `create`.
- [ ] `lens` è la versione che dà `lens_module_guide`, non una più nuova.
- [ ] Ogni impostazione ha `LENS_<ID>_…`, `label`, `help`, `kind`, ed è letta da `configure`, che restituisce `{ values, errors }` e accetta il valore vuoto.
- [ ] Ogni file scritto è dichiarato in `files()`; i percorsi solo letti hanno `kind: "read"`.
- [ ] I dati stanno in `ctx.jsonStore` o in `tables`, mai in `ctx.store`; con `tables` l'id ha solo minuscole e cifre.
- [ ] Ogni `POST` ha `body: { type: "json", max }` e `what` con `N_`; ogni rifiuto passa da `ctx.reply`.
- [ ] Il browser importa solo `"/module-kit.js"`, legge con `get`, scrive con `send`, mette i dati con `text`/`textContent`.
- [ ] Ogni widget legge solo route `GET` del modulo, ha `data-part="title"`, nessun timer, e non modifica il `ctx`.
- [ ] Ogni testo italiano ha la sua voce in `lang-en.js` e `lang-fr.js`, con le stesse chiavi.
- [ ] Nessun lavoro lungo blocca il processo; ogni lettura da fuori ha dei limiti.
- [ ] `lens_module_check` dice OK; dopo il riavvio e *Attiva* lo stato è `on`; i test del modulo passano.

## Errori tipici

Gli errori che fa chi scrive un modulo leggendo solo la documentazione, e la correzione.

1. **Il modulo nella cartella dell'app** (`~/Applications/opencode-lens/modules/`): sparisce al primo aggiornamento. Va nella cartella dei moduli dell'utente (vedi [Dove salvare il modulo](#dove-salvare-il-modulo)).
2. **Un'impostazione letta da `process.env`, o senza `configure`**: `ctx.settings` resta `{}` e la variabile non arriva mai. Dichiara la variabile in `settings` (`kind: "text"` per un elenco di percorsi, separati da `:`), leggila in `configure(ctx)` da `ctx.env`, accetta il valore vuoto (un default o «non configurato»: altrimenti `lens_module_check` non dice mai «OK» e *Attiva* è rifiutato), per il resto solo valori validi (per i percorsi: assoluti), e restituisci `{ values, errors }`.
3. **I dati in `ctx.store`**: sono i contatori della lens, non un deposito. Usa `ctx.jsonStore({ name, validate, empty, what })` in una variabile del modulo e dichiara il file in `files()`, insieme alle cartelle che il modulo legge soltanto (`kind: "read"`).
4. **Una `POST` senza corpo dichiarato, o con un tipo inventato** (`body: { type: "empty" }`): la route è scartata. Serve `body: { type: "json", max }` e una `what` con `N_` nudo.
5. **La pagina con `fetch` grezzo, `innerHTML` o import dalla lens fuori dal kit**: usa `page` e `title`, solo `"/module-kit.js"` (`get`, `send`, `el`, `table`…), e il testo dei dati come testo.
6. **Una scansione senza limiti, nel thread della lens**: la dashboard si blocca. Metti limiti a numero e dimensione dei file e al tempo, e lavora a pezzi senza bloccare (vedi [Lavoro lungo](#lavoro-lungo)).
7. **`families()` con una forma inventata**: le metriche sono `[{ name, type, help, samples: [{ labels, value }] }]`, come in `modules/security/server/audit.js`.
8. **Un widget che legge qualcosa di diverso dalle proprie route, o che si aggiorna da solo**: `data` elenca route `GET` del modulo stesso, con `{from}` nella query se il widget ha un periodo; `update` disegna ciò che la dashboard ha letto, senza timer.
9. **Nessun test, o test che importano la lens per percorso**: i test importano `"/module-test-kit.js"` e girano con `--import <app>/test/module-hooks.mjs` (vedi [Verifica](#verifica)).

Altri errori frequenti: un `create` `async` (restituisce una promessa: `error`); un `widgetsFile` che non è in `public/`; un tipo di widget senza il prefisso `<id>-`; una chiave del ⚙ che è una chiave del nucleo (`metric`, `by`…); `t` chiamato come `ctx.i18n.t("…")` (il testo resta senza traduzione); un `ctx.data` chiesto con il percorso già risolto in un altro modo da quello del manifesto.
