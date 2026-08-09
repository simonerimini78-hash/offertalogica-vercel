-- OffertaLogica Staff v2.2B2 - verifica non distruttiva
-- Eseguire DOPO premium-staff-owner-promote-v2.2B2.sql.

-- 1) Il target deve essere owner attivo e l'email deve essere quella identificata.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active,
  staff.updated_at
from public.premium_staff_members staff
join auth.users auth_user on auth_user.id = staff.user_id
where staff.user_id = '9e81ab10-22ff-4c62-bf23-fbec1aa5af67'::uuid;

-- 2) Nello stato attuale ci aspettiamo un solo owner attivo e nessun admin attivo.
select role, active, count(*) as members
from public.premium_staff_members
group by role, active
order by role, active desc;

-- 3) Il CHECK B1 deve continuare ad ammettere i cinque ruoli.
select
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.premium_staff_members'::regclass
  and c.contype = 'c'
  and c.conname = 'premium_staff_members_role_check';

-- 4) Gli helper A4 devono restare invariati: owner continua a ereditare i permessi legacy admin.
select
  pg_get_functiondef('public.premium_is_staff(text[])'::regprocedure) as premium_is_staff_definition,
  pg_get_functiondef('public.premium_staff_role()'::regprocedure) as premium_staff_role_definition;
