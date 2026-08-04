select case
  when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'premium_subscriptions' and column_name = 'first_paid_at'
  )
   and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'premium_subscriptions' and column_name = 'intro_price_redeemed_at'
  )
   and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'premium_subscriptions' and column_name = 'first_payment_intent_id'
  )
   and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'premium_subscriptions' and column_name = 'latest_amount_paid_cents'
  )
   and to_regclass('public.premium_checkout_sessions') is not null
   and to_regclass('public.premium_payment_events') is not null
   and not has_table_privilege('authenticated', 'public.premium_checkout_sessions', 'SELECT')
   and not has_table_privilege('authenticated', 'public.premium_payment_events', 'SELECT')
   and has_table_privilege('service_role', 'public.premium_checkout_sessions', 'SELECT,INSERT,UPDATE,DELETE')
   and has_table_privilege('service_role', 'public.premium_payment_events', 'SELECT,INSERT,UPDATE,DELETE')
  then 'premium_stripe_billing_v0.36.9_ok'
  else 'premium_stripe_billing_v0.36.9_error'
end as result;
