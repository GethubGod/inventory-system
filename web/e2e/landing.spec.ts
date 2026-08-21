// Sign-in surface: first-run onboarding, scan screen, token landing
// (happy + bad token), the closer pick, and the remembered-closer shortcut
// that skips it on the next scan.

import { expect, test } from "@playwright/test";
import { fixtures } from "./helpers";

/** Skip the first-run carousel for specs that aren't about it. */
async function markOnboarded(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("bt_tips_onboarded", "1");
  });
}

test.describe("scan landing", () => {
  test("first visit shows onboarding once, then the scan screen", async ({
    page,
  }) => {
    await page.goto("/");
    // Variant A carousel: three slides, dots, Next → Next → done. The button
    // label follows the scroll position, which animates — advance until the
    // last slide's label appears instead of firing blind clicks.
    await expect(page.getByText("Scan to start")).toBeVisible();
    const nextButton = page.getByRole("button", { name: "Next", exact: true });
    const goButton = page.getByRole("button", { name: /let.s go/i });
    await expect(async () => {
      if (await nextButton.isVisible()) await nextButton.click();
      await expect(goButton).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText("Speak it in")).toBeVisible();
    // Same animation caveat for the final click: the label can briefly flap
    // back to "Next" while the scroll settles.
    await expect(async () => {
      if (await goButton.isVisible()) await goButton.click();
      await expect(
        page.getByRole("heading", { name: "Scan to enter" }),
      ).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Scan the sticker" }),
    ).toBeVisible();
    // PIN entry is gone from the product.
    await expect(page.getByText(/PIN/)).toHaveCount(0);

    // Reload: onboarding does not come back.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Scan to enter" }),
    ).toBeVisible();
  });

  test("bad token shows a friendly error with a way back to scan", async ({
    page,
  }) => {
    await markOnboarded(page);
    await page.goto("/e?t=definitely-not-a-real-token");
    await expect(page.getByText("Couldn’t sign you in")).toBeVisible();
    await expect(
      page.getByText("This QR code is no longer active", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to scan" }).click();
    await expect(
      page.getByRole("heading", { name: "Scan to enter" }),
    ).toBeVisible();
  });

  // Uses the POKI token: entry.spec.ts records both of today's SUSHI slots,
  // and recorded slots now land sessions on the "All set for today" screen
  // instead of the form (the suite runs serially, entry before landing).
  test("token landing → closer pick → entry form; next scan skips the closer", async ({
    page,
  }) => {
    await markOnboarded(page);
    const { pokiToken } = fixtures();

    await page.goto(`/e?t=${pokiToken}`);
    await expect(
      page.getByRole("heading", { name: "Who’s closing?" }),
    ).toBeVisible();

    // The token must be stripped from the address bar / history immediately.
    expect(page.url()).not.toContain(pokiToken);

    await page.getByRole("button", { name: "Lena" }).click();
    await expect(page).toHaveURL(/\/entry$/);
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();
    await expect(
      page.getByText("Babytuna Poki & Pho", { exact: true }),
    ).toBeVisible();

    // Fresh scan on the same phone: the remembered closer skips the roster
    // screen entirely.
    await page.evaluate(() =>
      window.localStorage.removeItem("bt_tips_session"),
    );
    await page.goto(`/e?t=${pokiToken}`);
    await expect(page).toHaveURL(/\/entry$/);
    await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();
    // Target the roster chip specifically — the header closer pill is also
    // a button whose name contains "Lena".
    await expect(
      page.locator("button[aria-pressed]").filter({ hasText: "Lena" }),
    ).toBeVisible();
  });
});
