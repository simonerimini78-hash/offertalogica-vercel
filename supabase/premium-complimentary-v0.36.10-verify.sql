select case
  when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'premium_subscriptions'
      and column_name = 'complimentary_granted_at'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'premium_subscriptions'
      and column_name = 'complimentary_granted_by'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'premium_subscriptions'
      and column_name = 'complimentary_reason'
  )
  and to_regclass('public.premium_complimentary_events') is not null
  and to_regprocedure('public.premium_admin_set_complimentary(uuid,text,text)') is not null
  and to_regprocedure('public.premium_admin_revoke_complimentary(uuid,text)') is not null
  and pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure) like '%premium-complimentary%'
  and pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure) like '%offertalogica-complimentary%'
  and pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure) like '%included_bills_per_year = 1200%'
  and pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure) like '%premium_complimentary_paid_subscription_conflict%'
  and pg_get_functiondef('public.premium_admin_revoke_complimentary(uuid,text)'::regprocedure) like '%interval ''90 days''%'
  and pg_get_functiondef('public.premium_refresh_trial_lifecycle()'::regprocedure) like '%premium-complimentary%'
  and pg_get_functiondef('public.premium_trial_cleanup_candidates(integer)'::regprocedure) like '%offertalogica-complimentary%'
  and pg_get_functiondef('public.premium_finalize_trial_data_purge(uuid)'::regprocedure) like '%premium-complimentary%'
  and has_function_privilege('authenticated', 'public.premium_admin_set_complimentary(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.premium_admin_revoke_complimentary(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.premium_admin_set_complimentary(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.premium_admin_revoke_complimentary(uuid,text)', 'EXECUTE')
  then 'premium_complimentary_v0.36.10_ok'
  else 'premium_complimentary_v0.36.10_error'
end as result;
