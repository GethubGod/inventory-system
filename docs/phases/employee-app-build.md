# Build handoff — Employee app: checklist-first restructure (rev 3)

You are the build agent for this phase. This document is your ticket: precise about
outcomes and acceptance criteria, open about implementation. Read this whole file,
then `docs/employee-onboarding-redesign.md` (flow context),
`docs/phases/onboarding-auth-build.md` (the sibling phase — auth + manager controls,
already built on `feat/onboarding-auth`), `docs/ROADMAP.md` ("How to run a phase"),
and `ARCHITECTURE.md`. Then write your own implementation plan before editing.

## The one visual source of truth

David iterated three revisions on a fully interactive mockup and confirmed it:

- Artifact: https://claude.ai/code/artifact/c2b5c373-2d73-4dba-a767-7bd444e74904
- Repo copy (identical, open it locally): `docs/mockups/employee-app/index.html`
  (`.claude/launch.json` has an `employee-app-mockup` entry serving it on port 8022).

Click through it before writing code. Every behavior in it is intended: tap-to-check
rows, stepper +/- with the wide tap-safe middle, the quantity card, quick actions,
the shrinking pill, densities, categories toggle, note flow, receive flow, reorder
from History. Match it in structure and behavior; px-perfection is not required but
spacing discipline is (one 4px grid, no drift).

## Mission

Restructure the employee experience around the existing Phase 5a checklist:

1. Employee tabs become **Order / History / Settings**, rendered as a **floating
   pill toolbar** (detached, floats over content) instead of the attached tab bar.
   Home and Cart disappear for checklist-only employees.
2. The Order screen is the existing `SimpleOrderScreen` **restructured and
   recolored, not rewritten** — keep its services and data flow
   (`src/services/orderChecklist.ts`, `recentOrders`, `directSendFlow`,
   receiving, `VoiceAddSheet`), replace its chrome.
3. Quick actions, quantity card, display options, note, save-as-default (below).
4. Trimmed Settings + a compliance-complete Profile screen.

## Branch and baseline

- Check whether `feat/onboarding-auth` has been merged into `roadmap/integration`.
  If merged: branch `feat/employee-app` from `roadmap/integration`. If not: branch
  from `feat/onboarding-auth` (this phase depends on its module-default flip and
  colorway tokens). First command: `git log --oneline -5` to confirm your base.
- Reuse the tips-colorway tokens the sibling phase added to `src/theme/design.ts`
  (page `#F5F5F4`, card white, well `#EDEDEC`, hairline `rgba(0,0,0,.06)`, tint
  `#FBEAE7`, accent `#E8503A`). If they don't exist yet, add them once, named.

## Screen-by-screen spec

### Order tab (SimpleOrderScreen restructure)

Header: title "Checklist" top-left (24pt, bold); compact location pill top-right
(dot + short name + chevron, opens the existing location switcher). The four header
circle buttons are REMOVED — their functions move to Quick actions. Top spacing is
tight: status bar → header → list, no dead band.

List (both densities, per-user setting, persisted like `simpleOrderDensity` today):
- Comfortable: ~58pt rows, subtitle "unit · usually N", stepper pill right.
- Compact: ~40pt single-line rows; stepper pill is WIDE with quantity + unit
  side-by-side in the middle (`− 2 fillet +`), middle tap target ≥ 56pt wide.
- "Show categories" toggle (new setting): on = grouped under category labels;
  off = one flat list. Applies to both densities.
- "Rarely ordered (N)" section: **expanded by default**, tap header to collapse.
- Row tap toggles checked; +/- adjusts; tapping the middle (quantity) opens the
  **quantity card**.

Quantity card (bottom sheet): item name, "Usually N unit", unit segmented control
(the item's unit plus common alternates), big −/+ circles, editable center number
(decimal pad), quick chips `+1 +5 +10 Usual`, CTA "Set N unit". Changing the unit is
a per-line override on the order line — it must NOT mutate the inventory item's
admin-configured unit.

Pinned bottom stack (floating above the pill): optional note chip ("Note added ·
edit") → search results card when typing → the add-item bar (search field with mic
inside, red send circle with count badge; gray when 0). Send opens Review order.

Review order sheet: compact one-line rows — item name left (ellipsized), "qty unit"
right; ~40pt rows; note card shown when a note exists; CTA "Send N items". Subtitle
still flips between manager-review and direct-send wording per the user's send mode.

Quick actions (the pill's dots button, Order tab only):
- **Clear checklist** — uncheck everything, reset quantities to recommended. In the
  real build use an "Undo" toast rather than a confirm dialog.
- **Save checklist as default** — upsert the current checked items + quantities
  into the user's stored checklist (`order_checklist_items`, quantities into
  `recommended_qty`; unchecked items keep their rows). Toast "Saved as default ·
  N items".
- **Add note / Edit note** — free-text note attached to THIS send; travels with the
  order to manager review or into the direct-send message. If the send path has no
  note field today, add one additively (column or payload field) — check
  `orderChecklist`/send services first.
- **Checklist display** — Comfortable/Compact cards + Show categories toggle.
- **Receive delivery** — existing 7a flow.
- **Recent orders** — existing read-only sheet.
- Order reminder is NOT here — its editor (existing `OrderDayReminderSheet`) is
  reached from Settings → Order reminders.

### Floating pill toolbar (new shared component)

White pill, hairline border, soft shadow, detached from the bottom edge. Tabs:
Order (checklist icon), History (clock), Settings (person). Active tab gets tint
background + label; inactive tabs icon-only. On the Order tab (and receive screen) a
divider + dots button appends; on History/Settings the pill shrinks to just the
tabs. Employees with `ordering_advanced` on: the pill gains Advanced (and Cart)
tabs — the pill is driven by the same effective-modules state as today's tab
layout. (This is the assumed answer to the open Cart question — flag it in your
handback for David's confirmation.)

### History tab

Past sent orders (existing recent-orders data): card per order (receipt icon, date,
"N items · sent 9:14 AM"), Reorder button loads that order's items + quantities
into today's checklist and returns to Order.

### Settings tab (trimmed) + Profile

Settings: profile card (avatar initial, name, location · role) → Profile screen;
then: Order reminders (toggle + editor), Checklist display (same sheet), Contact
support, About and legal (privacy policy, terms, open-source licenses, version),
Sign out. Module-gated rows (e.g. Stock settings) appear only when the module is on.

Profile (App Store compliance set — all rows functional): Name (editable), Email
(optional, "for account recovery"), Location (read-only, "set by the manager"),
Change PIN or password, Privacy choices, **Delete account** (existing deletion flow,
kept working). Terms/Privacy link constants come from the sibling phase's config
module.

### Icons

No emoji glyphs anywhere. Ionicons via `@expo/vector-icons` first; purpose-built
`react-native-svg` components in `src/components/icons/` only where no glyph fits.
The mockup's drawn icons map to: checklist `list-outline`/custom, clock
`time-outline`, person `person-circle-outline`, dots `ellipsis-horizontal`, trash
`trash-outline`, bookmark `bookmark-outline`, note `create-outline` or
`document-text-outline`, sliders `options-outline`, cube `cube-outline`, bell
`notifications(-outline)`, mic `mic-outline`, send `arrow-up`, shield
`shield-checkmark-outline`, key `key-outline`, mail `mail-outline`, help
`help-circle-outline`.

## Backend (small, additive — do first, it unblocks nothing else)

1. Save-as-default: a service function (and RPC if RLS requires) that upserts the
   current selection into `order_checklists`/`order_checklist_items` for
   (user, location_group). Reuse existing upsert paths from the 5b dashboard editor
   if they fit.
2. Order note: additive field on the checklist-send path; surfaces in manager
   review (and appended to direct-send message bodies).
3. Per-line unit override: confirm order/checklist line rows carry a unit; if the
   unit is currently derived from the inventory item only, add an additive override
   column. No change to `inventory_items`.
4. Any migration: timestamped after every existing migration, additive only, proven
   with `scripts/local-db/verify-migrations.sh` + fixture. All previously-known
   migrations are already live in production — never re-apply, never deploy.

## Ground rules (same landmines as the sibling phase — do not skip)

- **Never push to `main`** (a main push production-deploys `web/` via Vercel).
- `supabase start` cannot bootstrap this repo; use the harness.
- `.expo/types/router.d.ts` is stale — cast `router.push` for new routes (pattern
  in `SimpleOrderScreen.tsx`).
- Tests: `npx jest --runInBand --watchman=false`
  (add `--testPathIgnorePatterns=/node_modules/` when running from a `/.claude/`
  worktree).
- Do not touch: `docs/mockups/tips-dashboard/*`, `web/src/app/{e,closer,pin}`,
  `web/src/components/entry*`, `web/src/components/manager/*`,
  `supabase/functions/tip-*`, `web/e2e/*`. Do not modify the auth/onboarding or
  manager screens from the sibling phase except where this spec requires wiring.
- Repo conventions: thin routes, feature code in `src/features/`, design tokens
  from `src/theme/design.ts`, Zustand selector rules, haptics via `@/lib/haptics`.
- No version-number changes (the 2.2→2.3 bump is a separate launch chore).

## Definition of done

- Typecheck, lint, full jest suite pass. New logic unit-tested: selection→default
  upsert mapping, unit override, note attach, pill tab derivation from modules,
  categories/density row derivation, clear-with-undo state.
- Migrations (if any) pass the harness with fixtures.
- Simulator recording/screenshots demonstrating: both densities (Compact showing
  12+ rows), categories on/off, quantity card set-20-and-switch-unit, quick
  actions incl. save-as-default and note-through-review, pill shrinking on
  History/Settings, reorder from History, receive flow, Settings + Profile
  compliance rows, and an employee with `ordering_advanced` on getting the wider
  pill.
- Existing flows unbroken: manager surfaces, direct-send queue, order-day
  reminders, stock check entry points, legacy tab layout for managers.
- Zero emoji glyphs. All new screens on the tips colorway tokens.
- Handback note: anything consciously left out, the Cart/Advanced-pill assumption
  for David to confirm, and any follow-ups for the order-interface polish round.
