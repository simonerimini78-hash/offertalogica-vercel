-- OFFERTALOGICA PREMIUM v0.29
-- Validazione umana campo per campo delle pre-analisi IA.
-- Script incrementale e idempotente. Non pubblica dati al cliente e non conclude i controlli.

begin;

alter table public.premium_analysis_runs
  add column if not exists review_status text not null default 'pending';

alter table public.premium_analysis_runs
  add column if not exists validated_by_staff_id uuid
    references public.premium_staff_members(user_id)
    on delete set null;

alter table public.premium_analysis_runs
  add column if not exists validated_at timestamptz;

alter table public.premium_analysis_runs
  add column if not exists validation_seconds integer not null default 0;

alter table public.premium_analysis_runs
  add column if not exists validation_note text not null default '';

alter table public.premium_analysis_runs
  add column if not exists validation_metrics jsonb not null default '{}'::jsonb;

alter table public.premium_analysis_runs
  add column if not exists validated_data jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'premium_analysis_runs_review_status_check'
      and conrelid = 'public.premium_analysis_runs'::regclass
  ) then
    alter table public.premium_analysis_runs
      add constraint premium_analysis_runs_review_status_check
      check (review_status in ('pending', 'validated'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'premium_analysis_runs_validation_seconds_check'
      and conrelid = 'public.premium_analysis_runs'::regclass
  ) then
    alter table public.premium_analysis_runs
      add constraint premium_analysis_runs_validation_seconds_check
      check (validation_seconds >= 0);
  end if;
end;
$$;

create table if not exists public.premium_analysis_field_reviews (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.premium_analysis_runs(id) on delete cascade,
  field_key text not null,
  commodity text not null default 'general'
    check (commodity in ('general', 'luce', 'gas')),
  ai_value jsonb,
  reviewed_value jsonb,
  decision text not null
    check (decision in ('approved', 'corrected', 'missing', 'not_applicable')),
  note text not null default '',
  staff_user_id uuid not null references public.premium_staff_members(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_run_id, field_key)
);

create index if not exists premium_analysis_field_reviews_run_idx
  on public.premium_analysis_field_reviews (analysis_run_id, field_key);

create index if not exists premium_analysis_runs_validation_idx
  on public.premium_analysis_runs (review_status, validated_at desc);

drop trigger if exists premium_analysis_field_reviews_set_updated_at
  on public.premium_analysis_field_reviews;
create trigger premium_analysis_field_reviews_set_updated_at
  before update on public.premium_analysis_field_reviews
  for each row execute procedure public.premium_set_updated_at();

alter table public.premium_analysis_field_reviews enable row level security;

revoke all on table public.premium_analysis_field_reviews from public, anon;
grant select, insert, update, delete on table public.premium_analysis_field_reviews to authenticated;
grant all on table public.premium_analysis_field_reviews to service_role;

drop policy if exists premium_analysis_field_reviews_staff_all
  on public.premium_analysis_field_reviews;
create policy premium_analysis_field_reviews_staff_all
on public.premium_analysis_field_reviews for all to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])))
with check ((select public.premium_is_staff(array['reviewer', 'admin'])));

create or replace function public.premium_staff_validate_analysis(
  p_analysis_run_id uuid,
  p_fields jsonb,
  p_review_seconds integer default 0,
  p_validation_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_role text := public.premium_staff_role();
  v_bill_id uuid;
  v_run_status text;
  v_run_data jsonb;
  v_check_status text;
  v_assigned_staff_id uuid;
  v_item jsonb;
  v_field_key text;
  v_decision text;
  v_note text;
  v_commodity text;
  v_ai_value jsonb;
  v_reviewed_value jsonb;
  v_final_value jsonb;
  v_validated_data jsonb;
  v_seen_keys text[] := array[]::text[];
  v_allowed_fields constant text[] := array[
    'commodity',
    'fornitore_luce',
    'consumo_luce_kwh',
    'prezzo_luce_eur_kwh',
    'quota_fissa_vendita_luce_eur_anno',
    'tipo_prezzo_luce',
    'indice_riferimento_luce',
    'formula_prezzo_luce',
    'fornitore_gas',
    'consumo_gas_smc',
    'prezzo_gas_eur_smc',
    'quota_fissa_vendita_gas_eur_anno',
    'tipo_prezzo_gas',
    'indice_riferimento_gas',
    'formula_prezzo_gas'
  ]::text[];
  v_fields_total integer := 0;
  v_approved integer := 0;
  v_corrected integer := 0;
  v_missing integer := 0;
  v_not_applicable integer := 0;
  v_applicable integer := 0;
  v_accuracy numeric(6,2) := 0;
  v_correction_rate numeric(6,2) := 0;
  v_metrics jsonb;
begin
  if v_staff_id is null or v_role is null then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  if p_analysis_run_id is null then
    raise exception 'premium_analysis_run_required' using errcode = '22023';
  end if;

  if p_fields is null
     or jsonb_typeof(p_fields) <> 'array'
     or jsonb_array_length(p_fields) = 0 then
    raise exception 'premium_analysis_fields_required' using errcode = '22023';
  end if;

  select run.bill_id, run.status, run.extracted_data
  into v_bill_id, v_run_status, v_run_data
  from public.premium_analysis_runs run
  where run.id = p_analysis_run_id
  for update;

  if not found then
    raise exception 'premium_analysis_run_not_found' using errcode = 'P0002';
  end if;

  if v_run_status not in ('completed', 'partial') then
    raise exception 'premium_analysis_not_reviewable' using errcode = 'P0001';
  end if;

  select check_record.status, check_record.assigned_staff_id
  into v_check_status, v_assigned_staff_id
  from public.premium_checks check_record
  where check_record.bill_id = v_bill_id
  order by check_record.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'premium_check_not_found' using errcode = 'P0002';
  end if;

  if v_check_status = 'pending' or v_assigned_staff_id is null then
    raise exception 'premium_check_must_be_claimed' using errcode = 'P0001';
  end if;

  if v_assigned_staff_id <> v_staff_id and v_role <> 'admin' then
    raise exception 'premium_check_assigned_to_other_staff' using errcode = '42501';
  end if;

  v_validated_data := coalesce(v_run_data, '{}'::jsonb);

  delete from public.premium_analysis_field_reviews
  where analysis_run_id = p_analysis_run_id;

  for v_item in select value from jsonb_array_elements(p_fields)
  loop
    v_field_key := trim(coalesce(v_item ->> 'field_key', ''));
    v_decision := trim(coalesce(v_item ->> 'decision', ''));
    v_note := left(trim(coalesce(v_item ->> 'note', '')), 1000);

    if v_field_key = '' or not (v_field_key = any(v_allowed_fields)) then
      raise exception 'premium_invalid_analysis_field:%', v_field_key using errcode = '22023';
    end if;

    if v_field_key = any(v_seen_keys) then
      raise exception 'premium_duplicate_analysis_field:%', v_field_key using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_field_key);

    if v_decision not in ('approved', 'corrected', 'missing', 'not_applicable') then
      raise exception 'premium_invalid_analysis_decision:%', v_field_key using errcode = '22023';
    end if;

    v_commodity := case
      when v_field_key like '%_luce%' then 'luce'
      when v_field_key like '%_gas%' then 'gas'
      else 'general'
    end;

    v_ai_value := case v_field_key
      when 'fornitore_luce' then coalesce(v_run_data -> 'fornitore_luce', v_run_data -> 'fornitore')
      when 'fornitore_gas' then coalesce(v_run_data -> 'fornitore_gas', v_run_data -> 'fornitore')
      else v_run_data -> v_field_key
    end;

    v_reviewed_value := v_item -> 'reviewed_value';

    if v_decision = 'approved' then
      if v_ai_value is null
         or v_ai_value = 'null'::jsonb
         or (jsonb_typeof(v_ai_value) = 'string' and length(trim(v_ai_value #>> '{}')) = 0) then
        raise exception 'premium_cannot_approve_missing_value:%', v_field_key using errcode = '22023';
      end if;
      v_final_value := v_ai_value;
      v_approved := v_approved + 1;
    elsif v_decision = 'corrected' then
      if v_reviewed_value is null
         or v_reviewed_value = 'null'::jsonb
         or (jsonb_typeof(v_reviewed_value) = 'string' and length(trim(v_reviewed_value #>> '{}')) = 0) then
        raise exception 'premium_corrected_value_required:%', v_field_key using errcode = '22023';
      end if;
      v_final_value := v_reviewed_value;
      v_corrected := v_corrected + 1;
    elsif v_decision = 'missing' then
      v_final_value := 'null'::jsonb;
      v_missing := v_missing + 1;
    else
      v_final_value := null;
      v_not_applicable := v_not_applicable + 1;
    end if;

    insert into public.premium_analysis_field_reviews (
      analysis_run_id,
      field_key,
      commodity,
      ai_value,
      reviewed_value,
      decision,
      note,
      staff_user_id
    ) values (
      p_analysis_run_id,
      v_field_key,
      v_commodity,
      v_ai_value,
      case when v_decision = 'approved' then v_ai_value else v_reviewed_value end,
      v_decision,
      v_note,
      v_staff_id
    );

    if v_decision = 'not_applicable' then
      v_validated_data := v_validated_data - v_field_key;
    else
      v_validated_data := jsonb_set(v_validated_data, array[v_field_key], v_final_value, true);
    end if;

    v_fields_total := v_fields_total + 1;
  end loop;

  v_applicable := v_approved + v_corrected + v_missing;
  if v_applicable = 0 then
    raise exception 'premium_no_applicable_analysis_fields' using errcode = '22023';
  end if;

  v_accuracy := round((v_approved::numeric * 100) / v_applicable, 2);
  v_correction_rate := round((v_corrected::numeric * 100) / v_applicable, 2);

  v_metrics := jsonb_build_object(
    'fields_total', v_fields_total,
    'applicable_fields', v_applicable,
    'approved_fields', v_approved,
    'corrected_fields', v_corrected,
    'missing_fields', v_missing,
    'not_applicable_fields', v_not_applicable,
    'accuracy_pct', v_accuracy,
    'correction_rate_pct', v_correction_rate,
    'validation_seconds', greatest(0, least(coalesce(p_review_seconds, 0), 86400)),
    'metric_definition', 'approved_fields / applicable_fields',
    'validated_at', now()
  );

  update public.premium_analysis_runs
  set
    review_status = 'validated',
    validated_by_staff_id = v_staff_id,
    validated_at = now(),
    validation_seconds = greatest(0, least(coalesce(p_review_seconds, 0), 86400)),
    validation_note = left(trim(coalesce(p_validation_note, '')), 2000),
    validation_metrics = v_metrics,
    validated_data = v_validated_data
  where id = p_analysis_run_id;

  return v_metrics;
end;
$$;

revoke all on function public.premium_staff_validate_analysis(uuid, jsonb, integer, text)
  from public, anon;
grant execute on function public.premium_staff_validate_analysis(uuid, jsonb, integer, text)
  to authenticated, service_role;

comment on table public.premium_analysis_field_reviews is
  'Confronto campo per campo tra bozza IA e dato verificato dallo staff. Mai visibile al cliente.';

comment on column public.premium_analysis_runs.validation_metrics is
  'Metriche di accordo campo per campo. accuracy_pct indica approved_fields/applicable_fields, non accuratezza scientifica generale del modello.';

commit;
