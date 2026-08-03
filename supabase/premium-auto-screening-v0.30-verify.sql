select
  (
    select count(*) = 6
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_bills'
      and column_name in (
        'automatic_screening_status',
        'automatic_screening_summary',
        'automatic_screening_reasons',
        'automatic_screened_at',
        'automatic_analysis_run_id',
        'total_amount_eur'
      )
  ) as bill_screening_columns_present,
  (
    select count(*) = 5
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_analysis_runs'
      and column_name in (
        'origin',
        'requested_by_user_id',
        'automatic_classification',
        'automatic_summary',
        'automatic_reasons'
      )
  ) as analysis_origin_columns_present,
  exists (
    select 1 from pg_constraint
    where conname = 'premium_bills_automatic_screening_status_check'
      and conrelid = 'public.premium_bills'::regclass
  ) as bill_status_constraint_present,
  exists (
    select 1 from pg_constraint
    where conname = 'premium_analysis_runs_origin_check'
      and conrelid = 'public.premium_analysis_runs'::regclass
  ) as analysis_origin_constraint_present,
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'premium_bills_automatic_screening_idx'
  ) as screening_index_present,
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_owner_insert'
      and with_check ilike '%automatic_screening_status%pending%'
      and with_check ilike '%premium_can_add_bill%'
  ) as bill_insert_requires_pending_screening,
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_owner_insert'
      and with_check ilike '%automatic_screening_status%pending%'
  ) as storage_insert_requires_pending_screening,
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_owner_delete'
      and qual ilike '%completed%'
      and qual ilike '%premium_checks%'
  ) as analyzed_bill_delete_is_protected,
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_owner_delete'
      and qual ilike '%completed%'
      and qual ilike '%premium_checks%'
  ) as analyzed_storage_delete_is_protected,
  position(
    'review_recommended' in
    pg_get_functiondef('public.premium_request_check(uuid)'::regprocedure)
  ) > 0 as request_requires_exception,
  position(
    'premium-auto-screening-v0.30' in
    pg_get_functiondef('public.premium_request_check(uuid)'::regprocedure)
  ) > 0 as consent_version_updated,
  (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('premium_bills', 'premium_analysis_runs')
      and grantee = 'anon'
  ) = 0 as anon_grants_absent;
