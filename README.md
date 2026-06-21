# OffertaLogica Vercel

Questa e la prima versione dell'app operativa per GitHub + Vercel.

## Struttura

```text
public/index.html          Frontend pubblico
come-funziona.html         Pagina trasparenza metodo e servizio
partner.html               Pagina per fornitori, affiliate e partner
api/analyze-pdf.js         Upload e lettura PDF testuali
api/lead.js                Creazione lead
api/send-otp.js            Invio OTP via SMS o demo
api/verify-otp.js          Verifica OTP, con notifica lead business
api/unlock-offers.js       Controllo lead verificato
api/offer-consent.js       Consenso partner sull'offerta scelta
api/health.js              Diagnostica protetta Redis/API
lib/notify.js              Invio lead operativo/cedibile a webhook esterno
lib/rateLimit.js           Limiti anti-spam per API, OTP e upload PDF
lib/                       Utility server
data/                      CSV offerte ARERA
data/destinazioni-offerte.csv
                            Destinazioni monetizzazione offerte
data/template-registro-lead.csv
                            Template Google Sheet/CRM lead
data/acquirenti-lead.csv   Registro potenziali acquirenti lead
docs/                      Note privacy/sicurezza/aziende
docs/MOTORE-CALCOLO.md     Regole del motore tariffario e prossimi livelli di precisione
```

## Pagine pubbliche

- `/`: calcolatore operativo.
- `/come-funziona.html`: spiega metodo, dati usati, limiti della stima, partner e remunerazione.
- `/partner.html`: presenta OffertaLogica a fornitori, network affiliate e partner commerciali.

## Motore di calcolo

Il confronto separa materia/variabile, quota fissa vendita, componenti di profilo e totale annuo stimato. Le offerte solo luce o solo gas vengono confrontate solo sulla commodity corretta, evitando risparmi gonfiati.

Vedi `docs/MOTORE-CALCOLO.md`.

## Deploy su Vercel

1. Crea un repository GitHub con questa cartella.
2. Importa il repository in Vercel.
3. Imposta le variabili ambiente copiando `.env.example`.
4. Deploy.

## Variabili minime

Per testare:

```text
OTP_SECRET=una-stringa-lunga-casuale
```

Senza provider SMS, l'API restituisce `demoCode` per provare il flusso.

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
TWILIO_FROM_NUMBER=
LEAD_WEBHOOK_URL=
LEAD_WEBHOOK_SECRET=
OTP_SECRET=
HEALTHCHECK_TOKEN=
ALLOWED_ORIGINS=https://offertalogica.it,https://www.offertalogica.it,https://offertalogica-vercel.vercel.app
```

Sono supportati anche gli alias `KV_REST_API_URL` e `KV_REST_API_TOKEN`, utili se Vercel o un'integrazione precedente li hanno gia creati.

## SMS OTP

Il sistema sceglie il provider in questo ordine:

1. Aruba SMS, se sono configurate le variabili `ARUBA_SMS_*`;
2. Twilio, se sono configurate le variabili `TWILIO_*`;
3. demo, se non e configurato nessun provider.

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

## Protezioni API

Le API applicano rate limit su creazione lead, invio OTP, verifica OTP, upload PDF e consenso offerta. I limiti sono configurabili con le variabili `RATE_LIMIT_*` presenti in `.env.example`.

In produzione e necessario configurare Redis/Upstash: senza Redis il rate limit usa memoria temporanea, utile per test ma non sufficiente su funzioni serverless.

Le API POST accettano richieste browser solo dagli origin indicati in `ALLOWED_ORIGINS`. Se aggiungi un nuovo dominio o sottodominio, aggiorna questa variabile in Vercel e fai redeploy.

## Diagnostica protetta

`api/health.js` controlla se lo storage Redis risponde, ma resta nascosta senza `HEALTHCHECK_TOKEN`. Per usarla:

1. crea una variabile ambiente `HEALTHCHECK_TOKEN` con una stringa lunga casuale;
2. fai redeploy;
3. apri `https://offertalogica.it/api/health?token=IL_TUO_TOKEN`.

Risposta attesa:

```json
{
  "ok": true,
  "storage": "redis"
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
