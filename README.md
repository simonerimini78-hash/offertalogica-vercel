# OffertaLogica Vercel

Questa e la prima versione dell'app operativa per GitHub + Vercel.

## Struttura

```text
public/index.html          Frontend pubblico
api/analyze-pdf.js         Upload e lettura PDF testuali
api/lead.js                Creazione lead
api/send-otp.js            Invio OTP via SMS o demo
api/verify-otp.js          Verifica OTP, con notifica lead business
api/unlock-offers.js       Controllo lead verificato
api/offer-consent.js       Consenso partner sull'offerta scelta
lib/notify.js              Invio lead operativo/cedibile a webhook esterno
lib/rateLimit.js           Limiti anti-spam per API, OTP e upload PDF
lib/                       Utility server
data/                      CSV offerte ARERA
docs/                      Note privacy/sicurezza/aziende
```

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
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
LEAD_WEBHOOK_URL=
LEAD_WEBHOOK_SECRET=
OTP_SECRET=
```

Sono supportati anche gli alias `KV_REST_API_URL` e `KV_REST_API_TOKEN`, utili se Vercel o un'integrazione precedente li hanno gia creati.

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
