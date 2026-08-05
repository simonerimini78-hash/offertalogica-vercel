-- OFFERTALOGICA PREMIUM v0.36.17
-- Espone al proprietario della bolletta soltanto un sottoinsieme sicuro dei dati
-- letti dalla IA. I dati tecnici completi restano in premium_analysis_runs e
-- continuano a essere accessibili esclusivamente allo staff.
-- Script incrementale e idempotente.

begin;

alter table public.premium_bills
  add column if not exists customer_analysis_data jsonb not null default '{}'::jsonb;

comment on column public.premium_bills.customer_analysis_data is
  'Sottoinsieme whitelist dei dati letti dalla bolletta, visibile al proprietario. Esclude dati tecnici IA e dati personali non necessari.';

create or replace function public.premium_customer_analysis_payload(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'commodity', nullif(btrim(coalesce(p_data ->> 'commodity', '')), ''),
    'fornitore', nullif(btrim(coalesce(p_data ->> 'fornitore', '')), ''),
    'fornitore_luce', coalesce(
      nullif(btrim(coalesce(p_data ->> 'fornitore_luce', '')), ''),
      nullif(btrim(coalesce(p_data ->> 'fornitore', '')), '')
    ),
    'fornitore_gas', coalesce(
      nullif(btrim(coalesce(p_data ->> 'fornitore_gas', '')), ''),
      nullif(btrim(coalesce(p_data ->> 'fornitore', '')), '')
    ),
    'nome_offerta_luce', coalesce(
      nullif(btrim(coalesce(p_data ->> 'nome_offerta_luce', '')), ''),
      nullif(btrim(coalesce(p_data ->> 'nome_offerta', '')), '')
    ),
    'nome_offerta_gas', coalesce(
      nullif(btrim(coalesce(p_data ->> 'nome_offerta_gas', '')), ''),
      nullif(btrim(coalesce(p_data ->> 'nome_offerta', '')), '')
    ),
    'codice_offerta_luce', coalesce(
      nullif(btrim(coalesce(p_data ->> 'codice_offerta_luce', '')), ''),
      nullif(btrim(coalesce(p_data ->> 'codice_offerta', '')), '')
    ),
    'codice_offerta_gas', coalesce(
      nullif(btrim(coalesce(p_data ->> 'codice_offerta_gas', '')), ''),
      nullif(btrim(coalesce(p_data ->> 'codice_offerta', '')), '')
    ),
    'pod', nullif(btrim(coalesce(p_data ->> 'pod', '')), ''),
    'pdr', nullif(btrim(coalesce(p_data ->> 'pdr', '')), ''),
    'billing_period_start', nullif(btrim(coalesce(p_data ->> 'billing_period_start', '')), ''),
    'billing_period_end', nullif(btrim(coalesce(p_data ->> 'billing_period_end', '')), ''),
    'issue_date', nullif(btrim(coalesce(p_data ->> 'issue_date', '')), ''),
    'due_date', nullif(btrim(coalesce(p_data ->> 'due_date', '')), ''),
    'total_amount_eur', p_data -> 'total_amount_eur',
    'consumo_luce_kwh', p_data -> 'consumo_luce_kwh',
    'consumo_luce_f1_kwh', p_data -> 'consumo_luce_f1_kwh',
    'consumo_luce_f2_kwh', p_data -> 'consumo_luce_f2_kwh',
    'consumo_luce_f3_kwh', p_data -> 'consumo_luce_f3_kwh',
    'consumo_luce_f23_kwh', p_data -> 'consumo_luce_f23_kwh',
    'prezzo_luce_eur_kwh', p_data -> 'prezzo_luce_eur_kwh',
    'prezzo_luce_f0_eur_kwh', p_data -> 'prezzo_luce_f0_eur_kwh',
    'prezzo_luce_f1_eur_kwh', p_data -> 'prezzo_luce_f1_eur_kwh',
    'prezzo_luce_f2_eur_kwh', p_data -> 'prezzo_luce_f2_eur_kwh',
    'prezzo_luce_f3_eur_kwh', p_data -> 'prezzo_luce_f3_eur_kwh',
    'prezzo_luce_f23_eur_kwh', p_data -> 'prezzo_luce_f23_eur_kwh',
    'quota_fissa_vendita_luce_eur_anno', p_data -> 'quota_fissa_vendita_luce_eur_anno',
    'potenza_impegnata_kw', p_data -> 'potenza_impegnata_kw',
    'tipo_prezzo_luce', nullif(btrim(coalesce(p_data ->> 'tipo_prezzo_luce', '')), ''),
    'indice_riferimento_luce', nullif(btrim(coalesce(p_data ->> 'indice_riferimento_luce', '')), ''),
    'spread_luce_eur_kwh', p_data -> 'spread_luce_eur_kwh',
    'formula_prezzo_luce', nullif(btrim(coalesce(p_data ->> 'formula_prezzo_luce', '')), ''),
    'scadenza_condizioni_economiche_luce', nullif(btrim(coalesce(p_data ->> 'scadenza_condizioni_economiche_luce', '')), ''),
    'consumo_gas_smc', p_data -> 'consumo_gas_smc',
    'prezzo_gas_eur_smc', p_data -> 'prezzo_gas_eur_smc',
    'quota_fissa_vendita_gas_eur_anno', p_data -> 'quota_fissa_vendita_gas_eur_anno',
    'tipo_prezzo_gas', nullif(btrim(coalesce(p_data ->> 'tipo_prezzo_gas', '')), ''),
    'indice_riferimento_gas', nullif(btrim(coalesce(p_data ->> 'indice_riferimento_gas', '')), ''),
    'spread_gas_eur_smc', p_data -> 'spread_gas_eur_smc',
    'formula_prezzo_gas', nullif(btrim(coalesce(p_data ->> 'formula_prezzo_gas', '')), ''),
    'scadenza_condizioni_economiche_gas', nullif(btrim(coalesce(p_data ->> 'scadenza_condizioni_economiche_gas', '')), '')
  ));
$$;

create or replace function public.premium_sync_customer_analysis_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source jsonb;
  v_payload jsonb;
begin
  if new.status not in ('completed', 'partial') then
    return new;
  end if;

  v_source := case
    when new.review_status = 'validated'
      and jsonb_typeof(new.validated_data) = 'object'
      and new.validated_data <> '{}'::jsonb
      then new.validated_data
    else coalesce(new.extracted_data, '{}'::jsonb)
  end;

  v_payload := public.premium_customer_analysis_payload(v_source);
  if v_payload = '{}'::jsonb then
    return new;
  end if;

  update public.premium_bills bill
  set customer_analysis_data = v_payload,
      updated_at = now()
  where bill.id = new.bill_id
    and bill.user_id = new.user_id
    and bill.customer_analysis_data is distinct from v_payload;

  return new;
end;
$$;

drop trigger if exists premium_analysis_runs_sync_customer_data
  on public.premium_analysis_runs;
create trigger premium_analysis_runs_sync_customer_data
  after insert or update of status, extracted_data, validated_data, review_status
  on public.premium_analysis_runs
  for each row execute function public.premium_sync_customer_analysis_data();

-- Recupera anche le analisi già presenti: per ogni bolletta usa la lettura più
-- recente conclusa e preferisce i dati convalidati dallo staff, se disponibili.
with latest_run as (
  select distinct on (run.bill_id)
    run.bill_id,
    run.user_id,
    case
      when run.review_status = 'validated'
        and jsonb_typeof(run.validated_data) = 'object'
        and run.validated_data <> '{}'::jsonb
        then run.validated_data
      else coalesce(run.extracted_data, '{}'::jsonb)
    end as source_data
  from public.premium_analysis_runs run
  where run.status in ('completed', 'partial')
  order by run.bill_id, run.completed_at desc nulls last, run.run_number desc, run.created_at desc
), payloads as (
  select
    latest_run.bill_id,
    latest_run.user_id,
    public.premium_customer_analysis_payload(latest_run.source_data) as payload
  from latest_run
)
update public.premium_bills bill
set customer_analysis_data = payloads.payload,
    updated_at = now()
from payloads
where bill.id = payloads.bill_id
  and bill.user_id = payloads.user_id
  and payloads.payload <> '{}'::jsonb
  and bill.customer_analysis_data is distinct from payloads.payload;

revoke all on function public.premium_customer_analysis_payload(jsonb)
  from public, anon, authenticated;
revoke all on function public.premium_sync_customer_analysis_data()
  from public, anon, authenticated;
grant execute on function public.premium_customer_analysis_payload(jsonb) to service_role;
grant execute on function public.premium_sync_customer_analysis_data() to service_role;

notify pgrst, 'reload schema';

commit;
