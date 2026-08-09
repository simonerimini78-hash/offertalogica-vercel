-- OffertaLogica Staff v2.2B1 - verifica non distruttiva
-- Eseguire DOPO premium-staff-role-schema-v2.2B1.sql.

-- 1) Il vincolo deve ora ammettere anche technician e owner.
select
  constraint_record.conname as constraint_name,
  pg_get_constraintdef(constraint_record.oid) as definition
from pg_constraint constraint_record
where constraint_record.conrelid = 'public.premium_staff_members'::regclass
  and constraint_record.contype = 'c'
  and constraint_record.conname = 'premium_staff_members_role_check';

-- 2) Nessun membro deve essere stato migrato da B1.
select role, active, count(*) as members
from public.premium_staff_members
group by role, active
order by role, active desc;

-- 3) Gli helper A4 devono restare presenti e continuare la compatibilita' legacy.
select
  pg_get_functiondef('public.premium_is_staff(text[])'::regprocedure) as premium_is_staff_definition,
  pg_get_functiondef('public.premium_staff_role()'::regprocedure) as premium_staff_role_definition;
