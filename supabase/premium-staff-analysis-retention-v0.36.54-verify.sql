-- Verifica OffertaLogica Staff v0.36.54
-- Solo lettura: non modifica dati.

with checks as (
  select
    to_regprocedure('public.premium_staff_delete_records(text,uuid[])') is not null as wrapper_exists,
    to_regprocedure('public.premium_staff_delete_records_v034_legacy(text,uuid[])') is not null as legacy_exists,
    exists (
      select 1
      from pg_constraint
      where conname = 'premium_bills_automatic_analysis_run_fk'
        and conrelid = 'public.premium_bills'::regclass
        and confdeltype = 'n' -- SET NULL
    ) as run_fk_is_on_delete_set_null,
    position(
      'premium_staff_delete_records_v034_legacy'
      in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)
    ) > 0 as delegates_non_run_deletes,
    position(
      'v_resource = ''analysis_runs'''
      in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)
    ) > 0 as intercepts_analysis_runs,
    position(
      'automatic_screening_status = ''not_run'''
      in pg_get_functiondef('public.premium_staff_delete_records(text,uuid[])'::regprocedure)
    ) = 0 as wrapper_does_not_reset_bill_analysis
)
select *,
  (wrapper_exists
   and legacy_exists
   and run_fk_is_on_delete_set_null
   and delegates_non_run_deletes
   and intercepts_analysis_runs
   and wrapper_does_not_reset_bill_analysis) as all_checks_ok
from checks;
