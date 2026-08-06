-- OFFERTALOGICA PREMIUM v0.36.22 — verifica limiti e Termini
select to_regprocedure('public.premium_has_current_acceptances()') is not null as current_acceptance_function_present;

do $$
begin
  if pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure)
     not like '%premium-terms-v0.36.22-2026-08-06%' then
    raise exception 'premium_terms_v0.36.22_missing';
  end if;
  if pg_get_functiondef('public.premium_can_add_bill(uuid)'::regprocedure)
     not like '%home_bill_count%< 30%' then
    raise exception 'premium_home_bill_limit_30_missing';
  end if;
  if pg_get_functiondef('public.premium_can_add_bill(uuid)'::regprocedure)
     not like '%included_bills_per_year%' then
    raise exception 'premium_annual_bill_limit_missing';
  end if;
  if pg_get_functiondef('public.premium_utility_allowed_for_plan(uuid,jsonb)'::regprocedure)
     not like '%count(*) from home_keys%<= 2%' then
    raise exception 'premium_two_home_limit_missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'premium_apply_plan_limits_before_write'
      and not tgisinternal
  ) then
    raise exception 'premium_plan_limit_trigger_missing';
  end if;
end $$;

select
  count(*) filter (where status='trialing' and plan_code='premium-beta' and included_utilities=2 and included_bills_per_year=4) as trial_rows_ok,
  count(*) filter (where status='active' and included_utilities=4 and included_bills_per_year=60) as premium_rows_ok,
  count(*) filter (where status='trialing' and plan_code='premium-beta' and (included_utilities<>2 or included_bills_per_year<>4)) as trial_rows_wrong,
  count(*) filter (where status='active' and (included_utilities<>4 or included_bills_per_year<>60)) as premium_rows_wrong
from public.premium_subscriptions;

select 'premium_home_bill_limits_terms_v0.36.22_ok' as result;
