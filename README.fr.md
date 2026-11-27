# OpenCode Lens

🌐 [Italiano](README.md) · [English](README.en.md) · Français

**Version 0.51.0** <!-- x-release-please-version --> · [Nouveautés](CHANGELOG.fr.md) · [Releases](https://github.com/vale76p/opencode-lens-public/releases)

Observabilité locale pour **OpenCode V2** : tokens, modèles appelés, coûts, latences, tools et erreurs, lus depuis le service OpenCode en arrière-plan et affichés dans un dashboard sur `http://127.0.0.1:4777`.

Le dashboard affiche :

- **Aujourd'hui** : les tokens du jour avec la composition, le budget `LENS_LIMIT_*` avec la projection en fin de journée, heure par heure et, avec les budgets hebdomadaires et mensuels, la semaine et le mois (aussi sur `/api/budget` pour l'app OpenCode Lens Monitor) ; le jour commence à minuit ou à l'heure de `LENS_RESET_HOUR` ;
- **Par modèle aujourd'hui** : les tokens d'aujourd'hui de chaque modèle avec un budget quotidien propre, ce qu'il en reste et quand il se réinitialise, aussi comme gauge d'un seul modèle ; les modèles viennent de la configuration d'OpenCode et les budgets se définissent dans les Paramètres ;
- **Prompts en cours** : le prompt qu'OpenCode exécute, avec temps, steps, tools, tokens et remplissage du contexte ;
- tokens, coût, cache, latence et tools de la période, par modèle, agent, provider ou type d'agent (principal ou sous-agent) ;
- **Prompts** : la liste des prompts de la période avec résultat, durée, steps, tools et tokens, et leur **distribution** (médiane, p95, durée moyenne) ; et l'**interaction** : permissions avec le temps d'attente, commits et poids des sous-agents ;
- **Dernière année** : calendrier quotidien de 53 semaines ;
- sessions paginées, avec le total des sous-agents et une **timeline** de steps et de tools, avec les pauses mises en évidence ;
- **Personnaliser le dashboard** : les blocs sont des widgets sur une grille de 12 colonnes ; ils se déplacent en les faisant glisser, se redimensionnent depuis le coin, se configurent (période, métrique, regroupement, titre), se retirent ou s'ajoutent depuis le catalogue, même plusieurs fois le même, y compris les **gauges** et l'évolution en colonnes ou en ligne. La navigation est dans une **barre latérale**. Le dashboard a trois vues, **Maintenant** (le jour des budgets, le prompt en cours), **Analyse** (période, distribution des tokens par prompt, liste des prompts) et **Monitor** (à garder sur un écran, aussi en plein écran) ; chaque widget avec plusieurs modèles graphiques a un **style** à choisir en modification, et la **Galerie** les montre tous avec les vraies données ; la disposition est enregistrée dans la lens (`dashboard-v2.json` à côté de la base de données), elle est personnelle et ne finit pas dans le paquet. Guide : [docs/fr/dashboard.md](docs/fr/dashboard.md) ;
- **Paramètres** (chemins, base de données, variables d'environnement modifiables depuis le dashboard avec le LaunchAgent, **langue** et **format** des dates, heures et nombres) et **Nouveautés** (changelog). Le dashboard est en italien, anglais et français : la langue et le format suivent le navigateur, ou se choisissent dans les Paramètres (`LENS_LANG`, `LENS_LOCALE` ; voir [docs/fr/traduzioni.md](docs/fr/traduzioni.md)) ;

Avec le **serveur MCP** (`opencode-lens mcp`), les modèles qui travaillent dans OpenCode peuvent eux aussi demander à Lens le budget, les erreurs agrégées, l'usage et les sessions : « pourquoi les requêtes échouent-elles ? », « compare cette semaine avec la précédente ». Il s'enregistre avec la ligne affichée par `opencode-lens mcp install` : voir [docs/fr/configurazione.md](docs/fr/configurazione.md#serveur-mcp-pour-opencode). Les skills que vous importez dans la page **Skill** se regroupent en **presets** : le MCP les propose à OpenCode comme commandes `/lens:<id>` et comme outil `preset`, avec le texte de `SKILL.md`, le dossier de base et les fichiers ([détails](docs/fr/configurazione.md#prompts)).

La lens ne touche pas aux sessions : elle écoute le flux d'événements du service partagé, relit les messages pour avoir des chiffres exacts et enregistre des compteurs, des temps et des noms dans une base de données SQLite locale, plus les titres des sessions (`LENS_STORE_TITLES=0` les exclut), le dossier de travail de chaque session et les messages d'erreur, expurgés (clés, tokens, dossier personnel) et tronqués à 500 caractères. Le texte des prompts, les réponses et les outputs des tools ne sont pas enregistrés.

## Prérequis

- **Node ≥ 22.13** : elle utilise le `node:sqlite` intégré. Zéro dépendance npm, aucun build. S'il n'y en a pas, `install.sh` télécharge Node 24 LTS dans le dossier de l'app, sans `sudo`.
- **OpenCode V2** (`opencode2`), lancé au moins une fois, pour que le service partagé écrive `~/.local/state/opencode/service.json`. Vérifié sur OpenCode v2.0.26.
- macOS pour l'installation comme service (launchd). Lancement manuel aussi sur Linux.
- Accès au dépôt, qui est privé : depuis le navigateur avec votre compte GitHub, ou avec la [GitHub CLI](https://cli.github.com) authentifiée (`gh auth login`).

OpenCode V1 (`opencode`) n'est pas pris en charge : il a une API serveur différente.

## Installation

Sur macOS, la lens tourne comme service launchd depuis `~/Applications/opencode-lens`. Tout reste dans votre dossier utilisateur, sans `sudo` ni droits d'administrateur : cela convient aussi à un Mac d'entreprise.

1. Depuis la [page de la release](https://github.com/vale76p/opencode-lens-public/releases), téléchargez `opencode-lens-<version>.zip`, ou « Source code (zip) » : les deux fonctionnent.
2. Double-cliquez sur le zip dans le dossier Téléchargements (Safari l'extrait généralement tout seul).
3. Ouvrez le Terminal et lancez `install.sh` du dossier extrait. Il n'y a qu'une commande : tapez `bash `, faites glisser `install.sh` dans la fenêtre et appuyez sur Entrée. Ou :

   ```bash
   bash ~/Downloads/opencode-lens*/install.sh
   ```

   S'il y a plusieurs versions dans Téléchargements, la commande s'arrête : indiquez le bon dossier, c'est-à-dire `opencode-lens` pour le zip de la release ou `opencode-lens-opencode-lens-v<version>` pour le Source code.

Pour voir d'abord ce qui est déjà installé (service, version, base de données, anciennes copies, Homebrew) sans rien changer : `bash …/install.sh --check`.

`install.sh` :

- enregistre une copie de la base de données et du plist dans `~/Library/Application Support/opencode-lens/backup/` (il garde les trois dernières) ;
- copie dans `~/Applications/opencode-lens` uniquement les fichiers nécessaires au fonctionnement de la lens (ni tests ni fichiers de développement, sauf le test kit des modules dans `test/`, pour essayer les vôtres : voir [docs/fr/moduli.md](docs/fr/moduli.md#essayer-un-module)) et retire la quarantaine du téléchargement ;
- utilise le Node ≥ 22.13 du `PATH` ; s'il n'y en a pas, ou s'il est plus ancien, il télécharge Node 24 LTS depuis nodejs.org dans `~/Applications/opencode-lens/node`, en vérifiant son checksum. Si nodejs.org n'est pas joignable (proxy d'entreprise), indiquez un miroir interne avec `LENS_NODE_MIRROR=https://…/dist bash …/install.sh` ;
- installe le service avec `opencode-lens service install`, qui démarre tout de suite et à chaque connexion, et attend qu'il réponde. Pour un autre port : `LENS_PORT=4800 bash …/install.sh` ;
- si le service démarrait depuis un autre dossier extrait d'un zip, il le met à la Corbeille. Un clone reste où il se trouve ; pour Homebrew, il affiche les commandes pour le retirer.

La base de données, la disposition du dashboard et les variables du service ne sont jamais touchées. Pour passer d'une version installée autrement (zip dans un autre dossier, Homebrew, clone), et pour restaurer une copie, voir [docs/fr/aggiornamento.md](docs/fr/aggiornamento.md).

Dashboard sur `http://127.0.0.1:4777`. L'app est dans `~/Applications/opencode-lens`, le service dans `~/Library/LaunchAgents/local.opencode-lens.plist`, la base de données et la disposition du dashboard dans `~/Library/Application Support/opencode-lens/`, les logs dans `~/Library/Logs/opencode-lens/lens.log`. Le zip téléchargé et le dossier extrait peuvent être supprimés.

**Mise à jour** : les mêmes étapes avec le nouveau zip. `install.sh` remplace l'app et garde le Node déjà téléchargé, la base de données et les variables du service (budgets, `LENS_TOKEN`, port). Depuis la 0.17.0, on peut aussi le faire depuis le dashboard : **Paramètres › Mise à jour**, vous chargez le zip et la lens lance son `install.sh` (voir [docs/fr/aggiornamento.md](docs/fr/aggiornamento.md#depuis-le-dashboard)).

Avec la GitHub CLI, les étapes 1-3 deviennent :

```bash
D="$(mktemp -d)" && gh release download -R vale76p/opencode-lens-public -p 'opencode-lens-[0-9]*.zip' -D "$D" && unzip -q "$D"/opencode-lens-[0-9]*.zip -d "$D" && bash "$D"/opencode-lens/install.sh
```

Sans tag, `gh release download` télécharge la dernière release.

La commande de la lens est `opencode-lens`, le nom qu'utilisent aussi ses messages et cette documentation ; pour l'avoir dans le shell, ajoutez à `~/.zshrc` :

```bash
alias opencode-lens='node ~/Applications/opencode-lens/src/main.js'
```

Si c'est `install.sh` qui a téléchargé Node, utilisez `~/Applications/opencode-lens/node/bin/node` à la place de `node`.

Gestion du service :

```bash
opencode-lens service status               # chargé ? répond ? chemins
opencode-lens service install --port 4800  # change le port (les autres variables restent)
opencode-lens service stop | start | restart
opencode-lens service open                 # ouvre le tableau de bord dans le navigateur, avec le jeton
opencode-lens service uninstall [--purge]  # avec --purge aussi base de données, disposition et logs
```

Pour donner Lens aux modèles d'OpenCode comme serveur MCP : `opencode-lens mcp install` affiche la ligne `opencode2 mcp add …` à exécuter ([détails](docs/fr/configurazione.md#serveur-mcp-pour-opencode)).

`service install` vérifie la version de Node et que le port est libre, essaie la connexion à OpenCode (s'il n'est pas actif, ce n'est pas grave : la lens se connecte au démarrage), écrit le plist et attend que `/healthz` réponde. Relancé sur une installation existante, il en conserve les `EnvironmentVariables`, comme les budgets et `LENS_TOKEN`, et ne change le port qu'avec `--port`. Si Node vient de Homebrew, le plist contient son chemin stable (`/opt/homebrew/opt/node/…`), qui reste valide après chaque mise à jour de Node.

Pour vraiment tout supprimer (aussi les données du navigateur et les intégrations), suivez [docs/fr/disinstallazione.md](docs/fr/disinstallazione.md). La page **Paramètres** du dashboard affiche les mêmes commandes déjà remplies avec vos chemins.

## Depuis un clone (développement)

```bash
git clone https://github.com/vale76p/opencode-lens-public.git opencode-lens && cd opencode-lens
npm run check     # vérifie qu'il trouve le service OpenCode
npm start         # collector + dashboard sur http://127.0.0.1:4777
npm run resync    # relit toutes les sessions depuis zéro, puis reste actif
npm run verify    # compare la base avec les totaux d'OpenCode, session par session (-v pour le détail)
node src/main.js --help
```

Comme service depuis le clone : `node src/main.js service install` (ou `./install.sh`, qui dans un clone ne copie rien et utilise le Node du `PATH` ; avec `LENS_PORT=4800 ./install.sh` pour le port ; `./uninstall.sh [--purge]` pour le retirer). C'est la même commande : le plist pointe vers le dossier du clone. Si vous utilisez un gestionnaire de versions (nvm, fnm, volta, asdf) et changez de version de Node, relancez-la.

Pour passer d'un clone au zip, ou l'inverse, il suffit de `service install` depuis le nouveau dossier : il réécrit le plist et conserve variables, base de données et disposition.

## Documentation

| Document | Contenu |
|---|---|
| [docs/fr/dashboard.md](docs/fr/dashboard.md) | dashboard personnalisable : barre latérale, vues et pages, modification, clavier, paramètres des widgets, catalogue, styles, Galerie, où il est enregistré et comment revenir à une lens plus ancienne |
| [docs/fr/sicurezza.md](docs/fr/sicurezza.md) | page Sécurité : guards DLP d'OpenCode, comment Lens les trouve (un `<nom>.audit.jsonl` suffit), santé, ce qui se voit depuis le réseau, tool MCP `security` (du module Sécurité) et série `/metrics` |
| [docs/fr/architettura.md](docs/fr/architettura.md) | discovery, flux en direct + backfill, idempotence, styles et modèles du dashboard, composants |
| [docs/fr/metriche.md](docs/fr/metriche.md) | signification des chiffres, API locale, `/metrics` et Prometheus |
| [docs/fr/configurazione.md](docs/fr/configurazione.md) | variables d'environnement, prix des modèles locaux, serveur MCP pour OpenCode, accès à distance, sécurité et confidentialité |
| [docs/fr/aggiornamento.md](docs/fr/aggiornamento.md) | passer depuis des versions précédentes (zip, Homebrew, clone) : contrôle, nettoyage, copies de la base de données |
| [docs/fr/troubleshooting.md](docs/fr/troubleshooting.md) | problèmes courants et limites connues de la bêta |
| [docs/fr/disinstallazione.md](docs/fr/disinstallazione.md) | ce que la lens écrit et comment la supprimer complètement |
| [docs/fr/app-macos.md](docs/fr/app-macos.md) | app macOS facultative : le dashboard dans une fenêtre native avec Dock, notifications et ouverture à la connexion ; compilation, installation, désinstallation |
| [docs/fr/moduli.md](docs/fr/moduli.md) | les modules (Vibe Coding, Système, Sécurité, IBM Bob, Skill) et les vôtres : les activer, états, API et contrat complet d'un module |
| [docs/fr/moduli-custom.md](docs/fr/moduli-custom.md) | écrire un module à vous, pas à pas (le guide que donne l'outil MCP `lens_module_guide`) : dossier, manifeste, routes, page, widgets, vérification, erreurs typiques |
| [docs/fr/traduzioni.md](docs/fr/traduzioni.md) | langues (italien, anglais, français), comment on ajoute et change les textes, glossaire |
| [CHANGELOG.fr.md](CHANGELOG.fr.md) | versions (aussi dans la page **Nouveautés** du dashboard) ; original italien dans [CHANGELOG.md](CHANGELOG.md), anglais dans [CHANGELOG.en.md](CHANGELOG.en.md) |

Le reste de la documentation existe en [italien](docs/) (l'original), [anglais](docs/en/) et [français](docs/fr/), avec les mêmes noms de fichiers.

## Structure

```
opencode-lens/
├── src/                  # collector, store SQLite, requêtes, serveur HTTP, serveur MCP, about/changelog
├── public/               # dashboard en modules ES sans build : barre latérale, grille de widgets, modèles de graphiques, éditeur, Galerie, Paramètres, Nouveautés, catalogues de langues
├── docs/                 # documentation (italien ; en/ et fr/ traduits)
├── test/                 # tests node:test, avec un faux service OpenCode
├── extras/
│   ├── opencode/         # plugin OpenCode lens-guard
│   ├── macos/            # app macOS facultative (Swift, compilée avec app.sh)
│   └── module-template/  # module d'exemple à copier pour écrire les vôtres (docs/fr/moduli-custom.md)
├── scripts/
│   ├── package.sh        # tests + dist/opencode-lens-<version>.zip
│   ├── changelog.mjs     # cohérence version/changelog/tag, notes de release
│   └── verify.mjs        # réconciliation avec les totaux d'OpenCode
├── dist/                 # paquet créé par npm run package (non commité)
├── install.sh            # depuis un clone : opencode-lens service install
├── uninstall.sh          # depuis un clone : opencode-lens service uninstall
├── CHANGELOG.md          # avec CHANGELOG.en.md et CHANGELOG.fr.md
└── package.json
```

## Développement

```bash
npm test                  # node:test, aucune dépendance
npm run test:integration  # contre un vrai opencode2 (ignoré s'il est absent)
npm run lint              # Biome via npx, aucune dépendance dans le projet
npm run test:macos        # compile vraiment l'app macOS facultative (macOS seulement, ignoré sans Command Line Tools)
npm run package           # tests + dist/opencode-lens-<version>.zip, vérifié en l'extrayant
```

Les tests tournent contre un faux service OpenCode (serveur HTTP local avec un `service.json` temporaire, Basic auth, flux SSE et pagination par curseur) et vérifient que *Σ steps + Σ tâches internes* coïncide avec les totaux de session. Le workflow `.github/workflows/opencode-lens.yml` les exécute avec Node 22 à chaque push sur `main` et à chaque pull request (sauf celles qui ne touchent que les fichiers de la PR de release de release-please : manifest, `CHANGELOG.md`, `README.md`, `package.json`), avec le lint et `npm run changelog:check`.

`npm run test:integration` lance un vrai `opencode2 serve` dans des dossiers temporaires (HOME et XDG propres, aucun identifiant) avec un faux modèle compatible OpenAI : les tools tournent vraiment (`read`, `shell` avec un `git commit`, une permission demandée et accordée) et le test vérifie que steps, coûts, runs, prompts, commits et permissions enregistrés par la lens coïncident avec OpenCode. Il ne tourne pas en CI car il exige `opencode2` : lancez-le avant une release et après chaque mise à jour d'OpenCode (`OPENCODE_BIN` pour un autre binaire).

`npm run test:macos` compile et signe vraiment l'app macOS facultative d'`extras/macos/` sans la démarrer ; il est ignoré hors de macOS ou sans Command Line Tools. La CI ne lance que ses contrôles statiques, dans `npm test`. Voir [docs/fr/app-macos.md](docs/fr/app-macos.md#développement).

## Versions et releases

Versions [SemVer](https://semver.org/lang/fr/) avec une seule source : `version` dans `package.json`. C'est de là que la lisent `--version`, `/api/status`, `/api/about`, la métrique `opencode_lens_build_info` et le dashboard (à côté du titre et dans la page **Nouveautés**).

| Change | Quand |
|---|---|
| *major* | API locale, schéma de la base de données ou installation incompatibles avec la version précédente |
| *minor* | nouvelles fonctions compatibles |
| *patch* | corrections |

Les releases sont préparées par [release-please](https://github.com/googleapis/release-please) à partir des [commits conventionnels](https://www.conventionalcommits.org/fr/v1.0.0/) sur `main` :

| Commit | Section du changelog | Version |
|---|---|---|
| `feat(opencode-lens): …` | Ajouté | *minor* |
| `fix(opencode-lens): …` | Corrigé | *patch* |
| `perf:` / `refactor:` | Modifié | *patch* |
| `docs:` | Documentation | *patch* |
| `!` après le type, ou `BREAKING CHANGE:` dans le corps | | *major* |
| `test:`, `ci:`, `build:`, `chore:` | n'apparaissent pas | |

(Les sections du changelog sont écrites en italien dans `CHANGELOG.md` : Aggiunto, Corretto, Modificato, Documentazione.)

À chaque push sur `main`, le workflow `.github/workflows/release-please.yml` tient à jour une PR « chore(main): release opencode-lens X.Y.Z » avec la version dans `package.json`, la nouvelle entrée dans `CHANGELOG.md` et `.release-please-manifest.json`. Les entrées peuvent être affinées à la main dans la PR avant le merge, et dans la même PR on ajoute les traductions de la nouvelle version dans `CHANGELOG.en.md` et `CHANGELOG.fr.md` (si elles manquent, la page **Nouveautés** affiche cette version en italien ; `npm run changelog:check` les signale). Au merge, release-please crée le tag `opencode-lens-vX.Y.Z` et la release GitHub ; le second job contrôle tag et changelog (`npm run changelog:check`), relance tests et paquet et joint le zip de l'app, `opencode-lens-X.Y.Z.zip`.

Pour installer la lens, on utilise le zip de l'app ou le « Source code » que GitHub ajoute à chaque release, et `install.sh` installe depuis les deux de la même façon :

| Zip | Dossier extrait | Contenu |
|---|---|---|
| `opencode-lens-X.Y.Z.zip` (joint par le workflow) | `opencode-lens/` | seulement les fichiers nécessaires au fonctionnement de la lens, testés par le job qui construit le paquet |
| « Source code (zip) » (généré par GitHub sur le tag) | `opencode-lens-opencode-lens-vX.Y.Z/` | tout le dépôt, tests et fichiers de développement compris ; `install.sh` ne copie que ce qui est nécessaire |

Pour essayer `main` avant une release, le « Download ZIP » de la branche (`opencode-lens-main/`) convient aussi : la version affichée reste celle de la dernière release tant que release-please ne la met pas à jour.

L'installation fait partie de la compatibilité. Le service `local.opencode-lens`, le plist, le dossier de données (`~/Library/Application Support/opencode-lens`) et les logs n'ont jamais changé de chemin depuis la 0.1.0, et `install.sh` met à jour depuis n'importe quelle version précédente ([docs/fr/aggiornamento.md](docs/fr/aggiornamento.md)). Changer l'un de ces chemins, ou exiger une étape manuelle pour mettre à jour, est un changement *major*.

Avant le merge d'une PR de release : `npm run test:integration` et `npm run test:macos` en local et, depuis un zip extrait, `bash install.sh --check` pour voir qu'il reconnaît l'installation existante. La PR de release-please, créée avec le token des Actions, ne lance pas la CI toute seule ; les tests tournent quand même dans le job qui construit le zip, après le tag.

Le workflow a besoin de « Allow GitHub Actions to create and approve pull requests » dans *Settings → Actions → General → Workflow permissions* du dépôt.
