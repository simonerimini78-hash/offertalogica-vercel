-- Rollback OffertaLogica Premium - cancellazione richieste assistenza.
-- Ripristina i privilegi precedenti: nessuna cancellazione diretta
-- di premium_communications dal client autenticato.

begin;

drop policy if exists premium_communications_owner_delete_support
on public.premium_communications;

revoke delete on table public.premium_communications from authenticated;

commit;
