select case
  when to_regprocedure('public.premium_has_current_acceptances()') is not null
   and pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure) like '%premium-terms-v0.36.7-2026-08-04%'
   and pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure) like '%premium-privacy-v0.36.6-2026-08-04%'
   and pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure) like '%premium-cloud-ai-v0.36.6-2026-08-04%'
   and to_regprocedure('public.premium_accept_current_terms(jsonb)') is not null
   and pg_get_functiondef('public.premium_accept_current_terms(jsonb)'::regprocedure) like '%premium-terms-v0.36.7-2026-08-04%'
   and to_regprocedure('public.premium_handle_new_user()') is not null
   and pg_get_functiondef('public.premium_handle_new_user()'::regprocedure) like '%premium-terms-v0.36.7-2026-08-04%'
   and has_function_privilege('authenticated', 'public.premium_has_current_acceptances()', 'EXECUTE')
   and has_function_privilege('authenticated', 'public.premium_accept_current_terms(jsonb)', 'EXECUTE')
   and not has_function_privilege('anon', 'public.premium_has_current_acceptances()', 'EXECUTE')
   and not has_function_privilege('anon', 'public.premium_accept_current_terms(jsonb)', 'EXECUTE')
  then 'premium_commercial_terms_v0.36.7_ok'
  else 'premium_commercial_terms_v0.36.7_error'
end as result;
