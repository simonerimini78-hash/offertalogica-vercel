-- OFFERTALOGICA PREMIUM v0.36.15 - verifica installazione
select case
  when to_regclass('public.premium_trial_bill_usage') is not null
   and to_regprocedure('public.premium_trial_bill_usage_count()') is not null
   and to_regprocedure('public.premium_reserve_trial_bill_upload(uuid)') is not null
   and to_regprocedure('public.premium_release_trial_bill_upload(uuid)') is not null
   and to_regprocedure('public.premium_mark_bill_upload_complete(uuid)') is not null
   and to_regprocedure('public.premium_release_uncommitted_bill_usage()') is not null
   and to_regprocedure('public.premium_can_add_bill(uuid,uuid)') is not null
   and pg_get_functiondef('public.premium_can_add_bill(uuid,uuid)'::regprocedure)
      like '%premium_trial_bill_usage%'
   and pg_get_functiondef('public.premium_reserve_trial_bill_upload(uuid)'::regprocedure)
      like '%premium_trial_bill_limit_reached%'
   and exists (
     select 1
     from pg_trigger trigger_record
     where trigger_record.tgname = 'premium_release_uncommitted_bill_usage_after_delete'
       and not trigger_record.tgisinternal
   )
   and exists (
     select 1
     from pg_policies
     where schemaname = 'public'
       and tablename = 'premium_bills'
       and policyname = 'premium_bills_owner_insert'
       and coalesce(with_check, '') ilike '%premium_can_add_bill%'
   )
  then 'premium_trial_bill_lifetime_limit_v0.36.15_ok'
  else 'premium_trial_bill_lifetime_limit_v0.36.15_incomplete'
end as verification_result;
