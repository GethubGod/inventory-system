-- Quick Order app configuration table.
--
-- Stores feature flags, parser mode, cost guardrails, and kill switch
-- settings for the Quick Order system. Only the service role can write;
-- authenticated users can read.

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

insert into public.app_config (key, value, description) values
  ('quick_order_parser_mode', '"auto"'::jsonb, 'live | mock | auto. auto = mock if no AI key, else live'),
  ('quick_order_enabled', 'true'::jsonb, 'Master kill switch for Quick Order feature'),
  ('quick_order_daily_limit_per_user', '100'::jsonb, 'Max parse calls per user per day'),
  ('quick_order_monthly_token_budget', '5000000'::jsonb, 'Max input+output tokens per org per month'),
  ('quick_order_token_warning_threshold', '0.8'::jsonb, 'Log warning when usage exceeds this fraction of budget')
on conflict (key) do nothing;

alter table public.app_config enable row level security;

drop policy if exists app_config_read_authenticated on public.app_config;
create policy app_config_read_authenticated
  on public.app_config
  for select
  to authenticated
  using (true);

-- Only service role can write — managed via SQL or admin functions.

grant select on public.app_config to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

-- Rollback:
-- drop policy if exists app_config_read_authenticated on public.app_config;
-- drop table if exists public.app_config;
