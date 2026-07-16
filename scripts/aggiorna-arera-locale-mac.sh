#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="$ROOT_DIR/.arera-download"
AS_OF="${1:-}"
DAYS_BACK="${ARERA_DAYS_BACK:-14}"
OPEN_DATA_URL="https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

log() {
  printf '[ARERA-LOCALE] %s\n' "$1"
}

mac_date() {
  local base="$1"
  local offset="$2"
  date -j -v-"${offset}"d -f "%Y-%m-%d" "$base" "+%Y-%m-%d"
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
  local e_out="$DOWNLOAD_DIR/PO_Offerte_E_MLIBERO_${stamp}.xml"
  local g_out="$DOWNLOAD_DIR/PO_Offerte_G_MLIBERO_${stamp}.xml"
  local d_out="$DOWNLOAD_DIR/PO_Offerte_D_MLIBERO_${stamp}.xml"

  log "Cerco XML ARERA per la data $stamp."
  rm -f "$e_out" "$g_out" "$d_out"

  if download_one "$e_url" "$e_out" && download_one "$g_url" "$g_out"; then
    if download_one "$d_url" "$d_out"; then
      log "Scaricato anche XML dual fuel per $stamp."
    else
      rm -f "$d_out"
      log "XML dual fuel non disponibile per $stamp; procedo con elettrico e gas."
    fi
    log "Download completato per $stamp."
    return 0
  fi

  rm -f "$e_out" "$g_out" "$d_out"
  log "Download non riuscito per $stamp."
  return 1
}

if [ -z "$AS_OF" ]; then
  BASE_DATE="$(date "+%Y-%m-%d")"
else
  BASE_DATE="$AS_OF"
fi

mkdir -p "$DOWNLOAD_DIR"

log "Cartella progetto: $ROOT_DIR"
log "Data iniziale cercata: $BASE_DATE. Giorni controllati: $DAYS_BACK."

FOUND_DATE=""
for offset in $(seq 0 $((DAYS_BACK - 1))); do
  day="$(mac_date "$BASE_DATE" "$offset")"
  stamp="$(date -j -f "%Y-%m-%d" "$day" "+%Y%m%d")"
  month_number="$(date -j -f "%Y-%m-%d" "$day" "+%-m")"
  year_number="$(date -j -f "%Y-%m-%d" "$day" "+%Y")"
  folder="${year_number}_${month_number}"
  if try_date "$stamp" "$folder"; then
    FOUND_DATE="$day"
    break
  fi
done

if [ -z "$FOUND_DATE" ]; then
  log "ERRORE: nessun XML ARERA scaricato. I dati esistenti non sono stati modificati."
  exit 1
fi

log "Genero JSON OffertaLogica dalla cartella XML locale."
python3 "$ROOT_DIR/scripts/update-arera-menu.py" --source-dir "$DOWNLOAD_DIR" --as-of "$FOUND_DATE"

log "Aggiornamento completato."
log "File aggiornati:"
log "- data/offerte-arera-menu.json"
log "- public/data/offerte-arera-menu.json"
log "Ora carica questi due file su GitHub."
