import { test } from '@playwright/test';
import {
  checkShortcutsAndFormatting,
  checkRelativeShortcuts,
  checkSymbolButton,
  checkValidation,
} from '../helpers/money-input';
import { PAGES } from './pages';

// ─── Generate test suites ─────────────────────────────────────────────────────

// Pages excluded from the standard helper-based behavioural sweep:
//   • p.traveling   → e2e/money-input-traveling/traveling.spec.ts
//   • p.trade       → e2e/money-input-trade/trade.spec.ts
//   • p.sanityOnly  → contract diverges from the shared helpers
//                     (low-cap inputs, AmountInput, etc.) — height tests
//                     still run because they are cap-independent
for (const { name, url, getInput, navigate, serial, allowZero } of PAGES.filter((p) => !p.traveling && !p.trade && !p.sanityOnly)) {
  test.describe(name, () => {
    if (serial) test.describe.configure({ mode: 'serial' });
    test.setTimeout(90_000);

    test.beforeEach(async ({ page }, testInfo) => {
      await page.goto(url);
      if (navigate) {
        const result = await navigate(page);
        if (result === false) {
          testInfo.skip(true, `${name}: prerequisite not met (account lacks access)`);
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
