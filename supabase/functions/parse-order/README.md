# parse-order Edge Function

Supabase Edge Function for parsing natural-language order text into structured inventory items.

## Mode Switching

The function operates in three modes, controlled via the `app_config` table:

| Mode | Behavior |
|------|----------|
| `live` | Calls AI API (Gemini or Claude) for parsing |
| `mock` | Uses local pattern matching — no AI calls, no cost |
| `auto` | Uses `live` if an AI API key is set, otherwise falls back to `mock` |

The mode is read from `app_config` key `quick_order_parser_mode` on every request.

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Auto-set by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Auto-set by Supabase |
| `GEMINI_API_KEY` | For live mode | Google AI Studio API key |
| `GOOGLE_API_KEY` | Alternative | Falls back if `GEMINI_API_KEY` not set |
| `ANTHROPIC_API_KEY` | For Claude | Required only if using Claude provider |
| `PARSE_ORDER_LLM_PROVIDER` | Optional | Force `gemini` or `claude`. Auto-detects if omitted. |

## Request Shape

```http
POST /functions/v1/parse-order
Authorization: Bearer <user_jwt>
Content-Type: application/json

{
  "raw_text": "salmon 2lb, tuna 3",
  "location_id": "uuid",
  "session_id": "uuid or null",
  "user_id": "uuid"
}
```

- `user_id` must match the authenticated JWT user
- `session_id` is optional for the first message; use the returned session ID for follow-ups
- `location_id` determines which inventory items are available

## Response Shape

```json
{
  "reply_text": "Got 2 items.",
  "parsed_items": [
    {
      "item_id": "uuid",
      "item_name": "Salmon fillet",
      "raw_token": "salmon 2lb",
      "quantity": 2,
      "unit": "lb",
      "confidence": 0.95,
      "needs_clarification": false,
      "unresolved": false,
      "notes": null
    }
  ],
  "flags": [],
  "suggestions": [],
  "session_state": {
    "total_items": 2,
    "ready_to_submit": true
  }
}
```

## Inventory Parsing Notes

- The parser prefers linked `qo_items` rows for Quick Order names, aliases, target stock, and order units.
- Active `inventory_items` rows are merged in as a defensive fallback when `qo_items` rows are missing, unlinked, or temporarily fail to load, so a bad sheet sync cannot make an entire inventory list unreadable. If the full `inventory_items` fallback query is rejected because an optional column is unavailable, the function retries with a minimal column set.
- Mixed numeric quantities are supported in typed inventory and order text: `5 1/2` parses as `5.5`, and `1 1/2 pack` parses as `1.5 pack`.
- Compound stock counts such as `Ikura 1 pack + 3` are never silently dropped. If the trailing amount has the same unit, it is summed; if it lacks a unit or conversion, the item is returned as a needs-input warning explaining what unit/conversion is needed.
- When an inventory count omits a unit, the unit is marked inferred. Reorder-rule comparison may use the rule unit for inferred counts, while explicitly typed mismatched units still require a conversion.
- In order mode, `app_config.order_mode_missing_unit_strategy = "item_default_order_unit"` makes rows like `Salmon 3` use the item's default order unit even when no explicit `quick_order_unit_rules` row exists.

## Error Codes

| Code | HTTP Status | Meaning |
|------|------------|---------|
| `feature_disabled` | 503 | Kill switch is active |
| `rate_limit_user_daily` | 429 | User exceeded daily call limit |
| `rate_limit_org_monthly` | 429 | Organization exceeded monthly token budget |
| `ai_unavailable` | 200 | AI API call failed or timed out |
| (HTTP 400) | 400 | Missing required fields |
| (HTTP 401) | 401 | Invalid or missing JWT |
| (HTTP 403) | 403 | User ID mismatch or suspended account |

## Cost Guardrails

1. **Per-user daily limit**: Default 100 calls/day (configurable in `app_config`)
2. **Per-org monthly token budget**: Default 5M tokens/month
3. **Hard max_tokens cap**: 1024 tokens on AI output (not client-configurable)
4. **Kill switch**: `quick_order_enabled` in `app_config`
5. **Usage logging**: Every call logged to `parser_usage_log`
6. **Anomaly detection**: `check_parser_anomalies()` SQL function

## Testing Locally

```bash
# Serve locally:
supabase functions serve parse-order --env-file .env.local

# Test with curl (requires a valid JWT):
curl -X POST http://localhost:54321/functions/v1/parse-order \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"raw_text": "salmon 2", "location_id": "<uuid>", "user_id": "<uuid>"}'
```

## Deploy

```bash
supabase functions deploy parse-order --no-verify-jwt
```
