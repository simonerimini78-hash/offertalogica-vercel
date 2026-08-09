-- OffertaLogica Staff v2.3B2.1 - verifica non distruttiva.
-- Eseguire DOPO premium-staff-collaborators-v2.3B2.1-fix-ambiguous-user-id.sql.

-- 1) La RPC deve esistere e mantenere la stessa firma.
select to_regprocedure('public.premium_owner_add_staff(text,text)') as add_staff_rpc;

-- 2) Evidenza della correzione: l'upsert deve essere eseguito tramite EXECUTE parametrizzato.
select
  position('execute $upsert$' in lower(pg_get_functiondef(
    'public.premium_owner_add_staff(text,text)'::regprocedure
  ))) > 0 as uses_dynamic_upsert,
  position('using v_user_id, v_role' in lower(pg_get_functiondef(
    'public.premium_owner_add_staff(text,text)'::regprocedure
  ))) > 0 as uses_parameter_binding;

-- 3) Test reale e NON distruttivo con il tuo Owner.
-- Prima del fix questa chiamata poteva fermarsi su:
--   column reference "user_id" is ambiguous
-- Dopo il fix deve arrivare alla protezione corretta:
--   premium_owner_protected
begin;

select set_config(
  'request.jwt.claim.sub',
  '9e81ab10-22ff-4c62-bf23-fbec1aa5af67',
  true
);

do $$
begin
  begin
    perform 1
    from public.premium_owner_add_staff(
      'offertalogica@gmail.com',
      'technician'
    );

    raise exception 'verification_failed_owner_was_not_protected';
  exception
    when others then
      if sqlerrm <> 'premium_owner_protected' then
        raise;
      end if;
  end;
end;
$$;

select
  auth.uid() as simulated_auth_uid,
  'premium_owner_protected'::text as expected_result,
  true as ambiguity_fix_pass;

rollback;

-- 4) Stato Owner invariato.
select
  staff.user_id,
  auth_user.email,
  staff.role,
  staff.active
from public.premium_staff_members as staff
join auth.users as auth_user on auth_user.id = staff.user_id
where staff.user_id = '9e81ab10-22ff-4c62-bf23-fbec1aa5af67'::uuid;
