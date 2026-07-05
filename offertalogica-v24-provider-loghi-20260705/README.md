# OffertaLogica Vercel

Questa e la prima versione dell'app operativa per GitHub + Vercel.

## Struttura

```text
public/index.html          Frontend pubblico
public/come-funziona.html  Pagina trasparenza metodo e servizio
public/partner.html        Pagina per fornitori, affiliate e partner
public/casa-smart.html     Pagina affiliazioni casa/smart home
public/internet-casa.html  Pagina affiliazioni internet casa
api/analyze-pdf.js         Upload e lettura PDF testuali
api/lead.js                Creazione lead
api/send-otp.js            Invio OTP via SMS o demo
api/verify-otp.js          Verifica OTP, con notifica lead business
api/unlock-offers.js       Controllo lead verificato
api/offer-consent.js       Consenso partner sull'offerta scelta
api/track-event.js         Raccolta eventi tecnici funnel senza PII
api/health.js              Diagnostica protetta Redis/API
api/staff-leads.js         Vista protetta lead e CSV operativo
api/staff-analytics.js     Vista protetta eventi/funnel
api/staff-preview.js       Attivazione modalita staff/test senza lead
lib/notify.js              Invio lead operativo/cedibile a webhook esterno
lib/customerDb.js          Archivio clienti proprietario opzionale su Supabase/Postgres
lib/rateLimit.js           Limiti anti-spam per API, OTP e upload PDF
lib/                       Utility server
data/                      CSV offerte ARERA
data/destinazioni-offerte.csv
                            Destinazioni monetizzazione offerte
data/calcolo-parametri.json Parametri aggiornabili del motore di calcolo
data/offerte-proposte.json  Offerte proposte aggiornabili dal frontend
data/audit-offerte.csv      Audit operativo delle offerte proposte
data/certificazione-offerte.csv
                            Registro fonti/codici per offerte certificate
data/template-registro-lead.csv
                            Template Google Sheet/CRM lead
data/acquirenti-lead.csv   Registro potenziali acquirenti lead
data/offerte-reali-arera-candidati.csv
                            Candidati importati dagli open data ARERA/AU
data/arera-candidati-menu.csv
                            Candidati ARERA/AU limitati ai fornitori della tendina
data/arera-shortlist-manutenzione.csv
                            Shortlist offerte da verificare/promuovere
data/arera-sync-meta.json   Metadati ultimo sync ARERA/AU
docs/                      Note privacy/sicurezza/aziende
docs/MOTORE-CALCOLO.md     Regole del motore tariffario e prossimi livelli di precisione
docs/AUDIT-OFFERTE.md      Report sintetico sulle offerte da verificare
docs/CERTIFICAZIONE-OFFERTE.md
                            Fonti ufficiali e schede sintetiche usate per certificare le offerte
docs/AGGIORNARE-PARAMETRI-CALCOLO.md
                            Istruzioni per aggiornare profilo medio, indici e componenti
.github/workflows/update-arera-menu.yml
                            Aggiornamento automatico menu offerte ARERA/AU
public/staff-leads.html    Mini console protetta per controllare lead recenti
public/staff-analytics.html
                            Mini console protetta per controllare eventi e funnel
```

## Pagine pubbliche

- `/`: calcolatore operativo.
- `/come-funziona.html`: spiega metodo, dati usati, limiti della stima, partner e remunerazione.
- `/partner.html`: presenta OffertaLogica a fornitori, network affiliate e partner commerciali.

## Motore di calcolo

Il confronto separa materia/variabile, quota fissa vendita, componenti di profilo, componenti regolate/fiscali e totale annuo stimato. Le offerte solo luce o solo gas vengono confrontate solo sulla commodity corretta, evitando risparmi gonfiati.

Il frontend online legge i parametri da `public/data/calcolo-parametri.json` e le offerte da `public/data/offerte-proposte.json`. Se i file non sono disponibili usa il fallback interno.

Vedi:

- `docs/MOTORE-CALCOLO.md`
- `docs/AGGIORNARE-PARAMETRI-CALCOLO.md`

## Deploy su Vercel

1. Crea un repository GitHub con questa cartella.
2. Importa il repository in Vercel.
3. Imposta le variabili ambiente copiando `.env.example`.
4. Deploy.

## Variabili minime

Per testare:

```text
OTP_SECRET=una-stringa-lunga-casuale
DEMO_OTP_ENABLED=true
```

La modalita demo OTP va usata solo per test controllati. In produzione, senza provider SMS configurato, l'OTP restituisce errore e non sblocca le offerte.

Per produzione:

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
ARUBA_SMS_USER_KEY=
ARUBA_SMS_ACCESS_TOKEN=
ARUBA_SMS_SENDER=
ARUBA_SMS_MESSAGE_TYPE=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
TWILIO_FROM_NUMBER=
LEAD_WEBHOOK_URL=
LEAD_WEBHOOK_SECRET=
CUSTOMER_DB_SUPABASE_URL=
CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY=
CUSTOMER_DB_HASH_SECRET=
STAFF_PREVIEW_TOKEN=
OTP_SECRET=
DEMO_OTP_ENABLED=false
HEALTHCHECK_TOKEN=
ALLOWED_ORIGINS=https://offertalogica.it,https://www.offertalogica.it,https://offertalogica-vercel.vercel.app
```

Sono supportati anche gli alias `KV_REST_API_URL` e `KV_REST_API_TOKEN`, utili se Vercel o un'integrazione precedente li hanno gia creati.

## SMS OTP

Il sistema sceglie il provider in questo ordine:

1. Twilio Verify, se sono configurate `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_VERIFY_SERVICE_SID`;
2. Aruba SMS, se sono configurate le variabili `ARUBA_SMS_*`;
3. Twilio Messaging classico, se sono configurate `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_FROM_NUMBER`;
4. demo solo se `DEMO_OTP_ENABLED=true`.

Variabili Twilio Verify:

```text
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
```

Variabili Aruba SMS consigliate:

```text
ARUBA_SMS_USER_KEY=
ARUBA_SMS_ACCESS_TOKEN=
ARUBA_SMS_SENDER=
ARUBA_SMS_MESSAGE_TYPE=
```

In alternativa ad `ARUBA_SMS_ACCESS_TOKEN`, il codice supporta anche:

```text
ARUBA_SMS_SESSION_KEY=
```

`ARUBA_SMS_MESSAGE_TYPE` deve essere il valore indicato da Aruba per la tipologia di SMS acquistata. Non lasciare configurazioni parziali: se imposti Aruba, devono esserci `ARUBA_SMS_USER_KEY`, `ARUBA_SMS_SENDER`, `ARUBA_SMS_MESSAGE_TYPE` e almeno uno tra `ARUBA_SMS_ACCESS_TOKEN` e `ARUBA_SMS_SESSION_KEY`.

## Redis / KV su Vercel

Per la produzione collega un database Redis dal Marketplace Vercel, per esempio Upstash Redis. Dopo il collegamento al progetto, Vercel deve avere in `Settings -> Environment Variables` almeno:

```text
UPSTASH_REDIS_KV_REST_API_URL
UPSTASH_REDIS_KV_REST_API_TOKEN
```

Il codice riconosce anche `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Se l'integrazione mostra solo una REST URL e un REST TOKEN con altri nomi, crea manualmente questi due alias:

```text
KV_REST_API_URL=la REST URL
KV_REST_API_TOKEN=il REST TOKEN
```

Dopo aver aggiunto o modificato le variabili ambiente, fai sempre un nuovo redeploy di produzione.

## Database clienti proprietario

Redis/Upstash serve per OTP, rate limit e stato operativo temporaneo. Per costruire un patrimonio clienti interno, storico consumi, offerte viste, offerte scelte e ricontatti futuri, collega anche un database Postgres/Supabase.

Variabili:

```text
CUSTOMER_DB_SUPABASE_URL=
CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY=
CUSTOMER_DB_LEADS_TABLE=lead_records
CUSTOMER_DB_EVENTS_TABLE=lead_events
CUSTOMER_DB_HASH_SECRET=
```

`CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY` puo essere la nuova chiave Supabase `sb_secret_...` o la vecchia `service_role` legacy. Deve stare solo nelle variabili ambiente Vercel.

Se queste variabili mancano, il sito continua a funzionare senza salvare nel database clienti. Se sono presenti, il backend salva:

- lead creato;
- lead verificato via OTP;
- offerta scelta con consenso partner;
- snapshot di calcolo, dati PDF estratti e consensi.

Lo schema SQL consigliato e in `docs/DATABASE-CLIENTI.md`.

## Vista staff lead

Dopo aver configurato Supabase, puoi controllare i lead recenti da:

```text
https://offertalogica.it/staff-leads.html#token=IL_TUO_STAFF_PREVIEW_TOKEN
```

La pagina non e indicizzata dai motori di ricerca e richiede `STAFF_PREVIEW_TOKEN` o `HEALTHCHECK_TOKEN`.

Endpoint JSON protetto:

```text
https://offertalogica.it/api/staff-leads?token=IL_TUO_TOKEN&limit=50
```

Export CSV protetto:

```text
https://offertalogica.it/api/staff-leads?token=IL_TUO_TOKEN&limit=50&format=csv
```

## Vista staff analytics

Dopo aver configurato Supabase e caricato una versione con gli eventi funnel, puoi controllare andamento del percorso da:

```text
https://offertalogica.it/staff-analytics.html#token=IL_TUO_STAFF_PREVIEW_TOKEN
```

La pagina non mostra nominativi: riassume eventi tecnici come PDF letti, confronti completati, popup aperti, OTP verificati, offerte cliccate, redirect partner e richieste consulente.

Endpoint JSON protetto:

```text
https://offertalogica.it/api/staff-analytics?token=IL_TUO_TOKEN&limit=200
```

## Modalita staff/test

La modalita staff permette di controllare calcolatore, popup, offerte e landing senza creare lead, senza scrivere nel database clienti, senza webhook e senza OTP reale.

1. Crea in Vercel una variabile `STAFF_PREVIEW_TOKEN` con una stringa lunga casuale.
2. Fai redeploy.
3. Apri il sito con `https://offertalogica.it/#staff=IL_TUO_TOKEN`.
4. Il sito rimuove il token dalla barra indirizzi e mostra la barra `Modalita staff attiva`.
5. Per uscire premi `Esci` nella barra staff oppure apri `https://offertalogica.it/#staff=off`.

In modalita staff il codice OTP simulato e `000000`. Quando apri una landing Tradedoubler, il frontend prova a usare la URL finale senza il tracker affiliato, cosi i test non generano click affiliati artificiali.

## Controlli locali

Per controllare HTML, JSON e motore di calcolo:

```text
npm run validate:calculator
```

Il controllo verifica anche che le offerte solo luce o solo gas non vengano confrontate contro tutta la spesa luce+gas.

Per generare la checklist delle offerte da verificare:

```text
npm run audit:offers
```

Questo comando aggiorna `data/audit-offerte.csv` e `docs/AUDIT-OFFERTE.md`.

Le offerte certificate sono tracciate in `data/certificazione-offerte.csv`. Non modificare un prezzo nel JSON pubblico senza aggiornare anche il registro di certificazione.

## Aggiornamento open data ARERA/AU

Gli open data del Portale Offerte ARERA/AU vengono usati come magazzino neutro di offerte reali.

Per aggiornare manualmente i candidati:

```text
npm run sync:arera
npm run shortlist:arera
```

`sync:arera` scarica l'ultimo pacchetto mercato libero luce/gas dal Portale Offerte e aggiorna:

- `data/offerte-reali-arera-candidati.csv`;
- `data/arera-sync-meta.json`.

`shortlist:arera` genera:

- `data/arera-shortlist-manutenzione.csv`.
- `data/arera-candidati-menu.csv`.

Il file completo `offerte-reali-arera-candidati.csv` resta come archivio tecnico. Il lavoro operativo parte invece da `arera-candidati-menu.csv`, che contiene solo i fornitori presenti nella tendina del calcolatore.

Per promuovere una riga ARERA dentro il listino pubblico:

```text
npm run promote:arera -- --offer-id 11 --luce CODICE_LUCE --gas CODICE_GAS
```

Esempio per offerta solo luce:

```text
npm run promote:arera -- --offer-id 6 --luce CODICE_LUCE
```

Prima di scrivere i file puoi fare una simulazione:

```text
npm run promote:arera -- --offer-id 11 --luce CODICE_LUCE --gas CODICE_GAS --dry-run
```

Lo script aggiorna:

- `data/offerte-proposte.json`;
- `public/data/offerte-proposte.json`;
- `data/certificazione-offerte.csv`.

Per sicurezza promuove solo righe `pronta_fisso`. Le variabili `PUN/PSV + spread` restano fuori dalla promozione automatica finche non sono state modellate con formula completa.

Il link live resta quello commerciale/affiliato gia presente. Solo se vuoi sostituirlo con il link ARERA devi aggiungere:

```text
--update-link
```

Il workflow GitHub `.github/workflows/update-arera-menu.yml` aggiorna il menu ARERA/AU con esecuzione manuale o programmata.

Importante: l'automazione non modifica `data/offerte-proposte.json` e non modifica `public/data/offerte-proposte.json`. Le offerte pubbliche vanno promosse solo dopo verifica della scheda sintetica, link attivabile e modello di monetizzazione.

## Protezioni API

Le API applicano rate limit su creazione lead, invio OTP, verifica OTP, upload PDF e consenso offerta. I limiti sono configurabili con le variabili `RATE_LIMIT_*` presenti in `.env.example`.

In produzione e necessario configurare Redis/Upstash: senza Redis il rate limit usa memoria temporanea, utile per test ma non sufficiente su funzioni serverless.

Le API POST accettano richieste browser solo dagli origin indicati in `ALLOWED_ORIGINS`. Se aggiungi un nuovo dominio o sottodominio, aggiorna questa variabile in Vercel e fai redeploy.

## Diagnostica protetta

`api/health.js` controlla se lo storage Redis risponde e, se configurato, se il database clienti risponde. Resta nascosta senza `HEALTHCHECK_TOKEN` o `STAFF_PREVIEW_TOKEN`. Per usarla:

1. crea una variabile ambiente `HEALTHCHECK_TOKEN` con una stringa lunga casuale;
2. fai redeploy;
3. apri `https://offertalogica.it/api/health?token=IL_TUO_TOKEN`.

Se il valore di `HEALTHCHECK_TOKEN` non e recuperabile perche e sensitive, puoi usare anche il valore di `STAFF_PREVIEW_TOKEN`.

Risposta attesa:

```json
{
  "ok": true,
  "storage": "redis",
  "customerDb": {
    "ok": true,
    "configured": false,
    "status": "not_configured"
  }
}
```

Se il token manca o e sbagliato, l'endpoint risponde come pagina non trovata.

## Notifica lead

Per i privati l'OTP verifica il numero e sblocca le offerte, ma non invia il lead a terzi. Il webhook parte solo quando l'utente clicca su una specifica offerta e conferma il consenso partner in `api/offer-consent.js`.

Per le aziende il popup resta unico: dopo OTP verificato il webhook puo ricevere l'evento `business_consulting_request`, perche la richiesta richiede un consulente e non un'attivazione self-service.

Il webhook puo essere un endpoint Make, Zapier, CRM, Google Sheet o partner CPL/CPA. Se `LEAD_WEBHOOK_URL` non e configurato, il flusso continua senza invio esterno.

Il payload contiene:

- dati contatto;
- tipo cliente privato/business;
- consensi;
- risparmio stimato;
- dati PDF letti;
- profilo business, se presente;
- offerta selezionata;
- timestamp consenso offerta.

## Monetizzazione offerte

Le destinazioni commerciali sono separate dalle tariffe in `data/destinazioni-offerte.csv`.

Usa questo file per segnare, per ogni offerta:

- network o partner;
- stato approvazione;
- link tracking;
- modello pagamento;
- note operative.

Le tariffe servono al calcolo. Le destinazioni servono a trasformare il click o il lead in ricavo. Vedi `docs/MONETIZZAZIONE-DESTINAZIONI.md`.

## Registro lead

Il template iniziale per Google Sheet/CRM e `data/template-registro-lead.csv`.

Usalo per tracciare:

- lead verificati;
- offerta scelta;
- consenso partner;
- destinazione commerciale;
- stato lavorazione;
- commissione prevista e confermata.

Vedi `docs/REGISTRO-LEAD-CRM.md`.

## Vendita lead

I potenziali acquirenti o gestori lead sono tracciati in `data/acquirenti-lead.csv`.

Vedi:

- `docs/VENDITA-LEAD.md`
- `docs/RICERCA-ACQUIRENTI-LEAD.md`
- `docs/TEMPLATE-CONTATTO-ACQUIRENTI-LEAD.md`

## Nota PDF

L'endpoint legge bene PDF testuali. Per bollette scansionate o PDF complessi si puo collegare `GEMINI_API_KEY` come fallback OCR/AI in una fase successiva.

## Nota privacy

Prima della produzione reale servono:

- informativa privacy definitiva;
- consensi separati;
- nomina responsabili esterni;
- retention lead;
- policy cancellazione PDF;
- audit accessi.
