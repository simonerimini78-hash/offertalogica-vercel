-- OffertaLogica Staff v2.5A - verifica NON distruttiva.
-- Non concede/revoca omaggi e non modifica permessi.

select
  to_regclass('public.premium_staff_complimentary_permissions') is not null
    as permission_table_exists,
  to_regprocedure('public.premium_staff_can_manage_complimentary()') is not null
    as permission_helper_exists,
  to_regprocedure('public.premium_owner_set_complimentary_permission(uuid,boolean,text)') is not null
    as owner_permission_writer_exists,
  to_regprocedure('public.premium_owner_list_complimentary_permissions()') is not null
    as owner_permission_reader_exists,
  to_regprocedure('public.premium_internal_set_complimentary_v03613(uuid,text,text)') is not null
    as internal_set_engine_exists,
  to_regprocedure('public.premium_internal_revoke_complimentary_v03613(uuid,text)') is not null
    as internal_revoke_engine_exists,
  to_regprocedure('public.premium_admin_set_complimentary(uuid,text,text)') is not null
    as governed_set_rpc_exists,
  to_regprocedure('public.premium_admin_revoke_complimentary(uuid,text)') is not null
    as governed_revoke_rpc_exists;

-- Atteso: tutti true.

select
  not has_table_privilege(
    'authenticated',
    'public.premium_staff_complimentary_permissions',
    'SELECT'
  ) as browser_cannot_read_permission_table,
  not has_table_privilege(
    'authenticated',
    'public.premium_staff_complimentary_permissions',
    'INSERT'
  ) as browser_cannot_write_permission_table,
  not has_function_privilege(
    'authenticated',
    'public.premium_internal_set_complimentary_v03613(uuid,text,text)',
    'EXECUTE'
  ) as browser_cannot_call_internal_set,
  not has_function_privilege(
    'authenticated',
    'public.premium_internal_revoke_complimentary_v03613(uuid,text)',
    'EXECUTE'
  ) as browser_cannot_call_internal_revoke;

-- Atteso: tutti true.

select
  position(
    'premium_complimentary_reason_required'
    in pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure)
  ) > 0 as set_reason_required,
  position(
    'premium_complimentary_reason_required'
    in pg_get_functiondef('public.premium_admin_revoke_complimentary(uuid,text)'::regprocedure)
  ) > 0 as revoke_reason_required,
  position(
    'premium_complimentary_unlimited_owner_only'
    in pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure)
  ) > 0 as unlimited_owner_only,
  position(
    'premium_staff_can_manage_complimentary'
    in pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure)
  ) > 0 as set_uses_permission_helper,
  position(
    'premium_staff_can_manage_complimentary'
    in pg_get_functiondef('public.premium_admin_revoke_complimentary(uuid,text)'::regprocedure)
  ) > 0 as revoke_uses_permission_helper,
  position(
    'premium_staff_audit_insert'
    in pg_get_functiondef('public.premium_admin_set_complimentary(uuid,text,text)'::regprocedure)
  ) > 0 as set_is_audited,
  position(
    'premium_staff_audit_insert'
    in pg_get_functiondef('public.premium_admin_revoke_complimentary(uuid,text)'::regprocedure)
  ) > 0 as revoke_is_audited;

-- Atteso: tutti true.

-- Verifica ruolo Owner senza lasciare stato.
begin;

select set_config(
  'request.jwt.claim.sub',
  (
    select staff.user_id::text
    from public.premium_staff_members staff
    where staff.role = 'owner'
      and staff.active = true
    order by staff.created_at
    limit 1
  ),
  true
);

select
  public.premium_staff_raw_role() = 'owner' as raw_role_is_owner,
  public.premium_staff_can_manage_complimentary() = true as owner_can_manage;

rollback;

-- Admin attivi senza permesso esplicito devono risultare negati.
-- Se non esistono Admin attivi la query restituisce zero righe, che è accettabile.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  coalesce(permission_record.allowed, false) as explicit_permission
from public.premium_staff_members staff
left join auth.users auth_user on auth_user.id = staff.user_id
left join public.premium_staff_complimentary_permissions permission_record
  on permission_record.staff_user_id = staff.user_id
where staff.role = 'admin'
  and staff.active = true
order by staff.created_at;

-- Owner invariato.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active
from public.premium_staff_members staff
left join auth.users auth_user on auth_user.id = staff.user_id
where staff.role = 'owner'
order by staff.created_at;
