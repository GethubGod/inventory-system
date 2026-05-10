# Quick Order Operations Runbook

## Emergency: Disable Quick Order

If you need to immediately disable the Quick Order feature (e.g., runaway AI costs, broken parser):

```sql
-- Disable Quick Order immediately:
UPDATE app_config SET value = 'false'::jsonb WHERE key = 'quick_order_enabled';
```

To re-enable:

```sql
UPDATE app_config SET value = 'true'::jsonb WHERE key = 'quick_order_enabled';
```

## Switch to Mock Mode (No AI Calls)

Mock mode still works but uses local pattern matching instead of AI. No API credits consumed.

```sql
UPDATE app_config SET value = '"mock"'::jsonb WHERE key = 'quick_order_parser_mode';
```

To switch back to live AI mode:

```sql
UPDATE app_config SET value = '"live"'::jsonb WHERE key = 'quick_order_parser_mode';
```

To use auto mode (mock if no API key, live if key exists):

```sql
UPDATE app_config SET value = '"auto"'::jsonb WHERE key = 'quick_order_parser_mode';
```

## Check Current Usage / Budget

### Today's usage per user:

```sql
SELECT user_id, count(*) as calls_today,
       sum(total_tokens) as tokens_today,
       sum(estimated_cost_usd) as cost_today
FROM parser_usage_log
WHERE created_at >= current_date
GROUP BY user_id
ORDER BY calls_today DESC;
```

### This month's total:

```sql
SELECT parser_mode, count(*) as calls,
       sum(total_tokens) as total_tokens,
       sum(estimated_cost_usd)::numeric(10,4) as total_cost
FROM parser_usage_log
WHERE created_at >= date_trunc('month', current_date)
GROUP BY parser_mode;
```

### Budget remaining:

```sql
SELECT
  (SELECT value::int FROM app_config WHERE key = 'quick_order_monthly_token_budget') as budget,
  sum(total_tokens) as used,
  (SELECT value::int FROM app_config WHERE key = 'quick_order_monthly_token_budget') - sum(total_tokens) as remaining
FROM parser_usage_log
WHERE parser_mode = 'live'
  AND created_at >= date_trunc('month', current_date);
```

## Check for Anomalies

```sql
SELECT * FROM check_parser_anomalies();
```

Returns rows if today's live call volume is 3x the 7-day average and above 50 calls.

## Interpret Usage Log

Each row in `parser_usage_log` represents one parse-order call:

| Column | Meaning |
|--------|---------|
| `parser_mode` | `live` (AI call) or `mock` (local parsing) |
| `ai_provider` | `gemini` or `claude` (null for mock) |
| `total_tokens` | Input + output tokens (0 for mock) |
| `estimated_cost_usd` | Estimated cost in USD (0 for mock) |
| `duration_ms` | Wall-clock time for the call |
| `succeeded` | Whether the call completed successfully |
| `error_code` | Error type if failed (`llm_timeout`, `llm_error`, etc.) |

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Quick Order is temporarily off" | Kill switch is active | Set `quick_order_enabled` to `true` |
| "Daily limit reached" | User exceeded 100 calls/day | Increase limit or wait until tomorrow |
| "Monthly AI budget reached" | Token budget exhausted | Increase budget or switch to mock |
| "Sorry, having trouble connecting" | AI API error or timeout | Check Supabase Edge Function logs, verify API key |
| Function returns 404 | parse-order not deployed | Run `supabase functions deploy parse-order --no-verify-jwt` |

## Adjust Limits

```sql
-- Change daily per-user limit:
UPDATE app_config SET value = '200'::jsonb WHERE key = 'quick_order_daily_limit_per_user';

-- Change monthly token budget:
UPDATE app_config SET value = '10000000'::jsonb WHERE key = 'quick_order_monthly_token_budget';

-- Change warning threshold (fraction 0-1):
UPDATE app_config SET value = '0.9'::jsonb WHERE key = 'quick_order_token_warning_threshold';
```

## View Current Config

```sql
SELECT key, value, description FROM app_config ORDER BY key;
```
