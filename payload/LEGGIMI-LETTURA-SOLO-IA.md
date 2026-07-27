# OffertaLogica — lettore PDF visuale solo IA

## Stato consolidato

Il percorso pubblico `POST /api/analyze-pdf` usa esclusivamente il lettore visuale IA nativo definito in `lib/pdfPureAiReader.js`.

Non sono presenti nel runtime parser PDF testuali, OCR Tesseract, PDFium, lettore ibrido o modalità shadow.

Versioni correnti:

- lettore: `pure-ai-native-pdf-v1.0.3`;
- ingresso PDF: `pdf-ingress-v1.0.3`;
- modello predefinito: `gpt-4.1-2025-04-14`.

## Flusso dei file

### PDF fino a 4.000.000 byte

`browser -> multipart /api/analyze-pdf -> OpenAI Responses`

La risposta espone:

- `ai.ingress_mode = vercel_multipart`;
- `ai.transport_mode = pdf_originale`.

### PDF oltre 4.000.000 byte

`browser -> upload firmato Supabase -> /api/analyze-pdf con ticket -> OpenAI Responses`

La risposta espone:

- `ai.ingress_mode = supabase_signed_upload`.

Il file temporaneo sotto `pending/` viene eliminato nel `finally` della richiesta di analisi.

### Trasporto verso OpenAI

- sotto 12.000.000 byte: `input_file.file_data` Base64;
- da 12.000.000 byte: upload temporaneo a OpenAI Files e `input_file.file_id`;
- il file OpenAI temporaneo viene eliminato in `finally`;
- un solo retry è consentito esclusivamente per HTTP OpenAI 500, 502, 503 e 504, quando resta tempo sufficiente.

## Limiti e validazione

- limite predefinito: 20.000.000 byte, configurabile con `MAX_PDF_BYTES`;
- MIME accettati dal percorso firmato: `application/pdf` e `application/octet-stream`;
- il file deve contenere un header `%PDF-1.x` o `%PDF-2.0` entro i primi 4096 byte;
- eventuali byte estranei prima dell'header vengono rimossi senza modificare il resto del documento;
- dimensione dichiarata, ticket e dimensione scaricata devono coincidere.

## Diagnostica

Gli errori pubblici includono:

- `diagnostic_code`;
- `analysis_stage`;
- `ingress_mode`;
- `elapsed_ms`;
- esito dell'archiviazione diagnostica.

I log Vercel usano gli eventi:

- `[pdf-analysis-error]`;
- `[pdf-analysis-archive-error]`.

## Archiviazione

L'archiviazione usa Supabase Storage e la tabella `pdf_analyses` quando configurata. La route staff esistente consente la pulizia dei record scaduti tramite l'azione `cleanup`.

Variabili principali:

- `OPENAI_API_KEY`;
- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `PDF_ARCHIVE_BUCKET`;
- `PDF_ARCHIVE_MODE`;
- `PDF_ARCHIVE_RETENTION_DAYS`;
- `MAX_PDF_BYTES`.

Variabili opzionali:

- `PDF_AI_PRIMARY_MODEL`;
- `PDF_AI_TIMEOUT_MS`;
- `PDF_AI_RETRY_DELAY_MS`;
- `PDF_AI_FILE_ID_THRESHOLD_BYTES`;
- `PDF_AI_FILE_UPLOAD_TIMEOUT_MS`;
- `PDF_AI_FILE_DELETE_TIMEOUT_MS`;
- `PDF_ANALYSIS_DEADLINE_MS`.

## File runtime del lettore

- `api/analyze-pdf.js`;
- `lib/pdfPureAiReader.js`;
- `lib/pdfFileValidation.js`;
- `lib/pdfAnalysisDiagnostics.js`;
- `lib/pdfArchive.js`;
- `lib/pdfDataContract.js`;
- `lib/pdfFieldValidation.js`;
- `public/index.html`.

## Vincoli verificati

- le route API restano 12;
- il comparatore e il catalogo ARERA non vengono modificati dal lettore;
- il bucket deve essere privato e avere un limite almeno pari a `MAX_PDF_BYTES`;
- i risultati visuali restano soggetti alla schermata di controllo dell'utente.

## Limite noto

Un PDF fotografico può essere formalmente valido ma costruito con geometrie di pagina anomale che causano un errore interno del servizio IA. Non è presente una trasformazione automatica dedicata a singoli documenti o fornitori: eventuali fallback generali devono essere introdotti solo dopo evidenze su più casi reali.

## Unione di più bollette dello stesso cliente

Quando vengono analizzate più bollette, il frontend non reinterpreta i dati restituiti dal lettore e non sceglie un fornitore, un indirizzo o un tipo di prezzo al posto dell'utente.

Regole consolidate:

- i documenti vengono uniti soltanto quando codice fiscale o partita IVA e intestatario risultano compatibili;
- luce e gas conservano separatamente fornitore, codice cliente, indirizzo, POD/PDR, consumi, prezzi, quote fisse e dati dell'offerta;
- un campo comune viene valorizzato soltanto quando il valore luce e quello gas coincidono esattamente;
- se due valori differenti puntano allo stesso controllo del modulo, il frontend non ne seleziona uno: il target resta bloccato per conflitto;
- il risultato non dipende dall'ordine di caricamento dei PDF;
- fornitori differenti per luce e gas determinano forniture separate, senza dialoghi o scelte arbitrarie del frontend;
- valori mancanti in una bolletta restano mancanti e non vengono copiati dall'altra commodity.
