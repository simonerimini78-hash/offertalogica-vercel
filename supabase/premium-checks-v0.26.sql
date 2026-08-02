-- OFFERTALOGICA PREMIUM v0.26
-- Richiesta atomica del controllo professionale e protezione contro richieste duplicate.
-- Script incrementale e idempotente. Non modifica le tabelle del sito o l'archivio diagnostico.

begin;

-- Una bolletta può avere un solo controllo non annullato.
create unique index if not exists premium_checks_bill_active_uidx
on public.premium_checks (bill_id, user_id)
where status <> 'canceled';

create or replace function public.premium_sync_bill_from_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.premium_bills
  set
    processing_status = case new.status
      when 'pending' then 'queued'
      when 'assigned' then 'queued'
      when 'in_review' then 'ready_for_review'
      when 'more_info_required' then 'ready_for_review'
      when 'completed' then 'completed'
      when 'canceled' then 'uploaded'
      else processing_status
    end,
    customer_status = case
      when new.status = 'pending' then 'awaiting_review'
      when new.status in ('assigned', 'in_review') then 'in_review'
      when new.status = 'more_info_required' then 'more_info_required'
      when new.status = 'completed' and new.outcome = 'correct' then 'correct'
      when new.status = 'completed' and new.outcome = 'anomaly' then 'anomaly_found'
      when new.status = 'completed' and new.outcome = 'possible_saving' then 'saving_opportunity'
      when new.status = 'completed' and new.outcome = 'inconclusive' then 'more_info_required'
      when new.status = 'canceled' then 'awaiting_review'
      else customer_status
    end,
    completed_at = case
      when new.status = 'completed' then coalesce(new.completed_at, now())
      when new.status = 'canceled' then null
      else completed_at
    end,
    updated_at = now()
  where id = new.bill_id
    and user_id = new.user_id
    and deleted_at is null;

  return new;
end;
$$;

revoke all on function public.premium_sync_bill_from_check() from public, anon;

drop trigger if exists premium_checks_sync_bill on public.premium_checks;
create trigger premium_checks_sync_bill
after insert or update of status, outcome, completed_at
on public.premium_checks
for each row execute procedure public.premium_sync_bill_from_check();

create or replace function public.premium_request_check(p_bill_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_check_id uuid;
  v_processing_status text;
  v_customer_status text;
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if not public.premium_has_service_access() then
    raise exception 'premium_service_access_required' using errcode = '42501';
  end if;

  -- Serializza eventuali doppi tap o richieste concorrenti sulla stessa bolletta.
  perform pg_advisory_xact_lock(hashtextextended(p_bill_id::text, 0));

  select bill.processing_status, bill.customer_status
  into v_processing_status, v_customer_status
  from public.premium_bills bill
  where bill.id = p_bill_id
    and bill.user_id = v_user_id
    and bill.deleted_at is null
  for update;

  if not found then
    raise exception 'premium_bill_not_found' using errcode = 'P0002';
  end if;

  select check_record.id
  into v_check_id
  from public.premium_checks check_record
  where check_record.bill_id = p_bill_id
    and check_record.user_id = v_user_id
    and check_record.status <> 'canceled'
  order by check_record.created_at desc
  limit 1;

  -- La funzione è idempotente: un doppio invio restituisce il controllo esistente.
  if v_check_id is not null then
    return v_check_id;
  end if;

  if v_processing_status <> 'uploaded'
     or v_customer_status <> 'awaiting_review' then
    raise exception 'premium_bill_not_requestable' using errcode = 'P0001';
  end if;

  insert into public.premium_checks (
    bill_id,
    user_id,
    status,
    outcome,
    summary,
    customer_message
  )
  values (
    p_bill_id,
    v_user_id,
    'pending',
    'pending',
    '',
    ''
  )
  returning id into v_check_id;

  insert into public.premium_consents (
    user_id,
    consent_type,
    version,
    granted,
    source,
    proof
  )
  values (
    v_user_id,
    'remote_review',
    'premium-check-v0.26',
    true,
    'premium_app',
    jsonb_build_object(
      'bill_id', p_bill_id,
      'check_id', v_check_id
    )
  );

  update public.premium_bills
  set
    processing_status = 'queued',
    customer_status = 'awaiting_review',
    updated_at = now()
  where id = p_bill_id
    and user_id = v_user_id;

  return v_check_id;
end;
$$;

revoke all on function public.premium_request_check(uuid) from public, anon;
grant execute on function public.premium_request_check(uuid) to authenticated, service_role;

commit;
