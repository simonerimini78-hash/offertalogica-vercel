# OffertaLogica Premium v0.36.3 — Verde, giallo e rosso

## Regola operativa

- **Verde:** analisi chiusa automaticamente, senza staff.
- **Giallo:** avviso automatico, senza staff.
- **Rosso:** anomalia economicamente importante; il cliente può richiedere la verifica dello staff.

La funzione Supabase `premium_request_check` accetta esclusivamente bollette con:

- `automatic_screening_status = review_recommended`;
- `customer_status = anomaly_found`;
- `processing_status = completed`.

## Offerta più conveniente

L’avviso giallo è ammesso soltanto quando il motore di confronto fornisce tutti questi dati:

- stima annuale attendibile;
- offerta vicina alla scadenza;
- risparmio annuo superiore a 60 € per utenza singola oppure 100 € per dual.

La v0.36.3 introduce il controllo delle soglie ma non inventa un risparmio quando il motore di confronto non ha ancora prodotto una stima validata.

## PDF non leggibile

Il lettore esegue già il recupero automatico dei dati essenziali. Se il risultato resta inutilizzabile, il caso è giallo: l’utente deve riprovare o caricare un PDF/scansione migliore. Non viene proposta automaticamente la verifica dello staff.

## Installazione

1. Copiare i file del pacchetto incrementale sulla baseline v0.36.1.
2. Eseguire `supabase/premium-traffic-light-v0.36.3.sql` nel SQL Editor di Supabase.
3. Eseguire `supabase/premium-traffic-light-v0.36.3-verify.sql`.
4. Distribuire la Preview e verificare un caso verde, uno giallo e uno rosso.
