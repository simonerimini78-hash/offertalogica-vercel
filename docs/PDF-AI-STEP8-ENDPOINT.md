# PDF AI — Endpoint controllato Step 8.4.1

L'endpoint `api/analyze-pdf.js` mantiene parser e OCR come risultato principale e collega una sola osservazione visuale AI.

## Gate server obbligatori

Prima di leggere il file temporaneo per l'AI devono essere veri:

- modalità `PDF_AI_MODE=shadow`;
- ambiente `VERCEL_ENV=preview`;
- token staff valido;
- archivio PDF privato configurato;
- modello, chiave e limiti tecnici validi.

Non viene letto alcun consenso AI dal browser e non esiste il campo `pdfAiConsent`.

## Risposte

- Production o richiesta non staff: solo `normalized` parser/OCR, senza dati AI.
- Preview staff autorizzata: `normalized` può contenere `ai_preview`, vista sanitizzata e solo revisionabile.
- Il sidecar completo `_ai_shadow` viene conservato esclusivamente nella copia privata archiviata.

Errori, timeout o indisponibilità AI non bloccano mai la normale analisi PDF.
