with checks as (
  select 'current_acceptances_terms_version' as check_name,
    pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure)
      like '%premium-terms-v0.36.20-2026-08-06%' as ok
  union all
  select 'accept_rpc_terms_version',
    pg_get_functiondef('public.premium_accept_current_terms(jsonb)'::regprocedure)
      like '%premium-terms-v0.36.20-2026-08-06%'
  union all
  select 'signup_trigger_terms_version',
    pg_get_functiondef('public.premium_handle_new_user()'::regprocedure)
      like '%premium-terms-v0.36.20-2026-08-06%'
  union all
  select 'consent_proof_terms_version',
    pg_get_functiondef('public.premium_prepare_legal_consent()'::regprocedure)
      like '%premium-terms-v0.36.20-2026-08-06%'
  union all
  select 'insert_policy_terms_version',
    exists (
      select 1
      from pg_policies policy_record
      where policy_record.schemaname = 'public'
        and policy_record.tablename = 'premium_consents'
        and policy_record.policyname = 'premium_consents_owner_insert'
        and policy_record.with_check like '%premium-terms-v0.36.20-2026-08-06%'
    )
  union all
  select 'privacy_version_unchanged',
    pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure)
      like '%premium-privacy-v0.36.6-2026-08-04%'
  union all
  select 'cloud_version_unchanged',
    pg_get_functiondef('public.premium_has_current_acceptances()'::regprocedure)
      like '%premium-cloud-ai-v0.36.6-2026-08-04%'
)
select
  bool_and(ok) as premium_commercial_terms_v0_36_20_ok,
  jsonb_object_agg(check_name, ok order by check_name) as checks
from checks;
