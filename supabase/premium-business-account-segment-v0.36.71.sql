-- OFFERTALOGICA PREMIUM BUSINESS v0.36.71
-- Segmentazione account alla registrazione, prova Business e limite 2 utenze Business.

begin;

do $$
begin
  if to_regclass('public.premium_subscriptions') is null then
    raise exception 'premium_subscriptions_missing';
  end if;
  if to_regclass('public.staff_management_products') is null then
    raise exception 'staff_management_products_missing';
  end if;
  if to_regprocedure('public.premium_has_current_acceptances()') is null then
    raise exception 'premium_has_current_acceptances_missing';
  end if;
end;
$$;

-- Premium Business diventa un prodotto selezionabile dall'app.
update public.staff_management_products
set enabled = true,
    updated_at = now()
where product_code = 'premium_business';

-- Se un account Business fosse stato creato tra il deploy frontend e questa migrazione,
-- riallinea soltanto la prova beta ancora classificata con i default Casa.
update public.premium_subscriptions subscription
set customer_segment = 'business',
    product_code = 'premium_business',
    included_utilities = 2,
    updated_at = now()
where subscription.status = 'trialing'
  and subscription.plan_code = 'premium-beta'
  and subscription.provider = 'offertalogica-beta'
  and exists (
    select 1
    from auth.users users
    where users.id = subscription.user_id
      and lower(coalesce(users.raw_user_meta_data ->> 'premium_customer_segment', 'consumer')) = 'business'
  );

create or replace function public.premium_activate_beta_trial()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_subscription public.premium_subscriptions%rowtype;
  v_period_start timestamptz := now();
  v_period_end timestamptz := now() + interval '30 days';
  v_archive_end timestamptz := now() + interval '120 days';
  v_segment text := 'consumer';
  v_product text := 'premium_casa';
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if not exists (
    select 1
    from public.premium_profiles profile
    where profile.id = v_user_id
      and profile.account_status = 'active'
  ) then
    raise exception 'premium_active_profile_required' using errcode = '42501';
  end if;

  if not public.premium_has_current_acceptances() then
    raise exception 'premium_legal_acceptance_required' using errcode = '42501';
  end if;

  select
    case
      when lower(coalesce(users.raw_user_meta_data ->> 'premium_customer_segment', 'consumer')) = 'business'
        then 'business'
      else 'consumer'
    end
  into v_segment
  from auth.users users
  where users.id = v_user_id;

  v_segment := coalesce(v_segment, 'consumer');
  v_product := case when v_segment = 'business' then 'premium_business' else 'premium_casa' end;

  select subscription.*
  into v_subscription
  from public.premium_subscriptions subscription
  where subscription.user_id = v_user_id
  order by subscription.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'activated', false,
      'reason', 'subscription_exists',
      'subscription_id', v_subscription.id,
      'status', v_subscription.status,
      'customer_segment', v_subscription.customer_segment,
      'product_code', v_subscription.product_code,
      'plan_code', v_subscription.plan_code,
      'current_period_end', v_subscription.current_period_end,
      'archive_access_until', v_subscription.archive_access_until,
      'data_purged_at', v_subscription.data_purged_at
    );
  end if;

  insert into public.premium_subscriptions (
    user_id,
    status,
    customer_segment,
    product_code,
    plan_code,
    included_utilities,
    included_bills_per_year,
    provider,
    current_period_start,
    current_period_end,
    archive_access_until,
    cancel_at_period_end
  )
  values (
    v_user_id,
    'trialing',
    v_segment,
    v_product,
    'premium-beta',
    2,
    4,
    'offertalogica-beta',
    v_period_start,
    v_period_end,
    v_archive_end,
    true
  )
  returning * into v_subscription;

  return jsonb_build_object(
    'ok', true,
    'activated', true,
    'subscription_id', v_subscription.id,
    'status', v_subscription.status,
    'customer_segment', v_subscription.customer_segment,
    'product_code', v_subscription.product_code,
    'plan_code', v_subscription.plan_code,
    'included_utilities', v_subscription.included_utilities,
    'included_bills_per_year', v_subscription.included_bills_per_year,
    'current_period_start', v_subscription.current_period_start,
    'current_period_end', v_subscription.current_period_end,
    'archive_access_until', v_subscription.archive_access_until
  );
end;
$$;

revoke all on function public.premium_activate_beta_trial() from public, anon;
grant execute on function public.premium_activate_beta_trial() to authenticated, service_role;

-- Casa mantiene i limiti esistenti. Business resta volutamente a 2 utenze.
create or replace function public.premium_apply_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'trialing' and new.plan_code = 'premium-beta' then
    new.included_utilities := 2;
    new.included_bills_per_year := 4;
  elsif new.status = 'active' and coalesce(new.customer_segment, 'consumer') = 'business' then
    new.included_utilities := 2;
    new.included_bills_per_year := 60;
  elsif new.status = 'active' then
    new.included_utilities := 4;
    new.included_bills_per_year := 60;
  end if;
  return new;
end;
$$;

revoke all on function public.premium_apply_plan_limits() from public, anon, authenticated;

drop trigger if exists premium_apply_plan_limits_before_write on public.premium_subscriptions;
create trigger premium_apply_plan_limits_before_write
before insert or update of status, plan_code, customer_segment, product_code, included_utilities, included_bills_per_year
on public.premium_subscriptions
for each row execute function public.premium_apply_plan_limits();

update public.premium_subscriptions
set included_utilities = 2,
    included_bills_per_year = 60,
    updated_at = now()
where status = 'active'
  and customer_segment = 'business';

-- Privato trial: due forniture della stessa abitazione.
-- Business trial: due utenze, anche su due indirizzi/sedi differenti.
-- Piani attivi: massimo due indirizzi; il numero totale resta governato da included_utilities.
create or replace function public.premium_utility_allowed_for_plan(
  p_utility_id uuid,
  p_address jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_subscription as (
    select
      subscription.status,
      subscription.plan_code,
      subscription.customer_segment,
      subscription.included_utilities
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
      and subscription.status in ('trialing', 'active')
      and (subscription.current_period_end is null or subscription.current_period_end > now())
    order by subscription.created_at desc
    limit 1
  ),
  other_utilities as (
    select
      utility.id,
      case
        when public.premium_normalize_supply_address(utility.address) <> ''
          then public.premium_normalize_supply_address(utility.address)
        else 'utility:' || utility.id::text
      end as home_key
    from public.premium_utilities utility
    where utility.user_id = (select auth.uid())
      and utility.status <> 'archived'
      and utility.id <> p_utility_id
  ),
  proposed as (
    select public.premium_normalize_supply_address(p_address) as home_key
  ),
  home_keys as (
    select home_key from other_utilities
    union
    select home_key from proposed where home_key <> ''
  )
  select
    (select public.premium_has_service_access())
    and exists (select 1 from active_subscription)
    and (select count(*) from other_utilities)
      < coalesce((select included_utilities from active_subscription), 0)
    and (select home_key from proposed) <> ''
    and (
      (
        exists (
          select 1 from active_subscription
          where status = 'trialing'
            and plan_code = 'premium-beta'
            and customer_segment = 'consumer'
        )
        and (select count(*) from home_keys) <= 1
      )
      or
      (
        exists (
          select 1 from active_subscription
          where status = 'trialing'
            and plan_code = 'premium-beta'
            and customer_segment = 'business'
        )
        and (select count(*) from home_keys) <= 2
      )
      or
      (
        not exists (
          select 1 from active_subscription
          where status = 'trialing' and plan_code = 'premium-beta'
        )
        and (select count(*) from home_keys) <= 2
      )
    );
$$;

revoke all on function public.premium_utility_allowed_for_plan(uuid, jsonb) from public, anon;
grant execute on function public.premium_utility_allowed_for_plan(uuid, jsonb) to authenticated, service_role;

comment on function public.premium_activate_beta_trial() is
  'Attiva la prova Premium fissando consumer/premium_casa oppure business/premium_business dal tipo account scelto alla registrazione.';
comment on function public.premium_utility_allowed_for_plan(uuid, jsonb) is
  'Privato trial: 2 forniture stessa abitazione. Business: massimo 2 utenze e fino a 2 sedi/indirizzi.';

commit;
