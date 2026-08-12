-- OffertaLogica Staff v2.8B1 — verifica live
-- Sola lettura; termina con ROLLBACK.

begin;

select
  to_regprocedure('public.premium_owner_list_staff_activation_status()') is not null
    as activation_status_rpc_ok,
  has_function_privilege(
    'authenticated',
    'public.premium_owner_list_staff_activation_status()',
    'EXECUTE'
  ) as authenticated_execute_guarded_ok;

select
  position(
    'premium_staff_raw_role'
    in pg_get_functiondef(
      'public.premium_owner_list_staff_activation_status()'::regprocedure
    )
  ) > 0 as owner_role_guard_ok,
  position(
    'auth.users'
    in pg_get_functiondef(
      'public.premium_owner_list_staff_activation_status()'::regprocedure
    )
  ) > 0 as auth_users_source_ok,
  position(
    'invited_at'
    in pg_get_functiondef(
      'public.premium_owner_list_staff_activation_status()'::regprocedure
    )
  ) > 0 as invited_at_used_ok,
  position(
    'email_confirmed_at'
    in pg_get_functiondef(
      'public.premium_owner_list_staff_activation_status()'::regprocedure
    )
  ) > 0 as email_confirmed_at_used_ok;

do $$
declare
  v_owner uuid;
  v_bad_rows integer;
begin
  select staff.user_id
    into v_owner
  from public.premium_staff_members as staff
  where staff.role = 'owner'
    and staff.active = true
  order by staff.created_at, staff.user_id
  limit 1;

  if v_owner is null then
    raise exception 'staff_v2_8B1_owner_missing';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'staff_v2_8B1_owner_context_failed';
  end if;

  select count(*)
    into v_bad_rows
  from public.premium_owner_list_staff_activation_status() as status
  where status.activation_status not in (
    'disabled',
    'auth_missing',
    'invited_pending',
    'email_unconfirmed',
    'activated'
  )
  or (
    status.activation_status = 'invited_pending'
    and (
      status.invited_at is null
      or status.email_confirmed_at is not null
      or status.staff_active is not true
    )
  )
  or (
    status.activation_status = 'activated'
    and status.email_confirmed_at is null
  );

  if v_bad_rows <> 0 then
    raise exception 'staff_v2_8B1_activation_status_invariant_failed:%', v_bad_rows;
  end if;
end;
$$;

select
  public.premium_staff_raw_role() = 'owner'
    as owner_raw_role_ok,
  (
    select count(*) > 0
    from public.premium_owner_list_staff_activation_status()
  ) as owner_activation_list_nonempty,
  (
    select count(*) = 0
    from public.premium_owner_list_staff_activation_status()
    where activation_status = 'invited_pending'
      and (
        invited_at is null
        or email_confirmed_at is not null
        or staff_active is not true
      )
  ) as pending_invite_invariant_ok;

rollback;
