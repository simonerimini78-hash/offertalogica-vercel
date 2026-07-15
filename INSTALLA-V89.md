# Installazione v89 sopra v88

1. Copiare i file del pacchetto nel repository OffertaLogica, mantenendo le cartelle.
2. Eseguire `supabase/pdf-analysis-archive.sql` nel SQL editor di Supabase.
3. In Vercel impostare:
   - `PDF_ARCHIVE_MODE=all`
   - `PDF_ARCHIVE_BUCKET=pdf-test-archive`
   - `PDF_ARCHIVE_RETENTION_DAYS=180`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Fare il redeploy.
5. Attivare la modalità staff e aprire `Archivio PDF`.

Senza il punto 2 e le variabili del punto 3, il lettore continua a funzionare ma l'archivio resta disattivato. La correzione Axpo della v88 non viene modificata.
