# OFFERTALOGICA PREMIUM — ARCHITETTURA SUPABASE V0.2

**Data:** 2 agosto 2026  
**Branch di sviluppo:** `App-Premium-ok`  
**Base congelata:** PWA gratuita `v0.22`, branch `App-OffetaLogica`  
**Stato:** progettazione database; nessuna modifica alla PWA gratuita

## 1. Decisione architetturale

Sito e app usano lo stesso progetto Supabase, ma le risorse restano separate per finalita:

- funnel commerciale esistente: `lead_records`, `lead_events`;
- archivio diagnostico parser: `pdf_analyses`, bucket `pdf-test-archive`;
- servizio abbonati: nuove tabelle `premium_*`, bucket privato `premium-bills`;
- identita: Supabase Auth `auth.users`.

Non vengono riutilizzati come archivio clienti ne `pdf_analyses` ne `pdf-test-archive`.

## 2. Auth verificata

Nel progetto Supabase condiviso risulta attivo soltanto il provider Email.
La configurazione URL non viene modificata in questa fase, perche il Premium non dispone ancora di un URL stabile dedicato e la PWA gratuita v0.22 non deve ricevere callback Premium.

Sito e app condividono `auth.users`. La registrazione Premium inviera il marker applicativo `offertalogica_product = premium`; il trigger crea il profilo solo per questi account. Il marker non e usato per autorizzare funzioni o ruoli.

## 3. Modello di accesso

### Cliente

Il frontend usa:

- Supabase Auth;
- chiave pubblicabile `sb_publishable_...`;
- sessione personale;
- Row Level Security.

Il cliente puo accedere soltanto alle proprie utenze, contratti, bollette, esiti, anomalie, comunicazioni e consensi.

### Staff e IA

Le operazioni sensibili usano API server Vercel o funzioni backend con chiave segreta `sb_secret_...`:

- lettura e analisi del PDF;
- creazione dei risultati IA;
- URL firmati per lo staff;
- gestione abbonamenti e pagamenti;
- contabilizzazione dei costi;
- attivita amministrative.

La chiave segreta non deve mai essere inserita in `public/`, nel browser o nel repository.

## 4. Tabelle

### `premium_profiles`

Profilo applicativo collegato uno-a-uno a `auth.users`. Non duplica la password e non sostituisce Supabase Auth.

### `premium_staff_members`

Autorizza i ruoli interni:

- `support`;
- `reviewer`;
- `admin`.

La funzione `premium_is_staff()` viene usata nelle policy RLS.

### `premium_subscriptions`

Registra stato e limiti del servizio. Il prezzo non e ancora definito.

Campi economici gia predisposti:

- piano;
- utenze incluse;
- bollette annue incluse;
- periodo corrente;
- identificativi del futuro provider di pagamento.

### `premium_utilities`

Rappresenta una fornitura:

- `electricity`;
- `gas`;
- `dual`.

L'ipotesi operativa iniziale e:

- 12 bollette annue per una fornitura o dual su documento unico;
- due utenze separate, luce e gas, da 12 bollette ciascuna per un totale di 24.

Il valore e memorizzato in `expected_bills_per_year` per poter misurare il carico reale.

### `premium_contracts`

Conserva le condizioni contrattuali da verificare: fornitore, offerta, prezzo fisso/indicizzato, scadenza e quote fisse.

### `premium_bills`

Registro principale delle bollette Premium. Il PDF resta nel bucket privato `premium-bills`; nella tabella vengono conservati metadati, percorso e stati di lavorazione.

Stati tecnici:

- `uploaded`;
- `queued`;
- `analyzing`;
- `ready_for_review`;
- `completed`;
- `failed`.

Stati visibili al cliente:

- da verificare;
- in controllo;
- bolletta corretta;
- anomalia rilevata;
- possibile risparmio;
- richiesta integrazione;
- errore.

### `premium_analysis_runs`

Registra ogni analisi IA separatamente, incluse:

- versione parser;
- modello;
- token;
- durata;
- costo stimato;
- dati estratti;
- avvisi ed errori.

Non e leggibile direttamente dal cliente.

### `premium_checks`

Contiene il controllo professionale e l'esito visibile al cliente. Registra anche i secondi effettivi di revisione umana.

### `premium_check_notes`

Contiene esclusivamente note interne dello staff. La separazione impedisce di esporle accidentalmente al cliente tramite il frontend.

### `premium_anomalies`

Registra anomalie di prezzo, quota fissa, sconto, consumo, imposte, conguaglio, contratto o duplicazione.

### `premium_communications`

Canale storico cliente-staff e notifiche di sistema.

### `premium_consents`

Storico append-only dei consensi, comprensivo di versione, fonte, prova tecnica e revoca.

### `premium_cost_events`

Registro indispensabile prima di fissare il prezzo dell'abbonamento. Misura:

- IA;
- revisione umana;
- storage;
- notifiche;
- commissioni di pagamento;
- assistenza;
- altri costi attribuibili.

## 5. Storage

Bucket:

```text
premium-bills
```

Caratteristiche:

- privato;
- soli PDF;
- massimo 20 MB;
- nessun URL pubblico;
- percorso obbligatorio:

```text
<user_id>/<bill_id>/<nome-file.pdf>
```

Il cliente puo leggere e cancellare soltanto file nella propria cartella. Non e consentito sovrascrivere un PDF tramite `UPDATE`.

## 6. Sicurezza RLS

Regole principali:

- nessun accesso `anon` alle tabelle Premium;
- il cliente usa `auth.uid()` per le proprie righe;
- utenze, contratti, bollette, storage ed esiti richiedono un abbonamento `trialing` o `active`;
- il solo marker di registrazione non abilita il servizio;
- lo staff viene riconosciuto tramite `premium_staff_members`;
- dati IA, note interne e costi non sono esposti ai clienti;
- la chiave segreta lato server bypassa RLS e va protetta;
- le colonne `user_id` usate nelle policy sono indicizzate.

## 7. Cose volutamente non attivate

Lo schema v0.2 non attiva ancora:

- prezzi dell'abbonamento;
- provider di pagamento;
- analisi automatica;
- dashboard staff;
- notifiche reali;
- migrazione IndexedDB-cloud;
- modifica della PWA v0.22.

Queste funzioni devono essere aggiunte e collaudate in fasi separate.

## 8. Ordine di applicazione

1. Aprire il progetto Supabase comune gia usato dal sito.
2. Eseguire `supabase/premium-schema-v0.2.sql` nel SQL Editor.
3. Eseguire `supabase/premium-schema-v0.2-verify.sql`.
4. Verificare che `premium-bills` sia privato.
5. Non inserire ancora clienti reali.
6. Creare successivamente un utente test e assegnare manualmente un solo ruolo staff di prova.
7. Collegare Auth alla PWA Premium soltanto dopo il test delle policy RLS.

## 9. Variabili future

Da aggiungere su Vercel nella fase di integrazione, senza rimuovere quelle esistenti:

```text
PREMIUM_SUPABASE_URL=
PREMIUM_SUPABASE_PUBLISHABLE_KEY=
PREMIUM_SUPABASE_SECRET_KEY=
PREMIUM_BILLS_BUCKET=premium-bills
```

Se lo stesso progetto Supabase e gia configurato con altre variabili, i valori possono coincidere; i nomi distinti evitano pero di mescolare il frontend Premium con l'archivio diagnostico.

## 9. Primo test funzionale successivo

Il primo flusso da costruire sara:

```text
Registrazione/Login
→ creazione utenza
→ creazione riga bolletta
→ upload PDF privato
→ visualizzazione della bolletta propria
```

Nessuna analisi IA e nessun pagamento in questa prima prova.


## 10. Correzioni introdotte dalla v0.2

- il trigger Auth non crea piu profili Premium per tutti gli utenti del backend condiviso;
- il recupero iniziale considera soltanto account marcati `offertalogica_product = premium`;
- un account Premium senza abbonamento puo gestire profilo e consensi, ma non puo usare archivio, utenze, contratti o controlli;
- l'accesso al servizio richiede `premium_subscriptions.status` pari a `trialing` o `active`;
- il bucket `premium-bills` applica lo stesso controllo di abbonamento;
- lo schema v0.1 viene reso non eseguibile per prevenire errori.
