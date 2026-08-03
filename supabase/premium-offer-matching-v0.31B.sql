-- OffertaLogica Premium v0.31B
-- Riconoscimento automatico dell'offerta attiva tramite storico ARERA.
-- Aggiunge soltanto campi a premium_contracts. Non modifica lead, diagnostica o Storage.

begin;

alter table public.premium_contracts
  add column if not exists arera_offer_code_electricity text not null default '',
  add column if not exists arera_offer_code_gas text not null default '',
  add column if not exists arera_history_key_electricity text not null default '',
  add column if not exists arera_history_key_gas text not null default '',
  add column if not exists electricity_arera_valid_from date,
  add column if not exists electricity_arera_valid_to date,
  add column if not exists gas_arera_valid_from date,
  add column if not exists gas_arera_valid_to date,
  add column if not exists electricity_index_name text not null default '',
  add column if not exists gas_index_name text not null default '',
  add column if not exists electricity_spread_eur_kwh numeric(12, 6),
  add column if not exists gas_spread_eur_smc numeric(12, 6),
  add column if not exists electricity_formula text not null default '',
  add column if not exists gas_formula text not null default '',
  add column if not exists automatic_match_status text not null default 'not_attempted',
  add column if not exists automatic_match_confidence numeric(5, 2) not null default 0,
  add column if not exists automatic_match_method text not null default 'none',
  add column if not exists automatic_match_candidates jsonb not null default '[]'::jsonb,
  add column if not exists automatic_matched_at timestamptz,
  add column if not exists automatic_match_catalog_version text not null default '',
  add column if not exists automatic_match_source_url text not null default '';

alter table public.premium_contracts
  drop constraint if exists premium_contracts_automatic_match_status_check;

alter table public.premium_contracts
  add constraint premium_contracts_automatic_match_status_check
  check (
    automatic_match_status in (
      'not_attempted',
      'matched',
      'partial',
      'ambiguous',
      'not_found',
      'error'
    )
  );

alter table public.premium_contracts
  drop constraint if exists premium_contracts_automatic_match_confidence_check;

alter table public.premium_contracts
  add constraint premium_contracts_automatic_match_confidence_check
  check (automatic_match_confidence between 0 and 100);

create index if not exists premium_contracts_arera_electricity_code_idx
  on public.premium_contracts (arera_offer_code_electricity)
  where arera_offer_code_electricity <> '';

create index if not exists premium_contracts_arera_gas_code_idx
  on public.premium_contracts (arera_offer_code_gas)
  where arera_offer_code_gas <> '';

create index if not exists premium_contracts_match_status_idx
  on public.premium_contracts (automatic_match_status, automatic_match_confidence desc);

comment on column public.premium_contracts.automatic_match_status is
  'Esito del riconoscimento automatico nello storico ARERA: matched, partial, ambiguous, not_found o error.';

comment on column public.premium_contracts.automatic_match_confidence is
  'Confidenza deterministica del riconoscimento automatico, da 0 a 100.';

comment on column public.premium_contracts.automatic_match_candidates is
  'Prime corrispondenze considerate dal motore per luce e gas, senza dati personali.';

comment on column public.premium_contracts.automatic_match_source_url is
  'Fonte pubblica versionata dello storico ARERA usata per il riconoscimento.';

commit;
