# Modules

🌐 [Italiano](../moduli.md) · [English](../en/moduli.md) · Français

Un module est une partie facultative de la lens, dans un dossier `modules/<id>/`. Tous sont **désactivés** au départ : un module désactivé n'a ni entrée de menu, ni routes, ni travail en arrière-plan, ni métriques. Le reste (Maintenant, Analyse, Monitor, Prompts, Sessions, Galerie, Nouveautés, Paramètres) est le cœur et il est toujours là.

Aujourd'hui il existe cinq modules : **Vibe Coding**, temps de travail, coûts et tokens par projet et dossier (voir [dashboard.md](dashboard.md#vibe-coding)) ; **Système**, l'ordinateur sur lequel tourne la lens (voir [dashboard.md](dashboard.md#système)) ; **Sécurité**, ce que les guards DLP d'OpenCode ont laissé passer ou bloqué (voir [sicurezza.md](sicurezza.md)) ; **IBM Bob**, les tâches de Bob IDE et Bob Shell (voir [dashboard.md](dashboard.md#ibm-bob)) ; **Skill**, la bibliothèque de vos skills, avec les versions, les presets et l'usage qu'en fait OpenCode (voir [Skill](#skill) et [dashboard.md](dashboard.md#skill)).

## Activer un module

- **Depuis le dashboard** : **Paramètres › Modules** a une carte par module trouvé, avec nom, description, état et le bouton *Activer* (ou *Désactiver*). Activer ou désactiver un module change `LENS_MODULES` : cela s'enregistre comme les autres paramètres et la lens redémarre (voir [configurazione.md](configurazione.md#modification-depuis-le-dashboard)).
- **Depuis le shell**, quand la lens ne tourne pas comme service (lancée à la main avec `npm start`) et que la page Paramètres est en lecture seule : `LENS_MODULES` est une liste d'ids séparés par des virgules, par exemple `LENS_MODULES=sistema`.

Les règles de `LENS_MODULES` :

- un id est fait de minuscules, de chiffres et de tirets, et commence par une lettre (`sistema`, `demo-2`) ; les espaces autour de la virgule ne comptent pas ;
- un id mal écrit ou répété est une erreur de configuration, et la lens ne démarre pas (comme pour les autres variables) ;
- un id bien formé qui ne correspond à aucun module est ignoré, avec un avertissement dans le log.

### États

`GET /api/modules` donne un état à chaque module :

| État | Signification |
|---|---|
| `off` | trouvé et non activé |
| `on` | actif et démarré |
| `unconfigured` | activé mais à configurer : ses réglages sont incomplets ou invalides (`configure` renvoie des `errors` ; la raison est dans `reason`). Il compte comme désactivé : pas de routes, de travail en arrière-plan ni de métriques. Se corrige depuis la carte du module |
| `error` | inutilisable : manifeste invalide, lens trop ancienne pour le module, démarrage échoué (aussi un `start()` asynchrone qui ne finit pas en 10 secondes : le registre appelle `stop()` et le serveur démarre quand même), un `configure` qui lève une exception. Les autres modules et la lens continuent |

Le motif de l'erreur (`reason`) n'est vu que par les clients de cet ordinateur, parce qu'il peut nommer des fichiers de l'ordinateur. Il en va de même pour `unconfigured`.

### Après une mise à jour

Après la mise à jour qui introduit les modules, ceux qui ne figurent pas dans `LENS_MODULES` restent désactivés. Pour chacun qui a déjà des données, un avis apparaît sur chaque page : « était utilisé : réactivez-le depuis Paramètres › Modules ». L'avis se ferme pour de bon, un par module ; la fermeture est `POST /api/modules/notice`. Système ne l'affiche jamais : il ne stocke rien. Sécurité l'affiche quand il trouve l'audit d'un guard dans ses dossiers (`hasData` se borne à regarder quels fichiers s'y trouvent). Le texte de l'avis est le champ `notice` du manifeste, si le module en a un (`noticeMessage` dans `GET /api/modules`) ; sinon, une phrase générique « {nom} était utilisé… ». IBM Bob l'affiche quand il trouve des tâches dans sa table `bob_tasks`, et dit que tant que vous ne le réactivez pas il n'est plus lu et que ce que Bob supprime entre-temps est perdu. Skill affiche l'avis générique (« Skill était utilisé : réactivez-le depuis Paramètres › Modules ») quand il trouve une skill dans l'index, un dossier de version dans la bibliothèque ou une livraison du MCP de Lens dans `skill_uses` ; tant que vous ne le réactivez pas ses fichiers restent tels quels, jamais réécrits par la lens.

## Skill

Skill (`modules/skill/`, menu *Lens*, avant Système et Sécurité) est la bibliothèque de vos skills avec les versions, les presets de skills et l'usage qu'en fait OpenCode (voir [dashboard.md](dashboard.md#skill)). Avec le module désactivé :

- **Ni route ni page.** `/api/skills`, `/api/skills/<id>`, `/api/skill-presets`, `/api/skill-loads` et `/api/skill-usage` répondent 404, les `POST` aussi ; l'entrée de menu et la page `#skill` n'existent pas.
- **MCP.** L'outil `preset` et les commandes `/lens:<id>` n'existent qu'avec Skill actif. Les commandes suivent `notifications/prompts/list_changed` ; l'outil ne disparaît d'OpenCode qu'après un redémarrage d'OpenCode (voir [Les outils MCP d'un module](#les-outils-mcp-dun-module)). Un MCP encore en cours après la mise à jour reçoit 404 sur `/api/skill-loads` : la livraison arrive au modèle, mais n'est pas comptée.
- **Ce qui reste du noyau.** La table `skill_uses` avec `src/skill-uses.js` et `src/skill-ids.js`, les métriques `opencode_lens_skill_loads_total` et `opencode_lens_skill_preset_loads_total` et le dossier `skills/` que le collector regarde pour distinguer les skills de la bibliothèque des natives continuent de se remplir même avec Skill désactivé : c'est la seule exception à « pas de métriques d'un module désactivé ». La reconnaissance d'un ancien MCP d'après les requêtes à `/api/skill-presets` (`noteMcp` : un chemin observé, pas servi) reste aussi dans le noyau. Les modèles du dashboard, qui s'appellent aussi presets, n'ont rien à voir : ils sont du noyau.
- **Ses fichiers.** `skills/` (un dossier : `kind: "dir"`), `skills.json`, `skill-presets.json` et les copies `.bad.json` sont du module. Désactivé, il ne les réécrit jamais (ni `hasData` ni `files()` n'écrivent), et le script de désinstallation les supprime (voir [disinstallazione.md](disinstallazione.md)).
- **Après une mise à jour.** Voir [ci-dessus](#après-une-mise-à-jour) : `hasData` regarde l'index, les dossiers de version et les livraisons du MCP de Lens (`origin = 'lens'` dans `skill_uses`).

## Les modules de l'utilisateur

En plus des modules de la lens, on peut en garder de personnels. Ils se trouvent dans un dossier `modules/` **à côté de la base de données**, hors du dossier de l'app :

| Où elle tourne | Dossier des modules de l'utilisateur |
|---|---|
| macOS | `~/Library/Application Support/opencode-lens/modules/` |
| Linux | `$XDG_DATA_HOME/opencode-lens/modules/` (par défaut `~/.local/share/opencode-lens/modules/`) |
| `LENS_DB` définie | le dossier `modules/` à côté du fichier de la base |
| `LENS_DB=:memory:` | aucun : sans dossier de données il n'y a pas de modules de l'utilisateur |

- **Comment il est fait.** Chaque module est un sous-dossier `<id>/` fait comme ceux de la lens (voir [Écrire un module](#écrire-un-module)). La lens ne crée pas le dossier : s'il n'existe pas, il ne se passe rien ; s'il n'est pas lisible, la lens écrit un avertissement dans le log et continue sans modules de l'utilisateur. Les sous-dossiers dont le nom n'est pas un id (une copie du Finder comme `demo 2`) ne sont pas des modules. Un sous-dossier peut être un lien symbolique vers un dossier (pratique pour un module que vous développez ailleurs) : dans le dossier de l'utilisateur il compte comme un module, dans le dossier `modules/` de la lens non.
- **Depuis un zip.** Un module (ou un zip de plusieurs modules) s'installe et se met à jour aussi depuis **Paramètres › Mise à jour** : un aperçu qui n'exécute rien, la vérification de chaque module seulement après l'avertissement et la confirmation (**Installer**), puis l'ancien dossier dans `.backup/` et le nouveau à sa place (voir [aggiornamento.md](aggiornamento.md#les-modules-de-lutilisateur-depuis-le-dashboard)).
- **Il survit aux mises à jour.** `install.sh` supprime et recrée le dossier de l'app (`~/Applications/opencode-lens`) quand on installe depuis le zip d'une release, et la mise à jour depuis l'app fait de même, car elle exécute cet `install.sh` ; il ne touche pas au dossier des données : vos modules restent où ils sont. Pour la même raison, les fichiers qu'un module écrit avec `files()` sont dans le dossier des données, et `modules` est un nom réservé au cœur (`CORE_DIRS`) : aucun module ne peut le déclarer.
- **Les mêmes règles.** Le manifeste, l'id, la version minimale de la lens, les variables et les états sont jugés comme pour les modules de la lens (voir [Le manifeste](#le-manifeste) et [États](#états)) ; un module de l'utilisateur est désactivé au départ et s'active depuis **Paramètres › Modules** ou avec `LENS_MODULES`. Une variable de `settings` déjà déclarée par un module de la lens est une erreur de manifeste.
- **Si l'id est déjà celui d'un module de la lens** (`sistema`, `skill`…) la lens gagne : le dossier de l'utilisateur n'est jamais importé, la lens écrit un avertissement dans le log et **Paramètres › Modules** affiche « Le dossier … a l'identifiant d'un module de la lens : renommez-le ». Renommez le dossier et l'`id` du manifeste.
- **Un nouveau module demande un redémarrage.** La lens ne cherche les modules qu'au démarrage : un module ajouté, ou un `module.js` modifié, apparaît après avoir redémarré la lens. Il en va de même pour le serveur MCP, qui calcule le dossier de l'utilisateur à partir du plist du service (`LENS_DB`, et non de `GET /api/modules`) et ne le lit qu'une fois, au démarrage : pour ses outils il faut redémarrer OpenCode (voir [Les outils MCP d'un module](#les-outils-mcp-dun-module)).
- **Où on le voit.** La carte du module dans **Paramètres › Modules** affiche l'étiquette « personnel » et le dossier ; `GET /api/modules` donne `origin` et, seulement aux clients de cet ordinateur, `dir` (seulement pour les modules de l'utilisateur), `userDir` et `shadowed` (voir [API](#api)).
- **Pas de sandbox.** Un module de l'utilisateur est du code Node auquel la lens fait confiance : il tourne dans son processus, avec les mêmes permissions, et peut lire et écrire n'importe lequel de vos fichiers, ouvrir des connexions réseau et utiliser la base de données. N'y mettez que des modules que vous avez écrits ou lus vous-même.
- **Désinstallation.** Les lignes sur vos modules n'apparaissent que si le dossier existe. `uninstall.sh` sans `--purge` laisse vos modules où ils sont et en indique le dossier ; avec `--purge` il les supprime avec les données s'ils sont dans le dossier des données, sinon ils restent où ils sont et le script le dit (voir [disinstallazione.md](disinstallazione.md)).

## API

| Endpoint | Contenu |
|---|---|
| `GET /api/modules` | `modules` (`id`, `name`, `description`, `state`, `reason`, `notice`, `settings` avec `name`, `label`, `help`, `kind`, `placeholder`, `value` et `isSet`, `mcp`, `mcpExamples`), `enabled` (les ids de `LENS_MODULES`), `canSave` et, si l'on ne peut pas enregistrer, le `reason` |
| `GET /api/modules` (autres champs) | `noticeMessage` (le `notice` du manifeste ou `null` ; `notice` reste le booléen « avis à afficher »), `settingsPanel` (le fichier du panneau ou `null`), `min` et `max` dans chaque réglage `num` ; `reason` est aussi présent pour `unconfigured` |
| `GET /api/modules` (modules de l'utilisateur) | `origin` (`core` pour les modules de la lens, `user` pour ceux du dossier `modules/` à côté de la base) sur chaque module ; depuis cet ordinateur aussi `dir` (le dossier d'un module de l'utilisateur ; `null` pour ceux de la lens), `userDir` (le dossier des modules de l'utilisateur, `null` avec la base en mémoire) et `shadowed` (les dossiers de l'utilisateur ignorés parce qu'ils ont l'identifiant d'un module de la lens : `{ id, dir }`). Depuis le réseau `dir` et `userDir` valent `null` et `shadowed` vaut `[]`. La carte affiche « personnel » et le dossier pour les modules de l'utilisateur, et une ligne par dossier ignoré |
| `POST /api/modules/notice` | `{ "id": "…" }` : ferme pour de bon l'avis du module. Depuis cet ordinateur seulement, avec les mêmes règles d'Origin, de content-type et de token que les autres écritures (voir [metriche.md](metriche.md#api-locale)) |
| `POST /api/modules/check` | `{ "id": "…" }` : juge le module `id` du dossier de l'utilisateur comme au démarrage, sans l'activer, et répond `{ ok, id, name, dir, errors, warnings }` (`name` est celui du manifeste, `null` s'il ne se charge pas). Depuis cet ordinateur seulement, avec les mêmes règles d'Origin, de content-type et de token que les autres écritures. Utilisé par l'outil MCP `module_check` |
| `GET /api/modules/authoring` | les valeurs de cette installation pour qui écrit un module (dossier de l'utilisateur, version de la lens, ids, variables, chemins, outils et types de widget déjà pris, plafonds des widgets). Depuis cet ordinateur seulement : les autres reçoivent 403. Utilisé par l'outil MCP `module_guide` |
| `/api/system`, `/api/system/live` | n'existent qu'avec Système actif ; désactivé, ils répondent 404 |
| `/api/vibe-coding`, `/api/vibe-coding/history`, `/api/vibe-projects` | n'existent qu'avec Vibe Coding actif (le `GET` des trois, le `POST` de `/api/vibe-projects`) ; désactivé, ils répondent 404 (le `POST` aussi) |
| `/api/security`, `/api/security/<guard>` | n'existent qu'avec Sécurité actif (le `GET` des deux) ; désactivé, ils répondent 404. Voir [metriche.md](metriche.md#api-locale) |
| `/api/bob`, `/api/bob/probe` | n'existent qu'avec IBM Bob actif (`GET /api/bob`, `POST /api/bob/probe`) ; désactivé, ils répondent 404 (le `POST` aussi). Voir [metriche.md](metriche.md#api-locale) |
| `/api/skills`, `/api/skills/<id>`, `/api/skill-presets`, `/api/skill-loads`, `/api/skill-usage` | n'existent qu'avec Skill actif (les `GET`, et les `POST` des quatre premiers) ; désactivé, ils répondent 404, les `POST` aussi : le MCP de Lens qui rapporte une livraison à une lens avec Skill désactivé reçoit 404 et la livraison n'est pas comptée. Voir [metriche.md](metriche.md#api-locale) |
| `/api/status`, `/healthz` | un module actif avec `status()` ajoute `<id>` à `/api/status`, avec `state()` à `/healthz` ; voir [État dans /api/status et /healthz](#état-dans-apistatus-et-healthz) |
| `/modules/<id>/<file>` | les fichiers du dossier `public/` d'un module **actif** : à plat, noms en minuscules ; pour un module désactivé c'est 404 |

## Écrire un module

Pour écrire un module à vous, dans le dossier des modules de l'utilisateur, suivez le guide [moduli-custom.md](moduli-custom.md) : l'ordre du travail, le module d'exemple `extras/module-template/`, la vérification et les erreurs typiques. Cette section est le contrat complet.

Un module vit dans `modules/<id>/`. L'id est aussi le nom du dossier et l'id de la page, et respecte `^[a-z][a-z0-9-]*$`. Le module le plus complet pour partir est `modules/vibecoding/` (routes `GET` et `POST`, lectures de la base, fichiers à lui) ; `modules/sistema/` est le plus petit.

```
modules/<id>/
  module.js          manifeste
  tables.js          les tables du module : { version, sql, columns } (facultatif)
  server/index.js    entrée Node : create(ctx), hasData(ctx), files(ctx)
  server/writes.js   le SQL d'écriture pour ctx.writer (seulement avec tables.js)
  mcp/tools.js       outils MCP du module : tools(kit) (facultatif)
  scripts/           scripts de terminal du module (facultatif)
  public/            fichiers du navigateur, tous dans le même dossier
    page.js          exporte page et title
    page.html        le markup de la page
    settings.js      le panneau dans la carte (facultatif)
    widgets.js       les widgets du dashboard (facultatif)
    style.css        facultatif
    lang-en.js       catalogues du module
    lang-fr.js
  test/              tests du module
```

L'entrée Node ne doit avoir aucun effet de bord à l'import : la lens l'importe même pour un module désactivé, afin de demander `hasData` et `files`. Ce dont le module a besoin se fait dans `create(ctx)` et `start()`. Un id égal à une page ou à une vue du cœur (`dashboard`, `impostazioni`, `adesso`…) est réservé : le module passe en `error`.

### Le manifeste

`module.js` exporte par défaut un objet, sans imports statiques. La lens le juge avec `src/modules.js` ; un manifeste invalide met le module en `error` avec le motif.

| Champ | |
|---|---|
| `id` | égal au dossier |
| `name`, `description` | textes en italien, traduits par les catalogues du module ; de même pour `label`, `help` et `placeholder` de `settings` et pour `mcpExamples` |
| `lens` | version minimale de la lens, `x.y.z` ; avec une lens plus ancienne le module reste en `error` |
| `menu` | `group` (`dati` ou `lens`), `order` (un nombre : dans le groupe les entrées vont par `order`, puis par id) et `icon` (l'intérieur d'un `<svg viewBox="0 0 24 24">`) |
| `page.title` | le titre de l'entrée de menu |
| `server` | une fonction qui importe l'entrée Node : `() => import("./server/index.js")` |
| `settings` | facultatif : les variables `LENS_…` du module, `[{ name, label, help, kind, placeholder? }]` ; voir [Les réglages d'un module](#les-réglages-dun-module). Pour `num` : `min` et `max`, entiers |
| `mcp` | facultatif : fonction qui importe les outils MCP, `() => import("./mcp/tools.js")` ; voir [Les outils MCP d'un module](#les-outils-mcp-dun-module) |
| `mcpTools` | avec `mcp` : les noms des outils que le module offre, par exemple `["security"]` |
| `mcpInstructions` | avec `mcp` : les lignes ajoutées aux instructions du serveur MCP tant que le module est actif. Elles arrivent à OpenCode en italien et ne sont pas traduites : leurs entrées dans les catalogues en/fr n'existent que pour le scanner des textes |
| `mcpExamples` | avec `mcp` : les questions que Paramètres › Serveur MCP suggère pour ses outils, seulement tant que le module est actif |
| `mcpPrompts` | avec `mcp` : `true` si le fichier `mcp` exporte aussi `prompts(kit)`, les prompts du module (dans OpenCode, commandes `/lens:<id>`) ; voir [Les prompts MCP d'un module](#les-prompts-mcp-dun-module) |
| `notice` | facultatif : le texte (italien, traduit comme `description`) de l'avis « après une mise à jour » ; la carte et le bandeau l'utilisent à la place de la phrase générique. Dans `GET /api/modules` c'est `noticeMessage` |
| `settingsPanel` | facultatif : le nom d'un fichier `.js` du dossier `public/` du module (`^[a-z0-9-]+\.js$`) ; voir [Le panneau dans la carte](#le-panneau-dans-la-carte) |
| `widgets` | facultatif : de 1 à 12 widgets que le module offre au dashboard, `[{ type, label, description, size, min, home, settings?, data }]` ; exige `widgetsFile` ; voir [Les widgets d'un module](#les-widgets-dun-module) |
| `widgetsFile` | facultatif : le nom d'un fichier `.js` du dossier `public/` du module (`^[a-z0-9-]+\.js$`) qui dessine les widgets ; voir [Les widgets d'un module](#les-widgets-dun-module) |
| `tables` | facultatif : fonction qui importe les tables du module, `() => import("./tables.js")` ; voir [Les tables d'un module](#les-tables-dun-module) |
| `source` | facultatif : `{ label }`, le module offre au dashboard une autre source de données ; voir [Une source alternative](#une-source-alternative) |

Dans le menu, les entrées des modules sont à la fin de leur groupe ; dans le groupe *Lens* elles viennent avant Paramètres.

### L'entrée Node

`server/index.js` exporte :

- `create(ctx)` : renvoie tout de suite (pas une promesse) un objet avec ce dont le module a besoin, le tout facultatif : `routes` (voir plus bas), `start()` et `stop()` (éventuellement asynchrones), `families()` (les familles de métriques pour `/metrics`). Si `create` ou `start` lèvent une exception, le module passe en `error` ;
- `hasData(ctx)` : facultative, dit si le module a déjà des données enregistrées et décide de l'avis après une mise à jour. Si elle lève une exception, elle vaut `false` ;
- `files(ctx)` : facultative, liste les fichiers que le module écrit, `[{ label, path, note }]` (`label` et `note` en italien, via `N_()`, `note` facultative). La lens les demande une fois au démarrage, même pour un module désactivé, et les montre dans **Paramètres › Données et fichiers** et dans le script de désinstallation (voir [disinstallazione.md](disinstallazione.md)). Comme le chemin finit dans un `rm -f`, il doit être **dans le dossier des données** (celui de la base) : une entrée sans `label`, avec un chemin relatif, hors du dossier ou égale au dossier lui-même est écartée avec un avertissement dans le log. Avec `LENS_DB=:memory:` il n'y a pas de dossier des données et aucun fichier n'est accepté ; un `files()` qui lève une exception ne donne rien. Une entrée avec `kind: "read"` déclare en revanche un chemin que le module **lit seulement** (Sécurité, les dossiers des guards) : ce peut être **n'importe quel chemin absolu**, même hors du dossier des données, car la lens ne l'écrit ni ne le supprime jamais. Il apparaît dans **Données et fichiers**, parmi les fichiers lus et seulement tant que le module est actif, et **n'entre pas** dans le script de désinstallation. Un `kind` autre que `write`, `read` ou `dir` écarte l'entrée, avec un avertissement dans le log. Si les réglages du module ne sont pas valides (voir [Les réglages d'un module](#les-réglages-dun-module)), `files()` n'est pas demandée. Une entrée avec `kind: "dir"` déclare un **dossier** dans le dossier des données (Skill : la bibliothèque `skills/`) : elle apparaît dans **Données et fichiers** et le script de désinstallation le supprime avec `rm -rf` ; hors du dossier des données elle est écartée avec un avertissement, comme une `write`. Le noyau garde pour lui quelques fichiers et dossiers (`CORE_FILES` et `CORE_DIRS` dans `src/core-paths.js` : la base avec `-wal` et `-shm`, les fichiers de la disposition et des modèles du dashboard, `update/`) : une entrée, `dir` comprise, qui est égale à l'un d'eux, ou qui se trouve dans un dossier du noyau, est écartée avec un avertissement. Si deux modules déclarent le même chemin la lens avertit et ne le liste qu'une fois.
- **`start()` a un temps maximal.** Un `start()` asynchrone a 10 secondes (`START_TIMEOUT_MS`) : au-delà, le module passe en `error` (« start() n'a pas fini en 10 s »), le registre appelle `stop()` et le serveur démarre quand même. Un temps maximal n'arrête pas du code synchrone : le travail lourd se planifie (`setTimeout(…, 0)`) et `start()` rend la main aussitôt, comme le fait Bob avec sa première lecture.
- En plus de ceux-ci, l'objet renvoyé par `create` peut avoir `status()`, `state()` et `source()` : voir [Une source alternative](#une-source-alternative) et [État dans /api/status et /healthz](#état-dans-apistatus-et-healthz).

#### Les routes

`routes` est un objet `{ "<MÉTHODE> <chemin>": … }`. Le chemin commence par `/api/`, et les routes passent par les contrôles d'hôte, de token et de méthode comme chaque route du cœur. Une route déjà prise par le cœur ou par un autre module n'est pas écrasée ; une clé ou une valeur invalide est écartée avec un avertissement, sans arrêter le module. Trois formes :

| Clé | Valeur | |
|---|---|---|
| `GET /api/x` | `(req, { url, local, rest }) => réponse` | chemin exact ; `rest` vaut `undefined`. Répond aussi à `HEAD` |
| `GET /api/x/*` | idem | préfixe : chaque chemin **sous** `/api/x/` (pas `/api/x`). Un chemin exact l'emporte sur un préfixe |
| `POST /api/x` | `{ handler, body: { type: "json", max }, what }` | chemin exact. `handler(req, { url, local, body })` reçoit le JSON déjà lu |
| `POST /api/x/*` | comme ci-dessus | préfixe, avec `rest` comme pour les `GET` (déjà décodé ; `null` pour un encodage cassé, que le module refuse ; `""` pour `POST /api/x/`) |
| `POST /api/x` avec `body: { type: "raw", types, max }` | `handler(req, { url, local, body, rest })` | corps non JSON : `body` est un `Buffer` ; voir ci-dessous |

- **`rest`** est ce qui suit le préfixe, **déjà décodé** : il peut contenir `/` et `..`, donc ne jamais l'utiliser tel quel comme chemin de fichier. Pour `/api/x/` il vaut `""` ; avec un encodage cassé (`%zz`) il vaut `null`.
- **`what`** dit ce qui est modifié (`N_("i progetti")`), pour les messages de refus. `body.max` est la limite du corps en octets, un entier de 1 à 16 Mio : c'est le cœur qui l'impose, pas le module. Avant le `handler` le POST passe par les mêmes contrôles que les autres écritures : loopback uniquement, `Origin`, `content-type: application/json`, token. Avec `body: { type: "raw", types: [...], max }` le corps n'est pas du JSON mais des octets (Skill : le zip d'une skill ou un `SKILL.md`) : `types` liste les content-type admis ; `type` vaut `"json"` s'il manque. Le registre refuse dans `types` les types qu'un navigateur envoie sans preflight (`text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`), les jokers et les valeurs vides, si bien que la défense contre les requêtes d'autres sites reste « content-type non admis par CORS ». Le noyau ne compare que le media type, sans tenir compte de la casse et sans paramètres ; un autre type reçoit un 415 avec un texte traduit, un corps au-delà de `max` un 413 avec `connection: close`, et `writeRefusal` (loopback, `Origin`, token) passe avant la lecture du corps. Les règles des chemins du noyau valent aussi pour les `POST`, à préfixe ou non.
- **La réponse** : un objet simple est un `200` en JSON ; pour un autre statut on renvoie `ctx.reply(statut, corps)` (`ctx.reply(404, { error })`, `ctx.reply(400, { errors })`). Toute autre chose (ou une exception) est un `500` générique, avec l'erreur dans le log sous l'id du module.
- **Module désactivé** : un `GET`, `HEAD` ou `POST` sur ses routes donne 404 : les routes d'un module trouvé mais pas actif sont hors de la table du 405. Une requête autre que `GET` sur un chemin `/api` que ni le noyau ni un module actif ne sert donne 404 (un chemin du noyau avec une mauvaise méthode reste 405).
- **Les textes** : un `what` et chaque texte que montre le code Node du module passent par `const { t, N_ } = ctx.i18n` et par les appels **nus** `t("…")` et `N_("…")`, jamais `ctx.i18n.t("…")` : le scanner des traductions ne voit que les appels nus.

Le `ctx` est la seule porte vers le cœur (`src/module-kit.js`) et il est figé :

| Champ | |
|---|---|
| `id` | l'id du module |
| `env` | les variables d'environnement **que le module déclare dans `settings`**, plus `HOME` et `XDG_*` ; jamais les autres du noyau (`LENS_TOKEN`, mots de passe) |
| `paths` | les dossiers d'où partent les défauts : `home`, `opencodeConfigDir` (la configuration d'OpenCode) et `xdgData` (`$XDG_DATA_HOME` ou `~/.local/share`) ; `dataDir`, le dossier des données (celui de la base ; `null` avec `:memory:`), aussi dans le `ctx` de `configure` : la bibliothèque de Skill est `path.join(ctx.paths.dataDir, "skills")` |
| `settings` | les `values` que `configure(ctx)` a renvoyées au démarrage (voir [Les réglages d'un module](#les-réglages-dun-module)) ; `{}` sans `configure` |
| `dbPath` | le chemin de la base |
| `collector` | `state`, `status()` et `config.scanIntervalMs` |
| `store` | `counts()` |
| `meta` | `get(clé)` et `set(clé, valeur)` : petites valeurs du module, enregistrées sous `module:<id>:data:`, sans jamais toucher les clés du registre |
| `log` | `info`, `warn`, `error`, avec le préfixe `[<id>]` |
| `reader` | `get(sql, …valeurs)` et `all(sql, …valeurs)` : lectures de la base, voir plus bas |
| `sql` | les fragments SQL du cœur, à composer dans ses propres requêtes : `TS` (l'instant d'un step, un `COALESCE` de fin, dernier démarrage et démarrage : la forme sur laquelle sont les index de période) et `ST_TS` (idem avec l'alias `st`), `TOOL_TS` (l'instant d'un appel d'outil), `STEP_START` (le démarrage d'un step), `FOLDER` (le dossier de la session d'un step), `TOKENS` et `ST_TOKENS` (la somme des tokens, sans et avec l'alias `st`), `MODEL_KEY` (`provider/modèle`, avec `#variante` si ce n'est pas la variante de base), et `COLUMNS` (`steps`, `sessions`, `tools`, `prompts`, `runs` : les colonnes de ces tables, dans l'ordre du noyau, pour que les `SELECT` d'un module qui les présentent le respectent) |
| `time` | `periodBounds(type, maintenant, reset)`, `localDay(ts)`, `budgetDayOf(reset)`, `DAY_MS`, `MIDNIGHT` et `reset`, l'heure de changement de jour configurée (`LENS_RESET_HOUR`) |
| `tokensOf` | la fonction qui additionne les tokens d'une ligne, celle du cœur |
| `budgets.month(maintenant?)` | la consommation du mois face à `LENS_LIMIT_COST_MONTHLY` : `{ used, limit, ratio, projected, projectedRatio, pace }`, `null` si la limite n'est pas définie |
| `range(searchParams, { earliest }?)` | la période d'une requête `{ from, to }` comme la lisent les endpoints du cœur : `from=day` est le jour de budget (`to` est ignoré), sinon `from`/`to` en ms ; `from=0` est « tout », depuis la donnée la plus ancienne d'OpenCode ou, avec `earliest` (une fonction qui renvoie des ms ou `null`), depuis celle du module |
| `i18n` | `t`, `N_`, `Localized`, `errorText` : les traductions du cœur, dans la langue de la requête |
| `jsonStore({ name, validate, empty, what })` | un fichier JSON du module à côté de la base, sur le même mécanisme que les presets : `read()`, `write(doc)`, `path` et `badFile`. `name` est un nom qui finit par `.json`, comme `projets.json` (`^[a-z0-9][a-z0-9._-]*\.json$` : minuscules, chiffres, `.`, `_`, `-` ; jamais de dossiers), sinon il lève `TypeError`. Un fichier illisible donne `empty()`, un avertissement dans le log et une copie `.bad.json` qu'un enregistrement ne détruit pas ; avec `:memory:` le document reste en mémoire jusqu'au redémarrage. `what` vaut `{ broken, none, dropped }`, les trois phrases italiennes (accordées entre elles) avec lesquelles l'avertissement nomme le contenu : « <fichier> non è JSON valido: <broken> » et « <fichier> <none> (motifs): <dropped> ». `read()` et `write()` sont synchrones et sans cache : chaque `read()` relit et revalide le fichier, ce qui convient à de petits documents. À déclarer dans `files()`. Il refuse aussi les fichiers du noyau (`CORE_FILES` : la disposition et les modèles du dashboard, la base) : il lève `TypeError` |
| `writer` | seulement avec `tables` : `statement(sql) → { run, get, all }` et `tx(fn)` ; voir [Écrire dans ses propres tables](#écrire-dans-ses-propres-tables) |
| `readers` | les lecteurs incrémentaux du noyau : `define`, `Watermark`, `contractMisses` et `adopt(reader, reset)`, qui garde la version du lecteur dans `ctx.meta` (`module:<id>:data:<metaKey>`) : au premier démarrage d'un module qui adopte un lecteur, sa source est relue une fois (les upserts sont idempotents) |
| `live` | `changed(payload)` : prévient les dashboards ouverts d'un changement du module (le type de modification est l'id du module) ; `feed(item)`, seulement avec `source` : une ligne d'« activité récente », marquée de la source |
| `reply(statut, corps)` | (le corps est un objet simple) la réponse avec un statut autre que 200 |
| `zip` | `readEntries`, `entryData`, `extractPlan`, `planEntries` et `ZipError` : la lecture des zip et le plan d'extraction du noyau (les fonctions de `src/zip.js` et `src/update.js`, mêmes signatures), pour un module qui importe des archives. `CORE_FILES` et `CORE_DIRS` valent pour ce qu'un module déclare (`files()`, `ctx.jsonStore`), pas pour les écritures : `extractPlan` écrit là où on lui dit |
| `skillLoads` | `record(payload) → { rows }` : valide une livraison du MCP (`{ id, channel, preset, sessionId?, skills, at }`) et l'écrit dans `skill_uses`, sans jamais compter deux fois le même `id`. Un payload invalide lève une erreur avec `errors` (une liste de textes : le module répond 400). Chaque module l'a, mais la table reste du noyau, qui continue de la remplir même avec Skill désactivé. Le noyau ne vérifie pas l'id du module qui l'utilise : le code d'un module est du code Node de confiance |
| `prices` | la liste de prix globale (`LENS_MODEL_PRICES`), figée et toujours présente : `empty` (`true` sans prix), `of(modèle) → { input, output, cacheRead, cacheWrite }` ou `null` (une variante `provider/modèle#variante` a le prix du modèle de base) et `estimate(modèle, genres) → nombre` ou `null`, avec `genres` comme les donne `tokensOf` (`{ input, output, reasoning, cacheRead, cacheWrite }`). Les prix sont en dollars par million de tokens ; le raisonnement se paie comme la sortie ; sans prix le résultat est `null`. Elle ne compte que les steps, comme le dépensé, sans les tâches internes |

#### Lire la base : `ctx.reader`

Un module n'ouvre pas la base, n'appelle pas `.prepare(` et n'utilise pas `store.db` (`test/db-owner.test.js` le contrôle sur `modules/<id>/server/`) : il lit avec `ctx.reader.get(sql, …valeurs)` et `ctx.reader.all(sql, …valeurs)`, en lecture seule sur la connexion de la lens. Les règles :

- **Seulement `SELECT` et `WITH … SELECT`**, une seule instruction. Il refuse un texte qui commence par autre chose (`INSERT`, `UPDATE`, `DELETE`, `ATTACH`, `PRAGMA …`), qui contient un `;` hors d'une chaîne (aussi dans un commentaire : SQLite ne compilerait que la première instruction) ou dont la compilation ouvre une table en écriture (par exemple un `WITH … INSERT`, vérifié avec `EXPLAIN` avant l'exécution). Le refus est une `Error` ordinaire, « ctx.reader: solo letture », et la base reste comme elle était.
- **Chaque exécution est sous `PRAGMA query_only`**, remis à 0 aussitôt après, même en cas d'exception : certaines instructions écrivent sans que `EXPLAIN` le montre (les fonctions de table des pragmas, comme `pragma_optimize`, lancent un `ANALYZE`) et SQLite les refuse. Ce refus aussi est « ctx.reader: solo letture ».
- **Dans le texte SQL seulement des constantes** : les valeurs variables passent en paramètres (`?`), jamais concaténées. Chaque texte distinct est préparé une fois et gardé en cache, jusqu'à **256 textes** par `ctx.reader` ; au-delà, un nouveau texte lève « ctx.reader: troppe istruzioni diverse ». Interpoler une valeur dans le texte (un id, une date) remplirait le cache et serait une injection SQL.
- **Les listes de valeurs** (ids, noms) passent comme **un seul paramètre JSON** : `WHERE name IN (SELECT value FROM json_each(?))` avec `JSON.stringify(liste)`. Jamais un `IN (?, ?, …)` aussi long que la liste : chaque longueur serait un texte différent et remplirait le cache. Le texte SQL de chaque requête est **un seul, fixe**.
- **Pour les périodes** on utilise `ctx.range`, `ctx.time` et les fragments de `ctx.sql`, pour que les requêtes lisent avec les mêmes index que le cœur (dans les tests, `check`, `rangeKeys` et `recorded` de `test/module-test-kit.js` vérifient que le plan d'une requête utilise ces index).

### Les tables d'un module

Un module qui enregistre des données propres dans la base de la lens déclare ses tables : le manifeste a `tables: () => import("./tables.js")` et `tables.js` (sans import, comme le manifeste) exporte par défaut `{ version, sql, columns? }`.

- **`version`** : un entier ≥ 1.
- **`sql`** : les instructions qui créent les tables. La liste est fermée : `CREATE TABLE IF NOT EXISTS <id>_…` et `CREATE [UNIQUE] INDEX IF NOT EXISTS <id>_… ON <id>_…`, rien d'autre. Hors littéraux et commentaires, les mots `REPLACE`, `REFERENCES`, `TEMP`, `TEMPORARY`, `VIRTUAL`, `AS SELECT`, `AUTOINCREMENT`, `TRIGGER`, `VIEW`, `PRAGMA`, `ATTACH`, `DROP`, `DELETE`, `UPDATE` et `INSERT` sont refusés. Tables et index portent le préfixe `<id>_` (avec l'id `bob` : `bob_`) et ne peuvent pas être des tables ou index du noyau, quel que soit leur préfixe. C'est pourquoi un module avec des tables a un id fait seulement de minuscules et de chiffres (`^[a-z][a-z0-9]*$`) : un id avec un tiret ne peut pas servir de préfixe et les tables sont refusées.
- **`columns`** : `{ table : { colonne : "TEXT" | "INTEGER" | "REAL" | "BLOB" } }`, les colonnes qu'une version précédente des tables n'avait pas : elles s'ajoutent avant les index qui les utilisent. Seulement des tables créées par `sql` et des colonnes présentes dans leur `CREATE TABLE`.

Le contrôle (`src/module-tables.js`, avec le scanner de littéraux et de commentaires de `src/sql-text.js`) exécute `sql` deux fois sur une base vide en mémoire : aucune erreur, `sqlite_temp_schema` vide, `user_version` 0, aucune clé étrangère, et chaque objet de `sqlite_schema` est une table ou un index avec le préfixe (les index automatiques sont admis). Un `tables.js` qui ne passe pas met le module en `error`, avec la raison.

Les tables se créent au démarrage, **même module désactivé** (ainsi ses données et son schéma suivent la lens), après la migration du noyau et avec un `SAVEPOINT` par module : d'abord les `columns` manquantes des tables déjà existantes, puis `sql`, puis la `meta` `module:<id>:schema` = `version` (une version enregistrée plus grande, par exemple après un retour à une lens précédente, reste telle quelle). Une erreur n'annule que ce module, qui passe en `error`. Lignes et tables ne sont jamais supprimées : désactiver le module, ou le retirer, laisse ses tables dans la base (voir [disinstallazione.md](disinstallazione.md)).

#### Écrire dans ses propres tables

`ctx.writer` n'existe que pour un module avec `tables`. C'est un filet contre les erreurs, pas un bac à sable : le code d'un module tourne dans le processus de la lens et pourrait faire autre chose.

- **`statement(sql)`** renvoie `{ run, get, all }` pour une instruction. **`tx(fn)`** exécute `fn` dans une transaction du Store (rollback si elle lève une exception). `fn` doit être synchrone : si elle renvoie une promesse (un thenable), la transaction est annulée et `tx` lève une exception, car la promesse écrirait hors de la transaction.
- **Refus** (une `Error` « ctx.writer : … ») : plus d'une instruction ; un texte qui ne commence pas par `INSERT` ou `UPDATE` (donc ni `DELETE`, `CREATE`, `PRAGMA`, ni `WITH … INSERT`) ; `REPLACE` (aussi `INSERT OR REPLACE`, qui supprime les lignes qu'il remplace) ; `pragma_` n'importe où dans le texte, même dans un littéral (`pragma_optimize` exécute un `ANALYZE` que `EXPLAIN` ne montre pas).
- **Contrôle sur le programme.** La lens compile l'`EXPLAIN` du texte et refuse tout `OpenWrite` qui n'est pas sur la base `main` (`p3 = 0`), sur une page racine donnée comme telle (`p5 & 0x10` éteint) ou hors des tables créées par le `sql` du module et de leurs index, ainsi que les opcodes `VUpdate`, `Program` et ceux de schéma (triggers, actions des clés étrangères, tables virtuelles).
- Comme pour `ctx.reader` : seulement des constantes dans le texte, les valeurs en paramètres, au plus 256 textes différents. Le SQL d'écriture est dans `modules/<id>/server/writes.js`, le seul fichier d'un module exempté de la règle R5 de `test/db-owner.test.js` (et seulement pour les modules avec `tables.js`).

### Les réglages d'un module

Un module qui a besoin de variables d'environnement les déclare dans le manifeste :

```js
settings: [{ name: "LENS_SECURITY_DIRS", label: "Cartelle degli audit dei guard", help: "separate da :, in sola lettura", kind: "text" }],
```

- **`name`** est une variable `LENS_…` (majuscules, chiffres, `_`). Elle ne peut pas être une variable du noyau, ni une déjà déclarée par un autre module, ni répétée : le manifeste n'est pas valide et le module passe en `error`. `label`, `help` et `kind` sont obligatoires (textes en italien, pour `N_()`) ; `kind` vaut `text`, `num` ou `secret` ; `placeholder` est facultatif.
- **Limites des nombres.** Un réglage `num` accepte `min` et `max` (entiers, `min ≤ max`) : `GET /api/modules` les passe à la carte, qui les contrôle comme les plages du noyau, et `configure` les recontrôle côté serveur. La valeur par défaut s'affiche en `placeholder`.
- **Une fois déclarée, la variable est connue de la lens** même module désactivé : ce n'est jamais une « faute de frappe » dans le log et sur la page Paramètres. Elle n'apparaît pas dans le tableau des variables du noyau (et `--help` ne les liste pas : elles sont dans le manifeste du module et dans sa carte de **Paramètres › Modules**, où on les modifie).
- **`configure(ctx)`** est un export facultatif de l'entrée Node (`server/index.js`). Elle reçoit `{ id, env, paths, i18n }` et ne peut rien lire ni écrire d'autre : `env` n'a que les variables que le module déclare plus `HOME` et `XDG_*`, `paths` a `home`, `opencodeConfigDir`, `xdgData` et `dataDir` (le dossier de la base, `null` avec `:memory:`). Elle renvoie `{ values, errors }` : `values` est un objet simple (chemins déjà absolus, nombres déjà des nombres), `errors` une liste de textes ou de `Localized`. Un `configure` qui lève une exception, ou qui ne renvoie pas `{ values, errors }`, est une erreur.
- **Qui l'appelle.** La lens l'appelle une fois au démarrage pour **chaque module trouvé, actif ou non**, et à chaque contrôle d'un enregistrement depuis Paramètres (avec l'environnement après l'enregistrement, seulement pour les modules actifs) : une mauvaise valeur se voit tout de suite, comme pour les variables du noyau, sans rien toucher. `ctx.settings` dans `create`, `hasData` et `files` est cet objet `values` lui-même (figé), pas `{ values, errors }`. Avec des erreurs, **le module est `unconfigured`** (la raison est dans la carte ; un `configure` qui lève une exception, ou qui ne renvoie pas `{ values, errors }`, le met en revanche en `error`), ne démarre pas, `hasData` vaut `false` et `files()` n'est pas demandée.
- **Dans la carte.** Chaque réglage a un champ dans la carte du module de **Paramètres › Modules** (`text`, `num` ou `secret`) et s'enregistre comme les autres variables : la lens redémarre. `GET /api/modules` ne donne la `value` et `isSet` qu'aux clients de cet ordinateur (depuis le réseau ils valent `null`, et le plist n'est même pas lu) ; d'un `secret` il donne seulement s'il est défini (`isSet`), jamais la valeur. Le plist n'est relu que quand il change. Un champ vide retire la variable et le défaut revient.
- **Lire les valeurs seulement depuis `ctx`.** Le module ne regarde pas `process.env`, qui contient aussi les variables du noyau : tout ce qu'il faut (dossiers par défaut compris) est dans `ctx.env` et `ctx.paths` (avec `dataDir`).

L'exemple complet est `modules/security/server/settings.js`.

### Le panneau dans la carte

Un module actif peut avoir un panneau à lui dans sa carte de **Paramètres › Modules**, sous les champs (IBM Bob : l'état de la lecture, les faits et les sondes). Le manifeste déclare `settingsPanel: "settings.js"`, un fichier de `public/` (`^[a-z0-9-]+\.js$`) qui exporte `mount(el, { status }) → { update(status) }`. La carte l'importe depuis `/modules/<id>/settings.js` et le monte une fois : l'élément reste le même d'un rendu à l'autre, et à chaque `/api/status` la carte appelle `update(status[<id>])`, le bloc du module (voir plus bas). Si l'import ou `mount` échouent, la carte dit « panneau indisponible ».

### Les widgets d'un module

Un module peut offrir des widgets au dashboard : ils apparaissent dans **Ajouter** de l'éditeur à côté de ceux du noyau (voir [dashboard.md](dashboard.md#modifier-la-disposition)) et se placent, se redimensionnent et se configurent comme les autres. Le manifeste a deux champs, `widgets` et `widgetsFile`, qu'une feuille sans import (`src/module-widget-fields.js`) juge avec le reste : un champ erroné est une erreur de manifeste et le module passe en `error`, avec le motif.

```js
widgetsFile: "widgets.js",
widgets: [{
  type: "mio-modulo-oggi", label: "Il mio indicatore", description: "Un numero del modulo, con il periodo",
  size: [4, 4], min: [3, 3], home: "both",
  settings: { title: null, range: ["dashboard", "day", "86400000"] },
  data: ["/api/mio-modulo/stato?from={from}"],
}],
```

- **`widgetsFile`** est obligatoire avec `widgets` : le nom d'un fichier `.js` du dossier `public/` du module (`^[a-z0-9-]+\.js$`), servi depuis `/modules/<id>/<fichier>`.
- **`widgets`** est une liste de 1 à 12 entrées. Chaque entrée a :
  - `type` : `<id>-<nom>`, soit l'id du module, un `-` et un nom ; le type entier, préfixe `<id>-` compris, suit `^[a-z][a-z0-9-]*$` et fait au plus 31 caractères (la limite qu'une disposition enregistrée met à un type) ; ce n'est pas un type du noyau, il n'est pas déclaré par un autre module et ne se répète pas ;
  - `label` et `description` : deux textes non vides, en italien. La page les reçoit tels quels, avec le `name` du module, et les traduit dans le navigateur avec le catalogue du module (`public/lang-<langue>.js`, fusionné avec celui du noyau), comme ses propres textes : l'ouverture de la page ne dit pas la langue au serveur. Le catalogue d'un module désactivé ne se charge pas (`/modules/<id>/…` n'est servi que si le module est actif) : son nom reste en italien ;
  - `size` et `min` : `[largeur, hauteur]` entiers, largeur de 1 à 12 et hauteur de 1 à 40, avec `min` non supérieur à `size` dans les deux dimensions. `size` est la taille d'un widget qu'on vient d'ajouter, `min` la plus petite à laquelle on peut le réduire ;
  - `home` : la vue où l'éditeur le propose, `adesso`, `analisi` ou `both` ;
  - `settings` (facultatif) : les réglages du ⚙. `title: null` donne le titre modifiable ; toute autre clé (lettres et chiffres, commence par une minuscule) est une liste de 1 à 20 textes distincts non vides, les valeurs que l'utilisateur peut choisir. En dehors de `title` et `range`, une clé ne peut pas être l'une de celles qu'utilise un widget du noyau (`metric`, `by`, `source`, `model`, `sort`, `style`…) : pour le ⚙ et pour la grille elles veulent déjà dire autre chose. La clé `range` n'admet que les périodes du dashboard (`dashboard`, `day`, `3600000`, `28800000`, `86400000`, `604800000`, `2592000000`, `0`), et `dashboard` n'est admis dans aucune autre clé. Le panneau ⚙ montre les clés dans l'ordre déclaré, nommées `t(clé)` et chaque valeur en `t(valeur)` : clés et valeurs se traduisent avec le catalogue du module ;
  - `data` : de 1 à 4 chemins `/api/…` que le widget lit, sans `..`, `#` ni espaces, avec au plus un marqueur `{from}` ; toute autre accolade est refusée, ainsi que `%2e`, `%2f` et `%5c` (un point, une barre oblique ou une barre oblique inverse encodés), en majuscules ou en minuscules.
- **`data` et les routes du module.** Un widget lit l'API de son propre module : au démarrage, un widget dont un chemin n'est pas une route `GET` du module lui-même (requête et `{from}` mis à part) est écarté avec un avertissement dans le journal, et le module reste actif. Pour un module actif, `GET /api/modules` donne les widgets restants. Un widget écarté reste dans la disposition et dit à sa place « Le widget {type} lit {chemin}, qui n'est pas une route GET de son module », sans aucune requête. Les chemins des widgets passent par les contrôles d'hôte et de jeton comme toute route.
- **`{from}`** est remplacé par le début de la période du widget, comme le `from` des endpoints du noyau : `day` pour le jour de budget, sinon les millisecondes de l'instant initial, et `0` pour « tout ». La période est celle choisie dans le ⚙ du widget ou, avec `dashboard`, celle de la vue. La route la lit avec `ctx.range` ([Les routes](#les-routes)).

**Le fichier des widgets.** Il exporte les moteurs de rendu par type, `{ mount(root, ctx), update(root, ctx) }` : de préférence en `export default { "mio-modulo-oggi": { mount, update } }` ; les exports nommés (`export { dessin as "mio-modulo-oggi" }`) conviennent aussi, mais s'il y a un `export default`, c'est lui qui l'emporte. Le fichier n'importe du noyau que `"/module-kit.js"` (voir [Les fichiers du navigateur](#les-fichiers-du-navigateur)).

- `mount(root, ctx)` est appelé une fois, sur une carte vide : il construit le balisage dans `root`. `update(root, ctx)` est appelé à chaque mise à jour, quand toutes les données déclarées dans `data` sont arrivées.
- `resize(root, ctx)` est facultatif : avec lui le dashboard observe la taille de la carte, comme pour un widget du noyau, et la redessine avec `update` quand elle change. La fonction n'est pas appelée : ce qui compte, c'est qu'elle soit là.
- **Pas de minuteries.** Un widget de module ne lance ni minuteries ni lectures à lui : la grille appelle `update` à chaque mise à jour du dashboard. Un `ctx.live.changed()` du module fait relire les chemins de ses widgets à l'écran (dans Maintenant seulement ceux-là, avec les autres du changement), puis la grille appelle `update`.
- Le `ctx` est gelé et a cinq champs : `widget` (une copie gelée du widget enregistré, avec `id`, `type`, position et `settings`), `title` (le titre déjà décidé : celui de l'utilisateur ou le `label`), `settings` (les réglages du widget, plus le `range`, la `metric` et le `by` déjà résolus avec ceux de la vue : `range` vaut `"day"` ou un nombre de millisecondes, `0` pour « tout »), `data(chemin)` et `inst`, un objet de la carte qui reste le même d'un `update` à l'autre (pour y garder un état). Le titre, c'est le module qui le dessine : un élément avec `data-part="title"` dans le balisage de `mount` est mis à jour par le dashboard quand `title` change.
- `ctx.data(chemin)` ne répond qu'aux chemins déclarés dans `data`, écrits comme dans le manifeste (avec `{from}`) ou déjà résolus ; pour tout autre chemin il donne `undefined`. Le corps renvoyé est le JSON de la réponse.
- **Valeurs par référence.** `settings`, `widget` et les données ne se modifient pas : le gel est superficiel et les données sont les mêmes objets que lisent les autres cartes.

**Quand il ne se dessine pas.**

- **Un fichier qui ne se charge pas.** La page reçoit dans une balise JSON (`lens-module-widgets`, dans l'en-tête) la liste des widgets de chaque module qui en déclare, et n'importe le fichier que des modules **actifs**, tous à la fois. Un fichier qui ne s'importe pas (erreur de syntaxe, 404) ou qui ne se termine pas en 5 secondes laisse ces types « non chargés », avec l'erreur seulement dans la console : le dashboard démarre quand même et les cartes de ce module disent « Widget du module {nom} non chargé ». Il en va de même pour un type que le fichier ne dessine pas avec `mount` et `update`. Les autres modules n'en pâtissent pas.
- **Un `mount` ou un `update` qui lève une exception** montre « Données indisponibles » dans cette carte, avec le message dans l'infobulle ; les autres cartes continuent. « réessayer » recharge les données mais ne remonte pas la carte : après un `mount` en échec, on recharge la page.
- **Une lecture qui échoue.** Si la requête d'un chemin déclaré échoue, la carte montre « Données indisponibles » avec l'erreur dans l'infobulle et `update` n'est pas appelé.
- **Un widget écarté au démarrage** (voir `data` plus haut) dit quel chemin n'est pas une route `GET` de son module.
- **« {source} seul ».** Avec la source d'un autre module choisie seule, les widgets du noyau sans données de cette source le disent ; un widget de module, non : ses données sont celles du module, pas d'OpenCode, et il se dessine comme toujours.
- **Module désactivé, en erreur ou à configurer.** Le widget reste dans la disposition enregistrée, avec sa position et ses réglages, et montre à sa place « Le module {nom} est désactivé : activez-le depuis Paramètres › Modules » (ou « est en erreur » / « est à configurer : voir Paramètres › Modules »), sans aucune requête. En réactivant le module, le widget revient tel qu'il était ; enregistrer la disposition depuis l'éditeur ne le retire pas. Un module dont le manifeste ne se charge pas (par exemple il demande une lens plus récente) dit aussi « est en erreur » : sans manifeste où lire le nom, à la place du nom figure l'id du module.
- **Un module retiré.** Le type que plus personne ne déclare reste dans la disposition, non dessiné, comme un type inconnu d'une version plus récente.
- **Dans l'éditeur**, « Ajouter » liste les widgets des modules actifs dont le fichier s'est chargé, après ceux du noyau, avec l'étiquette « module {nom} », dans la vue donnée par `home` ; dans la vue Monitor, aucun. Les widgets du noyau s'écoulent autour de ceux des modules, qui restent où ils sont : dans le calcul de la disposition ce sont des obstacles fixes et « Compacter » ne les fait pas monter. Ils ne se déplacent et ne se redimensionnent que directement.

**Hors périmètre.** Les styles multiples, la Galerie, la vue Monitor et les modèles de dashboard avec des widgets de modules n'existent pas encore.

**Pas de sandbox.** Le code navigateur d'un module tourne dans la page, sans isolation : les limites du `ctx` sont au niveau de l'API (un module ne reçoit pas par erreur les données des autres), pas une frontière de sécurité. Il en va comme du code Node des modules : le code d'un module est un code de confiance.

### Les outils MCP d'un module

Un module peut offrir des outils au serveur MCP (`opencode-lens mcp`), qu'OpenCode montre avec le préfixe `lens_` (l'outil `security` devient `lens_security`).

- **Le manifeste** déclare `mcp: () => import("./mcp/tools.js")`, `mcpTools` (les noms), `mcpInstructions` (les lignes pour les instructions du serveur) et `mcpExamples` (les questions suggérées dans Paramètres › Serveur MCP). Les champs `mcp`, `mcpTools`, `mcpInstructions`, `mcpExamples` et `mcpPrompts` sont validés par une feuille sans import, `src/module-mcp-fields.js` : par le registre (un champ faux est une erreur de manifeste et le module passe en `error`) et par le processus MCP (le module est ignoré avec un avertissement sur stderr, jamais avec le texte « désactivé »).
- **`mcp/tools.js`** exporte `tools(kit)`, qui renvoie la liste des outils `{ name, title, description, inputSchema, run(args, ctx) }`, faits comme ceux du noyau. Les fichiers de `mcp/` n'importent **rien** : tout ce qu'il leur faut vient du `kit` que le processus MCP leur passe (`argSpec`, `SINCE`, `SINCE_LABEL`, `withLens`, `resolve`, `project`, `LensError`, `ToolError`, `now` et `text` avec `cleanName`, `cleanText`, `num`, `pct`, `plural`, `when` ; `createToolKit` dans `src/mcp/module-kit.js`). Le processus MCP ne charge ni `node:sqlite` ni `src/server.js`, et l'outil ne parle à la lens que par son API HTTP (pour Sécurité, `/api/security`). Un nom déjà pris par un outil du noyau, ou déclaré dans `mcpTools` par un autre module, est écarté avec un avertissement sur stderr (le noyau gagne, puis le premier module par id) ; un outil non déclaré dans `mcpTools` est écarté.
- **Quels outils se voient.** Le processus MCP lit les manifestes de `modules/` et du dossier des modules de l'utilisateur (le dossier `modules/` à côté du `LENS_DB` du plist du service, calculé par le processus MCP et non repris de la réponse de `GET /api/modules` ; lu une seule fois, au démarrage : un nouveau module de l'utilisateur apparaît en redémarrant OpenCode ; avec une lens lancée à la main et `LENS_DB` seulement dans le shell, le plist ne l'indique pas et le dossier par défaut s'applique. Un id égal à celui d'un dossier de `modules/` de la lens est écarté avec un avertissement sur stderr avant d'importer son `module.js`, et un id dans `shadowed` perd ses outils. Un lien symbolique vers un dossier compte comme un module), demande à la lens `GET /api/modules` au démarrage (`initialize` attend une seconde au plus) puis toutes les 30 secondes, et ne liste que les outils des modules **actifs**. Tant qu'il n'a pas eu de réponse il ne liste aucun outil de module ; après la première, si la lens ne répond plus, **le dernier état connu reste**. Quand la liste change il envoie `notifications/tools/list_changed`.
- **Un outil d'un module qui n'est pas actif** ne disparaît pas avec une erreur générique : il répond par un texte qui dit pourquoi : « Il modulo <Nom> è spento in Lens: attivalo da Impostazioni › Moduli. », « Il modulo <Nom> è in errore in Lens: vedi Impostazioni › Moduli. » ou « Il modulo <Nom> è da configurare in Lens: vedi Impostazioni › Moduli. » (les textes restent en italien, comme tout ce que le MCP envoie à OpenCode). Il en va de même pour `prompts/get`.
- **OpenCode ne relit pas la liste.** Vérifié avec OpenCode 2.0.26 : après `notifications/tools/list_changed` OpenCode ne redemande **pas** les outils, et ne lit les instructions du serveur qu'une fois. Quand vous activez ou désactivez un module avec des outils, OpenCode continue donc d'afficher **l'ancienne liste et les anciennes instructions jusqu'à ce que vous le redémarriez**. Appeler un outil d'un module désactivé entre-temps donne le texte ci-dessus ; l'outil d'un module qui vient d'être activé n'apparaît dans OpenCode qu'après le redémarrage. La carte du module le rappelle par une note ; la notification sert aux clients qui la respectent.

### Les prompts MCP d'un module

Un module peut aussi offrir au serveur MCP des **prompts**, qu'OpenCode montre comme commandes `/lens:<id>`. Le manifeste déclare `mcpPrompts: true` et le fichier `mcp` du module (le même que celui des outils) exporte, en plus de `tools(kit)`, `prompts(kit)`, qui renvoie une `PromptSource` :

| Méthode | |
|---|---|
| `list(signal)` | `{ prompts: [{ id, name, brief }], snapshot }` : les prompts du module, plus un texte qui change quand ce que le client a lu change |
| `get({ name, skill }, signal, ctx)` | `{ description, text }` : le prompt choisi. Pour un nom inconnu il lève `kit.PromptNotFoundError`, que le noyau traduit par `-32602` |
| `instructions(signal)` | `string[]` : les lignes que le module ajoute à la fin des instructions du serveur |
| `snapshot(signal)` | seulement le `snapshot` d'aujourd'hui, pour la surveillance, sans lister les prompts |

Le `kit` a en plus `PromptNotFoundError`, `connect`, `randomUUID`, `PROMPT_BRIEF_MAX` (le plafond du brief dans le protocole) et, dans `text`, `cleanBlock` et `safePath`. Le noyau (`src/mcp/prompts.js`) réunit les sources des modules actifs :

- Un nom déjà pris par un module précédent (par id) est écarté avec un avertissement sur stderr ; un module qui échoue ne vide pas les autres.
- Toutes les 30 secondes le processus MCP rafraîchit d'abord les modules, puis compare le `snapshot` du dernier `list` servi au client avec `snapshot(signal)` et envoie `notifications/prompts/list_changed` s'ils diffèrent. La notification part aussi quand l'ensemble des modules avec prompts change. Une lens arrêtée pendant que le client lisait est annoncée à son retour ; une lens qui revient avec zéro preset peut envoyer une notification de plus.
- Un `prompts/get` d'un module désactivé, en erreur ou à configurer répond par les mêmes trois textes que les outils.
- **Les instructions** suivent cet ordre : l'en-tête et les outils du noyau, les `mcpInstructions` des modules actifs, le reste du noyau et, après une ligne vide, les lignes de `instructions(signal)` des modules actifs. Ces dernières sont asynchrones : `initialize` ne les attend que peu (3 secondes au plus) et n'échoue jamais parce qu'une lens est arrêtée. Avec une lens arrêtée à un démarrage à froid, les lignes des modules n'apparaissent qu'à partir du moment où leur état est connu.

Contrairement aux outils, les prompts suivent `prompts/list_changed` : activer ou désactiver Skill fait apparaître ou disparaître les commandes `/lens:<id>` dans OpenCode sans redémarrage.

### Une source alternative

Un module peut offrir au dashboard une autre source de données (aujourd'hui IBM Bob) : le manifeste a `source: { label: "Bob" }` et l'instance renvoyée par `create` expose `status()` (obligatoire avec `source`) et `source() → { selects, only?, add?, totals, earliest }` :

- **`selects`** : `{ steps, sessions, tools, prompts, runs }`, une `SELECT` (ou `WITH … SELECT`) chacune, qui présente les données du module avec les colonnes des tables du noyau, dans le même ordre (`ctx.sql.COLUMNS`). Dans « + », le noyau place chaque `select` dans une sous-requête (`SELECT * FROM (<select>)`) avant de l'unir aux lignes d'OpenCode : un `ORDER BY` ou un `LIMIT` au niveau le plus externe ne vaut que pour les lignes du module, jamais pour celles d'OpenCode.
- **`only`** (facultatif) : `{ limits, weeklyLimits, monthlyLimits, contextLimits }`, les budgets de « seul » ; **`add`** : `{ contextLimits }`, ajoutés à ceux d'OpenCode dans « + ».
- **`totals(from, to)`** : le bloc `<id>` ajouté à `/api/summary`. **`earliest()`** : la donnée la plus ancienne en ms ou `null`, pour `from=0`.

Le noyau (`src/source-views.js`) contrôle chaque `select` avec le scanner (une seule `SELECT` ou `WITH`), ouvre deux connexions en lecture seule avec des vues TEMP et essaie chaque vue avec `SELECT * FROM <vue> LIMIT 0`. Une erreur (dans `source()`, dans une `select` ou dans une vue) veut dire pas de source, un avertissement dans le log et le module en `error` avec la raison : jamais un démarrage raté. Au plus une source : avec deux modules actifs, le premier par id l'emporte et l'autre est ignoré avec un avertissement.

Le paramètre d'URL est l'id du module : `?bob=1` pour « + Bob », `?bob=only` pour « Bob seul », sur les endpoints qui travaillent sur les vues (la liste est dans [metriche.md](metriche.md#api-locale)) ; sans la source active, le paramètre est ignoré. Restent au noyau : quels endpoints en sont capables, le bloc `<id>` de `/api/summary`, le budget de « seul », l'union de `/api/runs/live` et les vues vides pour ce que la source n'a pas (`internal_usage`, `signals`, `permissions`, `daily_steps`, `daily_tools`). Dans « seul » `meta` n'a pas de `retention_from` (les jours élagués d'OpenCode n'entrent pas dans les chiffres de la source), `modelLimits` vaut `[]` et `opencodeModels` vaut `null`. `ctx.live.feed(item)` donne les lignes d'« activité récente » de la source.

Dans le navigateur le sélecteur est générique, « OpenCode · + {label} · {label} seul », et n'apparaît que si `/api/status` a le bloc de la source (voir [dashboard.md](dashboard.md#ibm-bob)).

### État dans `/api/status` et `/healthz`

Un module actif dont l'instance a `status()` ajoute `<id>: status()` au corps de `/api/status` ; avec `state()` (une lecture sans requête) il ajoute `<id>: state()` à `/healthz`. Le `problem` de `status()` (un `Localized` ou `null`) est la phrase du bandeau. Le registre capture par module : une exception s'écrit une fois dans le log et la clé manque, jamais un 500. Désactivé ou `unconfigured`, le module n'ajoute rien.

### Les ids réservés

Un id ne peut pas être (le module passe en `error`, avec la raison) : une page ou une vue du noyau ; une clé du corps de `/api/status` (`CORE_STATUS_KEYS` : les clés de `collector.status()` plus `lens`, `counts`, `ok`, `opencode`), car c'est là que le module met son bloc ; un type de modification du noyau (`CORE_CHANGE_KINDS` : `feed`, `step`, `tool`, `usage`, `signal`, `permission`, `status`, `session`, `scan`, `sync`), car `ctx.live.changed` l'utilise comme type ; et, pour un module avec `source`, un paramètre que le noyau lit (`SOURCE_RESERVED`) ou une clé de `/api/summary`. Les listes sont dans `src/core-paths.js` et les tests les vérifient contre le code.

### Les chemins du noyau

`src/core-paths.js` (`CORE_PATHS`) liste les chemins `/api` que le noyau sert : `exact` (les `GET`), `prefixes` (tout ce qui est dessous) et `writes` (les `POST`). Un module ne déclare pas de route sur l'un de ces chemins, avec **n'importe quelle méthode**, ni à l'intérieur d'un préfixe du noyau, ni avec un préfixe qui en couvre un : la route est écartée avec un avertissement dans le log. `test/core-paths.test.js` lit `src/server.js` et échoue si un chemin servi manque dans la liste, ou si un chemin de la liste n'est pas servi. Le même fichier liste `CORE_FILES` et `CORE_DIRS`, les fichiers et dossiers que le noyau écrit dans le dossier des données (voir [l'entrée Node](#lentrée-node)) ; le même test les compare à ce que le noyau écrit vraiment.

### Les fichiers du navigateur

Les pages des modules actifs sont servies depuis `/modules/<id>/<file>`. Dans le dossier `public/` du module, à plat (pas de sous-dossiers) :

- `page.js` exporte `page` (la page, comme les autres du director, voir [architettura.md](architettura.md#5-le-dashboard--styles-modèles-et-adaptateurs)) et `title` ;
- `page.html` est inséré dans le dashboard à la place du repère des modules ; `style.css`, s'il existe, est lié dans l'en-tête ;
- `lang-en.js` et `lang-fr.js` exportent par défaut le catalogue du module, fusionné avec celui du cœur ; un module sans catalogues s'affiche en italien. Les règles sont celles de [traduzioni.md](traduzioni.md).

Le code du navigateur importe du cœur **uniquement** depuis `"/module-kit.js"` (`t`, `tn`, `N_`, `esc`, `el`, `$`, `get`, `send`, `table`, `stateBox`, les formateurs et quelques autres). Les autres fichiers s'importent par des chemins relatifs. Il y a aussi `getLang` et `getLocale` (la langue et la locale du dashboard). Un fichier de `public/` que le côté Node du module importe aussi n'a pas d'imports : ce dont il a besoin, comme `t`, lui arrive en paramètre (`modules/vibecoding/public/vibe-projects.js`, `modules/skill/public/preset-rules.js`). Les règles CSS utilisées par au moins deux modules (Skill et Vibe Coding : `danger`, `fmenu`, `mix`, `vhero`, `vk`…) restent dans le CSS du noyau ; celles d'un seul module sont dans son `style.css`.

### Les règles des frontières

`test/module-boundaries.test.js` les vérifie :

- le cœur (`src/`, `public/`) n'importe rien de `modules/` et ne contient aucun marqueur d'un module (s'il en reste, ils sont dans une liste qui ne peut que raccourcir) ;
- un module n'importe que depuis l'intérieur de son dossier, depuis `node:*` et, seulement dans les fichiers de `public/` et `test/`, depuis `/module-kit.js` ; `module.js` n'a pas d'imports statiques ;
- le code de `server/` n'importe pas un fichier de `public/` qui utilise `/module-kit.js` ;
- les tests d'un module n'importent du cœur que `/module-kit.js` et `test/module-test-kit.js`.

### Essayer un module

Les tests d'un module sont dans `modules/<id>/test/` et n'importent du cœur que `/module-kit.js` et `test/module-test-kit.js`. Les tests d'un module de l'utilisateur, qui vit hors de l'app, importent le test kit avec le spécificateur absolu `"/module-test-kit.js"` (comme `"/module-kit.js"`, `test/module-hooks.mjs` le résout ; voir plus bas), jamais avec un chemin relatif vers l'app. Le test kit exporte ce qu'il faut pour essayer un module sur de vraies données : `memoryStore()` et les constructeurs `addSession`, `addStep`, `addTool`, `addPrompt`, `addRun`, `addInternal` (un store SQLite en mémoire), `moduleContext` (le vrai `ctx`, à construire avec `{ id, config, store, collector, queries, log }`), `Queries`, le contrôle des plans (`check`, `rangeKeys`, `recorded`) et, pour les outils MCP, `createToolKit` (le `kit` que reçoit `tools(kit)`), `createHandler` (le gestionnaire JSON-RPC qui les liste et les appelle) et les classes `LensError` et `ToolError`. Pour les pages du navigateur et les prompts MCP il ajoute `configure` et `rebuildFormats` (la langue dans les tests du navigateur), `catalogs()` (les catalogues du cœur fusionnés avec ceux du module), `createPromptAggregator`, `createPromptWatcher`, `instructionsWith` et `PromptNotFoundError`, plus `MAX_ID`, `PRESET_ID` et `SKILL_ID` pour comparer les ids d'un module à ceux du cœur. Pour les widgets il ajoute `widgetContext(spec, ctx)`, qui construit le `ctx` figé que le tableau de bord donne à `mount` et `update` (`spec` est l'entrée de `widgets` du manifeste, `ctx` celui de la grille avec `widget`, `title`, `settings`, `paths`, `data` et `inst`). Rien d'autre du cœur n'est accessible, exprès.

Le test d'un module se lance seul, mais il **faut** `--import ./test/module-hooks.mjs` : il fait résoudre `/module-kit.js` et `/module-test-kit.js` aussi sous Node, comme le fait le navigateur. Sans lui l'import échoue. `npm test` le passe déjà. Le test kit voyage aussi avec l'app installée (`test/module-test-kit.js`, `test/module-hooks.mjs` et les fichiers qu'ils importent, sous `~/Applications/opencode-lens/test/`) : les tests d'un module de l'utilisateur y tournent aussi, avec `--import <dossier de l'app>/test/module-hooks.mjs`.

```bash
node --disable-warning=ExperimentalWarning --import ./test/module-hooks.mjs --test modules/vibecoding/test/vibecoding-module.test.js
```
