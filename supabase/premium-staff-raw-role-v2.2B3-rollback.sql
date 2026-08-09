-- OffertaLogica Staff v2.2B3 - rollback
-- Rimuove SOLO l'helper raw role introdotto da B3.
-- Non modifica membri Staff, ruoli, vincoli o helper legacy A4.

begin;

drop function if exists public.premium_staff_raw_role();

commit;
