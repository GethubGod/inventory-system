# Quick Order — Diagnosis Report

**Date:** 2026-05-09
**Symptom:** Every parse attempt returns *"Sorry, I'm having trouble connecting. Try again?"*

## Root Cause

**The `parse-order` edge function was never deployed to the Supabase project.**

The function code exists locally at `supabase/functions/parse-order/index.ts` (821 lines, fully implemented), but `supabase functions list` shows 27 deployed functions with `parse-order` absent.

When the React Native client calls `supabase.functions.invoke('parse-order', ...)`, Supabase returns an HTTP error (the function doesn't exist). The frontend's catch block on line 709 of `QuickOrderScreen.tsx` catches any error and appends the hardcoded error message from line 125:

```typescript
const ERROR_REPLY = "Sorry, I'm having trouble connecting. Try again?";
```

## Supporting Evidence

| Check | Result |
|---|---|
| `supabase functions list` | 27 functions deployed; `parse-order` **not listed** |
| `supabase secrets list` | `GEMINI_API_KEY` is set ✅ |
| AI Provider | Gemini via AI Studio direct API (`generativelanguage.googleapis.com`) |
| Model | `gemini-2.0-flash` (valid) |
| Migrations | Both `20260509134000` and `20260509160000` applied to remote ✅ |
| CORS | Properly configured (`Access-Control-Allow-Origin: *`) ✅ |
| LLM Timeout | 2500ms — too aggressive (secondary issue) |

## Pre-requisites Missing

1. **Critical:** `parse-order` function not deployed
2. **Secondary:** LLM timeout at 2500ms risks timeouts on cold starts (3-5s typical)
3. **Missing:** No `app_config` table for mode switching / kill switch
4. **Missing:** No `parser_usage_log` table for cost tracking
5. **Missing:** No mock parser for development testing
6. **Missing:** No seed data in `inventory_items.aliases` or `parser_examples`

## Fix Order

1. Create mock parser (so we can test without burning AI credits)
2. Add `app_config` table and mode switching
3. Increase LLM timeout from 2500ms → 8000ms
4. Add `max_tokens: 1024` hardcap to AI requests
5. Deploy the function: `supabase functions deploy parse-order`
6. Add cost guardrails (`parser_usage_log`, daily limits, monthly budgets)
7. Seed test data
8. Fix UI error handling
