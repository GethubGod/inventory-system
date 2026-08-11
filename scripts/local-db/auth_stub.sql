-- auth_stub.sql
-- Minimal stand-in for the Supabase-managed pieces that prod's public schema
-- depends on. Load this BEFORE baseline_public_schema.sql.
--
-- Provides:
--   * Roles: anon, authenticated, service_role (referenced by RLS policies)
--   * auth schema with a minimal auth.users table (FK target of
--     public.users/public.profiles/public.org_settings/public.tip_location_access)
--   * auth.uid()/auth.role()/auth.jwt() stubs that read the same GUCs Supabase
--     sets from the JWT, null-safe so unauthenticated sessions behave like
--     service connections.
--
-- This is a stub: no gotrue, no storage, no realtime. See README.md.

\set ON_ERROR_STOP on

-- Roles referenced by GRANTs / RLS policies. NOLOGIN: the harness always
-- connects as postgres; SET ROLE if you want to simulate a client.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Minimal auth.users: just the columns public-schema functions/FKs touch.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- auth.uid(): reads the request.jwt.claim.sub GUC (settable per session/txn via
--   SELECT set_config('request.jwt.claim.sub', '<uuid>', true);
-- Returns NULL when unset, like a service-role connection.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- auth.role(): role claim, defaulting to 'anon' like Supabase.
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

-- auth.jwt(): full claims object if request.jwt.claims was set, else NULL.
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

GRANT SELECT ON auth.users TO anon, authenticated, service_role;
