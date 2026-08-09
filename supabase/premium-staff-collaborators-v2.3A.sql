-- OffertaLogica Staff v2.3A - Collaboratori, sola lettura Owner-only.
-- Aggiunge una RPC di elenco Staff senza modificare membri, ruoli o account Auth.

begin;

-- Precondizione: il ruolo reale introdotto in v2.2B3 deve essere disponibile.
do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;
end;
$$;

create or replace function public.premium_owner_list_staff()
returns table (
  user_id uuid,
  email text,
  role text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required';
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
  left join auth.users as auth_user
    on auth_user.id = staff.user_id
  order by
    case staff.role
      when 'owner' then 1
      when 'admin' then 2
      when 'technician' then 3
      when 'reviewer' then 4
      when 'support' then 5
      else 99
    end,
    staff.active desc,
    auth_user.email nulls last,
    staff.user_id;
end;
$$;

revoke all on function public.premium_owner_list_staff() from public, anon;
grant execute on function public.premium_owner_list_staff() to authenticated, service_role;

comment on function public.premium_owner_list_staff() is
  'Staff v2.3A: elenco collaboratori Staff in sola lettura, accessibile soltanto al ruolo reale owner.';

commit;
