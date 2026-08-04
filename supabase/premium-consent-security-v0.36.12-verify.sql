-- OFFERTALOGICA PREMIUM v0.36.12 — verifica sicurezza consensi

select case
  when to_regprocedure('public.premium_accept_current_terms(jsonb)') is not null
   and not (
     select procedure.prosecdef
     from pg_proc procedure
     where procedure.oid = 'public.premium_accept_current_terms(jsonb)'::regprocedure
   )
   and to_regprocedure('public.premium_has_current_acceptances()') is not null
   and not (
     select procedure.prosecdef
     from pg_proc procedure
     where procedure.oid = 'public.premium_has_current_acceptances()'::regprocedure
   )
   and to_regprocedure('public.premium_prepare_legal_consent()') is not null
   and not (
     select procedure.prosecdef
     from pg_proc procedure
     where procedure.oid = 'public.premium_prepare_legal_consent()'::regprocedure
   )
   and has_function_privilege(
     'authenticated',
     'public.premium_accept_current_terms(jsonb)',
     'EXECUTE'
   )
   and not has_function_privilege(
     'anon',
     'public.premium_accept_current_terms(jsonb)',
     'EXECUTE'
   )
   and has_column_privilege(
     'authenticated',
     'public.premium_consents',
     'consent_type',
     'INSERT'
   )
   and has_column_privilege(
     'authenticated',
     'public.premium_consents',
     'proof',
     'INSERT'
   )
   and not has_column_privilege(
     'authenticated',
     'public.premium_consents',
     'user_id',
     'INSERT'
   )
   and not has_column_privilege(
     'authenticated',
     'public.premium_consents',
     'recorded_at',
     'INSERT'
   )
   and not has_column_privilege(
     'authenticated',
     'public.premium_consents',
     'revoked_at',
     'INSERT'
   )
   and exists (
     select 1
     from pg_trigger trigger_record
     where trigger_record.tgrelid = 'public.premium_consents'::regclass
       and trigger_record.tgname = 'premium_prepare_legal_consent_before_insert'
       and not trigger_record.tgisinternal
       and trigger_record.tgenabled <> 'D'
   )
   and exists (
     select 1
     from pg_policies policy_record
     where policy_record.schemaname = 'public'
       and policy_record.tablename = 'premium_consents'
       and policy_record.policyname = 'premium_consents_owner_insert'
       and policy_record.roles::text like '%authenticated%'
       and policy_record.with_check like '%premium-terms-v0.36.7-2026-08-04%'
       and policy_record.with_check like '%premium-privacy-v0.36.6-2026-08-04%'
       and policy_record.with_check like '%premium-cloud-ai-v0.36.6-2026-08-04%'
   )
  then 'premium_consent_security_v0.36.12_ok'
  else 'premium_consent_security_v0.36.12_error'
end as result;
