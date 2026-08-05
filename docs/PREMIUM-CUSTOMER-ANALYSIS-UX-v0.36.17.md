# Premium v0.36.17 — analisi cliente, flusso staff e finestre OffertaLogica

## Problemi riprodotti

### 1. Dati corretti nello staff ma vuoti nell'app cliente

La dashboard staff leggeva `premium_analysis_runs.extracted_data`, dove la lettura IA era completa. L'app cliente interrogava soltanto `premium_bills` e mostrava quasi esclusivamente lo stato sintetico del controllo. Per ragioni RLS il cliente non deve leggere direttamente `premium_analysis_runs`, quindi non era corretto aprire quella tabella agli utenti.

### 2. Lavorazione staff macchinosa

La scheda mostrava subito metadati tecnici, token, warning e validazione campo per campo. Il modulo anomalie compariva dopo la sezione di chiusura del controllo, rendendo il percorso poco lineare.

### 3. Popup nativo con URL Preview e nome del progetto

La richiesta di controllo usava `window.confirm`. Le finestre native del browser mostrano automaticamente l'origine della pagina; su un deployment Preview Vercel l'origine include il nome del progetto e dell'account. Quel testo non è personalizzabile dal codice.

## Correzione

### Dati visibili al cliente

È stata aggiunta a `premium_bills` la colonna JSONB `customer_analysis_data`.

La colonna contiene soltanto una whitelist di dati utili:

- fornitore e offerta;
- POD/PDR;
- periodo, emissione, scadenza e importo;
- consumi;
- prezzi, fasce, quota fissa e potenza;
- tipo prezzo, indice, spread, formula e scadenza delle condizioni.

Restano esclusi:

- codice fiscale e intestatario;
- dati tecnici del lettore;
- token, costi e identificativi della risposta IA;
- warning interni e note staff.

La migrazione:

- recupera i dati dalle analisi già presenti;
- usa i dati convalidati dallo staff quando disponibili;
- aggiorna automaticamente la bolletta dopo nuove analisi o nuove validazioni;
- non modifica le policy RLS di `premium_analysis_runs`.

### Area staff

La sequenza diventa:

1. stato automatico;
2. presa in carico, quando necessaria;
3. dati letti dalla bolletta;
4. anomalie;
5. chiusura del controllo;
6. note.

Metadati, warning e validazione campo per campo sono raccolti in un pannello chiuso denominato **Dettagli tecnici IA e validazione**.

### Finestre di conferma

Tutte le conferme e richieste di testo dell'app sono state sostituite con finestre interne marchiate **OffertaLogica.it**. Non viene più mostrato l'URL Preview Vercel, il nome del progetto o il nome dell'account Vercel.

Il dominio definitivo `premium.offertalogica.it` resta comunque il dominio corretto per la pubblicazione finale, ma non è più necessario per nascondere l'origine nelle finestre dell'app.

## Installazione

Ordine obbligatorio:

1. eseguire `supabase/premium-customer-analysis-ux-v0.36.17.sql` in Supabase SQL Editor;
2. facoltativamente eseguire il file `-verify.sql`;
3. applicare il pacchetto incrementale alla base v0.36.16;
4. pubblicare il deployment Premium;
5. aggiornare la PWA quando compare il pulsante **AGGIORNA**.

La migrazione SQL deve precedere il deployment perché il nuovo backend scrive `customer_analysis_data` durante l'analisi.

## Verifica reale richiesta

- Aprire **Vedi analisi** su una delle quattro bollette già lette: i dati devono essere popolati senza ricaricare il PDF.
- Aprire un controllo nella dashboard staff: i dati principali devono essere subito leggibili e i dettagli tecnici chiusi.
- Richiedere un nuovo controllo: deve comparire una finestra OffertaLogica.it, senza intestazione del browser con URL Vercel.
- Provare eliminazione bolletta/utenza e gestione account: anche queste conferme devono essere interne all'app.

## Rollback

1. ripristinare i file della v0.36.16;
2. eseguire `supabase/premium-customer-analysis-ux-v0.36.17-rollback.sql`.

Il rollback SQL elimina `customer_analysis_data`; non tocca PDF, analisi IA, bollette, controlli o profili.
