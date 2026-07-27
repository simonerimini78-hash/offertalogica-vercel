# OffertaLogica — consolidamento finale lettore IA e multi-fornitore

Questo pacchetto sostituisce integralmente il precedente pacchetto v1.0.7, che non deve essere applicato separatamente.

## Perimetro

- conserva il lettore visuale IA v1.0.6 già collaudato;
- rimuove il vecchio stack OCR/parser/ibrido e i relativi test, dipendenze e documenti obsoleti;
- corregge esclusivamente l'unione frontend di bollette luce e gas dello stesso cliente;
- non modifica API, prompt IA, cataloghi, comparatore, prezzi o workflow ARERA.

## Caso riprodotto

Due normali PDF dello stesso intestatario e codice fiscale:

- luce HERA COMM S.p.A., codice cliente 1012697711;
- gas Edison Energia S.p.A., codice cliente 1001133382.

Le letture individuali erano corrette. L'errore era nel merge frontend, che dipendeva dall'ordine dei documenti e lasciava che l'ultimo PDF rendesse non applicabili i campi dell'altra commodity.

## Regole finali

- luce e gas restano separati per fornitore, codice cliente, indirizzo, identificativo e dati economici;
- il frontend non sceglie un valore comune quando i valori differiscono;
- un target condiviso con valori differenti viene bloccato;
- l'ordine di caricamento non modifica il risultato;
- un campo mancante non viene inventato o copiato dall'altra commodity.

## Applicazione

Da Terminale, dopo aver estratto lo ZIP:

```bash
./applica-consolidamento.sh /percorso/della-copia-locale/offertalogica-vercel
```

Poi:

```bash
cd /percorso/della-copia-locale/offertalogica-vercel
node --test test/*.test.mjs
npm run verify:offers
```

Esito atteso della suite consolidata: 119 test superati, 0 falliti.

## Aggiornamento di main

Al momento della preparazione, `main` contiene un aggiornamento ARERA giornaliero successivo al branch di lavoro. Prima del merge finale il branch deve essere aggiornato da `main`. Questo pacchetto non contiene e non sostituisce i due cataloghi ARERA, quindi l'aggiornamento giornaliero resta separato e viene conservato.

Lo script non esegue commit, push o merge.
