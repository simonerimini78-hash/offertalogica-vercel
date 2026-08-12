-- OffertaLogica Staff v2.8A — rollback di emergenza
-- Rimuove soltanto la fondazione V2.8A.
-- Non tocca V2.5A Premium omaggio, ruoli, Audit, Timeline o funzioni operative.

begin;

drop function if exists public.premium_owner_list_staff_permission_matrix();
drop function if exists public.premium_owner_set_staff_permission(uuid,text,boolean,text);
drop function if exists public.premium_staff_effective_permissions();
drop function if exists public.premium_staff_permission_allowed(text);
drop function if exists public.premium_staff_permission_default_for_role(text,text);
drop function if exists public.premium_staff_permission_admin_configurable(text);
drop function if exists public.premium_staff_permission_known(text);
drop function if exists public.premium_staff_permission_catalog();
drop function if exists public.premium_staff_permission_catalog_internal();

drop table if exists public.premium_staff_permissions;

commit;
