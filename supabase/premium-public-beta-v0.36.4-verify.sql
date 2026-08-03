-- OFFERTALOGICA PREMIUM v0.36.4 — verifica migrazione beta pubblica

select case
  when to_regprocedure('public.premium_activate_beta_trial()') is not null
   and has_function_privilege('authenticated', 'public.premium_activate_beta_trial()', 'EXECUTE')
   and pg_get_functiondef('public.premium_activate_beta_trial()'::regprocedure) like '%premium-beta%'
   and pg_get_functiondef('public.premium_activate_beta_trial()'::regprocedure) like '%included_utilities%2%'
   and pg_get_functiondef('public.premium_activate_beta_trial()'::regprocedure) like '%included_bills_per_year%30%'
   and pg_get_functiondef('public.premium_activate_beta_trial()'::regprocedure) like '%90 days%'
  then 'premium_public_beta_v0.36.4_ok'
  else 'premium_public_beta_v0.36.4_error'
end as verification;
