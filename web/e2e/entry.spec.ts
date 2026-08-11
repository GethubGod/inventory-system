// The entry form: split math, the zero-people guard, the save confirmation
// that signs the phone out, and the duplicate-slot lockout on the next
// session. Sessions are minted via the edge function directly (the sign-in
// UI is covered in landing.spec.ts).
//
// These tests write real tip_entries rows for today's Sushi lunch + dinner
// slots on the live backend; run e2e/cleanup.sql BEFORE and after a run —
// entry devices can no longer overwrite recorded slots, so leftovers from a
// previous run would leave these specs starting on the "All set" screen.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtures, signInAs } from "./helpers";

async function fillAmount(
  page: Page,
  label: "Cash" | "Card",
  value: string,
): Promise<void> {
  await page.getByLabel(`${label} amount`).fill(value);
}

/**
 * A roster split chip. Chips are the only buttons carrying aria-pressed,
 * which disambiguates them from the header's closer button of the same name.
 */
function chip(page: Page, name: string): Locator {
  return page.locator("button[aria-pressed]").filter({ hasText: name });
}

/** The Lunch|Dinner segmented control renders as tabs. */
function mealTab(page: Page, name: "Lunch" | "Dinner"): Locator {
  return page.getByRole("tab", { name, exact: true });
}

/** Wait for a save round-trip triggered by clicking "Save →". */
async function save(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("tip-entries")),
    page.getByRole("button", { name: "Save →" }).click(),
  ]);
}

test.describe("typed entry", () => {
  test("split math, save → confirmation signs the phone out", async ({
    page,
  }) => {
    const { sushiToken } = fixtures();
    await signInAs(page, sushiToken, "Maria");
    await page.goto("/entry");
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

    // Pin the test to the dinner slot regardless of wall-clock default.
    await mealTab(page, "Dinner").click();

    await fillAmount(page, "Cash", "120.50");
    await fillAmount(page, "Card", "340.25");

    // No people picked → strip prompts instead of computing.
    await expect(page.getByText(/Pick who.s splitting/)).toBeVisible();

    await chip(page, "Maria").click();
    await chip(page, "Jose").click();

    // (120.50 + 340.25) / 2 = 230.375 → 230.38 (half-up, in cents).
    await expect(page.getByText("Split 2 ways")).toBeVisible();
    await expect(page.getByText("$230.38 each")).toBeVisible();
    await expect(page.getByText("of $460.75")).toBeVisible();

    await save(page);

    // Full-screen confirmation with the numbers, then back to the scan gate.
    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
    await expect(page.getByText("$120.50")).toBeVisible();
    await expect(page.getByText("$340.25")).toBeVisible();
    await expect(page.getByText("2 people · $230.38 each")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    await expect(
      page.getByRole("heading", { name: "Scan to enter" }),
    ).toBeVisible();
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("bt_tips_session"),
    );
    expect(stored).toBeNull();
  });

  test("recorded shift is locked out for the next session", async ({
    page,
  }) => {
    // Runs after the dinner save above (Playwright config is serial).
    const { sushiToken } = fixtures();
    await signInAs(page, sushiToken, "Maria");
    await page.goto("/entry");
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

    await expect(mealTab(page, "Dinner")).toBeDisabled();
    await expect(
      page.getByText(/Dinner is already recorded today/),
    ).toBeVisible();
    // The preset lands on the remaining shift.
    await expect(mealTab(page, "Lunch")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("zero-people guard blocks, $0 amounts are legal; then all-done", async ({
    page,
  }) => {
    const { sushiToken } = fixtures();
    await signInAs(page, sushiToken, "Maria");
    await page.goto("/entry");
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

    // Lunch is the remaining slot after the dinner test.
    await fillAmount(page, "Cash", "0");
    await fillAmount(page, "Card", "0");

    // Amounts valid but nobody picked → warning, no save.
    await page.getByRole("button", { name: "Save →" }).click();
    await expect(page.getByText("Pick at least one person")).toBeVisible();

    // Picking someone clears the warning; $0/$0 saves fine.
    await chip(page, "Ken").click();
    await expect(page.getByText("Pick at least one person")).toBeHidden();
    await expect(page.getByText("$0.00 each")).toBeVisible();
    await save(page);
    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    // Both slots recorded → the next session gets the all-done screen.
    await signInAs(page, sushiToken, "Maria");
    await page.goto("/entry");
    await expect(page.getByText("All set for today")).toBeVisible();
  });
});
