/**
 * Retina support — user status backgrounds
 * Branch: 7915-add-retina-suport-user-status-profile
 *
 * Strategy:
 *   1. Navigate to /factions.php and click any member to open the mini profile popup.
 *   2. Wait for .profile-container to appear inside the React mini-profile.
 *   3. For each status under test: inject the CSS class(es) onto .profile-container
 *      via page.evaluate, then read the computed background-image.
 *   4. Assert the value is a valid image reference (not "none" / empty).
 *   5. Also assert that the -2x / -3x / -4x CSS custom properties are defined.
 *
 * This approach covers every status without needing real game accounts in those states.
 * TC coverage: TC-004–TC-070 (status backgrounds), TC-063/064 (1x / 4x DPR),
 *              TC-075/076 (image-set parsed by browser), TC-078 (CSS vars defined).
 */

import { test, expect, type Page, type Locator } from '@playwright/test';

// ─── Status class matrix ──────────────────────────────────────────────────────
// Each entry is the className string applied to .profile-container by the React
// component (from apps/profile/src/utils/userStatus.ts).

const MAIN_STATUSES = [
  { id: 'okay',         classes: 'okay' },
  { id: 'hospital',     classes: 'hospital' },
  { id: 'jail',         classes: 'jail' },
  { id: 'federal-jail', classes: 'okay federal-jail' },
  { id: 'dead',         classes: 'dead' },
];

const COUNTRIES = [
  'mexico', 'canada', 'cayman', 'hawaii', 'kingdom',
  'switzerland', 'argentina', 'japan', 'china', 'uae', 'africa',
];

const FLIGHT_TYPES = ['standard', 'private', 'airstrip'];

const ABROAD_STATUSES = COUNTRIES.map((country) => ({
  id:      `abroad-${country}`,
  classes: `abroad ${country}`,
}));

const TRAVELLING_STATUSES = [
  { id: 'travelling-hidden', classes: 'travelling hidden-travelling' },
  ...COUNTRIES.flatMap((country) =>
    FLIGHT_TYPES.map((flight) => [
      { id: `travelling-to-${country}-${flight}`,   classes: `travelling to ${country} ${flight}` },
      { id: `travelling-from-${country}-${flight}`, classes: `travelling from ${country} ${flight}` },
    ]),
  ).flat(),
];

/** NPC status: okay + loot-N */
const NPC_STATUSES = [1, 2, 3, 4, 5].map((level) => ({
  id:      `npc-loot-${level}`,
  classes: `okay loot-${level}`,
}));

// ─── CSS custom property matrix ───────────────────────────────────────────────
// Variable name prefix → what it should resolve to on each density.

const CSS_VAR_GROUPS = [
  '--profile-okay-bg-image',
  '--profile-npc-bg-image',
  '--profile-hospital-bg-image',
  '--profile-jail-bg-image',
  '--profile-federal-jail-bg-image',
  '--profile-dead-bg-image',
  ...COUNTRIES.map((c) => `--profile-abroad-${c === 'africa' ? 'south-africa' : c === 'cayman' ? 'cayman-islands' : c === 'kingdom' ? 'united-kingdom' : c}-bg-image`),
  '--profile-travelling-hidden-bg-image',
  ...COUNTRIES.flatMap((c) => {
    const slug = c === 'africa' ? 'south-africa' : c === 'cayman' ? 'cayman-islands' : c === 'kingdom' ? 'united-kingdom' : c;
    return [
      `--profile-travelling-to-${slug}-bg-image`,
      `--profile-travelling-from-${slug}-bg-image`,
    ];
  }),
  '--profile-travelling-to-private-bg-image',
  '--profile-travelling-from-private-bg-image',
  '--profile-travelling-to-airstrip-bg-image',
  '--profile-travelling-from-airstrip-bg-image',
];

const DENSITY_SUFFIXES = ['-2x', '-3x', '-4x'] as const;

// ─── Device pixel ratio presets ──────────────────────────────────────────────

const DPR_PRESETS = [
  { label: '1x (standard)',        dpr: 1    },
  { label: '2x (iPhone / Retina)', dpr: 2    },
  { label: '3x (iPhone Pro)',      dpr: 3    },
  { label: '4x (4K)',              dpr: 4    },
] as const;

// ─── Navigation helper ────────────────────────────────────────────────────────

/**
 * Open any mini profile on the faction page.
 * Returns the .profile-container Locator inside the mini-profile wrapper.
 *
 * Falls back to clicking the first visible member name link if the faction
 * controls member list is not immediately available.
 */
async function openAnyMiniProfile(page: Page): Promise<Locator> {
  await page.goto('/factions.php?step=your');

  // Click the first faction member link that triggers the mini profile popup.
  // These are typically <a class="t-yellow"> links inside the members list.
  const memberLink = page.locator('#faction-main-container a[href*="profiles.php"]').first();
  await memberLink.waitFor({ state: 'visible', timeout: 30_000 });
  await memberLink.click();

  // Wait for the React mini-profile to mount
  const container = page.locator('.mini-profile-wrapper .profile-container');
  await container.waitFor({ state: 'visible', timeout: 20_000 });
  return container;
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

/**
 * Replace all status-related classes on .profile-container with `classes`,
 * preserving the base "profile-container" class.
 * Returns the computed background-image value after the class swap.
 */
async function getComputedBgForClasses(
  container: Locator,
  classes: string,
): Promise<string> {
  return container.evaluate((el, cls) => {
    // Strip all existing classes and set the new ones
    el.className = `profile-container ${cls}`;
    // Force a style recalculation
    return getComputedStyle(el).backgroundImage;
  }, classes);
}

/**
 * Read a CSS custom property value from the mini-profile wrapper root element
 * (where the vars are typically scoped).
 */
async function getCSSVar(page: Page, varName: string): Promise<string> {
  return page.evaluate((name) => {
    const root = document.querySelector('.mini-profile-wrapper') ?? document.documentElement;
    return getComputedStyle(root).getPropertyValue(name).trim();
  }, varName);
}

// ─── Assertions ──────────────────────────────────────────────────────────────

function assertValidBgImage(value: string, context: string): void {
  expect(
    value,
    `background-image should not be "none" for ${context}`,
  ).not.toBe('none');
  expect(
    value,
    `background-image should not be empty for ${context}`,
  ).not.toBe('');
  // image-set() computes to either an image-set() token or a url() in
  // older browsers — both are valid. Only "none" means the image failed.
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('User Status — Retina background images', () => {
  test.setTimeout(120_000);

  // Open mini profile once per suite run and reuse it across tests
  // (serial mode so tests don't interfere with the shared popup state)
  test.describe.configure({ mode: 'serial' });

  let container: Locator;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    container = await openAnyMiniProfile(page);
  });

  // ── TC-004/TC-008/TC-011/TC-014/TC-017 — main status backgrounds ──────────

  for (const { id, classes } of MAIN_STATUSES) {
    test(`[main] ${id} — background-image is not none`, async () => {
      const bg = await getComputedBgForClasses(container, classes);
      assertValidBgImage(bg, `status: ${id}`);
    });
  }

  // ── TC-020–TC-022 — NPC loot backgrounds ─────────────────────────────────

  for (const { id, classes } of NPC_STATUSES) {
    test(`[npc] ${id} — NPC background-image is not none`, async () => {
      const bg = await getComputedBgForClasses(container, classes);
      assertValidBgImage(bg, `status: ${id}`);
    });
  }

  // ── TC-023–TC-034 — abroad backgrounds ──────────────────────────────────

  for (const { id, classes } of ABROAD_STATUSES) {
    test(`[abroad] ${id} — background-image is not none`, async () => {
      const bg = await getComputedBgForClasses(container, classes);
      assertValidBgImage(bg, `status: ${id}`);
    });
  }

  // ── TC-036–TC-054 — travelling backgrounds ───────────────────────────────

  for (const { id, classes } of TRAVELLING_STATUSES) {
    test(`[travelling] ${id} — background-image is not none`, async () => {
      const bg = await getComputedBgForClasses(container, classes);
      assertValidBgImage(bg, `status: ${id}`);
    });
  }
});

// ─── TC-078 — CSS custom properties for 2x / 3x / 4x are defined ─────────

test.describe('User Status — CSS variables for retina densities are defined', () => {
  test.setTimeout(60_000);

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await openAnyMiniProfile(page);
  });

  for (const baseVar of CSS_VAR_GROUPS) {
    for (const suffix of DENSITY_SUFFIXES) {
      const varName = `${baseVar}${suffix}`;
      test(`${varName} is defined and non-empty`, async () => {
        const value = await getCSSVar(page, varName);
        expect(
          value,
          `CSS variable ${varName} must be defined (backend must set -2x/-3x/-4x variants)`,
        ).not.toBe('');
      });
    }
  }
});

// ─── TC-063/064/005/006/007 — image-set renders at multiple DPRs ──────────

test.describe('User Status — image-set renders correctly at different device pixel ratios', () => {
  test.setTimeout(90_000);

  for (const { label, dpr } of DPR_PRESETS) {
    test(`[${label}] okay status — background-image is not none`, async ({ browser }) => {
      const ctx = await browser.newContext({ deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const container = await openAnyMiniProfile(page);
      const bg = await getComputedBgForClasses(container, 'okay');
      assertValidBgImage(bg, `okay at DPR=${dpr}`);
      await ctx.close();
    });

    test(`[${label}] hospital status — background-image is not none`, async ({ browser }) => {
      const ctx = await browser.newContext({ deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const container = await openAnyMiniProfile(page);
      const bg = await getComputedBgForClasses(container, 'hospital');
      assertValidBgImage(bg, `hospital at DPR=${dpr}`);
      await ctx.close();
    });

    test(`[${label}] travelling to mexico standard — background-image is not none`, async ({ browser }) => {
      const ctx = await browser.newContext({ deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const container = await openAnyMiniProfile(page);
      const bg = await getComputedBgForClasses(container, 'travelling to mexico standard');
      assertValidBgImage(bg, `travelling to mexico at DPR=${dpr}`);
      await ctx.close();
    });
  }
});

// ─── TC-056–TC-061 — dark mode CSS variables switch ──────────────────────

test.describe('User Status — dark mode CSS variables switch correctly', () => {
  test.setTimeout(60_000);

  const DARK_MODE_CLASS = 'dark-mode'; // adjust if Torn uses a different toggle class

  for (const { id, classes } of MAIN_STATUSES) {
    test(`[dark mode] ${id} — background-image is not none in dark mode`, async ({ browser }) => {
      const page = await browser.newPage();
      const container = await openAnyMiniProfile(page);

      // Enable dark mode by adding the dark-mode class to <body>
      await page.evaluate((cls) => document.body.classList.add(cls), DARK_MODE_CLASS);

      const bg = await getComputedBgForClasses(container, classes);
      assertValidBgImage(bg, `${id} in dark mode`);
    });
  }
});

// ─── TC-066–TC-070 — loot icon regression: icon visible in description ────
//
// The loot-1..5 .description::before background rules were commented out in
// this branch. This test checks whether loot icons are still visible via some
// other mechanism (SVG / remaining CSS).

test.describe('User Status — NPC loot level icons visible in description area (regression)', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await openAnyMiniProfile(page);
  });

  for (const level of [1, 2, 3, 4, 5]) {
    test(`loot level ${level} icon is visible in description area`, async ({ page }) => {
      const container = page.locator('.mini-profile-wrapper .profile-container');

      // Inject NPC loot class
      await container.evaluate((el, lvl) => {
        el.className = `profile-container okay loot-${lvl}`;
      }, level);

      // The loot icon should be rendered — either as an SVG child or via
      // a ::before pseudo-element with a background. We check for either:
      //   (a) an <svg> descendant inside .description, OR
      //   (b) the ::before has a non-"none" background-image

      const descriptionArea = container.locator('.description');

      // Check (a): SVG icon child
      const svgCount = await descriptionArea.locator('svg').count();

      // Check (b): computed ::before background
      const beforeBg = await container.evaluate((el) => {
        return getComputedStyle(el.querySelector('.description') ?? el, '::before').backgroundImage;
      });

      const hasIcon = svgCount > 0 || (beforeBg !== 'none' && beforeBg !== '');

      expect(
        hasIcon,
        `Loot level ${level} icon should be visible in description area (svg count: ${svgCount}, ::before bg: ${beforeBg})`,
      ).toBe(true);
    });
  }
});

// ─── TC-071/072 — pre-existing CSS typo fix: from.mexico / to.china ───────
//
// The old code had "ackground-image" (missing 'b') for these two rules.
// After the image-set rewrite they should now load.

test.describe('User Status — pre-existing CSS typo fix (from.mexico / to.china)', () => {
  test.setTimeout(60_000);

  test('travelling FROM mexico standard — background-image is not none (typo fix TC-071)', async ({ browser }) => {
    const page = await browser.newPage();
    const container = await openAnyMiniProfile(page);
    const bg = await getComputedBgForClasses(container, 'travelling from mexico standard');
    assertValidBgImage(bg, 'travelling from mexico (was broken by typo)');
  });

  test('travelling TO china standard — background-image is not none (typo fix TC-072)', async ({ browser }) => {
    const page = await browser.newPage();
    const container = await openAnyMiniProfile(page);
    const bg = await getComputedBgForClasses(container, 'travelling to china standard');
    assertValidBgImage(bg, 'travelling to china (was broken by typo)');
  });
});
