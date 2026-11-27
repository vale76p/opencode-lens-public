# Changelog

Toutes les modifications importantes d'opencode-lens. Format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions [SemVer](https://semver.org/lang/fr/) : *major* pour les changements incompatibles (API locale, schéma de la base, installation), *minor* pour les nouvelles fonctions, *patch* pour les corrections.

Depuis la 0.3.0, les entrées sont écrites par [release-please](https://github.com/googleapis/release-please) à partir des commits conventionnels (`feat:` → Ajouté, `fix:` → Corrigé, …) dans la PR de release, où on peut les affiner avant le merge. Chaque version a un tag git `opencode-lens-vX.Y.Z` et une [release GitHub](https://github.com/vale76p/opencode-lens-public/releases) avec le zip. Le dashboard affiche le même changelog dans la page **Nouveautés**. Comment publier : [README](README.fr.md#versions-et-releases). Ceci est la traduction française de [CHANGELOG.md](CHANGELOG.md), la source italienne : les versions pas encore traduites s'affichent en italien.

## [0.51.1](https://github.com/vale76p/opencode-lens-public/compare/opencode-lens-v0.51.0...opencode-lens-v0.51.1) (2026-11-27)


### Documentation

* **opencode-lens:** liens vers OpenCode Lens Monitor, désormais public (it/en/fr) ([8be0509](https://github.com/vale76p/opencode-lens-public/commit/8be05097cadd0496b70f0cf93fed93ff47961bcc))
* **opencode-lens:** README pour le dépôt public : ce qu'elle fait, comment elle fonctionne, utilisation et modules (it/en/fr) ([7de6ff6](https://github.com/vale76p/opencode-lens-public/commit/7de6ff646e1f20c8ad03b5497bcc7f965562e395))

## [0.51.0] (2026-11-21)


### Ajouté

* **opencode-lens:** chiffres du détail et de la vue d'ensemble des projets
* **opencode-lens:** coût estimé dans Vibe Coding
* **opencode-lens:** KPI et graphiques des projets dans Vibe Coding
* **opencode-lens:** prévision à la livraison et tendance mensuelle
* **opencode-lens:** projets à échéance dans Vibe Coding
* **opencode-lens:** estimé et dépensé dans le bandeau et sur le tableau
* **opencode-lens:** historique des projets de Vibe Coding
* **opencode-lens:** Vibe Coding avec coût estimé, projets à échéance et KPI par projet


### Corrigé

* **opencode-lens:** dates et type des projets à échéance validés, budget remis à zéro au repli
* **opencode-lens:** notes courtes dans le bandeau, travail après la livraison et estimation incomplète sur tous les chiffres de Vibe Coding
* **opencode-lens:** estimation par modèle regroupée par clé de modèle
* **opencode-lens:** historique des projets relu quand les jours clos changent
* **opencode-lens:** historique de Vibe Coding à jour pour aujourd'hui et après un changement de liste de prix, documentation alignée
* **opencode-lens:** tendance sur les mois civils, et début après la livraison
* **opencode-lens:** totaux de la vue d'ensemble sur tous les projets, estimation incomplète sur le même horizon que l'état
* **opencode-lens:** Vibe Coding s'affiche sans attendre l'historique, moins de lectures répétées


### Modifié

* **opencode-lens:** le budget des projets se compare désormais au coût estimé à partir de la liste de prix ; avec une liste vide il reste sur le coût d'OpenCode


### Documentation

* **opencode-lens:** Vibe Coding avec projets à échéance et coût estimé

## [0.50.0] (2026-11-18)


### Ajouté

* **opencode-lens:** carte « Liste de prix » dans les Réglages
* **opencode-lens:** ctx.prices pour les modules
* **opencode-lens:** LENS_MODEL_PRICES dans la configuration
* **opencode-lens:** liste de prix par million de tokens (src/prices.js)
* **opencode-lens:** liste de prix par modèle dans les Réglages et ctx.prices pour les modules
* **opencode-lens:** liste de prix écrite depuis les Réglages


### Corrigé

* **opencode-lens:** erreurs de la liste de prix reconnues dans toutes les langues, et tableau plus étroit
* **opencode-lens:** liste de prix : clés, textes et documentation après la revue
* **opencode-lens:** liste de prix : une seule règle pour les clés et des limites sur les nombres

## [0.49.3] (2026-11-06)


### Corrigé

* **opencode-lens:** le MCP ne répond plus « outil inconnu » à un outil de module appelé avant la lecture des modules
* **opencode-lens:** une étape échouée ou interrompue n'est plus une dérive de message:assistant
* **opencode-lens:** une étape échouée ou interrompue n'est plus une dérive de message:assistant

## [0.49.2] (2026-11-03)


### Corrigé

* **opencode-lens:** le redémarrage depuis les Réglages fonctionne aussi avec le job désactivé
* **opencode-lens:** le redémarrage depuis les Réglages fonctionne aussi avec le job désactivé

## [0.49.1] (2026-11-03)


### Corrigé

* **opencode-lens:** /healthz répond 503 si la base ne répond pas et signale degraded ; nouvelle métrique start_time_seconds
* **opencode-lens:** corrections issues de la revue contradictoire (sécurité, données, exploitation)
* **opencode-lens:** error_msg expurgé avant la troncature (clés, Bearer, chaînes longues, home)
* **opencode-lens:** les modules utilisateur s'installent depuis le dashboard seulement avec LENS_TOKEN
* **opencode-lens:** le backfill ne remet plus à zéro le coût et les tokens en direct quand le message ne les a pas
* **opencode-lens:** le contrat d'API couvre aussi les réponses REST des sessions et des messages
* **opencode-lens:** le WAL a une limite de 64 Mio et un checkpoint TRUNCATE toutes les 10 minutes
* **opencode-lens:** l'intégration MCP attend aussi module_guide et module_check
* **opencode-lens:** le dossier de données existant passe en 0700 et la copie de sauvegarde naît en 0600
* **opencode-lens:** la documentation dit exactement ce qui est enregistré (titres, dossier, error_msg expurgé)
* **opencode-lens:** l'analyse signale les synchronisations échouées dans scan.error avec une seule ligne de log
* **opencode-lens:** davantage d'en-têtes de reverse proxy reconnus comme non locaux
* **opencode-lens:** traduction française du message sur le token des modules, forme de politesse
* **opencode-lens:** un champ négatif n'écarte plus l'usage interne positif
* **opencode-lens:** un plantage laisse la pile dans le log avant de quitter


### Documentation

* **opencode-lens:** version d'OpenCode vérifiée v2.0.26 et limites connues mesurées

## [0.49.0] (2026-11-01)


### Ajouté

* **opencode-lens:** Ponytail quitte la distribution ; le module d'exemple et le guide restent
* **opencode-lens:** Ponytail quitte la distribution ; le module d'exemple et le guide restent

## [0.48.1] (2026-11-01)


### Corrigé

* **opencode-lens:** deux exports OTLP simultanés n'envoient plus deux fois la même hausse
* **opencode-lens:** exports OTLP qui se chevauchent, limit de /api/sessions, la vraie erreur de Store.tx
* **opencode-lens:** limit de /api/sessions est un entier de 1 à 500, comme pour /api/runs
* **opencode-lens:** une transaction déjà annulée par SQLite ne cache plus la vraie erreur

## [0.48.0] (2026-11-01)


### Ajouté

* **opencode-lens:** mettre à jour les modules de l'utilisateur depuis un zip dans Paramètres › Mise à jour
* **opencode-lens:** les modules d'un zip ne sont vérifiés qu'à « Installer », après l'avertissement
* **opencode-lens:** redémarrer la lens depuis le dashboard (POST /api/restart, encadré Service)
* **opencode-lens:** redémarrage depuis le dashboard, modules de l'utilisateur depuis un zip et Paramètres plus pratiques
* **opencode-lens:** fiches des modules avec un séparateur et un bouton Activer/Désactiver de largeur fixe


### Corrigé

* **opencode-lens:** « Redémarrer la lens » ne recharge pas un plist modifié à la main et non appliqué
* **opencode-lens:** après un enregistrement, Paramètres reste dans la section où vous étiez
* **opencode-lens:** le redémarrage depuis le dashboard ne part pas avec un plist illisible
* **opencode-lens:** installation des modules tout ou rien, 409 pendant une vérification, nettoyage des .staging-*


### Documentation

* **opencode-lens:** les modules d'un zip se vérifient à « Installer », après l'avertissement (it/en/fr)
* **opencode-lens:** installation des modules tout ou rien, redémarrage refusé avec un plist non appliqué (it/en/fr)
* **opencode-lens:** modules de l'utilisateur depuis un zip dans Paramètres › Mise à jour (it/en/fr)
* **opencode-lens:** redémarrage depuis le dashboard dans configuration, métriques et architecture (it/en/fr)

## [0.47.0] (2026-11-01)


### Ajouté

* **opencode-lens:** dossier extras/modules pour les modules supplémentaires, et leur zip dans la release
* **opencode-lens:** modules supplémentaires dans extras/modules et leur zip dans la release


### Documentation

* **opencode-lens:** les modules supplémentaires, leur zip dans la release et comment les installer

## [0.46.1] (2026-11-01)


### Corrigé

* **opencode-lens:** le zip de la release contient le kit de test des modules : la 0.46.0 est sortie sans zip, c'est cette version qu'il faut installer

## [0.46.0] (2026-11-01)


### Ajouté

* **opencode-lens:** vos propres modules : un dossier à côté de la base de données (sur macOS `~/Library/Application Support/opencode-lens/modules/`) que les mises à jour ne touchent pas, lu par la lens et par le MCP avec les mêmes règles que les modules de la lens ; dans Paramètres › Modules ils ont le badge « personnel » et leur dossier
* **opencode-lens:** widgets des modules dans la grille : un module déclare ses widgets dans son manifeste, « + Ajouter un widget » les propose avec le nom du module, et un module éteint ou en erreur laisse à leur place un cadre qui le dit
* **opencode-lens:** outils MCP `lens_module_guide` et `lens_module_check` pour écrire un module : le guide avec les valeurs de cette installation, et la vérification d'un module sans l'activer (`POST /api/modules/check`, `GET /api/modules/authoring`) ; OpenCode les montre après un redémarrage
* **opencode-lens:** un module d'exemple à copier (`extras/module-template/`) et le kit de test des modules installé avec l'app


### Documentation

* **opencode-lens:** guide pour écrire un module, pensé aussi pour un LLM : `docs/fr/moduli-custom.md`

## [0.45.0] (2026-10-29)


### Ajouté

* **opencode-lens:** Paramètres montre une section à la fois, avec l'icône d'engrenage
* **opencode-lens:** Paramètres montre une section à la fois, avec l'icône d'engrenage

## [0.44.1] (2026-10-29)


### Corrigé

* **opencode-lens:** finitions de sécurité et de comportement après la refonte en modules


### Modifié

* **opencode-lens:** retouches après les revues des modules

## [0.44.0] (2026-10-29)

**À lire avant la mise à jour.** Skill devient lui aussi un module, comme Vibe Coding, Security et IBM Bob dans la 0.43.0 : après la mise à jour il est désactivé. Qui a une bibliothèque trouve un avertissement qui mène à Paramètres › Modules, d'où on le réactive ; bibliothèque et presets restent intacts. Skill désactivé, l'outil MCP `preset` et les commandes `/lens:<id>` ne sont pas là ; le comptage des skills qu'OpenCode charge (`skill_uses` et les métriques des skills) continue même Skill désactivé. Après l'avoir activé ou désactivé, redémarrez OpenCode.

### Ajouté

* **opencode-lens:** les modules déclarent des POST bruts et à préfixe et des dossiers de données, et ne peuvent pas prendre les fichiers et chemins du core
* **opencode-lens:** les modules enregistrent les livraisons des skills, lisent les zips et connaissent le dossier des données
* **opencode-lens:** le côté serveur de Skill comme module, vérifié contre le core
* **opencode-lens:** le serveur MCP propose les prompts et les instructions des modules actifs
* **opencode-lens:** l'outil preset et les prompts des skills comme outils du module


### Corrigé

* **opencode-lens:** le hasData de Skill ignore les dossiers d'une suppression interrompue et le MCP signale les champs mcp mal formés
* **opencode-lens:** le MCP vérifie les prompts après avoir relu les modules, dans le même tour


### Modifié

* **opencode-lens:** le tiroir de Skill reçoit de la page ce qu'il utilise, sans cycle d'import
* **opencode-lens:** le côté serveur de Skill sort du core
* **opencode-lens:** l'outil preset et les prompts des skills sortent du core
* **opencode-lens:** Skill devient un module


### Documentation

* **opencode-lens:** finitions des docs, des traductions et du message des champs MCP après la revue de E
* **opencode-lens:** Skill comme module, POST bruts, prompts des modules et livraisons des skills

## [0.43.0] (2026-10-26)

**À lire avant la mise à jour.** Vibe Coding, Security et IBM Bob deviennent des modules, comme Système dans la 0.42.0 : après la mise à jour ils sont désactivés, IBM Bob compris, même avec `LENS_BOB=1`. Qui les utilisait trouve un avertissement qui mène à Paramètres › Modules, d'où on les réactive ; les données restent. `LENS_BOB` n'est plus nécessaire : elle est ignorée et on peut la retirer depuis Paramètres. Le sélecteur « OpenCode / + Bob / Bob seul » du dashboard repart de « OpenCode ». Skill reste dans le core pour l'instant.


### Ajouté

* **opencode-lens:** les modules déclarent aussi les chemins qu'ils lisent seulement
* **opencode-lens:** les modules déclarent leurs paramètres, modifiables depuis l'onglet Modules
* **opencode-lens:** les modules déclarent des routes POST et à préfixe, protégées par le core
* **opencode-lens:** les modules écrivent dans leurs tables, lisent des sources incrémentales et avertissent le dashboard
* **opencode-lens:** le core crée les tables déclarées par les modules
* **opencode-lens:** le ctx des modules lit la base en lecture seule et déclare fichiers et données
* **opencode-lens:** le côté serveur d'IBM Bob en module, vérifié contre le core
* **opencode-lens:** le côté serveur de Security en module, vérifié contre le core
* **opencode-lens:** le côté serveur de Vibe Coding en module, vérifié contre le core
* **opencode-lens:** le sélecteur du dashboard pour les sources des modules
* **opencode-lens:** le serveur MCP propose les outils des modules activés et avertit OpenCode quand ils changent
* **opencode-lens:** l'outil MCP security en outil du module
* **opencode-lens:** modules à configurer, start avec un temps maximal, limites des champs, avertissement et panneau des modules
* **opencode-lens:** sources alternatives et état des modules dans /api/status et /healthz


### Corrigé

* **opencode-lens:** ctx.reader lit avec query_only et les fichiers des modules restent dans le dossier des données
* **opencode-lens:** parmi les fichiers écrits et à la désinstallation, seulement les fichiers des modules de type write
* **opencode-lens:** GET /api/modules ne lit le plist que pour les clients locaux et seulement quand il change
* **opencode-lens:** garde query_only plus sûre, et les modules ne peuvent pas prendre les chemins du core
* **opencode-lens:** les panneaux des modules suivent chaque état et restent montés entre les rendus
* **opencode-lens:** la note de la carte dit de redémarrer OpenCode pour les outils et les instructions
* **opencode-lens:** la première lecture d'IBM Bob ne retient plus le démarrage du serveur
* **opencode-lens:** les tables d'un module ne peuvent pas être des tables du core
* **opencode-lens:** méta des modules sous module:&lt;id&gt;:data:, reply avec corps obligatoire et garde query_only réentrante
* **opencode-lens:** dans la section Modules, l'astuce du shell seulement pour qui peut l'utiliser, et l'avertissement mène à la section
* **opencode-lens:** dernières retouches du module IBM Bob après la revue


### Modifié

* **opencode-lens:** les graphiques que Skill et Vibe Coding partagent passent dans le core
* **opencode-lens:** IBM Bob devient un module
* **opencode-lens:** le CSS qui ne sert qu'à Vibe Coding passe dans le module
* **opencode-lens:** le côté serveur d'IBM Bob sort du core
* **opencode-lens:** Security devient un module
* **opencode-lens:** Vibe Coding devient un module


### Documentation

* **opencode-lens:** qui touche la base inclut le lecteur des modules, le nom de jsonStore et la règle de db-owner
* **opencode-lens:** légende des sondes de Bob, tableau des variables, références au lecteur du module et espaces françaises
* **opencode-lens:** IBM Bob en module, tables, écritures et sources des modules
* **opencode-lens:** OTLP avec les séries de Security, outil security du module, textes des manifestes traduits ou non
* **opencode-lens:** Security en module, paramètres et outils MCP des modules
* **opencode-lens:** Vibe Coding en module et contrat des modules étendu

## [0.42.0] (2026-10-25)


### Ajouté

* **opencode-lens:** le serveur sert les routes, fichiers, métriques et menu des modules actifs
* **opencode-lens:** le dashboard charge les pages et traductions des modules actifs
* **opencode-lens:** modules activables depuis Paramètres, Système est le premier
* **opencode-lens:** registre des modules avec états et démarrage isolé
* **opencode-lens:** section Modules dans Paramètres et avertissement pour les modules désactivés qui ont des données
* **opencode-lens:** variable LENS_MODULES pour les modules actifs


### Corrigé

* **opencode-lens:** l'export OTLP ne renvoie plus en entier les séries qui réapparaissent et inclut Security et IBM Bob comme /metrics
* **opencode-lens:** finitions des modules issues de la revue finale
* **opencode-lens:** un start asynchrone qui échoue met le module en erreur sans arrêter la lens


### Modifié

* **opencode-lens:** Système devient le premier module


### Documentation

* **opencode-lens:** modules, LENS_MODULES et Système en module
* **opencode-lens:** lignes vides dans moduli.md

## [0.41.2] (2026-10-24)


### Corrigé

* **opencode-lens:** dans la page Skill, les noms et descriptions longs ne débordent plus des colonnes
* **opencode-lens:** dans la page Skill, les noms et descriptions longs ne débordent plus des colonnes

## [0.41.1] (2026-10-24)


### Corrigé

* **opencode-lens:** l'app macOS se ferme comme avec ⌘Q avant d'être réinstallée et se rouvre avec open -a
* **opencode-lens:** l'app macOS se ferme comme avec ⌘Q avant d'être réinstallée et se rouvre avec open -a

## [0.41.0] (2026-10-24)


### Ajouté

* **opencode-lens:** Système avec CPU et mémoire en direct toutes les 2 secondes et les widgets de la Galerie
* **opencode-lens:** Système avec CPU et mémoire en direct toutes les 2 secondes et les widgets de la Galerie

## [0.40.0] (2026-10-24)


### Ajouté

* **opencode-lens:** « Vue » réunit le regroupement et la métrique d'Analyse, avec la période en forme courte
* **opencode-lens:** contrôles neutres dans la barre, période courte partout, Personnaliser et Plein écran en icône seule
* **opencode-lens:** l'heure de la dernière mise à jour dans la barre de Maintenant et Analyse
* **opencode-lens:** la barre façon outil, avec cadre et feuille, les mêmes places dans chaque barre et des contrôles neutres
* **opencode-lens:** le dashboard sur une feuille dans un cadre gris, le menu sans couleur d'accent
* **opencode-lens:** chaque barre du haut a les mêmes places, chaque contrôle toujours au même endroit


### Corrigé

* **opencode-lens:** barre au-dessus de la barre de modification, désormais rouge quand OpenCode est déconnecté, action seule à droite, stamp lisible par les lecteurs d'écran
* **opencode-lens:** compteurs du menu et secondes de l'horloge au-dessus de 4.5:1
* **opencode-lens:** le badge « beta » de la barre latérale ne descend pas sous 11px
* **opencode-lens:** les étiquettes de groupe du menu « Vue » au-dessus de 4.5:1 en clair

## [0.39.0] (2026-10-24)


### Ajouté

* **opencode-lens:** API pour l'état et l'installation de l'app macOS
* **opencode-lens:** app macOS installable depuis le dashboard et toujours à la version de la lens
* **opencode-lens:** app.sh check et update, avec la signature de l'app conservée
* **opencode-lens:** bloc App macOS dans Paramètres › Mise à jour
* **opencode-lens:** install.sh recompile l'app macOS quand elle est installée
* **opencode-lens:** état et installation de l'app macOS dans la lens


### Corrigé

* **opencode-lens:** jamais deux compilations de l'app après le redémarrage, ni compilations interminables


### Documentation

* **opencode-lens:** app macOS installable et alignée depuis le dashboard

## [0.38.3] (2026-10-24)


### Corrigé

* **opencode-lens:** « Ouvrir dans le navigateur » de l'app macOS ouvre le dashboard avec le jeton
* **opencode-lens:** « Ouvrir dans le navigateur » de l'app macOS ouvre le dashboard avec le jeton

## [0.38.2] (2026-10-24)


### Corrigé

* **opencode-lens:** le zip arrive dans la release même sans l'attestation de provenance
* **opencode-lens:** le zip arrive dans la release même sans l'attestation de provenance

## [0.38.1] (2026-10-24)


### Corrigé

* **opencode-lens:** les tests de package.sh tournent sans la clé de signature
* **opencode-lens:** les tests de package.sh tournent sans la clé de signature

## [0.38.0] (2026-10-24)


### ⚠ BREAKING CHANGES

* **opencode-lens:** depuis le tableau de bord, le « Source code (zip) » et les zips non signés ne s'installent plus (depuis le terminal avec install.sh, si). Après service install, le tableau de bord demande le jeton : ouvrez-le avec opencode-lens service open, depuis l'app macOS ou depuis le Monitor.

### Ajouté

* **opencode-lens:** releases signées, jeton par défaut et licence propriétaire

## [0.37.0] (2026-10-24)


### Ajouté

* **opencode-lens:** Phases 2 à 4 du refactor sur main : lecteur unique, compteurs, page-kit, MCP dans src/mcp/, app macOS

## [0.36.1] (2026-10-24)


### Modifié

* **opencode-lens:** comptages, infos de la base et lectures OTLP derrière le Store
* **opencode-lens:** Phase 1, un seul propriétaire du schéma
* **opencode-lens:** periodBounds dans src/period.js, MCP et Paramètres sans le côté lecture
* **opencode-lens:** schéma et expressions clés dans src/schema.js
* **opencode-lens:** écritures et lectures de Bob sur la lens derrière le Store
* **opencode-lens:** VERSION et redactUrl dans des modules feuilles, le cycle about↔otlp↔queries fermé


### Documentation

* **opencode-lens:** architecture, qui possède le schéma

## [0.36.0] (2026-10-23)


### Ajouté

* **opencode-lens:** agrégats et métriques de l'utilisation des skills
* **opencode-lens:** tableau des presets avec glisser-déposer, menu au clavier et Annuler
* **opencode-lens:** depuis quand la version actuelle d'une skill est utilisée
* **opencode-lens:** détail de la skill dans un panneau latéral avec son utilisation
* **opencode-lens:** les chiffres de la page Skills dans un module pur
* **opencode-lens:** le collecteur compte les chargements des skills et des presets de la lens
* **opencode-lens:** le MCP signale à la lens les livraisons des presets de skills
* **opencode-lens:** page Skills comme tableau des presets, avec hero et utilisation des skills
* **opencode-lens:** page Skills avec hero, période et import depuis la barre du haut
* **opencode-lens:** POST /api/skill-loads et protection des presets contre les enregistrements concurrents
* **opencode-lens:** déplacements des skills entre presets dans un module pur
* **opencode-lens:** table skill_uses et schéma v5 pour l'utilisation des skills


### Corrigé

* **opencode-lens:** barres par jour complètes, le dialogue des presets enregistre avec le rev et mini-cartes plus nettes
* **opencode-lens:** compteurs et last de l'utilisation des skills seulement sur les terminées
* **opencode-lens:** currentSince suit la version actuelle aussi dans reconcile et ne change pas avec un rollback sur l'actuelle
* **opencode-lens:** le panneau de la skill ignore les réponses tardives, relit les cases et montre l'utilisation par jour
* **opencode-lens:** en lecture seule ni import ni nouveau preset, et une erreur de lecture ne laisse ni hero ni chargement
* **opencode-lens:** l'utilisation des skills ne bloque plus la lecture d'une session et compte les activations
* **opencode-lens:** le tableau refait le déplacement sur le document actuel, Annuler seulement si sûr et plus de « null » dans les cartes
* **opencode-lens:** la bibliothèque est null dans les déplacements du tableau et le plafond réutilise le texte existant
* **opencode-lens:** origine lens pour les presets, dérive des skills comptée une fois par côté
* **opencode-lens:** utilisation normalisée, « Tout » commence depuis le début et un seul prédicat pour « jamais utilisées »
* **opencode-lens:** validation plus stricte des chargements de skills et écriture en transaction


### Documentation

* **opencode-lens:** limite du corps de skill-loads, dernier chargement terminé et lecture seule vers OpenCode
* **opencode-lens:** maquette de la page Skills avec hero, tableau des presets et utilisation
* **opencode-lens:** page Skills, utilisation des skills et nouvelles métriques
* **opencode-lens:** utilisation des skills telle que le code la fait

## [0.35.0] (2026-10-23)


### Ajouté

* **opencode-lens:** sondes d'IBM Bob depuis les paramètres et estimation de la conversion Bobcoin ↔ token
* **opencode-lens:** sondes d'IBM Bob depuis les paramètres et estimation de la conversion Bobcoin ↔ token

## [0.34.1] (2026-10-23)


### Corrigé

* **opencode-lens:** avec IBM Bob, le changement de source et le rafraîchissement des widgets ne ralentissent plus
* **opencode-lens:** avec IBM Bob, le changement de source et le rafraîchissement des widgets ne ralentissent plus

## [0.34.0] (2026-10-23)


### Ajouté

* **opencode-lens:** budgets, prompts en cours, interaction et activité en direct aussi pour IBM Bob
* **opencode-lens:** budgets, prompts en cours, interaction et activité en direct aussi pour IBM Bob

## [0.33.0] (2026-10-23)


### Ajouté

* **opencode-lens:** la sonde cherche où Bob garde la consommation du compte
* **opencode-lens:** la sonde cherche où Bob garde la consommation du compte

## [0.32.2] (2026-10-23)


### Corrigé

* **opencode-lens:** le widget Tool ne casse plus sur une erreur sans message
* **opencode-lens:** le widget Tool ne casse plus sur une erreur sans message

## [0.32.1] (2026-10-23)


### Corrigé

* **opencode-lens:** IBM Bob lu avec le vrai schéma de bob.db, et la sonde installée avec l'app
* **opencode-lens:** IBM Bob lu avec le vrai schéma de bob.db, et la sonde installée avec l'app

## [0.32.0] (2026-10-23)


### Ajouté

* **opencode-lens:** « Bob seul » et « + Bob » sur toutes les vues d'analyse, avec les requêtes d'OpenCode
* **opencode-lens:** IBM Bob comme seconde source, facultative (LENS_BOB)
* **opencode-lens:** IBM Bob comme seconde source, page et « Inclure Bob »
* **opencode-lens:** page IBM Bob et interrupteur « Inclure Bob » dans le dashboard
* **opencode-lens:** sélecteur OpenCode · + Bob · Bob seul à la place de « Inclure Bob »

## [0.31.1] (2026-10-23)


### Documentation

* **opencode-lens:** changelog 0.31.0 et 0.30.1 traduit en anglais et en français
* **opencode-lens:** changelog 0.31.0 et 0.30.1 traduit en anglais et en français

## [0.31.0] (2026-10-23)


### Ajouté

* **opencode-lens:** board des projets de Vibe Coding avec glisser-déposer des dossiers
* **opencode-lens:** détail du projet avec temps de travail et projection
* **opencode-lens:** document des projets de Vibe Coding
* **opencode-lens:** page Security en dashboard : hero avec graphiques, santé et politique en avant, événements dans le temps
* **opencode-lens:** page Security en dashboard : hero avec graphiques, santé et politique en avant, événements dans le temps
* **opencode-lens:** projets de Vibe Coding enregistrés dans vibe-projects.json
* **opencode-lens:** projection en fin de mois du coût, des tokens et du temps
* **opencode-lens:** bande de synthèse graphique de Vibe Coding
* **opencode-lens:** Vibe Coding avec la période « Mois » et des tableaux compacts
* **opencode-lens:** Vibe Coding avec projets, KPI graphiques et projection en fin de mois
* **opencode-lens:** Vibe Coding répartit tokens, coût et temps par dossier et par jour
* **opencode-lens:** Vibe Coding apporte la période précédente et les jours du mois en cours


### Corrigé

* **opencode-lens:** la « Fin du mois » de la bande correspond à l'anneau des projets, étiquettes des graphiques sans chevauchement
* **opencode-lens:** budget avec virgule décimale sans effacements accidentels, focus clavier dans le board, retour au dernier enregistré, + Nouveau projet toujours présent
* **opencode-lens:** projection et fin du budget comptent aujourd'hui de la même façon
* **opencode-lens:** état du budget cohérent entre carte, détail et anneau ; note de Fin du mois depuis l'anneau ; code mort de from=0 supprimé
* **opencode-lens:** bande Vibe Coding sans styles inline, étiquettes et totaux des graphiques corrigés
* **opencode-lens:** tableaux de Vibe Coding à 3 colonnes sans défilement, texte des graphiques lisible sur écrans étroits
* **opencode-lens:** Vibe Coding n'applique pas d'anciens projets après un enregistrement
* **opencode-lens:** vibe-projects.json parmi les fichiers écrits de /api/about


### Documentation

* **opencode-lens:** champs de /api/vibe-coding et /api/vibe-projects, rythme sur 7 jours, variation seulement sur coût, tokens et temps, devise des coûts
* **opencode-lens:** maquette de la page Security avec hero, santé, politique et graphiques
* **opencode-lens:** maquette de la page Vibe Coding avec projets et projection
* **opencode-lens:** Vibe Coding avec projets et projection

## [0.30.1] (2026-10-22)


### Documentation

* **opencode-lens:** changelog 0.30.0 traduit en anglais et en français
* **opencode-lens:** changelog 0.30.0 traduit en anglais et en français

## [0.30.0] (2026-10-22)


### Ajouté

* **opencode-lens:** dashboard sans « pulsation », tick sélectif et pause des mises à jour
* **opencode-lens:** dashboard sans « pulsation », tick sélectif et pause des mises à jour en direct
* **opencode-lens:** pause des mises à jour en direct, « Actualiser » et aucune lecture dans un onglet en arrière-plan
* **opencode-lens:** un tick en direct ne relit que les données que ses modifications ont pu changer


### Corrigé

* **opencode-lens:** /metrics et OTLP réutilisent les agrégats sur toute la durée tant que rien ne change, et au plus 10 s pendant que le collector écrit (F-13)
* **opencode-lens:** backpressure sur les clients SSE lents et nettoyage des timers (PER-01, ARC-06)
* **opencode-lens:** couleurs du dashboard et runs d'une période réutilisés quelques secondes pendant que le collector écrit (F-14)
* **opencode-lens:** le sync écrit les messages par blocs de 500 au lieu d'une transaction par session (F-15)
* **opencode-lens:** le dashboard ne s'atténue plus à chaque mise à jour et le bandeau n'interrompt que lorsqu'il est critique
* **opencode-lens:** les expressions de temps et de modèle sur lesquelles reposent les index ont un seul propriétaire, store.js (F-25)
* **opencode-lens:** dans les compteurs de /metrics, un step sans provider ni modèle attend le backfill au lieu de compter sous « ? » (F-18)
* **opencode-lens:** remédiation de la revue de sécurité du 22/10/2026
* **opencode-lens:** refuse une base au schéma plus récent au lieu de redémarrer en boucle (DAT-01)
* **opencode-lens:** si la base ne s'ouvre pas, la lens reste active avec une page qui dit pourquoi, au lieu de redémarrer toutes les 10 secondes (F-16)
* **opencode-lens:** service install raccourcit au dernier Mo un log de launchd de plus de 10 Mo (F-29)
* **opencode-lens:** tâches internes de la période et prompts sans sous-agents (COR-02, COR-03)
* **opencode-lens:** timeout sur les fetch du rafraîchissement et en-tête de langue sur chaque POST (CLI-01, CLI-02)
* **opencode-lens:** tokens sans régression, commit flag sur les chaînes entre guillemets, aucune fuite de listener (COR-01, DAT-03, COR-06, PER-06)


### Documentation

* **opencode-lens:** mises à jour en direct, pause et tick avec les kinds, en italien, anglais et français
* **opencode-lens:** les compteurs de /metrics peuvent baisser après une migration ou une correction du backfill, c'est maintenant écrit (F-17, atténuation)

## [0.29.1] (2026-10-22)


### Documentation

* **opencode-lens:** changelog 0.29.0 traduit en anglais et en français
* **opencode-lens:** changelog 0.29.0 traduit en anglais et en français

## [0.29.0] (2026-10-22)


### Ajouté

* **opencode-lens:** agrégats des guards DLP, contrôle croisé avec les appels vus par Lens et séries sur /metrics
* **opencode-lens:** avertissement dans Paramètres › Serveur MCP quand le MCP d'OpenCode est plus ancien que la lens
* **opencode-lens:** avertissement dans Paramètres › Serveur MCP quand le MCP d'OpenCode est plus ancien que la lens
* **opencode-lens:** découverte des guards DLP par convention de nom, santé et variables LENS_SECURITY_*
* **opencode-lens:** endpoint /api/security avec une vue réduite depuis le réseau et des gauges sur /metrics
* **opencode-lens:** page Security avec KPI, événements, santé et policy des guards DLP
* **opencode-lens:** page Security et outil MCP security
* **opencode-lens:** parsing et assainissement des audits des guards DLP
* **opencode-lens:** presets de skills avec un ordre choisi et un poids face au plafond, import de plusieurs fichiers et dossiers depuis le navigateur avec la liste des résultats, « déjà à jour » pour un contenu identique et lignes d'état toujours présentes
* **opencode-lens:** presets de skills : copie de /lens:id, Modifier direct, skills absentes écrites en toutes lettres avec « Retirer du preset », erreurs sous le champ et avertissement pour un preset sans skill
* **opencode-lens:** écriture de zip pure et regroupement des fichiers en skills, pour importer plusieurs fichiers et dossiers depuis le navigateur
* **opencode-lens:** outil MCP security pour l'audit des guards DLP
* **opencode-lens:** un import identique à la version courante ne crée pas de version ; hash et mdChars par version


### Corrigé

* **opencode-lens:** docs du MCP : trois plafonds sur le texte des presets, chemins, skills absentes, nom d'affichage et ligne de base du watcher (it, en, fr)
* **opencode-lens:** liste des presets dans les instructions avec le plafond, skills absentes signalées, name accepte le nom d'affichage, une ligne sur quand demander un preset
* **opencode-lens:** les dix fichiers listés par detail() choisis selon leur rôle
* **opencode-lens:** les numéros de l'ordre des presets sont visibles : un compteur CSS sur les lignes à la place du marqueur de liste, qu'une ligne flex n'affiche pas
* **opencode-lens:** les chemins de la policy ne sont pas masqués
* **opencode-lens:** le contrôle croisé cherche les outils de tout l'audit, pas seulement de la période
* **opencode-lens:** le poids d'un preset suit le MCP : corps plus description, dossier, chemins et cadre, skills parcourues dans l'ordre avec la forme sans texte et les plus petites qui tiennent encore, « probablement » sans texte
* **opencode-lens:** le texte de preset ne dépasse jamais les budgets, le watcher réannonce après une deuxième panne du client, note de coupure correcte et comparaisons des noms sur le même texte que voit le modèle
* **opencode-lens:** le texte de preset respecte aussi 48 KiB et 1900 lignes ; avec skill= le corps au-delà du budget est coupé en fin de ligne
* **opencode-lens:** instructions MCP : security avant preset, la phrase sur les presets reste à côté de sa ligne
* **opencode-lens:** l'adoption des dossiers ne suit pas les liens ; hash avec les longueurs ; un index illisible n'est jamais réécrit ; suppressions à l'épreuve des interruptions
* **opencode-lens:** le MCP donne des descriptions jusqu'à 1024 caractères et des chemins identiques à ceux sur disque, et retire les sélecteurs de variante et les caractères de remplissage Hangul
* **opencode-lens:** MCP : les formes d'une skill dans le preset sont construites une à la fois, seulement si la précédente ne tient pas
* **opencode-lens:** magasin des skills robuste : erreurs d'écriture, un reconcile qui n'arrête pas le démarrage et adopte les dossiers, import de SKILL.md sur la bonne skill
* **opencode-lens:** noms dans le zip bien décodés, zips de PowerShell acceptés, messages clairs pour les zips imbriqués
* **opencode-lens:** page Security : comparaison avec Lens, clés de la policy, note sur la policy et lignes refusées
* **opencode-lens:** page Security : plus de « null » dans le détail des événements sans détection
* **opencode-lens:** page Security : verdict dans le sous-titre, Copier pour SHA-256 et call ID, détail stable au rafraîchissement
* **opencode-lens:** page Skill : pas de défilement latéral sur téléphone, cartes sous 900 px, retours avec erreurs distinctes, détail sous la ligne, recherche, tri, compteur et colonne « Dans les presets »
* **opencode-lens:** la policy et les plugins des guards n'acceptent que des noms de guard valides
* **opencode-lens:** révision de la bibliothèque de skills : import robuste, MCP dans les budgets d'OpenCode, page Skill refaite
* **opencode-lens:** Security : comparaison depuis le premier événement de l'audit, masquage par token, limites sur les catégories, résultats et listes
* **opencode-lens:** outil MCP security : totaux sans portée, raisons du verdict, catégories et listes avec le total
* **opencode-lens:** un index des skills illisible ne ressemble pas à une bibliothèque vide : la page affiche la raison, canSave est faux et l'import et les actions répondent 409 tant qu'il n'est pas réparé
* **opencode-lens:** une skill avec les mêmes chemins et octets mais d'autres bits d'exécution est « déjà à jour » et garde ses modes ; « SKILL copia 2.md » et « SKILL copy 2.md » ne nomment pas une skill
* **opencode-lens:** une skill illisible n'arrête pas le preset, prompts/list dit pourquoi il est vide, le watcher part de ce que le client a reçu, skills lues en parallèle


### Documentation

* **opencode-lens:** « Skill » dans le dashboard : modes d'import avec explication, recherche, tri, « Dans les presets », panneau de détail, cartes sur téléphone, copie de /lens:id et avertissements des presets (it, en, fr)
* **opencode-lens:** « Skill » : import de dossiers et de plusieurs fichiers, ordre et poids des presets, « déjà à jour », hash et adoption au démarrage, zip-writer et nom ou id du preset (it, en, fr)
* **opencode-lens:** page Security, contrat des guards DLP et outil MCP security (it, en, fr)
* **opencode-lens:** Security : règles de masquage, comparaison avec Lens, résultats sur /metrics et ce qu'on voit depuis le réseau (it, en, fr)

## [0.28.1] (2026-10-22)


### Corrigé

* **opencode-lens:** une skill avec un nom d'affichage est importée avec l'id de son dossier ou du slug
* **opencode-lens:** une skill avec un nom d'affichage prend son id du dossier ou du slug, comme OpenCode

## [0.28.0] (2026-10-22)


### Ajouté

* **opencode-lens:** frontmatter, id et plan du zip d'une skill
* **opencode-lens:** bibliothèque de skills et presets via le MCP
* **opencode-lens:** bibliothèque de skills sur disque à côté de la base de données, avec versions
* **opencode-lens:** page Skill avec bibliothèque, versions et presets
* **opencode-lens:** presets de skills avec un validateur partagé
* **opencode-lens:** routes /api/skills et /api/skill-presets, Informations et désinstallation
* **opencode-lens:** tool preset, prompts MCP et instructions dynamiques avec les skills des presets


### Corrigé

* **opencode-lens:** dialogue des presets sans ligne « null », focus après le redessin, erreurs en italien et en-tête Actions
* **opencode-lens:** pattern de l'id du preset valide pour le flag v des navigateurs
* **opencode-lens:** prompts/get distingue le preset inconnu des pannes, plafond de texte strict, briefs entiers et échappements \u dans le source
* **opencode-lens:** revue finale des skills et presets : caractères invisibles, id, .git, langue des refus
* **opencode-lens:** rollback et removeVersion de la bibliothèque de skills exigent une version
* **opencode-lens:** un import n'écrase jamais de dossiers sur disque ; version et démarrage plus stricts


### Modifié

* **opencode-lens:** planEntries et JsonStore réutilisables pour la bibliothèque de skills


### Documentation

* **opencode-lens:** bibliothèque de skills, presets et tool preset du MCP

## [0.27.1] (2026-10-20)


### Documentation

* **opencode-lens:** changelog 0.27.0 traduit en anglais et en français

## [0.27.0] (2026-10-20)


### Ajouté

* **opencode-lens:** page Vibe Coding avec temps de travail, tokens et répartitions de la période
* **opencode-lens:** page Vibe Coding avec temps de travail, tokens et répartitions de la période

## [0.26.0] (2026-10-20)


### Ajouté

* **opencode-lens:** /api/system avec cœurs, répartition de la mémoire, réseau, santé de la lens et tendance récente
* **opencode-lens:** le badge de connexion à OpenCode passe en bas du menu, au-dessus du thème ; avec les icônes il ne reste que le point
* **opencode-lens:** le thème « système » a l'icône d'un portable au lieu du demi-disque
* **opencode-lens:** l'icône du bouton du thème suit le mode : demi-disque, soleil, lune
* **opencode-lens:** la page Système cherche les processus par PID, port TCP ou UDP et nom ; les sockets UDP sont aussi parmi les ports à l'écoute
* **opencode-lens:** menu latéral, icônes du thème et page Système plus complète avec recherche
* **opencode-lens:** page Système réorganisée : santé, performances avec les modèles de la Galerie, tendance, cœurs, réseau et services


### Documentation

* **opencode-lens:** page Système, badge de connexion et icônes du thème (it, en, fr), avec le design

## [0.25.0] (2026-10-20)


### Ajouté

* **opencode-lens:** ajouter un widget à la vue depuis la Galerie, dans la session de modification
* **opencode-lens:** comparer de deux à quatre styles du même type dans la Galerie
* **opencode-lens:** fonctions pures pour ajouter et comparer depuis la Galerie
* **opencode-lens:** Galerie à onglets, avec Comparer et Ajouter à la vue
* **opencode-lens:** la Galerie a un onglet par vue, avec recherche, filtre et index des types


### Corrigé

* **opencode-lens:** l'histogramme de Prompt : distribution ne se dessinait pas, une variable locale masquait la traduction


### Modifié

* **opencode-lens:** retirés le Récapitulatif classique, la Jauge en anneau plein et l'horloge des heures du Hero, migrés vers C22, B2 et G1
* **opencode-lens:** retirée la Jauge en anneau plein ; qui l'avait enregistrée la retrouve comme B2
* **opencode-lens:** retiré le Récapitulatif classique ; qui l'avait enregistré le retrouve comme C22
* **opencode-lens:** retirée l'horloge des heures du Hero ; qui l'avait enregistrée la retrouve comme G1


### Documentation

* **opencode-lens:** Ajouter et Comparer dans la Galerie
* **opencode-lens:** design de Comparer et Ajouter depuis la Galerie
* **opencode-lens:** plan de Comparer et Ajouter depuis la Galerie

## [0.24.1] (2026-10-20)


### Corrigé

* **opencode-lens:** 0.24.0 traduite dans les CHANGELOG et un test qui ne bloque plus la release
* **opencode-lens:** 0.24.0 traduite dans les CHANGELOG et un test qui ne bloque plus la release

## [0.24.0] (2026-10-20)


### Ajouté

* **opencode-lens:** dashboard, serveur, Nouveautés et documents en italien, anglais et français
* **opencode-lens:** dashboard, serveur, Nouveautés et documents en italien, anglais et français


### Corrigé

* **opencode-lens:** breakdown trié et MCP plus robuste
* **opencode-lens:** breakdown trié par les tokens totaux de chaque groupe
* **opencode-lens:** MCP : total d'usage cohérent, erreurs de la lens traduites, noms sur une ligne

## [0.23.0] (2026-10-19)


### Ajouté

* **opencode-lens:** fichier et API des presets du dashboard
* **opencode-lens:** fenêtre pour gérer les presets du dashboard
* **opencode-lens:** le fichier des presets parmi les fichiers écrits et dans la désinstallation
* **opencode-lens:** la disposition se souvient du modèle dont elle part
* **opencode-lens:** logique des presets du dashboard
* **opencode-lens:** presets personnalisés des modèles de dashboard
* **opencode-lens:** presets personnalisés dans le menu Modèle


### Corrigé

* **opencode-lens:** fenêtre et menu des presets : fermeture pendant l'enregistrement, confirmation avant d'enregistrer, focus, renommage et groupe accessible
* **opencode-lens:** les presets sont relus avant chaque modification, le formulaire ne se vide pas et le menu défile sur les écrans bas
* **opencode-lens:** le menu Modèle défile dans une fenêtre basse
* **opencode-lens:** prefs.origin d'une version plus récente est conservé et l'avertissement sur le fichier des presets ne se répète pas
* **opencode-lens:** un fichier de presets non valide est conservé avant qu'un enregistrement le remplace


### Documentation

* **opencode-lens:** notes sur les presets après les corrections de la revue
* **opencode-lens:** presets personnalisés des modèles de dashboard

## [0.22.0] (2026-10-19)


### Ajouté

* **opencode-lens:** « Afficher les coûts », un interrupteur unique pour masquer les coûts
* **opencode-lens:** Analyse part des 7 derniers jours
* **opencode-lens:** les graphiques des prompts individuels lisent jusqu'à 1000 prompts de la période
* **opencode-lens:** les retries d'aujourd'hui comme Indicateur, avec ceux dus à la limite de fréquence
* **opencode-lens:** le premier token peut être choisi comme métrique de l'Indicateur
* **opencode-lens:** le widget Budget compte aussi les steps et le coût
* **opencode-lens:** période « 8 heures » dans les filtres d'Analyse et dans les widgets


### Corrigé

* **opencode-lens:** compaction et nouvelles sessions dans l'Activité en direct
* **opencode-lens:** les filtres d'Analyse ne bougent plus quand la phrase sous le titre change
* **opencode-lens:** l'Activité en direct classique respecte « Événements affichés »
* **opencode-lens:** la petite note de « Voyants d'état » passe à la ligne au lieu d'être coupée
* **opencode-lens:** dans le Monitor d'Opérationnel, les modèles d'aujourd'hui sont des barres droites
* **opencode-lens:** dans le journal T4, la colonne de la session est aussi large que le nom le plus long
* **opencode-lens:** type « Steps échoués » dans l'Activité en direct
* **opencode-lens:** « Modèle » affiche le nom du modèle en entier, sur deux lignes
* **opencode-lens:** « Prompts en cours » peut masquer le coût
* **opencode-lens:** « Prompts en cours » sans coût dans Opérationnel et Veille
* **opencode-lens:** « Seulement avec problèmes » filtre les prompts sur le serveur

## [0.21.0] (2026-10-19)


### Ajouté

* **opencode-lens:** modèles de dashboard choisis depuis le menu latéral


### Corrigé

* **opencode-lens:** libellés des modèles et des prompts affichés en entier quand la place le permet

## [0.20.0] (2026-10-19)


### Ajouté

* **opencode-lens:** taille des widgets selon l'écran (Auto, Petite, Normale, Grande)


### Corrigé

* **opencode-lens:** le logo reste immobile quand on réduit le menu en icônes
* **opencode-lens:** tuiles de Paramètres et Système sur une ou deux lignes, sans troncature


### Documentation

* **opencode-lens:** conception de la taille des widgets selon l'écran

## [0.19.2] (2026-10-19)


### Corrigé

* **opencode-lens:** « bêta » et version sous le nom dans le menu, menu latéral plus étroit
* **opencode-lens:** « Par modèle aujourd'hui » classique : badge du rythme sans texte, avec la signification dans l'infobulle
* **opencode-lens:** « Réduire en icônes » en haut du menu, au-dessus des vues
* **opencode-lens:** « Dernière année » en vert, pour ne pas la confondre avec « Quand vous travaillez » qui reste en bleu
* **opencode-lens:** barres par modèle (B6) : nom entier sur deux lignes et barre sur le budget du jour
* **opencode-lens:** le dernier événement reçu n'est plus écrit dans le dashboard, seulement dans l'infobulle
* **opencode-lens:** aucun avertissement d'API modifiée si session.step.started n'a pas de data.started
* **opencode-lens:** valeurs des tuiles de Paramètres et Système à la ligne, sans points de suspension

## [0.19.1] (2026-10-18)


### Corrigé

* **opencode-lens:** série horaire avec 25 buckets le jour du retour à l'heure d'hiver

## [0.19.0] (2026-10-18)


### Ajouté

* **opencode-lens:** page « Système » avec CPU, mémoire, processus et services à l'écoute

## [0.18.0] (2026-10-18)


### Ajouté

* **opencode-lens:** mesures par style, Résumé avec styles et cartes sans espace vide
* **opencode-lens:** mesures par style, Résumé avec styles et cartes sans espace vide
* **opencode-lens:** position libre des widgets, barres de titre et barre latérale réductible
* **opencode-lens:** position libre des widgets, barres de titre et barre latérale réductible


### Documentation

* **opencode-lens:** maquette des barres de titre dans quatre directions

## [0.17.1] (2026-10-18)


### Corrigé

* **opencode-lens:** les instructions du MCP indiquent lens-guard pour le changement de modèle
* **opencode-lens:** les instructions du MCP indiquent lens-guard pour le changement de modèle

## [0.17.0] (2026-10-18)


### Ajouté

* **opencode-lens:** mise à jour de la lens depuis un zip dans Paramètres
* **opencode-lens:** lecture et vérification du zip de mise à jour
* **opencode-lens:** POST /api/update et /api/update/apply, mise à jour avec install.sh
* **opencode-lens:** section Mise à jour dans Paramètres


### Documentation

* **opencode-lens:** mise à jour depuis le dashboard
* **opencode-lens:** spécification et plan de la mise à jour depuis un zip dans Paramètres

## [0.16.0] (2026-10-18)


### Ajouté

* **opencode-lens:** GET /api/mcp/status, état du serveur MCP lu depuis OpenCode
* **opencode-lens:** Serveur MCP, nom lens indiqué dans la page et états plus précis
* **opencode-lens:** section Serveur MCP dans Paramètres
* **opencode-lens:** section Serveur MCP dans Paramètres
* **opencode-lens:** état et connexion du serveur MCP, logique pure


### Documentation

* **opencode-lens:** plan de la section Serveur MCP dans Paramètres
* **opencode-lens:** spécification de la section Serveur MCP approuvée

## [0.15.0] (2026-10-18)


### Ajouté

* **opencode-lens:** /api/errors et serveur MCP opencode-lens mcp pour OpenCode
* **opencode-lens:** /api/errors regroupe steps, tools, retries et exécutions échouées par modèle, type et statut
* **opencode-lens:** barre latérale, vue Monitor et styles de modèles sélectionnables
* **opencode-lens:** extras/ dans le paquet et dans l'installation, documentation de lens-guard
* **opencode-lens:** le MCP lit le port et le token dans le plist ; opencode-lens mcp install affiche la ligne pour opencode2
* **opencode-lens:** plugin lens-guard, changement de modèle quand le provider ne répond pas
* **opencode-lens:** plugin lens-guard, changement de modèle en cas de quota épuisé, long rate limit ou provider injoignable
* **opencode-lens:** serveur MCP stdio avec les révisions 2025-11-25 et 2026-07-28, écrit à la main
* **opencode-lens:** tools MCP budget, errors, usage et sessions avec le texte des erreurs seulement quand c'est permis


### Corrigé

* **opencode-lens:** les heures du MCP suivent le fuseau horaire courant
* **opencode-lens:** le MCP ne laisse pas le texte fermer les «», lit toutes les sessions et relit le plist à chaque appel
* **opencode-lens:** lens-guard se fie au type d'erreur d'OpenCode, ne change que si la connexion ne démarre pas et ne relance pas la chaîne en milieu de tour


### Documentation

* **opencode-lens:** plan de la branche réactive de lens-guard
* **opencode-lens:** plan de /api/errors et du serveur MCP opencode-lens mcp
* **opencode-lens:** serveur MCP pour OpenCode dans la configuration, métriques, README et architecture
* **opencode-lens:** évaluation du MCP et des plugins OpenCode au-dessus des API de Lens
* **opencode-lens:** évaluation du MCP et des plugins OpenCode au-dessus des API de Lens
* **opencode-lens:** évaluation du MCP et des plugins OpenCode au-dessus des API de Lens

## [0.14.1] (2026-10-17)


### Corrigé

* **opencode-lens:** Maintenant relit le jour des budgets dès qu'il se réinitialise
* **opencode-lens:** les id des widgets d'une vue inconnue comptent dans l'unicité entre les vues
* **opencode-lens:** les espaces entre les segments de la barre de composition ont la couleur de la surface
* **opencode-lens:** les runs en cours excluent les sessions supprimées
* **opencode-lens:** le test du contrat avec OpenCode Monitor vérifie le statut 200
* **opencode-lens:** la date du calendrier utilise fmtLongDate comme les autres dates
* **opencode-lens:** la ligne de détail met à jour le colspan quand le widget Prompts change de largeur
* **opencode-lens:** derniers restes des revues du dashboard v2
* **opencode-lens:** test, l'idle d'un sous-agent n'envoie pas d'événements run dans le feed
* **opencode-lens:** une seule règle pour les limites des modèles, entier positif sûr ou aucun
* **opencode-lens:** unités sur les axes de distribution et heure par heure, légende d'Évolution masquée sans données

## [0.14.0] (2026-10-17)


### Ajouté

* **opencode-lens:** événements en direct pour le premier token, la fin du stream, les interruptions, les titres et la compaction
* **opencode-lens:** métriques et spans OTLP pour le premier token, tok/s, les interruptions et les tâches internes
* **opencode-lens:** heures des steps et compaction exactes depuis la lecture des messages
* **opencode-lens:** premier token, tok/s, motifs des interruptions et tâches internes par type dans le dashboard
* **opencode-lens:** schéma v4 — premier token, tok/s, motif des interruptions et tâches internes exacts
* **opencode-lens:** schéma v4 avec les heures des steps, le motif des runs et le type des tâches internes
* **opencode-lens:** tâches internes exactes qui absorbent l'estimation sans double comptage
* **opencode-lens:** vitesse des steps, motifs des interruptions et tâches internes par type dans les API


### Corrigé

* **opencode-lens:** « Prompts en cours » sans durées absurdes ni retards
* **opencode-lens:** /api/timeseries accepte à nouveau le paramètre model utilisé par OpenCode Monitor
* **opencode-lens:** /api/timeseries accepte à nouveau le paramètre model utilisé par OpenCode Monitor
* **opencode-lens:** /metrics additionne premier token et tok/s des steps en SQL
* **opencode-lens:** compaction en direct seulement avec l'id de son started, et la lecture ne ramène pas la requête à la première tentative
* **opencode-lens:** durées de moins de 10 minutes avec les secondes (« 1 min 30 s »)
* **opencode-lens:** les prompts de la période entière se calculent une fois par actualisation
* **opencode-lens:** Début, Fin et Espace sur les onglets « Maintenant | Analyse »
* **opencode-lens:** la fin du stream d'une tentative précédente n'écrase pas celle de la dernière
* **opencode-lens:** dans le détail de la session, les tâches internes sont regroupées par type et modèle
* **opencode-lens:** prompts et sessions paginés suivent la hauteur du widget
* **opencode-lens:** finitions du dashboard v2
* **opencode-lens:** finitions du schéma v4 après la revue
* **opencode-lens:** test que chaque type du catalogue a son widget, niceMax retiré
* **opencode-lens:** un glissement ne finit pas dans l'autre vue si la vue change
* **opencode-lens:** une ligne exacte des tâches internes ne retombe plus sur une relecture
* **opencode-lens:** une réponse vide ne reste pas « en attente du premier token » jusqu'à la fin du step


### Documentation

* **opencode-lens:** conception du schéma v4 (vitesse des steps, motif des interruptions, tâches internes exactes)
* **opencode-lens:** documentation du schéma v4
* **opencode-lens:** le span d'un run est envoyé une fois, sans un motif d'interruption arrivé après
* **opencode-lens:** plan d'implémentation du schéma v4

## [0.13.0] (2026-10-17)


### Ajouté

* **opencode-lens:** « prompt terminé » dans l'activité en direct
* **opencode-lens:** Évolution en colonnes ou en ligne, feed et calendrier qui s'adaptent au widget
* **opencode-lens:** calculs purs pour les widgets de Maintenant
* **opencode-lens:** dashboard à deux vues, Maintenant et Analyse, avec les prompts et le prompt en cours
* **opencode-lens:** disposition à deux vues avec migration automatique
* **opencode-lens:** liste des prompts avec tokens par type, durée et tools (/api/runs)
* **opencode-lens:** liste et distribution des prompts dans le dashboard
* **opencode-lens:** hero d'aujourd'hui, modèles, indicateurs et prompt en cours
* **opencode-lens:** la disposition v2 dans dashboard-v2.json, la v1 reste intacte
* **opencode-lens:** limite de contexte des modèles depuis la config et le catalogue d'OpenCode
* **opencode-lens:** période « day » (jour des budgets) pour les endpoints avec from
* **opencode-lens:** prompts en cours en direct (/api/runs/live)
* **opencode-lens:** états vide, erreur et chargement identiques pour tous les widgets
* **opencode-lens:** tokens d'aujourd'hui heure par heure et indicateurs par jour (/api/hourly, /api/daily)
* **opencode-lens:** vues Maintenant et Analyse dans le dashboard


### Corrigé

* **opencode-lens:** axes des graphiques sans libellés répétés
* **opencode-lens:** avec la lens injoignable, les widgets affichent l'erreur au lieu de rester figés
* **opencode-lens:** formats it-IT des coûts, durées et dates
* **opencode-lens:** le catalogue des modèles ne signale pas de changement d'API pour les modèles sans contexte
* **opencode-lens:** la distribution des prompts se redessine à sa taille en revenant du tableau au graphique
* **opencode-lens:** heure courante dans le fuseau du serveur et widgets de Maintenant sans défilement interne à 900 px
* **opencode-lens:** soFarAvg ne compte les jours précédents que jusqu'au même décalage que now
* **opencode-lens:** widgets par défaut sans défilement interne, de 375 à 1440 px


### Modifié

* **opencode-lens:** les runs en direct cherchent dans les index de la fenêtre au lieu de lire tous les steps et tools


### Documentation

* **opencode-lens:** corrigé les formes de runs/summary et runs/live et le retour à une ancienne version
* **opencode-lens:** dashboard à deux vues, prompts et nouvelles API
* **opencode-lens:** conception et plan du dashboard à deux vues
* **opencode-lens:** documentation alignée sur le dashboard v2

## [0.12.2] (2026-10-17)


### Corrigé

* **opencode-lens:** corrections issues de la revue de code
* **opencode-lens:** les steps interrompus ne restent pas « en cours » pour toujours dans le Résumé et dans les sessions
* **opencode-lens:** OPENCODE_SERVER_URL avec utilisateur et mot de passe est refusé au lieu de finir dans les erreurs
* **opencode-lens:** plist, base de données et dashboard.json lisibles seulement par le propriétaire


### Modifié

* **opencode-lens:** code jamais utilisé signalé par la revue retiré

## [0.12.1] (2026-10-17)


### Corrigé

* **opencode-lens:** install.sh s'arrêtait avec « APP… : unbound variable » dans le Terminal de macOS

## [0.12.0] (2026-10-17)


### Ajouté

* **opencode-lens:** install.sh vérifie et nettoie les installations précédentes
* **opencode-lens:** installation depuis un zip avec une seule commande, sans sudo


### Documentation

* **opencode-lens:** versions et releases avec les deux zips et la compatibilité de l'installation

## [0.11.0] (2026-10-17)


### ⚠ BREAKING CHANGES

* **opencode-lens:** plus de formule Homebrew ni de tap vale76p/tap. Qui avait installé avec brew passe au zip : l'extraire dans ~/Applications, lancer node ~/Applications/opencode-lens/src/main.js service install (il conserve variables, base de données et disposition), puis brew uninstall opencode-lens et brew untap vale76p/tap.

### Modifié

* **opencode-lens:** installation depuis le zip de la release, sans Homebrew

## [0.10.0] (2026-10-17)


### ⚠ BREAKING CHANGES

* **opencode-lens:** dans /metrics et dans l'export OTLP, opencode_lens_steps_total n'a plus finish="running" (les steps terminés sans motif ont finish="unknown") et opencode_lens_tool_calls_total, opencode_lens_tool_output_bytes_total et opencode_lens_tool_duration_seconds n'ont plus status="pending"/"running"/"?". Pour ce qui est en cours, utiliser opencode_lens_steps_running et opencode_lens_tool_calls_running (voir docs/fr/metriche.md).

### Ajouté

* **opencode-lens:** compteurs corrigés et gauges pour les steps et tools en cours


### Corrigé

* **opencode-lens:** chaîne de release plus sûre
* **opencode-lens:** dashboard plus fiable avec la lens arrêtée et des sessions actives
* **opencode-lens:** serveur et paramètres plus robustes, aucun secret dans les erreurs

## [0.9.0] (2026-10-16)


### Ajouté

* **opencode-lens:** budgets actifs seulement pour les modèles de la configuration d'OpenCode
* **opencode-lens:** budgets par modèle depuis les Paramètres, avec l'historique
* **opencode-lens:** carte « Budget par modèle » dans les Paramètres
* **opencode-lens:** gauge du budget d'un modèle et type de widget models
* **opencode-lens:** lecture des modèles depuis la configuration globale d'OpenCode
* **opencode-lens:** widget « Budget par modèle » et gauge par modèle


### Corrigé

* **opencode-lens:** budgets avec le point des milliers refusés et LENS_MODEL_LIMITS écrite à la main plus bloquante
* **opencode-lens:** jour des budgets au passage à l'heure d'été et modèles jamais vus sans « feu vert »


### Documentation

* **opencode-lens:** budgets par modèle depuis la configuration d'OpenCode
* **opencode-lens:** budgets par modèle et heure de réinitialisation
* **opencode-lens:** conception des budgets par modèle depuis la configuration d'OpenCode
* **opencode-lens:** plan des budgets par modèle depuis la configuration d'OpenCode

## [0.8.1] (2026-10-16)


### Modifié

* **opencode-lens:** « Aujourd'hui » sans la barre de la tranche 7–19

## [0.8.0] (2026-10-16)


### Ajouté

* **Widget « Budget et réinitialisation »** : jour, semaine et mois pour la métrique choisie, avec l'utilisation par rapport au budget `LENS_LIMIT_*`, la projection à la réinitialisation et **quand ils se réinitialisent**, c'est-à-dire un compte à rebours (« se réinitialise dans 2 j 9 h ») et la date et l'heure (« lun 19/10 00:00 »). Les périodes suivent le calendrier en heure locale : le jour à partir de minuit, la semaine à partir du lundi, le mois à partir du jour 1. Il est dans la disposition par défaut, sous « Aujourd'hui » et « Dernière année », et dans le catalogue pour qui a déjà personnalisé le dashboard
* Les gauges de budget indiquent aussi dans combien de temps leur période se réinitialise


### Documentation

* `/api/budget` : `from` et `to` sont le début et la réinitialisation de la période (ms epoch, heure locale), `elapsed` la fraction écoulée

## [0.7.1] (2026-10-16)


### Corrigé

* **opencode-lens:** la formule Homebrew télécharge l'archive du tag avec HOMEBREW_GITHUB_API_TOKEN

## [0.7.0] (2026-10-16)


### Ajouté

* **Installation avec Homebrew** depuis le tap privé vale76p/homebrew-tap : `brew tap vale76p/tap`, `brew install vale76p/tap/opencode-lens`, `opencode-lens service install`. Tout dans le dossier utilisateur, sans `sudo` ; guide dans le [README](README.fr.md)
* **`opencode-lens service install | uninstall [--purge] | start | stop | restart | status`** : gère le LaunchAgent `local.opencode-lens` à la place de `install.sh` et `uninstall.sh`, qui restent comme enveloppes pour qui travaille depuis un clone. Il conserve les variables du plist (budgets, `LENS_TOKEN`…), utilise les chemins stables de Homebrew (`/opt/homebrew/opt/…`), réactive le service éteint par le Monitor et retente le bootstrap
* **Redémarrage automatique après une mise à jour** : lancée par launchd, la lens remarque la nouvelle version (par exemple après `brew upgrade`) et redémarre toute seule en une minute
* À chaque release, le workflow met à jour la formule du tap (secret `HOMEBREW_TAP_TOKEN`, voir le [README](README.fr.md#versions-et-releases))


### Documentation

* README, désinstallation, dépannage et configuration pour l'installation avec Homebrew ; conception et plan dans `docs/superpowers/`

## [0.6.0] (2026-10-16)


### Ajouté

* **Dashboard personnalisable** : avec « Personnaliser le dashboard » les blocs deviennent des widgets sur une grille de 12 colonnes. Ils se déplacent en les faisant glisser (ou avec les flèches), se redimensionnent depuis le coin, se retirent et s'ajoutent depuis le catalogue, même plusieurs fois le même. La disposition est enregistrée dans `dashboard.json` à côté de la base de données : elle est personnelle et ne finit pas dans le paquet. Guide : [docs/fr/dashboard.md](docs/fr/dashboard.md)
* **Paramètres par widget** (⚙) : période, métrique, regroupement et titre propres, ou « Dashboard » pour suivre les filtres en haut
* **Widget gauge**, en demi-cercle ou en anneau : budget du jour, de la semaine ou du mois avec la projection, prompts depuis le cache, steps échoués, appels de tool en erreur
* **Widget ligne** avec courbes douces et aire dégradée, une ligne par modèle, agent ou provider, ou le total (`/api/timeseries?by=total`)
* **Variables d'environnement modifiables depuis la page Paramètres** avec le LaunchAgent d'`install.sh` : validées comme au démarrage, écrites dans le plist, lens rechargée
* **« Aujourd'hui »** : barre de tokens 0–24 (bleue) et de la tranche 7–19 (verte) avec les heures, date et budget dans le bouton « i », à côté du calendrier annuel
* Statistiques des runs sur une seule ligne ; sessions de la période 10 par page (`/api/sessions` avec `offset` et le total dans l'en-tête `x-total-count`)


### Corrigé

* `install.sh` retente le bootstrap si launchd n'a pas encore fini de décharger le service : avant, il pouvait laisser la lens arrêtée avec « Bootstrap failed: 5 »


### Modifié

* Le dashboard est en modules ES : `ui.js`, `layout.js` (partagé avec le serveur pour valider), `widgets.js`, `editor.js`, `gauge.js`, `curves.js`


### Documentation

* Nouveau guide [docs/fr/dashboard.md](docs/fr/dashboard.md) ; conception et plan du dashboard personnalisable dans `docs/superpowers/`

## [0.5.0] (2026-10-16)


### Ajouté

* **opencode-lens-monitor :** app dans la barre des menus avec panneau et widgets


### Corrigé

* **opencode-lens:** install.sh conserve les EnvironmentVariables du plist existant
* **opencode-lens:** install.sh conserve les EnvironmentVariables du plist existant

## [0.4.0] (2026-10-16)


### Ajouté

* **opencode-lens:** budgets hebdomadaires et mensuels et /api/budget
* **opencode-lens:** budgets hebdomadaires et mensuels LENS_LIMIT_*_WEEKLY et _MONTHLY
* **opencode-lens:** endpoint /api/budget pour l'app monitor et les widgets
* **opencode-lens:** périodes de calendrier avec projection et rythme par jour, semaine et mois

## [0.3.1] (2026-10-15)


### Corrigé

* **opencode-lens:** export OTLP en delta sans renvoi de l'historique au redémarrage et sans perte après un envoi échoué
* **opencode-lens:** les spans en erreur ne portent que le type de l'erreur, l'endpoint OTLP apparaît sans identifiants
* **opencode-lens:** la série actuelle du calendrier ne se réinitialise pas au début de la journée
* **opencode-lens:** permissions en attente comme gauge, LENS_PORT=0 acceptée aussi dans le contrôle Host, --help avec toutes les variables même si l'environnement n'est pas valide
* **opencode-lens:** prompts et runs des sous-agents exclus de Run et interaction et des métriques, leur coût reste dans le run de la session parente
* **opencode-lens:** traces OTLP exportées run par run dans l'ordre d'enregistrement, avec chaque step sous son run et sans span perdu
* **opencode-lens:** un prompt envoyé pendant un run en cours ne coupe plus le run

## [0.3.0] (2026-10-15)


### Ajouté

* **opencode-lens:** barre Aujourd'hui avec budgets quotidiens et calendrier annuel
* **opencode-lens:** taille de l'output et tools exécutés par le provider dans le tableau Tools
* **opencode-lens:** export facultatif OTLP/HTTP JSON des métriques (cumulative ou delta) et des traces de run, step et tool
* **opencode-lens:** LENS_LABELS sur chaque série de /metrics et nouvelles métriques pour runs, prompts, permissions, commits, sous-agents, budgets et durée des tools
* **opencode-lens:** prompts (longueur et pièces jointes seulement), permissions avec réponse et temps d'attente, git commits réussis et coût par commit
* **opencode-lens:** runs du prompt à la réponse avec résultat, durée et coût sous-agents compris, reconstruits aussi pour les sessions sans messages idle
* **opencode-lens:** sous-agents liés à l'appel task qui les lance, total des sessions avec les sous-agents et regroupement par type d'agent
* **opencode-lens:** timeline de la session avec steps, tools et runs, pauses de plus d'une minute raccourcies


### Corrigé

* **opencode-lens:** événements avec un id déjà vu écartés, pour que le feed en direct ne les affiche pas deux fois
* **opencode-lens:** validation des variables d'environnement, colonne exécution des tools

## [0.2.0] — 2026-10-15

### Ajouté

- **Page Paramètres** dans le dashboard (`#impostazioni`) : version et processus, fichiers écrits par la lens avec statut, taille et date (base de données, WAL, log, LaunchAgent), fichiers lus, données enregistrées dans le navigateur, état de la base de données, variables d'environnement effectives avec leur origine (les secrets ne sont jamais affichés) et les commandes de désinstallation complète déjà remplies avec les chemins de cette installation.
- **Page Nouveautés** (`#novita`) : ce changelog, avec la version installée mise en évidence et un indicateur dans la navigation quand la version change.
- Version à côté du titre du dashboard, `--version` en ligne de commande, métrique `opencode_lens_build_info` dans `/metrics`.
- Endpoints `/api/about` et `/api/changelog`.
- Guide [docs/fr/disinstallazione.md](docs/fr/disinstallazione.md) : suppression complète du service, de la base de données, des logs, du dossier de l'app et des données du navigateur, avec les commandes de vérification.
- Versioning : tags `opencode-lens-vX.Y.Z`, workflow `opencode-lens-release` qui vérifie tag, version et changelog, crée le zip et publie la release sur GitHub ; `scripts/changelog.mjs` pour contrôler le changelog et extraire les notes.

### Modifié

- La version a une seule source, `package.json` : `/api/status` la lit de là au lieu de l'avoir écrite dans le code.
- Le zip n'est plus commité dans `dist/` : il est joint à la release GitHub. `npm run package` le crée toujours en local.

## [0.1.0] — 2026-10-15

Première version. Vérifiée avec OpenCode V2 bêta 17823.

### Ajouté

- **Collector** : discovery du service partagé depuis `service.json` (relue à chaque reconnexion, Basic auth), stream en direct depuis `/api/event` avec reconnexion et backoff, backfill faisant autorité depuis `/api/session` et `/api/session/{id}/message` à la connexion, toutes les 2 minutes et en fin de run.
- **Chiffres exacts** : upserts idempotents par ID, retries comptés comme tentatives du même step, tâches internes (titre, compaction) obtenues comme *total de la session − Σ steps* sans double comptage ; `npm run verify` réconcilie la base de données avec les totaux d'OpenCode.
- **Dashboard** sur `http://127.0.0.1:4777` : tokens par type, coût, cache, latence p50/p95, output tok/s, séries par heure/jour/semaine en heure locale, répartition par modèle, agent, provider et dossier, tools avec les erreurs les plus fréquentes, sessions avec détail des steps, feed en direct. Couleurs stables pour les 6 modèles les plus utilisés de tous les temps.
- **API locale** JSON, `/api/live` (SSE) et `/metrics` au format Prometheus.
- **Sécurité et confidentialité** : `127.0.0.1` seulement par défaut, contrôle de l'en-tête `Host`, GET seulement, CSP restrictive, aucun proxy vers l'API d'OpenCode ; `LENS_TOKEN` obligatoire pour l'exposer sur le réseau. Aucun prompt, réponse ou output de tool enregistré ; titres facultatifs (`LENS_STORE_TITLES=0`).
- **Signalement de la dérive de l'API** bêta : avertissement dans le dashboard, `/api/status` et `/metrics` quand les événements changent de forme.
- **Installation** comme LaunchAgent macOS avec `install.sh` / `uninstall.sh` (`--purge` pour supprimer base de données et logs).
- **Tests** `node:test` sans dépendances, avec un faux service OpenCode ; paquet `dist/opencode-lens-0.1.0.zip` créé par `scripts/package.sh`.

