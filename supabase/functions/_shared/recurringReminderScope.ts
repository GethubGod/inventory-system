export type ReminderLocationGroup = "sushi" | "poki";

export interface ReminderOrderScope {
  location_id: string | null;
}

export interface ReminderRuleScope {
  scope: "employee" | "location";
  location_id: string | null;
  rule_kind?: string | null;
  location_group?: string | null;
}

/**
 * Orders arrive newest-first. Choose the newest order that belongs to the
 * reminder's own location context so activity at one store cannot suppress a
 * reminder for the other store.
 */
export function selectLatestOrderForReminder<T extends ReminderOrderScope>(
  orders: T[],
  rule: ReminderRuleScope,
  locationGroupById: Map<string, ReminderLocationGroup>,
): T | null {
  if (rule.scope === "location") {
    return orders.find((order) => order.location_id === rule.location_id) ?? null;
  }

  if (
    rule.rule_kind === "checklist_order_day" &&
    (rule.location_group === "sushi" || rule.location_group === "poki")
  ) {
    return orders.find((order) =>
      order.location_id !== null &&
      locationGroupById.get(order.location_id) === rule.location_group
    ) ?? null;
  }

  return orders[0] ?? null;
}
