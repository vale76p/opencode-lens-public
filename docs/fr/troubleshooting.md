# Dépannage

🌐 [Italiano](../troubleshooting.md) · [English](../en/troubleshooting.md) · Français

## Problèmes courants

Avant tout, ouvrez la page **Paramètres** (`http://127.0.0.1:4777/#impostazioni`) : elle affiche la version, les chemins de la base de données et du log, les variables utilisées et l'état d'OpenCode.

- **« servizio non registrato »** (service non enregistré) : OpenCode V2 n'a jamais démarré, donc `service.json` n'existe pas. Lancez `opencode2` une fois, ou `opencode2 service start`. Le chemin attendu est affiché par `npm run check`.
- **Dashboard vide avec le service actif** : lancez `npm run check` et regardez combien de sessions il voit. Ensuite `npm run resync` reconstruit tout depuis zéro.
- **Chiffres non alignés** : lancez `npm run verify` avec les sessions à l'arrêt. S'il signale des différences, `npm run resync` les corrige. Un step en cours pendant le verify est toujours `BAD`. Avec la rétention active le verify compte aussi les steps élagués, et le resync ne les ramène pas.
- **« 401 dal servizio »** (401 du service) dans le log : OpenCode a redémarré avec un nouveau mot de passe. La lens relit `service.json` toute seule à la reconnexion suivante ; si le message se répète, vérifiez que `OPENCODE_SERVICE_FILE` pointe vers le bon fichier.
- **`install.sh` n'arrive pas à télécharger Node** (réseau d'entreprise, proxy) : si le proxy doit être indiqué, exportez `https_proxy` avant de le lancer ; si nodejs.org est bloqué, utilisez un miroir interne avec la même structure (`LENS_NODE_MIRROR=https://…/dist bash install.sh`), ou installez Node ≥ 22.13 dans le `PATH` autrement et relancez.
- **Le service ne se charge pas sur un Mac d'entreprise** : certaines politiques (MDM) bloquent les LaunchAgents utilisateur. `opencode-lens service status` le dit ; dans ce cas, lancez la lens à la main, dans un terminal : `~/Applications/opencode-lens/node/bin/node ~/Applications/opencode-lens/src/main.js` (ou `node …` si Node est dans le `PATH`).
- **Le port est déjà occupé** (`opencode-lens service install`) : choisissez-en un autre avec `opencode-lens service install --port 4800`.
- **Après avoir extrait le nouveau zip, le dashboard affiche toujours l'ancienne version** : la lens redémarre toute seule en une minute. Si ce n'est pas le cas, `opencode-lens service status` et le log (`aggiornata alla …: riavvio`, le message italien de la lens) ; `opencode-lens service restart` la redémarre tout de suite.
- **Le service launchd ne répond pas** : regardez le log avec `tail -f ~/Library/Logs/opencode-lens/lens.log` (au-delà de 10 Mo, `opencode-lens service install`, que chaque mise à jour exécute, le raccourcit au dernier Mo). L'état se voit avec `opencode-lens service status` (ou `launchctl print gui/$(id -u)/local.opencode-lens`).
- **Node a changé** (nvm, fnm, volta, asdf, installation depuis un clone) : le LaunchAgent utilise le chemin de Node trouvé à l'installation. Relancez `opencode-lens service install` (ou `./install.sh`). Avec le Node de Homebrew, ce n'est pas nécessaire : le plist utilise le chemin stable `/opt/homebrew/opt/node`. Pas non plus avec le Node téléchargé par `install.sh` dans `~/Applications/opencode-lens/node`, qui ne change pas avec les mises à jour.
- **« host non consentito » (403)** (hôte non autorisé) : vous ouvrez le dashboard avec un nom différent de `127.0.0.1`/`localhost`. Ajoutez-le à `LENS_ALLOWED_HOSTS`, port compris.
- **La lens ne démarre pas avec `LENS_HOST=0.0.0.0`** : `LENS_TOKEN` manque ou fait moins de 16 caractères. Voir [configurazione.md](configurazione.md#exposition-à-distance).

- **Export OTLP échoué** : l'erreur exacte est dans la page Paramètres et dans le log. `HTTP 401/403` : vérifiez `LENS_OTLP_HEADERS`. `HTTP 404` : l'endpoint est l'URL de base, sans `/v1/metrics`. `HTTP 415` : le collector n'accepte pas OTLP en JSON. Les spans non envoyés repartent à la tentative suivante.
- **Mise à jour depuis le dashboard échouée** : la section **Paramètres › Mise à jour** affiche l'état et les dernières lignes d'`install.sh` (tout dans `update/last.log`, à côté de la base de données). Si `install.sh` s'arrête avant de redémarrer, la lens reste celle d'avant. Si la page dit que la lens ne répond pas au bout de deux minutes, lancez `bash ~/Applications/opencode-lens/install.sh` depuis le terminal. « Installer » est désactivé avec la raison à côté quand la lens n'est pas lancée par launchd, tourne depuis un clone ou depuis un autre dossier, ou a des variables du plist à appliquer.
- **Le tableau de bord n'affiche que « opencode-lens non è partita : … »** (opencode-lens n'a pas démarré) : la lens n'arrive pas à ouvrir la base et reste active avec cette page (et `/healthz` répond 503) au lieu de redémarrer sans cesse. Le cas le plus courant est une base écrite par une version plus récente, après être revenu à une ancienne : réinstallez la version récente, la lens redémarre toute seule. Cela arrive par exemple en revenant à la 0.36 ou antérieure après une version au schéma v6 : pour l'utiliser il faut la copie de sécurité faite avant la mise à jour (voir [aggiornamento.md](aggiornamento.md#restaurer-une-copie-de-sécurité)). Dans les autres cas (fichier endommagé ou illisible) la raison est sur la page, visible depuis cet ordinateur, et dans le log.
- **La lens ne démarre pas après la mise à jour** avec « Configurazione non valida » (configuration invalide) : une variable a une valeur hors intervalle ou mal écrite ; le message les liste toutes.
- **Le dashboard est revenu à la disposition par défaut** : `dashboard-v2.json` (ou, s'il manque ou n'est pas valide, l'ancien `dashboard.json`, qui est migré) n'est pas un JSON valide ou décrit des widgets hors grille ou qui se chevauchent, en général après une modification à la main. Le log dit ce qui ne va pas (`grep 'dashboard' ~/Library/Logs/opencode-lens/lens.log`). Corrigez le fichier, ou recomposez la disposition et enregistrez-la : l'enregistrement le remplace.
- **Le bouton « Personnaliser le dashboard » manque** : le dashboard est ouvert depuis un autre ordinateur (les modifications ne se font que depuis celui où tourne la lens) ou la fenêtre est plus étroite que 700 px. Voir [dashboard.md](dashboard.md#quand-le-bouton-est-absent).

## Limites connues (OpenCode 2.0 est en bêta)

- **API en mouvement.** À chaque événement, la lens vérifie que les champs sur lesquels elle s'appuie existent. S'ils manquent, elle affiche un avertissement (« l'API a changé ») et le signale aussi dans `/metrics` (`opencode_lens_api_drift_events`) et dans `/api/status` (champ `drift`, avec les champs manquants et un exemple d'événement). Le backfill depuis les messages continue de fonctionner même quand les événements en direct changent de forme.
- **Endpoints documentés mais absents dans OpenCode v2.0.26.** Je ne les utilise pas :
  - `/api/info` répond 404 (j'utilise `/api/health`) ;
  - `/api/experimental/session/stats` répond 404 ;
  - `/api/experimental/session/{id}/log` ne renvoie que `log.synced`.
- **Tâches internes** : la date est celle de la synchronisation, pas l'instant exact de l'appel.
- **Serveurs privés** : les sessions d'un `--standalone` ne passent pas par le service partagé. Pour les voir, il faut `OPENCODE_SERVER_URL`.
- **V1** (`opencode`) n'est pas prise en charge : elle a une API serveur différente.
- **Permissions seulement en direct** : OpenCode ne garde que les demandes en attente, donc celles faites avec la lens éteinte ne se récupèrent pas.
- **Runs « sans résultat »** : les sessions antérieures à la mi-octobre 2026 n'ont pas de messages `idle` ; leurs runs sont déduits et n'ont pas de résultat.
- **Remise des prompts** (`steer`/`queue`) : connue seulement pour les prompts vus en direct.
- **Base de données très grande** (mesuré) : au-delà d'environ 250 000 steps, la plage « Tout » prend plus d'1 seconde, jusqu'à environ 5 secondes avec environ 1 million de steps (`/api/breakdown` lit tout en JavaScript et bloque la boucle d'événements : `/healthz` aussi peut répondre avec jusqu'à 6 secondes de retard). La mémoire (RSS) atteint environ 1,3 Go avec 1 million de steps. `LENS_RETENTION_DAYS` garde la base plus petite.
- **WAL qui grossit** : si un outil externe (par exemple `sqlite3`) garde ouverte une transaction de lecture, le fichier `-wal` ne peut pas être remis à zéro et grossit. Il est désormais limité par `journal_size_limit` (64 Mio) et la lens exécute un checkpoint `TRUNCATE` toutes les 10 minutes ; fermez quand même l'outil quand vous avez fini.
- **Disque plein** : les événements en direct sont perdus, mais le backfill répare l'historique dès que de la place se libère.
