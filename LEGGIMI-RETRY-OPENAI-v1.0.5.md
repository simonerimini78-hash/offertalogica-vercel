# OffertaLogica — retry OpenAI 5xx v1.0.5

Correzione mirata basata sull'errore reale archiviato per `bolletta.Irina.pdf`:
`openai_http_500` con richiesta OpenAI identificata.

## Modifica runtime

- Un solo retry automatico esclusivamente per HTTP OpenAI 500, 502, 503 e 504.
- Il PDF non viene ricaricato su Supabase e non viene riscaricato: il secondo tentativo usa lo stesso file temporaneo e la stessa richiesta già costruita.
- Attesa predefinita: 750 ms (`PDF_AI_RETRY_DELAY_MS`, massimo 2000 ms).
- Il retry parte solo se restano almeno 8 secondi nel budget della funzione.
- Nessun retry per 400, 401, 403, 413, 422, 429, timeout, refusal, output vuoto o JSON non valido.
- Nuovi diagnostici di successo: `ai.openai_attempts` e `ai.retry_count`.
- Versione lettore: `pure-ai-native-pdf-v1.0.2`.

## File da sostituire

- `lib/pdfPureAiReader.js`

Il file di test è incluso solo per verifica e non è necessario al runtime.
