-- Rollback OFFERTALOGICA PREMIUM v0.36.17
-- ATTENZIONE: rimuove il sottoinsieme cliente già sincronizzato.

begin;

drop trigger if exists premium_analysis_runs_sync_customer_data
  on public.premium_analysis_runs;
drop function if exists public.premium_sync_customer_analysis_data();
drop function if exists public.premium_customer_analysis_payload(jsonb);
alter table public.premium_bills
  drop column if exists customer_analysis_data;

notify pgrst, 'reload schema';

commit;
