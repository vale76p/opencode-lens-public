# Sécurité : les guards DLP

🌐 [Italiano](../sicurezza.md) · [English](../en/sicurezza.md) · Français

Un **guard DLP** est un plugin d'OpenCode qui contrôle ce que les tools MCP externes s'apprêtent à envoyer à l'extérieur (par exemple le texte d'une requête vers un service de documentation) et le laisse passer, le bloque ou vous demande. Celui qui existe aujourd'hui est **Context7 Guard**, mais la page **Sécurité** (`#security`) ne le connaît pas par son nom : elle lit les fichiers qu'un guard laisse de lui-même, donc un nouveau guard apparaît tout seul.

La page répond à trois questions :

1. **Ce qui est passé et ce qui a été bloqué**, sur une période de votre choix.
2. **Pourquoi** : quelles catégories de données le guard a reconnues, dans quel tool et sur quel objet.
3. **Le guard fonctionne-t-il ?** Si son audit est lisible et récent, si sa politique est valide et s'il enregistre tous les appels que Lens a vus.

La lens **n'écrit rien** dans les fichiers du guard et ne change pas son comportement : elle ouvre ses fichiers en lecture seule, c'est tout. Les événements sont relus depuis le fichier à chaque requête (avec un cache sur la date de modification) et ne sont jamais copiés dans la base de données.

## Le module Sécurité

Sécurité est un **module** (`modules/security/`, voir [moduli.md](moduli.md)) et il est **désactivé** par défaut : on l'active depuis **Paramètres › Modules**. Désactivé, il n'a pas d'entrée de menu, `/api/security` et `/api/security/<guard>` répondent 404, `/metrics` n'a pas la série `opencode_lens_security_events` et le serveur MCP n'offre pas l'outil `security`. Avec le module désactivé, la lens ne lit pas les fichiers des guards : elle regarde seulement s'il y a un audit, pour l'avis « était utilisé : réactivez-le depuis Paramètres › Modules » après une mise à jour. Les dossiers parcourus sont deux réglages du module (voir [Dossiers parcourus](#dossiers-parcourus)).

## Comment la lens trouve un guard

Par convention de nom. Un guard `<nom>` laisse jusqu'à trois traces :

| Quoi | Où | Obligatoire |
|---|---|---|
| **Audit** | `<nom>.audit.jsonl` dans le dossier de données d'OpenCode (`$XDG_DATA_HOME/opencode`, en général `~/.local/share/opencode`) ou dans son sous-dossier `security/` | oui : c'est ce qui fait exister le guard |
| **Politique** | `<nom>.json` dans le dossier de configuration d'OpenCode (`$XDG_CONFIG_HOME/opencode`, en général `~/.config/opencode`) | non |
| **Plugin** | un fichier `plugins/<nom>.*` ou `plugins/<nom>-*` avec l'extension `.ts`, `.js` ou `.mjs` dans le même dossier de configuration : le nom est suivi d'un point ou d'un tiret, ainsi le guard `a` ne prend pas `aws-tool.ts` | non |

Pour Context7 Guard ce sont, par exemple, `context7-guard.audit.jsonl`, `context7-guard.json` et `plugins/context7-guard.v2.ts`.

**Pour qu'un nouveau guard apparaisse, il lui suffit d'écrire un `<nom>.audit.jsonl`** dans l'un de ces dossiers. Il n'y a rien à changer dans Lens, rien à enregistrer et rien à déclarer dans un fichier : la politique et le plugin, s'ils existent, se reconnaissent au nom.

Règles :

- `<nom>` est fait de minuscules, de chiffres et de tirets (`context7-guard`), 40 caractères au plus. Les autres fichiers `.audit.jsonl` sont ignorés.
- Les dossiers sont parcourus sans descendre dans les sous-dossiers. Si le même nom apparaît dans deux dossiers, le premier l'emporte. Au plus 20 guards sont affichés, par ordre alphabétique.
- Seuls les fichiers réguliers sont lus : un lien symbolique n'est jamais suivi. Le plugin n'est jamais ouvert : la lens vérifie seulement que le fichier est là.
- L'étiquette du guard est son nom sous forme lisible (`context7-guard` devient « Context7 guard »).

### Une ligne de l'audit

Chaque ligne est un objet JSON. Tous les champs sont facultatifs sauf l'heure ; ce qui manque reste vide, sans erreur.

| Champ | Ce que c'est |
|---|---|
| `ts` | l'heure : texte ISO 8601 ou millisecondes depuis l'époque. Sans heure valide, ou avec une heure de plus d'un jour dans le futur, la ligne est écartée |
| `outcome` | le résultat. `allowed` (autorisé), `blocked` (bloqué), `approved-by-user` et `rejected-by-user` sont traduits ; une autre valeur (minuscules et tirets, jusqu'à 40 caractères) s'affiche telle quelle, une valeur invalide devient « ? » |
| `tool` | le tool MCP appelé |
| `kind` | le type d'appel |
| objet | ce sur quoi portait l'appel, pris dans le **premier champ présent parmi `object`, `library`, `target` et `resource`** (jusqu'à 120 caractères) |
| `findings` | jusqu'à 20 détections `{ category, detail, field }`. `category` est un code de majuscules, chiffres et `_` (`INFRA_INTERNA`) ; `detail` est le texte du guard (jusqu'à 160 caractères) |
| `chars`, `lines` | la taille de ce qui allait être envoyé |
| `sha256` | l'empreinte (hexadécimale) de ce qui allait être envoyé ; le tool MCP en montre les 12 premiers caractères, les mêmes que dans le message de blocage du guard |
| `sessionID` | la session d'OpenCode : c'est le lien avec les sessions de la lens |
| `callID`, `partID`, `runtime` | des identifiants que la page montre dans le détail |
| `args` | l'aperçu : un objet de 4096 caractères au plus. Si le guard ne l'écrit pas, le détail dit « non enregistré par le guard » |

Une ligne illisible (JSON cassé, plus de 8 Kio, sans heure valide ou avec une heure de plus d'un jour dans le futur) ne devient pas un événement mais est comptée comme une **ligne illisible**. La dernière ligne, si elle ne se termine pas par un retour à la ligne, est encore en cours d'écriture : elle est ignorée et non comptée. Un audit de plus de **20 Mio** n'est lu que par la fin (les 20 derniers Mio) : la santé le signale.

Les codes de catégorie s'affichent sous forme lisible (`INFRA_INTERNA` devient « Infra interna ») et chacun prend une couleur dans la palette de la page, toujours la même pour le même code. Il y a 6 couleurs pour un nombre quelconque de codes : deux catégories différentes peuvent avoir la même couleur, donc le nom compte plus que la couleur.

## La page

Avec le module actif, `#security` est dans le groupe *Lens* de la barre latérale, après Système (s'il est actif lui aussi). C'est une page fixe (pas un widget), en lecture seule, avec sa propre période : **7 jours**, **30 jours** (par défaut) ou **Tout**, mémorisée par le navigateur. Elle est relue toutes les 10 secondes tant qu'elle est ouverte.

- Sous le titre, le guard choisi et son **verdict** en toutes lettres ; le point à côté de l'heure de mise à jour en prend la couleur.
- Un bouton par **guard**, avec un point de la couleur du verdict (vert, jaune, rouge).
- **En haut**, une bande sombre avec six tuiles, chacune avec son graphique :
  - *État du guard* : un anneau avec les contrôles sans problème (par exemple 5/5), le verdict et une barrette colorée par contrôle ;
  - *Appels* (dont combien autorisés) et *Blocages*, avec leur évolution sur la période et la **variation** par rapport à la période de même durée juste avant (pour les blocages, une hausse est en rouge). La variation manque avec *Tout* et quand l'audit ne remonte pas jusqu'au début de la période précédente, car elle la ferait paraître plus calme qu'elle ne l'était ;
  - *Taux de blocage*, avec sa moyenne mobile sur 7 points. Il n'apparaît que si la période compte au moins un appel autorisé : si le guard n'enregistre que les blocages, la tuile dit « seuls les blocages sont enregistrés » ;
  - *Détecté* : la catégorie la plus fréquente et une barre avec la part de chaque catégorie ;
  - *Dernier blocage* : quand et dans quel tool, avec les blocages des dernières 24 heures sur une ligne.

  Un blocage est un `blocked` ou un `rejected-by-user` ; un appel autorisé est un `allowed` ou un `approved-by-user`.
- **Santé** : le verdict avec un bouclier et une ligne par contrôle, avec son état, sa valeur et une note qui dit pourquoi il compte ou quoi regarder (voir [ci-dessous](#santé)).
- **Politique**, à côté de la santé : les protections activées ou non et les clés réparties en groupes, voir [ci-dessous](#la-politique).
- **Événements** : au-dessus du tableau, les appels et les blocages dans le temps. Les appels (autorisés et approuvés par l'utilisateur) sont au-dessus de l'axe, les blocages (bloqués et refusés par l'utilisateur) en dessous, sur une échelle à eux, car quelques blocages parmi beaucoup d'appels seraient sinon invisibles ; un point par heure pour une période jusqu'à 2 jours, par jour jusqu'à 120 jours, par semaine au-delà. Le survol d'un point en donne les comptes. Puis le tableau, du plus récent, 50 par page (*Précédents* et *Suivants*), avec le filtre **Tous** ou **Blocages seulement**. Chaque ligne a l'heure, le résultat, le tool, l'objet et les catégories. Un clic sur une ligne ouvre le détail : objet et type, champ, taille, session (titre et dossier, si Lens la connaît), si Lens a aussi vu le tool, l'identifiant de l'appel, le runtime, l'empreinte, les détections avec leur texte et l'**aperçu** (seulement si le guard écrit `args`). À côté de l'identifiant de l'appel et de l'empreinte, un bouton **Copier**. Tant que le détail est ouvert, la relecture toutes les 10 secondes ne le redessine pas tant que l'événement ne change pas, donc le texte sélectionné le reste.
- À côté des événements : **Ce qui a été détecté** (événements par catégorie, les 8 premières), **Par tool** (événements des 10 tools les plus utilisés, avec la part bloquée) et **Quand cela arrive** (les blocages par jour de la semaine et heure, à l'heure locale de l'ordinateur de la lens).
- Sans aucun guard, la page dit quels dossiers elle a parcourus et renvoie à ce document.

Les totaux, tuiles, graphiques et catégories sont toujours ceux de **toute la période** : le filtre des blocages et la pagination ne changent que le tableau.

## Santé

Pour chaque guard la lens répond à « puis-je lui faire confiance ? » sans rien demander au guard :

| Contrôle | Ce qu'il regarde |
|---|---|
| Audit | qu'il y ait des événements ; la taille ; les lignes illisibles ; s'il a été lu seulement par la fin |
| Politique | que `<nom>.json` soit là, soit un JSON valide (un objet) et tienne dans 1 Mio. S'il contient `auditLog`, que ce soit une chaîne qui pointe vers le fichier d'audit trouvé (seul un `~/` initial est développé, et les liens symboliques des dossiers sont résolus des deux côtés) ; un `auditLog` qui n'est pas une chaîne compte comme « pointe vers un autre fichier » |
| Plugin | que le fichier dans `plugins/` soit là |
| Dernier événement | quand ; **plus de 7 jours** est « ancien » |
| Comparaison avec Lens | voir ci-dessous |

Le **verdict** est le pire des contrôles. Il est *en panne* (rouge) si la politique existe mais n'est pas valide. Il est *à vérifier* (jaune) si le dernier événement est ancien, s'il y a des lignes illisibles, si l'audit n'a été lu que par la fin, si `auditLog` pointe vers un autre fichier, si la politique est trop volumineuse ou si la comparaison avec Lens trouve un écart. Sinon il est *ok* (vert). Un plugin ou une politique absents n'abaissent pas le verdict : ils sont facultatifs.

### Comparaison avec Lens

C'est le seul signal « vivant » qui ne demande rien au guard. Les noms distincts de `tool` qui apparaissent dans l'audit (depuis toujours, pas seulement sur la période) sont les tools que le guard surveille. Pour la période choisie la lens compte dans sa propre base les appels à ces tools et les compare aux lignes de l'audit :

- égaux : « 12 appels, comme dans Lens » ;
- **plus d'appels dans Lens que dans l'audit** : « Lens a vu 12 appels, l'audit 0 » est un écart (verdict jaune). Cela veut dire que le guard n'enregistre pas : il est éteint, non chargé, contourné ou n'écrit pas les appels autorisés ;
- « Non vérifiable » si l'audit ne nomme encore aucun tool.

Les appels de Lens se comptent à partir du plus ancien événement que l'audit contient encore, quand il est plus récent que le début de la période : les appels faits avant que le guard commence à écrire, avant une rotation de l'audit ou avant la partie lue d'un audit de plus de 20 Mio ne sont pas un écart. Un guard qui a écrit par le passé et n'écrit plus rien sur la période donne en revanche un écart.

La page ne décide pas à votre place de ce qui s'est passé : elle donne les deux chiffres. Pour un guard qui n'enregistre **que les blocages**, la comparaison signale un écart chaque fois qu'un appel passe, parce que Lens le compte et pas l'audit.

## La politique

Si `<nom>.json` existe et est valide, la page en montre toutes les clés de premier niveau (jusqu'à 100), réparties en groupes : *Application*, *Détection*, *Listes* et *Audit* pour les clés des guards qui suivent la convention de Context7 Guard, *Autres* pour toutes les autres, dans l'ordre du fichier. Un chemin ou un texte long occupe toute la largeur de son groupe.

Au-dessus des groupes, les **protections** que la politique active ou non, pour les clés connues seulement : *Bloque* (`mode` égal à `block`), *Fail-closed* (`failClosed` vrai), *Données personnelles* (`detectPersonalData` vrai), *Pas de preuves dans le journal* (`logEvidence` faux) et *Audit complet* (`auditAllowed` vrai). Chacune est verte si elle protège et jaune sinon, avec le compte « n protections actives sur m » à côté du titre ; les oui/non de ces clés prennent la même couleur. Une clé absente, masquée ou d'un autre type ne devient pas une protection. Un guard avec d'autres clés n'est pas jugé : ses clés sont simplement affichées.

Comment s'affichent les valeurs :

- chaînes et nombres comme texte ; booléens comme oui/non ; listes de chaînes comme étiquettes (les 5 premières, puis « +n », qui compte toutes les entrées de la liste, même au-delà des 50 que la lens envoie) ; objets et autres listes comme leur nombre d'entrées ; les noms des clés sont coupés à 60 caractères ;
- les clés dont le nom contient, en majuscules ou minuscules, `secret`, `token`, `password` ou `passwd`, `api_key`, `api-key` ou `apikey`, `credential`, `private`, `auth`, `bearer` ou `dsn` sont **omises**, et la note sous les groupes dit combien ;
- une chaîne est masquée par `••••` si l'un quelconque de ses mots (séparés par des espaces) fait 32 caractères ou plus, a une forte entropie et n'est pas un chemin : ainsi `Bearer eyJ…` est cachée en entier ;
- un mot est un chemin, et s'affiche en entier, s'il commence par `~/`, `/`, `./` ou `../`, ne contient ni `+` ni `=` (le base64 en a) et a au moins deux parties séparées par `/`, chacune faite seulement de lettres, de chiffres et de `.`, `_`, `~`, `@`, `%`, `-`. Un chemin avec une espace se regarde mot par mot : si la partie après l'espace est longue et à forte entropie, la chaîne est masquée.

La politique affichée est **la politique globale**, celle du dossier de configuration d'OpenCode : un projet peut la rendre plus restrictive et Lens ne le voit pas. La note sous les groupes le redit, avec la date de dernière modification du fichier.

## Qui voit quoi

Trois niveaux, les mêmes pour la page, `/api/security` et le tool MCP :

| Où | Ce qu'il voit |
|---|---|
| **Dashboard sur cet ordinateur** | tout : objets, détails des détections, sessions, aperçus, politique, chemins des fichiers, filtres par session et dossier |
| **Dashboard depuis le réseau** (avec le token) | la « vue réduite » (`restricted: true`) : pour chaque événement seulement l'heure, le résultat, le tool, le type et les codes de catégorie ; puis les totaux, les graphiques, les catégories et la santé. Les endpoints de la Sécurité ne donnent ni objets, ni détails, ni sessions, ni politique, ni chemins, ni dossiers parcourus ; la page Paramètres, dans *Données et fichiers*, liste toutefois les dossiers des guards comme elle liste tout autre chemin de la lens. Les filtres par session et dossier sont ignorés |
| **Tool MCP `security`** | événements avec heure, résultat, tool, objet, catégories et l'empreinte de 12 caractères ; jamais le texte des détections (`detail`) ni les aperçus. De la politique, clés et valeurs simples (les nombres tels qu'écrits) ; les listes deviennent « N entrées », N étant le nombre de toutes les entrées, et les valeurs masquées restent cachées |

Derrière un reverse proxy qui ajoute ses propres en-têtes, même les requêtes venant de la même machine comptent comme « depuis le réseau » : voir [Derrière un reverse proxy](configurazione.md#derrière-un-reverse-proxy).

## Dossiers parcourus

Deux variables, toutes deux facultatives, qui sont les **réglages du module** : elles ne sont lues que module actif et se changent depuis sa carte de **Paramètres › Modules** (pas depuis le tableau des variables du noyau ; voir [moduli.md](moduli.md#les-réglages-dun-module)). Une mauvaise valeur met le module en erreur, avec la raison dans la carte.

| Variable | Défaut | |
|---|---|---|
| `LENS_SECURITY_DIRS` | `$XDG_DATA_HOME/opencode:$XDG_DATA_HOME/opencode/security` (en général `~/.local/share/opencode`, aussi sur macOS) | où chercher les `<nom>.audit.jsonl` ; plusieurs dossiers séparés par `:` |
| `LENS_SECURITY_CONFIG_DIR` | le dossier de configuration d'OpenCode (`$XDG_CONFIG_HOME/opencode`, en général `~/.config/opencode`) | où chercher `<nom>.json` et `plugins/<nom>*` |

Avec `LENS_SECURITY_DIRS` définie, **seuls** les dossiers indiqués sont parcourus. La page Paramètres, dans la section *Données et fichiers*, les liste parmi les fichiers lus, en « lecture seule », tant que le module est actif ; ce sont des chemins en lecture seule que la lens n'écrit ni ne supprime, et le script de désinstallation n'y touche jamais.

## Tool MCP `security`

Pour le modèle qui travaille dans OpenCode : `lens_security`. Voir [Serveur MCP pour OpenCode](configurazione.md#serveur-mcp-pour-opencode) pour l'installation.

**Il faut redémarrer OpenCode.** L'outil n'existe qu'avec Sécurité actif. Quand vous l'activez ou le désactivez, le MCP s'en aperçoit en 30 secondes et prévient OpenCode avec `notifications/tools/list_changed`, mais OpenCode (vérifié avec la 2.0.26) **ne relit pas** la liste des outils ni les instructions du serveur : il continue d'afficher l'ancienne liste jusqu'à ce que vous le redémarriez. Si `lens_security` est déjà dans la liste et que le module est désactivé, l'appeler répond « Il modulo Security è spento in Lens: attivalo da Impostazioni › Moduli. » ; si vous venez d'activer le module, l'outil apparaît après le redémarrage. Si la lens ne répond plus, le MCP garde le dernier état connu.

| Argument | Valeurs | |
|---|---|---|
| `guard` | le nom du guard | sans lui, le seul guard trouvé s'il n'y en a qu'un, sinon le résumé de tous |
| `session` | `current` ou un id `ses_…` | une seule session |
| `scope` | `project` (défaut) ou `all` | sans `session` : le projet de la session qui demande, ou tous |
| `since` | `1h`, `6h`, `24h` (défaut), `7d` | la période, jusqu'à maintenant |
| `outcome` | `blocked`, `allowed`, `all` (défaut) | seulement les bloqués, seulement les autorisés ou tous |
| `limit` | 1–30, 10 par défaut | événements au maximum |

Questions typiques : « qu'ont bloqué les guards DLP aujourd'hui ? », « le guard Context7 fonctionne-t-il ? ». Si un tool a échoué avec un message qui commence par « GUARD — invio bloccato », c'est un blocage DLP, pas une panne : les instructions du serveur le disent au modèle, qui interroge `security` (avec `session: "current"` et `outcome: "blocked"` ; l'empreinte de 12 caractères est la même que dans le message).

La réponse dit combien d'appels il y a eu et combien ont été bloqués (et le taux, si l'audit enregistre aussi les autorisés), les catégories détectées (jusqu'à 10, puis combien d'autres), les événements les plus récents, la santé (audit, politique, plugin, comparaison avec Lens, jugement et, s'il n'est pas ok, ses raisons : lignes illisibles, aucun événement depuis N jours, audit lu seulement par la fin, `auditLog` qui pointe vers un autre fichier, politique non valide ou trop volumineuse, écart avec Lens) et la politique globale. Les totaux en tête sont ceux du guard sur toute la période : `session` et `scope` ne restreignent que la ligne des événements, qui dit à quoi elle se rapporte. Le traitement habituel des textes s'applique : nettoyés, raccourcis et entre « ».

## Sur `/metrics`

Un gauge, écrit à partir du scan en cache, qui **n'existe qu'avec Sécurité actif** :

| Série | Type | Étiquettes |
|---|---|---|
| `opencode_lens_security_events` | gauge | `guard`, `outcome` (`allowed`, `blocked`, `approved-by-user`, `rejected-by-user`, et `other` pour tout autre résultat ou une ligne sans résultat) : les événements présents **dans tout l'audit** pour chaque résultat |

C'est un gauge, pas un counter : si l'audit est tourné ou nettoyé il baisse, et un audit lu par la fin ne compte que ce qui a été lu. Il part aussi dans l'export OTLP (comme gauge, avec les autres métriques des modules actifs) et n'a pas de période. Un exemple d'alerte sur les blocages de la dernière heure : `delta(opencode_lens_security_events{outcome="blocked"}[1h]) > 0`.

## Limites et ce que la lens ne fait pas

- **Elle n'écrit et ne crée rien** dans les dossiers du guard et ne change pas le guard : elle lit, c'est tout. Les données restent dans les fichiers du guard ; la lens ne les copie pas dans la base.
- **La politique est la politique globale.** Un projet peut en avoir une plus restrictive et Lens ne le sait pas.
- **L'aperçu n'existe que si le guard écrit `args`** (dans Context7 Guard avec `logEvidence` activé dans la politique). Sans lui, le détail dit « non enregistré par le guard ».
- **Un audit de plus de 20 Mio est lu par la fin** : les événements plus anciens ne se voient pas, les totaux valent pour la partie lue et le verdict est jaune.
- **Les couleurs des catégories peuvent se répéter** (il y en a 6 pour un nombre quelconque de codes).
- **La comparaison avec Lens vaut pour les tools que l'audit nomme.** Un guard qui n'a encore écrit aucune ligne n'a rien à comparer (« Non vérifiable »), et le nom dans `tool` doit être celui sous lequel Lens enregistre l'appel.
- La page voit ce que le guard a écrit, pas ce qu'il aurait dû écrire : si une ligne manque, la comparaison avec Lens est le seul indice.
