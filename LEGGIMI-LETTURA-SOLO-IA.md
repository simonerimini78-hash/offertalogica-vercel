# OffertaLogica — lettore solo IA nativo PDF v1.0.1

Base prevista: branch di prova creato dal `main` attuale.

## Correzione del 504

La versione v1.0.0 rasterizzava fino a 12 pagine in PNG prima di chiamare OpenAI. La route dispone di 60 secondi su Vercel, mentre il codice concedeva 55 secondi complessivi e richiedeva almeno 8 secondi residui per avviare la chiamata IA.

Il difetto è stato riprodotto: la rasterizzazione poteva consumare il budget e provocare `openai_insufficient_time_budget`, trasformato dalla route in HTTP 504, prima che OpenAI venisse interrogata.

La v1.0.1 elimina completamente la rasterizzazione server-side:

`PDF originale -> OpenAI Responses API -> JSON Schema strict -> validazione di main -> anteprima utente`

## Percorso attivo

- Il PDF originale viene inviato come `input_file`.
- Non vengono importati o eseguiti parser, OCR, Tesseract, PDFium o shadow reader.
- Non viene aggiunta alcuna API: `api/analyze-pdf.js` sostituisce la route esistente.
- Il numero di file JavaScript in `api/` resta invariato.
- Il frontend, il comparatore, le formule, i cataloghi ARERA, OTP e lead non vengono modificati.
- La risposta usa lo stesso `data_contract` già consumato dalla schermata di revisione.

## Gestione del tempo

- `vercel.json` di `main` configura già `api/analyze-pdf.js` con `maxDuration: 60`.
- La deadline interna predefinita è 52 secondi, lasciando margine alla risposta HTTP e alla pulizia del file temporaneo.
- Il timeout OpenAI predefinito è 46 secondi e non può superare 48 secondi.
- L'archivio PDF viene eseguito solo se restano almeno 7 secondi nel budget interno; in caso contrario la lettura riuscita viene restituita senza attendere l'archiviazione.
- Gli errori restituiscono anche un codice diagnostico, per esempio `AI_TIMEOUT`.

## Modello

Variabile dedicata consigliata:

- `PDF_AI_PRIMARY_MODEL=gpt-4.1-2025-04-14`

La nuova route non eredita più `PDF_AI_MODEL`, che poteva appartenere al vecchio percorso shadow.

Variabili:

- `OPENAI_API_KEY` — obbligatoria.
- `PDF_AI_PRIMARY_MODEL` — opzionale; predefinito `gpt-4.1-2025-04-14`.
- `PDF_AI_TIMEOUT_MS` — opzionale; predefinito `46000`, massimo interno `48000`.
- `PDF_ANALYSIS_DEADLINE_MS` — opzionale; predefinito e massimo interno `52000`.

Le vecchie variabili `PDF_AI_RASTER_SCALE`, `PDF_AI_MAX_RASTER_PAGES` e `PDF_AI_MAX_RASTER_BYTES` non sono più usate.

## File inclusi

- `api/analyze-pdf.js`
- `lib/pdfPureAiReader.js`
- `lib/pdfDataContract.js`
- `test/pdfPureAiReader.test.mjs`
- `LEGGIMI-LETTURA-SOLO-IA.md`

## Verifiche eseguite

- Riproduzione del difetto `openai_insufficient_time_budget` della v1.0.0.
- Controllo sintattico Node dei file runtime.
- Richiesta OpenAI con PDF originale, `store: false` e Structured Output `json_schema` strict.
- Nessun `input_image` e nessuna rasterizzazione.
- Compatibilità con `offertalogica.pdf-data` e con l'anteprima esistente.
- Annualizzazione della quota fissa mensile conservando la derivazione.
- Variabile modello dedicata al lettore primary.
- Test mirati: 4/4 superati.

## Limite della verifica

Non è stata eseguita una chiamata reale all'API OpenAI perché la chiave del progetto non è disponibile nell'ambiente di verifica. Dopo il deployment Preview, controllare nella risposta di `/api/analyze-pdf`:

- `normalized.parser_version = pure-ai-native-pdf-v1.0.1`;
- `normalized.ai.transport_mode = pdf_originale`;
- `normalized.ai.openai_ms` e `normalized.ai.total_ms`;
- in caso di errore, il campo `code` della risposta JSON.
