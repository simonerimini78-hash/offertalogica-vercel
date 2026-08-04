select case
  when exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_subscriptions'
      and column_name = 'archive_access_until'
      and data_type = 'timestamp with time zone'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_subscriptions'
      and column_name = 'data_purged_at'
      and data_type = 'timestamp with time zone'
  )
  and to_regprocedure('public.premium_refresh_trial_lifecycle()') is not null
  and pg_get_functiondef('public.premium_refresh_trial_lifecycle()'::regprocedure) like '%status = ''expired''%'
  and pg_get_functiondef('public.premium_refresh_trial_lifecycle()'::regprocedure) like '%interval ''90 days''%'
  and to_regprocedure('public.premium_has_archive_access()') is not null
  and pg_get_functiondef('public.premium_has_archive_access()'::regprocedure) like '%archive_access_until%'
  and to_regprocedure('public.premium_trial_cleanup_candidates(integer)') is not null
  and to_regprocedure('public.premium_finalize_trial_data_purge(uuid)') is not null
  and pg_get_functiondef('public.premium_finalize_trial_data_purge(uuid)'::regprocedure) like '%premium_cleanup_storage_not_empty%'
  and pg_get_functiondef('public.premium_finalize_trial_data_purge(uuid)'::regprocedure) not like '%delete from storage.objects%'
  and not has_function_privilege('anon', 'public.premium_finalize_trial_data_purge(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.premium_finalize_trial_data_purge(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.premium_finalize_trial_data_purge(uuid)', 'EXECUTE')
  and pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure) like '%premium-terms-v0.36.6-2026-08-04%'
  and pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure) like '%premium-privacy-v0.36.6-2026-08-04%'
  and pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure) like '%premium-cloud-ai-v0.36.6-2026-08-04%'
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_owner_select'
      and qual ilike '%premium_has_archive_access%'
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_owner_select'
      and qual ilike '%premium_has_archive_access%'
  )
  and not exists (
    select 1
    from public.premium_subscriptions subscription
    where subscription.plan_code = 'premium-beta'
      and subscription.provider = 'offertalogica-beta'
      and subscription.current_period_end is not null
      and subscription.archive_access_until is distinct from subscription.current_period_end + interval '90 days'
  )
  then 'premium_trial_retention_v0.36.6_ok'
  else 'premium_trial_retention_v0.36.6_error'
end as result;
