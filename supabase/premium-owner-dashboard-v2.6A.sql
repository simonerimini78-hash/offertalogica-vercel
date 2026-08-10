-- OffertaLogica Staff v2.6A
-- Fondazione Dashboard Owner: metriche aggregate Premium/Staff.
-- Base verificata: staff-v2-control-center @ 37887ea1e9d85643384f78db5cd2ced8c2fe7782 (Staff-v2.5B).
--
-- Principi:
--   - lettura esclusivamente Owner;
--   - nessun dato personale o contenuto cliente restituito;
--   - conteggi calcolati lato database, senza limiti UI 100/250/500;
--   - nessuna metrica di entrata economica non supportata da dati autorevoli;
--   - costi mostrati solo se già registrati/derivati dalle tabelle esistenti;
--   - nessuna modifica alle tabelle o ai flussi Premium esistenti.

begin;

do $$
declare
  v_required text;
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;

  foreach v_required in array array[
    'public.premium_profiles',
    'public.premium_subscriptions',
    'public.premium_utilities',
    'public.premium_bills',
    'public.premium_checks',
    'public.premium_anomalies',
    'public.premium_analysis_runs',
    'public.premium_cost_events',
    'public.premium_communications',
    'public.premium_complimentary_events',
    'public.premium_staff_members',
    'public.premium_staff_complimentary_permissions',
    'public.premium_staff_audit_events'
  ]
  loop
    if to_regclass(v_required) is null then
      raise exception 'premium_owner_dashboard_dependency_missing:%', v_required;
    end if;
  end loop;
end;
$$;

create or replace function public.premium_owner_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_since_7d timestamptz := v_now - interval '7 days';
  v_since_30d timestamptz := v_now - interval '30 days';
  v_result jsonb;
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;

  with latest_subscription as (
    select distinct on (subscription.user_id)
      subscription.id,
      subscription.user_id,
      subscription.status,
      subscription.plan_code,
      subscription.provider,
      subscription.provider_subscription_id,
      subscription.current_period_end,
      subscription.archive_access_until,
      subscription.cancel_at_period_end
    from public.premium_subscriptions subscription
    order by
      subscription.user_id,
      subscription.created_at desc,
      subscription.id desc
  ),
  customer_stats as (
    select
      count(*)::bigint as total,
      count(*) filter (where profile.account_status = 'active')::bigint as active,
      count(*) filter (where profile.account_status = 'suspended')::bigint as suspended,
      count(*) filter (where profile.account_status = 'deletion_requested')::bigint as deletion_requested,
      count(*) filter (where profile.created_at >= v_since_7d)::bigint as new_7d,
      count(*) filter (where profile.created_at >= v_since_30d)::bigint as new_30d
    from public.premium_profiles profile
  ),
  subscription_stats as (
    select
      count(*) filter (
        where subscription.provider = 'stripe'
          and coalesce(subscription.provider_subscription_id, '') <> ''
          and subscription.status = 'active'
      )::bigint as paid_active,
      count(*) filter (
        where subscription.provider = 'stripe'
          and coalesce(subscription.provider_subscription_id, '') <> ''
          and subscription.status in ('past_due', 'paused')
      )::bigint as paid_attention,
      count(*) filter (
        where subscription.plan_code = 'premium-beta'
          and subscription.provider = 'offertalogica-beta'
          and subscription.status = 'trialing'
          and (
            subscription.current_period_end is null
            or subscription.current_period_end > v_now
          )
      )::bigint as trial_active,
      count(*) filter (
        where subscription.plan_code = 'premium-complimentary'
          and subscription.provider = 'offertalogica-complimentary'
          and subscription.status = 'active'
          and (
            subscription.current_period_end is null
            or subscription.current_period_end > v_now
          )
      )::bigint as complimentary_active,
      count(*) filter (
        where subscription.plan_code = 'premium-complimentary'
          and subscription.provider = 'offertalogica-complimentary'
          and subscription.status = 'active'
          and subscription.current_period_end is null
      )::bigint as complimentary_unlimited,
      count(*) filter (
        where subscription.status in ('expired', 'canceled')
          and subscription.archive_access_until is not null
          and subscription.archive_access_until > v_now
      )::bigint as read_only_archive,
      count(*) filter (
        where subscription.provider = 'stripe'
          and coalesce(subscription.provider_subscription_id, '') <> ''
          and subscription.cancel_at_period_end = true
      )::bigint as cancel_at_period_end
    from latest_subscription subscription
  ),
  utility_stats as (
    select
      count(*) filter (where utility.status = 'active')::bigint as active
    from public.premium_utilities utility
  ),
  bill_stats as (
    select
      count(*) filter (where bill.deleted_at is null)::bigint as total,
      count(*) filter (
        where bill.deleted_at is null
          and bill.created_at >= v_since_7d
      )::bigint as new_7d,
      count(*) filter (
        where bill.deleted_at is null
          and bill.created_at >= v_since_30d
      )::bigint as new_30d,
      count(*) filter (
        where bill.deleted_at is null
          and bill.processing_status = 'failed'
      )::bigint as failed_current,
      count(*) filter (
        where bill.deleted_at is null
          and bill.customer_status in ('awaiting_review', 'in_review', 'more_info_required')
      )::bigint as pending_customer_state
    from public.premium_bills bill
  ),
  check_stats as (
    select
      count(*) filter (
        where check_row.status not in ('completed', 'canceled')
      )::bigint as open,
      count(*) filter (
        where check_row.status = 'completed'
          and check_row.completed_at >= v_since_7d
      )::bigint as completed_7d,
      count(*) filter (
        where check_row.status = 'completed'
          and check_row.completed_at >= v_since_30d
      )::bigint as completed_30d,
      count(*) filter (
        where check_row.status = 'completed'
          and check_row.completed_at >= v_since_30d
          and check_row.outcome = 'anomaly'
      )::bigint as anomaly_30d,
      count(*) filter (
        where check_row.status = 'completed'
          and check_row.completed_at >= v_since_30d
          and check_row.outcome = 'possible_saving'
      )::bigint as possible_saving_30d,
      coalesce(sum(check_row.human_seconds) filter (
        where check_row.completed_at >= v_since_30d
      ), 0)::bigint as human_seconds_30d
    from public.premium_checks check_row
  ),
  anomaly_stats as (
    select
      count(*) filter (
        where anomaly.status in ('open', 'acknowledged')
      )::bigint as open,
      count(*) filter (
        where anomaly.status in ('open', 'acknowledged')
          and anomaly.severity in ('high', 'critical')
      )::bigint as high_critical_open,
      count(*) filter (
        where anomaly.created_at >= v_since_30d
      )::bigint as created_30d
    from public.premium_anomalies anomaly
  ),
  support_stats as (
    select
      count(*) filter (
        where communication.direction = 'user_to_staff'
          and communication.read_at is null
      )::bigint as unread_messages
    from public.premium_communications communication
  ),
  ai_stats as (
    select
      count(*) filter (
        where run.created_at >= v_since_30d
      )::bigint as runs_30d,
      count(*) filter (
        where run.created_at >= v_since_30d
          and run.status = 'failed'
      )::bigint as failed_30d,
      coalesce(sum(run.estimated_cost_eur) filter (
        where run.created_at >= v_since_30d
      ), 0)::numeric(18, 6) as estimated_cost_eur_30d,
      coalesce(sum(
        coalesce(run.input_tokens, 0) + coalesce(run.output_tokens, 0)
      ) filter (
        where run.created_at >= v_since_30d
      ), 0)::bigint as tokens_30d
    from public.premium_analysis_runs run
  ),
  recorded_cost_stats as (
    select
      coalesce(sum(cost.cost_eur) filter (
        where cost.occurred_at >= v_since_30d
      ), 0)::numeric(18, 6) as total_eur_30d
    from public.premium_cost_events cost
  ),
  complimentary_stats as (
    select
      count(*) filter (
        where event.created_at >= v_since_30d
      )::bigint as events_30d,
      count(*) filter (
        where event.created_at >= v_since_30d
          and event.action = 'grant'
      )::bigint as grants_30d,
      count(*) filter (
        where event.created_at >= v_since_30d
          and event.action = 'extend'
      )::bigint as extends_30d,
      count(*) filter (
        where event.created_at >= v_since_30d
          and event.action = 'revoke'
      )::bigint as revokes_30d
    from public.premium_complimentary_events event
  ),
  staff_stats as (
    select
      count(*) filter (where staff.active = true)::bigint as active_total,
      count(*) filter (
        where staff.active = true
          and staff.role = 'admin'
      )::bigint as admins_active,
      count(*) filter (
        where staff.active = true
          and staff.role = 'technician'
      )::bigint as technicians_active
    from public.premium_staff_members staff
  ),
  complimentary_permission_stats as (
    select
      count(*)::bigint as admins_authorized
    from public.premium_staff_complimentary_permissions permission_record
    join public.premium_staff_members staff
      on staff.user_id = permission_record.staff_user_id
    where staff.active = true
      and staff.role = 'admin'
      and permission_record.allowed = true
  ),
  audit_stats as (
    select
      count(*) filter (
        where audit.created_at >= v_since_30d
      )::bigint as events_30d,
      count(*) filter (
        where audit.created_at >= v_since_30d
          and audit.result = 'error'
      )::bigint as errors_30d,
      count(*) filter (
        where audit.created_at >= v_since_30d
          and audit.result = 'denied'
      )::bigint as denied_30d
    from public.premium_staff_audit_events audit
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'window_days', 30,
    'customers', jsonb_build_object(
      'total', customer_stats.total,
      'active', customer_stats.active,
      'suspended', customer_stats.suspended,
      'deletion_requested', customer_stats.deletion_requested,
      'new_7d', customer_stats.new_7d,
      'new_30d', customer_stats.new_30d
    ),
    'subscriptions', jsonb_build_object(
      'paid_active', subscription_stats.paid_active,
      'paid_attention', subscription_stats.paid_attention,
      'trial_active', subscription_stats.trial_active,
      'complimentary_active', subscription_stats.complimentary_active,
      'complimentary_unlimited', subscription_stats.complimentary_unlimited,
      'read_only_archive', subscription_stats.read_only_archive,
      'cancel_at_period_end', subscription_stats.cancel_at_period_end
    ),
    'operations', jsonb_build_object(
      'utilities_active', utility_stats.active,
      'bills_total', bill_stats.total,
      'bills_new_7d', bill_stats.new_7d,
      'bills_new_30d', bill_stats.new_30d,
      'bills_failed_current', bill_stats.failed_current,
      'bills_pending_customer_state', bill_stats.pending_customer_state,
      'checks_open', check_stats.open,
      'checks_completed_7d', check_stats.completed_7d,
      'checks_completed_30d', check_stats.completed_30d,
      'checks_anomaly_30d', check_stats.anomaly_30d,
      'checks_possible_saving_30d', check_stats.possible_saving_30d,
      'anomalies_open', anomaly_stats.open,
      'anomalies_high_critical_open', anomaly_stats.high_critical_open,
      'anomalies_created_30d', anomaly_stats.created_30d,
      'support_unread_messages', support_stats.unread_messages
    ),
    'costs', jsonb_build_object(
      'ai_runs_30d', ai_stats.runs_30d,
      'ai_failed_30d', ai_stats.failed_30d,
      'ai_tokens_30d', ai_stats.tokens_30d,
      'ai_estimated_cost_eur_30d', ai_stats.estimated_cost_eur_30d,
      'recorded_cost_eur_30d', recorded_cost_stats.total_eur_30d,
      'human_seconds_30d', check_stats.human_seconds_30d
    ),
    'complimentary', jsonb_build_object(
      'events_30d', complimentary_stats.events_30d,
      'grants_30d', complimentary_stats.grants_30d,
      'extends_30d', complimentary_stats.extends_30d,
      'revokes_30d', complimentary_stats.revokes_30d
    ),
    'staff', jsonb_build_object(
      'active_total', staff_stats.active_total,
      'admins_active', staff_stats.admins_active,
      'technicians_active', staff_stats.technicians_active,
      'admins_complimentary_authorized', complimentary_permission_stats.admins_authorized
    ),
    'governance', jsonb_build_object(
      'audit_events_30d', audit_stats.events_30d,
      'audit_errors_30d', audit_stats.errors_30d,
      'audit_denied_30d', audit_stats.denied_30d
    )
  )
  into v_result
  from customer_stats
  cross join subscription_stats
  cross join utility_stats
  cross join bill_stats
  cross join check_stats
  cross join anomaly_stats
  cross join support_stats
  cross join ai_stats
  cross join recorded_cost_stats
  cross join complimentary_stats
  cross join staff_stats
  cross join complimentary_permission_stats
  cross join audit_stats;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.premium_owner_dashboard_metrics()
from public, anon;
grant execute on function public.premium_owner_dashboard_metrics()
to authenticated, service_role;

comment on function public.premium_owner_dashboard_metrics() is
  'Staff v2.6A: riepilogo aggregato Owner-only. Nessun dato personale; nessuna stima di entrate.';

commit;
