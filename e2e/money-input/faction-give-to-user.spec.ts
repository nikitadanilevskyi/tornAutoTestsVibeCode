import { test, expect, type Page } from '@playwright/test';
import {
  checkNegativeValues,
  checkShortcutsAndFormatting,
  checkRelativeShortcuts,
  checkValidation,
  checkInputHeight,
  fillMoney,
  VIEWPORTS,
  ZOOM_LEVELS,
} from '../helpers/money-input';

// ─── Navigation helper ────────────────────────────────────────────────────────

async function gotoGiveToUser(page: Page) {
  await page.goto('/factions.php?step=your');
  await page.locator('.faction-tabs li[data-case="controls"] a').click();
  const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
  await form.waitFor({ state: 'visible', timeout: 40_000 });
}

async function selectUser(page: Page) {
  const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
  await form.getByTestId('autocomplete-input').click();
  await page.getByRole('button', { name: /User nikitad with ID/i }).click();
}

function amountInput(page: Page) {
  return page.getByRole('textbox', { name: /How much money would you like/i });
}

// ─── Give money mode ──────────────────────────────────────────────────────────

test.describe('Faction › Give to User › Give money mode', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await gotoGiveToUser(page);
    await selectUser(page);
  });

  test('① formats exact numbers correctly', async ({ page }) => {
    await checkShortcutsAndFormatting(amountInput(page));
  });

  test('⑥–⑪ relative shortcuts: max, half, quarter, 1/3, %, fractions', async ({ page }) => {
    await checkRelativeShortcuts(amountInput(page));
  });

  test('⑰–⑳ validation: empty disables, 0 errors, abc errors, over-limit capped', async ({ page }) => {
    await checkValidation(amountInput(page));
  });

  test('① submits $1 to nikitad', async ({ page }) => {
    await fillMoney(amountInput(page), '1');
    await page.getByRole('button', { name: 'give money' }).click();
    await page.getByRole('button', { name: 'CONFIRM' }).click();
    await expect(page.getByText('You gave $1 to nikitad')).toBeVisible();
  });

  test('② submits via k shortcut — 1k resolves to 1,000 before submit', async ({ page }) => {
    const input = amountInput(page);
    await input.fill('1k');
    await input.press('Tab');
    await expect(input).toHaveValue('1,000');
    // Do not submit — avoids transferring $1,000 in every test run.
    // To test a real k-shortcut transfer, uncomment below:
    // await page.getByRole('button', { name: 'give money' }).click();
    // await page.getByRole('button', { name: 'CONFIRM' }).click();
    // await expect(page.getByText('You gave $1,000 to nikitad')).toBeVisible();
  });

  test('② m shortcut resolves to 1,000,000', async ({ page }) => {
    const input = amountInput(page);
    await input.fill('1m');
    await input.press('Tab');
    await expect(input).toHaveValue('1,000,000');
  });

  test('⑤ decimal shortcut 1.5k resolves to 1,500', async ({ page }) => {
    const input = amountInput(page);
    await input.fill('1.5k');
    await input.press('Tab');
    await expect(input).toHaveValue('1,500');
  });

  test('⑥ max shortcut fills to maximum vault amount', async ({ page }) => {
    const input = amountInput(page);
    await input.fill('max');
    await input.press('Tab');
    await expect(input).not.toHaveValue('max');
    await expect(input).not.toHaveValue('');
  });

  test('⑫ $ button click fills max value', async ({ page }) => {
    // The symbol button is next to the input inside .input-money-group
    await page.locator('.input-money-symbol').first().click();
    const input = amountInput(page);
    await expect(input).not.toHaveValue('');
  });
});

// ─── Add to balance mode ──────────────────────────────────────────────────────

test.describe('Faction › Give to User › Add to balance mode', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await gotoGiveToUser(page);
    await selectUser(page);
    await page.getByText('Add to balance').first().click();
  });

  test('③ formats exact numbers correctly', async ({ page }) => {
    await checkShortcutsAndFormatting(amountInput(page));
  });

  test('④ k / m / b shortcuts and relative shortcuts', async ({ page }) => {
    await checkRelativeShortcuts(amountInput(page));
  });

  test('⑬–⑯ negative values: -1000, -1k, -1m, -1b', async ({ page }) => {
    await checkNegativeValues(amountInput(page));
  });

  test('③ submits +$1 balance adjustment', async ({ page }) => {
    await fillMoney(amountInput(page), '1');
    await page.getByRole('button', { name: /add money/i }).click();
    await page.getByRole('button', { name: 'CONFIRM' }).click();
    await expect(
      page.getByText(/balance.*increased|increased.*\$1|\$1.*balance/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('⑬ submits -$1 (negative balance adjustment)', async ({ page }) => {
    await fillMoney(amountInput(page), '-1');
    await page.getByRole('button', { name: /add money/i }).click();
    await page.getByRole('button', { name: 'CONFIRM' }).click();
    await expect(
      page.getByText(/balance.*decreased|decreased.*\$1|removed.*\$1|you removed/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('⑭ -1k resolves to -1,000 before submit', async ({ page }) => {
    const input = amountInput(page);
    await input.fill('-1k');
    await input.press('Tab');
    await expect(input).toHaveValue('-1,000');
  });

  test('⑮ -1m resolves to -1,000,000', async ({ page }) => {
    const input = amountInput(page);
    await input.fill('-1m');
    await input.press('Tab');
    await expect(input).toHaveValue('-1,000,000');
  });

  test('⑯ -1b resolves to -1,000,000,000', async ({ page }) => {
    const input = amountInput(page);
    await input.fill('-1b');
    await input.press('Tab');
    await expect(input).toHaveValue('-1,000,000,000');
  });
});

// ─── Edit depositor balance (inline) ─────────────────────────────────────────

test.describe('Faction › Give to User › Edit depositor balance (inline)', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await gotoGiveToUser(page);
  });

  test('⑬–⑯ negative values in depositor balance editor', async ({ page }) => {
    // Each depositor row has an edit icon; click the first editable one
    const editBtn = page.locator('.depositor-list .edit-balance, [data-testid="edit-balance"]').first();
    if (!(await editBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'No depositor balance editor visible (no depositors or no permission)');
      return;
    }
    await editBtn.click();
    const input = page.locator('input.input-money').last();
    await checkNegativeValues(input);
  });
});

// ─── Height = 34 px — viewport sweep ─────────────────────────────────────────
//
// Checks the amount input in both "Give money" and "Add to balance" modes
// at every viewport breakpoint and zoom level.  Each test is self-contained
// (navigate + assert) so serial mode is not required.

test.describe('Faction › Give to User › height 34px — viewport sweep', () => {
  test.setTimeout(90_000);

  for (const viewport of VIEWPORTS) {
    test(`Give money — ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoGiveToUser(page);
      await selectUser(page);
      await checkInputHeight(amountInput(page));
    });

    test(`Add to balance — ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoGiveToUser(page);
      await selectUser(page);
      await page.getByText('Add to balance').first().click();
      await checkInputHeight(amountInput(page));
    });
  }
});

// ─── Height = 34 px — zoom sweep (desktop 1280 px) ───────────────────────────

test.describe('Faction › Give to User › height 34px — zoom sweep', () => {
  test.setTimeout(90_000);

  for (const zoom of ZOOM_LEVELS) {
    test(`Give money — ${zoom.label} zoom`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await gotoGiveToUser(page);
      await selectUser(page);
      await page.evaluate((z) => { document.body.style.zoom = String(z); }, zoom.value);
      await checkInputHeight(amountInput(page));
    });

    test(`Add to balance — ${zoom.label} zoom`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await gotoGiveToUser(page);
      await selectUser(page);
      await page.getByText('Add to balance').first().click();
      await page.evaluate((z) => { document.body.style.zoom = String(z); }, zoom.value);
      await checkInputHeight(amountInput(page));
    });
  }
});
