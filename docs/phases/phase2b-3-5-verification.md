# Phases 2b / 3 / 5a / 5b — Independent Verification

Verifier session, 2026-08-11, branch `roadmap/integration` (HEAD `ca3280d`).
Method: code-derived (no builder claims trusted), full test/build runs, and live SQL
probes against the disposable Docker harness (`scripts/local-db/verify-migrations.sh --keep`,
postgres:17 with production baseline + auth stub). Read-only except this file.

**Working-tree caveat:** a concurrent session was writing uncommitted Phase 7a files
(`src/services/orderReceiving.ts`, `supabase/migrations/20260812150000_order_receiving.sql`,
`src/types/database.ts` edits) into this tree during verification. Test/build runs and the
migration harness therefore included those files (the harness applied 7 migrations, not 6).
All passed, so no verdict below is tainted, but the runs are not a pure snapshot of `ca3280d`.

## 1. Full-run results

| Run | Result | Tail |
|---|---|---|
| `npm run typecheck` (app) | PASS (exit 0) | `tsc --noEmit`, no output |
| `npm run test:ci` (app, jest) | PASS (exit 0) | `Test Suites: 1 skipped, 47 passed, 47 of 48 total · Tests: 14 skipped, 847 passed, 861 total · Time: 3.198 s` |
| `cd web && npx vitest run` | PASS (exit 0) | `Test Files 10 passed (10) · Tests 105 passed (105) · Duration 183ms` |
| `cd web && npm run build` (Next.js prod) | PASS (exit 0) | build completed, static + dynamic routes emitted |
| `scripts/local-db/verify-migrations.sh` | PASS (exit 0) | `PASS: 7 new migration(s) applied cleanly on top of the production baseline.` (includes the concurrent session's uncommitted `20260812150000_order_receiving.sql`, applied last) |

New-phase unit tests exist and pass: `inviteJoin`, `moduleAccess`, `userModules`,
`orderChecklist`, `orderSendMode`, `simpleOrderSelection`, `simpleOrderDirectSend`,
`simpleOrderRecentOrders` (app); `web/src/lib/dashboard/__tests__/{invites,modules,ordering}.test.ts` (web).

## 2. Phase 2b — Invite links end-to-end

### Acceptance verdicts

| Criterion | Verdict |
|---|---|
| `invites` table per contract (token unique >=128 bits, name, role check, module_preset jsonb, expiry, created_by, used_at/used_by, revoked_at; manager RLS, anon none) | PASS — `supabase/migrations/20260812100000_invites.sql` matches column-for-column; token is 24 random bytes → 32 URL-safe chars (192 bits, `_shared/invites.ts:55-66`); RLS single manager-all policy, `revoke all ... from anon` |
| `create-invite` (manager JWT → {token, joinUrl}) | PASS — `supabase/functions/create-invite/index.ts`: JWT → requester role check (manager, non-suspended), input validation in `_shared/invites.ts`, unique-violation retry, returns `{inviteId, token, joinUrl}` |
| `revoke-invite` (manager JWT → {ok}) | PASS — manager-checked, single UPDATE by id |
| `accept-invite` validates token, creates account server-side, marks used, returns {ok, role}; dry-run `{validateOnly:true}` | PASS — `supabase/functions/accept-invite/index.ts` |
| Response-shape agreement between accept-invite and BOTH consumers | PASS — dry-run responds `{valid, invitedName, role[, reason]}` (200); both `web/src/lib/join.ts:96-106` and `src/services/invites.ts:127-137` branch on `valid === true`, read the structured `reason`, and tolerate legacy `{ok}`. Full accept responds `{ok, role}` / 409 `{error, reason}`; `src/services/invites.ts:144-178` matches. The residual mismatch flagged in phase1-2a verification is fixed (commit `64bdd00`). See minor F5 for the one remaining coupling. |
| Token race safety (single conditional UPDATE) | PASS — one `UPDATE ... eq(token).is(used_at,null).is(revoked_at,null).gt(expires_at,now)` (`accept-invite/index.ts:300-308`); loser gets 0 rows → account rolled back (`removeUnclaimedUser`). Simulated in harness: first consume 1 row, second consume 0 rows. User creation precedes consumption, and the race-loser cleanup deletes the auth user (user_modules rows cascade via FK `on delete cascade`). |
| used / expired / revoked all produce correct UI reasons | PASS — `inspectInviteState` (`_shared/invites.ts:175-189`) → structured reasons; web `/join` renders per-reason copy (`web/src/components/join/JoinLanding.tsx:22-31,127-130`); app maps `InviteError.reason` → `describeInviteFailure` (`src/services/inviteLinks.ts:70-81`); dashboard status chips derive pending/used/expired/revoked (`web/src/lib/dashboard/invites.ts:36-48`, unit-tested) |
| Deep link → app signup accept path skips access code | PASS — `app/join.tsx` → `/(auth)/signup?inviteToken=` → `fetchInvitePreview` greeting → `signUpWithInvite` (`src/store/authStore.ts:1544-1597`) calls `acceptInvite` then `signInWithPassword`; `app.json` registers scheme `babytunasystems`; `parseJoinToken` handles scheme/slash/web-link variants (unit-tested) |
| Access-code path byte-identical to origin/main | PASS — `git diff origin/main -- supabase/functions/validate-access-code supabase/functions/update-access-codes src/services/accessCodes.ts` is empty; `completeProfile`/access-code UI path intact in `authStore.ts` |
| module_preset application writes only the five keys | PASS — `accept-invite/index.ts:37-43,114-147` filters through the five-key `MODULE_KEYS` set with boolean-type check before upserting `user_modules`; dashboard `buildModulePreset` (`web/src/lib/dashboard/modules.ts:121-130`) also restricts to role-valid keys. (`create-invite` stores arbitrary preset keys unvalidated — harmless, filtered at apply time.) |
| Invite created on dashboard → link on phone → account with intended role (real device) | NEEDS-DEVICE — logic chain verified end-to-end in code; physical phone run not possible here |

## 3. Phase 3 — Per-user module toggles

### Acceptance verdicts

| Criterion | Verdict |
|---|---|
| `user_modules` schema + five canonical keys + manager-write RLS | PASS — `20260812110000_user_modules.sql`; pk (user_id, module_key), key check constraint, realtime publication added |
| SQL defaults vs frontend fallback match exactly | PASS — harness probe of `get_effective_modules` for an employee returned exactly `ordering_simple=f, ordering_advanced=f, stock_check=t, tips=f, fulfillment=f`; `getRoleDefaultModules` in `src/store/moduleStore.helpers.ts:39-48` and `web/src/lib/dashboard/modules.ts:41-50` produce the identical map (manager → all true). No drift. |
| RLS: employee cannot write own rows | PASS (verified live) — employee-session `INSERT` into `user_modules` → `ERROR: new row violates row-level security policy`; employee `UPDATE` of a manager-written row → `UPDATE 0`; manager-session insert succeeded and the employee immediately read the flip through `get_effective_modules`. `setUserModule` from an employee session therefore fails by policy. `get_effective_modules` is SECURITY DEFINER but self-authorizes (caller must be self or manager). |
| Realtime flip path (subscription → refetch → layout re-render) coherent | PASS (code) / NEEDS-DEVICE (live demo) — `subscribeToMyModules` (postgres_changes on `user_modules`, `user_id=eq.<self>` filter) → refcounted `acquireModuleAccess` → `moduleStore.load` → `useMyModules` → `Tabs.Screen href` flips (`app/(tabs)/_layout.tsx:57-80`, `app/(manager)/_layout.tsx:183-186`). Publication membership added in the migration. The plain-postgres harness has no realtime server, so the actual live flip on a phone is untestable here. |
| Quick Order renamed "Advanced ordering (Beta)" behind `ordering_advanced` | PASS (employee side) — tab title "Advanced", `MODULE_LABELS` carry the full name, `app/(tabs)/quick-order.tsx:32` guarded. Manager side: see F2. |
| Deep-link guards cover every module-gated route | **FAIL** — see F1/F2/F3. Guarded: `(tabs)/simple-order`, `(tabs)/quick-order`, `(tabs)/stock-check`, `(tabs)/stock-check-list`, `(tabs)/past-checks`, `(manager)/fulfillment`. Unguarded module surfaces remain (fulfillment sub-screens, drafts, manager quick-order/voice). |
| No route renders a broken/blank surface when a module is off | PASS — hidden tabs use `href: null`; guarded screens wait for a definitive module answer then `<Redirect>` home (`src/hooks/useMyModules.ts:55-74`), no flash/blank state; tips module gates nothing yet by design (documented TODO-PHASE4, contract-sanctioned) |
| Web toggle matrix + invite preset + in-app mirror | PASS — Team page expandable per-user matrix (`web/src/components/dashboard/TeamPage.tsx`), invite modal presets (`InviteCreateModal.tsx` → `buildModulePreset`), in-app mirror in `app/(manager)/manager-settings/user-management.tsx` (uses `getModulesForUser`/`setUserModule`/`MODULE_LABELS`) |
| Flipping a dashboard toggle updates the employee's phone without re-login | NEEDS-DEVICE (logic verified; realtime demo requires live stack + device) |

## 4. Phase 5a — Core checklist

### Acceptance verdicts

| Criterion | Verdict |
|---|---|
| Schema matches contract (both tables, RLS owner-read/manager-write) | PASS — `20260812120000_order_checklists.sql`; adds contract-anticipated `item_source` + `typical_qty`; `unique (user_id, location_group)` supports get-or-generate. RLS: owner select via checklist ownership, manager all — employees cannot write checklist rows (the app never needs them to: search-adds live in client selection state only). |
| Generation SQL deterministic + fixture-verified | PASS (verified live) — ran `phase5a_checklist_fixture.sql` against the kept harness container: output exactly `Frequent Tuna / frequent / 4.5 / 1 / 0`, `Occasional Salmon / occasional / 10 / 2 / 1`, `Rare Nori / rare / 1 / — / 2`. Buckets match contract (frequent ≥40%, rare <10% or single occurrence), median via `percentile_cont(0.5)`, thin-history fallback (<5 personal order days → location-group-wide stats), stable sort. Function self-authorizes (self or manager). |
| `sendChecklistOrder` → `submit_order_rpc` with `entry_method='simple_checklist'` accepted | PASS (verified live) — migration extends `orders_entry_method_check` (probed: constraint now includes `simple_checklist`) and surgically patches `submit_order_rpc` to accept `simple_checklist` without a Quick Order session (probed: function body contains the new branch; the patch raises if the expected block is missing, so it cannot silently no-op). Service passes `entryMethod: 'simple_checklist'`, `quickSessionId: null` (`src/services/orderChecklist.ts:585-593` → `orderSubmission.ts:125`). |
| Confirmation-sheet skip behavior for null-itemId lines matches service validation | PASS — review mode: `buildSendLines` drops unmatched lines and returns `unmatchedNames` (`checklistSelection.ts:244-265`), the sheet shows "Not in inventory, will be skipped: …" (`ConfirmOrderSheet.tsx:227-238`), and the service hard-rejects any null itemId that slips through (`orderChecklist.ts:503-516`). Direct mode intentionally keeps them (share-sheet Unassigned card) and suppresses the warning (`SimpleOrderScreen.tsx:792`) — consistent by design. |
| Service seam matches contract signatures | PASS — `src/services/orderChecklist.ts` implements `ChecklistItem`/`Checklist`/`ChecklistSendLine`/`getOrGenerateMyChecklist`/`regenerateMyChecklist`/`sendChecklistOrder` as specified |
| One-screen flow (pre-checked frequent, collapsed rare, add-more search, confirm sheet) | PASS (code) — `src/features/simpleOrder/SimpleOrderScreen.tsx` sections Usual/Sometimes/Added/Rarely(collapsed), stepper honors units, add-more search, confirm sheet → success state; behind `ordering_simple` module + route guard |
| Generated checklist "looks right" from a real employee's history; ~2-minute run | NEEDS-LIVE-DATA / NEEDS-DEVICE — fixture math verified; judgment on real history is David's |

## 5. Phase 5b — Direct send + editors

### Acceptance verdicts

| Criterion | Verdict |
|---|---|
| Direct send NEVER hits the review queue | PASS — traced: `prepareDirectSend` → `DirectSendQueue` (Phase 1 `sendAllQueueReducer` + `buildSupplierSendUrl`) → `archiveDirectSend`, which inserts only `past_orders` + `past_order_items` (`orderChecklist.ts:402-501`); no call anywhere in the direct path touches `orders`, `submitOrder`, or `submit_order_rpc`. Employee inserts are permitted by the existing owner RLS on both history tables (probed in harness: `created_by = auth.uid()` insert policies). |
| Review mode unchanged from 5a | PASS — `sendMode === 'direct'` branches before the 5a path; otherwise `sendChecklistOrder` runs exactly as in 5a (`SimpleOrderScreen.tsx:275-321`) |
| Direct-send message uses the shared unit-label helper | PASS — `buildDirectSendMessage` delegates to Phase 1's `buildSendAllMessage` (`orderChecklist.ts:290-298`), which resolves labels through the shared `src/features/fulfillment/unitLabels.ts` module ("single source of truth" used by fulfillment confirmation + Send All). No parallel formatting. (See minor F8 on the heading-strip hack.) |
| Per-employee send mode manager-only | PASS (verified live) — `20260812130000_order_send_mode.sql` puts `order_send_mode` on `profiles` with check constraint; harness probe: manager flipped an employee to `direct` (UPDATE 1), the employee's own attempt raised `Only managers can modify order send mode` via the `enforce_profile_security` trigger; RLS policy scopes cross-user updates to manager-on-employee |
| Dashboard editor writes match app read expectations | PASS — `web/src/lib/dashboard/ordering.ts`: `updateChecklistItem` patches only `default_checked`/`recommended_qty`; `insertChecklistItem` writes `item_source:'manual'`, `default_checked:true`, appended `sort_order`, unit chosen by the same preference chain the app uses (`unitForInventoryRow` mirrors `unitForInventoryItem`); `updateSendMode` targets `profiles.order_send_mode` with the employee-role filter matching the app's `setOrderSendMode`. App reads select the same columns and sort identically (sort_order, then name). |
| Manual items survive regeneration (item_source semantics) | PASS (verified live) — harness probe: after inserting a `manual` row plus a manual duplicate of a generated item, re-running `generate_order_checklist` deleted only `generated` rows, kept both manual rows (including the manual override's `default_checked=false`, `recommended_qty=42`), and did NOT re-insert a generated duplicate (the `not exists` dedup on item_id/name/unit works) |
| Recent past sent orders on the checklist screen (self only) | PASS — `src/features/simpleOrder/recentOrders.ts` queries `past_orders` with `.eq('created_by', self)`; both archive paths write `totalItemCount` the counter reads |
| Both send modes verified end-to-end on a phone; dashboard edits appear on the phone | NEEDS-DEVICE |

## 6. Cross-cutting

| Check | Verdict |
|---|---|
| Tips-files collision vs origin/main (`web/src/app/{e,closer,pin}`, `web/src/components/entry*`, `web/src/components/manager/*`, `supabase/functions/tip-*`, `web/e2e/*`) | PASS — `git diff origin/main --name-only` intersected with protected paths is empty |
| Leftover stub markers / TODOs from these phases | PASS — only two intentional markers: `TODO-PHASE4` (tips tab, contract-sanctioned) and `TODO-DAVID` App Store URL placeholder in `JoinLanding.tsx:15` (roadmap explicitly specs "App Store link placeholder") |
| `web/src/types/database.ts` hand-written additions vs migrations | PASS with minor drift (F6) — `invites`, `user_modules`, `order_checklists`, `order_checklist_items`, `profiles.order_send_mode`, supplier contact fields, and the `get_effective_modules`/`generate_order_checklist` function signatures all present and column-for-column correct except two nullability mismatches on `invites` |

## 7. Findings

**F1 (major, Phase 3)** — Fulfillment module gate does not cover the fulfillment sub-screens.
`app/(manager)/fulfillment.tsx:337` guards with `useModuleAccessGuard('fulfillment', '/(manager)')`,
but `fulfillment-confirmation.tsx`, `fulfillment-send-all.tsx`, `fulfillment-history.tsx`, and
`fulfillment-history-detail.tsx` have no module guard (grep confirms zero guard/module references).
They are hidden from the tab bar (`href: null`) yet remain directly navigable, so a manager with
`fulfillment` toggled off can still deep-link into confirmation/send-all/history. Exposure is
manager-role-only (the outer role gate holds), but the check item "deep-link guards cover every
module-gated route incl. fulfillment" is not met.

**F2 (minor, Phase 3)** — Manager Quick Order ignores `ordering_advanced`.
`getVisibleManagerTabs` (`src/store/moduleStore.helpers.ts:87-92`) always includes `quick-order`,
and `app/(manager)/quick-order.tsx` / `app/(manager)/voice.tsx` carry no guard — while the dashboard
matrix exposes the `ordering_advanced` toggle for manager rows (`moduleKeysForRole('manager')` returns
all five keys). Flipping it for a manager does nothing on the phone: a silent control/behavior drift.
Either gate the manager surface or hide the toggle for manager rows.

**F3 (minor, Phase 3)** — `app/(tabs)/draft.tsx` (Quick Order drafts, part of the Advanced
ordering surface) has no `ordering_advanced` guard; it is hidden (`href: null`) but reachable by
direct navigation when the module is off. `(tabs)/voice.tsx` is safe (unconditional redirect home).

**F4 (major, Phase 5b)** — Direct-send history is invisible to future checklist generation.
`archiveDirectSend` writes `past_order_items.location_group: null` (`src/services/orderChecklist.ts:490`),
but `generate_order_checklist` filters history on `poi.location_group = p_location_group`
(`20260812120000_order_checklists.sql:171`), which excludes NULLs. So orders sent by direct-mode
employees never feed their own checklist stats — exactly the users whose orders bypass fulfillment
finalization (the path that does stamp location_group). The 5b acceptance demo passes, but the 5a
feedback loop degrades for direct-mode users over time. The screen knows its `locationGroup`; passing
it through to the archive rows would close the loop.

**F5 (minor, Phase 2b)** — Full-accept error handling classifies by message keywords only.
On non-2xx accept, `src/services/invites.ts:154-163` extracts just the body's `error` string and
derives the reason via `classifyInviteFailure` word-matching; the structured `reason` field the 409
body carries is ignored (dry-run paths do use it). Works with current backend wording (`used`/
`expired`/`revoked` all appear), but reworded messages would silently downgrade to "invalid".

**F6 (minor, types)** — `web/src/types/database.ts` types `invites.created_by` and
`invites.expires_at` as `string | null` / optional-insert, but the migration declares both
`NOT NULL` (`20260812100000_invites.sql:13-14`). Loose in the safe direction (reads), yet the
Insert types would let TS accept an insert PostgREST rejects. Everything else matches
column-for-column.

**F7 (minor, Phase 2b)** — `revoke-invite` revokes unconditionally (no `used_at is null` guard),
and display precedence differs: dashboard shows a used-then-revoked invite as "used"
(`deriveInviteStatus`, documented choice) while the join/accept path reports it "revoked"
(`inspectInviteState` checks revokedAt first). Both are rejections; only the label differs.

**F8 (minor, Phase 5b)** — `buildDirectSendMessage` strips the Phase 1 builder's group heading
with a literal `message.replace('--- SUSHI ---\n', '')` (`orderChecklist.ts:298`). If the heading
format in `sendAllMessage.ts:188` ever changes, direct-send messages will silently include a bogus
"--- SUSHI ---" section header. A builder option (or exporting the heading format) would be robust.

**F9 (note)** — Verification ran against a working tree carrying a concurrent session's
uncommitted Phase 7a files; the migration harness applied its `20260812150000_order_receiving.sql`
(cleanly, after all Phase 2b/3/5 migrations). No impact on verdicts above.

## 8. Summary

- **Phase 2b:** PASS across the board (device run pending). Response shapes aligned, race-safe
  consumption proven in SQL, access-code path byte-identical to origin/main, preset application
  correctly restricted to the five keys.
- **Phase 3:** Backend fully verified live (defaults, RLS, function auth). Frontend largely
  correct, but the deep-link guard coverage criterion FAILS on the fulfillment sub-screens (F1),
  with two smaller gaps (F2, F3). Realtime flip is code-coherent; live demo NEEDS-DEVICE.
- **Phase 5a:** PASS — generation math confirmed against the fixture in the harness,
  `simple_checklist` accepted by the patched RPC/constraint, UI skip behavior consistent with
  service validation.
- **Phase 5b:** PASS on all acceptance-facing behavior (direct send provably never touches the
  review queue; send-mode security proven live; manual rows survive regeneration), with one real
  data-pipeline gap to fix (F4) before direct mode rolls out widely.
- Recommended before sign-off: fix F1 and F4 (small, contained changes); F2/F3/F5-F8 are
  polish-level.
