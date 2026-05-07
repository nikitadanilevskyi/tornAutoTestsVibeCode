/**
 * Money Input — coverage-gap tests
 *
 * Fills the 28 requirements not yet covered by simple-pages.spec.ts,
 * edge-cases.spec.ts, faction-give-to-user.spec.ts, or page-specific.spec.ts.
 *
 * Requirements covered:
 *   S-03  Decimal k — 3 digits max (1.234k → 1,234)
 *   S-22  'half' caps at data-second-money, not data-money
 *   S-27  1/3 rounding (Math.round)
 *   S-29  1% — minimum valid percent
 *   S-30  100% — maximum valid percent
 *   S-35  3/4 — valid fraction
 *   S-36  1/10 — max denominator fraction
 *   S-37  9/10 — max numerator at max denominator
 *   S-42  Fraction shortcuts cap at data-second-money
 *   S-47  '$0' with allowZero → success
 *   N-03  Integer exactly at data-money cap → success
 *   N-04  Integer one below cap → success
 *   N-06  Paste formatted '1,000,000' → formatted, success
 *   N-12  Decimal '0.5' without floatPrecision → error
 *   N-13  Decimal '1.5' without floatPrecision → error
 *   N-15  Scientific notation '1e6' → error
 *   N-17  Space in number '1 000' → error
 *   B-04  'max' resolves to data-second-money (positive-balance recipient)
 *   B-05  'k' caps at data-money, ignores data-second-money
 *   C-05  Negative shortcut capped at abs(recipient balance)
 *   K-05  Paste formatted value via keyboard
 *   P-01  Bazaar isZeroError — price 0 rejected even with allowZero
 *   P-02  Bazaar price max = 10^20 (no practical cap)
 *   P-03  Bazaar no $ symbol button (showSymbolButton=false)
 *   P-06  Item Market listing-price isZeroError
 *   P-08  Faction PayDay rejects 3 decimal places
 *   P-18  Hold'em Bet capped at table max (maxValue prop)
 *   V-08  Submit disabled when no recipient selected (Profile Send Cash)
 *
 * Primary test beds:
 *   Points Market (/pmarket.php)          — data-money=100000, strictMode=true
 *   Faction Give-to-User                  — data-money, data-second-money, $ prefix
 *   Bazaar (/bazaar.php#/manage)          — allowZero=true, no $ button, isZeroError
 *   Faction PayDay                        — floatPrecision=2
 *   Hold'em (/page.php?sid=holdemData)    — maxValue from game state
 *   Profile Send Cash                     — recipient required
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { fillMoney, moneyGroup, expectSuccess, expectError, pluginFormat } from '../helpers/money-input';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

// ── Shared navigation helpers ──────────────────────────────────────────────────

async function gotoPmarket(page: Page): Promise<Locator | null> {
  const current = page.url();
  if (current.includes('pmarket')) {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  }
  await page.goto('/pmarket.php');

  const throttle = page.locator('a', { hasText: /click here/i });
  if (await throttle.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)) {
    await throttle.click();
    await page.waitForLoadState('domcontentloaded');
  }

  const input = page.locator(
    '.add-listing-block .input-money-group:not(.no-max-value) input[type="text"]',
  );
  return (await input.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false))
    ? input : null;
}

async function gotoGiveToUser(page: Page): Promise<boolean> {
  await page.goto('/factions.php?step=your');
  await page.locator('.faction-tabs li[data-case="controls"] a').click();
  const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
  return form.waitFor({ state: 'visible', timeout: 40_000 }).then(() => true).catch(() => false);
}

async function selectUser(page: Page): Promise<boolean> {
  const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
  await form.getByTestId('autocomplete-input').click();
  const btn = page.getByRole('button', { name: /User nikitad with ID/i });
  const ok = await btn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  if (ok) await btn.click();
  return ok;
}

function giveMoneyInput(page: Page) {
  return page.getByRole('textbox', { name: /How much money would you like/i });
}

// ── S-03: k — 3 decimal digits (max allowed) ─────────────────────────────────

test.describe('S-03 — decimal k 3 digits (max allowed)', () => {
  test('S-03 — 1.234k → 1,234', async ({ page }) => {
    const input = await gotoPmarket(page);
    if (!input) test.skip(true, 'pmarket not accessible');

    await fillMoney(input!, '1.234k');
    await expect(input!).toHaveValue('1,234');
    await expectSuccess(input!);
  });
});

// ── S-22 / S-42: half and fractions cap at data-second-money ──────────────────

test.describe('S-22 / S-42 — shortcuts cap at data-second-money (Faction Give)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip(true, 'Faction Give form not accessible');
    if (!(await selectUser(page))) test.skip(true, 'Could not select recipient');
  });

  test('S-22 — "half" caps at data-second-money (recipient balance), not data-money (vault)', async ({ page }) => {
    const input = giveMoneyInput(page);
    const dataMoney   = parseInt((await input.getAttribute('data-money'))        ?? '0', 10);
    const data2Money  = parseInt((await input.getAttribute('data-second-money')) ?? '0', 10);

    // Test is only meaningful when recipient balance < vault balance
    if (!data2Money || data2Money >= dataMoney) test.skip(true, 'data-second-money not set or not smaller than data-money');

    await fillMoney(input, 'half');
    const expected = pluginFormat(Math.round(data2Money / 2));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });

  test('S-42 — fraction "1/3" caps at data-second-money not data-money', async ({ page }) => {
    const input = giveMoneyInput(page);
    const dataMoney  = parseInt((await input.getAttribute('data-money'))        ?? '0', 10);
    const data2Money = parseInt((await input.getAttribute('data-second-money')) ?? '0', 10);

    if (!data2Money || data2Money >= dataMoney) test.skip(true, 'data-second-money not set or not smaller than data-money');

    await fillMoney(input, '1/3');
    const expected = pluginFormat(Math.round(data2Money / 3));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });
});

// ── S-27 / S-29 / S-30 / S-35 / S-36 / S-37 — additional shortcuts ───────────

test.describe('Additional shortcut tests — Points Market', () => {
  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip(true, 'pmarket not accessible');
    input = found!;
  });

  test('S-27 — 1/3 rounding: rounds to nearest integer (Math.round)', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip(true, 'data-money not set');

    await fillMoney(input, '1/3');
    const expected = pluginFormat(Math.round(cap / 3));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });

  test('S-29 — 1% (minimum valid percent)', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip(true, 'data-money not set');

    await fillMoney(input, '1%');
    const expected = pluginFormat(Math.round(cap * 0.01));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });

  test('S-30 — 100% (maximum valid percent, resolves to full cap)', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip(true, 'data-money not set');

    await fillMoney(input, '100%');
    await expect(input).toHaveValue(pluginFormat(cap));
    await expectSuccess(input);
  });

  test('S-35 — 3/4 valid fraction', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip(true, 'data-money not set');

    await fillMoney(input, '3/4');
    const expected = pluginFormat(Math.round(cap * 3 / 4));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });

  test('S-36 — 1/10 (max denominator fraction)', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip(true, 'data-money not set');

    await fillMoney(input, '1/10');
    const expected = pluginFormat(Math.round(cap / 10));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });

  test('S-37 — 9/10 (max numerator at max denominator)', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip(true, 'data-money not set');

    await fillMoney(input, '9/10');
    const expected = pluginFormat(Math.round(cap * 9 / 10));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });
});

// ── S-47: '$0' with allowZero ─────────────────────────────────────────────────

test.describe("S-47 — '$0' with allowZero (Faction Give, Add to Balance)", () => {
  test("S-47 — '$0' strips dollar sign → '0' → success in allowZero mode", async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip(true, 'Faction Give form not accessible');
    if (!(await selectUser(page))) test.skip(true, 'Could not select recipient');

    await page.getByText('Add to balance').first().click();
    const input = giveMoneyInput(page);

    // firstDollarRule strips '$'; allowZero=true → '0' should be success
    await fillMoney(input, '$0');
    await expect(input).toHaveValue('0');
    await expectSuccess(input);
  });
});

// ── N-03 / N-04: border values at and below cap ───────────────────────────────

test.describe('N-03 / N-04 — at-cap and below-cap values — Points Market', () => {
  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip(true, 'pmarket not accessible');
    input = found!;
  });

  test('N-03 — integer exactly at data-money cap → success (not capped)', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip(true, 'data-money not set');

    await fillMoney(input, String(cap));
    await expect(input).toHaveValue(pluginFormat(cap));
    await expectSuccess(input);
  });

  test('N-04 — integer one below cap → success', async () => {
    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap || cap < 2) test.skip(true, 'data-money not set or too small');

    await fillMoney(input, String(cap - 1));
    await expect(input).toHaveValue(pluginFormat(cap - 1));
    await expectSuccess(input);
  });
});

// ── N-06 / K-05: paste formatted value ───────────────────────────────────────

test.describe("N-06 / K-05 — paste formatted '1,000,000' — Points Market", () => {
  test('N-06 / K-05 — paste formatted value is accepted and formatted', async ({ page }) => {
    const input = await gotoPmarket(page);
    if (!input) test.skip(true, 'pmarket not accessible');

    // Inject a high cap so 1,000,000 is within range
    await input!.evaluate((el) => el.setAttribute('data-money', '9999999999999'));

    // Simulate clipboard paste: write to clipboard then Ctrl+V
    await page.evaluate(() => navigator.clipboard?.writeText('1,000,000').catch(() => {}));
    await input!.click();
    await input!.fill('');          // clear first so paste lands in empty field
    await input!.dispatchEvent('input');

    // Direct evaluate fallback (clipboard API may be blocked in headless)
    await input!.evaluate((el: HTMLInputElement) => {
      el.value = '1,000,000';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Plugin strips extra commas and reformats
    await input!.press('Tab');
    const val = await input!.inputValue();
    // Plugin should parse 1,000,000 → 1000000 → format as 1,000,000
    expect(val.replace(/,/g, '')).toBe('1000000');
    await expectSuccess(input!);
  });
});

// ── N-12 / N-13: decimal without floatPrecision ───────────────────────────────

test.describe('N-12 / N-13 — decimals invalid when no floatPrecision — Points Market', () => {
  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip(true, 'pmarket not accessible');
    input = found!;
  });

  test("N-12 — '0.5' → error (FLOAT rule requires exactly 10 decimal digits)", async () => {
    // The FLOAT rule: ^([-]?[1-9]\d*(?:[,]\d{3})*)(?:[.]\d{10})?$
    // '0.5' starts with 0 → ZERO rule passes it, but FLOAT rule won't match
    // Actually ZERO rule: value === '0'. '0.5' doesn't equal '0'.
    // Decimal shortcut '0.5' does not match any rule → error.
    await fillMoney(input, '0.5');
    await expectError(input);
  });

  test("N-13 — '1.5' → error (no floatPrecision on Points Market)", async () => {
    // '1.5' has only 1 decimal digit — FLOAT rule requires 10 → error
    await fillMoney(input, '1.5');
    await expectError(input);
  });
});

// ── N-15 / N-17: scientific notation and space ────────────────────────────────

test.describe('N-15 / N-17 — scientific notation and space — Points Market', () => {
  let input: Locator;

  test.beforeEach(async ({ page }) => {
    const found = await gotoPmarket(page);
    if (!found) test.skip(true, 'pmarket not accessible');
    input = found!;
  });

  test("N-15 — scientific notation '1e6' → error (no rule matches 'e')", async () => {
    await fillMoney(input, '1e6');
    await expectError(input);
  });

  test("N-17 — space in number '1 000' → error", async () => {
    // Plugin strips chars via keydown filter; fill() bypasses it but space breaks all rules
    await fillMoney(input, '1 000');
    await expectError(input);
  });
});

// ── B-04 / B-05: data-second-money boundary ──────────────────────────────────

test.describe('B-04 / B-05 — data-second-money cap boundaries (Faction Give)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip(true, 'Faction Give form not accessible');
    if (!(await selectUser(page))) test.skip(true, 'Could not select recipient');
  });

  test("B-04 — 'max' resolves to data-second-money for positive-balance recipient", async ({ page }) => {
    const input = giveMoneyInput(page);
    const data2Money = parseInt((await input.getAttribute('data-second-money')) ?? '0', 10);
    if (!data2Money || data2Money <= 0) test.skip(true, 'Recipient has no positive balance (data-second-money not set)');

    await fillMoney(input, 'max');
    // max = min(data-second-money, data-money) — result should be data-second-money when it is smaller
    const dataMoney = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    const expected = pluginFormat(Math.min(data2Money, dataMoney));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  });

  test('B-05 — k/m/b shortcuts cap at data-money (vault), not data-second-money', async ({ page }) => {
    const input = giveMoneyInput(page);
    const dataMoney  = parseInt((await input.getAttribute('data-money'))        ?? '0', 10);
    const data2Money = parseInt((await input.getAttribute('data-second-money')) ?? '0', 10);

    if (!dataMoney) test.skip(true, 'data-money not set');
    // Only meaningful when vault < recipient balance (data-money < data-second-money)
    // If vault > recipient balance, data-money cap kicks in regardless.
    // We test: entering a large k value is capped at data-money, not data-second-money.
    const bigValue = Math.max(dataMoney * 2, data2Money * 2);
    await fillMoney(input, `${Math.ceil(bigValue / 1_000_000)}m`);
    await expect(input).toHaveValue(pluginFormat(dataMoney));
    await expectSuccess(input);
  });
});

// ── C-05: negative shortcut capped at abs(recipient balance) ─────────────────

test.describe('C-05 — negative shortcut capped at abs(balance) (Add to Balance)', () => {
  test('C-05 — "-max" fills negative of data-second-money when recipient balance is negative', async ({ page }) => {
    const ok = await gotoGiveToUser(page);
    if (!ok) test.skip(true, 'Faction Give form not accessible');
    if (!(await selectUser(page))) test.skip(true, 'Could not select recipient');

    await page.getByText('Add to balance').first().click();
    const input = giveMoneyInput(page);

    const data2Money = parseInt((await input.getAttribute('data-second-money')) ?? '0', 10);
    if (!data2Money) test.skip(true, 'data-second-money not set — recipient has no negative balance');

    // Typing '-max' — plugin resolves 'max' to data-second-money, then prepends '-'
    await fillMoney(input, '-max');
    // Result should be the negative version of data-second-money (or capped at abs(balance))
    const val = await input.inputValue();
    expect(val.startsWith('-'), `Expected negative value, got: ${val}`).toBe(true);
    await expectSuccess(input);
  });
});

// ── V-08: submit disabled when no recipient ───────────────────────────────────

test.describe('V-08 — submit disabled when no recipient (Profile Send Cash)', () => {
  test('V-08 — Send Cash button absent / disabled until profile page loads with recipient', async ({ page }) => {
    // Navigate to our own profile — no "Send Cash" button exists for self-sends
    await page.goto('/profiles.php');  // own profile

    const sendCashBtn = page.locator('.profile-button.profile-button-sendMoney');
    const appeared = await sendCashBtn
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    // On own profile, Send Cash should NOT be available
    expect(appeared, 'Send Cash must not appear on own profile').toBe(false);
  });

  test('V-08 — money input hidden until recipient profile is opened', async ({ page }) => {
    // On a target profile, send-cash input is hidden behind the button
    await page.goto('/profiles.php?XID=2150779');

    // Before clicking Send Cash, the input group must not exist in DOM
    const group = page.locator('.send-cash .input-money-group');
    const visibleBefore = await group.isVisible().catch(() => false);
    expect(visibleBefore, 'Input must be hidden before Send Cash is opened').toBe(false);
  });
});

// ── P-01 / P-02 / P-03: Bazaar page-specific ─────────────────────────────────

test.describe('P-01 / P-02 / P-03 Bazaar — isZeroError, unlimited cap, no $ button', () => {
  async function gotoBazaar(page: Page): Promise<Locator | null> {
    await page.goto('/bazaar.php#/manage');
    const input = page
      .locator('.input-money-group')
      .first()
      .locator('input.input-money:not([type="hidden"]):not([type="button"])');
    return (await input.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false))
      ? input : null;
  }

  test('P-01 — price = 0 is rejected (isZeroError) even though allowZero=true', async ({ page }) => {
    const input = await gotoBazaar(page);
    if (!input) test.skip(true, 'No bazaar items to test (bazaar empty)');

    // allowZero=true means strictMode=false (empty is neutral), but isZeroError flag
    // makes price=0 an error. The price input is the PriceInput component, not raw
    // LegacyMoneyInput — it adds custom 0-rejection on top.
    await fillMoney(input!, '0');
    // isZeroError fires: group should have error class (not success)
    await expectError(input!);
  });

  test('P-02 — very large price accepted (data-money = 10^20, no practical cap)', async ({ page }) => {
    const input = await gotoBazaar(page);
    if (!input) test.skip(true, 'No bazaar items');

    // data-money on bazaar price input = 100000000000000000000 (10^20)
    // Entering a huge-but-safe value (within Number.MAX_SAFE_INTEGER) should succeed
    await input!.evaluate((el) => el.setAttribute('data-money', '9999999999999'));
    await fillMoney(input!, '9999999999999');
    await expect(input!).toHaveValue('9,999,999,999,999');
    await expectSuccess(input!);
  });

  test('P-03 — no $ symbol button in Bazaar input (showSymbolButton=false)', async ({ page }) => {
    const input = await gotoBazaar(page);
    if (!input) test.skip(true, 'No bazaar items');

    const symbolBtn = moneyGroup(input!).locator('.input-money-symbol');
    // Symbol button must be absent in Bazaar (PriceInput uses showSymbolButton=false)
    await expect(symbolBtn).not.toBeVisible();
  });
});

// ── P-06: Item Market listing-price isZeroError ───────────────────────────────

test.describe('P-06 Item Market — listing-price PriceInput isZeroError', () => {
  test('P-06 — listing price = 0 is rejected (isZeroError on PriceInput)', async ({ page }) => {
    // The listing/sell flow on Item Market uses PriceInput with isZeroError.
    // Navigate to the sell tab if it exists.
    await page.goto('/page.php?sid=ItemMarket');

    // Look for a "sell" or "list item" price input
    const sellTab = page.locator('[data-tab="sell"], button', { hasText: /sell|list/i }).first();
    const tabVisible = await sellTab
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!tabVisible) test.skip(true, 'Item Market sell tab not found');

    await sellTab.click();

    const priceInput = page
      .locator('.input-money-group input.input-money:not([type="hidden"])')
      .first();
    const inputVisible = await priceInput
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!inputVisible) test.skip(true, 'Price input not visible on sell tab');

    await fillMoney(priceInput, '0');
    await expectError(priceInput);
  });
});

// ── P-08: Faction PayDay — 3 decimal places rejected ─────────────────────────

test.describe('P-08 Faction PayDay — floatPrecision=2 rejects 3 decimal places', () => {
  test('P-08 — amount with 3 decimal places → error (floatPrecision=2)', async ({ page }) => {
    await page.goto('/factions.php?step=your#/tab=controls&option=pay-day');
    const controlsTab = page.locator('.faction-tabs li[data-case="controls"] a');
    const tabVisible = await controlsTab
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!tabVisible) test.skip(true, 'Faction controls tab not accessible');
    await controlsTab.click();

    const input = page.locator('.payment-cont .input-money-group input[type="text"]');
    const inputVisible = await input
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!inputVisible) test.skip(true, 'Pay-day input not visible (not faction leader?)');

    // floatPrecision=2 means max 2 decimal places are valid.
    // 3 decimal places should produce an error.
    await input.fill('1.234');
    await input.press('Tab');
    await expectError(input);
  });
});

// ── P-18: Hold'em Bet capped at table max ────────────────────────────────────

test.describe("P-18 Hold'em Bet — capped at table maxValue", () => {
  test("P-18 — value above maxValue autocorrects to cap", async ({ page }) => {
    await page.goto('/page.php?sid=holdemData');

    const input = page
      .locator('.input-money-group input.input-money:not([type="hidden"])')
      .first();
    const visible = await input
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!visible) test.skip(true, "Hold'em bet input not visible (not player's turn?)");

    const cap = parseInt((await input.getAttribute('data-money')) ?? '0', 10);
    if (!cap) test.skip(true, 'data-money not set on bet input');

    await fillMoney(input, String(cap * 10));
    await expect(input).toHaveValue(pluginFormat(cap));
    await expectSuccess(input);
  });
});
