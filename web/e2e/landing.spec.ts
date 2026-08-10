// Sign-in surface: scan screen, token landing (happy + bad token), the
// full first-run flow through closer pick to the entry form, and the
// returning-session shortcut.

import { expect, test } from "@playwright/test";
import { fixtures } from "./helpers";

test.describe("scan landing", () => {
  test("unauthenticated / shows the scan screen", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Scan to enter" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enter PIN instead" }),
    ).toBeVisible();
  });

  test("bad token shows a friendly error with PIN fallback", async ({
    page,
  }) => {
    await page.goto("/e?t=definitely-not-a-real-token");
    await expect(page.getByText("Couldn’t sign you in")).toBeVisible();
    await expect(
      page.getByText("This QR code is no longer active", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enter PIN instead" }),
    ).toBeVisible();
  });

  test("token landing → closer pick → entry form, then returning session skips ahead", async ({
    page,
  }) => {
    const { sushiToken } = fixtures();

    await page.goto(`/e?t=${sushiToken}`);
    await expect(
      page.getByRole("heading", { name: "You’re in" }),
    ).toBeVisible();
    await expect(page.getByText("Babytuna Sushi", { exact: true })).toBeVisible();

    // The token must be stripped from the address bar / history immediately.
    await expect(page).toHaveURL(/\/e$/);
    expect(page.url()).not.toContain(sushiToken);

    await page.getByRole("button", { name: /Enter tonight/ }).click();
    await expect(
      page.getByRole("heading", { name: "Who’s closing?" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Maria" }).click();
    await expect(page).toHaveURL(/\/entry$/);
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();
    await expect(page.getByText("Babytuna Sushi", { exact: true })).toBeVisible();

    // Returning visit: straight to the form, no "You're in", no closer prompt.
    await page.goto("/");
    await expect(page).toHaveURL(/\/entry$/);
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();
  });
});
