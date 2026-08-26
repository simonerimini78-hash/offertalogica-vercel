-- OffertaLogica Staff v0.36.67
-- Fondazioni del gestionale mensile: punto zero condiviso, dimensioni prodotto/segmento
-- e snapshot delle dimensioni Premium al momento della bolletta.
-- Nessun dato storico viene cancellato o riscritto per finalità di reportistica.

begin;

do $$
begin
  if to_regclass('public.premium_staff_members') is null then
    raise exception 'premium_staff_members_missing';
  end if;
  if to_regclass('public.premium_subscriptions') is null then
    raise exception 'premium_subscriptions_missing';
  end if;
  if to_regclass('public.premium_bills') is null then
    raise exception 'premium_bills_missing';
  end if;
  if to_regprocedure('public.premium_economic_owner_allowed()') is null then
    raise exception 'premium_economic_owner_allowed_missing';
  end if;
end;
$$;

-- La tabella nata come baseline economica diventa il riferimento del punto zero gestionale.
-- Manteniamo nome e dati per compatibilità con il Cruscotto economico già in produzione.
create table if not exists public.premium_economic_baselines (
  id uuid primary key default gen_random_uuid(),
  baseline_at timestamptz not null default now(),
  created_by_staff_id uuid references public.premium_staff_members(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists premium_economic_baselines_at_idx
  on public.premium_economic_baselines (baseline_at desc);

alter table public.premium_economic_baselines enable row level security;
revoke all on table public.premium_economic_baselines from public, anon, authenticated;

comment on table public.premium_economic_baselines is
  'Storico dei punti zero gestionali OffertaLogica. I dati precedenti restano archiviati; la baseline limita soltanto i conteggi ufficiali.';

create or replace function public.staff_owner_set_management_baseline()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_baseline_at timestamptz := clock_timestamp();
  v_actor uuid := auth.uid();
begin
  if not public.premium_economic_owner_allowed() then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;

  insert into public.premium_economic_baselines (baseline_at, created_by_staff_id)
  values (v_baseline_at, v_actor);

  return jsonb_build_object(
    'ok', true,
    'baseline_at', v_baseline_at,
    'history_deleted', false,
    'scope', 'management'
  );
end;
$$;

revoke all on function public.staff_owner_set_management_baseline() from public, anon;
grant execute on function public.staff_owner_set_management_baseline() to authenticated, service_role;

comment on function public.staff_owner_set_management_baseline() is
  'Owner-only: imposta un nuovo punto zero gestionale senza cancellare dati storici. La stessa baseline è letta dal Cruscotto economico esistente.';

-- Catalogo stabile delle dimensioni che il gestionale userà anche quando nascerà Premium Business.
create table if not exists public.staff_management_products (
  product_code text primary key,
  label text not null,
  channel text not null check (channel in ('site','premium')),
  customer_segment text not null check (customer_segment in ('consumer','business')),
  product_family text not null check (product_family in ('site_free','premium')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_management_products enable row level security;
revoke all on table public.staff_management_products from public, anon, authenticated;

insert into public.staff_management_products
  (product_code, label, channel, customer_segment, product_family, enabled)
values
  ('site_free_consumer', 'Sito gratuito · Privati', 'site', 'consumer', 'site_free', true),
  ('site_free_business', 'Sito gratuito · Business', 'site', 'business', 'site_free', true),
  ('premium_casa', 'Premium Casa', 'premium', 'consumer', 'premium', true),
  ('premium_business', 'Premium Business', 'premium', 'business', 'premium', false)
on conflict (product_code) do update set
  label = excluded.label,
  channel = excluded.channel,
  customer_segment = excluded.customer_segment,
  product_family = excluded.product_family;

-- Le sottoscrizioni attuali sono tutte Casa: l'estensione è additiva e non cambia il flusso esistente.
alter table public.premium_subscriptions
  add column if not exists customer_segment text;
alter table public.premium_subscriptions
  add column if not exists product_code text;

update public.premium_subscriptions
set customer_segment = 'consumer'
where customer_segment is null or btrim(customer_segment) = '';

update public.premium_subscriptions
set product_code = 'premium_casa'
where product_code is null or btrim(product_code) = '';

alter table public.premium_subscriptions
  alter column customer_segment set default 'consumer',
  alter column customer_segment set not null,
  alter column product_code set default 'premium_casa',
  alter column product_code set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'premium_subscriptions_customer_segment_check') then
    alter table public.premium_subscriptions
      add constraint premium_subscriptions_customer_segment_check
      check (customer_segment in ('consumer','business'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'premium_subscriptions_product_code_fk') then
    alter table public.premium_subscriptions
      add constraint premium_subscriptions_product_code_fk
      foreign key (product_code) references public.staff_management_products(product_code);
  end if;
end;
$$;

create index if not exists premium_subscriptions_management_idx
  on public.premium_subscriptions (customer_segment, product_code, created_at desc);

-- Ogni bolletta conserva il segmento/prodotto/piano validi quando viene registrata.
-- Questo evita che un futuro cambio piano modifichi retroattivamente i report mensili.
alter table public.premium_bills
  add column if not exists customer_segment text;
alter table public.premium_bills
  add column if not exists product_code text;
alter table public.premium_bills
  add column if not exists plan_code_snapshot text;

update public.premium_bills
set customer_segment = 'consumer'
where customer_segment is null or btrim(customer_segment) = '';

update public.premium_bills
set product_code = 'premium_casa'
where product_code is null or btrim(product_code) = '';

update public.premium_bills bill
set plan_code_snapshot = coalesce((
  select subscription.plan_code
  from public.premium_subscriptions subscription
  where subscription.user_id = bill.user_id
    and subscription.created_at <= bill.created_at
  order by subscription.created_at desc, subscription.id desc
  limit 1
), '')
where bill.plan_code_snapshot is null or btrim(bill.plan_code_snapshot) = '';

alter table public.premium_bills
  alter column customer_segment set default 'consumer',
  alter column customer_segment set not null,
  alter column product_code set default 'premium_casa',
  alter column product_code set not null,
  alter column plan_code_snapshot set default '',
  alter column plan_code_snapshot set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'premium_bills_customer_segment_check') then
    alter table public.premium_bills
      add constraint premium_bills_customer_segment_check
      check (customer_segment in ('consumer','business'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'premium_bills_product_code_fk') then
    alter table public.premium_bills
      add constraint premium_bills_product_code_fk
      foreign key (product_code) references public.staff_management_products(product_code);
  end if;
end;
$$;

create index if not exists premium_bills_management_idx
  on public.premium_bills (customer_segment, product_code, created_at desc);

create or replace function public.premium_bill_snapshot_management_dimensions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment text;
  v_product text;
  v_plan text;
begin
  select subscription.customer_segment, subscription.product_code, subscription.plan_code
    into v_segment, v_product, v_plan
  from public.premium_subscriptions subscription
  where subscription.user_id = new.user_id
    and subscription.created_at <= coalesce(new.created_at, now())
  order by
    case when subscription.status in ('trialing','active') then 0 else 1 end,
    subscription.created_at desc,
    subscription.id desc
  limit 1;

  new.customer_segment := coalesce(nullif(v_segment,''), nullif(new.customer_segment,''), 'consumer');
  new.product_code := coalesce(nullif(v_product,''), nullif(new.product_code,''), 'premium_casa');
  new.plan_code_snapshot := coalesce(nullif(v_plan,''), nullif(new.plan_code_snapshot,''), '');
  return new;
end;
$$;

revoke all on function public.premium_bill_snapshot_management_dimensions() from public, anon, authenticated;

drop trigger if exists premium_bills_management_dimensions_before_insert on public.premium_bills;
create trigger premium_bills_management_dimensions_before_insert
  before insert on public.premium_bills
  for each row execute procedure public.premium_bill_snapshot_management_dimensions();

-- Contesto unico letto dal gestionale. Il calendario dei report usa il fuso italiano.
create or replace function public.staff_owner_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_baseline_at timestamptz;
  v_products jsonb;
begin
  if not public.premium_economic_owner_allowed() then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;

  select max(baseline.baseline_at)
    into v_baseline_at
  from public.premium_economic_baselines baseline;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_code', product.product_code,
    'label', product.label,
    'channel', product.channel,
    'customer_segment', product.customer_segment,
    'product_family', product.product_family,
    'enabled', product.enabled
  ) order by product.product_code), '[]'::jsonb)
    into v_products
  from public.staff_management_products product;

  return jsonb_build_object(
    'ok', true,
    'release', '0.36.67',
    'time_zone', 'Europe/Rome',
    'baseline_at', v_baseline_at,
    'products', v_products,
    'premium_business_ready', true,
    'premium_business_enabled', false
  );
end;
$$;

revoke all on function public.staff_owner_management_context() from public, anon;
grant execute on function public.staff_owner_management_context() to authenticated, service_role;

comment on function public.staff_owner_management_context() is
  'Contesto Owner-only del gestionale mensile: punto zero e catalogo segmenti/prodotti, incluso lo slot Premium Business non ancora attivo.';

commit;
