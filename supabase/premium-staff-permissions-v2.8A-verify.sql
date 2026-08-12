-- OffertaLogica Staff v2.8A — verifica live
-- Nessuna modifica persistente: BEGIN ... ROLLBACK.

begin;

-- 1) Presenza fondazione.
select
  to_regclass('public.premium_staff_permissions') is not null
    as permissions_table_ok,
  to_regprocedure('public.premium_staff_permission_catalog()') is not null
    as catalog_rpc_ok,
  to_regprocedure('public.premium_staff_permission_allowed(text)') is not null
    as allowed_rpc_ok,
  to_regprocedure('public.premium_staff_effective_permissions()') is not null
    as effective_rpc_ok,
  to_regprocedure('public.premium_owner_set_staff_permission(uuid,text,boolean,text)') is not null
    as owner_set_rpc_ok,
  to_regprocedure('public.premium_owner_list_staff_permission_matrix()') is not null
    as owner_matrix_rpc_ok;

-- 2) Nessun accesso diretto authenticated alla tabella override.
select
  not has_table_privilege('authenticated','public.premium_staff_permissions','SELECT')
    as authenticated_no_direct_select,
  not has_table_privilege('authenticated','public.premium_staff_permissions','INSERT')
    as authenticated_no_direct_insert,
  not has_table_privilege('authenticated','public.premium_staff_permissions','UPDATE')
    as authenticated_no_direct_update,
  not has_table_privilege('authenticated','public.premium_staff_permissions','DELETE')
    as authenticated_no_direct_delete;

-- 3) Superfici RPC esposte correttamente.
select
  has_function_privilege(
    'authenticated',
    'public.premium_staff_permission_catalog()',
    'EXECUTE'
  ) as authenticated_catalog_execute,
  has_function_privilege(
    'authenticated',
    'public.premium_staff_permission_allowed(text)',
    'EXECUTE'
  ) as authenticated_allowed_execute,
  has_function_privilege(
    'authenticated',
    'public.premium_staff_effective_permissions()',
    'EXECUTE'
  ) as authenticated_effective_execute,
  has_function_privilege(
    'authenticated',
    'public.premium_owner_set_staff_permission(uuid,text,boolean,text)',
    'EXECUTE'
  ) as authenticated_owner_set_execute_guarded,
  has_function_privilege(
    'authenticated',
    'public.premium_owner_list_staff_permission_matrix()',
    'EXECUTE'
  ) as authenticated_owner_matrix_execute_guarded;

-- 4) Catalogo: 20 permessi esatti, nessun duplicato.
select
  count(*) = 20 as catalog_count_ok,
  count(*) = count(distinct permission_key) as catalog_unique_ok,
  bool_and(length(trim(permission_key)) > 0) as catalog_keys_nonempty
from public.premium_staff_permission_catalog_internal();

-- 5) Regole pure: Owner sempre full.
select
  bool_and(
    public.premium_staff_permission_default_for_role(
      'owner',
      catalog.permission_key
    )
  ) as owner_all_catalog_permissions_true
from public.premium_staff_permission_catalog_internal() as catalog;

-- 6) Admin default-deny su tutta la matrice.
select
  bool_and(
    not public.premium_staff_permission_default_for_role(
      'admin',
      catalog.permission_key
    )
  ) as admin_default_deny_all
from public.premium_staff_permission_catalog_internal() as catalog;

-- 7) Tecnico/reviewer: ESATTAMENTE tre capacita' tecniche fisse.
select
  count(*) filter (where technician_fixed_allowed) = 3
    as technician_exact_three_fixed,
  bool_and(
    technician_fixed_allowed = (
      permission_key in (
        'view_checks',
        'view_pdf_diagnostics',
        'manage_checks'
      )
    )
  ) as technician_fixed_keys_exact
from public.premium_staff_permission_catalog_internal();

select
  public.premium_staff_permission_default_for_role('technician','view_checks')
    as technician_view_checks_true,
  public.premium_staff_permission_default_for_role('technician','manage_checks')
    as technician_manage_checks_true,
  public.premium_staff_permission_default_for_role('technician','view_pdf_diagnostics')
    as technician_pdf_true,
  not public.premium_staff_permission_default_for_role('technician','view_customers')
    as technician_customers_false,
  not public.premium_staff_permission_default_for_role('technician','view_leads')
    as technician_leads_false,
  not public.premium_staff_permission_default_for_role('technician','view_analytics')
    as technician_analytics_false,
  not public.premium_staff_permission_default_for_role('technician','view_ai_costs')
    as technician_costs_false,
  not public.premium_staff_permission_default_for_role('technician','delete_records')
    as technician_delete_false;

-- 8) Owner-only e Premium omaggio non sono delegabili via matrice Admin.
select
  not public.premium_staff_permission_admin_configurable('manage_complimentary')
    as complimentary_not_matrix_configurable,
  not public.premium_staff_permission_admin_configurable('view_audit')
    as audit_not_admin_configurable,
  not public.premium_staff_permission_admin_configurable('manage_collaborators')
    as collaborators_not_admin_configurable,
  not public.premium_staff_permission_admin_configurable('manage_staff_permissions')
    as permissions_not_admin_configurable,
  not public.premium_staff_permission_admin_configurable('view_owner_dashboard')
    as owner_dashboard_not_admin_configurable,
  not public.premium_staff_permission_admin_configurable('view_owner_lab')
    as owner_lab_not_admin_configurable;

-- 9) Il permesso omaggio resta marcato V2.5A.
select
  count(*) = 1
  and bool_and(governance_source = 'v2.5A')
  as complimentary_source_v25_ok
from public.premium_staff_permission_catalog_internal()
where permission_key = 'manage_complimentary';

-- 10) Setter: motivazione e Audit sono presenti nella definizione.
select
  position(
    'premium_staff_permission_reason_required'
    in pg_get_functiondef(
      'public.premium_owner_set_staff_permission(uuid,text,boolean,text)'::regprocedure
    )
  ) > 0 as setter_reason_required,
  position(
    'premium_staff_audit_insert'
    in pg_get_functiondef(
      'public.premium_owner_set_staff_permission(uuid,text,boolean,text)'::regprocedure
    )
  ) > 0 as setter_audited,
  position(
    'premium_staff_permission_technician_fixed'
    in pg_get_functiondef(
      'public.premium_owner_set_staff_permission(uuid,text,boolean,text)'::regprocedure
    )
  ) > 0 as setter_blocks_technician_override,
  position(
    'premium_owner_protected'
    in pg_get_functiondef(
      'public.premium_owner_set_staff_permission(uuid,text,boolean,text)'::regprocedure
    )
  ) > 0 as setter_protects_owner;

-- 11) Contesto Owner reale: snapshot effettivo deve essere tutto true.
do $$
declare
  v_owner uuid;
  v_payload jsonb;
  v_all_true boolean;
begin
  select staff.user_id
    into v_owner
  from public.premium_staff_members as staff
  where staff.role = 'owner'
    and staff.active = true
  order by staff.created_at, staff.user_id
  limit 1;

  if v_owner is null then
    raise exception 'staff_v2_8A_owner_missing';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'staff_v2_8A_owner_context_failed';
  end if;

  v_payload := public.premium_staff_effective_permissions();

  if coalesce(v_payload ->> 'role', '') <> 'owner' then
    raise exception 'staff_v2_8A_owner_effective_role_failed';
  end if;

  select bool_and(
    coalesce((v_payload -> 'permissions' ->> catalog.permission_key)::boolean, false)
  )
    into v_all_true
  from public.premium_staff_permission_catalog_internal() as catalog;

  if coalesce(v_all_true, false) <> true then
    raise exception 'staff_v2_8A_owner_not_full';
  end if;

  -- Anche la matrice Owner deve essere leggibile.
  perform count(*)
  from public.premium_owner_list_staff_permission_matrix();
end;
$$;

select
  public.premium_staff_raw_role() = 'owner'
    as owner_raw_role_ok,
  (public.premium_staff_effective_permissions() ->> 'policy_version') = '2.8A'
    as effective_policy_version_ok,
  (
    select bool_and(value::boolean)
    from jsonb_each_text(
      public.premium_staff_effective_permissions() -> 'permissions'
    )
  ) as owner_effective_all_true,
  (
    select count(*) > 0
    from public.premium_owner_list_staff_permission_matrix()
  ) as owner_matrix_nonempty;

rollback;
