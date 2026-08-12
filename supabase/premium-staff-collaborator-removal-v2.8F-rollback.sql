-- Rollback emergenza v2.8F collaboratori.
-- Prima ripristinare anche i file UI precedenti.
begin;

drop function if exists public.premium_owner_restore_staff(uuid,text,text);
drop function if exists public.premium_owner_remove_staff(uuid,text);
drop function if exists public.premium_owner_list_staff_v2(boolean);
drop trigger if exists premium_staff_member_removal_consistency_trigger on public.premium_staff_members;
drop function if exists public.premium_staff_member_removal_consistency();

alter table public.premium_staff_members
  drop column if exists removed_reason,
  drop column if exists removed_by,
  drop column if exists removed_at;

commit;
