# Environment Variables

## App Runtime

Use `.env` for local app development and keep real values out of git.

- `EXPO_PUBLIC_SUPABASE_URL`: Supabase project URL used by the Expo client.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key used by the Expo client.
- `EXPO_PUBLIC_ENABLE_QUICK_ORDER_VOICE`: Set to `true` to show client voice ordering controls.

## Supabase Edge Functions

Configure these with `supabase secrets set` or in the Supabase dashboard.

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Service-role key for server-only Edge Function work.
- `SUPABASE_ANON_KEY`: Anon key used by functions that call user-scoped Supabase APIs.
- `ALLOWED_ORIGINS`: Comma-separated CORS allowlist. Leave unset only for non-browser clients.
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`: LLM key for Quick Order parsing and voice ordering.
- `ANTHROPIC_API_KEY`: Optional Anthropic fallback key for Quick Order parsing.
- `PARSE_ORDER_LLM_PROVIDER`: Optional parser provider override, for example `gemini` or `anthropic`.
- `ENABLE_QUICK_ORDER_VOICE`: Set to `true` to enable voice parsing in Edge Functions.
- `QUICK_ORDER_DEBUG_TIMINGS`: Set to `true` only during debugging.
- `CRON_SECRET`: Shared secret for scheduled reminder evaluation.
