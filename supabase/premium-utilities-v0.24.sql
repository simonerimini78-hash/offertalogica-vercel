-- OFFERTALOGICA PREMIUM v0.24
-- Limite server-side delle utenze incluse nel piano.
-- Script incrementale e idempotente. Non modifica le tabelle del sito o l'archivio diagnostico.

begin;

create or replace function public.premium_can_add_utility()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_subscription as (
    select subscription.included_utilities
    from public.premium_subscriptions subscription
    where subscription.user_id = (select auth.uid())
      and subscription.status in ('trialing', 'active')
      and (
        subscription.current_period_end is null
        or subscription.current_period_end > now()
      )
    order by subscription.created_at desc
    limit 1
  )
  select
    (select public.premium_has_profile())
    and exists (select 1 from active_subscription)
    and (
      select count(*)
      from public.premium_utilities utility
      where utility.user_id = (select auth.uid())
        and utility.status <> 'archived'
    ) < coalesce((select included_utilities from active_subscription), 0);
$$;

revoke all on function public.premium_can_add_utility() from public, anon;
grant execute on function public.premium_can_add_utility() to authenticated, service_role;

drop policy if exists premium_utilities_owner_insert on public.premium_utilities;
create policy premium_utilities_owner_insert
on public.premium_utilities for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.premium_has_service_access())
  and (select public.premium_can_add_utility())
);

commit;
