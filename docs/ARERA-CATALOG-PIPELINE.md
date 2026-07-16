# Pipeline catalogo ARERA

## Trasformazione canonica

L'unico file autorizzato a calcolare `prezzo`, `quotaFissaAnnua` e
`qualitaPrezzo` del catalogo pubblico e `scripts/update-arera-menu.py`.

Il flusso e:

1. XML ARERA/AU luce e gas;
2. estrazione in staging con provenienza di ogni valore;
3. selezione semantica del prezzo principale;
4. confronto con l'ultimo record validato;
5. quarantena dei cambiamenti inattesi;
6. pubblicazione atomica in `data/offerte-arera-menu.json` e
   `public/data/offerte-arera-menu.json`.

`media_fasce`, componenti di dispacciamento/capacita/commercializzazione,
adeguamenti consumo, valori futuri e unita non compatibili non sono qualita
pubblicabili.

## Punti che possono avviare l'aggiornamento

- `.github/workflows/update-arera-menu.yml`: esegue la trasformazione canonica.
- `scripts/aggiorna-arera-locale-mac.sh`: scarica gli XML e richiama la stessa
  trasformazione canonica.
- `scripts/build-public-arera-menu.mjs`: ingresso di compatibilita; delega al
  trasformatore Python e non calcola prezzi.
- `offertalogica-v24-provider-loghi-20260705/scripts/update-arera-menu.py` e
  `build-public-arera-menu.mjs`: vecchi ingressi conservati come wrapper; non
  contengono piu logiche di prezzo autonome.

## File che non pubblicano il catalogo

- `scripts/sync-arera-open-data.mjs` calcola `prezzo_calcolo` e aggiorna i
  candidati CSV; questo valore non puo piu essere pubblicato direttamente.
- `scripts/shortlist-arera-candidates.mjs` legge `prezzo_calcolo` e prepara la
  shortlist, senza scrivere il catalogo pubblico.
- `scripts/promote-arera-offer.mjs` modifica il catalogo separato delle offerte
  proposte (`data/offerte-proposte.json`), non `offerte-arera-menu.json`.
- `scripts/test-ranking-arera.mjs` e `scripts/verify-calcolo-offerte.mjs` leggono
  il catalogo e producono report; non ne cambiano i prezzi.
- `public/index.html` legge `prezzo` e `qualitaPrezzo`; la funzione
  `risolviPrezzoVariabile` applica l'indice PUN/PSV durante il calcolo a video,
  ma non scrive ne modifica il catalogo JSON.

## Diagnostica

- Lo staging completo e salvato in
  `data/.arera-staging/offerte-arera-menu-staging.json` e conservato come
  artefatto del workflow per 90 giorni.
- Scarti e quarantena sono riepilogati in `data/arera-update-report.json`.
- I valori sintetici verificati che non possono essere derivati in sicurezza
  dall'XML sono dichiarati in `data/arera-verified-price-overrides.json` con
  sorgente e dettagli tecnici separati.
