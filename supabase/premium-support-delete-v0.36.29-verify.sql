-- Verifica configurazione cancellazione richieste assistenza.

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'premium_communications'
  and grantee = 'authenticated'
order by privilege_type;

select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'premium_communications'
  and policyname in (
    'premium_communications_owner_delete_support',
    'premium_communications_staff_all'
  )
order by policyname;
