# OffertaLogica — PATCH Lettore Certezza Dati v1.1.0

Questo archivio **non contiene il progetto completo**. Contiene esclusivamente i file da sostituire o aggiungere sul branch esistente `Lettore-IA-Pura-Pulita`.

## File da sostituire

Caricare ciascun file nello stesso identico percorso, sostituendo quello esistente:

1. `api/analyze-pdf.js`
2. `lib/pdfPureAiReader.js`
3. `public/index.html`
4. `public/staff-pdf.html`
5. `test/pdfPureAiReader.test.mjs`

## File nuovo da aggiungere

6. `PACCHETTO-CERTEZZA-DATI-PDF.md`

## File che non devono essere eliminati

Nessuno. La patch non richiede cancellazioni, nuove API o modifiche al numero delle route.

## Procedura GitHub

1. Restare sul branch esistente `Lettore-IA-Pura-Pulita`.
2. Aprire il percorso indicato per ciascun file.
3. Caricare il file della patch con lo stesso nome, confermando la sostituzione.
4. Aggiungere `PACCHETTO-CERTEZZA-DATI-PDF.md` nella root del repository.
5. Attendere il deploy Vercel.
6. Eseguire il collaudo descritto in `PACCHETTO-CERTEZZA-DATI-PDF.md`.

Non è necessario creare un nuovo branch per applicare tecnicamente questa patch. La scelta di usare un branch separato resta soltanto una precauzione facoltativa.
