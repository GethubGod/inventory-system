#!/usr/bin/env zsh
# Tips v3 black-box API harness (12 checks: functional round-trips, exact
# persistence read-backs, old-client compatibility, cross-location isolation,
# REST/RLS lockdown, session-token abuse, response leak scan, rate limiting).
#
# Authored by Codex/Luna, corrected and run by Claude against the throwaway
# Supabase branch `tips-v3-verify` (12/12 pass, no leakage). It is checked in
# so the suite can be re-pointed at a future verification branch.
#
# NEVER point this at production: it writes tip entries and deliberately trips
# the auth rate limiter. Replace the URLs/keys/tokens below with a disposable
# branch's values before running.
#
# Check 12 deliberately trips the auth rate limiter, which blocks token
# validation for ~10 minutes. Before re-running, either wait it out or clear
# the ledger on the branch: delete from public.tip_auth_attempts;
#
# Required env: TIPS_V3_FUNCTIONS_BASE, TIPS_V3_REST_BASE, TIPS_V3_ANON_KEY,
# TIPS_V3_SUSHI_TOKEN, TIPS_V3_POKI_TOKEN.
setopt NO_NOMATCH
setopt PIPE_FAIL
set -u

FUNCTIONS_BASE="${TIPS_V3_FUNCTIONS_BASE:?e.g. https://<branch-ref>.supabase.co/functions/v1}"
REST_BASE="${TIPS_V3_REST_BASE:?e.g. https://<branch-ref>.supabase.co/rest/v1}"
AUTH_URL="${FUNCTIONS_BASE}/tip-entry-auth"
ENTRIES_URL="${FUNCTIONS_BASE}/tip-entries"

ANON_KEY="${TIPS_V3_ANON_KEY:?set to the verification branch anon key}"
SUSHI_ENTRY_TOKEN="${TIPS_V3_SUSHI_TOKEN:?seeded sushi entry token}"
POKI_ENTRY_TOKEN="${TIPS_V3_POKI_TOKEN:?seeded poki entry token}"

WORK_DIR="$(mktemp -d /tmp/tips-v3-e2e.XXXXXX)" || exit 1
trap 'rm -rf "$WORK_DIR"' EXIT

typeset -A STATUS BODYFILE ERRFILE
typeset -a REQUESTS LEAK_FINDINGS
REQUESTS=()
LEAK_FINDINGS=()
LEAK_COUNT=0

body_excerpt() {
  python3 - "$1" <<'PY'
import json
import sys

try:
    raw = open(sys.argv[1], "rb").read()
except Exception:
    raw = b""

if not raw:
    out = "<empty>"
else:
    text = raw.decode("utf-8", "replace")
    try:
        out = json.dumps(json.loads(text), ensure_ascii=False, separators=(",", ":"))
    except Exception:
        out = text.replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")

if len(out) > 700:
    out = out[:700] + "..."
print(out)
PY
}

request_post() {
  local label="$1"
  local url="$2"
  local payload="$3"
  local body="$WORK_DIR/${label}.body"
  local status_file="$WORK_DIR/${label}.status"
  local err="$WORK_DIR/${label}.err"
  local http_status
  local excerpt
  local err_excerpt
  local curl_rc

  REQUESTS+=("$label")
  : > "$body"
  : > "$status_file"
  : > "$err"

  curl -sS --connect-timeout 15 --max-time 60 \
    -X POST "$url" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${ANON_KEY}" \
    -H "apikey: ${ANON_KEY}" \
    --data-raw "$payload" \
    -o "$body" \
    -w '%{http_code}' \
    > "$status_file" 2> "$err"
  curl_rc=$?

  http_status="$(<"$status_file")"
  [[ -z "$http_status" ]] && http_status='000'

  STATUS[$label]="$http_status"
  BODYFILE[$label]="$body"
  ERRFILE[$label]="$err"

  excerpt="$(body_excerpt "$body")"
  err_excerpt="$(body_excerpt "$err")"

  if [[ "$curl_rc" -eq 0 ]]; then
    print -r -- "HTTP ${label} status=${http_status} body=${excerpt}"
  else
    print -r -- "HTTP ${label} status=${http_status} body=${excerpt} curl_rc=${curl_rc} error=${err_excerpt}"
  fi
}

request_get() {
  local label="$1"
  local url="$2"
  local body="$WORK_DIR/${label}.body"
  local status_file="$WORK_DIR/${label}.status"
  local err="$WORK_DIR/${label}.err"
  local http_status
  local excerpt
  local err_excerpt
  local curl_rc

  REQUESTS+=("$label")
  : > "$body"
  : > "$status_file"
  : > "$err"

  curl -sS --connect-timeout 15 --max-time 60 \
    -X GET "$url" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    -H "apikey: ${ANON_KEY}" \
    -o "$body" \
    -w '%{http_code}' \
    > "$status_file" 2> "$err"
  curl_rc=$?

  http_status="$(<"$status_file")"
  [[ -z "$http_status" ]] && http_status='000'

  STATUS[$label]="$http_status"
  BODYFILE[$label]="$body"
  ERRFILE[$label]="$err"

  excerpt="$(body_excerpt "$body")"
  err_excerpt="$(body_excerpt "$err")"

  if [[ "$curl_rc" -eq 0 ]]; then
    print -r -- "HTTP ${label} status=${http_status} body=${excerpt}"
  else
    print -r -- "HTTP ${label} status=${http_status} body=${excerpt} curl_rc=${curl_rc} error=${err_excerpt}"
  fi
}

status_of() {
  local label="$1"
  local value="${STATUS[$label]-000}"
  [[ -z "$value" ]] && value='000'
  print -r -- "$value"
}

response_code() {
  python3 - "${BODYFILE[$1]}" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)

code = None
if isinstance(obj, dict):
    code = obj.get("code") or obj.get("errorCode")
    err = obj.get("error")
    if isinstance(err, dict):
        code = code or err.get("code") or err.get("errorCode")

if code is not None:
    print(str(code))
PY
}

describe() {
  local label="$1"
  local code
  code="$(response_code "$label" 2>/dev/null || true)"
  print -r -- "${label}[status=$(status_of "$label"),code=${code:-none}]"
}

json_extract() {
  local label="$1"
  local json_path="$2"

  python3 - "${BODYFILE[$label]}" "$json_path" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)

cur = obj
for part in sys.argv[2].split("."):
    if not isinstance(cur, dict) or part not in cur:
        sys.exit(1)
    cur = cur[part]

if cur is None:
    sys.exit(1)

if isinstance(cur, (dict, list)):
    print(json.dumps(cur, ensure_ascii=False, separators=(",", ":")))
elif isinstance(cur, bool):
    print("true" if cur else "false")
else:
    print(str(cur))
PY
}

make_validate_payload() {
  python3 - "$1" <<'PY'
import json
import sys
print(json.dumps({"action": "validate_token", "token": sys.argv[1]}, separators=(",", ":")))
PY
}

make_session_payload() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
print(json.dumps({"action": sys.argv[1], "sessionToken": sys.argv[2]}, separators=(",", ":")))
PY
}

make_set_closer_payload() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
print(json.dumps({
    "action": "set_closer",
    "sessionToken": sys.argv[1],
    "closerId": sys.argv[2],
}, separators=(",", ":")))
PY
}

make_get_slot_payload() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
print(json.dumps({
    "action": "get_slot",
    "sessionToken": sys.argv[1],
    "meal": sys.argv[2],
}, separators=(",", ":")))
PY
}

make_save_payload() {
  python3 - "$@" <<'PY'
import json
import re
import sys

(
    session,
    meal,
    cash,
    card,
    gratuity,
    scope,
    ids_text,
    weights_text,
    note,
    include_v3,
    extra_text,
) = sys.argv[1:]

ids = json.loads(ids_text)
weights = json.loads(weights_text)
extra = json.loads(extra_text)

payload = {
    "action": "save",
    "sessionToken": session,
    "meal": meal,
    "cash": "__CASH__",
    "card": "__CARD__",
    "peopleIds": ids,
    "entryMethod": "typed",
    "voiceVariant": None,
    "correctionsCount": 0,
    "confirmAnomaly": False,
}

if include_v3 == "1":
    payload.update({
        "gratuity": "__GRATUITY__",
        "enteredScope": scope,
        "weights": weights,
        "note": None if note == "__NULL_NOTE__" else note,
    })

payload.update(extra)
text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

number_re = r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
for marker, value in (
    ("__CASH__", cash),
    ("__CARD__", card),
    ("__GRATUITY__", gratuity),
):
    if not re.fullmatch(number_re, value):
        raise SystemExit("invalid numeric argument")
    text = text.replace(json.dumps(marker), value)

print(text)
PY
}

roster_ids_json() {
  python3 - "${BODYFILE[$1]}" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    print("[]")
    raise SystemExit

roster = obj.get("roster", []) if isinstance(obj, dict) else []
scheduled = []
other = []

for row in roster:
    if not isinstance(row, dict):
        continue
    ident = row.get("id")
    if not isinstance(ident, str) or not ident:
        continue
    if row.get("scheduled") is True:
        scheduled.append(ident)
    elif ident not in other:
        other.append(ident)

ids = scheduled + [x for x in other if x not in scheduled]
print(json.dumps(ids[:3], separators=(",", ":")))
PY
}

id_at() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

try:
    ids = json.loads(sys.argv[1])
except Exception:
    ids = []

index = int(sys.argv[2])
if index < len(ids):
    print(str(ids[index]))
else:
    print("__missing_id_%d__" % (index + 1))
PY
}

ids_prefix() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

try:
    ids = json.loads(sys.argv[1])
except Exception:
    ids = []

count = int(sys.argv[2])
print(json.dumps(ids[:count], separators=(",", ":")))
PY
}

weights_for_ids() {
  python3 - "$1" <<'PY'
import json
import sys

try:
    ids = json.loads(sys.argv[1])
except Exception:
    ids = []

print(json.dumps([1] * len(ids), separators=(",", ":")))
PY
}

json_ids_pair() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
print(json.dumps([sys.argv[1], sys.argv[2]], separators=(",", ":")))
PY
}

decimal_sub() {
  python3 - "$1" "$2" <<'PY'
from decimal import Decimal
import sys
print(format(Decimal(sys.argv[1]) - Decimal(sys.argv[2]), "f"))
PY
}

status_at_least() {
  python3 - "$1" "$2" <<'PY'
import sys
try:
    ok = int(sys.argv[1]) >= int(sys.argv[2])
except Exception:
    ok = False
raise SystemExit(0 if ok else 1)
PY
}

assert_ping() {
  local label="$1"
  [[ "$(status_of "$label")" == "200" ]] || return 1
  python3 - "${BODYFILE[$label]}" <<'PY'
import json
import sys
try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if isinstance(obj, dict) else 1)
PY
}

assert_validate() {
  local label="$1"
  local expected_location="$2"

  [[ "$(status_of "$label")" == "200" ]] || return 1

  python3 - "${BODYFILE[$label]}" "$expected_location" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

expected = sys.argv[2].lower()
if not isinstance(obj, dict):
    raise SystemExit(1)

loc = obj.get("location")
loc_name = loc.get("name", "") if isinstance(loc, dict) else loc
if expected not in str(loc_name).strip().lower():
    raise SystemExit(1)

if not isinstance(obj.get("sessionToken"), str) or not obj["sessionToken"]:
    raise SystemExit(1)

roster = obj.get("roster")
if not isinstance(roster, list) or not roster:
    raise SystemExit(1)

for row in roster:
    if not isinstance(row, dict):
        raise SystemExit(1)
    if not isinstance(row.get("id"), str) or not row.get("id"):
        raise SystemExit(1)
    if not isinstance(row.get("name"), str) or not row.get("name"):
        raise SystemExit(1)
    if "scheduled" not in row:
        raise SystemExit(1)

today = obj.get("today")
if not isinstance(today, dict):
    raise SystemExit(1)

for key in ("businessDate", "lunchRecorded", "dinnerRecorded", "defaultMeal", "lunch"):
    if key not in today:
        raise SystemExit(1)

if "closer" not in obj:
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_state() {
  local label="$1"
  local expected_location="$2"

  [[ "$(status_of "$label")" == "200" ]] || return 1

  python3 - "${BODYFILE[$label]}" "$expected_location" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

if not isinstance(obj, dict):
    raise SystemExit(1)

if "error" in obj:
    raise SystemExit(1)

expected = sys.argv[2].lower()
loc2 = obj.get("location")
loc2_name = loc2.get("name", "") if isinstance(loc2, dict) else loc2
if "location" in obj and expected not in str(loc2_name).strip().lower():
    raise SystemExit(1)

if "roster" in obj and not isinstance(obj["roster"], list):
    raise SystemExit(1)

if "today" in obj and not isinstance(obj["today"], dict):
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_set_closer() {
  local label="$1"
  local closer_id="$2"

  [[ "$(status_of "$label")" == "200" ]] || return 1

  python3 - "${BODYFILE[$label]}" "$closer_id" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

if not isinstance(obj, dict):
    raise SystemExit(1)

if obj.get("ok") is False:
    raise SystemExit(1)

closer = obj.get("closer")
if isinstance(closer, dict) and "id" in closer and str(closer["id"]) != sys.argv[2]:
    raise SystemExit(1)
if isinstance(closer, str) and closer != sys.argv[2]:
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_ticket() {
  local label="$1"

  [[ "$(status_of "$label")" == "200" ]] || return 1

  python3 - "${BODYFILE[$label]}" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

if not isinstance(obj, dict):
    raise SystemExit(1)

ticket = obj.get("ticket") or obj.get("voiceTicket") or obj.get("voice_ticket")
if not isinstance(ticket, str) or not ticket:
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_end() {
  local label="$1"
  local http_status
  http_status="$(status_of "$label")"

  [[ "$http_status" == "200" || "$http_status" == "204" ]] || return 1
  [[ "$http_status" == "204" ]] && return 0

  python3 - "${BODYFILE[$label]}" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

if not isinstance(obj, dict):
    raise SystemExit(1)
if obj.get("ok") is False or "error" in obj:
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_session_invalid() {
  local label="$1"
  [[ "$(status_of "$label")" == "401" ]] || return 1
  [[ "$(response_code "$label" 2>/dev/null || true)" == "session_invalid" ]] || return 1
}

assert_save_ok() {
  local label="$1"
  [[ "$(status_of "$label")" == "200" ]] || return 1

  python3 - "${BODYFILE[$label]}" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

if not isinstance(obj, dict):
    raise SystemExit(1)
if obj.get("ok") is not True:
    raise SystemExit(1)
if "businessDate" not in obj:
    raise SystemExit(1)
if not isinstance(obj.get("entry"), dict):
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_get_slot() {
  local label="$1"
  [[ "$(status_of "$label")" == "200" ]] || return 1

  python3 - "${BODYFILE[$label]}" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

if not isinstance(obj, dict):
    raise SystemExit(1)

for key in ("businessDate", "entry", "scheduledIds", "today"):
    if key not in obj:
        raise SystemExit(1)

if obj["entry"] is not None and not isinstance(obj["entry"], dict):
    raise SystemExit(1)
if not isinstance(obj["scheduledIds"], list):
    raise SystemExit(1)
if not isinstance(obj["today"], dict):
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_entry_file() {
  local label="$1"
  local mode="$2"
  local stored_cash="$3"
  local stored_card="$4"
  local stored_gratuity="$5"
  local raw_cash="$6"
  local raw_card="$7"
  local raw_gratuity="$8"
  local expected_scope="$9"
  local expected_note="${10}"
  local expected_ids="${11}"
  local expected_weights="${12}"
  local require_raw="${13}"

  python3 - "${BODYFILE[$label]}" "$mode" "$stored_cash" "$stored_card" "$stored_gratuity" \
    "$raw_cash" "$raw_card" "$raw_gratuity" "$expected_scope" "$expected_note" \
    "$expected_ids" "$expected_weights" "$require_raw" <<'PY'
from decimal import Decimal
import json
import sys

MISSING = object()

def load(path):
    return json.load(open(path), parse_float=Decimal, parse_int=Decimal)

def pick(obj, names):
    for name in names:
        if name in obj:
            return obj[name], True
    return MISSING, False

def dec(value):
    if isinstance(value, bool):
        raise AssertionError("boolean numeric")
    return Decimal(str(value))

def same_num(actual, expected):
    return dec(actual) == Decimal(expected)

def people_and_weights(entry):
    ids, ids_ok = pick(entry, ("peopleIds", "people_ids"))
    weights, weights_ok = pick(entry, ("weights",))

    if ids_ok and weights_ok and isinstance(ids, list) and isinstance(weights, list):
        return ids, weights

    people = entry.get("people")
    if people is None:
        people = entry.get("entryPeople")
    if people is None:
        people = entry.get("entry_people")
    if people is None:
        people = entry.get("tipEntryPeople")

    if not isinstance(people, list):
        raise AssertionError("missing people")

    result_ids = []
    result_weights = []
    for person in people:
        if not isinstance(person, dict):
            raise AssertionError("bad person")
        pid, pid_ok = pick(person, ("personId", "person_id", "employeeId", "employee_id", "id"))
        weight, weight_ok = pick(person, ("weight", "share"))
        if not pid_ok or not weight_ok:
            raise AssertionError("missing person weight")
        result_ids.append(pid)
        result_weights.append(weight)

    return result_ids, result_weights

def check_entry(entry, stored, raw, scope, note_arg, ids_expected, weights_expected, require_raw):
    if not isinstance(entry, dict):
        raise AssertionError("entry missing")

    cash, cash_ok = pick(entry, ("cash", "cashAmount", "cash_amount"))
    card, card_ok = pick(entry, ("card", "cardAmount", "card_amount"))
    gratuity, gratuity_ok = pick(entry, ("gratuity", "tip"))
    entered_scope, scope_ok = pick(entry, ("enteredScope", "entered_scope"))
    note, note_ok = pick(entry, ("note",))

    if not cash_ok or not card_ok or not gratuity_ok or not scope_ok or not note_ok:
        raise AssertionError("missing entry fields")

    if not same_num(cash, stored[0]):
        raise AssertionError("cash mismatch")
    if not same_num(card, stored[1]):
        raise AssertionError("card mismatch")
    if not same_num(gratuity, stored[2]):
        raise AssertionError("gratuity mismatch")
    if entered_scope != scope:
        raise AssertionError("scope mismatch")

    expected_note = None if note_arg == "__NULL_NOTE__" else note_arg
    if note != expected_note:
        raise AssertionError("note mismatch")

    ids_actual, weights_actual = people_and_weights(entry)
    if ids_actual != ids_expected:
        raise AssertionError("people order mismatch")
    if len(weights_actual) != len(weights_expected):
        raise AssertionError("weight length mismatch")

    for actual, expected in zip(weights_actual, weights_expected):
        if not same_num(actual, expected):
            raise AssertionError("weight mismatch")

    if require_raw == "1":
        raw_values = []
        for names in (
            ("rawCash", "raw_cash", "raw_cash_amount"),
            ("rawCard", "raw_card", "raw_card_amount"),
            ("rawGratuity", "raw_gratuity", "raw_tip"),
        ):
            value, present = pick(entry, names)
            if not present:
                raise AssertionError("missing raw field")
            raw_values.append(value)

        for actual, expected in zip(raw_values, raw):
            if not same_num(actual, expected):
                raise AssertionError("raw value mismatch")

try:
    obj = load(sys.argv[1])
    mode = sys.argv[2]
    stored = sys.argv[3:6]
    raw = sys.argv[6:9]
    scope = sys.argv[9]
    note_arg = sys.argv[10]
    ids_expected = json.loads(sys.argv[11])
    weights_expected = json.loads(sys.argv[12], parse_float=Decimal, parse_int=Decimal)
    require_raw = sys.argv[13]

    if mode == "entry":
        entry = obj.get("entry")
    elif mode == "today_lunch":
        entry = obj.get("today", {}).get("lunch")
        # CONTRACT: today.lunch is exactly {cash, card, gratuity} -- the
        # figures the entry phone subtracts. It deliberately carries no
        # scope/note/people, so assert only the three amounts here.
        if not isinstance(entry, dict):
            raise AssertionError("today.lunch missing")
        for key, expected_value in zip(("cash", "card", "gratuity"), stored):
            if key not in entry:
                raise AssertionError("today.lunch missing " + key)
            if not same_num(entry[key], expected_value):
                raise AssertionError("today.lunch " + key + " mismatch")
        raise SystemExit(0)
    else:
        raise AssertionError("bad mode")

    check_entry(
        entry,
        stored,
        raw,
        scope,
        note_arg,
        ids_expected,
        weights_expected,
        require_raw,
    )
except Exception:
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_entry_pair() {
  local save_label="$1"
  local get_label="$2"
  shift 2

  assert_entry_file "$save_label" entry "$@" || return 1
  assert_entry_file "$get_label" entry "$@" || return 1
}

assert_lunch_roundtrip() {
  local save_label="$1"
  local get_label="$2"
  local validate_label="$3"
  shift 3

  assert_entry_pair "$save_label" "$get_label" "$@" || return 1
  assert_entry_file "$validate_label" today_lunch "$@" || return 1
}

assert_note() {
  local label="$1"
  local expected="$2"

  python3 - "${BODYFILE[$label]}" "$expected" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

entry = obj.get("entry") if isinstance(obj, dict) else None
if not isinstance(entry, dict):
    raise SystemExit(1)

if entry.get("note") != sys.argv[2]:
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_null_note() {
  assert_note "$1" '__NULL_NOTE__' 2>/dev/null
}

assert_error_coded_or_message() {
  local label="$1"
  local expected_status="$2"
  local http_status
  http_status="$(status_of "$label")"
  [[ "$http_status" == "$expected_status" ]] || return 1

  python3 - "${BODYFILE[$label]}" <<'PY'
import json, sys
try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)
if not isinstance(obj, dict) or obj.get("ok") is not False:
    raise SystemExit(1)
code = obj.get("code")
msg = obj.get("error")
if isinstance(code, str) and code.strip():
    raise SystemExit(0)
if isinstance(msg, str) and msg.strip():
    raise SystemExit(0)
raise SystemExit(1)
PY
}

assert_error() {
  local label="$1"
  local expected_status="$2"
  local expected_code_regex="$3"
  local http_status
  local code

  http_status="$(status_of "$label")"
  [[ "$http_status" == "$expected_status" ]] || return 1

  code="$(response_code "$label" 2>/dev/null || true)"
  [[ -n "$code" ]] || return 1

  python3 - "$code" "$expected_code_regex" <<'PY'
import re
import sys
raise SystemExit(0 if re.fullmatch(sys.argv[2], sys.argv[1].lower()) else 1)
PY
}

assert_anomaly() {
  local label="$1"
  [[ "$(status_of "$label")" == "200" ]] || return 1

  python3 - "${BODYFILE[$label]}" <<'PY'
import json
import sys

try:
    obj = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)

if not isinstance(obj, dict) or obj.get("ok") is not True:
    raise SystemExit(1)

entry = obj.get("entry")
if not isinstance(entry, dict):
    raise SystemExit(1)

flag = entry.get("flaggedAnomaly")
if flag is None:
    flag = entry.get("flagged_anomaly")

raise SystemExit(0 if flag is True else 1)
PY
}

assert_rest_get() {
  local label="$1"
  local http_status
  http_status="$(status_of "$label")"

  python3 - "$http_status" "${BODYFILE[$label]}" <<'PY'
import json
import sys

try:
    status = int(sys.argv[1])
except Exception:
    raise SystemExit(1)

if 400 <= status <= 599:
    raise SystemExit(0)

if status == 204:
    raise SystemExit(0)

if status != 200:
    raise SystemExit(1)

try:
    obj = json.load(open(sys.argv[2]))
except Exception:
    raise SystemExit(1)

raise SystemExit(0 if obj == [] else 1)
PY
}

assert_rest_insert_failed() {
  local label="$1"
  local http_status
  http_status="$(status_of "$label")"

  python3 - "$http_status" <<'PY'
import sys
try:
    status = int(sys.argv[1])
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if 400 <= status <= 599 else 1)
PY
}

assert_isolation() {
  local poki_slot_label="$1"
  local poki_state_label="$2"
  local sushi_auth_label="$3"
  local poki_auth_label="$4"
  local sushi_slot_label="$5"

  python3 - "${BODYFILE[$poki_slot_label]}" "${BODYFILE[$poki_state_label]}" \
    "${BODYFILE[$sushi_auth_label]}" "${BODYFILE[$poki_auth_label]}" \
    "${BODYFILE[$sushi_slot_label]}" <<'PY'
import json
import sys
from decimal import Decimal

def load(path):
    return json.load(open(path), parse_float=Decimal, parse_int=Decimal)

def roster_ids(obj):
    result = set()
    for row in obj.get("roster", []) if isinstance(obj, dict) else []:
        if isinstance(row, dict) and isinstance(row.get("id"), str):
            result.add(row["id"])
    return result

def pick(obj, names):
    for name in names:
        if name in obj:
            return obj[name], True
    return None, False

def entry_people(entry):
    ids, ids_ok = pick(entry, ("peopleIds", "people_ids"))
    if ids_ok and isinstance(ids, list):
        return ids
    people = entry.get("people") or entry.get("entryPeople") or entry.get("entry_people")
    if not isinstance(people, list):
        return []
    result = []
    for person in people:
        if isinstance(person, dict):
            for key in ("personId", "person_id", "employeeId", "employee_id", "id"):
                if key in person:
                    result.append(person[key])
                    break
    return result

def number_tuple(entry):
    if not isinstance(entry, dict):
        return None
    values = []
    for names in (
        ("cash", "cashAmount", "cash_amount"),
        ("card", "cardAmount", "card_amount"),
        ("gratuity", "tip"),
    ):
        value, ok = pick(entry, names)
        if not ok:
            return None
        values.append(Decimal(str(value)))
    return tuple(values)

try:
    poki_slot = load(sys.argv[1])
    poki_state = load(sys.argv[2])
    sushi_auth = load(sys.argv[3])
    poki_auth = load(sys.argv[4])
    sushi_slot = load(sys.argv[5])

    sushi_ids = roster_ids(sushi_auth)
    poki_ids = roster_ids(poki_auth)
    sushi_only = sushi_ids - poki_ids

    state_location = poki_state.get("location")
    if isinstance(state_location, dict):
        state_location = state_location.get("name", "")
    if state_location is not None and "poki" not in str(state_location).lower():
        raise AssertionError("Poki state location mismatch")

    state_roster = poki_state.get("roster")
    if not isinstance(state_roster, list):
        raise AssertionError("Poki state roster missing")

    state_ids = roster_ids(poki_state)
    if state_ids & sushi_only:
        raise AssertionError("Sushi-only employee in Poki state")

    if poki_ids & sushi_only:
        raise AssertionError("Sushi-only employee in Poki roster")

    scheduled = poki_slot.get("scheduledIds")
    if isinstance(scheduled, list) and set(scheduled) & sushi_only:
        raise AssertionError("Sushi-only employee in Poki scheduledIds")

    poki_entry = poki_slot.get("entry")
    sushi_entry = sushi_slot.get("entry")

    if sushi_entry is None or not isinstance(sushi_entry, dict):
        raise AssertionError("Sushi comparison entry missing")

    if poki_entry is not None:
        if not isinstance(poki_entry, dict):
            raise AssertionError("bad Poki entry")

        if set(entry_people(poki_entry)) & sushi_only:
            raise AssertionError("Sushi-only employee in Poki entry")

        if number_tuple(poki_entry) == number_tuple(sushi_entry):
            raise AssertionError("Poki returned Sushi financial values")

        location = poki_entry.get("location")
        if location is not None and str(location).lower() != "poki":
            raise AssertionError("Poki entry location mismatch")
except Exception:
    raise SystemExit(1)

raise SystemExit(0)
PY
}

assert_poki_scope11() {
  local save_label="$1"
  local poki_get_label="$2"
  local sushi_before_label="$3"
  local sushi_after_label="$4"
  local expected_ids="$5"
  local expected_weights="$6"
  local expected_cash="$7"
  local expected_card="$8"
  local expected_gratuity="$9"
  local expected_note="${10}"

  python3 - "${BODYFILE[$save_label]}" "${BODYFILE[$poki_get_label]}" \
    "${BODYFILE[$sushi_before_label]}" "${BODYFILE[$sushi_after_label]}" \
    "$expected_ids" "$expected_weights" "$expected_cash" "$expected_card" \
    "$expected_gratuity" "$expected_note" <<'PY'
from decimal import Decimal
import json
import sys

def load(path):
    return json.load(open(path), parse_float=Decimal, parse_int=Decimal)

def pick(obj, names):
    for name in names:
        if name in obj:
            return obj[name], True
    return None, False

def people(entry):
    ids, ids_ok = pick(entry, ("peopleIds", "people_ids"))
    weights, weights_ok = pick(entry, ("weights",))
    if ids_ok and weights_ok and isinstance(ids, list) and isinstance(weights, list):
        return ids, weights

    rows = entry.get("people") or entry.get("entryPeople") or entry.get("entry_people")
    if not isinstance(rows, list):
        raise AssertionError("people missing")

    ids = []
    weights = []
    for row in rows:
        if not isinstance(row, dict):
            raise AssertionError("bad person")
        pid = None
        for key in ("personId", "person_id", "employeeId", "employee_id", "id"):
            if key in row:
                pid = row[key]
                break
        if pid is None or "weight" not in row:
            raise AssertionError("bad person fields")
        ids.append(pid)
        weights.append(row["weight"])
    return ids, weights

def signature(entry):
    if not isinstance(entry, dict):
        raise AssertionError("entry missing")

    cash, cash_ok = pick(entry, ("cash", "cashAmount", "cash_amount"))
    card, card_ok = pick(entry, ("card", "cardAmount", "card_amount"))
    gratuity, gratuity_ok = pick(entry, ("gratuity", "tip"))
    scope, scope_ok = pick(entry, ("enteredScope", "entered_scope"))
    note, note_ok = pick(entry, ("note",))

    if not all((cash_ok, card_ok, gratuity_ok, scope_ok, note_ok)):
        raise AssertionError("entry field missing")

    ids, weights = people(entry)
    return (
        Decimal(str(cash)),
        Decimal(str(card)),
        Decimal(str(gratuity)),
        scope,
        note,
        tuple(ids),
        tuple(Decimal(str(x)) for x in weights),
    )

try:
    save = load(sys.argv[1])
    poki_get = load(sys.argv[2])
    sushi_before = load(sys.argv[3])
    sushi_after = load(sys.argv[4])

    expected_ids = json.loads(sys.argv[5])
    expected_weights = json.loads(sys.argv[6], parse_float=Decimal, parse_int=Decimal)
    expected = (
        Decimal(sys.argv[7]),
        Decimal(sys.argv[8]),
        Decimal(sys.argv[9]),
        "shift",
        sys.argv[10],
        tuple(expected_ids),
        tuple(Decimal(str(x)) for x in expected_weights),
    )

    if save.get("ok") is not True:
        raise AssertionError("save not ok")

    if signature(save.get("entry")) != expected:
        raise AssertionError("Poki save mismatch")

    if signature(poki_get.get("entry")) != expected:
        raise AssertionError("Poki read-back mismatch")

    before_sig = signature(sushi_before.get("entry"))
    after_sig = signature(sushi_after.get("entry"))
    if before_sig != after_sig:
        raise AssertionError("Sushi entry changed")

    if set(expected_ids) & set(before_sig[5]):
        raise AssertionError("Poki IDs already present in Sushi snapshot")
except Exception:
    raise SystemExit(1)

raise SystemExit(0)
PY
}

scan_all_responses() {
  local sushi_roster_json
  local poki_roster_json
  local own_tokens_json
  local token_owner_json
  local label
  local result

  sushi_roster_json="$(json_extract auth_sushi_2 roster 2>/dev/null || print -r -- '[]')"
  poki_roster_json="$(json_extract auth_poki_1 roster 2>/dev/null || print -r -- '[]')"

  own_tokens_json="$(python3 - "$SESSION_SUSHI_1" "$SESSION_SUSHI" "$SESSION_SUSHI_3" \
    "$SESSION_SUSHI_4" "$SESSION_POKI_1" "$SESSION_POKI_2" "$TICKET_SUSHI_1" <<'PY'
import json
import sys
print(json.dumps([x for x in sys.argv[1:] if x], separators=(",", ":")))
PY
  )"

  token_owner_json="$(python3 - "$SESSION_SUSHI_1" "$SESSION_SUSHI" "$SESSION_SUSHI_3" \
    "$SESSION_SUSHI_4" "$SESSION_POKI_1" "$SESSION_POKI_2" "$TICKET_SUSHI_1" <<'PY'
import json
import sys

owner = {}
for value in sys.argv[1:5]:
    if value:
        owner[value] = "sushi"
for value in sys.argv[5:7]:
    if value:
        owner[value] = "poki"
if sys.argv[7]:
    owner[sys.argv[7]] = "sushi"
print(json.dumps(owner, separators=(",", ":")))
PY
  )"

  for label in "${REQUESTS[@]}"; do
    result="$(python3 - "${BODYFILE[$label]}" "$label" "$ANON_KEY" \
      "$SUSHI_ENTRY_TOKEN" "$POKI_ENTRY_TOKEN" "$sushi_roster_json" \
      "$poki_roster_json" "$own_tokens_json" "$token_owner_json" <<'PY'
import json
import re
import sys

path, label, anon_key, sushi_entry_token, poki_entry_token = sys.argv[1:6]
sushi_roster_text, poki_roster_text, own_tokens_text, owner_text = sys.argv[6:10]

try:
    raw = open(path, "rb").read()
except Exception:
    raw = b""

text = raw.decode("utf-8", "replace")
lower = text.lower()
findings = []

for term in ("hash", "service", "secret", "postgres", "pg"):
    if term in lower:
        findings.append("keyword:" + term)

for token_name, token in (
    ("anon_key", anon_key),
    ("sushi_entry_token", sushi_entry_token),
    ("poki_entry_token", poki_entry_token),
):
    if token and token in text:
        findings.append("token:" + token_name)

try:
    own_tokens = set(json.loads(own_tokens_text))
except Exception:
    own_tokens = set()

try:
    token_owner = json.loads(owner_text)
except Exception:
    token_owner = {}

try:
    parsed = json.loads(text)
except Exception:
    parsed = None

def walk(value, key=""):
    if isinstance(value, dict):
        for k, v in value.items():
            yield k, v
            yield from walk(v, k)
    elif isinstance(value, list):
        for v in value:
            yield from walk(v, key)

if parsed is not None:
    for key, value in walk(parsed):
        if key.lower() in ("token", "sessiontoken", "ticket", "voiceticket", "voice_ticket"):
            if isinstance(value, str) and value:
                if value not in own_tokens:
                    findings.append("unknown_token_field:" + key)
                else:
                    label_lower = label.lower()
                    owner = token_owner.get(value)
                    if owner == "sushi" and "poki" in label_lower:
                        findings.append("cross_location_token:sushi")
                    if owner == "poki" and "sushi" in label_lower:
                        findings.append("cross_location_token:poki")

def roster_values(text_value):
    try:
        rows = json.loads(text_value)
    except Exception:
        rows = []
    values = []
    for row in rows:
        if isinstance(row, dict):
            ident = row.get("id")
            name = row.get("name")
            if isinstance(ident, str) and ident:
                values.append(ident)
            if isinstance(name, str) and name:
                values.append(name)
    return values

sushi_values = roster_values(sushi_roster_text)
poki_values = roster_values(poki_roster_text)
sushi_ids = {
    row.get("id") for row in json.loads(sushi_roster_text)
    if isinstance(row, dict) and isinstance(row.get("id"), str)
}
poki_ids = {
    row.get("id") for row in json.loads(poki_roster_text)
    if isinstance(row, dict) and isinstance(row.get("id"), str)
}
sushi_only = sushi_ids - poki_ids
poki_only = poki_ids - sushi_ids

try:
    sushi_rows = json.loads(sushi_roster_text)
except Exception:
    sushi_rows = []
try:
    poki_rows = json.loads(poki_roster_text)
except Exception:
    poki_rows = []

sushi_only_values = []
for row in sushi_rows:
    if isinstance(row, dict) and row.get("id") in sushi_only:
        if isinstance(row.get("id"), str):
            sushi_only_values.append(row["id"])
        if isinstance(row.get("name"), str):
            sushi_only_values.append(row["name"])

poki_only_values = []
for row in poki_rows:
    if isinstance(row, dict) and row.get("id") in poki_only:
        if isinstance(row.get("id"), str):
            poki_only_values.append(row["id"])
        if isinstance(row.get("name"), str):
            poki_only_values.append(row["name"])

label_lower = label.lower()
if "poki" in label_lower:
    forbidden_values = sushi_only_values
elif "sushi" in label_lower:
    forbidden_values = poki_only_values
else:
    # Location cannot be attributed from the label alone, so a cross-location
    # claim would be unfounded here. Dedicated isolation checks (8, 11) cover
    # this; keyword scanning below still applies to every response.
    forbidden_values = []

for value in forbidden_values:
    needle = json.dumps(value, ensure_ascii=False)
    if needle in text:
        findings.append("other_location_data:" + value)

seen = []
for finding in findings:
    if finding not in seen:
        seen.append(finding)

print(",".join(seen[:12]))
PY
    )"

    if [[ -n "$result" ]]; then
      print -r -- "LEAK_SCAN ${label}: ${result}"
      LEAK_FINDINGS+=("${label}:${result}")
      (( LEAK_COUNT += 1 ))
    fi
  done

  if (( LEAK_COUNT == 0 )); then
    print -r -- "LEAK_SCAN none"
  fi
}

emit_check() {
  local id="$1"
  local short_name="$2"
  local evidence="$3"

  evidence="${evidence//$'\n'/ }"
  if [[ -z "$evidence" ]]; then
    print -r -- "CHECK ${id} ${short_name}: PASS"
  else
    print -r -- "CHECK ${id} ${short_name}: FAIL ${evidence}"
  fi
}

PING_AUTH='{"action":"ping"}'
PING_ENTRIES='{"action":"ping"}'
VALIDATE_SUSHI='{"action":"validate_token","token":"e2e-tips-v3-sushi-token-2026"}'
VALIDATE_POKI='{"action":"validate_token","token":"e2e-tips-v3-poki-token-2026"}'

typeset r1 r2 r3 r4 r5 r6 r7 r8 r9 r10 r11 r12
r1=''
r2=''
r3=''
r4=''
r5=''
r6=''
r7=''
r8=''
r9=''
r10=''
r11=''
r12=''

request_post ping_auth "$AUTH_URL" "$PING_AUTH"
request_post ping_entries "$ENTRIES_URL" "$PING_ENTRIES"
request_post auth_sushi_1 "$AUTH_URL" "$VALIDATE_SUSHI"
request_post auth_poki_1 "$AUTH_URL" "$VALIDATE_POKI"

SESSION_SUSHI_1="$(json_extract auth_sushi_1 sessionToken 2>/dev/null || print -r -- '')"
SESSION_POKI_1="$(json_extract auth_poki_1 sessionToken 2>/dev/null || print -r -- '')"

STATE_SUSHI_1="$(make_session_payload state "$SESSION_SUSHI_1")"
request_post state_sushi_1 "$AUTH_URL" "$STATE_SUSHI_1"

CLOSER_ID="$(id_at "$(roster_ids_json auth_sushi_1)" 0)"
SET_CLOSER="$(make_set_closer_payload "$SESSION_SUSHI_1" "$CLOSER_ID")"
request_post set_closer_sushi_1 "$AUTH_URL" "$SET_CLOSER"

VOICE_SUSHI_1="$(make_session_payload voice_ticket "$SESSION_SUSHI_1")"
request_post voice_sushi_1 "$AUTH_URL" "$VOICE_SUSHI_1"
TICKET_SUSHI_1="$(json_extract voice_sushi_1 ticket 2>/dev/null || json_extract voice_sushi_1 voiceTicket 2>/dev/null || print -r -- '')"

END_SUSHI_1="$(make_session_payload end_session "$SESSION_SUSHI_1")"
request_post end_sushi_1 "$AUTH_URL" "$END_SUSHI_1"

ENDED_STATE_SUSHI_1="$(make_session_payload state "$SESSION_SUSHI_1")"
request_post ended_state_sushi_1 "$AUTH_URL" "$ENDED_STATE_SUSHI_1"

if ! assert_ping ping_auth; then r1+="tip-entry-auth ping $(describe ping_auth); "; fi
if ! assert_ping ping_entries; then r1+="tip-entries ping $(describe ping_entries); "; fi
if ! assert_validate auth_sushi_1 sushi; then r1+="Sushi validate $(describe auth_sushi_1); "; fi
if ! assert_validate auth_poki_1 poki; then r1+="Poki validate $(describe auth_poki_1); "; fi
if ! assert_state state_sushi_1 sushi; then r1+="state $(describe state_sushi_1); "; fi
if ! assert_set_closer set_closer_sushi_1 "$CLOSER_ID"; then r1+="set_closer $(describe set_closer_sushi_1); "; fi
if ! assert_ticket voice_sushi_1; then r1+="voice_ticket $(describe voice_sushi_1); "; fi
if ! assert_end end_sushi_1; then r1+="end_session $(describe end_sushi_1); "; fi
if ! assert_session_invalid ended_state_sushi_1; then r1+="ended session invalidation $(describe ended_state_sushi_1); "; fi

request_post auth_sushi_2 "$AUTH_URL" "$VALIDATE_SUSHI"
SESSION_SUSHI="$(json_extract auth_sushi_2 sessionToken 2>/dev/null || print -r -- '')"

SUSHI_IDS_JSON="$(roster_ids_json auth_sushi_2)"
POKI_IDS_JSON="$(roster_ids_json auth_poki_1)"
SUSHI_ID1="$(id_at "$SUSHI_IDS_JSON" 0)"
SUSHI_ID2="$(id_at "$SUSHI_IDS_JSON" 1)"
SUSHI_ID3="$(id_at "$SUSHI_IDS_JSON" 2)"
POKI_ID1="$(id_at "$POKI_IDS_JSON" 0)"
POKI_ID2="$(id_at "$POKI_IDS_JSON" 1)"
SUSHI_TWO_JSON="$(json_ids_pair "$SUSHI_ID1" "$SUSHI_ID2")"
POKI_TWO_JSON="$(json_ids_pair "$POKI_ID1" "$POKI_ID2")"
SUSHI_LUNCH_WEIGHTS_JSON="$(weights_for_ids "$SUSHI_IDS_JSON")"
POKI_WEIGHTS_JSON='[1,0.5]'
SUSHI_DINNER_WEIGHTS_JSON='[1,0.5]'
POKI_ONE_JSON="$(python3 - "$POKI_ID1" <<'PY'
import json
import sys
print(json.dumps([sys.argv[1]], separators=(",", ":")))
PY
)"
SUSHI_ONE_JSON="$(python3 - "$SUSHI_ID1" <<'PY'
import json
import sys
print(json.dumps([sys.argv[1]], separators=(",", ":")))
PY
)"

NOTE_PREFIX='Quotes "and", comma, emoji ☕, literal $5, '
NOTE280="$(NOTE_PREFIX="$NOTE_PREFIX" python3 - <<'PY'
import os
prefix = os.environ["NOTE_PREFIX"]
print(prefix + "x" * (280 - len(prefix)), end="")
PY
)"
NOTE281="$(python3 - <<'PY'
print("x" * 281, end="")
PY
)"
NOTE_WS=$' \t  '

LUNCH_CASH='118.00'
LUNCH_CARD='142.00'
LUNCH_GRATUITY='12.34'
LUNCH_IDS_JSON="$SUSHI_IDS_JSON"
LUNCH_WEIGHTS_JSON="$SUSHI_LUNCH_WEIGHTS_JSON"

LUNCH_SAVE_PAYLOAD="$(make_save_payload "$SESSION_SUSHI" lunch "$LUNCH_CASH" "$LUNCH_CARD" "$LUNCH_GRATUITY" shift "$LUNCH_IDS_JSON" "$LUNCH_WEIGHTS_JSON" "$NOTE280" 1 '{}')"
request_post sushi_lunch_save "$ENTRIES_URL" "$LUNCH_SAVE_PAYLOAD"

LUNCH_GET_PAYLOAD="$(make_get_slot_payload "$SESSION_SUSHI" lunch)"
request_post sushi_lunch_get "$ENTRIES_URL" "$LUNCH_GET_PAYLOAD"

request_post auth_sushi_3 "$AUTH_URL" "$VALIDATE_SUSHI"
SESSION_SUSHI_3="$(json_extract auth_sushi_3 sessionToken 2>/dev/null || print -r -- '')"

if ! assert_validate auth_sushi_2 sushi; then r2+="fresh Sushi validate $(describe auth_sushi_2); "; fi
if ! assert_save_ok sushi_lunch_save; then r2+="lunch save $(describe sushi_lunch_save); "; fi
if ! assert_get_slot sushi_lunch_get; then r2+="lunch get_slot $(describe sushi_lunch_get); "; fi
if ! assert_validate auth_sushi_3 sushi; then r2+="fresh read-back validate $(describe auth_sushi_3); "; fi
if ! assert_lunch_roundtrip sushi_lunch_save sushi_lunch_get auth_sushi_3 \
  "$LUNCH_CASH" "$LUNCH_CARD" "$LUNCH_GRATUITY" \
  "$LUNCH_CASH" "$LUNCH_CARD" "$LUNCH_GRATUITY" \
  shift "$NOTE280" "$LUNCH_IDS_JSON" "$LUNCH_WEIGHTS_JSON" 0; then
  r2+="lunch persistence values/order/note $(describe sushi_lunch_get); "
fi

NEGATIVE_AFTER_LUNCH_PAYLOAD="$(make_save_payload "$SESSION_SUSHI" dinner '117.99' '141.99' '12.33' day "$SUSHI_TWO_JSON" "$SUSHI_DINNER_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post err_negative_after_lunch_pre "$ENTRIES_URL" "$NEGATIVE_AFTER_LUNCH_PAYLOAD"

DINNER_CASH='323.00'
DINNER_CARD='777.00'
DINNER_GRATUITY='216.00'
DINNER_STORED_CASH="$(decimal_sub "$DINNER_CASH" "$LUNCH_CASH")"
DINNER_STORED_CARD="$(decimal_sub "$DINNER_CARD" "$LUNCH_CARD")"
DINNER_STORED_GRATUITY="$(decimal_sub "$DINNER_GRATUITY" "$LUNCH_GRATUITY")"

DINNER_SAVE_PAYLOAD="$(make_save_payload "$SESSION_SUSHI" dinner "$DINNER_CASH" "$DINNER_CARD" "$DINNER_GRATUITY" day "$SUSHI_TWO_JSON" "$SUSHI_DINNER_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post sushi_dinner_save "$ENTRIES_URL" "$DINNER_SAVE_PAYLOAD"

DINNER_GET_PAYLOAD="$(make_get_slot_payload "$SESSION_SUSHI" dinner)"
request_post sushi_dinner_get "$ENTRIES_URL" "$DINNER_GET_PAYLOAD"

if ! assert_save_ok sushi_dinner_save; then r3+="dinner save $(describe sushi_dinner_save); "; fi
if ! assert_get_slot sushi_dinner_get; then r3+="dinner get_slot $(describe sushi_dinner_get); "; fi
if ! assert_entry_pair sushi_dinner_save sushi_dinner_get \
  "$DINNER_STORED_CASH" "$DINNER_STORED_CARD" "$DINNER_STORED_GRATUITY" \
  "$DINNER_CASH" "$DINNER_CARD" "$DINNER_GRATUITY" \
  day '__NULL_NOTE__' "$SUSHI_TWO_JSON" "$SUSHI_DINNER_WEIGHTS_JSON" 1; then
  r3+="derived/raw dinner persistence or person weights $(describe sushi_dinner_get); "
fi

RESAVE_CASH='500.00'
RESAVE_CARD='900.00'
RESAVE_GRATUITY='50.00'
RESAVE_STORED_CASH="$(decimal_sub "$RESAVE_CASH" "$LUNCH_CASH")"
RESAVE_STORED_CARD="$(decimal_sub "$RESAVE_CARD" "$LUNCH_CARD")"
RESAVE_STORED_GRATUITY="$(decimal_sub "$RESAVE_GRATUITY" "$LUNCH_GRATUITY")"

RESAVE_PAYLOAD="$(make_save_payload "$SESSION_SUSHI" dinner "$RESAVE_CASH" "$RESAVE_CARD" "$RESAVE_GRATUITY" day "$SUSHI_TWO_JSON" "$SUSHI_DINNER_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post sushi_dinner_resave_same "$ENTRIES_URL" "$RESAVE_PAYLOAD"

request_post sushi_dinner_get_after_resave "$ENTRIES_URL" "$DINNER_GET_PAYLOAD"

request_post auth_sushi_4 "$AUTH_URL" "$VALIDATE_SUSHI"
SESSION_SUSHI_4="$(json_extract auth_sushi_4 sessionToken 2>/dev/null || print -r -- '')"
OTHER_RESAVE_PAYLOAD="$(make_save_payload "$SESSION_SUSHI_4" dinner "$RESAVE_CASH" "$RESAVE_CARD" "$RESAVE_GRATUITY" day "$SUSHI_TWO_JSON" "$SUSHI_DINNER_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post sushi_dinner_resave_other "$ENTRIES_URL" "$OTHER_RESAVE_PAYLOAD"

if ! assert_save_ok sushi_dinner_resave_same; then r4+="same-session resave $(describe sushi_dinner_resave_same); "; fi
if ! assert_get_slot sushi_dinner_get_after_resave; then r4+="same-session resave read-back $(describe sushi_dinner_get_after_resave); "; fi
if ! assert_entry_pair sushi_dinner_resave_same sushi_dinner_get_after_resave \
  "$RESAVE_STORED_CASH" "$RESAVE_STORED_CARD" "$RESAVE_STORED_GRATUITY" \
  "$RESAVE_CASH" "$RESAVE_CARD" "$RESAVE_GRATUITY" \
  day '__NULL_NOTE__' "$SUSHI_TWO_JSON" "$SUSHI_DINNER_WEIGHTS_JSON" 1; then
  r4+="overwrite values $(describe sushi_dinner_get_after_resave); "
fi
if ! assert_validate auth_sushi_4 sushi; then r4+="different-session validate $(describe auth_sushi_4); "; fi
if ! assert_error sushi_dinner_resave_other 409 '^already_recorded$'; then
  r4+="different-session conflict $(describe sushi_dinner_resave_other); "
fi

BAD_MEAL_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" brunch '1.00' '2.00' '3.00' shift "$POKI_TWO_JSON" "$POKI_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post err_bad_meal "$ENTRIES_URL" "$BAD_MEAL_PAYLOAD"

NEGATIVE_AMOUNT_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" lunch '-1.00' '2.00' '3.00' shift "$POKI_TWO_JSON" "$POKI_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post err_negative_amount "$ENTRIES_URL" "$NEGATIVE_AMOUNT_PAYLOAD"

LARGE_AMOUNT_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" lunch '100000.00' '2.00' '3.00' shift "$POKI_TWO_JSON" "$POKI_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post err_amount_too_large "$ENTRIES_URL" "$LARGE_AMOUNT_PAYLOAD"

WEIGHT_MISMATCH_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" lunch '1.00' '2.00' '3.00' shift "$POKI_TWO_JSON" "$POKI_ONE_JSON" '__NULL_NOTE__' 1 '{}')"
request_post err_weights_mismatch "$ENTRIES_URL" "$WEIGHT_MISMATCH_PAYLOAD"

WEIGHT_ZERO_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" lunch '1.00' '2.00' '3.00' shift "$POKI_TWO_JSON" '[0,1]' '__NULL_NOTE__' 1 '{}')"
request_post err_weight_zero "$ENTRIES_URL" "$WEIGHT_ZERO_PAYLOAD"

WEIGHT_HIGH_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" lunch '1.00' '2.00' '3.00' shift "$POKI_TWO_JSON" '[1.2,1]' '__NULL_NOTE__' 1 '{}')"
request_post err_weight_high "$ENTRIES_URL" "$WEIGHT_HIGH_PAYLOAD"

NO_PEOPLE_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" lunch '1.00' '2.00' '3.00' shift '[]' '[]' '__NULL_NOTE__' 1 '{}')"
request_post err_no_people "$ENTRIES_URL" "$NO_PEOPLE_PAYLOAD"

OTHER_ROSTER_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" lunch '1.00' '2.00' '3.00' shift "$SUSHI_ONE_JSON" '[1]' '__NULL_NOTE__' 1 '{}')"
request_post err_other_roster "$ENTRIES_URL" "$OTHER_ROSTER_PAYLOAD"

BAD_SCOPE_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" lunch '1.00' '2.00' '3.00' garbage "$POKI_TWO_JSON" "$POKI_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post err_bad_scope "$ENTRIES_URL" "$BAD_SCOPE_PAYLOAD"

ANOMALY_PAYLOAD="$(make_save_payload "$SESSION_POKI_1" dinner '50.00' '60.00' '7.00' day "$POKI_TWO_JSON" "$POKI_WEIGHTS_JSON" '__NULL_NOTE__' 1 '{}')"
request_post err_poki_anomaly "$ENTRIES_URL" "$ANOMALY_PAYLOAD"

if ! assert_error_coded_or_message err_bad_meal 400; then r5+="bad meal $(describe err_bad_meal); "; fi
if ! assert_error_coded_or_message err_negative_amount 400; then r5+="negative amount $(describe err_negative_amount); "; fi
if ! assert_error_coded_or_message err_amount_too_large 400; then r5+="large amount $(describe err_amount_too_large); "; fi
if ! assert_error err_weights_mismatch 400 '^bad_weights$'; then r5+="weight length $(describe err_weights_mismatch); "; fi
if ! assert_error err_weight_zero 400 '^bad_weights$'; then r5+="weight zero $(describe err_weight_zero); "; fi
if ! assert_error err_weight_high 400 '^bad_weights$'; then r5+="weight >1 $(describe err_weight_high); "; fi
if ! assert_error err_no_people 400 '^no_people$'; then r5+="empty people $(describe err_no_people); "; fi
if ! assert_error_coded_or_message err_other_roster 400; then r5+="other roster $(describe err_other_roster); "; fi
if ! assert_error_coded_or_message err_bad_scope 400; then r5+="bad scope $(describe err_bad_scope); "; fi
if ! assert_error err_negative_after_lunch_pre 400 '^negative_after_lunch$'; then r5+="negative after lunch $(describe err_negative_after_lunch_pre); "; fi
if ! assert_anomaly err_poki_anomaly; then r5+="Poki no-lunch anomaly $(describe err_poki_anomaly); "; fi

OLD_CASH='10.00'
OLD_CARD='20.00'
OLD_PAYLOAD="$(make_save_payload "$SESSION_SUSHI" lunch "$OLD_CASH" "$OLD_CARD" '0.00' shift "$LUNCH_IDS_JSON" "$LUNCH_WEIGHTS_JSON" '__NULL_NOTE__' 0 '{}')"
request_post old_client_save "$ENTRIES_URL" "$OLD_PAYLOAD"
request_post old_client_get "$ENTRIES_URL" "$LUNCH_GET_PAYLOAD"

if ! assert_save_ok old_client_save; then r6+="old-client save $(describe old_client_save); "; fi
if ! assert_get_slot old_client_get; then r6+="old-client get_slot $(describe old_client_get); "; fi
if ! assert_entry_pair old_client_save old_client_get \
  "$OLD_CASH" "$OLD_CARD" '0.00' \
  "$OLD_CASH" "$OLD_CARD" '0.00' \
  shift '__NULL_NOTE__' "$LUNCH_IDS_JSON" "$LUNCH_WEIGHTS_JSON" 1; then
  r6+="old-client defaults/raw/weights $(describe old_client_get); "
fi

NOTE281_TRIMMED="$(python3 - "$NOTE281" <<'PY'
import sys
print(sys.argv[1].strip()[:280], end="")
PY
)"
NOTE281_PAYLOAD="$(make_save_payload "$SESSION_SUSHI" lunch '11.00' '21.00' '1.00' shift "$LUNCH_IDS_JSON" "$LUNCH_WEIGHTS_JSON" "$NOTE281" 1 '{}')"
request_post note_281_save "$ENTRIES_URL" "$NOTE281_PAYLOAD"
request_post note_281_get "$ENTRIES_URL" "$LUNCH_GET_PAYLOAD"

NOTE_WS_PAYLOAD="$(make_save_payload "$SESSION_SUSHI" lunch '12.00' '22.00' '2.00' shift "$LUNCH_IDS_JSON" "$LUNCH_WEIGHTS_JSON" "$NOTE_WS" 1 '{}')"
request_post note_whitespace_save "$ENTRIES_URL" "$NOTE_WS_PAYLOAD"
request_post note_whitespace_get "$ENTRIES_URL" "$LUNCH_GET_PAYLOAD"

if ! assert_save_ok note_281_save; then r7+="281+ note save $(describe note_281_save); "; fi
if ! assert_get_slot note_281_get; then r7+="281+ note get_slot $(describe note_281_get); "; fi
if ! assert_note note_281_get "$NOTE281_TRIMMED"; then r7+="281+ note trim $(describe note_281_get); "; fi
if ! assert_save_ok note_whitespace_save; then r7+="whitespace note save $(describe note_whitespace_save); "; fi
if ! assert_get_slot note_whitespace_get; then r7+="whitespace note get_slot $(describe note_whitespace_get); "; fi
if ! python3 - "${BODYFILE[note_whitespace_get]}" <<'PY'
import json
import sys
obj = json.load(open(sys.argv[1]))
entry = obj.get("entry")
raise SystemExit(0 if isinstance(entry, dict) and entry.get("note") is None else 1)
PY
then
  r7+="whitespace note null $(describe note_whitespace_get); "
fi

request_post sushi_dinner_get_isolation "$ENTRIES_URL" "$DINNER_GET_PAYLOAD"
request_post poki_dinner_get_isolation "$ENTRIES_URL" "$(make_get_slot_payload "$SESSION_POKI_1" dinner)"
request_post poki_state_isolation "$AUTH_URL" "$(make_session_payload state "$SESSION_POKI_1")"

if ! assert_get_slot sushi_dinner_get_isolation; then r8+="Sushi isolation comparison slot $(describe sushi_dinner_get_isolation); "; fi
if ! assert_get_slot poki_dinner_get_isolation; then r8+="Poki get_slot $(describe poki_dinner_get_isolation); "; fi
if ! assert_state poki_state_isolation poki; then r8+="Poki state $(describe poki_state_isolation); "; fi
if ! assert_isolation poki_dinner_get_isolation poki_state_isolation auth_sushi_2 auth_poki_1 sushi_dinner_get_isolation; then
  r8+="cross-location slot/roster isolation $(describe poki_dinner_get_isolation); "
fi

request_get rest_get_tip_entries "${REST_BASE}/tip_entries?select=*"
request_get rest_get_tip_entry_people "${REST_BASE}/tip_entry_people?select=*"
request_get rest_get_tip_employees "${REST_BASE}/tip_employees?select=*"
request_get rest_get_tip_location_access "${REST_BASE}/tip_location_access?select=*"
request_get rest_get_tip_entry_sessions "${REST_BASE}/tip_entry_sessions?select=*"
request_post rest_insert_tip_entries "${REST_BASE}/tip_entries" '{"business_date":"2026-08-28","location_id":"11111111-1111-1111-1111-111111111111","meal_period":"lunch","cash_amount":1,"card_amount":1,"entry_method":"typed"}'

if ! assert_rest_get rest_get_tip_entries; then r10+="tip_entries REST $(describe rest_get_tip_entries); "; fi
if ! assert_rest_get rest_get_tip_entry_people; then r10+="tip_entry_people REST $(describe rest_get_tip_entry_people); "; fi
if ! assert_rest_get rest_get_tip_employees; then r10+="tip_employees REST $(describe rest_get_tip_employees); "; fi
if ! assert_rest_get rest_get_tip_location_access; then r10+="tip_location_access REST $(describe rest_get_tip_location_access); "; fi
if ! assert_rest_get rest_get_tip_entry_sessions; then r10+="tip_entry_sessions REST $(describe rest_get_tip_entry_sessions); "; fi
if ! assert_rest_insert_failed rest_insert_tip_entries; then r10+="REST INSERT $(describe rest_insert_tip_entries); "; fi

request_post auth_poki_2 "$AUTH_URL" "$VALIDATE_POKI"
SESSION_POKI_2="$(json_extract auth_poki_2 sessionToken 2>/dev/null || print -r -- '')"

FAKE_TOKEN="$(python3 - <<'PY'
print("A" * 64, end="")
PY
)"
request_post fake_token_state "$AUTH_URL" "$(make_session_payload state "$FAKE_TOKEN")"
request_post ended_token_state_11 "$AUTH_URL" "$(make_session_payload state "$SESSION_SUSHI_1")"
request_post sushi_lunch_snapshot_11 "$ENTRIES_URL" "$LUNCH_GET_PAYLOAD"

LOCATION_INJECTION_PAYLOAD="$(make_save_payload "$SESSION_POKI_2" lunch "$LUNCH_CASH" "$LUNCH_CARD" "$LUNCH_GRATUITY" shift "$POKI_IDS_JSON" "$POKI_WEIGHTS_JSON" "$NOTE280" 1 '{"location":"Sushi"}')"
request_post poki_save_sushi_payload "$ENTRIES_URL" "$LOCATION_INJECTION_PAYLOAD"

SAVE_11_LABEL=''
INJECTION_STATUS="$(status_of poki_save_sushi_payload)"

if [[ "$INJECTION_STATUS" == "200" ]]; then
  SAVE_11_LABEL='poki_save_sushi_payload'
  if ! assert_save_ok "$SAVE_11_LABEL"; then r11+="location-injection save shape $(describe "$SAVE_11_LABEL"); "; fi
else
  if ! status_at_least "$INJECTION_STATUS" 400; then
    r11+="location-injection unexpected status $(describe poki_save_sushi_payload); "
  fi

  INJECTION_CODE="$(response_code poki_save_sushi_payload 2>/dev/null || true)"
  [[ -n "$INJECTION_CODE" ]] || r11+="location-injection missing error code; "

  FALLBACK_PAYLOAD="$(make_save_payload "$SESSION_POKI_2" lunch "$LUNCH_CASH" "$LUNCH_CARD" "$LUNCH_GRATUITY" shift "$POKI_IDS_JSON" "$POKI_WEIGHTS_JSON" "$NOTE280" 1 '{}')"
  request_post poki_save_scoped_fallback "$ENTRIES_URL" "$FALLBACK_PAYLOAD"
  SAVE_11_LABEL='poki_save_scoped_fallback'

  if ! assert_save_ok "$SAVE_11_LABEL"; then r11+="scoped fallback save $(describe "$SAVE_11_LABEL"); "; fi
fi

request_post poki_lunch_get_11 "$ENTRIES_URL" "$(make_get_slot_payload "$SESSION_POKI_2" lunch)"
request_post sushi_lunch_get_11 "$ENTRIES_URL" "$LUNCH_GET_PAYLOAD"

if ! assert_validate auth_poki_2 poki; then r11+="Poki session validate $(describe auth_poki_2); "; fi
if ! assert_session_invalid fake_token_state; then r11+="made-up token $(describe fake_token_state); "; fi
if ! assert_session_invalid ended_token_state_11; then r11+="ended token $(describe ended_token_state_11); "; fi
if ! assert_get_slot sushi_lunch_snapshot_11; then r11+="Sushi pre-injection snapshot $(describe sushi_lunch_snapshot_11); "; fi
if ! assert_get_slot poki_lunch_get_11; then r11+="Poki location read-back $(describe poki_lunch_get_11); "; fi
if ! assert_get_slot sushi_lunch_get_11; then r11+="Sushi post-injection read-back $(describe sushi_lunch_get_11); "; fi

if [[ -n "$SAVE_11_LABEL" ]]; then
  if ! assert_entry_pair "$SAVE_11_LABEL" poki_lunch_get_11 \
    "$LUNCH_CASH" "$LUNCH_CARD" "$LUNCH_GRATUITY" \
    "$LUNCH_CASH" "$LUNCH_CARD" "$LUNCH_GRATUITY" \
    shift "$NOTE280" "$POKI_IDS_JSON" "$POKI_WEIGHTS_JSON" 1; then
    r11+="Poki scoped save values/people $(describe "$SAVE_11_LABEL"); "
  fi

  if ! assert_poki_scope11 "$SAVE_11_LABEL" poki_lunch_get_11 sushi_lunch_snapshot_11 sushi_lunch_get_11 \
    "$POKI_IDS_JSON" "$POKI_WEIGHTS_JSON" "$LUNCH_CASH" "$LUNCH_CARD" "$LUNCH_GRATUITY" "$NOTE280"; then
    r11+="session-derived Poki location or Sushi protection $(describe poki_lunch_get_11); "
  fi
else
  r11+="no successful Poki scoped save; "
fi

WRONG_TOKEN="$(python3 - <<'PY'
print("Z" * 64, end="")
PY
)"
WRONG_VALIDATE_PAYLOAD="$(make_validate_payload "$WRONG_TOKEN")"

RATE_429=0
RATE_429_LABEL=''
RATE_EVIDENCE=''

for i in {1..25}; do
  label="rate_wrong_${i}"
  request_post "$label" "$AUTH_URL" "$WRONG_VALIDATE_PAYLOAD"
  code="$(response_code "$label" 2>/dev/null || true)"
  RATE_EVIDENCE+="${label}:${STATUS[$label]}/${code:-none} "
  if [[ "${STATUS[$label]}" == "429" && "$code" == "rate_limited" ]]; then
    RATE_429=1
    [[ -z "$RATE_429_LABEL" ]] && RATE_429_LABEL="$label"
  fi
done

if [[ "$RATE_429" -ne 1 ]]; then
  r12+="no 429 rate_limited response (${RATE_EVIDENCE}); "
fi

scan_all_responses

if (( LEAK_COUNT > 0 )); then
  r9+="suspicious response bodies=${LEAK_COUNT}; "
fi

emit_check 1 session-lifecycle "$r1"
emit_check 2 sushi-lunch-persistence "$r2"
emit_check 3 sushi-dinner-derivation "$r3"
emit_check 4 resave-conflict "$r4"
emit_check 5 validation-errors "$r5"
emit_check 6 old-client-compatibility "$r6"
emit_check 7 note-handling "$r7"
emit_check 8 location-isolation "$r8"
emit_check 9 response-leakage "$r9"
emit_check 10 rest-lockdown "$r10"
emit_check 11 token-abuse-scoping "$r11"
emit_check 12 rate-limiting "$r12"
