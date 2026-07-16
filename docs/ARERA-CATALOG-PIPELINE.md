# Pipeline catalogo ARERA v93

## Fonte unica

`scripts/update-arera-menu.py` e l'unica funzione che trasforma gli XML ARERA/AU in prezzi pubblicabili. Calcolatore, ranking, pagina SEO, pagine fornitore e card partner leggono `public/data/offerte-arera-menu.json`.

## Flusso

1. Gli XML luce e gas vengono scaricati o forniti localmente.
2. Tutte le righe interpretate vengono scritte in `data/.arera-staging/`.
3. Ogni riga viene validata per codice, validita, clientela, commodity, unita, prezzo, quota fissa e provenienza.
4. Righe ambigue, incomplete o anomale vengono inserite nel report di quarantena.
5. I metadati partner non economici vengono associati solo alle righe validate correnti.
6. Catalogo e report sostituiscono insieme le quattro copie `data/` e `public/data/`.
7. Se una sostituzione si interrompe, tutte le copie vengono ripristinate.

Non esiste alcun merge selettivo con il catalogo precedente. Il catalogo precedente resta disponibile solo integralmente quando il nuovo aggiornamento fallisce.

## Origine della regressione Axpo

Il catalogo pubblicato prima della v93 proveniva da una versione storica di `scripts/update-arera-menu.py`. La funzione `representative_price` raccoglieva valori economici eterogenei e ne calcolava la media, marcandola come `media_fasce`.

Questo percorso aveva prodotto:

- Axpo luce `0.066595 €/kWh`, media di prezzo per fascia, opzione verde, adeguamento e zero;
- Axpo gas `0.25051333 €/Smc`, media di componente gas, quota variabile e bilanciamento.

La v93 blocca `media_fasce`, `somma_componenti` e ogni fallback analogo. I casi Axpo ammessi sono sintesi documentali legate agli esatti codici correnti e vengono applicate solo quando identita, commodity, clientela, tipo prezzo, durata e validita coincidono con l'XML del giorno.

## File rimossi

I seguenti percorsi duplicavano o alimentavano cataloghi paralleli e sono stati eliminati:

- `data/offerte-proposte.json` e `public/data/offerte-proposte.json`;
- `scripts/sync-arera-open-data.mjs`;
- `scripts/shortlist-arera-candidates.mjs`;
- `scripts/promote-arera-offer.mjs`;
- shortlist, candidati e registri economici statici collegati;
- copie di vecchie versioni dell'app conservate dentro il repository.

## Report staff

`public/staff-analytics.html` legge `public/data/arera-update-report.json` dopo l'autorizzazione staff e mostra conteggi, stato atomico e dettagli delle offerte in quarantena.
