-- OffertaLogica Staff v2.8F — verifica finale RLS/Supporto.
-- Nessuna modifica persistente: termina con ROLLBACK.

begin;

select
  to_regprocedure('public.premium_staff_permission_allowed(text)') is not null as permission_helper_ok,
  to_regprocedure('public.premium_staff_account_support_snapshot(uuid)') is not null as support_snapshot_ok;

-- Nessuna vecchia policy Staff FOR ALL deve sopravvivere sulle superfici chiuse.
select not exists (
  select 1 from pg_policies
  where schemaname = 'public'
    and policyname in (
      'premium_subscriptions_staff_all',
      'premium_utilities_staff_all',
      'premium_contracts_staff_all',
      'premium_analysis_runs_staff_all',
      'premium_checks_staff_all',
      'premium_anomalies_staff_all',
      'premium_communications_staff_all',
      'premium_analysis_field_reviews_staff_all',
      'premium_cost_events_staff_all'
    )
) as legacy_staff_all_removed;

-- Membership: solo self-select diretto.
select
  count(*) = 1 as staff_self_policy_single,
  bool_and(qual ilike '%auth.uid%') as staff_self_uses_auth_uid,
  bool_and(qual not ilike '%premium_is_staff%') as staff_self_no_role_bypass
from pg_policies
where schemaname='public' and tablename='premium_staff_members' and policyname='premium_staff_self_select';

-- Tutte le policy Staff finali pubbliche devono usare la matrice V2.8.
with expected(policyname) as (
  values
    ('premium_profiles_staff_select'),
    ('premium_subscriptions_staff_select'),
    ('premium_utilities_staff_select'),
    ('premium_contracts_staff_select'),
    ('premium_bills_staff_select'),
    ('premium_analysis_runs_staff_select'),
    ('premium_checks_staff_select'),
    ('premium_check_notes_staff_select'),
    ('premium_anomalies_staff_select'),
    ('premium_analysis_field_reviews_staff_select'),
    ('premium_communications_staff_select'),
    ('premium_communications_staff_insert'),
    ('premium_communications_staff_update'),
    ('premium_communications_staff_delete'),
    ('premium_consents_staff_select'),
    ('premium_cost_events_staff_select')
)
select
  count(*) = (select count(*) from expected) as all_public_staff_policies_present,
  bool_and(coalesce(qual,'') || ' ' || coalesce(with_check,'') ilike '%premium_staff_permission_allowed%') as all_public_staff_policies_use_matrix
from pg_policies p
join expected e using(policyname)
where p.schemaname='public';

-- PDF: richiesta cliente non annullata preservata.
select
  qual ilike '%premium_staff_permission_allowed%view_checks%'
  and qual ilike '%check_record.status%<>%canceled%'
  as bills_staff_request_gate_ok
from pg_policies
where schemaname='public' and tablename='premium_bills' and policyname='premium_bills_staff_select';

select
  qual ilike '%premium_staff_permission_allowed%view_checks%'
  and qual ilike '%check_record.status%<>%canceled%'
  as storage_staff_request_gate_ok
from pg_policies
where schemaname='storage' and tablename='objects' and policyname='premium_bills_storage_staff_select';

select
  qual ilike '%premium_staff_permission_allowed%view_customers%'
  and qual ilike '%premium_staff_permission_allowed%delete_records%'
  as storage_delete_double_gate_ok
from pg_policies
where schemaname='storage' and tablename='objects' and policyname='premium_bills_storage_staff_delete';

-- Cancellazione DB diretta bolletta Admin legacy rimossa: passa dalla RPC V2.8C1.
select not exists (
  select 1 from pg_policies
  where schemaname='public' and tablename='premium_bills' and policyname='premium_bills_admin_delete'
) as bills_legacy_direct_delete_removed;

-- Supporto: snapshot sotto view_cases.
select
  position('premium_staff_permission_allowed(''view_cases'')' in pg_get_functiondef(
    'public.premium_staff_account_support_snapshot(uuid)'::regprocedure
  )) > 0 as support_snapshot_view_cases_gate_ok,
  position('premium_is_staff' in pg_get_functiondef(
    'public.premium_staff_account_support_snapshot(uuid)'::regprocedure
  )) = 0 as support_snapshot_no_legacy_role_gate;

-- Comunicazioni: delete richiede sia modulo sia permesso distruttivo.
select
  qual ilike '%view_cases%'
  and qual ilike '%delete_records%'
  as support_delete_double_gate_ok
from pg_policies
where schemaname='public' and tablename='premium_communications' and policyname='premium_communications_staff_delete';

-- Le policy cliente più importanti devono essere ancora presenti.
select
  exists(select 1 from pg_policies where schemaname='public' and tablename='premium_bills' and policyname='premium_bills_owner_select') as bills_owner_select_preserved,
  exists(select 1 from pg_policies where schemaname='public' and tablename='premium_bills' and policyname='premium_bills_owner_delete') as bills_owner_delete_preserved,
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='premium_bills_storage_owner_select') as storage_owner_select_preserved,
  exists(select 1 from pg_policies where schemaname='public' and tablename='premium_consents' and policyname='premium_consents_owner_insert') as consent_owner_insert_preserved;

-- Owner corrente: tutti i permessi effettivi devono restare true.
do $$
declare
  v_owner uuid;
  v_payload jsonb;
  v_all_true boolean;
begin
  select user_id into v_owner
  from public.premium_staff_members
  where role='owner' and active=true
  order by created_at, user_id
  limit 1;
  if v_owner is null then raise exception 'staff_v2_8F_owner_missing'; end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_payload := public.premium_staff_effective_permissions();
  select bool_and(value::boolean) into v_all_true
  from jsonb_each_text(v_payload -> 'permissions');
  if coalesce(v_all_true,false) <> true then
    raise exception 'staff_v2_8F_owner_not_full';
  end if;
end;
$$;


-- Eliminazioni: doppio gate modulo + delete_records.
select
  position('delete_records' in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)) > 0 as delete_records_gate_ok,
  position('view_customers' in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)) > 0 as delete_customers_module_gate_ok,
  position('view_ai_costs' in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)) > 0 as delete_costs_module_gate_ok,
  position('premium_delete_resource_not_allowed' in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)) > 0 as delete_unknown_resource_blocked;

select
  position('delete_records' in pg_get_functiondef('public.premium_staff_complete_account_deletion(uuid,text)'::regprocedure)) > 0 as account_delete_records_gate_ok,
  position('view_customers' in pg_get_functiondef('public.premium_staff_complete_account_deletion(uuid,text)'::regprocedure)) > 0 as account_delete_customer_module_gate_ok;

select true as v2_8F_final_rls_verifier_completed;
rollback;
