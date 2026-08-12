-- OffertaLogica Staff v2.8B1
-- Stato autorevole degli inviti Staff per la UI Owner.
--
-- Base verificata:
--   branch: staff-v2-control-center
--   commit: f9c48a1a3c6a51c567aebb646b3732725261f07b (Staff-V2.8B)
--
-- Non modifica il flusso di invito, premium_staff_members o auth.users.
-- Aggiunge soltanto una RPC Owner-only in sola lettura.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;

  if to_regclass('public.premium_staff_members') is null then
    raise exception 'premium_staff_members_missing';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'auth.users'::regclass
      and attname = 'invited_at'
      and not attisdropped
  ) then
    raise exception 'auth_users_invited_at_missing';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'auth.users'::regclass
      and attname = 'email_confirmed_at'
      and not attisdropped
  ) then
    raise exception 'auth_users_email_confirmed_at_missing';
  end if;
end;
$$;

create or replace function public.premium_owner_list_staff_activation_status()
returns table (
  staff_user_id uuid,
  staff_email text,
  staff_role text,
  staff_active boolean,
  activation_status text,
  invited_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
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
    coalesce(auth_user.email::text, ''),
    staff.role,
    staff.active,
    case
      when staff.active = false then 'disabled'
      when auth_user.id is null then 'auth_missing'
      when auth_user.invited_at is not null
       and auth_user.email_confirmed_at is null then 'invited_pending'
      when auth_user.email_confirmed_at is null then 'email_unconfirmed'
      else 'activated'
    end::text as activation_status,
    auth_user.invited_at,
    auth_user.email_confirmed_at,
    auth_user.last_sign_in_at
  from public.premium_staff_members as staff
  left join auth.users as auth_user
    on auth_user.id = staff.user_id
  order by
    case staff.role
      when 'owner' then 0
      when 'admin' then 1
      when 'technician' then 2
      when 'reviewer' then 3
      when 'support' then 4
      else 9
    end,
    lower(coalesce(auth_user.email, '')),
    staff.user_id;
end;
$$;

revoke all on function public.premium_owner_list_staff_activation_status()
from public, anon;

grant execute on function public.premium_owner_list_staff_activation_status()
to authenticated, service_role;

comment on function public.premium_owner_list_staff_activation_status() is
  'Staff v2.8B1: Owner-only, sola lettura. Distingue inviti Auth ancora non confermati dagli account Staff attivati senza dedurre lo stato dal solo flag premium_staff_members.active.';

commit;
