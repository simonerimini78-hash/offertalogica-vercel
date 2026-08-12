-- OffertaLogica Staff v2.8B1 — rollback
-- Rimuove soltanto la RPC di stato inviti introdotta da V2.8B1.

begin;

drop function if exists public.premium_owner_list_staff_activation_status();

commit;
