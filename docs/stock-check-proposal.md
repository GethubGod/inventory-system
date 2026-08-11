# Stock Check — Full Feature Proposal (Phase 9)

Status: proposal for David's review (2026-08-07). Builds on existing infra: `storage_areas`,
`area_items`, `stock_check_sessions`, `stock_updates`, `current_stock_snapshots`, the hidden
stock-check screens, `unit_conversions`, and `inventory_status_terms`.

## Goal

Fast, trustworthy counts that anyone on staff can do — and that directly feed the ordering
checklist, so counting and ordering become one connected loop instead of two chores.

## 1. Guided area walk-through — two views, one toggle

- Employee picks an area (Walk-in, Freezer, Dry storage, Front...) or taps "Full check".
- **Two counting views, toggleable at any time** (choice persists per user):
  - **Virtual Shelf view** — a spatial grid that mirrors the real shelf: rows and positions
    laid out exactly as items sit physically. Glance up at the shelf, glance down at the
    phone, tap the tile, punch the quantity. Counted tiles dim/check so you can see at a
    glance what's left.
  - **Checklist view** — a linear list in shelf order, same interaction style as the
    Simplified Ordering checklist. Best for quick reviews of a single section or for
    people who prefer a list.
- The manager arranges both once in the dashboard area editor: drag items into shelf order
  (drives the checklist) and into 2D grid positions (drives the virtual shelf).
- Progress bar per area, skip button per item, "area done → next area" flow, and sessions
  are resumable if interrupted mid-walk.

## 2. Count entry built for speed

- Big numeric pad + steppers; unit-aware (cases vs. singles via `unit_conversions`).
- Three quick-state buttons for items that don't need a precise number: **Full / Low / Out**
  (maps onto existing status-term infra).
- **Voice mode**: walk and talk — "nori two boxes… mayo three bottles… salmon out" — using
  the same pause-chunked incremental parsing already proven in Quick Order voice and tips.

## 3. Par levels

- Each item gets a **par** (target stock) and a **reorder point**, set by the manager on the
  dashboard — with AI-suggested initial values computed from order history.
- A count below the reorder point flags the item immediately.

## 4. Ordering integration (the payoff)

- Finishing a check computes **suggested order = par − counted**, rounded to order units.
- One button: **"Start order from this check"** → opens the Simplified Ordering checklist
  with those items pre-checked and quantities pre-filled. Counting flows straight into
  ordering; nothing is retyped.

## 5. Scheduling & accountability

- Recurring schedules per area or whole store (e.g., Freezer every Sunday 9pm), assigned to
  employees who have the `stock_check` module.
- Push reminder at the scheduled time, overdue nag, and a manager view of who completed
  what and when (reuses the existing reminders/push infrastructure).

## 6. Review & history

- Variance vs. the previous check, with big-swing flags (possible waste/theft/miscount).
- Per-item count history over time (small sparkline in item detail).
- Existing past-checks screen upgraded into this.

## 7. Offline-first sessions

- Walk-ins and freezers kill Wi-Fi. Counts persist locally as you go and sync when
  connectivity returns (queued, idempotent writes). A check never gets lost mid-walk.

## 8. Dashboard (manager)

- Latest snapshot per item + **stale list** (items not counted in X weeks — coverage gaps).
- Area editor: create areas, drag items into shelf order (checklist view) and into 2D
  grid positions (virtual shelf view).
- Par editor with AI-suggested values and per-item overrides.

## Later ideas (explicitly out of scope for v1)

- Shelf-photo AI counting (snap a photo, AI estimates counts).
- Expiry-date tracking for dated items; waste logging.

## Rollout inside Phase 9

- **9a (core):** walk-through in checklist view + fast entry + pars + "start order from
  this check". (Shelf-order sort via a simple ordered list editor.)
- **9b (polish):** virtual shelf view + 2D grid dashboard editor + the view toggle, voice
  mode, scheduling/accountability, variance review, offline hardening.

Review checkpoint: a full store check completed by a non-manager in one session, and the
resulting suggested order matches what the manager would have ordered by eye.
