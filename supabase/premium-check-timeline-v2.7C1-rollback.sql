-- OffertaLogica Staff v2.7C1 — ROLLBACK DI EMERGENZA
-- ATTENZIONE: elimina anche lo storico timeline gia' raccolto dopo l'installazione.

begin;

drop trigger if exists premium_check_timeline_communications
  on public.premium_communications;
drop trigger if exists premium_check_timeline_analysis
  on public.premium_analysis_runs;
drop trigger if exists premium_check_timeline_anomalies
  on public.premium_anomalies;
drop trigger if exists premium_check_timeline_notes
  on public.premium_check_notes;
drop trigger if exists premium_check_timeline_checks
  on public.premium_checks;

drop function if exists public.premium_check_timeline_communications_trigger();
drop function if exists public.premium_check_timeline_analysis_trigger();
drop function if exists public.premium_check_timeline_anomalies_trigger();
drop function if exists public.premium_check_timeline_notes_trigger();
drop function if exists public.premium_check_timeline_checks_trigger();
drop function if exists public.premium_staff_list_check_timeline(uuid, integer);
drop function if exists public.premium_check_timeline_write(
  uuid, uuid, uuid, text, uuid, jsonb, text
);

drop table if exists public.premium_check_timeline_events;

commit;
