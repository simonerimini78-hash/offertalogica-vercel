-- OffertaLogica Premium v0.32
-- Audit pre-lancio: accesso staff ai PDF solo dopo richiesta del cliente
-- e gestione/cancellazione dei dati anche senza abbonamento attivo.
-- Non modifica lead, diagnostica, PWA gratuita o funzioni Vercel.

begin;

-- Il cliente mantiene accesso in sola gestione ai propri dati Premium.
-- Creazione, modifica operativa, analisi e controlli restano vincolati
-- a premium_has_service_access() nelle policy già esistenti.

drop policy if exists premium_utilities_owner_select on public.premium_utilities;
create policy premium_utilities_owner_select
on public.premium_utilities for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
);

drop policy if exists premium_utilities_owner_delete on public.premium_utilities;
create policy premium_utilities_owner_delete
on public.premium_utilities for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
);

drop policy if exists premium_contracts_owner_select on public.premium_contracts;
create policy premium_contracts_owner_select
on public.premium_contracts for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
);

drop policy if exists premium_bills_owner_select on public.premium_bills;
create policy premium_bills_owner_select
on public.premium_bills for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
  and deleted_at is null
);

drop policy if exists premium_bills_owner_delete on public.premium_bills;
create policy premium_bills_owner_delete
on public.premium_bills for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
  and processing_status in ('uploaded', 'completed', 'failed')
  and automatic_screening_status <> 'running'
  and not exists (
    select 1
    from public.premium_checks check_record
    where check_record.bill_id = premium_bills.id
      and check_record.user_id = (select auth.uid())
      and check_record.status in ('pending', 'assigned', 'in_review', 'more_info_required')
  )
);

drop policy if exists premium_checks_owner_select on public.premium_checks;
create policy premium_checks_owner_select
on public.premium_checks for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
);

drop policy if exists premium_anomalies_owner_select on public.premium_anomalies;
create policy premium_anomalies_owner_select
on public.premium_anomalies for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_profile())
);

drop policy if exists premium_bills_storage_owner_select on storage.objects;
create policy premium_bills_storage_owner_select
on storage.objects for select to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_has_profile())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists premium_bills_storage_owner_delete on storage.objects;
create policy premium_bills_storage_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_has_profile())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.premium_bills bill
    where bill.storage_path = storage.objects.name
      and bill.user_id = (select auth.uid())
      and bill.processing_status in ('uploaded', 'completed', 'failed')
      and bill.automatic_screening_status <> 'running'
      and bill.deleted_at is null
      and not exists (
        select 1
        from public.premium_checks check_record
        where check_record.bill_id = bill.id
          and check_record.user_id = bill.user_id
          and check_record.status in ('pending', 'assigned', 'in_review', 'more_info_required')
      )
  )
);

-- Il solo ruolo staff non basta più per leggere una bolletta o il relativo PDF:
-- deve esistere una richiesta di controllo non annullata del cliente.

drop policy if exists premium_bills_staff_select on public.premium_bills;
create policy premium_bills_staff_select
on public.premium_bills for select to authenticated
using (
  (select public.premium_is_staff(array['reviewer', 'admin']))
  and deleted_at is null
  and exists (
    select 1
    from public.premium_checks check_record
    where check_record.bill_id = premium_bills.id
      and check_record.user_id = premium_bills.user_id
      and check_record.status <> 'canceled'
  )
);

drop policy if exists premium_bills_storage_staff_select on storage.objects;
create policy premium_bills_storage_staff_select
on storage.objects for select to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_is_staff(array['reviewer', 'admin']))
  and exists (
    select 1
    from public.premium_bills bill
    join public.premium_checks check_record
      on check_record.bill_id = bill.id
     and check_record.user_id = bill.user_id
    where bill.storage_path = storage.objects.name
      and bill.deleted_at is null
      and check_record.status <> 'canceled'
  )
);

comment on policy premium_bills_staff_select on public.premium_bills is
  'Reviewer/admin leggono soltanto bollette per cui il cliente ha richiesto un controllo non annullato.';

comment on policy premium_bills_storage_staff_select on storage.objects is
  'Reviewer/admin scaricano soltanto PDF collegati a una richiesta di controllo non annullata.';

commit;
