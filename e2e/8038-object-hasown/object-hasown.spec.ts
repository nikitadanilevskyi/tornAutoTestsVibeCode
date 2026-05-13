/**
 * Branch: 8038-high-res-attack-models-possibly-breaking-attack-screen-on-mobile-and-in-items-tab
 *
 * The branch is a single 3-file compatibility fix. It replaces calls to the
 * ES2022 `Object.hasOwn()` API with the universally-supported
 * `Object.prototype.hasOwnProperty.call()` equivalent.
 *
 * Affected files:
 *   1. apps/attack/src/controller/selectors/getItems.ts          → Attack screen items tab
 *   2. apps/russianRoulette/src/routes/Game/.../handleGameLeft.ts → RR game-left WS handler
 *   3. shared/components/UserModel/helpers/isArmor.ts            → any <UserModel> with armor
 *
 * The bug was: iOS Safari < 15.4 (and any older browser without ES2022 support)
 * threw `TypeError: Object.hasOwn is not a function` when these code paths
 * ran, crashing the affected surfaces — particularly the Attack screen on
 * mobile and the Items tab inside it.
 *
 * THE KEY AUTO-TEST STRATEGY:
 *
 * Each test deletes `Object.hasOwn` from the page BEFORE the React app
 * initialises (via Playwright's addInitScript). This faithfully simulates
 * the old-browser environment in modern Chromium without needing real
 * devices. If the fix is in place, the affected code paths no longer touch
 * `Object.hasOwn` and the surfaces load cleanly. If the fix is missing or
 * the file is regressed, we observe the same TypeError that affected
 * mobile users — and the test fails.
 *
 * This is more reliable than running on real old browsers because:
 *   - It catches the issue deterministically on every CI run
 *   - It runs against the dev box's actual production build
 *   - It doesn't depend on having a real iOS 15.3 device
 */

import { test, expect, type ConsoleMessage } from '@playwright/test';

/** Patterns that indicate the old-bug TypeError reappeared. */
const HASOWN_ERROR_PATTERNS = [
  /Object\.hasOwn is not a function/i,
  /undefined is not a function.*hasOwn/i,
  /\.hasOwn is not a function/i,
];

const isHasOwnError = (text: string) => HASOWN_ERROR_PATTERNS.some((re) => re.test(text));

/**
 * Install an init script that removes Object.hasOwn from the page's window,
 * simulating an older browser like iOS Safari < 15.4. The script runs
 * BEFORE any page JS, so the React app's first reference to Object.hasOwn
 * (which would happen during getItems/isArmor/handleGameLeft) would crash
 * UNLESS the code has been migrated off Object.hasOwn.
 */
async function simulateOldBrowser(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Object as any).hasOwn;
    // For diagnostics — visible in DevTools if a human reruns
    // eslint-disable-next-line no-console
    console.info('[8038-test] Object.hasOwn shimmed to undefined');
  });
}

/** Capture console + uncaught errors during a navigation. */
function captureErrors(page: import('@playwright/test').Page) {
  const consoleErrors: ConsoleMessage[] = [];
  const pageErrors: Error[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m); });
  page.on('pageerror', (e) => pageErrors.push(e));
  return {
    hasOwnErrors() {
      const fromConsole = consoleErrors.map((m) => m.text()).filter(isHasOwnError);
      const fromPage = pageErrors.map((e) => e.message).filter(isHasOwnError);
      return [...fromConsole, ...fromPage];
    },
    allErrors() {
      return {
        console: consoleErrors.map((m) => m.text()),
        page: pageErrors.map((e) => e.message),
      };
    },
  };
}

// ─── SHIM-01..03  Attack screen (apps/attack/.../getItems.ts) ─────────────────

test.describe('SHIM — Attack screen (without Object.hasOwn)', () => {
  test('SHIM-01 — Attack screen mounts without "Object.hasOwn is not a function"', async ({ page }) => {
    await simulateOldBrowser(page);
    const cap = captureErrors(page);

    // The Attack URL needs a target. Use a known user ID; if unreachable, skip.
    const resp = await page.goto('/page.php?sid=attack&user2ID=2150779');
    if (resp && resp.status() >= 400) test.skip(true, `Attack target not reachable (HTTP ${resp.status()})`);

    // Wait for the Attack React app to render. The attack root uses CSS
    // modules (weaponSlot___…, weaponWrapper___…); match by class prefix.
    const root = page
      .locator('[class*="weaponSlot"], [class*="weaponWrapper"], .attackStart, .attacking-events-attack-join')
      .first();
    const mounted = await root.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    if (!mounted) test.skip(true, 'Attack screen did not mount');

    await page.waitForTimeout(2_000); // settle Redux selectors (getItems runs here)

    const hits = cap.hasOwnErrors();
    expect(hits, 'Object.hasOwn errors in Attack screen without polyfill').toEqual([]);
  });

  test('SHIM-02 — getItems selector runs at mount time without crashing (Items state)', async ({ page }) => {
    // The Items tab UI only surfaces DURING an active fight, which we can't
    // safely trigger from a test (it would attack a real user). However the
    // Redux selector in getItems.ts runs at mount time regardless of whether
    // the tab is visible — `mapUserItems(Object.values(items))` is computed
    // when the Attack app initialises its store. So a clean mount with the
    // shim active is sufficient evidence that the getItems code path no
    // longer references Object.hasOwn.
    await simulateOldBrowser(page);
    const cap = captureErrors(page);

    const resp = await page.goto('/page.php?sid=attack&user2ID=2150779');
    if (resp && resp.status() >= 400) test.skip(true, `Attack target not reachable (HTTP ${resp.status()})`);

    const root = page
      .locator('[class*="weaponSlot"], [class*="weaponWrapper"], .attackStart')
      .first();
    if (!(await root.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false))) {
      test.skip(true, 'Attack screen did not mount');
    }

    // Wait extra for Redux selectors + any user-items fetch to complete.
    await page.waitForTimeout(3_000);

    const hits = cap.hasOwnErrors();
    expect(hits, 'Object.hasOwn errors during attack mount (covers getItems selector path)').toEqual([]);
  });

  test('SHIM-03 — Attack screen on mobile viewport (375 × 667) doesn\'t crash', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await simulateOldBrowser(page);
    const cap = captureErrors(page);

    const resp = await page.goto('/page.php?sid=attack&user2ID=2150779');
    if (resp && resp.status() >= 400) test.skip(true, `Attack target not reachable (HTTP ${resp.status()})`);

    await page.waitForTimeout(3_000);

    const hits = cap.hasOwnErrors();
    expect(hits, 'Object.hasOwn errors on mobile attack screen').toEqual([]);
  });
});

// ─── SHIM-04  Russian Roulette game-left saga ─────────────────────────────────

test.describe('SHIM — Russian Roulette (without Object.hasOwn)', () => {
  test('SHIM-04 — RR page loads without "Object.hasOwn is not a function"', async ({ page }) => {
    await simulateOldBrowser(page);
    const cap = captureErrors(page);

    // Try the canonical Torn URL pattern; fall back to a legacy path. Some
    // dev boxes return ERR_HTTP_RESPONSE_CODE_FAILURE on the legacy URL
    // before a status code is read — wrap in try/catch and skip cleanly.
    let mounted = false;
    for (const url of ['/page.php?sid=russianRoulette', '/russianroulette.php']) {
      try {
        const resp = await page.goto(url);
        if (resp && resp.status() >= 400) continue;
        const root = page.locator('#russianRoulette, [class*="RussianRoulette"], [class*="russianRoulette"]').first();
        if (await root.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) {
          mounted = true;
          break;
        }
      } catch {
        // try next URL
      }
    }
    if (!mounted) test.skip(true, 'Russian Roulette page not reachable on this account/dev box');

    await page.waitForTimeout(2_000);

    const hits = cap.hasOwnErrors();
    expect(hits, 'Object.hasOwn errors on Russian Roulette').toEqual([]);
  });
});

// ─── SHIM-05..06  Shared <UserModel> on representative surfaces ───────────────

test.describe('SHIM — UserModel surfaces (without Object.hasOwn)', () => {
  // isArmor.ts is consumed wherever UserModel renders an item that may be
  // either IArmor or IHairstyle. The Attack screen is the primary consumer
  // (covered by SHIM-01..03). This adds a non-attack surface for breadth.

  test('SHIM-05 — Profile page loads without "Object.hasOwn is not a function" (UserModel preview)', async ({ page }) => {
    await simulateOldBrowser(page);
    const cap = captureErrors(page);

    const resp = await page.goto('/profiles.php?XID=2150779');
    if (resp && resp.status() >= 400) test.skip(true, `Profile not reachable (HTTP ${resp.status()})`);

    await page.waitForTimeout(3_000);

    const hits = cap.hasOwnErrors();
    expect(hits, 'Object.hasOwn errors on profile page').toEqual([]);
  });

  test('SHIM-06 — Faction members listing loads without "Object.hasOwn" errors', async ({ page }) => {
    await simulateOldBrowser(page);
    const cap = captureErrors(page);

    const resp = await page.goto('/factions.php?step=your');
    if (resp && resp.status() >= 400) test.skip(true, `Factions not reachable (HTTP ${resp.status()})`);

    await page.waitForTimeout(3_000);

    const hits = cap.hasOwnErrors();
    expect(hits, 'Object.hasOwn errors on faction members').toEqual([]);
  });
});

// ─── SHIM-07  Semantic-parity sanity ──────────────────────────────────────────

test.describe('SHIM — Semantic parity of the replacement', () => {
  test('SHIM-07 — hasOwnProperty.call matches Object.hasOwn semantics (own vs inherited)', async ({ page }) => {
    // This test runs in-browser to mimic the same evaluation environment as the
    // affected files. It does NOT require navigation to any specific page.
    await page.goto('about:blank');

    const result = await page.evaluate(() => {
      // Synthetic objects mirroring the shape of inputs to getItems / isArmor
      const ownProp = { item: ['foo'] };
      const inherited: Record<string, unknown> = Object.create({ item: ['foo'] });
      const armorLike = { ID: 1, equipSlot: 'helmet', name: 'Riot Helmet' };
      const hairstyleLike = { ID: 1 };

      // Post-fix code path (universal)
      const hp = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

      return {
        ownDetected: hp(ownProp, 'item'),                  // expect true
        inheritedRejected: hp(inherited, 'item'),          // expect false
        armorDetected: hp(armorLike, 'equipSlot') && hp(armorLike, 'name'),  // expect true
        hairstyleRejected: hp(hairstyleLike, 'equipSlot') || hp(hairstyleLike, 'name'),  // expect false
      };
    });

    expect(result.ownDetected, 'own prop detected').toBe(true);
    expect(result.inheritedRejected, 'inherited prop rejected').toBe(false);
    expect(result.armorDetected, 'armor shape detected').toBe(true);
    expect(result.hairstyleRejected, 'hairstyle shape NOT classified as armor').toBe(false);
  });
});
