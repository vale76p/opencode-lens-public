# Traduzioni

🌐 Italiano · [English](en/traduzioni.md) · [Français](fr/traduzioni.md)

La dashboard è in italiano, inglese e francese. L'italiano è la lingua di base: nel codice `t("testo italiano")` cerca la traduzione in `public/lang-en.js` e `public/lang-fr.js` e, se manca, mostra l'italiano. Lingua e formato di date, ore e numeri si scelgono in **Impostazioni › Lingua e formato** (`LENS_LANG`, `LENS_LOCALE`), «Automatico» o forzati.

## Come si aggiunge o si cambia un testo

- Un testo = una stringa con segnaposto: `t("Ultimi {n} giorni", { n })`, mai pezzi concatenati. Ogni lingua ordina le parole a modo suo.
- Plurali: `tn(n, "1 sessione", "{n} sessioni")`. La voce del catalogo è `{ one, other }`; in francese lo zero è singolare.
- Tabelle di etichette: `N_("Testo")` segna il testo, `t(variabile)` lo traduce più tardi.
- Stesso testo italiano con due significati: `tc("contesto", "Testo")` e nel catalogo la chiave `contesto\u0004Testo`.
- Pagina statica (`index.html`): `data-i18n` (testo), `data-i18n-html` (testo con `<code>` o `<a>`), `data-i18n-<attributo>` (`title`, `aria-label`, `placeholder`, `data-label`), `data-i18n-ctx` per il contesto.
- Se cambi una parola italiana, cambia anche la chiave in `lang-en.js` e `lang-fr.js`: `npm test` lo segnala (nessun testo senza traduzione, nessuna voce orfana, stessi segnaposto e stesso markup).
- Mai `t()` al livello superiore di `src/` né di `public/layout.js`: sono condivisi con il server, che sceglie la lingua per ogni richiesta (`X-Lens-Lang`).

## Changelog, README e documenti

- `CHANGELOG.md` (italiano) è la fonte che scrive release-please. Ogni versione si traduce a mano in `CHANGELOG.en.md` e `CHANGELOG.fr.md`, nella stessa PR di rilascio, con lo stesso formato (titoli di sezione: Added/Fixed/Changed/Documentation in inglese, Ajouté/Corrigé/Modifié/Documentation in francese). La traduzione va fatta prima del merge della PR di rilascio: i test non lo bloccano (sul commit del tag la versione nuova c'è solo in italiano), quindi una versione dimenticata resta tale. Se una versione manca, la pagina **Novità** mostra quella italiana con l'etichetta «non ancora tradotto»; `npm run changelog:check` la segnala.
- `README.en.md`, `README.fr.md` e le cartelle `docs/en/` e `docs/fr/` hanno gli stessi nomi di file dell'originale italiano. Un cambiamento a un documento italiano va riportato nelle altre due lingue. `docs/superpowers/` (specifiche e piani) non si traduce.

## Glossario

Restano in inglese in tutte le lingue: token, prompt, cache, budget, step, tool, retry, agent, provider, widget, dashboard, rate limit, timeout, reasoning, streaming, fallback, LaunchAgent, OTLP, MCP, SSE, plist.

Si traducono i nomi delle viste e dei modelli di dashboard: Adesso (Now, Maintenant), Analisi (Analysis, Analyse), Galleria (Gallery, Galerie), Novità (What's new, Nouveautés), Sistema (System, Système), Impostazioni (Settings, Paramètres). Non si traducono «Lens», «OpenCode» e «Monitor».

Registro: tecnico e asciutto, frasi impersonali o all'imperativo; in francese «vous» solo quando serve.
