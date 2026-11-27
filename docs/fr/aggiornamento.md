# Mettre à jour depuis une version précédente

🌐 [Italiano](../aggiornamento.md) · [English](../en/aggiornamento.md) · Français

Ce guide sert à passer à `install.sh` (à partir de la 0.12.0) en partant d'une lens installée autrement. Il explique comment découvrir ce qu'il y a sur le Mac, ce que fait `install.sh` tout seul et ce qu'on peut retirer à la main sans perdre la base de données, les paramètres et la disposition du dashboard.

## Ce qui ne change pas entre les versions

Depuis la 0.1.0, la lens a toujours utilisé les mêmes chemins. Une nouvelle installation les retrouve et les réutilise :

| Quoi | Chemin | À garder |
|---|---|---|
| Service (LaunchAgent) | `~/Library/LaunchAgents/local.opencode-lens.plist` | oui : les `EnvironmentVariables` contiennent le port, les budgets, `LENS_TOKEN` et les autres paramètres |
| Base de données | `~/Library/Application Support/opencode-lens/lens.db`, avec `lens.db-wal` et `lens.db-shm` | oui |
| Disposition du dashboard | `dashboard-v2.json` dans le même dossier (la v1 reste dans `dashboard.json` ; `dashboard-v2.prev.json` est la copie d'avant les nouveaux styles) | oui |
| Presets du dashboard | `dashboard-presets.json` dans le même dossier | oui |
| Copies de sécurité d'`install.sh` | `backup/` dans le même dossier | oui, tant que vous n'êtes pas sûr que tout va bien |
| Logs | `~/Library/Logs/opencode-lens/lens.log` | facultatif |

Si le plist contient `LENS_DB`, la base de données est à ce chemin et non à celui par défaut.

D'une version à l'autre, seul **l'endroit d'où démarre l'app** change :

| Installation | Dossier de l'app | Versions |
|---|---|---|
| zip extrait et `./install.sh` depuis son dossier | là où vous avez extrait le zip, par exemple `~/Downloads/opencode-lens` | 0.1.0–0.6.x |
| Homebrew (`brew install vale76p/tap/opencode-lens`) | `/opt/homebrew/Cellar/opencode-lens/…` | 0.7.0–0.10.0 |
| zip de la release extrait dans `~/Applications` | `~/Applications/opencode-lens` | 0.11.x |
| clone du dépôt | le dossier du clone | toutes |
| `install.sh` à partir de la 0.12.0 | `~/Applications/opencode-lens`, avec `node/` s'il a téléchargé Node | 0.12.0 → |

## 1. Vérifiez ce qui est installé

Extrayez le nouveau zip et lancez `install.sh` avec `--check`. Il affiche la situation et **ne change rien** :

```bash
bash ~/Downloads/opencode-lens/install.sh --check
```

```text
Versione da installare: 0.12.0 (/Users/tu/Downloads/opencode-lens)
Servizio: /Users/tu/Library/LaunchAgents/local.opencode-lens.plist
  app: /Users/tu/Downloads/opencode-lens-0.6.0 (0.6.0)
  node: /opt/homebrew/opt/node/bin/node
Database: /Users/tu/Library/Application Support/opencode-lens/lens.db (4.1M)
Altra copia, non usata dal servizio: /Users/tu/Desktop/opencode-lens (0.2.0)
Homebrew: formula opencode-lens in /opt/homebrew/Cellar
```

(Les messages du script sont en italien : « Versione da installare » = version à installer, « Servizio » = service, « Altra copia, non usata dal servizio » = autre copie, non utilisée par le service.)

- **app** est le dossier d'où part le service maintenant, avec sa version.
- **Altra copia** (autre copie) est un dossier d'opencode-lens trouvé dans Téléchargements, Bureau, Documents ou `~/Applications`, que le service n'utilise pas.
- **Homebrew** indique que la formule ou le tap sont toujours là.

Sans le nouveau zip, les mêmes contrôles se font à la main :

```bash
plutil -extract WorkingDirectory raw ~/Library/LaunchAgents/local.opencode-lens.plist     # dossier de l'app
plutil -extract ProgramArguments.0 raw ~/Library/LaunchAgents/local.opencode-lens.plist   # Node utilisé
plutil -extract EnvironmentVariables.LENS_DB raw ~/Library/LaunchAgents/local.opencode-lens.plist  # « Could not extract » = base de données au chemin par défaut
find ~/Downloads ~/Desktop ~/Documents ~/Applications -maxdepth 3 -name package.json -path '*opencode-lens*' -exec grep -l '"name": *"opencode-lens"' {} \;
ls /opt/homebrew/Cellar/opencode-lens /usr/local/Cellar/opencode-lens 2>/dev/null           # formule Homebrew
pgrep -fl 'src/main.js'                                                                     # lens lancées à la main
```

## 2. Installez avec `install.sh`

Avant de le lancer :

- si la lens tourne **à la main** dans un terminal (`npm start` ou `node src/main.js`), arrêtez-la avec Ctrl-C, sinon le port apparaît occupé ;
- il n'est pas nécessaire d'arrêter le service : `install.sh` s'en charge.

```bash
bash ~/Downloads/opencode-lens/install.sh
```

Voici ce qu'il fait, dans cet ordre :

1. Il enregistre une copie de la base de données dans `~/Library/Application Support/opencode-lens/backup/lens-<version précédente>-<date>.db` et une du plist à côté (permissions `600` : il contient `LENS_TOKEN`). Il garde les trois copies les plus récentes. La copie est cohérente même avec la lens en marche. S'il n'y arrive pas, il s'arrête avant de toucher l'app ou le service.
2. Il copie l'app dans `~/Applications/opencode-lens` et, si besoin, télécharge Node.
3. Il réinstalle le service en le pointant vers le nouveau dossier. Toutes les `EnvironmentVariables` du plist restent, port compris.
4. Seulement si le service répond, il s'occupe de l'ancienne installation :

| Le service partait de | `install.sh` |
|---|---|
| `~/Applications/opencode-lens` | la remplace, en gardant `node/` |
| un autre dossier extrait d'un zip | le met à la **Corbeille** (on peut le remettre) |
| un clone du dépôt | le laisse où il se trouve |
| Homebrew | laisse la formule et affiche les commandes pour la retirer |

La base de données, `dashboard-v2.json`, `dashboard.json`, les logs et les autres copies trouvées ne sont pas touchés : les autres copies sont seulement listées.

Le premier démarrage d'une version avec un schéma de base de données plus récent met la base à jour tout seul. Si la base était plus ancienne que le schéma v5, il relit aussi les sessions depuis OpenCode : il est normal que pendant quelques minutes les chiffres se complètent. Le passage de la v5 à la v6 (après la 0.36) est immédiat et ne relit rien, mais à partir de là une lens 0.36 ou antérieure n'ouvre plus la base : pour revenir en arrière il faut la copie de sécurité (voir [Restaurer une copie de sécurité](#restaurer-une-copie-de-sécurité)).

### Depuis le dashboard

Une lens déjà installée avec `install.sh` (à partir de la 0.17.0) se met aussi à jour depuis **Paramètres › Mise à jour**, sans ouvrir le terminal :

1. Téléchargez le zip de la release (`opencode-lens-X.Y.Z.zip`) depuis la [page des releases](https://github.com/vale76p/opencode-lens-public/releases). Si Safari l'extrait tout seul, compressez à nouveau le dossier depuis le Finder (clic droit › Compresser) : n'importe quel nom convient. Les fichiers de la release sont signés (`MANIFEST.json` et `MANIFEST.sig`) : la lens refuse le « Source code (zip) », les zips aux fichiers modifiés, manquants ou en trop, et ceux signés par quelqu'un d'autre. Depuis le terminal avec `install.sh`, le Source code reste installable.
2. Choisissez-le ou faites-le glisser dans la section. La lens le lit sans rien exécuter et affiche la version nouvelle et actuelle, les nouveautés du CHANGELOG entre les deux et les avertissements (même version, version plus ancienne, zip d'une branche).
3. **Installer et redémarrer** lance l'`install.sh` du zip, avec les mêmes étapes que ci-dessus : copie de la base de données et du plist, app remplacée, service réinstallé. La page attend la nouvelle version et se recharge.

Ce qu'elle contrôle avant d'installer :

- **Le zip :** un seul dossier avec le `package.json` d'opencode-lens, `src/main.js`, `install.sh` et `public/index.html`. Pas de `.git`, de liens symboliques ni de chemins qui sortent du dossier. Au plus 16 Mio, 64 Mio extrait.
- **La version :** au moins la 0.12.1, avec le Node utilisé adapté à cette version. Pour revenir à une plus ancienne, il faut une confirmation explicite : le schéma de la base de données pourrait être plus récent, et une version sans cette section ne se met plus à jour depuis le dashboard.
- **La lens :** elle tourne comme service depuis `~/Applications/opencode-lens`, a été lancée par launchd et n'a pas de variables du plist encore à appliquer. Une lens qui tourne depuis un clone, depuis Homebrew ou depuis un autre dossier se met à jour depuis le terminal.

Ce qui reste identique et ce qui diffère par rapport au terminal :

- **Pas de réseau.** La lens ne cherche pas de mises à jour et ne télécharge rien : le zip, c'est vous qui l'apportez. `install.sh` ne télécharge pas Node : il utilise celui du service.
- **Pas de recherche de copies.** `install.sh` ne cherche pas d'autres copies dans Téléchargements, Bureau et Documents (`LENS_NO_SCAN=1`), pour que macOS ne demande pas d'autorisations.
- **Où va le zip.** Il est extrait dans `update/`, à côté de la base de données, et supprimé après l'installation ; un zip non installé disparaît après 30 minutes ou au redémarrage. `update/last.log` conserve la sortie du dernier `install.sh`, que la section affiche s'il a échoué.
- **La lens et l'app macOS.** Si `~/Applications/OpenCode Lens.app` est là, `install.sh` la recompile à la même version ([app-macos.md](app-macos.md#mise-à-jour)). L'app Monitor se met à jour avec son propre `install.sh`.

Si, au bout de deux minutes, la page dit que la lens ne répond pas, le service n'a pas redémarré : lancez `bash ~/Applications/opencode-lens/install.sh` depuis le terminal et regardez `~/Library/Logs/opencode-lens/lens.log`.

### Les modules de l'utilisateur depuis le dashboard

Le même champ de **Paramètres › Mise à jour** accepte aussi un zip de **modules de l'utilisateur** (voir [moduli.md](moduli.md#les-modules-de-lutilisateur)) : un ou plusieurs de vos modules compressés depuis le Finder. La lens le reconnaît à sa forme : à la racine uniquement des dossiers nommés comme un id (`mon-module/`…), chacun avec son `module.js`, et aucun fichier. Tout autre zip suit le chemin du zip de la lens, avec ses erreurs.

1. **Aperçu.** La lens vérifie le zip comme celui de l'app (pas de chemins qui sortent du dossier, de liens symboliques, de `.git`, 16 Mio au plus et 64 Mio une fois extrait) et l'extrait dans `update/`, **sans rien exécuter des modules** : pour chacun elle montre l'id et s'il est **nouveau** ou **remplace la version installée** (ou un lien symbolique). Au-dessus figure l'avertissement : **« Code non signé : il s'exécute dans le processus de la lens avec vos permissions. N'installez que des modules en qui vous avez confiance. »**, et le fait que les modules sont vérifiés quand vous appuyez sur **Installer**.
2. **Refus.** Un id d'un module de la lens (`sistema`, `skill`…), une lens sans dossier des modules (`LENS_DB=:memory:`) et un zip vide sont refusés tout de suite.
3. **Vérification.** Appuyez sur **Installer** (ou **Installer et redémarrer**) et confirmez : alors seulement la lens juge chaque module comme **Paramètres › Modules** et `lens_module_check`. La vérification exécute le code de premier niveau de `module.js` et `server/index.js` de chaque module, et sa `configure()` : c'est pourquoi elle vient après l'avertissement. Si un module a des erreurs, rien n'est installé : la section montre le nom, les erreurs et les avertissements de chaque module, et le zip doit être corrigé et chargé à nouveau.
4. **Installation.** Pour chaque module, le nouveau dossier est copié à côté de sa place puis renommé à la place de l'ancien : jamais un module à moitié. C'est tout ou rien : si une copie ou un échange échoue, les modules déjà remplacés reviennent comme avant, rien n'est installé et la lens ne redémarre pas ; les copies laissées par une interruption (`.staging-*`) sont supprimées au redémarrage. Un `.backup` qui n'est pas un dossier arrête l'installation avant de toucher le moindre module. L'ancien dossier va dans `<dossier des modules>/.backup/<id>-<date>/` (le point initial le garde hors des modules découverts) ; si c'était un lien symbolique, c'est le lien qui va dans `.backup/` et le dossier vers lequel il pointe reste tel quel. Les données des modules, à côté de la base de données, ne sont pas touchées.
5. **Redémarrage.** Si la lens tourne comme service launchd, et que le plist n'a pas de variables modifiées à la main et pas encore appliquées, elle redémarre seule (comme **Redémarrer la lens**) et la page se recharge dans la même section ; sinon la page dit de la redémarrer à la main. Les modules déjà activés le restent (`LENS_MODULES` ne change pas) ; un nouveau module est désactivé : activez-le depuis **Paramètres › Modules**.

Cela ne demande pas que la lens tourne depuis `~/Applications/opencode-lens` : le dossier des modules de l'utilisateur suffit. Cela ne se fait que depuis cet ordinateur, avec les mêmes règles d'Origin, de content-type et de token que les autres écritures, et cela **exige `LENS_TOKEN`** : sans lui la lens refuse le zip avec un 403 (« définissez LENS_TOKEN pour installer des modules »), car c'est du code non signé qui tourne dans son processus (l'installation en service en génère déjà un). Les copies dans `.backup/` restent jusqu'à ce que vous les supprimiez.

### Le serveur MCP : redémarrez OpenCode

Le serveur MCP (`opencode-lens mcp`) ne fait pas partie du service de la lens : c'est un processus enfant d'OpenCode, qui le lance au démarrage et le garde en vie tant qu'il tourne. Une mise à jour remplace les fichiers et redémarre la lens, mais le MCP déjà lancé continue avec l'ancien code : les nouveaux outils et prompts n'apparaissent pas tant qu'OpenCode n'a pas redémarré.

Paramètres › Serveur MCP le signale : chaque requête du MCP indique sa version à la lens (en-tête `X-Lens-Mcp-Version`) et, si ce n'est pas celle de la lens, la section affiche l'avertissement « Redémarrer OpenCode » avec les deux versions. Un MCP d'une version antérieure à la 0.29.0 n'envoie pas sa version : la lens le reconnaît quand même à sa lecture périodique des presets et l'indique comme « version antérieure ». L'avertissement disparaît de lui-même après le redémarrage d'OpenCode, à la première requête du nouveau MCP (en moins d'une demi-minute, car le MCP relit les presets toutes les 30 secondes). `opencode2 reload` ne suffit pas : il recharge la configuration, pas les serveurs MCP.

## 3. Nettoyage

Quand le dashboard sur `http://127.0.0.1:4777` affiche la nouvelle version et vos données, vous pouvez retirer ce qui ne sert plus.

**Homebrew** (après `install.sh`, pas avant : jusque-là le service démarre depuis là). La formule ne contient que le code : base de données et paramètres restent.

```bash
brew uninstall opencode-lens
brew untap vale76p/tap
```

**Autres copies** listées par `--check`, **zips téléchargés** et **dossier extrait** depuis lequel vous avez lancé `install.sh` : on peut les supprimer. Un clone ne vous sert que si vous y travaillez.

**Corbeille** : l'ancien dossier de l'app (`opencode-lens-<date>`) peut être vidé.

**Copies de sécurité** : `backup/` occupe autant que la base de données par copie. Retirez-les quand vous êtes sûr que tout va bien :

```bash
rm -rf ~/Library/Application\ Support/opencode-lens/backup
```

### À ne pas faire

- Ne pas utiliser `service uninstall --purge` ni `uninstall.sh --purge` : ils suppriment base de données, disposition et logs.
- Ne pas supprimer `~/Library/Application Support/opencode-lens`, ni `lens.db-wal` et `lens.db-shm` pendant que la lens tourne : ils contiennent des données pas encore écrites dans `lens.db`.
- Ne pas supprimer le plist avant d'avoir réinstallé : il contient vos paramètres. Si c'est déjà arrivé, récupérez la copie dans `backup/` (voir ci-dessous).

L'app OpenCode Lens Monitor continue de fonctionner sans modification : le nom du service et le port sont les mêmes.

## Restaurer une copie de sécurité

```bash
L=~/Applications/opencode-lens
N="$(command -v node || echo "$L/node/bin/node")"
"$N" "$L/src/main.js" service stop
cd ~/Library/Application\ Support/opencode-lens
mv lens.db lens.db.sostituito && rm -f lens.db-wal lens.db-shm
cp backup/lens-<version>-<date>.db lens.db
"$N" "$L/src/main.js" service start
```

Pour les paramètres du service, remettez le plist enregistré et réinstallez. `service install` reprend les variables du plist qu'il trouve :

```bash
cp ~/Library/Application\ Support/opencode-lens/backup/local.opencode-lens-<date>.plist ~/Library/LaunchAgents/local.opencode-lens.plist
bash ~/Applications/opencode-lens/install.sh
```

Pour revenir à une version précédente, réinstallez son zip et restaurez la copie qui porte son numéro de version. Une lens qui ne connaît pas le schéma de la base ne l'ouvre pas : la 0.36 ou antérieure, par exemple, refuse une base au schéma v6 et s'arrête avec « opencode-lens non è partita » (voir [troubleshooting.md](troubleshooting.md)). Avec le même schéma l'ancienne lens l'ouvre, mais sans garantie que les chiffres reviennent : mieux vaut de toute façon la copie faite avant la mise à jour.

La disposition du dashboard ne demande aucune copie : la version à deux vues enregistre dans `dashboard-v2.json` et n'écrit jamais `dashboard.json`, donc une lens plus ancienne retrouve sa disposition d'avant intacte (les modifications faites dans les vues, en revanche, ne restent que dans `dashboard-v2.json`). Après les styles des modèles, une lens plus ancienne ne rejette `dashboard-v2.json` que s'il contient des styles ou des paramètres nouveaux, ou un Aujourd'hui plus étroit que 6 colonnes (à partir de cette version il peut descendre à 4, et chaque widget `today` d'une v1 migrée fait 4 de large) ; elle utilise alors `dashboard.json` ou la disposition par défaut. Au premier enregistrement, la nouvelle lens garde la copie d'avant dans `dashboard-v2.prev.json` : comment revenir en arrière est dans [dashboard.md](dashboard.md#revenir-à-une-lens-plus-ancienne). Si vous revenez ensuite à la nouvelle version, vous retrouvez la disposition enregistrée dans `dashboard-v2.json` ; si vous ne l'aviez jamais enregistrée, elle est de nouveau dérivée de `dashboard.json`.
