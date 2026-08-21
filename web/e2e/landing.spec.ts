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
    // Variant A carousel: three slides, dots, Next → Next → done.
    const currentSlide = () =>
      page.getByLabel("Tutorial slides").evaluate((track) =>
        Math.round(track.scrollLeft / track.clientWidth),
      );

    await expect(page.getByText("Scan to start")).toBeVisible();
    await expect(page.locator("[data-onboarding-icon]")).toHaveCount(3);
    await expect(
      page.locator(".onboarding-kinetic-tile").first(),
    ).toHaveCSS("animation-iteration-count", "infinite");
    await expect(page.locator(".onboarding-kinetic-eq > span")).toHaveCount(5);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(currentSlide).toBe(1);
    await expect(page.getByText("Speak it in")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(currentSlide).toBe(2);
    await page.getByRole("button", { name: "Got it", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Scan to enter" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Scan the sticker" }),
    ).toBeVisible();
    await expect(
      page.getByText("Use your camera app or scan it here."),
    ).toBeVisible();
    await expect(page.getByText(/One scan per entry/)).toHaveCount(0);
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
    await expect(page.getByRole("button", { name: /Lena/ })).toBeVisible();
  });
});
