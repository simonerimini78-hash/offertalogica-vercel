-- Rollback OffertaLogica Security Step 6B2 / Staff v2.8G1
-- Ripristina premium_staff_permission_allowed(text) alla logica v2.8A
-- senza enforcement MFA centrale e rimuove il nuovo helper.

begin;

create or replace function public.premium_staff_permission_allowed(
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := coalesce(public.premium_staff_raw_role(), '');
  v_key text := lower(trim(coalesce(p_permission_key, '')));
  v_explicit_allowed boolean;
begin
  if v_user_id is null or v_role = '' then
    return false;
  end if;

  if not public.premium_staff_permission_known(v_key) then
    return false;
  end if;

  if v_role = 'owner' then
    return true;
  end if;

  if v_key = 'manage_complimentary' then
    return public.premium_staff_can_manage_complimentary();
  end if;

  if v_role in ('technician', 'reviewer') then
    return public.premium_staff_permission_default_for_role(v_role, v_key);
  end if;

  if v_role <> 'admin' then
    return false;
  end if;

  if not public.premium_staff_permission_admin_configurable(v_key) then
    return false;
  end if;

  select permission_record.allowed
    into v_explicit_allowed
  from public.premium_staff_permissions as permission_record
  where permission_record.staff_user_id = v_user_id
    and permission_record.permission_key = v_key;

  if found then
    return coalesce(v_explicit_allowed, false);
  end if;

  return public.premium_staff_permission_default_for_role(v_role, v_key);
end;
$$;

revoke all on function public.premium_staff_permission_allowed(text)
from public, anon;

grant execute on function public.premium_staff_permission_allowed(text)
to authenticated, service_role;

drop function if exists public.premium_staff_mfa_verified();

commit;
