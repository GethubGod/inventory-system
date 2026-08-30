// Tips v3 edge case: a whole-day dinner with NO lunch on record saves
// flagged for the manager — with nothing shown to the closer. The entry
// screen shows no banner, the save succeeds with the ordinary confirmation,
// and the stored row carries flagged_anomaly (asserted from the save
// response, since the manager dashboard is auth-gated).
//
// Uses the Poki slot: entry.spec.ts records today's Sushi lunch, so Sushi
// always HAS a lunch by the time these run. Poki's dinner is free —
// voice-sheet.spec.ts only smoke-tests the sheet and never saves.

import { expect, test } from "@playwright/test";
import { fixtures, signInAs } from "./helpers";

test("no-lunch whole-day dinner saves flagged with nothing shown to the closer", async ({
  page,
}) => {
  const { pokiToken } = fixtures();
  await signInAs(page, pokiToken, "Lena");
  await page.goto("/entry");
  await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

  await page.getByRole("tab", { name: "Dinner", exact: true }).click();

  // Whole day is the default. With no lunch on record the receipt subtracts
  // zero and no warning of any kind appears.
  await expect(
    page.getByRole("tab", { name: "Whole day (Square)" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Cash amount").fill("200.00");
  await page.getByLabel("Card amount").fill("100.00");
  await expect(page.getByText("− Lunch already recorded")).toBeVisible();
  await expect(page.getByText("−$0.00")).toBeVisible();
  await expect(
    page.getByText(/Lunch already recorded more than this/),
  ).toBeHidden();

  const pressed = page.locator('button[aria-pressed="true"]');
  while ((await pressed.count()) > 0) {
    await pressed.first().click();
  }
  await page
    .locator("button[aria-pressed]")
    .filter({ hasText: "Lena" })
    .click();

  // Save succeeds normally; the stored row is flagged day_total_no_lunch.
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("tip-entries")),
    page.getByRole("button", { name: "Save →" }).click(),
  ]);
  const json = (await response.json()) as {
    entry?: { flaggedAnomaly?: boolean; enteredScope?: string };
  };
  expect(json.entry?.flaggedAnomaly).toBe(true);
  expect(json.entry?.enteredScope).toBe("day");

  // The closer sees the ordinary confirmation — no flag, no warning.
  await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
  await expect(page.getByText(/Back to the scan screen in/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Scan to enter" })).toBeVisible();
});
