#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="$ROOT_DIR/.arera-download"
AS_OF="${1:-}"
SYNC_RESTARTED="${ARERA_SYNC_RESTARTED:-0}"
MAIN_REPO_DIR=""
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
    log "ERRORE: git non disponibile; impossibile allineare il trasformatore locale a MAIN."
    return 1
  fi

  local repo_dir="$ROOT_DIR"
  local external_repo=0
  if ! git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    repo_dir="${ARERA_GITHUB_SYNC_REPO:-$HOME/OffertLogica/offertalogica-github-sync}"
    external_repo=1
    if ! git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      log "ERRORE: la cartella dati non è un repository Git e il clone MAIN non è disponibile in $repo_dir."
      log "Aggiornamento bloccato: non genero dati con un parser locale non verificato."
      return 1
    fi
  fi

  local branch local_head remote_head merge_base
  branch="$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD)"
  if [ "$branch" != "main" ]; then
    log "ERRORE: il clone MAIN deve essere sul branch main; branch corrente: $branch."
    return 1
  fi
  if ! git -C "$repo_dir" diff --quiet || ! git -C "$repo_dir" diff --cached --quiet; then
    log "ERRORE: clone MAIN con modifiche locali. Aggiornamento dati bloccato per evitare codice non pubblicato."
    return 1
  fi

  MAIN_REPO_DIR="$repo_dir"
  log "Verifico il codice MAIN usato dal Mac: $repo_dir."
  git -C "$repo_dir" fetch --quiet origin main
  local_head="$(git -C "$repo_dir" rev-parse HEAD)"
  remote_head="$(git -C "$repo_dir" rev-parse origin/main)"
  if [ "$local_head" != "$remote_head" ]; then
    merge_base="$(git -C "$repo_dir" merge-base HEAD origin/main)"
    if [ "$merge_base" != "$local_head" ]; then
      log "ERRORE: il clone MAIN è avanti o divergente rispetto a origin/main. Aggiornamento dati bloccato."
      return 1
    fi
    log "Clone MAIN arretrato: eseguo solo un fast-forward a origin/main."
    git -C "$repo_dir" merge --ff-only --quiet origin/main
  fi

  if [ "$external_repo" != "1" ]; then
    log "Codice locale allineato a origin/main: $(git -C "$repo_dir" rev-parse HEAD)."
    if [ "$SYNC_RESTARTED" != "1" ] && [ "$local_head" != "$remote_head" ]; then
      log "Codice aggiornato. Riavvio il processo con gli script appena allineati."
      if [ -n "$AS_OF" ]; then
        ARERA_SYNC_RESTARTED=1 exec bash "$ROOT_DIR/scripts/aggiorna-arera-locale-mac.sh" "$AS_OF"
      else
        ARERA_SYNC_RESTARTED=1 exec bash "$ROOT_DIR/scripts/aggiorna-arera-locale-mac.sh"
      fi
    fi
    return 0
  fi

  local changed=0
  local rel
  for rel in \
    scripts/aggiorna-arera-locale-mac.sh \
    scripts/update-arera-menu.py \
    scripts/update-arera-reference-data.py \
    scripts/update-regulated-parameters.py \
    scripts/update-energy-today.py \
    scripts/update-sitemap-lastmod.py \
    scripts/validate-calculator-data.mjs \
    public/index.html \
    data/offerte-proposte.json \
    public/data/offerte-proposte.json \
    .github/workflows/update-arera-menu.yml
  do
    if [ ! -f "$repo_dir/$rel" ]; then
      log "ERRORE: file MAIN necessario non trovato: $repo_dir/$rel"
      return 1
    fi
    if ! cmp -s "$repo_dir/$rel" "$ROOT_DIR/$rel"; then
      mkdir -p "$ROOT_DIR/$(dirname "$rel")"
      cp "$repo_dir/$rel" "$ROOT_DIR/$rel"
      changed=1
      log "Codice Mac allineato da MAIN: $rel"
    fi
  done
  chmod +x "$ROOT_DIR/scripts/aggiorna-arera-locale-mac.sh"

  if [ "$changed" = "1" ]; then
    if [ "$SYNC_RESTARTED" = "1" ]; then
      log "ERRORE: il codice continua a cambiare dopo il riavvio di sincronizzazione. Aggiornamento bloccato."
      return 1
    fi
    log "Codice del Mac aggiornato dal clone MAIN. Riavvio il processo prima di scaricare ARERA."
    if [ -n "$AS_OF" ]; then
      ARERA_SYNC_RESTARTED=1 exec bash "$ROOT_DIR/scripts/aggiorna-arera-locale-mac.sh" "$AS_OF"
    else
      ARERA_SYNC_RESTARTED=1 exec bash "$ROOT_DIR/scripts/aggiorna-arera-locale-mac.sh"
    fi
  fi

  log "Codice della cartella dati già identico al clone MAIN: $(git -C "$repo_dir" rev-parse HEAD)."
}

ensure_static_surfaces_from_main() {
  if [ -z "$MAIN_REPO_DIR" ] || [ "$MAIN_REPO_DIR" = "$ROOT_DIR" ]; then
    return 0
  fi

  local rel
  for rel in \
    public/pun-oggi.html \
    public/psv-gas-oggi.html \
    public/offerte-luce-gas-aggiornate.html \
    public/sitemap.xml
  do
    if [ ! -f "$MAIN_REPO_DIR/$rel" ]; then
      log "AVVISO: superficie pubblica non trovata nel MAIN: $MAIN_REPO_DIR/$rel. Gli altri dataset continueranno."
      continue
    fi
    if [ -f "$ROOT_DIR/$rel" ] && cmp -s "$MAIN_REPO_DIR/$rel" "$ROOT_DIR/$rel"; then
      continue
    fi
    mkdir -p "$ROOT_DIR/$(dirname "$rel")"
    cp "$MAIN_REPO_DIR/$rel" "$ROOT_DIR/$rel"
    log "Superficie pubblica allineata dal MAIN: $rel"
  done
}

snapshot_group() {
  local group="$1"
  shift
  local dir="$STAGING_DIR/rollback/$group"
  rm -rf "$dir"
  mkdir -p "$dir"
  local rel
  for rel in "$@"; do
    mkdir -p "$dir/$(dirname "$rel")"
    if [ -f "$ROOT_DIR/$rel" ]; then
      cp -p "$ROOT_DIR/$rel" "$dir/$rel"
    else
      : > "$dir/$rel.__missing__"
    fi
  done
}

restore_group() {
  local group="$1"
  shift
  local dir="$STAGING_DIR/rollback/$group"
  local rel
  for rel in "$@"; do
    if [ -f "$dir/$rel.__missing__" ]; then
      rm -f "$ROOT_DIR/$rel"
    elif [ -f "$dir/$rel" ]; then
      mkdir -p "$ROOT_DIR/$(dirname "$rel")"
      cp -p "$dir/$rel" "$ROOT_DIR/$rel"
    fi
  done
}

cleanup() {
  local status=$?
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
  log "AVVISO: nessuna terna ARERA E/G/D completa e valida trovata negli ultimi $DAYS_BACK giorni."
  log "Il catalogo offerte resterà all'ultima versione valida; gli altri dataset continueranno ad aggiornarsi."
fi

ensure_static_surfaces_from_main

CORE_FILES=(
  "data/calcolo-parametri.json"
  "public/data/calcolo-parametri.json"
  "data/offerte-arera-menu.json"
  "public/data/offerte-arera-menu.json"
  "data/arera-update-report.json"
)
PARAM_FILES=(
  "data/calcolo-parametri.json"
  "public/data/calcolo-parametri.json"
)
OFFER_FILES=(
  "data/offerte-arera-menu.json"
  "public/data/offerte-arera-menu.json"
  "data/arera-update-report.json"
)
REGULATED_FILES=(
  "data/calcolo-parametri.json"
  "public/data/calcolo-parametri.json"
  ".arera-download/regulatory-source-state.json"
)
ENERGY_FILES=(
  "public/data/energia-oggi.json"
  "public/pun-oggi.html"
  "public/psv-gas-oggi.html"
  "public/sitemap.xml"
)
OFFER_SURFACE_FILES=(
  "public/offerte-luce-gas-aggiornate.html"
  "public/sitemap.xml"
)

snapshot_group "core-base" "${CORE_FILES[@]}"

INDICES_STATUS="mantenuti"
CATALOG_STATUS="mantenuto"
REGULATED_STATUS="mantenuti"
ENERGY_STATUS="mantenuta"
CATALOG_UPDATED=0
REGULATED_UPDATED=0
ENERGY_UPDATED=0

log "Rileggo e convalido gli indici ufficiali ARERA usati dal calcolatore."
if python3 "$ROOT_DIR/scripts/update-arera-reference-data.py" indices --package-root "$ROOT_DIR"; then
  INDICES_STATUS="riletti/convalidati"
else
  log "AVVISO: aggiornamento indici non riuscito. Mantengo gli ultimi indici validi e continuo con gli altri dataset."
  restore_group "core-base" "${PARAM_FILES[@]}"
fi

if [ -n "$SELECTED_DATE" ]; then
  E_FILE="$(basename "$E_PATH")"
  G_FILE="$(basename "$G_PATH")"
  D_FILE="$(basename "$D_PATH")"

  snapshot_group "offers" "${OFFER_FILES[@]}"
  log "Genero e valido il JSON OffertaLogica con:"
  log "- luce: $E_FILE"
  log "- gas: $G_FILE"
  log "- dual: $D_FILE"

  if python3 - "$ROOT_DIR" "$STAGING_DIR" "$SELECTED_DATE" "$E_FILE" "$G_FILE" "$D_FILE" <<'PY'
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
  then
    log "Ricalcolo il benchmark medio usando esattamente il catalogo appena generato."
    if python3 "$ROOT_DIR/scripts/update-arera-reference-data.py" benchmark --package-root "$ROOT_DIR"; then
      CATALOG_UPDATED=1
      CATALOG_STATUS="aggiornato con terna $SELECTED_DATE"
    else
      log "AVVISO: benchmark del nuovo catalogo non valido. Ripristino solo catalogo/parametri e continuo con gli altri dataset."
      restore_group "offers" "${OFFER_FILES[@]}"
      restore_group "core-base" "${PARAM_FILES[@]}"
      CATALOG_STATUS="mantenuto (benchmark non valido)"
      INDICES_STATUS="mantenuti per coerenza col catalogo precedente"
    fi
  else
    log "AVVISO: generazione del catalogo non riuscita. Ripristino solo catalogo/parametri e continuo con gli altri dataset."
    restore_group "offers" "${OFFER_FILES[@]}"
    restore_group "core-base" "${PARAM_FILES[@]}"
    CATALOG_STATUS="mantenuto (generazione non valida)"
    INDICES_STATUS="mantenuti per coerenza col catalogo precedente"
  fi
else
  # Gli indici sono incorporati anche nel catalogo. Senza una terna valida non
  # possono avanzare da soli, altrimenti catalogo e parametri divergerebbero.
  restore_group "core-base" "${PARAM_FILES[@]}"
  INDICES_STATUS="mantenuti per coerenza col catalogo precedente"
fi

# Catalogo + pagina offerte + relativo lastmod sono una singola unità coerente.
# Un errore SEO non deve però bloccare energia o parametri regolati.
snapshot_group "offer-surfaces" "${OFFER_SURFACE_FILES[@]}"
log "Verifico la coerenza SEO tra dataset, pagine e sitemap."
if python3 "$ROOT_DIR/scripts/update-sitemap-lastmod.py" --root "$ROOT_DIR"; then
  if python3 - "$ROOT_DIR" <<'PYSEO'
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
catalog = json.loads((root / "public/data/offerte-arera-menu.json").read_text(encoding="utf-8"))
energy = json.loads((root / "public/data/energia-oggi.json").read_text(encoding="utf-8"))
sitemap = (root / "public/sitemap.xml").read_text(encoding="utf-8")
offers = (root / "public/offerte-luce-gas-aggiornate.html").read_text(encoding="utf-8")
pun_page = (root / "public/pun-oggi.html").read_text(encoding="utf-8")
gas_page = (root / "public/psv-gas-oggi.html").read_text(encoding="utf-8")

def lastmod(url: str) -> str:
    match = re.search(
        rf"<url><loc>{re.escape(url)}</loc><lastmod>(\d{{4}}-\d{{2}}-\d{{2}})</lastmod>",
        sitemap,
    )
    if not match:
        raise RuntimeError(f"URL sitemap non trovata: {url}")
    return match.group(1)

catalog_date = str(catalog.get("aggiornatoIl") or "")
pun_date = str((energy.get("pun") or {}).get("data") or "")
gas_date = str(((energy.get("gas") or {}).get("giornaliero") or {}).get("data") or "")
if lastmod("https://offertalogica.it/offerte-luce-gas-aggiornate.html") != catalog_date:
    raise RuntimeError("lastmod offerte non coerente con il catalogo ARERA")
for url in re.findall(r"<loc>(https://offertalogica\.it/fornitori/[^<]+\.html)</loc>", sitemap):
    if lastmod(url) != catalog_date:
        raise RuntimeError(f"lastmod fornitore non coerente con il catalogo ARERA: {url}")
if lastmod("https://offertalogica.it/pun-oggi.html") != pun_date:
    raise RuntimeError("lastmod PUN sovrascritto da un dataset diverso")
if lastmod("https://offertalogica.it/psv-gas-oggi.html") != gas_date:
    raise RuntimeError("lastmod PSV sovrascritto da un dataset diverso")
if f'"dateModified":"{pun_date}"' not in pun_page:
    raise RuntimeError("dateModified PUN non coerente")
if f'"dateModified":"{gas_date}"' not in gas_page:
    raise RuntimeError("dateModified PSV non coerente")
if not re.search(rf'"dateModified"\s*:\s*"{re.escape(catalog_date)}"', offers):
    raise RuntimeError("dateModified offerte non coerente con il catalogo ARERA")
if 'data-energy-method="pun"' not in pun_page or 'data-energy-method="gas"' not in gas_page:
    raise RuntimeError("sezione Fonti e metodo non gestita dall'updater energia")
print(
    "[ARERA-LOCALE] Coerenza SEO OK: "
    f"catalogo={catalog_date}, PUN={pun_date}, PSV={gas_date}."
)
PYSEO
  then
    :
  else
    log "AVVISO: coerenza SEO offerte non valida. Ripristino il gruppo offerte e continuo."
    restore_group "offer-surfaces" "${OFFER_SURFACE_FILES[@]}"
    if [ "$CATALOG_UPDATED" = "1" ]; then
      restore_group "core-base" "${CORE_FILES[@]}"
      CATALOG_UPDATED=0
      CATALOG_STATUS="mantenuto (superficie SEO non valida)"
      INDICES_STATUS="mantenuti per coerenza col catalogo precedente"
    fi
  fi
else
  log "AVVISO: aggiornamento superficie SEO offerte non riuscito. Ripristino il gruppo offerte e continuo."
  restore_group "offer-surfaces" "${OFFER_SURFACE_FILES[@]}"
  if [ "$CATALOG_UPDATED" = "1" ]; then
    restore_group "core-base" "${CORE_FILES[@]}"
    CATALOG_UPDATED=0
    CATALOG_STATUS="mantenuto (superficie SEO non aggiornata)"
    INDICES_STATUS="mantenuti per coerenza col catalogo precedente"
  fi
fi

log "Eseguo la validazione completa del calcolatore e del contratto dati core."
if ! (cd "$ROOT_DIR" && node scripts/validate-calculator-data.mjs); then
  log "AVVISO: il gruppo catalogo/parametri corrente non supera la validazione. Ripristino il core precedente; energia continuerà indipendentemente."
  restore_group "core-base" "${CORE_FILES[@]}"
  CATALOG_UPDATED=0
  CATALOG_STATUS="mantenuto (validazione core non superata)"
  INDICES_STATUS="mantenuti (validazione core non superata)"
  # Riallinea pagina offerte e relativi lastmod al catalogo ripristinato senza
  # toccare i lastmod energia.
  if ! python3 "$ROOT_DIR/scripts/update-sitemap-lastmod.py" --root "$ROOT_DIR"; then
    log "AVVISO: impossibile riallineare la superficie offerte dopo il ripristino core."
  fi
fi

snapshot_group "energy" "${ENERGY_FILES[@]}"
log "Aggiorno e convalido i riferimenti energia giornalieri ARERA/GME."
if ensure_pdf_reader && python3 "$ROOT_DIR/scripts/update-energy-today.py" \
  --output "$ROOT_DIR/public/data/energia-oggi.json" \
  --params "$ROOT_DIR/public/data/calcolo-parametri.json" \
  --pun-page "$ROOT_DIR/public/pun-oggi.html" \
  --gas-page "$ROOT_DIR/public/psv-gas-oggi.html" \
  --sitemap "$ROOT_DIR/public/sitemap.xml"
then
  if python3 - "$ROOT_DIR" <<'PYSEO'
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
catalog = json.loads((root / "public/data/offerte-arera-menu.json").read_text(encoding="utf-8"))
energy = json.loads((root / "public/data/energia-oggi.json").read_text(encoding="utf-8"))
sitemap = (root / "public/sitemap.xml").read_text(encoding="utf-8")
offers = (root / "public/offerte-luce-gas-aggiornate.html").read_text(encoding="utf-8")
pun_page = (root / "public/pun-oggi.html").read_text(encoding="utf-8")
gas_page = (root / "public/psv-gas-oggi.html").read_text(encoding="utf-8")

def lastmod(url: str) -> str:
    match = re.search(
        rf"<url><loc>{re.escape(url)}</loc><lastmod>(\d{{4}}-\d{{2}}-\d{{2}})</lastmod>",
        sitemap,
    )
    if not match:
        raise RuntimeError(f"URL sitemap non trovata: {url}")
    return match.group(1)

catalog_date = str(catalog.get("aggiornatoIl") or "")
pun_date = str((energy.get("pun") or {}).get("data") or "")
gas_date = str(((energy.get("gas") or {}).get("giornaliero") or {}).get("data") or "")
if lastmod("https://offertalogica.it/offerte-luce-gas-aggiornate.html") != catalog_date:
    raise RuntimeError("lastmod offerte non coerente con il catalogo ARERA")
for url in re.findall(r"<loc>(https://offertalogica\.it/fornitori/[^<]+\.html)</loc>", sitemap):
    if lastmod(url) != catalog_date:
        raise RuntimeError(f"lastmod fornitore non coerente con il catalogo ARERA: {url}")
if lastmod("https://offertalogica.it/pun-oggi.html") != pun_date:
    raise RuntimeError("lastmod PUN sovrascritto da un dataset diverso")
if lastmod("https://offertalogica.it/psv-gas-oggi.html") != gas_date:
    raise RuntimeError("lastmod PSV sovrascritto da un dataset diverso")
if f'"dateModified":"{pun_date}"' not in pun_page:
    raise RuntimeError("dateModified PUN non coerente")
if f'"dateModified":"{gas_date}"' not in gas_page:
    raise RuntimeError("dateModified PSV non coerente")
if not re.search(rf'"dateModified"\s*:\s*"{re.escape(catalog_date)}"', offers):
    raise RuntimeError("dateModified offerte non coerente con il catalogo ARERA")
if 'data-energy-method="pun"' not in pun_page or 'data-energy-method="gas"' not in gas_page:
    raise RuntimeError("sezione Fonti e metodo non gestita dall'updater energia")
print(
    "[ARERA-LOCALE] Coerenza SEO OK: "
    f"catalogo={catalog_date}, PUN={pun_date}, PSV={gas_date}."
)
PYSEO
  then
    ENERGY_UPDATED=1
    ENERGY_STATUS="riletta/convalidata"
  else
    log "AVVISO: dati energia generati ma superfici SEO non coerenti. Ripristino solo il gruppo energia."
    restore_group "energy" "${ENERGY_FILES[@]}"
    ENERGY_STATUS="mantenuta (coerenza SEO non superata)"
  fi
else
  log "AVVISO: aggiornamento energia non riuscito. Mantengo l'ultima versione valida e continuo."
  restore_group "energy" "${ENERGY_FILES[@]}"
  ENERGY_STATUS="mantenuta (acquisizione non riuscita)"
fi

# I parametri regolati sono deliberatamente l'ultimo gruppo acquisito: un loro
# errore o rallentamento non deve impedire che offerte ed energia già valide
# siano disponibili al publisher GitHub.
snapshot_group "regulated" "${REGULATED_FILES[@]}"
log "Controllo i parametri regolati dalle fonti ufficiali ARERA/ADM."
if python3 "$ROOT_DIR/scripts/update-regulated-parameters.py" --package-root "$ROOT_DIR"; then
  if (cd "$ROOT_DIR" && node scripts/validate-calculator-data.mjs); then
    REGULATED_UPDATED=1
    REGULATED_STATUS="controllati/aggiornati"
  else
    log "AVVISO: parametri regolati aggiornati ma core non coerente. Ripristino solo i parametri regolati."
    restore_group "regulated" "${REGULATED_FILES[@]}"
    REGULATED_STATUS="mantenuti (validazione core non superata)"
  fi
else
  log "AVVISO: parametri regolati non aggiornabili. Mantengo l'ultima versione valida; offerte ed energia restano disponibili."
  restore_group "regulated" "${REGULATED_FILES[@]}"
  REGULATED_STATUS="mantenuti (controllo non superato)"
fi

if [ "$CATALOG_UPDATED" = "1" ]; then
  rm -f \
    "$DOWNLOAD_DIR"/PO_Offerte_E_MLIBERO_*.xml \
    "$DOWNLOAD_DIR"/PO_Offerte_G_MLIBERO_*.xml \
    "$DOWNLOAD_DIR"/PO_Offerte_D_MLIBERO_*.xml \
    "$DOWNLOAD_DIR"/*.part
  cp -f "$E_PATH" "$G_PATH" "$D_PATH" "$DOWNLOAD_DIR/"
fi

log "Aggiornamento giornaliero completato per gruppi indipendenti."
log "- offerte ARERA: $CATALOG_STATUS"
log "- indici/benchmark: $INDICES_STATUS"
log "- parametri regolati: $REGULATED_STATUS"
log "- energia PUN/IG/PSV: $ENERGY_STATUS"
log "Superfici pubbliche gestite in coerenza con i rispettivi dataset:"
log "- public/offerte-luce-gas-aggiornate.html"
log "Un dataset mantenuto alla data precedente non impedisce l'aggiornamento degli altri dataset validi."
