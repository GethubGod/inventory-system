-- Install the recurring-reminder schedule without persisting credentials in
-- migration text. Production setup stores `project_url` and
-- `recurring_reminder_cron_secret` in Supabase Vault, then invokes this helper.
do $extensions$
begin
  begin
    create extension if not exists pg_net;
  exception when feature_not_supported or undefined_file then
    raise notice 'pg_net is unavailable in this environment; schedule installation will remain dormant';
  end;

  begin
    create extension if not exists pg_cron;
  exception when feature_not_supported or undefined_file then
    raise notice 'pg_cron is unavailable in this environment; schedule installation will remain dormant';
  end;
end;
$extensions$;

create or replace function public.install_recurring_reminder_schedule()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_url text;
  v_cron_secret text;
  v_command text;
begin
  select decrypted_secret
  into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  order by updated_at desc
  limit 1;

  select decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets
  where name = 'recurring_reminder_cron_secret'
  order by updated_at desc
  limit 1;

  if nullif(btrim(v_project_url), '') is null
    or nullif(btrim(v_cron_secret), '') is null then
    return false;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'evaluate-recurring-reminders-every-10m';

  v_command := format(
    $cron$select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', %L
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 15000
    );$cron$,
    rtrim(v_project_url, '/') || '/functions/v1/evaluate-recurring-reminders',
    'Bearer ' || v_cron_secret
  );

  perform cron.schedule(
    'evaluate-recurring-reminders-every-10m',
    '*/10 * * * *',
    v_command
  );

  return true;
end;
$function$;

revoke all on function public.install_recurring_reminder_schedule() from public, anon, authenticated;
grant execute on function public.install_recurring_reminder_schedule() to service_role;

notify pgrst, 'reload schema';
