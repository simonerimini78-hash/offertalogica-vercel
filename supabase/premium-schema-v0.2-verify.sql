-- OffertaLogica Premium - controlli non distruttivi dopo l'esecuzione dello schema v0.2

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

-- 3. Funzioni di sicurezza presenti
select routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'premium_is_staff',
    'premium_has_profile',
    'premium_has_service_access',
    'premium_handle_new_user'
  )
order by routine_name;

-- 4. Trigger Auth Premium presente
select trigger_name, event_object_schema, event_object_table, action_timing, event_manipulation
from information_schema.triggers
where trigger_name = 'premium_on_auth_user_created';

-- 5. Policy Premium presenti
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename like 'premium_%')
   or (schemaname = 'storage' and policyname like 'premium_%')
order by schemaname, tablename, policyname;

-- 6. Bucket Premium privato e separato dall'archivio diagnostico
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('premium-bills', 'pdf-test-archive')
order by id;

-- 7. Nessun privilegio anon sulle tabelle Premium
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'premium_%'
  and grantee = 'anon'
order by table_name, privilege_type;

-- 8. Nessun utente Auth generico deve essere stato convertito automaticamente.
-- Un profilo e valido soltanto se l'utente Auth porta il marker Premium.
select
  p.id,
  u.email,
  u.raw_user_meta_data ->> 'offertalogica_product' as product_marker
from public.premium_profiles p
join auth.users u on u.id = p.id
where coalesce(u.raw_user_meta_data ->> 'offertalogica_product', '') <> 'premium';

-- 9. Quantita iniziali
select 'premium_profiles' as resource, count(*) as rows from public.premium_profiles
union all select 'premium_subscriptions', count(*) from public.premium_subscriptions
union all select 'premium_utilities', count(*) from public.premium_utilities
union all select 'premium_bills', count(*) from public.premium_bills
union all select 'premium_checks', count(*) from public.premium_checks
union all select 'premium_cost_events', count(*) from public.premium_cost_events;
