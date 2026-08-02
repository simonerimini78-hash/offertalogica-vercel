-- OFFERTALOGICA PREMIUM v0.27
-- Dashboard staff: coda controlli, accesso PDF, presa in carico, note, anomalie ed esito.
-- Script incrementale e idempotente. Non modifica lead_records, lead_events, pdf_analyses o pdf-test-archive.

begin;

-- -----------------------------------------------------------------------------
-- Dato email consultabile dallo staff senza accesso diretto ad auth.users
-- -----------------------------------------------------------------------------

alter table public.premium_profiles
  add column if not exists email text not null default '';

update public.premium_profiles profile
set email = lower(coalesce(users.email, ''))
from auth.users users
where users.id = profile.id
  and profile.email is distinct from lower(coalesce(users.email, ''));

create or replace function public.premium_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'offertalogica_product', '') <> 'premium' then
    return new;
  end if;

  insert into public.premium_profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.phone, ''),
    lower(coalesce(new.email, ''))
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.premium_handle_new_user() from public, anon, authenticated;

create or replace function public.premium_sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.premium_profiles
  set
    email = lower(coalesce(new.email, '')),
    updated_at = now()
  where id = new.id;
  return new;
end;
$$;

revoke all on function public.premium_sync_profile_email() from public, anon, authenticated;

drop trigger if exists premium_on_auth_user_email_updated on auth.users;
create trigger premium_on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute procedure public.premium_sync_profile_email();

-- -----------------------------------------------------------------------------
-- Indici della coda staff
-- -----------------------------------------------------------------------------

create index if not exists premium_checks_status_created_idx
  on public.premium_checks (status, created_at desc);

create index if not exists premium_checks_assigned_status_idx
  on public.premium_checks (assigned_staff_id, status, created_at desc);

create index if not exists premium_check_notes_check_created_idx
  on public.premium_check_notes (check_id, created_at desc);

create index if not exists premium_anomalies_check_created_idx
  on public.premium_anomalies (check_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Accesso staff ai PDF privati: sola lettura per reviewer/admin
-- -----------------------------------------------------------------------------

drop policy if exists premium_bills_storage_staff_select on storage.objects;
create policy premium_bills_storage_staff_select
on storage.objects for select to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_is_staff(array['reviewer', 'admin']))
);

-- -----------------------------------------------------------------------------
-- Funzioni comuni di autorizzazione e assegnazione
-- -----------------------------------------------------------------------------

create or replace function public.premium_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select staff.role
  from public.premium_staff_members staff
  where staff.user_id = (select auth.uid())
    and staff.active = true
    and staff.role in ('reviewer', 'admin')
  limit 1;
$$;

revoke all on function public.premium_staff_role() from public, anon;
grant execute on function public.premium_staff_role() to authenticated, service_role;

create or replace function public.premium_staff_claim_check(p_check_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_role text := public.premium_staff_role();
  v_status text;
  v_assigned_staff_id uuid;
begin
  if v_staff_id is null or v_role is null then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  select check_record.status, check_record.assigned_staff_id
  into v_status, v_assigned_staff_id
  from public.premium_checks check_record
  where check_record.id = p_check_id
  for update;

  if not found then
    raise exception 'premium_check_not_found' using errcode = 'P0002';
  end if;

  if v_status in ('completed', 'canceled') then
    raise exception 'premium_check_not_claimable' using errcode = 'P0001';
  end if;

  if v_assigned_staff_id is not null
     and v_assigned_staff_id <> v_staff_id
     and v_role <> 'admin' then
    raise exception 'premium_check_assigned_to_other_staff' using errcode = '42501';
  end if;

  update public.premium_checks
  set
    assigned_staff_id = v_staff_id,
    status = case when v_status = 'pending' then 'assigned' else v_status end,
    updated_at = now()
  where id = p_check_id;

  return p_check_id;
end;
$$;

revoke all on function public.premium_staff_claim_check(uuid) from public, anon;
grant execute on function public.premium_staff_claim_check(uuid) to authenticated, service_role;

create or replace function public.premium_staff_set_check_status(
  p_check_id uuid,
  p_status text,
  p_customer_message text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_role text := public.premium_staff_role();
  v_current_status text;
  v_assigned_staff_id uuid;
  v_allowed boolean := false;
begin
  if v_staff_id is null or v_role is null then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('assigned', 'in_review', 'more_info_required', 'canceled') then
    raise exception 'premium_invalid_check_status' using errcode = '22023';
  end if;

  select check_record.status, check_record.assigned_staff_id
  into v_current_status, v_assigned_staff_id
  from public.premium_checks check_record
  where check_record.id = p_check_id
  for update;

  if not found then
    raise exception 'premium_check_not_found' using errcode = 'P0002';
  end if;

  if v_assigned_staff_id is not null
     and v_assigned_staff_id <> v_staff_id
     and v_role <> 'admin' then
    raise exception 'premium_check_assigned_to_other_staff' using errcode = '42501';
  end if;

  v_allowed := case v_current_status
    when 'pending' then p_status in ('assigned', 'in_review', 'canceled')
    when 'assigned' then p_status in ('assigned', 'in_review', 'more_info_required', 'canceled')
    when 'in_review' then p_status in ('in_review', 'more_info_required', 'canceled')
    when 'more_info_required' then p_status in ('in_review', 'more_info_required', 'canceled')
    else false
  end;

  if not v_allowed then
    raise exception 'premium_invalid_check_transition' using errcode = 'P0001';
  end if;

  if p_status = 'more_info_required'
     and length(trim(coalesce(p_customer_message, ''))) = 0 then
    raise exception 'premium_customer_message_required' using errcode = '22023';
  end if;

  update public.premium_checks
  set
    assigned_staff_id = coalesce(assigned_staff_id, v_staff_id),
    status = p_status,
    outcome = case when p_status = 'canceled' then 'pending' else outcome end,
    customer_message = case
      when length(trim(coalesce(p_customer_message, ''))) > 0 then trim(p_customer_message)
      else customer_message
    end,
    started_at = case
      when p_status = 'in_review' then coalesce(started_at, now())
      else started_at
    end,
    completed_at = case when p_status = 'canceled' then null else completed_at end,
    updated_at = now()
  where id = p_check_id;

  return p_check_id;
end;
$$;

revoke all on function public.premium_staff_set_check_status(uuid, text, text) from public, anon;
grant execute on function public.premium_staff_set_check_status(uuid, text, text) to authenticated, service_role;

create or replace function public.premium_staff_add_check_note(
  p_check_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_note_id uuid;
begin
  if v_staff_id is null or public.premium_staff_role() is null then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'premium_note_required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.premium_checks check_record where check_record.id = p_check_id) then
    raise exception 'premium_check_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.premium_checks check_record
    where check_record.id = p_check_id
      and check_record.status in ('pending', 'completed', 'canceled')
  ) then
    raise exception 'premium_check_must_be_claimed' using errcode = 'P0001';
  end if;

  insert into public.premium_check_notes (check_id, staff_user_id, note)
  values (p_check_id, v_staff_id, trim(p_note))
  returning id into v_note_id;

  return v_note_id;
end;
$$;

revoke all on function public.premium_staff_add_check_note(uuid, text) from public, anon;
grant execute on function public.premium_staff_add_check_note(uuid, text) to authenticated, service_role;

create or replace function public.premium_staff_add_anomaly(
  p_check_id uuid,
  p_category text,
  p_severity text,
  p_title text,
  p_description text default '',
  p_estimated_impact_eur numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_role text := public.premium_staff_role();
  v_bill_id uuid;
  v_user_id uuid;
  v_status text;
  v_assigned_staff_id uuid;
  v_anomaly_id uuid;
begin
  if v_staff_id is null or v_role is null then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'premium_anomaly_title_required' using errcode = '22023';
  end if;

  if p_category is null or p_category not in ('price', 'fixed_fee', 'discount', 'consumption', 'tax', 'adjustment', 'contract', 'duplicate', 'other') then
    raise exception 'premium_invalid_anomaly_category' using errcode = '22023';
  end if;

  if p_severity is null or p_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'premium_invalid_anomaly_severity' using errcode = '22023';
  end if;

  select check_record.bill_id, check_record.user_id, check_record.status, check_record.assigned_staff_id
  into v_bill_id, v_user_id, v_status, v_assigned_staff_id
  from public.premium_checks check_record
  where check_record.id = p_check_id
  for update;

  if not found then
    raise exception 'premium_check_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'pending' then
    raise exception 'premium_check_must_be_claimed' using errcode = 'P0001';
  end if;

  if v_status in ('completed', 'canceled') then
    raise exception 'premium_check_not_editable' using errcode = 'P0001';
  end if;

  if v_assigned_staff_id is not null
     and v_assigned_staff_id <> v_staff_id
     and v_role <> 'admin' then
    raise exception 'premium_check_assigned_to_other_staff' using errcode = '42501';
  end if;

  insert into public.premium_anomalies (
    bill_id,
    check_id,
    user_id,
    category,
    severity,
    status,
    title,
    description,
    estimated_impact_eur
  )
  values (
    v_bill_id,
    p_check_id,
    v_user_id,
    p_category,
    p_severity,
    'open',
    trim(p_title),
    trim(coalesce(p_description, '')),
    p_estimated_impact_eur
  )
  returning id into v_anomaly_id;

  return v_anomaly_id;
end;
$$;

revoke all on function public.premium_staff_add_anomaly(uuid, text, text, text, text, numeric) from public, anon;
grant execute on function public.premium_staff_add_anomaly(uuid, text, text, text, text, numeric) to authenticated, service_role;

create or replace function public.premium_staff_delete_anomaly(p_anomaly_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_role text := public.premium_staff_role();
  v_check_status text;
  v_assigned_staff_id uuid;
begin
  if v_staff_id is null or v_role is null then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  select check_record.status, check_record.assigned_staff_id
  into v_check_status, v_assigned_staff_id
  from public.premium_anomalies anomaly
  join public.premium_checks check_record on check_record.id = anomaly.check_id
  where anomaly.id = p_anomaly_id
  for update of anomaly, check_record;

  if not found then
    raise exception 'premium_anomaly_not_found' using errcode = 'P0002';
  end if;

  if v_check_status in ('completed', 'canceled') then
    raise exception 'premium_check_not_editable' using errcode = 'P0001';
  end if;

  if v_assigned_staff_id is not null
     and v_assigned_staff_id <> v_staff_id
     and v_role <> 'admin' then
    raise exception 'premium_check_assigned_to_other_staff' using errcode = '42501';
  end if;

  delete from public.premium_anomalies where id = p_anomaly_id;
  return true;
end;
$$;

revoke all on function public.premium_staff_delete_anomaly(uuid) from public, anon;
grant execute on function public.premium_staff_delete_anomaly(uuid) to authenticated, service_role;

create or replace function public.premium_staff_complete_check(
  p_check_id uuid,
  p_outcome text,
  p_summary text,
  p_customer_message text,
  p_human_seconds integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_role text := public.premium_staff_role();
  v_status text;
  v_assigned_staff_id uuid;
begin
  if v_staff_id is null or v_role is null then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  if p_outcome is null or p_outcome not in ('correct', 'anomaly', 'possible_saving', 'inconclusive') then
    raise exception 'premium_invalid_check_outcome' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_summary, ''))) = 0
     or length(trim(coalesce(p_customer_message, ''))) = 0 then
    raise exception 'premium_customer_message_required' using errcode = '22023';
  end if;

  if coalesce(p_human_seconds, 0) < 0 or coalesce(p_human_seconds, 0) > 86400 then
    raise exception 'premium_invalid_human_seconds' using errcode = '22023';
  end if;

  select check_record.status, check_record.assigned_staff_id
  into v_status, v_assigned_staff_id
  from public.premium_checks check_record
  where check_record.id = p_check_id
  for update;

  if not found then
    raise exception 'premium_check_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'pending' then
    raise exception 'premium_check_must_be_claimed' using errcode = 'P0001';
  end if;

  if v_status in ('completed', 'canceled') then
    raise exception 'premium_check_not_editable' using errcode = 'P0001';
  end if;

  if v_assigned_staff_id is not null
     and v_assigned_staff_id <> v_staff_id
     and v_role <> 'admin' then
    raise exception 'premium_check_assigned_to_other_staff' using errcode = '42501';
  end if;

  if p_outcome in ('anomaly', 'possible_saving')
     and not exists (
       select 1
       from public.premium_anomalies anomaly
       where anomaly.check_id = p_check_id
         and anomaly.status <> 'dismissed'
     ) then
    raise exception 'premium_anomaly_required' using errcode = '22023';
  end if;

  update public.premium_checks
  set
    assigned_staff_id = coalesce(assigned_staff_id, v_staff_id),
    status = 'completed',
    outcome = p_outcome,
    summary = trim(p_summary),
    customer_message = trim(p_customer_message),
    started_at = coalesce(started_at, now()),
    completed_at = now(),
    human_seconds = coalesce(p_human_seconds, 0),
    updated_at = now()
  where id = p_check_id;

  return p_check_id;
end;
$$;

revoke all on function public.premium_staff_complete_check(uuid, text, text, text, integer) from public, anon;
grant execute on function public.premium_staff_complete_check(uuid, text, text, text, integer) to authenticated, service_role;

commit;
