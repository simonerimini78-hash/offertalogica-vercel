-- OFFERTALOGICA PREMIUM v0.26 — VERIFICA SOLA LETTURA

select
  exists (
    select 1
    from information_schema.routines
    where routine_schema = 'public'
      and routine_name = 'premium_request_check'
  ) as request_function_present,

  has_function_privilege(
    'authenticated',
    'public.premium_request_check(uuid)',
    'EXECUTE'
  ) as authenticated_can_execute,

  not has_function_privilege(
    'anon',
    'public.premium_request_check(uuid)',
    'EXECUTE'
  ) as anon_cannot_execute,

  exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'premium_request_check'
      and procedure.prosecdef = true
  ) as request_function_is_security_definer,

  exists (
    select 1
    from information_schema.triggers
    where event_object_schema = 'public'
      and event_object_table = 'premium_checks'
      and trigger_name = 'premium_checks_sync_bill'
  ) as bill_status_sync_trigger_present,

  exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'premium_request_check'
      and pg_get_functiondef(procedure.oid) ilike '%remote_review%'
      and pg_get_functiondef(procedure.oid) ilike '%premium-check-v0.26%'
  ) as remote_review_consent_recorded,

  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'premium_checks'
      and indexname = 'premium_checks_bill_active_uidx'
      and indexdef ilike '%unique index%'
      and indexdef ilike '%status%<>%canceled%'
  ) as duplicate_request_index_present,

  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_checks'
      and policyname = 'premium_checks_owner_select'
      and qual ilike '%auth.uid%'
      and qual ilike '%premium_has_service_access%'
  ) as customer_can_read_own_checks,

  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_check_notes'
      and policyname = 'premium_check_notes_staff_all'
  )
  and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_check_notes'
      and policyname ilike '%owner%'
  ) as internal_notes_remain_staff_only;
