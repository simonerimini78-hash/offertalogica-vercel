-- OffertaLogica Staff v2.2A4 - verifica non distruttiva
-- Eseguire DOPO premium-staff-role-compat-v2.2A4.sql.

-- 1) Nessun dato viene modificato: mostra soltanto i ruoli attualmente presenti.
select role, active, count(*) as members
from public.premium_staff_members
group by role, active
order by role, active desc;

-- 2) Il vincolo ruolo deve essere ancora quello precedente alla migrazione V2.2B.
-- In V2.2A4 NON deve essere stato ampliato automaticamente.
select
  constraint_record.conname as constraint_name,
  pg_get_constraintdef(constraint_record.oid) as definition
from pg_constraint constraint_record
where constraint_record.conrelid = 'public.premium_staff_members'::regclass
  and constraint_record.contype = 'c'
order by constraint_record.conname;

-- 3) Le due definizioni devono contenere le normalizzazioni:
-- owner -> admin; technician -> reviewer.
select pg_get_functiondef('public.premium_is_staff(text[])'::regprocedure) as premium_is_staff_definition;
select pg_get_functiondef('public.premium_staff_role()'::regprocedure) as premium_staff_role_definition;

-- 4) Matrice attesa della normalizzazione (test puro, senza cambiare account).
with roles(role) as (
  values ('support'::text), ('reviewer'), ('technician'), ('admin'), ('owner')
)
select
  role as stored_role,
  case role
    when 'owner' then 'admin'
    when 'technician' then 'reviewer'
    else role
  end as legacy_authorization_role
from roles
order by case role
  when 'support' then 1
  when 'reviewer' then 2
  when 'technician' then 3
  when 'admin' then 4
  when 'owner' then 5
  else 99
end;
