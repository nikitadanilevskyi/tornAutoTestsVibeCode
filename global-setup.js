// @ts-check
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const AUTH_FILE = path.join(__dirname, 'playwright/.auth/user.json');
const BASE_URL = 'https://nikitad-dev.torn.com';

module.exports = async function globalSetup() {
  const email = process.env.TORN_EMAIL;
  const password = process.env.TORN_PASSWORD;

  if (!email || !password) {
    throw new Error('TORN_EMAIL and TORN_PASSWORD must be set in .env');
  }

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  const browser = await chromium.launch({ headless: !!process.env.CI });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    httpCredentials: process.env.TORN_HTTP_USER ? {
      username: process.env.TORN_HTTP_USER,
      password: process.env.TORN_HTTP_PASS || '',
    } : undefined,
  });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // Wait for the React-rendered Login button to appear
  const loginBtn = page.getByRole('button', { name: 'Login' });
  await loginBtn.waitFor({ state: 'visible', timeout: 30000 });
  await loginBtn.click();

  // Popup is a React portal — wait for it to appear
  await page.locator('#player').waitFor({ state: 'visible' });
  await page.locator('#player').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('input[name="btnLogin"]').click();

  // Form posts to /page.php?sid=Auth, then redirects back
  await page.waitForURL((url) => !url.pathname.includes('page.php') && !url.search.includes('sid=Auth'), {
    timeout: 30000,
  });

  await context.storageState({ path: AUTH_FILE });
  await browser.close();

  console.log('✓ Authenticated — session saved to playwright/.auth/user.json');
};
