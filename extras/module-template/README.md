# Modulo d'esempio

Un modulo completo e piccolo da copiare per scrivere il tuo: un blocco di note con la sua pagina, un widget per la dashboard, un'impostazione e un file di dati. Ogni file è commentato per chi lo copia.

## Come usarlo

1. Copia questa cartella nella cartella dei moduli dell'utente, accanto al database, con il nome dell'id (`mio-modulo`):

   | Dove gira | Cartella |
   |---|---|
   | macOS | `~/Library/Application Support/opencode-lens/modules/mio-modulo/` |
   | Linux | `$XDG_DATA_HOME/opencode-lens/modules/mio-modulo/` (di default `~/.local/share/opencode-lens/modules/mio-modulo/`) |
   | `LENS_DB` impostata | la cartella `modules/` accanto al file del database |

   ```bash
   cp -R ~/Applications/opencode-lens/extras/module-template "$HOME/Library/Application Support/opencode-lens/modules/mio-modulo"
   ```

2. Riavvia la lens: cerca i moduli solo all'avvio.
3. Attiva **Il mio modulo** da **Impostazioni › Moduli**. Compaiono la voce di menu *Il mio modulo*, la pagina e, in **Personalizza › Aggiungi**, il widget *Note del mio modulo*.

Per farne il tuo, cambia l'id (`mio-modulo`) nella cartella, in `module.js`, nei percorsi `/api/mio-modulo`, nel tipo del widget e nei test. L'id è fatto di minuscole, cifre e trattino, e comincia con una lettera.

## Cosa c'è dentro

| File | A cosa serve |
|---|---|
| `module.js` | il manifesto: id, nome, menu, impostazioni e widget. Nessun import |
| `server/index.js` | il lato Node: `configure` (legge `LENS_MIO_MODULO_NOTE`), `files`, `create` con le route `GET` e `POST /api/mio-modulo` |
| `public/page.js`, `page.html`, `style.css` | la pagina: elenco e form delle note |
| `public/widgets.js` | il widget `mio-modulo-conteggio`: quante note nel periodo, e l'ultima |
| `public/lang-en.js`, `lang-fr.js` | le traduzioni dei testi italiani del modulo |
| `test/template.test.js` | i test del modulo |

Un modulo gira nel processo della lens, con i suoi permessi, e non ha sandbox: mettici solo codice che hai scritto o letto tu. Come scrivere un modulo passo per passo, con la verifica e gli errori tipici, è in [docs/moduli-custom.md](../../docs/moduli-custom.md) (la stessa guida che dà lo strumento MCP `lens_module_guide`); le regole complete, il `ctx` e tutti i campi del manifesto sono in [docs/moduli.md](../../docs/moduli.md).

## Provarlo

I test importano `/module-test-kit.js` e il codice del browser `/module-kit.js`: li risolve `test/module-hooks.mjs`, che sta nel repository della lens e nell'app installata (`~/Applications/opencode-lens/test/`, insieme al test kit e ai file che importa; il resto di `test/` no). Dal repository:

```bash
# i test di questo esempio, dalla cartella del repository (li lancia anche npm test)
node --disable-warning=ExperimentalWarning --import ./test/module-hooks.mjs --test extras/module-template/test/template.test.js

# i test del modulo copiato (<app> è il repository o ~/Applications/opencode-lens)
node --disable-warning=ExperimentalWarning --import <app>/test/module-hooks.mjs --test <cartella dei moduli>/mio-modulo/test/template.test.js
```

Il test kit vuole Node 22.13 o successivo, come la lens. Se il Node l'ha scaricato `install.sh`, al posto di `node` usa `~/Applications/opencode-lens/node/bin/node`.
