import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Fixture tokens/PINs and Supabase coordinates come from env files that are
// never committed: .env.e2e (E2E_* fixtures) and .env.local (NEXT_PUBLIC_*).
// Values already present in the environment win.
for (const file of [".env.e2e", ".env.local"]) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseURL);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // The suite talks to the live Supabase backend and its auth rate limits:
  // keep runs serial and deterministic.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    viewport: { width: 390, height: 844 },
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: isLocal
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
