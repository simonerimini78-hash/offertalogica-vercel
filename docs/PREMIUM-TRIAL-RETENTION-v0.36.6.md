# Premium v0.36.6 — scadenza e conservazione della prova

## Comportamento implementato

- La prova resta operativa per 30 giorni.
- Alla scadenza lo stato passa da `trialing` a `expired` quando l’utente apre l’app.
- Per i successivi 90 giorni l’utente può leggere, scaricare ed eliminare i dati già presenti.
- Durante i 90 giorni non può aggiungere o modificare utenze, caricare bollette, avviare analisi o richiedere controlli staff.
- Dopo il termine di conservazione le policy cliente bloccano l’accesso ai dati Premium.
- Le funzioni protette `premium_trial_cleanup_candidates` e `premium_finalize_trial_data_purge` preparano la cancellazione definitiva.

## Limite non ancora automatizzato

La migrazione non cancella direttamente righe da `storage.objects`. I file devono essere rimossi tramite la Storage API di Supabase. Soltanto dopo la rimozione dei file, un processo con ruolo di servizio può chiamare `premium_finalize_trial_data_purge` per eliminare i dati operativi dal database.

Fino all’installazione e alla pianificazione di tale processo, la cancellazione fisica automatica al termine dei 90 giorni non è attiva. Le policy impediscono comunque al cliente di accedere all’archivio scaduto.

## Installazione

1. Distribuire i file applicativi della v0.36.6.
2. Eseguire `supabase/premium-trial-retention-v0.36.6.sql` nel SQL Editor.
3. Eseguire `supabase/premium-trial-retention-v0.36.6-verify.sql`.
4. Verificare il risultato `premium_trial_retention_v0.36.6_ok`.
5. Collaudare un account con date simulate prima del merge.
