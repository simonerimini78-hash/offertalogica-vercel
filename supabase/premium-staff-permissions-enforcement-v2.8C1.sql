-- OffertaLogica Staff v2.8C1
-- Enforcement backend: mutazioni verifiche + eliminazioni.
--
-- Base verificata:
--   branch: staff-v2-control-center
--   commit: 906d01d0bd60ccaeab30b836bd7914fd49e1fce4 (Staff-V2.8B1)
--
-- OBIETTIVO
-- - applicare la matrice V2.8A alle RPC operative sensibili già esistenti;
-- - preservare integralmente la logica legacy delle RPC, incapsulandola dietro
--   wrapper permission-aware;
-- - impedire la mutazione diretta via RLS delle tabelle note/anomalie/field review;
-- - non modificare frontend, Stripe, lead, analytics, clienti o Premium app.
--
-- PERMESSI
-- - manage_checks: claim, stato, note, anomalie, chiusura, validazione IA;
-- - delete_records: cancellazioni definitive record/account.
--
-- NOTA
-- V2.8C2 completerà enforcement su API/Edge Function e letture/RLS dei moduli.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_permission_allowed(text)') is null then
    raise exception 'premium_staff_permissions_v28a_missing';
  end if;
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conservazione delle implementazioni legacy con EXECUTE revocato al client.
-- Il rename mantiene identica l'implementazione già collaudata; i wrapper
-- sottostanti diventano l'unica superficie RPC eseguibile da authenticated.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.premium_staff_claim_check_v28c1_legacy(uuid)') is null then
    if to_regprocedure('public.premium_staff_claim_check(uuid)') is null then
      raise exception 'premium_staff_claim_check_missing';
    end if;
    alter function public.premium_staff_claim_check(uuid)
      rename to premium_staff_claim_check_v28c1_legacy;
  end if;

  if to_regprocedure('public.premium_staff_set_check_status_v28c1_legacy(uuid,text,text)') is null then
    if to_regprocedure('public.premium_staff_set_check_status(uuid,text,text)') is null then
      raise exception 'premium_staff_set_check_status_missing';
    end if;
    alter function public.premium_staff_set_check_status(uuid,text,text)
      rename to premium_staff_set_check_status_v28c1_legacy;
  end if;

  if to_regprocedure('public.premium_staff_add_check_note_v28c1_legacy(uuid,text)') is null then
    if to_regprocedure('public.premium_staff_add_check_note(uuid,text)') is null then
      raise exception 'premium_staff_add_check_note_missing';
    end if;
    alter function public.premium_staff_add_check_note(uuid,text)
      rename to premium_staff_add_check_note_v28c1_legacy;
  end if;

  if to_regprocedure('public.premium_staff_add_anomaly_v28c1_legacy(uuid,text,text,text,text,numeric)') is null then
    if to_regprocedure('public.premium_staff_add_anomaly(uuid,text,text,text,text,numeric)') is null then
      raise exception 'premium_staff_add_anomaly_missing';
    end if;
    alter function public.premium_staff_add_anomaly(uuid,text,text,text,text,numeric)
      rename to premium_staff_add_anomaly_v28c1_legacy;
  end if;

  if to_regprocedure('public.premium_staff_delete_anomaly_v28c1_legacy(uuid)') is null then
    if to_regprocedure('public.premium_staff_delete_anomaly(uuid)') is null then
      raise exception 'premium_staff_delete_anomaly_missing';
    end if;
    alter function public.premium_staff_delete_anomaly(uuid)
      rename to premium_staff_delete_anomaly_v28c1_legacy;
  end if;

  if to_regprocedure('public.premium_staff_complete_check_v28c1_legacy(uuid,text,text,text,integer)') is null then
    if to_regprocedure('public.premium_staff_complete_check(uuid,text,text,text,integer)') is null then
      raise exception 'premium_staff_complete_check_missing';
    end if;
    alter function public.premium_staff_complete_check(uuid,text,text,text,integer)
      rename to premium_staff_complete_check_v28c1_legacy;
  end if;

  if to_regprocedure('public.premium_staff_validate_analysis_v28c1_legacy(uuid,jsonb,integer,text)') is null then
    if to_regprocedure('public.premium_staff_validate_analysis(uuid,jsonb,integer,text)') is null then
      raise exception 'premium_staff_validate_analysis_missing';
    end if;
    alter function public.premium_staff_validate_analysis(uuid,jsonb,integer,text)
      rename to premium_staff_validate_analysis_v28c1_legacy;
  end if;

  if to_regprocedure('public.premium_staff_delete_records_v28c1_legacy(text,uuid[])') is null then
    if to_regprocedure('public.premium_staff_delete_records(text,uuid[])') is null then
      raise exception 'premium_staff_delete_records_missing';
    end if;
    alter function public.premium_staff_delete_records(text,uuid[])
      rename to premium_staff_delete_records_v28c1_legacy;
  end if;

  if to_regprocedure('public.premium_staff_complete_account_deletion_v28c1_legacy(uuid,text)') is null then
    if to_regprocedure('public.premium_staff_complete_account_deletion(uuid,text)') is null then
      raise exception 'premium_staff_complete_account_deletion_missing';
    end if;
    alter function public.premium_staff_complete_account_deletion(uuid,text)
      rename to premium_staff_complete_account_deletion_v28c1_legacy;
  end if;
end;
$$;

revoke all on function public.premium_staff_claim_check_v28c1_legacy(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.premium_staff_set_check_status_v28c1_legacy(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.premium_staff_add_check_note_v28c1_legacy(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.premium_staff_add_anomaly_v28c1_legacy(uuid,text,text,text,text,numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.premium_staff_delete_anomaly_v28c1_legacy(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.premium_staff_complete_check_v28c1_legacy(uuid,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.premium_staff_validate_analysis_v28c1_legacy(uuid,jsonb,integer,text)
  from public, anon, authenticated, service_role;
revoke all on function public.premium_staff_delete_records_v28c1_legacy(text,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.premium_staff_complete_account_deletion_v28c1_legacy(uuid,text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Wrapper manage_checks.
-- ---------------------------------------------------------------------------

create or replace function public.premium_staff_claim_check(p_check_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('manage_checks') then
    raise exception 'premium_staff_permission_required:manage_checks' using errcode = '42501';
  end if;
  return public.premium_staff_claim_check_v28c1_legacy(p_check_id);
end;
$$;

create or replace function public.premium_staff_set_check_status(
  p_check_id uuid,
  p_status text,
  p_customer_message text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('manage_checks') then
    raise exception 'premium_staff_permission_required:manage_checks' using errcode = '42501';
  end if;
  return public.premium_staff_set_check_status_v28c1_legacy(
    p_check_id, p_status, p_customer_message
  );
end;
$$;

create or replace function public.premium_staff_add_check_note(
  p_check_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('manage_checks') then
    raise exception 'premium_staff_permission_required:manage_checks' using errcode = '42501';
  end if;
  return public.premium_staff_add_check_note_v28c1_legacy(p_check_id, p_note);
end;
$$;

create or replace function public.premium_staff_add_anomaly(
  p_check_id uuid,
  p_category text,
  p_severity text,
  p_title text,
  p_description text default '',
  p_estimated_impact_eur numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('manage_checks') then
    raise exception 'premium_staff_permission_required:manage_checks' using errcode = '42501';
  end if;
  return public.premium_staff_add_anomaly_v28c1_legacy(
    p_check_id,
    p_category,
    p_severity,
    p_title,
    p_description,
    p_estimated_impact_eur
  );
end;
$$;

create or replace function public.premium_staff_delete_anomaly(p_anomaly_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('manage_checks') then
    raise exception 'premium_staff_permission_required:manage_checks' using errcode = '42501';
  end if;
  return public.premium_staff_delete_anomaly_v28c1_legacy(p_anomaly_id);
end;
$$;

create or replace function public.premium_staff_complete_check(
  p_check_id uuid,
  p_outcome text,
  p_summary text,
  p_customer_message text,
  p_human_seconds integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('manage_checks') then
    raise exception 'premium_staff_permission_required:manage_checks' using errcode = '42501';
  end if;
  return public.premium_staff_complete_check_v28c1_legacy(
    p_check_id,
    p_outcome,
    p_summary,
    p_customer_message,
    p_human_seconds
  );
end;
$$;

create or replace function public.premium_staff_validate_analysis(
  p_analysis_run_id uuid,
  p_fields jsonb,
  p_review_seconds integer default 0,
  p_validation_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('manage_checks') then
    raise exception 'premium_staff_permission_required:manage_checks' using errcode = '42501';
  end if;
  return public.premium_staff_validate_analysis_v28c1_legacy(
    p_analysis_run_id,
    p_fields,
    p_review_seconds,
    p_validation_note
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Wrapper delete_records.
-- ---------------------------------------------------------------------------

create or replace function public.premium_staff_delete_records(
  p_resource text,
  p_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('delete_records') then
    raise exception 'premium_staff_permission_required:delete_records' using errcode = '42501';
  end if;
  return public.premium_staff_delete_records_v28c1_legacy(p_resource, p_ids);
end;
$$;

create or replace function public.premium_staff_complete_account_deletion(
  p_user_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.premium_staff_permission_allowed('delete_records') then
    raise exception 'premium_staff_permission_required:delete_records' using errcode = '42501';
  end if;
  return public.premium_staff_complete_account_deletion_v28c1_legacy(
    p_user_id,
    p_confirmation
  );
end;
$$;

revoke all on function public.premium_staff_claim_check(uuid) from public, anon;
grant execute on function public.premium_staff_claim_check(uuid) to authenticated, service_role;

revoke all on function public.premium_staff_set_check_status(uuid,text,text) from public, anon;
grant execute on function public.premium_staff_set_check_status(uuid,text,text) to authenticated, service_role;

revoke all on function public.premium_staff_add_check_note(uuid,text) from public, anon;
grant execute on function public.premium_staff_add_check_note(uuid,text) to authenticated, service_role;

revoke all on function public.premium_staff_add_anomaly(uuid,text,text,text,text,numeric) from public, anon;
grant execute on function public.premium_staff_add_anomaly(uuid,text,text,text,text,numeric) to authenticated, service_role;

revoke all on function public.premium_staff_delete_anomaly(uuid) from public, anon;
grant execute on function public.premium_staff_delete_anomaly(uuid) to authenticated, service_role;

revoke all on function public.premium_staff_complete_check(uuid,text,text,text,integer) from public, anon;
grant execute on function public.premium_staff_complete_check(uuid,text,text,text,integer) to authenticated, service_role;

revoke all on function public.premium_staff_validate_analysis(uuid,jsonb,integer,text) from public, anon;
grant execute on function public.premium_staff_validate_analysis(uuid,jsonb,integer,text) to authenticated, service_role;

revoke all on function public.premium_staff_delete_records(text,uuid[]) from public, anon;
grant execute on function public.premium_staff_delete_records(text,uuid[]) to authenticated, service_role;

revoke all on function public.premium_staff_complete_account_deletion(uuid,text) from public, anon;
grant execute on function public.premium_staff_complete_account_deletion(uuid,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Chiusura bypass RLS di tre tabelle mutate esclusivamente dalle RPC sopra.
-- Le letture Staff restano compatibili; nessun diritto cliente viene rimosso.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on table public.premium_check_notes from authenticated;
drop policy if exists premium_check_notes_staff_all on public.premium_check_notes;
drop policy if exists premium_check_notes_staff_select on public.premium_check_notes;
create policy premium_check_notes_staff_select
on public.premium_check_notes for select to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])));

revoke insert, update, delete on table public.premium_anomalies from authenticated;
drop policy if exists premium_anomalies_staff_all on public.premium_anomalies;
drop policy if exists premium_anomalies_staff_select on public.premium_anomalies;
create policy premium_anomalies_staff_select
on public.premium_anomalies for select to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])));

revoke insert, update, delete on table public.premium_analysis_field_reviews from authenticated;
drop policy if exists premium_analysis_field_reviews_staff_all on public.premium_analysis_field_reviews;
drop policy if exists premium_analysis_field_reviews_staff_select on public.premium_analysis_field_reviews;
create policy premium_analysis_field_reviews_staff_select
on public.premium_analysis_field_reviews for select to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])));

comment on function public.premium_staff_claim_check(uuid) is
  'Staff v2.8C1: manage_checks enforcement; delega alla logica operativa legacy V2.7/V0.27.';
comment on function public.premium_staff_validate_analysis(uuid,jsonb,integer,text) is
  'Staff v2.8C1: manage_checks enforcement; validazione IA delegata alla logica legacy V0.29.';
comment on function public.premium_staff_delete_records(text,uuid[]) is
  'Staff v2.8C1: delete_records enforcement; cancellazione delegata alla logica auditata V2.4B.';
comment on function public.premium_staff_complete_account_deletion(uuid,text) is
  'Staff v2.8C1: delete_records enforcement; cancellazione account delegata alla logica privacy V0.35.';

commit;
