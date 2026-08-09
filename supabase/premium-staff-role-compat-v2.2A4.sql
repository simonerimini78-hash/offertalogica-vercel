-- OffertaLogica Staff v2.2A4
-- Compatibilita' preventiva dei ruoli v2 con le autorizzazioni Supabase esistenti.
--
-- IMPORTANTE:
-- - NON modifica il vincolo della colonna premium_staff_members.role;
-- - NON converte alcun account staff;
-- - gli attuali admin/reviewer mantengono esattamente il comportamento corrente;
-- - quando V2.2B abiliterà i nuovi valori nel vincolo, owner erediterà i controlli
--   legacy admin e technician erediterà i controlli legacy reviewer.

begin;

-- Mantiene la semantica esistente dei chiamanti: gli allowed_roles continuano
-- a essere interpretati come ruoli legacy (support/reviewer/admin).
-- Viene normalizzato soltanto il ruolo effettivo del membro staff.
create or replace function public.premium_is_staff(
  allowed_roles text[] default array['support', 'reviewer', 'admin']::text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.premium_staff_members staff
    where staff.user_id = (select auth.uid())
      and staff.active = true
      and (
        case staff.role
          when 'owner' then 'admin'
          when 'technician' then 'reviewer'
          else staff.role
        end
      ) = any(allowed_roles)
  );
$$;

revoke all on function public.premium_is_staff(text[]) from public, anon;
grant execute on function public.premium_is_staff(text[]) to authenticated, service_role;

-- Le RPC staff legacy confrontano il risultato con 'admin'/'reviewer'.
-- Restituire il ruolo normalizzato permette di preservare quelle RPC senza
-- riscriverle una per una.
create or replace function public.premium_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select
    case staff.role
      when 'owner' then 'admin'
      when 'technician' then 'reviewer'
      else staff.role
    end
  from public.premium_staff_members staff
  where staff.user_id = (select auth.uid())
    and staff.active = true
    and staff.role in ('reviewer', 'technician', 'admin', 'owner')
  limit 1;
$$;

revoke all on function public.premium_staff_role() from public, anon;
grant execute on function public.premium_staff_role() to authenticated, service_role;

comment on function public.premium_is_staff(text[]) is
  'Staff v2.2A4: compatibilita legacy. owner=>admin, technician=>reviewer; nessuna modifica ai ruoli salvati.';
comment on function public.premium_staff_role() is
  'Staff v2.2A4: restituisce il ruolo legacy equivalente per mantenere compatibili le RPC esistenti.';

commit;
