# OffertaLogica Premium — sicurezza consensi v0.36.12

## Problema riprodotto

Supabase Security Advisor segnalava `premium_accept_current_terms(jsonb)` perché la funzione pubblica era `SECURITY DEFINER` ed eseguibile dal ruolo `authenticated` tramite RPC.

La chiamata dell'app era intenzionale, ma la tabella `premium_consents` concedeva anche un `INSERT` generico agli utenti autenticati. Un utente poteva quindi registrare direttamente valori arbitrari nel proprio storico dei consensi, senza passare dalla funzione controllata.

## Correzione

- `premium_accept_current_terms(jsonb)` passa a `SECURITY INVOKER`;
- `premium_has_current_acceptances()` passa a `SECURITY INVOKER`;
- l'utente mantiene soltanto l'inserimento sulle colonne strettamente necessarie;
- `user_id`, `recorded_at` e `revoked_at` vengono governati dal database;
- la policy RLS consente esclusivamente le versioni legali correnti;
- un trigger normalizza i metadati, limita il payload a 4 KB e impedisce duplicati;
- `anon` continua a non poter eseguire l'RPC;
- firma RPC e codice frontend restano invariati.

## Installazione

1. Eseguire `supabase/premium-consent-security-v0.36.12.sql`.
2. Eseguire `supabase/premium-consent-security-v0.36.12-verify.sql`.
3. Verificare il risultato `premium_consent_security_v0.36.12_ok`.
4. Rilanciare il Security Advisor di Supabase.
5. Provare l'accettazione delle condizioni con un account autenticato.

La versione dei Termini non cambia e non viene richiesta una nuova accettazione agli utenti che hanno già accettato le versioni correnti.
