# OffertaLogica

Comparatore luce e gas per privati e aziende, con lettura bollette, verifica OTP, archivio operativo e percorsi partner.

## Struttura

```text
public/index.html                         Calcolatore pubblico
public/offerte-luce-gas-aggiornate.html  Pagina SEO alimentata dal catalogo canonico
public/fornitori/                         Pagine fornitore alimentate dal catalogo canonico
public/staff-analytics.html               Analytics e diagnostica catalogo ARERA
api/                                      Funzioni serverless Vercel
lib/                                      Logica backend condivisa
scripts/update-arera-menu.py              Unica trasformazione canonica ARERA/AU
data/offerte-arera-menu.json              Catalogo validato di lavoro
public/data/offerte-arera-menu.json       Copia pubblica identica
data/arera-update-report.json             Report validazione e quarantena
public/data/arera-update-report.json      Copia pubblica identica
data/partner-metadata.json                Solo logo, URL e metadati non economici
```

## Catalogo ARERA

Prezzi, quote fisse, codici, validita, tipo prezzo e clientela provengono esclusivamente dagli XML ufficiali ARERA/Acquirente Unico. Il flusso e:

```text
download XML -> staging -> normalizzazione -> validazione -> quarantena -> pubblicazione atomica
```

Il solo trasformatore economico e `scripts/update-arera-menu.py`. `scripts/build-public-arera-menu.mjs` e un punto di ingresso compatibile che delega allo stesso script Python.

Se una riga non e interpretabile con certezza, non viene pubblicata. Se l'intero aggiornamento fallisce, i cataloghi pubblici precedenti restano integralmente invariati. Non vengono recuperate singole offerte del giorno precedente.

I metadati partner in `data/partner-metadata.json` non possono contenere prezzi, quote, codici offerta, spread, indici o durate. Una rotta partner viene aggiunta soltanto a una riga corrente gia validata.

Aggiornamento da XML locali:

```bash
python3 scripts/update-arera-menu.py \
  --source-dir /percorso/xml \
  --as-of YYYY-MM-DD
```

Aggiornamento dalla rete, quando il Portale Offerte accetta la richiesta:

```bash
npm run update:arera
```

Su macOS e disponibile anche `scripts/aggiorna-arera-locale-mac.sh`.

## Verifiche

```bash
npm run test:arera
npm run validate-calculator-data
npm run verify-calcolo-offerte
npm run test:ranking-arera
npm run test:js
npm run audit:offers
```

## Variabili ambiente principali

```text
OTP_SECRET
STAFF_PREVIEW_TOKEN
HEALTHCHECK_TOKEN
UPSTASH_REDIS_KV_REST_API_URL
UPSTASH_REDIS_KV_REST_API_TOKEN
CUSTOMER_DB_SUPABASE_URL
CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY
SMS_PROVIDER
ARUBA_SMS_USER_KEY
ARUBA_SMS_ACCESS_TOKEN
ARUBA_SMS_SENDER
ARUBA_SMS_MESSAGE_TYPE
```

Le credenziali non devono essere salvate nel repository. Per dettagli su PDF, OTP, database e procedure operative consultare i documenti in `docs/`.
