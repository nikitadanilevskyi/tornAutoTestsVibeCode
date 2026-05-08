/**
 * Trade-only money-input tests.
 *
 * Pages requiring an active trade with a hard-coded ID in the URL hash
 * (PageDef.trade === true). EXCLUDED from the general money-input
 * workflow so the main suite isn't polluted by skips when the test
 * account has no active trade.
 *
 * Pages covered:
 *   • Trade / Add Money   (/trade.php#step=addmoney&ID=<n>)
 *
 * Updating the trade ID:
 *   The URL is hard-coded in `e2e/money-input/pages.ts` because trade IDs
 *   are personal & ephemeral. When the active trade is completed,
 *   cancelled, or expires, edit the `Trade / Add Money` entry there with
 *   a fresh trade ID — no other change required.
 *
 * Run only this file when the trade ID in the URL is still active:
 *
 *   npx playwright test --config=playwright.config.no-setup.js \
 *     e2e/money-input-trade/
 */

import { test, expect } from '@playwright/test';
import {
  checkRelativeShortcuts,
  checkShortcutsAndFormatting,
  checkSymbolButton,
  checkValidation,
} from '../helpers/money-input';
import { PAGES } from '../money-input/pages';

const TRADE_PAGES = PAGES.filter((p) => p.trade);
const BEHAVIORAL_PAGES = TRADE_PAGES.filter((p) => !p.sanityOnly);

// ─── Behavioral suite ────────────────────────────────────────────────────────

for (const { name, url, getInput, navigate, serial, allowZero } of BEHAVIORAL_PAGES) {
  test.describe(`Trade — ${name}`, () => {
    if (serial) test.describe.configure({ mode: 'serial' });
    test.setTimeout(90_000);

    test.beforeEach(async ({ page }, testInfo) => {
      await page.goto(url);
      if (navigate) {
        const result = await navigate(page);
        if (result === false) {
          testInfo.skip(true, `${name}: trade not reachable (ID may have expired or been completed)`);
        }
      }
    });

    test('① shortcuts and exact number formatting', async ({ page }) => {
      await checkShortcutsAndFormatting(getInput(page));
    });

    test('②–⑪ relative shortcuts (max, half, %, fractions) — skipped if no data-money', async ({ page }) => {
      await checkRelativeShortcuts(getInput(page));
    });

    test('⑫ $ symbol button fills max — skipped if no data-money', async ({ page }) => {
      await checkSymbolButton(getInput(page));
    });

    test('⑰–⑳ validation: empty / zero / invalid text / over-limit', async ({ page }) => {
      await checkValidation(getInput(page), { allowZero });
    });
  });
}

// ─── SANITY: at least one trade page is reachable ────────────────────────────

test('SANITY — at least one trade page is reachable on this account', async ({ page }) => {
  if (TRADE_PAGES.length === 0) {
    test.skip(true, 'No trade pages defined in PAGES (PageDef.trade)');
  }

  const reachable: string[] = [];
  for (const p of TRADE_PAGES) {
    await page.goto(p.url);
    const ok = p.navigate ? await p.navigate(page).then((r) => r !== false).catch(() => false) : true;
    if (ok) {
      const visible = await p
        .getInput(page)
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (visible) reachable.push(p.name);
    }
  }
  if (reachable.length === 0) {
    test.skip(true, 'Trade ID is not active — update the URL in pages.ts');
  }
  expect(reachable.length, `Reachable trade pages: ${reachable.join(', ')}`).toBeGreaterThan(0);
});
