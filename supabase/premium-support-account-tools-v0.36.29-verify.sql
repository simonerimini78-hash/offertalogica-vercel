-- Verifica installazione strumenti staff account/accesso.
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'premium_staff_account_support_snapshot';

-- Risultato atteso:
-- premium_staff_account_support_snapshot | p_user_id uuid | true
