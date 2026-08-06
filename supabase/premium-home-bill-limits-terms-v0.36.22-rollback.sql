-- OFFERTALOGICA PREMIUM v0.36.22 — rollback dei soli limiti commerciali
-- Non ripristina automaticamente le accettazioni legali precedenti.
begin;
drop trigger if exists premium_apply_plan_limits_before_write on public.premium_subscriptions;
drop function if exists public.premium_apply_plan_limits();
update public.premium_subscriptions
set included_utilities = case when status='trialing' and plan_code='premium-beta' then 2 else 2 end,
    included_bills_per_year = case when status='trialing' and plan_code='premium-beta' then 4 else 1200 end,
    updated_at=now()
where status in ('trialing','active');
commit;
