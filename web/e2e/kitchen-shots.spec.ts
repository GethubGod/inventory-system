// Demo screenshots of the kitchen screens next to the mockup, for review.
// Same local-stack requirements as kitchen.spec.ts, plus E2E_KITCHEN_SHOTS=1.
// Writes PNGs to docs/phases/kitchen-requests-demo/.

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clearKitchenRequests, ensureKitchenFixture, type KitchenFixture } from "./kitchenFixture";

test.skip(process.env.E2E_KITCHEN_SHOTS !== "1", "Set E2E_KITCHEN_SHOTS=1 to capture demo shots.");

const OUT = path.resolve(__dirname, "../../docs/phases/kitchen-requests-demo");
const MOCKUP = path.resolve(
  __dirname,
  "../../docs/mockups/kitchen-requests/kitchen-requests-prototype.html",
);

let fixture: KitchenFixture;

test.beforeAll(async () => {
  fixture = await ensureKitchenFixture();
  await clearKitchenRequests(fixture);
});

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/kitchen");
  await page.getByRole("tab", { name: "Email" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const picker = page.getByRole("heading", { name: "Which kitchen?" });
  const chefTitle = page.getByRole("heading", { name: "Kitchen request" });
  const queueTitle = page.getByRole("heading", { name: "Queue" });
  await expect(picker.or(chefTitle).or(queueTitle)).toBeVisible();
  if (await picker.isVisible()) {
    await page.getByRole("button", { name: "Babytuna Sushi" }).click();
  }
}

test("capture chef, sheet, kitchen display, and the mockup", async ({ browser }) => {
  const chefCtx = await browser.newContext({ deviceScaleFactor: 2 });
  const chef = await chefCtx.newPage();
  await signIn(chef, fixture.users.chef.email, fixture.users.chef.password);
  await chef.screenshot({ path: path.join(OUT, "01-login-and-chef-empty.png"), fullPage: true });

  const displayCtx = await browser.newContext({ deviceScaleFactor: 2 });
  const display = await displayCtx.newPage();
  await signIn(display, fixture.users.display.email, fixture.users.display.password);

  // Two requests so the log and queue have content, then open the sheet.
  await chef.getByRole("button", { name: "Crab Mix" }).click();
  await chef.getByRole("button", { name: /^Send 1 / }).click();
  await expect(chef.getByRole("dialog")).toBeHidden({ timeout: 5_000 });
  await chef.getByRole("button", { name: "Fried Shrimp" }).click();
  await chef.getByRole("button", { name: "Increase quantity" }).click();
  await chef.screenshot({ path: path.join(OUT, "02-chef-sheet.png"), fullPage: true });
  await chef.getByRole("button", { name: /^Send 2 / }).click();
  await expect(chef.getByText("Sent — 2 fried shrimp")).toBeVisible();
  await chef.screenshot({ path: path.join(OUT, "03-chef-sent.png"), fullPage: true });
  await expect(chef.getByRole("dialog")).toBeHidden({ timeout: 5_000 });

  await expect(display.getByRole("button", { name: "Mark 2 Fried Shrimp done" })).toBeVisible({
    timeout: 3_000,
  });
  await display.screenshot({ path: path.join(OUT, "04-kitchen-queue.png"), fullPage: true });
  await display.getByRole("button", { name: "Mark 1 Crab Mix done" }).click();
  await display.screenshot({ path: path.join(OUT, "05-kitchen-done-undo.png"), fullPage: true });
  await expect(chef.getByText("READY", { exact: true })).toBeVisible({ timeout: 3_000 });
  await chef.screenshot({ path: path.join(OUT, "06-chef-log-ready.png"), fullPage: true });

  // Manager dashboard: Kitchen items page and the Team module toggles.
  const managerCtx = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1200, height: 900 },
  });
  const manager = await managerCtx.newPage();
  await manager.goto("/dashboard/kitchen");
  await manager.getByLabel("Email").fill(fixture.users.manager.email);
  await manager.getByLabel("Password").fill(fixture.users.manager.password);
  await manager.getByRole("button", { name: "Sign in" }).click();
  await expect(manager.getByRole("heading", { name: "Kitchen" })).toBeVisible();
  await expect(manager.getByLabel("Name for Fried Shrimp")).toBeVisible();
  await manager.screenshot({ path: path.join(OUT, "07-dashboard-kitchen-items.png"), fullPage: true });
  await manager.goto("/dashboard/team");
  await expect(manager.getByRole("heading", { name: "Team" })).toBeVisible();
  const chefRow = manager.getByRole("row", { name: /Chef E2E/ });
  await chefRow.getByRole("button", { name: "Modules" }).click();
  await expect(manager.getByRole("button", { name: /Kitchen requests: On/ })).toBeVisible();
  await expect(manager.getByRole("button", { name: /Kitchen display: Off/ })).toBeVisible();
  await manager.screenshot({ path: path.join(OUT, "08-dashboard-team-modules.png"), fullPage: true });

  const mockupCtx = await browser.newContext({ deviceScaleFactor: 2 });
  const mockup = await mockupCtx.newPage();
  await mockup.goto(pathToFileURL(MOCKUP).toString());
  await mockup.screenshot({ path: path.join(OUT, "90-mockup-chef.png"), fullPage: true });
  await mockup.getByRole("tab", { name: /Kitchen display/ }).click();
  await mockup.screenshot({ path: path.join(OUT, "91-mockup-kitchen.png"), fullPage: true });

  await clearKitchenRequests(fixture);
});
