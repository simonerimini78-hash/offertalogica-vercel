-- Verifica OffertaLogica Security Step 6B3A / Staff v2.8G2
-- Non modifica dati o configurazione.

do $$
declare
  v_raw_role_definition text;
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'VERIFY_FAIL: premium_staff_raw_role_missing';
  end if;

  if to_regprocedure('public.premium_staff_mfa_verified()') is null then
    raise exception 'VERIFY_FAIL: premium_staff_mfa_verified_missing';
  end if;

  select pg_get_functiondef('public.premium_staff_raw_role()'::regprocedure)
    into v_raw_role_definition;

  if position('premium_staff_mfa_verified' in v_raw_role_definition) = 0 then
    raise exception 'VERIFY_FAIL: raw_role_not_gated_by_mfa';
  end if;

  raise notice 'VERIFY_OK: premium_staff_raw_role richiede MFA AAL2.';
end;
$$;

select
  to_regprocedure('public.premium_staff_mfa_verified()') is not null
    as mfa_helper_installed,
  position(
    'premium_staff_mfa_verified'
    in pg_get_functiondef('public.premium_staff_raw_role()'::regprocedure)
  ) > 0
    as raw_role_mfa_gate_installed;
