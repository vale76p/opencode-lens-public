# OpenCode Lens

🌐 [Italiano](README.md) · [English](README.en.md) · Français

**Version 0.51.1** <!-- x-release-please-version --> · [Nouveautés](CHANGELOG.fr.md) · [Releases](https://github.com/vale76p/opencode-lens-public/releases) · Licence [MIT](LICENSE)

**Observabilité locale pour [OpenCode](https://opencode.ai) V2.** OpenCode Lens se connecte en lecture seule au service OpenCode qui tourne en arrière-plan, compte les tokens, coûts, modèles, outils, erreurs et temps de chaque session, et les montre dans un dashboard sur `http://127.0.0.1:4777`, dans une API JSON et sur `/metrics` pour Prometheus.

Elle répond à des questions comme : *combien ai-je consommé aujourd'hui ? à ce rythme, vais-je dépasser le budget de la semaine ? quel modèle ou quel agent coûte le plus ? pourquoi les requêtes échouent-elles depuis ce matin ?* Les modèles qui travaillent dans OpenCode peuvent poser les mêmes questions grâce au serveur MCP de la lens.

Tout reste sur votre ordinateur : aucun service externe, aucun compte, zéro dépendance npm, aucun build.

## Ce qu'elle fait

- **Budget et consommation du jour.** Tokens, coût et steps du jour face aux budgets que vous choisissez (`LENS_LIMIT_*`, aussi hebdomadaires, mensuels et par modèle), avec la projection en fin de journée, heure par heure, et ce qui reste.
- **Ce que fait OpenCode en ce moment.** Le prompt en cours avec temps, steps, outils, tokens et remplissage du contexte.
- **Analyse d'une période.** Évolution dans le temps, rythme de travail, part par modèle, agent, provider ou type d'agent, cache, latences (p50/p95), les prompts les plus lourds, le calendrier de la dernière année.
- **Prompts et sessions.** Chaque prompt avec résultat, durée, steps, outils et tokens ; chaque session avec ses sous-agents et une timeline des steps et des outils, avec les pauses mises en évidence ; permissions, commits et temps d'attente.
- **Dashboard personnalisable.** Des widgets sur une grille de 12 colonnes à déplacer, redimensionner et configurer, avec gauges, graphiques en colonnes ou en ligne et différents styles ; trois vues (**Maintenant**, **Analyse**, **Monitor** à garder en plein écran) et une **Galerie** de tous les widgets avec les vraies données.
- **Serveur MCP pour OpenCode.** Les modèles peuvent demander à Lens budgets, erreurs agrégées, usage et sessions (« compare cette semaine avec la précédente »).
- **API, Prometheus et OTLP.** Une API JSON locale, `/metrics` avec des compteurs qui ne baissent jamais, et l'export OTLP vers un collecteur OpenTelemetry.
- **Modules facultatifs.** Des pages en plus à activer quand il le faut : Vibe Coding, Système, Sécurité, IBM Bob et Skill, plus ceux que vous écrivez (voir [Modules](#modules)).
- **Extras.** Le plugin OpenCode **lens-guard**, qui passe à un modèle de secours quand le provider a épuisé son quota ou ne répond pas, une app macOS facultative avec le dashboard dans une fenêtre native et, comme projet à part, [OpenCode Lens Monitor](https://github.com/vale76p/opencode-lens-monitor-public), l'app de la barre des menus avec budget, panneau et widgets.

L'interface est en italien, anglais et français : la langue et le format des dates et des nombres suivent le navigateur, ou se choisissent dans les Paramètres.

## Comment elle fonctionne

```
service OpenCode ──SSE (en direct)──┐
  (~/.local/state/opencode/         ├─► collecteur ─► SQLite local ─► dashboard · API JSON · /metrics · MCP
   service.json)  ──backfill ───────┘
```

1. **Découverte.** La lens lit `~/.local/state/opencode/service.json` pour connaître l'adresse et le mot de passe du service OpenCode, et le relit à chaque reconnexion.
2. **En direct et backfill.** Elle écoute le flux d'événements du service et, à intervalles, relit sessions et messages : le message de l'assistant fait foi, donc les chiffres restent exacts même après une déconnexion.
3. **Store.** Chaque écriture est un upsert idempotent par ID dans une base SQLite locale (`node:sqlite`), et les totaux sont rapprochés de ceux d'OpenCode (`npm run verify`).

**Ce qu'elle enregistre et ce qu'elle n'enregistre pas.** Elle enregistre des comptes, des temps et des noms (modèles, agents, outils), les titres des sessions (`LENS_STORE_TITLES=0` les exclut), le dossier de travail de chaque session et les messages d'erreur, expurgés (clés, tokens, home) et tronqués à 500 caractères. Elle **n'enregistre pas** le texte des prompts, les réponses ni la sortie des outils. Elle ne touche pas aux sessions et ne sert pas de proxy à l'API d'OpenCode.

**Sécurité.** Par défaut elle n'écoute que sur `127.0.0.1`, contrôle l'en-tête `Host` et accepte peu d'écritures, seulement depuis cet ordinateur. Pour l'exposer sur le réseau, `LENS_TOKEN` est obligatoire (voir [docs/fr/configurazione.md](docs/fr/configurazione.md#exposition-à-distance)).

Le détail est dans [docs/fr/architettura.md](docs/fr/architettura.md).

## Prérequis

- **OpenCode V2** (`opencode2`), lancé au moins une fois, pour que le service partagé écrive `service.json`. Vérifié sur OpenCode v2.0.26. OpenCode V1 (`opencode`) n'est pas pris en charge : il a une API serveur différente.
- **Node ≥ 22.13** (elle utilise `node:sqlite` intégré). S'il n'y en a pas, `install.sh` télécharge Node 24 LTS dans le dossier de l'app, sans `sudo`.
- **macOS** pour l'installation comme service (launchd). Sous **Linux** la lens se lance à la main.

## Installation

Sous macOS la lens tourne comme service launchd depuis `~/Applications/opencode-lens`. Tout reste dans votre dossier utilisateur, sans `sudo` ni droits d'administrateur.

1. Depuis la [page des releases](https://github.com/vale76p/opencode-lens-public/releases) téléchargez `opencode-lens-<version>.zip` (ou « Source code (zip) » : les deux fonctionnent).
2. Extrayez le zip (double-clic dans le dossier Téléchargements).
3. Dans le Terminal lancez le `install.sh` du dossier extrait : tapez `bash `, faites glisser `install.sh` dans la fenêtre et appuyez sur Entrée. Ou :

   ```bash
   bash ~/Downloads/opencode-lens*/install.sh
   ```

4. Ouvrez `http://127.0.0.1:4777`.

Avec la [GitHub CLI](https://cli.github.com) les étapes 1 à 3 tiennent en une commande :

```bash
D="$(mktemp -d)" && gh release download -R vale76p/opencode-lens-public -p 'opencode-lens-[0-9]*.zip' -D "$D" && unzip -q "$D"/opencode-lens-[0-9]*.zip -d "$D" && bash "$D"/opencode-lens/install.sh
```

`install.sh` enregistre d'abord une copie de la base de données et du plist, copie seulement les fichiers nécessaires, utilise ou télécharge Node (en vérifiant sa somme de contrôle ; derrière un proxy d'entreprise, `LENS_NODE_MIRROR` indique un miroir interne), installe le service, qui démarre tout de suite et à chaque connexion, et attend qu'il réponde. Pour un autre port : `LENS_PORT=4800 bash …/install.sh`. Pour voir ce qui est déjà installé sans rien changer : `bash …/install.sh --check`.

| Quoi | Où |
|---|---|
| app | `~/Applications/opencode-lens` |
| service | `~/Library/LaunchAgents/local.opencode-lens.plist` |
| base de données et disposition du dashboard | `~/Library/Application Support/opencode-lens/` |
| log | `~/Library/Logs/opencode-lens/lens.log` |

**Mettre à jour** : les mêmes étapes avec le nouveau zip, ou depuis le dashboard dans **Paramètres › Mise à jour**. Base de données, disposition et variables du service (budgets, `LENS_TOKEN`, port) sont conservées. Détails, et passage depuis des versions installées autrement : [docs/fr/aggiornamento.md](docs/fr/aggiornamento.md).

**Désinstaller** : `opencode-lens service uninstall` (avec `--purge`, aussi la base de données, la disposition et le log) ; pour vraiment tout retirer, [docs/fr/disinstallazione.md](docs/fr/disinstallazione.md).

## Utilisation

### Le dashboard

| Page | Ce qu'elle montre |
|---|---|
| **Maintenant** | le jour des budgets : consommation, budgets par modèle, prompt en cours |
| **Analyse** | une période au choix (7 jours au départ) : évolution, rythme, parts par modèle ou agent, prompts les plus lourds |
| **Monitor** | à garder ouvert sur un écran, aussi en plein écran ; il se met à jour tout seul |
| **Prompts**, **Sessions** | les listes complètes, avec les filtres d'Analyse et la timeline de chaque session |
| **Galerie** | tous les widgets et leurs styles avec vos données, à ajouter au dashboard |
| **Nouveautés** | le changelog de la version installée |
| **Paramètres** | chemins, variables d'environnement (modifiables depuis le dashboard quand la lens tourne comme service), langue et format, modules, mise à jour |

Avec **Personnaliser** chaque vue devient une grille de widgets à modifier ; la disposition est enregistrée dans la lens et elle est personnelle. Guide complet : [docs/fr/dashboard.md](docs/fr/dashboard.md).

### La commande

La commande est `opencode-lens`. Pour l'avoir dans le shell, ajoutez à `~/.zshrc` :

```bash
alias opencode-lens='node ~/Applications/opencode-lens/src/main.js'
```

(si c'est `install.sh` qui a téléchargé Node, utilisez `~/Applications/opencode-lens/node/bin/node` à la place de `node`).

```bash
opencode-lens                              # lance collecteur + dashboard (à la main, aussi sous Linux)
opencode-lens --check                      # vérifie qu'elle trouve le service OpenCode, puis quitte
opencode-lens --resync                     # relit toutes les sessions depuis zéro, puis reste active
opencode-lens service status               # chargé ? répond ? chemins
opencode-lens service stop | start | restart
opencode-lens service install --port 4800  # change le port (les autres variables restent)
opencode-lens service open                 # ouvre le dashboard dans le navigateur, avec le token
opencode-lens mcp install                  # affiche la ligne qui enregistre le serveur MCP dans OpenCode
```

### Budgets et configuration

La lens se configure avec des variables d'environnement qui, en service, se changent aussi depuis les **Paramètres** (la lens redémarre toute seule). Les plus utilisées :

| Variable | À quoi elle sert |
|---|---|
| `LENS_LIMIT_TOKENS`, `LENS_LIMIT_COST`, `LENS_LIMIT_STEPS` | budgets quotidiens (avec `_WEEKLY` et `_MONTHLY` pour la semaine et le mois) |
| `LENS_MODEL_LIMITS` | budget quotidien de modèles précis |
| `LENS_MODEL_PRICES` | prix des modèles locaux ou sans grille tarifaire |
| `LENS_RESET_HOUR` | l'heure à laquelle commence le jour des budgets (minuit au départ) |
| `LENS_PORT`, `LENS_HOST`, `LENS_TOKEN` | port, adresse et token d'accès |
| `LENS_RETENTION_DAYS` | au bout de combien de jours les détails sont résumés par jour |
| `LENS_OTLP_ENDPOINT` | export vers un collecteur OpenTelemetry |
| `LENS_MODULES` | les modules activés |

La liste complète est dans [docs/fr/configurazione.md](docs/fr/configurazione.md).

### Le serveur MCP

`opencode-lens mcp install` vous donne la ligne `opencode2 mcp add …` à lancer une fois. Ensuite les modèles dans OpenCode ont les outils `lens_budget`, `lens_errors`, `lens_usage` et `lens_sessions`, plus ceux des modules activés, et peuvent répondre à « combien me reste-t-il aujourd'hui sur Opus ? » ou « quelles sont les sessions les plus chères du mois ? ». Détails : [docs/fr/configurazione.md](docs/fr/configurazione.md#serveur-mcp-pour-opencode).

### API et métriques

L'API JSON locale (`/api/summary`, `/api/budget`, `/api/runs`, `/api/status`…) est décrite dans [docs/fr/metriche.md](docs/fr/metriche.md#api-locale) ; `/metrics` est prêt pour Prometheus et Grafana ([docs/fr/metriche.md](docs/fr/metriche.md#prometheus--grafana)), tout comme l'[export OTLP](docs/fr/metriche.md#export-otlp).

## Modules

Un **module** est une partie facultative de la lens : une page en plus dans le menu, avec ses propres API, ses propres widgets pour le dashboard et éventuellement ses propres outils MCP et tables. Tous les modules sont **désactivés** au départ : un module désactivé n'a ni entrée de menu, ni routes, ni travail en arrière-plan, ni métriques. Tout le reste (Maintenant, Analyse, Monitor, Prompts, Sessions, Galerie, Nouveautés, Paramètres) est le cœur et il est toujours là.

Cinq modules sont inclus :

| Module | Ce qu'il ajoute |
|---|---|
| **Vibe Coding** | temps de travail, coûts et tokens par projet et par dossier |
| **Système** | l'ordinateur sur lequel tourne la lens : CPU, mémoire, batterie, processus |
| **Sécurité** | ce que les guards DLP d'OpenCode ont laissé passer ou bloqué, lu dans leurs fichiers d'audit ; aussi comme outil MCP `lens_security` ([docs/fr/sicurezza.md](docs/fr/sicurezza.md)) |
| **IBM Bob** | les tâches de Bob IDE et Bob Shell, avec un sélecteur pour les voir à côté d'OpenCode ou seules |
| **Skill** | la bibliothèque de vos skills avec leurs versions et l'usage qu'en fait OpenCode ; elle les regroupe en **presets** que le MCP offre à OpenCode comme commandes `/lens:<id>` |

**Les activer.** Depuis **Paramètres › Modules**, avec le bouton *Activer* de chaque carte ; ou, avec la lens lancée à la main, avec `LENS_MODULES` (par exemple `LENS_MODULES=sistema,vibecoding`). Un module qui ne démarre pas passe en erreur tout seul : la lens et les autres modules continuent de fonctionner.

**Vos propres modules.** Vous pouvez écrire les vôtres et les mettre dans le dossier `modules/` à côté de la base de données (sous macOS `~/Library/Application Support/opencode-lens/modules/`), que les mises à jour ne touchent pas ; ils s'installent aussi depuis un zip dans **Paramètres › Mise à jour**. Un module lit la base de données en lecture seule et n'écrit que dans ses propres tables. Pour commencer :

- copiez le module d'exemple [extras/module-template/](extras/module-template/) ;
- suivez le guide pas à pas [docs/fr/moduli-custom.md](docs/fr/moduli-custom.md), écrit aussi pour un LLM ;
- ou demandez au modèle dans OpenCode : les outils MCP `lens_module_guide` et `lens_module_check` lui donnent le guide avec les valeurs de votre installation et vérifient le module sans l'activer.

Le contrat complet (manifeste, routes, widgets, tables, paramètres, MCP) est dans [docs/fr/moduli.md](docs/fr/moduli.md).

## Développement

```bash
git clone https://github.com/vale76p/opencode-lens-public.git opencode-lens && cd opencode-lens
npm run check             # vérifie qu'elle trouve le service OpenCode
npm start                 # collecteur + dashboard sur http://127.0.0.1:4777
npm test                  # tests node:test, avec un faux service OpenCode
npm run lint              # Biome via npx
npm run test:integration  # contre un vrai opencode2 (ignoré s'il n'y en a pas)
npm run verify            # compare la base de données avec les totaux d'OpenCode, session par session
npm run package           # tests + dist/opencode-lens-<version>.zip
```

Il n'y a rien à installer : aucune dépendance npm et aucun build. Le dashboard est fait de modules ES lus sur le disque à chaque requête, donc il suffit de recharger le navigateur. Pour le faire tourner comme service depuis le clone : `node src/main.js service install` (le plist pointe vers le dossier du clone).

Les tests tournent contre un faux service OpenCode (`service.json` temporaire, Basic auth, flux SSE, pagination) et vérifient que *Σ steps + Σ tâches internes* correspond aux totaux de session. `npm run test:integration` lance un vrai `opencode2 serve` dans des dossiers temporaires, avec un faux modèle compatible OpenAI. `npm run test:macos` construit l'app macOS facultative ([docs/fr/app-macos.md](docs/fr/app-macos.md)).

```
opencode-lens/
├── src/                  # collecteur, store SQLite, requêtes, serveur HTTP, serveur MCP
├── public/               # dashboard en modules ES, sans build
├── modules/              # les modules inclus (Vibe Coding, Système, Sécurité, IBM Bob, Skill)
├── docs/                 # documentation (en italien, traduite dans docs/en et docs/fr)
├── test/                 # tests node:test, avec un faux service OpenCode
├── extras/
│   ├── opencode/         # plugin OpenCode lens-guard
│   ├── macos/            # app macOS facultative (Swift)
│   └── module-template/  # module d'exemple à copier
├── scripts/              # paquet, changelog, vérification des totaux, signature des releases
├── install.sh            # installation comme service
└── uninstall.sh
```

## Versions et releases

Versions [SemVer](https://semver.org/lang/fr/) avec une seule source : `version` dans `package.json`. Les releases sont préparées par [release-please](https://github.com/googleapis/release-please) à partir des [commits conventionnels](https://www.conventionalcommits.org/fr/v1.0.0/) sur `main` : `feat(opencode-lens): …` fait une *minor*, `fix(opencode-lens): …` une *patch*, `!` ou `BREAKING CHANGE:` une *major* ; `test`, `ci`, `build` et `chore` n'apparaissent pas dans le changelog. Le merge de la PR de release crée le tag `opencode-lens-vX.Y.Z` avec la release GitHub et le zip signé de l'app.

Le service `local.opencode-lens`, le plist, le dossier des données et le log n'ont jamais changé de chemin depuis la 0.1.0, et `install.sh` met à jour depuis n'importe quelle version précédente : les changer serait une modification *major*.

## Documentation

Les documents gardent leurs noms de fichier italiens dans toutes les langues.

| Document | Contenu |
|---|---|
| [docs/fr/dashboard.md](docs/fr/dashboard.md) | dashboard : vues et pages, modification, widgets, catalogue, styles, Galerie |
| [docs/fr/configurazione.md](docs/fr/configurazione.md) | variables d'environnement, budgets, prix, serveur MCP, plugin lens-guard, accès à distance, sécurité et confidentialité |
| [docs/fr/metriche.md](docs/fr/metriche.md) | signification des chiffres, API locale, `/metrics`, Prometheus, OTLP |
| [docs/fr/moduli.md](docs/fr/moduli.md) | les modules : les activer, états, API et contrat complet |
| [docs/fr/moduli-custom.md](docs/fr/moduli-custom.md) | écrire votre propre module, pas à pas |
| [docs/fr/sicurezza.md](docs/fr/sicurezza.md) | le module Sécurité et les guards DLP d'OpenCode |
| [docs/fr/architettura.md](docs/fr/architettura.md) | découverte, flux en direct + backfill, idempotence, composants |
| [docs/fr/aggiornamento.md](docs/fr/aggiornamento.md) | mettre à jour et passer depuis des versions précédentes |
| [docs/fr/troubleshooting.md](docs/fr/troubleshooting.md) | problèmes courants et limites connues |
| [docs/fr/disinstallazione.md](docs/fr/disinstallazione.md) | ce que la lens écrit et comment la supprimer complètement |
| [docs/fr/app-macos.md](docs/fr/app-macos.md) | l'app macOS facultative |
| [docs/fr/traduzioni.md](docs/fr/traduzioni.md) | langues, textes et glossaire |
| [CHANGELOG.fr.md](CHANGELOG.fr.md) | versions, aussi dans la page **Nouveautés** du dashboard ([it](CHANGELOG.md), [en](CHANGELOG.en.md)) |

## Licence

[MIT](LICENSE) © 2026 vale76p. OpenCode Lens est un projet indépendant, non affilié à OpenCode ni à IBM.
