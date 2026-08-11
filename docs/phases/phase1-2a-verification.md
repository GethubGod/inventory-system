# Phase 1 + 2a independent verification — roadmap/integration

Verifier: independent agent, 2026-08-11. Branch `roadmap/integration` at `efebab0`,
compared against `origin/main` (`6f004f8`). All findings derived from code, not
builder claims. No code was modified; this file is the only write.

Context caveat: the working tree contained uncommitted Phase 2b work-in-progress
(untracked `supabase/migrations/20260812100000_invites.sql`, `supabase/functions/{create,accept,revoke}-invite/`,
`supabase/functions/_shared/invites.ts`, modified `supabase/config.toml`) from a
parallel session. None of it is in HEAD and none of it affects the checks below
(app typecheck/jest and the web build do not compile those paths).

---

## 1. Build & test runs (verbatim tails)

### `npm run typecheck` — exit 0 (PASS)

```
> babytuna@2.2 typecheck
> tsc --noEmit
```

(no output = clean)

### `npm run test:ci` — exit 0 (PASS)

```
Test Suites: 1 skipped, 36 passed, 36 of 37 total
Tests:       14 skipped, 738 passed, 752 total
Snapshots:   0 total
Time:        3.487 s, estimated 4 s
Ran all test suites.
```

(The console noise above the summary is a pre-existing react-test-renderer
`act()` warning in `quickOrderComposerPills.test.ts`, not a failure.)

### `cd web && npm ci --silent` — exit 0 (PASS)

### `cd web && npm run build` — exit 0 (PASS)

```
✓ Compiled successfully in 2.4s
  Running TypeScript ...
  Finished TypeScript in 1922ms ...
✓ Generating static pages using 13 workers (14/14) in 213ms

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /closer
├ ○ /dashboard
├ ○ /dashboard/ordering
├ ○ /dashboard/suppliers
├ ○ /dashboard/team
├ ○ /e
├ ○ /entry
├ ○ /manager
├ ○ /manager/qr
└ ○ /pin
```

### `cd web && npx vitest run` — exit 0 (PASS)

```
 Test Files  6 passed (6)
      Tests  64 passed (64)
   Duration  145ms
```

### `scripts/local-db/verify-migrations.sh` — NOT RUN

`scripts/local-db/` does not exist in the repo (`ls: scripts/local-db: No such
file or directory`). No migration-verification script anywhere under `scripts/`.

---

## 2. Phase 1 — Rapid Send All

### 2.1 Archive path is exactly `finalizeSupplierOrder`, semantics unchanged — PASS

- `git diff origin/main..HEAD -- src/store/orderStore.ts app/(manager)/fulfillment-confirmation.tsx`
  is **empty**: the store's archive machinery and the confirmation screen are
  byte-identical to main.
- The only archive call in the new flow is
  `src/features/fulfillment/sendAll/SendAllScreen.tsx:296` (`finalizeSupplierOrder({...})`),
  with a payload shape mirroring the confirmation screen's
  (`buildFinalizePayloadFromItems`, fulfillment-confirmation.tsx:227); the mirror is
  unit-tested (`src/__tests__/sendAllMessage.test.ts:148` "mirrors the
  confirmation-screen payload shape", `:196` dedup/zero-qty filtering).
- Empty-consumed-ids guard before finalizing (SendAllScreen.tsx:285-294) mirrors
  the confirmation screen's "Finalize Blocked" guard.

### 2.2 SMS cancel does NOT archive — PASS (iOS), NEEDS-DEVICE (Android)

- Preferred path `SMS.sendSMSAsync` (SendAllScreen.tsx:428): `result === 'cancelled'`
  dispatches `send-cancelled` and returns **without** calling `completeSend`
  (SendAllScreen.tsx:429-432). Card stays pending. Correct.
- **Finding (minor, NEEDS-DEVICE)** — SendAllScreen.tsx:428-434: on Android,
  `expo-sms` `sendSMSAsync` resolves with `result: 'unknown'` regardless of
  whether the user actually sent, and `'unknown'` falls through to
  `completeSend(...)` → the order archives even if the user cancelled the
  compose sheet. Platform API limitation, not detectable in code; verify
  intended behavior on an Android device (iOS reports cancel correctly).
- **Noted (by design)** — deep-link fallback (`sms:`/`whatsapp` URLs): after
  `Linking.openURL`, the AppState listener (SendAllScreen.tsx:348-362) finalizes
  on the next `active` event whether or not the user sent the message. Deep
  links have no completion callback; the ROADMAP explicitly specifies
  "on return to app, auto-advance", so this matches spec — but a user who
  backs out of Messages without sending still gets that supplier archived.

### 2.3 Skip does NOT archive — PASS

`handleSkipPress` (SendAllScreen.tsx:498-505) only dispatches the `skip` queue
event; no finalize call on any skip path. Reducer marks `skipped` and advances
(sendAllQueue.ts:92-105). Skipped cards are excluded from the "sent" count.

### 2.4 Share / copy fallback vs. pre-existing confirmation flow — PASS (flow), FINDINGS (message text, below)

- Share: `handleShareFallback` (SendAllScreen.tsx:364-384) starts
  `finalizeCard(card,'share')` in parallel with `Share.share`, exactly mirroring
  `handleShareOrder` (fulfillment-confirmation.tsx:2931-2962), including
  finalizing even when the share dialog is dismissed — same semantics as today.
- Copy: `handleCopyPress` (SendAllScreen.tsx:471-483) copies then always
  finalizes, mirroring `handleCopyToClipboard`
  (fulfillment-confirmation.tsx:2964-2983).

### 2.5 Message-builder diff (`sendAllMessage.ts` vs confirmation screen) — divergences found

The structural pipeline (sushi→poki sections, `--- SUSHI ---` headers, grouped
line merging by `name|unitType|unitLabel` key, `[set qty]` placeholders,
`{{supplier}}/{{date}}/{{items}}` template fill, `\n` unescaping, dev-only
"reported" assertion) matches line-for-line. Four divergences that can change
message text:

1. **Unit-label source (major)** — the confirmation screen resolves the printed
   unit label through `resolveUnitSelectorProps`
   (fulfillment-confirmation.tsx:399-404), where `inventory_items.base_unit`/
   `pack_unit` **take precedence over the order item's own `unitLabel`**, and
   uses that resolved label in the message even with no per-item unit switching
   (fulfillment-confirmation.tsx:1581-1584, 1599-1604). `sendAllMessage.ts`
   (buildSendAllItemsText, lines 103-131) prints raw `item.unitLabel`. Whenever
   an inventory item's canonical unit label differs textually from the label
   stored on the order item (e.g. "pcs" vs "pc"), Send All and the confirmation
   screen produce different label text — and because the grouping key includes
   the label (fulfillment-confirmation.tsx:1558 vs sendAllMessage.ts:93), lines
   can merge differently. Note the confirmation screen's own output shifts once
   its async `unitInfoMap` fetch lands; Send All (which never fetches unit
   info) matches only the pre-fetch output. The card preview is exactly what is
   sent, so the flow is self-consistent — the divergence is purely vs. what the
   per-supplier confirmation screen would have produced for the same items.
2. **Blank unit label fallback (minor)** — confirmation falls back to
   `'unit'`/`'pack'` for empty labels (fulfillment-confirmation.tsx:399);
   `sendAllMessage.ts` renders an empty string.
3. **Unresolved-remaining placeholder label (minor)** — confirmation prints the
   resolved `targetUnitLabel` in `- name: [set qty] <label>`
   (fulfillment-confirmation.tsx:1624); sendAll prints raw `item.unitLabel`
   (sendAllMessage.ts:122). Low impact: Send All blocks sending while any
   remaining item is unresolved (Send button replaced by "Review & Set
   Quantities", SendAllScreen.tsx:771-796; Copy/Share disabled at 828-840), so
   this text only appears in the on-screen preview, never in a sent message.
4. **Sort tie-breaks (minor)** — confirmation sorts name → inventoryItemId →
   unitType → unitLabel (fulfillment-confirmation.tsx:1337-1344); sendAll sorts
   by name only (sendAllMessage.ts:74-75). Two same-named items can appear in a
   different order.

### 2.6 Auto-advance cannot double-finalize — PASS

- The `SMS.sendSMSAsync` path never dispatches `send-launched`/`awaitReturn`
  (SendAllScreen.tsx:423-434), so `awaitingReturnId` stays null and the
  AppState listener (348-362) no-ops when the compose sheet closes — the
  completion result and the AppState event cannot both finalize.
- Deep-link path: `finalizeInFlightRef` (SendAllScreen.tsx:281-282) makes
  concurrent `finalizeCard` calls return false, and the queue reducer only
  transitions `pending → sent` (`send-completed` on a non-pending card is a
  no-op, sendAllQueue.ts:70-75; unit-tested at sendAllQueue.test.ts:97).
  Worst-case double `active` events: second call fails fast, dispatches
  `send-cancelled` (clears the flag only), first call's `send-completed` lands.
  No path finalizes the same card twice.
- Focus-refresh (SendAllScreen.tsx:229-258) marks cards completed only via the
  queue event when their pending items vanished server-side — no finalize call.
- **Finding (minor)** — SendAllScreen.tsx:275-330 (`finalizeCard`) omits the
  confirmation screen's best-effort staleness pre-check
  (fulfillment-confirmation.tsx:2714-2749 re-queries `order_items` and aborts
  if any consumed id is no longer `pending`). If another device finalizes the
  same supplier between card load and tap, Send All will re-archive (duplicate
  `past_orders` entry). Mitigated by the focus-refresh, but there is no
  pre-finalize freshness check on the tap itself. Repro: two devices on the
  same fulfillment queue; device A finalizes supplier X from confirmation;
  device B, already sitting on Send All card X, taps Send.
- **Finding (minor, cosmetic)** — SendAllScreen.tsx:357 and :433 record
  `shareMethod: 'share'` in history for sends that actually went out via
  SMS/WhatsApp. Metadata only; archive semantics unaffected.

### 2.7 Unconfigured suppliers fall back to share sheet — PASS

- No contact row / no phone / channel `share_sheet` → `handleShareFallback`
  (SendAllScreen.tsx:417-418, 455).
- `buildSupplierSendUrl` returns null for `share_sheet` or unusable phone
  (supplierSendLink.ts:30-32) and both deep-link branches fall back on null
  (SendAllScreen.tsx:436-442, 445-452); `canOpenURL` false and `openURL` throw
  also fall back (386-408).
- Unknown DB channel values normalize to `share_sheet`
  (supplierContacts.ts:26-32); contact-load failure degrades to all-share-sheet
  (SendAllScreen.tsx:194-199); the card badge falls back to "Share sheet" when
  a channel is set but the phone is missing (SendAllScreen.tsx:527-530).

### 2.8 URL builder (`+`, newlines, separators) — PASS code-side, NEEDS-DEVICE for the iOS quirk

`src/services/supplierSendLink.ts`: strips spaces/dashes/parens, keeps leading
`+` (lines 10-24); iOS `&body=` / Android `?body=` (line 40) per contract;
`encodeURIComponent` encodes newlines as `%0A` (preserved); WhatsApp uses
digits-only phone (line 37). All five behaviors unit-tested with exact-string
assertions (`src/__tests__/supplierSendLink.test.ts`, 5 tests, passing).
ROADMAP requires verifying the iOS separator quirk **on a real device** — that
cannot be established from code: NEEDS-DEVICE.

### 2.9 Migration `20260812090000_supplier_contact_fields.sql` — PASS

Matches the Phase 1 contract SQL verbatim. Additive-only (`alter table ... add
column if not exists` × 4, no drops/renames/type changes). Valid Postgres
(NOT NULL + constant default is a fast metadata-only add). Check constraint
enumerates exactly `('sms','whatsapp','share_sheet')`, matching the TypeScript
union. `web/src/types/database.ts` diff is additive-only (the 4 columns,
`contact_channel: string` required on Row, optional on Insert/Update —
consistent with NOT NULL DEFAULT). Standard `if not exists` caveat (the check
would not attach if the column pre-existed) is moot: no prior
`contact_channel` in schema history. Could not run against a live stack
(no verify script, Supabase MCP unauthenticated in this session) —
apply-on-stack: NEEDS-LIVE-DATA.

### 2.10 Contract seam + scope — PASS

- `supplierContacts.ts` and `supplierSendLink.ts` export exactly the contract
  signatures.
- Entry point: "Send All (N suppliers)" button on the fulfillment screen
  (app/(manager)/fulfillment.tsx, `handleSendAll` — 700 ms tap-lock, excludes
  unknown-supplier groups, alerts when nothing sendable); hidden route
  `fulfillment-send-all` registered (app/(manager)/_layout.tsx:219) inside the
  manager-gated group.
- Supplier contacts editor: `app/(manager)/manager-settings/supplier-contacts.tsx`
  + `src/features/settings/SupplierContactsScreen.tsx` using
  `listSupplierContacts`/`updateSupplierContact`; registered in the manager
  "management" settings section (settingsSections.ts).
- No new npm dependencies (package.json diff removes deps, adds none;
  `expo-sms` pre-existing). Design tokens from `@/theme/design`, haptics via
  `@/lib/haptics` as required.

### 2.11 Phase 1 ROADMAP acceptance — verdicts

| Criterion | Verdict |
| --- | --- |
| Schema contact fields | PASS |
| In-app supplier contacts editor | PASS (code) |
| Send All card queue, preview, one-button send, auto-advance, per-card copy/share/skip | PASS (code) |
| Orders archive exactly as today | PASS (with minor staleness-check gap, 2.6) |
| iOS `sms:` body-separator verified on real device | NEEDS-DEVICE |
| "Real order day… under a minute; messages land in correct threads" | NEEDS-DEVICE / NEEDS-LIVE-DATA |
| Unconfigured suppliers fall back to share sheet | PASS |
| Non-goals (no auto-send, no replies, no dashboard coupling) | PASS |

---

## 3. Phase 2a — Dashboard shell / Team / Suppliers

### 3.1 Manager gate cannot be bypassed into privileged actions — PASS

`DashboardGate` (web/src/components/dashboard/DashboardGate.tsx) is UI-only, as
expected; every mutation is server-enforced:

- **Team**: the only mutation paths are `supabase.functions.invoke` calls to
  `list-users` and `set-user-suspended` (web/src/lib/dashboard/team.ts:35, :50).
  Both edge functions enforce manager role server-side with the caller's JWT:
  `supabase/functions/list-users/index.ts:101-102` (`403 Only managers can view
  users`), `supabase/functions/set-user-suspended/index.ts:103-107` (suspended
  requester 403, non-manager 403) and `:137` (only employee accounts can be
  suspended — the UI's employee-only button matches, TeamPage.tsx:186).
  Neither function was modified on this branch.
- **Suppliers**: writes are plain supabase-js `update` on `suppliers`
  (SuppliersPage.tsx:180-183) relying on RLS. A manager-only write policy
  exists: `suppliers_modify_manager` — `FOR ALL TO authenticated USING
  (public.current_user_is_manager()) WITH CHECK (public.current_user_is_manager())`
  (supabase/migrations/20260324120000_purge_org_memberships_policies.sql:64-71,
  created after dropping all prior policies). `current_user_is_manager()` is
  SECURITY DEFINER, requires `profiles.role = 'manager'` AND not suspended
  (supabase/migrations/20260518120100_harden_role_escalation_and_users_rls.sql:10-24).
  Non-managers therefore cannot update suppliers → per the check spec, this
  **passes**. (Authenticated non-managers CAN `select` suppliers via the
  pre-existing `suppliers_select_authenticated` policy — unchanged by this
  branch and required by the app's employee flows; read-only, not flagged.)
- The gate's own check uses the same RPC (`DashboardGate.tsx:42`), so the UI
  gate and the server share one source of truth; it also pins the check to the
  current session's user id (lines 52-56) to avoid stale-session confusion.

### 3.2 Shell / routes / scope — PASS

- `web/src/app/dashboard/layout.tsx` wraps the whole subtree in `DashboardGate`;
  index redirects to `/dashboard/team`; `ordering` is an explicit placeholder
  page; nav (DashboardShell.tsx:17-23) = Team, Suppliers, Ordering setup,
  Tips → `/manager` (plain link), Analytics disabled with "Soon" badge — exactly
  the 2a contract.
- Auth is a dashboard-local login card (`DashboardLoginCard.tsx`) using
  `supabase.auth.signInWithPassword` — no imports from `components/manager/*`
  or entry components (verified by grep).
- Shared-file caution respected: `web/src/lib/supabase.ts` untouched;
  `web/src/types/database.ts` diff is 12 additive lines.

### 3.3 Team page — PASS (code); live roster flow NEEDS-LIVE-DATA

Roster via `list-users` with session JWT, role + suspended badges, confirm
dialog before suspend/unsuspend (ConfirmDialog, destructive styling on
suspend), optimistic flip with rollback on error, self and managers excluded
from the suspend button (mirroring the server rule). The ROADMAP acceptance
("manager signs in, sees real roster, suspends a test user") requires a live
Supabase project — the project's MCP connection was unauthenticated in this
session, so end-to-end is NEEDS-LIVE-DATA.

### 3.4 Suppliers page — PASS (code); "edit a phone Phase 1 then uses" NEEDS-LIVE-DATA

Inline edit of exactly the four Phase 1 columns; save-on-blur with per-row
saving/saved/error status; channel select constrained to the three values
(unknown → `share_sheet`, same normalization as the app). Phone stored as
typed (trim-only, `phoneForStore`), matching Phase 1's normalize-at-send
design (`supplierSendLink.normalizePhone`) — the two ends compose correctly:
any display formatting is cosmetic (unit-tested, web vitest 64/64 green).
Reads filter `active is null or active = true`, ordered name then id.

### 3.5 Collision constraint — PASS

Both `git diff origin/main..HEAD --name-only` and `git log origin/main..HEAD`
over `web/src/app/{e,closer,pin}`, `web/src/components/entry*`,
`web/src/components/manager/`, `supabase/functions/tip-*`, `web/e2e/` return
**nothing** — no commit on this branch ever touched a protected path. The only
`supabase/functions` changes are under `parse-order` (the Phase 0 quick-order
merge, outside the protected set).

### 3.6 Phase 2a ROADMAP acceptance — verdicts

| Criterion | Verdict |
| --- | --- |
| Dashboard nav shell with existing manager Supabase auth | PASS |
| Team page: roster, roles, suspend/unsuspend via existing edge fns | PASS (code) / NEEDS-LIVE-DATA (e2e) |
| Suppliers page: contact editor over Phase 1 columns | PASS (code) / NEEDS-LIVE-DATA (e2e) |
| Mutations server-enforced (no client-side-gate bypass) | PASS |
| No changes to tips pages/functions | PASS |

---

## 4. Cross-cutting

- **PHASE1-STUB / PHASE2-STUB markers**: none anywhere in `src/`, `app/`,
  `web/src/`, `supabase/functions/` — PASS.
- **TODO/FIXME/HACK introduced by these phases**: none in any Phase 1/2a file
  diff — PASS.
- **Hardcoded credentials/URLs**: none in `web/src/{components,lib,app}/dashboard`,
  `src/features/fulfillment/sendAll`, or the supplier-contacts screen; Supabase
  config comes from the existing env-driven client — PASS.
- **Unit-test coverage of the new logic**: sendAllMessage (13 tests),
  sendAllQueue (16), supplierSendLink (5), supplierContacts (3), web phone
  helpers (part of 64 vitest tests) — all passing.

---

## 5. Findings index

| # | Severity | File:line | Summary |
| --- | --- | --- | --- |
| F1 | major | src/features/fulfillment/sendAll/sendAllMessage.ts:103-131 vs app/(manager)/fulfillment-confirmation.tsx:399-404,1581-1604 | Send All prints raw order-item unit labels; confirmation screen prefers inventory `base_unit`/`pack_unit` labels even without unit switching — message text and line grouping can diverge for the same supplier |
| F2 | minor | src/features/fulfillment/sendAll/SendAllScreen.tsx:275-330 | `finalizeCard` lacks the confirmation screen's staleness pre-check (fulfillment-confirmation.tsx:2714-2749); concurrent finalize from another device can double-archive |
| F3 | minor (NEEDS-DEVICE) | src/features/fulfillment/sendAll/SendAllScreen.tsx:428-434 | Android `sendSMSAsync` returns `'unknown'` on cancel → archives anyway; iOS cancel handled correctly |
| F4 | minor | src/features/fulfillment/sendAll/sendAllMessage.ts:74-75,122 | Sort tie-breaks and `[set qty]` label differ from confirmation builder (blocked from sent messages by the unresolved-items gate; preview-only) |
| F5 | minor (cosmetic) | src/features/fulfillment/sendAll/SendAllScreen.tsx:357,433 | Deep-link/SMS sends record `shareMethod: 'share'` in history |
| F6 | note | src/features/fulfillment/sendAll/SendAllScreen.tsx:348-362 | Deep-link fallback archives on app-return regardless of actual send — matches the ROADMAP's auto-advance-on-return spec, but users should know backing out of Messages still archives |

No blockers. Builds, tests, migration, RLS enforcement, collision constraint,
and stub cleanup all verify clean. Device-dependent acceptance criteria
(iOS `sms:` quirk, real-order-day run, live roster/suppliers e2e) remain open
as NEEDS-DEVICE / NEEDS-LIVE-DATA.
