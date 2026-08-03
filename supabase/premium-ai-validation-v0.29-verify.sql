-- Verifica non distruttiva OFFERTALOGICA PREMIUM v0.29

select
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'premium_analysis_field_reviews'
  ) as field_reviews_table_present,

  (
    select count(*) = 7
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_analysis_runs'
      and column_name in (
        'review_status',
        'validated_by_staff_id',
        'validated_at',
        'validation_seconds',
        'validation_note',
        'validation_metrics',
        'validated_data'
      )
  ) as analysis_validation_columns_present,

  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'premium_analysis_field_reviews'
      and indexname = 'premium_analysis_field_reviews_run_idx'
  ) as field_reviews_index_present,

  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_analysis_field_reviews'
      and policyname = 'premium_analysis_field_reviews_staff_all'
      and 'authenticated' = any(roles)
      and coalesce(qual, '') ilike '%premium_is_staff%reviewer%admin%'
  ) as field_reviews_are_staff_only,

  exists (
    select 1 from information_schema.routines
    where routine_schema = 'public'
      and routine_name = 'premium_staff_validate_analysis'
  ) as validation_function_present,

  has_function_privilege(
    'authenticated',
    'public.premium_staff_validate_analysis(uuid,jsonb,integer,text)',
    'EXECUTE'
  ) as authenticated_staff_can_execute,

  not has_function_privilege(
    'anon',
    'public.premium_staff_validate_analysis(uuid,jsonb,integer,text)',
    'EXECUTE'
  ) as anon_cannot_execute,

  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'premium_analysis_field_reviews'
      and grantee = 'anon'
  ) as anon_has_no_field_review_grants,

  not exists (
    select 1
    from public.premium_analysis_runs run
    where run.review_status = 'validated'
      and (
        run.validated_by_staff_id is null
        or run.validated_at is null
        or jsonb_typeof(run.validation_metrics) <> 'object'
        or jsonb_typeof(run.validated_data) <> 'object'
      )
  ) as validated_runs_have_complete_audit,

  not exists (
    select 1
    from public.premium_analysis_field_reviews review
    left join public.premium_analysis_runs run on run.id = review.analysis_run_id
    where run.id is null
  ) as no_orphan_field_reviews;
