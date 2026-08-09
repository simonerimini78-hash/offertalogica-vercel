-- OffertaLogica Staff v2.4A - fondazione Audit + governance Collaboratori
-- Base verificata: Staff v2.3B2.1.
-- Ambito intenzionalmente ristretto:
--   1) crea registro audit Staff applicativo;
--   2) espone lettura esclusivamente all'Owner;
--   3) registra le mutazioni Collaboratori eseguite dalle RPC Owner esistenti.
-- Non modifica frontend, Stripe, omaggi, pratiche, bollette, lead o analytics.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;
  if to_regprocedure('public.premium_owner_add_staff(text,text)') is null then
    raise exception 'premium_owner_add_staff_missing';
  end if;
  if to_regprocedure('public.premium_owner_update_staff(uuid,text,boolean)') is null then
    raise exception 'premium_owner_update_staff_missing';
  end if;
end;
$$;

create table if not exists public.premium_staff_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_user_id uuid,
  staff_email text not null default '',
  staff_role text not null default '',
  action text not null,
  target_type text not null,
  target_id text,
  result text not null default 'success'
    check (result in ('success', 'error', 'denied')),
  reason text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'database'
);

comment on table public.premium_staff_audit_events is
  'Registro applicativo append-only delle operazioni Staff. Nessun accesso diretto agli utenti authenticated.';
comment on column public.premium_staff_audit_events.staff_user_id is
  'UUID dell’operatore al momento dell’evento. Nessuna FK: lo storico resta leggibile anche se l’account Auth viene rimosso.';
comment on column public.premium_staff_audit_events.staff_role is
  'Snapshot del ruolo reale dell’operatore al momento dell’evento.';
comment on column public.premium_staff_audit_events.metadata is
  'Metadati tecnici minimi; non deve contenere password, token, PDF o contenuti completi delle comunicazioni.';

alter table public.premium_staff_audit_events enable row level security;

revoke all on table public.premium_staff_audit_events from public, anon, authenticated;
revoke update, delete, truncate on table public.premium_staff_audit_events from service_role;
grant select, insert on table public.premium_staff_audit_events to service_role;

create index if not exists premium_staff_audit_created_idx
  on public.premium_staff_audit_events (created_at desc);
create index if not exists premium_staff_audit_actor_idx
  on public.premium_staff_audit_events (staff_user_id, created_at desc);
create index if not exists premium_staff_audit_action_idx
  on public.premium_staff_audit_events (action, created_at desc);
create index if not exists premium_staff_audit_target_idx
  on public.premium_staff_audit_events (target_type, target_id, created_at desc);

create or replace function public.premium_staff_audit_insert(
  p_staff_user_id uuid,
  p_staff_role text,
  p_action text,
  p_target_type text,
  p_target_id text default null,
  p_result text default 'success',
  p_reason text default '',
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'database'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_staff_email text := '';
  v_role text := lower(trim(coalesce(p_staff_role, '')));
  v_action text := left(trim(coalesce(p_action, '')), 120);
  v_target_type text := left(trim(coalesce(p_target_type, '')), 80);
  v_result text := lower(trim(coalesce(p_result, 'success')));
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_source text := left(trim(coalesce(p_source, 'database')), 120);
begin
  if p_staff_user_id is null then
    raise exception 'premium_staff_audit_actor_required';
  end if;

  if v_role not in ('support', 'reviewer', 'technician', 'admin', 'owner') then
    raise exception 'premium_staff_audit_role_invalid';
  end if;

  if v_action = '' or v_target_type = '' then
    raise exception 'premium_staff_audit_action_invalid';
  end if;

  if v_result not in ('success', 'error', 'denied') then
    raise exception 'premium_staff_audit_result_invalid';
  end if;

  select coalesce(auth_user.email::text, '')
    into v_staff_email
  from auth.users as auth_user
  where auth_user.id = p_staff_user_id;

  insert into public.premium_staff_audit_events (
    staff_user_id,
    staff_email,
    staff_role,
    action,
    target_type,
    target_id,
    result,
    reason,
    metadata,
    source
  )
  values (
    p_staff_user_id,
    coalesce(v_staff_email, ''),
    v_role,
    v_action,
    v_target_type,
    nullif(left(trim(coalesce(p_target_id, '')), 200), ''),
    v_result,
    v_reason,
    coalesce(p_metadata, '{}'::jsonb),
    case when v_source = '' then 'database' else v_source end
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.premium_staff_audit_insert(
  uuid, text, text, text, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.premium_staff_audit_insert(
  uuid, text, text, text, text, text, text, jsonb, text
) to service_role;

create or replace function public.premium_owner_list_audit(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  event_id uuid,
  event_created_at timestamptz,
  staff_user_id uuid,
  staff_email text,
  staff_role text,
  action text,
  target_type text,
  target_id text,
  result text,
  reason text,
  metadata jsonb,
  source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required';
  end if;

  return query
  select
    audit.id,
    audit.created_at,
    audit.staff_user_id,
    audit.staff_email,
    audit.staff_role,
    audit.action,
    audit.target_type,
    audit.target_id,
    audit.result,
    audit.reason,
    audit.metadata,
    audit.source
  from public.premium_staff_audit_events as audit
  order by audit.created_at desc, audit.id desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.premium_owner_list_audit(integer, integer)
from public, anon;
grant execute on function public.premium_owner_list_audit(integer, integer)
to authenticated, service_role;

create or replace function public.premium_owner_add_staff(
  p_email text,
  p_role text default 'technician'
)
returns table (
  user_id uuid,
  email text,
  role text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_role text := lower(trim(coalesce(p_role, '')));
  v_user_id uuid;
  v_existing_role text;
  v_existing_active boolean;
  v_action text;
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required';
  end if;

  if v_email = '' or position('@' in v_email) <= 1 then
    raise exception 'premium_staff_email_invalid';
  end if;

  if v_role not in ('admin', 'technician') then
    raise exception 'premium_staff_role_invalid';
  end if;

  select auth_user.id
    into v_user_id
  from auth.users as auth_user
  where lower(coalesce(auth_user.email, '')) = v_email
  limit 1;

  if v_user_id is null then
    raise exception 'premium_staff_auth_user_not_found';
  end if;

  select staff.role, staff.active
    into v_existing_role, v_existing_active
  from public.premium_staff_members as staff
  where staff.user_id = v_user_id;

  if v_existing_role = 'owner' then
    raise exception 'premium_owner_protected';
  end if;

  execute $upsert$
    insert into public.premium_staff_members (user_id, role, active)
    values ($1, $2, true)
    on conflict (user_id) do update
      set role = excluded.role,
          active = true,
          updated_at = now()
  $upsert$
  using v_user_id, v_role;

  v_action := case
    when v_existing_role is null then 'staff_member_added_existing_auth'
    when coalesce(v_existing_active, false) = false then 'staff_member_reactivated'
    when v_existing_role is distinct from v_role then 'staff_role_changed'
    else 'staff_member_upserted'
  end;

  perform public.premium_staff_audit_insert(
    auth.uid(),
    'owner',
    v_action,
    'staff_member',
    v_user_id::text,
    'success',
    '',
    jsonb_build_object(
      'target_email', v_email,
      'previous_role', v_existing_role,
      'previous_active', v_existing_active,
      'new_role', v_role,
      'new_active', true
    ),
    'rpc:premium_owner_add_staff'
  );

  return query
  select
    staff.user_id,
    auth_user.email::text,
    staff.role,
    staff.active,
    staff.created_at,
    staff.updated_at
  from public.premium_staff_members as staff
  left join auth.users as auth_user on auth_user.id = staff.user_id
  where staff.user_id = v_user_id;
end;
$$;

revoke all on function public.premium_owner_add_staff(text, text) from public, anon;
grant execute on function public.premium_owner_add_staff(text, text) to authenticated, service_role;

create or replace function public.premium_owner_update_staff(
  p_user_id uuid,
  p_role text,
  p_active boolean
)
returns table (
  user_id uuid,
  email text,
  role text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := lower(trim(coalesce(p_role, '')));
  v_current_role text;
  v_current_active boolean;
  v_next_active boolean := coalesce(p_active, false);
  v_target_email text := '';
  v_updated integer;
  v_action text;
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required';
  end if;

  if p_user_id is null then
    raise exception 'premium_staff_user_id_invalid';
  end if;

  if v_role not in ('admin', 'technician') then
    raise exception 'premium_staff_role_invalid';
  end if;

  select staff.role, staff.active, coalesce(auth_user.email::text, '')
    into v_current_role, v_current_active, v_target_email
  from public.premium_staff_members as staff
  left join auth.users as auth_user on auth_user.id = staff.user_id
  where staff.user_id = p_user_id;

  if v_current_role is null then
    raise exception 'premium_staff_member_not_found';
  end if;

  if v_current_role = 'owner' then
    raise exception 'premium_owner_protected';
  end if;

  update public.premium_staff_members
  set role = v_role,
      active = v_next_active,
      updated_at = now()
  where premium_staff_members.user_id = p_user_id
    and premium_staff_members.role <> 'owner';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'premium_staff_update_failed';
  end if;

  v_action := case
    when v_current_role is distinct from v_role then 'staff_role_changed'
    when v_current_active is distinct from v_next_active and v_next_active then 'staff_access_reactivated'
    when v_current_active is distinct from v_next_active and not v_next_active then 'staff_access_deactivated'
    else 'staff_member_updated'
  end;

  perform public.premium_staff_audit_insert(
    auth.uid(),
    'owner',
    v_action,
    'staff_member',
    p_user_id::text,
    'success',
    '',
    jsonb_build_object(
      'target_email', v_target_email,
      'previous_role', v_current_role,
      'previous_active', v_current_active,
      'new_role', v_role,
      'new_active', v_next_active
    ),
    'rpc:premium_owner_update_staff'
  );

  return query
  select
    staff.user_id,
    auth_user.email::text,
    staff.role,
    staff.active,
    staff.created_at,
    staff.updated_at
  from public.premium_staff_members as staff
  left join auth.users as auth_user on auth_user.id = staff.user_id
  where staff.user_id = p_user_id;
end;
$$;

revoke all on function public.premium_owner_update_staff(uuid, text, boolean) from public, anon;
grant execute on function public.premium_owner_update_staff(uuid, text, boolean) to authenticated, service_role;

comment on function public.premium_owner_add_staff(text, text) is
  'Staff v2.4A: Owner-only. Mantiene B2.1 e registra in Audit aggiunta/riattivazione/cambio ruolo via upsert.';
comment on function public.premium_owner_update_staff(uuid, text, boolean) is
  'Staff v2.4A: Owner-only. Mantiene B1 e registra in Audit ruolo/stato collaboratore.';
comment on function public.premium_owner_list_audit(integer, integer) is
  'Staff v2.4A: lettura paginata del registro Audit, esclusivamente Owner.';

commit;
