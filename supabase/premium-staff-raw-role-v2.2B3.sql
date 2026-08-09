-- OffertaLogica Staff v2.2B3
-- Aggiunge un helper che restituisce il ruolo REALE salvato per lo Staff attivo.
-- Non modifica membri Staff, ruoli, vincoli o helper legacy A4.

begin;

-- Precondizione: B3 deve partire dallo schema B1/B2 con i cinque ruoli ammessi.
do $$
declare
  v_definition text;
begin
  select pg_get_constraintdef(c.oid)
    into v_definition
  from pg_constraint c
  where c.conrelid = 'public.premium_staff_members'::regclass
    and c.contype = 'c'
    and c.conname = 'premium_staff_members_role_check';

  if v_definition is null then
    raise exception 'premium_staff_role_constraint_missing';
  end if;

  if v_definition not like '%support%'
     or v_definition not like '%reviewer%'
     or v_definition not like '%technician%'
     or v_definition not like '%admin%'
     or v_definition not like '%owner%' then
    raise exception 'premium_staff_role_constraint_unexpected:%', v_definition;
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
  limit 1;
$$;

revoke all on function public.premium_staff_raw_role() from public, anon;
grant execute on function public.premium_staff_raw_role() to authenticated, service_role;

comment on function public.premium_staff_raw_role() is
  'Staff v2.2B3: restituisce il ruolo Staff reale salvato, senza normalizzazione legacy.';

commit;
