-- OffertaLogica Staff v2.2B2 - promozione Proprietario
-- Promuove SOLO l'account identificato e verificato da admin attivo a owner.
-- Target verificato il 2026-08-09 tramite discovery B2:
-- user_id: 9e81ab10-22ff-4c62-bf23-fbec1aa5af67
-- email: offertalogica@gmail.com

begin;

do $$
declare
  v_target uuid := '9e81ab10-22ff-4c62-bf23-fbec1aa5af67'::uuid;
  v_email text := 'offertalogica@gmail.com';
  v_matches integer;
  v_active_admins integer;
  v_owners integer;
  v_constraint text;
  v_updated integer;
begin
  -- B2 deve partire esattamente dallo schema B1 che ammette owner.
  select pg_get_constraintdef(c.oid)
    into v_constraint
  from pg_constraint c
  where c.conrelid = 'public.premium_staff_members'::regclass
    and c.contype = 'c'
    and c.conname = 'premium_staff_members_role_check';

  if v_constraint is null
     or v_constraint not like '%owner%'
     or v_constraint not like '%technician%' then
    raise exception 'premium_staff_owner_promote_blocked:role_schema_not_ready:%', coalesce(v_constraint, '<missing>');
  end if;

  -- Lo stato verificato prima di B2 contiene un solo admin attivo e nessun owner.
  select count(*) into v_active_admins
  from public.premium_staff_members
  where active = true and role = 'admin';

  if v_active_admins <> 1 then
    raise exception 'premium_staff_owner_promote_blocked:unexpected_active_admin_count:%', v_active_admins;
  end if;

  select count(*) into v_owners
  from public.premium_staff_members
  where role = 'owner';

  if v_owners <> 0 then
    raise exception 'premium_staff_owner_promote_blocked:owner_already_exists:%', v_owners;
  end if;

  -- UUID, email, ruolo e stato devono corrispondere tutti al discovery approvato.
  select count(*) into v_matches
  from public.premium_staff_members staff
  join auth.users auth_user on auth_user.id = staff.user_id
  where staff.user_id = v_target
    and lower(coalesce(auth_user.email, '')) = lower(v_email)
    and staff.role = 'admin'
    and staff.active = true;

  if v_matches <> 1 then
    raise exception 'premium_staff_owner_promote_blocked:target_mismatch:%', v_matches;
  end if;

  update public.premium_staff_members
  set role = 'owner',
      updated_at = now()
  where user_id = v_target
    and role = 'admin'
    and active = true;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'premium_staff_owner_promote_blocked:unexpected_update_count:%', v_updated;
  end if;
end;
$$;

commit;
