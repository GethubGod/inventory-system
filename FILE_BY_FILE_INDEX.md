# File-by-File Index (Babytuna Inventory System)

Dense index for **navigation and impact analysis**. Paths relative to repo root.

---

## Root config

| Path | Purpose |
|------|---------|
| `package.json` | Expo entry `expo-router/entry`; deps (Expo 54, RN 81, NativeWind, Zustand, Supabase); scripts **no jest** |
| `app.json` | Expo config, plugins (router, secure-store, camera, speech, splash), EAS projectId, updates URL |
| `tsconfig.json` | Strict; `@/*` → `src/*` |
| `babel.config.js` | `babel-preset-expo`, nativewind |
| `metro.config.js` | `withNativeWind`, `global.css` |
| `jest.config.js` | `src/__tests__`, ts-jest, path mapper |
| `eas.json` | development/preview/production profiles; submit metadata |
| `global.css` | NativeWind entry (referenced by metro) |

---

## `app/` (Expo Router)

| Path | Imports | Notes |
|------|---------|-------|
| `app/_layout.tsx` | `Stack`, `useAuthStore`, realtime hooks | Root; **supabaseConfigError** gate; subscriptions when `session` |
| `app/index.tsx` | `useProtectedAuthGuard`, `getAuthenticatedHomeHref` | Redirect hub |
| `app/(auth)/_layout.tsx` | auth stack | |
| `app/(auth)/login.tsx` | login UI | |
| `app/(auth)/signup.tsx` | signup | access code |
| `app/(auth)/complete-profile.tsx` | profile completion | |
| `app/(tabs)/_layout.tsx` | `Tabs`, cart/draft badges | **Employee** shell |
| `app/(tabs)/index.tsx` | employee home | |
| `app/(tabs)/quick-order.tsx` | `QuickOrderScreen`, `EMPLOYEE_ORDERING_MODE` | Thin |
| `app/(tabs)/cart.tsx` | cart feature | |
| `app/(tabs)/stock-check.tsx` | stock | |
| `app/(tabs)/settings.tsx` | settings hub | |
| `app/(manager)/_layout.tsx` | manager tabs, fulfillment badge SQL | **Realtime** orders/order_items |
| `app/(manager)/quick-order.tsx` | `MANAGER_ORDERING_MODE` | |
| `app/(manager)/fulfillment.tsx` | fulfillment screen | |
| `app/(manager)/fulfillment-confirmation.tsx` | confirm | |
| `app/(manager)/cart.tsx` | hidden manager cart | |
| `app/(manager)/manager-settings/quick-order-config.tsx` | manager parser config | |
| `app/(manager)/browse.tsx`, `inventory.tsx`, `orders.tsx`, … | manager tools | |
| `app/inventory-browse.tsx` | shared browse | |
| `app/settings/*` | nested settings routes | display, notifications, reminders, … |
| `app/orders/*` | history/detail | |
| `app/suspended.tsx` | suspended account | |

---

## `src/store/`

| Path | Exports / role |
|------|----------------|
| `store/index.ts` | Barrel: all stores + key types |
| `store/authStore.ts` | `useAuthStore` — auth, profile, OAuth, identity repair, user-scoped reset |
| `store/inventoryStore.ts` | `useInventoryStore` — items, fetch with fallback |
| `store/orderStore.ts` | `useOrderStore` — cart, submit, fulfillment, past orders, order-later |
| `store/orderStore.types.ts` | `CartItem`, fulfillment types, `OrderState` interface |
| `store/orderStore.helpers.ts` | Re-exports `./helpers` |
| `store/draftStore.ts` | `useDraftStore` — draft items map per location |
| `store/fulfillmentStore.ts` | `useFulfillmentStore` — legacy checklist (Sets) |
| `store/settingsStore.ts` | `useSettingsStore` — local prefs from `@/types/settings` |
| `store/displayStore.ts` | `useDisplayStore` — theme, scales, **haptics** toggle, reduce motion |
| `store/stockStore.ts` | `useStockStore` — stock sessions, pending updates |
| `store/tunaSpecialistStore.ts` | specialist conversation state |

### `src/store/helpers/`

| Path | Key exports |
|------|-------------|
| `helpers/index.ts` | Barrel — cart, past order, supplier draft, shared, quickOrderCart |
| `helpers/cartHelpers.ts` | **`mergeCartItem`**, **`cartItemToPayload`**, submittable checks |
| `helpers/pastOrderHelpers.ts` | Past order normalization, consumed id extraction |
| `helpers/supplierDraftHelpers.ts` | Draft/order-later normalization |
| `helpers/sharedHelpers.ts` | **`tableFlags`**, network/missing column detection, order-later notifications |
| `helpers/quickOrderCart.ts` | **`areQuickOrderItemsCartReady`**, **`quickOrderItemsToCartAdds`** |

---

## `src/features/ordering/` (Quick Order + related)

| Path | Role |
|------|------|
| `QuickOrderScreen.tsx` | Main chat + session + invoke + confirm; **source of truth** for Qo UX |
| `QuickOrderListCard.tsx` | Floating order list / confirm |
| `QuickOrderUserMessage.tsx` | User bubble |
| `QuickOrderItemRow.tsx` | Parsed line UI |
| `QuickOrderItemEditModal.tsx` | Edit parsed item |
| `QuickOrderQuantitySheet.tsx` | Missing qty / unit sheet |
| `QuickOrderShortcutChips.tsx` | Starters |
| `QuickOrderReviewQueueScreen.tsx` | Manager review queue (entry_method / session join) |
| `QuickOrderConfigScreen.tsx` | Examples / config UI |
| `quickOrderItems.ts` | Parsed item model, merge, clarifications, operations |
| `quickOrderResponse.ts` | API normalization |
| `quickOrderErrors.ts` | User-facing errors |
| `quickOrderChatLayout.ts` | Keyboard/composer math |
| `quickOrderQuantityFlow.ts` | Multi-step quantity fixes |
| `quickOrderHistorySuggestions.ts` | Client-side history qty hints |
| `quickOrderShortcuts.ts` | Shortcut definitions |
| `quickOrderEmptyStateLayout.ts` | Empty state |
| `UnitSegmentedControl.tsx`, `QuantityStepper.tsx` | Controls |
| `PreviousQuantitySuggestionCard.tsx` | Suggestion UI |
| `modes.ts` | **`EMPLOYEE_ORDERING_MODE`**, **`MANAGER_ORDERING_MODE`** |
| `types.ts` | `OrderingMode` |
| `dailySuggestions.ts`, `orderInsights.ts`, `SmartOrderScreen` links | Related smart flows |

---

## `src/features/cart/`

| Path | Role |
|------|------|
| `CartScreenView.tsx` | Cart UI |
| `EmptyCartReorderState.tsx` | Empty state |
| `OrderSubmissionConfirmationOverlay.tsx` | Post-submit overlay |
| `orderConfirmation.ts` | Helpers |
| `locationSwitch.ts` | Location change behavior for cart |

---

## `src/features/browse/`

| Path | Role |
|------|------|
| `EmployeeBrowseInventoryScreen.tsx` | Employee browse |
| `ManagerBrowseInventoryScreen.tsx` | Manager browse |
| `BrowseInventoryScreenView.tsx` | Shared view |
| `BrowseItemRow.tsx` | Row |
| `config.ts` | Browse constants |

---

## `src/features/fulfillment/`

| Path | Role |
|------|------|
| `components/*` | Cards, headers, expanded rows, schedule modals, banners |
| `components/index.ts` | Barrel |

---

## `src/features/stock-check/`

| Path | Role |
|------|------|
| `StockCheckScreenView.tsx`, `StockHomeScreen.tsx`, `PastChecksScreen.tsx` | Flows |
| `useStockCheckStore.ts` | Local stock-check UI state |
| `components/*` | Wheel pickers, bottom sheets, progress |
| `utils/stockMath.ts` | Pure math |
| `types.ts` | Feature types |

---

## `src/features/home/`

| Path | Role |
|------|------|
| `EmployeeHomeScreen.tsx`, `ManagerHomeScreen.tsx` | Home |
| `HomeScreenView.tsx` | Layout |
| `modes.ts`, `components/HomeScreenPrimitives.tsx` | |

---

## `src/features/smart/`

| Path | Role |
|------|------|
| `SmartOrderScreen.tsx` | Smart/voice-style ordering |
| `useDailySuggestions.ts`, `dailySuggestions.ts` | Suggestions hook/data |

---

## `src/features/settings/`

| Path | Role |
|------|------|
| `settingsSections.ts` | Section metadata |

---

## `src/services/`

| Path | Role |
|------|------|
| `orderSubmission.ts` | **`submitOrder`**, **`syncProfileAfterOrder`**, **`generateUUID`**, `OrderSubmissionError` |
| `orderValidation.ts` | **`validateSubmitRequest`**, payload types |
| `fulfillmentDataSource.ts` | **`loadPendingFulfillmentData`**, grouping prep, types |
| `supplierResolver.ts` | Supplier resolution + issues |
| `accessCodes.ts` | **`validateAccessCode`** |
| *(others)* | grep `src/services` for full list |

---

## `src/lib/`

| Path | Role |
|------|------|
| `supabase.ts` | **Singleton client**, SecureStore adapter |
| `haptics.ts` | **`triggerSelectionHaptic`**, etc. |
| `api/client.ts` | HTTP helpers, **`listInventory`**, **`deleteSelfAccountRequest`**, session getter |
| `api/stock.ts` | Stock RPC/API wrappers |
| `inventoryUnits.ts` | Unit normalization |
| `perf.ts` | `perfMark` / `perfMeasure` |

---

## `src/hooks/`

| Path | Role |
|------|------|
| `useAuthGuard.ts` | **`useProtectedAuthGuard`**, **`getAuthenticatedHomeHref`**, `resolveProtectedAuthGuard` |
| `useResolvedActiveLocation.ts` | Location resolution |
| `useScaledStyles.ts` | Display scaling |
| `useOrderSubscription.ts`, `useInventorySubscription.ts` | Realtime |
| *(others)* | |

---

## `src/components/` & `src/components/ui/`

| Path | Role |
|------|------|
| `components/index.ts` | Barrel |
| `ui/GlassSurface.tsx`, `GlassView.tsx` | Glass cards |
| `ui/StackScreenHeader.tsx`, `UnitTypeSegmentedControl.tsx` | |
| `navigation/*` | Tab bar config, **`getTabBarBottomInset`** |

---

## `src/types/`

| Path | Role |
|------|------|
| `database.ts` | Domain types (User, Profile, Order, InventoryItem, reminders, …) |
| `settings.ts` | Settings/default structs |
| `index.ts` | Re-exports |

---

## `supabase/functions/parse-order/`

| Path | Role |
|------|------|
| `index.ts` | HTTP handler, auth, config, catalog fetch, invoke **`parseQuickOrder`**, logging |
| `orchestrator.ts` | **`parseQuickOrder`**, **`PARSER_VERSION`** |
| `deterministic-parser.ts` | Line parsing |
| `catalog-matcher.ts`, `catalog-search-index.ts` | Search/match |
| `validator.ts` | Post-parse validation |
| `input-classifier.ts` | Intent |
| `operations.ts` | Command ops |
| `conflicts.ts` | Duplicate / repeat list |
| `llm-fallback.ts` | Focused LLM repair |
| `units.ts` | Allowed units + alias config |
| `types.ts` | Edge types |

---

## `src/__tests__/`

| Path | Covers |
|------|--------|
| `quickOrderParser.test.ts` | Parser-related |
| `quickOrderCart.test.ts` | Cart bridge |
| `quickOrderChatLayout.test.ts` | Layout math |
| `quickOrderQuantityFlow.test.ts` | Quantity flow |
| `quickOrderHistorySuggestions.test.ts` | History |
| `quickOrderUiHelpers.test.ts` | UI helpers |
| `cartHelpers.test.ts` | Merge/payload |
| `orderSubmission.test.ts` | Submit validation |
| `authStore.*.test.ts` | Auth |
| `inventoryStore.test.ts`, `inventoryUnits.test.ts` | Inventory |
| `pastOrderHelpers.test.ts`, `supplierDraftHelpers.test.ts` | Fulfillment helpers |
| `useAuthGuard.test.ts` | Guards |
| `apiClient.deleteSelf.test.ts` | API |

---

## Documents in repo (non-code)

| Path | Note |
|------|------|
| `CODEBASE_FULL_CONTEXT_SUMMARY.md` | This project’s master summary |
| `QUICK_ORDER_DEEP_DIVE.md` | Quick Order only |
| `SUPABASE_AND_DATABASE_SUMMARY.md` | DB/Edge |
| `FILE_BY_FILE_INDEX.md` | This file |
| `QUICK_ORDER_ARCHITECTURE.md` | Pre-existing doc — cross-check if stale |
