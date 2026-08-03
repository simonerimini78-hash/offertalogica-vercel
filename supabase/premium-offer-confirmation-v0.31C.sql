-- OffertaLogica Premium v0.31C
-- Visualizzazione e conferma minima dell'offerta riconosciuta.
-- Nessuna nuova tabella, funzione Vercel o modifica alle risorse lead/diagnostica.

begin;

alter table public.premium_contracts
  add column if not exists customer_confirmation_status text not null default 'not_required',
  add column if not exists customer_confirmed_at timestamptz,
  add column if not exists customer_rejected_at timestamptz,
  add column if not exists customer_selected_candidates jsonb not null default '[]'::jsonb,
  add column if not exists customer_confirmation_version text not null default '';

alter table public.premium_contracts
  drop constraint if exists premium_contracts_customer_confirmation_status_check;

alter table public.premium_contracts
  add constraint premium_contracts_customer_confirmation_status_check
  check (
    customer_confirmation_status in (
      'not_required',
      'pending',
      'confirmed',
      'rejected',
      'not_available'
    )
  );

alter table public.premium_contracts
  drop constraint if exists premium_contracts_customer_confirmation_dates_check;

alter table public.premium_contracts
  add constraint premium_contracts_customer_confirmation_dates_check
  check (
    (customer_confirmation_status <> 'confirmed' or customer_confirmed_at is not null)
    and (customer_confirmation_status <> 'rejected' or customer_rejected_at is not null)
  );

-- Allinea i match già creati dalla v0.31B prima dell'aggiunta dei nuovi campi.
update public.premium_contracts
set
  customer_confirmation_status = case
    when verification_status = 'verified' then 'not_required'
    when verification_status = 'rejected' then 'rejected'
    when verification_status = 'needs_review'
      and automatic_match_status in ('matched', 'ambiguous')
      and jsonb_typeof(automatic_match_candidates) = 'array'
      and jsonb_array_length(automatic_match_candidates) > 0
      then 'pending'
    else 'not_available'
  end,
  customer_rejected_at = case
    when verification_status = 'rejected' then coalesce(customer_rejected_at, updated_at, now())
    else customer_rejected_at
  end,
  customer_confirmation_version = case
    when customer_confirmation_version = '' then 'premium-offer-confirmation-v0.31C'
    else customer_confirmation_version
  end
where customer_confirmation_status = 'not_required'
  and verification_status <> 'verified';

create index if not exists premium_contracts_confirmation_pending_idx
  on public.premium_contracts (user_id, customer_confirmation_status, updated_at desc)
  where is_current = true and customer_confirmation_status = 'pending';

-- I contratti sono leggibili dal cliente ma vengono creati e modificati soltanto
-- dal backend protetto o dallo staff autorizzato. La conferma non passa da update browser.
drop policy if exists premium_contracts_owner_insert on public.premium_contracts;
drop policy if exists premium_contracts_owner_update on public.premium_contracts;
drop policy if exists premium_contracts_owner_delete on public.premium_contracts;

comment on column public.premium_contracts.customer_confirmation_status is
  'Esito della conferma minima del cliente: non richiesta, in attesa, confermata, rifiutata o non disponibile.';

comment on column public.premium_contracts.customer_selected_candidates is
  'Candidati ARERA selezionati esplicitamente dal cliente, senza dati personali.';

comment on column public.premium_contracts.customer_confirmation_version is
  'Versione del flusso applicativo che ha registrato la decisione del cliente.';

commit;
