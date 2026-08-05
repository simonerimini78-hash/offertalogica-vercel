-- Rollback tecnico OFFERTALOGICA PREMIUM v0.36.16
-- Rimuove soltanto la RPC aggiunta. Non elimina profili, consensi, bollette,
-- abbonamenti o ruoli staff eventualmente gia presenti.

begin;

revoke all on function public.premium_ensure_current_user_profile()
  from public, anon, authenticated, service_role;
drop function if exists public.premium_ensure_current_user_profile();

commit;
