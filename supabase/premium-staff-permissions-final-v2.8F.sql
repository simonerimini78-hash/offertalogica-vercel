-- OffertaLogica Staff v2.8F — chiusura matrice permessi: RLS + supporto.
-- Base verificata: staff-v2-control-center @ 3511121aa20df7d977dd5879b1a3b34d49f8996b
-- Presupposti: V2.8A + V2.8C1 installate.
-- Sostituisce soltanto policy Staff note; le policy del cliente restano intatte.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_permission_allowed(text)') is null then
    raise exception 'premium_staff_permission_allowed_missing';
  end if;
  if to_regprocedure('public.premium_staff_account_support_snapshot(uuid)') is null then
    raise exception 'premium_support_snapshot_missing';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership Staff: ogni collaboratore legge soltanto la propria membership.
-- L'Owner continua a leggere la lista completa esclusivamente tramite RPC Owner.
-- ---------------------------------------------------------------------------
drop policy if exists premium_staff_self_select on public.premium_staff_members;
create policy premium_staff_self_select
on public.premium_staff_members for select to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Clienti / utenze / contratti / abbonamenti.
-- Rimuoviamo le vecchie policy Staff FOR ALL e ricreiamo sola lettura.
-- ---------------------------------------------------------------------------
drop policy if exists premium_profiles_staff_select on public.premium_profiles;
create policy premium_profiles_staff_select
on public.premium_profiles for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_customers'))
  or (select public.premium_staff_permission_allowed('view_checks'))
  or (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_control'))
);

drop policy if exists premium_subscriptions_staff_all on public.premium_subscriptions;
drop policy if exists premium_subscriptions_staff_select on public.premium_subscriptions;
create policy premium_subscriptions_staff_select
on public.premium_subscriptions for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_customers'))
  or (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_control'))
  or (select public.premium_staff_permission_allowed('manage_billing'))
);

drop policy if exists premium_utilities_staff_all on public.premium_utilities;
drop policy if exists premium_utilities_staff_select on public.premium_utilities;
create policy premium_utilities_staff_select
on public.premium_utilities for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_customers'))
  or (select public.premium_staff_permission_allowed('view_checks'))
  or (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_control'))
);

drop policy if exists premium_contracts_staff_all on public.premium_contracts;
drop policy if exists premium_contracts_staff_select on public.premium_contracts;
create policy premium_contracts_staff_select
on public.premium_contracts for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_customers'))
  or (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_control'))
);

-- ---------------------------------------------------------------------------
-- Bollette e PDF: il Tecnico/Staff verifiche conserva la regola pre-lancio:
-- può leggere il documento soltanto se esiste una richiesta non annullata.
-- La vista clienti/controllo può leggere i metadati bolletta, non il PDF storage.
-- ---------------------------------------------------------------------------
drop policy if exists premium_bills_staff_all on public.premium_bills;
drop policy if exists premium_bills_staff_select on public.premium_bills;
create policy premium_bills_staff_select
on public.premium_bills for select to authenticated
using (
  deleted_at is null
  and (
    (select public.premium_staff_permission_allowed('view_customers'))
    or (select public.premium_staff_permission_allowed('view_cases'))
    or (select public.premium_staff_permission_allowed('view_control'))
    or (
      (select public.premium_staff_permission_allowed('view_checks'))
      and exists (
        select 1
        from public.premium_checks check_record
        where check_record.bill_id = premium_bills.id
          and check_record.user_id = premium_bills.user_id
          and check_record.status <> 'canceled'
      )
    )
  )
);

-- Le cancellazioni DB delle bollette passano dalla RPC V2.8C1.
drop policy if exists premium_bills_admin_delete on public.premium_bills;

drop policy if exists premium_bills_storage_staff_select on storage.objects;
create policy premium_bills_storage_staff_select
on storage.objects for select to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_staff_permission_allowed('view_checks'))
  and exists (
    select 1
    from public.premium_bills bill
    join public.premium_checks check_record
      on check_record.bill_id = bill.id
     and check_record.user_id = bill.user_id
    where bill.storage_path = storage.objects.name
      and bill.deleted_at is null
      and check_record.status <> 'canceled'
  )
);

-- Lo storage viene rimosso dal Control Center prima della RPC di cancellazione.
-- Richiediamo sia visibilità clienti sia permesso distruttivo.
drop policy if exists premium_bills_storage_admin_delete on storage.objects;
create policy premium_bills_storage_staff_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_staff_permission_allowed('view_customers'))
  and (select public.premium_staff_permission_allowed('delete_records'))
  and exists (
    select 1
    from public.premium_bills bill
    where bill.storage_path = storage.objects.name
      and bill.deleted_at is null
  )
);

-- ---------------------------------------------------------------------------
-- Analisi / controlli / note / anomalie.
-- V2.8C1 ha già chiuso le scritture operative attraverso RPC protette.
-- Qui chiudiamo la lettura diretta RLS alla matrice.
-- ---------------------------------------------------------------------------
drop policy if exists premium_analysis_runs_staff_all on public.premium_analysis_runs;
drop policy if exists premium_analysis_runs_staff_select on public.premium_analysis_runs;
create policy premium_analysis_runs_staff_select
on public.premium_analysis_runs for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_checks'))
  or (select public.premium_staff_permission_allowed('view_ai_costs'))
  or (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_control'))
);

drop policy if exists premium_checks_staff_all on public.premium_checks;
drop policy if exists premium_checks_staff_select on public.premium_checks;
create policy premium_checks_staff_select
on public.premium_checks for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_checks'))
  or (select public.premium_staff_permission_allowed('view_ai_costs'))
  or (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_control'))
);

drop policy if exists premium_check_notes_staff_all on public.premium_check_notes;
drop policy if exists premium_check_notes_staff_select on public.premium_check_notes;
create policy premium_check_notes_staff_select
on public.premium_check_notes for select to authenticated
using ((select public.premium_staff_permission_allowed('view_checks')));

drop policy if exists premium_anomalies_staff_all on public.premium_anomalies;
drop policy if exists premium_anomalies_staff_select on public.premium_anomalies;
create policy premium_anomalies_staff_select
on public.premium_anomalies for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_checks'))
  or (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_control'))
);

drop policy if exists premium_analysis_field_reviews_staff_all on public.premium_analysis_field_reviews;
drop policy if exists premium_analysis_field_reviews_staff_select on public.premium_analysis_field_reviews;
create policy premium_analysis_field_reviews_staff_select
on public.premium_analysis_field_reviews for select to authenticated
using ((select public.premium_staff_permission_allowed('view_checks')));

-- ---------------------------------------------------------------------------
-- Supporto / comunicazioni.
-- Lettura per pratiche, scrittura risposta/chiusura per pratiche,
-- eliminazione solo con view_cases + delete_records.
-- ---------------------------------------------------------------------------
drop policy if exists premium_communications_staff_all on public.premium_communications;
drop policy if exists premium_communications_staff_select on public.premium_communications;
drop policy if exists premium_communications_staff_insert on public.premium_communications;
drop policy if exists premium_communications_staff_update on public.premium_communications;
drop policy if exists premium_communications_staff_delete on public.premium_communications;

create policy premium_communications_staff_select
on public.premium_communications for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_checks'))
  or (select public.premium_staff_permission_allowed('view_control'))
);

create policy premium_communications_staff_insert
on public.premium_communications for insert to authenticated
with check ((select public.premium_staff_permission_allowed('view_cases')));

create policy premium_communications_staff_update
on public.premium_communications for update to authenticated
using ((select public.premium_staff_permission_allowed('view_cases')))
with check ((select public.premium_staff_permission_allowed('view_cases')));

create policy premium_communications_staff_delete
on public.premium_communications for delete to authenticated
using (
  (select public.premium_staff_permission_allowed('view_cases'))
  and (select public.premium_staff_permission_allowed('delete_records'))
);

-- Snapshot Auth/account per il supporto: stessa firma e stesso payload, nuovo gate V2.8.
create or replace function public.premium_staff_account_support_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.premium_staff_permission_allowed('view_cases') then
    raise exception 'premium_staff_permission_required:view_cases' using errcode = '42501';
  end if;

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
  )
  into v_result
  from auth.users users
  left join public.premium_profiles profiles on profiles.id = users.id
  left join lateral (
    select subscription.status, subscription.plan_code, subscription.current_period_end
    from public.premium_subscriptions subscription
    where subscription.user_id = users.id
    order by subscription.created_at desc
    limit 1
  ) subscriptions on true
  where users.id = p_user_id;

  if v_result is null then
    raise exception 'premium_account_not_found';
  end if;

  return v_result;
end;
$$;

revoke all on function public.premium_staff_account_support_snapshot(uuid) from public, anon;
grant execute on function public.premium_staff_account_support_snapshot(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Consensi e costi: sola lettura Staff secondo modulo.
-- Le policy owner/insert legali del cliente restano intatte.
-- ---------------------------------------------------------------------------
drop policy if exists premium_consents_staff_all on public.premium_consents;
drop policy if exists premium_consents_staff_select on public.premium_consents;
create policy premium_consents_staff_select
on public.premium_consents for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_customers'))
  or (select public.premium_staff_permission_allowed('view_control'))
);

drop policy if exists premium_cost_events_staff_all on public.premium_cost_events;
drop policy if exists premium_cost_events_staff_select on public.premium_cost_events;
create policy premium_cost_events_staff_select
on public.premium_cost_events for select to authenticated
using (
  (select public.premium_staff_permission_allowed('view_ai_costs'))
  or (select public.premium_staff_permission_allowed('view_cases'))
  or (select public.premium_staff_permission_allowed('view_control'))
);


-- ---------------------------------------------------------------------------
-- Eliminazioni generiche: delete_records non basta da solo.
-- Richiediamo anche il modulo a cui appartiene la risorsa.
-- ---------------------------------------------------------------------------
create or replace function public.premium_staff_delete_records(
  p_resource text,
  p_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource text := lower(trim(coalesce(p_resource, '')));
  v_module_permission text;
begin
  if not public.premium_staff_permission_allowed('delete_records') then
    raise exception 'premium_staff_permission_required:delete_records' using errcode = '42501';
  end if;

  v_module_permission := case
    when v_resource in ('bills', 'contracts', 'utilities', 'customers') then 'view_customers'
    when v_resource in ('analysis_runs', 'cost_events') then 'view_ai_costs'
    else null
  end;

  if v_module_permission is null then
    raise exception 'premium_delete_resource_not_allowed:%', v_resource using errcode = '22023';
  end if;

  if not public.premium_staff_permission_allowed(v_module_permission) then
    raise exception 'premium_staff_permission_required:%', v_module_permission using errcode = '42501';
  end if;

  return public.premium_staff_delete_records_v28c1_legacy(v_resource, p_ids);
end;
$$;

create or replace function public.premium_staff_complete_account_deletion(
  p_user_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('delete_records') then
    raise exception 'premium_staff_permission_required:delete_records' using errcode = '42501';
  end if;
  if not public.premium_staff_permission_allowed('view_customers') then
    raise exception 'premium_staff_permission_required:view_customers' using errcode = '42501';
  end if;
  return public.premium_staff_complete_account_deletion_v28c1_legacy(p_user_id, p_confirmation);
end;
$$;

revoke all on function public.premium_staff_delete_records(text,uuid[]) from public, anon;
grant execute on function public.premium_staff_delete_records(text,uuid[]) to authenticated, service_role;
revoke all on function public.premium_staff_complete_account_deletion(uuid,text) from public, anon;
grant execute on function public.premium_staff_complete_account_deletion(uuid,text) to authenticated, service_role;

commit;
