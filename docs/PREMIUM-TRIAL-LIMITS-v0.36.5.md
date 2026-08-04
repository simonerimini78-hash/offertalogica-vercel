# OffertaLogica Premium v0.36.5 — limiti della prova gratuita

## Base

La modifica si applica alla Premium v0.36.4 completa.

## Prova gratuita

Il piano `premium-beta` in stato `trialing` prevede:

- durata di 30 giorni;
- massimo 2 utenze luce/gas della stessa abitazione;
- massimo 4 bollette complessive nel periodo di prova;
- massimo 1 richiesta di controllo staff;
- controllo staff disponibile soltanto per anomalie rosse;
- nessuna carta e nessun addebito automatico.

I limiti da 4 bollette e 1 controllo staff non vengono applicati alle future sottoscrizioni in stato `active`.

## Migrazione degli account esistenti

Le prove `premium-beta` già create vengono riallineate a:

- 4 bollette;
- 2 utenze;
- scadenza a 30 giorni dalla data iniziale del periodo.

## Database

La migrazione `supabase/premium-trial-limits-v0.36.5.sql`:

- aggiorna `premium_activate_beta_trial()`;
- rende `premium_can_add_bill()` dipendente dal periodo della sottoscrizione;
- applica il vincolo della stessa abitazione alle utenze del trial;
- limita a una la richiesta staff del trial;
- mantiene invariata la regola semaforo: solo il rosso può essere inviato allo staff.

## Ordine di installazione

1. caricare i file incrementali sul branch Premium;
2. eseguire `supabase/premium-trial-limits-v0.36.5.sql` nel SQL Editor di Supabase;
3. eseguire `supabase/premium-trial-limits-v0.36.5-verify.sql`;
4. verificare la Preview con un account esterno nuovo e un account beta già esistente.
