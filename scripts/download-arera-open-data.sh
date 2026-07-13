#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-.arera-download}"
START_DATE="${2:-}"
DAYS_BACK="${ARERA_DAYS_BACK:-14}"
OPEN_DATA_URL="https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

mkdir -p "$OUT_DIR"

log() {
  printf '[ARERA-AUTO] %s\n' "$1"
}

download_one() {
  local url="$1"
  local out="$2"
  curl \
    --fail \
    --location \
    --retry 2 \
    --retry-delay 2 \
    --connect-timeout 30 \
    --max-time 120 \
    --compressed \
    --user-agent "$UA" \
    --header "Accept: application/xml,text/xml,text/html,*/*" \
    --header "Accept-Language: it-IT,it;q=0.9,en;q=0.8" \
    --header "Referer: $OPEN_DATA_URL" \
    "$url" \
    --output "$out"
}

try_date() {
  local stamp="$1"
  local folder="$2"
  local base="https://www.ilportaleofferte.it/portaleOfferte/resources/opendata/csv/offerteML/$folder"
  local e_url="$base/PO_Offerte_E_MLIBERO_${stamp}.xml"
  local g_url="$base/PO_Offerte_G_MLIBERO_${stamp}.xml"
  local d_url="$base/PO_Offerte_D_MLIBERO_${stamp}.xml"
  local e_out="$OUT_DIR/PO_Offerte_E_MLIBERO_${stamp}.xml"
  local g_out="$OUT_DIR/PO_Offerte_G_MLIBERO_${stamp}.xml"
  local d_out="$OUT_DIR/PO_Offerte_D_MLIBERO_${stamp}.xml"

  log "Cerco file XML Mercato Libero per la data $stamp."
  rm -f "$e_out" "$g_out" "$d_out"

  if download_one "$e_url" "$e_out" && download_one "$g_url" "$g_out"; then
    if download_one "$d_url" "$d_out"; then
      log "Scaricato anche il file dual fuel per la data $stamp."
    else
      rm -f "$d_out"
      log "File dual fuel non scaricato per la data $stamp; procedo con elettrico e gas."
    fi
    log "Download completato per la data $stamp."
    return 0
  fi

  rm -f "$e_out" "$g_out" "$d_out"
  log "Download non riuscito per la data $stamp."
  return 1
}

if [ -n "$START_DATE" ]; then
  BASE_DATE="$START_DATE"
else
  BASE_DATE="$(date -u +%Y-%m-%d)"
fi

log "Data iniziale cercata: $BASE_DATE. Giorni controllati: $DAYS_BACK."

for offset in $(seq 0 $((DAYS_BACK - 1))); do
  day="$(date -u -d "$BASE_DATE -${offset} day" +%Y-%m-%d)"
  stamp="$(date -u -d "$day" +%Y%m%d)"
  folder="$(date -u -d "$day" +%Y_%-m)"
  if try_date "$stamp" "$folder"; then
    exit 0
  fi
done

log "Nessun file XML ARERA scaricato automaticamente."
exit 1
