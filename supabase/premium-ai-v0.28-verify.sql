-- Verifica non distruttiva OFFERTALOGICA PREMIUM v0.28

select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_analysis_runs'
      and column_name = 'requested_by_staff_id'
      and data_type = 'uuid'
  ) as requested_by_staff_column_present,

  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_analysis_runs'
      and column_name = 'usage_details'
      and data_type = 'jsonb'
  ) as usage_details_column_present,

  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_analysis_runs'
      and column_name = 'response_ids'
      and data_type = 'jsonb'
  ) as response_ids_column_present,

  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'premium_analysis_runs'
      and indexname = 'premium_analysis_runs_one_active_per_bill'
      and indexdef ilike '%where%status%queued%running%'
  ) as one_active_analysis_per_bill,

  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'premium_analysis_runs'
      and indexname = 'premium_analysis_runs_staff_idx'
  ) as staff_analysis_index_present,

  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_analysis_runs'
      and policyname = 'premium_analysis_runs_staff_all'
      and 'authenticated' = any(roles)
      and coalesce(qual, '') ilike '%premium_is_staff%reviewer%admin%'
  ) as analysis_runs_are_staff_only,

  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_cost_events'
      and policyname = 'premium_cost_events_staff_all'
      and coalesce(qual, '') ilike '%premium_is_staff%admin%'
  ) as cost_events_are_admin_only,

  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('premium_analysis_runs', 'premium_cost_events')
      and grantee = 'anon'
  ) as anon_has_no_ai_table_grants,

  not exists (
    select 1
    from public.premium_analysis_runs
    where status in ('queued', 'running')
    group by bill_id
    having count(*) > 1
  ) as no_duplicate_active_runs;
