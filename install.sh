#!/bin/bash
# Installa (o aggiorna) opencode-lens come LaunchAgent utente: parte al login,
# riparte se cade. Tutto resta nella cartella utente, senza sudo.
#
# Da uno zip estratto (quello della release o il «Source code» di GitHub):
#   bash ~/Downloads/<cartella estratta>/install.sh
#   1. cerca installazioni precedenti (servizio, cartella dell'app, Homebrew, altre copie)
#   2. salva una copia del database e del plist in ~/Library/Application Support/opencode-lens/backup
#   3. copia l'app in ~/Applications/opencode-lens (solo i file che servono a farla girare)
#   4. usa il Node >= 22.13 del PATH; se manca, scarica Node 24 LTS da nodejs.org
#      in ~/Applications/opencode-lens/node (verificato con SHASUMS256.txt)
#   5. lancia `opencode-lens service install` (src/service.js), che conserva le
#      variabili del servizio; se va a buon fine sposta nel Cestino la vecchia
#      cartella dell'app, quando era una copia estratta da uno zip
# Database, disposizione della dashboard e log non vengono mai toccati.
# Per aggiornare si rilancia lo stesso comando dallo zip nuovo.
#
# Da un clone del repository installa il servizio sulla cartella del clone,
# con il Node del PATH.
#
# Uso: bash install.sh                  (porta 4777, o quella già nel plist)
#      bash install.sh --check          (mostra cosa c'è installato, non cambia niente)
#      LENS_PORT=4800 bash install.sh
#      LENS_NODE_MIRROR=https://mirror.interno/nodejs/dist bash install.sh
#      LENS_NO_SCAN=1 bash install.sh   (non cerca altre copie in Download, Scrivania,
#                                        Documenti: lo usa «Aggiornamento» della dashboard)
set -euo pipefail

APP="$HOME/Applications/opencode-lens"
PLIST="$HOME/Library/LaunchAgents/local.opencode-lens.plist"
DATA="$HOME/Library/Application Support/opencode-lens"
BACKUPS="$DATA/backup"
FILES=(LICENSE README.md README.en.md README.fr.md CHANGELOG.md CHANGELOG.en.md CHANGELOG.fr.md package.json install.sh uninstall.sh src public modules scripts/verify.mjs docs extras test/module-test-kit.js test/module-hooks.mjs test/helpers.js test/query-plan-check.js)
NODE_LINE="latest-v24.x"
MIRROR="${LENS_NODE_MIRROR:-https://nodejs.org/dist}"
SRC="$(cd "$(dirname "$0")" && pwd -P)"

die() {
  echo "$*" >&2
  exit 1
}

CHECK=0
case "$#:${1:-}" in
  0:) ;;
  1:--check) CHECK=1 ;;
  *) die "uso: bash install.sh [--check] (un solo install.sh alla volta: indica la cartella della versione da installare)" ;;
esac

[[ "$(id -u)" -ne 0 ]] || die "Non serve essere amministratore: rilancia come utente normale, con bash install.sh"
[[ -f "$SRC/src/main.js" && -f "$SRC/package.json" ]] || die "In $SRC non c'è opencode-lens: lancia install.sh dalla cartella estratta dallo zip."

version_of() {
  [[ -f "$1/package.json" ]] && sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1/package.json" | head -n 1
}

# One value of the plist (plutil key path), empty when missing. Without plutil
# (not macOS) it reads the XML that service install writes.
plist_get() {
  [[ -f "$PLIST" ]] || return 0
  if command -v plutil >/dev/null; then
    plutil -extract "$1" raw -o - "$PLIST" 2>/dev/null || true
  else
    local key="${1##*.}"
    [[ "$1" == ProgramArguments.0 ]] && key=ProgramArguments
    awk -v k="<key>$key</key>" 'f && /<string>/ { sub(/.*<string>/, ""); sub(/<\/string>.*/, ""); gsub(/&lt;/, "<"); gsub(/&gt;/, ">"); gsub(/&amp;/, "\\&"); print; exit } index($0, k) { f = 1 }' "$PLIST"
  fi
}

# Node >= 22.13 (node:sqlite)
node_ok() {
  [[ -x "$1" ]] && "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null
}

download_node() {
  local os arch sums file sum tmp
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "Sistema non supportato: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) die "Architettura non supportata: $(uname -m)" ;;
  esac
  echo "Node >= 22.13 non trovato: scarico Node 24 LTS ($os-$arch) da $MIRROR in $APP/node…"
  sums="$(curl -fsSL "$MIRROR/$NODE_LINE/SHASUMS256.txt")" || die "Download di $MIRROR/$NODE_LINE/SHASUMS256.txt non riuscito. Senza accesso a nodejs.org installa Node >= 22.13 nel PATH, oppure indica un mirror con LENS_NODE_MIRROR."
  read -r sum file < <(grep -E " node-v[0-9.]+-$os-$arch\.tar\.gz\$" <<<"$sums" | head -n 1) || true
  [[ -n "${file:-}" ]] || die "In SHASUMS256.txt non c'è Node per $os-$arch."
  tmp="$(mktemp -d)"
  curl -fSL --progress-bar "$MIRROR/$NODE_LINE/$file" -o "$tmp/$file" || die "Download di $file non riuscito."
  [[ "$(shasum -a 256 "$tmp/$file" | cut -d ' ' -f 1)" == "$sum" ]] || die "Checksum di $file non valido: download corrotto, riprova."
  mkdir -p "$tmp/x"
  tar -xzf "$tmp/$file" -C "$tmp/x" --strip-components 1
  node_ok "$tmp/x/bin/node" || die "Il Node scaricato non parte."
  rm -rf "$APP/node"
  mkdir -p "$APP"
  mv "$tmp/x" "$APP/node"
  rm -rf "$tmp"
}

# --- what is installed now ---------------------------------------------------

CLONE=0
[[ -e "$SRC/.git" ]] && CLONE=1
APP_REAL="$(cd "$APP" 2>/dev/null && pwd -P || true)"
OLD_DIR="$(plist_get WorkingDirectory)"
OLD_DIR_REAL="$(cd "$OLD_DIR" 2>/dev/null && pwd -P || true)"
OLD_NODE="$(plist_get ProgramArguments.0)"
DB="$(plist_get EnvironmentVariables.LENS_DB)"
DB="${DB:-$DATA/lens.db}"

# kind of the app folder the service starts from now
OLD_KIND=none
if [[ -n "$OLD_DIR" ]]; then
  if [[ "$OLD_DIR" == */Cellar/* || "$OLD_DIR" == */opt/opencode-lens* ]]; then OLD_KIND=homebrew
  elif [[ -z "$OLD_DIR_REAL" ]]; then OLD_KIND=missing
  elif [[ "$OLD_DIR_REAL" == "$SRC" ]]; then OLD_KIND=same
  elif [[ "$OLD_DIR_REAL" == "$APP_REAL" ]]; then OLD_KIND=app
  elif [[ -e "$OLD_DIR/.git" ]]; then OLD_KIND=clone
  # an app folder of its own (an old extracted zip), not one that holds this one
  elif [[ -f "$OLD_DIR/src/main.js" && "$SRC" != "$OLD_DIR_REAL/"* ]] && grep -q '"name": *"opencode-lens"' "$OLD_DIR/package.json" 2>/dev/null; then OLD_KIND=folder
  else OLD_KIND=other
  fi
fi

# other copies lying around: old extracted zips, clones, Homebrew
OTHERS=()
while IFS= read -r pkg; do
  d="$(cd "$(dirname "$pkg")" && pwd -P)"
  [[ "$d" == "$SRC" || "$d" == "$OLD_DIR_REAL" ]] && continue
  [[ -n "$APP_REAL" && ("$d" == "$APP_REAL" || "$d" == "$APP_REAL/"*) ]] && continue
  grep -q '"name": *"opencode-lens"' "$pkg" 2>/dev/null || continue
  [[ -f "$d/src/main.js" ]] || continue
  if [[ -e "$d/.git" ]]; then OTHERS+=("$d (clone del repository, $(version_of "$d"))")
  else OTHERS+=("$d ($(version_of "$d"))")
  fi
done < <([[ -n "${LENS_NO_SCAN:-}" ]] || find "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME/Applications" -maxdepth 3 -name package.json -path '*opencode-lens*' 2>/dev/null || true)
BREW=()
for p in /opt/homebrew /usr/local; do
  [[ -d "$p/Cellar/opencode-lens" ]] && BREW+=("formula opencode-lens in $p/Cellar")
  [[ -d "$p/Library/Taps/vale76p/homebrew-tap" ]] && BREW+=("tap vale76p/tap in $p/Library/Taps")
done

report() {
  echo "Versione da installare: $(version_of "$SRC") ($SRC)"
  if [[ -f "$PLIST" ]]; then
    echo "Servizio: $PLIST"
    case "$OLD_KIND" in
      homebrew) echo "  app: $OLD_DIR (Homebrew, $(version_of "$OLD_DIR"))" ;;
      missing) echo "  app: $OLD_DIR (cartella non più presente: il servizio non può partire)" ;;
      clone) echo "  app: $OLD_DIR (clone del repository, $(version_of "$OLD_DIR"))" ;;
      none) echo "  app: (WorkingDirectory non leggibile)" ;;
      *) echo "  app: $OLD_DIR ($(version_of "$OLD_DIR"))" ;;
    esac
    echo "  node: ${OLD_NODE:-?}"
  else
    echo "Servizio: non installato"
  fi
  if [[ -f "$DB" ]]; then echo "Database: $DB ($(du -h "$DB" | cut -f 1 | tr -d ' '))"; else echo "Database: $DB (non c'è ancora)"; fi
  if [[ -d "$BACKUPS" ]]; then echo "Backup: $BACKUPS ($(find "$BACKUPS" -name 'lens-*.db' | wc -l | tr -d ' '))"; fi
  if [[ -d "$APP/node" ]]; then echo "Node scaricato da install.sh: $APP/node"; fi
  for o in ${OTHERS[@]+"${OTHERS[@]}"}; do echo "Altra copia, non usata dal servizio: $o"; done
  for b in ${BREW[@]+"${BREW[@]}"}; do echo "Homebrew: $b"; done
}

report
if [[ "$CHECK" -eq 1 ]]; then
  echo
  echo "Solo controllo: nessuna modifica. Per installare: bash $SRC/install.sh"
  exit 0
fi
[[ "$CLONE" -eq 1 || ! -e "$APP/.git" ]] || die "$APP è un clone del repository: non lo sovrascrivo. Lancia install.sh dal clone, o spostalo altrove."

# --- Node ------------------------------------------------------------------------

NODE="$(command -v node || true)"
if ! node_ok "$NODE"; then
  [[ "$CLONE" -eq 0 ]] || die "Serve Node >= 22.13 nel PATH (trovato: ${NODE:-nessuno})."
  NODE="$APP/node/bin/node"
  node_ok "$NODE" || download_node
fi

# --- backup ----------------------------------------------------------------------

# a consistent copy even while the lens is writing (VACUUM INTO on a read-only
# connection); the newest 3 are kept. The database itself is never touched.
if [[ -f "$DB" && -z "${LENS_SKIP_BACKUP:-}" ]]; then
  mkdir -p "$BACKUPS"
  chmod 700 "$BACKUPS"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  OLD_VERSION="$(version_of "$OLD_DIR" || true)"
  BK="$BACKUPS/lens-${OLD_VERSION:-prima}-$STAMP.db"
  # umask in a subshell: the copy is never readable by others, not even for an instant
  (umask 077 && "$NODE" --disable-warning=ExperimentalWarning -e 'const{DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});d.prepare("VACUUM INTO ?").run(process.argv[2]);d.close()' "$DB" "$BK") ||
    die "Copia di sicurezza del database non riuscita: non procedo. Per installare comunque: LENS_SKIP_BACKUP=1 bash $SRC/install.sh"
  chmod 600 "$BK"
  if [[ -f "$PLIST" ]]; then
    cp "$PLIST" "$BACKUPS/local.opencode-lens-$STAMP.plist"
    chmod 600 "$BACKUPS/local.opencode-lens-$STAMP.plist"
  fi
  { ls -1t "$BACKUPS"/lens-*.db 2>/dev/null || true; } | tail -n +4 | while IFS= read -r f; do rm -f "$f"; done
  { ls -1t "$BACKUPS"/local.opencode-lens-*.plist 2>/dev/null || true; } | tail -n +4 | while IFS= read -r f; do rm -f "$f"; done
  echo "Copia del database: $BK"
fi

# --- app -------------------------------------------------------------------------

if [[ "$CLONE" -eq 1 ]]; then
  # clone: the plist points at the clone
  DEST="$SRC"
else
  DEST="$APP"
  if [[ "$SRC" != "$APP_REAL" ]]; then
    echo "Installo opencode-lens $(version_of "$SRC") in ${APP}…"
    mkdir -p "$HOME/Applications"
    STAGE="$(mktemp -d "$HOME/Applications/.opencode-lens.XXXXXX")"
    for f in "${FILES[@]}"; do
      [[ -e "$SRC/$f" ]] || continue
      mkdir -p "$STAGE/$(dirname "$f")"
      cp -R "$SRC/$f" "$STAGE/$f"
    done
    chmod 755 "$STAGE"
    # the private Node survives updates; the running lens notices the new version
    # (or the files gone for a moment) and launchd restarts it with the new code
    if [[ -d "$APP/node" ]]; then mv "$APP/node" "$STAGE/node"; fi
    rm -rf "$APP"
    mv "$STAGE" "$APP"
    [[ "$NODE" != "$APP/node/bin/node" ]] || node_ok "$NODE" || die "Node in $APP/node non più utilizzabile."
  fi
  # files extracted from a downloaded zip carry the quarantine flag
  if command -v xattr >/dev/null; then xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true; fi
fi

# --- service ---------------------------------------------------------------------

echo "Node $("$NODE" -p process.versions.node): $NODE"
"$NODE" --disable-warning=ExperimentalWarning "$DEST/src/main.js" service install ${LENS_PORT:+--port "$LENS_PORT"}

# --- macOS app -------------------------------------------------------------------

# an installed OpenCode Lens.app gets the version just installed (extras/macos/app.sh); its failure
# never fails the install: the lens is already updated and the dashboard shows the app behind
MAC_APP="$HOME/Applications/OpenCode Lens.app"
if [[ -z "${LENS_SKIP_APP:-}" && -d "$MAC_APP" && -f "$DEST/extras/macos/app.sh" ]]; then
  echo "Allineo l'app OpenCode Lens…"
  bash "$DEST/extras/macos/app.sh" update ||
    echo "App OpenCode Lens non allineata: riprova da Impostazioni › Aggiornamento o con bash \"$DEST/extras/macos/app.sh\" update"
fi

# --- cleanup of the previous installation ----------------------------------------

[[ "$DEST" == "$APP" ]] || exit 0
case "$OLD_KIND" in
  folder)
    # an old extracted zip: to the Trash, not deleted, so it can be put back
    trash="$HOME/.Trash/$(basename "$OLD_DIR")-$(date +%Y%m%d-%H%M%S)"
    if mv "$OLD_DIR" "$trash" 2>/dev/null; then echo "Vecchia cartella dell'app spostata nel Cestino: $OLD_DIR"
    else echo "Non usata più dal servizio, puoi cancellarla: $OLD_DIR"
    fi
    ;;
  clone) echo "Il servizio prima partiva dal clone $OLD_DIR: lo lascio dove si trova." ;;
  other) echo "Il servizio prima partiva da $OLD_DIR: non la tocco." ;;
esac
if [[ ${#BREW[@]} -gt 0 ]]; then
  echo "Resta l'installazione con Homebrew, non più usata. Per toglierla (database e impostazioni restano):"
  echo "  brew uninstall opencode-lens; brew untap vale76p/tap"
fi
for o in ${OTHERS[@]+"${OTHERS[@]}"}; do echo "Altra copia, non usata dal servizio: $o"; done
