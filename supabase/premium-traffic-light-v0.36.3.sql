-- OFFERTALOGICA PREMIUM v0.36.3
-- Regola verde/giallo/rosso: lo staff può essere richiesto soltanto per anomalie rosse.
-- Script incrementale e idempotente.

begin;

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
  v_screening_status text;
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  if not public.premium_has_service_access() then
    raise exception 'premium_service_access_required' using errcode = '42501';
  end if;

  if p_bill_id is null then
    raise exception 'premium_bill_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_bill_id::text, 0));

  select bill.processing_status, bill.customer_status, bill.automatic_screening_status
  into v_processing_status, v_customer_status, v_screening_status
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

  if v_check_id is not null then
    return v_check_id;
  end if;

  -- Verde e giallo si chiudono senza staff. Solo il rosso è richiedibile.
  if v_screening_status <> 'review_recommended'
     or v_processing_status <> 'completed'
     or v_customer_status <> 'anomaly_found' then
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
    'premium-traffic-light-v0.36.3',
    true,
    'premium_app',
    jsonb_build_object(
      'bill_id', p_bill_id,
      'check_id', v_check_id,
      'automatic_screening_status', v_screening_status,
      'traffic_light', 'red'
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
