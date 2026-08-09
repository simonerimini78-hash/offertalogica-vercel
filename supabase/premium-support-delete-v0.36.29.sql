-- OffertaLogica Premium
-- Assistenza: cancellazione richieste cliente/staff
-- Incrementale e reversibile a livello di privilegi/policy.
-- Non modifica dati automaticamente.

begin;

-- La policy staff "premium_communications_staff_all" esiste gia,
-- ma il ruolo authenticated non aveva il privilegio SQL DELETE.
grant delete on table public.premium_communications to authenticated;

-- Il cliente puo eliminare esclusivamente comunicazioni di assistenza
-- appartenenti al proprio account. Non puo cancellare comunicazioni
-- di bollette, sistema o di altri utenti.
drop policy if exists premium_communications_owner_delete_support on public.premium_communications;
create policy premium_communications_owner_delete_support
on public.premium_communications
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and subject like '[support:%'
);

commit;
