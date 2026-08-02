-- Verifica non distruttiva dell'incremento utenze Premium v0.24.

select
  to_regprocedure('public.premium_can_add_utility()') is not null as limit_function_present,
  has_function_privilege('authenticated', 'public.premium_can_add_utility()', 'EXECUTE') as authenticated_can_execute,
  not has_function_privilege('anon', 'public.premium_can_add_utility()', 'EXECUTE') as anon_cannot_execute,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_utilities'
      and policyname = 'premium_utilities_owner_insert'
      and cmd = 'INSERT'
      and with_check ilike '%premium_can_add_utility%'
  ) as insert_policy_enforces_limit;
