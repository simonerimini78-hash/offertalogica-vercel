-- OFFERTALOGICA PREMIUM v0.36.8
-- Registro affidabile delle esecuzioni della cancellazione automatica.
-- I PDF vengono eliminati dalla Edge Function tramite Storage API; soltanto
-- dopo la rimozione fisica viene chiamata premium_finalize_trial_data_purge().

begin;

create table if not exists public.premium_trial_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null default 'cron'
    check (trigger_source in ('cron', 'manual', 'manual_dry_run', 'test')),
  dry_run boolean not null default false,
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed')),
  requested_limit integer not null default 25 check (requested_limit between 1 and 100),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  purged_count integer not null default 0 check (purged_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  details jsonb not null default '[]'::jsonb,
  error_message text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.premium_trial_cleanup_runs enable row level security;

create index if not exists premium_trial_cleanup_runs_started_idx
  on public.premium_trial_cleanup_runs (started_at desc);

create unique index if not exists premium_trial_cleanup_single_running_idx
  on public.premium_trial_cleanup_runs ((1))
  where status = 'running';

comment on table public.premium_trial_cleanup_runs is
  'Registro interno delle cancellazioni automatiche dei dati Premium scaduti. Non accessibile agli utenti.';

revoke all on table public.premium_trial_cleanup_runs from public, anon, authenticated;
grant select, insert, update on table public.premium_trial_cleanup_runs to service_role;

create or replace function public.premium_begin_trial_cleanup_run(
  p_source text default 'cron',
  p_dry_run boolean default false,
  p_limit integer default 25
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_source text := case
    when p_source in ('cron', 'manual', 'manual_dry_run', 'test') then p_source
    else 'cron'
  end;
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  -- Una funzione interrotta non deve bloccare per sempre i tentativi successivi.
  update public.premium_trial_cleanup_runs run_record
  set
    status = 'failed',
    completed_at = now(),
    error_message = case
      when run_record.error_message = '' then 'stale_run_released'
      else run_record.error_message
    end
  where run_record.status = 'running'
    and run_record.started_at < now() - interval '30 minutes';

  insert into public.premium_trial_cleanup_runs (
    trigger_source,
    dry_run,
    status,
    requested_limit
  )
  values (
    v_source,
    coalesce(p_dry_run, false),
    'running',
    v_limit
  )
  returning id into v_run_id;

  return v_run_id;
exception
  when unique_violation then
    raise exception 'premium_cleanup_already_running' using errcode = 'P0001';
end;
$$;

revoke all on function public.premium_begin_trial_cleanup_run(text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.premium_begin_trial_cleanup_run(text, boolean, integer)
  to service_role;

create or replace function public.premium_finish_trial_cleanup_run(
  p_run_id uuid,
  p_status text,
  p_candidate_count integer,
  p_purged_count integer,
  p_failed_count integer,
  p_details jsonb default '[]'::jsonb,
  p_error_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_row public.premium_trial_cleanup_runs%rowtype;
begin
  if p_run_id is null then
    raise exception 'premium_cleanup_run_id_required' using errcode = '22023';
  end if;

  if p_status not in ('completed', 'partial', 'failed') then
    raise exception 'premium_cleanup_run_status_invalid' using errcode = '22023';
  end if;
  v_status := p_status;

  update public.premium_trial_cleanup_runs run_record
  set
    status = v_status,
    candidate_count = greatest(0, coalesce(p_candidate_count, 0)),
    purged_count = greatest(0, coalesce(p_purged_count, 0)),
    failed_count = greatest(0, coalesce(p_failed_count, 0)),
    details = case when jsonb_typeof(coalesce(p_details, '[]'::jsonb)) = 'array'
      then coalesce(p_details, '[]'::jsonb)
      else '[]'::jsonb
    end,
    error_message = left(coalesce(p_error_message, ''), 1000),
    completed_at = now()
  where run_record.id = p_run_id
    and run_record.status = 'running'
  returning * into v_row;

  if not found then
    raise exception 'premium_cleanup_run_not_running' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_row.id,
    'status', v_row.status,
    'candidate_count', v_row.candidate_count,
    'purged_count', v_row.purged_count,
    'failed_count', v_row.failed_count,
    'completed_at', v_row.completed_at
  );
end;
$$;

revoke all on function public.premium_finish_trial_cleanup_run(uuid, text, integer, integer, integer, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.premium_finish_trial_cleanup_run(uuid, text, integer, integer, integer, jsonb, text)
  to service_role;

commit;
