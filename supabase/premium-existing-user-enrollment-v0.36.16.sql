-- OFFERTALOGICA PREMIUM v0.36.16
-- Consente a un utente Supabase Auth gia esistente di associare lo stesso
-- account al servizio Premium. Non modifica o rimuove eventuali ruoli staff.
-- L'attivazione della prova resta subordinata alle accettazioni legali correnti.

begin;

create or replace function public.premium_ensure_current_user_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := '';
  v_phone text := '';
  v_full_name text := '';
  v_existed boolean := false;
  v_status text := '';
begin
  if v_user_id is null then
    raise exception 'premium_auth_required' using errcode = '42501';
  end if;

  select
    lower(coalesce(users.email, '')),
    coalesce(users.phone, ''),
    trim(coalesce(users.raw_user_meta_data ->> 'full_name', ''))
  into v_email, v_phone, v_full_name
  from auth.users users
  where users.id = v_user_id;

  if not found then
    raise exception 'premium_auth_user_not_found' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.premium_profiles profile
    where profile.id = v_user_id
  ) into v_existed;

  insert into public.premium_profiles as profile (id, full_name, phone, email)
  values (v_user_id, v_full_name, v_phone, v_email)
  on conflict (id) do update set
    full_name = case
      when trim(coalesce(profile.full_name, '')) = ''
        then excluded.full_name
      else profile.full_name
    end,
    phone = case
      when trim(coalesce(profile.phone, '')) = ''
        then excluded.phone
      else profile.phone
    end,
    email = excluded.email,
    updated_at = now()
  returning account_status into v_status;

  return jsonb_build_object(
    'ok', true,
    'created', not v_existed,
    'user_id', v_user_id,
    'account_status', v_status
  );
end;
$$;

revoke all on function public.premium_ensure_current_user_profile()
  from public, anon;
grant execute on function public.premium_ensure_current_user_profile()
  to authenticated, service_role;

comment on function public.premium_ensure_current_user_profile() is
  'Associa l utente Auth corrente a premium_profiles senza modificare i ruoli staff e senza attivare automaticamente un piano.';

commit;
