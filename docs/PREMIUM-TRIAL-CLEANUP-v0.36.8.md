# OffertaLogica Premium v0.36.8 — cancellazione automatica

## Obiettivo

Completare la cancellazione fisica dei PDF e dei dati operativi Premium quando sono trascorsi i 90 giorni di archivio in sola lettura successivi alla prova.

## Flusso

1. Supabase Cron invoca ogni giorno la Edge Function `premium-trial-cleanup`.
2. La funzione accetta soltanto richieste con il secret `PREMIUM_CLEANUP_CRON_SECRET`.
3. La funzione legge i candidati tramite `premium_trial_cleanup_candidates`.
4. I PDF vengono eliminati dal bucket `premium-bills` tramite Storage API, in blocchi fino a 1000 oggetti.
5. Solo dopo la rimozione dei file viene chiamata `premium_finalize_trial_data_purge`.
6. Il database elimina bollette, analisi, controlli, anomalie, comunicazioni, contratti e utenze operative; profilo, consensi e record della prova restano per impedire una seconda prova e documentare il rapporto.
7. Ogni esecuzione viene registrata in `premium_trial_cleanup_runs`.

## Sicurezza

- `verify_jwt` è disattivato soltanto per questa Edge Function perché l'autenticazione è effettuata tramite un secret dedicato.
- Il secret non deve essere inserito nel browser, nel repository o nelle variabili Vercel.
- Il valore deve essere salvato sia tra i secret della Edge Function sia in Supabase Vault.
- Le funzioni SQL e il registro delle esecuzioni sono accessibili soltanto al ruolo di servizio.
- Una singola esecuzione può essere in stato `running`; i processi interrotti da oltre 30 minuti vengono chiusi come falliti prima del tentativo successivo.

## Installazione

1. Applicare `premium-trial-cleanup-v0.36.8.sql`.
2. Verificare con `premium-trial-cleanup-v0.36.8-verify.sql`.
3. Creare e distribuire la Edge Function usando `supabase/functions/premium-trial-cleanup/index.ts` e il modulo `_shared`.
4. Configurare il secret `PREMIUM_CLEANUP_CRON_SECRET`.
5. Disattivare `Verify JWT` per la sola funzione `premium-trial-cleanup`.
6. Eseguire una chiamata manuale con `{"dry_run":true,"limit":25}`.
7. Creare i tre valori in Vault.
8. Eseguire `premium-trial-cleanup-v0.36.8-schedule-template.sql`.
9. Controllare la Cron History, i log della Edge Function e la tabella `premium_trial_cleanup_runs`.

## Test reale

La cancellazione definitiva deve essere collaudata con un account dedicato contenente documenti non necessari. Non modificare le date dell'account principale. Il test completo può essere concluso dopo il ripristino delle email di conferma account tramite SMTP personalizzato.
