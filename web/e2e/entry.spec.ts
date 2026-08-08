// The entry form itself: split math, save → edit-in-place, the zero-people
// guard, and $0 amounts. Sessions are minted via the edge function directly
// (the sign-in UI is covered in landing.spec.ts / pin.spec.ts).
//
// These tests write real tip_entries rows for today's Sushi lunch + dinner
// slots on the live backend; e2e/cleanup.sql removes them after a run.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAs } from "./helpers";
import { fixtures } from "./helpers";

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
  return page
    .locator("button[aria-pressed]")
    .filter({ hasText: name });
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
  test.beforeEach(async ({ page }) => {
    const { sushiToken } = fixtures();
    await signInAs(page, sushiToken, "Maria");
  });

  test("amounts + chips drive the split strip; save, reload-prefill, edit in place", async ({
    page,
  }) => {
    await page.goto("/entry");
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

    // Pin the test to the dinner slot regardless of wall-clock default.
    await mealTab(page, "Dinner").click();

    // A previous run may have left this slot saved; normalize to a clean
    // start (no people selected) so every assertion below is exercised.
    const pressed = page.locator('button[aria-pressed="true"]');
    while ((await pressed.count()) > 0) {
      await pressed.first().click();
    }

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
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // Reload → same slot comes back as an edit with values prefilled.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();
    await mealTab(page, "Dinner").click();
    await expect(
      page.getByText("Already recorded — editing"),
    ).toBeVisible();
    await expect(page.getByLabel("Cash amount")).toHaveValue("120.50");
    await expect(page.getByLabel("Card amount")).toHaveValue("340.25");
    await expect(chip(page, "Maria")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "Jose")).toHaveAttribute("aria-pressed", "true");

    // Edit and re-save: still one row, new values (verified via prefill).
    await fillAmount(page, "Cash", "150");
    await save(page);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await mealTab(page, "Dinner").click();
    await expect(page.getByLabel("Cash amount")).toHaveValue("150.00");
  });

  test("zero-people guard blocks, $0 amounts are legal", async ({ page }) => {
    await page.goto("/entry");
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

    // Use the lunch slot so this test owns its own slot.
    await mealTab(page, "Lunch").click();

    await fillAmount(page, "Cash", "0");
    await fillAmount(page, "Card", "0");

    // A previous run may have left this slot saved with people prefilled;
    // deselect everyone so the guard is actually exercised.
    const pressed = page.locator('button[aria-pressed="true"]');
    while ((await pressed.count()) > 0) {
      await pressed.first().click();
    }

    // Amounts valid but nobody picked → warning, no save.
    await page.getByRole("button", { name: "Save →" }).click();
    await expect(page.getByText("Pick at least one person")).toBeVisible();

    // Picking someone clears the warning; $0/$0 saves fine.
    await chip(page, "Ken").click();
    await expect(page.getByText("Pick at least one person")).toBeHidden();
    await expect(page.getByText("$0.00 each")).toBeVisible();
    await save(page);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });
});
