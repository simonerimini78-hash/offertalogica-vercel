# Database clienti proprietario

Questo database serve a creare un patrimonio dati interno OffertaLogica: utenti verificati, consumi, offerte viste/scelte, consensi e storico utile per ricontatti futuri.

Redis/Upstash resta lo storage tecnico per OTP, rate limit e stato temporaneo. Il database clienti e lo storico proprietario.

## Quando salva

Il backend salva uno snapshot in tre momenti:

- `lead_created`: l'utente compila i dati e richiede OTP;
- `lead_verified`: l'OTP viene verificato;
- `offer_partner_consent`: l'utente sceglie una specifica offerta e conferma il consenso partner.

La modalita staff non passa da questi endpoint e quindi non salva nulla.

## Cosa viene conservato

- Dati contatto del lead: nome, email, telefono.
- Dati della comparazione: origine del dato (`pdf_upload`, `manual_input`, `arera_average_profile`, `business_profile`), consumi, fornitore attuale, prezzi letti/inseriti, quote fisse, tipo prezzo, tipo fornitura, regione e risparmio stimato.
- Dati PDF normalizzati: valori tecnici estratti da bolletta o scheda sintetica.
- Consensi e prova tecnica del consenso: versione privacy, fonte, pagina, timestamp server.
- Offerta scelta e monetizzazione prevista, se l'utente procede con una proposta.

## Cosa non viene conservato

- Il file PDF originale non viene salvato come documento permanente.
- In modalita staff non viene creato alcun lead e non viene scritto nulla nel database.
- I dati non vengono trasmessi a partner esterni finche l'utente non conferma anche il consenso partner su una specifica offerta.

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

## Vista tecnica anonimizzata per migliorare il motore

Questa vista serve a studiare consumi, prezzi, origine dei dati e comportamento sulle offerte senza usare nome, email, telefono, POD o PDR. E utile per affinare il motore di calcolo con bollette reali.

```sql
create or replace view calculation_insights_view as
select
  md5(id) as lead_hash,
  created_at,
  updated_at,
  status,
  customer_type,
  source,
  calculation ->> 'dataOrigin' as data_origin,
  nullif(calculation #>> '{comparisonProfile,pdfDocumentCount}', '')::numeric as pdf_document_count,
  calculation #>> '{comparisonProfile,tipoPrezzo}' as tipo_prezzo,
  calculation #>> '{comparisonProfile,tipoFornitura}' as tipo_fornitura,
  calculation #>> '{comparisonProfile,regioneGas}' as regione_gas,
  nullif(calculation #>> '{comparisonProfile,potenzaKw}', '')::numeric as potenza_kw,
  calculation #>> '{comparisonProfile,fornitoreAttuale}' as fornitore_attuale,
  nullif(calculation #>> '{comparisonProfile,luceConsumoKwh}', '')::numeric as luce_consumo_kwh,
  nullif(calculation #>> '{comparisonProfile,gasConsumoSmc}', '')::numeric as gas_consumo_smc,
  nullif(calculation #>> '{currentSupply,luce,prezzoVariabile}', '')::numeric as luce_prezzo_eur_kwh,
  nullif(calculation #>> '{currentSupply,gas,prezzoVariabile}', '')::numeric as gas_prezzo_eur_smc,
  nullif(calculation #>> '{currentSupply,luce,quotaFissaAnnua}', '')::numeric as luce_quota_fissa_annua,
  nullif(calculation #>> '{currentSupply,gas,quotaFissaAnnua}', '')::numeric as gas_quota_fissa_annua,
  best_saving,
  selected_offer ->> 'provider' as selected_provider,
  selected_offer ->> 'name' as selected_offer_name,
  selected_offer ->> 'destinationType' as selected_destination_type,
  selected_offer ->> 'destinationStatus' as selected_destination_status
from lead_records
where consent_service = true;
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

## Vista staff lead

Per un controllo rapido senza entrare nel pannello Supabase:

```text
https://offertalogica.it/staff-leads.html#token=IL_TUO_STAFF_PREVIEW_TOKEN
```

La pagina usa l'endpoint protetto:

```text
https://offertalogica.it/api/staff-leads?token=IL_TUO_TOKEN&limit=50
```

Puoi scaricare anche un CSV operativo:

```text
https://offertalogica.it/api/staff-leads?token=IL_TUO_TOKEN&limit=50&format=csv
```

Usare questa vista solo internamente. Contiene dati personali e va protetta come il pannello Supabase.
