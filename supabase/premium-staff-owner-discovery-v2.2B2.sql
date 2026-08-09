-- OffertaLogica Staff v2.2B2 - identificazione Proprietario
-- SOLA LETTURA: non modifica utenti, ruoli, vincoli o funzioni.
-- Eseguire in Supabase SQL Editor dopo V2.2B1.

-- 1) Elenco completo dei membri Staff con email Auth associata.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active,
  staff.created_at,
  staff.updated_at
from public.premium_staff_members as staff
left join auth.users as auth_user
  on auth_user.id = staff.user_id
order by
  staff.active desc,
  staff.role,
  auth_user.email nulls last,
  staff.user_id;

-- 2) Candidati attivi attualmente Admin.
-- Nello stato verificato prima di B2 ci aspettiamo una sola riga.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active
from public.premium_staff_members as staff
left join auth.users as auth_user
  on auth_user.id = staff.user_id
where staff.active = true
  and staff.role = 'admin'
order by auth_user.email nulls last, staff.user_id;
