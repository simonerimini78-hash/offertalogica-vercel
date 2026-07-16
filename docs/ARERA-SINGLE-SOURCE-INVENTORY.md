# Inventario fonti e consumatori ARERA v93

## Trasformazione canonica

- `scripts/update-arera-menu.py`: unico parser, normalizzatore, validatore e pubblicatore del catalogo.
- `scripts/build-public-arera-menu.mjs`: wrapper senza logica economica; delega allo script Python.

## Ingressi e orchestrazione

- `.github/workflows/update-arera-menu.yml`: esegue il trasformatore canonico, i test e il commit dei quattro file pubblicati.
- `scripts/download-arera-open-data.sh`: scarica gli XML, senza trasformarli.
- `scripts/aggiorna-arera-locale-mac.sh`: scarica gli XML e chiama il trasformatore canonico.
- `.github/workflows/diagnostica-arera.yml`: verifica solo la raggiungibilita degli URL, senza scrivere cataloghi.

## Dati pubblicati

- `data/offerte-arera-menu.json` e `public/data/offerte-arera-menu.json`: copie identiche del catalogo validato.
- `data/arera-update-report.json` e `public/data/arera-update-report.json`: copie identiche del report di validazione e quarantena.
- `data/.arera-staging/`: staging locale ignorato da Git.

## Supplementi controllati

- `data/partner-metadata.json`: logo, URL, testo e priorita non economica. I campi economici sono rifiutati.
- `data/arera-verified-price-overrides.json`: sintesi documentali eccezionali legate a codice, nome, commodity, clientela, tipo, durata e validita esatti dell'XML corrente. Non e letto dal frontend e non genera card autonome.
- `data/provider-brand.json`: solo identita visiva.
- `data/calcolo-parametri.json`: parametri generali del calcolo, non listino offerte.

## Consumatori pubblici

- `public/index.html`: calcolatore e ranking.
- `public/offerte-luce-gas-aggiornate.html`: pagina SEO.
- `public/fornitori/a2a.html`.
- `public/fornitori/alperia.html`.
- `public/fornitori/enel.html`.
- `public/fornitori/eon.html`.
- `public/fornitori/octopus.html`.
- `public/fornitori/plenitude.html`.
- `public/staff-analytics.html`: report diagnostico, non modifica il catalogo.

## Verifiche e report derivati

- `scripts/validate-calculator-data.mjs`.
- `scripts/verify-calcolo-offerte.mjs`.
- `scripts/test-ranking-arera.mjs`.
- `scripts/audit-offers.mjs`.
- `test/update_arera_menu_test.py`.
- `test/areraCatalogConsumers.test.mjs`.

Questi file leggono il catalogo ma non possono pubblicarlo o sostituirne i prezzi.

## Percorsi paralleli rimossi

- `data/offerte-proposte.json` e `public/data/offerte-proposte.json`.
- `scripts/sync-arera-open-data.mjs`.
- `scripts/shortlist-arera-candidates.mjs`.
- `scripts/promote-arera-offer.mjs`.
- `data/arera-candidati-menu.csv`.
- `data/arera-shortlist-manutenzione.csv`.
- `data/arera-sync-meta.json`.
- `data/offerte-reali-arera`.
- `data/offerte-reali-arera-candidati.csv`.
- `data/certificazione-offerte.csv`.
- `data/destinazioni-offerte.csv`.
- `public/index-preview-pelle-premium.html`.
- cartelle-versione v24, v70 e v75 conservate impropriamente dentro il repository.

## Origine dei valori Axpo errati

La funzione storica `representative_price` in una vecchia revisione di `scripts/update-arera-menu.py` aggregava valori eterogenei e pubblicava `qualitaPrezzo: media_fasce`. Da quel percorso provenivano `0.066595` per Axpo luce e `0.25051333` per Axpo gas. Gli script JavaScript di sync/promozione e la copia v24 potevano poi mantenere cataloghi distinti dal risultato Python.

La v93 elimina questi produttori e blocca esplicitamente `media_fasce`, `somma_componenti` e fallback equivalenti.
