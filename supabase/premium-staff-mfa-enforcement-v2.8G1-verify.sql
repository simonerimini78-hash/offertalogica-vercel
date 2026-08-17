-- Verifica OffertaLogica Security Step 6B2 / Staff v2.8G1
-- Non modifica dati o configurazione.

do $$
declare
  v_mfa_definition text;
  v_permission_definition text;
begin
  if to_regprocedure('public.premium_staff_mfa_verified()') is null then
    raise exception 'VERIFY_FAIL: premium_staff_mfa_verified_missing';
  end if;

  if to_regprocedure('public.premium_staff_permission_allowed(text)') is null then
    raise exception 'VERIFY_FAIL: premium_staff_permission_allowed_missing';
  end if;

  select pg_get_functiondef('public.premium_staff_mfa_verified()'::regprocedure)
    into v_mfa_definition;

  if position('auth.jwt()' in v_mfa_definition) = 0
     or position('aal2' in v_mfa_definition) = 0 then
    raise exception 'VERIFY_FAIL: mfa_helper_does_not_check_aal2';
  end if;

  select pg_get_functiondef('public.premium_staff_permission_allowed(text)'::regprocedure)
    into v_permission_definition;

  if position('premium_staff_mfa_verified' in v_permission_definition) = 0 then
    raise exception 'VERIFY_FAIL: permission_matrix_not_gated_by_mfa';
  end if;

  raise notice 'VERIFY_OK: Staff MFA AAL2 enforcement centrale installato.';
end;
$$;

select
  to_regprocedure('public.premium_staff_mfa_verified()') is not null
    as mfa_helper_installed,
  to_regprocedure('public.premium_staff_permission_allowed(text)') is not null
    as permission_gate_installed;
