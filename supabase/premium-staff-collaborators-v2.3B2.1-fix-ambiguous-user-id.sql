-- OffertaLogica Staff v2.3B2.1
-- Correzione minima: elimina l'ambiguita' PL/pgSQL tra RETURNS TABLE.user_id
-- e ON CONFLICT (user_id) nella RPC premium_owner_add_staff().
-- Non modifica schema, dati esistenti, ruoli, Owner, frontend o Edge Functions.

begin;

do $$
begin
  if to_regprocedure('public.premium_owner_add_staff(text,text)') is null then
    raise exception 'premium_owner_add_staff_missing';
  end if;
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
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

  -- IMPORTANTE:
  -- l'ON CONFLICT resta identico a B1, ma vive dentro EXECUTE.
  -- In questo modo PL/pgSQL non tenta di interpretare "user_id"
  -- come variabile OUT della RETURNS TABLE.
  execute $upsert$
    insert into public.premium_staff_members (user_id, role, active)
    values ($1, $2, true)
    on conflict (user_id) do update
      set role = excluded.role,
          active = true,
          updated_at = now()
  $upsert$
  using v_user_id, v_role;

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

comment on function public.premium_owner_add_staff(text, text) is
  'Staff v2.3B2.1: Owner-only. Aggiunge/riattiva un Auth esistente come admin/technician; fix ambiguita PL/pgSQL ON CONFLICT(user_id); owner protetto.';

commit;
