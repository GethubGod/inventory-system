// The entry form: cash-pool split math, the day-scope receipt, partial-share
// badges, notes, the zero-people guard, the 10s save confirmation that signs
// the phone out, and the duplicate-slot lockout on the next session. Sessions
// are minted via the edge function directly (the sign-in UI is covered in
// landing.spec.ts).
//
// These tests write real tip_entries rows for today's Sushi lunch + dinner
// slots on the live backend; run e2e/cleanup.sql BEFORE and after a run —
// entry devices can no longer overwrite recorded slots, so leftovers from a
// previous run would leave these specs starting on the "All set" screen.
//
// Order matters: lunch records first so the whole-day dinner test has a
// lunch to subtract.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtures, signInAs } from "./helpers";

async function fillAmount(
  page: Page,
  label: "Cash" | "Card" | "Gratuity",
  value: string,
): Promise<void> {
  await page.getByLabel(`${label} amount`).fill(value);
}

/**
 * A roster split chip. Chips are the only buttons carrying aria-pressed,
 * which disambiguates them from the header's closer button of the same name
 * (the % badges carry aria-labels, not aria-pressed).
 */
function chip(page: Page, name: string): Locator {
  return page.locator("button[aria-pressed]").filter({ hasText: name });
}

/** A selected chip's share badge, addressed by its accessible name. */
function badge(page: Page, name: string, percent: number): Locator {
  return page.getByRole("button", { name: `${name} share ${percent}%` });
}

/** The Lunch|Dinner segmented control renders as tabs. */
function mealTab(page: Page, name: "Lunch" | "Dinner"): Locator {
  return page.getByRole("tab", { name, exact: true });
}

/** Clear the schedule's pre-selected chips so the math is deterministic. */
async function clearChips(page: Page): Promise<void> {
  const pressed = page.locator('button[aria-pressed="true"]');
  while ((await pressed.count()) > 0) {
    await pressed.first().click();
  }
}

/** Wait for a save round-trip triggered by clicking "Save →". */
async function save(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("tip-entries")),
    page.getByRole("button", { name: "Save →" }).click(),
  ]);
}

test.describe("typed entry", () => {
  test("lunch: cash-pool split, note, 10s countdown returns to the scan gate", async ({
    page,
  }) => {
    const { sushiToken } = fixtures();
    await signInAs(page, sushiToken, "Maria");
    await page.goto("/entry");
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

    await mealTab(page, "Lunch").click();
    // Lunch has no scope switch — always records what was typed.
    await expect(page.getByText("Whole day (Square)")).toBeHidden();
    await clearChips(page);

    await fillAmount(page, "Cash", "120.50");
    await fillAmount(page, "Card", "340.25");
    // Gratuity stays blank — blank is legal and means $0.

    // No people picked → strip prompts instead of computing.
    await expect(page.getByText(/Pick who.s splitting/)).toBeVisible();

    await chip(page, "Maria").click();
    await chip(page, "Jose").click();

    // The strip reads on the CASH pool only: 120.50 / 2 = 60.25.
    await expect(page.getByText("Split 2 ways")).toBeVisible();
    await expect(page.getByText("$60.25 each")).toBeVisible();
    await expect(page.getByText("of $120.50 cash")).toBeVisible();
    // All-full split → no per-person card.
    await expect(page.getByText("What each person takes")).toBeHidden();

    // Attach a note, then reopen the editor to prove it round-trips.
    await page.getByRole("button", { name: "+ Add a note" }).click();
    await page.getByLabel("Note").fill("Drawer was $20 short — recounted.");
    await expect(page.getByText("33 / 280")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Drawer was $20 short — recounted."),
    ).toBeVisible();

    await save(page);

    // Full-screen confirmation: read-only wells, the note, and a countdown
    // that hands the phone back to the scan gate without a tap.
    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
    await expect(page.getByText("$120.50")).toBeVisible();
    await expect(page.getByText("$340.25")).toBeVisible();
    await expect(page.getByText("2 people · $60.25 each")).toBeVisible();
    await expect(
      page.getByText("Drawer was $20 short — recounted."),
    ).toBeVisible();
    await expect(page.getByText(/Back to the scan screen in/)).toBeVisible();

    // Hold ~10s: the countdown expires and the session ends on its own.
    await expect(
      page.getByRole("heading", { name: "Scan to enter" }),
    ).toBeVisible({ timeout: 15_000 });
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("bt_tips_session"),
    );
    expect(stored).toBeNull();
  });

  test("dinner as whole day: receipt subtraction, negative guard, badges, derived save", async ({
    page,
  }) => {
    const { sushiToken } = fixtures();
    await signInAs(page, sushiToken, "Maria");
    await page.goto("/entry");
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

    await mealTab(page, "Dinner").click();
    await clearChips(page);

    // Zero-people guard: amounts alone don't save.
    await fillAmount(page, "Cash", "350.50");
    await fillAmount(page, "Card", "400.25");
    await fillAmount(page, "Gratuity", "50.00");
    await page.getByRole("button", { name: "Save →" }).click();
    await expect(page.getByText("Pick at least one person")).toBeVisible();
    await chip(page, "Maria").click();
    await chip(page, "Jose").click();
    await expect(page.getByText("Pick at least one person")).toBeHidden();

    // Whole day is the default: the receipt shows its work against the
    // recorded lunch (cash 120.50 + card 340.25 + gratuity 0 = 460.75).
    await expect(page.getByText("Entered (whole day)")).toBeVisible();
    await expect(page.getByText("$800.75")).toBeVisible();
    await expect(page.getByText("− Lunch already recorded")).toBeVisible();
    await expect(page.getByText("−$460.75")).toBeVisible();
    await expect(page.getByText("Dinner records")).toBeVisible();
    await expect(page.getByText("$340.00")).toBeVisible();

    // The one blocking warning: typed cash below the recorded lunch cash.
    await fillAmount(page, "Cash", "50");
    await expect(
      page.getByText(/Lunch already recorded more than this/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save →" })).toBeDisabled();
    await fillAmount(page, "Cash", "350.50");
    await expect(
      page.getByText(/Lunch already recorded more than this/),
    ).toBeHidden();

    // Dinner-only scope hides the lunch line and relabels the receipt.
    await page.getByRole("tab", { name: "Dinner only" }).click();
    await expect(page.getByText("Entered (dinner only)")).toBeVisible();
    await expect(page.getByText("− Lunch already recorded")).toBeHidden();
    await page.getByRole("tab", { name: "Whole day (Square)" }).click();

    // Derived cash pool: 350.50 − 120.50 = 230.00. Badge cycling reshapes
    // the shares: Jose at 50% raises Maria's full share.
    await expect(page.getByText("of $230.00 cash")).toBeVisible();
    await expect(page.getByText("Split 2 ways")).toBeVisible();
    await badge(page, "Jose", 100).click(); // → 75
    await badge(page, "Jose", 75).click(); // → 50
    await expect(page.getByText("Full share")).toBeVisible();
    // The full share shows in the strip and in Maria's payout row.
    await expect(page.getByText("$153.33").first()).toBeVisible();
    await expect(page.getByText("What each person takes")).toBeVisible();
    await expect(page.getByText("50% share")).toBeVisible();
    await expect(page.getByText("$76.67")).toBeVisible();
    // Cycling badges never deselects the person.
    await expect(chip(page, "Jose")).toHaveAttribute("aria-pressed", "true");

    // Back to 100% removes the per-person card; then settle on 50%.
    await badge(page, "Jose", 50).click(); // → 25
    await badge(page, "Jose", 25).click(); // → 100
    await expect(page.getByText("What each person takes")).toBeHidden();
    await expect(page.getByText("Split 2 ways")).toBeVisible();
    await badge(page, "Jose", 100).click(); // → 75
    await badge(page, "Jose", 75).click(); // → 50

    await save(page);

    // The saved screen shows the DERIVED shift figures, not what was typed:
    // cash 230.00, card 400.25 − 340.25 = 60.00, gratuity 50.00 − 0 = 50.00.
    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
    await expect(page.getByText("$230.00")).toBeVisible();
    await expect(page.getByText("$60.00")).toBeVisible();
    await expect(page.getByText("$50.00")).toBeVisible();
    await expect(page.getByText(/full share/)).toBeVisible();
    await expect(page.getByText(/\(50%\)/)).toBeVisible();

    // Done short-circuits the countdown.
    await page.getByRole("button", { name: "Done" }).click();
    await expect(
      page.getByRole("heading", { name: "Scan to enter" }),
    ).toBeVisible();
  });

  test("recorded shifts lock out the next session; both recorded → all done", async ({
    page,
  }) => {
    // Runs after both saves above (Playwright config is serial).
    const { sushiToken } = fixtures();
    await signInAs(page, sushiToken, "Maria");
    await page.goto("/entry");
    await expect(page.getByText("All set for today")).toBeVisible();
  });
});
