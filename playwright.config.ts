import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    env: {
      ...process.env,
      ALLOW_DEMO_PHASE_TRANSITIONS: "true",
      ALLOW_DEMO_RESET: "true",
      E2E_ROOM_HARNESS: "true",
      PLAYWRIGHT_DIST_DIR: ".next-e2e",
    },
    url: `${baseURL}/room/demo`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
