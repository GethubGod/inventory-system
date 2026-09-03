#!/usr/bin/env bash
#
# verify-migrations.sh
#
# Spins up a disposable postgres:17 Docker container, loads a stubbed auth
# schema plus a production public-schema snapshot, then applies every migration
# newer than that snapshot plus any older migration that is new on this branch.
#
# Usage:
#   scripts/local-db/verify-migrations.sh          # run, clean up container
#   scripts/local-db/verify-migrations.sh --keep   # leave container running
#
# Exit code 0 = PASS (all new migrations applied cleanly).
# Any migration error stops the run immediately and reports FAIL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
BASELINE="$SCRIPT_DIR/baseline_public_schema.sql"
AUTH_STUB="$SCRIPT_DIR/auth_stub.sql"
# The snapshot was captured on 2026-08-11 after this production migration. It
# predates 20260811204219 (no tip_entries.entry_session_id, 12-argument
# tip_save_entry), so that file must be applied on top of it.
BASELINE_MIGRATION_CUTOFF="20260807101000_tip_set_updated_at_search_path.sql"

KEEP=false
if [[ "${1:-}" == "--keep" ]]; then
  KEEP=true
fi

for f in "$BASELINE" "$AUTH_STUB"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing $f" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required" >&2
  exit 1
fi

# Random free port on localhost.
PORT="$(python3 - <<'PYEOF'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PYEOF
)"

CONTAINER="verify-migrations-$$-$RANDOM"

cleanup() {
  local code=$?
  if $KEEP; then
    echo ""
    echo "--keep: container '$CONTAINER' left running on 127.0.0.1:$PORT"
    echo "  connect: docker exec -it $CONTAINER psql -U postgres"
    echo "  or:      psql postgresql://postgres:postgres@127.0.0.1:$PORT/postgres"
    echo "  remove:  docker rm -f $CONTAINER"
  else
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  exit $code
}
trap cleanup EXIT

echo "==> Starting postgres:17 container '$CONTAINER' on 127.0.0.1:$PORT"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -p "127.0.0.1:$PORT:5432" \
  postgres:17 >/dev/null

echo -n "==> Waiting for postgres to accept connections"
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  if [[ "$i" == 60 ]]; then
    echo ""
    echo "ERROR: postgres did not become ready in time" >&2
    docker logs "$CONTAINER" | tail -20 >&2
    exit 1
  fi
  echo -n "."
  sleep 0.5
done
echo " ready."
# pg_isready can flip green momentarily during initdb's restart; settle.
sleep 1
docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null

run_sql_file() {
  local file="$1"
  docker exec -i "$CONTAINER" psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -q -X < "$file"
}

echo "==> Loading auth stub ($(basename "$AUTH_STUB"))"
run_sql_file "$AUTH_STUB"

echo "==> Loading production public-schema baseline ($(basename "$BASELINE"))"
run_sql_file "$BASELINE"

# Apply every migration after the snapshot cutoff, including files already on
# main, because the checked-in baseline does not contain their schema changes.
# Also include any branch-new migration at or before the cutoff.
MAIN_LIST="$(git -C "$REPO_ROOT" ls-tree -r --name-only origin/main -- supabase/migrations/ | sed 's|.*/||' | sort)"
LOCAL_LIST="$(cd "$MIGRATIONS_DIR" && ls -1 *.sql 2>/dev/null | sort)"
NEW_MIGRATIONS="$(comm -13 <(printf '%s\n' "$MAIN_LIST") <(printf '%s\n' "$LOCAL_LIST"))"
AFTER_BASELINE="$(printf '%s\n' "$LOCAL_LIST" | awk -v cutoff="$BASELINE_MIGRATION_CUTOFF" '$0 > cutoff')"
MIGRATIONS_TO_APPLY="$(printf '%s\n%s\n' "$AFTER_BASELINE" "$NEW_MIGRATIONS" | sed '/^$/d' | sort -u)"

if [[ -z "$MIGRATIONS_TO_APPLY" ]]; then
  echo ""
  echo "==> No new migrations on this branch vs origin/main. Nothing to verify."
  echo "PASS (baseline + auth stub loaded cleanly; 0 new migrations)"
  exit 0
fi

echo "==> Migrations to apply after the baseline snapshot, in timestamp order:"
printf '      %s\n' $MIGRATIONS_TO_APPLY

APPLIED=0
while IFS= read -r mig; do
  [[ -z "$mig" ]] && continue
  echo "==> Applying $mig"
  if ! run_sql_file "$MIGRATIONS_DIR/$mig"; then
    echo ""
    echo "FAIL: migration '$mig' failed against the production-baseline schema." >&2
    echo "      ($APPLIED migration(s) applied successfully before the failure)" >&2
    exit 1
  fi
  APPLIED=$((APPLIED + 1))
done <<< "$MIGRATIONS_TO_APPLY"

echo ""
echo "PASS: $APPLIED migration(s) applied cleanly on top of the production baseline."
