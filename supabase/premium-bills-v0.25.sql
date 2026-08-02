-- OFFERTALOGICA PREMIUM v0.25
-- Quota annuale bollette, prevenzione duplicati e cancellazione Storage protetta.
-- Script incrementale e idempotente. Non modifica le tabelle del sito o l'archivio diagnostico.

begin;

create or replace function public.premium_can_add_bill(p_utility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_subscription as (
    select subscription.included_bills_per_year
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
      and subscription.status in ('trialing', 'active')
      and (
        subscription.current_period_end is null
        or subscription.current_period_end > now()
      )
    order by subscription.created_at desc
    limit 1
  ),
  owned_utility as (
    select utility.id, utility.expected_bills_per_year
    from public.premium_utilities utility
    where utility.id = p_utility_id
      and utility.user_id = (select auth.uid())
      and utility.status <> 'archived'
    limit 1
  ),
  yearly_counts as (
    select
      count(*) filter (where bill.user_id = (select auth.uid())) as user_bill_count,
      count(*) filter (where bill.utility_id = p_utility_id) as utility_bill_count
    from public.premium_bills bill
    where bill.user_id = (select auth.uid())
      and bill.deleted_at is null
      and bill.created_at >= now() - interval '1 year'
  )
  select
    (select public.premium_has_service_access())
    and exists (select 1 from active_subscription)
    and exists (select 1 from owned_utility)
    and coalesce((select user_bill_count from yearly_counts), 0)
      < coalesce((select included_bills_per_year from active_subscription), 0)
    and coalesce((select utility_bill_count from yearly_counts), 0)
      < coalesce((select expected_bills_per_year from owned_utility), 0);
$$;

revoke all on function public.premium_can_add_bill(uuid) from public, anon;
grant execute on function public.premium_can_add_bill(uuid) to authenticated, service_role;

-- Lo stesso PDF non può essere registrato due volte nell'archivio attivo dello stesso cliente.
create unique index if not exists premium_bills_user_sha_active_uidx
on public.premium_bills (user_id, file_sha256)
where deleted_at is null and file_sha256 <> '';

-- La quota viene verificata dal database, non soltanto dall'interfaccia.
drop policy if exists premium_bills_owner_insert on public.premium_bills;
create policy premium_bills_owner_insert
on public.premium_bills for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and (select public.premium_can_add_bill(utility_id))
  and storage_bucket = 'premium-bills'
  and split_part(storage_path, '/', 1) = (select auth.uid())::text
  and processing_status = 'uploaded'
  and customer_status = 'awaiting_review'
  and completed_at is null
  and deleted_at is null
);

-- Un oggetto Storage può essere caricato soltanto dopo che il database ha
-- accettato il record della bolletta e verificato quota, proprietà e duplicati.
drop policy if exists premium_bills_storage_owner_insert on storage.objects;
create policy premium_bills_storage_owner_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'premium-bills'
  and (select public.premium_has_service_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.premium_bills bill
    where bill.storage_path = storage.objects.name
      and bill.user_id = (select auth.uid())
      and bill.processing_status = 'uploaded'
      and bill.deleted_at is null
  )
);

-- Il cliente può rimuovere un file soltanto prima della presa in carico.
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
      and bill.processing_status = 'uploaded'
      and bill.deleted_at is null
  )
);

commit;
