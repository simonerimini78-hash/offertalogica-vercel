# Archivio PDF di test

L'archivio e disattivato per impostazione predefinita. Durante test controllati
puo conservare gli originali in un bucket Supabase privato e registrare output,
diagnostica e correzioni staff.

## Configurazione

Eseguire in Supabase:

`supabase/pdf-analysis-archive.sql`

Impostare su Vercel:

- `PDF_ARCHIVE_MODE=all`, `problematic` oppure `off`;
- `PDF_ARCHIVE_BUCKET=pdf-test-archive`;
- `PDF_ARCHIVE_RETENTION_DAYS=180`;
- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `STAFF_PREVIEW_TOKEN`;
- `CRON_SECRET`.

Il bucket deve restare privato. `SUPABASE_SERVICE_ROLE_KEY` e usata solo da
codice server in `lib/pdfArchive.js` e non deve avere prefisso `NEXT_PUBLIC_`.

## Uso staff

Aprire:

`/staff-pdf.html#token=IL_TUO_STAFF_PREVIEW_TOKEN`

La pagina permette di consultare il risultato, aprire il PDF con URL firmato,
correggere i campi, classificare il caso ed eliminare analisi e file.

## Retention

Ogni record riceve `expires_at` in base a
`PDF_ARCHIVE_RETENTION_DAYS`. La pulizia usa una funzione API gia esistente:

```text
GET /api/staff-pdf-analyses?action=cleanup
Authorization: Bearer CRON_SECRET
```

Si puo usare anche `POST`. L'operazione elimina i record scaduti e rimuove il
file quando non e condiviso da altre analisi. Per applicare davvero la
retention, pianificare una chiamata periodica esterna o un cron compatibile con
il piano Vercel.

## Regola operativa

Usare `all` soltanto durante il collaudo. Prima dell'apertura pubblica scegliere
consapevolmente `problematic` o `off` e verificare informativa, consenso e
periodo di conservazione.
