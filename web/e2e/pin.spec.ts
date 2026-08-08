// PIN fallback: wrong PIN error + recovery, and the per-device rate limit.
// Each describe block runs with its own throwaway user agent so the
// identifier-scoped rate limit never bleeds between runs or specs (the
// server keys attempts on IP + user agent). The bad tries briefly pollute
// tip_auth_attempts; e2e/cleanup.sql clears them after a run.

import { expect, test, type Page } from "@playwright/test";
import { fixtures } from "./helpers";

const RUN_ID = Date.now().toString(36);

interface PinVerdict {
  status: number;
  code: string | null;
}

/**
 * Tap a 4-digit PIN and wait for the server's verdict. The keypad ignores
 * taps while a validation request is in flight, so each submission is
 * synchronized on the validate_pin response; the response body is the
 * deterministic signal (the DOM error text lags a paint behind it).
 */
async function submitPin(page: Page, pin: string): Promise<PinVerdict> {
  for (const digit of pin.slice(0, 3)) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes("tip-entry-auth") &&
        (candidate.request().postData() ?? "").includes("validate_pin"),
    ),
    page.getByRole("button", { name: pin[3], exact: true }).click(),
  ]);
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  return { status: response.status(), code: body.code ?? null };
}

test.describe("wrong then right PIN", () => {
  test.use({ userAgent: `bt-e2e-pin-happy/${RUN_ID}` });

  test("wrong PIN shows an error, right PIN proceeds to closer pick", async ({
    page,
  }) => {
    const { sushiPin } = fixtures();
    const wrongPin = sushiPin === "0000" ? "1111" : "0000";

    await page.goto("/pin");
    await expect(
      page.getByRole("heading", { name: "Enter the PIN" }),
    ).toBeVisible();

    // Sushi sorts first and is preselected; make it explicit anyway.
    await page.getByRole("button", { name: "Sushi", exact: true }).click();

    const wrong = await submitPin(page, wrongPin);
    expect(wrong.status).toBe(401);
    expect(wrong.code).toBe("invalid");
    await expect(page.getByText(/That PIN didn/)).toBeVisible();

    const right = await submitPin(page, sushiPin);
    expect(right.status).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Who’s closing?" }),
    ).toBeVisible();
  });
});

test.describe("PIN rate limit", () => {
  test.use({ userAgent: `bt-e2e-pin-limit/${RUN_ID}` });

  test("six bad tries lock this device out with a clear message", async ({
    page,
  }) => {
    const { pokiPin } = fixtures();
    const wrongPin = pokiPin === "0000" ? "1111" : "0000";

    await page.goto("/pin");
    await expect(
      page.getByRole("heading", { name: "Enter the PIN" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Poki & Pho", exact: true }).click();

    // Per-device cap is 6 failures / 10 min → the 7th try must be refused
    // before the PIN is even checked. There is also a per-location cap
    // (30 failures / 10 min) shared with earlier runs until cleanup.sql is
    // applied, so the lockout may legitimately arrive sooner — never later.
    let lockedAtAttempt: number | null = null;
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const verdict = await submitPin(page, wrongPin);
      if (verdict.code === "rate_limited") {
        expect(verdict.status).toBe(429);
        lockedAtAttempt = attempt;
        break;
      }
      expect(verdict.status).toBe(401);
      expect(verdict.code).toBe("invalid");
    }

    expect(
      lockedAtAttempt,
      "rate limit never engaged within 7 bad tries",
    ).not.toBeNull();
    if (lockedAtAttempt !== 7) {
      test.info().annotations.push({
        type: "note",
        description: `locked out at attempt ${lockedAtAttempt} — location ledger carried failures from a previous run (clean run locks at exactly 7)`,
      });
    }

    // And the person holding the phone is told what happened.
    await expect(page.getByText("Too many attempts")).toBeVisible();
  });
});
