-- OffertaLogica Staff v2.4B - verifica NON distruttiva.
-- Eseguire dopo premium-staff-audit-v2.4B.sql.

select
  to_regprocedure('public.premium_staff_audit_insert(uuid,text,text,text,text,text,text,jsonb,text)') is not null
    as audit_writer_exists,
  to_regprocedure('public.premium_staff_delete_records(text,uuid[])') is not null
    as delete_rpc_exists;

select
  position(
    'premium_staff_audit_insert'
    in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)
  ) > 0 as deletion_is_audited,
  position(
    '''premium_records_deleted'''
    in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)
  ) > 0 as deletion_action_present,
  position(
    '''requested_ids'''
    in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)
  ) > 0 as deleted_targets_recorded,
  position(
    'premium_staff_raw_role'
    in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)
  ) > 0 as raw_role_recorded;

-- Atteso: tutti true.

-- Protezione Owner e struttura Audit restano invariate.
select
  count(*) = 1 as exactly_one_active_owner
from public.premium_staff_members
where role = 'owner'
  and active = true;

select
  not has_table_privilege('authenticated', 'public.premium_staff_audit_events', 'INSERT')
    as browser_cannot_insert_audit,
  not has_function_privilege(
    'authenticated',
    'public.premium_staff_audit_insert(uuid,text,text,text,text,text,text,jsonb,text)',
    'EXECUTE'
  ) as browser_cannot_call_audit_writer;

-- Atteso: tutti true.
