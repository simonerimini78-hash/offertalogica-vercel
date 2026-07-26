-- OffertaLogica Step 8 v2.6 - tracciamento opzionale delle sessioni PDF.
-- Il funzionamento runtime usa KV/Upstash. Questa tabella conserva solo stato e metriche,
-- mai token di accesso, chiavi OpenAI o file_id delle pagine.

create table if not exists public.pdf_analysis_sessions (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'uploading' check (status in ('uploading','ready','questioning','finalized','cancelled','failed')),
  original_file_name text not null default 'documento.pdf',
  expected_page_count integer not null default 0,
  uploaded_page_count integer not null default 0,
  question_count integer not null default 0,
  completed_question_count integer not null default 0,
  accepted_question_count integer not null default 0,
  session_version text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pdf_analysis_sessions_updated_at_idx on public.pdf_analysis_sessions (updated_at desc);
create index if not exists pdf_analysis_sessions_status_idx on public.pdf_analysis_sessions (status, updated_at desc);
create index if not exists pdf_analysis_sessions_expires_at_idx on public.pdf_analysis_sessions (expires_at);

alter table public.pdf_analysis_sessions enable row level security;
revoke all on table public.pdf_analysis_sessions from anon, authenticated;

-- Per attivare il mirror diagnostico impostare lato server:
-- PDF_SESSION_AUDIT_SUPABASE=true
