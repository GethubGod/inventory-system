#!/usr/bin/env bash
#
# full-stack.sh — boot a complete local Supabase stack (Postgres, GoTrue,
# PostgREST, Realtime, edge runtime) on this repo's ports (54421-54424) with
# the production schema, so browser flows can be tested end to end
# (sign-in, RLS, realtime, edge functions). verify-migrations.sh only proves
# migrations apply; this gives you a database you can log in to.
#
# `supabase start` cannot replay this repo's migrations (history starts
# mid-stream), so migrations are disabled for the boot and the schema is
# loaded by hand: auth is real, public comes from the baseline snapshot plus
# every migration newer than it, in timestamp order.
#
# Usage:
#   scripts/local-db/full-stack.sh up      # boot + load schema (idempotent)
#   scripts/local-db/full-stack.sh load    # (re)load schema into a running stack
#   scripts/local-db/full-stack.sh down    # stop the stack
#   scripts/local-db/full-stack.sh psql    # psql into the stack
#
# Requires docker and the supabase CLI. The other local project on this Mac
# uses the default ports (54321-54327); this stack never touches them.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
BASELINE="$SCRIPT_DIR/baseline_public_schema.sql"
CONFIG="$REPO_ROOT/supabase/config.toml"
BASELINE_MIGRATION_CUTOFF="20260811204219_tip_entry_session_duplicate_guard.sql"
# Migrations that are known not to apply on the baseline snapshot (they
# depend on production state the snapshot predates). Listed here so the
# rest of the schema still loads; they are skipped with a warning.
SKIP_MIGRATIONS=("20260828100000_tips_v3_grat_scope_weights_notes.sql")

project_id() {
  basename "$REPO_ROOT"
}

db_container() {
  echo "supabase_db_$(project_id)"
}

psql_in() {
  docker exec -i "$(db_container)" psql -U postgres -d postgres "$@"
}

overlay_config() {
  # Boot-time overrides only. The file is restored in `restore_config`.
  cp "$CONFIG" "$CONFIG.full-stack.bak"
  cat >> "$CONFIG" <<'EOF'

# --- full-stack.sh overlay (temporary; restored on exit) ---
[db.migrations]
enabled = false

[inbucket]
enabled = true
port = 54424

[analytics]
enabled = false
EOF
}

restore_config() {
  if [[ -f "$CONFIG.full-stack.bak" ]]; then
    mv "$CONFIG.full-stack.bak" "$CONFIG"
  fi
}

load_schema() {
  local existing
  existing="$(psql_in -Atc "select count(*) from information_schema.tables where table_schema='public'")"
  if [[ "$existing" != "0" ]]; then
    echo "==> public schema already has $existing tables; only applying missing migrations"
  else
    echo "==> Loading production public-schema baseline"
    psql_in -v ON_ERROR_STOP=1 -q -X < "$BASELINE"
    # The snapshot carries policies but not grants. Production has Supabase's
    # default grants (RLS does the gating); later migrations revoke what they
    # need to, exactly as they did in production.
    echo "==> Applying Supabase default grants"
    psql_in -v ON_ERROR_STOP=1 -q -X <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
SQL
  fi

  psql_in -q -X -c "create table if not exists public._full_stack_applied (name text primary key, applied_at timestamptz not null default now());"

  local applied=0
  while IFS= read -r mig; do
    [[ -z "$mig" ]] && continue
    if psql_in -Atc "select 1 from public._full_stack_applied where name = '$mig'" | grep -q 1; then
      continue
    fi
    if printf '%s\n' "${SKIP_MIGRATIONS[@]}" | grep -qx "$mig"; then
      echo "==> SKIP $mig (known not to apply on the snapshot)"
      continue
    fi
    echo "==> Applying $mig"
    if ! psql_in -v ON_ERROR_STOP=1 -q -X < "$MIGRATIONS_DIR/$mig"; then
      echo "FAIL: $mig did not apply." >&2
      exit 1
    fi
    psql_in -q -X -c "insert into public._full_stack_applied (name) values ('$mig') on conflict do nothing;"
    applied=$((applied + 1))
  done < <(cd "$MIGRATIONS_DIR" && ls -1 *.sql | sort | awk -v c="$BASELINE_MIGRATION_CUTOFF" '$0 > c')
  echo "PASS: schema loaded ($applied migration(s) applied this run)."
}

case "${1:-}" in
  up)
    trap restore_config EXIT
    overlay_config
    (cd "$REPO_ROOT" && supabase start -x studio,imgproxy,logflare,vector)
    load_schema
    (cd "$REPO_ROOT" && supabase status)
    ;;
  load)
    load_schema
    ;;
  down)
    trap restore_config EXIT
    overlay_config
    (cd "$REPO_ROOT" && supabase stop)
    ;;
  psql)
    docker exec -it "$(db_container)" psql -U postgres -d postgres
    ;;
  *)
    echo "usage: $0 up|load|down|psql" >&2
    exit 2
    ;;
esac
