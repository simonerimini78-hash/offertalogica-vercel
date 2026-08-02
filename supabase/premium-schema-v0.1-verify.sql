-- OffertaLogica Premium - controlli non distruttivi dopo l'esecuzione dello schema v0.1

-- 1. Tabelle Premium presenti
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'premium_%'
order by table_name;

-- 2. RLS attiva su tutte le tabelle Premium
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename like 'premium_%'
order by tablename;

-- 3. Policy Premium presenti
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename like 'premium_%')
   or (schemaname = 'storage' and policyname like 'premium_%')
order by schemaname, tablename, policyname;

-- 4. Bucket Premium privato e separato dall'archivio diagnostico
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('premium-bills', 'pdf-test-archive')
order by id;

-- 5. Nessun privilegio anon sulle tabelle Premium
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'premium_%'
  and grantee = 'anon'
order by table_name, privilege_type;

-- 6. Quantita iniziali; premium_profiles puo contenere utenti Auth gia esistenti
select 'premium_profiles' as resource, count(*) as rows from public.premium_profiles
union all select 'premium_subscriptions', count(*) from public.premium_subscriptions
union all select 'premium_utilities', count(*) from public.premium_utilities
union all select 'premium_bills', count(*) from public.premium_bills
union all select 'premium_checks', count(*) from public.premium_checks
union all select 'premium_cost_events', count(*) from public.premium_cost_events;
