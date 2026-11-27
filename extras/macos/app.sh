#!/bin/bash
# App macOS facoltativa di opencode-lens: la dashboard in una finestra nativa (docs/app-macos.md).
# Uso: bash app.sh build [--out DIR] | install | update | check | uninstall | test
#
# Builds with the Command Line Tools only (xcrun swiftc, iconutil, plutil, codesign): no Xcode
# project, no SwiftPM, no dependency. The app is built on the Mac that uses it, so it carries no
# quarantine; the release zip holds only these sources. install.sh runs `update` after every
# install, so an installed app always has the lens's version; the lens runs `check`, `install`
# and `update` from Impostazioni › Aggiornamento (src/macos-app.js).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$HERE/../.." && pwd -P)"
NAME="OpenCode Lens"
EXE=OpenCodeLens
BUNDLE_ID=local.opencode-lens.app
MIN_MACOS=13.0
DEST="${HOME:-}/Applications/${NAME}.app"
CACHE="${HOME:-}/Library/Caches/opencode-lens-app"
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"

die() { echo "$*" >&2; exit 1; }

# install and uninstall write and delete under $HOME: never with an empty HOME or /
need_home() {
  [[ -n "${HOME:-}" && "$HOME" != / ]] || die "HOME non impostata o uguale a /: mi fermo senza toccare nulla."
}

on_macos() {
  [[ "$(uname -s)" == Darwin ]] || die "L'app si costruisce solo su macOS."
}

# Checks the tools before using them: /usr/bin/swiftc is a shim that, without the Command Line
# Tools, opens the installation dialog instead of failing, so xcode-select comes first.
# Prints why the app cannot be built here, on one line, and fails; prints nothing when it can.
tools_problem() {
  if [[ "$(uname -s)" != Darwin ]]; then echo "L'app si costruisce solo su macOS."; return 1; fi
  if [[ "$(id -u)" -eq 0 ]]; then echo "Non serve essere amministratore: rilancia come utente normale."; return 1; fi
  local macos
  macos="$(sw_vers -productVersion)"
  if [[ "${macos%%.*}" -lt 13 ]]; then echo "Serve macOS 13 o successivo (trovato ${macos})."; return 1; fi
  if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --find swiftc >/dev/null 2>&1; then
    echo "Serve swiftc: xcode-select --install (Xcode non serve)."
    return 1
  fi
  local swift
  swift="$(xcrun swiftc --version 2>&1 | sed -n 's/.*Swift version \([0-9][0-9]*\).*/\1/p' | head -n 1)"
  if [[ -z "$swift" || "$swift" -lt 6 ]]; then
    echo "Serve Swift 6 o successivo (trovato: ${swift:-sconosciuto}): aggiorna i Command Line Tools."
    return 1
  fi
}

need_tools() {
  on_macos
  local problem
  problem="$(tools_problem)" || die "$problem"
}

# The lens's version, as install.sh reads it.
version() {
  sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1
}

# The version of the installed app, empty when it is missing or unreadable.
installed_version() {
  plutil -extract CFBundleShortVersionString raw -o - "$DEST/Contents/Info.plist" 2>/dev/null || true
}

# LENS_APP_SIGN, else the certificate the installed app was signed with when the keychain still
# has it (a rebuild from install.sh must not drop the signature notifications need), else ad-hoc.
sign_identity() {
  if [[ -n "${LENS_APP_SIGN:-}" ]]; then
    echo "$LENS_APP_SIGN"
    return
  fi
  local authority
  authority="$(codesign -dv "$DEST" 2>&1 | sed -n 's/^Authority=//p' | head -n 1 || true)"
  if [[ -n "$authority" ]] && security find-identity -v -p codesigning 2>/dev/null | grep -qF "\"$authority\""; then
    echo "$authority"
  else
    echo -
  fi
}

compile() {
  xcrun swiftc -swift-version 6 -target "$(uname -m)-apple-macos${MIN_MACOS}" "$@"
}

build() {
  local out="$1"
  need_tools
  local ver
  ver="$(version)"
  [[ "$ver" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]] || die "Versione non valida in ${ROOT}/package.json: ${ver}"
  local number=$((10#${BASH_REMATCH[1]} * 10000 + 10#${BASH_REMATCH[2]} * 100 + 10#${BASH_REMATCH[3]}))

  # ~/Documents may be under iCloud (File Provider): its extended attributes break the signature,
  # so the bundle is assembled in a temporary folder and copied at the end
  WORK="$(mktemp -d "${TMP_ROOT}/opencode-lens-app.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT
  local app="$WORK/${NAME}.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

  echo "Compilazione dell'app ${ver} ($(uname -m))…"
  compile -O "$HERE"/Sources/Core/*.swift "$HERE"/Sources/App/*.swift -o "$app/Contents/MacOS/$EXE"

  echo "Icona…"
  compile "$HERE/Tools/MakeIcon.swift" -o "$WORK/MakeIcon"
  "$WORK/MakeIcon" "$WORK/AppIcon.iconset"
  iconutil -c icns "$WORK/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"

  cp "$HERE/Info.plist" "$app/Contents/Info.plist"
  plutil -replace CFBundleShortVersionString -string "$ver" "$app/Contents/Info.plist"
  plutil -replace CFBundleVersion -string "$number" "$app/Contents/Info.plist"
  plutil -lint -s "$app/Contents/Info.plist"
  printf 'APPL????' > "$app/Contents/PkgInfo"

  # ad-hoc signature with the hardened runtime, or a certificate (sign_identity)
  local identity
  identity="$(sign_identity)"
  xattr -cr "$app"
  codesign --force --sign "$identity" --options runtime --timestamp=none "$app"
  codesign --verify --strict "$app"

  mkdir -p "$out"
  rm -rf "$out/${NAME}.app"
  ditto "$app" "$out/${NAME}.app"
  codesign --verify --strict "$out/${NAME}.app" 2>/dev/null \
    || die "Firma non valida dopo la copia in ${out}: scegli una cartella senza attributi estesi (es. fuori da iCloud)."
  echo "App pronta: ${out}/${NAME}.app"
}

# SIGTERM is a regular quit for the app (main.swift), as ⌘Q; SIGKILL only when it is still open
# after 5 seconds (an older app just exits on SIGTERM).
stop_app() {
  local sig i
  for sig in TERM KILL; do
    pkill "-$sig" -x "$EXE" 2>/dev/null || true
    for i in 1 2 3 4 5 6 7 8 9 10; do
      pgrep -x "$EXE" >/dev/null 2>&1 || return 0
      sleep 0.5
    done
  done
  die "L'app è ancora aperta: chiudila (⌘Q) e riprova."
}

# `always` opens the app at the end; `if-running` only when it was open before.
install_app() {
  local open="$1" was_open=0
  need_home
  build "$CACHE"
  if pgrep -x "$EXE" >/dev/null 2>&1; then was_open=1; fi
  stop_app
  mkdir -p "$HOME/Applications"
  rm -rf "$DEST"
  ditto "$CACHE/${NAME}.app" "$DEST"
  codesign --verify --strict "$DEST" || die "Firma non valida in ${DEST}."
  echo "Installata: ${DEST}"
  if [[ "$open" == always || "$was_open" -eq 1 ]]; then
    open -a "$DEST"
  fi
}

# Rebuilds an installed app whose version is not the lens's, in either direction; never
# installs one that is not there.
update_app() {
  need_home
  if [[ ! -d "$DEST" ]]; then
    echo "App OpenCode Lens non installata: niente da allineare."
    return 0
  fi
  local installed lens
  installed="$(installed_version)"
  lens="$(version)"
  if [[ "$installed" == "$lens" ]]; then
    echo "App OpenCode Lens già alla ${lens}."
    return 0
  fi
  echo "App OpenCode Lens ${installed:-di versione sconosciuta}: la ricompilo alla ${lens}."
  install_app if-running
}

uninstall_app() {
  need_home
  on_macos
  # the login item first, while the app that registered it is still there
  if [[ -x "$DEST/Contents/MacOS/$EXE" ]]; then
    "$DEST/Contents/MacOS/$EXE" --unregister-login-item || true
  fi
  stop_app
  rm -rf "$DEST" "$CACHE"
  rm -rf "$HOME/Library/WebKit/$BUNDLE_ID" "$HOME/Library/Caches/$BUNDLE_ID" \
    "$HOME/Library/Saved Application State/${BUNDLE_ID}.savedState" \
    "$HOME/Library/HTTPStorages/$BUNDLE_ID" "$HOME/Library/HTTPStorages/${BUNDLE_ID}.binarycookies"
  defaults delete "$BUNDLE_ID" >/dev/null 2>&1 || true
  echo "App disinstallata: la lens e i suoi dati non sono stati toccati."
}

run_tests() {
  need_tools
  WORK="$(mktemp -d "${TMP_ROOT}/opencode-lens-app.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT
  compile -parse-as-library "$HERE"/Sources/Core/*.swift "$HERE/Tests/CoreTests.swift" -o "$WORK/core-tests"
  "$WORK/core-tests"
}

case "${1:-}" in
  build)
    on_macos
    out="$CACHE"
    if [[ "${2:-}" == --out ]]; then
      [[ -n "${3:-}" ]] || die "Uso: bash app.sh build --out DIR"
      mkdir -p "$3"
      out="$(cd "$3" && pwd -P)"
    fi
    build "$out"
    ;;
  install) install_app always ;;
  update) update_app ;;
  check)
    if ! problem="$(tools_problem)"; then
      echo "$problem"
      exit 1
    fi
    ;;
  uninstall) uninstall_app ;;
  test) run_tests ;;
  *) die "Uso: bash app.sh build [--out DIR] | install | update | check | uninstall | test" ;;
esac
