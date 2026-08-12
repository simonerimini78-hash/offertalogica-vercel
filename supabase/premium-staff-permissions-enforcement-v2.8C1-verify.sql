-- OffertaLogica Staff v2.8C1 - verifier
-- Eseguire DOPO premium-staff-permissions-enforcement-v2.8C1.sql.
-- Deve restituire solo true.

with expected_functions(signature, permission_key) as (
  values
    ('public.premium_staff_claim_check(uuid)', 'manage_checks'),
    ('public.premium_staff_set_check_status(uuid,text,text)', 'manage_checks'),
    ('public.premium_staff_add_check_note(uuid,text)', 'manage_checks'),
    ('public.premium_staff_add_anomaly(uuid,text,text,text,text,numeric)', 'manage_checks'),
    ('public.premium_staff_delete_anomaly(uuid)', 'manage_checks'),
    ('public.premium_staff_complete_check(uuid,text,text,text,integer)', 'manage_checks'),
    ('public.premium_staff_validate_analysis(uuid,jsonb,integer,text)', 'manage_checks'),
    ('public.premium_staff_delete_records(text,uuid[])', 'delete_records'),
    ('public.premium_staff_complete_account_deletion(uuid,text)', 'delete_records')
),
expected_legacy(signature) as (
  values
    ('public.premium_staff_claim_check_v28c1_legacy(uuid)'),
    ('public.premium_staff_set_check_status_v28c1_legacy(uuid,text,text)'),
    ('public.premium_staff_add_check_note_v28c1_legacy(uuid,text)'),
    ('public.premium_staff_add_anomaly_v28c1_legacy(uuid,text,text,text,text,numeric)'),
    ('public.premium_staff_delete_anomaly_v28c1_legacy(uuid)'),
    ('public.premium_staff_complete_check_v28c1_legacy(uuid,text,text,text,integer)'),
    ('public.premium_staff_validate_analysis_v28c1_legacy(uuid,jsonb,integer,text)'),
    ('public.premium_staff_delete_records_v28c1_legacy(text,uuid[])'),
    ('public.premium_staff_complete_account_deletion_v28c1_legacy(uuid,text)')
)
select
  to_regprocedure('public.premium_staff_permission_allowed(text)') is not null
    as permission_engine_present,
  (select bool_and(to_regprocedure(signature) is not null) from expected_functions)
    as protected_rpc_present,
  (select bool_and(to_regprocedure(signature) is not null) from expected_legacy)
    as preserved_legacy_present,
  (
    select bool_and(
      position('premium_staff_permission_allowed' in pg_get_functiondef(to_regprocedure(signature))) > 0
      and position(permission_key in pg_get_functiondef(to_regprocedure(signature))) > 0
    )
    from expected_functions
  ) as wrappers_call_permission_engine,
  (
    select bool_and(
      not has_function_privilege('authenticated', signature, 'EXECUTE')
    )
    from expected_legacy
  ) as authenticated_cannot_execute_legacy,
  (
    select bool_and(
      not has_function_privilege('anon', signature, 'EXECUTE')
    )
    from expected_legacy
  ) as anon_cannot_execute_legacy,
  not has_table_privilege('authenticated', 'public.premium_check_notes', 'INSERT')
    and not has_table_privilege('authenticated', 'public.premium_check_notes', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.premium_check_notes', 'DELETE')
    as notes_direct_write_blocked,
  not has_table_privilege('authenticated', 'public.premium_anomalies', 'INSERT')
    and not has_table_privilege('authenticated', 'public.premium_anomalies', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.premium_anomalies', 'DELETE')
    as anomalies_direct_write_blocked,
  not has_table_privilege('authenticated', 'public.premium_analysis_field_reviews', 'INSERT')
    and not has_table_privilege('authenticated', 'public.premium_analysis_field_reviews', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.premium_analysis_field_reviews', 'DELETE')
    as field_reviews_direct_write_blocked,
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_check_notes'
      and policyname = 'premium_check_notes_staff_select'
      and cmd = 'SELECT'
  ) as notes_staff_read_preserved,
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_anomalies'
      and policyname = 'premium_anomalies_staff_select'
      and cmd = 'SELECT'
  ) as anomalies_staff_read_preserved,
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_analysis_field_reviews'
      and policyname = 'premium_analysis_field_reviews_staff_select'
      and cmd = 'SELECT'
  ) as field_reviews_staff_read_preserved,
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'premium_check_notes' and policyname = 'premium_check_notes_staff_all')
        or (tablename = 'premium_anomalies' and policyname = 'premium_anomalies_staff_all')
        or (tablename = 'premium_analysis_field_reviews' and policyname = 'premium_analysis_field_reviews_staff_all')
      )
  ) as legacy_staff_all_write_policies_removed;
