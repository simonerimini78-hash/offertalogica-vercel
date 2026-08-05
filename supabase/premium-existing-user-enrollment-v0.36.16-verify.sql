-- Verifica OFFERTALOGICA PREMIUM v0.36.16

select
  to_regprocedure('public.premium_ensure_current_user_profile()') is not null
    as premium_existing_user_enrollment_function_exists,
  has_function_privilege(
    'authenticated',
    'public.premium_ensure_current_user_profile()',
    'EXECUTE'
  ) as authenticated_can_enroll,
  not has_function_privilege(
    'anon',
    'public.premium_ensure_current_user_profile()',
    'EXECUTE'
  ) as anon_cannot_enroll;

select 'premium_existing_user_enrollment_v0.36.16_ok' as verification_result;
