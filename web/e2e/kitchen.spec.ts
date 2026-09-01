// Kitchen requests, end to end, against a LOCAL Supabase stack: a chef phone
// and a kitchen display in two browser contexts. Run with
//   E2E_KITCHEN=1 E2E_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=... PORT=3100 E2E_BASE_URL=http://localhost:3100 \
//   npx playwright test e2e/kitchen.spec.ts
// See e2e/README.md "Kitchen suite".

import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  clearKitchenRequests,
  countRequestsBy,
  ensureKitchenFixture,
  type KitchenFixture,
  type KitchenUserKey,
} from "./kitchenFixture";

test.skip(process.env.E2E_KITCHEN !== "1", "Set E2E_KITCHEN=1 with a local stack to run the kitchen suite.");

let fixture: KitchenFixture;

test.beforeAll(async () => {
  fixture = await ensureKitchenFixture();
});

test.beforeEach(async () => {
  await clearKitchenRequests(fixture);
});

async function signInWithEmail(page: Page, who: KitchenUserKey): Promise<void> {
  const user = fixture.users[who];
  await page.goto("/kitchen");
  await page.getByRole("tab", { name: "Email" }).click();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function openSushi(page: Page): Promise<void> {
  // Accounts without a works-at location choose once; the device remembers.
  const picker = page.getByRole("heading", { name: "Which kitchen?" });
  const chefTitle = page.getByRole("heading", { name: "Kitchen request" });
  const queueTitle = page.getByRole("heading", { name: "Queue" });
  await expect(picker.or(chefTitle).or(queueTitle)).toBeVisible();
  if (await picker.isVisible()) {
    await page.getByRole("button", { name: "Babytuna Sushi" }).click();
  }
}

async function chefPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithEmail(page, "chef");
  await openSushi(page);
  await expect(page.getByRole("heading", { name: "Kitchen request" })).toBeVisible();
  return page;
}

async function displayPage(browser: Browser, who: KitchenUserKey = "display"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithEmail(page, who);
  await openSushi(page);
  await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
  return page;
}

async function sendFromSheet(page: Page, item: string, extraTaps = 0): Promise<void> {
  await page.getByRole("button", { name: item }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < extraTaps; i += 1) {
    await page.getByRole("button", { name: "Increase quantity" }).click();
  }
  await page.getByRole("button", { name: /^Send \d+ / }).click();
}

test("chef sends, kitchen sees it live, marks ready, chef sees READY, got it clears", async ({
  browser,
}) => {
  const chef = await chefPage(browser);
  const display = await displayPage(browser);
  await expect(display.getByText("All caught up.", { exact: false })).toBeVisible();
  await expect(display.getByText("Live · connected")).toBeVisible();

  await sendFromSheet(chef, "Fried Shrimp", 1);
  await expect(chef.getByText("Sent — 2 fried shrimp")).toBeVisible();
  await expect(chef.getByRole("dialog")).toBeHidden({ timeout: 5_000 });
  const chefRow = chef.locator("div", { hasText: /^2 Fried Shrimp/ }).first();
  await expect(chef.getByText("2 Fried Shrimp")).toBeVisible();
  await expect(chef.getByText("SENT")).toBeVisible();

  // Stamped with who sent it, live on the display within the realtime budget.
  const queueRow = display.getByRole("button", { name: "Mark 2 Fried Shrimp done" });
  await expect(queueRow).toBeVisible({ timeout: 3_000 });
  await expect(display.getByText("Chef E2E @chef e2e")).toBeVisible();

  await queueRow.click();
  await expect(display.getByText(/Undo · \ds/)).toBeVisible();
  await expect(chef.getByText("READY")).toBeVisible({ timeout: 3_000 });
  await expect(chef.getByRole("button", { name: "Got it" })).toBeVisible();
  await expect(chefRow).toBeVisible();

  // The undo window closes and the row leaves the queue.
  await expect(display.getByRole("button", { name: /Undo ready/ })).toBeHidden({ timeout: 8_000 });
  await expect(display.getByText("All caught up.", { exact: false })).toBeVisible();

  await chef.getByRole("button", { name: "Got it" }).click();
  await expect(chef.getByText("2 Fried Shrimp")).toBeHidden();
  await expect(chef.getByText("Nothing requested right now.")).toBeVisible();
});

test("kitchen undo puts the request back in the queue and the chef sees SENT again", async ({
  browser,
}) => {
  const chef = await chefPage(browser);
  const display = await displayPage(browser);

  await sendFromSheet(chef, "Sushi Rice");
  await expect(chef.getByRole("dialog")).toBeHidden({ timeout: 5_000 });
  const queueRow = display.getByRole("button", { name: "Mark 1 Sushi Rice done" });
  await expect(queueRow).toBeVisible({ timeout: 3_000 });
  await queueRow.click();
  await expect(chef.getByText("READY")).toBeVisible({ timeout: 3_000 });

  await display.getByRole("button", { name: /Undo ready/ }).click();
  await expect(display.getByRole("button", { name: "Mark 1 Sushi Rice done" })).toBeVisible();
  await expect(chef.getByText("SENT")).toBeVisible({ timeout: 3_000 });
  await expect(chef.getByText("READY")).toBeHidden();
});

test("chef cancel removes the request from the kitchen queue", async ({ browser }) => {
  const chef = await chefPage(browser);
  const display = await displayPage(browser);

  await sendFromSheet(chef, "Crab Mix");
  await expect(chef.getByRole("dialog")).toBeHidden({ timeout: 5_000 });
  await expect(display.getByRole("button", { name: "Mark 1 Crab Mix done" })).toBeVisible({
    timeout: 3_000,
  });
  await chef.getByRole("button", { name: "Cancel 1 crab mix" }).click();
  await expect(chef.getByText("Cancelled 1 crab mix")).toBeVisible();
  await expect(display.getByRole("button", { name: "Mark 1 Crab Mix done" })).toBeHidden({
    timeout: 3_000,
  });
});

test("offline send fails loudly; retry with the same key lands exactly once", async ({
  browser,
}) => {
  const chef = await chefPage(browser);
  const chefId = fixture.users.chef.id;
  await chef.context().setOffline(true);

  await sendFromSheet(chef, "Unagi", 2);
  await expect(chef.getByText("Didn’t send — 3 unagi")).toBeVisible({ timeout: 15_000 });
  await expect(chef.getByRole("button", { name: "Retry now" })).toBeVisible();
  expect(await countRequestsBy(fixture, chefId)).toBe(0);

  await chef.context().setOffline(false);
  await chef.getByRole("button", { name: "Retry now" }).click();
  await expect(chef.getByText("Sent — 3 unagi")).toBeVisible({ timeout: 15_000 });
  await expect(chef.getByRole("dialog")).toBeHidden({ timeout: 5_000 });
  await expect(chef.getByText("3 Unagi")).toBeVisible();
  expect(await countRequestsBy(fixture, chefId)).toBe(1);

  // A second retry of the same failed row can never duplicate: the log has
  // one row and the server has one row.
  await chef.reload();
  await openSushi(chef);
  await expect(chef.getByText("3 Unagi")).toHaveCount(1);
  expect(await countRequestsBy(fixture, chefId)).toBe(1);
});

test("name + PIN sign-in lands on the chef screen with the username and tag", async ({
  page,
}) => {
  await page.goto("/kitchen");
  await page.getByLabel("Name").fill("Chef E2E");
  await page.getByLabel("PIN or password").fill(fixture.users.chef.pin ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await openSushi(page);
  await expect(page.getByRole("heading", { name: "Kitchen request" })).toBeVisible();
  await expect(page.getByText("Chef E2E")).toBeVisible();
  await expect(page.getByText("@chef e2e")).toBeVisible();
  // A chef-only account gets no screen switcher.
  await expect(page.getByRole("tab", { name: "Kitchen display" })).toHaveCount(0);
});

test("an account with neither module is told so, and a manager gets both screens", async ({
  browser,
}) => {
  const nobody = await browser.newContext().then((c) => c.newPage());
  await signInWithEmail(nobody, "nobody");
  await expect(nobody.getByText("No kitchen access")).toBeVisible();
  await expect(nobody.getByRole("button", { name: "Sign out" })).toBeVisible();

  const manager = await browser.newContext().then((c) => c.newPage());
  await signInWithEmail(manager, "manager");
  await openSushi(manager);
  await expect(manager.getByRole("tab", { name: "Chef" })).toBeVisible();
  await manager.getByRole("tab", { name: /Kitchen display/ }).click();
  await expect(manager.getByRole("heading", { name: "Queue" })).toBeVisible();
});

test("a display pinned to the other location never sees this kitchen's requests", async ({
  browser,
}) => {
  const chef = await chefPage(browser);
  const poki = await browser.newContext().then((c) => c.newPage());
  await signInWithEmail(poki, "pokiDisplay");
  // Pinned accounts skip the picker entirely and cannot change location.
  await expect(poki.getByRole("heading", { name: "Queue" })).toBeVisible();
  await expect(poki.getByText("Babytuna Poki & Pho")).toBeVisible();
  await expect(poki.getByRole("button", { name: "Change" })).toHaveCount(0);

  await sendFromSheet(chef, "Salmon");
  await expect(chef.getByRole("dialog")).toBeHidden({ timeout: 5_000 });
  await poki.waitForTimeout(2_500);
  await expect(poki.getByText("Salmon")).toHaveCount(0);
  await expect(poki.getByText("All caught up.", { exact: false })).toBeVisible();
});
