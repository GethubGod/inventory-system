// Voice sheet smoke test only: the sheet opens against a fake microphone,
// the checklist renders, and cancel returns to the form without touching it.
// Real speech-to-parse accuracy is exercised separately against
// tip-voice-parse with synthesized audio (see e2e/README.md).

import { expect, test } from "@playwright/test";
import { fixtures, signInAs } from "./helpers";

test("voice sheet opens, shows the checklist, and cancels cleanly", async ({
  page,
}) => {
  // Poki token: entry.spec.ts records today's Sushi slots, which would land
  // this session on the "All set for today" screen instead of the form.
  const { pokiToken } = fixtures();
  await signInAs(page, pokiToken, "Lena");

  await page.goto("/entry");
  await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();

  await page.getByRole("button", { name: "Speak it in" }).click();

  // Fake mic granted → listening state with the five checklist rows.
  await expect(page.getByText("Listening…").first()).toBeVisible();
  for (const row of ["Location", "Shift", "Cash", "Card", "People"]) {
    await expect(page.getByText(row, { exact: true }).first()).toBeVisible();
  }

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Listening…")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Tips" })).toBeVisible();
});
