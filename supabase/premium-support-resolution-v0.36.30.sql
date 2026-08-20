-- OffertaLogica Premium / Staff
-- FASE 1: separazione stato pratica da stato lettura messaggi.
-- Base auditata: staff-v2-control-center @ ae452d44b1e2304be45bcbb86246b12edf2f0a40
-- Incrementale: aggiunge resolved_at senza creare nuove tabelle o API.

begin;

alter table public.premium_communications
  add column if not exists resolved_at timestamptz;

comment on column public.premium_communications.resolved_at is
  'Timestamp di risoluzione operativa della richiesta user_to_staff; distinto da read_at, che indica la lettura del messaggio da parte del destinatario.';

-- Storico: fino a questa migrazione read_at sui messaggi cliente era usato
-- dal Control Center come marcatore di chiusura. Trasferiamo quel significato
-- in resolved_at e liberiamo read_at per la sola semantica di lettura.
update public.premium_communications
set
  resolved_at = read_at,
  read_at = null
where direction = 'user_to_staff'
  and subject like '[support:%'
  and resolved_at is null
  and read_at is not null;

-- Lo Staff autenticato deve poter valorizzare resolved_at. Le RLS continuano
-- a decidere quali righe sono aggiornabili.
grant update (resolved_at) on public.premium_communications to authenticated;

-- Il cliente può creare soltanto richieste non già risolte.
drop policy if exists premium_communications_owner_insert on public.premium_communications;
create policy premium_communications_owner_insert
on public.premium_communications for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and direction = 'user_to_staff'
  and created_by_user_id = (select auth.uid())
  and created_by_staff_id is null
  and resolved_at is null
);

commit;
