-- OffertaLogica Staff v2.2A4 - rollback dei SOLI helper di compatibilita'.
-- Non modifica dati, ruoli o vincoli della tabella premium_staff_members.

begin;

create or replace function public.premium_is_staff(
  allowed_roles text[] default array['support', 'reviewer', 'admin']::text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.premium_staff_members staff
    where staff.user_id = (select auth.uid())
      and staff.active = true
      and staff.role = any(allowed_roles)
  );
$$;

revoke all on function public.premium_is_staff(text[]) from public, anon;
grant execute on function public.premium_is_staff(text[]) to authenticated, service_role;

create or replace function public.premium_staff_role()
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
    and staff.role in ('reviewer', 'admin')
  limit 1;
$$;

revoke all on function public.premium_staff_role() from public, anon;
grant execute on function public.premium_staff_role() to authenticated, service_role;

comment on function public.premium_is_staff(text[]) is null;
comment on function public.premium_staff_role() is null;

commit;
