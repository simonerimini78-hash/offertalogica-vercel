# v90 — compatibilità Vercel Hobby

La v89 ha portato la cartella `api` a 15 funzioni. Vercel Hobby ne consente 12.

## Applicazione

1. Elimina dal repository GitHub:
   - `api/staff-pdf-file.js`
   - `api/cleanup-pdf-archive.js`
   - `api/send.otp.js`
2. Carica i due file aggiornati di questo pacchetto:
   - `api/staff-pdf-analyses.js`
   - `public/staff-pdf.html`
3. Commit e redeploy.

## Cosa resta invariato

- archivio PDF;
- apertura protetta del PDF originale;
- elenco, modifica ed eliminazione delle analisi;
- pulizia dei documenti scaduti;
- OTP tramite `/api/send-otp.js`;
- correzione Axpo della v88.

## Nuove rotte incorporate

- PDF originale: `/api/staff-pdf-analyses?action=file&id=...`
- pulizia archivio: `/api/staff-pdf-analyses?action=cleanup`

La pulizia continua a richiedere `Authorization: Bearer CRON_SECRET`.
