-- OFFERTALOGICA PREMIUM v0.25 — VERIFICA SOLA LETTURA

select
  exists (
    select 1
    from information_schema.routines
    where routine_schema = 'public'
      and routine_name = 'premium_can_add_bill'
  ) as limit_function_present,

  has_function_privilege(
    'authenticated',
    'public.premium_can_add_bill(uuid)',
    'EXECUTE'
  ) as authenticated_can_execute,

  not has_function_privilege(
    'anon',
    'public.premium_can_add_bill(uuid)',
    'EXECUTE'
  ) as anon_cannot_execute,

  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and indexname = 'premium_bills_user_sha_active_uidx'
      and indexdef ilike '%unique index%'
      and indexdef ilike '%file_sha256%'
  ) as duplicate_index_present,

  coalesce((
    select with_check ilike '%premium_can_add_bill%'
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_bills'
      and policyname = 'premium_bills_owner_insert'
  ), false) as insert_policy_enforces_limit,

  coalesce((
    select with_check ilike '%premium_bills%'
      and with_check ilike '%processing_status%uploaded%'
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_owner_insert'
  ), false) as storage_insert_requires_bill,

  coalesce((
    select qual ilike '%premium_bills%'
      and qual ilike '%processing_status%uploaded%'
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'premium_bills_storage_owner_delete'
  ), false) as storage_delete_is_protected,

  exists (
    select 1
    from storage.buckets
    where id = 'premium-bills'
      and public = false
      and file_size_limit = 20000000
      and allowed_mime_types = array['application/pdf']::text[]
  ) as private_pdf_bucket_valid;
