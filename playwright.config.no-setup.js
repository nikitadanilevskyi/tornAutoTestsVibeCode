// @ts-check
// Same as playwright.config.js but skips globalSetup so we can use the
// already-cached storageState (playwright/.auth/user.json) when the dev
// box's login form is misbehaving.
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const AUTH_FILE = path.join(__dirname, 'playwright/.auth/user.json');

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never', port: 0 }], ['list']],
  // No globalSetup — relies on existing AUTH_FILE.

  use: {
    baseURL: 'https://nikitad-dev.torn.com',
    ignoreHTTPSErrors: true,
    storageState: AUTH_FILE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: !!process.env.CI,
    httpCredentials: process.env.TORN_HTTP_USER ? {
      username: process.env.TORN_HTTP_USER,
      password: process.env.TORN_HTTP_PASS || '',
    } : undefined,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
