-- OffertaLogica Staff v2.7C1 — verifica live
-- Non lascia modifiche: il probe viene eseguito dentro una transazione e termina con ROLLBACK.

begin;

select
  to_regclass('public.premium_check_timeline_events') is not null
    as timeline_table_ok,
  to_regprocedure('public.premium_check_timeline_write(uuid,uuid,uuid,text,uuid,jsonb,text)') is not null
    as timeline_writer_ok,
  to_regprocedure('public.premium_staff_list_check_timeline(uuid,integer)') is not null
    as timeline_reader_ok,
  to_regprocedure('public.premium_check_timeline_checks_trigger()') is not null
    as checks_trigger_function_ok,
  to_regprocedure('public.premium_check_timeline_notes_trigger()') is not null
    as notes_trigger_function_ok,
  to_regprocedure('public.premium_check_timeline_anomalies_trigger()') is not null
    as anomalies_trigger_function_ok,
  to_regprocedure('public.premium_check_timeline_analysis_trigger()') is not null
    as analysis_trigger_function_ok,
  to_regprocedure('public.premium_check_timeline_communications_trigger()') is not null
    as communications_trigger_function_ok;

select
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.premium_checks'::regclass
      and tgname = 'premium_check_timeline_checks'
      and not tgisinternal
  ) as checks_trigger_attached,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.premium_check_notes'::regclass
      and tgname = 'premium_check_timeline_notes'
      and not tgisinternal
  ) as notes_trigger_attached,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.premium_anomalies'::regclass
      and tgname = 'premium_check_timeline_anomalies'
      and not tgisinternal
  ) as anomalies_trigger_attached,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.premium_analysis_runs'::regclass
      and tgname = 'premium_check_timeline_analysis'
      and not tgisinternal
  ) as analysis_trigger_attached,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.premium_communications'::regclass
      and tgname = 'premium_check_timeline_communications'
      and not tgisinternal
  ) as communications_trigger_attached;

select
  not has_table_privilege(
    'authenticated',
    'public.premium_check_timeline_events',
    'SELECT'
  ) as authenticated_no_direct_select,
  not has_table_privilege(
    'authenticated',
    'public.premium_check_timeline_events',
    'INSERT'
  ) as authenticated_no_direct_insert,
  not has_table_privilege(
    'authenticated',
    'public.premium_check_timeline_events',
    'UPDATE'
  ) as authenticated_no_direct_update,
  not has_table_privilege(
    'authenticated',
    'public.premium_check_timeline_events',
    'DELETE'
  ) as authenticated_no_direct_delete,
  not has_table_privilege(
    'service_role',
    'public.premium_check_timeline_events',
    'UPDATE'
  ) as service_role_no_update,
  not has_table_privilege(
    'service_role',
    'public.premium_check_timeline_events',
    'DELETE'
  ) as service_role_no_delete,
  not has_table_privilege(
    'service_role',
    'public.premium_check_timeline_events',
    'TRUNCATE'
  ) as service_role_no_truncate;

select
  not has_function_privilege(
    'authenticated',
    'public.premium_check_timeline_write(uuid,uuid,uuid,text,uuid,jsonb,text)',
    'EXECUTE'
  ) as authenticated_cannot_call_writer,
  has_function_privilege(
    'authenticated',
    'public.premium_staff_list_check_timeline(uuid,integer)',
    'EXECUTE'
  ) as authenticated_can_call_reader;

select
  position(
    'premium_staff_raw_role'
    in pg_get_functiondef(
      'public.premium_staff_list_check_timeline(uuid,integer)'::regprocedure
    )
  ) > 0 as reader_uses_raw_role,
  position(
    'premium_check_timeline_write'
    in pg_get_functiondef(
      'public.premium_check_timeline_checks_trigger()'::regprocedure
    )
  ) > 0 as checks_use_internal_writer,
  position(
    'corrected_field_keys'
    in pg_get_functiondef(
      'public.premium_check_timeline_analysis_trigger()'::regprocedure
    )
  ) > 0 as validation_records_corrected_fields,
  position(
    'body'
    in pg_get_functiondef(
      'public.premium_check_timeline_communications_trigger()'::regprocedure
    )
  ) = 0 as communication_body_not_copied;

-- Probe append-only interno: nessuna FK verso dati reali e ROLLBACK finale.
do $$
declare
  v_check uuid := gen_random_uuid();
  v_event uuid;
  v_count integer;
begin
  v_event := public.premium_check_timeline_write(
    v_check,
    null,
    null,
    'verify_probe',
    null,
    jsonb_build_object('probe', true),
    'verify:v2.7C1'
  );

  select count(*)
    into v_count
  from public.premium_check_timeline_events
  where id = v_event
    and check_id = v_check
    and event_type = 'verify_probe'
    and actor_role = 'system';

  if v_count <> 1 then
    raise exception 'staff_v2_7C1_writer_probe_failed';
  end if;
end;
$$;

select true as append_only_writer_probe_ok;

-- Verifica Owner reader se esiste l'Owner attivo.
do $$
declare
  v_owner uuid;
begin
  select staff.user_id
    into v_owner
  from public.premium_staff_members as staff
  where staff.role = 'owner'
    and staff.active = true
  order by staff.created_at, staff.user_id
  limit 1;

  if v_owner is null then
    raise exception 'staff_v2_7C1_owner_missing';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'staff_v2_7C1_owner_context_failed';
  end if;

  perform count(*)
  from public.premium_staff_list_check_timeline(gen_random_uuid(), 10);
end;
$$;

select
  public.premium_staff_raw_role() = 'owner'
    as owner_raw_role_ok,
  (
    select count(*) = 0
    from public.premium_staff_list_check_timeline(gen_random_uuid(), 10)
  ) as owner_reader_empty_check_ok;

rollback;
