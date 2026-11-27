#!/usr/bin/env bash
# Crea il pacchetto installabile di opencode-lens.
#   scripts/package.sh       → test + dist/opencode-lens-<versione>.zip
#   npm run package          → stessa cosa
# Lo zip contiene una cartella opencode-lens/ pronta per `bash install.sh`.
#
# Il contenuto viene da git (`git archive HEAD`), non dall'albero di lavoro: file
# non tracciati o ignorati (un .db di prova, appunti in docs/, un .env) non
# finiscono mai nello zip. Se i file da impacchettare hanno modifiche non
# committate lo script si ferma: i test girano sull'albero di lavoro e lo zip
# deve contenere esattamente il codice provato.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$HERE"

VERSION="$(node -p 'require("./package.json").version')"
NAME="opencode-lens-$VERSION"
OUT="$HERE/dist/$NAME.zip"
FILES=(LICENSE README.md README.en.md README.fr.md CHANGELOG.md CHANGELOG.en.md CHANGELOG.fr.md package.json install.sh uninstall.sh src public modules scripts/verify.mjs docs extras test/module-test-kit.js test/module-hooks.mjs test/helpers.js test/query-plan-check.js)

[[ "$(git rev-parse --show-toplevel 2>/dev/null)" == "$HERE" ]] || {
  echo "$HERE non è la radice di un repository git: il pacchetto si crea dai file tracciati." >&2
  exit 1
}
for f in "${FILES[@]}"; do
  git cat-file -e "HEAD:$f" 2>/dev/null || { echo "Manca $f nel commit HEAD: pacchetto non creato." >&2; exit 1; }
done
if ! git diff --quiet HEAD -- "${FILES[@]}"; then
  echo "Modifiche non committate in:" >&2
  git diff --name-only HEAD -- "${FILES[@]}" >&2
  echo "Fai commit (o annullale) prima di creare il pacchetto." >&2
  exit 1
fi

echo "Test…"
# la chiave privata serve solo alla firma: i test (e gli script che lanciano) non la vedono
env -u LENS_RELEASE_KEY -u LENS_RELEASE_KEY_FILE -u LENS_REQUIRE_SIGNATURE npm test --silent

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/opencode-lens"
git archive --format=tar HEAD -- "${FILES[@]}" | tar -x -C "$WORK/opencode-lens"
# I mockup sono un riferimento di design, non fanno parte dell'app: restano fuori dallo zip.
rm -rf "$WORK/opencode-lens/docs/mockups"
# Nemmeno i test dei moduli: girano dal repository, l'app installata non li usa.
# test/ invece viaggia con l'app, ma solo con il test kit dei moduli (i quattro file
# di FILES: module-test-kit.js, module-hooks.mjs, helpers.js, query-plan-check.js),
# con cui girano i test dei moduli dell'utente.
rm -rf "$WORK/opencode-lens"/modules/*/test

# Firma dei file (src/signature.js): dalla dashboard si installano solo release firmate.
# La chiave privata arriva da LENS_RELEASE_KEY (il secret del workflow) o LENS_RELEASE_KEY_FILE.
SIGNED=0
if [[ -n "${LENS_RELEASE_KEY:-}${LENS_RELEASE_KEY_FILE:-}" ]]; then
  node scripts/sign-release.mjs sign "$WORK/opencode-lens"
  SIGNED=1
elif [[ "${LENS_REQUIRE_SIGNATURE:-0}" == "1" ]]; then
  echo "LENS_REQUIRE_SIGNATURE=1 ma manca la chiave: imposta LENS_RELEASE_KEY o LENS_RELEASE_KEY_FILE." >&2
  exit 1
else
  echo "Attenzione: pacchetto NON firmato (manca LENS_RELEASE_KEY). Si installa da terminale, non dalla dashboard." >&2
fi

mkdir -p "$HERE/dist"
rm -f "$OUT"
(cd "$WORK" && zip -qrXy "$OUT" opencode-lens)

echo "Verifica del pacchetto…"
mkdir "$WORK/check"
unzip -q "$OUT" -d "$WORK/check"
for f in "${FILES[@]}"; do
  [[ -e "$WORK/check/opencode-lens/$f" ]] || { echo "Nel pacchetto manca $f" >&2; exit 1; }
done
[[ -x "$WORK/check/opencode-lens/install.sh" && -x "$WORK/check/opencode-lens/uninstall.sh" ]] || {
  echo "install.sh/uninstall.sh non eseguibili nel pacchetto" >&2
  exit 1
}
(cd "$WORK/check/opencode-lens" && OPENCODE_SERVICE_FILE=/nonesiste/service.json \
  node --disable-warning=ExperimentalWarning src/main.js --help >/dev/null)
[[ "$SIGNED" == "0" ]] || node scripts/sign-release.mjs verify "$WORK/check/opencode-lens"

echo "OK: dist/$NAME.zip ($(du -h "$OUT" | cut -f1 | tr -d ' '))$([[ "$SIGNED" == "1" ]] && echo ", firmato")"
