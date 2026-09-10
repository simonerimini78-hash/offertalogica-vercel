#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="/Users/simo78/OffertLogica/offertalogica-v59-arera-update-locale-mac-20260713 5"
REPO_DIR="$HOME/OffertLogica/offertalogica-github-sync"
TODAY="$(date '+%Y-%m-%d')"

PUBLISH_FILES=(
  "data/offerte-arera-menu.json"
  "public/data/offerte-arera-menu.json"
  "data/offerte-arera-history.json"
  "public/data/offerte-arera-history.json"
  "data/arera-update-report.json"
  "data/calcolo-parametri.json"
  "public/data/calcolo-parametri.json"
  "public/data/energia-oggi.json"
  "public/pun-oggi.html"
  "public/psv-gas-oggi.html"
  "public/offerte-luce-gas-aggiornate.html"
  "public/sitemap.xml"
)

log() {
  printf '[GITHUB-SYNC] %s\n' "$1"
}

for relative_path in "${PUBLISH_FILES[@]}"; do
  case "$relative_path" in
    "data/offerte-arera-history.json"|"public/data/offerte-arera-history.json")
      continue
      ;;
  esac
  if [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
    log "ERRORE: file mancante o vuoto: $relative_path"
    exit 1
  fi
done

PUBLISH_DATE="$(python3 - "$SOURCE_ROOT" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
menu = json.loads((root / "data" / "offerte-arera-menu.json").read_text(encoding="utf-8"))
report = json.loads((root / "data" / "arera-update-report.json").read_text(encoding="utf-8"))

menu_date = str(menu.get("aggiornatoIl") or "")
report_date = str(report.get("aggiornatoIl") or "")
menu_version = str(menu.get("versioneDati") or "")
report_version = str(report.get("versioneDati") or "")

if not menu_date or report_date != menu_date:
    raise SystemExit(
        f"Report ARERA non coerente: catalogo={menu_date or 'assente'} report={report_date or 'assente'}"
    )
if not menu_version or report_version != menu_version:
    raise SystemExit(
        f"Versione report ARERA non coerente: catalogo={menu_version or 'assente'} report={report_version or 'assente'}"
    )
if report.get("pubblicazioneAutorizzata") is not True:
    raise SystemExit("Report ARERA non autorizza la pubblicazione")

print(menu_date)
PY
)"

if [ "${ARERA_FORCE_PUBLISH:-0}" != "1" ] && [ "$PUBLISH_DATE" != "$TODAY" ]; then
  log "Nessun aggiornamento ARERA completato per $TODAY."
  log "Ultimo aggiornamento valido disponibile: $PUBLISH_DATE."
  log "GitHub non è stato modificato."
  exit 0
fi

log "Aggiornamento ARERA valido del $PUBLISH_DATE."
log "Aggiorno la copia locale del repository GitHub."
git -C "$REPO_DIR" fetch origin main
git -C "$REPO_DIR" checkout --quiet main
git -C "$REPO_DIR" reset --hard origin/main >/dev/null

ENERGY_PUBLISH=1
if [ -s "$REPO_DIR/public/data/energia-oggi.json" ]; then
  ENERGY_DECISION="$(python3 - "$SOURCE_ROOT/public/data/energia-oggi.json" "$REPO_DIR/public/data/energia-oggi.json" <<'PYENERGY'
import json
import sys
from pathlib import Path

source = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
repo = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
source_date = str(source.get("aggiornatoIl") or "")
repo_date = str(repo.get("aggiornatoIl") or "")

if not source_date:
    raise SystemExit("Data energia locale assente")

if repo_date and source_date < repo_date:
    print(f"SKIP|{source_date}|{repo_date}")
else:
    print(f"PUBLISH|{source_date}|{repo_date or 'assente'}")
PYENERGY
  )"

  IFS='|' read -r ENERGY_ACTION ENERGY_SOURCE_DATE ENERGY_REPO_DATE <<< "$ENERGY_DECISION"
  if [ "$ENERGY_ACTION" = "SKIP" ]; then
    ENERGY_PUBLISH=0
    log "Dati energia locali del $ENERGY_SOURCE_DATE più vecchi di GitHub ($ENERGY_REPO_DATE): mantengo la versione GitHub."
  else
    log "Dati energia pubblicabili: locale=$ENERGY_SOURCE_DATE GitHub=$ENERGY_REPO_DATE."
  fi
fi

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

for relative_path in "${PUBLISH_FILES[@]}"; do
  if [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
    log "ERRORE: file mancante o vuoto dopo l'elaborazione: $relative_path"
    exit 1
  fi
done

# Il report diagnostico deve riferirsi esattamente allo stesso catalogo che sta
# per essere pubblicato. In questo modo non può più restare indietro su GitHub.
python3 - "$SOURCE_ROOT" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
menu = json.loads((root / "data" / "offerte-arera-menu.json").read_text(encoding="utf-8"))
report = json.loads((root / "data" / "arera-update-report.json").read_text(encoding="utf-8"))

menu_date = str(menu.get("aggiornatoIl") or "")
report_date = str(report.get("aggiornatoIl") or "")
menu_version = str(menu.get("versioneDati") or "")
report_version = str(report.get("versioneDati") or "")

if not menu_date or report_date != menu_date:
    raise SystemExit(
        f"Report ARERA non coerente: catalogo={menu_date or 'assente'} report={report_date or 'assente'}"
    )
if not menu_version or report_version != menu_version:
    raise SystemExit(
        f"Versione report ARERA non coerente: catalogo={menu_version or 'assente'} report={report_version or 'assente'}"
    )
if report.get("pubblicazioneAutorizzata") is not True:
    raise SystemExit("Report ARERA non autorizza la pubblicazione")

print(f"[GITHUB-SYNC] Report ARERA coerente con il catalogo del {menu_date}.")
PY

for relative_path in "${PUBLISH_FILES[@]}"; do
  if [ "$ENERGY_PUBLISH" = "0" ]; then
    case "$relative_path" in
      "public/data/energia-oggi.json"|"public/pun-oggi.html"|"public/psv-gas-oggi.html")
        continue
        ;;
    esac
  fi

  mkdir -p "$REPO_DIR/$(dirname "$relative_path")"
  cp "$SOURCE_ROOT/$relative_path" "$REPO_DIR/$relative_path"
done

log "Verifico la coerenza completa prima della pubblicazione GitHub."

python3 "$REPO_DIR/test/update_sitemap_lastmod_test.py"

git -C "$REPO_DIR" add -- "${PUBLISH_FILES[@]}"

if git -C "$REPO_DIR" diff --cached --quiet; then
  log "I file su GitHub sono già aggiornati; nessun commit necessario."
  exit 0
fi

git -C "$REPO_DIR" commit \
  -m "Aggiorna offerte e dati ARERA al $PUBLISH_DATE"
git -C "$REPO_DIR" push origin main
log "Caricamento su GitHub completato correttamente."
