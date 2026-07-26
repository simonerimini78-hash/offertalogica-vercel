# OffertaLogica — diagnostica IA v1.0.4

Patch diagnostica incrementale per il branch `lettura-IA-pura.1` dopo il caso Irina `502 AI_INVALID_RESULT` senza riga archiviata in Supabase.

## Scopo

Questa patch non modifica il lettore, il prompt, lo schema, i limiti, l'upload o il comparatore. Aggiunge esclusivamente evidenze diagnostiche sicure:

- `diagnostic_code`
- `analysis_stage`
- `ingress_mode`
- `elapsed_ms`
- esito del tentativo di archivio
- log strutturato `[pdf-analysis-error]` nei log Vercel

## File runtime

- `api/analyze-pdf.js`
- `lib/pdfAnalysisDiagnostics.js`

## Dopo il deploy

Ricaricare Irina e copiare la Response JSON. Il campo decisivo sarà, ad esempio:

- `OPENAI_HTTP_400`
- `OPENAI_INCOMPLETE_MAX_OUTPUT_TOKENS`
- `OPENAI_EMPTY_OUTPUT`
- `OPENAI_REFUSAL`
- `OPENAI_INVALID_OUTPUT`

Nei log Vercel cercare `[pdf-analysis-error]` per il messaggio interno completo, troncato a 500 caratteri.
