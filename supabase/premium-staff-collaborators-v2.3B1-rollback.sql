-- OffertaLogica Staff v2.3B1 - rollback delle sole RPC di gestione.
-- Non modifica alcun membro Staff. Eventuali modifiche effettuate tramite le RPC restano dati reali
-- e devono essere corrette esplicitamente prima del rollback se necessario.

begin;

drop function if exists public.premium_owner_update_staff(uuid, text, boolean);
drop function if exists public.premium_owner_add_staff(text, text);

commit;
