-- Verifica facoltativa OFFERTALOGICA PREMIUM v0.36.13
select case
  when exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_subscriptions'
      and column_name = 'complimentary_restore_trial'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_subscriptions'
      and column_name = 'complimentary_trial_period_start'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_subscriptions'
      and column_name = 'complimentary_trial_remaining_seconds'
  )
  and pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure)
    like '%complimentary_trial_remaining_seconds%'
  and pg_get_functiondef('public.premium_admin_revoke_complimentary(uuid,text)'::regprocedure)
    like '%restored_trial%'
  and pg_get_functiondef('public.premium_admin_revoke_complimentary(uuid,text)'::regprocedure)
    like '%included_bills_per_year = 4%'
  and pg_get_functiondef('public.premium_refresh_trial_lifecycle()'::regprocedure)
    like '%complimentary_restore_trial = true%'
  then 'premium_complimentary_trial_restore_v0.36.13_ok'
  else 'premium_complimentary_trial_restore_v0.36.13_error'
end as result;
