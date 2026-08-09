-- OffertaLogica Staff v2.3A - rollback.
-- Rimuove soltanto la RPC di elenco collaboratori.

begin;

drop function if exists public.premium_owner_list_staff();

commit;
