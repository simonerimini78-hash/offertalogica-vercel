-- OffertaLogica Premium - strumenti staff per problemi account/accesso.
-- Espone allo staff soltanto uno snapshot operativo minimo dell'account Auth.
-- Non consente di leggere o impostare password.

begin;

create or replace function public.premium_staff_account_support_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (select public.premium_is_staff()) then
    raise exception 'premium_staff_required';
  end if;

  select jsonb_build_object(
    'user_id', users.id,
    'email', users.email,
    'email_confirmed', users.email_confirmed_at is not null,
    'email_confirmed_at', users.email_confirmed_at,
    'last_sign_in_at', users.last_sign_in_at,
    'auth_created_at', users.created_at,
    'profile_status', profiles.account_status,
    'subscription_status', subscriptions.status,
    'subscription_plan', subscriptions.plan_code,
    'subscription_period_end', subscriptions.current_period_end
  )
  into v_result
  from auth.users users
  left join public.premium_profiles profiles
    on profiles.id = users.id
  left join lateral (
    select
      subscription.status,
      subscription.plan_code,
      subscription.current_period_end
    from public.premium_subscriptions subscription
    where subscription.user_id = users.id
    order by subscription.created_at desc
    limit 1
  ) subscriptions on true
  where users.id = p_user_id;

  if v_result is null then
    raise exception 'premium_account_not_found';
  end if;

  return v_result;
end;
$$;

revoke all on function public.premium_staff_account_support_snapshot(uuid)
from public, anon;

grant execute on function public.premium_staff_account_support_snapshot(uuid)
to authenticated, service_role;

commit;
