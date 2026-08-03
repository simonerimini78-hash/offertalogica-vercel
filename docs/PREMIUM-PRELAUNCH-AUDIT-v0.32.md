# OffertaLogica Premium v0.32 — audit pre-lancio

## Correzioni incluse

1. Lo staff reviewer/admin può leggere una bolletta e scaricare il PDF soltanto se il cliente ha creato una richiesta di controllo non annullata.
2. La scadenza dell’abbonamento non blocca la gestione dei dati già archiviati.
3. Senza abbonamento attivo il cliente può:
   - consultare bollette, offerte riconosciute ed esiti già presenti;
   - aprire i PDF;
   - eliminare bollette non coinvolte in controlli attivi;
   - eliminare un’utenza dopo aver rimosso le bollette collegate.
4. Senza abbonamento attivo restano bloccati:
   - nuovi caricamenti;
   - analisi IA e tentativi;
   - conferma dell’offerta;
   - nuove richieste di controllo;
   - creazione o modifica delle utenze.

## File SQL

Eseguire dopo il deployment:

- `supabase/premium-prelaunch-access-v0.32.sql`
- `supabase/premium-prelaunch-access-v0.32-verify.sql`

La verifica deve restituire 11 righe tutte `true`.

## Audit tecnico

- Test Premium: 94/94.
- Suite completa: 310/323. Restano 13 errori preesistenti del comparatore/lettore gratuito; la v0.32 non ne introduce di nuovi.
- Nessuna nuova funzione Vercel.
- La PWA gratuita stabile non viene modificata.
- Rimangono da completare prima di un lancio pubblico aperto: recupero password, informativa/consenso Premium specifici e verifica delle variabili Vercel per costo IA e rate limit persistente.
