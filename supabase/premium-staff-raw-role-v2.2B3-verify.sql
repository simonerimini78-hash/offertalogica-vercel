-- OffertaLogica Staff v2.2B3 - verifica non distruttiva
-- Eseguire DOPO premium-staff-raw-role-v2.2B3.sql.

-- 1) L'helper deve esistere e restituire il ruolo reale senza CASE di normalizzazione.
select pg_get_functiondef('public.premium_staff_raw_role()'::regprocedure) as premium_staff_raw_role_definition;

-- 2) Il membro Owner identificato in B2 deve essere ancora invariato.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active
from public.premium_staff_members staff
join auth.users auth_user on auth_user.id = staff.user_id
where staff.user_id = '9e81ab10-22ff-4c62-bf23-fbec1aa5af67'::uuid;

-- 3) Stato complessivo membri Staff: B3 non migra alcuna riga.
select role, active, count(*) as members
from public.premium_staff_members
group by role, active
order by role, active desc;

-- 4) Il CHECK B1 continua ad ammettere i cinque ruoli.
select
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.premium_staff_members'::regclass
  and c.contype = 'c'
  and c.conname = 'premium_staff_members_role_check';

-- 5) Gli helper legacy A4 devono essere rimasti invariati.
select
  pg_get_functiondef('public.premium_is_staff(text[])'::regprocedure) as premium_is_staff_definition,
  pg_get_functiondef('public.premium_staff_role()'::regprocedure) as premium_staff_role_definition;
