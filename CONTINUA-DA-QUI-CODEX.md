# CONTINUA DA QUI — OffertaLogica

Ultimo aggiornamento: 22 luglio 2026

Questo file è il punto di ripartenza autorevole. Non ricostruire il Punto 8 copiando il branch storico contaminato.

## Repository e branch

- repository: `simonerimini78-hash/offertalogica-vercel`;
- `main`: Punto 7 OCR pulito più aggiornamenti ARERA e correzioni del sito;
- branch di lavoro: `lettore-pdf-ocr-AI-step8`;
- branch storico da non unire: `lettore-pdf-ocr-step7`;
- prima di collegare l'endpoint, riallineare il branch Punto 8 con il `main` aggiornato e risolvere esplicitamente ogni conflitto.

## Regola architetturale permanente

Tutte le migliorie del lettore devono funzionare sulle bollette di tutti i fornitori.

- nessuna logica centrale basata sul nome del fornitore;
- nessuna coordinata, testo o layout hardcoded per un singolo PDF;
- estrazione basata su etichette, struttura, unità, contesto semantico ed evidenza;
- eventuali regole specifiche isolate solo come fallback documentato;
- test con fornitori, layout e terminologie differenti;
- una modifica è invalida se corregge un PDF ma peggiora la generalizzazione;
- in caso di ambiguità, preferire revisione esplicita a una supposizione.

## Punto 7 — completato

- parser deterministico prima fonte;
- OCR PDFium/Tesseract italiano solo quando necessario;
- OCR non sovrascrive valori deterministici;
- candidati OCR revisionabili e non preselezionati;
- suite OCR storica: `40/40`.

## Punto 8.0 — fondazione completata

File:

- `lib/pdfAiConfig.js`;
- `lib/pdfAiSchema.js`;
- `lib/pdfAiPolicy.js`;
- `lib/pdfAiMerge.js`.

Garanzie:

- modalità `off`, `shadow`, `fallback`, default `off`;
- modello solo da ambiente;
- consenso esplicito;
- limiti di pagine, byte, timeout e riserva;
- campi AI limitati a classificazione e identità;
- prezzi, consumi, quote, spread, indici e offerte esclusi;
- merge non distruttivo, nessun autofill.

## Punto 8.1 — client isolato completato

File:

- `lib/pdfAiClient.js`;
- `test/pdfAiClientStep8.test.mjs`;
- `docs/PDF-AI-STEP8-CLIENT.md`.

Garanzie:

- `store: false`, `background: false`;
- schema JSON rigoroso e validazione locale;
- timeout con `AbortController`;
- trasporto iniettabile;
- errori normalizzati e redatti;
- nessuna rete nei test;
- nessuna integrazione con l'endpoint.

## Punto 8.2 — orchestratore shadow completato nel pacchetto corrente

Nuovi file:

- `lib/pdfAiShadow.js`;
- `test/pdfAiShadowStep8.test.mjs`;
- `docs/PDF-AI-STEP8-SHADOW.md`.

Comportamento:

- modalità eseguibile: solo `shadow`;
- usa `shouldAttemptPdfAi()`;
- usa `runPdfAiReview()` soltanto dopo autorizzazione;
- costruisce `buildPdfAiReviewPlan()` su copie private;
- restituisce un sidecar diagnostico e revisionabile;
- risultato pubblico invariato;
- timeout ed errori non bloccanti;
- nessun collegamento a `api/analyze-pdf.js`;
- nessun costo AI nel flusso pubblico attuale.

## Verifiche Punto 8.2

- modalità off: nessuna chiamata;
- consenso mancante: nessuna chiamata;
- fallback: bloccato dall'orchestratore shadow;
- successo: sidecar con `review_plan.applied=false`;
- timeout, eccezioni e piano invalido: non bloccanti;
- oggetto normalizzato non mutato;
- nomi di fornitori diversi: stesso comportamento;
- PDF e segreti assenti dai diagnostici.

## Stato del frontend al 22 luglio 2026

Il fix `6 partner + 3 consulente` deve essere presente in `public/index.html`.
È stato rilevato un caricamento accidentale di un duplicato `index.html` nella radice: mantenere una sola versione applicativa in `public/index.html` ed eliminare il duplicato in radice dopo averne copiato il contenuto corretto.

## Punto 8.3 — endpoint shadow controllato completato

Nuovi file e modifiche:

- nuovo `lib/pdfAiEndpoint.js`;
- modificato `lib/pdfAiShadow.js` con lettura differita del PDF;
- modificato `lib/pdfArchive.js` per il sidecar privato `_ai_shadow`;
- modificato `api/analyze-pdf.js`;
- nuovo `test/pdfAiEndpointStep8.test.mjs`;
- nuovo `docs/PDF-AI-STEP8-ENDPOINT.md`.

Garanzie:

- un solo percorso AI attivo nell'endpoint;
- il vecchio `runPdfReaderShadow()` non è più importato dall'endpoint;
- modalità endpoint ammessa: soltanto `shadow`;
- archivio privato obbligatorio prima dell'invio;
- consenso AI letto soltanto dal campo dedicato `pdfAiConsent`;
- consenso servizio/marketing/partner non riutilizzato;
- il PDF viene letto soltanto dopo autorizzazione della policy;
- `normalized` e risposta JSON pubblica restano invariati;
- sidecar conservato soltanto nella copia privata come `_ai_shadow`;
- errori e timeout restano non bloccanti;
- fallback pubblico ancora disattivato.

Il frontend pubblico non invia ancora `pdfAiConsent`: i normali caricamenti non generano chiamate AI.

## Punto 8.4 — gate Preview staff completato nel pacchetto corrente

File modificati o aggiunti:

- `public/index.html`;
- `api/analyze-pdf.js`;
- `api/staff-preview.js`;
- `lib/staffAuth.js`;
- `lib/pdfAiEndpoint.js`;
- `test/pdfAiEndpointStep8.test.mjs`;
- `test/pdfAiPreviewStep8.test.mjs`;
- `docs/PDF-AI-STEP8-PREVIEW.md`.

Garanzie introdotte:

- controllo consenso AI visibile soltanto in modalità staff e in una Preview completamente configurata;
- checkbox mai preselezionato e azzerato dopo ogni batch;
- token staff inviato separatamente nell'header `X-Staff-Token`;
- verifica server di `VERCEL_ENV=preview`;
- consenso contraffatto in produzione bloccato prima della lettura AI del PDF;
- Preview senza token staff bloccata prima della lettura AI del PDF;
- sidecar AI ancora esclusivamente privato;
- risposta pubblica e autofill invariati;
- fallback pubblico ancora disattivato.

Verifiche locali:

- suite Step 8: `51/51`;
- suite OCR Step 7: `40/40`;
- suite forniture singole: `10/10`;
- verifica offerte: zero errori e zero warning;
- regressione completa: stessi due errori già presenti nel baseline per il file mancante `lib/pdfHybridPolicy.js`, non introdotti dallo Step 8.4.

## Prossimo sottostep esatto — collaudo reale Step 8.4 in Preview

1. configurare le variabili AI, archivio e staff soltanto nell'ambiente Preview;
2. aprire la modalità staff tramite link protetto;
3. provare il percorso senza consenso e confermare zero tentativi AI;
4. provare un corpus anonimizzato multi-fornitore luce, gas e dual con consenso;
5. confrontare parser/OCR con corroborazioni, revisioni e conflitti AI nel sidecar privato;
6. misurare timeout, costi e percentuale di tentativi utili;
7. lasciare il fallback pubblico disattivato.

## Regole permanenti

- parser deterministico > OCR > AI;
- AI seconda opinione, mai fonte dominante;
- AI spenta per default;
- consenso esplicito prima dell'invio;
- nessun valore AI applicato automaticamente;
- nessuna sovrascrittura dei dati validi;
- pagina, etichetta, evidenza e provenienza obbligatorie;
- campi economici esclusi finché non esiste una policy dedicata;
- un sottostep per commit logico;
- test AI, OCR e regressione a ogni sottostep;
- Preview Vercel prima del merge nel `main`.
