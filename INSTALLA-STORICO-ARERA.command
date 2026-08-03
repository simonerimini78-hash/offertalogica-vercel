#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_ROOT="/Users/simo78/OffertLogica/offertalogica-v59-arera-update-locale-mac-20260713 5"
TARGET_SCRIPTS="$TARGET_ROOT/scripts"
STAMP="$(date '+%Y%m%d-%H%M%S')"

if [ ! -d "$TARGET_SCRIPTS" ]; then
  printf 'ERRORE: cartella non trovata:\n%s\n' "$TARGET_SCRIPTS"
  exit 1
fi

if [ ! -f "$TARGET_SCRIPTS/pubblica-arera-github.sh" ]; then
  printf 'ERRORE: script di pubblicazione non trovato:\n%s\n' \
    "$TARGET_SCRIPTS/pubblica-arera-github.sh"
  exit 1
fi

cp "$TARGET_SCRIPTS/pubblica-arera-github.sh" \
  "$TARGET_SCRIPTS/pubblica-arera-github.sh.backup-$STAMP"

cp "$PACKAGE_DIR/scripts/pubblica-arera-github.sh" \
  "$TARGET_SCRIPTS/pubblica-arera-github.sh"
cp "$PACKAGE_DIR/scripts/update-arera-history.py" \
  "$TARGET_SCRIPTS/update-arera-history.py"

chmod 700 "$TARGET_SCRIPTS/pubblica-arera-github.sh"
chmod 700 "$TARGET_SCRIPTS/update-arera-history.py"

bash -n "$TARGET_SCRIPTS/pubblica-arera-github.sh"
python3 -m py_compile "$TARGET_SCRIPTS/update-arera-history.py"

printf '\nInstallazione completata.\n'
printf 'Backup creato: %s\n' \
  "$TARGET_SCRIPTS/pubblica-arera-github.sh.backup-$STAMP"
printf 'La programmazione launchd non è stata modificata.\n'
printf 'Non è stato eseguito alcun push su GitHub.\n'
