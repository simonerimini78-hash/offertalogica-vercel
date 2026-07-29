# OffertaLogica — rollback reader v1.1.0

Sostituire sul branch attuale esclusivamente questi file:

- lib/pdfPureAiReader.js
- public/staff-pdf.html
- test/pdfPureAiReader.test.mjs
- test/pdfPureAiSemanticValidation.test.mjs
- test/pdfTargetedQuestionSafety.test.mjs

Non modificare api/analyze-pdf.js e public/index.html: devono restare nella versione Certezza Dati v1.1.0 già caricata.

Risultato atteso: reader pure-ai-native-pdf-v1.0.11, una sola chiamata OpenAI, nessun secondo passaggio completo o fallback nella stessa Function.
