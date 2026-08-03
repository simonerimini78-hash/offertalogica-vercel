-- Verifica installazione OffertaLogica Premium v0.31C

with contract_columns as (
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'premium_contracts'
),
constraints as (
  select conname
  from pg_constraint
  where conrelid = 'public.premium_contracts'::regclass
),
indexes as (
  select indexname
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'premium_contracts'
)
select
  (
    select count(*) = 5
    from contract_columns
    where column_name in (
      'customer_confirmation_status',
      'customer_confirmed_at',
      'customer_rejected_at',
      'customer_selected_candidates',
      'customer_confirmation_version'
    )
  ) as confirmation_columns_present,
  exists (
    select 1 from constraints
    where conname = 'premium_contracts_customer_confirmation_status_check'
  ) as confirmation_status_constraint_present,
  exists (
    select 1 from constraints
    where conname = 'premium_contracts_customer_confirmation_dates_check'
  ) as confirmation_dates_constraint_present,
  exists (
    select 1 from indexes
    where indexname = 'premium_contracts_confirmation_pending_idx'
  ) as confirmation_pending_index_present,
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_contracts'
      and policyname in (
        'premium_contracts_owner_insert',
        'premium_contracts_owner_update',
        'premium_contracts_owner_delete'
      )
  ) as customer_contract_mutations_disabled,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_contracts'
      and policyname = 'premium_contracts_staff_all'
  ) as staff_contract_policy_present,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'premium_contracts'
      and policyname = 'premium_contracts_owner_select'
  ) as customer_contract_read_present,
  not exists (
    select 1
    from public.premium_contracts
    where verification_status = 'verified'
      and customer_confirmation_status = 'pending'
  ) as verified_contracts_not_pending,
  not exists (
    select 1
    from public.premium_contracts
    where customer_confirmation_status = 'confirmed'
      and customer_confirmed_at is null
  ) as confirmed_dates_valid,
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.premium_contracts'::regclass
  ) as contracts_rls_still_enabled,
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'premium_contracts'
      and grantee = 'anon'
  ) as anon_grants_absent;
