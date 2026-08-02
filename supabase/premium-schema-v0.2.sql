-- OffertaLogica Premium - schema condiviso sito/app, versione 0.2
-- Base applicativa: PWA gratuita v0.22, branch Premium: App-Premium-ok
-- Auth verificato: provider Email; URL Auth da configurare solo quando esiste un URL Premium stabile.
-- Questo script crea SOLO risorse nuove con prefisso premium_ e il bucket premium-bills.
-- Non modifica lead_records, lead_events, pdf_analyses o pdf-test-archive.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Funzioni comuni
-- -----------------------------------------------------------------------------

create or replace function public.premium_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profili e ruoli staff
-- -----------------------------------------------------------------------------

create table if not exists public.premium_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'deletion_requested', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.premium_staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('support', 'reviewer', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.premium_is_staff(allowed_roles text[] default array['support', 'reviewer', 'admin']::text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.premium_staff_members staff
    where staff.user_id = (select auth.uid())
      and staff.active = true
      and staff.role = any(allowed_roles)
  );
$$;

revoke all on function public.premium_is_staff(text[]) from public, anon;
grant execute on function public.premium_is_staff(text[]) to authenticated, service_role;

create or replace function public.premium_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sito e app condividono auth.users. Il profilo Premium nasce solo
  -- quando la registrazione proviene esplicitamente dall'app Premium.
  if coalesce(new.raw_user_meta_data ->> 'offertalogica_product', '') <> 'premium' then
    return new;
  end if;

  insert into public.premium_profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.phone, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.premium_handle_new_user() from public, anon, authenticated;

create or replace function public.premium_has_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.premium_profiles profile
    where profile.id = (select auth.uid())
      and profile.account_status = 'active'
  );
$$;

revoke all on function public.premium_has_profile() from public, anon;
grant execute on function public.premium_has_profile() to authenticated, service_role;

drop trigger if exists premium_on_auth_user_created on auth.users;
create trigger premium_on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.premium_handle_new_user();

-- Recupera soltanto eventuali registrazioni Premium gia marcate.
-- Non converte automaticamente gli utenti Auth del sito in clienti Premium.
insert into public.premium_profiles (id, full_name, phone)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', ''),
  coalesce(users.phone, '')
from auth.users users
where coalesce(users.raw_user_meta_data ->> 'offertalogica_product', '') = 'premium'
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Abbonamenti, utenze e contratti
-- -----------------------------------------------------------------------------

create table if not exists public.premium_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'trialing', 'active', 'past_due', 'paused', 'canceled', 'expired')),
  plan_code text not null default 'premium-base',
  included_utilities integer not null default 1 check (included_utilities between 1 and 100),
  included_bills_per_year integer not null default 12 check (included_bills_per_year between 1 and 1200),
  provider text not null default '',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create or replace function public.premium_has_service_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.premium_has_profile())
    and exists (
      select 1
      from public.premium_subscriptions subscription
      where subscription.user_id = (select auth.uid())
        and subscription.status in ('trialing', 'active')
        and (
          subscription.current_period_end is null
          or subscription.current_period_end > now()
        )
    );
$$;

revoke all on function public.premium_has_service_access() from public, anon;
grant execute on function public.premium_has_service_access() to authenticated, service_role;

create table if not exists public.premium_utilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default '',
  supply_type text not null check (supply_type in ('electricity', 'gas', 'dual')),
  provider_name text not null default '',
  pod text not null default '',
  pdr text not null default '',
  address jsonb not null default '{}'::jsonb,
  expected_bills_per_year integer not null default 12 check (expected_bills_per_year between 1 and 60),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.premium_contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  utility_id uuid not null,
  provider_name text not null default '',
  offer_name text not null default '',
  pricing_type text not null default 'unknown' check (pricing_type in ('fixed', 'indexed', 'mixed', 'unknown')),
  contract_start date,
  contract_end date,
  fixed_price_expiry date,
  electricity_price_eur_kwh numeric(12, 6),
  gas_price_eur_smc numeric(12, 6),
  electricity_fixed_fee_eur_year numeric(12, 2),
  gas_fixed_fee_eur_year numeric(12, 2),
  source text not null default 'manual' check (source in ('manual', 'bill', 'staff', 'import')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'needs_review', 'verified', 'rejected')),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint premium_contracts_utility_owner_fk
    foreign key (utility_id, user_id)
    references public.premium_utilities(id, user_id)
    on delete cascade
);

-- -----------------------------------------------------------------------------
-- Bollette e lavorazione professionale
-- -----------------------------------------------------------------------------

create table if not exists public.premium_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  utility_id uuid not null,
  contract_id uuid,
  commodity text not null default 'unknown' check (commodity in ('electricity', 'gas', 'dual', 'unknown')),
  billing_period_start date,
  billing_period_end date,
  issue_date date,
  due_date date,
  total_amount_eur numeric(12, 2),
  currency text not null default 'EUR' check (currency = 'EUR'),
  original_file_name text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  file_sha256 text not null default '',
  storage_bucket text not null default 'premium-bills' check (storage_bucket = 'premium-bills'),
  storage_path text not null unique,
  processing_status text not null default 'uploaded'
    check (processing_status in ('uploaded', 'queued', 'analyzing', 'ready_for_review', 'completed', 'failed')),
  customer_status text not null default 'awaiting_review'
    check (customer_status in ('awaiting_review', 'in_review', 'correct', 'anomaly_found', 'saving_opportunity', 'more_info_required', 'failed')),
  completed_at timestamptz,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint premium_bills_utility_owner_fk
    foreign key (utility_id, user_id)
    references public.premium_utilities(id, user_id)
    on delete restrict,
  constraint premium_bills_contract_owner_fk
    foreign key (contract_id, user_id)
    references public.premium_contracts(id, user_id)
    on delete restrict
);

create table if not exists public.premium_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_number integer not null default 1 check (run_number > 0),
  parser_version text not null default 'unknown',
  model text not null default '',
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost_eur numeric(14, 6) check (estimated_cost_eur is null or estimated_cost_eur >= 0),
  extracted_data jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_code text not null default '',
  error_message text not null default '',
  created_at timestamptz not null default now(),
  unique (bill_id, run_number),
  constraint premium_analysis_runs_bill_owner_fk
    foreign key (bill_id, user_id)
    references public.premium_bills(id, user_id)
    on delete cascade
);

create table if not exists public.premium_checks (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_staff_id uuid references public.premium_staff_members(user_id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'assigned', 'in_review', 'more_info_required', 'completed', 'canceled')),
  outcome text not null default 'pending'
    check (outcome in ('pending', 'correct', 'anomaly', 'possible_saving', 'inconclusive')),
  summary text not null default '',
  customer_message text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  human_seconds integer not null default 0 check (human_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint premium_checks_bill_owner_fk
    foreign key (bill_id, user_id)
    references public.premium_bills(id, user_id)
    on delete cascade
);

-- Le note interne sono separate dai controlli visibili al cliente.
create table if not exists public.premium_check_notes (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.premium_checks(id) on delete cascade,
  staff_user_id uuid not null references public.premium_staff_members(user_id) on delete restrict,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.premium_anomalies (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null,
  check_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'other'
    check (category in ('price', 'fixed_fee', 'discount', 'consumption', 'tax', 'adjustment', 'contract', 'duplicate', 'other')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  title text not null,
  description text not null default '',
  estimated_impact_eur numeric(12, 2),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint premium_anomalies_bill_owner_fk
    foreign key (bill_id, user_id)
    references public.premium_bills(id, user_id)
    on delete cascade,
  constraint premium_anomalies_check_owner_fk
    foreign key (check_id, user_id)
    references public.premium_checks(id, user_id)
    on delete cascade
);

create table if not exists public.premium_communications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid,
  check_id uuid,
  direction text not null check (direction in ('user_to_staff', 'staff_to_user', 'system_to_user')),
  channel text not null default 'in_app' check (channel in ('in_app', 'email', 'push')),
  subject text not null default '',
  body text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_staff_id uuid references public.premium_staff_members(user_id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint premium_communications_actor_check check (
    (direction = 'user_to_staff' and created_by_user_id is not null and created_by_staff_id is null)
    or (direction = 'staff_to_user' and created_by_staff_id is not null)
    or (direction = 'system_to_user' and created_by_user_id is null)
  ),
  constraint premium_communications_bill_owner_fk
    foreign key (bill_id, user_id)
    references public.premium_bills(id, user_id)
    on delete cascade,
  constraint premium_communications_check_owner_fk
    foreign key (check_id, user_id)
    references public.premium_checks(id, user_id)
    on delete cascade
);

create table if not exists public.premium_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null
    check (consent_type in ('terms', 'privacy', 'cloud_storage', 'remote_review', 'marketing', 'profiling')),
  version text not null,
  granted boolean not null,
  source text not null default 'premium_app',
  proof jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Registro economico: serve a misurare il costo reale prima di fissare il prezzo.
create table if not exists public.premium_cost_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  bill_id uuid references public.premium_bills(id) on delete set null,
  analysis_run_id uuid references public.premium_analysis_runs(id) on delete set null,
  check_id uuid references public.premium_checks(id) on delete set null,
  event_type text not null
    check (event_type in ('ai_analysis', 'human_review', 'storage', 'notification', 'payment_fee', 'support', 'other')),
  provider text not null default '',
  quantity numeric(18, 6) not null default 1 check (quantity >= 0),
  unit text not null default 'event',
  cost_eur numeric(14, 6) not null default 0 check (cost_eur >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Indici
-- -----------------------------------------------------------------------------

create index if not exists premium_subscriptions_user_idx on public.premium_subscriptions (user_id, status);
create index if not exists premium_subscriptions_period_end_idx on public.premium_subscriptions (current_period_end);
create index if not exists premium_utilities_user_idx on public.premium_utilities (user_id, status);
create index if not exists premium_contracts_user_idx on public.premium_contracts (user_id, utility_id, is_current);
create index if not exists premium_bills_user_idx on public.premium_bills (user_id, created_at desc);
create index if not exists premium_bills_utility_idx on public.premium_bills (utility_id, created_at desc);
create index if not exists premium_bills_status_idx on public.premium_bills (processing_status, customer_status, created_at);
create index if not exists premium_analysis_runs_bill_idx on public.premium_analysis_runs (bill_id, run_number desc);
create index if not exists premium_checks_bill_idx on public.premium_checks (bill_id, created_at desc);
create index if not exists premium_checks_staff_idx on public.premium_checks (assigned_staff_id, status, created_at);
create index if not exists premium_anomalies_user_idx on public.premium_anomalies (user_id, status, created_at desc);
create index if not exists premium_communications_user_idx on public.premium_communications (user_id, created_at desc);
create index if not exists premium_consents_user_idx on public.premium_consents (user_id, consent_type, recorded_at desc);
create index if not exists premium_cost_events_user_idx on public.premium_cost_events (user_id, occurred_at desc);
create index if not exists premium_cost_events_type_idx on public.premium_cost_events (event_type, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Trigger updated_at
-- -----------------------------------------------------------------------------

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'premium_profiles',
    'premium_staff_members',
    'premium_subscriptions',
    'premium_utilities',
    'premium_contracts',
    'premium_bills',
    'premium_checks',
    'premium_anomalies'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute procedure public.premium_set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e permessi
-- -----------------------------------------------------------------------------

alter table public.premium_profiles enable row level security;
alter table public.premium_staff_members enable row level security;
alter table public.premium_subscriptions enable row level security;
alter table public.premium_utilities enable row level security;
alter table public.premium_contracts enable row level security;
alter table public.premium_bills enable row level security;
alter table public.premium_analysis_runs enable row level security;
alter table public.premium_checks enable row level security;
alter table public.premium_check_notes enable row level security;
alter table public.premium_anomalies enable row level security;
alter table public.premium_communications enable row level security;
alter table public.premium_consents enable row level security;
alter table public.premium_cost_events enable row level security;

revoke all on table
  public.premium_profiles,
  public.premium_staff_members,
  public.premium_subscriptions,
  public.premium_utilities,
  public.premium_contracts,
  public.premium_bills,
  public.premium_analysis_runs,
  public.premium_checks,
  public.premium_check_notes,
  public.premium_anomalies,
  public.premium_communications,
  public.premium_consents,
  public.premium_cost_events
from anon, authenticated;

-- Un utente autenticato riceve i privilegi SQL necessari; RLS limita le righe.
grant select, update (full_name, phone) on public.premium_profiles to authenticated;
grant select on public.premium_staff_members to authenticated;
grant select, insert, update, delete on public.premium_subscriptions to authenticated;
grant select, insert, update, delete on public.premium_utilities to authenticated;
grant select, insert, update, delete on public.premium_contracts to authenticated;
grant select, insert, update, delete on public.premium_bills to authenticated;
grant select, insert, update, delete on public.premium_analysis_runs to authenticated;
grant select, insert, update, delete on public.premium_checks to authenticated;
grant select, insert, update, delete on public.premium_check_notes to authenticated;
grant select, insert, update, delete on public.premium_anomalies to authenticated;
grant select, insert, update (read_at) on public.premium_communications to authenticated;
grant select, insert on public.premium_consents to authenticated;
grant select, insert, update, delete on public.premium_cost_events to authenticated;

grant all on table
  public.premium_profiles,
  public.premium_staff_members,
  public.premium_subscriptions,
  public.premium_utilities,
  public.premium_contracts,
  public.premium_bills,
  public.premium_analysis_runs,
  public.premium_checks,
  public.premium_check_notes,
  public.premium_anomalies,
  public.premium_communications,
  public.premium_consents,
  public.premium_cost_events
  to service_role;

-- Profili

drop policy if exists premium_profiles_owner_select on public.premium_profiles;
create policy premium_profiles_owner_select
on public.premium_profiles for select to authenticated
using ((select auth.uid()) is not null and id = (select auth.uid()));

drop policy if exists premium_profiles_owner_update on public.premium_profiles;
create policy premium_profiles_owner_update
on public.premium_profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists premium_profiles_staff_select on public.premium_profiles;
create policy premium_profiles_staff_select
on public.premium_profiles for select to authenticated
using ((select public.premium_is_staff()));

-- Elenco staff: ogni membro vede il proprio record; gli admin vedono tutti.

drop policy if exists premium_staff_self_select on public.premium_staff_members;
create policy premium_staff_self_select
on public.premium_staff_members for select to authenticated
using (user_id = (select auth.uid()) or (select public.premium_is_staff(array['admin'])));

-- Abbonamenti: il cliente legge il proprio; lo staff gestisce.

drop policy if exists premium_subscriptions_owner_select on public.premium_subscriptions;
create policy premium_subscriptions_owner_select
on public.premium_subscriptions for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
);

drop policy if exists premium_subscriptions_staff_all on public.premium_subscriptions;
create policy premium_subscriptions_staff_all
on public.premium_subscriptions for all to authenticated
using ((select public.premium_is_staff(array['admin', 'support'])))
with check ((select public.premium_is_staff(array['admin', 'support'])));

-- Utenze

drop policy if exists premium_utilities_owner_select on public.premium_utilities;
create policy premium_utilities_owner_select
on public.premium_utilities for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_utilities_owner_insert on public.premium_utilities;
create policy premium_utilities_owner_insert
on public.premium_utilities for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_utilities_owner_update on public.premium_utilities;
create policy premium_utilities_owner_update
on public.premium_utilities for update to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
)
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_utilities_owner_delete on public.premium_utilities;
create policy premium_utilities_owner_delete
on public.premium_utilities for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_utilities_staff_all on public.premium_utilities;
create policy premium_utilities_staff_all
on public.premium_utilities for all to authenticated
using ((select public.premium_is_staff()))
with check ((select public.premium_is_staff()));

-- Contratti

drop policy if exists premium_contracts_owner_select on public.premium_contracts;
create policy premium_contracts_owner_select
on public.premium_contracts for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_contracts_owner_insert on public.premium_contracts;
create policy premium_contracts_owner_insert
on public.premium_contracts for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and verification_status = 'unverified'
);

drop policy if exists premium_contracts_owner_update on public.premium_contracts;
create policy premium_contracts_owner_update
on public.premium_contracts for update to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and verification_status in ('unverified', 'needs_review')
)
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and verification_status in ('unverified', 'needs_review')
);

drop policy if exists premium_contracts_owner_delete on public.premium_contracts;
create policy premium_contracts_owner_delete
on public.premium_contracts for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_contracts_staff_all on public.premium_contracts;
create policy premium_contracts_staff_all
on public.premium_contracts for all to authenticated
using ((select public.premium_is_staff()))
with check ((select public.premium_is_staff()));

-- Bollette

drop policy if exists premium_bills_owner_select on public.premium_bills;
create policy premium_bills_owner_select
on public.premium_bills for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and deleted_at is null
);

drop policy if exists premium_bills_owner_insert on public.premium_bills;
create policy premium_bills_owner_insert
on public.premium_bills for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and storage_bucket = 'premium-bills'
  and split_part(storage_path, '/', 1) = (select auth.uid())::text
  and processing_status = 'uploaded'
  and customer_status = 'awaiting_review'
  and completed_at is null
  and deleted_at is null
);

-- Il cliente non aggiorna gli stati di lavorazione: li gestiscono backend e staff.
drop policy if exists premium_bills_owner_update on public.premium_bills;

drop policy if exists premium_bills_owner_delete on public.premium_bills;
create policy premium_bills_owner_delete
on public.premium_bills for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and processing_status = 'uploaded'
);

drop policy if exists premium_bills_staff_all on public.premium_bills;
create policy premium_bills_staff_all
on public.premium_bills for all to authenticated
using ((select public.premium_is_staff()))
with check ((select public.premium_is_staff()));

-- Analisi IA: mai visibile direttamente al cliente.

drop policy if exists premium_analysis_runs_staff_all on public.premium_analysis_runs;
create policy premium_analysis_runs_staff_all
on public.premium_analysis_runs for all to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])))
with check ((select public.premium_is_staff(array['reviewer', 'admin'])));

-- Controlli: il cliente legge l'esito; lo staff gestisce.

drop policy if exists premium_checks_owner_select on public.premium_checks;
create policy premium_checks_owner_select
on public.premium_checks for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_checks_staff_all on public.premium_checks;
create policy premium_checks_staff_all
on public.premium_checks for all to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])))
with check ((select public.premium_is_staff(array['reviewer', 'admin'])));

-- Note interne: esclusivamente reviewer/admin.

drop policy if exists premium_check_notes_staff_all on public.premium_check_notes;
create policy premium_check_notes_staff_all
on public.premium_check_notes for all to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])))
with check ((select public.premium_is_staff(array['reviewer', 'admin'])));

-- Anomalie

drop policy if exists premium_anomalies_owner_select on public.premium_anomalies;
create policy premium_anomalies_owner_select
on public.premium_anomalies for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_anomalies_staff_all on public.premium_anomalies;
create policy premium_anomalies_staff_all
on public.premium_anomalies for all to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])))
with check ((select public.premium_is_staff(array['reviewer', 'admin'])));

-- Comunicazioni

drop policy if exists premium_communications_owner_select on public.premium_communications;
create policy premium_communications_owner_select
on public.premium_communications for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_communications_owner_insert on public.premium_communications;
create policy premium_communications_owner_insert
on public.premium_communications for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and direction = 'user_to_staff'
  and created_by_user_id = (select auth.uid())
  and created_by_staff_id is null
);

drop policy if exists premium_communications_owner_update_read on public.premium_communications;
create policy premium_communications_owner_update_read
on public.premium_communications for update to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and direction in ('staff_to_user', 'system_to_user')
)
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
);

drop policy if exists premium_communications_staff_all on public.premium_communications;
create policy premium_communications_staff_all
on public.premium_communications for all to authenticated
using ((select public.premium_is_staff()))
with check ((select public.premium_is_staff()));

-- Consensi: il cliente legge e aggiunge eventi, ma non modifica lo storico.

drop policy if exists premium_consents_owner_select on public.premium_consents;
create policy premium_consents_owner_select
on public.premium_consents for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
);

drop policy if exists premium_consents_owner_insert on public.premium_consents;
create policy premium_consents_owner_insert
on public.premium_consents for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
);

drop policy if exists premium_consents_staff_select on public.premium_consents;
create policy premium_consents_staff_select
on public.premium_consents for select to authenticated
using ((select public.premium_is_staff(array['support', 'admin'])));

-- Costi: esclusivamente server/staff autorizzato.

drop policy if exists premium_cost_events_staff_all on public.premium_cost_events;
create policy premium_cost_events_staff_all
on public.premium_cost_events for all to authenticated
using ((select public.premium_is_staff(array['admin'])))
with check ((select public.premium_is_staff(array['admin'])));

-- -----------------------------------------------------------------------------
-- Storage Premium privato
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'premium-bills',
  'premium-bills',
  false,
  20000000,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Percorso obbligatorio: <auth.uid()>/<bill_id>/<nome-file.pdf>

drop policy if exists premium_bills_storage_owner_insert on storage.objects;
create policy premium_bills_storage_owner_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'premium-bills'
  and (select public.premium_has_service_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists premium_bills_storage_owner_select on storage.objects;
create policy premium_bills_storage_owner_select
on storage.objects for select to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_has_service_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists premium_bills_storage_owner_delete on storage.objects;
create policy premium_bills_storage_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_has_service_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Nessuna policy UPDATE: i PDF non vengono sovrascritti. Per sostituirli si elimina e ricarica.
-- La registrazione Premium dovra inviare options.data.offertalogica_product = 'premium'.
-- Tale metadata instrada la creazione del profilo, ma NON concede accesso al servizio:
-- l'accesso deriva esclusivamente da premium_subscriptions e dalle policy RLS.
-- Lo staff e le API IA accedono ai file tramite backend con chiave segreta e URL firmati.

commit;
