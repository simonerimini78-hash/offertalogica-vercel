# OffertaLogica — Patch timeout e fallback v1.2.1

Applicare sopra il branch `Lettore-IA-Pura-Pulita` dopo la patch Lettura Completa v1.2.0.

## File da sostituire

- `lib/pdfPureAiReader.js`
- `public/staff-pdf.html`
- `test/pdfPureAiReader.test.mjs`
- `test/pdfPureAiSemanticValidation.test.mjs`
- `test/pdfTargetedQuestionSafety.test.mjs`

Non eliminare altri file. Non vengono aggiunte API: le route restano 12.

## Causa corretta

La v1.2.0 assegnava fino a 45 secondi al primo passaggio completo e permetteva fino a 4.500 token di output. Se quel passaggio scadeva, l'intera analisi terminava con `AI_TIMEOUT`, senza restituire dati.

## Correzione

- lettore aggiornato a `pure-ai-native-pdf-v1.0.13`;
- primo passaggio completo ridotto a 2.800 token;
- timeout del primo passaggio limitato per conservare budget;
- in caso di `openai_timeout`, parte un fallback rapido con 1.800 token;
- il fallback non parte per errori deterministici o HTTP 400/500;
- dopo un fallback riuscito viene restituito il risultato invece di `lettura non disponibile`;
- la verifica mirata resta facoltativa e ha un timeout più breve;
- area staff separa tentativo completo, fallback rapido, lettura utilizzata e verifica mirata.

## Verifiche

- test lettore/timeout/tracciabilità: 25/25;
- test semantici e sicurezza: 21/21;
- suite completa: 181/184;
- i 3 fallimenti residui sono quelli preesistenti del menu partner 6+3, fuori perimetro.
