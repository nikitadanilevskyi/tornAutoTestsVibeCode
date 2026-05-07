/**
 * Branch 22097-dropdown-width
 *
 * Two independent changes:
 *  A) .donator-top-links-dropdown width 237 px → 205 px (donator.css)
 *  B) Slow Queries Log migrated from loader.php?sid=manageSlowQueriesLog
 *     to page.php?sid=logSlowQueries (admin-only page)
 */

import { test, expect, Page } from '@playwright/test';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Returns computed width (px) of the first matching element, or null if absent. */
async function computedWidth(page: Page, selector: string): Promise<number | null> {
  return page.locator(selector).first().evaluate((el) => {
    const w = getComputedStyle(el as HTMLElement).width;
    return w ? parseFloat(w) : null;
  }).catch(() => null);
}

// ─── A: Donator currency dropdown width ──────────────────────────────────────

test.describe('Donator currency dropdown — width 205 px', () => {
  // The dropdown is rendered only on /donationinfo.php (Torn Donatorship page),
  // injected into the page header via content_title() in TCDonator::run('donationinfo').
  // It is only visible for accounts with donator status — tests skip gracefully otherwise.

  test.beforeEach(async ({ page }) => {
    await page.goto('/donationinfo.php');
  });

  test('① container width is 205 px (not 237 px)', async ({ page }) => {
    const w = await computedWidth(page, '.donator-top-links-dropdown');
    if (w === null) test.skip(); // account is not a donator
    expect(w, 'dropdown container width').toBe(205);
  });

  test('② dropdown list width is 205 px in .r (RTL) layout', async ({ page }) => {
    const w = await computedWidth(
      page,
      '.r .donator-top-links-dropdown .select-wrap .select-list',
    );
    if (w === null) test.skip();
    expect(w, 'dropdown list width in .r layout').toBe(205);
  });

  test('③ dropdown text is not clipped', async ({ page }) => {
    const dropdown = page.locator('.donator-top-links-dropdown').first();
    if (!(await dropdown.isVisible())) test.skip();

    // No element inside should overflow its container horizontally.
    const overflows = await dropdown.evaluate((el) => {
      return [...el.querySelectorAll('*')].some(
        (child) => (child as HTMLElement).scrollWidth > el.clientWidth + 2, // 2 px tolerance
      );
    });
    expect(overflows, 'no child should overflow the dropdown').toBe(false);
  });

  test('④ dropdown does not cause horizontal page scroll', async ({ page }) => {
    const bodyScrollWidth = await page.evaluate(
      () => document.body.scrollWidth > window.innerWidth,
    );
    expect(bodyScrollWidth, 'page should not scroll horizontally').toBe(false);
  });

  test('⑤ dropdown opens and list is visible', async ({ page }) => {
    const trigger = page.locator('.donator-top-links-dropdown').first();
    if (!(await trigger.isVisible())) test.skip();

    await trigger.click();
    const list = page.locator('.donator-top-links-dropdown .select-list').first();
    await expect(list).toBeVisible();
  });

  test('⑥ selecting a currency option does not break layout', async ({ page }) => {
    const trigger = page.locator('.donator-top-links-dropdown').first();
    if (!(await trigger.isVisible())) test.skip();

    await trigger.click();
    const firstOption = page
      .locator('.donator-top-links-dropdown .select-list li')
      .first();
    if (!(await firstOption.isVisible())) test.skip();
    await firstOption.click();

    // After selection the dropdown should still be 205 px wide.
    const w = await computedWidth(page, '.donator-top-links-dropdown');
    expect(w, 'width unchanged after selection').toBe(205);
  });

  // Responsive viewports
  for (const { label, width } of [
    { label: 'mobile (375 px)',  width: 375  },
    { label: 'tablet (600 px)',  width: 600  },
    { label: 'desktop (1280 px)', width: 1280 },
  ] as const) {
    test(`⑦ dropdown usable at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/donationinfo.php');

      const dropdown = page.locator('.donator-top-links-dropdown').first();
      if (!(await dropdown.isVisible())) test.skip();

      const w = await computedWidth(page, '.donator-top-links-dropdown');
      expect(w, `dropdown width at ${label}`).toBe(205);

      // Check no horizontal overflow at this viewport.
      const overflows = await page.evaluate(
        () => document.body.scrollWidth > window.innerWidth,
      );
      expect(overflows, 'no horizontal overflow').toBe(false);
    });
  }
});

// ─── B: Slow Queries Log — page migration ────────────────────────────────────

test.describe('Slow Queries Log — page migration (admin)', () => {
  // ── redirect ─────────────────────────────────────────────────────────────

  test('⑧ old URL /loader.php?sid=manageSlowQueriesLog redirects to new URL', async ({ page }) => {
    await page.goto('/loader.php?sid=manageSlowQueriesLog');
    await expect(page).toHaveURL(/page\.php\?sid=logSlowQueries/);
  });

  test('⑨ old URL preserves extra query params through the redirect', async ({ page }) => {
    await page.goto('/loader.php?sid=manageSlowQueriesLog&whiteListed=1');
    await expect(page).toHaveURL(/page\.php\?sid=logSlowQueries/);
    await expect(page).toHaveURL(/whiteListed=1/);
  });

  // ── new page renders ──────────────────────────────────────────────────────

  test.describe('new page /page.php?sid=logSlowQueries', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/page.php?sid=logSlowQueries');
    });

    test('⑩ page loads without PHP errors', async ({ page }) => {
      // No "Fatal error" or "Warning:" text visible.
      await expect(page.locator('body')).not.toContainText('Fatal error');
      await expect(page.locator('body')).not.toContainText('Warning:');
      await expect(page.locator('body')).not.toContainText('Notice:');
    });

    test('⑪ page shows table or "No logs" message', async ({ page }) => {
      const table  = page.locator('#slow-queries');
      const noLogs = page.locator('text=No logs');
      await expect(table.or(noLogs)).toBeVisible({ timeout: 10_000 });
    });

    test('⑫ table has correct column headers when data is present', async ({ page }) => {
      const table = page.locator('#slow-queries');
      if (!(await table.isVisible())) test.skip(); // no data in environment

      for (const col of ['DB', 'Time created', 'Query', 'Time', 'Script']) {
        await expect(table.locator('thead')).toContainText(col);
      }
    });

    test('⑬ DataTables search box is present when table is shown', async ({ page }) => {
      if (!(await page.locator('#slow-queries').isVisible())) test.skip();

      // DataTables injects a search input above the table.
      await expect(page.locator('[type="search"]')).toBeVisible();
    });

    test('⑭ DataTables plain-text search filters rows', async ({ page }) => {
      if (!(await page.locator('#slow-queries').isVisible())) test.skip();

      const searchBox = page.locator('[type="search"]').first();
      const allRows   = page.locator('#slow-queries tbody tr');

      const totalBefore = await allRows.count();
      if (totalBefore < 2) test.skip(); // not enough data to filter

      // Type a search term unlikely to match everything.
      await searchBox.fill('zzzzz_no_match_expected');
      await page.waitForTimeout(400); // DataTables debounce

      const afterSearch = await allRows.count();
      // Either 0 rows or fewer rows visible.
      expect(afterSearch).toBeLessThan(totalBefore);

      // Clear search — rows come back.
      await searchBox.fill('');
      await page.waitForTimeout(400);
      expect(await allRows.count()).toBe(totalBefore);
    });

    test('⑮ ! prefix search excludes matching rows', async ({ page }) => {
      if (!(await page.locator('#slow-queries').isVisible())) test.skip();

      const searchBox = page.locator('[type="search"]').first();
      const allRows   = page.locator('#slow-queries tbody tr');

      const totalBefore = await allRows.count();
      if (totalBefore < 2) test.skip();

      // The slow-queries.js script must handle ! prefix.
      await searchBox.fill('!zzzzz_no_match');
      await page.waitForTimeout(400);

      // All rows should still be visible (nothing excluded).
      expect(await allRows.count()).toBe(totalBefore);
    });

    test('⑯ Toggle Call Stack link is present', async ({ page }) => {
      if (!(await page.locator('#slow-queries').isVisible())) test.skip();
      await expect(page.locator('#toggle-callstack')).toBeVisible();
    });

    test('⑰ whiteListed=1 param is accepted without errors', async ({ page }) => {
      await page.goto('/page.php?sid=logSlowQueries&whiteListed=1');
      await expect(page.locator('body')).not.toContainText('Fatal error');
      const table  = page.locator('#slow-queries');
      const noLogs = page.locator('text=No logs');
      await expect(table.or(noLogs)).toBeVisible({ timeout: 10_000 });
    });
  });

  // ── admin links page ──────────────────────────────────────────────────────

  test('⑱ admin logs-links page points to new URL', async ({ page }) => {
    await page.goto('/admin.php');

    const link = page.locator('a[href*="sid=logSlowQueries"]', {
      hasText: /slow queries/i,
    });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveAttribute('href', /loader\.php/);
  });

  test('⑲ clicking the admin link navigates to new page', async ({ page }) => {
    await page.goto('/admin.php');

    const link = page.locator('a[href*="sid=logSlowQueries"]', {
      hasText: /slow queries/i,
    });
    if (!(await link.isVisible())) test.skip();

    await link.click();
    await expect(page).toHaveURL(/page\.php\?sid=logSlowQueries/);
  });

  // ── access control ────────────────────────────────────────────────────────

  test('⑳ non-admin user cannot access the page', async ({ browser }) => {
    // Open a fresh context with no stored auth (anonymous session).
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/page.php?sid=logSlowQueries');

    // Should NOT contain any log data.
    await expect(page.locator('#slow-queries')).not.toBeVisible();
    await ctx.close();
  });
});
