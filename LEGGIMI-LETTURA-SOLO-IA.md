# OffertaLogica — lettore IA nativo PDF con upload diretto v1.0.2

Base verificata: branch `lettura-IA-pura.1`.

Il lettore IA non viene modificato e conserva la versione:

`pure-ai-native-pdf-v1.0.1`

La v1.0.2 modifica soltanto il percorso con cui i PDF grandi arrivano alla route.

## Problema riprodotto

Il frontend del branch inviava ogni PDF intero a:

`POST /api/analyze-pdf` con `multipart/form-data`.

Vercel respingeva i documenti oltre il limite del corpo della Function prima che il codice venisse eseguito, restituendo:

- HTTP `413`;
- `FUNCTION_PAYLOAD_TOO_LARGE`.

Aumentare `MAX_PDF_BYTES` o `maxDuration` non può correggere questo errore, perché la richiesta viene bloccata prima di raggiungere `formidable` e prima della chiamata OpenAI.

## Nuovo percorso

### PDF fino a 4.000.000 byte

Resta invariato il percorso già verificato:

`browser -> multipart /api/analyze-pdf -> GPT visuale`

### PDF oltre 4.000.000 byte

Viene usato:

`browser -> URL firmato Supabase -> bucket privato -> /api/analyze-pdf con piccolo JSON -> GPT visuale`

La stessa route gestisce due operazioni JSON:

- `create_upload`: genera un URL temporaneo firmato;
- `analyze_uploaded_pdf`: scarica il PDF dal bucket, verifica firma e dimensione e avvia lo stesso lettore IA.

Non viene aggiunto alcun file in `api/`: il totale resta 12.

## Limite applicativo conservato

Il limite del progetto resta quello già presente:

- `MAX_PDF_BYTES`, se configurato;
- altrimenti `8.000.000` byte.

Questa patch non alza arbitrariamente il limite. Un file oltre il limite continua a essere rifiutato con `PDF_TOO_LARGE`.

## Sicurezza

- Il bucket resta privato.
- `SUPABASE_SERVICE_ROLE_KEY` resta esclusivamente server-side.
- Il percorso temporaneo è casuale e confinato sotto `pending/AAAA/MM/UUID.pdf`.
- Il browser riceve un URL di upload firmato, non la service role.
- La seconda richiesta usa un ticket firmato HMAC e non può indicare liberamente un altro oggetto del bucket.
- Dimensione dichiarata e dimensione scaricata devono coincidere.
- La firma `%PDF-` viene verificata prima dell'analisi.
- L'oggetto temporaneo viene eliminato nel `finally` anche quando l'analisi fallisce dopo aver raggiunto la route.

## Variabili necessarie per i PDF grandi

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `PDF_ARCHIVE_BUCKET`, oppure il predefinito `pdf-test-archive`;
- bucket privato esistente con limite file almeno pari a `MAX_PDF_BYTES`.

`PDF_ARCHIVE_MODE` continua a controllare l'archiviazione permanente dell'analisi. Non espone chiavi al browser.

## Diagnostica nella risposta

Per un PDF piccolo:

`normalized.ai.ingress_mode = vercel_multipart`

Per un PDF grande:

`normalized.ai.ingress_mode = supabase_signed_upload`

In entrambi i casi:

- `normalized.ai.ingress_version = pdf-ingress-v1.0.2`;
- `normalized.parser_version = pure-ai-native-pdf-v1.0.1`;
- `normalized.ai.transport_mode = pdf_originale`.

## File modificati

- `api/analyze-pdf.js`;
- `lib/pdfArchive.js`;
- `public/index.html`.

Test aggiunti:

- `test/pdfDirectUpload.test.mjs`;
- `test/pdfDirectUploadFrontend.test.mjs`.

## Verifiche locali

- ZIP sorgente confrontato con il branch GitHub tramite SHA Git: coincidenza esatta sui file di lavoro.
- API JavaScript: 12 prima e dopo.
- Test mirati upload e regressioni del lettore: 34/34 superati.
- Suite non OCR eseguibile: 160 test superati.
- Due test legacy aggiuntivi non partono già nel branch originale perché manca `lib/pdfHybridPolicy.js`; la stessa anomalia è stata riprodotta sulla base non modificata.
- `npm run verify:offers`: 0 errori, 0 avvisi, 0 partner warning.
- `npm run validate:calculator` segnala già nella base originale `catalogo ARERA: vere offerte dual mancanti`; non è introdotto dalla patch.

## Limite della verifica

Non è stata eseguita una prova reale contro il bucket Supabase del progetto, perché le credenziali non sono disponibili nell'ambiente locale. Il controllo obbligatorio dopo il deployment Preview è caricare Sorgenia e Irina e verificare:

- assenza di `413 FUNCTION_PAYLOAD_TOO_LARGE`;
- `ingress_mode: supabase_signed_upload`;
- arrivo della risposta IA;
- eliminazione dell'oggetto sotto `pending/` dopo la richiesta.

Supabase consente gli upload standard anche oltre 6 MB, ma raccomanda TUS resumable per maggiore affidabilità sopra tale dimensione. Il progetto conserva per ora il limite massimo di 8 MB; se i test reali mostrano interruzioni di rete, TUS sarà una modifica successiva separata, non inclusa in questa patch.
