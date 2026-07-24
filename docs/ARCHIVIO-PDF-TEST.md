# Archivio PDF di test - configurazione v89

Questa funzione e disattivata per impostazione predefinita. Durante la fase di test controllata puo conservare i PDF in un bucket Supabase privato e registrare la diagnostica campo per campo.

Per i PDF standard viene conservato l'originale. Per i PDF grandi rasterizzati nel browser viene conservata una copia PDF privata ricostruita dalle stesse pagine JPEG analizzate dall'IA. Il record la identifica con `source_context.archiveSource=client_raster_reconstruction` e conserva separatamente dimensione originale dichiarata, dimensione raster e numero di pagine.

## 1. Creare tabella e bucket

Eseguire nel SQL editor di Supabase:

`supabase/pdf-analysis-archive.sql`

Il bucket `pdf-test-archive` è privato. Non sono create policy pubbliche; l'accesso avviene soltanto tramite API server con la service role.

## 2. Variabili Vercel

Impostare:

- `PDF_ARCHIVE_MODE=all` per archiviare tutti i documenti durante il test;
- `PDF_ARCHIVE_BUCKET=pdf-test-archive`;
- `PDF_ARCHIVE_RETENTION_DAYS=180`;
- `SUPABASE_URL` con l'URL del progetto Supabase;
- `SUPABASE_SERVICE_ROLE_KEY` con la chiave server, mai esposta nel browser;
- `STAFF_PREVIEW_TOKEN` già usato dalla modalità staff;
- `CRON_SECRET` solo se si usa l'endpoint di pulizia automatica.

Modalità alternative:

- `PDF_ARCHIVE_MODE=problematic`: conserva soltanto analisi fallite, non riconosciute o da verificare;
- `PDF_ARCHIVE_MODE=off`: non conserva originali e lascia invariato il lettore.

## 3. Aprire l'archivio

Attivare la modalità staff nel calcolatore. Nel banner compare `Archivio PDF`.

Accesso diretto:

`/staff-pdf.html#token=IL_TUO_STAFF_PREVIEW_TOKEN`

La pagina permette di:

- aprire il PDF originale con un collegamento firmato valido cinque minuti;
- vedere pagina, testo sorgente, metodo ed esito di ogni campo;
- correggere i valori attesi;
- classificare il documento come verificato o caso di test;
- eliminare analisi e file.

## 4. Pulizia e retention

Ogni record riceve `expires_at`. L'endpoint protetto:

`/api/staff-pdf-analyses?action=cleanup`

elimina i record scaduti e rimuove il file quando non è condiviso da altre analisi dello stesso PDF. Deve essere chiamato con:

`Authorization: Bearer CRON_SECRET`

La pulizia riusa una delle 12 funzioni esistenti e non crea una tredicesima API. Per applicare davvero `PDF_ARCHIVE_RETENTION_DAYS`, l'azione deve essere richiamata periodicamente da un cron esterno o da una pianificazione compatibile con il piano Vercel. La sola variabile imposta `expires_at`, ma non avvia da sola la cancellazione.

## 5. Regola operativa

Durante il test usare `all`. Prima dell'apertura pubblica rivalutare la modalità e passare a `problematic` o `off`. La pagina pubblica non aggiunge checkbox o passaggi; l'archiviazione dipende esclusivamente dalla configurazione server.
