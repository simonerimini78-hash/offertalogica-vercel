-- Rollback strumenti staff account/accesso.
begin;

drop function if exists public.premium_staff_account_support_snapshot(uuid);

commit;
