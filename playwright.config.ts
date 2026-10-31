import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:4100',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://localhost:4100/api/health',
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
