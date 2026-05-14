# Quick Order — Deep Dive (Babytuna Inventory System)

Companion to **`CODEBASE_FULL_CONTEXT_SUMMARY.md` §8**.

---

## Product truth

- **Quick Order does not submit orders.** After the user taps confirm, items are **`addToCart`**’d and the user navigates to the **Cart** tab/screen; submission is the **same `submit_order_rpc` path** as manual ordering.
- **Session row** (`quick_order_sessions`) holds **`messages`** and **`parsed_items`** JSON for continuity and for **Edge Function** `fetchSessionContext(session_id)`.

---

## Frontend file map

| Concern | File |
|--------|------|
| Main screen | `src/features/ordering/QuickOrderScreen.tsx` |
| Route (employee) | `app/(tabs)/quick-order.tsx` → `EMPLOYEE_ORDERING_MODE` |
| Route (manager) | `app/(manager)/quick-order.tsx` → `MANAGER_ORDERING_MODE` |
| Mode config | `src/features/ordering/modes.ts` — `scope`, `cartRoute`, `browseRoute`, `inputAccessoryId` |
| Parsed item helpers | `src/features/ordering/quickOrderItems.ts` |
| Merge / clarification / operations | same file: `mergeQuickOrderParsedItemsDetailed`, `applyQuickOrderClarificationAction`, `applyQuickOrderOperations`, `getParsedItemKey`, … |
| Normalize API response | `src/features/ordering/quickOrderResponse.ts` — `normalizeQuickOrderParseResponse`, `buildQuickOrderAssistantMessage`, `hasQuickOrderStateChange` |
| Errors | `src/features/ordering/quickOrderErrors.ts` — `toFriendlyQuickOrderError`, `sanitizeAssistantReply` |
| Chat layout / keyboard | `src/features/ordering/quickOrderChatLayout.ts` |
| Quantity sheet flow | `src/features/ordering/quickOrderQuantityFlow.ts` + `QuickOrderQuantitySheet.tsx` |
| History suggestions (client) | `src/features/ordering/quickOrderHistorySuggestions.ts` |
| Shortcut chips | `src/features/ordering/QuickOrderShortcutChips.tsx` + `quickOrderShortcuts.ts` |
| List card / rows | `QuickOrderListCard.tsx`, `QuickOrderItemRow.tsx`, `QuickOrderUserMessage.tsx` |
| Edit modal | `QuickOrderItemEditModal.tsx` |
| Cart bridge (pure) | `src/store/helpers/quickOrderCart.ts` — `areQuickOrderItemsCartReady`, `quickOrderItemsToCartAdds` |
| Manager review UI | `src/features/ordering/QuickOrderReviewQueueScreen.tsx` |

---

## Local React state (QuickOrderScreen)

- **`inputValue`**, **`isSending`**: send lock for **`handleSubmitMore`** / **`handleSubmitMore`** uses `prepareQuickOrderSendDraft` from chat layout.
- **`messages`**: `QuickOrderMessage[]` (user / assistant / error).
- **`parsedItems`**: `ParsedQuickOrderItem[]` — authoritative working set after merges.
- **`pendingClarifications`**: from backend **`pending_clarifications` / `pending_actions`**.
- **`sessionId`**: UUID for `quick_order_sessions`; `ensureSession()` creates row if missing.
- **`nudgeSent`**, nudge timer: “Anything else, or ready to send?” after 30s of quiet.
- **`editingState`**, **`quantityFlowState`**: modals/sheets.
- **Refs**: `lastUserTextRef` for **retry**; scroll scheduler refs for chat stick-to-bottom.

**Retry**: `handleRetry` re-fills input from `lastUserTextRef` and calls `handleSubmitMore`.

---

## Send pipeline (`handleSubmitMore`)

1. **`prepareQuickOrderSendDraft`** — validates non-empty, not already sending.
2. If **missing `userId` / `locationId`** → inline error bubble.
3. **`isManualCombineInput`** branch: resolves **quantity_conflict** “combine” without network — applies **`applyQuickOrderClarificationAction`**, persists session.
4. Else: dismiss keyboard; **`setIsSending(true)`**; append **optimistic user message**.
5. **`ensureSession()`** then **`persistSession(sessionId, messages, parsedItems)`** (ordering: persist optimistic transcript before network — see code).
6. **`supabase.functions.invoke('parse-order', { body: { raw_text, location_id, session_id, user_id }})`**.
7. **Error path**: maps `FunctionsHttpError` / `FunctionsFetchError` to codes (`rate_limit_user_daily`, `feature_disabled`, `network_error`, etc.) → **`appendErrorMessage`** (tap retry UI on repeat).
8. **Success path**: **`normalizeQuickOrderParseResponse(data)`**.
9. **Operations first**: `applyQuickOrderOperations` for remove/replace/update/clear intents.
10. **Merge**: `mergeQuickOrderParsedItemsDetailed(operationBase, response.parsedItems)` + **`mergePendingClarificationsAfterParse`**.
11. **Assistant text**: `buildQuickOrderAssistantMessage`.
12. **Quantity auto-flow**: **`getQuantityFixQueue(nextParsedItems)`** → **`openQuantityFlow`**.
13. **`persistSession`** again (failures logged; **local state kept**).
14. **`setIsSending(false)`** in `finally`.

**Race notes**: Rapid double-send guarded by `isSending`. Session persist races can leave server messages slightly behind local — usually acceptable; errors log `session_persist_failed`.

---

## Confirm pipeline (`handleConfirmOrder`)

1. Gate: `parsedItems.length`, **`issueCount`**, **`areQuickOrderItemsCartReady`**, not `isConfirming`.
2. **`loadInventoryItems()`** (refresh for unit resolution).
3. **`quickOrderItemsToCartAdds(parsedItems, inventoryById)`** — throws if any line not ready.
4. For each add: **`addToCart(locationId, …, { context: mode.scope, inputMode: 'quantity', quantityRequested, note })`**.
5. Best-effort **`quick_order_sessions.update({ status: 'abandoned', messages: [], parsed_items: [] })`**.
6. Clear local chat state; **`router.push(mode.cartRoute)`**.

---

## Backend: `supabase/functions/parse-order/index.ts`

### Request (POST JSON)

| Field | Required | Notes |
|-------|----------|-------|
| `raw_text` | yes | User utterance |
| `location_id` | yes | Drives **`area_items`** catalog |
| `session_id` | optional | Loads prior `messages`/`parsed_items` |
| `user_id` | yes | **Must equal** JWT user or **403** |

### Auth

- `Authorization: Bearer <access_token>`
- **`auth.getUser(token)`** then **`profiles.is_suspended`** → 403 if suspended.

### Rate limits / feature flags (`app_config` keys)

- `quick_order_enabled` === false → **503** `feature_disabled`
- **`parser_usage_log`** count since midnight vs `quick_order_daily_limit_per_user` (default 100) → **429** `rate_limit_user_daily`
- **`quick_order_parser_mode`**: `live` forces LLM when keys exist; `auto` uses LLM only if `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` present; **`mock`** (per `app_config` migration comment) matches **no-LLM** path in `index.ts` because only `live` and `auto+keys` set `llmEnabled`.
- Monthly: sum **`total_tokens`** for `parser_mode = 'live'` vs `quick_order_monthly_token_budget` (default 5M) → **429** `rate_limit_org_monthly`

### Data loaded (parallel)

- **Catalog**: `fetchCatalog(locationId)` from **`area_items`** … `inventory_items!inner` … `storage_areas!inner` (active filters, limit 2000). Cached **5 min** per location.
- **Global catalog**: `inventory_items` active (diagnostic / cross-check), cached.
- **Examples**: `parser_examples` active, limit 25.
- **Session**: `quick_order_sessions` → last 20 messages, `parsed_items`.
- **Corrections**: `parser_corrections` for user, `location_id` null OR match, limit 25.

### LLM

- **Timeout**: `LLM_TIMEOUT_MS = 8000`
- **Gemini**: `gemini-2.5-flash`, `temperature: 0`, `responseMimeType: application/json`, `maxOutputTokens: 1024`
- **Claude**: `claude-3-5-haiku-20241022`, `max_tokens: 1200`, `temperature: 0`, system “Return strict JSON only.”
- **Provider order**: env `PARSE_ORDER_LLM_PROVIDER` → else first available key (**Gemini preferred** if both).

### Response (shape)

Uses **`ParseResponse`** from `types.ts` (orchestrator). Client normalizes via **`normalizeQuickOrderParseResponse`**. Typical fields:

- `status`: `ok` | `needs_clarification` | `needs_review` | `error` | …
- `parsed_items`, `flags`, `suggestions`, `pending_clarifications`, `operations`
- `assistant_message`, `reply_text`
- `session_state`, `diagnostics` (includes `parser_version`, counts, `input_classification`, etc.)
- `metrics` (LLM used/failed)

### Usage logging

Always inserts **`parser_usage_log`** with duration, estimated tokens (rough: `ceil(rawText.length/4)` when LLM used), `succeeded`, `metrics` jsonb.

### Suggestions merge

After parse: **DOW** suggestions **`get_dow_suggestions`** unless user asked history; **`buildIntentSuggestions`** overrides with reorder-last-week / recent / usual flows from **`get_recent_orders`**.

---

## Orchestrator (`orchestrator.ts`) — logic outline

1. **`classifyQuickOrderInput`** → intent + stripped text; may return early (pre-parse response).
2. **`confirm`** intent → returns confirm-only response from `existingParsedItems`.
3. **Deterministic candidates**: `parseDeterministicOrder` on stripped text.
4. For each candidate: **`matchCatalogIndex`**, **`validateParsedLine`** (`validator.ts`).
5. **Command intents** (`remove`, `replace`, `update`, `increase`, `decrease`, `clear`): **`buildCommandOperations`** — returns **`operations`**, often **empty `parsed_items`** in that branch.
6. **Add/unknown**: `gateParsedItemsForOrder`, optional **`parseWithLlmFallback`** for weak lines (`llm-fallback.ts`), **`reconcileParsedSources`**.
7. **Normalize**: `normalizeParsedItemsForResponse`.
8. **Duplicates**: `detectRepeatedOrderList`, **`resolveParsedItemConflicts`** (additive language heuristic using effective raw text).
9. **Combine** + invariant check `finalItems.length <= candidates.length` (logs invariant violation if broken).
10. Returns **`ParseResponse`** with diagnostics (`PARSER_VERSION` constant **quick-order-parser-v3-line-based**).

Supporting modules: `deterministic-parser.ts`, `catalog-search-index.ts`, `catalog-matcher.ts`, `input-classifier.ts`, `operations.ts`, `conflicts.ts`, `validator.ts`, `units.ts` (`deriveAllowedUnits`, `configureUnitAliases`).

---

## Text sequence diagram

```
User types in composer → handleSubmitMore
  → ensureSession + persistSession (optimistic)
  → POST parse-order (JWT)
      → app_config / rate limits
      → fetch area_items catalog + examples + corrections + session history
      → parseQuickOrder (deterministic ± LLM)
      → parser_usage_log insert
      → attach suggestions (DOW / history intents)
  ← JSON ParseResponse

Client: normalizeQuickOrderParseResponse
  → applyQuickOrderOperations (if any)
  → mergeQuickOrderParsedItemsDetailed
  → update messages + pending clarifications
  → maybe open QuickOrderQuantitySheet
  → persistSession

User taps Confirm on list card → handleConfirmOrder
  → quickOrderItemsToCartAdds + addToCart (per line)
  → abandon quick_order_sessions row
  → router.push cart

User submits cart → createAndSubmitOrder → submit_order_rpc (fetch)
```

---

## Edge cases & races (Quick Order specific)

- **Catalog empty**: server returns `catalog_empty` — user sees assistant error, no items.
- **LLM unavailable**: deterministic-only still returns partial results; `llm_failed` in metrics.
- **User/session mismatch**: 403 on `user_id`.
- **Daily/monthly caps**: 429 — client maps to friendly error + retry affordance.
- **Confirmation before inventory loaded**: confirm path **forces** inventory load for unit typing.
- **`mergeResult` no-op**: dev warning logged when parser produces no state change.
- **Stale session server-side**: local `parsedItems` can diverge if another device edits session (rare — single-device assumed).

---

## Related manager tooling

- **`QuickOrderConfigScreen`** / `app/(manager)/manager-settings/quick-order-config` — examples (DB).
- **`QuickOrderReviewQueueScreen`** — expects orders with **`entry_method = quick_order`** OR **`quick_session_id` set**; **verify orders created from cart actually satisfy this** in your deployment.
