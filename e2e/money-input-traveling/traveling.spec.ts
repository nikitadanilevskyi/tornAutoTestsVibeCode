/**
 * Traveling-only money-input tests.
 *
 * Pages requiring the player to be currently traveling/abroad
 * (PageDef.traveling === true). EXCLUDED from the general money-input
 * workflow so the main suite isn't polluted by cascading skips when the
 * account is at home.
 *
 * Pages covered:
 *   • Travel Abroad Shop / Item Quantity   (/page.php?sid=travel)        — sanity only
 *   • Cayman Bank / Deposit                 (/index.php?page=bank in Cayman)
 *   • Cayman Bank / Withdraw                (/index.php?page=bank in Cayman)
 *
 * Run only this file when the account is set up to be currently abroad in
 * the Cayman Islands:
 *
 *   npx playwright test --config=playwright.config.no-setup.js \
 *     e2e/money-input-traveling/
 *
 * sanityOnly entries:
 *   The Travel Abroad Shop input is the React `AmountInput` component
 *   (item quantity, single-digit cap, 24 px height, no $ symbol button).
 *   The shared shortcut/formatting/symbol-button/height/validation helpers
 *   were designed for large-cap 34 px LegacyMoneyInputs, so they don't fit
 *   that surface. PageDef.sanityOnly === true skips behavioral tests for
 *   such entries; only the SANITY reachability probe runs against them.
 */

import { test, expect } from '@playwright/test';
import {
  checkRelativeShortcuts,
  checkShortcutsAndFormatting,
  checkSymbolButton,
  checkValidation,
} from '../helpers/money-input';
import { PAGES } from '../money-input/pages';

const TRAVELING_PAGES = PAGES.filter((p) => p.traveling);
const BEHAVIORAL_PAGES = TRAVELING_PAGES.filter((p) => !p.sanityOnly);

// ─── Behavioral suite (standard tornInputMoney pages while abroad) ────────────

for (const { name, url, getInput, navigate, serial, allowZero } of BEHAVIORAL_PAGES) {
  test.describe(`Traveling — ${name}`, () => {
    if (serial) test.describe.configure({ mode: 'serial' });
    test.setTimeout(90_000);

    test.beforeEach(async ({ page }, testInfo) => {
      await page.goto(url);
      if (navigate) {
        const result = await navigate(page);
        if (result === false) {
          testInfo.skip(true, `${name}: account is not currently abroad`);
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

// ─── SANITY: at least one traveling input is reachable ────────────────────────

test('SANITY — at least one traveling page is reachable on this account', async ({ page }) => {
  if (TRAVELING_PAGES.length === 0) {
    test.skip(true, 'No traveling pages defined in PAGES (PageDef.traveling)');
  }

  const reachable: string[] = [];
  for (const p of TRAVELING_PAGES) {
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
    test.skip(true, 'Account is not currently abroad — no traveling input reachable');
  }
  expect(reachable.length, `Reachable traveling pages: ${reachable.join(', ')}`).toBeGreaterThan(0);
});
