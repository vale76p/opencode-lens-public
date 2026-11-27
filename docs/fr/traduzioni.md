# Traductions

🌐 [Italiano](../traduzioni.md) · [English](../en/traduzioni.md) · Français

Le dashboard est en italien, anglais et français. L'italien est la langue de base : dans le code `t("texte italien")` cherche la traduction dans `public/lang-en.js` et `public/lang-fr.js` et, si elle manque, affiche l'italien. La langue et le format des dates, heures et nombres se choisissent dans **Paramètres › Langue et format** (`LENS_LANG`, `LENS_LOCALE`), « Automatique » ou forcés.

## Comment ajouter ou changer un texte

- Un texte = une chaîne avec des paramètres substituables : `t("Ultimi {n} giorni", { n })`, jamais des morceaux concaténés. Chaque langue ordonne les mots à sa façon.
- Pluriels : `tn(n, "1 sessione", "{n} sessioni")`. L'entrée du catalogue est `{ one, other }` ; en français zéro est singulier.
- Tableaux d'étiquettes : `N_("Texte")` marque le texte, `t(variable)` le traduit plus tard.
- Le même texte italien avec deux sens : `tc("contexte", "Texte")` et dans le catalogue la clé `contexte\u0004Texte`.
- Page statique (`index.html`) : `data-i18n` (texte), `data-i18n-html` (texte avec `<code>` ou `<a>`), `data-i18n-<attribut>` (`title`, `aria-label`, `placeholder`, `data-label`), `data-i18n-ctx` pour le contexte.
- Si vous changez un mot italien, changez aussi la clé dans `lang-en.js` et `lang-fr.js` : `npm test` le signale (aucun texte sans traduction, aucune entrée orpheline, mêmes paramètres substituables et même balisage).
- Jamais de `t()` au niveau supérieur de `src/` ni de `public/layout.js` : ils sont partagés avec le serveur, qui choisit la langue pour chaque requête (`X-Lens-Lang`).

## Changelog, README et documents

- `CHANGELOG.md` (italien) est la source écrite par release-please. Chaque version se traduit à la main dans `CHANGELOG.en.md` et `CHANGELOG.fr.md`, dans la même PR de release, avec le même format (titres de section : Added/Fixed/Changed/Documentation en anglais, Ajouté/Corrigé/Modifié/Documentation en français). La traduction se fait avant le merge de la PR de release : les tests ne la bloquent pas (sur le commit du tag, la nouvelle version n'existe qu'en italien), donc une version oubliée le reste. Si une version manque, la page **Nouveautés** affiche l'italienne avec l'étiquette « pas encore traduit » ; `npm run changelog:check` la signale.
- `README.en.md`, `README.fr.md` et les dossiers `docs/en/` et `docs/fr/` ont les mêmes noms de fichiers que l'original italien. Un changement dans un document italien doit être reporté dans les deux autres langues. `docs/superpowers/` (spécifications et plans) ne se traduit pas.

## Glossaire

Restent en anglais dans toutes les langues : token, prompt, cache, budget, step, tool, retry, agent, provider, widget, dashboard, rate limit, timeout, reasoning, streaming, fallback, LaunchAgent, OTLP, MCP, SSE, plist.

Les noms des vues et des modèles de dashboard se traduisent : Adesso (Now, Maintenant), Analisi (Analysis, Analyse), Galleria (Gallery, Galerie), Novità (What's new, Nouveautés), Sistema (System, Système), Impostazioni (Settings, Paramètres). « Lens », « OpenCode » et « Monitor » ne se traduisent pas.

Registre : technique et sobre, phrases impersonnelles ou à l'impératif ; en français « vous » seulement quand c'est nécessaire.
