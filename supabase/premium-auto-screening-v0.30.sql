-- OFFERTALOGICA PREMIUM v0.30
-- Analisi IA automatica al caricamento, aggiornamento archivio e smistamento delle sole eccezioni.
-- Script incrementale e idempotente. Non modifica lead_records, lead_events, pdf_analyses o pdf-test-archive.

begin;

-- Esito sintetico visibile al cliente. I dati grezzi IA restano in premium_analysis_runs
-- e continuano a essere accessibili soltanto allo staff autorizzato.
alter table public.premium_bills
  add column if not exists automatic_screening_status text;

update public.premium_bills
set automatic_screening_status = 'not_run'
where automatic_screening_status is null;

alter table public.premium_bills
  alter column automatic_screening_status set default 'pending',
  alter column automatic_screening_status set not null;

alter table public.premium_bills
  add column if not exists automatic_screening_summary text not null default '';

alter table public.premium_bills
  add column if not exists automatic_screening_reasons jsonb not null default '[]'::jsonb;

alter table public.premium_bills
  add column if not exists automatic_screened_at timestamptz;

alter table public.premium_bills
  add column if not exists automatic_analysis_run_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'premium_bills_automatic_screening_status_check'
      and conrelid = 'public.premium_bills'::regclass
  ) then
    alter table public.premium_bills
      add constraint premium_bills_automatic_screening_status_check
      check (automatic_screening_status in (
        'not_run', 'pending', 'running', 'clear', 'review_recommended', 'inconclusive', 'failed'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'premium_bills_automatic_analysis_run_fk'
      and conrelid = 'public.premium_bills'::regclass
  ) then
    alter table public.premium_bills
      add constraint premium_bills_automatic_analysis_run_fk
      foreign key (automatic_analysis_run_id)
      references public.premium_analysis_runs(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists premium_bills_automatic_screening_idx
  on public.premium_bills (automatic_screening_status, created_at desc);

-- Provenienza e risultato dello screening per audit e misurazione economica.
alter table public.premium_analysis_runs
  add column if not exists origin text;

update public.premium_analysis_runs
set origin = 'staff_manual'
where origin is null;

alter table public.premium_analysis_runs
  alter column origin set default 'staff_manual',
  alter column origin set not null;

alter table public.premium_analysis_runs
  add column if not exists requested_by_user_id uuid
    references auth.users(id)
    on delete set null;

alter table public.premium_analysis_runs
  add column if not exists automatic_classification text not null default 'not_applicable';

alter table public.premium_analysis_runs
  add column if not exists automatic_summary text not null default '';

alter table public.premium_analysis_runs
  add column if not exists automatic_reasons jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'premium_analysis_runs_origin_check'
      and conrelid = 'public.premium_analysis_runs'::regclass
  ) then
    alter table public.premium_analysis_runs
      add constraint premium_analysis_runs_origin_check
      check (origin in ('customer_upload', 'staff_manual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'premium_analysis_runs_automatic_classification_check'
      and conrelid = 'public.premium_analysis_runs'::regclass
  ) then
    alter table public.premium_analysis_runs
      add constraint premium_analysis_runs_automatic_classification_check
      check (automatic_classification in (
        'not_applicable', 'clear', 'review_recommended', 'inconclusive', 'failed'
      ));
  end if;
end;
$$;

create index if not exists premium_analysis_runs_origin_idx
  on public.premium_analysis_runs (origin, created_at desc);

create index if not exists premium_analysis_runs_requested_user_idx
  on public.premium_analysis_runs (requested_by_user_id, created_at desc);

comment on column public.premium_bills.automatic_screening_status is
  'Esito automatico sintetico visibile al cliente. Non equivale a una certificazione umana.';
comment on column public.premium_bills.automatic_screening_reasons is
  'Motivi sintetici che abilitano l’eventuale richiesta di controllo umano.';
comment on column public.premium_analysis_runs.origin is
  'customer_upload per analisi automatica; staff_manual per riesecuzione dalla dashboard.';

-- Il client può creare soltanto una bolletta ancora da analizzare. Lo stato di
-- screening e gli esiti sono scritti esclusivamente dal backend con chiave server.
drop policy if exists premium_bills_owner_insert on public.premium_bills;
create policy premium_bills_owner_insert
on public.premium_bills for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and (select public.premium_can_add_bill(utility_id))
  and storage_bucket = 'premium-bills'
  and split_part(storage_path, '/', 1) = (select auth.uid())::text
  and processing_status = 'uploaded'
  and customer_status = 'awaiting_review'
  and automatic_screening_status = 'pending'
  and automatic_screening_summary = ''
  and automatic_screening_reasons = '[]'::jsonb
  and automatic_screened_at is null
  and automatic_analysis_run_id is null
  and completed_at is null
  and deleted_at is null
);

drop policy if exists premium_bills_storage_owner_insert on storage.objects;
create policy premium_bills_storage_owner_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'premium-bills'
  and (select public.premium_has_service_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.premium_bills bill
    where bill.storage_path = storage.objects.name
      and bill.user_id = (select auth.uid())
      and bill.processing_status = 'uploaded'
      and bill.automatic_screening_status = 'pending'
      and bill.deleted_at is null
  )
);

-- Il cliente può eliminare la bolletta finché non esiste un controllo umano attivo,
-- anche dopo il completamento dello screening automatico.
drop policy if exists premium_bills_owner_delete on public.premium_bills;
create policy premium_bills_owner_delete
on public.premium_bills for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and processing_status in ('uploaded', 'completed', 'failed')
  and not exists (
    select 1
    from public.premium_checks check_record
    where check_record.bill_id = premium_bills.id
      and check_record.user_id = (select auth.uid())
      and check_record.status <> 'canceled'
  )
);

drop policy if exists premium_bills_storage_owner_delete on storage.objects;
create policy premium_bills_storage_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_has_service_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.premium_bills bill
    where bill.storage_path = storage.objects.name
      and bill.user_id = (select auth.uid())
      and bill.processing_status in ('uploaded', 'completed', 'failed')
      and bill.deleted_at is null
      and not exists (
        select 1
        from public.premium_checks check_record
        where check_record.bill_id = bill.id
          and check_record.user_id = bill.user_id
          and check_record.status <> 'canceled'
      )
  )
);

-- Richiesta umana disponibile soltanto per eccezioni rilevate o analisi non conclusive.
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

  if v_screening_status not in ('review_recommended', 'inconclusive', 'failed')
     or v_processing_status not in ('completed', 'failed')
     or v_customer_status not in ('anomaly_found', 'more_info_required', 'failed') then
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
    'premium-auto-screening-v0.30',
    true,
    'premium_app',
    jsonb_build_object(
      'bill_id', p_bill_id,
      'check_id', v_check_id,
      'automatic_screening_status', v_screening_status
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
