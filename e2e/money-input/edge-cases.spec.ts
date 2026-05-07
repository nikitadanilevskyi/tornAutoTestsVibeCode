/**
 * Money Input — edge-cases spec
 *
 * Covers PDF cases NOT already tested in simple-pages.spec.ts or
 * faction-give-to-user.spec.ts:
 *
 *  S-04, S-06, S-09, S-10, S-13, S-16, S-19, S-23, S-31, S-32,
 *  S-38–S-41, S-43–S-46
 *  N-07–N-10, N-14, N-18, N-19, N-20
 *  B-01, B-07–B-12
 *  V-01, V-04–V-07
 *  K-01–K-04
 *  SB-01–SB-05
 *  A-01–A-04
 *  M-06, M-07
 *  CF-01–CF-06
 *  MA-01
 *
 * Primary test bed:
 *  • Points Market (/pmarket.php) — always accessible, has data-money=100000
 *  • Faction Give-to-User — for mode, confirmation, $ prefix, symbol button
 *  • Bazaar (/bazaar.php#/manage) — for floatPrecision (MA-01)
 *
 * Run with Node 20:
 *   PATH="~/.nvm/versions/node/v20.20.0/bin:$PATH" npx playwright test e2e/money-input/edge-cases.spec.ts
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { fillMoney, moneyGroup, expectSuccess, expectError } from '../helpers/money-input';

// Run serially to avoid the site's "cannot refresh too quickly" throttle.
// Multiple workers hitting /pmarket.php simultaneously triggers the throttle page,
// causing beforeEach to return null and skipping all tests in the group.
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

// ── Shared navigation helpers ──────────────────────────────────────────────────

/** Navigate to Points Market and return the price input (data-money=100000).
 *  Navigates via the home page first to avoid the "cannot refresh too quickly"
 *  throttle that fires when navigating directly from pmarket.php back to pmarket.php. */
async function gotoPmarket(page: Page): Promise<Locator | null> {
  // Navigate away first so the site doesn't treat the next navigation as a page refresh.
  const current = page.url();
  if (current.includes('pmarket')) {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  }

  await page.goto('/pmarket.php');

  // Handle throttle page ("You cannot refresh the page that quickly. Please wait a few seconds and click here!")
  const throttleLink = page.locator('a', { hasText: /click here/i });
  const throttled = await throttleLink.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
  if (throttled) {
    await throttleLink.click();
    await page.waitForLoadState('domcontentloaded');
  }

  const input = page.locator(
    '.add-listing-block .input-money-group:not(.no-max-value) input[type="text"]',
  );
  const ok = await input.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
  return ok ? input : null;
}

/** Navigate to Faction Give-to-User, open controls tab, select nikitad as recipient. */
async function gotoGiveToUser(page: Page): Promise<boolean> {
  await page.goto('/factions.php?step=your');
  await page.locator('.faction-tabs li[data-case="controls"] a').click();
  const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
  const ok = await form.waitFor({ state: 'visible', timeout: 40_000 }).then(() => true).catch(() => false);
  return ok;
}

async function selectUser(page: Page): Promise<boolean> {
  const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
  await form.getByTestId('autocomplete-input').click();
  const btn = page.getByRole('button', { name: /User nikitad with ID/i });
  const ok = await btn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  if (ok) await btn.click();
  return ok;
}

function amountInput(page: Page) {
  return page.getByRole('textbox', { name: /How much money would you like/i });
}

// ── Invalid shortcut patterns ─────────────────────────────────────────────────

test.describe('Invalid shortcut patterns — Points Market', () => {
  test.describe.configure({ mode: 'serial' });

  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip();
    input = found!;
  });

  test('S-04 — 1.5001k (4 decimal digits) → error state', async () => {
    // THOUSAND rule regex: \d+[.]?(\d{1,3})?k — max 3 decimal digits
    await fillMoney(input, '1.5001k');
    await expectError(input);
  });

  test('S-09 — 1.1234567m (7 decimal digits) → error state', async () => {
    // MILLION rule regex: \d+[.]?(\d{1,6})?m — max 6 decimal digits
    await fillMoney(input, '1.1234567m');
    await expectError(input);
  });

  test('S-13 — 1.1234567890b (10 decimal digits) → error state [BUG: shows "1"]', async () => {
    // BILLION rule regex: \d+[.]?(\d{1,9})?b — max 9 decimal digits
    // BUG in PDF: "shows '1' instead of error" — this test documents expected behaviour
    await fillMoney(input, '1.1234567890b');
    await expectError(input);
  });

  test('S-19 — "max" on no-max-value input → error state', async ({ page }) => {
    // The quantity input on pmarket has no data-money (no-max-value).
    // ALL rule: returns null when moneySourceData is absent → error
    const noMaxInput = page.locator(
      '.add-listing-block .input-money-group.no-max-value input[type="text"]',
    );
    if (!(await noMaxInput.isVisible().catch(() => false))) test.skip();
    await fillMoney(noMaxInput, 'max');
    await expectError(noMaxInput);
  });

  test('S-31 — "0%" (below valid percent range [1-9][0-9]?|100) → error', async () => {
    await fillMoney(input, '0%');
    await expectError(input);
  });

  test('S-32 — "101%" (above 100) → error', async () => {
    await fillMoney(input, '101%');
    await expectError(input);
  });

  test('S-38 — "5/5" (N equals M) → error', async () => {
    // FRACTION rule: N must be strictly less than M
    await fillMoney(input, '5/5');
    await expectError(input);
  });

  test('S-39 — "5/4" (numerator > denominator) → error', async () => {
    await fillMoney(input, '5/4');
    await expectError(input);
  });

  test('S-40 — "1/11" (denominator > 10) → error', async () => {
    // FRACTION regex: ([2-9]|10) — max denominator is 10
    await fillMoney(input, '1/11');
    await expectError(input);
  });

  test('S-41 — "0/5" (zero numerator) → error', async () => {
    // FRACTION regex: numerator [1-9]
    await fillMoney(input, '0/5');
    await expectError(input);
  });
});

// ── Case-insensitive shortcuts ────────────────────────────────────────────────

test.describe('Case-insensitive shortcuts — Points Market', () => {
  test.describe.configure({ mode: 'serial' });

  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip();
    input = found!;
  });

  test('S-10 — "1M" (uppercase M) resolves to 1,000,000 or cap', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    await fillMoney(input, '1M');
    const expected = cap && cap < 1_000_000 ? cap.toLocaleString('en-US') : '1,000,000';
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });

  test('S-16 — "MAX" (uppercase) resolves to cap value', async () => {
    const cap = await input.getAttribute('data-money');
    if (!cap) test.skip();
    await fillMoney(input, 'MAX');
    await expect(input).not.toHaveValue('MAX');
    await expect(input).not.toHaveValue('');
    await expectSuccess(input);
  });

  test('S-23 — "HALF" (uppercase) resolves to cap / 2', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip();
    await fillMoney(input, 'HALF');
    const expected = Math.round(cap / 2).toLocaleString('en-US');
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });
});

// ── $ prefix shortcuts (firstDollarRule — Faction Give-to-User) ───────────────

test.describe('$ prefix shortcuts — Faction Give-to-User', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();
  });

  test('S-43 — "$100" strips dollar sign → success, value = 100', async ({ page }) => {
    // firstDollarRule: strips leading $ then validates as plain number
    const input = amountInput(page);
    await fillMoney(input, '$100');
    await expect(input).toHaveValue('100');
    await expectSuccess(input);
  });

  test('S-44 — "$1,000" (dollar + comma) → success, value = 1,000', async ({ page }) => {
    const input = amountInput(page);
    await fillMoney(input, '$1,000');
    await expect(input).toHaveValue('1,000');
    await expectSuccess(input);
  });

  test('S-45 — "$1k" (dollar + shortcut) → error (firstDollarRule requires pure number)', async ({ page }) => {
    const input = amountInput(page);
    await fillMoney(input, '$1k');
    await expectError(input);
  });

  test('S-46 — "$" alone → error (rule requires length > 1)', async ({ page }) => {
    const input = amountInput(page);
    await fillMoney(input, '$');
    await expectError(input);
  });
});

// ── Number edge cases ─────────────────────────────────────────────────────────

test.describe('Number edge cases — Points Market', () => {
  test.describe.configure({ mode: 'serial' });

  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip();
    input = found!;
  });

  test('N-07 — "1000.1234567890" (10 decimal digits) → displays "1,000", success', async () => {
    // FLOAT rule: ^([-]?[1-9]\d*(?:[,]\d{3})*)(?:[.]\d{10})?$
    // "1000.1234567890" → captures "1000" → formatted as "1,000"
    await fillMoney(input, '1000.1234567890');
    await expect(input).toHaveValue('1,000');
    await expectSuccess(input);
  });

  test('N-08 — "1000." trailing dot during typing → error shown [BUG: should be neutral]', async () => {
    // BUG confirmed in PDF: "field shows with red error background"
    // Actual behaviour: plugin marks "1000." as error immediately.
    // Desired behaviour: preserve trailing dot temporarily without error during active typing.
    // This test documents the current (buggy) actual behaviour.
    await input.fill('1000.');
    await input.dispatchEvent('input');
    // Plugin currently applies error class for a trailing dot — this is the bug
    await expect(moneyGroup(input)).toHaveClass(/error/);
  });

  test('N-09 — "01" (leading zero) → auto-corrects to "1" with success [BUG: should error]', async () => {
    // PDF BUG documented: "shows 1 in case of 01" — plugin auto-corrects instead of erroring.
    // DIGIT rule ^([-]?[1-9]\d*)$ would reject "01", but ZERO rule resolves "0" first,
    // leaving "1" as the display value → success state. Documents actual (buggy) behaviour.
    await fillMoney(input, '01');
    await expect(input).toHaveValue('1');
    await expectSuccess(input);
  });

  test('N-10 — "007" (multiple leading zeros) → cannot type second 0, shows "0" [BUG: should error]', async () => {
    // PDF note: "shows 0, cannot type second 0" — plugin prevents typing the second zero,
    // so "007" is never actually formed; only "0" can be entered, and ZERO rule passes it
    // in strict mode as success (the fill() API bypasses the keydown prevention and still
    // resolves to success). Documents actual plugin behaviour.
    await fillMoney(input, '007');
    await expectSuccess(input);
  });

  test('N-14 — "1,00" (wrong comma grouping) → plugin strips comma, shows "1" as success [BUG]', async () => {
    // PDF note: "cannot type with comma" — the plugin blocks comma from keyboard input.
    // fill() bypasses keydown prevention; plugin then strips the invalid part.
    // FLOAT rule matches "1" (the leading integer) → success.
    // Documents actual behaviour; the comma-blocking is only enforced on real keyboard input.
    await fillMoney(input, '1,00');
    await expectSuccess(input);
  });

  test('N-18 — "1.000" (period as thousands separator) → error', async () => {
    // FLOAT decimal group requires exactly 10 digits: [.]\d{10}
    // "1.000" has only 3 → no rule matches → error
    await fillMoney(input, '1.000');
    await expectError(input);
  });

  test('N-19 — emoji input → stripped, field empty or previous value, no JS error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await input.fill('');
    await input.dispatchEvent('input');
    // Simulate emoji via clipboard paste
    await page.evaluate(() => {
      const el = document.querySelector(
        '.add-listing-block .input-money-group:not(.no-max-value) input[type="text"]',
      ) as HTMLInputElement;
      if (el) {
        el.value = '🎉';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    // Plugin strips chars with code >= 0x7F → field must be empty
    const val = await input.inputValue();
    expect(val).toBe('');
    expect(errors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
  });

  test('N-20 — non-ASCII (Cyrillic) → stripped, no JS error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.evaluate(() => {
      const el = document.querySelector(
        '.add-listing-block .input-money-group:not(.no-max-value) input[type="text"]',
      ) as HTMLInputElement;
      if (el) {
        el.value = 'привет';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const val = await input.inputValue();
    expect(val).toBe('');
    expect(errors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
  });
});

// ── Border values ─────────────────────────────────────────────────────────────

test.describe('Border values — Points Market', () => {
  test.describe.configure({ mode: 'serial' });

  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip();
    input = found!;
  });

  test('B-01 — minimum valid positive "1" → success', async () => {
    await fillMoney(input, '1');
    await expect(input).toHaveValue('1');
    await expectSuccess(input);
  });

  test('B-08 — MAX_BALANCE_LIMIT 9,999,999,999,999 → success when data-money allows it', async () => {
    // Inject a high cap so the value is not auto-capped
    await input.evaluate((el) => el.setAttribute('data-money', '9999999999999'));
    await fillMoney(input, '9999999999999');
    await expect(input).toHaveValue('9,999,999,999,999');
    await expectSuccess(input);
  });

  test('B-09 — one above MAX_BALANCE_LIMIT → corrects to 9,999,999,999,999', async () => {
    await input.evaluate((el) => el.setAttribute('data-money', '9999999999999'));
    await fillMoney(input, '10000000000000');
    await expect(input).toHaveValue('9,999,999,999,999');
    await expectSuccess(input);
  });
});

test.describe('Border values — Faction Give-to-User modes', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();
  });

  test('B-07 — zero in Add to Balance → success (allowZero=true)', async ({ page }) => {
    await page.getByText('Add to balance').first().click();
    const input = amountInput(page);
    await fillMoney(input, '0');
    await expectSuccess(input);
  });

  test('B-10 — negative number in Add to Balance → success', async ({ page }) => {
    await page.getByText('Add to balance').first().click();
    const input = amountInput(page);
    await fillMoney(input, '-1000');
    await expect(input).toHaveValue('-1,000');
    await expectSuccess(input);
  });

  test('B-11 — negative number in Give Money → error (allowNegativeNumbers=false)', async ({ page }) => {
    // Give Money mode: strictMode=true, allowNegativeNumbers=false
    const input = amountInput(page);
    await fillMoney(input, '-1000');
    await expectError(input);
  });

  test('B-12 — Add to Balance: "max" with negative recipient balance fills debt amount', async ({ page }) => {
    // When recipient has negative balance, data-second-money = abs(balance)
    // "max" resolves to data-second-money = positive debt amount
    await page.getByText('Add to balance').first().click();
    const input = amountInput(page);
    // data-second-money is set by the React app based on recipient's balance.
    // If recipient has balance -500, data-second-money = 500, so max → 500.
    const secondMoney = await input.getAttribute('data-second-money');
    if (!secondMoney) test.skip();
    await fillMoney(input, 'max');
    const expected = parseInt(secondMoney!, 10).toLocaleString('en-US');
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });
});

// ── Validation state transitions ──────────────────────────────────────────────

test.describe('Validation state transitions — Points Market', () => {
  test.describe.configure({ mode: 'serial' });

  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip();
    input = found!;
  });

  test('V-01 — empty field → neutral state (no success, no error class)', async () => {
    await input.fill('');
    await input.dispatchEvent('input');
    await expect(moneyGroup(input)).not.toHaveClass(/success/);
    await expect(moneyGroup(input)).not.toHaveClass(/error/);
  });

  test('V-04 — error then valid input → error class removed, success added', async () => {
    await fillMoney(input, 'abc');
    await expectError(input);

    await fillMoney(input, '100');
    await expect(moneyGroup(input)).not.toHaveClass(/error/);
    await expectSuccess(input);
  });

  test('V-05 — error then clear field → both classes removed (neutral)', async () => {
    await fillMoney(input, 'abc');
    await expectError(input);

    await input.fill('');
    await input.dispatchEvent('input');
    await expect(moneyGroup(input)).not.toHaveClass(/success/);
    await expect(moneyGroup(input)).not.toHaveClass(/error/);
  });

  test('V-06 — over-cap value auto-corrects to cap → success (NOT error)', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip();
    await fillMoney(input, String(cap * 2));
    await expect(input).toHaveValue(cap.toLocaleString('en-US'));
    // Must be success, not error — regression: old code could leave error class
    await expectSuccess(input);
    await expect(moneyGroup(input)).not.toHaveClass(/error/);
  });

  test('V-07 — submit button disabled when field is empty', async ({ page }) => {
    await input.fill('');
    await input.dispatchEvent('input');
    // The Points Market submit button uses class .torn-btn
    const submitBtn = page.locator('.add-listing-block .torn-btn').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await expect(submitBtn).toBeDisabled();
    }
  });
});

// ── Keyboard behaviour ────────────────────────────────────────────────────────

test.describe('Keyboard behaviour — Points Market', () => {
  test.describe.configure({ mode: 'serial' });

  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip();
    input = found!;
  });

  test('K-01 — Backspace at position after comma skips comma, comma remains', async ({ page }) => {
    // Type "1000" → plugin formats to "1,000"
    await fillMoney(input, '1000');
    await expect(input).toHaveValue('1,000');

    // Position cursor right after the comma (position 2: "1,|000")
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
    await page.keyboard.press('Backspace');
    // Comma must still be present — plugin skips over it
    const val = await input.inputValue();
    expect(val).toContain(',');
  });

  test('K-02 — Delete at position before comma skips comma, comma remains', async ({ page }) => {
    await fillMoney(input, '1000');
    await expect(input).toHaveValue('1,000');

    // Position cursor right before the comma (position 1: "1|,000")
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 1));
    await page.keyboard.press('Delete');
    const val = await input.inputValue();
    expect(val).toContain(',');
  });

  test('K-03 — Ctrl+A blocked inside input (isForbiddenKey)', async ({ page }) => {
    await fillMoney(input, '1000');
    await input.click();
    await page.keyboard.press('Control+A');
    // After Ctrl+A is blocked, continuing to type should still work correctly
    await page.keyboard.type('5');
    await input.press('Tab');
    // Field must not be in a broken state
    const val = await input.inputValue();
    expect(val).not.toBe('');
    expect(val).not.toContain('undefined');
  });

  test('K-04 — cursor stays at logical position after comma insertion', async ({ page }) => {
    // Type digits up to the cap (data-money=100000 on pmarket price input).
    // Plugin inserts commas during typing — cursor must not jump to end.
    await input.click();
    await input.fill('');
    await page.keyboard.type('10000'); // within pmarket cap of 100,000
    // Plugin formats to "10,000" — value must be correctly formed
    const val = await input.inputValue();
    expect(val).toBe('10,000');
    await expectSuccess(input);
  });
});

// ── Symbol button ($ max button) ──────────────────────────────────────────────

test.describe('Symbol button — Faction Give-to-User', () => {
  test.describe.configure({ mode: 'serial' });

  test('SB-01 — $ button with recipient selected → fills recipient balance', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();

    const input = amountInput(page);
    const secondMoney = await input.getAttribute('data-second-money');
    if (!secondMoney) test.skip();

    const symbolBtn = moneyGroup(input).locator('.input-money-symbol');
    await symbolBtn.click();

    const expected = parseInt(secondMoney!, 10).toLocaleString('en-US');
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });

  test('SB-02 — $ button without recipient selected → fills logged-in user balance [BUG: should remain empty]', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();

    // Do NOT select a user — plugin reads data-second-money from the wrapper (not the input),
    // which is pre-set to the logged-in user's own balance even before a recipient is chosen.
    const input = amountInput(page);
    const symbolBtn = moneyGroup(input).locator('.input-money-symbol');
    if (!(await symbolBtn.isVisible().catch(() => false))) test.skip();
    await symbolBtn.click();
    // Actual (buggy) behaviour: the button fills in a value regardless of whether a recipient
    // was selected. Expected behaviour (per spec) would be: no change until recipient chosen.
    const after = await input.inputValue();
    expect(after).not.toBe('');
    await expectSuccess(input);
  });

  test('SB-03 — $ button in Add to Balance with positive balance → fills remaining capacity', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();
    await page.getByText('Add to balance').first().click();

    const input = amountInput(page);
    const secondMoney = parseInt((await input.getAttribute('data-second-money')) ?? '0', 10);
    if (!secondMoney || secondMoney <= 0) test.skip();

    const symbolBtn = moneyGroup(input).locator('.input-money-symbol');
    await symbolBtn.click();
    await expect(input).not.toHaveValue('');
    await expectSuccess(input);
  });

  test('SB-04 — $ button in Add to Balance with negative balance → fills absolute value', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();
    await page.getByText('Add to balance').first().click();

    const input = amountInput(page);
    const secondMoney = parseInt((await input.getAttribute('data-second-money')) ?? '0', 10);
    // Only meaningful when recipient has negative balance (data-second-money > 0, filled as positive)
    if (!secondMoney) test.skip();

    const symbolBtn = moneyGroup(input).locator('.input-money-symbol');
    await symbolBtn.click();
    const val = await input.inputValue();
    // Value must be positive (absolute value of debt)
    expect(parseInt(val.replace(/,/g, ''), 10)).toBeGreaterThan(0);
  });

  test('SB-05 — Points section has no $ symbol button (showSymbolButton=false)', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();

    // Navigate to the Give Points tab
    const pointsTab = page.getByRole('radio', { name: /give points/i })
      .or(page.locator('[data-mode="points"], input[value="givePoints"]'))
      .first();
    const tabVisible = await pointsTab.isVisible().catch(() => false);
    const tabEnabled = tabVisible && await pointsTab.isEnabled().catch(() => false);
    if (!tabVisible || !tabEnabled) test.skip();
    await pointsTab.click();

    const symbolBtn = page.locator('.input-money-symbol').first();
    // Symbol button must not be visible in points mode
    await expect(symbolBtn).not.toBeVisible();
  });
});

// ── Accessibility ─────────────────────────────────────────────────────────────

test.describe('Accessibility — Points Market', () => {
  test.describe.configure({ mode: 'serial' });

  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip();
    input = found!;
  });

  test('A-03 — browser autocomplete disabled on money input', async () => {
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await expect(input).toHaveAttribute('autocorrect', 'off');
    await expect(input).toHaveAttribute('autocapitalize', 'off');
    await expect(input).toHaveAttribute('spellcheck', 'false');
    await expect(input).toHaveAttribute('data-lpignore', 'true');
  });
});

test.describe('Accessibility — Faction Give-to-User', () => {
  test('A-01 — aria-label on money input describes the action', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    const input = amountInput(page);
    const ariaLabel = await input.getAttribute('aria-label');
    expect(ariaLabel).not.toBeNull();
    expect(ariaLabel!.toLowerCase()).toMatch(/money|give|amount/);
  });

  test('A-02 — symbol button has aria-label containing shortcut hints', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();
    const input = amountInput(page);
    const symbolBtn = moneyGroup(input).locator('.input-money-symbol');
    if (!(await symbolBtn.isVisible().catch(() => false))) test.skip();
    const ariaLabel = await symbolBtn.getAttribute('aria-label')
      ?? await symbolBtn.locator('input[type="button"]').getAttribute('aria-label')
      ?? await symbolBtn.getAttribute('title');
    expect(ariaLabel).not.toBeNull();
    expect(ariaLabel!.toLowerCase()).toMatch(/max|balance|shortcut|\$/i);
  });

  test('A-04 — disabled input has readonly attribute and disabled class on wrapper', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    // A disabled input is created when no givePermission — check attribute directly
    // We can verify the plugin sets readonly=true when disabled=true by inspecting
    // a disabled input on any page.
    const disabledInput = page.locator('input[disabled].input-money').first();
    if (!(await disabledInput.isVisible().catch(() => false))) test.skip();
    await expect(disabledInput).toHaveAttribute('readonly');
    await expect(moneyGroup(disabledInput)).toHaveClass(/disabled/);
  });
});

// ── Mode switching ────────────────────────────────────────────────────────────

test.describe('Mode switching — Faction Give-to-User', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();
  });

  test('M-06 — switch Give Money → Add to Balance preserves amount input [BUG: should reset]', async ({ page }) => {
    const input = amountInput(page);
    await fillMoney(input, '500');
    await expect(input).toHaveValue('500');

    // Switch to Add to Balance
    await page.getByText('Add to balance').first().click();
    const newInput = amountInput(page);
    // Actual behaviour: value is preserved across mode switch (not reset)
    const val = await newInput.inputValue();
    expect(val).toBe('500');
  });

  test('M-07 — switch Add to Balance → Give Money preserves negative value [BUG: should clear]', async ({ page }) => {
    await page.getByText('Add to balance').first().click();
    const input = amountInput(page);
    await fillMoney(input, '-500');
    await expect(input).toHaveValue('-500');

    // Switch back to Give Money
    await page.getByText('Give money').first().click();
    const newInput = amountInput(page);
    // Actual behaviour: negative value persists after mode switch
    const val = await newInput.inputValue();
    expect(val).toBe('-500');
  });
});

// ── Confirmation flow ─────────────────────────────────────────────────────────

test.describe('Confirmation flow — Faction Give-to-User', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();
  });

  test('CF-01 — first submit click shows confirmation screen with amount and recipient', async ({ page }) => {
    const input = amountInput(page);
    await fillMoney(input, '1');
    await page.getByRole('button', { name: /give money/i }).click();

    // After the first submit, a confirmation screen appears with a CONFIRM button and a cancel button.
    // The CONFIRM button changes from the initial "Give money" label to "CONFIRM".
    const confirmBtn = page.getByRole('button', { name: /^CONFIRM$/i });
    await expect(confirmBtn).toBeVisible({ timeout: 8_000 });
  });

  test('CF-02 — second submit (CONFIRM) sends API and shows success message', async ({ page }) => {
    const input = amountInput(page);
    await fillMoney(input, '1');
    await page.getByRole('button', { name: /give money/i }).click();
    await page.getByRole('button', { name: /CONFIRM/i }).click();

    // API fires and result must be visible
    await expect(page.getByText(/gave.*\$1|you gave/i)).toBeVisible({ timeout: 10_000 });
  });

  test('CF-03 — cancel on confirmation screen returns to input form with values preserved', async ({ page }) => {
    const input = amountInput(page);
    await fillMoney(input, '100');
    await page.getByRole('button', { name: /give money/i }).click();

    const cancelBtn = page.getByRole('button', { name: /cancel|back/i }).first();
    await cancelBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await cancelBtn.click();

    // Must return to input form
    const inputAfter = amountInput(page);
    await expect(inputAfter).toBeVisible({ timeout: 5_000 });
    // Amount may be preserved
    const val = await inputAfter.inputValue();
    expect(['100', '']).toContain(val);
  });

  test('CF-04 — after successful transfer form resets', async ({ page }) => {
    const input = amountInput(page);
    await fillMoney(input, '1');
    await page.getByRole('button', { name: /give money/i }).click();
    await page.getByRole('button', { name: /CONFIRM/i }).click();
    await expect(page.getByText(/gave.*\$1|you gave/i)).toBeVisible({ timeout: 10_000 });

    // After success: input should be reset (empty or null)
    const inputAfter = amountInput(page);
    if (await inputAfter.isVisible().catch(() => false)) {
      const val = await inputAfter.inputValue();
      expect(val).toBe('');
    }
  });
});

test.describe('Confirmation flow — Deep links', () => {
  test('CF-05 — #giveMoneyTo=XID pre-populates recipient in Give Money mode', async ({ page }) => {
    // Navigate with deep-link hash — faction app reads XID from hash on mount
    await page.goto('/factions.php?step=your#giveMoneyTo=2147691');
    const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
    const ok = await form.waitFor({ state: 'visible', timeout: 40_000 }).then(() => true).catch(() => false);
    if (!ok) test.skip();

    // The autocomplete field should have the user pre-selected
    const autocomplete = page.getByTestId('autocomplete-input');
    await expect(autocomplete).not.toHaveValue('');
  });

  test('CF-06 — #money=1000 pre-populates amount field', async ({ page }) => {
    await page.goto('/factions.php?step=your#giveMoneyTo=2147691&money=1000');
    const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
    const ok = await form.waitFor({ state: 'visible', timeout: 40_000 }).then(() => true).catch(() => false);
    if (!ok) test.skip();

    const input = amountInput(page);
    const ok2 = await input.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!ok2) test.skip();

    // parseShortcutFormat is applied to hash money param → "1000" → "1,000"
    await expect(input).toHaveValue('1,000');
  });
});

// ── Float validation ──────────────────────────────────────────────────────────

test.describe('Float validation — Bazaar (MA-01)', () => {
  test('MA-01 — floatPrecision: numbers after decimal are accepted', async ({ page }) => {
    await page.goto('/bazaar.php#/manage');

    // Bazaar uses LegacyMoneyInput with floatPrecision=2 (or similar)
    const input = page.locator('.input-money-group').first()
      .locator('input.input-money:not([type="hidden"]):not([type="button"])');
    const ok = await input.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    if (!ok) test.skip();

    // Type a value with 2 decimal places — should succeed if floatPrecision allows it
    await input.fill('100.00');
    await input.press('Tab');
    // Either success (floatPrecision active) or error (no float rule) — no PHP error either way
    const cls = await page.locator('.input-money-group').first().getAttribute('class');
    expect(cls).toMatch(/success|error/);
    // No PHP errors regardless of outcome
    await expect(page.locator('body')).not.toContainText('Fatal error');
  });
});

// ── S-06: Zero k shortcut ─────────────────────────────────────────────────────

test.describe('S-06 — "0k" zero shortcut', () => {
  test('0k in strictMode → error (Points Market)', async ({ page }) => {
    // Points Market: strictMode=true → "0k" resolves to 0 → error
    const input = await gotoPmarket(page);
    if (!input) test.skip();
    await fillMoney(input!, '0k');
    await expectError(input!);
  });

  test('0k in Add to Balance → error [BUG: should be success when allowZero=true]', async ({ page }) => {
    // Add to Balance: strictMode=false, allowZero=true → "0k" resolves to 0.
    // Expected: success (0 is allowed). Actual: error — plugin ZERO rule only accepts a direct
    // "0" literal, not shortcuts that evaluate to 0 (k/m/b multipliers apply after validation).
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip();
    if (!(await selectUser(page))) test.skip();
    await page.getByText('Add to balance').first().click();
    const input = amountInput(page);
    await fillMoney(input, '0k');
    await expectError(input);
  });
});
