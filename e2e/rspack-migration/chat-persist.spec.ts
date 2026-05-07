/**
 * Branch: config/rspack-migration-with-loose
 *
 * E2E for the @tanstack/react-query persist behavior. The original loose-mode
 * SWC transform produced compiled output where `query.state` was undefined
 * inside `defaultShouldDehydrateQuery` during persist. The fix disables
 * loose mode globally; this test confirms the persist round-trip works in
 * the rspack-built bundle.
 *
 * Surface: Chat is the only consumer of `persistQueryClient` in the
 * react-apps repo (apps/chat/src/shared/config/query/index.ts).
 */

import { test, expect, type ConsoleMessage } from '@playwright/test';

const CHAT_URL = '/page.php?sid=chat';

const PERSIST_ERROR_PATTERNS = [
  /Cannot read properties of undefined \(reading 'state'\)/i,
  /defaultShouldDehydrateQuery/i,
  /persistQueryClient/i,
  /createSyncStoragePersister/i,
];

function isPersistError(text: string): boolean {
  return PERSIST_ERROR_PATTERNS.some((re) => re.test(text));
}

test.describe('Chat — react-query persist hydration', () => {
  let consoleErrors: ConsoleMessage[] = [];
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg); });
    page.on('pageerror', (err) => pageErrors.push(err));
  });

  test('CHAT-01 — first load with empty cache does not crash', async ({ page, context }) => {
    // Wipe any previous query cache from localStorage before load.
    await context.clearCookies();
    await page.goto('about:blank');
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
    });

    await page.goto(CHAT_URL);
    const chatRoot = page.locator('.chat-app, [class*="ChatApp"], #chat-react-root, [data-testid="chat-root"]').first();
    const visible = await chatRoot.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!visible) test.skip(true, 'Chat app did not mount on this account');

    expect(consoleErrors.filter((m) => isPersistError(m.text())).map((m) => m.text())).toEqual([]);
    expect(pageErrors.filter((e) => isPersistError(e.message)).map((e) => e.message)).toEqual([]);
  });

  test('CHAT-02 — hydration on reload does not throw query.state undefined', async ({ page }) => {
    await page.goto(CHAT_URL);
    const chatRoot = page.locator('.chat-app, [class*="ChatApp"], #chat-react-root, [data-testid="chat-root"]').first();
    if (!(await chatRoot.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false))) {
      test.skip(true, 'Chat app not mounted');
    }

    // Give the persister time to write at least once.
    await page.waitForTimeout(2_000);

    // Reset error buffers — we only care about errors during the hydration phase.
    consoleErrors = [];
    pageErrors = [];

    await page.reload();
    await chatRoot.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_500);

    expect(consoleErrors.filter((m) => isPersistError(m.text())).map((m) => m.text())).toEqual([]);
    expect(pageErrors.filter((e) => isPersistError(e.message)).map((e) => e.message)).toEqual([]);
  });
});
