-- Verifica OffertaLogica Premium v0.32
-- Ogni riga deve restituire true.

with policy_data as (
  select
    schemaname,
    tablename,
    policyname,
    cmd,
    coalesce(qual, '') as qual,
    coalesce(with_check, '') as with_check
  from pg_policies
),
checks as (
  select 'owner_bill_read_uses_profile' as check_name,
    exists (
      select 1 from policy_data
      where schemaname = 'public'
        and tablename = 'premium_bills'
        and policyname = 'premium_bills_owner_select'
        and cmd = 'SELECT'
        and qual like '%premium_has_profile%'
        and qual not like '%premium_has_service_access%'
    ) as ok
  union all
  select 'owner_bill_delete_uses_profile',
    exists (
      select 1 from policy_data
      where schemaname = 'public'
        and tablename = 'premium_bills'
        and policyname = 'premium_bills_owner_delete'
        and cmd = 'DELETE'
        and qual like '%premium_has_profile%'
        and qual like '%premium_checks%'
    )
  union all
  select 'owner_storage_read_uses_profile',
    exists (
      select 1 from policy_data
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'premium_bills_storage_owner_select'
        and cmd = 'SELECT'
        and qual like '%premium_has_profile%'
    )
  union all
  select 'owner_storage_delete_protected',
    exists (
      select 1 from policy_data
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'premium_bills_storage_owner_delete'
        and cmd = 'DELETE'
        and qual like '%premium_has_profile%'
        and qual like '%premium_checks%'
        and qual like '%automatic_screening_status%'
    )
  union all
  select 'staff_bill_requires_requested_check',
    exists (
      select 1 from policy_data
      where schemaname = 'public'
        and tablename = 'premium_bills'
        and policyname = 'premium_bills_staff_select'
        and cmd = 'SELECT'
        and qual like '%premium_checks%'
        and qual like '%reviewer%'
        and qual like '%admin%'
        and qual like '%canceled%'
    )
  union all
  select 'staff_storage_requires_requested_check',
    exists (
      select 1 from policy_data
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'premium_bills_storage_staff_select'
        and cmd = 'SELECT'
        and qual like '%premium_checks%'
        and qual like '%reviewer%'
        and qual like '%admin%'
        and qual like '%canceled%'
    )
  union all
  select 'contracts_owner_read_uses_profile',
    exists (
      select 1 from policy_data
      where schemaname = 'public'
        and tablename = 'premium_contracts'
        and policyname = 'premium_contracts_owner_select'
        and cmd = 'SELECT'
        and qual like '%premium_has_profile%'
    )
  union all
  select 'utilities_owner_delete_uses_profile',
    exists (
      select 1 from policy_data
      where schemaname = 'public'
        and tablename = 'premium_utilities'
        and policyname = 'premium_utilities_owner_delete'
        and cmd = 'DELETE'
        and qual like '%premium_has_profile%'
    )
  union all
  select 'bills_rls_enabled',
    coalesce((select relrowsecurity from pg_class where oid = 'public.premium_bills'::regclass), false)
  union all
  select 'contracts_rls_enabled',
    coalesce((select relrowsecurity from pg_class where oid = 'public.premium_contracts'::regclass), false)
  union all
  select 'anon_premium_grants_absent',
    not exists (
      select 1
      from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema = 'public'
        and table_name like 'premium_%'
    )
)
select check_name, ok
from checks
order by check_name;
