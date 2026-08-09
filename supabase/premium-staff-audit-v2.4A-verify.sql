-- OffertaLogica Staff v2.4A - verifica NON distruttiva.

select
  to_regclass('public.premium_staff_audit_events') as audit_table,
  to_regprocedure('public.premium_staff_audit_insert(uuid,text,text,text,text,text,text,jsonb,text)') as audit_writer,
  to_regprocedure('public.premium_owner_list_audit(integer,integer)') as owner_audit_reader;

select
  has_table_privilege('authenticated', 'public.premium_staff_audit_events', 'SELECT') as authenticated_can_select,
  has_table_privilege('authenticated', 'public.premium_staff_audit_events', 'INSERT') as authenticated_can_insert,
  has_table_privilege('authenticated', 'public.premium_staff_audit_events', 'UPDATE') as authenticated_can_update,
  has_table_privilege('authenticated', 'public.premium_staff_audit_events', 'DELETE') as authenticated_can_delete,
  has_function_privilege(
    'authenticated',
    'public.premium_staff_audit_insert(uuid,text,text,text,text,text,text,jsonb,text)',
    'EXECUTE'
  ) as authenticated_can_call_writer;

-- Atteso: tutti false.

select
  position('premium_staff_audit_insert' in pg_get_functiondef(
    'public.premium_owner_add_staff(text,text)'::regprocedure
  )) > 0 as add_staff_is_audited,
  position('execute $upsert$' in lower(pg_get_functiondef(
    'public.premium_owner_add_staff(text,text)'::regprocedure
  ))) > 0 as b2_1_dynamic_upsert_preserved,
  position('premium_staff_audit_insert' in pg_get_functiondef(
    'public.premium_owner_update_staff(uuid,text,boolean)'::regprocedure
  )) > 0 as update_staff_is_audited;

begin;

select set_config(
  'request.jwt.claim.sub',
  (
    select staff.user_id::text
    from public.premium_staff_members as staff
    where staff.role = 'owner'
      and staff.active = true
    order by staff.created_at
    limit 1
  ),
  true
);

select public.premium_staff_audit_insert(
  auth.uid(),
  'owner',
  'audit_verify',
  'staff_member',
  auth.uid()::text,
  'success',
  'test transazionale',
  jsonb_build_object('phase', 'v2.4A'),
  'verify'
) as temporary_event_id;

select
  count(*) >= 1 as owner_can_read_temporary_event
from public.premium_owner_list_audit(20, 0)
where action = 'audit_verify'
  and source = 'verify';

rollback;

select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active
from public.premium_staff_members as staff
left join auth.users as auth_user on auth_user.id = staff.user_id
where staff.role = 'owner'
order by staff.created_at;
