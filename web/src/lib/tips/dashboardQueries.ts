// The exact PostgREST selects and RPC the Tip Dashboard issues, in one place.
//
// The pages import these so the live schema check
// (__tests__/schemaContract.live.test.ts, `npm run check:schema`) exercises
// the same strings the browser sends. A column or function the database does
// not have yet fails there, before a deploy, instead of on the manager's
// screen. Tips v3 shipped its web half ahead of its migrations once; this is
// the seam that catches that.

import type { Database } from "@/types/database";

export const DASHBOARD_SELECTS = {
  locations: "id, name, tip_entries(business_date)",
  tip_employees: "id, name, location_id, active, sort_order",
  tip_employee_schedules: "id, tip_employee_id, location_id, weekday, meal, created_at",
  tip_location_access: "location_id, token_rotated_at, entry_token_plain",
  tip_entries:
    "id, business_date, location_id, meal_period, cash_amount, card_amount, gratuity_amount, entered_scope, raw_cash_amount, raw_card_amount, raw_gratuity_amount, note, note_at, split_count, entry_method, entered_by, flagged_anomaly, anomaly_reason, flag_verified_at, created_at, tip_entry_people(tip_employee_id, share_weight)",
  tip_entry_sessions: "id, location_id, closer_id, created_at",
} as const;

/** What the Fix dialog reads back before and after a manager correction. */
export const FIX_ENTRY_SELECT =
  "cash_amount, card_amount, gratuity_amount, entered_scope, raw_cash_amount, raw_card_amount, raw_gratuity_amount, split_count, note, tip_entry_people(tip_employee_id, share_weight)" as const;

export const FIX_ENTRY_RPC = "tip_manager_fix_entry" as const;

type FixEntryRpcArgs = Database["public"]["Functions"][typeof FIX_ENTRY_RPC]["Args"];

/**
 * Named arguments of the Tips v3 signature; PostgREST resolves overloads by
 * name set. `satisfies Record<keyof Args, true>` fails to compile if this list
 * and the generated RPC type (which also types the LedgerPage call) diverge in
 * either direction.
 */
export const FIX_ENTRY_RPC_ARGS = Object.keys({
  p_entry_id: true,
  p_cash: true,
  p_card: true,
  p_gratuity: true,
  p_entered_scope: true,
  p_raw_cash: true,
  p_raw_card: true,
  p_raw_gratuity: true,
  p_people: true,
  p_weights: true,
  p_note: true,
} satisfies Record<keyof FixEntryRpcArgs, true>) as ReadonlyArray<keyof FixEntryRpcArgs>;
