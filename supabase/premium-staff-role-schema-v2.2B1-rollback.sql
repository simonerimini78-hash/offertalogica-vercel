-- OffertaLogica Staff v2.2B1 - rollback
-- Sicuro SOLO prima di assegnare realmente owner o technician.

begin;

do $$
begin
  if exists (
    select 1
    from public.premium_staff_members
    where role in ('owner', 'technician')
  ) then
    raise exception 'premium_staff_role_schema_rollback_blocked:new_roles_in_use';
  end if;
end;
$$;

alter table public.premium_staff_members
  drop constraint premium_staff_members_role_check;

alter table public.premium_staff_members
  add constraint premium_staff_members_role_check
  check (role in ('support', 'reviewer', 'admin'));

comment on constraint premium_staff_members_role_check on public.premium_staff_members is null;

commit;
