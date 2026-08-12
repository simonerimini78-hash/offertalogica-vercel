-- OffertaLogica Staff v2.8F — rimozione collaboratori con storico preservato.
-- Base verificata: staff-v2-control-center @ 3511121aa20df7d977dd5879b1a3b34d49f8996b
-- Non elimina auth.users e non elimina premium_staff_members: revoca l'accesso Staff
-- mantenendo intatti riferimenti storici, audit, note e timeline.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;
  if to_regprocedure('public.premium_staff_audit_insert(uuid,text,text,text,text,text,text,jsonb,text)') is null then
    raise exception 'premium_staff_audit_insert_missing';
  end if;
  if to_regclass('public.premium_staff_members') is null then
    raise exception 'premium_staff_members_missing';
  end if;
end;
$$;

alter table public.premium_staff_members
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid,
  add column if not exists removed_reason text not null default '';

create or replace function public.premium_staff_member_removal_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active then
    new.removed_at := null;
    new.removed_by := null;
    new.removed_reason := '';
  elsif new.removed_at is null then
    new.removed_by := null;
    new.removed_reason := '';
  end if;
  return new;
end;
$$;

revoke all on function public.premium_staff_member_removal_consistency()
from public, anon, authenticated, service_role;

drop trigger if exists premium_staff_member_removal_consistency_trigger
on public.premium_staff_members;
create trigger premium_staff_member_removal_consistency_trigger
before insert or update on public.premium_staff_members
for each row execute procedure public.premium_staff_member_removal_consistency();

create or replace function public.premium_owner_list_staff_v2(
  p_include_removed boolean default false
)
returns table (
  user_id uuid,
  email text,
  role text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  removed_at timestamptz,
  removed_by uuid,
  removed_reason text,
  activation_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;

  return query
  select
    staff.user_id,
    lower(coalesce(auth_user.email, ''))::text,
    staff.role,
    staff.active,
    staff.created_at,
    staff.updated_at,
    staff.removed_at,
    staff.removed_by,
    staff.removed_reason,
    case
      when staff.removed_at is not null then 'removed'
      when not staff.active then 'inactive'
      when auth_user.id is null then 'auth_missing'
      when auth_user.invited_at is not null and auth_user.email_confirmed_at is null then 'invited_pending'
      when auth_user.email_confirmed_at is null then 'email_unconfirmed'
      else 'active'
    end::text
  from public.premium_staff_members staff
  left join auth.users auth_user on auth_user.id = staff.user_id
  where coalesce(p_include_removed, false) or staff.removed_at is null
  order by
    case staff.role when 'owner' then 0 when 'admin' then 1 when 'technician' then 2 when 'reviewer' then 3 else 9 end,
    staff.removed_at nulls first,
    lower(coalesce(auth_user.email, '')),
    staff.created_at;
end;
$$;

revoke all on function public.premium_owner_list_staff_v2(boolean) from public, anon;
grant execute on function public.premium_owner_list_staff_v2(boolean) to authenticated, service_role;

create or replace function public.premium_owner_remove_staff(
  p_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_target_role text;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_removed_at timestamptz := now();
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'premium_staff_user_id_invalid' using errcode = '22023';
  end if;
  if v_reason = '' then
    raise exception 'premium_staff_remove_reason_required' using errcode = '22023';
  end if;

  select staff.role into v_target_role
  from public.premium_staff_members staff
  where staff.user_id = p_user_id
  for update;

  if not found then
    raise exception 'premium_staff_member_not_found' using errcode = 'P0002';
  end if;
  if v_target_role = 'owner' or p_user_id = v_owner_id then
    raise exception 'premium_owner_protected' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.premium_staff_members staff
    where staff.user_id = p_user_id and staff.removed_at is not null
  ) then
    raise exception 'premium_staff_already_removed' using errcode = 'P0001';
  end if;

  update public.premium_staff_members
  set active = false,
      removed_at = v_removed_at,
      removed_by = v_owner_id,
      removed_reason = v_reason,
      updated_at = now()
  where user_id = p_user_id;

  if to_regclass('public.premium_staff_permissions') is not null then
    delete from public.premium_staff_permissions where staff_user_id = p_user_id;
  end if;
  if to_regclass('public.premium_staff_complimentary_permissions') is not null then
    delete from public.premium_staff_complimentary_permissions where staff_user_id = p_user_id;
  end if;

  perform public.premium_staff_audit_insert(
    v_owner_id,
    'owner',
    'staff_member_removed',
    'staff_member',
    p_user_id::text,
    'success',
    v_reason,
    jsonb_build_object(
      'target_role', v_target_role,
      'history_preserved', true,
      'auth_user_deleted', false,
      'permissions_cleared', true
    ),
    'rpc:premium_owner_remove_staff'
  );

  return jsonb_build_object(
    'ok', true,
    'staff_user_id', p_user_id,
    'removed_at', v_removed_at,
    'history_preserved', true,
    'auth_user_deleted', false
  );
end;
$$;

revoke all on function public.premium_owner_remove_staff(uuid,text) from public, anon;
grant execute on function public.premium_owner_remove_staff(uuid,text) to authenticated, service_role;

create or replace function public.premium_owner_restore_staff(
  p_user_id uuid,
  p_role text default null,
  p_reason text default 'Collaboratore ripristinato dal Proprietario'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_current_role text;
  v_next_role text;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'premium_staff_user_id_invalid' using errcode = '22023';
  end if;

  select staff.role into v_current_role
  from public.premium_staff_members staff
  where staff.user_id = p_user_id
    and staff.removed_at is not null
  for update;

  if not found then
    raise exception 'premium_staff_not_removed' using errcode = 'P0001';
  end if;
  if v_current_role = 'owner' or p_user_id = v_owner_id then
    raise exception 'premium_owner_protected' using errcode = '42501';
  end if;

  v_next_role := lower(trim(coalesce(p_role, v_current_role)));
  if v_next_role = 'reviewer' then v_next_role := 'technician'; end if;
  if v_next_role not in ('admin', 'technician') then
    raise exception 'premium_staff_role_invalid' using errcode = '22023';
  end if;
  if v_reason = '' then v_reason := 'Collaboratore ripristinato dal Proprietario'; end if;

  -- I permessi Admin non vengono ripristinati: al rientro vale di nuovo default-deny.
  if to_regclass('public.premium_staff_permissions') is not null then
    delete from public.premium_staff_permissions where staff_user_id = p_user_id;
  end if;
  if to_regclass('public.premium_staff_complimentary_permissions') is not null then
    delete from public.premium_staff_complimentary_permissions where staff_user_id = p_user_id;
  end if;

  update public.premium_staff_members
  set role = v_next_role,
      active = true,
      removed_at = null,
      removed_by = null,
      removed_reason = '',
      updated_at = now()
  where user_id = p_user_id;

  perform public.premium_staff_audit_insert(
    v_owner_id,
    'owner',
    'staff_member_restored',
    'staff_member',
    p_user_id::text,
    'success',
    v_reason,
    jsonb_build_object(
      'previous_role', v_current_role,
      'restored_role', v_next_role,
      'permissions_reset', true
    ),
    'rpc:premium_owner_restore_staff'
  );

  return jsonb_build_object(
    'ok', true,
    'staff_user_id', p_user_id,
    'role', v_next_role,
    'permissions_reset', true
  );
end;
$$;

revoke all on function public.premium_owner_restore_staff(uuid,text,text) from public, anon;
grant execute on function public.premium_owner_restore_staff(uuid,text,text) to authenticated, service_role;

comment on function public.premium_owner_remove_staff(uuid,text) is
  'Staff v2.8F: revoca Owner-only dell accesso Staff senza cancellare identita e storico.';
comment on function public.premium_owner_restore_staff(uuid,text,text) is
  'Staff v2.8F: ripristino Owner-only; i permessi Admin ripartono da default-deny.';

commit;
