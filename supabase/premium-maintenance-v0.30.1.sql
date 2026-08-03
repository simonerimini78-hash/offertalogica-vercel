-- OffertaLogica Premium v0.30.1
-- Correzione eliminazione bollette e permessi staff.
-- Non modifica lead, archivio diagnostico o PWA gratuita.

begin;

-- Il cliente può eliminare una bolletta dopo la chiusura del controllo.
-- Restano bloccati soltanto i controlli umani ancora attivi.
drop policy if exists premium_bills_owner_delete on public.premium_bills;
create policy premium_bills_owner_delete
on public.premium_bills for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and processing_status in ('uploaded', 'completed', 'failed')
  and not exists (
    select 1
    from public.premium_checks check_record
    where check_record.bill_id = premium_bills.id
      and check_record.user_id = (select auth.uid())
      and check_record.status in ('pending', 'assigned', 'in_review', 'more_info_required')
  )
);

drop policy if exists premium_bills_storage_owner_delete on storage.objects;
create policy premium_bills_storage_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_has_service_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.premium_bills bill
    where bill.storage_path = storage.objects.name
      and bill.user_id = (select auth.uid())
      and bill.processing_status in ('uploaded', 'completed', 'failed')
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

-- La vecchia policy ALL consentiva tecnicamente anche DELETE a reviewer/support.
-- La sostituiamo con sola lettura e riserviamo la cancellazione all'admin.
drop policy if exists premium_bills_staff_all on public.premium_bills;
drop policy if exists premium_bills_staff_select on public.premium_bills;
create policy premium_bills_staff_select
on public.premium_bills for select to authenticated
using ((select public.premium_is_staff()));

drop policy if exists premium_bills_admin_delete on public.premium_bills;
create policy premium_bills_admin_delete
on public.premium_bills for delete to authenticated
using ((select public.premium_is_staff(array['admin'])));

drop policy if exists premium_bills_storage_admin_delete on storage.objects;
create policy premium_bills_storage_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'premium-bills'
  and (select public.premium_is_staff(array['admin']))
  and exists (
    select 1
    from public.premium_bills bill
    where bill.storage_path = storage.objects.name
      and bill.deleted_at is null
  )
);

commit;
