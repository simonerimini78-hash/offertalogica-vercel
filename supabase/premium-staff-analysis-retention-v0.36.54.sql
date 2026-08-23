-- OffertaLogica Staff v0.36.54
-- La pulizia del registro analisi/costi NON deve riportare la bolletta a "da analizzare".
-- Base verificata: staff-v2-control-center @ feacc60e4ff281fafe9bc9cbb5b1ac37bcda01ee
-- Strategia: conserva la funzione v0.34 come legacy per tutte le altre risorse e
-- intercetta solo analysis_runs. La FK premium_bills_automatic_analysis_run_fk
-- e' ON DELETE SET NULL: eliminando il run si azzera solo il riferimento tecnico,
-- senza modificare stato, esito e dati cliente della bolletta.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_delete_records_v034_legacy(text,uuid[])') is null then
    if to_regprocedure('public.premium_staff_delete_records(text,uuid[])') is null then
      raise exception 'premium_staff_delete_records_missing';
    end if;

    alter function public.premium_staff_delete_records(text, uuid[])
      rename to premium_staff_delete_records_v034_legacy;
  end if;
end;
$$;

create or replace function public.premium_staff_delete_records(
  p_resource text,
  p_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_resource text := lower(trim(coalesce(p_resource, '')));
  v_ids uuid[] := coalesce(p_ids, array[]::uuid[]);
  v_target_count integer := 0;
  v_run_ids uuid[] := array[]::uuid[];
begin
  -- Mantiene gli stessi vincoli amministrativi della funzione preesistente.
  if v_admin_id is null or public.premium_staff_role() <> 'admin' then
    raise exception 'premium_admin_delete_required' using errcode = '42501';
  end if;

  if cardinality(v_ids) = 0 then
    raise exception 'premium_delete_ids_required' using errcode = '22023';
  end if;

  if cardinality(v_ids) > 500 then
    raise exception 'premium_delete_limit_exceeded' using errcode = '22023';
  end if;

  if v_resource = 'analysis_runs' then
    select count(*)::integer,
           coalesce(array_agg(run.id), array[]::uuid[])
      into v_target_count, v_run_ids
    from public.premium_analysis_runs run
    where run.id = any(v_ids);

    -- Pulizia contabile richiesta dallo Staff.
    delete from public.premium_cost_events cost
    where cost.analysis_run_id = any(v_run_ids);

    -- NON modificare premium_bills.
    -- La FK ON DELETE SET NULL elimina automaticamente solo automatic_analysis_run_id.
    delete from public.premium_analysis_runs run
    where run.id = any(v_run_ids);

    return jsonb_build_object(
      'resource', v_resource,
      'deleted_count', v_target_count,
      'requested_count', cardinality(v_ids),
      'deleted_at', now(),
      'deleted_by', v_admin_id,
      'bill_analysis_state_preserved', true
    );
  end if;

  -- Tutte le altre eliminazioni mantengono esattamente il comportamento v0.34.
  return public.premium_staff_delete_records_v034_legacy(p_resource, p_ids);
end;
$$;

revoke all on function public.premium_staff_delete_records_v034_legacy(text, uuid[])
  from public, anon, authenticated;
revoke all on function public.premium_staff_delete_records(text, uuid[])
  from public, anon;

grant execute on function public.premium_staff_delete_records(text, uuid[])
  to authenticated, service_role;

comment on function public.premium_staff_delete_records(text, uuid[]) is
  'v0.36.54: la cancellazione dei run/costi Staff preserva lo stato funzionale e i dati analizzati della bolletta; le altre risorse usano la logica legacy v0.34.';

commit;
