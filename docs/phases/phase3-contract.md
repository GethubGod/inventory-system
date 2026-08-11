# Phase 3 contract — Per-user module toggles

Roadmap spec: `docs/ROADMAP.md` Phase 3. Binding seam between backend (Codex) and
frontend (Claude).

## Module keys (canonical, do not invent others)

`ordering_simple` | `ordering_advanced` | `stock_check` | `tips` | `fulfillment` (manager-side)

## Backend (Codex)

- Migration: `user_modules` (user_id uuid ref auth.users, module_key text check in the
  five keys, enabled boolean not null, updated_by uuid, updated_at timestamptz,
  pk (user_id, module_key)). RLS: user reads own rows; managers read/write all.
- Role defaults when no row exists — single SQL function `get_effective_modules(user_id)`
  returning (module_key, enabled), defaulting: employee → ordering_simple=false (until
  Phase 5 ships it), ordering_advanced=false, stock_check=true, tips=false;
  manager → all true incl. fulfillment. Defaults centralized here so app + web read one
  source of truth.
- `src/services/userModules.ts`:
  ```ts
  export type ModuleKey = 'ordering_simple' | 'ordering_advanced' | 'stock_check' | 'tips' | 'fulfillment';
  export interface ModuleState { key: ModuleKey; enabled: boolean; }
  export async function getMyModules(): Promise<ModuleState[]>;            // rpc get_effective_modules
  export async function getModulesForUser(userId: string): Promise<ModuleState[]>;
  export async function setUserModule(userId: string, key: ModuleKey, enabled: boolean): Promise<void>;
  export function subscribeToMyModules(onChange: () => void): () => void;  // supabase realtime on user_modules
  ```
- Realtime: enable replication for user_modules in the migration if the repo's other
  realtime tables do so — copy their pattern.
- 2b tie-in: accept-invite applies the invite's module_preset into user_modules.

## Frontend (Claude)

- App `(tabs)` / role layouts render tab sets from getMyModules + subscribeToMyModules —
  a toggle flips the tab live without re-login. Existing Quick Order surface renamed
  **"Advanced ordering (Beta)"**, gated by ordering_advanced. Keep the binary role gate
  as the outer boundary (modules refine within role, never grant manager surfaces to
  employees).
- Web dashboard: Team page gains a per-user module toggle matrix (five columns); invite
  modal presets modules (writes module_preset).
- In-app mirror: module toggles inside existing manager user-management screen.

## Verification

Typecheck + jest (app), web build. Realtime flip demonstrated against local stack
(ports 54421-54423): flip a row in SQL, observe subscription callback in a test/script.

## Non-goals

No new modules beyond the five keys. No employee-facing Phase 5 UI. Tips tab gating only
(the tab itself is Phase 4 — a `tips` key that shows nothing yet is fine and expected).
