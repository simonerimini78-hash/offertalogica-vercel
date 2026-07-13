
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="$ROOT_DIR/.arera-download"
AS_OF="${1:-}"

MAX_TIME="${ARERA_MAX_TIME:-900}"
MAX_ATTEMPTS="${ARERA_MAX_ATTEMPTS:-3}"
RETRY_DELAY="${ARERA_RETRY_DELAY:-5}"

OPEN_DATA_URL="https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

log() {
  printf '[ARERA-LOCALE] %s\n' "$1"
}

download_one() {
  local url="$1"
  local out="$2"
  local temporary="${out}.part"
  local attempt

  rm -f "$temporary"

  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    log "Download $(basename "$out"): tentativo $attempt di $MAX_ATTEMPTS."

    if curl \
      --fail \
      --location \
      --connect-timeout 30 \
      --max-time "$MAX_TIME" \
      --compressed \
      --user-agent "$UA" \
      --header "Accept: application/xml,text/xml,text/html,*/*" \
      --header "Accept-Language: it-IT,it;q=0.9,en;q=0.8" \
      --header "Referer: $OPEN_DATA_URL" \
      "$url" \
      --output "$temporary"
    then
      if [ -s "$temporary" ]; then
        mv -f "$temporary" "$out"
        return 0
      fi

      log "Il file scaricato è vuoto."
    fi

    rm -f "$temporary"

    if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
      log "Nuovo tentativo tra $RETRY_DELAY secondi."
      sleep "$RETRY_DELAY"
    fi
  done

  rm -f "$temporary"
  return 1
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

  log "Cerco XML ARERA esclusivamente per la data $stamp."

  rm -f \
    "$e_out" "$g_out" "$d_out" \
    "${e_out}.part" "${g_out}.part" "${d_out}.part"

  if ! download_one "$e_url" "$e_out"; then
    rm -f "$e_out" "$g_out" "$d_out"
    log "ERRORE: download elettrico non riuscito per $stamp."
    return 1
  fi

  if ! download_one "$g_url" "$g_out"; then
    rm -f "$e_out" "$g_out" "$d_out"
    log "ERRORE: download gas non riuscito per $stamp."
    return 1
  fi

  if download_one "$d_url" "$d_out"; then
    log "Scaricato anche XML dual fuel per $stamp."
  else
    rm -f "$d_out"
    log "XML dual fuel non disponibile per $stamp; procedo con elettrico e gas."
  fi

  log "Download completato per $stamp."
  return 0
}

if [ -z "$AS_OF" ]; then
  BASE_DATE="$(date "+%Y-%m-%d")"
else
  BASE_DATE="$AS_OF"
fi

if ! date -j -f "%Y-%m-%d" "$BASE_DATE" "+%Y-%m-%d" >/dev/null 2>&1; then
  log "ERRORE: data non valida: $BASE_DATE. Usa il formato AAAA-MM-GG."
  exit 1
fi

STAMP="$(date -j -f "%Y-%m-%d" "$BASE_DATE" "+%Y%m%d")"
MONTH_NUMBER="$(date -j -f "%Y-%m-%d" "$BASE_DATE" "+%-m")"
YEAR_NUMBER="$(date -j -f "%Y-%m-%d" "$BASE_DATE" "+%Y")"
FOLDER="${YEAR_NUMBER}_${MONTH_NUMBER}"

mkdir -p "$DOWNLOAD_DIR"

log "Cartella progetto: $ROOT_DIR"
log "Data richiesta: $BASE_DATE."
log "Non verranno utilizzati dati di giorni precedenti."

if ! try_date "$STAMP" "$FOLDER"; then
  log "ERRORE: XML ARERA del $BASE_DATE non scaricati completamente."
  log "I JSON esistenti non sono stati modificati."
  exit 1
fi

log "Genero JSON OffertaLogica dalla cartella XML locale."

python3 "$ROOT_DIR/scripts/update-arera-menu.py" \
  --source-dir "$DOWNLOAD_DIR" \
  --as-of "$BASE_DATE"

log "Aggiornamento completato correttamente per $BASE_DATE."
log "File aggiornati:"
log "- data/offerte-arera-menu.json"
log "- public/data/offerte-arera-menu.json"
log "Ora puoi caricare questi due file su GitHub."
