#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="$ROOT_DIR/.arera-download"
ORIGINAL_ARGS=("$@")
AS_OF="${1:-}"
SYNC_RESTARTED="${ARERA_SYNC_RESTARTED:-0}"
SUCCESS=0
BACKUP_READY=0
BACKUP_DIR=""
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

ensure_pdf_reader() {
  if python3 -c 'import pdfplumber' >/dev/null 2>&1; then
    return 0
  fi
  log "pdfplumber non presente: installo localmente la dipendenza necessaria al bollettino ARERA."
  if ! python3 -m pip install --user --disable-pip-version-check --quiet pdfplumber; then
    log "ERRORE: impossibile installare pdfplumber; aggiornamento annullato."
    return 1
  fi
  if ! python3 -c 'import pdfplumber' >/dev/null 2>&1; then
    log "ERRORE: pdfplumber non importabile dopo l'installazione; aggiornamento annullato."
    return 1
  fi
}

sync_main_code() {
  if ! command -v git >/dev/null 2>&1; then
    log "ERRORE: git non disponibile; impossibile verificare che il trasformatore locale coincida con MAIN."
    return 1
  fi
  if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "Ambiente senza repository Git: salto il controllo origin/main (modalità pacchetto/test)."
    return 0
  fi

  local branch local_head remote_head merge_base
  branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
  if [ "$branch" != "main" ]; then
    log "ERRORE: aggiornamento automatico consentito solo dal branch main; branch corrente: $branch."
    return 1
  fi
  if ! git -C "$ROOT_DIR" diff --quiet || ! git -C "$ROOT_DIR" diff --cached --quiet; then
    log "ERRORE: working tree non pulito. Nessun aggiornamento dati eseguito per evitare di mescolare codice e dati."
    return 1
  fi

  log "Verifico che il codice locale usato dal Mac coincida con origin/main."
  git -C "$ROOT_DIR" fetch --quiet origin main
  local_head="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  remote_head="$(git -C "$ROOT_DIR" rev-parse origin/main)"
  if [ "$local_head" = "$remote_head" ]; then
    log "Codice locale allineato a origin/main: $local_head."
    return 0
  fi

  merge_base="$(git -C "$ROOT_DIR" merge-base HEAD origin/main)"
  if [ "$merge_base" != "$local_head" ]; then
    log "ERRORE: MAIN locale è avanti o divergente rispetto a origin/main. Aggiornamento dati bloccato."
    return 1
  fi

  log "MAIN locale arretrato: eseguo solo un fast-forward a origin/main."
  git -C "$ROOT_DIR" merge --ff-only --quiet origin/main
  if [ "$SYNC_RESTARTED" != "1" ]; then
    log "Codice aggiornato. Riavvio il processo con gli script appena allineati."
    ARERA_SYNC_RESTARTED=1 exec bash "$ROOT_DIR/scripts/aggiorna-arera-locale-mac.sh" "${ORIGINAL_ARGS[@]}"
  fi
}

backup_outputs() {
  BACKUP_DIR="$STAGING_DIR/rollback"
  mkdir -p "$BACKUP_DIR"
  local rel
  for rel in \
    data/calcolo-parametri.json \
    public/data/calcolo-parametri.json \
    data/offerte-arera-menu.json \
    public/data/offerte-arera-menu.json \
    data/arera-update-report.json \
    public/data/energia-oggi.json \
    public/pun-oggi.html \
    public/psv-gas-oggi.html \
    public/sitemap.xml
  do
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    if [ -f "$ROOT_DIR/$rel" ]; then
      cp -p "$ROOT_DIR/$rel" "$BACKUP_DIR/$rel"
    else
      : > "$BACKUP_DIR/$rel.__missing__"
    fi
  done
  BACKUP_READY=1
}

restore_outputs() {
  [ "$BACKUP_READY" = "1" ] || return 0
  local rel
  log "Ripristino atomico dei file precedenti: l'aggiornamento non verrà pubblicato parzialmente."
  for rel in \
    data/calcolo-parametri.json \
    public/data/calcolo-parametri.json \
    data/offerte-arera-menu.json \
    public/data/offerte-arera-menu.json \
    data/arera-update-report.json \
    public/data/energia-oggi.json \
    public/pun-oggi.html \
    public/psv-gas-oggi.html \
    public/sitemap.xml
  do
    if [ -f "$BACKUP_DIR/$rel.__missing__" ]; then
      rm -f "$ROOT_DIR/$rel"
    elif [ -f "$BACKUP_DIR/$rel" ]; then
      mkdir -p "$ROOT_DIR/$(dirname "$rel")"
      cp -p "$BACKUP_DIR/$rel" "$ROOT_DIR/$rel"
    fi
  done
}

cleanup() {
  local status=$?
  if [ "$SUCCESS" != "1" ]; then
    restore_outputs || true
  fi
  [ -z "${STAGING_DIR:-}" ] || rm -rf "$STAGING_DIR"
  return "$status"
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
        light = offer.findtext(
            "po:OffertaDual/po:OFFERTE_CONGIUNTE_EE",
            default="",
            namespaces=ns,
        ).strip()
        gas = offer.findtext(
            "po:OffertaDual/po:OFFERTE_CONGIUNTE_GAS",
            default="",
            namespaces=ns,
        ).strip()
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

SELECTED_DATE=""
E_PATH=""
G_PATH=""
D_PATH=""

try_complete_date() {
  local day="$1"
  local stamp month_number year_number folder base
  local e_url g_url d_url e_out g_out d_out

  stamp="$(date -j -f "%Y-%m-%d" "$day" "+%Y%m%d")"
  month_number="$(date -j -f "%Y-%m-%d" "$day" "+%-m")"
  year_number="$(date -j -f "%Y-%m-%d" "$day" "+%Y")"
  folder="${year_number}_${month_number}"
  base="https://www.ilportaleofferte.it/portaleOfferte/resources/opendata/csv/offerteML/$folder"

  e_url="$base/PO_Offerte_E_MLIBERO_${stamp}.xml"
  g_url="$base/PO_Offerte_G_MLIBERO_${stamp}.xml"
  d_url="$base/PO_Offerte_D_MLIBERO_${stamp}.xml"
  e_out="$STAGING_DIR/PO_Offerte_E_MLIBERO_${stamp}.xml"
  g_out="$STAGING_DIR/PO_Offerte_G_MLIBERO_${stamp}.xml"
  d_out="$STAGING_DIR/PO_Offerte_D_MLIBERO_${stamp}.xml"

  log "Cerco la terna XML ARERA luce/gas/dual per la data $stamp."
  rm -f "$e_out" "$g_out" "$d_out" "${e_out}.part" "${g_out}.part" "${d_out}.part"

  if ! download_one "$e_url" "$e_out" || ! validate_xml "E" "$e_out"; then
    log "Terna non utilizzabile per $stamp: XML luce assente o non valido."
    rm -f "$e_out" "$g_out" "$d_out"
    return 1
  fi

  if ! download_one "$g_url" "$g_out" || ! validate_xml "G" "$g_out"; then
    log "Terna non utilizzabile per $stamp: XML gas assente o non valido."
    rm -f "$e_out" "$g_out" "$d_out"
    return 1
  fi

  if ! download_one "$d_url" "$d_out" || ! validate_xml "D" "$d_out"; then
    log "Terna non utilizzabile per $stamp: XML dual assente o non valido."
    rm -f "$e_out" "$g_out" "$d_out"
    return 1
  fi

  SELECTED_DATE="$day"
  E_PATH="$e_out"
  G_PATH="$g_out"
  D_PATH="$d_out"
  log "Terna completa e valida selezionata per $stamp."
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

if ! [[ "$DAYS_BACK" =~ ^[1-9][0-9]*$ ]]; then
  log "ERRORE: ARERA_DAYS_BACK deve essere un intero positivo."
  exit 1
fi

sync_main_code

mkdir -p "$DOWNLOAD_DIR"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/offertalogica-arera.XXXXXX")"
trap cleanup EXIT

log "Cartella progetto: $ROOT_DIR"
log "Data iniziale: $BASE_DATE."
log "Verrà pubblicata solo una terna E/G/D completa, valida e riferita alla stessa data."

for offset in $(seq 0 $((DAYS_BACK - 1))); do
  candidate_date="$(mac_date "$BASE_DATE" "$offset")"
  if try_complete_date "$candidate_date"; then
    break
  fi
done

if [ -z "$SELECTED_DATE" ]; then
  log "ERRORE: nessuna terna ARERA E/G/D completa e valida trovata negli ultimi $DAYS_BACK giorni."
  log "I JSON esistenti non sono stati modificati."
  exit 1
fi

E_FILE="$(basename "$E_PATH")"
G_FILE="$(basename "$G_PATH")"
D_FILE="$(basename "$D_PATH")"

backup_outputs

log "Rileggo e convalido oggi gli indici ufficiali ARERA usati dal calcolatore."
python3 "$ROOT_DIR/scripts/update-arera-reference-data.py" indices --package-root "$ROOT_DIR"

log "Genero e valido il JSON OffertaLogica con:"
log "- luce: $E_FILE"
log "- gas: $G_FILE"
log "- dual: $D_FILE"

python3 - "$ROOT_DIR" "$STAGING_DIR" "$SELECTED_DATE" "$E_FILE" "$G_FILE" "$D_FILE" <<'PY'
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

payload, report, staging_path = module.build_validated_payload(files, as_of, root)

stats = dict(payload.get("statistiche") or {})
for kind, field in (("E", "fileLuce"), ("G", "fileGas"), ("D", "fileDual")):
    if stats.get(field) != expected_files[kind]:
        raise RuntimeError(f"Statistica {field} mancante o errata: {stats.get(field)!r}")

expected_date = as_of.strftime("%Y-%m-%d")
if payload.get("aggiornatoIl") != expected_date:
    raise RuntimeError("La data del catalogo non coincide con la data della terna ARERA")

private_dual = payload.get("offerteDual")
business_dual = payload.get("offerteDualBusiness")
if not isinstance(private_dual, list) or not isinstance(business_dual, list):
    raise RuntimeError("Il catalogo non contiene offerteDual e offerteDualBusiness")

all_dual = private_dual + business_dual
if not all_dual:
    raise RuntimeError("La terna contiene il file D ma non produce alcuna offerta dual valida")

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

log "Leggo dagli allegati ARERA la spesa annua media ufficiale delle offerte di mercato libero (fisso/variabile, luce/gas)."
python3 "$ROOT_DIR/scripts/update-arera-retail-benchmarks.py" --package-root "$ROOT_DIR"

log "Aggiorno e convalido i riferimenti energia giornalieri ARERA/GME."
ensure_pdf_reader
python3 "$ROOT_DIR/scripts/update-energy-today.py" \
  --output "$ROOT_DIR/public/data/energia-oggi.json" \
  --params "$ROOT_DIR/public/data/calcolo-parametri.json" \
  --pun-page "$ROOT_DIR/public/pun-oggi.html" \
  --gas-page "$ROOT_DIR/public/psv-gas-oggi.html" \
  --sitemap "$ROOT_DIR/public/sitemap.xml"

log "Eseguo la validazione completa del calcolatore e del contratto dati."
(
  cd "$ROOT_DIR"
  node scripts/validate-calculator-data.mjs
)

python3 - "$ROOT_DIR" "$SELECTED_DATE" <<'PY'
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

root = Path(sys.argv[1]).resolve()
selected_date = sys.argv[2]
today = date.today().isoformat()

def load(relative: str):
    return json.loads((root / relative).read_text(encoding="utf-8"))

catalog = load("data/offerte-arera-menu.json")
public_catalog = load("public/data/offerte-arera-menu.json")
params = load("data/calcolo-parametri.json")
public_params = load("public/data/calcolo-parametri.json")
report = load("data/arera-update-report.json")
energy = load("public/data/energia-oggi.json")

if catalog != public_catalog:
    raise RuntimeError("Catalogo data/public non identico")
if params != public_params:
    raise RuntimeError("Parametri data/public non identici")
if catalog.get("aggiornatoIl") != selected_date:
    raise RuntimeError("Data catalogo diversa dalla terna XML selezionata")
if catalog.get("trasformatoreVersione") != "arera-menu-v5-sconti-durata-esplicita":
    raise RuntimeError("Catalogo prodotto da un trasformatore diverso da quello MAIN atteso")

all_rows = []
for field in ("offerte", "offerteBusiness"):
    value = catalog.get(field)
    if not isinstance(value, list):
        raise RuntimeError(f"Campo catalogo {field} non valido")
    all_rows.extend(value)
for row in all_rows:
    if not isinstance(row.get("sconti"), list):
        raise RuntimeError(f"Metadata sconti assente per {row.get('codice')}")

stats = catalog.get("statistiche") or {}
for field in ("scontiTotali", "offerteConSconti", "scontiConPrezzoSupportatoFonte"):
    if field not in stats:
        raise RuntimeError(f"Statistica integrità sconti mancante: {field}")

if params.get("aggiornatoIl") != today:
    raise RuntimeError("Parametri economici non convalidati nella data di esecuzione")
for key in ("pun", "psv"):
    detail = (params.get("indiciMercato") or {}).get(key) or {}
    if detail.get("acquisitoIl") != today:
        raise RuntimeError(f"Indice {key.upper()} non riletto/convalidato oggi")
for key in ("pun", "psv", "psbg"):
    detail = (params.get("indiciMercato") or {}).get(key) or {}
    if float((catalog.get("indiciUsati") or {}).get(key)) != float(detail.get("valore")):
        raise RuntimeError(f"Indice {key.upper()} diverso tra catalogo e parametri")

consumption_source = ((params.get("parametriCalcolo") or {}).get("profiloConsumiFonte") or {})
profile = ((params.get("parametriCalcolo") or {}).get("profiloMedio") or {})
if consumption_source.get("acquisitoIl") != today:
    raise RuntimeError("Profilo consumi ARERA non riletto/convalidato oggi")
for source_key, profile_key in (("luceConsumoKwh", "luceConsumoKwh"), ("gasConsumoSmc", "gasConsumoSmc"), ("potenzaKw", "potenzaKw")):
    if str(consumption_source.get(source_key)) != str(profile.get(profile_key)):
        raise RuntimeError(f"Profilo consumi non coerente: {source_key}")

retail_reference = ((params.get("parametriCalcolo") or {}).get("riferimentiMercatoLibero") or {})
if retail_reference.get("acquisitoIl") != today:
    raise RuntimeError("Riferimenti medi ARERA non acquisiti oggi")
for commodity in ("luce", "gas"):
    sector = retail_reference.get(commodity) or {}
    for price_type in ("fisso", "variabile"):
        item = sector.get(price_type) or {}
        value = item.get("spesaAnnuaMediaEur")
        if item.get("stato") != "ufficiale" or not isinstance(value, (int, float)) or value <= 0:
            raise RuntimeError(f"Riferimento medio ARERA incompleto: {commodity}/{price_type}")
if report.get("versioneDati") != catalog.get("versioneDati") or report.get("pubblicazioneAutorizzata") is not True:
    raise RuntimeError("Report ARERA non coerente con il catalogo pubblicato")
if energy.get("acquisitoIl") != today:
    raise RuntimeError("Dati energia giornalieri non riletti/convalidati oggi")
pun_daily = energy.get("pun") or {}
ig_daily = ((energy.get("gas") or {}).get("giornaliero") or {})
if not pun_daily.get("data") or not isinstance(pun_daily.get("valoreEurMwh"), (int, float)):
    raise RuntimeError("PUN Index GME giornaliero mancante dopo l'acquisizione")
if not ig_daily.get("data") or not isinstance(ig_daily.get("valoreEurMwh"), (int, float)):
    raise RuntimeError("IG Index GME giornaliero mancante dopo l'acquisizione")

print(
    "[ARERA-LOCALE] Integrità finale OK: "
    f"catalogo={catalog.get('versioneDati')}, parametri={params.get('versioneDati')}, "
    f"sconti={stats.get('scontiTotali')}, acquisizione={today}."
)
PY

python3 "$ROOT_DIR/scripts/update-sitemap-lastmod.py" --root "$ROOT_DIR"

rm -f \
  "$DOWNLOAD_DIR"/PO_Offerte_E_MLIBERO_*.xml \
  "$DOWNLOAD_DIR"/PO_Offerte_G_MLIBERO_*.xml \
  "$DOWNLOAD_DIR"/PO_Offerte_D_MLIBERO_*.xml \
  "$DOWNLOAD_DIR"/*.part
cp -f "$E_PATH" "$G_PATH" "$D_PATH" "$DOWNLOAD_DIR/"

SUCCESS=1
log "Aggiornamento completato correttamente con la terna del $SELECTED_DATE."
log "File aggiornati:"
log "- data/offerte-arera-menu.json"
log "- public/data/offerte-arera-menu.json"
log "- data/arera-update-report.json"
log "- data/calcolo-parametri.json"
log "- public/data/calcolo-parametri.json"
log "- public/data/energia-oggi.json"
log "- public/pun-oggi.html"
log "- public/psv-gas-oggi.html"
log "- public/sitemap.xml"
