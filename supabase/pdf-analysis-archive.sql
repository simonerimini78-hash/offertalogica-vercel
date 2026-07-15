-- OffertaLogica v89 - archivio privato PDF di test e diagnostica del parser.
-- Eseguire una sola volta nel SQL editor del progetto Supabase.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pdf-test-archive',
  'pdf-test-archive',
  false,
  8000000,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.pdf_analyses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  expires_at timestamptz,
  parser_version text not null default 'unknown',
  archive_mode text not null default 'off',
  status text not null default 'partial' check (status in ('complete', 'partial', 'unrecognized', 'failed')),
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed', 'test_case', 'discarded')),
  original_file_name text not null default 'documento.pdf',
  storage_bucket text not null default 'pdf-test-archive',
  storage_path text not null,
  file_sha256 text not null,
  file_size bigint not null default 0,
  mime_type text not null default 'application/pdf',
  kind text not null default 'unknown',
  commodity text not null default 'unknown',
  provider text not null default '',
  recognized boolean not null default false,
  confidence text not null default 'low',
  text_length integer not null default 0,
  page_count integer,
  warnings jsonb not null default '[]'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  diagnostics jsonb not null default '[]'::jsonb,
  confirmed_data jsonb not null default '{}'::jsonb,
  correction_summary jsonb not null default '{}'::jsonb,
  staff_notes text not null default '',
  source_context jsonb not null default '{}'::jsonb,
  error_code text not null default '',
  error_message text not null default ''
);

create index if not exists pdf_analyses_created_at_idx on public.pdf_analyses (created_at desc);
create index if not exists pdf_analyses_status_idx on public.pdf_analyses (status, review_status, created_at desc);
create index if not exists pdf_analyses_provider_idx on public.pdf_analyses (provider, created_at desc);
create index if not exists pdf_analyses_hash_idx on public.pdf_analyses (file_sha256);
create index if not exists pdf_analyses_expires_at_idx on public.pdf_analyses (expires_at) where expires_at is not null;

alter table public.pdf_analyses enable row level security;

-- Nessuna policy pubblica: browser e chiave anon non possono leggere né scrivere.
-- Le API server utilizzano esclusivamente SUPABASE_SERVICE_ROLE_KEY.
revoke all on table public.pdf_analyses from anon, authenticated;
