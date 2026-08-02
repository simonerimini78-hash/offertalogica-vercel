-- OFFERTALOGICA PREMIUM v0.27 - verifica sola lettura

with expected_functions(signature) as (
  values
    ('public.premium_staff_role()'),
    ('public.premium_staff_claim_check(uuid)'),
    ('public.premium_staff_set_check_status(uuid,text,text)'),
    ('public.premium_staff_add_check_note(uuid,text)'),
    ('public.premium_staff_add_anomaly(uuid,text,text,text,text,numeric)'),
    ('public.premium_staff_delete_anomaly(uuid)'),
    ('public.premium_staff_complete_check(uuid,text,text,text,integer)')
),
function_checks as (
  select
    count(*) = 7 as all_present,
    bool_and(has_function_privilege('authenticated', signature, 'EXECUTE')) as authenticated_can_execute,
    bool_and(not has_function_privilege('anon', signature, 'EXECUTE')) as anon_cannot_execute
  from expected_functions
),
queue_indexes as (
  select count(*) = 4 as valid
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'premium_checks_status_created_idx',
      'premium_checks_assigned_status_idx',
      'premium_check_notes_check_created_idx',
      'premium_anomalies_check_created_idx'
    )
),
staff_role_definition as (
  select
    coalesce(procedure.prosecdef, false) as security_definer,
    position('reviewer' in pg_get_functiondef(procedure.oid)) > 0
      and position('admin' in pg_get_functiondef(procedure.oid)) > 0
      and position('support' in pg_get_functiondef(procedure.oid)) = 0 as reviewer_admin_only
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'premium_staff_role'
  limit 1
)
select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_profiles'
      and column_name = 'email'
      and data_type = 'text'
      and is_nullable = 'NO'
  ) as profile_email_column_present,

  not exists (
    select 1
    from public.premium_profiles
    where email is null
  ) as profile_email_values_valid,

  exists (
    select 1
    from information_schema.triggers
    where event_object_schema = 'auth'
      and event_object_table = 'users'
      and trigger_name = 'premium_on_auth_user_email_updated'
  ) as profile_email_sync_trigger_present,

  (select valid from queue_indexes) as staff_queue_indexes_present,

  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_staff_select'
      and cmd = 'SELECT'
      and coalesce(qual, '') like '%reviewer%'
      and coalesce(qual, '') like '%admin%'
  ) as staff_can_read_private_pdfs,

  (select all_present from function_checks) as staff_functions_present,
  (select authenticated_can_execute from function_checks) as authenticated_staff_can_execute,
  (select anon_cannot_execute from function_checks) as anon_cannot_execute,
  coalesce((select security_definer from staff_role_definition), false) as staff_role_is_security_definer,
  coalesce((select reviewer_admin_only from staff_role_definition), false) as dashboard_is_reviewer_admin_only,

  position('premium_anomaly_required' in pg_get_functiondef('public.premium_staff_complete_check(uuid,text,text,text,integer)'::regprocedure)) > 0
    and position('human_seconds' in pg_get_functiondef('public.premium_staff_complete_check(uuid,text,text,text,integer)'::regprocedure)) > 0
    and position('status = ''completed''' in pg_get_functiondef('public.premium_staff_complete_check(uuid,text,text,text,integer)'::regprocedure)) > 0
    as completion_enforces_outcome,

  position('premium_invalid_check_transition' in pg_get_functiondef('public.premium_staff_set_check_status(uuid,text,text)'::regprocedure)) > 0
    and position('more_info_required' in pg_get_functiondef('public.premium_staff_set_check_status(uuid,text,text)'::regprocedure)) > 0
    as status_transitions_are_enforced;
