# Babytuna Systems — Build Roadmap (Aug 2026, v2)

Purpose: phase-by-phase checkpoints for autonomous AI build sessions, each ending in a
reviewable deliverable David signs off on before the next phase starts.

## How to run a phase (read this first, agent)

This roadmap is **precise about outcomes, contracts, and acceptance criteria — and
deliberately open about implementation**. Phase specs are tickets, not scripts:

1. Start each phase by reading this doc, `ARCHITECTURE.md`, and the referenced code, then
   **write your own implementation plan** against the phase spec before editing anything.
   Plans made at execution time with live code context beat steps written weeks earlier.
2. Follow repo conventions (thin route files, design tokens, Zustand selector rules,
   haptics via `@/lib/haptics`, test expectations in `ARCHITECTURE.md`).
3. Stay inside the phase's scope. Non-goals are binding. Anything worth doing outside
   scope: note it at the end of the session for David, don't build it.
4. Sub-checkpoints (2a/2b…) are separate sessions with separate reviews.

## Definition of done (every phase)

- Typecheck, lint, and the test suite pass; new logic gets unit tests consistent with the
  repo's existing coverage patterns.
- Migrations are **additive only** (no destructive change to existing tables/data) and were
  applied cleanly to a local/branch database.
- Existing flows still work (app builds and runs; touched screens smoke-tested).
- UI phases end with screenshots or a short recording for David's review.
- The phase's acceptance list below is demonstrated, not just claimed.

## Safety rails

- **Dark launch:** until the module system exists (Phase 3), new user-facing surfaces ship
  behind an `app_config` kill switch (pattern: `quick_order_enabled`). From Phase 3 on, new
  employee-facing features are modules, default-off for employees.
- **Never remove the access-code path** until invites are proven in production (explicit
  David decision, not an agent call).
- **Parallel sessions** (e.g., phases 4 ∥ 5) must touch disjoint tables and edge functions;
  migration filename timestamps are ordered at merge time. One schema owner per phase.
- The tips web QR/device-session flow must keep working unchanged through every phase.

## Product decisions (locked 2026-08-07)

1. **Single-org now, seams for later.** Multi-tenancy was deliberately removed in March
   2026; it returns only as parked Phase B. All new tables/flows stay org-agnostic so an
   org column can be added mechanically (no new hard-coded org references outside one
   config module; org context via a single shared helper).
2. **Dashboard lives in both places.** `web/` Next.js app is primary; the mobile app keeps
   a minimal in-app mirror (module toggles, supplier contacts).
3. **Checklist data comes from both sources** — in-app `past_orders` stats AND screenshot
   AI import; both required before employee rollout (phases 5+6, reviewed jointly).
4. **Send flow is a per-employee toggle** (`direct` vs `review` queue).
5. **Suppliers are iMessage/SMS-first.** Rapid sending uses `sms:` deep links (recipient +
   body pre-filled); the iOS share sheet cannot pre-select recipients and is fallback only.
6. **Send All is Phase 1** — small, no dependencies, immediate daily win.
7. **Localization ships English + Simplified Chinese first**; user-set language,
   manager-set default; AI-translated item names with manager override.
8. **Stock check gets two counting views** — Virtual Shelf (spatial grid mirroring the
   physical shelf) and Checklist view, with a per-user toggle. Full spec in
   `docs/stock-check-proposal.md`.
9. **Delivery receiving ships as a deliberate placeholder** (check off what arrived vs.
   what was sent); customized later once real business needs emerge.
10. **Holiday ordering templates** are a manager-configured add-on to the checklist.
11. **No shared-device app mode** (rejected). Roster unification folds into Phase 4.

## Current-state facts the phases build on

- Auth: email/password + Google/Apple OAuth; role via shared 4-digit access codes (bcrypt
  in `org_settings`, edge fns `validate-access-code`/`update-access-codes`). Suspension +
  user management exist (`list-users`, `set-user-suspended`).
- Tab visibility is a binary role gate; no per-user flags. Global flags: `app_config`.
- Orders are already **split per supplier** in fulfillment (`buildSupplierConfirmationData`,
  per-supplier drafts, `finalizeSupplierOrder`) but sent via generic clipboard/share sheet;
  `suppliers` has **no contact columns**.
- History: `orders`/`order_items` → archived to `past_orders`/`past_order_items`;
  `inventory_items.supplier_id` exists.
- Reminder/push infra exists (`reminders`, `recurring_reminder_rules`, `send-reminder`,
  `device_push_tokens`).
- Tips web app **built but unmerged** on `feat/tips-web-app` (`web/` app + `tip_*`
  migration + 4 edge fns). Supabase project is paused → manual restore required.

---

## Phase 0 — Merge & deploy foundation (small)

**Blocker first: David restores the paused Supabase project** — everything else waits on it.

- Finish and merge `fix/quick-order-multiline-parsing` (working tree has uncommitted
  changes + untracked fulfillment-eligibility tests).
- Merge `feat/tips-web-app` into `main`.
- `supabase db push`; deploy all edge functions (incl. tips); regenerate
  `web/src/types/database.ts`; deploy `web/` to Vercel; seed entry tokens/PINs.

**Accept:** tip entry works end-to-end in production (QR → entry → manager dashboard);
app builds and runs; `main` contains both branches.

## Phase 1 — Rapid Send All + per-supplier send targets

Goal: an order day's supplier messages sent in seconds, share sheet eliminated.

- Schema: `suppliers` contact fields (phone, channel `sms | whatsapp | share_sheet`,
  optional contact name/notes).
- In-app manager settings: supplier contacts editor (dashboard editor comes in Phase 2).
- **Send All** in fulfillment: queue of per-supplier order cards — full message preview +
  one "Send to {supplier}" button → `sms:` deep link (recipient + body pre-filled) → on
  return to app, auto-advance to the next card. Per-card fallbacks: copy / share sheet /
  skip. Orders archive exactly as today.
- Handle iOS `sms:` body-separator quirks (`?body=` vs `&body=`) via expo-linking; verify
  on a real device.

**Non-goals:** no automatic sending, no supplier replies handling, no dashboard UI.
**Accept:** real order day — every configured supplier message lands in the correct
Messages thread pre-typed; full run takes well under a minute of taps; unconfigured
suppliers fall back to share sheet; orders archived.

## Phase 2 — Dashboard shell + team, then invites

### 2a — Shell + Team page (existing capabilities only)

- Dashboard nav shell (Team, Suppliers, Ordering setup, Tips, Analytics-later) using the
  existing manager Supabase auth in `web/`.
- Team page: roster, roles, suspend/unsuspend (reuse `list-users`, `set-user-suspended`).
- Suppliers page: contact editor (same data as Phase 1's in-app config).

**Accept:** manager signs into the dashboard, sees the real roster, suspends/unsuspends a
test user, edits a supplier phone number that Phase 1 then uses.

### 2b — Invite links end-to-end

- `invites` table (token, invited name, role, module preset, expiry, created_by, used_at)
  + edge fns `create-invite` / `revoke-invite` / `accept-invite`.
- Team page: create invite → personalized link. Public `/join/[token]` page: greets
  invitee by name, setup instructions, App Store link, `babytunasystems://join?...` deep
  link. App signup accepts the token and skips the access code.

**Non-goals:** access codes stay fully functional; no email-sending infrastructure (links
are shared manually by the manager).
**Accept:** invite created on dashboard → link opened on a phone → account exists with
intended role; used/expired/revoked tokens all rejected with clear messaging.

## Phase 3 — Per-user module toggles (tabs)

- `user_modules` (user_id, module_key, enabled, updated_by) + role defaults; manager-write
  RLS. Keys: `ordering_simple`, `ordering_advanced`, `stock_check`, `tips`, manager-side
  `fulfillment`.
- App `(tabs)` renders from module access with realtime updates. Existing Quick Order
  renamed **"Advanced ordering (Beta)"** behind `ordering_advanced`.
- Web: per-user toggle matrix; invite flow (2b) presets modules. In-app mirror: toggles in
  the existing manager user-management screen.

**Accept:** flipping a dashboard toggle adds/removes the tab on the employee's phone
without reinstall or re-login; role defaults apply to fresh accounts.

## Phase 4 — Tip entry in the app

### 4a — Native entry (typed)

- Tips tab (gated by `tips` module): location × meal period, cash + card, roster name-tap
  split. Extend tip edge fns to accept Supabase-authenticated users alongside
  device-session tokens.

**Accept:** tips entered in-app appear in the web manager Entries tab with correct
attribution; anomaly flags fire; web QR flow untouched.

### 4b — Voice + roster unification

- Voice entry reusing the pause-chunked parse pattern (`tip-voice-parse`).
- Link `tip_employees` ↔ app `profiles`: one identity per person across tips attribution,
  invites, modules, analytics.

**Accept:** voice entry fills the tip form correctly; roster shows one identity per person.

## Phase 5 — Simplified Inventory Ordering

### 5a — Core checklist (backend + screen, review-queue sends)

- `order_checklists` + `order_checklist_items` (per employee; default-checked, recommended
  qty, staleness bucket). Generation v1 from `past_orders` frequency + typical quantities.
- One-screen module: frequent items pre-checked with editable quantities; rarely-ordered
  section at the bottom; "add more" search; **Send Order** + confirmation sheet; sends go
  to the fulfillment queue (`submit_order_rpc`) in this checkpoint.

**Accept:** a checklist auto-generated from a real employee's history looks right to
David; the employee completes an order on one screen in ~2 minutes; it lands in
fulfillment.

### 5b — Direct send + editors

- Per-employee send mode (`direct` | `review`); `direct` → per-supplier `sms:` deep links
  (Phase 1 flow) + archive. Past sent orders visible on the checklist screen.
- Web: checklist editor per employee (items, default-checked, quantities) + send-mode
  toggle.

**Accept:** both send modes verified end-to-end; dashboard edits show up on the phone.

### 5c — Order reminders + notification hardening

- Scheduled order-day reminders tied to checklist state ("Fish order due today — 3 items
  unchecked") on existing reminder infra; reliability pass on push delivery (token
  refresh, delivery logging).

**Accept:** reminder fires on schedule on a real device with correct unchecked count;
delivery is logged.

## Phase 6 — Checklist enrichment

### 6a — Screenshot parse spike (go/no-go, cheap)

- Before building any UI: run real order screenshots through a Gemini parse prototype
  (script or scratch edge fn); measure item/quantity extraction accuracy against ground
  truth; test fuzzy matching to `inventory_items` via the existing alias infra.

**Accept:** a short written result — accuracy numbers, failure modes, recommended prompt/
model approach. David decides go/adjust before 6b.

### 6b — Screenshot import (full)

- Dashboard multi-image upload → Storage → parse edge fn → match → review screen for
  unmatched items (nothing silently dropped) → confirmed imports merge into checklist
  stats alongside 5a generation.

**Accept:** ~2 months of real screenshots upload, parse, and produce a checklist David
agrees matches reality. (Phases 5+6 jointly = "both sources" — joint review before
employee rollout.)

### 6c — Holiday ordering templates

- Manager-configured holiday templates (builds on the `qo_holiday_overrides` concept):
  named template + date window → checklist shows a "Holiday: New Year's" banner with
  adjusted/additional pre-checked items and quantities.

**Accept:** manager sets up a holiday template on the dashboard; during its window the
employee checklist reflects it; outside the window it doesn't.

## Phase 7 — Receiving & invoices

### 7a — Delivery receiving (deliberate placeholder)

- When an order arrives: "check off what showed up" screen against the sent order;
  discrepancies (missing/short items) flagged and stored, visible to the manager.
- Kept intentionally simple — real workflow customization waits for observed business
  needs.

**Accept:** receiving a real delivery against a sent order takes under a minute; a shorted
item is flagged and visible on the manager side.

### 7b — Invoice photo reconciliation

- Snap the supplier invoice → AI extracts line items/prices → compared against the sent
  order: price changes and quantity mismatches flagged. Extracted prices seed a
  per-supplier price history.

**Accept:** a real invoice photo reconciles against its order; a deliberate mismatch is
caught; price history records the invoice prices.

## Phase 8 — Localization (English + Simplified Chinese)

- i18n infrastructure (string extraction) for employee-facing screens first; per-user
  language setting + manager-set default (dashboard).
- `item_translations` (item_id, lang, name): AI auto-filled, manager-overridable on the
  dashboard. Checklist, cart, stock check, and previews show translated names; supplier
  messages stay in English.

**Accept:** an employee switches to Chinese and completes the checklist order entirely in
Chinese with correctly translated item names; supplier message still sends in English.

## Phase 9 — Stock Check revamp

Full spec: `docs/stock-check-proposal.md`.

- **9a (core):** guided walk-through (checklist view, shelf order), fast entry (numpad /
  Full-Low-Out), par levels + reorder points, **"start order from this check"** feeding
  the Phase 5 checklist.
- **9b (polish):** Virtual Shelf view (spatial grid mirroring the physical shelf) + 2D
  grid dashboard editor + view toggle, voice counting, recurring schedules + assignment +
  reminders, variance review, offline-first hardening.

**Accept (9a):** a non-manager completes a full store check; suggested order matches what
the manager would order by eye. **(9b):** virtual shelf layout matches the real shelf;
toggle persists; a check survives airplane mode mid-walk.

## Phase 10 — Usage analytics + weekly digest

- Lightweight `app_events` instrumentation (screen opens, orders sent, tips entered, voice
  use) — batched, no PII beyond user_id.
- Dashboard Analytics: per-user last-active + weekly activity, orders per module, AI token
  spend (`parser_usage_log` + `app_config` budgets).
- **Weekly digest** push to managers: orders sent, tip totals, anomalies, price changes
  (7b), inactive users, overdue stock checks — linking to the dashboard.

**Accept:** instrumentation verified immediately (events land as actions happen; digest
fires on schedule). **Soak review** (~1 week of real use, non-blocking for later phases):
numbers match reality.

## Parked A — True auto-send relay

For fully automatic supplier sends (no human tap), iMessage/SMS options ranked:

- **Twilio-style virtual SMS number (recommended if ever needed):** edge-function sends,
  fully automatic. ~$1/mo + ~$0.01/msg. Trade-offs: unfamiliar number for suppliers
  (green bubble, needs a heads-up), US A2P 10DLC registration (days–weeks), replies need
  routing (webhook → dashboard / forward to manager).
- **Always-on Mac iMessage bridge** (BlueBubbles-style, business Apple ID): true iMessage,
  no per-message cost; hardware to babysit, fragile across macOS updates, Apple ToS gray.
- **WhatsApp Business Cloud API:** only if suppliers move to WhatsApp.
- **Carrier email-to-SMS gateways:** being shut down; not viable.

Reality check: Phase 1's one-tap flow captures ~95% of the savings with zero infra and
messages come from the manager's own number. Build a relay only if remaining friction
proves to matter.

## Parked B — Multi-organization

Trigger: a second business actually committed. Re-introduce `organizations` + memberships,
org_id + RLS, org context in dashboard/invites, onboarding. Phases 1–10 follow the
multi-org seams (see Product decisions #1), making this mechanical.

## Sequencing / parallelism

0 → 1 → 2a → 2b → 3 → (4 ∥ 5) → 6 → 7 → 8 → 9 → 10.

- Phases 4 and 5 are independent after Phase 3 → parallel sessions in separate worktrees
  (disjoint tables; see Safety rails).
- Phase 8 (i18n) can run parallel to 6–7 if desired.
- Phase 10's soak review doesn't block anything.
