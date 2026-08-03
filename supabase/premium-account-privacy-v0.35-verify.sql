-- Verifica OffertaLogica Premium v0.35
select 'profile_deletion_columns_present' as check_name,
       count(*) = 2 as ok
from information_schema.columns
where table_schema = 'public'
  and table_name = 'premium_profiles'
  and column_name in ('deletion_requested_at', 'deletion_request_reason')
union all
select 'deletion_request_index_present',
       to_regclass('public.premium_profiles_deletion_requested_idx') is not null
union all
select 'current_acceptances_function_present',
       to_regprocedure('public.premium_has_current_acceptances()') is not null
union all
select 'accept_current_terms_function_present',
       to_regprocedure('public.premium_accept_current_terms(jsonb)') is not null
union all
select 'request_deletion_function_present',
       to_regprocedure('public.premium_request_account_deletion(text)') is not null
union all
select 'cancel_deletion_function_present',
       to_regprocedure('public.premium_cancel_account_deletion_request()') is not null
union all
select 'complete_account_deletion_function_present',
       to_regprocedure('public.premium_staff_complete_account_deletion(uuid,text)') is not null
union all
select 'service_access_requires_acceptances',
       pg_get_functiondef('public.premium_has_service_access()'::regprocedure) like '%premium_has_current_acceptances%'
union all
select 'profile_access_kept_during_deletion_request',
       pg_get_functiondef('public.premium_has_profile()'::regprocedure) like '%deletion_requested%'
union all
select 'signup_trigger_records_versions',
       pg_get_functiondef('public.premium_handle_new_user()'::regprocedure) like '%premium-terms-v0.35-2026-08-03%'
       and pg_get_functiondef('public.premium_handle_new_user()'::regprocedure) like '%premium-privacy-v0.35-2026-08-03%'
       and pg_get_functiondef('public.premium_handle_new_user()'::regprocedure) like '%premium-cloud-ai-v0.35-2026-08-03%'
union all
select 'account_delete_requires_request',
       pg_get_functiondef('public.premium_staff_complete_account_deletion(uuid,text)'::regprocedure) like '%premium_account_deletion_not_requested%'
union all
select 'account_delete_checks_storage_empty',
       pg_get_functiondef('public.premium_staff_complete_account_deletion(uuid,text)'::regprocedure) like '%premium_account_storage_not_empty%'
union all
select 'account_delete_blocks_active_staff',
       pg_get_functiondef('public.premium_staff_complete_account_deletion(uuid,text)'::regprocedure) like '%premium_staff_account_delete_blocked%'
union all
select 'authenticated_can_execute_account_functions',
       has_function_privilege('authenticated', 'public.premium_accept_current_terms(jsonb)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.premium_request_account_deletion(text)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.premium_cancel_account_deletion_request()', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.premium_staff_complete_account_deletion(uuid,text)', 'EXECUTE')
union all
select 'anon_cannot_execute_account_functions',
       not has_function_privilege('anon', 'public.premium_accept_current_terms(jsonb)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.premium_request_account_deletion(text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.premium_cancel_account_deletion_request()', 'EXECUTE')
       and not has_function_privilege('anon', 'public.premium_staff_complete_account_deletion(uuid,text)', 'EXECUTE');
