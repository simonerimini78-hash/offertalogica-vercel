#!/usr/bin/env sh
set -eu
printf 'Percorso completo del repository: '
read REPO
python3 APPLICA_FIX_ARERA_SOLO_GAS.py "$REPO"
python3 VERIFICA_FIX_ARERA_SOLO_GAS.py "$REPO"
printf '\nHOTFIX APPLICATO E VERIFICATO.\n'
