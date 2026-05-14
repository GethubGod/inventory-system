# Babytuna Inventory System — Full Codebase Context Summary

This document is **hand-written from repository inspection** (May 2026). Use it with `QUICK_ORDER_DEEP_DIVE.md`, `SUPABASE_AND_DATABASE_SUMMARY.md`, and `FILE_BY_FILE_INDEX.md` for extended detail.

---

## 1. Executive Summary

**Babytuna Inventory System** (`babytuna`, Expo app **1.5.0**) is a **React Native / Expo** mobile app for **multi-location restaurant inventory and ordering**. Primary users:

- **Employees**: browse inventory, build carts per **location**, submit orders, run **stock checks**, use **Quick Order** (natural-language ordering assistant), optional **voice/smart** flows.
- **Managers**: same core ordering plus **fulfillment** (group pending order lines by **supplier** and **location group** sushi/poki), **past orders** / export, **employee reminders**, **user/access code** management, **Quick Order config** (parser examples, app config via DB), inventory management screens.

**Major flows**

| Flow | Summary |
|------|---------|
| **Employee ordering** | Home → browse/add items → **cart** (`useOrderStore`, `cartByLocation`) → **submit** via `submit_order_rpc` (atomic RPC, raw `fetch` from `src/services/orderSubmission.ts`). |
| **Quick Order** | Chat UI (`QuickOrderScreen`) → Edge Function **`parse-order`** → parsed line items merged locally → user fixes quantity/unit/clarifications → **Confirm** pushes lines into **normal cart** (does **not** submit order by itself) → user submits from Cart. |
| **Browse inventory** | `useInventoryStore`: `listInventory` API with **direct Supabase fallback** to `inventory_items`; filters by category/supplier category/search. |
| **Cart** | Unified `cartByLocation`; `getCartByContext` supports `employee` vs `manager` scope but **writes always go to `cartByLocation`** (legacy `managerCartByLocation` merged on rehydrate). |
| **Manager fulfillment** | `loadFulfillmentData` / `fetchPendingFulfillmentData` load submitted orders + **past orders** + **order_later** queue; supplier resolution in `supplierResolver.ts`; draft lines per supplier; SMS/share/export patterns. |
| **Manager configuration** | Routes under `app/(manager)/manager-settings/*`, `quick-order-config`, access codes, user management, reminders. |
| **Auth / location** | **Supabase Auth** (email + Google/Apple OAuth), **`useAuthStore`** persisted (`babytuna-auth`): `users`, `profiles`, `locations`, `viewMode` (employee vs manager UI). **Selected location** from `user.default_location_id` + `LocationSelector` patterns. |
| **Supplier / location grouping** | Fulfillment uses **`supplier_override_id`** on `order_items`, **supplier categories** on inventory, and **FulfillmentLocationGroup** `'sushi' \| 'poki'` derived from location name/short_code heuristics in `fulfillmentDataSource.ts`. |

---

## 2. Tech Stack

| Layer | Package / version (from `package.json`) | Role here |
|-------|-------------------------------------------|-----------|
| **Runtime** | `expo ~54.0.33`, `react-native 0.81.5`, `react 19.1.0` | Single RN app; **`main`: `expo-router/entry`**. |
| **Routing** | `expo-router ~6.0.23` | File-based routes under `app/`; typed routes experiment in `app.json`. |
| **Language** | `typescript ~5.9.2` | Strict; path alias `@/*` → `src/*`. |
| **Auth / DB** | `@supabase/supabase-js ^2.45.0` | Client in `src/lib/supabase.ts` (**SecureStore** adapter, chunked keys); Edge Functions use service role. |
| **State** | `zustand ^4.5.0` + `persist` + **AsyncStorage** | Multiple persisted stores (see §5). |
| **Styling** | **`nativewind ^4.0.1`** + `tailwindcss ^3.4.0` | `babel.config.js`: `nativewind/babel`, `jsxImportSource: nativewind` · `metro.config.js`: `withNativeWind`, `global.css`. |
| **Lists** | `@shopify/flash-list` | Performance-critical lists where used. |
| **Sheets / modals** | `@gorhom/bottom-sheet` | Bottom sheets. |
| **Animation** | `react-native-reanimated ~4.1.1` | Quick Order UI, transitions. |
| **Gestures** | `react-native-gesture-handler` | Wrapped at root `_layout`. |
| **Icons** | `@expo/vector-icons`, `lucide-react-native` | UI icons. |
| **Haptics** | `expo-haptics` | **Always use `src/lib/haptics.ts`** (respects `useDisplayStore` haptic toggle), not raw `expo-haptics` in features. |
| **Networking / offline** | `@react-native-community/netinfo` | Order submission pre-check; past-order sync retry. |
| **Updates** | `expo-updates` | EAS Update URL in `app.json` extra. |
| **AI (server)** | **Gemini** (`gemini-2.5-flash`) or **Anthropic** (`claude-3-5-haiku-20241022`) inside **`supabase/functions/parse-order/index.ts`** — **not** an app dependency. |

**Testing**

- `jest.config.js`: `testMatch: ['**/src/__tests__/**/*.test.ts']`, `ts-jest`.
- **`package.json` does not define a `test` script** — run `npx jest` manually (or add script).

**Important Expo modules**: `expo-secure-store`, `expo-camera`, `expo-speech-recognition`, `expo-notifications`, `expo-font`, `expo-splash-screen`, `expo-linear-gradient`, `expo-blur`, `expo-clipboard`, `expo-sms`, `expo-auth-session`, `expo-web-browser` (OAuth).

---

## 3. Folder Structure

```
app/                    # Expo Router: thin wrappers → src/features screens
src/
  components/           # Shared UI (GlassSurface, navigation, auth, cart peek, …)
  features/             # Domain UI + logic: ordering/, cart/, browse/, fulfillment/, home/, stock-check/, smart/, settings/
  hooks/                # useAuthGuard, subscriptions, scaled styles, …
  lib/                  # supabase client, api clients, haptics, perf, inventory units, …
  services/             # orderSubmission, orderValidation, fulfillmentDataSource, supplierResolver, accessCodes, …
  store/                # Zustand stores
  store/helpers/        # Pure cart/past order/quick order helpers (unit-testable)
  theme/                # design.ts tokens (+ glassSpacing, etc.)
  types/                # database.ts domain types, settings.ts
supabase/
  functions/            # Edge Functions (parse-order + _shared)
  migrations/           # SQL migrations (authoritative schema evolution)
```

**What belongs where**

- **`app/`**: Route components should stay **thin** (e.g. `app/(tabs)/quick-order.tsx` only sets `OrderingMode` and renders `QuickOrderScreen`). Do not move large JSX into `app/` if the convention is feature modules.
- **`src/features/`**: Screen composition, feature-specific hooks, feature types. Ordering has the bulk of Quick Order code.
- **`src/store/`**: Global client state and orchestration; **complex pure logic** should live in `store/helpers/*` and be imported.
- **`src/theme/design.ts`**: Colors, radii, spacing, typography scales — **avoid hardcoding** duplicate hex values in features when tokens exist.
- **`supabase/functions`**: Server trust boundary; uses **service role** for catalog/examples/sessions.

**Dependencies (high level)**

- Screens → stores + `services/*` + `lib/supabase` + `components/ui/*`
- `orderStore` → `orderSubmission.submitOrder`, `fulfillmentDataSource`, Supabase tables
- Quick Order UI → `supabase.functions.invoke('parse-order')` + `quick_order_sessions` for persistence

---

## 4. Route Map

Guards: **`useProtectedAuthGuard`** (`src/hooks/useAuthGuard.ts`) — redirects to `/(auth)/login`, `/(auth)/complete-profile`, `/suspended`; managers use `{ requireManager: true, ... }` and must have `viewMode === 'manager'`.

| Route path | File | Imported view | Purpose | Notes |
|------------|------|---------------|---------|-------|
| `/` | `app/index.tsx` | Redirect only | Auth gate → `getAuthenticatedHomeHref(role, viewMode)` → `/(tabs)` or `/(manager)` | |
| `/(auth)/login` | `app/(auth)/login.tsx` | (auth screens) | Login | OAuth + email |
| `/(auth)/signup` | `app/(auth)/signup.tsx` | | Signup | access code |
| `/(auth)/complete-profile` | `app/(auth)/complete-profile.tsx` | | Finish profile | |
| `/(tabs)/*` | `app/(tabs)/_layout.tsx` | **Tabs** | Employee shell | Badges: cart count, draft count |
| `/(tabs)/index` | `app/(tabs)/index.tsx` | Employee home | Home | |
| `/(tabs)/quick-order` | `app/(tabs)/quick-order.tsx` | `QuickOrderScreen` | Quick Order | `EMPLOYEE_ORDERING_MODE` |
| `/(tabs)/cart` | `app/(tabs)/cart.tsx` | Cart screen | Cart | |
| `/(tabs)/stock-check` | `app/(tabs)/stock-check.tsx` | Stock check | | |
| `/(tabs)/settings` | `app/(tabs)/settings.tsx` | Settings hub | | |
| `/(manager)/*` | `app/(manager)/_layout.tsx` | **Tabs** | Manager shell | Fulfillment tab badge counts pending work |
| `/(manager)/quick-order` | `app/(manager)/quick-order.tsx` | `QuickOrderScreen` | Quick Order | `MANAGER_ORDERING_MODE` |
| `/(manager)/fulfillment` | `app/(manager)/fulfillment.tsx` | Fulfillment | | |
| `/(manager)/fulfillment-confirmation` | `app/(manager)/fulfillment-confirmation.tsx` | | Confirm / share | |
| `/(manager)/cart` | `app/(manager)/cart.tsx` | | Manager cart | Hidden from tab bar |
| `/(manager)/inventory` | `app/(manager)/inventory.tsx` | | Inventory CRUD | |
| `/(manager)/browse` | `app/(manager)/browse.tsx` | | Manager browse | |
| `/(manager)/manager-settings/quick-order-config` | `app/(manager)/manager-settings/quick-order-config.tsx` | | Parser examples / prompts | |
| `inventory-browse` | `app/inventory-browse.tsx` | | Shared browse entry | |
| `settings/*` | `app/settings/_layout.tsx` | | Nested settings | |
| `orders/*` | `app/orders/_layout.tsx` | | Order history/detail | |
| `/suspended` | `app/suspended.tsx` | | Suspended account | |

*(Many more routes exist under `app/` — see `glob app/**/*.tsx` for full list.)*

---

## 5. State Management

### `useAuthStore` — `src/store/authStore.ts`

- **Persist**: `babytuna-auth` (partialize: `location`, `user`, `profile`, `viewMode`).
- **State**: `session`, `user`, `profile`, `location`, `locations[]`, `isLoading`, `isInitialized`, `viewMode` (`employee` | `manager`).
- **Key actions**: `initialize`, `signIn`, `signInWithOAuth`, `signUp`, `completeProfile`, `signOut`, `deleteSelfAccount`, `fetchProfile`, `fetchUser`, `fetchLocations`, `updateDefaultLocation`, `updateUserRole`.
- **Supabase**: `profiles`, `users`, `locations`, RPC **`ensure_current_user_identity`** (repair), realtime subscription on `profiles` row.
- **Critical behavior**: **Auth transition IDs** + `clearUserScopedClientState` resets **order, draft, inventory, stock, fulfillment, tunaSpecialist** persisted stores on user switch/sign-out. **`registerSessionGetter`** wires `src/lib/api/client` to avoid `supabase.auth.getSession()` deadlocks on RN.
- **Fragile**: Race between `SIGNED_OUT` and recovery (`recoverUnexpectedSignedOutSession`); profile null handling during hydration (intentionally avoids redirect loops).

### `useInventoryStore` — `src/store/inventoryStore.ts`

- **Persist**: `inventory-storage` (items only, capped **2000** rows in partialize).
- **State**: `items`, `isLoading`, `error`, `lastFetched`, `hasFetchedThisSession`, filters.
- **fetchItems**: `listInventory` from API; fallback **`listInventoryDirect`** to `inventory_items` with optional column retry (`supplier_id`, `created_by`).
- **TTL**: 5 minutes unless `force`.

### `useOrderStore` — `src/store/orderStore.ts` + `orderStore.types.ts`

- **Persist**: `order-storage` — `cartByLocation`, **`managerCartByLocation`** (migrated into main cart on merge), `supplierDrafts`, `orderLaterQueue`, `pastOrders`, `pendingPastOrderSyncQueue`. *(Note: `lastOrderedCacheBySupplier` is in state type but **not** in partialize — in-memory only.)*
- **Cart**: `addToCart`, `updateCartItem`, `removeFromCart`, merge helpers in `store/helpers/cartHelpers.ts`. **Unified cart**: all writes set **`cartByLocation`** even when `context` is `manager`.
- **Submit**: `createAndSubmitOrder` → **`submitOrder` service** (RPC). Clears cart on success.
- **Fulfillment**: `loadFulfillmentData`, `fetchPendingFulfillmentOrders`, `markOrderItemsStatus`, `setSupplierOverride`, `createPastOrder`, `finalizeSupplierOrder`, order-later queue with **table capability flags** in module `tableFlags` (orderStore.helpers).
- **Consumes**: `useInventoryStore.getState()` inside **`normalizeCartItemUnitForSubmit`** to align unit with inventory.

### `useDraftStore` — `src/store/draftStore.ts`

- Separate **draft** map per location (not the main cart). Used for Quick Order tab badge (`draft` count in tabs layout).

### `useFulfillmentStore` — `src/store/fulfillmentStore.ts`

- **Legacy/simple**: checklists for fish/other, local **default suppliers**. Still persisted `babytuna-fulfillment`. Heavy fulfillment **state lives in `orderStore`**.

### `useSettingsStore` — `src/store/settingsStore.ts`

- Local reminder/notification/export/stock UI preferences (`@/types/settings`).

### `useDisplayStore` — `src/store/displayStore.ts`

- **theme**, **textScale**, **uiScale**, **buttonSize**, **`hapticFeedback`**, **`reduceMotion`** — drives scaled UI and haptics wrapper.

### `useStockStore` — `src/store/stockStore.ts`

- Stock check sessions, area items, pending updates; API in `src/lib/api/stock.ts`.

### `useTunaSpecialistStore` — `src/store/tunaSpecialistStore.ts`

- Voice/specialist conversation (see `src/features/smart/`).

**`useShallow`**: Not globally mandated; stores use fine-grained selectors `(s) => s.field` in layouts. When selecting multiple fields, use Zustand `shallow` compare if needed to avoid re-renders (pattern not centralized in one file).

---

## 6. Data Models and Types

Primary definitions: **`src/types/database.ts`** (domain) and **`src/store/orderStore.types.ts`** (cart/fulfillment client shapes).

| Concept | Type / file | Notes |
|---------|-------------|-------|
| **Inventory item** | `InventoryItem` in `database.ts` | `id`, `name`, `category`, `supplier_category`, `supplier_id`, `base_unit`, `pack_unit`, `pack_size`, `active`, aliases |
| **Cart item** | `CartItem` in `orderStore.types.ts` | `inputMode` `quantity` \| `remaining`, dual quantity fields, `wasSuggested`, `note` |
| **Order** | `Order`, `OrderWithDetails` in `database.ts` | Includes `order_type`, optional **`entry_method`**, **`quick_session_id`**, **`manager_review_status`** |
| **Parsed Quick Order item** | `ParsedQuickOrderItem` in `src/features/ordering/quickOrderItems.ts` | Rich normalization, `needs_clarification`, `unresolved`, match metadata |
| **Quick Order message** | Local `QuickOrderMessage` in `QuickOrderScreen.tsx` | `role`, `text`, optional `parsedItems`, `pendingClarifications`, `suggestions`, `flags` |
| **Fulfillment grouping** | `FulfillmentLocationGroup`, supplier draft types | `orderStore.types.ts` |
| **Profile / user** | `Profile`, `User` | Role, suspension, provider |

**Naming pitfalls**

- **`order_type`** (RPC / DB) vs **`entry_method`** (quick order source) — both exist on orders; **see §7/SUPABASE doc for RPC vs column wiring**.
- **`CartContext`**: `'employee' \| 'manager'` — getter uses context; persistence is unified into `cartByLocation`.

---

## 7. Supabase Architecture

**See `SUPABASE_AND_DATABASE_SUMMARY.md`** for table-by-table detail and migration index.

**Client**: `src/lib/supabase.ts` — `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

**Edge Function `parse-order`**: Authenticates JWT via **`supabase.auth.getUser`**, loads **`profiles.is_suspended`**, reads **`app_config`**, enforces **daily `parser_usage_log` limit** and **monthly token budget** (for live mode), loads catalog from **`area_items` + inventory join**, runs **`parseQuickOrder`** (`orchestrator.ts`).

**Atomic submit**: **`submit_order_rpc`** — only path in TS that creates orders (`orderSubmission.ts` raw `fetch` with Bearer token).

---

## 8. Quick Order System Deep Dive

**See `QUICK_ORDER_DEEP_DIVE.md`** for the full step-by-step (frontend + `parse-order` internals, sequence diagram, race conditions).

**One-sentence architecture**: Chat + local merge layer + Edge parser; **confirm** = copy to **real cart**; **abandon session** row best-effort.

---

## 9. Normal Ordering / Cart Flow

1. **Browse**: `EmployeeBrowseInventoryScreen` / manager browse → `useInventoryStore.items`.
2. **Add to cart**: `useOrderStore.addToCart(locationId, inventoryItemId, qty, unitType, options)` — merges lines via **`mergeCartItem`** (same SKU + unit + mode rules).
3. **Edit**: `updateCartItem`, per-line notes, remaining-mode **decisions** via `setCartItemDecision`.
4. **Submit**: Cart screen calls `createAndSubmitOrder` / similar → **`submitOrder`** with **`cartItemToPayload`** items (`OrderItemPayload`: inventory id, quantity, unit, input_mode, note, suggested flags).
5. **Confirmation**: Overlay / navigation per `CartScreenView`, `OrderSubmissionConfirmationOverlay`.
6. **`entry_method`**: **Not set by current `submit_order_rpc` client payload** — DB defaults and RPC insert fields documented in Supabase summary (**verify** Quick Order vs manager review expectations).

**Items disappearing**: filter **`isSubmittableCartItem`** removes zero-qty lines; **remaining mode** needs decisions; cart clear after **successful** submit only.

---

## 10. Fulfillment and Manager Flow

- **Routes**: `(manager)/fulfillment`, `fulfillment-confirmation`, `fulfillment-history`, `export-fish-order`, past orders.
- **Data**: `orderStore.fetchPendingFulfillmentOrders` → **`loadPendingFulfillmentData`** excludes lines consumed by **`past_orders`** tracking; merges **supplier** resolution.
- **Quick Order review**: **`QuickOrderReviewQueueScreen.tsx`** queries orders with **`entry_method.eq.quick_order` OR `quick_session_id` not null** — **if DB never sets these on submit, queue may be empty** (integration risk).
- **Grouping**: Supplier cards (`FulfillmentSupplierCard`, etc.), location group sushi/poki from **`normalizeLocationGroup`**.

---

## 11. Inventory Management

- **Load**: `useInventoryStore.fetchItems` — API + direct query fallback; active-only filter client-side.
- **Aliases**: `inventory_items.aliases` **text[]**, GIN index (migration); parser catalog includes aliases.
- **Units**: `base_unit`, `pack_unit`, `pack_size`, **`allowed_units`** (migration `quick_order_parser_resilience`); normalization **`src/lib/inventoryUnits.ts`**.
- **CRUD**: Manager inventory screen + `addItem` / `updateItem` / soft **`deleteItem`** (`active: false`).
- **Quick Order dependency**: Parser catalog from **`area_items`** scoped to **storage areas at `location_id`** — if area mapping missing, **catalog can be empty** (`catalog_empty` response).

---

## 12. UI and Design System

- **Tokens**: `src/theme/design.ts` — `colors`, `grayScale`, `primaryScale`, `spacing`, `radii`, `typography`, `glass.*` preset styles, `glassSpacing`, `glassHairlineWidth`.
- **Glass**: `src/components/ui/GlassSurface.tsx`, `GlassView.tsx` — prefer these over ad-hoc borders.
- **Haptics**: `src/lib/haptics.ts` only.
- **Safe area / keyboard**: Quick Order uses **`quickOrderChatLayout.ts`**, `calculateQuickOrderBottomPadding`, `Keyboard` listeners, **`getTabBarBottomInset`** from `@/components/navigation`.
- **Motion**: Respect **`useDisplayStore` `reduceMotion`** (root Stack `animation: 'none'` when set).

---

## 13. Authentication and Roles

- **Roles**: `employee` | `manager` on `users` / `profiles`; **access codes** assign role on signup (`validateAccessCode` service).
- **`viewMode`**: Managers can flip UI between employee-style tabs and manager tabs (stored persisted with auth).
- **Guards**: `resolveProtectedAuthGuard` — requires **`profile.profile_completed`**, not suspended.
- **OAuth**: `expo-auth-session` redirect **`babytunasystems://auth/callback`**; `WebBrowser.openAuthSessionAsync`.

---

## 14. Error Handling and Edge Cases

| Edge case | Handling |
|-----------|----------|
| Parser LLM timeout / failure | `LLM_TIMEOUT_MS` 8000; deterministic path still runs; `llm_failed` metrics; safe parse failure message |
| Empty catalog for location | `catalog_empty` from `area_items` query |
| `needs_clarification` / conflicts | `pending_clarifications` + local `applyQuickOrderClarificationAction` |
| Quantity missing | **`getQuantityFixQueue`** → `QuickOrderQuantitySheet` / `quickOrderQuantityFlow.ts` |
| Session persist failure | Logged; **local state kept** |
| Order submit timeout | 12s abort → `OrderSubmissionError` `TIMEOUT` |
| Stale inventory cache | 5 min TTL; Quick Order loads inventory on confirm via **`loadInventoryItems`** |
| Manager fulfillment missing quick orders | **Verify `entry_method` / `quick_session_id` populated on order insert** |

---

## 15. Testing

- **Framework**: Jest + ts-jest; tests under **`src/__tests__/**/*.test.ts`**.
- **Commands**: `npx jest` (no npm script in `package.json`).
- **Existing areas**: `quickOrderParser`, `quickOrderCart`, `quickOrderChatLayout`, `quickOrderQuantityFlow`, `quickOrderHistorySuggestions`, `quickOrderUiHelpers`, `cartHelpers`, `orderSubmission`, `authStore`, `inventoryStore`, `inventoryUnits`, `useAuthGuard`, `apiClient.deleteSelf`, `pastOrderHelpers`, `supplierDraftHelpers`.

**High-value additions**: integration test **cart + Quick Order confirm**; **submit_order** payload snapshot; **fulfillmentDataSource** grouping; **parser orchestrator** golden cases; **`mergeCartItem`** duplicates across unit types.

---

## 16. Environment and Deployment

- **Dev**: `npx expo start`, `expo run:ios` / `android`.
- **EAS**: `eas.json` — `development`, `preview`, `production` channels; **remote appVersionSource**.
- **Expo**: `app.json` — slug `babytuna-systems`, iOS bundle `com.babytuna.systems`, EAS projectId in `extra.eas`.
- **Env vars**: **`EXPO_PUBLIC_SUPABASE_URL`**, **`EXPO_PUBLIC_SUPABASE_ANON_KEY`** (required). Edge: **`SUPABASE_URL`**, **`SUPABASE_SERVICE_ROLE_KEY`**, **`GEMINI_API_KEY`** / **`GOOGLE_API_KEY`**, **`ANTHROPIC_API_KEY`**, optional **`PARSE_ORDER_LLM_PROVIDER`**.

---

## 17. Known Risk Areas

| Area | Path | Risk | Mitigation |
|------|------|------|------------|
| Auth hydration | `authStore.ts` | Complex transitions / stale listeners | Preserve transition IDs; avoid blocking sign-in on repair |
| Unified cart + context | `orderStore.ts` | Wrong `getCartByContext` assumption | Test manager vs employee flows |
| Quick Order → DB order metadata | `submit_order_rpc` vs `orders.entry_method` | Manager review / fulfillment filters **may not see quick orders** | Align RPC or client to set **`entry_method` / `quick_session_id`** |
| Parser catalog | `area_items` join | Empty catalog for new locations | Storage area setup |
| LLM reconciliation | `orchestrator.ts` | Hallucinated ids | Validator + catalog index guards |
| Past order offline queue | `orderStore` | Duplicate or stuck `pending_sync` | NetInfo flush; inspect `pendingPastOrderSyncQueue` |
| SecureStore session size | `supabase.ts` | Chunked storage | Avoid huge JWT payloads in custom claims |

---

## 18. Troubleshooting Guide

| Symptom | Likely files | Checks |
|---------|--------------|--------|
| Quick Order “no items” | `parse-order` catalog, `area_items` | Edge logs `catalog_count`; DB area mapping |
| Invoke 429 / disabled | `app_config`, `parser_usage_log` | Keys `quick_order_enabled`, daily limit |
| Cart confirm fails | `quickOrderCart.ts`, `quickOrderItems.getParsedItemIssue` | All lines resolved + qty |
| Order not in fulfillment | `fulfillmentDataSource.ts`, order status, **`entry_method`** | Query `orders` row |
| Auth bounce | `useAuthGuard.ts`, `authStore` | `profile_completed`, `isLoading` |
| Keyboard hides composer | `QuickOrderScreen`, `quickOrderChatLayout` | `calculateComposerInputMaxHeight`, snap delays |

---

## 19. How Future AI Should Modify This Codebase

1. **Read callers first** before changing `orderStore` helpers (merge semantics affect production money).
2. **Keep `app/` routes thin**; implement in `src/features/`.
3. **Use design tokens** from `theme/design.ts` and **`GlassSurface`** patterns.
4. **Haptics** only through **`src/lib/haptics.ts`**.
5. **Parser changes**: prefer **catalog-driven** fixes in **`supabase/functions/parse-order`** (`validator.ts`, `catalog-matcher.ts`, `deterministic-parser.ts`) over item-specific hacks in UI.
6. **Schema**: always add **migration** under `supabase/migrations/`; never only change remote DB.
7. **Orders**: use **`submit_order_rpc`** only path for writes; use raw fetch pattern to avoid RN deadlock.
8. **Tests**: add **jest** tests for pure helpers when touching merge/parser logic.
9. **Roles**: do not expose manager-only mutations to employee UI without guard.

---

## 20. File-by-File Index

**See `FILE_BY_FILE_INDEX.md`** for a dense per-file export list (too long to embed here without diluting navigation).

---

## 21. Glossary

- **Quick Order**: NL chat flow → Edge `parse-order` → parsed lines → confirm → cart → RPC submit.
- **Parsed item**: Structured line (`ParsedQuickOrderItem`) with optional `item_id`, quantity, unit, flags.
- **needs_clarification**: Parser/user must choose (unit conflict, duplicate line, etc.).
- **Alias**: String in `inventory_items.aliases[]` for matching.
- **Parser example**: Row in **`parser_examples`** seeding LLM / tests.
- **Parser correction**: Row in **`parser_corrections`** (user-corrected mapping) scoped by user + optional location.
- **Session**: **`quick_order_sessions`** row: `messages` jsonb, `parsed_items` jsonb, `status`.
- **Cart item**: `CartItem` in Zustand persist.
- **Order payload**: `OrderItemPayload[]` inside **`submit_order_rpc`** request.
- **Fulfillment**: Manager workflow on **submitted** orders / order_lines / supplier drafts / past orders.
- **Supplier grouping**: Roll up lines by resolved **supplier** (with override support).
- **Location grouping**: **Sushi vs poki** buckets for some UX.
- **entry_method**: `orders` column: `manual` | `quick_order` | `voice_order` | `suggested_order` (default manual if not set).

---

## 22. Final “Context Packet” (< 3000 words)

**Babytuna Inventory System** is an **Expo SDK 54** React Native app using **Expo Router** (file routes in `app/`), **Zustand** persisted stores, **NativeWind v4**, **Reanimated**, **FlashList**, and **Supabase** (Auth + Postgres + Realtime + **Edge Functions**). Domain code lives in **`src/features`** (ordering, cart, browse, fulfillment, stock-check, home, smart, settings) with **thin `app/*.tsx` wrappers**.

**Auth** (`useAuthStore`): Supabase session in **SecureStore**-backed client; profile sync; Google/Apple OAuth; **ensure_current_user_identity** repair RPC; realtime profile updates. **viewMode** toggles **`/(tabs)`** vs **`/(manager)`** home. Guards in **`useProtectedAuthGuard`**.

**Inventory** (`useInventoryStore`): loads **`inventory_items`** via API **`listInventory`** with **direct Supabase fallback**; 5-minute cache; supports CRUD and soft-delete.

**Cart and orders** (`useOrderStore`): **`cartByLocation`** is the **single unified cart** (manager migration merges legacy `managerCartByLocation`). Submit uses **`submitOrder`** in **`src/services/orderSubmission.ts`**: single **`POST /rest/v1/rpc/submit_order_rpc`** with **`useAuthStore.getState().session.access_token`** (avoids JS client deadlock). Payload built by **`cartItemToPayload`** from **`store/helpers/cartHelpers.ts`**. Fulfillment adds **supplier drafts**, **order_later** queue, **past_orders** sync jobs, **`markOrderItemsStatus`**, **supplier_override_id** updates.

**Quick Order**: UI **`src/features/ordering/QuickOrderScreen.tsx`** (~2.5k lines) — local **`messages`**, **`parsedItems`**, **`pendingClarifications`**, **`sessionId`**; persists to **`quick_order_sessions`**; **`handleSubmitMore`** calls **`supabase.functions.invoke('parse-order', { body: { raw_text, location_id, session_id, user_id }})`**; normalizes with **`normalizeQuickOrderParseResponse`** (`quickOrderResponse.ts`); merges via **`mergeQuickOrderParsedItemsDetailed`** (`quickOrderItems.ts`); applies **`applyQuickOrderOperations`** for command intents; auto-opens **`QuickOrderQuantitySheet`** via **`quickOrderQuantityFlow`**. **Confirm** (`handleConfirmOrder`) requires **`areQuickOrderItemsCartReady`** → **`quickOrderItemsToCartAdds`** → **`addToCart`** with **`mode.scope`** (`employee` vs `manager`) → **`router.push(mode.cartRoute)`**; session marked **`abandoned`** and cleared. **Quick Order does not call `submit_order_rpc`**.

**Edge `parse-order`** (`supabase/functions/parse-order/index.ts`): Validates Bearer token + not suspended; reads **`app_config`** (`quick_order_parser_mode`: per DB comment **`live` \| `mock` \| `auto`**; **`index.ts`** enables LLM when mode is **`live`**, or **`auto`** and an API key exists — otherwise deterministic-only; `quick_order_enabled`, limits, **`quick_order_unit_synonyms`**) — applies **`configureUnitAliases`**. Fetches **location catalog** from **`area_items`** join, **`parser_examples`**, **`quick_order_sessions`** history, **`parser_corrections`**, RPCs **`get_dow_suggestions`**, **`get_recent_orders`**. Runs **`parseQuickOrder`** in **`orchestrator.ts`**: **deterministic parse** → catalog index → optional **LLM** (`callGemini` / `callClaude`, temperature 0, JSON) for unresolved lines; conflict + duplicate logic; returns **`parsed_items`**, **`pending_clarifications`**, **`operations`**, **`diagnostics`** (`PARSER_VERSION` string). Logs usage to **`parser_usage_log`**.

**Design**: **`src/theme/design.ts`** tokens; **`GlassSurface`**; haptics wrapper; tab bar insets **`getTabBarBottomInset`**.

**Top fragility**: (1) **Quick Order confirmed orders** may still store **`entry_method: 'manual'`** and **`quick_session_id: null`** if no DB trigger/client sets them — **manager Quick Order review query may miss them**. (2) **Catalog** entirely depends on **`area_items`** for a location. (3) **Auth** transition complexity. (4) **LLM** timeouts / partial JSON. (5) **Past order** offline queue reconciliation.

**Safe edits**: touch **helpers** + **tests** first; mirror existing **Zustand persist merge** patterns; avoid `supabase.auth.getSession()` in API hot paths; keep **RPC** as single write gateway for orders.

---

## Deliverables checklist (for the human operator)

- **Could not inspect in full detail**: Every non-TypeScript asset; all `android/` / `ios/` native dirs; individual migration file bodies beyond grep/read samples; runtime **production** Supabase project data; **`node_modules`** contents; exhaustive listing of every `app/*.tsx` line.
- **Assumptions**: `submit_order_rpc` definition in latest applied migration matches `20260401113000_*` excerpt (orgs may have drift); EAS secrets not visible in repo.
- **Top 10 fragile areas**: (1) `entry_method` / `quick_session` vs Cart submit, (2) `area_items` catalog gating, (3) `authStore` transitions, (4) LLM fallback reconciliation, (5) unified cart `context` confusion, (6) past order sync, (7) `order_items.status` column presence, (8) manager fulfillment badge raw SQL in `_layout`, (9) inventory cache staleness vs parser, (10) SecureStore size limits.
- **Top 10 tests to add**: (1) Quick Order confirm → cart payload equality, (2) `mergeCartItem` duplicate SKUs different units, (3) `submit_order_rpc` payload validation rejects zero qty, (4) parser `resolveParsedItemConflicts` additive vs replace, (5) `fulfillmentDataSource` quick_order filter, (6) `area_items` empty catalog handling, (7) `normalizeQuickOrderParseResponse` error codes, (8) `quickOrderQuantityFlow` multi-item queue, (9) auth guard profile null loading, (10) `parser_usage_log` rate limit branch (mocked).
