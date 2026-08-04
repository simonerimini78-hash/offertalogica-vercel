# OffertaLogica Premium v0.36.10 — Premium omaggio e popup informativo

## Obiettivo

La versione sostituisce il blocco informativo permanente nel Profilo con una card compatta. Prova, conservazione e prezzi sono mostrati soltanto in un popup aperto dall’utente.

Introduce inoltre il piano amministrativo `premium-complimentary`, assegnabile esclusivamente da un amministratore dall’area **Clienti e utenze**.

## Piano omaggio

L’amministratore può scegliere:

- 1 mese;
- 3 mesi;
- 6 mesi;
- 12 mesi;
- senza scadenza.

Il piano:

- non usa Stripe;
- non genera pagamenti o rinnovi;
- non applica i limiti delle 4 bollette e dell’unico controllo staff previsti per la prova;
- conserva il limite di 2 utenze del piano Casa;
- può essere prorogato, modificato o revocato;
- non può sostituire un abbonamento Stripe attivo o da regolarizzare.

Alla scadenza o alla revoca, l’archivio passa in sola lettura per 90 giorni e poi entra nella stessa coda di cancellazione automatica prevista per la prova.

## Installazione

1. Applicare lo ZIP incrementale alla v0.36.9 certificata.
2. Eseguire `supabase/premium-complimentary-v0.36.10.sql`.
3. Eseguire `supabase/premium-complimentary-v0.36.10-verify.sql`.
4. Verificare il risultato `premium_complimentary_v0.36.10_ok`.
5. Dalla dashboard staff, aprire **Clienti e utenze** e utilizzare **REGALA PREMIUM** su un account di prova.

## Sicurezza

Le funzioni di concessione e revoca verificano il ruolo `admin` sul server. Gli eventi sono registrati in `premium_complimentary_events`. Nessuna nuova funzione Vercel o chiave esterna viene aggiunta.
