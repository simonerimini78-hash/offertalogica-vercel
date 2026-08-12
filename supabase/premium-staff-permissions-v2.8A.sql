-- OffertaLogica Staff v2.8A
-- Fondazione autorevole della matrice permessi Staff.
--
-- Base verificata:
--   branch: staff-v2-control-center
--   commit: 356b278b1cab9a03adca3f3e4234f21d3cef9510 (Staff-V2.7C2)
--
-- OBIETTIVO
-- - Owner: accesso sempre completo, non delegabile e non revocabile dalla matrice.
-- - Admin: default deny; l'Owner concede/revoca esplicitamente i moduli delegabili.
-- - Technician/Reviewer legacy: profilo tecnico fisso e non estendibile dalla matrice.
-- - Support: nessun permesso V2.8 di default.
-- - Premium omaggio: resta governato esclusivamente da V2.5A.
--
-- Questa fase NON modifica menu, RPC operative, RLS esistenti o API.
-- V2.8B applichera' la matrice all'interfaccia.
-- V2.8C applichera' la matrice alle operazioni/API/RPC sensibili.

begin;

do $$
begin
  if to_regprocedure('public.premium_staff_raw_role()') is null then
    raise exception 'premium_staff_raw_role_missing';
  end if;

  if to_regprocedure('public.premium_staff_audit_insert(uuid,text,text,text,text,text,text,jsonb,text)') is null then
    raise exception 'premium_staff_audit_insert_missing';
  end if;

  if to_regprocedure('public.premium_staff_can_manage_complimentary()') is null then
    raise exception 'premium_complimentary_governance_v25_missing';
  end if;

  if to_regclass('public.premium_staff_members') is null then
    raise exception 'premium_staff_members_missing';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalogo interno delle capacita'.
-- Non e' una tabella modificabile: il catalogo e' versione-controllato nello SQL.
-- ---------------------------------------------------------------------------

create or replace function public.premium_staff_permission_catalog_internal()
returns table (
  permission_key text,
  permission_label text,
  permission_category text,
  admin_configurable boolean,
  technician_fixed_allowed boolean,
  owner_only boolean,
  governance_source text
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from (
    values
      ('view_control',              'Controllo',                    'Operativita',       true,  false, false, 'matrix'),
      ('view_cases',                'Pratiche',                     'Operativita',       true,  false, false, 'matrix'),
      ('view_customers',            'Clienti e utenze',            'Operativita',       true,  false, false, 'matrix'),
      ('view_checks',               'Bollette e verifiche',        'Operativita',       true,  true,  false, 'matrix'),
      ('view_leads',                'Lead e attivazioni',           'Commerciale',       true,  false, false, 'matrix'),
      ('view_analytics',            'Statistiche',                  'Analisi',           true,  false, false, 'matrix'),
      ('view_site_preview',         'Verifica sito e funnel',       'Strumenti tecnici', true,  false, false, 'matrix'),
      ('view_pdf_diagnostics',      'Diagnostica PDF',              'Strumenti tecnici', true,  true,  false, 'matrix'),
      ('view_ai_costs',             'Costi IA e configurazione',    'Strumenti tecnici', true,  false, false, 'matrix'),
      ('manage_checks',             'Gestione verifiche bollette',  'Operativita',       true,  true,  false, 'matrix'),
      ('manage_customers',          'Gestione clienti',             'Operativita',       true,  false, false, 'matrix'),
      ('manage_billing',            'Gestione pagamenti / Stripe',  'Commerciale',       true,  false, false, 'matrix'),
      ('manage_ai_configuration',   'Configurazione IA',            'Strumenti tecnici', true,  false, false, 'matrix'),
      ('delete_records',            'Eliminazioni critiche',        'Gestione',           true,  false, false, 'matrix'),
      ('manage_complimentary',      'Premium omaggio',              'Commerciale',       false, false, false, 'v2.5A'),
      ('view_audit',                'Audit completo',               'Gestione',           false, false, true,  'owner_only'),
      ('manage_collaborators',      'Gestione collaboratori',       'Gestione',           false, false, true,  'owner_only'),
      ('manage_staff_permissions',  'Gestione permessi Staff',      'Gestione',           false, false, true,  'owner_only'),
      ('view_owner_dashboard',      'Dashboard Owner',              'Gestione',           false, false, true,  'owner_only'),
      ('view_owner_lab',            'Laboratorio Owner',            'Gestione',           false, false, true,  'owner_only')
  ) as catalog (
    permission_key,
    permission_label,
    permission_category,
    admin_configurable,
    technician_fixed_allowed,
    owner_only,
    governance_source
  );
$$;

revoke all on function public.premium_staff_permission_catalog_internal()
from public, anon, authenticated, service_role;

-- Catalogo pubblico allo Staff autenticato: non contiene dati utente.
create or replace function public.premium_staff_permission_catalog()
returns table (
  permission_key text,
  permission_label text,
  permission_category text,
  admin_configurable boolean,
  technician_fixed_allowed boolean,
  owner_only boolean,
  governance_source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.premium_staff_raw_role(), '') = '' then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  return query
  select
    catalog.permission_key,
    catalog.permission_label,
    catalog.permission_category,
    catalog.admin_configurable,
    catalog.technician_fixed_allowed,
    catalog.owner_only,
    catalog.governance_source
  from public.premium_staff_permission_catalog_internal() as catalog
  order by
    case catalog.permission_category
      when 'Operativita' then 1
      when 'Commerciale' then 2
      when 'Analisi' then 3
      when 'Strumenti tecnici' then 4
      when 'Gestione' then 5
      else 9
    end,
    catalog.permission_label;
end;
$$;

revoke all on function public.premium_staff_permission_catalog()
from public, anon;
grant execute on function public.premium_staff_permission_catalog()
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Override espliciti Owner -> Admin.
-- Nessuna riga per Owner e nessun override per Technician.
-- ---------------------------------------------------------------------------

create table if not exists public.premium_staff_permissions (
  staff_user_id uuid not null
    references public.premium_staff_members(user_id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default false,
  reason text not null default '',
  updated_by uuid not null
    references public.premium_staff_members(user_id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (staff_user_id, permission_key),
  constraint premium_staff_permissions_key_length
    check (length(trim(permission_key)) between 1 and 80),
  constraint premium_staff_permissions_reason_length
    check (length(reason) <= 500)
);

comment on table public.premium_staff_permissions is
  'Override espliciti Owner->Admin della matrice Staff v2.8. Owner sempre full; Technician/Reviewer con profilo tecnico fisso; Premium omaggio resta V2.5A.';

create index if not exists premium_staff_permissions_updated_idx
  on public.premium_staff_permissions (updated_at desc);

alter table public.premium_staff_permissions enable row level security;

revoke all on table public.premium_staff_permissions
from public, anon, authenticated;

grant select, insert, update, delete
on table public.premium_staff_permissions
to service_role;

-- ---------------------------------------------------------------------------
-- Helper puri di policy.
-- ---------------------------------------------------------------------------

create or replace function public.premium_staff_permission_known(
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.premium_staff_permission_catalog_internal() as catalog
    where catalog.permission_key = lower(trim(coalesce(p_permission_key, '')))
  );
$$;

revoke all on function public.premium_staff_permission_known(text)
from public, anon, authenticated, service_role;

create or replace function public.premium_staff_permission_admin_configurable(
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select catalog.admin_configurable
    from public.premium_staff_permission_catalog_internal() as catalog
    where catalog.permission_key = lower(trim(coalesce(p_permission_key, '')))
    limit 1
  ), false);
$$;

revoke all on function public.premium_staff_permission_admin_configurable(text)
from public, anon, authenticated, service_role;

create or replace function public.premium_staff_permission_default_for_role(
  p_role text,
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := lower(trim(coalesce(p_role, '')));
  v_key text := lower(trim(coalesce(p_permission_key, '')));
  v_technician_allowed boolean := false;
begin
  if not public.premium_staff_permission_known(v_key) then
    return false;
  end if;

  if v_role = 'owner' then
    return true;
  end if;

  -- Admin e' intenzionalmente default-deny.
  if v_role = 'admin' then
    return false;
  end if;

  -- Reviewer e' trattato come ruolo tecnico legacy.
  if v_role in ('technician', 'reviewer') then
    select catalog.technician_fixed_allowed
      into v_technician_allowed
    from public.premium_staff_permission_catalog_internal() as catalog
    where catalog.permission_key = v_key;

    return coalesce(v_technician_allowed, false);
  end if;

  return false;
end;
$$;

revoke all on function public.premium_staff_permission_default_for_role(text,text)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper autorevole per il chiamante corrente.
-- E' la funzione che V2.8B/V2.8C useranno per menu e enforcement.
-- ---------------------------------------------------------------------------

create or replace function public.premium_staff_permission_allowed(
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := coalesce(public.premium_staff_raw_role(), '');
  v_key text := lower(trim(coalesce(p_permission_key, '')));
  v_explicit_allowed boolean;
begin
  if v_user_id is null or v_role = '' then
    return false;
  end if;

  if not public.premium_staff_permission_known(v_key) then
    return false;
  end if;

  -- L'Owner e' sempre full e non dipende da righe della matrice.
  if v_role = 'owner' then
    return true;
  end if;

  -- Governance dedicata V2.5A: nessuna seconda fonte di verita'.
  if v_key = 'manage_complimentary' then
    return public.premium_staff_can_manage_complimentary();
  end if;

  -- Profilo tecnico fisso: nessun override puo' ampliarlo.
  if v_role in ('technician', 'reviewer') then
    return public.premium_staff_permission_default_for_role(v_role, v_key);
  end if;

  if v_role <> 'admin' then
    return false;
  end if;

  -- Gli Owner-only e i permessi speciali non sono delegabili all'Admin.
  if not public.premium_staff_permission_admin_configurable(v_key) then
    return false;
  end if;

  select permission_record.allowed
    into v_explicit_allowed
  from public.premium_staff_permissions as permission_record
  where permission_record.staff_user_id = v_user_id
    and permission_record.permission_key = v_key;

  if found then
    return coalesce(v_explicit_allowed, false);
  end if;

  -- Default-deny Admin.
  return public.premium_staff_permission_default_for_role(v_role, v_key);
end;
$$;

revoke all on function public.premium_staff_permission_allowed(text)
from public, anon;
grant execute on function public.premium_staff_permission_allowed(text)
to authenticated, service_role;

create or replace function public.premium_staff_effective_permissions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(public.premium_staff_raw_role(), '');
  v_permissions jsonb := '{}'::jsonb;
begin
  if v_role = '' then
    raise exception 'premium_staff_access_required' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_object_agg(
      catalog.permission_key,
      public.premium_staff_permission_allowed(catalog.permission_key)
      order by catalog.permission_key
    ),
    '{}'::jsonb
  )
  into v_permissions
  from public.premium_staff_permission_catalog_internal() as catalog;

  return jsonb_build_object(
    'policy_version', '2.8A',
    'role', v_role,
    'permissions', v_permissions
  );
end;
$$;

revoke all on function public.premium_staff_effective_permissions()
from public, anon;
grant execute on function public.premium_staff_effective_permissions()
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mutazione Owner-only degli override Admin.
-- Motivo obbligatorio e Audit V2.4.
-- ---------------------------------------------------------------------------

create or replace function public.premium_owner_set_staff_permission(
  p_user_id uuid,
  p_permission_key text,
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
  v_owner_role text := coalesce(public.premium_staff_raw_role(), '');
  v_target_role text;
  v_key text := lower(trim(coalesce(p_permission_key, '')));
  v_allowed boolean := coalesce(p_allowed, false);
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  if v_owner_role <> 'owner' then
    raise exception 'premium_owner_required' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'premium_staff_user_id_invalid' using errcode = '22023';
  end if;

  if v_reason = '' then
    raise exception 'premium_staff_permission_reason_required' using errcode = '22023';
  end if;

  if not public.premium_staff_permission_known(v_key) then
    raise exception 'premium_staff_permission_invalid' using errcode = '22023';
  end if;

  if v_key = 'manage_complimentary' then
    raise exception 'premium_staff_permission_dedicated_governance' using errcode = '42501';
  end if;

  if not public.premium_staff_permission_admin_configurable(v_key) then
    raise exception 'premium_staff_permission_not_delegable' using errcode = '42501';
  end if;

  select staff.role
    into v_target_role
  from public.premium_staff_members as staff
  where staff.user_id = p_user_id
    and staff.active = true;

  if v_target_role is null then
    raise exception 'premium_staff_member_not_found' using errcode = 'P0002';
  end if;

  if v_target_role = 'owner' then
    raise exception 'premium_owner_protected' using errcode = '42501';
  end if;

  if v_target_role in ('technician', 'reviewer') then
    raise exception 'premium_staff_permission_technician_fixed' using errcode = '42501';
  end if;

  if v_target_role <> 'admin' then
    raise exception 'premium_staff_permission_admin_only' using errcode = '42501';
  end if;

  insert into public.premium_staff_permissions (
    staff_user_id,
    permission_key,
    allowed,
    reason,
    updated_by,
    updated_at
  )
  values (
    p_user_id,
    v_key,
    v_allowed,
    v_reason,
    v_owner_id,
    now()
  )
  on conflict (staff_user_id, permission_key) do update
    set allowed = excluded.allowed,
        reason = excluded.reason,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  perform public.premium_staff_audit_insert(
    v_owner_id,
    'owner',
    case
      when v_allowed then 'staff_permission_granted'
      else 'staff_permission_revoked'
    end,
    'staff_member',
    p_user_id::text,
    'success',
    v_reason,
    jsonb_build_object(
      'permission_key', v_key,
      'allowed', v_allowed,
      'target_role', v_target_role,
      'policy_version', '2.8A'
    ),
    'rpc:premium_owner_set_staff_permission'
  );

  return jsonb_build_object(
    'ok', true,
    'staff_user_id', p_user_id,
    'permission_key', v_key,
    'allowed', v_allowed,
    'reason', v_reason,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.premium_owner_set_staff_permission(uuid,text,boolean,text)
from public, anon;
grant execute on function public.premium_owner_set_staff_permission(uuid,text,boolean,text)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Vista Owner della matrice completa.
-- manage_complimentary viene letto dalla tabella V2.5A, non duplicato.
-- ---------------------------------------------------------------------------

create or replace function public.premium_owner_list_staff_permission_matrix()
returns table (
  staff_user_id uuid,
  staff_email text,
  staff_role text,
  staff_active boolean,
  permission_key text,
  permission_label text,
  permission_category text,
  configurable boolean,
  explicit_allowed boolean,
  effective_allowed boolean,
  permission_source text,
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
    coalesce(auth_user.email::text, ''),
    staff.role,
    staff.active,
    catalog.permission_key,
    catalog.permission_label,
    catalog.permission_category,
    (
      staff.role = 'admin'
      and staff.active = true
      and catalog.admin_configurable = true
    ) as configurable,
    case
      when staff.role = 'admin' and catalog.permission_key = 'manage_complimentary'
        then complimentary.allowed
      when staff.role = 'admin' and catalog.admin_configurable
        then permission_record.allowed
      else null
    end as explicit_allowed,
    case
      when staff.role = 'owner' then true
      when catalog.permission_key = 'manage_complimentary' and staff.role = 'admin'
        then coalesce(complimentary.allowed, false)
      when staff.role = 'admin' and catalog.admin_configurable
        then coalesce(permission_record.allowed, false)
      when staff.role in ('technician', 'reviewer')
        then catalog.technician_fixed_allowed
      else false
    end as effective_allowed,
    case
      when staff.role = 'owner' then 'owner_always'
      when catalog.permission_key = 'manage_complimentary' and staff.role = 'admin'
        then 'v2.5A'
      when staff.role = 'admin' and catalog.admin_configurable and permission_record.staff_user_id is not null
        then 'owner_override'
      when staff.role = 'admin' and catalog.admin_configurable
        then 'admin_default_deny'
      when staff.role in ('technician', 'reviewer') and catalog.technician_fixed_allowed
        then 'technical_fixed'
      when catalog.owner_only then 'owner_only'
      else 'role_denied'
    end::text as permission_source,
    case
      when staff.role = 'admin' and catalog.permission_key = 'manage_complimentary'
        then coalesce(complimentary.reason, '')
      when staff.role = 'admin' and catalog.admin_configurable
        then coalesce(permission_record.reason, '')
      else ''
    end::text as permission_reason,
    case
      when staff.role = 'admin' and catalog.permission_key = 'manage_complimentary'
        then complimentary.updated_at
      when staff.role = 'admin' and catalog.admin_configurable
        then permission_record.updated_at
      else null
    end as permission_updated_at
  from public.premium_staff_members as staff
  left join auth.users as auth_user
    on auth_user.id = staff.user_id
  cross join public.premium_staff_permission_catalog_internal() as catalog
  left join public.premium_staff_permissions as permission_record
    on permission_record.staff_user_id = staff.user_id
   and permission_record.permission_key = catalog.permission_key
  left join public.premium_staff_complimentary_permissions as complimentary
    on complimentary.staff_user_id = staff.user_id
  order by
    case staff.role
      when 'owner' then 0
      when 'admin' then 1
      when 'technician' then 2
      when 'reviewer' then 3
      when 'support' then 4
      else 9
    end,
    lower(coalesce(auth_user.email, '')),
    case catalog.permission_category
      when 'Operativita' then 1
      when 'Commerciale' then 2
      when 'Analisi' then 3
      when 'Strumenti tecnici' then 4
      when 'Gestione' then 5
      else 9
    end,
    catalog.permission_label;
end;
$$;

revoke all on function public.premium_owner_list_staff_permission_matrix()
from public, anon;
grant execute on function public.premium_owner_list_staff_permission_matrix()
to authenticated, service_role;

comment on function public.premium_staff_permission_allowed(text) is
  'Staff v2.8A: decisione autorevole per un singolo permesso del chiamante corrente. Owner sempre full; Admin default-deny con override Owner; tecnico profilo fisso.';
comment on function public.premium_staff_effective_permissions() is
  'Staff v2.8A: snapshot JSON dei permessi effettivi del chiamante. Non modifica il comportamento UI fino a V2.8B.';
comment on function public.premium_owner_set_staff_permission(uuid,text,boolean,text) is
  'Staff v2.8A: Owner-only. Concede/revoca un permesso delegabile a un Admin con motivazione e Audit.';
comment on function public.premium_owner_list_staff_permission_matrix() is
  'Staff v2.8A: Owner-only. Matrice completa per Owner/Admin/Tecnico e permessi speciali.';

commit;
