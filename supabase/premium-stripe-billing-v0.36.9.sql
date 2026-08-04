-- OffertaLogica Premium v0.36.9
-- Fondazione Stripe in modalità test: Checkout, rinnovo annuale, portale e webhook.

begin;

alter table public.premium_subscriptions
  add column if not exists first_paid_at timestamptz,
  add column if not exists intro_price_redeemed_at timestamptz,
  add column if not exists first_invoice_id text,
  add column if not exists first_payment_intent_id text,
  add column if not exists first_amount_paid_cents integer,
  add column if not exists latest_invoice_id text,
  add column if not exists latest_payment_intent_id text,
  add column if not exists latest_amount_paid_cents integer,
  add column if not exists latest_currency text,
  add column if not exists latest_payment_at timestamptz,
  add column if not exists billing_updated_at timestamptz;

comment on column public.premium_subscriptions.first_paid_at is
  'Data del primo pagamento Premium andato a buon fine. Base per il periodo commerciale e il futuro recesso.';
comment on column public.premium_subscriptions.intro_price_redeemed_at is
  'Data in cui e stato consumato il prezzo introduttivo del primo anno. Impedisce di riapplicarlo dopo una cancellazione.';
comment on column public.premium_subscriptions.first_invoice_id is
  'Identificativo della prima fattura del provider di pagamento.';
comment on column public.premium_subscriptions.first_payment_intent_id is
  'Identificativo del primo pagamento, necessario per il futuro rimborso entro 14 giorni.';
comment on column public.premium_subscriptions.billing_updated_at is
  'Ultimo allineamento dello stato di fatturazione tramite provider o webhook.';

create index if not exists premium_subscriptions_provider_customer_idx
  on public.premium_subscriptions (provider, provider_customer_id)
  where provider_customer_id is not null;

create table if not exists public.premium_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_session_id text not null,
  provider_customer_id text,
  status text not null default 'open' check (status in ('open', 'completed', 'expired', 'canceled')),
  checkout_url text not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_session_id)
);

create index if not exists premium_checkout_sessions_user_open_idx
  on public.premium_checkout_sessions (user_id, created_at desc)
  where status = 'open';

create table if not exists public.premium_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_event_id text not null,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed', 'ignored')),
  user_id uuid references auth.users(id) on delete set null,
  provider_customer_id text,
  provider_subscription_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text not null default '',
  payload_summary jsonb not null default '{}'::jsonb,
  unique (provider, provider_event_id)
);

create index if not exists premium_payment_events_status_idx
  on public.premium_payment_events (status, received_at desc);
create index if not exists premium_payment_events_subscription_idx
  on public.premium_payment_events (provider, provider_subscription_id, received_at desc)
  where provider_subscription_id is not null;

alter table public.premium_checkout_sessions enable row level security;
alter table public.premium_payment_events enable row level security;

revoke all on table public.premium_checkout_sessions from public, anon, authenticated;
revoke all on table public.premium_payment_events from public, anon, authenticated;
grant all on table public.premium_checkout_sessions to service_role;
grant all on table public.premium_payment_events to service_role;

-- L'utente può leggere soltanto i dati commerciali essenziali già presenti
-- in premium_subscriptions; sessioni Checkout e payload webhook restano server-only.

commit;
