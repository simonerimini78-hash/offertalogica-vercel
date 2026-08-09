-- OffertaLogica Staff v2.3B1 - gestione collaboratori esistenti, Owner-only.
-- Consente al Proprietario di aggiungere un utente Auth esistente come Admin/Tecnico,
-- cambiare ruolo e attivare/disattivare collaboratori. L'Owner non e' modificabile.

begin;

-- Precondizioni: ruolo reale B3 e lista collaboratori A devono essere disponibili.
do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;
  if to_regprocedure('public.premium_owner_list_staff()') is null then
    raise exception 'premium_owner_list_staff_missing';
  end if;
end;
$$;

create or replace function public.premium_owner_add_staff(
  p_email text,
  p_role text default 'technician'
)
returns table (
  user_id uuid,
  email text,
  role text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_role text := lower(trim(coalesce(p_role, '')));
  v_user_id uuid;
  v_existing_role text;
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required';
  end if;

  if v_email = '' or position('@' in v_email) <= 1 then
    raise exception 'premium_staff_email_invalid';
  end if;

  if v_role not in ('admin', 'technician') then
    raise exception 'premium_staff_role_invalid';
  end if;

  select auth_user.id
    into v_user_id
  from auth.users as auth_user
  where lower(coalesce(auth_user.email, '')) = v_email
  limit 1;

  if v_user_id is null then
    raise exception 'premium_staff_auth_user_not_found';
  end if;

  select staff.role
    into v_existing_role
  from public.premium_staff_members as staff
  where staff.user_id = v_user_id;

  if v_existing_role = 'owner' then
    raise exception 'premium_owner_protected';
  end if;

  insert into public.premium_staff_members (user_id, role, active)
  values (v_user_id, v_role, true)
  on conflict (user_id) do update
    set role = excluded.role,
        active = true,
        updated_at = now();

  return query
  select
    staff.user_id,
    auth_user.email::text,
    staff.role,
    staff.active,
    staff.created_at,
    staff.updated_at
  from public.premium_staff_members as staff
  left join auth.users as auth_user on auth_user.id = staff.user_id
  where staff.user_id = v_user_id;
end;
$$;

revoke all on function public.premium_owner_add_staff(text, text) from public, anon;
grant execute on function public.premium_owner_add_staff(text, text) to authenticated, service_role;

create or replace function public.premium_owner_update_staff(
  p_user_id uuid,
  p_role text,
  p_active boolean
)
returns table (
  user_id uuid,
  email text,
  role text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := lower(trim(coalesce(p_role, '')));
  v_current_role text;
  v_updated integer;
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required';
  end if;

  if p_user_id is null then
    raise exception 'premium_staff_user_id_invalid';
  end if;

  if v_role not in ('admin', 'technician') then
    raise exception 'premium_staff_role_invalid';
  end if;

  select staff.role
    into v_current_role
  from public.premium_staff_members as staff
  where staff.user_id = p_user_id;

  if v_current_role is null then
    raise exception 'premium_staff_member_not_found';
  end if;

  if v_current_role = 'owner' then
    raise exception 'premium_owner_protected';
  end if;

  update public.premium_staff_members
  set role = v_role,
      active = coalesce(p_active, false),
      updated_at = now()
  where premium_staff_members.user_id = p_user_id
    and premium_staff_members.role <> 'owner';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'premium_staff_update_failed';
  end if;

  return query
  select
    staff.user_id,
    auth_user.email::text,
    staff.role,
    staff.active,
    staff.created_at,
    staff.updated_at
  from public.premium_staff_members as staff
  left join auth.users as auth_user on auth_user.id = staff.user_id
  where staff.user_id = p_user_id;
end;
$$;

revoke all on function public.premium_owner_update_staff(uuid, text, boolean) from public, anon;
grant execute on function public.premium_owner_update_staff(uuid, text, boolean) to authenticated, service_role;

comment on function public.premium_owner_add_staff(text, text) is
  'Staff v2.3B1: Owner-only. Aggiunge o riattiva un utente Auth esistente come admin/technician; non puo modificare owner.';
comment on function public.premium_owner_update_staff(uuid, text, boolean) is
  'Staff v2.3B1: Owner-only. Cambia ruolo admin/technician e stato attivo; owner protetto.';

commit;
