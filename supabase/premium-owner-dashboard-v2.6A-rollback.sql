-- OffertaLogica Staff v2.6A - rollback.
-- Rimuove soltanto la RPC aggregata Owner; nessun dato viene toccato.

begin;

drop function if exists public.premium_owner_dashboard_metrics();

commit;
