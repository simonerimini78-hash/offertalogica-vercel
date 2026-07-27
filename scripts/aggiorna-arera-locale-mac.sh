#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="$ROOT_DIR/.arera-download"
AS_OF="${1:-}"
DAYS_BACK="${ARERA_DAYS_BACK:-14}"
MAX_TIME="${ARERA_MAX_TIME:-900}"
MAX_ATTEMPTS="${ARERA_MAX_ATTEMPTS:-3}"
RETRY_DELAY="${ARERA_RETRY_DELAY:-5}"
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

validate_xml() {
  local kind="$1"
  local path="$2"

  python3 - "$kind" "$path" <<'PY'
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

kind = sys.argv[1]
path = Path(sys.argv[2])
namespace = "http://www.acquirenteunico.it/schemas/SII_AU/OffertaRetail/01"
ns = {"po": namespace}

if not path.is_file() or path.stat().st_size == 0:
    raise SystemExit(1)

try:
    root = ET.parse(path).getroot()
except (ET.ParseError, OSError):
    raise SystemExit(1)

if root.tag != f"{{{namespace}}}ListaOfferteMercatoLibero":
    raise SystemExit(1)

offers = root.findall("po:offerta", ns)
if not offers:
    raise SystemExit(1)

if kind == "D":
    valid_dual = 0
    for offer in offers:
        light = offer.findtext("po:OffertaDual/po:OFFERTE_CONGIUNTE_EE", default="", namespaces=ns).strip()
        gas = offer.findtext("po:OffertaDual/po:OFFERTE_CONGIUNTE_GAS", default="", namespaces=ns).strip()
        if light and gas:
            valid_dual += 1
    if valid_dual == 0:
        raise SystemExit(1)
PY
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

SELECTED_PATH=""
SELECTED_DATE=""

find_latest_file() {
  local kind="$1"
  local label="$2"
  local offset day stamp month_number year_number folder base url out

  SELECTED_PATH=""
  SELECTED_DATE=""

  for offset in $(seq 0 $((DAYS_BACK - 1))); do
    day="$(mac_date "$BASE_DATE" "$offset")"
    stamp="$(date -j -f "%Y-%m-%d" "$day" "+%Y%m%d")"
    month_number="$(date -j -f "%Y-%m-%d" "$day" "+%-m")"
    year_number="$(date -j -f "%Y-%m-%d" "$day" "+%Y")"
    folder="${year_number}_${month_number}"
    base="https://www.ilportaleofferte.it/portaleOfferte/resources/opendata/csv/offerteML/$folder"
    url="$base/PO_Offerte_${kind}_MLIBERO_${stamp}.xml"
    out="$STAGING_DIR/PO_Offerte_${kind}_MLIBERO_${stamp}.xml"

    log "Cerco XML $label per la data $stamp."
    rm -f "$out" "${out}.part"

    if download_one "$url" "$out"; then
      if validate_xml "$kind" "$out"; then
        SELECTED_PATH="$out"
        SELECTED_DATE="$day"
        log "XML $label valido selezionato: $(basename "$out")."
        return 0
      fi

      rm -f "$out"
      log "XML $label non valido per la data $stamp."
    fi
  done

  log "ERRORE: nessun XML $label valido trovato negli ultimi $DAYS_BACK giorni."
  return 1
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

if ! [[ "$DAYS_BACK" =~ ^[1-9][0-9]*$ ]]; then
  log "ERRORE: ARERA_DAYS_BACK deve essere un intero positivo."
  exit 1
fi

mkdir -p "$DOWNLOAD_DIR"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/offertalogica-arera.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT

log "Cartella progetto: $ROOT_DIR"
log "Data di elaborazione: $BASE_DATE."
log "Ogni archivio viene cercato separatamente negli ultimi $DAYS_BACK giorni."

if ! find_latest_file "E" "luce"; then
  log "I JSON esistenti non sono stati modificati."
  exit 1
fi
E_PATH="$SELECTED_PATH"
E_DATE="$SELECTED_DATE"

if ! find_latest_file "G" "gas"; then
  log "I JSON esistenti non sono stati modificati."
  exit 1
fi
G_PATH="$SELECTED_PATH"
G_DATE="$SELECTED_DATE"

if ! find_latest_file "D" "dual"; then
  log "Il file dual è obbligatorio: l'aggiornamento viene annullato."
  log "I JSON esistenti non sono stati modificati."
  exit 1
fi
D_PATH="$SELECTED_PATH"
D_DATE="$SELECTED_DATE"

log "Terna ARERA selezionata:"
log "- luce: $(basename "$E_PATH")"
log "- gas: $(basename "$G_PATH")"
log "- dual: $(basename "$D_PATH")"

rm -f \
  "$DOWNLOAD_DIR"/PO_Offerte_E_MLIBERO_*.xml \
  "$DOWNLOAD_DIR"/PO_Offerte_G_MLIBERO_*.xml \
  "$DOWNLOAD_DIR"/PO_Offerte_D_MLIBERO_*.xml \
  "$DOWNLOAD_DIR"/*.part

mv -f "$E_PATH" "$DOWNLOAD_DIR/"
mv -f "$G_PATH" "$DOWNLOAD_DIR/"
mv -f "$D_PATH" "$DOWNLOAD_DIR/"

E_FILE="$(basename "$E_PATH")"
G_FILE="$(basename "$G_PATH")"
D_FILE="$(basename "$D_PATH")"

log "Genero e valido il JSON OffertaLogica usando tutti e tre gli XML."

python3 - "$ROOT_DIR" "$DOWNLOAD_DIR" "$BASE_DATE" "$E_FILE" "$G_FILE" "$D_FILE" <<'PY'
from __future__ import annotations

import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path

root = Path(sys.argv[1]).resolve()
source_dir = Path(sys.argv[2]).resolve()
as_of = datetime.strptime(sys.argv[3], "%Y-%m-%d")
expected_files = {"E": sys.argv[4], "G": sys.argv[5], "D": sys.argv[6]}
script = root / "scripts" / "update-arera-menu.py"

spec = importlib.util.spec_from_file_location("update_arera_menu_local", script)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Impossibile caricare {script}")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

files = module.local_files(source_dir)
actual_files = {kind: files[kind].name for kind in ("E", "G", "D")}
if actual_files != expected_files:
    raise RuntimeError(f"Terna XML non coerente: attesa {expected_files}, trovata {actual_files}")

# Si usa la data corrente di elaborazione, non la data più vecchia tra i tre file.
# In questo modo un file dual ancora valido può restare meno recente di luce e gas.
payload, report, staging_path = module.build_validated_payload(files, as_of, root)

stats = dict(payload.get("statistiche") or {})
for kind, field in (("E", "fileLuce"), ("G", "fileGas"), ("D", "fileDual")):
    if stats.get(field) != expected_files[kind]:
        raise RuntimeError(f"Statistica {field} mancante o errata: {stats.get(field)!r}")

if payload.get("aggiornatoIl") != as_of.strftime("%Y-%m-%d"):
    raise RuntimeError("La data del catalogo non coincide con la data di elaborazione")

private_dual = payload.get("offerteDual")
business_dual = payload.get("offerteDualBusiness")
if not isinstance(private_dual, list) or not isinstance(business_dual, list):
    raise RuntimeError("Il catalogo non contiene le sezioni offerteDual e offerteDualBusiness")

all_dual = private_dual + business_dual
if not all_dual:
    raise RuntimeError("Il file dual è stato scaricato ma non ha prodotto alcuna offerta dual valida")

for row in all_dual:
    light_code = str(row.get("codiceOffertaLuce") or "")
    gas_code = str(row.get("codiceOffertaGas") or "")
    light = row.get("luce")
    gas = row.get("gas")
    if not light_code or not gas_code or not isinstance(light, dict) or not isinstance(gas, dict):
        raise RuntimeError(f"Offerta dual incompleta: {row.get('codice')}")
    if str(light.get("codice") or "") != light_code:
        raise RuntimeError(f"Riferimento luce dual incoerente: {row.get('codice')}")
    if str(gas.get("codice") or "") != gas_code:
        raise RuntimeError(f"Riferimento gas dual incoerente: {row.get('codice')}")

module.atomic_publish(root, payload, report)

# Controllo finale sui due JSON effettivamente pubblicati.
data_payload = json.loads((root / "data" / "offerte-arera-menu.json").read_text(encoding="utf-8"))
public_payload = json.loads((root / "public" / "data" / "offerte-arera-menu.json").read_text(encoding="utf-8"))
if data_payload != public_payload:
    raise RuntimeError("I JSON data e public/data non sono identici")

print(
    "[ARERA-LOCALE] Catalogo validato: "
    f"{len(private_dual)} dual privati, {len(business_dual)} dual business."
)
print(f"[ARERA-LOCALE] Staging validato: {staging_path.relative_to(root)}")
PY

log "Aggiornamento completato correttamente."
log "Date sorgenti utilizzate: luce $E_DATE, gas $G_DATE, dual $D_DATE."
log "File aggiornati:"
log "- data/offerte-arera-menu.json"
log "- public/data/offerte-arera-menu.json"
log "- data/arera-update-report.json"
