#!/bin/bash
# Rimuove il LaunchAgent. Il database resta dove si trova, a meno di --purge.
# Fa tutto `opencode-lens service uninstall` (src/service.js).
# Uso: bash uninstall.sh [--purge]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# the Node in the PATH, else the one install.sh downloaded next to the app
NODE="$(command -v node || true)"
[[ -n "$NODE" ]] || NODE="$HERE/node/bin/node"
if [[ ! -x "$NODE" ]]; then
  echo "node non trovato nel PATH né in $HERE/node." >&2
  exit 1
fi
exec "$NODE" --disable-warning=ExperimentalWarning "$HERE/src/main.js" service uninstall "$@"
