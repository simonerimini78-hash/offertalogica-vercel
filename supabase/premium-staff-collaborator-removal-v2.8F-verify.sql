-- Verifica v2.8F rimozione collaboratori. Non persiste modifiche.
begin;

select
  to_regprocedure('public.premium_owner_list_staff_v2(boolean)') is not null as list_v2_ok,
  to_regprocedure('public.premium_owner_remove_staff(uuid,text)') is not null as remove_rpc_ok,
  to_regprocedure('public.premium_owner_restore_staff(uuid,text,text)') is not null as restore_rpc_ok,
  to_regprocedure('public.premium_staff_member_removal_consistency()') is not null as consistency_trigger_function_ok;

select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='premium_staff_members' and column_name='removed_at') as removed_at_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='premium_staff_members' and column_name='removed_by') as removed_by_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='premium_staff_members' and column_name='removed_reason') as removed_reason_ok;

select
  exists(
    select 1 from pg_trigger
    where tgrelid='public.premium_staff_members'::regclass
      and tgname='premium_staff_member_removal_consistency_trigger'
      and not tgisinternal
  ) as removal_consistency_trigger_ok;

select
  not has_function_privilege('anon','public.premium_owner_remove_staff(uuid,text)','EXECUTE') as anon_remove_denied,
  has_function_privilege('authenticated','public.premium_owner_remove_staff(uuid,text)','EXECUTE') as authenticated_remove_guarded,
  not has_function_privilege('anon','public.premium_owner_restore_staff(uuid,text,text)','EXECUTE') as anon_restore_denied,
  has_function_privilege('authenticated','public.premium_owner_restore_staff(uuid,text,text)','EXECUTE') as authenticated_restore_guarded;

select
  position('premium_owner_protected' in pg_get_functiondef('public.premium_owner_remove_staff(uuid,text)'::regprocedure)) > 0 as owner_protected,
  position('premium_staff_permissions' in pg_get_functiondef('public.premium_owner_remove_staff(uuid,text)'::regprocedure)) > 0 as matrix_permissions_cleared,
  position('premium_staff_complimentary_permissions' in pg_get_functiondef('public.premium_owner_remove_staff(uuid,text)'::regprocedure)) > 0 as complimentary_permission_cleared,
  position('premium_staff_audit_insert' in pg_get_functiondef('public.premium_owner_remove_staff(uuid,text)'::regprocedure)) > 0 as removal_audited,
  position('permissions_reset' in pg_get_functiondef('public.premium_owner_restore_staff(uuid,text,text)'::regprocedure)) > 0 as restore_default_deny_documented;

-- Contesto Owner reale: la lista deve essere invocabile e contenere l'Owner.
do $$
declare v_owner uuid; v_count integer;
begin
  select user_id into v_owner from public.premium_staff_members
  where role='owner' and active=true order by created_at limit 1;
  if v_owner is null then raise exception 'staff_v28f_owner_missing'; end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  select count(*) into v_count from public.premium_owner_list_staff_v2(true) where role='owner';
  if v_count < 1 then raise exception 'staff_v28f_owner_not_listed'; end if;
end;
$$;

select public.premium_staff_raw_role()='owner' as owner_context_ok,
       (select count(*) >= 1 from public.premium_owner_list_staff_v2(true) where role='owner') as owner_list_ok;

rollback;
