-- OffertaLogica Staff v2.3A - verifica non distruttiva.

-- 1) Definizione RPC: deve controllare premium_staff_raw_role() = owner.
select pg_get_functiondef('public.premium_owner_list_staff()'::regprocedure) as premium_owner_list_staff_definition;

-- 2) Stato reale dei membri: v2.3A non modifica nessuna riga.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active,
  staff.created_at,
  staff.updated_at
from public.premium_staff_members staff
left join auth.users auth_user on auth_user.id = staff.user_id
order by staff.created_at;

-- 3) Test della RPC come Owner identificato in v2.2B2.
-- Il blocco e' locale alla transazione e viene annullato dal rollback.
begin;
select set_config('request.jwt.claim.sub', '9e81ab10-22ff-4c62-bf23-fbec1aa5af67', true);
select * from public.premium_owner_list_staff();
rollback;
