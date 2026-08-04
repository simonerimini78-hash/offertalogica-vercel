-- ESEGUIRE SOLTANTO DOPO:
-- 1. deployment della Edge Function premium-trial-cleanup;
-- 2. disattivazione Verify JWT per questa funzione;
-- 3. creazione del secret Edge PREMIUM_CLEANUP_CRON_SECRET;
-- 4. creazione in Vault dei tre secret indicati sotto.
--
-- Secret Vault richiesti:
-- offertalogica_project_url       = https://kzxdamhfmzaxonpkytcf.supabase.co
-- offertalogica_publishable_key   = chiave sb_publishable del progetto
-- offertalogica_cleanup_cron_secret = stesso valore di PREMIUM_CLEANUP_CRON_SECRET

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'offertalogica-premium-trial-cleanup-daily'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'offertalogica-premium-trial-cleanup-daily',
  '17 3 * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'offertalogica_project_url'
      limit 1
    ) || '/functions/v1/premium-trial-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'offertalogica_publishable_key'
        limit 1
      ),
      'x-offertalogica-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'offertalogica_cleanup_cron_secret'
        limit 1
      )
    ),
    body := '{"dry_run":false,"limit":25}'::jsonb
  ) as request_id;
  $job$
);
