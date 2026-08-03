-- OFFERTALOGICA PREMIUM v0.36.4
-- Accesso automatico alla beta riservata per account Premium senza sottoscrizione.
-- La funzione è idempotente e non riattiva account che hanno già avuto un piano.

begin;

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
  v_period_end timestamptz := now() + interval '90 days';
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
      'plan_code', v_subscription.plan_code,
      'current_period_end', v_subscription.current_period_end
    );
  end if;

  insert into public.premium_subscriptions (
    user_id,
    status,
    plan_code,
    included_utilities,
    included_bills_per_year,
    provider,
    current_period_start,
    current_period_end,
    cancel_at_period_end
  )
  values (
    v_user_id,
    'trialing',
    'premium-beta',
    2,
    30,
    'offertalogica-beta',
    v_period_start,
    v_period_end,
    true
  )
  returning * into v_subscription;

  return jsonb_build_object(
    'ok', true,
    'activated', true,
    'subscription_id', v_subscription.id,
    'status', v_subscription.status,
    'plan_code', v_subscription.plan_code,
    'included_utilities', v_subscription.included_utilities,
    'included_bills_per_year', v_subscription.included_bills_per_year,
    'current_period_start', v_subscription.current_period_start,
    'current_period_end', v_subscription.current_period_end
  );
end;
$$;

revoke all on function public.premium_activate_beta_trial() from public, anon;
grant execute on function public.premium_activate_beta_trial() to authenticated, service_role;

commit;
