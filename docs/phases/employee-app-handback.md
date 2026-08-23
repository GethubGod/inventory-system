# Handback — Employee app: checklist-first restructure (feat/employee-app)

Built 2026-08-20 on `feat/employee-app` (cut from `feat/onboarding-auth` @ `a00e201` —
the sibling branch was not yet merged to `roadmap/integration`, per the ticket's rule).
Ticket: `docs/phases/employee-app-build.md` · Mockup: `docs/mockups/employee-app/index.html`.

## What shipped

### Backend (1 additive migration `20260820130000_employee_checklist_ux.sql`; harness PASS + fixture)
- `save_my_checklist_default(p_location_group, p_items jsonb)` — employees upsert
  their own checklist (RLS keeps direct `order_checklist_items` writes manager-only).
  Checked lines update in place (`recommended_qty`, `unit`, `default_checked=true`);
  search adds insert as `item_source='manual'`; every other row keeps its row but
  flips `default_checked=false` so the next order starts exactly as saved. Creates
  the checklist row (`generation_source='manual'`) if none exists. Re-saves never
  duplicate (matched by row id, then item_id, then name+unit).
- `set_my_order_meta(p_order_id, p_note, p_unit_overrides)` — post-submit write of
  the order note into the already-existing-but-never-written `orders.notes`, plus
  per-line `order_items.unit_label` (new additive column). Own submitted orders only.
  `submit_order_rpc` was deliberately NOT re-stated — it has been surgically patched
  8 times and re-stating ~300 lines risked drift from production.
- `update_my_display_name(p_name)` — self-rename that keeps `login_identities`
  (name sign-in) in sync and enforces sign-in-name uniqueness with a clear error.
- Fixture: `scripts/local-db/employee_app_fixture.sql` (save-default update/insert/
  uncheck/re-save/auto-create, order-meta write + foreign-user rejection, rename
  sync + duplicate rejection). Run after `verify-migrations.sh --keep`; prints PASS.

### Unit override + note, end to end
- The quantity card's unit segmented control is a per-line override
  (`setUnit` reducer action). `inventory_items` is never touched.
- Direct send: the chosen unit already flows into supplier messages and
  `past_order_items.unit`; the note is appended to every supplier message
  (`Note: …`) and archived in the payload (`orderNote`).
- Review send: unit_type still carries base/pack exactly; a foreign unit is
  submitted with an item note "Ordered as N unit" — visible in TODAY's deployed
  fulfillment + confirmation screens — and recorded on `order_items.unit_label`
  post-submit. The manager fulfillment screen additionally now selects
  `orders.notes` (with a pre-deploy 42703 fallback for `unit_label`) and shows an
  "Order notes" banner (employee name · location · note) above the supplier cards.

### Floating pill toolbar (`src/components/navigation/FloatingPillTabBar.tsx`)
Custom `tabBar` on the employee Tabs navigator. White pill, hairline, soft shadow,
detached; active tab = tint + label, inactive icon-only; divider + dots appended on
the Order tab and receive screen (dots request the quick-actions sheet through
`simpleOrderUiStore`); pill shrinks to just tabs elsewhere. Driven by
`getVisibleEmployeeTabs` — the same derivation the invite live-preview card and
Preview-as render from, so all three stay in lock-step:
- checklist-only → Order / History / Settings
- `ordering_advanced` on → Order / Advanced / Cart / History / Settings
- neither ordering module → History / Settings (Home is gone entirely)
Cart is gated by `ordering_advanced` (it only serves that flow). `(tabs)/index`
now redirects to the first visible tab. Manager `(manager)` layout untouched.

### Order tab (SimpleOrderScreen restructured — services untouched)
`orderChecklist`/`recentOrders`/`directSendFlow`/receiving/`VoiceAddSheet` all kept.
New chrome per the confirmed mockup: "Checklist" title + compact location pill
(dot · short name · chevron → existing switcher, now absolutely anchored — see
fix note below); four header circle buttons removed; tight top. List: comfortable
~58pt rows with "unit · usually N", compact ~40pt single-line rows with the WIDE
stepper middle (`− 2 fillet +`, ≥56pt tap target); "Show categories" (new persisted
setting) groups under real inventory category labels ordered by the app's category
order, off = one flat list; rarely-ordered section expanded by default, collapsible.
Row tap toggles, −/+ adjusts, middle opens the quantity card (name, "Usually N unit",
unit segmented control from `unitOptionsForLine`, big −/+, editable decimal center,
`+1 +5 +10 Usual` chips, "Set N unit"). Pinned stack: note chip → results card →
add-item bar (mic inside the field, red send circle with count badge, gray at 0).
Review sheet: compact one-line rows, NOTE card, "Send N items", review/direct
subtitle flip. Quick actions: Clear (Undo toast, no confirm dialog), Save as
default, Add/Edit note, Checklist display, Receive delivery, Recent orders —
order reminders deliberately NOT here (Settings → Order reminders).

### History tab (new)
`past_orders` cards ("Tuesday, Aug 18 · 3 items · sent 7:02 PM", receipt icon),
Reorder loads that order's items + quantities (+archived units) into today's
checklist as the exact checked set and returns to Order; card tap shows the
archived message text with a Reorder CTA. Foreign/unparseable payloads simply
don't offer Reorder.

### Settings (trimmed) + Profile (compliance set, all rows functional)
Settings: profile card (initial avatar, name, location · role) → Profile; Order
reminders (existing `OrderDayReminderSheet`, subtitle shows the live rule);
Checklist display; Stock settings (only when `stock_check` on); Contact support
(babytunasystems.com/support); About and legal (privacy, terms, open-source
licenses, contact support, version); Sign out; managers keep "Switch to Manager
view". Profile: Name (edits through `update_my_display_name` so name sign-in keeps
working), Email (synthetic `@members.babytunasystems.com` addresses show as "Add";
saving goes through `supabase.auth.updateUser` with a confirmation email), Location
(read-only, "set by the manager"), Change PIN or password (self-service sheet on
`setMyCredential` — this UI did not exist anywhere before), Privacy choices (plain
"data we store and why" + full-policy link), Delete account (existing typed-DELETE
flow on `deleteSelfAccount`).

### Fixes found along the way
- `LocationSwitcherDropdown` always occupies layout space (it animates
  opacity/scale, not height). The old Order screen rendered it in-flow, which under
  the new tight header produced a ~130pt dead band; it is now absolutely anchored
  the way Browse mounts it.
- The old profile screen's name "editing" never saved (both ✓ and ✕ just closed
  edit mode); the new Profile actually persists.

## Verification
- `npx tsc --noEmit` clean; eslint: 0 errors on all touched paths (7 pre-existing
  warnings in untouched store files); jest: **62 suites, 972 passed / 14 skipped**
  (new suites: `employeeChecklistMeta`, `simpleOrderRestructure`; updated:
  `moduleAccess`, `invitePreview`, `simpleOrderRecentOrders`).
- Migration harness PASS (16 branch migrations incl. this one on the prod
  baseline) + `employee_app_fixture.sql` PASS.
- **Simulator demo: 24 screenshots in `docs/phases/employee-app-demo/`** — driven
  live against production with one temporary demo employee (created via SQL like
  the sibling phase's test account): comfortable+categories, quantity card
  set-20-and-switch-to-lb, override applied (20 lb on a case item), quick actions,
  note sheet → chip → NOTE card in review, a real review-mode send (server-verified:
  `entry_method='simple_checklist'`, item note "Ordered as 20 lb" on the line),
  display sheet, compact flat list (15+ rows), History with shrunk pill, reorder
  loading the exact archived set, location dropdown, receive flow end-to-end
  ("Saved with issues", `order_receipts` written and verified), trimmed Settings,
  About/legal, Profile compliance rows, Change PIN sheet, delete-account modal,
  and the pill widening LIVE to Order/Advanced/Cart/History/Settings when
  `ordering_advanced` was flipped in `user_modules` (realtime, no reload).
- **Pre-deploy failures behaved exactly as designed** (this branch's backend and
  the sibling's are not deployed): save-as-default and set_my_order_meta fail
  gracefully (order still sends; note/unit_label columns stay null until deploy),
  and Change PIN shows the inline "Unable to save" error (shot 22) because
  `set_my_login_credential` doesn't exist in prod yet. All three RPC paths are
  proven by the local harness fixtures.
- **Test-data cleanup: DONE.** Demo user, its order, receipts, past orders,
  checklists, module rows, and auth rows all deleted; verification query returned
  zeros across every table.
- Existing flows: manager surfaces untouched except the fulfillment notes banner;
  direct-send queue, order-day reminders, stock-check entry (Settings row), legacy
  tab layout for managers `(manager)` all untouched; invite preview/Preview-as
  tests updated to the new derivation and passing.
- Zero emoji glyphs; every new screen is on the `tipsTheme` tokens.

## Needs David
1. **Cart/Advanced pill assumption (ticket asked to flag):** with
   `ordering_advanced` on, the pill becomes Order / Advanced / Cart / History /
   Settings (Cart shares the advanced gate). With NO ordering module, the pill is
   just History / Settings — Home is gone for all employees. Confirm both.
2. **Deploy order:** apply `20260820130000_employee_checklist_ux.sql` together
   with (after) the sibling's 4 migrations. No edge functions changed in this
   phase. Until it deploys, the graceful failures above persist in prod builds.
3. **Save-as-default semantics:** saving flips rows you left unchecked to
   default-unchecked (rows are kept) — that's what makes "checked items and
   amounts start the next order" literally true. Say the word if you'd rather
   saving never un-defaults anything.
4. **"Bigger text" is not in the trimmed Settings** — the rev-3 ticket's list
   omits it (the older redesign doc had it). Display & Accessibility still exists
   at `/settings/display-accessibility`; one row could bring it back.
5. **Open-source licenses** is a curated list of the major packages, not a
   generated manifest — flagging for the polish round if you want the full list.
6. **Manager fulfillment shows unit overrides via the per-item note** ("Ordered as
   20 lb"); `unit_label` is recorded on the line but the giant fulfillment screens
   still display base/pack labels. Threading `unit_label` through their display is
   left for the order-interface polish round (those files are the known-tech-debt
   huge screens).
7. The **dev simulator** (iPhone 17 Pro) is signed out again; Metro is still
   running on 8081 from this session. The `ordering_simple` default flip is still
   undeployed, so in prod-today a fresh employee needs an explicit `user_modules`
   row to see the Order tab (the sibling migration fixes this at deploy).

## Consciously left out / notes
- Clear-checklist's Undo toast is implemented and unit-tested (`clearAll` +
  `restore` snapshot round-trip) but isn't in the screenshots — it auto-expires
  faster than scripted screenshot round-trips; verify with one tap in person.
- Voice add, recent-orders sheet, direct-send queue, and reminders sheet were
  reused as-is (recolored surfaces render them unchanged).
- Managers in employee view get the same pill (their all-on modules → the wide
  set). The employee Home screen files remain in the repo but are no longer
  routed to.
- Checklist rows generated from history can show near-duplicate lines (same item,
  different unit — e.g. two Amaebi rows); pre-existing 5a generation behavior,
  untouched here.
- `.expo/types/router.d.ts` stayed stale; new routes use the established cast.
