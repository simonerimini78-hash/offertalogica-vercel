-- OffertaLogica Staff v2.8F — rollback RLS/Supporto.
-- Ripristina le policy Staff legacy immediatamente precedenti alla chiusura V2.8F.
-- Non modifica le policy cliente.

begin;

-- Membership legacy: self oppure Admin/Owner compatibile.
drop policy if exists premium_staff_self_select on public.premium_staff_members;
create policy premium_staff_self_select
on public.premium_staff_members for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.premium_is_staff(array['admin']))
);

-- Ripristino letture/superfici legacy per ruolo.
drop policy if exists premium_profiles_staff_select on public.premium_profiles;
create policy premium_profiles_staff_select on public.premium_profiles for select to authenticated
using ((select public.premium_is_staff()));

drop policy if exists premium_subscriptions_staff_select on public.premium_subscriptions;
create policy premium_subscriptions_staff_all on public.premium_subscriptions for all to authenticated
using ((select public.premium_is_staff())) with check ((select public.premium_is_staff()));

drop policy if exists premium_utilities_staff_select on public.premium_utilities;
create policy premium_utilities_staff_all on public.premium_utilities for all to authenticated
using ((select public.premium_is_staff())) with check ((select public.premium_is_staff()));

drop policy if exists premium_contracts_staff_select on public.premium_contracts;
create policy premium_contracts_staff_all on public.premium_contracts for all to authenticated
using ((select public.premium_is_staff())) with check ((select public.premium_is_staff()));

drop policy if exists premium_bills_staff_select on public.premium_bills;
create policy premium_bills_staff_select on public.premium_bills for select to authenticated
using (
  (select public.premium_is_staff(array['reviewer','admin']))
  and deleted_at is null
  and exists (
    select 1 from public.premium_checks check_record
    where check_record.bill_id = premium_bills.id
      and check_record.user_id = premium_bills.user_id
      and check_record.status <> 'canceled'
  )
);
create policy premium_bills_admin_delete on public.premium_bills for delete to authenticated
using ((select public.premium_is_staff(array['admin'])));

drop policy if exists premium_bills_storage_staff_select on storage.objects;
create policy premium_bills_storage_staff_select on storage.objects for select to authenticated
using (
  bucket_id='premium-bills'
  and (select public.premium_is_staff(array['reviewer','admin']))
  and exists (
    select 1 from public.premium_bills bill
    join public.premium_checks check_record on check_record.bill_id=bill.id and check_record.user_id=bill.user_id
    where bill.storage_path=storage.objects.name and bill.deleted_at is null and check_record.status <> 'canceled'
  )
);
drop policy if exists premium_bills_storage_staff_delete on storage.objects;
create policy premium_bills_storage_admin_delete on storage.objects for delete to authenticated
using (
  bucket_id='premium-bills'
  and (select public.premium_is_staff(array['admin']))
  and exists (select 1 from public.premium_bills bill where bill.storage_path=storage.objects.name and bill.deleted_at is null)
);

drop policy if exists premium_analysis_runs_staff_select on public.premium_analysis_runs;
create policy premium_analysis_runs_staff_all on public.premium_analysis_runs for all to authenticated
using ((select public.premium_is_staff())) with check ((select public.premium_is_staff()));

drop policy if exists premium_checks_staff_select on public.premium_checks;
create policy premium_checks_staff_all on public.premium_checks for all to authenticated
using ((select public.premium_is_staff())) with check ((select public.premium_is_staff()));

drop policy if exists premium_check_notes_staff_select on public.premium_check_notes;
create policy premium_check_notes_staff_select on public.premium_check_notes for select to authenticated
using ((select public.premium_is_staff(array['reviewer','admin'])));

drop policy if exists premium_anomalies_staff_select on public.premium_anomalies;
create policy premium_anomalies_staff_all on public.premium_anomalies for all to authenticated
using ((select public.premium_is_staff())) with check ((select public.premium_is_staff()));

drop policy if exists premium_analysis_field_reviews_staff_select on public.premium_analysis_field_reviews;
create policy premium_analysis_field_reviews_staff_all on public.premium_analysis_field_reviews for all to authenticated
using ((select public.premium_is_staff(array['reviewer','admin'])))
with check ((select public.premium_is_staff(array['reviewer','admin'])));

drop policy if exists premium_communications_staff_select on public.premium_communications;
drop policy if exists premium_communications_staff_insert on public.premium_communications;
drop policy if exists premium_communications_staff_update on public.premium_communications;
drop policy if exists premium_communications_staff_delete on public.premium_communications;
create policy premium_communications_staff_all on public.premium_communications for all to authenticated
using ((select public.premium_is_staff())) with check ((select public.premium_is_staff()));
create policy premium_communications_staff_delete on public.premium_communications for delete to authenticated
using ((select public.premium_is_staff(array['support','admin'])));

drop policy if exists premium_consents_staff_select on public.premium_consents;
create policy premium_consents_staff_select on public.premium_consents for select to authenticated
using ((select public.premium_is_staff()));

drop policy if exists premium_cost_events_staff_select on public.premium_cost_events;
create policy premium_cost_events_staff_all on public.premium_cost_events for all to authenticated
using ((select public.premium_is_staff())) with check ((select public.premium_is_staff()));

create or replace function public.premium_staff_account_support_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not (select public.premium_is_staff()) then raise exception 'premium_staff_required'; end if;
  select jsonb_build_object(
    'user_id', users.id,
    'email', users.email,
    'email_confirmed', users.email_confirmed_at is not null,
    'email_confirmed_at', users.email_confirmed_at,
    'last_sign_in_at', users.last_sign_in_at,
    'auth_created_at', users.created_at,
    'profile_status', profiles.account_status,
    'subscription_status', subscriptions.status,
    'subscription_plan', subscriptions.plan_code,
    'subscription_period_end', subscriptions.current_period_end
  ) into v_result
  from auth.users users
  left join public.premium_profiles profiles on profiles.id=users.id
  left join lateral (
    select subscription.status, subscription.plan_code, subscription.current_period_end
    from public.premium_subscriptions subscription
    where subscription.user_id=users.id order by subscription.created_at desc limit 1
  ) subscriptions on true
  where users.id=p_user_id;
  if v_result is null then raise exception 'premium_account_not_found'; end if;
  return v_result;
end;
$$;
revoke all on function public.premium_staff_account_support_snapshot(uuid) from public, anon;
grant execute on function public.premium_staff_account_support_snapshot(uuid) to authenticated, service_role;


create or replace function public.premium_staff_delete_records(p_resource text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.premium_staff_permission_allowed('delete_records') then
    raise exception 'premium_staff_permission_required:delete_records' using errcode = '42501';
  end if;
  return public.premium_staff_delete_records_v28c1_legacy(p_resource, p_ids);
end;
$$;

create or replace function public.premium_staff_complete_account_deletion(p_user_id uuid, p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.premium_staff_permission_allowed('delete_records') then
    raise exception 'premium_staff_permission_required:delete_records' using errcode = '42501';
  end if;
  return public.premium_staff_complete_account_deletion_v28c1_legacy(p_user_id, p_confirmation);
end;
$$;

commit;
