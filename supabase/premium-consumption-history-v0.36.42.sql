-- OFFERTALOGICA PREMIUM v0.36.42
-- Conserva nel profilo cliente i consumi del singolo periodo fatturato.
-- Nessuna nuova tabella: i dati restano in premium_analysis_runs e premium_bills.customer_analysis_data.
-- Script incrementale e idempotente.

begin;

create or replace function public.premium_sync_customer_period_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period jsonb;
  v_luce jsonb;
  v_gas jsonb;
begin
  if new.status not in ('completed', 'partial') then
    return new;
  end if;

  -- Se lo staff ha convalidato altri campi ma non ha riscritto il consumo del
  -- periodo, conserva il valore estratto dalla stessa analisi invece di perderlo.
  v_luce := coalesce(
    case when jsonb_typeof(new.validated_data) = 'object' then new.validated_data -> 'consumo_periodo_luce_kwh' end,
    case when jsonb_typeof(new.extracted_data) = 'object' then new.extracted_data -> 'consumo_periodo_luce_kwh' end
  );
  v_gas := coalesce(
    case when jsonb_typeof(new.validated_data) = 'object' then new.validated_data -> 'consumo_periodo_gas_smc' end,
    case when jsonb_typeof(new.extracted_data) = 'object' then new.extracted_data -> 'consumo_periodo_gas_smc' end
  );

  v_period := jsonb_strip_nulls(jsonb_build_object(
    'consumo_periodo_luce_kwh', v_luce,
    'consumo_periodo_gas_smc', v_gas
  ));

  if v_period = '{}'::jsonb then
    return new;
  end if;

  update public.premium_bills bill
  set customer_analysis_data = coalesce(bill.customer_analysis_data, '{}'::jsonb) || v_period,
      updated_at = now()
  where bill.id = new.bill_id
    and bill.user_id = new.user_id
    and coalesce(bill.customer_analysis_data, '{}'::jsonb) @> v_period is not true;

  return new;
end;
$$;

-- Il trigger esistente premium_analysis_runs_sync_customer_data continua a
-- gestire la whitelist principale. Questo trigger, ordinato dopo quello per nome,
-- aggiunge soltanto i due consumi del periodo senza cambiare gli altri dati.
drop trigger if exists premium_analysis_runs_sync_customer_period_data
  on public.premium_analysis_runs;
create trigger premium_analysis_runs_sync_customer_period_data
  after insert or update of status, extracted_data, validated_data, review_status
  on public.premium_analysis_runs
  for each row execute function public.premium_sync_customer_period_consumption();

-- Backfill delle analisi già concluse: per ogni bolletta usa l'ultima analisi
-- che contiene almeno uno dei due consumi del periodo.
with period_runs as (
  select distinct on (run.bill_id)
    run.bill_id,
    run.user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'consumo_periodo_luce_kwh', coalesce(
        case when jsonb_typeof(run.validated_data) = 'object' then run.validated_data -> 'consumo_periodo_luce_kwh' end,
        case when jsonb_typeof(run.extracted_data) = 'object' then run.extracted_data -> 'consumo_periodo_luce_kwh' end
      ),
      'consumo_periodo_gas_smc', coalesce(
        case when jsonb_typeof(run.validated_data) = 'object' then run.validated_data -> 'consumo_periodo_gas_smc' end,
        case when jsonb_typeof(run.extracted_data) = 'object' then run.extracted_data -> 'consumo_periodo_gas_smc' end
      )
    )) as period_data
  from public.premium_analysis_runs run
  where run.status in ('completed', 'partial')
    and (
      coalesce(run.validated_data, '{}'::jsonb) ?| array['consumo_periodo_luce_kwh', 'consumo_periodo_gas_smc']
      or coalesce(run.extracted_data, '{}'::jsonb) ?| array['consumo_periodo_luce_kwh', 'consumo_periodo_gas_smc']
    )
  order by run.bill_id, run.completed_at desc nulls last, run.run_number desc, run.created_at desc
)
update public.premium_bills bill
set customer_analysis_data = coalesce(bill.customer_analysis_data, '{}'::jsonb) || period_runs.period_data,
    updated_at = now()
from period_runs
where bill.id = period_runs.bill_id
  and bill.user_id = period_runs.user_id
  and period_runs.period_data <> '{}'::jsonb
  and coalesce(bill.customer_analysis_data, '{}'::jsonb) @> period_runs.period_data is not true;

revoke all on function public.premium_sync_customer_period_consumption()
  from public, anon, authenticated;
grant execute on function public.premium_sync_customer_period_consumption() to service_role;

notify pgrst, 'reload schema';

commit;
