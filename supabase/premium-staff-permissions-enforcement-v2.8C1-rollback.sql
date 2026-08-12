-- OffertaLogica Staff v2.8C1 - rollback
-- Ripristina deliberatamente la superficie precedente a C1.
-- Usare solo se è necessario annullare C1.

begin;

drop function if exists public.premium_staff_claim_check(uuid);
drop function if exists public.premium_staff_set_check_status(uuid,text,text);
drop function if exists public.premium_staff_add_check_note(uuid,text);
drop function if exists public.premium_staff_add_anomaly(uuid,text,text,text,text,numeric);
drop function if exists public.premium_staff_delete_anomaly(uuid);
drop function if exists public.premium_staff_complete_check(uuid,text,text,text,integer);
drop function if exists public.premium_staff_validate_analysis(uuid,jsonb,integer,text);
drop function if exists public.premium_staff_delete_records(text,uuid[]);
drop function if exists public.premium_staff_complete_account_deletion(uuid,text);

do $$
begin
  if to_regprocedure('public.premium_staff_claim_check_v28c1_legacy(uuid)') is not null then
    alter function public.premium_staff_claim_check_v28c1_legacy(uuid)
      rename to premium_staff_claim_check;
  end if;
  if to_regprocedure('public.premium_staff_set_check_status_v28c1_legacy(uuid,text,text)') is not null then
    alter function public.premium_staff_set_check_status_v28c1_legacy(uuid,text,text)
      rename to premium_staff_set_check_status;
  end if;
  if to_regprocedure('public.premium_staff_add_check_note_v28c1_legacy(uuid,text)') is not null then
    alter function public.premium_staff_add_check_note_v28c1_legacy(uuid,text)
      rename to premium_staff_add_check_note;
  end if;
  if to_regprocedure('public.premium_staff_add_anomaly_v28c1_legacy(uuid,text,text,text,text,numeric)') is not null then
    alter function public.premium_staff_add_anomaly_v28c1_legacy(uuid,text,text,text,text,numeric)
      rename to premium_staff_add_anomaly;
  end if;
  if to_regprocedure('public.premium_staff_delete_anomaly_v28c1_legacy(uuid)') is not null then
    alter function public.premium_staff_delete_anomaly_v28c1_legacy(uuid)
      rename to premium_staff_delete_anomaly;
  end if;
  if to_regprocedure('public.premium_staff_complete_check_v28c1_legacy(uuid,text,text,text,integer)') is not null then
    alter function public.premium_staff_complete_check_v28c1_legacy(uuid,text,text,text,integer)
      rename to premium_staff_complete_check;
  end if;
  if to_regprocedure('public.premium_staff_validate_analysis_v28c1_legacy(uuid,jsonb,integer,text)') is not null then
    alter function public.premium_staff_validate_analysis_v28c1_legacy(uuid,jsonb,integer,text)
      rename to premium_staff_validate_analysis;
  end if;
  if to_regprocedure('public.premium_staff_delete_records_v28c1_legacy(text,uuid[])') is not null then
    alter function public.premium_staff_delete_records_v28c1_legacy(text,uuid[])
      rename to premium_staff_delete_records;
  end if;
  if to_regprocedure('public.premium_staff_complete_account_deletion_v28c1_legacy(uuid,text)') is not null then
    alter function public.premium_staff_complete_account_deletion_v28c1_legacy(uuid,text)
      rename to premium_staff_complete_account_deletion;
  end if;
end;
$$;

grant execute on function public.premium_staff_claim_check(uuid) to authenticated, service_role;
grant execute on function public.premium_staff_set_check_status(uuid,text,text) to authenticated, service_role;
grant execute on function public.premium_staff_add_check_note(uuid,text) to authenticated, service_role;
grant execute on function public.premium_staff_add_anomaly(uuid,text,text,text,text,numeric) to authenticated, service_role;
grant execute on function public.premium_staff_delete_anomaly(uuid) to authenticated, service_role;
grant execute on function public.premium_staff_complete_check(uuid,text,text,text,integer) to authenticated, service_role;
grant execute on function public.premium_staff_validate_analysis(uuid,jsonb,integer,text) to authenticated, service_role;
grant execute on function public.premium_staff_delete_records(text,uuid[]) to authenticated, service_role;
grant execute on function public.premium_staff_complete_account_deletion(uuid,text) to authenticated, service_role;

grant select, insert, update, delete on table public.premium_check_notes to authenticated;
drop policy if exists premium_check_notes_staff_select on public.premium_check_notes;
drop policy if exists premium_check_notes_staff_all on public.premium_check_notes;
create policy premium_check_notes_staff_all
on public.premium_check_notes for all to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])))
with check ((select public.premium_is_staff(array['reviewer', 'admin'])));

grant select, insert, update, delete on table public.premium_anomalies to authenticated;
drop policy if exists premium_anomalies_staff_select on public.premium_anomalies;
drop policy if exists premium_anomalies_staff_all on public.premium_anomalies;
create policy premium_anomalies_staff_all
on public.premium_anomalies for all to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])))
with check ((select public.premium_is_staff(array['reviewer', 'admin'])));

grant select, insert, update, delete on table public.premium_analysis_field_reviews to authenticated;
drop policy if exists premium_analysis_field_reviews_staff_select on public.premium_analysis_field_reviews;
drop policy if exists premium_analysis_field_reviews_staff_all on public.premium_analysis_field_reviews;
create policy premium_analysis_field_reviews_staff_all
on public.premium_analysis_field_reviews for all to authenticated
using ((select public.premium_is_staff(array['reviewer', 'admin'])))
with check ((select public.premium_is_staff(array['reviewer', 'admin'])));

commit;
