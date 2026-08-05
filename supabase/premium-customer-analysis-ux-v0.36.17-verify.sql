-- Verifica OFFERTALOGICA PREMIUM v0.36.17

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'premium_bills'
      and column_name = 'customer_analysis_data'
      and data_type = 'jsonb'
  ) then
    raise exception 'v0.36.17: colonna customer_analysis_data mancante';
  end if;

  if to_regprocedure('public.premium_customer_analysis_payload(jsonb)') is null then
    raise exception 'v0.36.17: funzione whitelist mancante';
  end if;

  if to_regprocedure('public.premium_sync_customer_analysis_data()') is null then
    raise exception 'v0.36.17: funzione trigger mancante';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'premium_analysis_runs_sync_customer_data'
      and tgrelid = 'public.premium_analysis_runs'::regclass
      and not tgisinternal
  ) then
    raise exception 'v0.36.17: trigger sincronizzazione mancante';
  end if;
end;
$$;

select
  count(*) filter (where customer_analysis_data <> '{}'::jsonb) as bollette_con_dati_visibili,
  count(*) as bollette_totali
from public.premium_bills
where deleted_at is null;

select
  bill.id,
  bill.original_file_name,
  bill.customer_analysis_data
from public.premium_bills bill
where bill.deleted_at is null
order by bill.created_at desc
limit 10;
