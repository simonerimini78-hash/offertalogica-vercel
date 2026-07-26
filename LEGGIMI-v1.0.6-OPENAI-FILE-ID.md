# OffertaLogica — lettura IA pura v1.0.6

## Scopo isolato

Questa modifica verifica il trasporto dei PDF grandi verso OpenAI senza cambiare prompt, modello, schema dati o logica di validazione.

Il caso riprodotto è `bolletta.Irina.pdf`, dimensione registrata: `19.694.477 byte`.

## Modifica runtime

Solo:

- `lib/pdfPureAiReader.js`

Il file di test incluso non è necessario al runtime:

- `test/pdfPureAiReader.test.mjs`

## Comportamento

### PDF inferiori a 12.000.000 byte

Resta invariato il percorso esistente:

1. il PDF viene incorporato nella richiesta Responses come `file_data` Base64;
2. `ai.transport_mode = pdf_originale`.

### PDF da 12.000.000 byte in su

1. il backend carica temporaneamente il PDF su `POST /v1/files`;
2. usa `purpose=user_data`;
3. imposta scadenza automatica a un'ora;
4. invia a Responses solo `file_id`, senza Base64;
5. l'eventuale retry riusa lo stesso `file_id` e non ripete l'upload;
6. il file OpenAI viene eliminato in `finally`, anche quando l'analisi fallisce.

Diagnostica attesa in caso di successo di Irina:

```text
parser_version: pure-ai-native-pdf-v1.0.3
ai.transport_mode: openai_file_id
ai.input_file_bytes: 19694477
ai.file_id_threshold_bytes: 12000000
ai.openai_file_deleted: true
```

## Variabili opzionali

Non sono richieste nuove variabili. I valori predefiniti sono:

```text
PDF_AI_FILE_ID_THRESHOLD_BYTES=12000000
PDF_AI_FILE_UPLOAD_TIMEOUT_MS=15000
PDF_AI_FILE_DELETE_TIMEOUT_MS=2000
```

## Cosa non cambia

- modello `gpt-4.1-2025-04-14`;
- prompt e domande;
- output JSON strutturato;
- contratto dati e validazione;
- caricamento browser → Supabase per PDF grandi;
- limite applicativo di 20 MB;
- numero di API: resta 12;
- comparatore, cataloghi ARERA, OTP e lead.

## Verifiche eseguite

- file corrente del branch verificato tramite Git blob SHA prima della modifica;
- test mirati lettore/upload/contratto: 50/50 superati;
- test del solo lettore: 14/14 superati;
- simulazione esatta di un PDF da 19.694.477 byte;
- verifica che Responses riceva `file_id` e non `file_data`;
- verifica `500 → retry` con un solo upload;
- verifica cancellazione del file OpenAI dopo successo e dopo errore;
- suite generale: 226 test superati, 4 fallimenti preesistenti identici alla base v1.0.5;
- `npm run verify:offers`: 0 errori, 0 warning;
- API totali: 12.

## Limite della verifica

Non è stata eseguita una chiamata OpenAI reale da locale perché le credenziali del deployment non sono disponibili. Il risultato decisivo resta la prova Preview con `bolletta.Irina.pdf`.
