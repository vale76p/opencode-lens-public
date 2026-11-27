# Écrire un module de Lens

🌐 [Italiano](../moduli-custom.md) · [English](../en/moduli-custom.md) · Français

Ce guide s'adresse à qui écrit un module **à soi**, presque toujours un modèle (dans OpenCode ou ailleurs) qui ne connaît pas le code de la lens. Suivez les sections dans l'ordre : c'est l'ordre du travail. Chaque règle dit quel fichier de la lens l'impose ; les détails complets du contrat sont dans [moduli.md](moduli.md#écrire-un-module), ici il n'y a que ce qu'il faut pour construire. Qui lit ce guide par `lens_module_guide` ne peut pas ouvrir les liens vers moduli.md : le fichier est sur le disque, dans `<app>/docs/moduli.md` (`<app>` est `~/Applications/opencode-lens`, ou la copie du dépôt de la lens). L'outil MCP `lens_module_guide` renvoie le texte italien de ce guide plus les valeurs de cette installation (dossier, version, noms déjà pris) ; avec `section` il renvoie chaque section dont le titre contient ce texte (sans distinction de casse), par exemple `section: "widget"`. **`section` cherche dans les titres du guide italien**, pas dans ceux de cette traduction : `Persistenza`, `Pagina del browser`, `Widget della dashboard`, `Lavoro lungo`, `Verifica`, `Checklist`… Les libellés et les réponses de l'outil sont en italien, comme tout ce que le MCP envoie à OpenCode. Dans ce guide, un libellé italien cité tel quel depuis l'outil est en italique *« … »*, avec une courte traduction à sa première occurrence.

Tous les exemples viennent du module d'exemple `extras/module-template/` (id `mio-modulo`, widget `mio-modulo-conteggio`, réglage `LENS_MIO_MODULO_NOTE`) : une page avec un bloc-notes, un widget, un `GET`, un `POST` JSON, un fichier JSON, un réglage et les tests. **Partez toujours d'une copie de celui-ci.**

## Avant d'écrire

- **Faut-il vraiment un module ?** Un module ajoute à la lens une page, des widgets pour le dashboard, des routes `/api`, des outils MCP ou des métriques, sur des données que la lens n'a pas déjà. Pour voir autrement des données que la lens a déjà, essayez d'abord les widgets du cœur et leur ⚙ (voir [dashboard.md](dashboard.md)) ; pour demander quelque chose à Lens depuis OpenCode, les outils MCP du cœur suffisent (`lens_usage`, `lens_sessions`…).
- **Ce qu'on ne trouve pas.** La lens n'enregistre ni le texte des prompts ni les réponses des modèles (voir [configurazione.md](configurazione.md#sécurité-et-confidentialité)) : aucun module ne peut les lire dans la base. Un module n'ouvre pas la base, n'écrit pas dans les tables du cœur, n'importe pas de fichiers de `src/` ou `public/` de la lens et ne lit pas `process.env` : tout arrive par `ctx` (Node), par `"/module-kit.js"` (navigateur) et par `kit` (MCP).
- **Pas de rechargement à chaud.** La lens cherche les modules seulement au démarrage : un module nouveau, ou un fichier du module modifié, compte après un redémarrage de la lens (`src/modules.js`, `discoverAll`). Les outils MCP d'un module apparaissent dans OpenCode seulement après un redémarrage d'OpenCode.
- **Pas de sandbox.** Le code d'un module est du code Node de confiance : il tourne dans le processus de la lens, avec ses permissions, et peut lire et écrire n'importe quel fichier de l'utilisateur. Le code du navigateur tourne dans la page du dashboard sans isolation. Les limites de `ctx` évitent les erreurs, elles n'arrêtent pas un module hostile. N'écrivez pas un module qui fait plus que ce que l'utilisateur a demandé.
- **L'ordre du travail** : `lens_module_guide` (ce guide et les valeurs) → copie du module d'exemple dans le dossier de l'utilisateur → manifeste → côté Node → page et widgets → `lens_module_check` jusqu'à ce qu'il réponde OK → redémarrage de la lens → **Paramètres › Modules** › *Activer* → les tests du module.

## Où enregistrer le module

- **Dans le dossier des modules de l'utilisateur**, à côté de la base de la lens (`<dossier de lens.db>/modules/<id>/`), jamais dans le dossier de l'app. La valeur exacte est donnée par `lens_module_guide` (*« Cartella dei moduli dell'utente »*, le dossier des modules de l'utilisateur) et par `GET /api/modules/authoring` (champ `userDir`, depuis cet ordinateur seulement). Par défaut :

  | Où elle tourne | Dossier des modules de l'utilisateur |
  |---|---|
  | macOS | `~/Library/Application Support/opencode-lens/modules/` |
  | Linux | `$XDG_DATA_HOME/opencode-lens/modules/` (par défaut `~/.local/share/opencode-lens/modules/`) |
  | `LENS_DB` définie | le dossier `modules/` à côté du fichier de la base |
  | `LENS_DB=:memory:` | aucun : pas de modules de l'utilisateur |

- **Ne l'enregistrez pas dans `~/Applications/opencode-lens/modules/`** : chaque mise à jour efface et recrée le dossier de l'app. Le dossier des données survit aux mises à jour (`install.sh` n'y touche pas), et les modules qu'il contient aussi.
- **Si le dossier `modules/` n'existe pas, créez-le.** La lens ne le crée pas ; s'il manque, il ne se passe rien.
- **Le nom du sous-dossier est l'id du module** : minuscules, chiffres et tiret, commençant par une lettre (`^[a-z][a-z0-9-]*$`, `MODULE_ID` de `src/config.js`). Un dossier avec un autre nom (`mio modulo`, `Mio-Modulo`, `demo 2`) n'est pas un module et il est ignoré sans bruit. Si le module doit avoir des tables, pas de tiret dans l'id (voir [Persistance](#persistance)).
- **Un id libre.** N'utilisez pas un id déjà pris (liste *« Id di modulo già presi »*, les ids de module déjà pris, de `lens_module_guide`) ni un id réservé par le cœur (pages, vues, clés de `/api/status`, types de changement : liste *« Id riservati »*, les ids réservés). Un id égal à un module de la lens (`sistema`, `skill`…) n'est jamais importé : la lens le met de côté (`shadowed`) et **Paramètres › Modules** demande de renommer le dossier.
- **Un lien symbolique convient** : dans le dossier de l'utilisateur un sous-dossier peut être un lien vers un dossier ailleurs (par exemple une copie de travail sous git).

## Dossiers et fichiers

Copiez le module d'exemple sous le nom de votre id, puis renommez `mio-modulo` partout : nom du dossier, `id` du manifeste, chemins `/api/mio-modulo`, type du widget `mio-modulo-conteggio`, `id` de `page.js`, `id="view-mio-modulo"` et `data-ico` de `page.html`, préfixe des classes CSS et des ids HTML (`mm-`), nom du fichier JSON et nom du réglage `LENS_MIO_MODULO_NOTE`.

```bash
# l'app installée contient le module d'exemple ; <dossier des modules> est celui de lens_module_guide
cp -R ~/Applications/opencode-lens/extras/module-template "<dossier des modules>/mio-modulo"
```

```
<id>/
  module.js          le manifeste (obligatoire)
  server/index.js    l'entrée Node (obligatoire) : configure, files, hasData, create
  public/            les fichiers du navigateur, tous dans ce dossier, plat, noms en minuscules
    page.js          la page : exporte page et title
    page.html        le balisage de la page : <section id="view-<id>">
    widgets.js       les widgets du dashboard (avec widgets et widgetsFile)
    style.css        facultatif
    lang-en.js       les catalogues du module (un texte italien → la traduction)
    lang-fr.js
  tables.js          facultatif : les tables du module dans la base
  server/writes.js   facultatif, avec tables.js : les SQL d'écriture
  mcp/tools.js       facultatif : les outils MCP
  test/              les tests du module
```

- **`module.js` n'a pas d'import** et ne fait rien : la lens l'importe au démarrage même pour un module désactivé, pour savoir qu'il existe.
- **`server/index.js` n'a pas d'effets à l'import** : ni minuteries, ni connexions, ni lectures au premier niveau. La lens l'importe même pour un module désactivé (pour `files` et `hasData`) et `lens_module_check` l'exécute à chaque contrôle. Le travail se fait dans `create(ctx)` et dans `start()`.
- **Les imports** : dans le dossier du module, `node:*` et, seulement dans les fichiers de `public/` et `test/`, `"/module-kit.js"` ; dans les tests aussi `"/module-test-kit.js"`. Rien d'autre (les règles sont celles de `test/module-boundaries.test.js` pour les modules de la lens ; pour le vôtre, le test *« gli import »* (les imports) du module d'exemple les vérifie : gardez-le).
- **`public/` est plat** : la lens sert `/modules/<id>/<fichier>` avec `<fichier>` fait de minuscules, chiffres, `.`, `_` et `-`, sans sous-dossiers (`MODULE_FILE` de `src/server.js`), et seulement avec le module activé.

## Le manifeste

`module.js` exporte par défaut un objet. La lens le juge avec `manifestError` de `src/modules.js` (plus `src/module-mcp-fields.js` et `src/module-widget-fields.js`) : un champ erroné envoie le module en `error` avec le motif, visible dans **Paramètres › Modules** et dans `lens_module_check`. Voici **tous** les champs qu'elle lit (la liste est `MANIFEST_FIELDS` de `src/modules.js`) :

| Champ | Obligatoire | Valeurs valides |
|---|---|---|
| `id` | oui | égal au nom du dossier ; pas une page ou une vue du cœur, une clé de `/api/status` ni un type de changement (voir [Les ids réservés](moduli.md#les-ids-réservés)) |
| `name` | oui | texte italien non vide, traduit par les catalogues du module |
| `description` | oui | texte italien non vide, traduit comme `name` |
| `lens` | oui | `x.y.z`, la version la plus ancienne de la lens qui fait tourner le module : mettez celle que donne `lens_module_guide`. Plus récente que la lens en service → `error` |
| `menu` | oui | `{ group, order, icon }` : `group` vaut `"dati"` ou `"lens"`, `order` un nombre (trie dans le groupe ; les modules vont à la fin), `icon` un texte, l'intérieur d'un `<svg viewBox="0 0 24 24">` |
| `page` | oui | `{ title }` : le titre de l'entrée de menu, texte italien non vide |
| `server` | oui | `() => import("./server/index.js")` |
| `settings` | non | les variables `LENS_…` du module, voir plus bas |
| `widgets` | non | de 1 à 12 widgets du dashboard ; exige `widgetsFile` (voir [Widgets du dashboard](#widgets-du-dashboard)) |
| `widgetsFile` | avec `widgets` | le nom d'un fichier `.js` de `public/` (`^[a-z0-9-]+\.js$`), par exemple `"widgets.js"` |
| `mcp` | non | `() => import("./mcp/tools.js")` (voir [MCP du module](#mcp-du-module)) |
| `mcpTools` | avec `mcp` | les noms des outils, `^[a-z][a-z0-9_-]{0,63}$`, sans répétition |
| `mcpInstructions` | non, avec `mcp` | des lignes (une ligne chacune, non vides) ajoutées aux instructions du serveur MCP |
| `mcpExamples` | non, avec `mcp` | des questions d'exemple pour Paramètres › Serveur MCP, une ligne chacune |
| `mcpPrompts` | non, avec `mcp` | `true` si le fichier `mcp` exporte aussi `prompts(kit)` (voir [moduli.md](moduli.md#les-prompts-mcp-dun-module)) |
| `notice` | non | texte italien de l'avis « était utilisé » après une mise à jour |
| `settingsPanel` | non | un fichier `.js` de `public/` avec le panneau de la carte (voir [moduli.md](moduli.md#le-panneau-dans-la-carte)) |
| `tables` | non | `() => import("./tables.js")` (voir [Persistance](#persistance)) |
| `source` | non | `{ label }` : le module est une source de données alternative à OpenCode. Avancé : un module nouveau n'en a pas besoin (voir [moduli.md](moduli.md#une-source-alternative)) |

Le manifeste du module d'exemple :

```js
export default {
  id: "mio-modulo",
  name: "Il mio modulo",
  description: "Un modulo d'esempio da copiare: un blocco di note con la sua pagina, un widget per la dashboard e un'impostazione",
  lens: "0.51.1", // x-release-please-version
  menu: { group: "dati", order: 90, icon: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h6"/>' },
  page: { title: "Il mio modulo" },
  server: () => import("./server/index.js"),
  settings: [{ name: "LENS_MIO_MODULO_NOTE", label: "Nota di benvenuto", help: "mostrata in cima alla pagina; vuoto = nessuna", kind: "text", placeholder: "Ciao!" }],
  widgetsFile: "widgets.js",
  widgets: [{
    type: "mio-modulo-conteggio", label: "Note del mio modulo", description: "Quante note hai scritto nel periodo, e l'ultima",
    size: [3, 4], min: [3, 3], home: "adesso",
    settings: { title: null, range: ["dashboard", "day", "604800000", "2592000000", "0"] },
    data: ["/api/mio-modulo?from={from}"],
  }],
};
```

**`settings`** (`settingsError` de `src/modules.js`) : une liste de `{ name, label, help, kind, placeholder? }`.

- `name` : `LENS_` plus majuscules, chiffres et `_` (`^LENS_[A-Z0-9_]+$`) ; pas une variable du cœur, pas déjà déclarée par un autre module (liste *« Variabili LENS_… già prese »*, les variables LENS_… déjà prises, de `lens_module_guide`), sans répétition. Utilisez `LENS_<ID>_…`, comme `LENS_MIO_MODULO_NOTE`.
- `label` et `help` : textes italiens (`help` peut être vide). `kind` : `"text"`, `"num"` ou `"secret"`. `placeholder` : texte facultatif, la valeur par défaut affichée dans le champ.
- Avec `kind: "num"`, `min` et `max` facultatifs, entiers, `min ≤ max` ; avec un autre `kind` ils sont une erreur.
- Une liste de chemins est un réglage `kind: "text"` avec les chemins séparés par `:`, comme `LENS_SECURITY_DIRS` (`modules/security/server/settings.js`).
- Chaque réglage est un champ de la carte du module dans **Paramètres › Modules** ; l'enregistrer redémarre la lens, si `configure` accepte la valeur (voir la section suivante). La valeur n'arrive au module que par `configure`.

**Les textes du manifeste** (`name`, `description`, `page.title`, `label`, `help` et `placeholder` des réglages, `label` et `description` des widgets, `notice`) s'écrivent en italien et ont une entrée dans `public/lang-en.js` et `public/lang-fr.js` du module.

## Entrée Node et ctx

`server/index.js` exporte jusqu'à quatre fonctions. Seule `create` est obligatoire (`lens_module_check` dit *« server/index.js deve esportare create(ctx) »*, server/index.js doit exporter create(ctx)).

- **`configure(ctx)`** : lit les réglages. La lens l'appelle au démarrage pour chaque module trouvé, activé ou non, et à chaque enregistrement depuis Paramètres. Elle reçoit seulement `{ id, env, paths, i18n }` (`settingsContext` de `src/module-kit.js`) : `env` contient **seulement** les variables déclarées dans `settings`, plus `HOME` et `XDG_*`. Elle renvoie `{ values, errors }` : `values` est l'objet que le module verra comme `ctx.settings` (déjà converti : nombres en nombres, chemins absolus), `errors` une liste de textes ou de `Localized`. Ce que font les `errors` : **depuis le dashboard une valeur erronée ne s'enregistre pas** : à chaque enregistrement depuis Paramètres la lens exécute `configure` des modules qui resteront activés avec l'environnement d'après l'enregistrement (`validateEnv` de `src/modules.js`, appelée par `src/settings.js`) et, en cas d'erreur, répond 400 avec les erreurs, sans rien écrire et sans redémarrer (une erreur qui commence par le nom de la variable, comme celle du module d'exemple, la page la signale sur le champ). Le module est « à configurer » (`unconfigured`), et ne démarre pas, seulement quand l'environnement est déjà erroné au démarrage : un dossier disparu, le plist écrit à la main. Si `configure` lève une exception ou ne renvoie pas `{ values, errors }`, le module passe en `error`. **Sans `configure`, `ctx.settings` vaut `{}`** : la valeur de la variable n'arrive jamais au module.

  ```js
  export function configure(ctx) {
    const { Localized } = ctx.i18n;
    const note = (ctx.env.LENS_MIO_MODULO_NOTE ?? "").trim();
    const errors = note.length > MAX_TEXT ? [new Localized("LENS_MIO_MODULO_NOTE è troppo lunga: al più {max} caratteri", { max: MAX_TEXT })] : [];
    return { values: { note }, errors };
  }
  ```

  **La valeur vide doit être valide.** `lens_module_check` exécute `configure` avec l'environnement actuel de la lens (`process.env`, `src/main.js`), où la variable d'un module nouveau n'existe pas encore ; et *Activer* est un enregistrement comme les autres, qui exécute `configure` du module tout juste activé. Si le vide est une erreur, la vérification ne répond jamais « OK » et *Activer* avec le champ vide est refusé (400). Pour le vide utilisez une valeur par défaut, ou un état « non configuré » dans le module que la page explique : dans le module d'exemple vide = aucune note de bienvenue.

  Un réglage qui est un chemin : vide = un défaut construit à partir de `ctx.paths` (ou « non configuré ») ; s'il est rempli, n'acceptez que des chemins absolus. Un chemin qui n'existe pas, vous pouvez le dire dans `errors` (l'enregistrement est refusé avec le motif ; si le dossier disparaît plus tard, au redémarrage le module est « à configurer »), ou bien le sauter et le dire dans la page, comme le fait Security.
- **`files(ctx)`** : facultative, les fichiers que le module écrit, `[{ label, path, note?, kind? }]` (`label` et `note` avec `N_`). La lens les montre dans **Paramètres › Données et fichiers** et le script de désinstallation les efface. `kind` vaut `"write"` (par défaut : un fichier **dans le dossier des données**), `"dir"` (un dossier dans le dossier des données) ou `"read"` (n'importe quel chemin absolu que le module **lit seulement** : jamais effacé). Une entrée hors de ces règles, ou sur un fichier du cœur, est écartée avec un avertissement dans le log (`files()` de `ModuleRegistry`, `src/modules.js`). Avec des réglages non valides `files` n'est pas demandée.
- **`hasData(ctx)`** : facultative, `true` si le module a déjà des données enregistrées (elle décide l'avis « était utilisé » après une mise à jour). Si elle lève une exception, elle vaut `false`. Comme `files`, elle n'écrit rien : donc **elle n'appelle pas `read()` du store**, qui sur un fichier cassé en fait une copie `<nom>.bad.json` et écrit dans le log (`JsonStore` de `src/presets.js`). Elle prend seulement `path` du store (créer le store ne touche pas le disque) et lit le fichier elle-même, avec `fs.readFileSync` et `JSON.parse` dans un `try` (`false` s'il manque ou n'est pas valide), comme `hasData` de `modules/vibecoding/server/projects.js`.
- **`create(ctx)`** : appelée seulement pour un module activé et configuré. Elle renvoie **tout de suite** (jamais une promesse : c'est une erreur) un objet, tout facultatif : `routes` (voir [Routes GET et POST](#routes-get-et-post)), `start()` et `stop()` (asynchrones aussi), `families()` (métriques pour `/metrics`), `status()` et `state()` (blocs de `/api/status` et `/healthz`). Si `create` ou `start` lèvent une exception, le module passe en `error` et les autres continuent.

**Le `ctx`** de `create`, `files` et `hasData` (`moduleContext` de `src/module-kit.js`) est figé et c'est la seule porte vers la lens. Ce qu'il faut pour construire :

| Champ | |
|---|---|
| `ctx.id` | l'id du module |
| `ctx.settings` | les `values` de `configure` (figées) ; `{}` sans `configure` |
| `ctx.env`, `ctx.paths` | comme dans `configure` ; `ctx.paths` a `home`, `opencodeConfigDir`, `xdgData` et `dataDir` (le dossier de la base, `null` avec `:memory:`) |
| `ctx.i18n` | `t`, `N_`, `Localized`, `errorText` |
| `ctx.reply(statut, corps)` | une réponse avec un statut autre que 200 (statut de 200 à 599, corps un objet simple) |
| `ctx.range(searchParams, { earliest }?)` | la période `{ from, to }` d'une requête, comme la lisent les endpoints du cœur |
| `ctx.jsonStore({ name, validate, empty, what })` | un fichier JSON du module à côté de la base (voir [Persistance](#persistance)) |
| `ctx.reader` | `get(sql, …)` et `all(sql, …)` : lectures de la base de la lens, `SELECT` seulement |
| `ctx.writer` | seulement avec `tables` : écritures dans les tables du module |
| `ctx.live.changed(payload)` | prévient les dashboards ouverts : les widgets du module relisent leurs données |
| `ctx.meta` | `get(clé)` et `set(clé, valeur)` : petites valeurs du module dans la base (clés `module:<id>:data:…`) |
| `ctx.log` | `info`, `warn`, `error`, avec le préfixe `[<id>]` |
| `ctx.time`, `ctx.sql`, `ctx.budgets`, `ctx.tokensOf` | périodes, fragments SQL et budgets du cœur, pour lire les données d'OpenCode |
| `ctx.prices` | la liste de prix par modèle : `empty`, `of(modèle)` et `estimate(modèle, genres)` (voir [moduli.md](moduli.md#lentrée-node)) |

Absent : `process.env` (utilisez `ctx.env`), la base (utilisez `ctx.reader`/`ctx.writer`), la configuration du cœur, le token. **`ctx.store` n'est pas un endroit pour vos données** : il n'a que `counts()`, les compteurs de la lens. La liste complète, avec `readers`, `zip`, `skillLoads` et `collector`, est dans [moduli.md](moduli.md#lentrée-node).

**Les textes** que le code Node affiche passent par `const { t, N_ } = ctx.i18n` et par des appels **nus**, `t("…")` et `N_("…")` : jamais `ctx.i18n.t("…")`, que le scanner des traductions ne voit pas. Chaque texte a une entrée dans les catalogues du module.

## Routes GET et POST

`create(ctx)` renvoie `routes`, un objet `{ "<MÉTHODE> <chemin>": … }` (`routeError` et `#buildRoutes` de `src/modules.js`) :

| Clé | Valeur |
|---|---|
| `"GET /api/x"` | `(req, { url, local }) => réponse` ; répond aussi à `HEAD` |
| `"GET /api/x/*"` | comme ci-dessus, pour chaque chemin **sous** `/api/x/`, avec `rest` (le reste, déjà décodé) |
| `"POST /api/x"` | `{ handler, body: { type: "json", max }, what }` ; `handler(req, { url, local, body })` reçoit le JSON déjà lu |
| `"POST /api/x/*"` | comme ci-dessus, avec `rest` |

- **Le chemin** commence par `/api/`, n'a que des minuscules, chiffres, `/`, `_` et `-` (`[a-z0-9/_-]`, `ROUTE_KEY` de `src/modules.js`), et ne touche ni un chemin du cœur (listes *« Percorsi /api riservati »*, les chemins /api réservés, de `lens_module_guide`) ni la route d'un autre module : une telle route est écartée avec un avertissement dans le log, et le module reste activé. Utilisez `/api/<id>` et `/api/<id>/…`. `lens_module_check` ne voit pas les routes (elles naissent dans `create`) : les conflits n'apparaissent que dans le log au démarrage.
- **`url`** est une `URL` : les paramètres se lisent dans `url.searchParams`. **`local`** vaut `true` pour un client de cet ordinateur : un `GET` répond aussi depuis le réseau (avec le token), donc ne donnez pas au réseau ce qui ne vaut qu'en local. **`rest`** peut contenir `/` et `..` : ne l'utilisez jamais tel quel comme chemin de fichier ; il vaut `null` pour un encodage cassé.
- **Un `POST` déclare son corps** : `body: { type: "json", max }` avec `max` un entier en octets, de 1 à 16 Mio ; il n'existe pas d'autres types pour du JSON (pas de `empty` : un `POST` sans données envoie quand même un objet JSON, au moins `{}`). Avant le `handler` la lens applique les contrôles de toute écriture (depuis cet ordinateur seulement, `Origin`, `content-type: application/json`, token) et la limite `max`. `what` est obligatoire : ce qui est modifié, avec un `N_` nu, pour les messages de refus. Pour un corps non JSON (`type: "raw"`) voir [moduli.md](moduli.md#les-routes).
- **La réponse** : un objet simple est un `200` en JSON ; un autre statut est `return ctx.reply(400, { errors: [t("…")] })`. Toute autre chose, ou une exception, est un `500` générique avec l'erreur dans le log. La page lit les `errors` d'un refus (voir [Page du navigateur](#page-du-navigateur)).
- **Un handler peut être `async`** : la lens attend la promesse (`moduleAnswer` de `src/server.js`) et les règles de la réponse valent pour la valeur résolue ; une promesse rejetée est un `500`. Attendre un travail court et borné est permis ; un travail long, non (voir [Travail long](#travail-long)).
- **La période** : `ctx.range(url.searchParams, { earliest })` lit `?from=` et `?to=` comme le cœur : `from=day` est le jour de budget, `from=0` est « tout » (avec `earliest`, une fonction qui donne la donnée la plus ancienne du module en ms ou `null`, elle part de là), sinon des millisecondes. C'est ce qui arrive du `{from}` d'un widget.

Les routes du module d'exemple :

```js
"GET /api/mio-modulo": (_req, { url, local }) => {
  const all = notes.read().notes;
  const { from, to } = ctx.range(url.searchParams, { earliest: () => all[0]?.at ?? null });
  const inPeriod = all.filter((n) => n.at >= from && n.at <= to);
  return {
    note: ctx.settings.note ?? "",
    notes: [...all].reverse(),
    count: inPeriod.length,
    last: inPeriod.at(-1) ?? null,
    from,
    to,
    canSave: local,
  };
},
"POST /api/mio-modulo": {
  body: { type: "json", max: 4096 },
  what: N_("le note del modulo d'esempio"),
  handler: (_req, { body }) => {
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text === "" || text.length > MAX_TEXT) return ctx.reply(400, { errors: [t("La nota deve avere da 1 a {max} caratteri", { max: MAX_TEXT })] });
    const doc = notes.read();
    notes.write({ version: 1, notes: [...doc.notes, { text, at: Date.now() }].slice(-MAX_NOTES) });
    ctx.live.changed({ notes: Math.min(doc.notes.length + 1, MAX_NOTES) });
    return { ok: true };
  },
},
```

Vérifiez toujours le corps d'un `POST` champ par champ : il peut être `null`, une liste ou n'importe quoi.

## Persistance

Choisissez l'une des deux façons. Dans le doute, la première.

**`ctx.jsonStore` : un fichier JSON à côté de la base.** Pour de petits documents (réglages, notes, un historique court). `ctx.jsonStore({ name, validate, empty, what })` (`src/module-kit.js`, sur le `JsonStore` de `src/presets.js`) :

- `name` : un nom de fichier, `^[a-z0-9][a-z0-9._-]*\.json$`, sans dossiers, pas un fichier du cœur (sinon il lève `TypeError`). Utilisez `<id>.json`.
- `validate(doc)` : renvoie `{ ok: true, doc }` avec le document nettoyé ou `{ ok: false, errors }`. Le fichier peut être modifié à la main : vérifiez tout.
- `empty()` : le document quand il n'y a encore rien.
- `what` : `{ broken, none, dropped }`, les trois phrases italiennes avec lesquelles le log dit que le fichier ne convient pas (`<fichier> non è JSON valido: <broken>`, `<fichier> <none> (motifs): <dropped>`), accordées entre elles.
- Il donne `read()`, `write(doc)` (atomique : fichier temporaire puis renommage), `path` et `badFile`. Un fichier illisible donne `empty()`, un avertissement dans le log et une copie `<nom>.bad.json` qu'un enregistrement ne détruit pas : `read()` aussi peut écrire, c'est pourquoi `hasData` ne l'utilise pas (voir [Entrée Node et ctx](#entrée-node-et-ctx)). Avec `LENS_DB=:memory:` le document reste en mémoire jusqu'au redémarrage et `path` vaut `null`.
- `read()` et `write()` sont **synchrones et sans cache** : chaque `read()` relit et revalide le fichier. Gardez le document petit (le module d'exemple garde au plus 50 notes de 200 caractères) et ne les appelez pas dans une boucle.
- Créez le store **dans une variable du module**, dans `create` (et, pour `files`, avec la même fonction), et déclarez-le dans `files()` :

```js
const FILE = "mio-modulo.json";
const WHAT = { broken: "le note sono ignorate", none: "non contiene note valide", dropped: "sono ignorate" };
const notesStore = (ctx) => ctx.jsonStore({ name: FILE, validate, empty, what: WHAT });

export function files(ctx) {
  const { N_ } = ctx.i18n;
  const store = notesStore(ctx);
  if (!store.path) return [];
  return [
    { label: N_("Note del mio modulo"), path: store.path, note: N_("le note scritte nella pagina del modulo d'esempio") },
    { label: N_("Note del mio modulo (file non valido)"), path: store.badFile, note: N_("copia di mio-modulo.json fatta quando non era leggibile, prima che un salvataggio lo sostituisse") },
  ];
}
```

**`tables` + `ctx.writer` : des tables dans la base de la lens.** Pour beaucoup de lignes, des requêtes par période, des données qui grandissent. Le manifeste a `tables: () => import("./tables.js")` ; `tables.js`, sans import, exporte `{ version, sql, columns? }` avec seulement `CREATE TABLE IF NOT EXISTS <id>_…` et `CREATE [UNIQUE] INDEX IF NOT EXISTS <id>_… ON <id>_…`. **Un module avec des tables a un id fait seulement de minuscules et de chiffres** (`^[a-z][a-z0-9]*$`), parce que `<id>_` est le préfixe des noms SQL : avec l'id `mio-modulo` les tables sont refusées. Elles sont contrôlées par `src/module-tables.js` ; les règles complètes sont dans [Les tables d'un module](moduli.md#les-tables-dun-module). On écrit avec `ctx.writer.statement(sql).run(…)` et `ctx.writer.tx(fn)` (fn synchrone) : seulement `INSERT` et `UPDATE` sur ses propres tables, jamais `DELETE` ni `REPLACE` ([Écrire dans ses propres tables](moduli.md#écrire-dans-ses-propres-tables)). Les tables ne sont jamais effacées, pas même en désactivant le module.

**Lire la base** (les données d'OpenCode aussi) : `ctx.reader.get(sql, …valeurs)` et `ctx.reader.all(sql, …valeurs)`, seulement `SELECT` et `WITH … SELECT`, une seule instruction. Dans le texte SQL **seulement des constantes** : les valeurs passent en paramètres `?`, les listes en un seul paramètre JSON (`IN (SELECT value FROM json_each(?))`). Au plus 256 textes SQL différents par module. Les règles sont dans [Lire la base](moduli.md#lire-la-base--ctxreader).

**Jamais** : `ctx.store` pour vos données, des fichiers écrits hors du dossier des données sans les déclarer, `node:sqlite` ouvert à la main sur la base de la lens.

## Page du navigateur

La page est le fichier `public/page.js` plus `public/page.html` (et, si besoin, `public/style.css`). La lens les charge seulement pour un module activé (`loadModulePage` de `public/app.js`, `src/module-html.js`).

- **`page.js`** exporte `title` (le titre, `t("…")`) et `page`, une page du director (`createDirector` de `public/kit.js`) : `{ id, refreshMs?, setup?(ctx), show?(ctx), refresh?(ctx), hide?(ctx) }`. `page.id` est l'id du module, sinon la page ne se charge pas. `setup` tourne une fois et reçoit `report(err)`, qui affiche une erreur dans le bandeau ; `show` tourne quand la page s'ouvre ; `refresh` toutes les `refreshMs` tant qu'elle est à l'écran.
- **`page.html`** est une `<section class="page-view hidden" id="view-<id>">`. Ni attributs `style` ni `<script>` : la CSP de la page les bloque. Les textes sont italiens avec `data-i18n` (ou `data-i18n-placeholder`, `data-i18n-aria-label`). Les ids HTML sont partagés avec tout le dashboard : donnez-leur un préfixe (le module d'exemple utilise `mm-`). Dans la barre de titre (ci-dessous), `data-ico="<id>"` copie l'icône du menu.
- **N'importez de la lens que `"/module-kit.js"`** (`public/module-kit.js`) : `t`, `tn`, `N_`, `el`, `$`, `get`, `send`, `table`, `stateBox`, les formateurs (`fmtDateTime`, `nf`, `money`, `dur`…), les aides pour les petits graphiques (ci-dessous) et quelques autres. Le reste avec des chemins relatifs, dans `public/`.
- **Les petits graphiques** (`public/spark.js` et `public/ui.js`, depuis le kit), chacun renvoie un élément à mettre dans le DOM :
  - `barSpark(valeurs, série, { highlightLast, title, label })` : un `<svg class="spark">` à barres (`viewBox` 120×30). `série` est la couleur, de `1` à `7` ou `"other"` ; les `highlightLast` dernières barres (7 par défaut) sont pleines, les autres atténuées ; `title(valeur, indice)` donne le texte au survol ; `label` est l'`aria-label`.
  - `sparkSvg(w, h, label)` : un `<svg class="spark">` vide, sur lequel dessiner avec `svg(tag, attributs)` (un élément SVG avec ces attributs).
  - `ring(rapport, étiquette, { size, stroke, title })` : un anneau rempli jusqu'à `rapport` (au plus 1), avec `étiquette` au milieu ; vert, ambre au-delà de 0,85, rouge au-delà de 1.
  - `facts(box, [[étiquette, valeur, mono], …])` : remplit une bande de faits (`box` est un id ou un élément ; les entrées `null` ou `false` sont sautées, une valeur absente est « – », `mono` l'écrit en chasse fixe). `ago(ms)` : le temps écoulé, « il y a 5 min » (« jamais » sans date).
  - `barSpark`, `sparkSvg`, `ring` et `svg` utilisent `document.createElementNS` : le faux DOM des tests du module doit l'avoir. Celui du module d'exemple n'a que `createElement` et `createTextNode` : ajoutez-le avant de tester un widget ou une page qui dessine un graphique.

**La barre de titre** de `page.html`, avec une action et une bande de faits (comme dans `modules/skill/public/page.html`) :

```html
<header class="topbar">
  <div class="tb-row">
    <div class="slot s-ident">
      <span class="tb-ico" data-ico="mio-modulo" aria-hidden="true"></span>
      <div class="tb-title">
        <h1 id="mm-title" data-i18n>Il mio modulo</h1>
        <p class="ctx" data-i18n>Un blocco di note, per vedere come è fatto un modulo</p>
      </div>
    </div>
    <span class="spacer"></span>
    <div class="slot s-actions">
      <button class="primary" type="button" id="mm-scan" data-i18n>Scansiona</button>
      <button class="ghost" type="button" id="mm-export" data-i18n>Esporta…</button>
    </div>
    <div class="slot s-action"></div>
  </div>
</header>
<div class="view-body">
  <div class="facts" id="mm-facts"></div>
  …
</div>
```

Les boutons d'action vont dans le slot `s-actions` : `primary` pour l'action principale, `ghost` pour les autres. La bande de faits est un `<div class="facts">` que `page.js` remplit avec `facts("mm-facts", [[t("Ultima scansione"), ago(d.at)], [t("Cartella"), d.dir, true]])`. `mm-scan`, `mm-export` et `mm-facts` sont des exemples : le module d'exemple ne les a pas.
- **Lisez avec `get(chemin)` et écrivez avec `send(chemin, corps)`**, jamais avec un `fetch` brut : ils envoient la langue, `get` a un délai maximal de 30 secondes, et ils lèvent une exception sur un statut d'erreur. `send` lève une `Error` avec `errors`, les textes du refus du serveur.
- **Jamais `innerHTML` avec des données** : ce qui vient du serveur ou d'un fichier entre dans le DOM avec `el(tag, { text })` ou `textContent`.
- **Pas de travail à l'import** (ni DOM ni minuteries) : les tests importent la page sans DOM.
- **Une écriture à la fois** : désactivez le champ et le bouton pendant que `send` est en cours, et ne laissez pas un `refresh` arrivé entre-temps les réactiver (le module d'exemple garde un drapeau `saving`).

Le cœur de `page.js` du module d'exemple :

```js
import { $, el, fmtDateTime, get, send, stateBox, t, table } from "/module-kit.js";

const API = "/api/mio-modulo";
export const title = t("Il mio modulo");

function draw(d) {
  $("mm-welcome").textContent = d.note || t("Nessuna nota di benvenuto: scrivila da Impostazioni › Moduli.");
  $("mm-list").replaceChildren(
    d.notes.length
      ? table([t("Quando"), t("Nota")], d.notes.map((n) => el("tr", {}, el("td", { text: fmtDateTime(n.at) }), el("td", { class: "key", text: n.text }))))
      : stateBox("empty", t("Nessuna nota ancora: scrivine una qui sopra.")),
  );
}

async function refresh() {
  draw(await get(API));
}

export const page = { id: "mio-modulo", refreshMs: 30_000, setup, show: refresh, refresh };
```

**Les catalogues.** `public/lang-en.js` et `public/lang-fr.js` exportent par défaut un objet `{ "texte italien": "traduction" }`, avec les mêmes clés ; un pluriel (`tn`) a la clé de la forme « plusieurs » et la valeur `{ one, other }`. La clé est le texte italien exact de `t("…")`, `N_("…")`, `Localized("…")`, `data-i18n` et des textes du manifeste. Un texte que le cœur traduit déjà (`Salva`, `Annulla`…) n'est pas nécessaire : dans les tests, `catalogs({ en, fr })` du test kit donne les catalogues du cœur avec ceux du module, comme le dashboard les charge (le test « lang-en.js e lang-fr.js » du module d'exemple les utilise ainsi). Les règles sont dans [traduzioni.md](traduzioni.md).

## Widgets du dashboard

Un widget du module apparaît dans **Personnaliser › Ajouter** à côté de ceux du cœur, se déplace, se redimensionne et a son ⚙. Le manifeste a `widgets` et `widgetsFile`, jugés par `widgetFieldsError` de `src/module-widget-fields.js`.

**Chaque entrée de `widgets` :**

- `type` : `<id>-<nom>` (`mio-modulo-conteggio`), en entier dans `^[a-z][a-z0-9-]*$`, 31 caractères au plus ; pas un type du cœur ni d'un autre module (liste *« Tipi di widget già presi »*, les types de widget déjà pris), sans répétition.
- `label` et `description` : textes italiens non vides, avec une entrée dans les catalogues.
- `size` et `min` : `[largeur, hauteur]` entiers, largeur de 1 à 12 colonnes, hauteur de 1 à 40 lignes, `min` jamais plus grand que `size`.
- `home` : où l'éditeur le propose, `"adesso"`, `"analisi"` ou `"both"`. Jamais dans la vue Monitor.
- `settings` (facultatif) : les choix du ⚙. `title: null` rend le titre modifiable. `range` propose les périodes du dashboard, seulement parmi `"dashboard"` (suit la vue), `"day"`, `"3600000"`, `"28800000"`, `"86400000"`, `"604800000"`, `"2592000000"` et `"0"` (« tout »). Toute autre clé est à vous : elle commence par une minuscule, lettres et chiffres seulement, et n'est pas une clé des widgets du cœur (`metric`, `by`, `source`, `model`, `sort`, `style`…) ; la valeur est une liste de 1 à 20 textes distincts non vides, sans `"dashboard"`. Le ⚙ affiche la clé comme `t(clé)` et chaque valeur comme `t(valeur)` : écrivez clé et valeurs comme des mots italiens et mettez-les dans les catalogues.
- `data` : de 1 à 4 chemins que le widget lit, chacun une route `GET` **du module lui-même** (la requête à part), qui commence par `/api/`, sans `..`, `#`, espaces ni `%2e`/`%2f`/`%5c`, avec au plus un marqueur `{from}` et aucune autre accolade. `{from}` est facultatif : si le widget a une période, mettez-le dans la requête, `"/api/mio-modulo?from={from}"` ; un widget sans période lit `"/api/<id>"` et ne propose pas `range`.

**Les limites**, les mêmes que `lens_module_guide` donne dans *« Limiti dei widget »*, les limites des widgets (`WIDGET_LIMITS` de `src/module-widget-fields.js`, `widgetLimits` de `GET /api/modules/authoring`) :

| Limite | Valeur | |
|---|---|---|
| `maxWidgets` | 12 | entrées de `widgets` |
| `maxDataPaths` | 4 | chemins de `data` par widget |
| `maxValues` | 20 | valeurs d'une clé de `settings` |
| `maxWidth` | 12 | largeur de `size` et `min`, en colonnes |
| `maxHeight` | 40 | hauteur de `size` et `min`, en lignes |
| `maxTypeLength` | 31 | caractères de `type` |
| `fromPlaceholder` | `{from}` | le seul marqueur de `data` |
| `homes` | `adesso`, `analisi`, `both` | les valeurs de `home` |

**`{from}`** devient le début de la période du widget : `day` pour le jour de budget, sinon des millisecondes, `0` pour « tout ». La période est celle du ⚙ ou, avec `dashboard`, celle de la vue. La route la lit avec `ctx.range` (voir [Routes GET et POST](#routes-get-et-post)). Au démarrage un widget avec un chemin qui n'est pas une route `GET` du module est écarté, et à sa place le dashboard dit quel chemin ne va pas ; `lens_module_check` ne le voit pas.

**Le fichier des widgets** (`widgetsFile`) exporte par défaut un objet avec un dessinateur par type, `export default { "<type>": { mount, update, resize? } }`, et n'importe de la lens que `"/module-kit.js"` :

```js
import { el, full, tn, t } from "/module-kit.js";

const DATA = "/api/mio-modulo?from={from}";

const conteggio = {
  mount(root, ctx) {
    root.replaceChildren(
      el("div", { class: "card-head" }, el("div", { class: "head-text" }, el("h2", {}, el("span", { "data-part": "title", text: ctx.title })))),
      el("div", { class: "kpi-main" }, el("span", { class: "kpi-value", "data-part": "value", text: "–" })),
      el("div", { class: "kpi-label", "data-part": "label" }),
      el("div", { class: "kpi-note", "data-part": "note" }),
    );
  },
  update(root, ctx) {
    const d = ctx.data(DATA);
    const count = d?.count ?? 0;
    root.querySelector('[data-part="value"]').textContent = full(count);
    root.querySelector('[data-part="label"]').textContent = tn(count, "nota nel periodo", "note nel periodo");
    root.querySelector('[data-part="note"]').textContent = d?.last?.text ?? t("Nessuna nota nel periodo");
  },
};

export default { "mio-modulo-conteggio": conteggio };
```

- **`mount(root, ctx)`** tourne une fois, sur une carte vide : il construit le balisage. Dessinez un élément avec `data-part="title"` : le dashboard en réécrit le texte quand le titre change.
- **`update(root, ctx)`** tourne à chaque actualisation du dashboard, quand tous les chemins de `data` sont arrivés.
- **`resize`** est facultatif : s'il est là (une fonction), le dashboard observe la taille de la carte et, quand elle change, rappelle `update`. La fonction elle-même n'est pas appelée.
- **Le `ctx` du widget** (`widgetContext` de `public/module-widgets.js`) est figé et n'a que `{ widget, title, settings, data, inst }` : `widget` est le widget enregistré (`id`, `type`, position, `settings`) ; `title` le titre déjà décidé (celui de l'utilisateur ou le `label`) ; `settings` les choix du ⚙ plus `range`, `metric` et `by` déjà résolus, avec ceux de la vue quand le widget la suit (`range` vaut `"day"` ou des millisecondes, `0` = « tout ») ; une clé à vous jamais choisie vaut `undefined`, et c'est le code qui choisit la valeur par défaut (`ctx.settings.modo ?? "primo"`) ; `data(chemin)` le JSON d'un chemin de `data`, écrit **comme dans le manifeste** (avec `{from}`), `undefined` pour tout autre ; `inst` un objet à vous qui dure autant que la carte, pour garder un état.
- **Ne modifiez pas** `ctx.settings`, `ctx.widget` ni les données : le gel n'a qu'un niveau et les objets sont partagés avec les autres cartes.
- **Ni minuteries ni lectures à vous** (`setInterval`, `setTimeout`, `fetch`) : le dashboard lit les données et appelle `update`. Pour actualiser les widgets juste après une écriture, la route appelle `ctx.live.changed(…)`.
- **Jamais `innerHTML` avec des données** : `el(…, { text })` ou `textContent`. Utilisez les classes du cœur (`card-head`, `kpi-value`…) et les jetons de couleur (`--border`, `--text-primary`…).

**Quand il ne se dessine pas** (`public/module-widgets.js`, `public/dashboard-grid.js`) :

- Le fichier des widgets se charge seulement pour un module activé, en **5 secondes** au plus (`LOAD_TIMEOUT_MS`) : une erreur de syntaxe, un 404, un retard ou un type sans `mount` et `update` laissent « Widget du module {name} non chargé » dans ses cartes, avec l'erreur dans la console. Le dashboard et les autres modules continuent.
- Un `mount` ou un `update` qui lève une exception affiche « Données indisponibles » dans cette carte, avec le message dans l'infobulle ; après un `mount` raté, rechargez la page.
- Avec le module désactivé, en erreur ou à configurer, le widget **reste dans la disposition enregistrée** et à sa place dit « Le module {name} est désactivé : activez-le depuis Paramètres › Modules », « Le module {name} est en erreur : voir Paramètres › Modules » ou « Le module {name} est à configurer : voir Paramètres › Modules », sans requêtes. Réactivé, il revient tel qu'il était. Il en va de même pour un module dont le manifeste ne se charge pas (un `widgets` erroné, un `lens` plus récent que la lens en marche, un `module.js` qui lève une erreur) : il n'y a pas de manifeste où lire le nom, et à la place de `{name}` figure l'id du module.
- Dans la disposition les widgets des modules sont des **obstacles fixes** : ceux du cœur s'écoulent autour, « Compacter » ne les fait pas monter ; ils ne se déplacent qu'à la main.

## MCP du module

Facultatif. Un module peut offrir des outils au serveur MCP de la lens, qu'OpenCode montre avec le préfixe `lens_` (l'outil `note` deviendrait `lens_note`). Les règles : `src/module-mcp-fields.js` et `src/mcp/modules.js` ; les détails dans [Les outils MCP d'un module](moduli.md#les-outils-mcp-dun-module).

- Le manifeste déclare `mcp: () => import("./mcp/tools.js")` et `mcpTools: ["<nom>"]` ; un nom déjà pris (liste *« Nomi di strumenti MCP già presi »*, les noms d'outils MCP déjà pris, `module_guide` et `module_check` compris) est écarté, et `lens_module_check` le signale comme une erreur.
- `mcp/tools.js` **n'importe rien** : il exporte `tools(kit)`, qui renvoie `[{ name, title, description, inputSchema, run(args, ctx) }]`. Tout arrive par `kit` (`createToolKit` de `src/mcp/module-kit.js`) : `argSpec`, `withLens`, `ToolError`, `LensError`, `SINCE`, `now`, `text` (`cleanName`, `cleanText`, `num`, `plural`…).
- **`kit.argSpec({ … })`** donne `{ inputSchema, parse(args) }`. Chaque argument a `description` et l'un de `enum: [...]`, `int: [min, max]`, `bool: true` ou rien (un texte non vide) ; en plus `default`, `required: true` (absent → erreur), et pour un texte `pattern` (une expression régulière, en texte) avec `hint` (la phrase que l'erreur affiche à la place de l'expression). `parse` refuse les arguments inconnus.
- L'outil parle à la lens **seulement en HTTP**, avec les routes du module : `return withLens(signal, async (lens) => { const d = await lens.get("/api/mio-modulo", {}, signal); return "…"; })`. Les textes qui arrivent au modèle sont en italien et ne se traduisent pas.
- **OpenCode ne relit pas la liste des outils** : un outil nouveau, ou d'un module tout juste activé, n'apparaît qu'après un **redémarrage d'OpenCode**. Un outil d'un module désactivé répond *« Il modulo … è spento in Lens »*, le module … est désactivé dans Lens.

## Travail long

- **Ne bloquez jamais le processus** : la lens sert le dashboard et le MCP depuis le même thread. Une lecture de nombreux fichiers, un parcours de dossiers, un calcul long se font par morceaux, avec des API asynchrones (`node:fs/promises`) et des pauses (`await new Promise((r) => setImmediate(r))`) entre un morceau et le suivant.
- **Mettez des limites** à tout ce qui est lu de l'extérieur : nombre de fichiers, taille d'un fichier, profondeur, temps total. Au-delà de la limite arrêtez-vous et dites-le (un champ dans la réponse, un avertissement dans le log), ne continuez pas.
- **`start()` a 10 secondes** (`START_TIMEOUT_MS` de `src/modules.js`) : un `start()` asynchrone qui ne finit pas à temps envoie le module en `error`, et la lens appelle `stop()`. Le délai n'arrête pas du code synchrone. Le travail lourd se planifie (`setTimeout(…, 0)`) et `start()` revient tout de suite.
- **Un travail périodique** démarre dans `start()` (un `setInterval`) et s'arrête dans `stop()` (`clearInterval`) : `stop()` est appelée quand la lens s'arrête et redémarre. Après avoir mis à jour les données, `ctx.live.changed(…)` fait relire les widgets à l'écran.
- **`stop()` ferme tout ce que le module a ouvert**, dans `start()` ou dans une route : chaque minuterie, watcher, abonnement ou socket, et le travail lancé par une requête (un parcours démarré par un `POST`). La lens appelle `stop()` pour chaque module activé quand elle s'arrête et redémarre, même s'il n'a pas de `start()` (`stop()` de `ModuleRegistry`, `src/modules.js`). Elle n'efface ni ne tronque jamais les données du module : désactiver un module n'est pas le désinstaller. Les routes et `families()` n'existent que tant que le module est activé.
- **Une route n'attend pas un travail long** : elle répond avec le dernier résultat prêt, ou lance le travail et répond tout de suite, et un `GET` suivant en lit l'avancement. Elle peut attendre (`await`) un travail borné qui ne bloque pas : un parcours limité à quelques secondes, par morceaux avec `setImmediate`, bien en dessous des 30 secondes après lesquelles `get` de la page abandonne.
- **Les métriques** (`families()`) sont une lecture rapide de ce que le module a déjà : `[{ name, type: "gauge", help, samples: [{ labels, value }] }]`, avec `name` `opencode_lens_<id avec _>_…` et des étiquettes aux valeurs bornées (comme `modules/security/server/audit.js`). Une métrique sans étiquettes a `labels: {}` (comme `opencode_lens_bob_up` de `modules/bob/server/source.js`).

## Vérification

Après chaque modification, dans cet ordre.

1. **`lens_module_check` avec `id`** (`POST /api/modules/check`, `checkUserModule` de `src/modules.js`). Il juge le module du dossier de l'utilisateur comme au démarrage, sans l'activer : manifeste, widgets, tables, `configure` avec l'environnement actuel de la lens (où la variable d'un module nouveau n'existe pas encore : le vide doit être valide), noms déjà pris. Il marche aussi sur un module que la lens n'a pas encore découvert, et relit `module.js`, `tables.js` (si le manifeste a `tables`) et `server/index.js` à chaque appel ; les autres fichiers que `server/index.js` importe restent ceux chargés la première fois, jusqu'au redémarrage de la lens. **Ce n'est pas une lecture** : il exécute le code de premier niveau de ces fichiers, et `configure()`, dans le processus de la lens (c'est pourquoi `server/index.js` ne doit pas avoir d'effets à l'import). Il répond « OK » ou les erreurs : corrigez et rappelez jusqu'à « OK ». Les **avertissements** sous un « OK » sont des rappels, pas des erreurs : que le code s'exécute à chaque contrôle, que les routes et les chemins `data` des widgets ne se vérifient qu'au démarrage, que le module n'est pas encore parmi ceux découverts (redémarrez la lens) ou qu'il est déjà chargé (les modifications s'appliquent après un redémarrage de la lens), que `widgetsFile` manque dans `public/`, qu'un type de widget commence par l'id d'un autre module, qu'une variable, un type de widget ou un outil MCP du module appartient déjà à un module qui vient après lui par id (au redémarrage ce module passerait en erreur, ou perdrait l'outil). Les trois derniers sont à résoudre.
2. **Redémarrez la lens** (`opencode-lens service restart`), qui ne découvre les modules qu'au démarrage. Le log (`~/Library/Logs/opencode-lens/lens.log` sous macOS) dit les routes et les widgets écartés.
3. **Paramètres › Modules** › la carte du module (étiquette « personnel » et le dossier) › *Activer* : la lens redémarre avec le module activé. Si `configure` refuse la valeur des champs (vides aussi), *Activer* ne s'enregistre pas et la page affiche les erreurs. Si l'état est `error` ou `unconfigured`, la carte dit pourquoi. Vérifiez l'entrée de menu, la page, le widget dans **Personnaliser › Ajouter** et, s'il y en a, les outils MCP après un redémarrage d'OpenCode.
4. **Les tests du module**, dans son dossier `test/` (le module d'exemple en a un complet : `test/template.test.js`). Ils n'importent de la lens que `"/module-test-kit.js"` (et `"/module-kit.js"` pour le code du navigateur), que résout `test/module-hooks.mjs` de l'app :

   ```bash
   # <app> est ~/Applications/opencode-lens (ou une copie du dépôt de la lens)
   node --disable-warning=ExperimentalWarning --import <app>/test/module-hooks.mjs --test "<dossier des modules>/mio-modulo/test/"*.test.js
   ```

   Le test kit demande Node 22.13 ou plus récent, comme la lens. Si c'est `install.sh` qui a téléchargé Node, utilisez `~/Applications/opencode-lens/node/bin/node` à la place de `node`.

   `"/module-test-kit.js"` donne `memoryStore()` et `moduleContext(…)` (un vrai `ctx` sur une base en mémoire), `Queries`, `createToolKit` et `createHandler` pour les outils MCP, `widgetContext(spec, ctx)`, le `ctx` figé que le dashboard passe à `mount` et `update`, et `catalogs({ en, fr })`, les catalogues du cœur avec ceux du module. La liste complète est dans [Essayer un module](moduli.md#essayer-un-module). Testez au moins : le manifeste, `configure` (valeur vide, valide, erronée), chaque route (les refus d'un `POST` aussi), le fichier JSON (illisible → vide), le widget avec `widgetContext`, la page, les catalogues (chaque texte traduit, par le module ou par le cœur ; aucune entrée orpheline) et les imports.

   Le test kit ne donne pas le `ctx` de `configure` (`{ id, env, paths, i18n }`) : construisez-le avec `paths` et `i18n` d'un `ctx` de `moduleContext`, comme le module d'exemple (son `setup()` fait le `ctx` avec `moduleContext`) :

   ```js
   const { ctx } = setup();
   const given = (env) => configure({ id: ID, env, paths: ctx.paths, i18n: ctx.i18n });
   assert.deepEqual(given({}), { values: { note: "" }, errors: [] });
   ```

## Mettre à jour un module

- **Sur le même ordinateur**, vous modifiez les fichiers dans le dossier des modules de l'utilisateur et refaites la [Vérification](#vérification) : `lens_module_check`, redémarrage, tests.
- **Depuis un zip** (un module écrit ailleurs, ou la nouvelle version d'un module que vous avez déjà) : compressez le dossier du module, pas son contenu, pour que le zip contienne `<id>/module.js` ; plusieurs modules vont dans le même zip, un dossier chacun, aucun fichier à la racine. Chargez-le dans **Paramètres › Mise à jour** (`src/module-update.js`) ; `LENS_TOKEN` doit être défini, sinon la lens répond 403.
- **L'aperçu** n'exécute rien du module : il dit seulement s'il est nouveau ou s'il remplace celui qui est installé, et avertit que c'est du code non signé. Un id d'un module de la lens est refusé.
- **Installer**, après la confirmation, juge d'abord chaque module avec la même vérification que `lens_module_check` (il exécute donc son code de premier niveau et `configure()`). Un module avec des erreurs bloque tout le zip, rien n'est installé et la section montre les erreurs de chaque module : corrigez-les et chargez à nouveau le zip. Faites passer `lens_module_check` avant de compresser.
- **Puis** il met l'ancien dossier dans `<dossier des modules>/.backup/<id>-<date>/` et le nouveau à sa place avec un `rename` : jamais un module à moitié, et tout ou rien (si un échange échoue, les modules déjà remplacés reviennent comme avant). Si le module était un lien symbolique vers une copie de travail, c'est le lien qui va dans `.backup/` et la copie de travail reste telle quelle, mais dès lors le module n'est plus un lien. Les fichiers du module dans le dossier des données (`files()`, `ctx.jsonStore`, les tables) ne sont pas touchés.
- **Enfin** la lens redémarre seule si elle tourne comme service, sinon redémarrez-la vous-même. Un module déjà activé le reste ; un nouveau s'active depuis **Paramètres › Modules**. Les outils MCP modifiés apparaissent après un redémarrage d'OpenCode.

## Checklist

- [ ] Le dossier est `<dossier des modules de l'utilisateur>/<id>/`, pas dans `~/Applications/opencode-lens`.
- [ ] L'id est le même dans le dossier, `id`, `page.id`, `view-<id>`, le préfixe des chemins `/api/<id>` et des types de widget ; il n'est ni déjà pris ni réservé.
- [ ] `module.js` n'a pas d'import ; `server/index.js` ne fait rien à l'import et exporte `create`.
- [ ] `lens` est la version que donne `lens_module_guide`, pas une plus récente.
- [ ] Chaque réglage a `LENS_<ID>_…`, `label`, `help`, `kind`, et il est lu par `configure`, qui renvoie `{ values, errors }` et accepte la valeur vide.
- [ ] Chaque fichier écrit est déclaré dans `files()` ; les chemins seulement lus ont `kind: "read"`.
- [ ] Les données sont dans `ctx.jsonStore` ou dans `tables`, jamais dans `ctx.store` ; avec `tables` l'id n'a que des minuscules et des chiffres.
- [ ] Chaque `POST` a `body: { type: "json", max }` et `what` avec `N_` ; chaque refus passe par `ctx.reply`.
- [ ] Le navigateur n'importe que `"/module-kit.js"`, lit avec `get`, écrit avec `send`, met les données avec `text`/`textContent`.
- [ ] Chaque widget ne lit que des routes `GET` du module, a `data-part="title"`, aucune minuterie, et ne modifie pas le `ctx`.
- [ ] Chaque texte italien a son entrée dans `lang-en.js` et `lang-fr.js`, avec les mêmes clés.
- [ ] Aucun travail long ne bloque le processus ; chaque lecture de l'extérieur a des limites.
- [ ] `lens_module_check` dit OK ; après le redémarrage et *Activer* l'état est `on` ; les tests du module passent.

## Erreurs typiques

Les erreurs que fait qui écrit un module en lisant seulement la documentation, et la correction.

1. **Le module dans le dossier de l'app** (`~/Applications/opencode-lens/modules/`) : il disparaît à la première mise à jour. Il va dans le dossier des modules de l'utilisateur (voir [Où enregistrer le module](#où-enregistrer-le-module)).
2. **Un réglage lu dans `process.env`, ou sans `configure`** : `ctx.settings` reste `{}` et la variable n'arrive jamais. Déclarez la variable dans `settings` (`kind: "text"` pour une liste de chemins, séparés par `:`), lisez-la dans `configure(ctx)` depuis `ctx.env`, acceptez la valeur vide (un défaut ou « non configuré » : sinon `lens_module_check` ne dit jamais « OK » et *Activer* est refusé), pour le reste seulement des valeurs valides (pour les chemins : absolus), et renvoyez `{ values, errors }`.
3. **Les données dans `ctx.store`** : ce sont les compteurs de la lens, pas un dépôt. Utilisez `ctx.jsonStore({ name, validate, empty, what })` dans une variable du module et déclarez le fichier dans `files()`, avec les dossiers que le module lit seulement (`kind: "read"`).
4. **Un `POST` sans corps déclaré, ou avec un type inventé** (`body: { type: "empty" }`) : la route est écartée. Il faut `body: { type: "json", max }` et une `what` avec un `N_` nu.
5. **La page avec un `fetch` brut, `innerHTML` ou des imports de la lens hors du kit** : utilisez `page` et `title`, seulement `"/module-kit.js"` (`get`, `send`, `el`, `table`…), et le texte des données comme texte.
6. **Un parcours sans limites, dans le thread de la lens** : le dashboard se fige. Mettez des limites au nombre et à la taille des fichiers et au temps, et travaillez par morceaux sans bloquer (voir [Travail long](#travail-long)).
7. **`families()` avec une forme inventée** : les métriques sont `[{ name, type, help, samples: [{ labels, value }] }]`, comme dans `modules/security/server/audit.js`.
8. **Un widget qui lit autre chose que ses propres routes, ou qui s'actualise tout seul** : `data` liste des routes `GET` du module lui-même, avec `{from}` dans la requête si le widget a une période ; `update` dessine ce que le dashboard a lu, sans minuteries.
9. **Pas de tests, ou des tests qui importent la lens par chemin** : les tests importent `"/module-test-kit.js"` et tournent avec `--import <app>/test/module-hooks.mjs` (voir [Vérification](#vérification)).

Autres erreurs fréquentes : un `create` `async` (il renvoie une promesse : `error`) ; un `widgetsFile` qui n'est pas dans `public/` ; un type de widget sans le préfixe `<id>-` ; une clé du ⚙ qui est une clé du cœur (`metric`, `by`…) ; `t` appelé comme `ctx.i18n.t("…")` (le texte reste sans traduction) ; un `ctx.data` demandé avec le chemin résolu autrement que dans le manifeste.
