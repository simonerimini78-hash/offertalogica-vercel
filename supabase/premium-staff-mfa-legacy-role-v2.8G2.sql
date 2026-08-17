-- OffertaLogica Security Step 6B3A / Staff v2.8G2
-- MFA enforcement sui percorsi DB Staff legacy che autorizzano tramite
-- premium_staff_raw_role().
--
-- Base attesa:
-- - Staff v2.8F
-- - Security Step 6B2 / v2.8G1 installato
--
-- Strategia:
-- premium_staff_raw_role() continua a essere la fonte del ruolo Staff reale,
-- ma restituisce un ruolo soltanto a sessioni Supabase AAL2.
--
-- Questo chiude in un unico punto anche le RPC legacy Owner/Admin che
-- controllano direttamente premium_staff_raw_role() invece della matrice
-- premium_staff_permission_allowed(text).
--
-- La lettura della PROPRIA membership premium_staff_members resta separata:
-- serve al flusso login -> enrollment/challenge MFA e non viene modificata.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;

  if to_regprocedure('public.premium_staff_mfa_verified()') is null then
    raise exception 'premium_staff_mfa_verified_missing';
  end if;

  if to_regclass('public.premium_staff_members') is null then
    raise exception 'premium_staff_members_missing';
  end if;
end;
$$;

create or replace function public.premium_staff_raw_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select staff.role
  from public.premium_staff_members staff
  where staff.user_id = (select auth.uid())
    and staff.active = true
    and staff.role in ('support', 'reviewer', 'technician', 'admin', 'owner')
    and public.premium_staff_mfa_verified()
  limit 1;
$$;

revoke all on function public.premium_staff_raw_role()
from public, anon;

grant execute on function public.premium_staff_raw_role()
to authenticated, service_role;

comment on function public.premium_staff_raw_role() is
  'Staff v2.8G2: ruolo Staff reale disponibile alle richieste utente solo dopo MFA AAL2; la membership self-select resta disponibile per completare il challenge MFA.';

commit;
