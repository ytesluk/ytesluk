import { defineConfig } from "@playwright/test";

/**
 * Dashboard smoke tests. Requires API + worker + web running (pnpm dev, or docker compose up) and
 * seeded demo data (pnpm db:seed). PLAYWRIGHT_CHROMIUM_PATH lets CI/sandboxes use a preinstalled browser.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:3000",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
});
