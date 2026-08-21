-- OffertaLogica Premium / FASE 2A
-- Seconda verifica IA dei soli casi rossi, senza nuove tabelle o API.
-- Incrementale e idempotente.

begin;

alter table public.premium_bills
  add column if not exists red_verification_state text not null default 'not_run',
  add column if not exists red_verification_result jsonb not null default '{}'::jsonb,
  add column if not exists red_verification_run_id uuid,
  add column if not exists red_verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'premium_bills_red_verification_state_check'
      and conrelid = 'public.premium_bills'::regclass
  ) then
    alter table public.premium_bills
      add constraint premium_bills_red_verification_state_check
      check (red_verification_state in (
        'not_run', 'running', 'resolved_ai', 'quick_verify', 'staff_required', 'inconclusive', 'failed'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'premium_bills_red_verification_run_fk'
      and conrelid = 'public.premium_bills'::regclass
  ) then
    alter table public.premium_bills
      add constraint premium_bills_red_verification_run_fk
      foreign key (red_verification_run_id)
      references public.premium_analysis_runs(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists premium_bills_red_verification_state_idx
  on public.premium_bills (red_verification_state, created_at desc);

-- Il secondo passaggio è un run IA distinto, così costi/token restano misurabili.
alter table public.premium_analysis_runs
  drop constraint if exists premium_analysis_runs_origin_check;
alter table public.premium_analysis_runs
  add constraint premium_analysis_runs_origin_check
  check (origin in ('customer_upload', 'staff_manual', 'red_verification'));

comment on column public.premium_bills.red_verification_state is
  'Stato della seconda verifica IA dei casi rossi: risolto IA, verifica rapida o Staff necessario.';
comment on column public.premium_bills.red_verification_result is
  'JSON strutturato della seconda verifica IA: issue, evidence, verification_result, confidence, can_resolve_alone, customer_reply, escalation_reason, missing_data, route e decision.';
comment on column public.premium_bills.red_verification_run_id is
  'Run IA dedicato alla seconda verifica del caso rosso.';

-- Impedisce a un client autenticato di autocertificare l'esito IA. Il backend
-- con service_role usa role=service_role e può aggiornare i campi.
create or replace function public.premium_guard_red_verification_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
begin
  -- Supabase/PostgREST può esporre il ruolo sia nel claim singolo sia nel JSON
  -- completo. Il fallback mantiene il guard efficace in entrambe le modalità.
  if v_role = '' and v_claims <> '' then
    begin
      v_role := coalesce(v_claims::jsonb ->> 'role', '');
    exception when others then
      v_role := '';
    end;
  end if;

  if v_role = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.red_verification_state <> 'not_run'
         or new.red_verification_result <> '{}'::jsonb
         or new.red_verification_run_id is not null
         or new.red_verified_at is not null then
        raise exception 'premium_red_verification_server_only' using errcode = '42501';
      end if;
    elsif new.red_verification_state is distinct from old.red_verification_state
       or new.red_verification_result is distinct from old.red_verification_result
       or new.red_verification_run_id is distinct from old.red_verification_run_id
       or new.red_verified_at is distinct from old.red_verified_at then
      raise exception 'premium_red_verification_server_only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.premium_guard_red_verification_client_write() from public, anon, authenticated;

drop trigger if exists premium_bills_guard_red_verification on public.premium_bills;
create trigger premium_bills_guard_red_verification
before insert or update of red_verification_state, red_verification_result, red_verification_run_id, red_verified_at
on public.premium_bills
for each row execute procedure public.premium_guard_red_verification_client_write();

commit;
