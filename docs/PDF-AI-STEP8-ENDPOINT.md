# Punto 8.3 — collegamento controllato all'endpoint PDF

## Obiettivo

Collegare l'orchestratore visuale del Punto 8.2 a `api/analyze-pdf.js` senza modificare il risultato pubblico prodotto dal parser deterministico e dall'OCR.

## Percorso attivo

L'endpoint usa un solo percorso AI:

1. `api/analyze-pdf.js` completa parser e OCR;
2. `lib/pdfAiEndpoint.js` applica i vincoli dell'endpoint;
3. `lib/pdfAiShadow.js` applica la policy e coordina il client;
4. `lib/pdfAiClient.js` effettua l'eventuale richiesta strutturata;
5. `lib/pdfAiMerge.js` costruisce soltanto un piano privato non applicato;
6. `lib/pdfArchive.js` conserva il sidecar esclusivamente nell'archivio privato.

Il vecchio `runPdfReaderShadow()` non è più importato dall'endpoint.

## Condizioni necessarie per leggere e inviare il PDF

Devono essere vere contemporaneamente tutte queste condizioni:

- `PDF_AI_MODE=shadow`;
- `PDF_AI_MODEL` configurato lato server;
- chiave provider configurata lato server;
- archivio PDF privato realmente configurato;
- campo multipart dedicato `pdfAiConsent` valorizzato esplicitamente;
- dimensione e numero pagine entro i limiti;
- budget temporale sufficiente.

Il consenso generico al servizio, al marketing o ai partner non viene interpretato come consenso AI.

## Lettura differita del file

Il file temporaneo non viene letto in memoria per l'AI finché la policy non ha autorizzato il tentativo. In modalità off, senza archivio o senza consenso, il loader del PDF non viene eseguito.

## Contratto pubblico invariato

La risposta resta:

```json
{
  "ok": true,
  "normalized": {},
  "archive": {}
}
```

Il sidecar `aiShadow` non viene restituito al browser e non viene inserito dentro `normalized`. Viene aggiunto soltanto alla copia privata archiviata come `_ai_shadow`.

## Frontend attuale

Il frontend pubblico non invia ancora `pdfAiConsent`. Di conseguenza, anche configurando il server in modalità shadow, i normali caricamenti pubblici non effettuano chiamate AI. Questa è una protezione intenzionale del sottostep 8.3.

La prova con PDF reali richiede un successivo controllo staff/Preview dedicato e un consenso esplicito separato.

## Errori

Errori di lettura, timeout, trasporto, output invalido o costruzione del piano:

- non modificano `normalized`;
- non fanno fallire l'analisi deterministica;
- non vengono esposti nel JSON pubblico;
- restano diagnostici privati redatti quando l'archivio è disponibile.

## Variabili ambiente

```text
PDF_AI_MODE=off|shadow
PDF_AI_MODEL=<modello lato server>
OPENAI_API_KEY=<segreto lato server>
PDF_AI_MAX_PAGES=4
PDF_AI_MAX_BYTES=8388608
PDF_AI_TIMEOUT_MS=12000
PDF_AI_RESERVE_MS=3000
PDF_ARCHIVE_MODE=all|problematic
PDF_ARCHIVE_BUCKET=<bucket privato>
SUPABASE_URL=<url lato server>
SUPABASE_SERVICE_ROLE_KEY=<segreto lato server>
```

`fallback` non viene attivato dall'endpoint in questo sottostep.
