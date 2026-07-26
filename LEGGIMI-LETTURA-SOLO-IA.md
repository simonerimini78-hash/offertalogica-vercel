# OffertaLogica — lettore bollette solo IA visuale v1.0.0

## Base e vincoli

- Base verificata: branch `main`.
- La route esistente `api/analyze-pdf.js` viene sostituita internamente: non viene aggiunta una nuova API.
- Il totale delle route resta 12.
- Non viene aggiunta alcuna dipendenza a `package.json`.
- Il comparatore e `public/index.html` non vengono modificati.

## Percorso di lettura

1. Il PDF viene validato dalla route esistente.
2. Le pagine vengono rasterizzate in PNG ad alta risoluzione tramite `@hyzyla/pdfium`, già presente in `main`.
3. Tutte le pagine vengono inviate nella stessa richiesta alla Responses API di OpenAI con dettaglio `high`.
4. Se la rasterizzazione non è disponibile o supererebbe i limiti configurati, viene inviato il PDF originale come `input_file`: il percorso resta solo IA e non usa parser/OCR.
5. La risposta è vincolata da JSON Schema rigido.
6. I dati vengono sottoposti alle validazioni formali già presenti in `main` e trasformati nello stesso `data_contract` usato dalla schermata di controllo.
7. L'utente deve confermare i dati prima dell'inserimento nel modulo.

## File inclusi

- `api/analyze-pdf.js` — sostituisce la logica della route esistente.
- `lib/pdfPureAiReader.js` — nuovo lettore visuale IA-only.
- `lib/pdfDataContract.js` — aggiunge provenienza IA mantenendo il contratto esistente.
- `test/pdfPureAiReader.test.mjs` — test mirati senza chiamate reali alla rete.

## Variabili d'ambiente

Obbligatoria:

- `OPENAI_API_KEY`

Opzionali:

- `PDF_AI_MODEL` — predefinito `gpt-4.1-2025-04-14`.
- `PDF_AI_TIMEOUT_MS` — timeout chiamata IA; limitato internamente a 50 secondi.
- `PDF_AI_RASTER_SCALE` — scala raster, predefinita 2.2; intervallo 1.5–3.
- `PDF_AI_MAX_RASTER_PAGES` — predefinito 12; massimo 20.
- `PDF_AI_MAX_RASTER_BYTES` — limite cumulativo PNG, predefinito 18 MB.

## Verifiche eseguite

- Controllo sintattico Node dei tre file runtime.
- Nessun import o richiamo a parser, OCR, Tesseract o shadow reader nel nuovo percorso.
- Richiesta raster: PNG reali, `input_image`, dettaglio `high`, Structured Output `json_schema` strict.
- Fallback: PDF originale come `input_file`, senza parser/OCR.
- Compatibilità con il contratto dati esistente.
- Annualizzazione della quota fissa mensile conservando valore originale e derivazione.
- 4 test mirati superati.

## Limite della verifica locale

Non è stata eseguita una chiamata reale all'API OpenAI perché nell'ambiente di verifica non è disponibile la chiave del progetto. Inoltre l'installazione locale di `@hyzyla/pdfium` non si è completata per un errore 503 del registry, quindi la funzione di rasterizzazione è stata verificata sintatticamente, contro l'API già usata in `main` e tramite test del PNG, ma non con una bolletta reale. Il primo deployment deve essere provato con una bolletta già validata, confrontando il JSON visuale con i valori noti.
