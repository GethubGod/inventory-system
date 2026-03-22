# InventorySystem — Architecture & Contributor Guide

> **For anyone touching this codebase.** Follow these conventions to keep things organized and consistent.

---

## Directory Structure

```
app/                          # Expo Router — file-based routing
├── (auth)/                   # Authentication screens (login, register)
├── (tabs)/                   # Employee tab group
├── (manager)/                # Manager tab group
│   ├── manager-settings/     # Manager settings sub-route
│   └── past-orders/          # Past order routes (re-export stubs)
├── orders/                   # Shared order detail routes
└── settings/                 # Shared settings routes

src/
├── __tests__/                # Unit tests (Jest + ts-jest)
├── components/               # SHARED components (used by 2+ screens)
│   ├── navigation/           # TabButton, tabBarConfig (shared between layouts)
│   ├── settings/             # Settings-related components
│   ├── tuna-specialist/      # Tuna specialist UI components
│   └── ui/                   # Design primitives (GlassSurface, GlassView, etc.)
├── constants/                # App-wide constants (categories, labels, colors)
├── features/                 # Feature-scoped screen views + components
│   ├── browse/               # BrowseInventoryScreenView
│   ├── cart/                 # CartScreenView + hooks
│   ├── fulfillment/          # Fulfillment-specific components
│   │   └── components/       # FulfillmentConfirmItemRow, OrderLaterAddToSheet, etc.
│   ├── home/                 # EmployeeHomeScreen
│   ├── ordering/             # QuickOrderScreenView
│   └── smart/                # StockCheckView
├── hooks/                    # Custom React hooks
├── lib/                      # Low-level utilities (supabase, haptics, notifications)
├── services/                 # Business logic services (fulfillment, orders, etc.)
├── store/                    # Zustand state management
│   └── helpers/              # Domain-split helper functions for orderStore
│       ├── cartHelpers.ts
│       ├── sharedHelpers.ts
│       ├── pastOrderHelpers.ts
│       ├── supplierDraftHelpers.ts
│       └── index.ts          # Barrel re-export
├── theme/                    # Design tokens (THE single source of truth)
│   ├── design.ts             # All colors, spacing, radii, glass tokens
│   └── segmentedControls.ts  # Segmented control styles
└── types/                    # TypeScript type definitions
```

---

## Key Rules

### 1. Imports — Use the Right Path

| What | Import from | NOT from |
|---|---|---|
| Design tokens | `@/theme/design` | ~~`@/design/tokens`~~, ~~`@/constants/theme`~~ |
| Shared components | `@/components` | Direct file paths (unless needed) |
| Fulfillment components | `@/features/fulfillment/components` | ~~`@/components`~~ |
| Store types | `@/store` or `@/store/orderStore.types` | — |
| Haptics | `@/lib/haptics` | ~~`expo-haptics` directly~~ |

> **Never import `expo-haptics` directly in new code.** Always use `@/lib/haptics` — it respects the user's haptic feedback preference from `displayStore` and handles platform checks internally.

### 2. Zustand Stores — Selector Rules

**DO** — use `useShallow` for multi-field destructuring:
```ts
import { useShallow } from 'zustand/react/shallow';

const { user, locations } = useAuthStore(
  useShallow((state) => ({
    user: state.user,
    locations: state.locations,
  }))
);
```

**DO** — use individual selectors for single values:
```ts
const exportFormat = useSettingsStore((state) => state.exportFormat);
```

**DON'T** — destructure without a selector (causes re-renders on ANY store change):
```ts
// ❌ BAD — every store update re-renders this component
const { user, locations } = useAuthStore();
```

> **When to use `useShallow`:** Whenever you destructure 2+ fields from a store. It does a shallow comparison of the returned object so the component only re-renders when the selected fields actually change.

### 3. Components — Where to Put Them

| Scenario | Location |
|---|---|
| Used by **2+ screens** across route groups | `src/components/` |
| Used by **1 screen** or only within a feature | `src/features/<feature>/components/` |
| Design primitives (GlassSurface, etc.) | `src/components/ui/` |
| Navigation elements (TabButton, etc.) | `src/components/navigation/` |

When adding a new component:
1. Check if a similar component already exists
2. Place it in the correct directory based on usage scope
3. Export it from the directory's `index.ts` barrel file
4. Use `React.memo()` for list item components or components that receive stable props

### 4. Store Organization

The stores live in `src/store/`. The `orderStore` is the largest (2600+ lines) and uses domain-split helper files:

```
src/store/
├── authStore.ts              # Auth, session, profiles, locations
├── orderStore.ts             # Cart, orders, fulfillment, past orders
├── orderStore.types.ts       # TypeScript interfaces for orderStore
├── orderStore.helpers.ts     # Re-export barrel → helpers/
├── helpers/                  # Domain-split pure functions
│   ├── cartHelpers.ts        # Cart normalization, merging, context
│   ├── sharedHelpers.ts      # Table flags, error detection, notifications
│   ├── pastOrderHelpers.ts   # Past-order normalization, sync queue, cache
│   ├── supplierDraftHelpers.ts # Supplier drafts, order-later queue
│   └── index.ts              # Barrel
├── draftStore.ts             # Quick-order drafts per location
├── displayStore.ts           # UI/scale/haptic preferences
├── settingsStore.ts          # App settings, notifications, reminders
├── fulfillmentStore.ts       # Fulfillment checked items
├── inventoryStore.ts         # Inventory CRUD + caching
├── stockStore.ts             # Stock check sessions + offline queue
└── tunaSpecialistStore.ts    # Voice AI ordering
```

**Adding helper functions to `orderStore`:** Put them in the appropriate `helpers/*.ts` file, export from `helpers/index.ts`. The `orderStore.helpers.ts` barrel will automatically re-export.

### 5. Route Files — Thin Wrappers

Route files in `app/` should be **thin wrappers** that:
1. Import a feature view from `src/features/`
2. Pass route-level params/navigation props
3. Have minimal logic

**Good example** (`app/(tabs)/cart.tsx`):
```tsx
import CartScreenView from '@/features/cart/CartScreenView';
export default function CartScreen() {
  return <CartScreenView />;
}
```

**Don't** put 3000 lines of JSX directly in a route file. Extract the view into `src/features/`.

### 6. Haptic Feedback

Always use the shared utility:

```ts
import { triggerImpactHaptic, triggerNotificationHaptic, ImpactFeedbackStyle, NotificationFeedbackType } from '@/lib/haptics';

// Light tap feedback
triggerImpactHaptic(ImpactFeedbackStyle.Light);

// Success notification
triggerNotificationHaptic(NotificationFeedbackType.Success);

// Warning notification
triggerNotificationHaptic(NotificationFeedbackType.Warning);
```

This automatically:
- Checks `Platform.OS !== 'web'`
- Respects the user's `hapticFeedback` preference from `displayStore`
- Catches device-unsupported errors silently

### 7. Design Tokens

All colors, spacing, radii, and glass tokens live in **one file**: `src/theme/design.ts`.

```ts
import { colors, glassColors, glassRadii, glassSpacing } from '@/theme/design';
```

**Never create** alternative token files or re-export shims.

---

## Testing

### Running Tests
```bash
npx jest                    # Run all tests
npx jest --watch            # Watch mode
npx jest <filename>         # Run a specific test file
npx tsc --noEmit            # TypeScript check (no emit)
```

### Writing Tests

Tests go in `src/__tests__/`. All helper functions in `src/store/helpers/` are pure functions — ideal for testing.

For tests that import files with React Native dependencies, add mocks at the top:
```ts
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({}) } }));
jest.mock('@/lib/notifications', () => ({ getNotificationsModule: () => null }));
```

### Current Test Coverage
| Suite | Tests | What it covers |
|---|---|---|
| `orderSubmission.test.ts` | 29 | Validation, error classes, payload shape |
| `cartHelpers.test.ts` | 32 | Cart normalization, merging, searching |
| `pastOrderHelpers.test.ts` | 21 | Cache lookups, past-order normalization, sync |
| `supplierDraftHelpers.test.ts` | 24 | Draft normalization, order-later queue |

---

## Quick Reference — Adding a New Feature

1. **Create the view** in `src/features/<feature>/<FeatureName>ScreenView.tsx`
2. **Create a thin route** in `app/(tabs)/<route>.tsx` or `app/(manager)/<route>.tsx`
3. **Register the screen** in the layout's `<Tabs.Screen>` list (with `href: null` if not a primary tab)
4. **Add feature-specific components** in `src/features/<feature>/components/`
5. **Add shared components** in `src/components/` (only if used by 2+ screens)
6. **Use `useShallow`** for Zustand selectors
7. **Use `@/lib/haptics`** for haptic feedback
8. **Import tokens** from `@/theme/design`
9. **Write tests** in `src/__tests__/` for any pure-function logic

---

## Known Tech Debt

| Item | Why deferred |
|---|---|
| 3 huge screen files (inventory 122KB, fulfillment 110KB, fulfillment-confirm 108KB) | Need dedicated visual testing on device |
| ~15 inline `Haptics.*` calls in large screen files | Part of the screen file refactor |
| Some settings screens use bare `useStore()` without selectors | Low-priority — small screens with minimal re-render cost |
| Only 1 feature (orderSubmission) has integration-level tests | Testing infrastructure is basic |
