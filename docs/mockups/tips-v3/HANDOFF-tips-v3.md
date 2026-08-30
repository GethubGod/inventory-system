# Handoff — Tips v3: gratuity, day-scope, partial shares, notes

You are implementing a finalized, approved design. **Do not redesign, do not
widen the scope, do not add features beyond this document.** Where this
document and the repo disagree about a *data shape*, the repo wins and you
flag it. Where they disagree about *product behavior*, this document and the
mockup win.

## The one artifact that is the truth

`docs/mockups/tips-v3/tips-v3-final.html` — **open it in a browser and click
through every state before writing a line of code.** It is live: the amounts
recalculate, the badges cycle, the note attaches, the ledger rows unfold.
Every number it prints is the number your build must print.

`docs/mockups/tips-v3/tips-v3-proposals.html` is the rejected-options archive.
**Do not build anything from it.** The four chosen options are A1, B1, C1, D2
and they are already merged into the final file.

Use the top-bar **lunch today** switch in the final mockup to see the
edge-case states (no lunch on record; subtraction going negative).

## Revision — read this first

The mockup was revised after the first review. If you have seen an earlier
version of this document or that file, re-read both. What changed:
the field is called **Gratuity** (never "auto-grat"), it is **not** tinted
green or anything else, all three amounts got an **underline** marking them
editable, the "These numbers are" label is **gone**, the no-lunch warning is
**no longer shown to the closer**, the note button says **Save**, and the
confirmation screen now **holds 10 seconds and returns to the scan gate**.

## What is being added

1. **Gratuity** — a third amount on the entry screen next to Cash and Card.
2. **Day-scope switch** — dinner can say "this Square number is the whole day",
   and the app subtracts what lunch already recorded.
3. **Partial shares** — a percentage badge per person on the split (100/75/50/25).
4. **Note** — one optional free-text note per entry.
5. **Recorded tips** — rows unfold to show all of the above.

## Locked decisions — do not revisit

- **No 18%-of-subtotal calculator.** The closer types the gratuity amount or
  leaves the well blank. Blank means `0`.
- **The field is called “Gratuity.”** Not "auto-grat", not "auto-gratuity", in
  the UI, the copy, or the CSV header. Column and payload names use
  `gratuity` to match.
- **Gratuity is its own bucket.** It is not added to `card_amount`, and it is
  **not** part of the cash pool that gets split. It is recorded, shown in the
  detail panel, and exported. (See "Confirm with David" #1.)
- **No tint on the gratuity well.** Cash, Card and Gratuity are visually
  identical. Do not add a color token for it — the earlier green is gone.
- **All three amounts get a rule under the value**, accent-red on focus. This
  is the only cue that they are typeable, so it ships with the feature rather
  than as polish. Note that `AmountWell` is shared with the voice sheet's
  inline editors — the underline will appear there too, which is correct.
- **The scope switch carries no label above it** and appears on dinner only,
  defaulting to **Whole day**.
  Lunch has no switch and always records what was typed.
- **Subtraction is field by field** — cash−cash, card−card, grat−grat — against
  today's recorded **lunch** row at the **same location**.
- **Shares are weighted, not capped.** Full share = `pool ÷ Σweights`. One
  person at 50% makes everyone else *larger*, not the pool smaller. Nothing is
  left in the drawer beyond sub-cent rounding. (See "Confirm with David" #2.)
- **The per-person list only renders when at least one weight is under 100%.**
  An all-full split shows only the strip: `Split N ways · $41.00 each`.
- **Weights apply to the cash pool only.** Card → payroll is untouched by them.
- **Voice entry is out of scope this phase.** "Speak it in" keeps filling
  cash / card / people exactly as it does today; the new fields stay typed. Do
  not change `tip-voice-parse`, `tip-voice-stream`, `voiceSchema.ts`, or
  `localVoiceParse.ts`.
- Visual language is unchanged: cream `#f5f5f4` page, white cards, accent
  `#e84d38`, existing tokens in `web/src/app/globals.css`. Add **no** new color tokens. The dark top bar and the "lunch today" switch in the mockup are
  mockup-only chrome — do not build them.

## Confirm with David before the migration lands

These are stated as assumptions so you are not blocked. Ask once, early, in one
message; build on the defaults meanwhile.

1. **Is the 18% already inside the Card number Square reports?** Default
   assumed: **no** — it arrives separately and is entered separately, so
   `cash + card + auto_grat` is the entry total with no double count. If it is
   actually inside the card figure, `gratuity_amount` becomes a carve-out that
   must be *excluded* from every total that already counts card.
2. **Reflow vs fixed cut** — default assumed **reflow** (weighted, as above and
   as the mockup shows). The alternative is a full share fixed at
   `pool ÷ heads` with the difference staying in the drawer.
3. **Who may set a partial share** — default assumed **the closer, at entry**
   (that is what the mockup does), with the manager able to change it in Fix.
4. **A missing lunch on a whole-day dinner** — **decided: say nothing to the
   closer.** No banner and no extra tap; the entry saves flagged for the
   manager. Nothing at the register can fix it, so it is not the closer's
   problem to read. The *only* warning the entry screen ever shows is the
   blocking negative-amount one.

## Division of work

The seam is the **JSON contract** in the section below. Agree on it in writing
before either side starts, then work in parallel.

### Codex — backend

- `supabase/migrations/<timestamp>_tips_v3_grat_scope_weights_notes.sql`
- `supabase/functions/tip-entries/index.ts` (`save`, `get_slot`)
- `supabase/functions/tip-entry-auth/index.ts` (`state`)
- `supabase/functions/_shared/tips.ts` (mirror of the pure helpers)
- RLS for the manager's direct-update path (the Fix dialog writes
  `tip_entries` / `tip_entry_people` under RLS, not through the RPC)
- Regenerating `web/src/types/database.ts`

### Claude — frontend

- `web/src/lib/tips/split.ts`, new `web/src/lib/tips/dayScope.ts` — the
  **canonical** pure math plus its vitest coverage. Codex mirrors these into
  `_shared/tips.ts`; the "keep both in sync" comment convention already used
  for `anomaly.ts` / `businessDate.ts` applies here too.
- `web/src/lib/tips/api.ts` — payload and state types
- `web/src/components/entry/` — `EntryForm.tsx`, `RosterChips.tsx`,
  `SplitStrip.tsx`, plus new `ScopeSwitch.tsx`, `PayoutList.tsx`, `NoteField.tsx`
- `web/src/components/manager/dashboard/LedgerPage.tsx` — D2 rows, detail
  panel, and the extended Fix dialog
- `web/src/lib/tips/dashboardDerive.ts`, `dashboardCsv.ts`
- vitest units + the playwright e2e additions

Neither side edits the other's files. If you believe you must, say so and get
agreement first.

## Schema

```sql
alter table public.tip_entries
  add column gratuity_amount   numeric(10,2) not null default 0,
  add column entered_scope      text not null default 'shift'
      check (entered_scope in ('shift','day')),
  add column raw_cash_amount    numeric(10,2),
  add column raw_card_amount    numeric(10,2),
  add column raw_gratuity_amount numeric(10,2),
  add column note               text,
  add column note_at            timestamptz;

alter table public.tip_entry_people
  add column share_weight numeric(4,3) not null default 1
      check (share_weight > 0 and share_weight <= 1);
```

- `raw_*` is **always** populated with what the closer typed. On
  `entered_scope = 'shift'` they equal the stored amounts; on `'day'` they are
  the pre-subtraction figures. The dashboard shows its work from these.
- `cash_amount` / `card_amount` / `gratuity_amount` are **always** the
  shift-only figures. Nothing downstream needs to know about scope to be right.
- `note` ≤ 280 characters, trimmed, `null` when empty. `note_at` set whenever
  the note text changes. The note's author is displayed from `entered_by`.
- `share_weight` is one of `1, 0.75, 0.5, 0.25` today; the column allows any
  value in `(0,1]` so a future custom percentage does not need a migration.
- `split_count` stays as-is (the count of people). Do not overload it.
- Every existing row backfills to the defaults, which reproduces exactly
  today's behavior — verify that on a branch before merging.

`tip_save_entry` changed signature, so it must be dropped and recreated. The
**current** definition is in `20260811204219_tip_entry_session_duplicate_guard.sql`
(the 13-arg version with `p_session_id`) — extend that one, not the original in
the foundation migration, and re-issue the `revoke`/`grant` lines for the new
signature. New parameters: `p_gratuity numeric`, `p_entered_scope text`,
`p_raw_cash numeric`, `p_raw_card numeric`, `p_raw_gratuity numeric`,
`p_note text`, `p_weights numeric[]`. `p_weights` is positional against
`p_people` and must be the same length; raise if it is not.

## The JSON contract

**The client sends what the closer typed; the server does the subtraction.**
The server is authoritative — a stale client must never be able to write a
figure derived from a lunch amount that has since changed.

`tip-entry-auth` → `state`, and `tip-entries` → `get_slot`, both gain today's
recorded lunch on `today`:

```ts
today: {
  businessDate: string;
  lunchRecorded: boolean;
  dinnerRecorded: boolean;
  defaultMeal: MealPeriod;
  lunch: { cash: number; card: number; gratuity: number } | null; // NEW
}
```

`lunch` is `null` when nothing is recorded — that is the case that drives the
amber warning and the flag. Read it defensively on the client (`?? null`) so an
older server degrades to "no subtraction available".

`tip-entries` → `save` payload gains:

```ts
interface SavePayload {
  meal: MealPeriod;
  cash: number;          // as typed
  card: number;          // as typed
  gratuity: number;      // as typed, 0 when blank        NEW
  enteredScope: "shift" | "day";                       // NEW
  peopleIds: string[];
  weights: number[];     // positional against peopleIds  NEW
  note: string | null;                                  // NEW
  entryMethod: "typed" | "voice";
  voiceVariant: VoiceVariant | null;
  correctionsCount: number;
  confirmAnomaly: boolean;
}
```

Server-side rules on `save`:

- `enteredScope === "day"` → subtract today's lunch row field by field. Missing
  lunch row → subtract nothing, set `flagged_anomaly = true` and
  `anomaly_reason = 'day_total_no_lunch'`. **This flag is silent to the entry
  device** — the save succeeds normally and the closer sees the ordinary
  confirmation. It surfaces only in Recorded tips.
- Any derived amount `< 0` → reject `400` with
  `{ code: "negative_after_lunch" }`. The client disables Save on this state,
  but the server must not depend on that.
- `weights` must be the same length as `peopleIds`, each in `(0,1]`, else `400`
  `{ code: "bad_weights" }`. A missing `weights` array (old client) means all
  `1`.
- **The anomaly check runs on the DERIVED shift amounts**, never the raw ones —
  otherwise every whole-day dinner looks like an outlier. Gratuity is not part
  of the anomaly rule.
- Absent new fields default to today's behavior: `gratuity = 0`,
  `enteredScope = "shift"`, all weights `1`, `note = null`. An old client must
  keep working through the deploy window.
- `SlotEntry` in the response gains `gratuity`, `enteredScope`, `rawCash`,
  `rawCard`, `rawGratuity`, `note`, and `people: {id, weight}[]`.

## The math — canonical, with test vectors

Money is integer cents everywhere. Never accumulate in floats.

**Day scope.** `derived = typed − lunch[field]`, per field, only when
`scope === 'day'` and a lunch row exists.

**Allocation — largest remainder.** The shares must sum to the pool *exactly*.

```
raw_i   = poolCents × w_i / Σw
base_i  = floor(raw_i)
rest    = poolCents − Σ base_i
```

Distribute `rest` one cent at a time to the largest fractional parts, ties
broken by the person's position in the split. This replaces
`cashShareCents(cash, splitCount)` for weighted entries. Half-up rounding is
**wrong** here — it can pay out more than the pool.

Required test vectors (these are exactly what the mockup prints):

| Pool | Weights | Result |
|---|---|---|
| $205.00 | 1, 1, 1, 1, 0.5 | 45.56, 45.56, 45.55, 45.55, **22.78** — sums to 205.00 |
| $205.00 | 1, 1, 1, 1, 1 | 41.00 × 5 |
| $205.00 | 1, 1, 0.75, 1, 1 | full share $43.16; Priya $32.37 |
| $822.00 | 1, 0.25 | 657.60, 164.40 |
| $118.00 | 1, 1, 1 | 39.33, 39.33, **39.34** |

Invariants to assert as properties, not just examples: the shares always sum to
the pool; no share is negative; a pool of 0 gives all zeros; one person takes
everything; 30 people at mixed weights still sums exactly.

## Frontend behavior — exact

Read these against the mockup; the mockup wins on anything ambiguous.

**Entry screen, top to bottom:** header · location · Lunch|Dinner segmented ·
amounts card · roster card · per-person card (conditional) · split strip ·
note line · sticky bar.

- **Amounts card**: the scope segmented (`Whole day (Square)` / `Dinner only`)
  with **no label above it**, then a **three-column** grid of Cash · Card ·
  Gratuity. All three are the same `AmountWell` with the same neutral `--well`
  background — no tint on any of them. Gratuity's placeholder is `0.00`.
  Helper line: *"Leave gratuity blank on a night with no large parties."*
- **Editable affordance**: `AmountWell` gains a `1.5px` bottom rule under the
  `$ 000.00` line in `--color-disabled`, switching to `--color-accent` on
  focus-within, with `caret-color` accent. Read-only renderings of the same
  well (the saved screen) must **not** have the rule.
- **Receipt** under the wells: `Entered (whole day)` → `− Lunch already
  recorded` → `Dinner records`. The lunch line is hidden on `Dinner only`, and
  the first label switches to `Entered (dinner only)`.
- **Warnings**: exactly one. Any derived field negative → red banner **and
  `Save` disabled**. There is no amber state and no no-lunch banner.
- **Roster chips**: selected chips carry a `%` badge. Tapping the badge cycles
  `100 → 75 → 50 → 25 → 100`; tapping the chip body still toggles selection.
  The badge must be its own hit target — do not let a badge tap deselect the
  person. Give it a real touch target (≥ 28px) even though it renders small.
- **Per-person card**: renders **only** when some weight < 1. Title
  `What each person takes`; a row per selected person, `NN% share` caption on
  reduced ones, dollars right-aligned and tabular.
- **Split strip**: `Split N ways` + `$X each` when even; `Full share` + `$X`
  when uneven. Right side is always `of $Y cash`.
- **Note**: dashed `+ Add a note` → textarea (280 cap, live `n / 280` counter)
  → `Cancel` / **`Save`** (not "Attach"). Saving empty text collapses back to
  the dashed button. Saved shows a one-line truncated preview with `edit`.
- **Saved screen**: the same three wells as the entry form — Cash · Card ·
  Gratuity, same grid, same type scale, same labels — but read-only, so
  **without** the editable underline. Below them `full share $X` plus each
  reduced person's dollars, the names, and the note if present.
- **Saved screen timing**: it now holds **10 seconds**, not 4 —
  `SAVED_SCREEN_MS` in `EntryForm.tsx` goes `4000 → 10000`. Show a countdown
  ("Back to the scan screen in 10s") over a thin progress bar that drains, so
  the wait is legible rather than a hang. `Done` still skips it. At zero it
  runs the existing `finishSession()` path — end the session, return to the
  scan gate at `/`. Do not build a new scan screen; that route already exists
  ("Scan to enter" / "Every entry starts with the QR code by the register").
  The mockup reproduces it only so you can see where the phone lands.

**Recorded tips (D2):**

- Existing columns keep their existing order, widths and tints. Two additions
  only: a caret cell at the left, a note/action cell at the right.
- Cash cell gains a `day −lunch` badge when `entered_scope = 'day'`, with the
  raw figure in its `title`.
- "Split between" shows `N names` plus a `1 partial` mark when any weight < 1.
  "Per person" shows the full share with a `full share` caption — never a
  misleading average.
- Clicking a row unfolds three cards: **how this number was reached** (raw →
  −lunch → recorded, then card and gratuity), **who takes what** (name,
  weight, dollars, plus a Pool row that must equal the cash pool), and
  **note** (author + time, or "No note on this entry.").
- A flagged row auto-opens its detail when the range first loads.
- The **Fix dialog** gains gratuity, the scope switch, per-person weights and
  the note. It writes under RLS, not through `tip_save_entry` — keep the
  existing ordering (add people → update amounts → remove people) so no
  intermediate state is unrecoverable, and write weights with the people.
- **No gratuity column** on the table itself.
- `dashboardDerive.takeHomeByPerson` and the Overview ranking must use the
  weighted allocation. Leaving them on `cash ÷ split_count` is a silent
  money bug — treat it as part of this change, not a follow-up.
- CSV gains `Gratuity`, `Entered scope`, `Raw cash`, `Raw card`, `Note`, and a
  per-person weight; existing columns keep their position so old sheets do not
  break.

## Review protocol

1. Agree the JSON contract in writing. Nothing else starts before that.
2. Build in parallel. Each side runs its own checks green before handing over.
3. **Cross-review.** Codex reviews the frontend diff; Claude reviews the
   backend diff. Review against *this document and the mockup*, not against
   taste. Each finding gets: file:line, what breaks, and the concrete input
   that breaks it. Specifically hunt for:
   - a number the UI shows that the server would not store
   - float money anywhere
   - shares that do not sum to the pool
   - the anomaly check running on raw instead of derived amounts
   - an old client, or an existing row, behaving differently than before
   - `takeHomeByPerson` / CSV / Overview still assuming equal splits
4. Fix, then re-review until both sides sign off with nothing outstanding.
5. Only then run the joint verification below.
6. If the two of you disagree twice on the same point, stop and ask David
   rather than trading opinions a third time.

## Verification — all of it must pass

```bash
cd web && npm run typecheck && npm run lint && npm run test
```

New unit coverage (vitest, in `web/src/lib/tips/__tests__/`):
- `split.test.ts` — every vector and invariant in the math section
- `dayScope.test.ts` — day vs shift, missing lunch, negative, zero
- `dashboardDerive.test.ts` — weighted take-home, mixed weights across a range
- `dashboardCsv.test.ts` — new columns, quoting, column order

E2E (playwright, alongside `web/e2e/entry.spec.ts`):
- dinner entered as a whole day → receipt shows the subtraction → saved entry
  holds the derived amounts and the raw ones
- badge cycling changes the dollars and the per-person card appears
- all-100% split → per-person card absent, strip reads `Split N ways`
- note saved → survives a save → visible in Recorded tips
- no-lunch whole-day dinner → saves flagged **with no warning shown on the
  entry screen**
- saved screen holds ~10s, counts down, then lands on the scan gate; `Done`
  short-circuits it

Backend: apply the migration to a Supabase **branch**, not production. Prove
(a) existing rows still read identically, (b) the RPC rejects mismatched
weights, (c) a `day` save with no lunch flags rather than fails, (d) a negative
derived amount is refused, (e) the manager Fix path can write weights under
RLS and a non-manager cannot.

Manual pass, side by side with the mockup at the same viewport: every state in
the "lunch today" switch, the four badge values, empty gratuity, a 1-person
split, and an 8-person split.

## Branch, PR, deploy

- `git fetch origin` then branch off **`origin/main`** (local `main` is behind).
  One branch for both of you: `feat/tips-v3`. Do not push to `main`; open one PR.
- Deploy order is **migration → edge functions → web**. The backend is
  backward compatible by design, so the window where old clients are live is
  safe; the reverse order is not.
- Production: Supabase `whrohvitvmcrmedepurd`, Vercel project
  `inventory-system` (root `web`), serving tips.smelterpos.com and
  dashboard.smelterpos.com.

## Done means

- Every state in `tips-v3-final.html` reproduced in the real app, including the
  numbers to the cent.
- Typecheck, lint, unit and e2e green.
- Both reviews signed off with nothing outstanding.
- One PR, with a description that lists what changed and what David still has
  to confirm from the four questions above.
- Nothing from the rejected options file built. Voice untouched.
