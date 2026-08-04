-- OFFERTALOGICA PREMIUM v0.36.5 — verifica limiti prova gratuita

select case
  when to_regprocedure('public.premium_activate_beta_trial()') is not null
   and pg_get_functiondef('public.premium_activate_beta_trial()'::regprocedure) like '%interval ''30 days''%'
   and pg_get_functiondef('public.premium_activate_beta_trial()'::regprocedure) like '%included_bills_per_year%4%'
   and to_regprocedure('public.premium_can_add_bill(uuid)') is not null
   and pg_get_functiondef('public.premium_can_add_bill(uuid)'::regprocedure) like '%current_period_start%'
   and to_regprocedure('public.premium_utility_allowed_for_plan(uuid,jsonb)') is not null
   and pg_get_functiondef('public.premium_utility_allowed_for_plan(uuid,jsonb)'::regprocedure) like '%premium-beta%'
   and to_regprocedure('public.premium_request_check(uuid)') is not null
   and pg_get_functiondef('public.premium_request_check(uuid)'::regprocedure) like '%premium_trial_staff_limit_reached%'
   and pg_get_functiondef('public.premium_request_check(uuid)'::regprocedure) like '%v_trial_check_count >= 1%'
  then 'premium_trial_limits_v0.36.5_ok'
  else 'premium_trial_limits_v0.36.5_error'
end as result;

select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'premium_utilities'
  and policyname in ('premium_utilities_owner_insert', 'premium_utilities_owner_update')
order by policyname;
