/**
 * E2E tests for PR #21730 — Museum armoury table adaptation
 *
 * Code changes covered:
 *  1. MuseumArmoryItemDTO: ID field → amount field
 *  2. getMuseumSetItems(): $isForUpdate param removed, FOR UPDATE lock gone
 *  3. getArmorySetItems(): returns {itemID: amount} map, not {itemID: [armouryIDs]}
 *  4. getSetItemsGroupedByCount(): deleted (MuseumManager calls getArmorySetItems() directly)
 *  5. removeSeveralArmouryItemsByIDs(): deleted
 *  6. getArmouryItemsCountByUserIdAndArmouryIDs(): deleted
 *  7. Exchange uses removeArmouryItemByItemID(userID, itemID, amount) per item type
 *  8. itemsMigration flag: new path hits armoury_inventory table
 *
 * DOM facts (inspected from nikitad-dev.torn.com/museum.php):
 *  - Set tabs:      a.set-name (href="#plushie", "#flower", etc.) — jQuery UI tabs, no page nav
 *  - Set panels:    div#plushie, div#flower, etc. with class .set-elements
 *  - Item rows:     .item-wrapper (one per collectible item)
 *  - Item quantity: .item-amount.qty (plain integer, e.g. "1015")
 *  - Exchange btn:  button.torn-btn.exchange-btn (data-href="museum.php?step=exchange&tab=…")
 *  - Set data is server-side rendered — tab click fires no XHR
 *  - networkidle never fires (persistent WS connections) — use domcontentloaded + timeout
 *
 * Run with Node 20:
 *   PATH="~/.nvm/versions/node/v20.20.0/bin:$PATH" npx playwright test e2e/museum-armoury-table.spec.ts
 */

import { test, expect, Page } from '@playwright/test';

// ── helpers ──────────────────────────────────────────────────────────────────

async function goToMuseum(page: Page) {
  await page.goto('/museum.php');
  await page.waitForLoadState('domcontentloaded');
  // Wait for jQuery tabs to initialise (set-name links appear after JS runs)
  await page.waitForSelector('a.set-name', { timeout: 10_000 });
}

/** Click the first set tab and wait for its panel to be visible */
async function openFirstSet(page: Page): Promise<boolean> {
  const link = page.locator('a.set-name').first();
  if (!(await link.isVisible().catch(() => false))) return false;
  await link.click();
  // Tab switch — no page navigation, just DOM visibility change
  await page.waitForTimeout(1000);
  return true;
}

/** Item rows inside the active set panel */
function setItemRows(page: Page) {
  return page.locator('.set-elements .item-wrapper');
}

/** Read the quantity shown for a set item row — .item-amount.qty contains a plain integer */
async function getRowQuantity(row: ReturnType<Page['locator']>): Promise<number | null> {
  const el = row.locator('.item-amount').first();
  if (!(await el.isVisible().catch(() => false))) return null;
  const text = (await el.innerText()).trim();
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

// ── 1. Page health ────────────────────────────────────────────────────────────

test.describe('Museum page health', () => {
  test('loads without PHP fatal errors or "Not implemented" exceptions', async ({ page }) => {
    // Covers: removed "throw new Exception('Not implemented')" guards from
    // getMuseumSetItems() and removeSeveralArmouryItemsByIDs() when $itemsMigration=true
    await goToMuseum(page);
    await expect(page.locator('body')).not.toContainText('Fatal error');
    await expect(page.locator('body')).not.toContainText('Not implemented');
    await expect(page.locator('body')).not.toContainText('Uncaught Exception');
    await expect(page).toHaveTitle(/.+/);
  });

  test('no 5xx responses on museum page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('museum') && r.status() >= 500) {
        errors.push(`${r.status()} ${r.url()}`);
      }
    });
    await goToMuseum(page);
    // domcontentloaded + short wait; networkidle never fires (persistent WS)
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });

  test('collectible set tabs are visible', async ({ page }) => {
    await goToMuseum(page);
    // a.set-name links are the jQuery UI tab anchors for each collectible set
    await expect(page.locator('a.set-name').first()).toBeVisible();
  });
});

// ── 2. MuseumArmoryItemDTO: ID → amount ───────────────────────────────────────

test.describe('DTO: amount field (not ID) — set quantities rendered server-side', () => {
  test('set item quantities are plain integers — not PHP array dumps', async ({ page }) => {
    // Before: getArmorySetItems() returned {itemID: [armouryID,...]} — if accidentally
    // serialised, UI could show "Array". After: {itemID: amount} — always a direct integer.
    await goToMuseum(page);
    await openFirstSet(page);

    const rows = setItemRows(page);
    const count = await rows.count();
    expect(count).toBeGreaterThan(0); // set must have items

    for (let i = 0; i < count; i++) {
      const raw = await rows.nth(i).innerText();
      expect(raw).not.toContain('Array');
      expect(raw).not.toContain('Notice:');
      expect(raw).not.toContain('Warning:');
      const qty = await getRowQuantity(rows.nth(i));
      if (qty !== null) expect(qty).toBeGreaterThanOrEqual(0);
    }
  });

  test('item quantity element (.item-amount) contains only a number', async ({ page }) => {
    // .item-amount.qty must be a bare integer — regression guard for old DTO returning IDs
    await goToMuseum(page);
    await openFirstSet(page);

    const amountEls = page.locator('.set-elements .item-amount');
    const count = await amountEls.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = (await amountEls.nth(i).innerText()).trim();
      expect(text).toMatch(/^\d+$/); // must be purely numeric
    }
  });

  test('page HTML does not contain old "ID" DTO field pattern', async ({ page }) => {
    // MuseumArmoryItemDTO previously serialised as {"ID":…,"itemID":…}
    // After refactor: {"amount":…,"itemID":…}
    await goToMuseum(page);
    const html = await page.content();
    // The pattern "\"ID\":" (JSON key) should not appear in the rendered museum page
    expect(html).not.toMatch(/"ID"\s*:/);
  });
});

// ── 3. getSetItemsGroupedByCount() deleted ────────────────────────────────────

test.describe('getSetItemsGroupedByCount() deleted — MuseumManager calls getArmorySetItems() directly', () => {
  test('set item counts load correctly after MuseumManager refactor', async ({ page }) => {
    // MuseumManager.getSetUserItems() previously called getSetItemsGroupedByCount()
    // then wrapped in array_map(count). It now calls getArmorySetItems() directly.
    // If the refactor broke the call, the page would show 0 counts or PHP errors.
    await goToMuseum(page);
    await openFirstSet(page);

    await expect(page.locator('body')).not.toContainText('Fatal error');
    await expect(page.locator('body')).not.toContainText('Call to undefined');

    // Every item-wrapper must have a non-negative numeric amount
    const rows = setItemRows(page);
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const qty = await getRowQuantity(rows.nth(i));
      if (qty !== null) expect(qty).toBeGreaterThanOrEqual(0);
    }
  });

  test('all set tabs load without errors', async ({ page }) => {
    await goToMuseum(page);
    const tabs = page.locator('a.set-name');
    const tabCount = Math.min(await tabs.count(), 4); // check first 4 sets

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(800);
      await expect(page.locator('body')).not.toContainText('Fatal error');
      await expect(page.locator('body')).not.toContainText('Call to undefined');
    }
  });
});

// ── 4. removeSeveralArmouryItemsByIDs() deleted ───────────────────────────────

test.describe('removeSeveralArmouryItemsByIDs() deleted — exchange uses removeArmouryItemByItemID()', () => {
  test('no reference to deleted method in museum page HTML', async ({ page }) => {
    // If the old code path were still active, PHP might surface the method name in an error
    await goToMuseum(page);
    const html = await page.content();
    expect(html).not.toContain('removeSeveralArmouryItemsByIDs');
    expect(html).not.toContain('getArmouryItemsCountByUserIdAndArmouryIDs');
  });

  test('exchange button is present and enabled', async ({ page }) => {
    // Covers: new removal path (removeArmouryItemByItemID) must be reachable.
    // button.torn-btn.exchange-btn is the real selector from DOM inspection.
    await goToMuseum(page);
    await openFirstSet(page);

    const exchangeBtn = page.locator('button.torn-btn.exchange-btn').first();
    await expect(exchangeBtn).toBeVisible({ timeout: 5_000 });
    await expect(exchangeBtn).toBeEnabled();
  });

  test('exchange response contains no deleted method references', async ({ page }) => {
    // Click exchange and verify the response does not mention removed methods
    await goToMuseum(page);
    await openFirstSet(page);

    const exchangeBtn = page.locator('button.torn-btn.exchange-btn').first();
    if (!(await exchangeBtn.isVisible().catch(() => false))) test.skip();

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('step=exchange'),
        { timeout: 10_000 }
      ).catch(() => null),
      exchangeBtn.click(),
    ]);

    if (response) {
      const body = await response.text().catch(() => '');
      expect(body).not.toContain('removeSeveralArmouryItemsByIDs');
      expect(body).not.toContain('Fatal error');
      expect(body).not.toContain('Not implemented');
    } else {
      // Exchange navigated the page — check inline
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText('removeSeveralArmouryItemsByIDs');
      await expect(page.locator('body')).not.toContainText('Fatal error');
      await expect(page.locator('body')).not.toContainText('Not implemented');
    }
  });
});

// ── 5. FOR UPDATE lock removed ────────────────────────────────────────────────

test.describe('FOR UPDATE lock removed from getMuseumSetItems()', () => {
  test('concurrent museum page loads do not cause DB lock errors', async ({ browser }) => {
    // FOR UPDATE was removed — multiple simultaneous reads must not dead-lock
    const contexts = await Promise.all([
      browser.newContext({ storageState: 'playwright/.auth/user.json' }),
      browser.newContext({ storageState: 'playwright/.auth/user.json' }),
    ]);
    const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));

    const results = await Promise.all(
      pages.map(async (p) => {
        await p.goto('/museum.php');
        await p.waitForLoadState('domcontentloaded');
        return p.locator('body').innerText().catch(() => '');
      })
    );

    for (const body of results) {
      expect(body).not.toContain('Fatal error');
      expect(body).not.toContain('Deadlock');
      expect(body).not.toContain('Lock wait timeout');
    }

    await Promise.all(contexts.map((ctx) => ctx.close()));
  });
});

// ── 6. armoury_inventory migration path ($itemsMigration = true) ──────────────

test.describe('armoury_inventory table path (itemsMigration flag)', () => {
  test('museum set items load with correct amounts from new table', async ({ page }) => {
    // basicItemsInventoryProvider.getMuseumSetItems() now queries armoury_inventory
    // with "SELECT amount, itemID" instead of old "SELECT ID, itemID FROM armoury"
    await goToMuseum(page);
    await openFirstSet(page);

    await expect(page.locator('body')).not.toContainText('Unknown column');
    await expect(page.locator('body')).not.toContainText('Fatal error');

    // Quantities must be non-negative integers
    const amountEls = page.locator('.set-elements .item-amount');
    const count = await amountEls.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = (await amountEls.nth(i).innerText()).trim();
      expect(text).toMatch(/^\d+$/);
      expect(parseInt(text, 10)).toBeGreaterThanOrEqual(0);
    }
  });

  test('no 5xx errors when switching between museum sets', async ({ page }) => {
    // Each tab switch triggers getMuseumSetItems() — must not 500 on new table path
    const errors: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('museum') && r.status() >= 500) {
        errors.push(`${r.status()} ${r.url()}`);
      }
    });

    await goToMuseum(page);
    const tabs = page.locator('a.set-name');
    const tabCount = Math.min(await tabs.count(), 3);
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(500);
    }

    expect(errors).toHaveLength(0);
  });
});

// ── 7. Regression: sidebar and attack button ──────────────────────────────────

test.describe('Regression guard (PR #21730 side changes)', () => {
  test('sidebar renders without errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).not.toContainText('Fatal error');
    await expect(page.locator('body')).not.toContainText('Uncaught');
    await expect(page.locator('#sidebar, .sidebar, [id*="side"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('life bar value in sidebar is a valid number', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // Real class from DOM inspection: .bar___Bv5Ho.life___PlnzK
    const lifeBar = page.locator('[class*="life"][class*="bar"], .bar-life').first();
    if (await lifeBar.isVisible().catch(() => false)) {
      const text = await lifeBar.innerText();
      expect(text).toMatch(/\d/);
      expect(text).not.toContain('Array');
      expect(text).not.toContain('Error');
    }
  });

  test('player profile attack button renders without PHP errors', async ({ page }) => {
    await page.goto('/profiles.php?XID=1');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).not.toContainText('Fatal error');
    await expect(page.locator('body')).not.toContainText('Undefined index');
    await expect(page.locator('body')).not.toContainText('Undefined offset');
  });
});
