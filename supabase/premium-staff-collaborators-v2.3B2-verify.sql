-- OffertaLogica Staff v2.3B2 - verifica non distruttiva.
-- B2 non modifica lo schema: controlla che la base B1 e il Proprietario siano integri.

-- 1) Proprietario ancora protetto e attivo.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active
from public.premium_staff_members staff
join auth.users auth_user on auth_user.id = staff.user_id
where staff.role = 'owner';

-- 2) Le RPC di gestione B1 devono ancora esistere.
select
  to_regprocedure('public.premium_owner_list_staff()') is not null as list_staff_ok,
  to_regprocedure('public.premium_owner_add_staff(text,text)') is not null as add_staff_ok,
  to_regprocedure('public.premium_owner_update_staff(uuid,text,boolean)') is not null as update_staff_ok,
  to_regprocedure('public.premium_staff_raw_role()') is not null as raw_role_ok;

-- 3) Nessun ruolo salvato fuori dal set ammesso dalla fase V2.2B1.
select role, active, count(*) as members
from public.premium_staff_members
group by role, active
order by role, active desc;
