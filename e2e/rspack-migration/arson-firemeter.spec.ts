/**
 * Branch: config/rspack-migration-with-loose
 *
 * E2E for the Arson FireMeter fix. Pre-fix code in
 *   apps/crimes/src/routes/13-Arson/components/FireMeter/a11y.ts
 * crashed with "false is not iterable" whenever atLeastOneOn was false
 * (all flames unstarted or all gone out). Now that loose-mode SWC is off,
 * the page would white-screen. The fix uses a ternary with a [] fallback.
 *
 * Test strategy: navigate to the Arson sub-crime, listen for console
 * errors, and (if a FireMeter renders) verify its aria-label has the
 * expected shape. Skips gracefully when the account doesn't have access.
 */

import { test, expect, type ConsoleMessage } from '@playwright/test';

const ARSON_URL = '/page.php?sid=crimes#/arson';

test.describe('Arson — FireMeter aria-label', () => {
  let consoleErrors: ConsoleMessage[] = [];
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg);
    });
    page.on('pageerror', (err) => pageErrors.push(err));
  });

  test('AR-01 — Arson page mounts without console errors', async ({ page }) => {
    await page.goto(ARSON_URL);
    // Crimes UI is React; wait for the Arson root or the Crimes shell.
    const arsonRoot = page.locator('[data-testid="arson-root"], .arson, [class*="ArsonRoot"]').first();
    const crimeShell = page.locator('.crimes-app, #crimes-react-root, .crimes-content').first();
    const visible = await Promise.race([
      arsonRoot.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'arson').catch(() => null),
      crimeShell.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'crimes').catch(() => null),
    ]);
    if (!visible) test.skip(true, 'Arson route not accessible on this account');

    // Critical: zero "is not iterable" or TypeError from getLabelForFireStatus.
    const noisySWC = (msg: string) =>
      /is not iterable/i.test(msg) ||
      /TypeError/i.test(msg) ||
      /flameStatePart/i.test(msg) ||
      /getLabelForFireStatus/i.test(msg);

    const offending = consoleErrors.filter((m) => noisySWC(m.text())).map((m) => m.text());
    const offendingPageErrors = pageErrors.filter((e) => noisySWC(e.message)).map((e) => e.message);
    expect(offending, 'console errors related to FireMeter').toEqual([]);
    expect(offendingPageErrors, 'uncaught FireMeter errors').toEqual([]);
  });

  test('AR-02 — when a FireMeter is rendered, its aria-label has the expected shape', async ({ page }) => {
    await page.goto(ARSON_URL);
    const fireMeter = page
      .locator('[aria-label*="flame"], [aria-label*="flames"]')
      .first();
    const visible = await fireMeter.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) test.skip(true, 'No FireMeter rendered on this Arson session');

    const label = await fireMeter.getAttribute('aria-label');
    expect(label, 'aria-label content').not.toBeNull();
    // Must always start with "<N> flame" / "<N> flames"
    expect(label!).toMatch(/^\d+ flames?/);
    // Must not contain literal "false" or "undefined" (would indicate
    // the original spread crash leaving the array half-built).
    expect(label!.toLowerCase()).not.toContain('false');
    expect(label!.toLowerCase()).not.toContain('undefined');
    // Must not contain the function name (a typical sign of [object Object]).
    expect(label!).not.toContain('[object');
  });
});
