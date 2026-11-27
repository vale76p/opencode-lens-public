# Translations

🌐 [Italiano](../traduzioni.md) · English · [Français](../fr/traduzioni.md)

The dashboard is in Italian, English and French. Italian is the base language: in the code `t("Italian text")` looks up the translation in `public/lang-en.js` and `public/lang-fr.js` and, if it is missing, shows the Italian. Language and format of dates, times and numbers are chosen in **Settings › Language and format** (`LENS_LANG`, `LENS_LOCALE`), “Automatic” or forced.

## How to add or change a text

- One text = one string with placeholders: `t("Ultimi {n} giorni", { n })`, never concatenated pieces. Each language orders the words its own way.
- Plurals: `tn(n, "1 sessione", "{n} sessioni")`. The catalog entry is `{ one, other }`; in French zero is singular.
- Label tables: `N_("Text")` marks the text, `t(variable)` translates it later.
- The same Italian text with two meanings: `tc("context", "Text")` and in the catalog the key `context\u0004Text`.
- Static page (`index.html`): `data-i18n` (text), `data-i18n-html` (text with `<code>` or `<a>`), `data-i18n-<attribute>` (`title`, `aria-label`, `placeholder`, `data-label`), `data-i18n-ctx` for the context.
- If you change an Italian word, change the key in `lang-en.js` and `lang-fr.js` too: `npm test` flags it (no text without a translation, no orphan entry, same placeholders and same markup).
- Never `t()` at the top level of `src/` or of `public/layout.js`: they are shared with the server, which picks the language for each request (`X-Lens-Lang`).

## Changelog, README and documents

- `CHANGELOG.md` (Italian) is the source written by release-please. Each version is translated by hand into `CHANGELOG.en.md` and `CHANGELOG.fr.md`, in the same release PR, with the same format (section titles: Added/Fixed/Changed/Documentation in English, Ajouté/Corrigé/Modifié/Documentation in French). The translation is done before the release PR is merged: the tests do not block it (on the tag commit the new version exists only in Italian), so a forgotten version stays forgotten. If a version is missing, the **What's new** page shows the Italian one with the label “not translated yet”; `npm run changelog:check` flags it.
- `README.en.md`, `README.fr.md` and the folders `docs/en/` and `docs/fr/` have the same file names as the Italian original. A change to an Italian document must be carried over to the other two languages. `docs/superpowers/` (specs and plans) is not translated.

## Glossary

These stay in English in all languages: token, prompt, cache, budget, step, tool, retry, agent, provider, widget, dashboard, rate limit, timeout, reasoning, streaming, fallback, LaunchAgent, OTLP, MCP, SSE, plist.

The names of the views and of the dashboard layouts are translated: Adesso (Now, Maintenant), Analisi (Analysis, Analyse), Galleria (Gallery, Galerie), Novità (What's new, Nouveautés), Sistema (System, Système), Impostazioni (Settings, Paramètres). “Lens”, “OpenCode” and “Monitor” are not translated.

Register: technical and dry, impersonal sentences or the imperative; in French “vous” only when needed.
