-- Rollback OffertaLogica Security Step 6B3A / Staff v2.8G2
-- Ripristina soltanto premium_staff_raw_role() alla definizione pre-G2.
-- NON rimuove lo Step 6B2 / v2.8G1.

begin;

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
  limit 1;
$$;

revoke all on function public.premium_staff_raw_role()
from public, anon;

grant execute on function public.premium_staff_raw_role()
to authenticated, service_role;

comment on function public.premium_staff_raw_role() is
  'Staff v2.2B3: restituisce il ruolo Staff reale salvato, senza normalizzazione legacy.';

commit;
