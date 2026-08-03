#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="/Users/simo78/OffertLogica/offertalogica-v59-arera-update-locale-mac-20260713 5"
REPO_DIR="$HOME/OffertLogica/offertalogica-github-sync"
SUCCESS_MARKER="$SOURCE_ROOT/.arera-download/.last-successful-date"
TODAY="$(date '+%Y-%m-%d')"

log() {
  printf '[GITHUB-SYNC] %s\n' "$1"
}

if [ "${ARERA_FORCE_PUBLISH:-0}" != "1" ]; then
  if [ ! -f "$SUCCESS_MARKER" ] || [ "$(cat "$SUCCESS_MARKER")" != "$TODAY" ]; then
    log "Nessun aggiornamento ARERA completato per $TODAY."
    log "GitHub non è stato modificato."
    exit 0
  fi
fi

for relative_path in \
  "data/offerte-arera-menu.json" \
  "public/data/offerte-arera-menu.json"
do
  if [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
    log "ERRORE: file mancante o vuoto: $relative_path"
    exit 1
  fi
done

log "Aggiorno la copia locale del repository GitHub."
git -C "$REPO_DIR" fetch origin main
git -C "$REPO_DIR" checkout --quiet main
git -C "$REPO_DIR" reset --hard origin/main >/dev/null

# Prima installazione: se uno storico esiste già su main e la copia locale non lo
# possiede ancora, lo recupera come base. In seguito la copia locale resta la fonte
# progressiva e non perde le offerte non più commercializzate.
mkdir -p "$SOURCE_ROOT/data" "$SOURCE_ROOT/public/data"
if [ ! -s "$SOURCE_ROOT/data/offerte-arera-history.json" ] && \
   [ -s "$REPO_DIR/data/offerte-arera-history.json" ]; then
  cp "$REPO_DIR/data/offerte-arera-history.json" \
    "$SOURCE_ROOT/data/offerte-arera-history.json"
fi

log "Aggiorno lo storico progressivo delle offerte ARERA."
python3 "$SOURCE_ROOT/scripts/update-arera-history.py" \
  --package-root "$SOURCE_ROOT"

for relative_path in \
  "data/offerte-arera-menu.json" \
  "public/data/offerte-arera-menu.json" \
  "data/offerte-arera-history.json" \
  "public/data/offerte-arera-history.json"
do
  if [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
    log "ERRORE: file mancante o vuoto dopo l'elaborazione: $relative_path"
    exit 1
  fi
done

cp "$SOURCE_ROOT/data/offerte-arera-menu.json" \
  "$REPO_DIR/data/offerte-arera-menu.json"
cp "$SOURCE_ROOT/public/data/offerte-arera-menu.json" \
  "$REPO_DIR/public/data/offerte-arera-menu.json"
cp "$SOURCE_ROOT/data/offerte-arera-history.json" \
  "$REPO_DIR/data/offerte-arera-history.json"
cp "$SOURCE_ROOT/public/data/offerte-arera-history.json" \
  "$REPO_DIR/public/data/offerte-arera-history.json"

git -C "$REPO_DIR" add \
  data/offerte-arera-menu.json \
  public/data/offerte-arera-menu.json \
  data/offerte-arera-history.json \
  public/data/offerte-arera-history.json

if git -C "$REPO_DIR" diff --cached --quiet; then
  log "I file su GitHub sono già aggiornati; nessun commit necessario."
  exit 0
fi

git -C "$REPO_DIR" commit \
  -m "Aggiorna offerte e storico ARERA al $TODAY"
git -C "$REPO_DIR" push origin main
log "Caricamento su GitHub completato correttamente."
