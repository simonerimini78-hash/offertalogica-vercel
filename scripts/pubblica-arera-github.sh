#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${ARERA_SOURCE_ROOT:-/Users/simo78/OffertLogica/offertalogica-v59-arera-update-locale-mac-20260713 5}"
REPO_DIR="${ARERA_GITHUB_SYNC_REPO:-$HOME/OffertLogica/offertalogica-github-sync}"
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

OFFER_VALID=1
PARAMS_VALID=1
ENERGY_VALID=1
OFFER_PUBLISH=0
PARAMS_PUBLISH=0
ENERGY_PUBLISH=0
OFFER_DATE=""
PARAMS_DATE=""
ENERGY_DATE=""

# Verifica solo i file sorgente indispensabili a ciascun gruppo. Una famiglia
# incompleta viene esclusa senza impedire la pubblicazione delle altre.
for relative_path in "${PUBLISH_FILES[@]}"; do
  case "$relative_path" in
    "data/offerte-arera-history.json"|"public/data/offerte-arera-history.json"|\
    "public/pun-oggi.html"|"public/psv-gas-oggi.html"|\
    public/offerte-*.html|"public/sitemap.xml")
      continue
      ;;
    "data/offerte-arera-menu.json"|"public/data/offerte-arera-menu.json"|"data/arera-update-report.json")
      if [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
        OFFER_VALID=0
        log "AVVISO: gruppo offerte escluso, file mancante o vuoto: $relative_path"
      fi
      ;;
    "data/calcolo-parametri.json"|"public/data/calcolo-parametri.json")
      if [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
        PARAMS_VALID=0
        log "AVVISO: gruppo parametri escluso, file mancante o vuoto: $relative_path"
      fi
      ;;
    "public/data/energia-oggi.json")
      if [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
        ENERGY_VALID=0
        log "AVVISO: gruppo energia escluso, file mancante o vuoto: $relative_path"
      fi
      ;;
  esac
done

if [ "$OFFER_VALID" = "1" ]; then
  if OFFER_DATE="$(python3 - "$SOURCE_ROOT" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
menu = json.loads((root / "data/offerte-arera-menu.json").read_text(encoding="utf-8"))
public_menu = json.loads((root / "public/data/offerte-arera-menu.json").read_text(encoding="utf-8"))
report = json.loads((root / "data/arera-update-report.json").read_text(encoding="utf-8"))

if menu != public_menu:
    raise SystemExit("Catalogo ARERA data/public non identico")
menu_date = str(menu.get("aggiornatoIl") or "")
report_date = str(report.get("aggiornatoIl") or "")
menu_version = str(menu.get("versioneDati") or "")
report_version = str(report.get("versioneDati") or "")
if not menu_date or report_date != menu_date:
    raise SystemExit(f"Report ARERA non coerente: catalogo={menu_date or 'assente'} report={report_date or 'assente'}")
if not menu_version or report_version != menu_version:
    raise SystemExit("Versione report ARERA non coerente con il catalogo")
if report.get("pubblicazioneAutorizzata") is not True:
    raise SystemExit("Report ARERA non autorizza la pubblicazione")
print(menu_date)
PY
  )"; then
    REPO_OFFER_DATE="$(python3 - "$REPO_DIR/data/offerte-arera-menu.json" <<'PY'
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
if not p.exists():
    print("")
else:
    print(str(json.loads(p.read_text(encoding="utf-8")).get("aggiornatoIl") or ""))
PY
    )"
    if [ -n "$REPO_OFFER_DATE" ] && [[ "$OFFER_DATE" < "$REPO_OFFER_DATE" ]]; then
      log "Gruppo offerte locale più vecchio di GitHub: locale=$OFFER_DATE GitHub=$REPO_OFFER_DATE. Mantengo GitHub."
    elif ! cmp -s "$SOURCE_ROOT/data/offerte-arera-menu.json" "$REPO_DIR/data/offerte-arera-menu.json" || \
         ! cmp -s "$SOURCE_ROOT/public/data/offerte-arera-menu.json" "$REPO_DIR/public/data/offerte-arera-menu.json" || \
         ! cmp -s "$SOURCE_ROOT/data/arera-update-report.json" "$REPO_DIR/data/arera-update-report.json"; then
      OFFER_PUBLISH=1
      log "Gruppo offerte pubblicabile: locale=$OFFER_DATE GitHub=${REPO_OFFER_DATE:-assente}."
    else
      log "Gruppo offerte già allineato: $OFFER_DATE."
    fi
  else
    OFFER_VALID=0
    log "AVVISO: gruppo offerte non valido; gli altri gruppi continueranno."
  fi
fi

if [ "$PARAMS_VALID" = "1" ]; then
  if ! cmp -s "$SOURCE_ROOT/data/calcolo-parametri.json" "$SOURCE_ROOT/public/data/calcolo-parametri.json"; then
    PARAMS_VALID=0
    log "AVVISO: gruppo parametri escluso, copie data/public non identiche."
  elif PARAMS_DATE="$(python3 - "$SOURCE_ROOT/data/calcolo-parametri.json" <<'PY'
import json, sys
from pathlib import Path
payload=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
date=str(payload.get("aggiornatoIl") or "")
if not date:
    raise SystemExit("Data parametri assente")
print(date)
PY
  )"; then
    REPO_PARAMS_DATE="$(python3 - "$REPO_DIR/data/calcolo-parametri.json" <<'PY'
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
if not p.exists():
    print("")
else:
    print(str(json.loads(p.read_text(encoding="utf-8")).get("aggiornatoIl") or ""))
PY
    )"
    if [ -n "$REPO_PARAMS_DATE" ] && [[ "$PARAMS_DATE" < "$REPO_PARAMS_DATE" ]]; then
      log "Gruppo parametri locale più vecchio di GitHub: locale=$PARAMS_DATE GitHub=$REPO_PARAMS_DATE. Mantengo GitHub."
    elif ! cmp -s "$SOURCE_ROOT/data/calcolo-parametri.json" "$REPO_DIR/data/calcolo-parametri.json" || \
         ! cmp -s "$SOURCE_ROOT/public/data/calcolo-parametri.json" "$REPO_DIR/public/data/calcolo-parametri.json"; then
      PARAMS_PUBLISH=1
      log "Gruppo parametri pubblicabile: locale=$PARAMS_DATE GitHub=${REPO_PARAMS_DATE:-assente}."
    else
      log "Gruppo parametri già allineato: $PARAMS_DATE."
    fi
  else
    PARAMS_VALID=0
    log "AVVISO: gruppo parametri non valido; gli altri gruppi continueranno."
  fi
fi

if [ "$ENERGY_VALID" = "1" ]; then
  if ENERGY_DATE="$(python3 - "$SOURCE_ROOT/public/data/energia-oggi.json" <<'PY'
import json, sys
from pathlib import Path
payload=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
updated=str(payload.get("aggiornatoIl") or "")
pun=payload.get("pun") or {}
gas=((payload.get("gas") or {}).get("giornaliero") or {})
if not updated or not pun.get("data") or not gas.get("data"):
    raise SystemExit("Dataset energia incompleto")
if not isinstance(pun.get("valoreEurMwh"), (int, float)) or not isinstance(gas.get("valoreEurMwh"), (int, float)):
    raise SystemExit("Valori energia non numerici")
print(updated)
PY
  )"; then
    REPO_ENERGY_DATE="$(python3 - "$REPO_DIR/public/data/energia-oggi.json" <<'PY'
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
if not p.exists():
    print("")
else:
    print(str(json.loads(p.read_text(encoding="utf-8")).get("aggiornatoIl") or ""))
PY
    )"
    if [ -n "$REPO_ENERGY_DATE" ] && [[ "$ENERGY_DATE" < "$REPO_ENERGY_DATE" ]]; then
      log "Gruppo energia locale più vecchio di GitHub: locale=$ENERGY_DATE GitHub=$REPO_ENERGY_DATE. Mantengo GitHub."
    elif ! cmp -s "$SOURCE_ROOT/public/data/energia-oggi.json" "$REPO_DIR/public/data/energia-oggi.json"; then
      ENERGY_PUBLISH=1
      log "Gruppo energia pubblicabile: locale=$ENERGY_DATE GitHub=${REPO_ENERGY_DATE:-assente}."
    else
      log "Gruppo energia già allineato: $ENERGY_DATE."
    fi
  else
    ENERGY_VALID=0
    log "AVVISO: gruppo energia non valido; gli altri gruppi continueranno."
  fi
fi

# Lo storico è parte del gruppo offerte e viene rigenerato solo quando il
# catalogo cambia, evitando riscritture ripetute a catalogo invariato.
if [ "$OFFER_PUBLISH" = "1" ]; then
  mkdir -p "$SOURCE_ROOT/data" "$SOURCE_ROOT/public/data"
  if [ ! -s "$SOURCE_ROOT/data/offerte-arera-history.json" ] && \
     [ -s "$REPO_DIR/data/offerte-arera-history.json" ]; then
    cp "$REPO_DIR/data/offerte-arera-history.json" "$SOURCE_ROOT/data/offerte-arera-history.json"
  fi

  log "Aggiorno lo storico progressivo delle offerte ARERA."
  if ! python3 "$SOURCE_ROOT/scripts/update-arera-history.py" --package-root "$SOURCE_ROOT"; then
    OFFER_PUBLISH=0
    log "AVVISO: storico offerte non aggiornabile. Il gruppo offerte non verrà pubblicato; gli altri gruppi continueranno."
  fi
fi

# Secondo controllo: verifica i soli file che stanno davvero per essere copiati.
for relative_path in "${PUBLISH_FILES[@]}"; do
  case "$relative_path" in
    "data/offerte-arera-menu.json"|"public/data/offerte-arera-menu.json"|\
    "data/offerte-arera-history.json"|"public/data/offerte-arera-history.json"|"data/arera-update-report.json")
      if [ "$OFFER_PUBLISH" = "1" ] && [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
        OFFER_PUBLISH=0
        log "AVVISO: gruppo offerte annullato, file mancante dopo elaborazione: $relative_path"
      fi
      ;;
    "data/calcolo-parametri.json"|"public/data/calcolo-parametri.json")
      if [ "$PARAMS_PUBLISH" = "1" ] && [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
        PARAMS_PUBLISH=0
        log "AVVISO: gruppo parametri annullato, file mancante: $relative_path"
      fi
      ;;
    "public/data/energia-oggi.json")
      if [ "$ENERGY_PUBLISH" = "1" ] && [ ! -s "$SOURCE_ROOT/$relative_path" ]; then
        ENERGY_PUBLISH=0
        log "AVVISO: gruppo energia annullato, file mancante: $relative_path"
      fi
      ;;
  esac
done

if [ "$OFFER_PUBLISH" = "0" ] && [ "$PARAMS_PUBLISH" = "0" ] && [ "$ENERGY_PUBLISH" = "0" ]; then
  log "Nessun dataset valido differisce da GitHub; nessun commit necessario."
  exit 0
fi

# Copia solo i gruppi validi. Le superfici HTML/sitemap vengono rigenerate nel
# clone GitHub usando i dataset effettivamente selezionati, così un gruppo
# vecchio non può sovrascrivere la data di un altro gruppo più recente.
for relative_path in "${PUBLISH_FILES[@]}"; do
  case "$relative_path" in
    "data/offerte-arera-menu.json"|"public/data/offerte-arera-menu.json"|\
    "data/offerte-arera-history.json"|"public/data/offerte-arera-history.json"|"data/arera-update-report.json")
      [ "$OFFER_PUBLISH" = "1" ] || continue
      ;;
    "data/calcolo-parametri.json"|"public/data/calcolo-parametri.json")
      [ "$PARAMS_PUBLISH" = "1" ] || continue
      ;;
    "public/data/energia-oggi.json")
      [ "$ENERGY_PUBLISH" = "1" ] || continue
      ;;
    "public/pun-oggi.html"|"public/psv-gas-oggi.html"|public/offerte-*.html|"public/sitemap.xml")
      continue
      ;;
  esac
  mkdir -p "$REPO_DIR/$(dirname "$relative_path")"
  cp "$SOURCE_ROOT/$relative_path" "$REPO_DIR/$relative_path"
done

if [ "$ENERGY_PUBLISH" = "1" ]; then
  log "Rigenero pagine PUN/PSV e relativi lastmod dal JSON energia selezionato."
  python3 "$REPO_DIR/scripts/update-energy-today.py" \
    --sync-from-json \
    --output "$REPO_DIR/public/data/energia-oggi.json" \
    --pun-page "$REPO_DIR/public/pun-oggi.html" \
    --gas-page "$REPO_DIR/public/psv-gas-oggi.html" \
    --sitemap "$REPO_DIR/public/sitemap.xml"
fi

if [ "$OFFER_PUBLISH" = "1" ]; then
  log "Rigenero pagina offerte e relativi lastmod dal catalogo selezionato."
  python3 "$REPO_DIR/scripts/update-sitemap-lastmod.py" --root "$REPO_DIR"
fi

log "Verifico la coerenza dei gruppi selezionati prima della pubblicazione GitHub."
if [ "$OFFER_PUBLISH" = "1" ] || [ "$PARAMS_PUBLISH" = "1" ]; then
  if ! (cd "$REPO_DIR" && node scripts/validate-calculator-data.mjs); then
    log "ERRORE: validazione core non superata. Nessun commit verrà creato."
    git -C "$REPO_DIR" checkout -- "${PUBLISH_FILES[@]}" 2>/dev/null || true
    exit 1
  fi
fi

if [ "$OFFER_PUBLISH" = "1" ] || [ "$ENERGY_PUBLISH" = "1" ]; then
  if ! python3 "$REPO_DIR/test/update_sitemap_lastmod_test.py"; then
    log "ERRORE: validazione sitemap/superfici non superata. Nessun commit verrà creato."
    git -C "$REPO_DIR" checkout -- "${PUBLISH_FILES[@]}" 2>/dev/null || true
    exit 1
  fi
fi

git -C "$REPO_DIR" add -- "${PUBLISH_FILES[@]}"

if git -C "$REPO_DIR" diff --cached --quiet; then
  log "I dataset selezionati non producono differenze; nessun commit necessario."
  exit 0
fi

COMMIT_SCOPE=""
if [ "$OFFER_PUBLISH" = "1" ]; then
  COMMIT_SCOPE="offerte $OFFER_DATE"
fi
if [ "$PARAMS_PUBLISH" = "1" ]; then
  [ -z "$COMMIT_SCOPE" ] || COMMIT_SCOPE="$COMMIT_SCOPE, "
  COMMIT_SCOPE="${COMMIT_SCOPE}parametri $PARAMS_DATE"
fi
if [ "$ENERGY_PUBLISH" = "1" ]; then
  [ -z "$COMMIT_SCOPE" ] || COMMIT_SCOPE="$COMMIT_SCOPE, "
  COMMIT_SCOPE="${COMMIT_SCOPE}energia $ENERGY_DATE"
fi

# Il push resta l'ultimo passo: GitHub/Vercel ricevono soltanto gruppi già
# validati localmente e nessuna famiglia è subordinata alla data delle offerte.
git -C "$REPO_DIR" commit -m "Aggiorna dati OffertaLogica: $COMMIT_SCOPE"
git -C "$REPO_DIR" push origin main
log "Caricamento su GitHub completato correttamente ($COMMIT_SCOPE)."
log "Esecuzione publisher del $TODAY completata per gruppi indipendenti."
