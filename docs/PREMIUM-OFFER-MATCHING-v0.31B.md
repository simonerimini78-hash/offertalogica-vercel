# OffertaLogica Premium v0.31B

## Obiettivo

Riconoscere automaticamente l'offerta attiva leggendo dalla bolletta:

- fornitore;
- nome offerta;
- codice offerta;
- luce, gas o dual;
- prezzo fisso o indicizzato;
- prezzo applicato;
- quota fissa;
- indice, spread e formula.

Il motore interroga lo storico ARERA centrale pubblicato dal branch `main`.

## Ordine del riconoscimento

1. Codice ARERA esatto.
2. Fornitore + nome offerta + tipo di prezzo.
3. Impronta economica: prezzo, quota fissa e tipologia.
4. Scheda provvisoria ricostruita dalla bolletta quando non esiste una corrispondenza affidabile.

## Regole di sicurezza

- Un contratto verificato manualmente o dallo staff non viene sovrascritto.
- Un match esatto o molto forte può essere usato dal controllo automatico.
- Un risultato ambiguo o incompleto viene salvato come `needs_review` e non viene usato per dichiarare anomalie contrattuali.
- Per le offerte indicizzate si conservano indice e spread; il prezzo corrente ARERA non viene trattato come prezzo fisso contrattuale.
- Un errore nel recupero dello storico ARERA non fa fallire l'analisi della bolletta.

## File centrali

Il backend tenta in ordine:

1. `ARERA_HISTORY_URL`, quando configurato;
2. `https://offertalogica.it/data/offerte-arera-history.json`;
3. copia pubblica sul branch `main` di GitHub.

Non è obbligatoria una nuova variabile Vercel.

## Installazione

1. Caricare il pacchetto sul branch `App-Premium-ok`.
2. Eseguire `supabase/premium-offer-matching-v0.31B.sql`.
3. Eseguire `supabase/premium-offer-matching-v0.31B-verify.sql`.
4. Collaudare con una nuova bolletta.

Non vengono aggiunte funzioni Vercel.
