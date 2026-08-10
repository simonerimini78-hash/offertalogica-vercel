-- OffertaLogica Staff v2.5A - rollback
-- Ripristina l'esposizione diretta delle RPC Premium v0.36.13.
-- Non modifica dati Premium/Trial. Rimuove soltanto governance e permessi v2.5A.
-- ATTENZIONE: eventuali righe di permesso Admin create dopo v2.5A vengono eliminate.

begin;

drop function if exists public.premium_admin_set_complimentary(uuid,text,text);
drop function if exists public.premium_admin_revoke_complimentary(uuid,text);

alter function public.premium_internal_set_complimentary_v03613(uuid,text,text)
  rename to premium_admin_set_complimentary;
alter function public.premium_internal_revoke_complimentary_v03613(uuid,text)
  rename to premium_admin_revoke_complimentary;

revoke all on function public.premium_admin_set_complimentary(uuid,text,text)
from public, anon;
grant execute on function public.premium_admin_set_complimentary(uuid,text,text)
to authenticated, service_role;

revoke all on function public.premium_admin_revoke_complimentary(uuid,text)
from public, anon;
grant execute on function public.premium_admin_revoke_complimentary(uuid,text)
to authenticated, service_role;

comment on function public.premium_admin_set_complimentary(uuid,text,text) is
  'Motore Premium omaggio v0.36.13 ripristinato dal rollback Staff v2.5A.';
comment on function public.premium_admin_revoke_complimentary(uuid,text) is
  'Motore revoca Premium omaggio v0.36.13 ripristinato dal rollback Staff v2.5A.';

drop function if exists public.premium_owner_list_complimentary_permissions();
drop function if exists public.premium_owner_set_complimentary_permission(uuid,boolean,text);
drop function if exists public.premium_staff_can_manage_complimentary();
drop table if exists public.premium_staff_complimentary_permissions;

commit;
