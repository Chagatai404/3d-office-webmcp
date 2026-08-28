import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    env: {
      ...process.env,
      ALLOW_DEMO_PHASE_TRANSITIONS: "true",
      ALLOW_DEMO_RESET: "true",
    },
    url: "http://127.0.0.1:3000/room/demo",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
