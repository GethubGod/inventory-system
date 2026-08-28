# Tips v3 — JSON contract (the seam between frontend and backend)

Status: **AGREED** (Sol: yes-with-amendments, both folded in below;
Fable: agreed. 2026-08-27.)
Frontend owner: Claude (Fable). Backend owner: Codex (Sol).
Source of truth for product behavior: `HANDOFF-tips-v3.md` + `tips-v3-final.html`.
Where this file and the repo disagree about an existing data shape, the repo wins
and the discrepancy gets flagged here before either side builds on it.

## Principles

1. **The client sends what the closer typed; the server does the subtraction.**
   The server is authoritative — a stale client must never write a figure
   derived from a lunch amount that has since changed.
2. Money crosses the wire as decimal dollars (matching the existing payload
   convention) but is computed in **integer cents** on both sides.
3. Every new field is optional-with-default so an old client keeps working
   through the deploy window: `gratuity = 0`, `enteredScope = "shift"`,
   all weights `1`, `note = null`.

## `tip-entry-auth` → `state` and `tip-entries` → `get_slot`

`today` gains one key:

```ts
today: {
  businessDate: string;
  lunchRecorded: boolean;
  dinnerRecorded: boolean;
  defaultMeal: MealPeriod;
  lunch: { cash: number; card: number; gratuity: number } | null; // NEW
}
```

- `lunch` is the recorded lunch row for **this location** and **today's
  business date**, shift-only figures, decimal dollars.
- `null` when no lunch is recorded — the client then subtracts nothing and the
  save gets flagged server-side (silently to the closer).
- Client reads it defensively (`?? null`) so an older server degrades to
  "no subtraction available".

## `tip-entries` → `save` request

```ts
interface SavePayload {
  meal: MealPeriod;
  cash: number;          // as typed (decimal dollars)
  card: number;          // as typed
  gratuity: number;      // as typed, 0 when blank                      NEW
  enteredScope: "shift" | "day";                                     // NEW
  peopleIds: string[];
  weights: number[];     // positional against peopleIds, each in (0,1] NEW
  note: string | null;   // trimmed, ≤280 chars, null when empty        NEW
  entryMethod: "typed" | "voice";
  voiceVariant: VoiceVariant | null;
  correctionsCount: number;
  confirmAnomaly: boolean;
}
```

Server-side rules on `save` (backend owner implements, frontend owner relies on):

- `enteredScope === "day"` → subtract today's lunch row **field by field**
  (cash−cash, card−card, gratuity−gratuity) at the same location. Store the
  derived figures in `cash_amount`/`card_amount`/`gratuity_amount` and the
  typed figures in `raw_*`. On `"shift"`, `raw_* = stored`.
- Missing lunch row on a `"day"` save → subtract nothing, save succeeds
  normally, set `flagged_anomaly = true`, `anomaly_reason = 'day_total_no_lunch'`.
  **Silent to the entry device** — the response is an ordinary success.
- Any derived amount < 0 → `400 { code: "negative_after_lunch" }`.
- `weights.length !== peopleIds.length`, or any weight outside `(0,1]` →
  `400 { code: "bad_weights" }`. A missing `weights` key (old client) means all `1`.
- Missing `gratuity` → 0; missing `enteredScope` → `"shift"`; missing `note` → null.
- The anomaly check runs on the **derived shift amounts**, never the raw ones.
  Gratuity is not part of the anomaly rule.
- Weighted allocation (largest remainder, ties by position) is the canonical
  math in `web/src/lib/tips/split.ts` / `dayScope.ts`, mirrored into
  `supabase/functions/_shared/tips.ts` under the existing keep-in-sync
  comment convention.

## `save` / `get_slot` response — `SlotEntry` gains

```ts
{
  // ...existing fields unchanged...
  gratuity: number;              // derived shift figure
  enteredScope: "shift" | "day";
  rawCash: number;
  rawCard: number;
  rawGratuity: number;
  note: string | null;
  people: { id: string; weight: number }[];  // weight in (0,1]
}
```

## Schema (backend owner)

As specified in HANDOFF-tips-v3.md §Schema, verbatim:
- `tip_entries` + `gratuity_amount`, `entered_scope` ('shift'|'day', default
  'shift'), `raw_cash_amount`, `raw_card_amount`, `raw_gratuity_amount`,
  `note` (≤280, trimmed, null when empty), `note_at`.
- `tip_entry_people` + `share_weight numeric(4,3) not null default 1`,
  check `(0,1]`.
- `tip_save_entry`: extend the 13-arg version from
  `20260811204219_tip_entry_session_duplicate_guard.sql` (drop + recreate,
  re-issue revoke/grant). New params: `p_gratuity numeric`,
  `p_entered_scope text`, `p_raw_cash numeric`, `p_raw_card numeric`,
  `p_raw_gratuity numeric`, `p_note text`, `p_weights numeric[]` (positional
  against `p_people`, same length or raise).
- Existing rows backfill to defaults ⇒ behavior identical to today.

## Repo-alignment notes (from the codebase map, 2026-08-27)

Verified against the repo; the repo's existing shapes win. Alignments:

1. **`SlotEntry` keeps `peopleIds: string[]`** (existing field, `api.ts:46-60`
   and `tip-entries/index.ts` `loadSlot`). The new `people: {id, weight}[]` is
   **additive**; `peopleIds` stays populated for compatibility. Server derives
   `peopleIds` = `people.map(p => p.id)` as today.
2. **Wire money is decimal dollars** — matches existing `cash`/`card`
   convention in `SavePayload` and `SlotEntry`. Server normalizes via the
   existing `normalizeAmount()` in `_shared/tips.ts:211` (0 ≤ n < 100000,
   rounds to cents). Gratuity uses the same normalization.
3. **`today` extension** lands in `fetchToday()`
   (`tip-entry-auth/index.ts:65-80`), which today only reads `meal_period`.
   It must additionally read the lunch row's `cash_amount`, `card_amount`,
   `gratuity_amount` and surface them as `lunch: {cash, card, gratuity} | null`
   (decimal dollars). `get_slot` in `tip-entries` returns the same `today`
   shape — currently it returns only `businessDate`; it gains a `today` object
   or the `lunch` key alongside (backend owner picks; frontend reads
   defensively from either `state` or `get_slot`, preferring the freshest).
   **Decision: `get_slot` response gains `today` with the full shape above**,
   so a meal switch refreshes the lunch figures without a `state` round-trip.
4. **Anomaly**: check stays cash/card only (gratuity excluded per the locked
   decision — no third `field` literal in `anomaly.ts` or its mirror). It runs
   on the **derived** shift amounts. Stored history is always shift-only
   figures, so the history series stays consistent.
5. **`split_count`** stays `array_length(p_people, 1)` — headcount, not
   weight-sum. Nothing overloads it.
6. **Error envelope** matches existing style: `{ ok: false, code, error }` with
   HTTP 400 for `negative_after_lunch` and `bad_weights`; the human `error`
   strings are the backend owner's choice but must be register-appropriate.
   The existing `needsConfirm` anomaly flow (status 200) is unchanged and runs
   on derived amounts *after* the day-scope subtraction and negative check.
7. **`gratuity_amount` check**: foundation table uses `>= 0` checks on
   cash/card; the new columns get the same non-negative checks for the stored
   (derived) figures; `raw_*` are nullable, populated on every new save.
8. **Trend/totals**: `rangeTotals` and `dailyTrend` remain cash+card only —
   gratuity is its own bucket and is *not* added to trend or totals (locked:
   recorded, shown in detail, exported).
9. **Old-client window**: `tip-entries` `save` currently requires `cash`,
   `card`, `peopleIds` — new fields are read with defaults exactly as in the
   rules above, so the currently deployed web build keeps saving unchanged
   rows (`entered_scope='shift'`, `gratuity=0`, weights all 1, `raw_* = typed`).

## Agreed amendments (Sol's review, 2026-08-27)

1. **The 13-arg `tip_save_entry` stays as a compatibility wrapper.** The
   migration creates the new extended function AND recreates the 13-arg
   signature as a service-role wrapper that delegates with v3 defaults
   (gratuity 0, scope 'shift', raw_* = typed, unit weights, no note) — the
   currently deployed edge function keeps working until the functions deploy.
   Both signatures get the revoke/grant treatment. The wrapper can be dropped
   in a later cleanup migration once the functions are live.
2. **Anomaly precedence on a no-lunch day save.** The `needsConfirm`
   round-trip comes ONLY from the statistical outlier check (on derived
   amounts) — the missing-lunch condition never prompts the closer. When both
   conditions hold, the saved row has `flagged_anomaly = true` and
   `anomaly_reason = 'day_total_no_lunch; ' + <statistical reason>` — the
   `day_total_no_lunch` token always first so the dashboard's flag detection
   can match on prefix. When only the lunch is missing, the reason is exactly
   `day_total_no_lunch`.
3. **Weights stay positional through server-side filtering.** The server
   filters/dedupes `peopleIds` (UUID regex, dedupe) — the `weights` array
   must be filtered in lockstep BEFORE any of that reshaping, so index i
   always refers to the same person.

## Sign-off

- [x] Backend (Codex/Sol): agreed with amendments 1–3 above.
- [x] Frontend (Claude/Fable): agreed, including amendments 1–3.
