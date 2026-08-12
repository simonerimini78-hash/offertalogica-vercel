-- OffertaLogica Staff v2.7C1
-- Timeline reale append-only delle pratiche Premium.
--
-- Base verificata:
--   branch: staff-v2-control-center
--   commit: 367cd2c3c4df7e4838c01cc2e8eb3c9122cf92c0 (Staff-V2.7B)
--
-- PRINCIPI
-- - non sostituisce e non modifica le RPC operative esistenti;
-- - registra gli eventi nel database tramite trigger, quindi il browser non e' fonte autorevole;
-- - nessun contenuto PDF, token, password o corpo completo delle comunicazioni viene copiato;
-- - lo storico non ha FK verso check/bill/user: resta leggibile come audit tecnico anche se la pratica viene rimossa;
-- - nessun accesso diretto alla tabella per authenticated.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;
  if to_regclass('public.premium_checks') is null then
    raise exception 'premium_checks_missing';
  end if;
  if to_regclass('public.premium_check_notes') is null then
    raise exception 'premium_check_notes_missing';
  end if;
  if to_regclass('public.premium_anomalies') is null then
    raise exception 'premium_anomalies_missing';
  end if;
  if to_regclass('public.premium_analysis_runs') is null then
    raise exception 'premium_analysis_runs_missing';
  end if;
  if to_regclass('public.premium_analysis_field_reviews') is null then
    raise exception 'premium_analysis_field_reviews_missing';
  end if;
  if to_regclass('public.premium_communications') is null then
    raise exception 'premium_communications_missing';
  end if;
end;
$$;

create table if not exists public.premium_check_timeline_events (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null,
  bill_id uuid,
  user_id uuid,
  event_type text not null
    check (length(trim(event_type)) between 1 and 80),
  actor_user_id uuid,
  actor_label text not null default '',
  actor_email text not null default '',
  actor_role text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'database',
  created_at timestamptz not null default now()
);

comment on table public.premium_check_timeline_events is
  'Timeline append-only delle pratiche Premium. Registra eventi operativi reali senza contenuti PDF o corpi completi delle comunicazioni.';
comment on column public.premium_check_timeline_events.actor_email is
  'Email snapshot valorizzata soltanto per operatori Staff. Per il cliente resta vuota.';
comment on column public.premium_check_timeline_events.actor_role is
  'Ruolo snapshot: owner/admin/technician/reviewer/support, customer oppure system.';
comment on column public.premium_check_timeline_events.metadata is
  'Metadati tecnici minimi dell evento; non deve contenere PDF, token, password o corpi completi di messaggi.';

create index if not exists premium_check_timeline_check_created_idx
  on public.premium_check_timeline_events (check_id, created_at asc, id asc);
create index if not exists premium_check_timeline_bill_created_idx
  on public.premium_check_timeline_events (bill_id, created_at asc);
create index if not exists premium_check_timeline_actor_created_idx
  on public.premium_check_timeline_events (actor_user_id, created_at desc);
create index if not exists premium_check_timeline_type_created_idx
  on public.premium_check_timeline_events (event_type, created_at desc);

alter table public.premium_check_timeline_events enable row level security;

revoke all on table public.premium_check_timeline_events
  from public, anon, authenticated;
revoke update, delete, truncate on table public.premium_check_timeline_events
  from service_role;
grant select, insert on table public.premium_check_timeline_events
  to service_role;

-- Writer interno. Non e' una API browser.
create or replace function public.premium_check_timeline_write(
  p_check_id uuid,
  p_bill_id uuid,
  p_user_id uuid,
  p_event_type text,
  p_actor_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'database'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_actor_id uuid := p_actor_user_id;
  v_event_type text := left(trim(coalesce(p_event_type, '')), 80);
  v_source text := left(trim(coalesce(p_source, 'database')), 120);
  v_actor_label text := 'Sistema automatico';
  v_actor_email text := '';
  v_actor_role text := 'system';
  v_staff_role text;
  v_auth_email text := '';
  v_auth_name text := '';
begin
  if p_check_id is null then
    raise exception 'premium_check_timeline_check_required';
  end if;

  if v_event_type = '' then
    raise exception 'premium_check_timeline_event_required';
  end if;

  if v_actor_id is null then
    v_actor_id := auth.uid();
  end if;

  if v_actor_id is not null then
    select staff.role
      into v_staff_role
    from public.premium_staff_members as staff
    where staff.user_id = v_actor_id
    limit 1;

    if v_staff_role in ('support', 'reviewer', 'technician', 'admin', 'owner') then
      select
        coalesce(auth_user.email::text, ''),
        trim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', ''))
        into v_auth_email, v_auth_name
      from auth.users as auth_user
      where auth_user.id = v_actor_id;

      v_actor_role := v_staff_role;
      v_actor_email := coalesce(v_auth_email, '');
      v_actor_label := case
        when coalesce(v_auth_name, '') <> '' then v_auth_name
        when coalesce(v_auth_email, '') <> '' then v_auth_email
        else 'Operatore Staff'
      end;
    elsif p_user_id is not null and v_actor_id = p_user_id then
      -- Non copiare l'email cliente nello storico tecnico.
      v_actor_role := 'customer';
      v_actor_email := '';
      v_actor_label := 'Cliente';
    else
      v_actor_role := 'system';
      v_actor_email := '';
      v_actor_label := 'Sistema automatico';
    end if;
  end if;

  insert into public.premium_check_timeline_events (
    check_id,
    bill_id,
    user_id,
    event_type,
    actor_user_id,
    actor_label,
    actor_email,
    actor_role,
    metadata,
    source
  )
  values (
    p_check_id,
    p_bill_id,
    p_user_id,
    v_event_type,
    case when v_actor_role = 'system' then null else v_actor_id end,
    left(v_actor_label, 240),
    left(v_actor_email, 320),
    left(v_actor_role, 40),
    coalesce(p_metadata, '{}'::jsonb),
    case when v_source = '' then 'database' else v_source end
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.premium_check_timeline_write(
  uuid, uuid, uuid, text, uuid, jsonb, text
) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CHECK: creazione, presa in carico, cambi stato, chiusura.
-- ---------------------------------------------------------------------------

create or replace function public.premium_check_timeline_checks_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_screening_status text := '';
  v_screening_reason_count integer := 0;
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    select
      coalesce(bill.automatic_screening_status, ''),
      case
        when jsonb_typeof(coalesce(bill.automatic_screening_reasons, '[]'::jsonb)) = 'array'
          then jsonb_array_length(coalesce(bill.automatic_screening_reasons, '[]'::jsonb))
        else 0
      end
      into v_screening_status, v_screening_reason_count
    from public.premium_bills as bill
    where bill.id = new.bill_id;

    perform public.premium_check_timeline_write(
      new.id,
      new.bill_id,
      new.user_id,
      'check_created',
      v_actor,
      jsonb_build_object(
        'status', new.status,
        'outcome', new.outcome,
        'screening_status', coalesce(v_screening_status, ''),
        'screening_reason_count', coalesce(v_screening_reason_count, 0)
      ),
      'trigger:premium_checks:insert'
    );

    return new;
  end if;

  if new.assigned_staff_id is distinct from old.assigned_staff_id then
    perform public.premium_check_timeline_write(
      new.id,
      new.bill_id,
      new.user_id,
      case
        when old.assigned_staff_id is null and new.assigned_staff_id is not null then 'check_claimed'
        when old.assigned_staff_id is not null and new.assigned_staff_id is null then 'check_unassigned'
        else 'check_reassigned'
      end,
      v_actor,
      jsonb_build_object(
        'previous_assigned_staff_id', old.assigned_staff_id,
        'assigned_staff_id', new.assigned_staff_id
      ),
      'trigger:premium_checks:assignment'
    );
  end if;

  if new.status is distinct from old.status then
    -- pending -> assigned insieme alla prima assegnazione e' gia rappresentato
    -- dall'evento check_claimed; evitare un doppione inutile.
    if not (
      old.status = 'pending'
      and new.status = 'assigned'
      and new.assigned_staff_id is distinct from old.assigned_staff_id
    ) then
      perform public.premium_check_timeline_write(
        new.id,
        new.bill_id,
        new.user_id,
        case new.status
          when 'in_review' then 'check_in_review'
          when 'more_info_required' then 'check_more_info_required'
          when 'completed' then 'check_completed'
          when 'canceled' then 'check_canceled'
          when 'assigned' then 'check_assigned'
          else 'check_status_changed'
        end,
        v_actor,
        jsonb_strip_nulls(jsonb_build_object(
          'from_status', old.status,
          'to_status', new.status,
          'outcome', case when new.status = 'completed' then new.outcome else null end,
          'human_seconds', case when new.status = 'completed' then new.human_seconds else null end,
          'has_customer_message', case
            when new.status = 'more_info_required'
              then length(trim(coalesce(new.customer_message, ''))) > 0
            else null
          end
        )),
        'trigger:premium_checks:status'
      );
    end if;
  elsif new.customer_message is distinct from old.customer_message then
    perform public.premium_check_timeline_write(
      new.id,
      new.bill_id,
      new.user_id,
      'customer_message_updated',
      v_actor,
      jsonb_build_object(
        'status', new.status,
        'has_customer_message', length(trim(coalesce(new.customer_message, ''))) > 0
      ),
      'trigger:premium_checks:customer_message'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.premium_check_timeline_checks_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists premium_check_timeline_checks
  on public.premium_checks;
create trigger premium_check_timeline_checks
after insert or update of assigned_staff_id, status, outcome, customer_message, completed_at, human_seconds
on public.premium_checks
for each row execute procedure public.premium_check_timeline_checks_trigger();

-- ---------------------------------------------------------------------------
-- NOTE INTERNE.
-- ---------------------------------------------------------------------------

create or replace function public.premium_check_timeline_notes_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill_id uuid;
  v_user_id uuid;
begin
  select check_record.bill_id, check_record.user_id
    into v_bill_id, v_user_id
  from public.premium_checks as check_record
  where check_record.id = new.check_id;

  if found then
    perform public.premium_check_timeline_write(
      new.check_id,
      v_bill_id,
      v_user_id,
      'note_added',
      new.staff_user_id,
      jsonb_build_object(
        'note_id', new.id,
        'note_length', length(coalesce(new.note, ''))
      ),
      'trigger:premium_check_notes:insert'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.premium_check_timeline_notes_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists premium_check_timeline_notes
  on public.premium_check_notes;
create trigger premium_check_timeline_notes
after insert on public.premium_check_notes
for each row execute procedure public.premium_check_timeline_notes_trigger();

-- ---------------------------------------------------------------------------
-- ANOMALIE: inserimento e rimozione.
-- ---------------------------------------------------------------------------

create or replace function public.premium_check_timeline_anomalies_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.check_id is not null then
      perform public.premium_check_timeline_write(
        old.check_id,
        old.bill_id,
        old.user_id,
        'anomaly_removed',
        auth.uid(),
        jsonb_strip_nulls(jsonb_build_object(
          'anomaly_id', old.id,
          'category', old.category,
          'severity', old.severity,
          'title', nullif(left(trim(coalesce(old.title, '')), 240), ''),
          'estimated_impact_eur', old.estimated_impact_eur
        )),
        'trigger:premium_anomalies:delete'
      );
    end if;
    return old;
  end if;

  if new.check_id is not null then
    perform public.premium_check_timeline_write(
      new.check_id,
      new.bill_id,
      new.user_id,
      'anomaly_added',
      auth.uid(),
      jsonb_strip_nulls(jsonb_build_object(
        'anomaly_id', new.id,
        'category', new.category,
        'severity', new.severity,
        'title', nullif(left(trim(coalesce(new.title, '')), 240), ''),
        'estimated_impact_eur', new.estimated_impact_eur
      )),
      'trigger:premium_anomalies:insert'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.premium_check_timeline_anomalies_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists premium_check_timeline_anomalies
  on public.premium_anomalies;
create trigger premium_check_timeline_anomalies
after insert or delete on public.premium_anomalies
for each row execute procedure public.premium_check_timeline_anomalies_trigger();

-- ---------------------------------------------------------------------------
-- VALIDAZIONE IA: un solo evento aggregato, dopo che le field_reviews esistono.
-- ---------------------------------------------------------------------------

create or replace function public.premium_check_timeline_analysis_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_id uuid;
  v_user_id uuid;
  v_corrected_keys jsonb := '[]'::jsonb;
  v_event_type text;
begin
  if new.review_status <> 'validated' then
    return new;
  end if;

  if old.review_status = 'validated'
     and new.validated_at is not distinct from old.validated_at
     and new.validation_metrics is not distinct from old.validation_metrics then
    return new;
  end if;

  select check_record.id, check_record.user_id
    into v_check_id, v_user_id
  from public.premium_checks as check_record
  where check_record.bill_id = new.bill_id
    and check_record.status <> 'canceled'
  order by check_record.created_at desc, check_record.id desc
  limit 1;

  if v_check_id is null then
    return new;
  end if;

  select coalesce(jsonb_agg(review.field_key order by review.field_key), '[]'::jsonb)
    into v_corrected_keys
  from public.premium_analysis_field_reviews as review
  where review.analysis_run_id = new.id
    and review.decision = 'corrected';

  v_event_type := case
    when old.review_status = 'validated' then 'analysis_revalidated'
    else 'analysis_validated'
  end;

  perform public.premium_check_timeline_write(
    v_check_id,
    new.bill_id,
    v_user_id,
    v_event_type,
    coalesce(new.validated_by_staff_id, auth.uid()),
    jsonb_build_object(
      'analysis_run_id', new.id,
      'approved_fields', coalesce((new.validation_metrics ->> 'approved_fields')::integer, 0),
      'corrected_fields', coalesce((new.validation_metrics ->> 'corrected_fields')::integer, 0),
      'missing_fields', coalesce((new.validation_metrics ->> 'missing_fields')::integer, 0),
      'not_applicable_fields', coalesce((new.validation_metrics ->> 'not_applicable_fields')::integer, 0),
      'corrected_field_keys', coalesce(v_corrected_keys, '[]'::jsonb),
      'validation_seconds', coalesce(new.validation_seconds, 0)
    ),
    'trigger:premium_analysis_runs:validation'
  );

  return new;
end;
$$;

revoke all on function public.premium_check_timeline_analysis_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists premium_check_timeline_analysis
  on public.premium_analysis_runs;
create trigger premium_check_timeline_analysis
after update of review_status, validated_by_staff_id, validated_at, validation_metrics
on public.premium_analysis_runs
for each row execute procedure public.premium_check_timeline_analysis_trigger();

-- ---------------------------------------------------------------------------
-- COMUNICAZIONI collegate alla pratica: registra il passaggio, non il corpo.
-- ---------------------------------------------------------------------------

create or replace function public.premium_check_timeline_communications_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_event_type text;
begin
  if new.check_id is null then
    return new;
  end if;

  v_actor := case
    when new.direction = 'staff_to_user' then new.created_by_staff_id
    when new.direction = 'user_to_staff' then new.created_by_user_id
    else null
  end;

  v_event_type := case new.direction
    when 'staff_to_user' then 'communication_sent'
    when 'user_to_staff' then 'communication_received'
    else 'system_message_sent'
  end;

  perform public.premium_check_timeline_write(
    new.check_id,
    new.bill_id,
    new.user_id,
    v_event_type,
    v_actor,
    jsonb_build_object(
      'communication_id', new.id,
      'direction', new.direction,
      'channel', new.channel,
      'has_subject', length(trim(coalesce(new.subject, ''))) > 0
    ),
    'trigger:premium_communications:insert'
  );

  return new;
end;
$$;

revoke all on function public.premium_check_timeline_communications_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists premium_check_timeline_communications
  on public.premium_communications;
create trigger premium_check_timeline_communications
after insert on public.premium_communications
for each row execute procedure public.premium_check_timeline_communications_trigger();

-- ---------------------------------------------------------------------------
-- READER: unica superficie browser per la timeline.
-- V2.8 restringera' ulteriormente le aree per ruolo; qui si conserva
-- la compatibilita' con gli attuali ruoli tecnici del modulo controlli.
-- ---------------------------------------------------------------------------

create or replace function public.premium_staff_list_check_timeline(
  p_check_id uuid,
  p_limit integer default 250
)
returns table (
  event_id uuid,
  event_created_at timestamptz,
  event_type text,
  actor_user_id uuid,
  actor_label text,
  actor_email text,
  actor_role text,
  metadata jsonb,
  source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(public.premium_staff_raw_role(), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 250), 500));
begin
  if v_role not in ('reviewer', 'technician', 'admin', 'owner') then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  if p_check_id is null then
    raise exception 'premium_check_timeline_check_required' using errcode = '22023';
  end if;

  return query
  select
    event.id,
    event.created_at,
    event.event_type,
    event.actor_user_id,
    event.actor_label,
    event.actor_email,
    event.actor_role,
    event.metadata,
    event.source
  from public.premium_check_timeline_events as event
  where event.check_id = p_check_id
  order by event.created_at asc, event.id asc
  limit v_limit;
end;
$$;

revoke all on function public.premium_staff_list_check_timeline(uuid, integer)
  from public, anon;
grant execute on function public.premium_staff_list_check_timeline(uuid, integer)
  to authenticated;

commit;
