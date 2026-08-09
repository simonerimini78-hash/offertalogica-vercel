-- OffertaLogica Staff v2.3B1 - verifica non distruttiva.

-- 1) Le due funzioni di gestione devono esistere.
select
  to_regprocedure('public.premium_owner_add_staff(text,text)') as add_staff_rpc,
  to_regprocedure('public.premium_owner_update_staff(uuid,text,boolean)') as update_staff_rpc;

-- 2) Mostra le definizioni per verificare Owner-only e protezione Owner.
select pg_get_functiondef('public.premium_owner_add_staff(text,text)'::regprocedure) as add_staff_definition;
select pg_get_functiondef('public.premium_owner_update_staff(uuid,text,boolean)'::regprocedure) as update_staff_definition;

-- 3) Stato attuale: l'Owner deve restare invariato.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active,
  staff.created_at,
  staff.updated_at
from public.premium_staff_members as staff
left join auth.users as auth_user on auth_user.id = staff.user_id
order by
  case staff.role when 'owner' then 1 when 'admin' then 2 when 'technician' then 3 else 9 end,
  auth_user.email nulls last;
