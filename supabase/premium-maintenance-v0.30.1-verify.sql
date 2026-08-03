-- Verifica sola lettura OffertaLogica Premium v0.30.1
select
  coalesce((
    select
      qual ilike '%pending%'
      and qual ilike '%assigned%'
      and qual ilike '%in_review%'
      and qual ilike '%more_info_required%'
      and qual not ilike '%status <>%'
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_owner_delete'
  ), false) as owner_delete_blocks_only_active_checks,

  coalesce((
    select
      qual ilike '%pending%'
      and qual ilike '%assigned%'
      and qual ilike '%in_review%'
      and qual ilike '%more_info_required%'
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_owner_delete'
  ), false) as storage_owner_delete_blocks_only_active_checks,

  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_staff_select'
      and cmd = 'SELECT'
  ) as staff_has_read_only_policy,

  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_staff_all'
  ) as old_staff_all_policy_removed,

  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_admin_delete'
      and cmd = 'DELETE'
  ) as admin_database_delete_present,

  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_admin_delete'
      and cmd = 'DELETE'
  ) as admin_storage_delete_present;
