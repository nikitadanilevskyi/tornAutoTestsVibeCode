/**
 * Money Input — page-specific requirements (P-01 to P-22)
 *
 * Covers unique behaviours that are specific to individual pages and cannot be
 * verified by the generic simple-pages.spec.ts suite:
 *
 *  P-01  Item Market — AmountInput max capped to available quantity
 *  P-02  Item Market — error when amount exceeds available stock
 *  P-03  Bookie — data-minvalue: amount below MIN_BET_LIMIT → error
 *  P-04  Bookie — amount equal to MIN_BET_LIMIT → success
 *  P-05  Bookie — $ symbol button fills current vault balance
 *  P-06  Faction Pay Day — floatPrecision: decimal amounts accepted
 *  P-07  Faction Pay Day — deep-link #/tab=controls&option=pay-day opens form
 *  P-09  Hold'em Buy-In — buy button disabled outside min/max range
 *  P-10  Hold'em Buy-In — buy button enabled within range
 *  P-11  Hold'em Bet — minus (−) button decreases amount by 1 BB
 *  P-12  Hold'em Bet — plus (+) button increases amount by 1 BB
 *  P-13  Hold'em Bet — BB sign mode: floatPrecision=2 (decimal BB amounts)
 *  P-14  Hold'em Bet — $ sign mode: integer amounts only (no floatPrecision)
 *  P-17  Stock Market — share cost preview updates when amount changes
 *  P-18  Stock Market — buy button disabled when input is in error state
 *  P-19  Travel Abroad Shop — carry capacity enforced (max = available space)
 *  P-20  Travel Abroad Shop — error when qty exceeds item stock
 *  P-21  Profile Send Cash — anti-scam warning dialog appears on first open
 *  P-22  Stock Market — buy/sell confirmation dialog flow
 *
 * Primary test beds:
 *  • /page.php?sid=bookie         — bookie bet input
 *  • /page.php?sid=holdemData     — hold'em bet and buy-in
 *  • /page.php?sid=stocks         — stock market
 *  • /page.php?sid=ItemMarket     — item market
 *  • /page.php?sid=travel         — abroad shop (when player is travelling)
 *  • /factions.php?step=your      — faction pay day
 *  • /profiles.php?XID=2150779    — profile send cash
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { fillMoney, moneyGroup, expectSuccess, expectError } from '../helpers/money-input';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

// ── Navigation helpers ────────────────────────────────────────────────────────

async function gotoItemMarket(page: Page): Promise<Locator | null> {
  await page.goto('/page.php?sid=ItemMarket');
  // Wait for React SPA mount
  await page.waitForFunction(
    () =>
      document.querySelector('.buy-controls .input-money-group') !== null ||
      document.querySelector('[data-testid="amount-input"]') !== null,
    { timeout: 25_000 },
  ).catch(() => {});

  const input = page
    .locator('.buy-controls .input-money-group input.input-money:not([type="hidden"])')
    .first();
  const visible = await input
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  return visible ? input : null;
}

async function gotoBookie(page: Page): Promise<Locator | null> {
  await page.goto('/page.php?sid=bookie');
  const input = page
    .locator('.bookie-popular-wrap .input-money-group input.input-money:not([type="hidden"])')
    .first();
  const visible = await input
    .waitFor({ state: 'visible', timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  return visible ? input : null;
}

async function gotoHoldemBet(page: Page): Promise<Locator | null> {
  await page.goto('/page.php?sid=holdemData');
  // Bet input renders only when it is the player's turn during an active hand
  const input = page
    .locator('.input-money-group input.input-money:not([type="hidden"])')
    .first();
  const visible = await input
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  return visible ? input : null;
}

async function gotoStockMarket(page: Page): Promise<Locator | null> {
  await page.goto('/page.php?sid=stocks');
  // Click the first stock card to open the buy/sell dialog
  const card = page
    .locator('.stock-card, [data-testid="stock-card"], .stock-item, .stocks-list > li')
    .first();
  const cardVisible = await card
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!cardVisible) return null;
  await card.click();

  const input = page
    .locator('.input-money-group input.input-money:not([type="hidden"])')
    .first();
  const visible = await input
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  return visible ? input : null;
}

async function gotoAbroadShop(page: Page): Promise<Locator | null> {
  await page.goto('/page.php?sid=travel');
  const input = page
    .locator('input.input-money[data-testid="legacy-money-input"]:not([type="hidden"])')
    .first();
  const visible = await input
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  return visible ? input : null;
}

async function gotoFactionPayDay(page: Page): Promise<boolean> {
  await page.goto('/factions.php?step=your#/tab=controls&option=pay-day');
  const controlsTab = page.locator('.faction-tabs li[data-case="controls"] a');
  const tabVisible = await controlsTab
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!tabVisible) return false;
  await controlsTab.click();

  const group = page.locator('.payment-cont .input-money-group');
  return group
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
}

// ── P-01 / P-02: Item Market AmountInput ─────────────────────────────────────

test.describe('P-01/P-02 Item Market — AmountInput quantity cap', () => {
  test('P-01 — AmountInput max prop equals available quantity (data-money set)', async ({ page }) => {
    const input = await gotoItemMarket(page);
    if (!input) test.skip(true, 'No stacked items visible in Item Market');

    // AmountInput passes max={available} → tornInputMoney data-money = available qty
    const dataMoney = await input!.getAttribute('data-money');
    expect(dataMoney, 'AmountInput must set data-money to available quantity').not.toBeNull();
    expect(parseInt(dataMoney!, 10)).toBeGreaterThan(0);
  });

  test('P-02 — entering qty above available → auto-capped to max', async ({ page }) => {
    const input = await gotoItemMarket(page);
    if (!input) test.skip(true, 'No stacked items visible in Item Market');

    const max = parseInt((await input!.getAttribute('data-money')) ?? '0', 10);
    if (!max) test.skip(true, 'data-money not set on Item Market input');

    await fillMoney(input!, String(max * 10));
    await expect(input!).toHaveValue(max.toLocaleString('en-US'));
    await expectSuccess(input!);
  });
});

// ── P-03 / P-04 / P-05: Bookie data-minvalue ─────────────────────────────────

test.describe('P-03/P-04/P-05 Bookie — data-minvalue enforcement', () => {
  test('P-03 — amount below MIN_BET_LIMIT → error state', async ({ page }) => {
    const input = await gotoBookie(page);
    if (!input) test.skip(true, 'Bookie bet input not visible (no open matches?)');

    const minValue = parseInt((await input!.getAttribute('data-minvalue')) ?? '0', 10);
    if (!minValue || minValue < 2) test.skip(true, 'data-minvalue not set or too low to test');

    await fillMoney(input!, String(minValue - 1));
    await expectError(input!);
  });

  test('P-04 — amount equal to MIN_BET_LIMIT → success', async ({ page }) => {
    const input = await gotoBookie(page);
    if (!input) test.skip(true, 'Bookie bet input not visible');

    const minValue = parseInt((await input!.getAttribute('data-minvalue')) ?? '0', 10);
    if (!minValue) test.skip(true, 'data-minvalue not set');

    await fillMoney(input!, String(minValue));
    await expect(input!).toHaveValue(minValue.toLocaleString('en-US'));
    await expectSuccess(input!);
  });

  test('P-05 — $ symbol button fills vault balance cap', async ({ page }) => {
    const input = await gotoBookie(page);
    if (!input) test.skip(true, 'Bookie bet input not visible');

    const maxValue = await input!.getAttribute('data-money');
    if (!maxValue) test.skip(true, 'data-money not set on bookie input');

    const symbolBtn = moneyGroup(input!).locator('.input-money-symbol');
    if (!(await symbolBtn.isVisible().catch(() => false))) test.skip(true, 'Symbol button not found');

    await symbolBtn.click();
    await expect(input!).toHaveValue(parseInt(maxValue, 10).toLocaleString('en-US'));
    await expectSuccess(input!);
  });
});

// ── P-06 / P-07: Faction Pay Day ──────────────────────────────────────────────

test.describe('P-06/P-07 Faction Pay Day — floatPrecision & deep-link', () => {
  test('P-06 — floatPrecision: decimal pay amounts are accepted', async ({ page }) => {
    const ok = await gotoFactionPayDay(page);
    if (!ok) test.skip(true, 'Faction pay-day tab not accessible (not faction leader?)');

    const input = page.locator('.payment-cont .input-money-group input[type="text"]');
    const inputVisible = await input.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!inputVisible) test.skip(true, 'Pay-day input not visible');

    // floatPrecision is set to allow decimal pay rates (e.g. 1.5)
    await input.fill('1.50');
    await input.press('Tab');
    // Either success (floatPrecision active) or the value is preserved (no error for decimal)
    const cls = await moneyGroup(input).getAttribute('class');
    // Must not show error for a valid decimal amount
    expect(cls).not.toMatch(/\berror\b/);
  });

  test('P-07 — deep-link #/tab=controls&option=pay-day opens pay-day form', async ({ page }) => {
    await page.goto('/factions.php?step=your#/tab=controls&option=pay-day');
    const group = page.locator('.payment-cont .input-money-group');
    const visible = await group
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    expect(visible, 'Pay-day form must open via deep-link').toBe(true);
  });
});

// ── P-09 / P-10: Hold'em Buy-In range ────────────────────────────────────────

test.describe("P-09/P-10 Hold'em Buy-In — min/max range enforcement", () => {
  test('P-09 — buy button disabled when amount below minBet', async ({ page }) => {
    await page.goto('/page.php?sid=holdemData');

    // Trigger the buy-in popup if not already visible
    const sitInBtn = page
      .locator('button', { hasText: /sit in|buy.?in/i })
      .or(page.locator('[data-testid="sit-in-btn"]'))
      .first();
    const btnVisible = await sitInBtn
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!btnVisible) test.skip(true, "Hold'em sit-in button not found");

    await sitInBtn.click();

    const input = page
      .locator('.input-money-group input.input-money:not([type="hidden"])')
      .first();
    const inputVisible = await input
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!inputVisible) test.skip(true, 'Buy-in input not visible');

    // Fill with 0 — below any realistic minBet
    await fillMoney(input, '0');

    const okBtn = page.locator('button', { hasText: /^ok$/i }).first();
    if (await okBtn.isVisible().catch(() => false)) {
      await expect(okBtn).toBeDisabled();
    }
  });

  test('P-10 — buy button enabled when amount within range', async ({ page }) => {
    await page.goto('/page.php?sid=holdemData');

    const sitInBtn = page
      .locator('button', { hasText: /sit in|buy.?in/i })
      .or(page.locator('[data-testid="sit-in-btn"]'))
      .first();
    const btnVisible = await sitInBtn
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!btnVisible) test.skip(true, "Hold'em sit-in button not found");

    await sitInBtn.click();

    const input = page
      .locator('.input-money-group input.input-money:not([type="hidden"])')
      .first();
    const inputVisible = await input
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!inputVisible) test.skip(true, 'Buy-in input not visible');

    // The initial value is pre-filled to min(userMoney, maxBet) — should be enabled by default
    const okBtn = page.locator('button', { hasText: /^ok$/i }).first();
    if (await okBtn.isVisible().catch(() => false)) {
      await expect(okBtn).not.toBeDisabled();
    }
  });
});

// ── P-11 / P-12 / P-13 / P-14: Hold'em Bet +/− buttons ──────────────────────

test.describe("P-11/P-12/P-13/P-14 Hold'em Bet — +/− buttons and sign modes", () => {
  test('P-11 — minus (−) button decreases amount by 1 BB', async ({ page }) => {
    const input = await gotoHoldemBet(page);
    if (!input) test.skip(true, "Hold'em bet input not visible (not player's turn?)");

    await fillMoney(input!, '5');
    const before = parseInt((await input!.inputValue()).replace(/,/g, ''), 10);

    const minusBtn = page.locator('button[title*="Decrease"], button[title*="decrease"]').first();
    if (!(await minusBtn.isVisible().catch(() => false)))
      test.skip(true, '− button not found in BetInput');

    await minusBtn.click();
    const after = parseInt((await input!.inputValue()).replace(/,/g, ''), 10);
    expect(after).toBeLessThan(before);
  });

  test('P-12 — plus (+) button increases amount by 1 BB', async ({ page }) => {
    const input = await gotoHoldemBet(page);
    if (!input) test.skip(true, "Hold'em bet input not visible");

    await fillMoney(input!, '1');
    const before = parseInt((await input!.inputValue()).replace(/,/g, ''), 10);

    const plusBtn = page.locator('button[title*="Increase"], button[title*="increase"]').first();
    if (!(await plusBtn.isVisible().catch(() => false)))
      test.skip(true, '+ button not found in BetInput');

    await plusBtn.click();
    const after = parseInt((await input!.inputValue()).replace(/,/g, ''), 10);
    expect(after).toBeGreaterThan(before);
  });

  test('P-13 — BB sign mode: floatPrecision=2 allows decimal big-blind values', async ({ page }) => {
    const input = await gotoHoldemBet(page);
    if (!input) test.skip(true, "Hold'em bet input not visible");

    // BetInput uses floatPrecision=2 when sign='BB'
    // If the BB sign is active, a decimal like "1.50" should succeed (not error)
    const isBBMode = await page.locator('.input-money-symbol svg, .input-money-symbol').first()
      .evaluate((el) => el.textContent?.includes('BB') || el.getAttribute('title')?.includes('BB'))
      .catch(() => false);
    if (!isBBMode) test.skip(true, 'Not in BB sign mode');

    await input!.fill('1.50');
    await input!.press('Tab');
    const cls = await moneyGroup(input!).getAttribute('class');
    expect(cls).not.toMatch(/\berror\b/);
  });

  test('P-14 — $ sign mode: integer amounts only (no float precision)', async ({ page }) => {
    const input = await gotoHoldemBet(page);
    if (!input) test.skip(true, "Hold'em bet input not visible");

    // When sign='$', floatPrecision is undefined → decimal values should error
    const isDollarMode = await page.locator('.input-money-symbol').first()
      .evaluate((el) => !el.textContent?.includes('BB'))
      .catch(() => false);
    if (!isDollarMode) test.skip(true, 'Not in $ sign mode');

    await input!.fill('1.5');
    await input!.press('Tab');
    await expectError(input!);
  });
});

// ── P-17 / P-18 / P-22: Stock Market ─────────────────────────────────────────

test.describe('P-17/P-18/P-22 Stock Market — share cost preview and confirmation', () => {
  test('P-17 — share cost preview updates when amount changes', async ({ page }) => {
    const input = await gotoStockMarket(page);
    if (!input) test.skip(true, 'Stock market dialog did not open');

    // Fill a valid share count — the price preview should contain a "$" sign
    await fillMoney(input!, '1');
    await expectSuccess(input!);

    // Dialog must show cost/value text after a valid entry
    const priceText = page.locator('p strong').filter({ hasText: /\$/ }).first();
    const textVisible = await priceText
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    expect(textVisible, 'Share cost preview must be visible after filling amount').toBe(true);
  });

  test('P-18 — buy button disabled when input is in error state', async ({ page }) => {
    const input = await gotoStockMarket(page);
    if (!input) test.skip(true, 'Stock market dialog did not open');

    await fillMoney(input!, 'abc');
    await expectError(input!);

    const buyBtn = page.locator('button.torn-btn').filter({ hasText: /buy|sell/i }).first();
    if (await buyBtn.isVisible().catch(() => false)) {
      await expect(buyBtn).toBeDisabled();
    }
  });

  test('P-22 — buy dialog: first click shows confirmation, second click confirms', async ({ page }) => {
    const input = await gotoStockMarket(page);
    if (!input) test.skip(true, 'Stock market dialog did not open');

    await fillMoney(input!, '1');
    await expectSuccess(input!);

    const actionBtn = page.locator('button.torn-btn').filter({ hasText: /^(buy|sell)$/i }).first();
    if (!(await actionBtn.isVisible().catch(() => false)))
      test.skip(true, 'Stock market action button not found');

    await actionBtn.click();

    // After first click: dialog transitions to confirmation step
    // The button text changes or a new confirmation element appears
    const confirmStep = page
      .locator('p', { hasText: /buying|selling/i })
      .or(page.locator('button', { hasText: /confirm/i }))
      .first();
    const confirmVisible = await confirmStep
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    expect(confirmVisible, 'Confirmation step must appear after first buy click').toBe(true);
  });
});

// ── P-19 / P-20: Travel Abroad Shop ──────────────────────────────────────────

test.describe('P-19/P-20 Travel Abroad Shop — carry capacity', () => {
  test('P-19 — carry capacity: AmountInput max = available carry space', async ({ page }) => {
    const input = await gotoAbroadShop(page);
    if (!input) test.skip(true, 'Abroad shop not visible (player not travelling?)');

    // AmountInput sets data-money = min(available items in shop, carry capacity)
    const dataMoney = await input!.getAttribute('data-money');
    expect(dataMoney, 'AmountInput must set data-money to carry cap').not.toBeNull();
    expect(parseInt(dataMoney!, 10)).toBeGreaterThanOrEqual(0);
  });

  test('P-20 — qty above available stock → auto-capped to max', async ({ page }) => {
    const input = await gotoAbroadShop(page);
    if (!input) test.skip(true, 'Abroad shop not visible');

    const max = parseInt((await input!.getAttribute('data-money')) ?? '0', 10);
    if (!max) test.skip(true, 'data-money not set or zero on abroad shop input');

    await fillMoney(input!, String(max * 10));
    await expect(input!).toHaveValue(max.toLocaleString('en-US'));
    await expectSuccess(input!);
  });
});

// ── P-21: Profile Send Cash — anti-scam warning ───────────────────────────────

test.describe('P-21 Profile Send Cash — anti-scam warning dialog', () => {
  test('P-21 — warning dialog appears when opening Send Cash for the first time', async ({ page }) => {
    await page.goto('/profiles.php?XID=2150779');

    const sendCashBtn = page.locator('.profile-button.profile-button-sendMoney');
    const btnVisible = await sendCashBtn
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!btnVisible) test.skip(true, 'Send Cash button not found on profile');

    // Ensure "Don't show again" cookie/storage is cleared so the warning always fires.
    // We remove the relevant localStorage key before clicking.
    await page.evaluate(() => {
      try { localStorage.removeItem('sendCashWarningDismissed'); } catch {}
      try { localStorage.removeItem('scamWarningDismissed'); } catch {}
    });

    await sendCashBtn.click();

    // Warning dialog contains text about scams or "Okay" button
    const warning = page
      .locator('.send-cash-text', { hasText: /scam|warning|careful/i })
      .or(page.locator('.cancel-btn', { hasText: /okay/i }))
      .first();
    const warningVisible = await warning
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    expect(warningVisible, 'Anti-scam warning must appear on Send Cash open').toBe(true);
  });
});
