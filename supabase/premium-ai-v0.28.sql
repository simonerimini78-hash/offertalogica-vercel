-- OFFERTALOGICA PREMIUM v0.28
-- Pre-analisi IA assistita, riservata allo staff e sempre soggetta a revisione umana.
-- Script incrementale e idempotente. Non attiva analisi automatiche e non pubblica esiti al cliente.

begin;

alter table public.premium_analysis_runs
  add column if not exists requested_by_staff_id uuid
    references public.premium_staff_members(user_id)
    on delete set null;

alter table public.premium_analysis_runs
  add column if not exists usage_details jsonb not null default '{}'::jsonb;

alter table public.premium_analysis_runs
  add column if not exists response_ids jsonb not null default '[]'::jsonb;

-- Evita due costose esecuzioni concorrenti sulla stessa bolletta.
create unique index if not exists premium_analysis_runs_one_active_per_bill
on public.premium_analysis_runs (bill_id)
where status in ('queued', 'running');

create index if not exists premium_analysis_runs_staff_idx
on public.premium_analysis_runs (requested_by_staff_id, created_at desc);

comment on column public.premium_analysis_runs.requested_by_staff_id is
  'Operatore che ha richiesto la pre-analisi IA. Non implica approvazione del risultato.';

comment on column public.premium_analysis_runs.usage_details is
  'Conteggi tecnici e dettaglio chiamate necessari alla misurazione dei costi.';

comment on column public.premium_analysis_runs.response_ids is
  'Identificativi delle risposte del provider IA, conservati solo per audit tecnico.';

commit;
