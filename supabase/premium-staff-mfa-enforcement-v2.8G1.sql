-- OffertaLogica Security Step 6B2 / Staff v2.8G1
-- MFA enforcement centrale sulla matrice permessi Staff.
--
-- OBIETTIVO
-- - lasciare disponibile la sola identificazione della membership Staff a AAL1,
--   necessaria al flusso password -> MFA;
-- - negare invece tutti i permessi operativi Staff finche' la sessione non e' AAL2;
-- - propagare automaticamente il vincolo alle RLS/RPC che usano
--   premium_staff_permission_allowed(text).
--
-- Base attesa: Staff v2.8F.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;

  if to_regprocedure('public.premium_staff_permission_allowed(text)') is null then
    raise exception 'premium_staff_permission_allowed_missing';
  end if;

  if to_regprocedure('public.premium_staff_permission_known(text)') is null then
    raise exception 'premium_staff_permission_known_missing';
  end if;

  if to_regprocedure('public.premium_staff_permission_admin_configurable(text)') is null then
    raise exception 'premium_staff_permission_admin_configurable_missing';
  end if;

  if to_regprocedure('public.premium_staff_permission_default_for_role(text,text)') is null then
    raise exception 'premium_staff_permission_default_for_role_missing';
  end if;

  if to_regprocedure('public.premium_staff_can_manage_complimentary()') is null then
    raise exception 'premium_staff_can_manage_complimentary_missing';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper MFA centrale.
-- JWT senza claim aal viene trattato come AAL1 e quindi NON soddisfa MFA.
-- ---------------------------------------------------------------------------
create or replace function public.premium_staff_mfa_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2';
$$;

revoke all on function public.premium_staff_mfa_verified()
from public, anon;

grant execute on function public.premium_staff_mfa_verified()
to authenticated, service_role;

comment on function public.premium_staff_mfa_verified() is
  'Staff v2.8G1: true solo per sessione Supabase elevata ad AAL2 tramite MFA.';

-- ---------------------------------------------------------------------------
-- Helper autorevole dei permessi Staff.
-- La membership/ruolo puo' ancora essere identificata a AAL1 per completare
-- il challenge MFA, ma NESSUN permesso operativo viene concesso prima di AAL2.
-- ---------------------------------------------------------------------------
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

  -- Fail closed: password sola (AAL1), token legacy o claim assente => nessun
  -- permesso Staff operativo.
  if not public.premium_staff_mfa_verified() then
    return false;
  end if;

  if not public.premium_staff_permission_known(v_key) then
    return false;
  end if;

  -- L'Owner e' sempre full SOLO dopo MFA.
  if v_role = 'owner' then
    return true;
  end if;

  -- Governance dedicata V2.5A: resta l'unica fonte di verita', ma solo AAL2.
  if v_key = 'manage_complimentary' then
    return public.premium_staff_can_manage_complimentary();
  end if;

  -- Profilo tecnico fisso: nessun override puo' ampliarlo.
  if v_role in ('technician', 'reviewer') then
    return public.premium_staff_permission_default_for_role(v_role, v_key);
  end if;

  if v_role <> 'admin' then
    return false;
  end if;

  -- Gli Owner-only e i permessi speciali non sono delegabili all'Admin.
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

  -- Default-deny Admin.
  return public.premium_staff_permission_default_for_role(v_role, v_key);
end;
$$;

revoke all on function public.premium_staff_permission_allowed(text)
from public, anon;

grant execute on function public.premium_staff_permission_allowed(text)
to authenticated, service_role;

comment on function public.premium_staff_permission_allowed(text) is
  'Staff v2.8G1: matrice permessi Staff con enforcement MFA AAL2 centrale.';

commit;
