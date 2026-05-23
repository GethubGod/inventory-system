insert into public.app_config (key, value, description) values
  (
    'quick_order_daily_limit_per_user',
    '5000'::jsonb,
    'Max parse calls per user per day'
  )
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;
