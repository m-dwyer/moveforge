import { defineConfig, devices } from "@playwright/test";

const PORT = 8765;

export default defineConfig({
  testDir: "web/tests",
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `pnpm exec vite --mode test --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }]
});
