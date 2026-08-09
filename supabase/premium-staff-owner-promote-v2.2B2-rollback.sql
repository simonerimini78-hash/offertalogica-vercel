-- OffertaLogica Staff v2.2B2 - rollback della SOLA promozione Proprietario.
-- Riporta a admin soltanto lo stesso UUID/email promosso da B2.
-- Usare solo se B2 crea un problema immediato, prima di ulteriori modifiche ai ruoli Staff.

begin;

do $$
declare
  v_target uuid := '9e81ab10-22ff-4c62-bf23-fbec1aa5af67'::uuid;
  v_email text := 'offertalogica@gmail.com';
  v_matches integer;
  v_owners integer;
  v_updated integer;
begin
  -- Il rollback e' sicuro solo se questo e' ancora l'unico owner.
  select count(*) into v_owners
  from public.premium_staff_members
  where role = 'owner';

  if v_owners <> 1 then
    raise exception 'premium_staff_owner_rollback_blocked:unexpected_owner_count:%', v_owners;
  end if;

  select count(*) into v_matches
  from public.premium_staff_members staff
  join auth.users auth_user on auth_user.id = staff.user_id
  where staff.user_id = v_target
    and lower(coalesce(auth_user.email, '')) = lower(v_email)
    and staff.role = 'owner'
    and staff.active = true;

  if v_matches <> 1 then
    raise exception 'premium_staff_owner_rollback_blocked:target_mismatch:%', v_matches;
  end if;

  update public.premium_staff_members
  set role = 'admin',
      updated_at = now()
  where user_id = v_target
    and role = 'owner'
    and active = true;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'premium_staff_owner_rollback_blocked:unexpected_update_count:%', v_updated;
  end if;
end;
$$;

commit;
