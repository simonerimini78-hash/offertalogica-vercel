-- OffertaLogica Staff v2.2B1
-- Estende SOLO il vincolo dei ruoli Staff.
-- Non modifica nessun membro Staff e non assegna owner/technician a nessun account.

begin;

-- Precondizione rigorosa: B1 deve partire dal vincolo legacy verificato in A4.
do $$
declare
  v_definition text;
begin
  select pg_get_constraintdef(constraint_record.oid)
    into v_definition
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.premium_staff_members'::regclass
    and constraint_record.contype = 'c'
    and constraint_record.conname = 'premium_staff_members_role_check';

  if v_definition is null then
    raise exception 'premium_staff_role_constraint_missing';
  end if;

  if v_definition not like '%support%'
     or v_definition not like '%reviewer%'
     or v_definition not like '%admin%'
     or v_definition like '%technician%'
     or v_definition like '%owner%' then
    raise exception 'premium_staff_role_constraint_unexpected:%', v_definition;
  end if;
end;
$$;

alter table public.premium_staff_members
  drop constraint premium_staff_members_role_check;

alter table public.premium_staff_members
  add constraint premium_staff_members_role_check
  check (role in ('support', 'reviewer', 'technician', 'admin', 'owner'));

comment on constraint premium_staff_members_role_check on public.premium_staff_members is
  'Staff v2 roles: support/reviewer legacy, technician, admin, owner. B1 does not migrate member rows.';

commit;
