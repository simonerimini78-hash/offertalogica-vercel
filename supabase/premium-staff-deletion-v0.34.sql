-- OffertaLogica Premium v0.34
-- Eliminazione amministrativa coerente in tutta la pagina staff unica.
-- Consente cancellazione singola e a blocchi senza nuove funzioni Vercel.

begin;

-- Separazione netta: reviewer legge e lavora tramite RPC dedicate,
-- l'eliminazione diretta delle risorse resta riservata all'amministratore.

drop policy if exists premium_utilities_staff_all on public.premium_utilities;
drop policy if exists premium_utilities_staff_select on public.premium_utilities;
create policy premium_utilities_staff_all
on public.premium_utilities for select to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])));

drop policy if exists premium_contracts_staff_all on public.premium_contracts;
drop policy if exists premium_contracts_staff_select on public.premium_contracts;
create policy premium_contracts_staff_all
on public.premium_contracts for select to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])));

drop policy if exists premium_analysis_runs_staff_all on public.premium_analysis_runs;
drop policy if exists premium_analysis_runs_staff_select on public.premium_analysis_runs;
create policy premium_analysis_runs_staff_all
on public.premium_analysis_runs for select to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])));

drop policy if exists premium_checks_staff_all on public.premium_checks;
drop policy if exists premium_checks_staff_select on public.premium_checks;
create policy premium_checks_staff_all
on public.premium_checks for select to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])));

-- I reviewer continuano a leggere soltanto le bollette richieste dal cliente.
-- L'admin può vedere i metadati di tutte le bollette per cancellarle, ma non
-- ottiene automaticamente il diritto di aprire il PDF: la policy Storage v0.32
-- resta vincolata alla richiesta di controllo.
drop policy if exists premium_bills_staff_select on public.premium_bills;
drop policy if exists premium_bills_reviewer_select on public.premium_bills;
create policy premium_bills_staff_select
on public.premium_bills for select to authenticated
using (
  (select public.premium_is_staff(array['reviewer']))
  and deleted_at is null
  and exists (
    select 1
    from public.premium_checks check_record
    where check_record.bill_id = premium_bills.id
      and check_record.user_id = premium_bills.user_id
      and check_record.status <> 'canceled'
  )
);

drop policy if exists premium_bills_admin_select on public.premium_bills;
create policy premium_bills_admin_select
on public.premium_bills for select to authenticated
using (
  (select public.premium_is_staff(array['admin']))
  and deleted_at is null
);

-- Un solo punto transazionale per eliminare record Premium e blocchi collegati.
-- I PDF fisici vengono rimossi dal client tramite Storage prima della RPC.
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
  v_admin_id uuid := auth.uid();
  v_resource text := lower(trim(coalesce(p_resource, '')));
  v_ids uuid[] := coalesce(p_ids, array[]::uuid[]);
  v_target_count integer := 0;
  v_bill_ids uuid[] := array[]::uuid[];
  v_run_ids uuid[] := array[]::uuid[];
  v_check_ids uuid[] := array[]::uuid[];
begin
  if v_admin_id is null or public.premium_staff_role() <> 'admin' then
    raise exception 'premium_admin_delete_required' using errcode = '42501';
  end if;

  if cardinality(v_ids) = 0 then
    raise exception 'premium_delete_ids_required' using errcode = '22023';
  end if;

  if cardinality(v_ids) > 500 then
    raise exception 'premium_delete_limit_exceeded' using errcode = '22023';
  end if;

  if v_resource = 'bills' then
    select count(*)::integer,
           coalesce(array_agg(bill.id), array[]::uuid[])
      into v_target_count, v_bill_ids
    from public.premium_bills bill
    where bill.id = any(v_ids);

    select coalesce(array_agg(run.id), array[]::uuid[])
      into v_run_ids
    from public.premium_analysis_runs run
    where run.bill_id = any(v_bill_ids);

    select coalesce(array_agg(check_record.id), array[]::uuid[])
      into v_check_ids
    from public.premium_checks check_record
    where check_record.bill_id = any(v_bill_ids);

    delete from public.premium_cost_events cost
    where cost.bill_id = any(v_bill_ids)
       or cost.analysis_run_id = any(v_run_ids)
       or cost.check_id = any(v_check_ids);

    delete from public.premium_bills bill
    where bill.id = any(v_bill_ids);

  elsif v_resource = 'contracts' then
    select count(*)::integer into v_target_count
    from public.premium_contracts contract_record
    where contract_record.id = any(v_ids);

    update public.premium_bills bill
    set contract_id = null,
        updated_at = now()
    where bill.contract_id = any(v_ids);

    delete from public.premium_contracts contract_record
    where contract_record.id = any(v_ids);

  elsif v_resource = 'utilities' then
    select count(*)::integer into v_target_count
    from public.premium_utilities utility
    where utility.id = any(v_ids);

    select coalesce(array_agg(bill.id), array[]::uuid[])
      into v_bill_ids
    from public.premium_bills bill
    where bill.utility_id = any(v_ids);

    select coalesce(array_agg(run.id), array[]::uuid[])
      into v_run_ids
    from public.premium_analysis_runs run
    where run.bill_id = any(v_bill_ids);

    select coalesce(array_agg(check_record.id), array[]::uuid[])
      into v_check_ids
    from public.premium_checks check_record
    where check_record.bill_id = any(v_bill_ids);

    delete from public.premium_cost_events cost
    where cost.bill_id = any(v_bill_ids)
       or cost.analysis_run_id = any(v_run_ids)
       or cost.check_id = any(v_check_ids);

    delete from public.premium_bills bill
    where bill.id = any(v_bill_ids);

    delete from public.premium_contracts contract_record
    where contract_record.utility_id = any(v_ids);

    delete from public.premium_utilities utility
    where utility.id = any(v_ids);

  elsif v_resource = 'customers' then
    if exists (
      select 1
      from public.premium_staff_members staff
      where staff.user_id = any(v_ids)
        and staff.active = true
    ) then
      raise exception 'premium_staff_account_delete_blocked' using errcode = '42501';
    end if;

    select count(*)::integer into v_target_count
    from public.premium_profiles profile
    where profile.id = any(v_ids);

    select coalesce(array_agg(bill.id), array[]::uuid[])
      into v_bill_ids
    from public.premium_bills bill
    where bill.user_id = any(v_ids);

    select coalesce(array_agg(run.id), array[]::uuid[])
      into v_run_ids
    from public.premium_analysis_runs run
    where run.user_id = any(v_ids);

    select coalesce(array_agg(check_record.id), array[]::uuid[])
      into v_check_ids
    from public.premium_checks check_record
    where check_record.user_id = any(v_ids);

    delete from public.premium_cost_events cost
    where cost.user_id = any(v_ids)
       or cost.bill_id = any(v_bill_ids)
       or cost.analysis_run_id = any(v_run_ids)
       or cost.check_id = any(v_check_ids);

    delete from public.premium_bills bill
    where bill.user_id = any(v_ids);

    delete from public.premium_contracts contract_record
    where contract_record.user_id = any(v_ids);

    delete from public.premium_utilities utility
    where utility.user_id = any(v_ids);

    delete from public.premium_communications communication
    where communication.user_id = any(v_ids);

    delete from public.premium_consents consent_record
    where consent_record.user_id = any(v_ids);

    delete from public.premium_subscriptions subscription
    where subscription.user_id = any(v_ids);

    delete from public.premium_profiles profile
    where profile.id = any(v_ids);

  elsif v_resource = 'checks' then
    select count(*)::integer,
           coalesce(array_agg(check_record.id), array[]::uuid[]),
           coalesce(array_agg(check_record.bill_id), array[]::uuid[])
      into v_target_count, v_check_ids, v_bill_ids
    from public.premium_checks check_record
    where check_record.id = any(v_ids);

    delete from public.premium_cost_events cost
    where cost.check_id = any(v_check_ids);

    update public.premium_bills bill
    set
      processing_status = case bill.automatic_screening_status
        when 'failed' then 'failed'
        when 'review_recommended' then 'completed'
        when 'inconclusive' then 'completed'
        when 'clear' then 'completed'
        else 'uploaded'
      end,
      customer_status = case bill.automatic_screening_status
        when 'failed' then 'failed'
        when 'review_recommended' then 'anomaly_found'
        when 'inconclusive' then 'more_info_required'
        when 'clear' then 'correct'
        else 'awaiting_review'
      end,
      completed_at = case
        when bill.automatic_screening_status in ('failed', 'review_recommended', 'inconclusive', 'clear')
          then coalesce(bill.completed_at, now())
        else null
      end,
      updated_at = now()
    where bill.id = any(v_bill_ids);

    delete from public.premium_checks check_record
    where check_record.id = any(v_check_ids);

  elsif v_resource = 'analysis_runs' then
    select count(*)::integer,
           coalesce(array_agg(run.id), array[]::uuid[])
      into v_target_count, v_run_ids
    from public.premium_analysis_runs run
    where run.id = any(v_ids);

    delete from public.premium_cost_events cost
    where cost.analysis_run_id = any(v_run_ids);

    update public.premium_bills bill
    set
      automatic_analysis_run_id = null,
      automatic_screening_status = 'not_run',
      automatic_screening_summary = '',
      automatic_screening_reasons = '[]'::jsonb,
      automatic_screened_at = null,
      processing_status = case
        when exists (
          select 1 from public.premium_checks check_record
          where check_record.bill_id = bill.id
            and check_record.status <> 'canceled'
        ) then bill.processing_status
        else 'uploaded'
      end,
      customer_status = case
        when exists (
          select 1 from public.premium_checks check_record
          where check_record.bill_id = bill.id
            and check_record.status <> 'canceled'
        ) then bill.customer_status
        else 'awaiting_review'
      end,
      completed_at = case
        when exists (
          select 1 from public.premium_checks check_record
          where check_record.bill_id = bill.id
            and check_record.status <> 'canceled'
        ) then bill.completed_at
        else null
      end,
      updated_at = now()
    where bill.automatic_analysis_run_id = any(v_run_ids);

    delete from public.premium_analysis_runs run
    where run.id = any(v_run_ids);

  elsif v_resource = 'cost_events' then
    select count(*)::integer into v_target_count
    from public.premium_cost_events cost
    where cost.id = any(v_ids);

    delete from public.premium_cost_events cost
    where cost.id = any(v_ids);

  else
    raise exception 'premium_delete_resource_invalid' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'resource', v_resource,
    'deleted_count', v_target_count,
    'requested_count', cardinality(v_ids),
    'deleted_at', now(),
    'deleted_by', v_admin_id
  );
end;
$$;

revoke all on function public.premium_staff_delete_records(text, uuid[]) from public, anon;
grant execute on function public.premium_staff_delete_records(text, uuid[]) to authenticated, service_role;

comment on function public.premium_staff_delete_records(text, uuid[]) is
  'Eliminazione amministrativa atomica di record Premium singoli o a blocchi. I file Storage vengono rimossi separatamente dal client admin.';

commit;
