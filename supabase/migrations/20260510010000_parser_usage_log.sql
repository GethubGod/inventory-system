-- Parser usage log for cost tracking and rate limiting.
--
-- Every parse-order call (live or mock, success or failure) writes a row here.
-- Used for per-user daily limits, per-org monthly token budgets, and
-- anomaly detection.

create table if not exists public.parser_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid,
  session_id uuid,
  call_type text not null,
  parser_mode text not null,
  ai_provider text,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  estimated_cost_usd numeric(10,6),
  duration_ms int,
  succeeded boolean not null default true,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists parser_usage_log_user_day
  on public.parser_usage_log(user_id, created_at desc);

create index if not exists parser_usage_log_org_month
  on public.parser_usage_log(org_id, created_at desc);

create index if not exists parser_usage_log_created
  on public.parser_usage_log(created_at desc);

alter table public.parser_usage_log enable row level security;

-- Only service role writes (from edge function). Managers can read for reporting.
drop policy if exists parser_usage_log_select_manager on public.parser_usage_log;
create policy parser_usage_log_select_manager
  on public.parser_usage_log
  for select
  to authenticated
  using (public.current_user_is_manager());

grant select on public.parser_usage_log to authenticated;

-- Anomaly detection function (data only, no notifications yet).
create or replace function public.check_parser_anomalies()
returns table (alert_type text, detail jsonb)
language plpgsql
security definer
as $$
declare
  today_count int;
  avg_count numeric;
begin
  select count(*) into today_count
  from public.parser_usage_log
  where created_at >= current_date
    and parser_mode = 'live';

  select avg(daily_count) into avg_count
  from (
    select date(created_at) as d, count(*) as daily_count
    from public.parser_usage_log
    where created_at >= current_date - interval '7 days'
      and created_at < current_date
      and parser_mode = 'live'
    group by date(created_at)
  ) recent;

  if today_count > coalesce(avg_count, 0) * 3 and today_count > 50 then
    return query select
      'high_volume_spike'::text,
      jsonb_build_object('today', today_count, 'avg_7d', avg_count);
  end if;
end;
$$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

-- Rollback:
-- drop function if exists public.check_parser_anomalies();
-- drop policy if exists parser_usage_log_select_manager on public.parser_usage_log;
-- drop table if exists public.parser_usage_log;
