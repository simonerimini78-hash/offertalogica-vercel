select case
  when to_regclass('public.premium_trial_cleanup_runs') is not null
   and exists (
     select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'premium_trial_cleanup_runs'
       and indexname = 'premium_trial_cleanup_single_running_idx'
   )
   and to_regprocedure('public.premium_begin_trial_cleanup_run(text,boolean,integer)') is not null
   and to_regprocedure('public.premium_finish_trial_cleanup_run(uuid,text,integer,integer,integer,jsonb,text)') is not null
   and pg_get_functiondef('public.premium_begin_trial_cleanup_run(text,boolean,integer)'::regprocedure)
     like '%premium_cleanup_already_running%'
   and pg_get_functiondef('public.premium_finish_trial_cleanup_run(uuid,text,integer,integer,integer,jsonb,text)'::regprocedure)
     like '%premium_cleanup_run_not_running%'
   and not has_function_privilege('anon', 'public.premium_begin_trial_cleanup_run(text,boolean,integer)', 'EXECUTE')
   and not has_function_privilege('authenticated', 'public.premium_begin_trial_cleanup_run(text,boolean,integer)', 'EXECUTE')
   and has_function_privilege('service_role', 'public.premium_begin_trial_cleanup_run(text,boolean,integer)', 'EXECUTE')
   and not has_function_privilege('anon', 'public.premium_finish_trial_cleanup_run(uuid,text,integer,integer,integer,jsonb,text)', 'EXECUTE')
   and not has_function_privilege('authenticated', 'public.premium_finish_trial_cleanup_run(uuid,text,integer,integer,integer,jsonb,text)', 'EXECUTE')
   and has_function_privilege('service_role', 'public.premium_finish_trial_cleanup_run(uuid,text,integer,integer,integer,jsonb,text)', 'EXECUTE')
   and not has_table_privilege('anon', 'public.premium_trial_cleanup_runs', 'SELECT')
   and not has_table_privilege('authenticated', 'public.premium_trial_cleanup_runs', 'SELECT')
  then 'premium_trial_cleanup_v0.36.8_ok'
  else 'premium_trial_cleanup_v0.36.8_error'
end as result;
