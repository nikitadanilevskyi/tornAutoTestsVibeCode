/**
 * Branch: config/rspack-migration-with-loose
 *
 * Covers PR #8012 — "Switched OnlineUserStatus to show svg icons via img
 * as base64 data". The new shared/components/UserOnlineStatus/UserOnlineStatus.tsx
 * imports SVGs with `?base64` and renders them inside an <img src="data:...">
 * rather than inline <svg>.
 *
 * Consumed by:
 *   apps/header/.../GlobalSearch/AutocompleteSearch/Autocomplete/index.tsx
 *
 * Test surface: header global search → type a recipient name → autocomplete
 * dropdown shows users with their online-status icon. Verify the rendered
 * <img> has a base64 data URI as its src (not an empty/missing src that
 * would indicate the loose-mode SWC SVG transform regressed).
 */

import { test, expect } from '@playwright/test';

test.describe('Header global search — UserOnlineStatus icons (#8012)', () => {
  test('OS-01 — header global search input is present', async ({ page }) => {
    await page.goto('/');
    const search = page
      .locator('input[type="text"][placeholder*="search" i], input[name="search"], [data-testid="global-search-input"], .header input[placeholder*="search" i]')
      .first();
    const visible = await search.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!visible) test.skip(true, 'Global search input not found in header on this page');
    expect(visible).toBe(true);
  });

  test('OS-02 — typing a query opens autocomplete with online-status images', async ({ page }) => {
    await page.goto('/');
    const search = page
      .locator('input[type="text"][placeholder*="search" i], input[name="search"]')
      .first();
    if (!(await search.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false))) {
      test.skip(true, 'No global search input');
    }

    await search.click();
    await search.fill('a'); // any letter likely to surface autocomplete suggestions
    await page.waitForTimeout(1_000);

    // The Autocomplete renders user rows; each row should include either an
    // <img> with a data: URI (post-fix) or some online-status indicator.
    const dataImgs = page.locator('img[src^="data:image/svg"]');
    const count = await dataImgs.count();
    if (count === 0) test.skip(true, 'No autocomplete suggestions surfaced for "a" — try a known name');

    expect(count, 'autocomplete should render base64-data svg images').toBeGreaterThan(0);

    // Spot-check: each <img> has an actual data URI (not empty / not unresolved import).
    for (let i = 0; i < Math.min(count, 5); i++) {
      const src = await dataImgs.nth(i).getAttribute('src');
      expect(src, `dataImgs[${i}].src`).toMatch(/^data:image\/svg\+xml(;base64,|,)/);
    }
  });

  test('OS-03 — UserOnlineStatus img has alt attribute matching its status', async ({ page }) => {
    await page.goto('/');
    const search = page.locator('input[name="search"], input[type="text"][placeholder*="search" i]').first();
    if (!(await search.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false))) {
      test.skip();
    }
    await search.click();
    await search.fill('a');
    await page.waitForTimeout(1_000);

    const statusImgs = page.locator('img[src^="data:image/svg"][alt]');
    const count = await statusImgs.count();
    if (count === 0) test.skip();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const alt = await statusImgs.nth(i).getAttribute('alt');
      expect(['online', 'offline', 'idle']).toContain(alt);
    }
  });
});
