# Phase 6 + 7 contract — checklist enrichment, receiving, invoices

Roadmap spec: `docs/ROADMAP.md` Phases 6–7. Binding seams.

## 6a — screenshot parse spike (report only, cheap)

- Deliverable is a WRITTEN REPORT (docs/phases/phase6a-spike-report.md) + a runnable
  prototype script (scripts/spike/parse-order-screenshot.mjs), NOT product code.
- Model access: mirror how existing AI edge fns call Gemini (inspect parse-order /
  quick-order-voice-parse for provider + model names). Locally the secret isn't
  available: the script takes GEMINI_API_KEY from env; with no key it runs in
  --dry-run mode printing the prompt + expected JSON schema. Synthetic fixtures:
  generate 6–10 fake order-screenshot PNGs (rendered text lists w/ varying formats,
  quantities, units, noise) + ground-truth JSON; measure per-item precision/recall and
  quantity accuracy when a key is provided.
- Fuzzy matching: reuse the alias infra concepts (employee_quick_order_aliases,
  quick_order_alias_rules) — the report must state how matched/unmatched split on the
  fixtures and the recommended prompt/model.
- Real screenshots stay on NEEDS-DAVID; the report notes results are synthetic-only.

## 6b — screenshot import (build after 6a exists; don't wait for real-image results)

Backend (Codex):
- Storage bucket `order-screenshots` (private) + migration for
  `historical_order_imports` reuse: inspect existing historical_order_imports/items
  tables and EXTEND them (status flow: uploaded → parsed → reviewed → merged;
  source 'screenshot'), additive only.
- Edge fn `parse-order-screenshot`: {importId} → downloads image(s) from Storage,
  Gemini parse (same provider plumbing as existing AI fns), writes
  historical_order_import_items (raw name, qty, unit, confidence, matched_item_id
  nullable via alias/fuzzy match), status 'parsed'. Batch-safe, idempotent per import.
- `merge_screenshot_import(p_import_id)` SQL fn: merges REVIEWED items into checklist
  stats — implemented as: imported rows become synthetic past-order signals the
  generate_order_checklist v1 reads (simplest correct: insert into
  historical_order_import_items final state and make generate_order_checklist UNION
  imported signals; document the exact approach taken).

Frontend (Claude):
- Dashboard: under /dashboard/ordering, an Import tab: multi-image upload to Storage
  (supabase-js), create import, trigger parse fn, poll status, then a REVIEW screen:
  parsed rows w/ confidence, unmatched rows highlighted with an inventory-item search
  to match or "skip" (nothing silently dropped — every row gets an explicit state),
  confirm → mark reviewed → merge. Per-import history list.

## 6c — holiday templates

Backend: `qo_holiday_overrides` exists — inspect. Additive migration for manager-configured
templates if the existing table doesn't fit: named template + date window +
item adjustments (add item w/ qty, or scale qty). SQL: checklist generation applies
active-window overrides; expose active_holiday_banner(p_user_id) or fold into the
checklist fetch.
Frontend: dashboard editor (template CRUD, date window, item list); app checklist
shows "Holiday: {name}" banner + adjusted pre-checks during the window.

## 7a — delivery receiving (placeholder, deliberately simple)

Backend: migration `order_receipts` (id, past_order_id ref, received_by, received_at,
status complete|partial) + `order_receipt_items` (receipt_id, past_order_item_id ref,
received boolean, received_qty numeric nullable, note text). RLS owner+manager.
Service: src/services/orderReceiving.ts — listReceivableOrders() (recent past_orders
for my location group w/o a complete receipt), getReceipt/startReceipt/saveReceiptLines.
Frontend: app screen from the checklist/orders surface: pick a sent order → check off
arrived items (default all checked; uncheck/short-qty flags discrepancy) → save.
Manager: discrepancies visible (dashboard ordering area section + in-app fulfillment
history badge — keep minimal).

## 7b — invoice reconciliation

Backend: Storage bucket `supplier-invoices`; migration `invoice_scans`
(id, past_order_id nullable ref, supplier_id text, uploaded_by, status, image_path) +
`invoice_scan_items` (raw_name, qty, unit, unit_price, total_price, matched_item_id,
matched_past_order_item_id, price_delta) + `supplier_price_history`
(supplier_id text, item_id, unit_price, observed_at, source invoice_scan_id).
Edge fn `parse-invoice` (same AI plumbing): extracts line items/prices; matcher marks
qty/price mismatches vs the linked sent order.
Frontend: app camera/photo flow from the receiving screen ("Scan invoice") → upload →
parsed compare view (matches, price changes highlighted, qty mismatches) → confirm
writes price history. Dashboard: per-supplier price history table.

## Verification

Every migration through scripts/local-db/verify-migrations.sh (orchestrator runs
Docker parts). AI fns: unit-test the pure parsing/matching helpers; live model calls
only behind env keys. App/web: usual typecheck/jest/vitest/build.

## Non-goals

No auto-send of anything, no supplier-facing surfaces, no changes to Quick Order
parse infra beyond alias reuse.
