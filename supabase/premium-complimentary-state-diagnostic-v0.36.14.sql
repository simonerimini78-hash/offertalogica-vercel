-- OFFERTALOGICA PREMIUM v0.36.14
-- Diagnostica di sola lettura per prova gratuita e Premium omaggio.
-- Non modifica né elimina dati.

with latest_subscription as (
  select distinct on (subscription.user_id)
    subscription.*
  from public.premium_subscriptions subscription
  order by subscription.user_id, subscription.created_at desc
), event_summary as (
  select
    event.user_id,
    count(*) as event_count,
    max(event.created_at) as latest_event_at,
    (array_agg(event.action order by event.created_at desc))[1] as latest_action
  from public.premium_complimentary_events event
  group by event.user_id
)
select
  profile.email,
  profile.account_status,
  subscription.id as subscription_id,
  subscription.status,
  subscription.plan_code,
  subscription.provider,
  subscription.created_at,
  subscription.current_period_start,
  subscription.current_period_end,
  subscription.archive_access_until,
  subscription.complimentary_granted_at,
  subscription.complimentary_revoked_at,
  nullif(to_jsonb(subscription) ->> 'complimentary_restore_trial', '')::boolean
    as complimentary_restore_trial,
  nullif(to_jsonb(subscription) ->> 'complimentary_trial_remaining_seconds', '')::bigint
    as complimentary_trial_remaining_seconds,
  coalesce(events.event_count, 0) as complimentary_event_count,
  events.latest_action as latest_complimentary_action,
  events.latest_event_at as latest_complimentary_event_at,
  case
    when subscription.plan_code = 'premium-beta'
      and subscription.status = 'trialing'
      and subscription.complimentary_revoked_at is not null
      then 'trial_restored'
    when subscription.plan_code = 'premium-beta'
      and subscription.status = 'trialing'
      then 'trial_active'
    when subscription.plan_code = 'premium-complimentary'
      and subscription.status = 'active'
      and (subscription.current_period_end is null or subscription.current_period_end > now())
      then 'complimentary_active'
    when subscription.plan_code = 'premium-complimentary'
      and subscription.status = 'expired'
      and coalesce(nullif(to_jsonb(subscription) ->> 'complimentary_restore_trial', '')::boolean, false) = true
      and coalesce(nullif(to_jsonb(subscription) ->> 'complimentary_trial_remaining_seconds', '')::bigint, 0) > 0
      then 'trial_restore_pending'
    when subscription.plan_code = 'premium-complimentary'
      and subscription.status = 'expired'
      and subscription.complimentary_revoked_at is not null
      then 'complimentary_revoked_read_only'
    when subscription.plan_code = 'premium-complimentary'
      and subscription.status = 'expired'
      then 'complimentary_expired_read_only'
    when subscription.status = 'expired'
      and subscription.archive_access_until > now()
      then 'read_only'
    else 'other'
  end as diagnostic_state
from public.premium_profiles profile
left join latest_subscription subscription
  on subscription.user_id = profile.id
left join event_summary events
  on events.user_id = profile.id
where subscription.plan_code in ('premium-beta', 'premium-complimentary')
   or events.user_id is not null
order by profile.created_at desc;
