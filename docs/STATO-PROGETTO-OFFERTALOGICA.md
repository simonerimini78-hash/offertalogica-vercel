# Stato progetto OffertaLogica

Aggiornato: 2026-07-27

## Architettura attiva

- Frontend statico in `public/`.
- 12 funzioni Vercel in `api/`.
- Redis/Upstash per OTP e stato temporaneo.
- Supabase per clienti, eventi e archivio PDF privato.
- Aruba SMS o Twilio per OTP.
- OpenAI GPT-4.1 per lettura nativa del PDF.
- Catalogo ARERA separato dai metadati commerciali partner.

## Lettore bollette

Il percorso attivo e esclusivamente:

`api/analyze-pdf.js` -> `lib/pdfPureAiReader.js`

Il PDF originale viene inviato al modello. Non sono attivi parser regex, OCR o
shadow reader. Restano separati:

- validazione del file;
- normalizzazione e contratto dati;
- stato e verificabilita dei campi;
- diagnostica;
- archivio PDF di test;
- autocompilazione frontend dopo conferma.

## Calcolatore e offerte

- Quando disponibili, i consumi reali dell'utente guidano il confronto.
- Filtri fisso/variabile e dual/separate non vanno sostituiti automaticamente.
- Le vere dual provengono dal catalogo dual ARERA.
- Le offerte partner restano distinte dalle offerte con consulente.
- Il catalogo ARERA fornisce dati economici; il catalogo partner aggiunge link,
  logo, stato commerciale e tracciamento.
- Prima dell'OTP non si espongono importi riservati nelle card.

## Sicurezza e consensi

- Il consenso privacy abilita confronto e gestione richiesta.
- Il consenso partner precede la trasmissione a fornitore o partner.
- Chiavi OpenAI, Supabase service role, Redis e SMS sono server-side.
- L'archivio PDF e privato, facoltativo e soggetto a retention.
- Gli eventi analytics non devono contenere dati personali o testo della
  bolletta.

## Procedure operative

- Aggiornamento ARERA: `scripts/update-arera-menu.py`.
- Verifica ambiente: `npm run lint`.
- Suite Node: `npm test`.
- Suite Python ARERA: `npm run test:python`.
- Verifica offerte: `npm run verify:offers`.
- Pannelli staff: `staff-leads.html`, `staff-analytics.html`,
  `staff-pdf.html`.

## Vincoli

- Non superare 12 funzioni API senza revisione del piano Vercel.
- Non fare deployment durante audit o test locali.
- Non caricare uno ZIP completo su `main` senza confrontare prima i file ARERA.
- Ogni modifica deve dichiarare cosa cambia, cosa non cambia e come viene
  verificata.
