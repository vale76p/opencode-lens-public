# Désinstallation complète

🌐 [Italiano](../disinstallazione.md) · [English](../en/disinstallazione.md) · Français

Ce guide supprime **toute trace** d'opencode-lens du Mac : service launchd, base de données, logs, dossier de l'app et données enregistrées par le navigateur. Il vaut pour les installations depuis un zip (`install.sh`) ou depuis un clone (`service install` ou `install.sh`) et pour le démarrage manuel avec `npm start`.

La lens ne touche pas à OpenCode : elle ne modifie ni sa config, ni les sessions, ni `service.json` (elle le lit seulement). Elle n'installe aucun paquet npm global, n'écrit pas dans `PATH`, n'utilise pas `sudo`. Le Node que `install.sh` télécharge quand il manque se trouve dans le dossier de l'app. Ce qui suit est tout ce qu'il y a à retirer. Les fichiers des modules (aujourd'hui ceux de Vibe Coding) sont dans le dossier des données, et figurent dans la liste des fichiers et dans le script de désinstallation de Paramètres même quand le module est désactivé. Les chemins qu'un module **lit seulement** (les dossiers des guards de Sécurité, `kind: "read"`) ne sont pas dans le script et la lens n'y touche jamais : même la désinstallation ne les supprime pas.

Les chemins exacts de votre installation sont dans la page **Paramètres** du dashboard (`http://127.0.0.1:4777/#impostazioni`), qui affiche aussi ces commandes déjà remplies. Ouvrez-la et notez-les **avant** de commencer : après l'étape 1, le dashboard ne répond plus.

## Ce que la lens écrit

| Quoi | Chemin par défaut | Créé par |
|---|---|---|
| LaunchAgent | `~/Library/LaunchAgents/local.opencode-lens.plist` | `service install` (aussi via `install.sh`) |
| Base de données SQLite | `~/Library/Application Support/opencode-lens/lens.db` | la lens, au premier démarrage |
| Fichiers WAL de la base | `lens.db-wal`, `lens.db-shm` dans le même dossier | SQLite, pendant que la lens tourne |
| Disposition du dashboard | `dashboard-v2.json` dans le même dossier (et `dashboard.json`, s'il vient d'une version précédente) | la lens, quand vous enregistrez « Personnaliser le dashboard » (seulement `dashboard-v2.json` ; au premier enregistrement avec des styles ou paramètres nouveaux, elle copie aussi `dashboard-v2.prev.json`, la disposition d'avant, voir [dashboard.md](dashboard.md#revenir-à-une-lens-plus-ancienne)) |
| Copies de sécurité | `backup/` dans le même dossier : base de données et plist | `install.sh`, avant chaque installation |
| Mises à jour | `update/` dans le même dossier : le zip chargé et extrait tant que vous ne l'installez pas, le log de la dernière mise à jour | la lens, depuis **Paramètres › Mise à jour** |
| Presets du dashboard | `dashboard-presets.json` dans le même dossier (et `dashboard-presets.bad.json`, la copie d'un fichier illisible) | la lens, quand vous enregistrez un preset depuis le menu « Modèle » |
| Bibliothèque de skills | `skills/` dans le même dossier (`skills/<id>/<n>/`, un dossier par version) et `skills.json`, l'index (et `skills.bad.json`, la copie d'un fichier illisible) | le module Skill, quand vous importez une skill depuis la page **Skill** (avec le module désactivé elle n'est jamais réécrite ; `skills/` est un dossier, c'est pourquoi le script utilise `rm -rf`) |
| Presets de skills | `skill-presets.json` dans le même dossier (et `skill-presets.bad.json`, la copie d'un fichier illisible) | le module Skill, quand vous enregistrez un preset depuis « Gérer les presets… » |
| Projets de Vibe Coding | `vibe-projects.json` dans le même dossier (et `vibe-projects.bad.json`, la copie d'un fichier illisible) | le module Vibe Coding, quand vous créez ou modifiez un projet |
| Usage des skills | la table `skill_uses` dans `lens.db` | la lens, même module Skill désactivé (les chargements qu'OpenCode fait de lui-même) ; le MCP avec Skill activé. Elle n'est pas à Skill : elle reste module désactivé et part avec la base |
| Tables des modules | tables `<id>_…` dans `lens.db` (pour IBM Bob `bob_tasks`, `bob_requests`, `bob_tools`), créées même module désactivé | les modules avec `tables`, voir [moduli.md](moduli.md#les-tables-dun-module). Désactiver un module ne les supprime pas : elles partent avec la base. Le `bob.db` d'IBM Bob n'est pas à la lens et n'est pas touché |
| Fichiers d'autres modules | ceux qu'un module déclare avec `files()`, toujours dans le dossier des données | le module, voir [moduli.md](moduli.md#lentrée-node) |
| Vos modules | `modules/` dans le même dossier : un sous-dossier par module | vous, voir [moduli.md](moduli.md#les-modules-de-lutilisateur). Ils survivent aux mises à jour ; `uninstall.sh` sans `--purge` n'y touche pas et, si le dossier existe, en indique le chemin |
| Logs | `~/Library/Logs/opencode-lens/lens.log` | launchd (stdout et stderr de la lens) |
| Dossier de l'app | `~/Applications/opencode-lens` pour l'installation depuis un zip, avec `node/` si `install.sh` a téléchargé Node ; ou là où vous avez cloné le dépôt | `install.sh`, ou vous |
| Préférences du dashboard | `localStorage` du navigateur, clés `lens:*`, origine `http://127.0.0.1:4777` | le dashboard |
| Cookie `lens_token` | navigateur, seulement si vous utilisez `LENS_TOKEN` | la lens |

Sur Linux (démarrage manuel), la base de données est dans `$XDG_DATA_HOME/opencode-lens/lens.db`, c'est-à-dire `~/.local/share/opencode-lens/lens.db` ; il n'y a ni LaunchAgent ni fichier de log (la lens écrit sur le terminal). Avec `LENS_DB` définie, la base est là où la variable le dit.

## 1. Notez le dossier de l'app

Le LaunchAgent sait de quel dossier part la lens. Lisez-le avant de le supprimer :

```bash
plutil -extract WorkingDirectory raw ~/Library/LaunchAgents/local.opencode-lens.plist
```

Si vous avez changé `LENS_DB` à la main dans le plist, lisez aussi celle-ci :

```bash
plutil -extract EnvironmentVariables.LENS_DB raw ~/Library/LaunchAgents/local.opencode-lens.plist
```

(« Could not extract value » signifie qu'elle n'est pas définie : le chemin par défaut s'applique.)

## 2. Arrêtez et retirez le service, la base de données et les logs

```bash
bash ~/Applications/opencode-lens/uninstall.sh --purge
```

Il utilise le Node du `PATH` ou, s'il manque, celui téléchargé par `install.sh`. Depuis un clone, depuis son dossier : `./uninstall.sh --purge` (c'est la même commande).

Si la commande n'existe plus, les mêmes étapes à la main :

```bash
launchctl bootout "gui/$(id -u)/local.opencode-lens"
rm -f ~/Library/LaunchAgents/local.opencode-lens.plist
rm -rf ~/Library/Application\ Support/opencode-lens ~/Library/Logs/opencode-lens
```

`--purge` ne supprime que les chemins par défaut (et avec eux le dossier `modules/` de vos modules, s'il est dans le dossier des données). Les lignes sur vos modules n'apparaissent que si le dossier `modules/` existe. Sans `--purge` le script affiche `I tuoi moduli restano in: <dossier>` (« vos modules restent dans »). Avec `--purge`, si le dossier était dans le dossier des données, la ligne finale devient « Database, dati dei moduli, i tuoi moduli, disposizione della dashboard e log eliminati. » ; s'il est en dehors (avec `LENS_DB`), `--purge` n'y touche pas, la ligne finale ne nomme pas vos modules et le script affiche `I tuoi moduli restano in: <dossier>` (les messages du script restent en italien). Si vous utilisiez `LENS_DB`, supprimez aussi ce fichier avec ses compagnons WAL :

```bash
rm -f /chemin/lens.db /chemin/lens.db-wal /chemin/lens.db-shm /chemin/dashboard-v2.json /chemin/dashboard-v2.prev.json /chemin/dashboard.json /chemin/dashboard-presets.json /chemin/dashboard-presets.bad.json /chemin/skills.json /chemin/skills.bad.json /chemin/skill-presets.json /chemin/skill-presets.bad.json /chemin/vibe-projects.json /chemin/vibe-projects.bad.json
rm -rf /chemin/update /chemin/skills /chemin/modules
```

Si la lens tournait à la main (`npm start` dans un terminal), arrêtez-la avec Ctrl-C avant de supprimer la base de données.

## 3. Supprimez l'app

Si vous avez installé l'app macOS facultative ([app-macos.md](app-macos.md)), retirez-la avant de supprimer le dossier de la lens, car le script est dedans :

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh uninstall
```

Elle retire `~/Applications/OpenCode Lens.app`, son élément d'ouverture, le cache de build, les données WebKit et les préférences de l'app ([détails](app-macos.md#désinstallation)). Sans l'app installée, elle ne fait aucun dégât.

C'est le dossier noté à l'étape 1. Si c'est `~/Applications/opencode-lens`, supprimez-le : dedans il y a aussi le Node éventuellement téléchargé par `install.sh`. Si c'est un clone du dépôt, vous pouvez le supprimer ou le garder : sans LaunchAgent, il ne démarre pas tout seul.

## 4. Nettoyez le navigateur

Le dashboard enregistre période, regroupement, métrique, thème, taille des widgets (`lens:size`), la dernière version vue (`lens:seenVersion`), « Afficher les id des modèles » (`lens:show-style-ids`) dans le `localStorage` de `http://127.0.0.1:4777` (clés commençant par `lens:`). Avec `LENS_TOKEN`, il y a aussi le cookie `lens_token`.

- **Chrome / Edge / Arc** : ouvrez `http://127.0.0.1:4777`, icône à gauche de l'adresse → *Paramètres du site* → *Supprimer les données*. Cela fonctionne aussi avec la lens déjà éteinte.
- **Safari** : *Paramètres* → *Confidentialité* → *Gérer les données de sites web*, cherchez `127.0.0.1` et supprimez.
- **Firefox** : *Paramètres* → *Vie privée et sécurité* → *Cookies et données de sites* → *Gérer les données*, cherchez `127.0.0.1`.

Si vous aviez changé de port (`LENS_PORT`), l'origine est `http://127.0.0.1:<port>`.

## 5. Intégrations externes

Si vous aviez relié `/metrics` à Prometheus, Grafana ou autre, retirez le job de scrape (la cible `127.0.0.1:4777`) et les dashboards liés. Si vous utilisiez l'export OTLP (`LENS_OTLP_ENDPOINT`), les métriques et traces déjà envoyées restent dans le collector ou dans le service de destination : elles se suppriment de là, selon sa rétention. Si vous utilisiez `LENS_TOKEN`, le token ne sert plus : supprimez-le du gestionnaire de mots de passe ou de la config de Prometheus.

## 6. Vérification

Chaque ligne doit afficher `ok` :

```bash
launchctl print "gui/$(id -u)/local.opencode-lens" >/dev/null 2>&1 && echo "servizio ancora registrato" || echo "ok: servizio"
lsof -nP -iTCP:4777 -sTCP:LISTEN >/dev/null && echo "porta 4777 ancora in ascolto" || echo "ok: porta"
pgrep -f opencode-lens/src/main.js >/dev/null && echo "processo ancora attivo" || echo "ok: processo"
for p in ~/Library/LaunchAgents/local.opencode-lens.plist ~/Library/Application\ Support/opencode-lens ~/Library/Logs/opencode-lens; do
  [ -e "$p" ] && echo "esiste ancora: $p" || echo "ok: $p"
done
```

(Les messages sont en italien : « servizio ancora registrato » = service encore enregistré, « porta … ancora in ascolto » = port encore à l'écoute, « processo ancora attivo » = processus encore actif, « esiste ancora » = existe encore.)

OpenCode continue de fonctionner comme avant : la lens était un client en lecture seule de son service (la seule écriture nouvelle est le MCP de Lens qui rapporte à la lens les livraisons de presets, pas à OpenCode).
