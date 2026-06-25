# Database clienti proprietario

Questo database serve a creare un patrimonio dati interno OffertaLogica: utenti verificati, consumi, offerte viste/scelte, consensi e storico utile per ricontatti futuri.

Redis/Upstash resta lo storage tecnico per OTP, rate limit e stato temporaneo. Il database clienti e lo storico proprietario.

## Quando salva

Il backend salva uno snapshot in tre momenti:

- `lead_created`: l'utente compila i dati e richiede OTP;
- `lead_verified`: l'OTP viene verificato;
- `offer_partner_consent`: l'utente sceglie una specifica offerta e conferma il consenso partner.

La modalita staff non passa da questi endpoint e quindi non salva nulla.

## Schema Supabase/Postgres

Esegui questo SQL nel pannello SQL di Supabase.

```sql
create table if not exists lead_records (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text,
  customer_type text,
  name text,
  email text,
  phone text,
  source text,
  privacy_version text,
  consent_service boolean not null default false,
  consent_marketing boolean not null default false,
  consent_partners boolean not null default false,
  consent_profiling boolean not null default false,
  best_saving numeric,
  selected_offer jsonb,
  calculation jsonb,
  record jsonb
);

create table if not exists lead_events (
  id bigint generated always as identity primary key,
  lead_id text references lead_records(id) on delete set null,
  event_type text not null,
  created_at timestamptz not null default now(),
  payload jsonb
);

create index if not exists lead_records_created_at_idx on lead_records (created_at desc);
create index if not exists lead_records_status_idx on lead_records (status);
create index if not exists lead_records_customer_type_idx on lead_records (customer_type);
create index if not exists lead_events_lead_id_idx on lead_events (lead_id);
create index if not exists lead_events_event_type_idx on lead_events (event_type);
create index if not exists lead_events_created_at_idx on lead_events (created_at desc);
```

## Vista commerciale opzionale

Questa vista rende piu leggibili i lead che hanno scelto un'offerta. Non e obbligatoria per il funzionamento del sito.

```sql
create or replace view lead_commercial_view as
select
  id,
  created_at,
  updated_at,
  status,
  customer_type,
  name,
  email,
  phone,
  best_saving,
  selected_offer ->> 'provider' as selected_provider,
  selected_offer ->> 'name' as selected_offer_name,
  record #>> '{monetization,network}' as network,
  record #>> '{monetization,model}' as commission_model,
  nullif(record #>> '{monetization,expectedCommission}', '')::numeric as expected_commission,
  nullif(record #>> '{monetization,economyRank}', '')::numeric as economy_rank,
  record #>> '{monetization,displayGroup}' as display_group,
  nullif(record #>> '{monetization,annualCost}', '')::numeric as annual_cost,
  nullif(record #>> '{monetization,annualDelta}', '')::numeric as annual_delta,
  consent_service,
  consent_partners,
  privacy_version
from lead_records
where selected_offer is not null;
```

## Variabili Vercel

```text
CUSTOMER_DB_SUPABASE_URL=
CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY=
CUSTOMER_DB_LEADS_TABLE=lead_records
CUSTOMER_DB_EVENTS_TABLE=lead_events
CUSTOMER_DB_HASH_SECRET=
```

`CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY` puo contenere la nuova secret key Supabase `sb_secret_...` oppure la vecchia `service_role` JWT legacy. Deve restare solo lato server in Vercel. Non va mai inserita nel frontend, nel codice o su GitHub.

`CUSTOMER_DB_HASH_SECRET` serve a salvare l'hash dell'indirizzo IP tecnico senza conservare l'IP in chiaro nello snapshot JSON.

## Sicurezza

- Non usare la chiave anon pubblica per questo flusso.
- Non esporre Supabase dal frontend.
- Limita l'accesso al pannello Supabase a persone autorizzate.
- Definisci una retention coerente con informativa privacy e finalita di ricontatto.
- Se esporti dati verso Google Sheet, CRM o partner, conserva il consenso e lo stato della pratica.

## Health check

Dopo il deploy, l'endpoint protetto:

```text
https://offertalogica.it/api/health?token=IL_TUO_HEALTHCHECK_TOKEN
```

mostra anche `customerDb`. Se il database non e configurato risponde:

```json
{
  "ok": true,
  "configured": false,
  "status": "not_configured"
}
```

Quando Supabase e collegato correttamente, `configured` diventa `true` e `status` diventa `ready`.
