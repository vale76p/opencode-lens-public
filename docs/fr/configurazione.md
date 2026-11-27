# Configuration

🌐 [Italiano](../configurazione.md) · [English](../en/configurazione.md) · Français

La lens n'a pas de fichier de configuration : tout passe par des variables d'environnement. Les valeurs utilisées, avec leur origine (variable ou défaut), les chemins des fichiers et la base de données se voient dans la page **Paramètres** du dashboard (`http://127.0.0.1:4777/#impostazioni`). Avec `opencode-lens service install` (ou `install.sh` depuis un clone) la seule définie dans le LaunchAgent est `LENS_PORT` ; les autres se changent depuis la même page (voir [Modification depuis le dashboard](#modification-depuis-le-dashboard)) ou à la main dans `~/Library/LaunchAgents/local.opencode-lens.plist` (section `EnvironmentVariables`), puis en rechargeant le service. Lancée à la main avec `npm start`, la lens prend les variables du shell et la page reste en lecture seule. Relancer `opencode-lens service install` (par exemple après un changement de version de Node dans un clone) les conserve : il réécrit le reste du plist mais garde les `EnvironmentVariables` qu'il trouve, en listant leurs noms dans la sortie, et ne change `LENS_PORT` qu'avec `--port 4800` ; sinon le port déjà dans le plist reste. Les mises à jour (le nouveau zip extrait sur le dossier de l'app) ne touchent pas au plist.

## Variables d'environnement

| Variable | Défaut | |
|---|---|---|
| `LENS_PORT` / `LENS_HOST` | `4777` / `127.0.0.1` | où écoute le dashboard ; port entier 0–65535 (0 = choisi par le système) |
| `LENS_TOKEN` | généré par `service install` | protège tableau de bord et API ; obligatoire si `LENS_HOST` n'est pas local (au moins 16 caractères). Dans le navigateur : `opencode-lens service open` |
| `LENS_ALLOWED_HOSTS` | – | en-têtes `Host` supplémentaires acceptés, séparés par des virgules, toujours sous la forme `nom:port` |
| `LENS_DB` | `~/Library/Application Support/opencode-lens/lens.db` | sous Linux `$XDG_DATA_HOME/opencode-lens/lens.db` |
| `LENS_SCAN_INTERVAL` | `120` | secondes entre une synchro complète et la suivante, entier entre 10 et 86400 |
| `LENS_STORE_TITLES` | `1` | `0` (ou `false`) pour ne pas enregistrer les titres |
| `LENS_LANG` | `auto` | langue du dashboard et des textes du serveur destinés aux personnes : `auto` (la langue du navigateur, l'anglais si elle n'est pas prise en charge), `it`, `en` ou `fr`. Voir [Langue et format](#langue-et-format) |
| `LENS_LOCALE` | `auto` | format des dates, heures et nombres : `auto` (celui du navigateur, s'il fait partie de ceux proposés, sinon celui de la langue), `it-IT`, `en-US`, `en-GB` ou `fr-FR` |
| `LENS_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LENS_RETENTION_DAYS` | – | jours de steps et de tools d'OpenCode à conserver, entier entre 400 et 36500 ; non définie (ou vide) = pour toujours. Voir [Rétention des détails](#rétention-des-détails) |
| `OPENCODE_SERVICE_FILE` | `~/.local/state/opencode/service.json` | respecte `$XDG_STATE_HOME` |
| `OPENCODE_SERVER_URL` / `OPENCODE_SERVER_PASSWORD` | – | pour un serveur explicite (p. ex. `opencode2 serve` ou `--standalone`) à la place du service partagé ; URL complète avec schéma (`http://…`), sans utilisateur ni mot de passe dans l'URL. Un mot de passe sans URL est une erreur |
| `OPENCODE_SERVER_USERNAME` | `opencode` | utilisateur Basic pour `OPENCODE_SERVER_URL` |
| `LENS_LIMIT_TOKENS` / `LENS_LIMIT_COST` / `LENS_LIMIT_STEPS` | – | budgets quotidiens pour la barre « Aujourd'hui » (tokens et steps entiers, coût en USD) ; chacun est facultatif |
| `LENS_LIMIT_TOKENS_WEEKLY` / `LENS_LIMIT_COST_WEEKLY` / `LENS_LIMIT_STEPS_WEEKLY` | – | budgets de la semaine calendaire, à partir du lundi 00:00 (mêmes règles que les quotidiens) |
| `LENS_LIMIT_TOKENS_MONTHLY` / `LENS_LIMIT_COST_MONTHLY` / `LENS_LIMIT_STEPS_MONTHLY` | – | budgets du mois calendaire, à partir du jour 1 |
| `LENS_MODEL_LIMITS` | – | budget quotidien de tokens par modèle (`provider/modèle=tokens`, séparés par des virgules) : se définit depuis la carte « Budget par modèle » des Paramètres, avec les modèles de la configuration d'OpenCode (voir [Budget par modèle](#budget-par-modèle)) |
| `LENS_MODEL_PRICES` | – | liste de prix par modèle, en dollars par million de tokens (`provider/modèle=entrée:sortie[:cacheLu[:cacheÉcrit]]`, séparés par des virgules) : se définit depuis la carte « Liste de prix » des Paramètres (voir [Liste de prix](#liste-de-prix)) |
| `LENS_RESET_HOUR` | `0` | heure à laquelle commence le jour des budgets : `0`–`23` en heure locale, ou avec `Z` en UTC (`0Z`) |
| `LENS_LABELS` | – | étiquettes `clé=valeur,…` ajoutées à chaque série de `/metrics` et à l'export OTLP (noms : lettres, chiffres, `_`) |
| `LENS_OTLP_ENDPOINT` | – | URL de base d'un collecteur OTLP/HTTP, p. ex. `http://127.0.0.1:4318` : active l'export |
| `LENS_OTLP_HEADERS` | – | en-têtes `clé=valeur,…` pour l'authentification du collecteur (secret) |
| `LENS_OTLP_INTERVAL` | `60` | secondes entre un export et le suivant, entre 10 et 3600 |
| `LENS_OTLP_TEMPORALITY` | `cumulative` | `delta` pour Datadog |
| `LENS_OTLP_TRACES` | `1` | `0` pour n'envoyer que les métriques |
| `LENS_SECURITY_DIRS` | `$XDG_DATA_HOME/opencode` et son sous-dossier `security/` (en général `~/.local/share/opencode`) | dossiers où chercher les audits des guards DLP (`<nom>.audit.jsonl`), séparés par `:` ; lecture seule. Voir [sicurezza.md](sicurezza.md#dossiers-parcourus). **Réglage du module Sécurité** : lu seulement module actif et modifié depuis la carte du module dans Paramètres › Modules. |
| `LENS_SECURITY_CONFIG_DIR` | le dossier de configuration d'OpenCode (`$XDG_CONFIG_HOME/opencode`, en général `~/.config/opencode`) | où chercher les politiques des guards (`<nom>.json`) et leurs plugins (`plugins/<nom>*`) ; lecture seule. **Réglage du module Sécurité** : lu seulement module actif et modifié depuis la carte du module dans Paramètres › Modules. |
| `LENS_BOB` | – | **dépréciée** : IBM Bob est un module (voir [IBM Bob](#ibm-bob)). La lens l'ignore, quelle que soit sa valeur, et écrit une ligne dans le log seulement si elle a une valeur non vide ; Paramètres propose « Retirer » et refuse de la définir |
| `LENS_BOB_DB` | `~/.bob/db/bob.db` | la base de données des tâches de Bob, en lecture seule. **Réglage du module IBM Bob** : lu seulement module actif et modifié depuis la carte du module dans Paramètres › Modules. |
| `LENS_BOB_INTERVAL` | `30` | secondes entre une lecture de Bob et la suivante, entre 5 et 3600. **Réglage du module IBM Bob** : lu seulement module actif et modifié depuis la carte du module dans Paramètres › Modules. |
| `LENS_BOB_COIN_USD` | `0.5` | valeur d'un Bobcoin en USD, pour ajouter les coûts de Bob à ceux d'OpenCode. **Réglage du module IBM Bob** : lu seulement module actif et modifié depuis la carte du module dans Paramètres › Modules. |
| `LENS_BOB_COINS_MONTHLY` | – | Bobcoins inclus dans le forfait chaque mois (50 Pro, 180 Pro+, 1000 Ultra), pour la barre du mois de la page Bob. **Réglage du module IBM Bob** : lu seulement module actif et modifié depuis la carte du module dans Paramètres › Modules. |
| `LENS_MODULES` | – | modules à activer, ids séparés par des virgules (par exemple `sistema`) ; tous désactivés au départ. Un id invalide ou répété est une erreur, un id inconnu est ignoré avec un avertissement dans le log. Se change depuis Paramètres › Modules, ou depuis le shell hors de launchd. Voir [moduli.md](moduli.md) |
| `LENS_MCP_ERROR_TEXT` | – | uniquement dans l'environnement du serveur MCP, pas dans le plist : `1` pour donner au modèle le texte des erreurs même hors d'une session unique (voir [Serveur MCP pour OpenCode](#serveur-mcp-pour-opencode)) |

Les valeurs sont contrôlées au démarrage : si l'une n'est pas valide la lens ne démarre pas et affiche **toutes** les erreurs ensemble (aussi avec `npm run check`). Les variables `LENS_*` que la lens ne connaît pas, en général des fautes de frappe comme `LENS_PROT`, ne bloquent pas le démarrage : elles finissent comme avertissement dans le log et dans la page Paramètres.

Les variables qu'un module déclare (aujourd'hui `LENS_SECURITY_DIRS` et `LENS_SECURITY_CONFIG_DIR`, du module Sécurité) sont des **réglages du module** : la lens les connaît même module désactivé, mais ne les lit que module actif, et elles se modifient depuis sa carte de **Paramètres › Modules**, jamais depuis les fichiers des modules ; les valeurs ne se voient que sur cet ordinateur et un secret ne se voit jamais. `--help` ne les liste pas : elles sont dans le manifeste du module (voir [moduli.md](moduli.md#les-réglages-dun-module)).

## Modification depuis le dashboard

Avec la lens installée comme service (`opencode-lens service install`, LaunchAgent de macOS) le tableau **Variables d'environnement** de la page Paramètres est un formulaire : chaque variable a la valeur écrite dans le plist à côté de celle utilisée. *Enregistrer et redémarrer* :

1. contrôle les valeurs avec les mêmes règles que le démarrage et, si quelque chose ne va pas, montre **toutes** les erreurs sans rien toucher ;
2. si le port ou l'interface changent, vérifie que le nouveau port est libre ;
3. réécrit seulement les `EnvironmentVariables` du plist (sur une copie contrôlée avec `plutil -lint`, puis remplacée) ;
4. recharge le service (`launchctl bootout` + `bootstrap`, parce que launchd ne lit l'environnement qu'au chargement) ; la page attend que la lens redémarre, ou va à la nouvelle adresse si le port a changé.

Un champ vide retire la variable (le défaut revient). Les secrets (`LENS_TOKEN`, `OPENCODE_SERVER_PASSWORD`, `LENS_OTLP_HEADERS`) ne sont jamais affichés : un champ vide les laisse tels quels, *retirer* les supprime. Les variables `LENS_*` inconnues trouvées dans le plist peuvent être retirées avec un bouton ; de même pour `LENS_BOB`, que la lens ne lit plus (bouton « Retirer »). Si le plist a été modifié à la main et pas encore rechargé, la page le signale et un enregistrement sans modification l'applique.

Les modifications ne sont acceptées que depuis cet ordinateur (connexion depuis `127.0.0.1` ou `::1`), même quand le dashboard est joignable depuis le réseau, et avec `LENS_TOKEN` le token est requis comme pour le reste. Si vous changez `LENS_TOKEN` vous devrez rouvrir le dashboard avec le nouveau `?token=`. Si la lens ne redémarre pas (par exemple port pris entre-temps), la raison est dans le log.

Pour redémarrer la lens sans changer aucune variable (par exemple après avoir ajouté un module à la main dans le dossier des modules), il y a l'encadré **Service** en bas de Paramètres › Général, avec le bouton *Redémarrer la lens* : il demande confirmation, recharge le service comme *Enregistrer et redémarrer* mais sans toucher au plist, attend que la lens revienne et reste dans la même section. Les mêmes règles que pour les autres modifications s'appliquent (uniquement depuis cet ordinateur, uniquement avec la lens installée comme service) : sinon le bouton est désactivé et en donne la raison. Il est aussi désactivé quand le plist ne se lit pas (le recharger laisserait la lens arrêtée) ou a des variables modifiées à la main et pas encore appliquées : le recharger les appliquerait sans les vérifications d'*Enregistrer et redémarrer*, qui est la façon de les appliquer. Derrière il y a `POST /api/restart` (voir [métriques](metriche.md)).

Exemple, pour suivre un serveur standalone :

```bash
OPENCODE_SERVER_URL=http://127.0.0.1:4096 OPENCODE_SERVER_PASSWORD=… npm start
```

## Langue et format

Le dashboard existe en italien, anglais et français. Les deux choix sont indépendants et se font dans la page **Paramètres**, carte **Langue et format** :

- **Langue** (`LENS_LANG`) : `Automatique` suit la première langue du navigateur parmi l'italien, l'anglais et le français ; si aucune n'est prise en charge, l'interface est en anglais. Une langue forcée vaut pour tous les navigateurs qui ouvrent le dashboard.
- **Format** (`LENS_LOCALE`) : dates, heures et nombres. `Automatique` utilise le premier format avec région du navigateur, s'il fait partie de ceux proposés (`it-IT`, `en-US`, `en-GB`, `fr-FR`), sinon celui habituel de la langue choisie (`it-IT`, `en-US`, `fr-FR`). On peut avoir le dashboard en anglais avec dates et heures à l'italienne, ou l'inverse.

L'enregistrement recharge la page dans la nouvelle langue. Les choix sont dans le plist comme les autres variables, pas dans le navigateur. Le navigateur envoie la langue choisie au serveur (`X-Lens-Lang`, `X-Lens-Locale`) et les textes que le serveur écrit pour les personnes (erreurs, descriptions, état) la suivent aussi ; sans ces en-têtes ils sont en italien. Le log, les lignes `HELP` de `/metrics` et la sortie de l'outil MCP restent en italien.

Certains termes techniques ne se traduisent dans aucune des trois langues (token, prompt, cache, budget, step, tool, retry, agent, provider, widget, dashboard…). Comment ajouter ou corriger une traduction : [traduzioni.md](traduzioni.md).

## Budget

La barre « Aujourd'hui » en haut du dashboard compare le jour en cours aux budgets que vous définissez. Sans budget elle n'affiche que l'usage. Par exemple, 5 millions de tokens et 300 steps par jour :

```bash
LENS_LIMIT_TOKENS=5000000 LENS_LIMIT_STEPS=300 npm start
```

Avec le LaunchAgent ajoutez-les dans les `EnvironmentVariables` du plist et rechargez le service ; une nouvelle exécution de `opencode-lens service install` ne les efface pas. Les mêmes valeurs sont dans `/metrics` (`opencode_lens_daily_limit`) pour y construire une alerte.

La semaine et le mois ont des budgets propres, calendaires en heure locale (semaine à partir du lundi 00:00, mois à partir du jour 1). L'app [OpenCode Lens Monitor](https://github.com/vale76p/opencode-lens-monitor-public) les utilise pour le pourcentage dans la barre, les cartes et les widgets, en les lisant dans `/api/budget`. Exemple, 50 millions de tokens par semaine et 200 millions par mois :

```bash
LENS_LIMIT_TOKENS_WEEKLY=50000000 LENS_LIMIT_TOKENS_MONTHLY=200000000 npm start
```

Pour chaque période et métrique `/api/budget` rapporte usage, limite, rapport, projection linéaire à la fin de la période (seulement après 1 heure pour le jour, aussi les jours de changement d'heure, et après 1/24 de la période pour la semaine et le mois : 7 heures pour la semaine) et le rythme : `none` sans limite, `under`, `over` si la projection dépasse la limite, `exceeded` si la limite est déjà dépassée.

### Budget par modèle

Quand chaque modèle a son propre quota, par exemple un serveur d'entreprise avec 4 modèles locaux et 100 millions de tokens par jour chacun, définissez les budgets depuis la page **Paramètres**, carte **« Budget par modèle »**.

Les modèles viennent de la **configuration globale d'OpenCode** : les fichiers `opencode.jsonc`, `opencode.json` et `config.json` dans `~/.config/opencode` (ou `$XDG_CONFIG_HOME/opencode`), section `providers` → `<provider>` → `models` (aussi le `provider` du schéma précédent). Chaque modèle devient `provider/modèle`, le nom du tableau par modèle du dashboard ; son `name`, s'il y en a un, apparaît à côté. Par exemple :

```jsonc
{
  "providers": {
    "entreprise": {
      "package": "aisdk:@ai-sdk/openai-compatible",
      "settings": { "baseURL": "http://llm.entreprise.lan/v1" },
      "models": {
        "qwen3-coder": { "name": "Qwen3 Coder" },
        "llama-4": { "name": "Llama 4" }
      }
    }
  }
}
```

- À côté de chaque modèle écrivez les **tokens par jour** : un entier, ou `100M`, `1,5M`, `500k`, `2G`. Vide = pas de budget. « Enregistrer et redémarrer » écrit `LENS_MODEL_LIMITS` dans le LaunchAgent et redémarre la lens ; le bouton enregistre aussi ensemble les modifications des autres champs des Paramètres.
- `LENS_MODEL_LIMITS` ne se modifie plus à la main : dans le tableau des variables elle est en lecture seule, et la page refuse de la changer à cet endroit.
- **Historique** : un modèle qui disparaît ou change de nom dans la configuration d'OpenCode ne compte plus (il disparaît du widget et des gauges), mais son budget reste en bas de la carte, en lecture seule, comme « plus dans la configuration ». Si le modèle revient, il retrouve son budget.
- La configuration est relue quand elle change, sans redémarrer la lens.
- **Configuration non disponible** (aucun fichier, JSON invalide, fichier illisible) : la carte le signale avec le chemin et l'erreur, tous les budgets restent actifs et ne peuvent pas être changés tant que la configuration n'est pas de nouveau lisible.
- Toutes les variantes d'un modèle (`#high` et semblables) consomment le même budget.
- Un modèle que la lens n'a jamais vu est signalé dans le widget et dans la gauge (« jamais vu »).
- Les steps du modèle comptent. Les tâches internes d'OpenCode (titres, compaction) n'ont pas de modèle dans la base et restent dehors, alors que le serveur les compte : gardez un peu de marge.
- Sans le LaunchAgent (lens lancée à la main ou dashboard ouvert depuis un autre ordinateur) la carte est en lecture seule ; dans ce cas `LENS_MODEL_LIMITS` se passe toujours comme variable d'environnement, au format `provider/modèle=tokens,…`.

Ils se voient dans le widget « Par modèle aujourd'hui » et dans les gauges « Budget quotidien d'un modèle » (voir [dashboard.md](dashboard.md)), et dans `/api/budget` sous `periods.day.models`.

### Liste de prix

La carte « Liste de prix » (Paramètres › Budget) est la liste des prix par modèle : les modules s'en servent pour estimer un coût. Elle ne change pas le coût que montre la lens, qui reste celui que calcule OpenCode.

- Les lignes sont les modèles de la configuration d'OpenCode, ceux utilisés dans les steps des 90 derniers jours et ceux déjà chiffrés, avec leurs tokens des 30 derniers jours.
- Pour chaque modèle, écris les dollars par million de tokens : **entrée** et **sortie**, et au choix **cache lu** et **cache écrit**. Sans eux, le cache lu vaut 10 % de l'entrée et le cache écrit autant que l'entrée. Le raisonnement se paie comme la sortie.
- « Enregistrer et redémarrer » écrit `LENS_MODEL_PRICES` dans le LaunchAgent, au format `provider/modèle=entrée:sortie[:cacheLu[:cacheÉcrit]],…` (par exemple `anthropic/claude-sonnet=3:15`). Comme `LENS_MODEL_LIMITS`, elle ne se modifie pas à la main. Les clés avec des espaces, `?` ou `#` sont refusées.
- Les variantes d'un modèle (`provider/modèle#variante`) ont le prix du modèle de base. Un modèle sans prix reste sans prix : la lens ne l'invente pas.
- L'estimation ne compte que les steps, comme le dépensé, sans les tâches internes d'OpenCode.

### Heure de réinitialisation

Le jour des budgets commence à minuit. Si le serveur qui applique le quota réinitialise à une autre heure, définissez-la dans `LENS_RESET_HOUR` :

```bash
LENS_RESET_HOUR=2     # de 02:00 locales à 02:00 du lendemain
LENS_RESET_HOUR=0Z    # depuis minuit UTC : 02:00 en Italie l'été, 01:00 l'hiver
```

Avec le `Z` l'heure reste juste même quand l'heure d'été change. Cela vaut pour tous les budgets quotidiens (`LENS_LIMIT_*` et `LENS_MODEL_LIMITS`), pour « Aujourd'hui », pour le jour d'« Aujourd'hui », pour les gauges du jour, pour `/api/today` et pour `opencode_lens_today` dans `/metrics` et OTLP. La semaine et le mois restent calendaires (lundi 00:00 et jour 1 00:00, heure locale), comme les graphiques par jour et le calendrier de la dernière année : avec une heure de réinitialisation différente de 0 la somme des jours de budget peut ne pas coïncider exactement avec la semaine.

## Rétention des détails

Par défaut la lens garde tout pour toujours. Avec `LENS_RETENTION_DAYS`, un entier entre 400 et 36500, elle supprime les steps et les appels de tools d'OpenCode plus anciens que ce nombre de jours, comptés depuis minuit local ; non définie, ou vide, la rétention est désactivée. Elle se règle aussi depuis **Paramètres › Général › Conserver les détails**. Le minimum de 400 jours laisse exactes toutes les fenêtres fixes du dashboard, dont aucune ne dépasse les 370 jours du calendrier : jours, heures, rythme, budgets du jour, de la semaine et du mois.

- **Ce qu'elle supprime** : seulement les lignes `steps` et `tools` d'OpenCode.
- **Ce qui reste** : sessions, prompts, runs, tâches internes, signaux (retries, compactions, exécutions échouées), permissions, utilisation des skills et toutes les données d'IBM Bob.
- **Ce qui reste dans les chiffres** : avant de supprimer un jour la lens additionne ses steps et ses tools dans un récapitulatif quotidien (`daily_steps` par session, modèle et agent ; `daily_tools` par nom de tool) et enregistre dans `counter_offsets` ce qu'ils comptaient dans `/metrics` (voir [Des compteurs qui ne baissent pas](metriche.md#des-compteurs-qui-ne-baissent-pas)). Ainsi les totaux du résumé de « Tout », les compteurs de `/metrics` et de l'export OTLP et le contrôle *Σ steps + Σ tâches internes = totaux d'OpenCode* (aussi `npm run verify`) ne changent pas. Un resync ne remet pas les lignes élaguées : la lens ne réécrit pas les steps et les tools plus anciens que la limite.
- **Quand** : 60 secondes après le démarrage puis toutes les 6 heures, un jour par transaction ; entre un jour et le suivant le collector et le dashboard continuent de travailler. Dans le log : `retention: N giorni potati (… step, … tool) prima del …`.
- **Le fichier ne rétrécit pas** : la lens ne fait pas de `VACUUM`. L'espace libéré est réutilisé pour les nouvelles lignes.

Limites :

- Dans « Tout » les graphiques, les répartitions (par modèle, agent, dossier…), les sessions, les prompts, le détail de la session, la latence et la vitesse ne montrent que les lignes conservées ; seuls les totaux du résumé (`/api/summary` : steps, steps échoués, coût, tokens, sessions et modèles distincts, appels et erreurs des tools) comprennent les jours élagués.
- Un prompt (run) d'un jour élagué reste, avec son issue et sa durée, mais sans steps, tokens ni coût ; un retry de ces jours reste, mais sans le modèle.
- Dans une période choisie à la main un jour élagué ne compte dans les totaux que si la période contient son minuit, ainsi deux périodes adjacentes ne le comptent pas deux fois. L'exception est la période qui contient le début de la ligne élaguée la plus ancienne, comme « Tout » : elle compte aussi le jour où elle commence.
- IBM Bob n'est pas élagué : ses tables grandissent comme avant.
- Les Paramètres et `/api/status` ne montrent pas l'état de la rétention : il n'y a que la ligne du log.

## Export OTLP

Pour envoyer métriques et traces à un collecteur OpenTelemetry, à Grafana Cloud ou à Datadog :

```bash
# OpenTelemetry Collector local
LENS_OTLP_ENDPOINT=http://127.0.0.1:4318 npm start

# Grafana Cloud
LENS_OTLP_ENDPOINT=https://otlp-gateway-prod-eu-west-2.grafana.net/otlp \
LENS_OTLP_HEADERS="Authorization=Basic <base64 instance:token>" npm start

# Datadog : delta uniquement
LENS_OTLP_ENDPOINT=https://otlp.datadoghq.eu LENS_OTLP_HEADERS="dd-api-key=<clé>" LENS_OTLP_TEMPORALITY=delta npm start
```

Dans la page Paramètres et dans le log l'endpoint apparaît sans identifiants (`utilisateur:mot de passe@` et query string masqués). La lens utilise OTLP/HTTP avec encodage JSON, sans SDK : l'endpoint doit l'accepter (le Collector et les services cités l'acceptent sur `/v1/metrics` et `/v1/traces`). `LENS_OTLP_HEADERS` contient en général un secret : gardez-le hors du contrôle de version. Ce qui est envoyé : [metriche.md](metriche.md#export-otlp).

## Prix pour les modèles locaux

Le coût est calculé par OpenCode, pas par la lens, à partir des prix par million de tokens déclarés dans la config du modèle. Pour les modèles locaux il vaut 0, à moins que vous ne déclariez un prix dans la config d'OpenCode :

```jsonc
{
  "providers": {
    "lmstudio-local": {
      "package": "aisdk:@ai-sdk/openai-compatible",
      "settings": { "baseURL": "http://127.0.0.1:1234/v1" },
      "models": {
        "qwen3.5-9b": { "cost": { "input": 0.1, "output": 0.4, "cache": { "read": 0.01, "write": 0 } } }
      }
    }
  }
}
```

## Serveur MCP pour OpenCode

`opencode-lens mcp` est un serveur [MCP](https://modelcontextprotocol.io) sur stdio : les modèles qui travaillent dans OpenCode V2 peuvent demander à Lens budget, erreurs, usage, sessions et ce qu'ont fait les guards DLP, et recevoir les skills d'un preset que vous choisissez (voir [Prompts](#prompts)). Il ne parle qu'à l'API HTTP de la lens sur `127.0.0.1`, n'ouvre pas la base de données et ne change ni les modèles ni la configuration d'OpenCode. Il n'est pas en lecture seule : quand il livre un preset (`prompts/get` ou l'outil `preset`) il le rapporte à la lens avec `POST /api/skill-loads` (id du preset et des skills livrées, jamais de textes), pour compter l'utilisation. Avec une lens éteinte ou ancienne la livraison arrive quand même au modèle et le comptage se perd en silence. L'outil `preset`, les commandes `/lens:<id>` et le comptage des livraisons n'existent qu'avec le module **Skill** actif (voir [moduli.md](moduli.md#skill)) ; désactivé, `/api/skill-loads` répond 404 et la livraison n'est pas comptée.

### Installation

Le moyen le plus simple est la section **Serveur MCP** des Paramètres dans le dashboard. Elle a trois onglets, tous déjà remplis avec les chemins de cette installation et avec le bouton « Copier » :

- la commande à exécuter ;
- le même serveur comme bloc pour `opencode.jsonc` ;
- un prompt à coller dans OpenCode pour que ce soit le modèle qui ajoute le serveur. Le prompt ne modifie que `mcp.servers.lens` et ne touche ni les agents ni les permissions.

Dans la même section on voit si le serveur tourne. L'état est lu depuis OpenCode (`GET /api/mcp`, pour le dossier par défaut du service) et depuis la configuration globale : Lens reconnaît le serveur au nom `lens` et n'écrit jamais dans la configuration d'OpenCode. Pour l'allumer ou l'éteindre on utilise OpenCode (`"disabled": true`, ou en retirant la permission `lens_*` aux agents), puis `opencode2 reload`.

La ligne « MCP en cours d'exécution » dit quelle version du MCP a appelé la lens en dernier et quand. Si ce n'est pas celle de la lens (typique après une mise à jour : le MCP est un processus enfant d'OpenCode et reste l'ancien), l'avertissement « Redémarrer OpenCode » apparaît : voir [Le serveur MCP : redémarrez OpenCode](aggiornamento.md#le-serveur-mcp--redémarrez-opencode).

Depuis le terminal :

```bash
opencode-lens mcp install
```

La commande affiche la ligne à exécuter, avec des chemins absolus : le `node` et le `main.js` du LaunchAgent ou, sans service, ceux du processus qui l'a lancée. Par exemple :

```bash
opencode2 mcp add --global lens -- /opt/homebrew/opt/node/bin/node /Users/vous/Applications/opencode-lens/src/main.js mcp
```

La ligne ajoute `mcp.servers.lens` à la configuration globale d'OpenCode. OpenCode démarre la commande sans shell, donc pas de `~`. Une mise à jour de la lens n'exige pas de la répéter, parce que le chemin reste le même. Elle est à refaire seulement si l'app change de dossier ou si le Node du plist change.

Port et token viennent des `EnvironmentVariables` du LaunchAgent, donc le token ne finit pas en clair dans `opencode.jsonc`. Dans l'environnement du serveur MCP (`--env` de `opencode2 mcp add`) `LENS_PORT`, `LENS_TOKEN` et `LENS_RESET_HOUR` l'emportent sur le plist. Sans plist les défauts s'appliquent (`4777`, pas de token). Le MCP se connecte toujours à `127.0.0.1` : si la lens n'écoute que sur une adresse réseau (`LENS_HOST` différent de `0.0.0.0` et de la loopback), le MCP ne l'atteint pas.

### Outils

OpenCode les affiche avec le préfixe du serveur : `lens_budget`, `lens_errors`, `lens_usage`, `lens_sessions`, `lens_module_guide`, `lens_module_check`, `lens_security` (seulement avec le module Sécurité actif) et `lens_preset` (seulement avec le module Skill actif). Les permissions par agent se donnent sur ces actions. Ils lisent tous depuis la lens ; la seule écriture est le comptage des livraisons de `preset` (voir ci-dessus), qui ne change rien à ce que reçoit le modèle. `module_check` fait un `POST /api/modules/check`, mais ce n'est qu'une interrogation : la lens juge le module sans l'activer ni rien changer. Pour le juger, pourtant, elle exécute le code du module dans le processus de la lens : c'est pourquoi `module_check` n'est pas déclaré en lecture seule.

Après la mise à jour de la lens qui les apporte, `lens_module_guide` et `lens_module_check` n'apparaissent dans OpenCode qu'une fois celui-ci redémarré (voir [Le serveur MCP : redémarrez OpenCode](aggiornamento.md#le-serveur-mcp--redémarrez-opencode)).

| Outil | Arguments | Questions typiques |
|---|---|---|
| `budget` | – | « combien me reste-t-il aujourd'hui sur Opus ? », « à ce rythme, je dépasse la semaine ? » |
| `errors` | `since` (`1h`, `6h`, `24h`, `7d` ; défaut `24h`), `session` (`current` ou un id), `scope` (`project` ou `all`), `limit` (1–30) | « pourquoi les requêtes échouent-elles depuis ce matin ? », « que s'est-il passé dans cette session ? » |
| `usage` | `range` (`today`, `yesterday`, `7d`, `30d`, `month` ; défaut `7d`), `by` (`model`, `provider`, `agent`, `tool`, `day`), `compare` | « compare cette semaine avec la précédente », « quel agent coûte le plus ? » |
| `sessions` | `range`, `sort` (`cost`, `tokens`, `errors`, `recent`), `limit` (1–20), `scope`, `id` (`current` ou un id) | « les sessions les plus chères du mois », « détail de cette session » |
| `module_guide` | `section` (facultatif : le titre, ou une partie du titre, d'une section du guide) | « écris un module Lens qui montre les fichiers d'un dossier », « que dois-je savoir des widgets d'un module ? » |
| `module_check` | `id` (le module, c'est-à-dire le nom de son dossier : minuscules, chiffres et tirets) | « vérifie le module mio-modulo » |
| `security` | `guard` (le nom), `session` (`current` ou un id), `scope` (`project` ou `all`), `since` (`1h`, `6h`, `24h`, `7d` ; défaut `24h`), `outcome` (`blocked`, `allowed`, `all`), `limit` (1–30) | « qu'ont bloqué les guards DLP aujourd'hui ? », « le guard Context7 fonctionne-t-il ? » |
| `preset` | `name` (l'id ou le nom d'un preset ; l'id est celui de `/lens:<id>`), `skill` (l'id d'une skill de la bibliothèque) | « quels presets de skills ai-je dans Lens ? », « utilise le preset angular-security pour ce travail » |

Comment ils travaillent :
- **Session appelante.** Elle vient de `_meta["ai.opencode/sessionID"]`, qu'OpenCode ajoute à chaque appel. `errors` et `sessions` restent par défaut dans le projet (le dossier) de cette session ; avec `scope: "all"` on les voit toutes.
- **Erreurs.** Elles sont regroupées par source (step, tool, retry, exécution échouée), modèle, type et statut HTTP. Les retries et les exécutions échouées n'existent que depuis que Lens les voit en direct : la réponse dit depuis quand elle les compte. Si une erreur a interrompu la session en cours, la question se pose au tour suivant.
- **Comparaisons.** `compare` compare avec la période immédiatement précédente, à la même durée écoulée (aujourd'hui jusqu'à 10:40 contre hier jusqu'à 10:40). Les différences, c'est le MCP qui les calcule, le modèle les rapporte, c'est tout. Les jours sont ceux des budgets, comme dans le dashboard (`LENS_RESET_HOUR`).
- **Budget.** Ce sont les limites que vous avez choisies (`LENS_LIMIT_*`, `LENS_MODEL_LIMITS`), pas les quotas du provider : Lens ne voit pas ce qu'il reste chez le provider. Avec une session en cours il y a aussi le remplissage du contexte.
- **Changement de modèle.** Le MCP ne change ni de modèle ni de configuration. Ses instructions disent au modèle que le passage automatique à un modèle de secours, quand le provider épuise le quota ou ne répond pas, c'est le [plugin lens-guard](#plugin-lens-guard--changement-de-modèle-quand-le-provider-ne-répond-pas) qui le fait, et que les budgets de Lens ne font pas changer de modèle pour l'instant.
- **Sécurité.** Seulement avec le module Sécurité actif. Dit ce que les guards DLP trouvés dans les dossiers d'OpenCode (aujourd'hui Context7 Guard) ont laissé passer ou bloqué, avec les catégories détectées, la santé du guard et sa politique globale ; sans `guard` et avec plusieurs guards elle donne le résumé. Jamais le texte des détections ni les aperçus, et les listes de la politique seulement comme « N entrées ». Un tool échoué avec « GUARD — invio bloccato » est un blocage DLP, pas une panne : on le demande ici. Détails dans [sicurezza.md](sicurezza.md#tool-mcp-security).
- **Modules et redémarrage d'OpenCode.** Les outils d'un module (aujourd'hui `security` et `preset` de Skill) et les lignes qu'ils ajoutent aux instructions du serveur n'existent que module actif. Le MCP s'en aperçoit en 30 secondes et le dit à OpenCode avec `notifications/tools/list_changed`, mais OpenCode (vérifié avec la 2.0.26) ne relit ni les outils ni les instructions : après avoir activé ou désactivé un module avec des outils, **redémarrez OpenCode**. Jusque-là il voit l'ancienne liste, et l'outil d'un module désactivé répond « Il modulo <Nom> è spento in Lens: attivalo da Impostazioni › Moduli. ». Voir [moduli.md](moduli.md#les-outils-mcp-dun-module).
- **Presets.** Sans argument `preset` donne la liste à jour des presets (id, nom, brief, skills). Avec `name` il donne les skills de ce preset ; avec `skill` (et `name` omis) une seule skill de la bibliothèque, utile quand le texte d'un preset a été abrégé (si les deux sont donnés, `skill` l'emporte) ; un corps de plus de 48 Kio ou 1900 lignes est coupé à une ligne entière, avec une note qui renvoie à `SKILL.md`. `name` est l'id ou le nom du preset : l'id compte d'abord, puis le nom affiché (sans distinction de casse, sans espaces aux bords ; si plusieurs presets ont le même nom, on demande l'id). Un `name` qui n'existe pas est une erreur en italien qui liste les ids valides (30 au plus) et renvoie à la liste. Chaque livraison réussie est comptée (voir [Utilisation des skills](metriche.md#utilisation-des-skills)). Ce n'est pas une observation d'OpenCode : ce sont vos propres instructions, voir [Prompts](#prompts) et [Ce qui arrive au modèle](#ce-qui-arrive-au-modèle). Seulement avec le module Skill actif : OpenCode ne relit pas la liste des outils, donc l'outil n'apparaît ou ne disparaît qu'après un redémarrage d'OpenCode ; avec Skill désactivé il répond « Il modulo Skill è spento in Lens: attivalo da Impostazioni › Moduli. »
- **Écrire un module.** `module_guide` et `module_check` sont des outils du noyau, toujours présents (aucun module ne les active), pour qu'un modèle écrive un module dans le dossier des modules de l'utilisateur (voir [moduli.md](moduli.md)). `module_guide` donne le guide de l'app (`docs/moduli-custom.md`) ou, avec `section`, seulement la section dont le titre contient ce texte (casse ignorée ; sans correspondance il liste les titres), plus les valeurs de cette installation lues dans `GET /api/modules/authoring` : le dossier des modules de l'utilisateur, la version de la lens, et les ids, variables `LENS_…`, chemins `/api`, outils MCP et types de widget déjà pris, ainsi que les plafonds des widgets. Si le guide manque il le dit et donne quand même les valeurs ; si la lens ne répond pas il donne le guide et dit que les valeurs manquent. `module_check` demande à `POST /api/modules/check` de juger le module du dossier de l'utilisateur comme au démarrage, sans l'activer (il exécute pourtant le code de premier niveau de `module.js`, `tables.js` et `server/index.js`, et `configure()`, dans le processus de la lens) : il répond « OK » ou les erreurs et avertissements, un par ligne (avec `isError` s'il y a des erreurs), même pour un module nouveau que la lens n'a pas encore découvert ; le modèle corrige et rappelle jusqu'à « OK ». Un module ne peut pas déclarer d'outils portant ces noms. Comme les autres nouveaux outils, ils apparaissent dans OpenCode après un redémarrage. Ils ne fonctionnent que depuis cet ordinateur : les deux chemins de la lens refusent tout client qui n'est pas local.
- **Fraîcheur.** Chaque réponse se termine par une ligne sur l'état du collector, sur le dernier événement vu et sur le drift de l'API d'OpenCode.
- **Erreurs du MCP.** Si Lens est éteinte ou si le token est faux, l'outil répond par une erreur en italien qui dit quoi vérifier (`opencode-lens service status`, `LENS_TOKEN`).

Il prend en charge les révisions MCP 2025-11-25 (`initialize`) et 2026-07-28 (`server/discover`). OpenCode 2.0.26 utilise la première.

### Prompts

Un **preset** regroupe des skills de la bibliothèque de Lens (la page **Skill**, voir [dashboard.md](dashboard.md#skill)) sous un id que vous choisissez, un nom et un brief. Le MCP les propose de trois façons : Ils font partie du module Skill : les commandes, l'outil et les instructions ci-dessous n'existent qu'avec le module actif (Paramètres › Modules).

- **Prompts.** Un par preset : `name` est l'id du preset, `title` le nom, `description` le brief, sur une ligne et sans guillemets « ». Dans OpenCode ils deviennent les commandes `/lens:<id>` : écrire `/lens:api-docs` suivi de la tâche remet au modèle les skills du preset. `prompts/get` répond par un message qui commence par « Usa queste skill per il compito che segue. » (« Utilise ces skills pour la tâche qui suit. ») et se poursuit avec le texte du preset (voir [Ce qui arrive au modèle](#ce-qui-arrive-au-modèle)). Les commandes suivent `notifications/prompts/list_changed` : activer ou désactiver Skill les fait apparaître ou disparaître dans OpenCode sans redémarrage (l'outil `preset`, lui, ne change qu'après un redémarrage d'OpenCode).
- **Outil.** `preset` (voir [Outils](#outils)), pour quand c'est le modèle qui décide : « utilise le preset angular-security pour ce travail ».
- **Instructions.** À `initialize` la liste des presets (id, nom, brief et ids des skills) est ajoutée aux instructions du serveur, pour que le modèle sache qu'ils existent et quand les utiliser : si la tâche correspond au brief d'un preset, il doit le demander avec `preset` avant de commencer. La liste est plafonnée à environ 3000 caractères : briefs coupés à 160, 300 caractères d'ids de skills au plus par preset, et si les presets ne tiennent pas tous une ligne finale dit combien manquent (« … e altri N preset: chiedi preset senza argomenti per l'elenco completo »). Une skill disparue de la bibliothèque est marquée « (assente) ». Les instructions se lisent une fois par connexion, avec 3 secondes de temps : avec Lens éteinte ou lente elles restent les habituelles, sans liste. La liste à jour et complète est donnée par `preset` sans argument. La liste se trouve à la fin des instructions, après une ligne vide, et c'est le module Skill qui l'écrit ; ses lignes fixes (presets et livraisons) suivent celles des outils du noyau.

Si les presets changent (un nouveau ou un supprimé, ou un nom, un brief ou les skills d'un preset différents), le MCP le voit en 30 secondes, parce qu'il contrôle toutes les 30, et envoie `notifications/prompts/list_changed` : le client relit `prompts/list`. Le point de départ est ce que le client a vraiment reçu avec son dernier `prompts/list` (une liste vide s'il avait échoué) : une Lens qui revient après cet échec est annoncée aussitôt, et le même changement n'est pas annoncé à chaque contrôle. Tant que le client n'a rien demandé, la première lecture après le démarrage ne fixe que le point de départ. Changer le texte d'une skill n'est pas un changement des presets : chaque requête relit la bibliothèque, donc il arrive à la requête suivante.

Erreurs de `prompts/get` : sans `name`, ou avec un preset qui n'existe pas, c'est `-32602` (requête invalide) ; avec Lens éteinte, un token faux ou une configuration invalide c'est `-32603` (erreur interne). Avec Lens éteinte, un token faux ou une configuration invalide `prompts/list` répond par une liste vide et écrit la raison sur stderr, une fois par raison. Avec le module Skill désactivé, en erreur ou à configurer `prompts/get` répond par un texte qui le dit (désactivé, en erreur, à configurer), pas par une erreur générique.

### Ce qui arrive au modèle

Lens n'enregistre ni prompts ni outputs, mais certains champs peuvent en contenir des morceaux :
- les messages d'erreur des providers peuvent citer la requête ;
- les erreurs des tools sont de l'output de tools (stderr, pages web) ;
- les titres des sessions résument les prompts.

Les envoyer à un modèle, même d'une session à l'autre, est une sortie de données et un possible canal de prompt injection. C'est pourquoi le MCP :
- par défaut n'envoie que la classe d'erreur, le statut HTTP et les comptages ;
- n'envoie le texte des erreurs que pour une session (`session`, ou `sessions` avec `id`), ou partout avec `LENS_MCP_ERROR_TEXT=1` :

  ```bash
  opencode2 mcp add --global --env LENS_MCP_ERROR_TEXT=1 lens -- <node> <main.js> mcp
  ```
- de `security` ne passent jamais le texte des détections (`detail`) ni les aperçus des arguments, et les valeurs de la politique qui ressemblent à des clés sont masquées ; les objets des appels, les noms des tools et les catégories passent, nettoyés comme les autres textes ;
- nettoie textes et titres des retours à la ligne, caractères de contrôle, caractères bidi et caractères invisibles (largeur nulle, sélecteurs de variante, remplisseurs Hangul), les coupe à 160 caractères (80 pour les titres) et les met entre « ».

Le `preset` (outil et prompt) est l'exception voulue : il envoie du **texte**, celui de vos skills, parce que c'est son but. Ce ne sont pas des données d'OpenCode mais votre propre configuration, que vous avez importée et choisie dans la page Skill, et c'est pourquoi le texte arrive tel quel, sans la coupe à 160 caractères : le MCP nettoie seulement les caractères de contrôle (retours à la ligne et tabulations restent, les autres deviennent une espace) et retire les invisibles (largeur nulle) et les bidi ; les sélecteurs de variante restent, parce que des emoji comme ✔️ les utilisent. Le nom et le brief du preset, dans la première ligne, restent en revanche nettoyés sur une ligne et mis entre « », suivis de la liste de ses skills. Pour chaque skill du preset il arrive :

```
Preset «Documentare le API» (api-docs): «Mappa e documenta le API HTTP di un progetto, poi verifica a runtime.» · skill: api-explore, sparita (assente)
<skill_content name="api-explore">
# API Explore
…
Cartella base di questa skill: /Users/…/Application Support/opencode-lens/skills/api-explore/2
I percorsi relativi (scripts/, references/…) partono da lì.
<skill_files>
<file>/Users/…/skills/api-explore/2/references/discovery-heuristics.md</file>
</skill_files>
</skill_content>
Skill «sparita» assente dalla libreria di Lens.
```

- le corps de `SKILL.md`, sans le frontmatter, dans `<skill_content name="…">` ;
- le **dossier de base** absolu de la version en cours d'utilisation (« Cartella base di questa skill: … ») : les chemins relatifs du texte (`scripts/`, `references/`…) partent de là, et le modèle les lit avec ses propres outils ;
- la description de la skill, entière jusqu'à 1024 caractères (« Descrizione: … ») ;
- les chemins absolus des autres fichiers de la skill, dans `<skill_files>` (les 10 premiers), tels qu'ils sont sur le disque : espaces et guillemets restent, et un chemin avec des caractères de contrôle, bidi ou invisibles n'est pas altéré mais omis, avec la note « (N file con nomi non sicuri omessi) » ;
- si une skill du preset n'est plus dans la bibliothèque, une ligne qui le dit (« Skill «sparita» assente dalla libreria di Lens. ») ;
- si une skill ne se lit pas (Lens répond par une erreur autre que « introuvable »), une ligne « Skill «id» non leggibile ora: … » à sa place : les autres arrivent quand même.

Le texte de toutes les skills d'une réponse a **trois plafonds, qui valent ensemble** : 40 000 caractères, 48 Kio d'octets UTF-8 et 1900 lignes. OpenCode coupe le résultat d'un outil à 50 Kio ou 2000 lignes, et un texte non latin pèse plus d'octets que de caractères. Une skill qui ne tient pas dans le total arrive sans corps, avec son dossier et ses fichiers et la note de lire `SKILL.md` avec le tool `read` ou de demander `preset` avec `skill="<id>"` ; une suivante plus petite peut encore tenir, et si même cette forme ne tient pas il arrive une seule ligne ; quand même les lignes ne tiennent pas, les dernières skills sont réunies en une ligne comptée (« … e altre N skill non incluse: … »). Avec `skill` il n'y a pas le plafond de 40 000 caractères mais les 48 Kio et les 1900 lignes restent : un corps qui les dépasse est coupé à la dernière ligne entière qui tient, avec une note qui renvoie à `SKILL.md` dans le dossier de base, où le modèle lit le reste.

Lens n'exécute jamais une skill ni ses scripts : c'est le modèle qui les lit ou les lance, avec les outils et les permissions qu'il a dans OpenCode.

Les fichiers sont dans `~/Library/Application Support/opencode-lens/skills/`, en dehors du projet sur lequel travaille OpenCode. Si `read` ou `bash` demandent confirmation pour les fichiers de ce dossier, on peut essayer d'ajouter dans `permissions` de la configuration d'OpenCode une règle qui autorise `read` sur ce dossier (Lens n'écrit jamais dans la configuration d'OpenCode). C'est une possibilité, pas encore vérifiée.

## Exposition à distance

Pour qu'un Prometheus sur une autre machine la lise, trois variables sont nécessaires. Sans token la lens refuse de démarrer sur une interface non locale.

```bash
LENS_HOST=0.0.0.0 LENS_TOKEN="$(openssl rand -hex 24)" LENS_ALLOWED_HOSTS="macbook.local:4777" npm start
```

Le token peut être passé de trois façons :

- en-tête `Authorization: Bearer <token>` (Prometheus : `authorization: { credentials: <token> }`) ;
- `?token=<token>` une fois dans le navigateur : la lens répond par une redirection qui retire le token de l'URL et définit le cookie `lens_token` (`HttpOnly`, `SameSite=Strict`) ;
- cookie `lens_token`.

`LENS_ALLOWED_HOSTS` doit contenir le nom par lequel on joint la lens, port compris : les requêtes avec un autre `Host` reçoivent 403.

### Derrière un reverse proxy

Si la lens est publiée par un reverse proxy sur le même Mac (nginx, Caddy, `ngrok`, `cloudflared`, Tailscale Serve ou Funnel), pour la lens chaque requête arrive de `127.0.0.1`, même celles qui viennent du réseau. Si le proxy réécrit aussi le `Host`, le contrôle sur le `Host` ne suffit plus : dans ce cas **définissez toujours `LENS_TOKEN`**, même avec `LENS_HOST=127.0.0.1`, sinon quiconque atteint le proxy lit toutes les données.

Les modifications (paramètres, disposition du dashboard, skills et presets, mise à jour) ne passent jamais par le proxy : les requêtes `POST` avec des en-têtes de proxy (`Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP`, `Via`, `CF-Connecting-IP`, `Tailscale-*`) reçoivent 403, même avec le bon token. Pour les modifier ouvrez le dashboard directement depuis ce Mac (`http://127.0.0.1:4777`). Pour les clients derrière un proxy `GET /api/settings` montre `LENS_OTLP_ENDPOINT` masqué, comme `/api/about`. Le contrôle ne vaut que pour les proxys qui ajoutent au moins un de ces en-têtes : vérifiez que le vôtre le fait.

## Plugin lens-guard : changement de modèle quand le provider ne répond pas

`extras/opencode/lens-guard.v2.ts` est un plugin pour OpenCode 2.x. Quand le provider ne peut pas répondre, le tour continue sur un modèle de secours : il n'est pas nécessaire de renvoyer le prompt. Il travaille dans OpenCode et n'a pas besoin de la lens : la lens ne voit que le résultat, c'est-à-dire le step compté sur le modèle de secours.

Le plugin change de modèle dans trois cas :

- **quota épuisé** : 429 avec `insufficient_quota`, `billing` ou semblables, erreurs qu'OpenCode ne retente pas ;
- **rate limit avec un `Retry-After` long** : OpenCode attendrait au moins `minRetryDelayMs` (60 secondes par défaut, jusqu'à 15 minutes) avant de réessayer ;
- **provider injoignable** : connexion refusée, nom du serveur non résolu, réseau absent. Une connexion qui s'interrompt en pleine réponse ne compte pas : OpenCode la retente sur le même modèle.

Les autres erreurs (authentification, content policy, rate limits courts, erreurs internes du provider) restent à OpenCode, qui les gère comme d'habitude. Un rate limit court reste tel même quand le provider écrit « quota » dans le message, comme le fait Gemini pour les limites à la minute.

### Installation

Avec la lens installée depuis le zip, le plugin est dans `~/Applications/opencode-lens/extras/opencode/` :

```bash
cp ~/Applications/opencode-lens/extras/opencode/lens-guard.v2.ts ~/.config/opencode/plugins/
```

```bash
cp ~/Applications/opencode-lens/extras/opencode/lens-guard.example.json ~/.config/opencode/lens-guard.json
```

Modifiez `lens-guard.json` et redémarrez OpenCode. Les mises à jour de la lens ne touchent pas à la copie dans `plugins/` : après une mise à jour répétez la première commande si vous voulez la nouvelle version. La désinstallation de la lens la laisse aussi en place.

### Configuration

```json
{
  "fallback": {
    "anthropic/claude-opus-4-1": ["anthropic/claude-sonnet-4-5", "openai/gpt-5"]
  },
  "minRetryDelayMs": 60000
}
```

- `fallback` : pour chaque modèle, la chaîne de secours dans l'ordre. Les modèles s'écrivent `provider/modèle`, comme dans `opencode2 models` ; tout ce qui suit le premier `/` est l'id du modèle (`openrouter/anthropic/claude-sonnet`).
- `minRetryDelayMs` : à partir de quelle attente en millisecondes un rate limit fait changer de modèle. Défaut `60000`.

Le fichier est du **JSON pur** : ni commentaires ni virgules finales. Un fichier avec des commentaires ou invalide, ou un `fallback` qui n'est pas un objet, éteint le plugin sans erreur et OpenCode continue comme s'il n'était pas là. Les entrées individuelles invalides sont écartées : une sans `/`, un modèle qui renvoie à lui-même, les doublons.

Le fichier est dans `${XDG_CONFIG_HOME:-~/.config}/opencode/lens-guard.json`. `LENS_GUARD_CONFIG=/chemin/fichier.json` en indique un autre, `LENS_GUARD=off` éteint le plugin. Ce sont des variables d'environnement d'OpenCode, pas de la lens.

### Comment il se comporte

- Le changement a lieu dans le tour : OpenCode retente le même step sur le modèle de secours, sans attente. Dans la TUI apparaît la ligne « Switched model from … to … », le seul avis : le plugin n'ajoute pas de messages à la conversation, ce qui coûterait un step de plus.
- Dans la lens le step retenté n'apparaît qu'une fois, sur le modèle de secours, avec 2 tentatives. L'erreur de la première tentative reste dans les retries enregistrés en direct.
- La session **reste** sur le modèle de secours aussi aux tours suivants. Le plugin ne revient pas en arrière tout seul : pour revenir au modèle d'avant, choisissez-le de nouveau dans OpenCode.
- Chaque chaîne n'est parcourue **qu'une seule fois par tour** et aucun modèle n'est réessayé dans le même tour. La chaîne est celle du premier modèle qui échoue : avec `A → [B]` et `B → [A]`, si les deux échouent il y a un seul changement, puis l'erreur reste à OpenCode. Au prompt suivant on repart.
- Changer de provider en pleine conversation fait perdre le prompt cache du provider d'avant : le premier step sur le modèle de secours paie de nouveau tout le contexte.

## IBM Bob

Le module **IBM Bob**, à activer dans Paramètres › Modules (voir [moduli.md](moduli.md)), lit les tâches d'**IBM Bob** (Bob IDE 2.x et Bob Shell 2.x), qui les gardent dans la même base SQLite, `~/.bob/db/bob.db`. Bob n'a ni API ni flux d'événements : la lens ouvre le fichier en lecture seule toutes les `LENS_BOB_INTERVAL` secondes, relit les tâches qui ont bougé et les enregistre dans ses propres tables (`bob_tasks`, `bob_requests`, `bob_tools`), créées par le module et jamais élaguées. Elle ne touche pas à la configuration de Bob et n'enregistre jamais titres, prompts, texte des messages, arguments ou sorties des tools : seulement dossier, mode, état, durées, coût, token et noms des tools (Bob n'enregistre pas le modèle qu'il choisit). Bob supprime les tâches au bout de 30 jours ; la lens les garde.

Les chiffres d'OpenCode ne changent pas : les tables de Bob sont séparées, `/api/summary` reste celui de toujours et les séries `/metrics` d'OpenCode sont identiques. Bob n'apparaît dans le dashboard que là où vous le demandez, avec le sélecteur **OpenCode · + Bob · Bob seul** (voir [dashboard.md](dashboard.md#ibm-bob)) ; les Bobcoins deviennent des dollars avec `LENS_BOB_COIN_USD`.

Les quatre variables `LENS_BOB_*` du tableau sont des **réglages du module** : elles se changent depuis sa carte dans Paramètres › Modules (`LENS_BOB_INTERVAL` entre 5 et 3600, `LENS_BOB_COINS_MONTHLY` au moins 1) et ne valent que module actif. **`LENS_BOB` ne sert plus** : qui l'utilisait trouve Bob désactivé après la mise à jour, car la lens l'ignore (une ligne dans le log), et un avis sur chaque page dit que Bob n'est plus lu tant que vous ne le réactivez pas depuis Paramètres › Modules et que ce que Bob supprime entre-temps est perdu. « Retirer », dans Paramètres, ôte la variable du LaunchAgent. Le choix « + Bob » ou « Bob seul » du sélecteur repart de « OpenCode ». Les tables `bob_*` restent dans la base même module désactivé : lignes et tables ne sont jamais supprimées (voir [disinstallazione.md](disinstallazione.md)).

IBM ne documente pas le schéma de bob.db. S'il change (une table ou une colonne attendue manque), la lecture de Bob est suspendue et le dashboard le signale ; OpenCode continue comme avant. `node modules/bob/scripts/bob-probe.mjs` montre le schéma du bob.db de cet ordinateur et la forme de ses champs, sans aucun texte. `node modules/bob/scripts/bob-probe.mjs --account` cherche plutôt où Bob garde la consommation de votre compte (Bobcoins utilisés, forfait, renouvellement) : l'état enregistré de Bob IDE, `~/.bob` et le code de Bob IDE et Bob Shell ; là aussi seulement des formes et des noms, jamais de texte ni de token. `--checks` vérifie ce que la lens tient pour acquis : il estime combien de Bobcoins coûte un million de token de chaque type (input nouveau, cache lue, cache écrite, output, par une régression sur les appels : IBM ne publie pas la conversion), contrôle que `input` comprend le cache, que le coût d'une tâche est la somme de ses appels et s'il comprend ses sous-agents, compte les prompts masqués et les jours couverts, et mesure les messages que Bob écrit en retard : combien il en écrit après un plus récent de la même tâche, le retard maximal et combien dépassent les 60 secondes que la lens relit à chaque passage (il compte aussi les messages de l'assistant sans `_meta.spend`). Les trois sondes se lancent aussi depuis le panneau d'IBM Bob dans **Paramètres › Modules**, depuis cet ordinateur seulement et seulement avec le module actif : le résultat se copie ou se télécharge en fichier texte.

## Sécurité et confidentialité

- Elle écoute uniquement sur `127.0.0.1` par défaut. Elle n'accepte que les requêtes avec un `Host` local, comme protection contre le DNS rebinding. Seulement GET (et HEAD), CSP restrictive, pas de CORS. Les seules exceptions sont `POST /api/settings` (modification des variables), `POST /api/dashboard` (disposition du dashboard), `POST /api/presets` (ses presets), `POST /api/skills` et `POST /api/skills/<id>` (bibliothèque de skills), `POST /api/skill-presets` (leurs presets), `POST /api/vibe-projects` (les projets de Vibe Coding) et `POST /api/update` avec `POST /api/update/apply` (mise à jour depuis un zip) : uniquement depuis loopback, uniquement `content-type: application/json`, ou `application/zip` pour le zip de mise à jour et `application/zip` ou `text/markdown` pour une skill (une page d'un autre site ne peut pas les envoyer sans un preflight CORS auquel la lens ne répond pas ; `multipart/form-data` est refusé justement parce qu'il n'en exige pas), avec `Origin`, s'il est présent, égal à l'adresse du dashboard et sans en-têtes de reverse proxy.
- Les skills importées sont des données, pas des programmes : le zip (ou le `SKILL.md`) est contrôlé (noms sûrs, pas de symlink, limites sur le nombre de fichiers et sur la taille, extraction dans un dossier toujours nouveau) et copié dans la bibliothèque à côté de la base, jamais exécuté. Ce sont votre propre configuration, pas des données d'OpenCode, et comme les presets elles ne se modifient que depuis cet ordinateur.
- La mise à jour depuis un zip exécute l'`install.sh` du zip téléversé, avec les permissions de l'utilisateur : c'est la même chose que de le lancer depuis un terminal, et on ne peut la demander que depuis cet ordinateur. Le zip est lu et extrait sans rien exécuter tant que vous ne confirmez pas ; la lens ne télécharge jamais rien depuis internet.
- Elle **ne sert pas de proxy à l'API d'OpenCode** et n'expose jamais son mot de passe. L'API d'OpenCode comprend des endpoints sensibles, comme la liste des identifiants avec les secrets en clair, et ils restent hors du dashboard.
- Elle n'enregistre ni prompts, ni réponses, ni input ou output des tools : seulement des comptages, des temps, des noms de modèles et de tools, et des messages d'erreur. Avant de les enregistrer, elle les expurge : les clés `sk-…`, `Bearer <token>` et les longues chaînes de type token (32 caractères ou plus) deviennent `[redatto]`, le dossier personnel devient `~` ; puis elle les tronque à 500 caractères. C'est un filtre heuristique : un secret court ou d'une autre forme peut passer.
- Elle enregistre les **titres** des sessions, qui sont des résumés générés de votre prompt. `LENS_STORE_TITLES=0` les exclut.
- Elle enregistre le dossier de travail de chaque session, utilisé pour le breakdown par répertoire.
- Le token est comparé en temps constant.
- Une erreur interne répond par un 500 générique ; dans le log ne finissent que la méthode et le chemin de la requête, jamais la query (qui peut contenir `?token=`).
- `GET /api/settings` ne renvoie jamais les secrets ; `LENS_OTLP_ENDPOINT` n'arrive en entier qu'aux clients de cet ordinateur, aux autres masqué (identifiants et query retirés).
- Des prompts elle n'enregistre que la longueur et le nombre de pièces jointes ; des commandes shell seulement si c'était un `git commit` ; des permissions l'action et le nombre de ressources, pas les ressources.
- L'export OTLP, s'il est actif, envoie les mêmes données que la base (comptages, temps, noms), jamais de textes.
- La page Sécurité lit, en lecture seule, les audits et les politiques des guards DLP dans les dossiers d'OpenCode (`LENS_SECURITY_DIRS`, `LENS_SECURITY_CONFIG_DIR`, seulement avec le module Sécurité actif) sans rien écrire et sans les copier dans la base ; depuis le réseau elle ne montre que résultats, tools et catégories. Voir [sicurezza.md](sicurezza.md#qui-voit-quoi).
- Le serveur MCP (`opencode-lens mcp`) ne parle qu'à l'API HTTP de la lens (il lit, et rapporte les livraisons de presets : ids, jamais de textes) et par défaut passe au modèle des comptages et des classes d'erreur, pas des textes, à l'exception du texte des skills des presets, qui est le vôtre : voir [Ce qui arrive au modèle](#ce-qui-arrive-au-modèle).
