-- Verifica installazione OffertaLogica Premium v0.31B

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
    select count(*) = 22
    from contract_columns
    where column_name in (
      'arera_offer_code_electricity',
      'arera_offer_code_gas',
      'arera_history_key_electricity',
      'arera_history_key_gas',
      'electricity_arera_valid_from',
      'electricity_arera_valid_to',
      'gas_arera_valid_from',
      'gas_arera_valid_to',
      'electricity_index_name',
      'gas_index_name',
      'electricity_spread_eur_kwh',
      'gas_spread_eur_smc',
      'electricity_formula',
      'gas_formula',
      'automatic_match_status',
      'automatic_match_confidence',
      'automatic_match_method',
      'automatic_match_candidates',
      'automatic_matched_at',
      'automatic_match_catalog_version',
      'automatic_match_source_url',
      'offer_name'
    )
  ) as contract_match_columns_present,
  exists (
    select 1 from constraints
    where conname = 'premium_contracts_automatic_match_status_check'
  ) as match_status_constraint_present,
  exists (
    select 1 from constraints
    where conname = 'premium_contracts_automatic_match_confidence_check'
  ) as match_confidence_constraint_present,
  exists (
    select 1 from indexes
    where indexname = 'premium_contracts_arera_electricity_code_idx'
  ) as electricity_code_index_present,
  exists (
    select 1 from indexes
    where indexname = 'premium_contracts_arera_gas_code_idx'
  ) as gas_code_index_present,
  exists (
    select 1 from indexes
    where indexname = 'premium_contracts_match_status_idx'
  ) as match_status_index_present,
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
