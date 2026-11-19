import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e/.artifacts',
  use: { baseURL: WEB, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /responsive/ },
    // Device emulation runs on Chromium (viewport, touch, DPR, user agent) — see docs/TESTING.md.
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /responsive/ },
    { name: 'android', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
    { name: 'tablet', use: { ...devices['iPad Mini'], browserName: 'chromium' }, testMatch: /responsive/ },
  ],
  webServer: [
    { command: 'node e2e/start-api.mjs', url: 'http://localhost:4100/api/health', timeout: 180_000, reuseExistingServer: false },
    { command: 'npx vite --port 5174 --strictPort', url: WEB, env: { API_URL: 'http://localhost:4100' }, timeout: 120_000, reuseExistingServer: false },
  ],
});
