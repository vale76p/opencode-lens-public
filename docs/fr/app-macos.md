# App macOS

🌐 [Italiano](../app-macos.md) · [English](../en/app-macos.md) · Français

**OpenCode Lens** (`~/Applications/OpenCode Lens.app`) est une app macOS facultative qui affiche le dashboard de la lens dans une fenêtre native, avec une icône dans le Dock, des notifications et l'ouverture à la connexion. C'est une enveloppe légère : une `WKWebView` qui charge le même dashboard que `http://127.0.0.1:4777`, plus ce qui manque à une page web (menus, Dock, notifications). Ses sources sont dans `extras/macos/` et se compilent sur le Mac qui l'utilise.

## Ce que c'est

- **Facultative.** La lens fonctionne à l'identique sans elle : même service, même dashboard dans le navigateur, mêmes données. `install.sh` copie les sources de l'app dans `~/Applications/opencode-lens/extras/macos/`. L'app s'installe depuis **Paramètres › Mise à jour** ou avec la commande ci-dessous ; ensuite `install.sh` la garde à la version de la lens.
- **Un client HTTP de la lens.** Elle n'ouvre pas la base de données et ne lit pas les fichiers de la lens : elle sait où est la lens grâce au plist du LaunchAgent et lui parle en HTTP sur loopback. Aucune API nouvelle : elle utilise le dashboard, `/healthz` et `/api/budget`.
- **À côté d'OpenCode Lens Monitor, pas à sa place.** Monitor garde la barre des menus : le pourcentage du budget, le panneau, les widgets, Démarrer et Arrêter du LaunchAgent et sa propre ouverture à la connexion. L'app garde la fenêtre du dashboard, l'icône du Dock, les notifications et l'ouverture à la connexion de la fenêtre. Elle n'a pas d'icône dans la barre des menus et ne démarre ni n'arrête la lens. Les deux apps ont des noms et des bundle id différents (`local.opencode-lens-monitor`, `local.opencode-lens.app`) et cohabitent ; aucune n'a besoin de l'autre.

## Prérequis

- macOS 13 ou ultérieur.
- Les Command Line Tools avec Swift 6 ou ultérieur : `xcode-select --install`. Xcode n'est pas nécessaire.
- La lens installée (le script est dans son dossier, `~/Applications/opencode-lens/extras/macos/app.sh`) ou un clone du dépôt.
- Un utilisateur normal : le script refuse de tourner en root et ne demande jamais `sudo`.

Le script vérifie tout cela avant de compiler et s'arrête avec un message s'il manque quelque chose (`Serve swiftc: xcode-select --install (Xcode non serve).`, `Serve macOS 13 o successivo`, `Serve Swift 6 o successivo` ; les messages du script sont en italien).

## Installation

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh install
```

Depuis un clone : `bash extras/macos/app.sh install`.

**Depuis le dashboard.** **Paramètres › Mise à jour › App macOS** montre la version de l'app à côté de celle de la lens et, avec **Installer l'app** (ou **Mettre à jour l'app**), lance la même commande dans un processus qui survit à un redémarrage de la lens ; le log de la compilation reste sur la page. Le bouton n'apparaît que si la lens tourne depuis le LaunchAgent dans son dossier `~/Applications/opencode-lens`, comme pour la mise à jour par zip : une lens de développement montre l'état mais ne peut pas remplacer l'app. Sans les Command Line Tools, pas de bouton : la page dit quoi installer (`xcode-select --install`). Si vous l'utilisez depuis l'app, l'app se ferme et se rouvre.

La commande compile l'app pour l'architecture du Mac (`arm64` ou `x86_64`) dans `~/Library/Caches/opencode-lens-app`, la signe, ferme une copie éventuellement ouverte, la copie dans `~/Applications/OpenCode Lens.app`, vérifie la signature et l'ouvre. Au premier démarrage macOS demande l'autorisation pour les notifications. La version de l'app est celle de la lens depuis laquelle vous la compilez (`version` de `package.json`).

**Pourquoi on la compile sur chaque Mac.** Le zip de la release ne contient que les sources. Une app téléchargée aurait la quarantaine et une signature ad hoc non notarisée, et Gatekeeper la bloquerait ; une app compilée sur le Mac même n'a pas de quarantaine. Pour la même raison, ne copiez pas `OpenCode Lens.app` sur un autre Mac : lancez-y `app.sh install`.

L'app n'est jamais dans `~/Applications/opencode-lens`, que chaque mise à jour de la lens remplace.

## La fenêtre

La fenêtre affiche le dashboard : 1280×840 au premier démarrage, au moins 760×520, et elle retient sa position et sa taille. Si la lens n'est pas sur `127.0.0.1:4777`, le sous-titre de la fenêtre affiche `hôte:port`.

- **⌘W** ferme la fenêtre et libère la page (processus web et flux `/api/live`) ; l'app reste dans le Dock pour les notifications. Un clic sur l'icône du Dock ou **⌘1** rouvrent le dashboard.
- Le zoom de la page (⌘+, ⌘-, ⌘0) va de 50 % à 200 % et se conserve d'un démarrage à l'autre.
- Les fonctions du navigateur que le dashboard utilise sont là aussi : les confirmations avant les actions destructives (`confirm()`, en feuille de la fenêtre), le choix de fichiers et de dossiers (Skill › Importer…), l'enregistrement des fichiers (panneau sur Téléchargements), le plein écran de Monitor, les balayages à deux doigts pour précédent et suivant.
- Si la lens ne répond pas, une page d'erreur native remplace le dashboard : « La lens ne répond pas », « Token manquant ou incorrect » ou « Adresse non prise en charge ». Elle réessaie seule après 2, 4, 8 et 16 secondes, puis toutes les 30, avec un compte à rebours ; **Réessayer** (ou ⏎) et ⌘R réessaient tout de suite. À chaque essai l'app relit le plist, et retrouve donc la lens même si entre-temps son port ou son token a changé.

Le dashboard dans l'app et celui du navigateur sont deux clients indépendants, comme deux onglets : les préférences du navigateur (thème, clés `lens:*`) sont séparées ; disposition et presets sont dans la lens et le dernier enregistrement l'emporte.

### Menus et raccourcis

| Menu | Éléments |
|---|---|
| OpenCode Lens | À propos d'OpenCode Lens · Paramètres… ⌘, (ouvre la page Paramètres du dashboard) · Ouvrir à la connexion · Masquer OpenCode Lens ⌘H · Masquer les autres ⌥⌘H · Tout afficher · Quitter OpenCode Lens ⌘Q |
| Édition | Annuler ⌘Z · Rétablir ⇧⌘Z · Couper ⌘X · Copier ⌘C · Coller ⌘V · Tout sélectionner ⌘A |
| Présentation | Recharger ⌘R · Précédent ⌘[ · Suivant ⌘] · Taille réelle ⌘0 · Agrandir ⌘+ (aussi ⌘=) · Réduire ⌘- · Ouvrir dans le navigateur |
| Fenêtre | Placer dans le Dock ⌘M · Zoom · Dashboard ⌘1 · Fermer ⌘W |
| Aide | Aide d'OpenCode Lens (cette page sur GitHub, dans la langue de l'app) · Envoyer une notification de test |

**Ouvrir dans le navigateur** ouvre la même page dans le navigateur du système. Avec un token, l'adresse porte `?token=` : la lens l'échange contre un cookie et le retire de l'adresse par une redirection, mais la première adresse peut rester dans l'historique du navigateur.

La langue des menus et des notifications est le `LENS_LANG` du plist s'il vaut `it`, `en` ou `fr` ; sinon la première de celles-ci parmi les langues préférées de macOS ; sinon l'anglais.

## Dock

- **Pastille** : `!` quand la lens n'a pas répondu à deux contrôles de suite ; sinon le nombre de budgets dépassés à ce moment ; rien si tout va bien.
- **Menu de l'icône** (clic droit) : une ligne d'état (« La lens répond (127.0.0.1:4777) », « La lens ne répond pas (…) » ou « Contrôle de la lens en cours… »), « Budgets dépassés : N » s'il y en a, puis **Recharger** et **Ouvrir dans le navigateur**.

## Notifications

L'app contrôle la lens 5 secondes après le démarrage puis une fois par minute, même fenêtre fermée : `GET /healthz` puis `GET /api/budget`, avec sa propre session HTTP (sans cookies ni cache) et le token dans l'en-tête `Authorization`. Elle ne lit pas la page du dashboard. Au réveil, les contrôles échoués d'avant ne comptent plus et le contrôle suivant arrive après 10 secondes. macOS peut retarder un contrôle de quelques minutes pour économiser l'énergie (App Nap) : une notification peut arriver en retard.

| Événement | Titre | Texte |
|---|---|---|
| Un budget est à 100 % ou plus (jour, semaine ou mois ; tokens, coût ou steps) | Budget dépassé | « Aujourd'hui, tokens : 120 % du budget » (aussi « Cette semaine », « Ce mois-ci » ; « coût », « steps ») |
| Un modèle a dépassé son budget journalier (`LENS_MODEL_LIMITS`) | Budget dépassé | « openai/gpt-5.5 : 104 % du budget du jour » |
| Plus de trois nouveaux budgets à la fois (par exemple au premier démarrage) | Budgets dépassés : N | les trois premiers, puis « et N autres » |
| La lens ne répond pas à deux contrôles de suite (environ 2 minutes), après avoir répondu au moins une fois depuis le démarrage de l'app | La lens ne répond pas | « Aucune réponse de 127.0.0.1:4777 lors des derniers contrôles. » |
| La lens répond de nouveau | La lens répond de nouveau | « 127.0.0.1:4777 répond. » ; la notification précédente est retirée |

- Le 503 du mode diagnostic compte aussi comme « ne répond pas ».
- **Déduplication.** Chaque budget est notifié une fois par période : « Aujourd'hui, tokens » au plus une fois par jour, « Cette semaine » une fois par semaine. Ceux déjà notifiés restent dans `notified.<port>` des préférences de l'app (`local.opencode-lens.app`) ; quand la période se termine, ils sont oubliés. Rouvrir l'app ne répète pas les notifications.
- **Retenues seulement si livrées.** Si une notification ne part pas (autorisation refusée, erreur du centre de notifications), ce budget n'est pas marqué et le contrôle suivant réessaie.
- Un clic sur une notification amène la fenêtre au premier plan sur la vue **Maintenant**. Les notifications s'affichent aussi quand l'app est au premier plan.
- **Aide › Envoyer une notification de test** envoie une notification ; si elle ne peut pas s'afficher, une alerte dit pourquoi (notifications désactivées, ou l'erreur du système).

Pour revoir les notifications de budget déjà envoyées (port 4777) : `defaults delete local.opencode-lens.app notified.4777`.

### Si les notifications n'arrivent pas

Avec la signature ad hoc qu'`app.sh` utilise par défaut, macOS peut refuser les notifications de l'app : le centre de notifications ne la reconnaît pas et le log du système affiche « Failed to find or validate client ». Pour les activer :

1. Ouvrez la copie dans `~/Applications` et répondez **Autoriser** à la demande, si elle apparaît.
2. **Réglages Système › Notifications › OpenCode Lens** : activez « Autoriser les notifications », style « Bannières ».
3. **Aide › Envoyer une notification de test**.
4. Si l'app n'est pas dans la liste ou si le test donne une erreur, signez-la avec un certificat de signature de code (par exemple celui que vous utilisez déjà pour Monitor). Trouvez son nom exact :

   ```bash
   security find-identity -v -p codesigning
   ```

   Réinstallez avec ce certificat et vérifiez la signature :

   ```bash
   LENS_APP_SIGN="<nom exact du certificat>" bash ~/Applications/opencode-lens/extras/macos/app.sh install
   codesign -dv ~/Applications/"OpenCode Lens.app" 2>&1 | grep Authority
   ```

   Rouvrez l'app et répétez les étapes 2 et 3.

Pour le diagnostic, le log des 5 dernières minutes (en zsh, utilisez `/usr/bin/log` : `log` seul est une commande du shell) :

```bash
/usr/bin/log show --last 5m --predicate 'eventMessage CONTAINS "local.opencode-lens.app"' | grep -iE "validate client|hasError"
```

Les budgets non livrés n'ont pas été retenus : ils arrivent seuls au premier contrôle réussi.

## Ouvrir à la connexion

**OpenCode Lens › Ouvrir à la connexion** ouvre l'app (et la fenêtre) à chaque connexion. L'élément n'est actif qu'avec l'app dans `~/Applications` ou `/Applications`, où `app.sh install` la met ; depuis un autre dossier (par exemple une build d'essai) il est désactivé et une infobulle dit pourquoi. Le désactiver est toujours possible.

Si macOS demande une approbation, l'élément devient « Ouvrir à la connexion (à approuver dans Réglages Système) » et un clic ouvre **Réglages Système › Général › Ouverture**. Après une réinstallation, macOS peut afficher à nouveau l'avis d'élément d'ouverture ajouté.

C'est indépendant du démarrage de la lens, qui reste le rôle du LaunchAgent (et de Monitor pour Démarrer/Arrêter).

## Port, token et hôte

L'app lit port, token, hôte et langue dans les `EnvironmentVariables` du plist du LaunchAgent, `~/Library/LaunchAgents/local.opencode-lens.plist`, comme le serveur MCP. Elle le relit à chaque chargement et à chaque contrôle : si vous changez le port depuis les Paramètres, l'app suit la lens à la nouvelle adresse.

| Variable | Usage dans l'app |
|---|---|
| `LENS_PORT` | port de la lens ; vide, `0` ou invalide → 4777 |
| `LENS_TOKEN` | token pour le dashboard et les contrôles ; **valable seulement sur le port du plist** |
| `LENS_HOST` | `127.0.0.1`, `0.0.0.0`, `::`, `[::]` → l'app utilise `127.0.0.1` ; `localhost` → `localhost` ; toute autre valeur (`::1`, une adresse réseau, un nom) → page « Adresse non prise en charge » |
| `LENS_LANG` | langue de l'app (`it`, `en`, `fr`) |

- `LENS_PORT` et `LENS_TOKEN` dans l'environnement de l'app (par exemple `open -n --env LENS_PORT=4800 …`) l'emportent sur le plist. Si le port vient de l'environnement et diffère de celui du plist, le token du plist n'est pas utilisé : le token de la vraie lens ne part jamais vers une lens de développement.
- Un hôte non loopback est refusé : l'app ne se connecte jamais à un autre ordinateur et n'envoie jamais le token en clair sur le réseau. Pour une lens joignable depuis le réseau, utilisez le navigateur.
- Un `401` relit le plist et remet le token une fois ; si la lens refuse encore, la page « Token manquant ou incorrect » apparaît.

## Sécurité

- **Seulement l'origine de la lens.** Seul le `http://<hôte>:<port>` de la lens, sans identifiants dans l'adresse, reste dans la fenêtre ; `about:blank` est admis. Un fichier créé par le dashboard (`blob:` de la lens) peut seulement être enregistré. Tout le reste est annulé : `file:`, `javascript:`, `data:` comme page, frames et redirections vers d'autres sites.
- **Liens externes dans le navigateur, seulement s'ils sont cliqués.** Un clic sur un lien `http`, `https` ou `mailto` vers un autre site (aussi `target="_blank"`) l'ouvre dans le navigateur du système. Un `window.open` lancé par un script n'ouvre rien : les scripts ne peuvent pas ouvrir de fenêtres et l'app ne crée jamais de deuxième page.
- **Aucun JavaScript injecté.** Ni scripts utilisateur ni ponts entre page et app ; la page d'erreur est native ; la Content-Security-Policy de la lens reste intacte. Un test (`test/macos-app.test.js`) le fait respecter.
- **Le token** arrive au dashboard dans un cookie de session `lens_token` (HttpOnly, SameSite Strict, sans expiration : il n'arrive jamais sur le disque), posé par l'app avant le chargement ; pour les contrôles il passe dans l'en-tête `Authorization`. Jamais dans l'adresse, jamais dans les logs. Si vous le passez avec `open --env LENS_TOKEN=…`, il est visible dans `ps eww`, comme pour le MCP.
- **Réseau** : App Transport Security n'admet que le réseau local (`NSAllowsLocalNetworking`). Signée avec le hardened runtime ; pas d'App Sandbox.
- **Données** : les préférences du dashboard (`localStorage`) sont dans les données WebKit de l'app, `~/Library/WebKit/local.opencode-lens.app`.
- **Limite connue.** Un `a.click()` appelé par un script sur un lien sans `target` arrive à WebKit comme un vrai clic : un lien externe ouvert ainsi irait dans le navigateur. Seuls les scripts de la lens tournent dans la fenêtre (sa Content-Security-Policy le garantit) : il faudrait donc un défaut du dashboard lui-même.

## Mise à jour

Après chaque installation de la lens (nouveau zip depuis le terminal, ou **Paramètres › Mise à jour**, aussi depuis l'app) `install.sh` lance `app.sh update` : si l'app est installée et que sa version diffère de celle de la lens, il la recompile et la réinstalle. Il ne la rouvre que si elle était ouverte. La compilation dure environ une minute et démarre après le redémarrage de la lens, qui est déjà disponible entre-temps ; son log rejoint celui de la mise à jour.

Si la compilation échoue (par exemple, les Command Line Tools manquent), la lens reste à jour et **Paramètres › Mise à jour › App macOS** indique que l'app est restée en arrière, avec le bouton pour réessayer. Depuis le terminal :

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh update
```

`LENS_SKIP_APP=1 bash <dossier extrait>/install.sh` saute l'étape.

**Avec un certificat.** Sans `LENS_APP_SIGN`, `app.sh` réutilise le certificat avec lequel l'app installée était signée, s'il est encore dans le trousseau. La première fois que `codesign` utilise sa clé, macOS peut demander l'autorisation avec une fenêtre : répondez **Toujours autoriser**. Si personne n'est devant l'écran, une compilation lancée depuis le dashboard reste en attente ; la lens est de toute façon à jour.

## Désinstallation

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh uninstall
```

Elle retire, dans cet ordre : l'élément d'ouverture (l'app elle-même le désenregistre, avec `OpenCodeLens --unregister-login-item`), l'app ouverte, `~/Applications/OpenCode Lens.app`, le cache de build `~/Library/Caches/opencode-lens-app`, les données WebKit (`~/Library/WebKit/local.opencode-lens.app`, `~/Library/Caches/local.opencode-lens.app`, `~/Library/HTTPStorages/local.opencode-lens.app` et `.binarycookies`), l'état enregistré des fenêtres et les préférences de l'app (`defaults delete local.opencode-lens.app` : taille de la fenêtre, zoom, budgets notifiés).

Elle laisse la lens, son LaunchAgent, la base de données et toutes ses données, et Monitor. Pour retirer aussi la lens, suivez [disinstallazione.md](disinstallazione.md) en lançant d'abord cette commande : le script est dans le dossier de la lens.

## Développement

```bash
bash extras/macos/app.sh test                 # tests de la partie pure (Sources/Core), « OK N checks »
bash extras/macos/app.sh build --out /tmp/olapp   # compile sans installer
npm run test:macos                            # vraie build, signature, version et icône ; avant une release
```

- `app.sh build` sans `--out` compile dans le cache, `~/Library/Caches/opencode-lens-app`. Choisissez un dossier `--out` hors d'iCloud (`~/Documents` peut l'être) : les attributs étendus cassent la signature et le script le signale. La compilation elle-même se fait dans un dossier temporaire.
- `npm run test:macos` (`test/macos/app.test.js`) compile vraiment l'app et vérifie bundle, signature ad hoc avec hardened runtime, version, icône et architecture, sans jamais la démarrer. Il est ignoré hors de macOS ou sans Command Line Tools. Il fait partie des contrôles avant une release ; il ne tourne pas en CI.
- `npm test` (CI compris) contient les contrôles statiques `test/macos-app.test.js` (script, `Info.plist`, sources sans JavaScript injecté, aucun fichier de la lens qui dépende de l'app) et `test/macos-app-contract.test.js` (les API de la lens que l'app utilise).
- Variables pour les essais, à passer avec `open -n --env …` :

  | Variable | Effet |
  |---|---|
  | `LENS_APP_PLIST` | un autre plist à la place de celui du LaunchAgent, par exemple le `dev/data/dev.plist` de la lens de développement (copiez-le hors de `~/Documents` : là, les autorisations de macOS peuvent bloquer l'app) |
  | `LENS_APP_INSPECTABLE=1` | la page devient inspectable depuis Safari › Développement (macOS 13.3 ou ultérieur) |
  | `LENS_PORT`, `LENS_TOKEN` | port et token à la place de ceux du plist |
  | `LENS_APP_SIGN` | pour `app.sh build` et `install` : le certificat avec lequel signer à la place de la signature ad hoc |

  ```bash
  open -n --env LENS_APP_PLIST=/tmp/dev.plist --env LENS_APP_INSPECTABLE=1 "/tmp/olapp/OpenCode Lens.app"
  ```

- Organisation : `Sources/Core` (logique pure, Foundation seulement, avec ses tests dans `Tests/CoreTests.swift`), `Sources/App` (AppKit, WebKit, notifications, éléments d'ouverture), `Tools/MakeIcon.swift` (l'icône, générée depuis la marque du dashboard à chaque build), `Info.plist`, `app.sh`. Ni projet Xcode ni SwiftPM.

## Limites

- Elle n'est pas intégrée à `uninstall.sh` ni à **Paramètres › Désinstallation** : elle se retire seulement avec `app.sh uninstall`.
- Pas d'icône dans la barre des menus (Monitor en a une), pas d'option pour masquer l'icône du Dock, pas d'ouverture masquée à la connexion.
- Les notifications ne couvrent pas la projection « au-delà du budget en fin de journée », les drifts de l'API ni le motif du mode diagnostic ; l'intervalle d'une minute ne se change pas.
- Avec un token erroné, les contrôles échouent comme si la lens ne répondait pas : le Dock dit « ne répond pas », tandis que la fenêtre affiche la page du token.
- `LENS_HOST=::1`, les adresses réseau et les noms `.local` ne sont pas pris en charge.
- Seulement l'architecture du Mac qui compile ; signature ad hoc par défaut (les notifications peuvent demander un certificat) ; pas d'App Sandbox.
- **Aide d'OpenCode Lens** ouvre cette page sur GitHub : il faut l'accès au dépôt.
- `prompt()` n'est pas pris en charge (le dashboard ne l'utilise pas).
