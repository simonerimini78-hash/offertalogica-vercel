-- OffertaLogica Staff v2.6A - verifica NON distruttiva.
-- Verifica struttura, protezione Owner e forma del payload.

begin;

select
  to_regprocedure('public.premium_owner_dashboard_metrics()') is not null
    as owner_dashboard_rpc_exists,
  has_function_privilege(
    'authenticated',
    'public.premium_owner_dashboard_metrics()',
    'EXECUTE'
  ) as authenticated_can_invoke_guarded_rpc;

-- Atteso: entrambi true.

select
  position(
    'premium_staff_raw_role'
    in pg_get_functiondef('public.premium_owner_dashboard_metrics()'::regprocedure)
  ) > 0 as exact_raw_role_guard_present,
  position(
    'premium_owner_required'
    in pg_get_functiondef('public.premium_owner_dashboard_metrics()'::regprocedure)
  ) > 0 as owner_required_present,
  position(
    'distinct on (subscription.user_id)'
    in lower(pg_get_functiondef('public.premium_owner_dashboard_metrics()'::regprocedure))
  ) > 0 as latest_subscription_dedup_present,
  position(
    'premium_complimentary_events'
    in pg_get_functiondef('public.premium_owner_dashboard_metrics()'::regprocedure)
  ) > 0 as complimentary_events_source_present,
  position(
    'premium_staff_audit_events'
    in pg_get_functiondef('public.premium_owner_dashboard_metrics()'::regprocedure)
  ) > 0 as audit_source_present;

-- Atteso: tutti true.

-- Se esiste almeno un collaboratore non-Owner attivo, deve essere respinto.
do $$
declare
  v_non_owner uuid;
  v_blocked boolean := false;
begin
  select staff.user_id
    into v_non_owner
  from public.premium_staff_members staff
  where staff.active = true
    and staff.role <> 'owner'
  order by staff.created_at
  limit 1;

  if v_non_owner is not null then
    perform set_config('request.jwt.claim.sub', v_non_owner::text, true);

    begin
      perform public.premium_owner_dashboard_metrics();
    exception
      when sqlstate '42501' then
        v_blocked := true;
    end;

    if not v_blocked then
      raise exception 'premium_owner_dashboard_non_owner_not_blocked';
    end if;
  end if;
end;
$$;

-- Verifica reale come Owner, senza modificare dati.
select set_config(
  'request.jwt.claim.sub',
  (
    select staff.user_id::text
    from public.premium_staff_members staff
    where staff.role = 'owner'
      and staff.active = true
    order by staff.created_at
    limit 1
  ),
  true
);

select
  public.premium_staff_raw_role() = 'owner' as raw_role_is_owner,
  jsonb_typeof(public.premium_owner_dashboard_metrics()) = 'object'
    as dashboard_payload_is_object,
  (public.premium_owner_dashboard_metrics() ? 'customers')
    as customers_section_present,
  (public.premium_owner_dashboard_metrics() ? 'subscriptions')
    as subscriptions_section_present,
  (public.premium_owner_dashboard_metrics() ? 'operations')
    as operations_section_present,
  (public.premium_owner_dashboard_metrics() ? 'costs')
    as costs_section_present,
  (public.premium_owner_dashboard_metrics() ? 'complimentary')
    as complimentary_section_present,
  (public.premium_owner_dashboard_metrics() ? 'staff')
    as staff_section_present,
  (public.premium_owner_dashboard_metrics() ? 'governance')
    as governance_section_present;

-- Atteso: tutti true.

-- Controllo esplicito: il payload non contiene chiavi tipiche PII.
select
  position('"email"' in lower(public.premium_owner_dashboard_metrics()::text)) = 0
    as payload_has_no_email_key,
  position('"phone"' in lower(public.premium_owner_dashboard_metrics()::text)) = 0
    as payload_has_no_phone_key,
  position('"full_name"' in lower(public.premium_owner_dashboard_metrics()::text)) = 0
    as payload_has_no_name_key;

-- Atteso: tutti true.

rollback;
