-- tip_ws_tickets was added in the tips hardening pass without RLS or grant
-- revocation; with Supabase's default privileges that left it writable via
-- the anon key. Service-role-only like the other tip auth tables.

alter table public.tip_ws_tickets enable row level security;
revoke all on table public.tip_ws_tickets from anon, authenticated;
-- No policies on purpose: only the service role (edge functions) touches it.
