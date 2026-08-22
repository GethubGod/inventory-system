import { selectLatestOrderForReminder } from "./recurringReminderScope.ts";

Deno.test("checklist reminders only consider orders from their location group", () => {
  const orders = [
    { id: "new-poki", location_id: "poki-id" },
    { id: "old-sushi", location_id: "sushi-id" },
  ];
  const groups = new Map([
    ["sushi-id", "sushi" as const],
    ["poki-id", "poki" as const],
  ]);

  const result = selectLatestOrderForReminder(
    orders,
    {
      scope: "employee",
      location_id: null,
      rule_kind: "checklist_order_day",
      location_group: "sushi",
    },
    groups,
  );

  if (result?.id !== "old-sushi") {
    throw new Error("Expected the Poki order not to suppress the Sushi reminder");
  }
});

Deno.test("location rules only consider orders for that exact location", () => {
  const orders = [
    { id: "new-other", location_id: "other-id" },
    { id: "target", location_id: "target-id" },
  ];

  const result = selectLatestOrderForReminder(
    orders,
    { scope: "location", location_id: "target-id" },
    new Map(),
  );

  if (result?.id !== "target") {
    throw new Error("Expected the exact location's latest order");
  }
});

Deno.test("ordinary employee rules retain employee-wide order behavior", () => {
  const newest = { id: "newest", location_id: "anywhere" };
  const result = selectLatestOrderForReminder(
    [newest, { id: "older", location_id: null }],
    { scope: "employee", location_id: null, rule_kind: "standard" },
    new Map(),
  );

  if (result !== newest) throw new Error("Expected the employee's newest order");
});
