-- Verifica OffertaLogica Premium v0.34
select
  to_regprocedure('public.premium_staff_delete_records(text,uuid[])') is not null
    as deletion_rpc_present,

  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'premium_staff_delete_records'
      and p.prosecdef = true
  ) as deletion_rpc_security_definer,

  has_function_privilege('authenticated', 'public.premium_staff_delete_records(text,uuid[])', 'EXECUTE')
    as authenticated_can_execute_deletion_rpc,

  not has_function_privilege('anon', 'public.premium_staff_delete_records(text,uuid[])', 'EXECUTE')
    as anon_cannot_execute_deletion_rpc,

  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_admin_select'
  ) as admin_bill_metadata_policy_present,

  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_staff_select'
  ) as reviewer_bill_request_policy_present,

  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_utilities'
      and policyname = 'premium_utilities_staff_all'
      and cmd = 'SELECT'
  ) as utilities_staff_select_only,

  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_contracts'
      and policyname = 'premium_contracts_staff_all'
      and cmd = 'SELECT'
  ) as contracts_staff_select_only,

  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_analysis_runs'
      and policyname = 'premium_analysis_runs_staff_all'
      and cmd = 'SELECT'
  ) as analysis_runs_staff_select_only,

  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_checks'
      and policyname = 'premium_checks_staff_all'
      and cmd = 'SELECT'
  ) as checks_staff_select_only,

  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and policyname in (
        'premium_utilities_staff_all',
        'premium_contracts_staff_all',
        'premium_analysis_runs_staff_all',
        'premium_checks_staff_all'
      )
      and cmd <> 'SELECT'
  ) as staff_all_policies_are_select_only,

  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_staff_select'
  ) as storage_request_policy_still_present,

  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_admin_delete'
  ) as storage_admin_delete_policy_present;
