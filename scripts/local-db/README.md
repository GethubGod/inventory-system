# Local migration verification harness

`supabase start` cannot bootstrap this project locally: the migrations folder
starts mid-stream (the earliest migration already assumes `public.locations`,
`public.users`, `public.inventory_items`, `public.orders`, `public.order_items`
and `public.suppliers` exist, because those tables predate migration adoption).
So historical migrations can never be replayed from zero.

This harness answers a narrower, more useful question instead:

> **Do the migrations that are NEW on this branch apply cleanly against the
> CURRENT production schema?**

## What's in here

| File | Purpose |
| --- | --- |
| `baseline_public_schema.sql` | Full DDL snapshot of prod's `public` schema (project `whrohvitvmcrmedepurd`): 75 tables with columns/defaults/generated columns, PK/unique/check constraints, FKs, 2 sequences, 55 functions, 45 triggers, all non-constraint indexes, RLS enablement and all 142 policies. Generated 2026-08-11 via read-only `pg_catalog` / `information_schema` queries (`pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`). |
| `auth_stub.sql` | Minimal stand-in for Supabase-managed dependencies: roles `anon` / `authenticated` / `service_role`, an `auth` schema with a minimal `auth.users` table, and `auth.uid()` / `auth.role()` / `auth.jwt()` stubs that read the `request.jwt.claim.*` GUCs (null-safe). |
| `verify-migrations.sh` | The runner. Disposable `postgres:17` Docker container on a random free localhost port; loads `auth_stub.sql`, then `baseline_public_schema.sql`, then applies every file in `supabase/migrations/` that does **not** exist in `origin/main`'s `supabase/migrations/`, in timestamp (filename) order. Fails loudly on the first error; always removes the container via an EXIT trap unless `--keep` is passed. |

## Usage

```sh
# From anywhere in the repo (docker required):
scripts/local-db/verify-migrations.sh

# Keep the container running afterwards for inspection:
scripts/local-db/verify-migrations.sh --keep
#   connect with: docker exec -it <container> psql -U postgres
```

Exit code 0 and a final `PASS:` line means every branch-new migration applied
cleanly on top of the production baseline. A `FAIL:` line names the first
migration that broke and how many applied before it.

Note: "new on this branch" is computed against your local `origin/main` ref.
Run `git fetch origin main` first if it might be stale.

### How agents use this per phase

1. Write your phase's migration(s) into `supabase/migrations/` with a
   timestamped filename (later than everything on `origin/main`).
2. Run `scripts/local-db/verify-migrations.sh` and require `PASS` before
   considering the phase's DB work done. The script picks up *all* branch-new
   migrations, so parallel phases are verified together in timestamp order —
   which also catches cross-phase ordering conflicts early.
3. If you need to poke at the resulting schema (check a column, run an
   EXPLAIN, test an RPC), re-run with `--keep` and connect with psql.
4. To simulate an authenticated user in the kept container:
   `SELECT set_config('request.jwt.claim.sub', '<some-uuid>', false);` then
   `SET ROLE authenticated;` (the stub's `auth.uid()` reads that GUC).

### Phase 5a checklist fixture

The Phase 5a fixture seeds nine observed Sushi item-order days for one fake
user, with a frequent item (6/9 days), an occasional item (2/9), and a rare
item (one occurrence).
It runs `generate_order_checklist` as that user and prints the generated rows.

```sh
scripts/local-db/verify-migrations.sh --keep
# Copy the container name printed after `--keep`, then:
docker exec -i <container-name> psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/phase5a_checklist_fixture.sql
docker rm -f <container-name>
```

The expected result has `Frequent Tuna` / `frequent` / `4.5`, `Occasional
Salmon` / `occasional` / `10`, and `Rare Nori` / `rare` / `1`, in that sort
order. The fixture is intentionally separate from the general migration
harness so the harness remains data-free for every phase.

### Phase 6c holiday-template fixture

After a kept migration run, execute the Phase 6c fixture to prove that holiday
templates are a non-destructive checklist overlay:

```sh
docker exec -i <container-name> psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/phase6c_holiday_templates_fixture.sql
```

It creates a `Fixture New Year` window from 2026-12-24 through 2026-12-26.
Its date probe prints zero rows on 2026-12-23 and 2026-12-27, and three rows
inside the window: Tuna `scale 1.5`, Salmon `set_qty 8`, and Nori `add 3`.
The fixture also asserts that Tuna's stored generated quantity remains `4` and
that the additive Nori line was never inserted into `order_checklist_items`.

### Onboarding/auth fixture

After a kept migration run, execute the onboarding/auth fixture to prove the
login-credential and invite-defaults backend:

```sh
docker exec -i <container-name> psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/onboarding_auth_fixture.sql
```

It prints twelve `ok:` notices covering: the `ordering_simple` employee
default flip in `get_effective_modules` (and that explicit `user_modules`
rows still override it), `set_my_login_credential` normalization + bcrypt
hashing + format validation + duplicate-name refusal,
`verify_login_credential` success/invalid/rate-limit (6 failures per name in
10 minutes) and suspended-account refusal, `reset_login_credential`
manager gating + PIN rotation + suspended-target refusal, the seeded
`employee_invite_module_defaults` app_config row and its manager-gated
validated writes, and `set_user_default_location` gating with `null`
meaning "both". It ends with
`PASS: onboarding auth fixture assertions all held` and rolls back.

## What this does NOT prove

- **No gotrue / real auth.** `auth` is a stub: only `auth.users(id, email,
  raw_user_meta_data, raw_app_meta_data, created_at)` and stubbed
  `uid()/role()/jwt()`. Prod's triggers **on `auth.users`** (identity-sync
  trigger wiring) are not reproduced; the public-schema trigger *functions*
  they call do exist. Signup/login flows are out of scope.
- **No storage, realtime, edge functions, pg_net, pg_cron, or vault.** No
  public-schema object references them today, so they are not stubbed. If a
  future migration touches e.g. `storage.` or `cron.`, the run will fail —
  extend the stub then, deliberately.
- **No data.** The baseline is DDL-only. Migrations whose correctness depends
  on production data shapes (backfills, constraint validation over existing
  rows) only prove they *parse and execute* on an empty schema here.
- **Grants/ownership are approximate.** Roles exist so `GRANT`/`CREATE POLICY
  ... TO authenticated` statements work, but prod's exact grant matrix and
  object ownership are not mirrored; everything is owned by `postgres`.
- **Point-in-time snapshot.** The baseline reflects prod as of 2026-08-11.
  After new migrations are deployed to prod, the snapshot is stale (usually
  harmlessly, since your new migrations are also part of prod by then). If
  drift matters, regenerate the baseline from prod with the same pg_catalog
  queries.

## Known stubs / deviations from prod (documented per the generation run)

- `extensions` schema is created with `pgcrypto` and `uuid-ossp` (both exist in
  the stock `postgres:17` image). These are the only extensions prod's public
  schema actually uses (`extensions.crypt`, `gen_salt`, `digest`,
  `gen_random_bytes`, `uuid_generate_v4`). Prod additionally has
  `pg_stat_statements`, `pg_net`, `pg_cron`, `pg_graphql` and `supabase_vault`
  installed, but nothing in `public` references them, so they are omitted.
- `ALTER DATABASE postgres SET search_path TO "$user", public, extensions;`
  mirrors Supabase's database-level search_path so unqualified calls like
  `uuid_generate_v4()` in column defaults resolve identically.
- The baseline loads with `SET check_function_bodies = off`, because function
  bodies reference tables created later in the file, and because prod itself
  contains three orphaned functions (`has_org_role`, `is_org_member`,
  `org_has_members`) whose bodies reference the long-dropped
  `public.org_memberships` table. They are reproduced verbatim.
- `tip_auth_attempts_id_seq` is not created explicitly; it is auto-created by
  the `GENERATED ALWAYS AS IDENTITY` column, same as prod.
- `service_role` is created with `BYPASSRLS` to approximate Supabase behavior.
