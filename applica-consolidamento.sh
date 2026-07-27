#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Uso: ./applica-consolidamento.sh /percorso/del/repository" >&2
  exit 2
fi
TARGET="$(cd "$TARGET" && pwd)"

if [[ ! -f "$TARGET/api/analyze-pdf.js" || ! -f "$TARGET/lib/pdfPureAiReader.js" || ! -f "$TARGET/public/index.html" ]]; then
  echo "Destinazione non riconosciuta: mancano i file runtime del lettore" >&2
  exit 3
fi
if ! grep -q 'pure-ai-native-pdf-v1.0.3' "$TARGET/lib/pdfPureAiReader.js"; then
  echo "Base non compatibile: il lettore non è pure-ai-native-pdf-v1.0.3" >&2
  exit 4
fi

OLD_MERGE_MARKER='merged.field_status = { ...(merged.field_status || {}), ...(doc.field_status || {}) };'
NEW_MERGE_MARKER='function mergePdfFieldStatuses(target, source)'
if ! grep -Fq "$OLD_MERGE_MARKER" "$TARGET/public/index.html" && ! grep -Fq "$NEW_MERGE_MARKER" "$TARGET/public/index.html"; then
  echo "Base frontend non riconosciuta: operazione interrotta" >&2
  exit 5
fi

while IFS= read -r relative; do
  [[ -z "$relative" ]] && continue
  rm -f "$TARGET/$relative"
done < "$PACKAGE_DIR/FILES-TO-DELETE.txt"

cp -f "$PACKAGE_DIR/payload/LEGGIMI-LETTURA-SOLO-IA.md" "$TARGET/LEGGIMI-LETTURA-SOLO-IA.md"
cp -f "$PACKAGE_DIR/payload/package.json" "$TARGET/package.json"
cp -f "$PACKAGE_DIR/payload/package-lock.json" "$TARGET/package-lock.json"
cp -f "$PACKAGE_DIR/payload/vercel.json" "$TARGET/vercel.json"
mkdir -p "$TARGET/public" "$TARGET/test"
cp -f "$PACKAGE_DIR/payload/public/index.html" "$TARGET/public/index.html"
cp -f "$PACKAGE_DIR/payload/test/pdfPureAiConsolidation.test.mjs" "$TARGET/test/pdfPureAiConsolidation.test.mjs"
cp -f "$PACKAGE_DIR/payload/test/pdfMultiProviderMerge.test.mjs" "$TARGET/test/pdfMultiProviderMerge.test.mjs"

if ! grep -Fq "$NEW_MERGE_MARKER" "$TARGET/public/index.html"; then
  echo "Verifica post-applicazione fallita: merge multi-documento non presente" >&2
  exit 6
fi
if grep -Eq '"(@hyzyla/pdfium|@tesseract.js-data/ita|tesseract.js|pdf-parse)"' "$TARGET/package.json"; then
  echo "Verifica post-applicazione fallita: dipendenze PDF legacy ancora presenti" >&2
  exit 7
fi

API_COUNT="$(find "$TARGET/api" -maxdepth 1 -type f -name '*.js' | wc -l | tr -d ' ')"
if [[ "$API_COUNT" != "12" ]]; then
  echo "Verifica post-applicazione fallita: route API trovate $API_COUNT, attese 12" >&2
  exit 8
fi

echo "Consolidamento applicato. Nessun commit, push o merge è stato eseguito."
echo "I file data/offerte-arera-menu.json e public/data/offerte-arera-menu.json non sono stati modificati."
echo "Eseguire: cd '$TARGET' && node --test test/*.test.mjs"
