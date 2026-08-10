-- OffertaLogica Staff v2.5A
-- Governance Premium omaggio - fondazione backend.
-- Base verificata: Staff v2.4C + motore omaggi Premium v0.36.13.
--
-- Regole:
--   Owner: sempre autorizzato.
--   Admin: autorizzato solo se l'Owner concede esplicitamente il permesso.
--   Technician/Reviewer/Support: mai autorizzati.
--   Durata "unlimited": solo Owner.
--   Motivazione: obbligatoria per concessione/proroga e revoca.
--   Ogni operazione riuscita viene registrata anche nell'Audit Staff v2.4.
--
-- Il motore Premium v0.36.13 viene preservato integralmente:
-- le due RPC esistenti vengono rinominate come funzioni interne e invocate
-- dai nuovi wrapper di governance. Nessuna logica trial/restore viene riscritta.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;
  if to_regprocedure('public.premium_staff_audit_insert(uuid,text,text,text,text,text,text,jsonb,text)') is null then
    raise exception 'premium_staff_audit_insert_missing';
  end if;
  if to_regprocedure('public.premium_admin_set_complimentary(uuid,text,text)') is null then
    raise exception 'premium_admin_set_complimentary_missing';
  end if;
  if to_regprocedure('public.premium_admin_revoke_complimentary(uuid,text)') is null then
    raise exception 'premium_admin_revoke_complimentary_missing';
  end if;
  if to_regprocedure('public.premium_internal_set_complimentary_v03613(uuid,text,text)') is not null
     or to_regprocedure('public.premium_internal_revoke_complimentary_v03613(uuid,text)') is not null then
    raise exception 'premium_complimentary_governance_already_installed';
  end if;
end;
$$;

create table public.premium_staff_complimentary_permissions (
  staff_user_id uuid primary key
    references public.premium_staff_members(user_id) on delete cascade,
  allowed boolean not null default false,
  reason text not null default '',
  updated_by uuid not null
    references public.premium_staff_members(user_id) on delete restrict,
  updated_at timestamptz not null default now()
);

comment on table public.premium_staff_complimentary_permissions is
  'Permesso esplicito Owner->Admin per concedere/revocare Premium omaggio. Owner non necessita di una riga; gli altri ruoli restano sempre esclusi.';

alter table public.premium_staff_complimentary_permissions enable row level security;

revoke all on table public.premium_staff_complimentary_permissions
from public, anon, authenticated;
grant select, insert, update, delete
on table public.premium_staff_complimentary_permissions
to service_role;

create or replace function public.premium_staff_can_manage_complimentary()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := coalesce(public.premium_staff_raw_role(), '');
begin
  if v_user_id is null then
    return false;
  end if;

  if v_role = 'owner' then
    return true;
  end if;

  if v_role <> 'admin' then
    return false;
  end if;

  return exists (
    select 1
    from public.premium_staff_complimentary_permissions permission_record
    where permission_record.staff_user_id = v_user_id
      and permission_record.allowed = true
  );
end;
$$;

revoke all on function public.premium_staff_can_manage_complimentary()
from public, anon;
grant execute on function public.premium_staff_can_manage_complimentary()
to authenticated, service_role;

create or replace function public.premium_owner_set_complimentary_permission(
  p_user_id uuid,
  p_allowed boolean,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_target_role text;
  v_allowed boolean := coalesce(p_allowed, false);
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'premium_staff_user_id_invalid' using errcode = '22023';
  end if;

  if v_reason = '' then
    raise exception 'premium_complimentary_permission_reason_required' using errcode = '22023';
  end if;

  select staff.role
    into v_target_role
  from public.premium_staff_members staff
  where staff.user_id = p_user_id
    and staff.active = true;

  if v_target_role is null then
    raise exception 'premium_staff_member_not_found' using errcode = 'P0002';
  end if;

  if v_target_role = 'owner' then
    raise exception 'premium_owner_protected' using errcode = '42501';
  end if;

  if v_target_role <> 'admin' then
    raise exception 'premium_complimentary_permission_admin_only' using errcode = '42501';
  end if;

  insert into public.premium_staff_complimentary_permissions (
    staff_user_id,
    allowed,
    reason,
    updated_by,
    updated_at
  )
  values (
    p_user_id,
    v_allowed,
    v_reason,
    v_owner_id,
    now()
  )
  on conflict (staff_user_id) do update
    set allowed = excluded.allowed,
        reason = excluded.reason,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  perform public.premium_staff_audit_insert(
    v_owner_id,
    'owner',
    case when v_allowed
      then 'complimentary_admin_permission_granted'
      else 'complimentary_admin_permission_revoked'
    end,
    'staff_member',
    p_user_id::text,
    'success',
    v_reason,
    jsonb_build_object(
      'permission', 'manage_complimentary',
      'allowed', v_allowed
    ),
    'rpc:premium_owner_set_complimentary_permission'
  );

  return jsonb_build_object(
    'ok', true,
    'staff_user_id', p_user_id,
    'allowed', v_allowed,
    'reason', v_reason,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.premium_owner_set_complimentary_permission(uuid,boolean,text)
from public, anon;
grant execute on function public.premium_owner_set_complimentary_permission(uuid,boolean,text)
to authenticated, service_role;

create or replace function public.premium_owner_list_complimentary_permissions()
returns table (
  staff_user_id uuid,
  email text,
  role text,
  active boolean,
  complimentary_allowed boolean,
  permission_reason text,
  permission_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.premium_staff_raw_role(), '') <> 'owner' then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;

  return query
  select
    staff.user_id,
    auth_user.email::text,
    staff.role,
    staff.active,
    case
      when staff.role = 'owner' then true
      when staff.role = 'admin' then coalesce(permission_record.allowed, false)
      else false
    end,
    coalesce(permission_record.reason, '')::text,
    permission_record.updated_at
  from public.premium_staff_members staff
  left join auth.users auth_user
    on auth_user.id = staff.user_id
  left join public.premium_staff_complimentary_permissions permission_record
    on permission_record.staff_user_id = staff.user_id
  order by
    case staff.role
      when 'owner' then 0
      when 'admin' then 1
      when 'technician' then 2
      when 'reviewer' then 3
      else 4
    end,
    lower(coalesce(auth_user.email, '')),
    staff.created_at;
end;
$$;

revoke all on function public.premium_owner_list_complimentary_permissions()
from public, anon;
grant execute on function public.premium_owner_list_complimentary_permissions()
to authenticated, service_role;

-- Preserva il motore Premium v0.36.13 senza riscriverlo.
alter function public.premium_admin_set_complimentary(uuid,text,text)
  rename to premium_internal_set_complimentary_v03613;
alter function public.premium_admin_revoke_complimentary(uuid,text)
  rename to premium_internal_revoke_complimentary_v03613;

revoke all on function public.premium_internal_set_complimentary_v03613(uuid,text,text)
from public, anon, authenticated, service_role;
revoke all on function public.premium_internal_revoke_complimentary_v03613(uuid,text)
from public, anon, authenticated, service_role;

comment on function public.premium_internal_set_complimentary_v03613(uuid,text,text) is
  'Motore interno Premium omaggio v0.36.13. Non esporre al browser: usare premium_admin_set_complimentary.';
comment on function public.premium_internal_revoke_complimentary_v03613(uuid,text) is
  'Motore interno revoca Premium omaggio v0.36.13. Non esporre al browser: usare premium_admin_revoke_complimentary.';

create or replace function public.premium_admin_set_complimentary(
  p_user_id uuid,
  p_duration_code text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_role text := coalesce(public.premium_staff_raw_role(), '');
  v_duration_code text := lower(trim(coalesce(p_duration_code, '')));
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_result jsonb;
begin
  if v_staff_id is null or not public.premium_staff_can_manage_complimentary() then
    raise exception 'premium_complimentary_permission_required' using errcode = '42501';
  end if;

  if v_reason = '' then
    raise exception 'premium_complimentary_reason_required' using errcode = '22023';
  end if;

  if v_duration_code = 'unlimited' and v_role <> 'owner' then
    raise exception 'premium_complimentary_unlimited_owner_only' using errcode = '42501';
  end if;

  v_result := public.premium_internal_set_complimentary_v03613(
    p_user_id,
    v_duration_code,
    v_reason
  );

  perform public.premium_staff_audit_insert(
    v_staff_id,
    v_role,
    case coalesce(v_result ->> 'action', '')
      when 'extend' then 'complimentary_extended'
      else 'complimentary_granted'
    end,
    'premium_subscription',
    p_user_id::text,
    'success',
    v_reason,
    jsonb_build_object(
      'duration_code', v_duration_code,
      'subscription_id', v_result ->> 'subscription_id',
      'current_period_end', v_result ->> 'current_period_end',
      'unlimited', coalesce((v_result ->> 'unlimited')::boolean, false),
      'trial_will_restore', coalesce((v_result ->> 'trial_will_restore')::boolean, false)
    ),
    'rpc:premium_admin_set_complimentary'
  );

  return v_result;
end;
$$;

revoke all on function public.premium_admin_set_complimentary(uuid,text,text)
from public, anon;
grant execute on function public.premium_admin_set_complimentary(uuid,text,text)
to authenticated, service_role;

create or replace function public.premium_admin_revoke_complimentary(
  p_user_id uuid,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_role text := coalesce(public.premium_staff_raw_role(), '');
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_result jsonb;
begin
  if v_staff_id is null or not public.premium_staff_can_manage_complimentary() then
    raise exception 'premium_complimentary_permission_required' using errcode = '42501';
  end if;

  if v_reason = '' then
    raise exception 'premium_complimentary_reason_required' using errcode = '22023';
  end if;

  v_result := public.premium_internal_revoke_complimentary_v03613(
    p_user_id,
    v_reason
  );

  perform public.premium_staff_audit_insert(
    v_staff_id,
    v_role,
    'complimentary_revoked',
    'premium_subscription',
    p_user_id::text,
    'success',
    v_reason,
    jsonb_build_object(
      'subscription_id', v_result ->> 'subscription_id',
      'restored_trial', coalesce((v_result ->> 'restored_trial')::boolean, false),
      'trial_ends_at', v_result ->> 'trial_ends_at',
      'archive_access_until', v_result ->> 'archive_access_until'
    ),
    'rpc:premium_admin_revoke_complimentary'
  );

  return v_result;
end;
$$;

revoke all on function public.premium_admin_revoke_complimentary(uuid,text)
from public, anon;
grant execute on function public.premium_admin_revoke_complimentary(uuid,text)
to authenticated, service_role;

comment on function public.premium_admin_set_complimentary(uuid,text,text) is
  'Staff v2.5A: governance Premium omaggio. Owner sempre; Admin solo con permesso esplicito; unlimited solo Owner; motivazione obbligatoria; motore v0.36.13 preservato.';
comment on function public.premium_admin_revoke_complimentary(uuid,text) is
  'Staff v2.5A: revoca Premium omaggio con stessa governance e motivazione obbligatoria; motore v0.36.13 preservato.';

commit;
