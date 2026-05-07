/**
 * Branch: 7912-update-users-online-styles
 *
 * Scope: the "Users Online" widget on the home page (/index.php).
 *
 * What changed:
 *  - html/templates/main/home/users.php — markup restructure: new
 *    .users-online-content-wrap; .left-arrow / .right-arrow spans inside
 *    each digit block; conditional .with-long-digits on outer wrapper and
 *    .long on .daily-wrap when strlen($day) > 5.
 *  - static/css/style/players_online_common.css — replaced SVG-based
 *    :after shadow with pure-CSS ::before (top gradient) + ::after
 *    (middle horizontal line) + .left-arrow / .right-arrow triangles.
 *  - static/css/style/{dark_mode,light_mode}/home_main.css — 4 new vars:
 *      --users-online-digits-top-shadow
 *      --users-online-digits-middle-line
 *      --users-online-digits-middle-line-shadow
 *      --users-online-digits-arrows-bg
 *  - Deleted six SVGs:
 *      static/images/v2/home_main/users_online/{320,578,976}_{bg,top}.svg
 */

import { test, expect, type Page, type Locator } from '@playwright/test';

// The Users Online widget lives on the public landing page, which is only
// served to anonymous visitors. Override the global storageState so every
// test in this file runs without the authenticated session cookie.
test.use({ storageState: { cookies: [], origins: [] } });

const WIDGET = '.users-online-wrap';
const CONTAINER = '.users-online-wrap .users-online';
const CONTENT_WRAP = '.users-online-wrap .users-online-content-wrap';
const MINUTE_BLOCK = '.users-online-wrap .minute-wrap';
const HOUR_BLOCK = '.users-online-wrap .hour-wrap';
const DAILY_BLOCK = '.users-online-wrap .daily-wrap';
const ALL_BLOCKS = '.users-online-wrap .digits-block';

const NEW_CSS_VARS = [
  '--users-online-digits-top-shadow',
  '--users-online-digits-middle-line',
  '--users-online-digits-middle-line-shadow',
  '--users-online-digits-arrows-bg',
] as const;

const DELETED_SVGS = [
  '320_bg.svg',
  '320_top.svg',
  '578_bg.svg',
  '578_top.svg',
  '976_bg.svg',
  '976_top.svg',
];

// ─── helpers ──────────────────────────────────────────────────────────────────

async function gotoHome(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator(WIDGET).waitFor({ state: 'visible', timeout: 15_000 });
}

async function readCssVar(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );
}

async function readPseudo(
  locator: Locator,
  pseudo: '::before' | '::after',
  prop: string,
): Promise<string> {
  return locator.evaluate(
    (el, args) => getComputedStyle(el as HTMLElement, args.pseudo).getPropertyValue(args.prop).trim(),
    { pseudo, prop },
  );
}

async function getDailyDigitCount(page: Page): Promise<number> {
  return page.locator(`${DAILY_BLOCK} .digits-list > li`).count();
}

async function isLongDigitsState(page: Page): Promise<boolean> {
  const cls = await page.locator(WIDGET).getAttribute('class');
  return !!cls && cls.includes('with-long-digits');
}

// ─── Smoke ────────────────────────────────────────────────────────────────────

test.describe('Users Online — smoke', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('S-01 — widget renders with three digit blocks', async ({ page }) => {
    await expect(page.locator(WIDGET)).toBeVisible();
    await expect(page.locator(MINUTE_BLOCK)).toBeVisible();
    await expect(page.locator(HOUR_BLOCK)).toBeVisible();
    await expect(page.locator(DAILY_BLOCK)).toBeVisible();
  });

  test('S-02 — each block displays at least one digit', async ({ page }) => {
    for (const sel of [MINUTE_BLOCK, HOUR_BLOCK, DAILY_BLOCK]) {
      const count = await page.locator(`${sel} .digits-list > li, ${sel} > ul > li`).count();
      expect(count, `digit count in ${sel}`).toBeGreaterThan(0);
    }
  });

  test('S-03 — no requests for the six deleted SVGs', async ({ page }) => {
    const seen: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (DELETED_SVGS.some((name) => url.endsWith(`/${name}`))) seen.push(url);
    });
    await page.goto('/');
    await page.locator(WIDGET).waitFor();
    await page.waitForTimeout(500);
    expect(seen, 'requests for deleted SVGs').toEqual([]);
  });
});

// ─── Markup ───────────────────────────────────────────────────────────────────

test.describe('Users Online — markup', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('M-01 — users-online-content-wrap exists', async ({ page }) => {
    await expect(page.locator(CONTENT_WRAP)).toHaveCount(1);
  });

  test('M-02 — every digit block has left-arrow and right-arrow spans', async ({ page }) => {
    const blocks = await page.locator(ALL_BLOCKS).all();
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of blocks) {
      await expect(block.locator('.left-arrow')).toHaveCount(1);
      await expect(block.locator('.right-arrow')).toHaveCount(1);
    }
  });

  test('M-03 — bottom labels in correct order: Now / Last hour / Last 24 hours', async ({ page }) => {
    const labels = page.locator(`${CONTAINER} > .users-online-content-wrap > ul.label:not(.m-hide) > li`);
    await expect(labels).toHaveCount(3);
    await expect(labels.nth(0)).toHaveText('Now');
    await expect(labels.nth(1)).toHaveText('Last hour');
    await expect(labels.nth(2)).toHaveText('Last 24 hours');
  });

  test('M-04 — hidden top labels (m-hide) preserved', async ({ page }) => {
    const labels = page.locator(`${CONTENT_WRAP} > ul.label.m-hide > li`);
    await expect(labels).toHaveCount(3);
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

test.describe('Users Online — accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('A-01 — aria-labels preserved on each digit block', async ({ page }) => {
    await expect(page.locator(MINUTE_BLOCK)).toHaveAttribute('aria-label', /Now \d[\d,]* users online/);
    await expect(page.locator(HOUR_BLOCK)).toHaveAttribute('aria-label', /Last hour \d[\d,]* users online/);
    await expect(page.locator(DAILY_BLOCK)).toHaveAttribute('aria-label', /Last 24 hours \d[\d,]* users online/);
  });

  test('A-02 — tabindex="0" preserved on each block', async ({ page }) => {
    await expect(page.locator(MINUTE_BLOCK)).toHaveAttribute('tabindex', '0');
    await expect(page.locator(HOUR_BLOCK)).toHaveAttribute('tabindex', '0');
    await expect(page.locator(DAILY_BLOCK)).toHaveAttribute('tabindex', '0');
  });

  test('A-04 — decorative arrow spans are empty (not announced)', async ({ page }) => {
    const arrows = page.locator(`${ALL_BLOCKS} .left-arrow, ${ALL_BLOCKS} .right-arrow`);
    const count = await arrows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = await arrows.nth(i).innerText().catch(() => '');
      expect(text.trim()).toBe('');
    }
  });
});

// ─── Visual structure (pseudo-elements + arrows) ──────────────────────────────

test.describe('Users Online — visual structure', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('V-01 — ::before renders top shadow gradient', async ({ page }) => {
    const block = page.locator(MINUTE_BLOCK);
    const bg = await readPseudo(block, '::before', 'background-image');
    expect(bg, '::before background-image').toContain('gradient');
    const height = await readPseudo(block, '::before', 'height');
    expect(parseFloat(height)).toBeGreaterThan(0);
  });

  test('V-02 — ::after renders middle horizontal line', async ({ page }) => {
    const block = page.locator(MINUTE_BLOCK);
    const top = await readPseudo(block, '::after', 'top');
    expect(top).toBe('50%');
    const height = await readPseudo(block, '::after', 'height');
    expect(parseFloat(height)).toBeCloseTo(1, 0); // 1px
    const shadow = await readPseudo(block, '::after', 'box-shadow');
    expect(shadow, '::after box-shadow').not.toBe('none');
  });

  test('V-03 — left/right arrows render as CSS triangles', async ({ page }) => {
    const left = page.locator(MINUTE_BLOCK).locator('.left-arrow');
    const right = page.locator(MINUTE_BLOCK).locator('.right-arrow');

    const leftBorderLeft = await left.evaluate((el) => getComputedStyle(el as HTMLElement).borderLeftWidth);
    const rightBorderRight = await right.evaluate((el) => getComputedStyle(el as HTMLElement).borderRightWidth);
    expect(parseFloat(leftBorderLeft)).toBeGreaterThan(0);
    expect(parseFloat(rightBorderRight)).toBeGreaterThan(0);

    // 0×0 box with colored borders = triangle
    const w = await left.evaluate((el) => getComputedStyle(el as HTMLElement).width);
    const h = await left.evaluate((el) => getComputedStyle(el as HTMLElement).height);
    expect(parseFloat(w)).toBe(0);
    expect(parseFloat(h)).toBe(0);
  });

  test('V-04 — digits are flex-centered (not text-aligned)', async ({ page }) => {
    const li = page.locator(`${MINUTE_BLOCK} .digits-list > li`).first();
    const display = await li.evaluate((el) => getComputedStyle(el as HTMLElement).display);
    const justify = await li.evaluate((el) => getComputedStyle(el as HTMLElement).justifyContent);
    const align = await li.evaluate((el) => getComputedStyle(el as HTMLElement).alignItems);
    expect(display).toBe('flex');
    expect(justify).toBe('center');
    expect(align).toBe('center');
  });

  test('V-05 — container is centered with no left/right padding', async ({ page }) => {
    const container = page.locator(CONTAINER);
    const align = await container.evaluate((el) => getComputedStyle(el as HTMLElement).alignItems);
    const padLeft = await container.evaluate((el) => getComputedStyle(el as HTMLElement).paddingLeft);
    const padRight = await container.evaluate((el) => getComputedStyle(el as HTMLElement).paddingRight);
    expect(align).toBe('center');
    expect(parseFloat(padLeft)).toBe(0);
    expect(parseFloat(padRight)).toBe(0);
  });
});

// ─── CSS variables (theme) ────────────────────────────────────────────────────

test.describe('Users Online — CSS variables', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  for (const v of NEW_CSS_VARS) {
    test(`T-VAR ${v} — defined and non-empty`, async ({ page }) => {
      const value = await readCssVar(page, v);
      expect(value, `${v} value`).not.toBe('');
    });
  }

  test('T-DARK — when .dark-mode is active, vars use dark values', async ({ page }) => {
    // Force the dark-mode class to test dark-mode vars regardless of account preference.
    await page.evaluate(() => document.documentElement.classList.add('dark-mode'));
    const arrowsBg = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--users-online-digits-arrows-bg').trim(),
    );
    expect(arrowsBg.toLowerCase()).toBe('#444');
  });

  test('T-LIGHT — when .dark-mode is removed, vars use light values', async ({ page }) => {
    await page.evaluate(() => document.documentElement.classList.remove('dark-mode'));
    const arrowsBg = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--users-online-digits-arrows-bg').trim(),
    );
    expect(arrowsBg.toLowerCase()).toBe('#f2f2f2');
  });
});

// ─── Long-digits modifier ─────────────────────────────────────────────────────

test.describe('Users Online — long-digits modifier', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('LD-01 — wrapper class matches PHP rule (strlen($day) > 5)', async ({ page }) => {
    const dailyText = await page.locator(`${DAILY_BLOCK}`).getAttribute('aria-label');
    const m = dailyText?.match(/Last 24 hours ([\d,]+) users online/);
    if (!m) test.skip();
    const dayString = m![1];
    const expectedLong = dayString.length > 5;
    const isLong = await isLongDigitsState(page);
    expect(isLong, `class should match strlen($day)=${dayString.length} > 5`).toBe(expectedLong);
  });

  test('LD-02 — daily-wrap.long ↔ wrapper.with-long-digits in lockstep', async ({ page }) => {
    const wrapperLong = await isLongDigitsState(page);
    const dailyClass = (await page.locator(DAILY_BLOCK).getAttribute('class')) ?? '';
    const dailyLong = dailyClass.split(/\s+/).includes('long');
    expect(dailyLong, 'daily-wrap.long must mirror wrapper.with-long-digits').toBe(wrapperLong);
  });

  test('LD-03 — when long-digits active, font-size is 40px', async ({ page }) => {
    if (!(await isLongDigitsState(page))) test.skip();
    const fontSize = await page
      .locator(`${MINUTE_BLOCK} .digits-list > li`)
      .first()
      .evaluate((el) => getComputedStyle(el as HTMLElement).fontSize);
    expect(parseFloat(fontSize)).toBe(40);
  });

  test('LD-04 — when long-digits active, daily block width is 168px (vs 140px)', async ({ page }) => {
    if (!(await isLongDigitsState(page))) test.skip();
    const minuteW = await page.locator(MINUTE_BLOCK).evaluate((el) => getComputedStyle(el as HTMLElement).width);
    const dailyW = await page.locator(DAILY_BLOCK).evaluate((el) => getComputedStyle(el as HTMLElement).width);
    expect(parseFloat(minuteW)).toBe(140);
    expect(parseFloat(dailyW)).toBe(168);
  });

  test('LD-05 — daily digits not clipped by container', async ({ page }) => {
    if (!(await isLongDigitsState(page))) test.skip();
    const block = page.locator(DAILY_BLOCK);
    const list = page.locator(`${DAILY_BLOCK} .digits-list`);
    const blockBox = await block.boundingBox();
    const listBox = await list.boundingBox();
    if (!blockBox || !listBox) test.skip();
    expect(listBox!.x + listBox!.width, 'digits-list right edge inside block').toBeLessThanOrEqual(
      blockBox!.x + blockBox!.width + 1,
    );
  });
});

// ─── Forced long-digits (synthetic) ───────────────────────────────────────────
// Useful when the production daily count is short (≤5 chars) — we can't get the
// PHP server to emit `with-long-digits`, but we can still verify the CSS rules
// fire correctly by injecting the classes client-side.

test.describe('Users Online — forced long-digits styles', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await page.evaluate(() => {
      document.querySelector('.users-online-wrap')?.classList.add('with-long-digits');
      document.querySelector('.daily-wrap')?.classList.add('long');
    });
  });

  test('FL-01 — desktop font-size = 40px under .with-long-digits', async ({ page }) => {
    const fs = await page
      .locator(`${MINUTE_BLOCK} .digits-list > li`)
      .first()
      .evaluate((el) => getComputedStyle(el as HTMLElement).fontSize);
    expect(parseFloat(fs)).toBe(40);
  });

  test('FL-02 — desktop block widths: minute/hour=140px, daily=168px', async ({ page }) => {
    const minuteW = await page.locator(MINUTE_BLOCK).evaluate((el) => getComputedStyle(el as HTMLElement).width);
    const hourW = await page.locator(HOUR_BLOCK).evaluate((el) => getComputedStyle(el as HTMLElement).width);
    const dailyW = await page.locator(DAILY_BLOCK).evaluate((el) => getComputedStyle(el as HTMLElement).width);
    expect(parseFloat(minuteW)).toBe(140);
    expect(parseFloat(hourW)).toBe(140);
    expect(parseFloat(dailyW)).toBe(168);
  });

  test('FL-03 — desktop label widths under .with-long-digits = 150px', async ({ page }) => {
    const widths = await page
      .locator(`${WIDGET}.with-long-digits .label > li.minute, ${WIDGET}.with-long-digits .label > li.hour`)
      .evaluateAll((els) => els.map((el) => getComputedStyle(el as HTMLElement).width));
    for (const w of widths) {
      expect(parseFloat(w)).toBe(150);
    }
  });
});

// ─── Responsive breakpoints ───────────────────────────────────────────────────
// The CSS is gated on `.r` (retina) at small viewports. Our authenticated
// session already loads the retina stylesheet; if not, these tests skip.

const BREAKPOINTS = [
  { name: 'desktop  1280px', width: 1280, height: 900 },
  { name: 'tablet   900px',  width: 900,  height: 800 },
  { name: 'small    700px',  width: 700,  height: 800 },
  { name: 'phone    480px',  width: 480,  height: 800 },
  { name: 'tiny     360px',  width: 360,  height: 800 },
];

test.describe('Users Online — responsive', () => {
  for (const bp of BREAKPOINTS) {
    test(`R — ${bp.name}: widget renders without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await gotoHome(page);
      const widget = page.locator(WIDGET);
      await expect(widget).toBeVisible();
      const box = await widget.boundingBox();
      expect(box, 'widget bounding box').not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(bp.width + 1);
    });
  }

  test('R — at 700px with long-digits forced, font-size becomes 24px (retina rule)', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await gotoHome(page);
    const isRetina = await page.evaluate(() => document.documentElement.classList.contains('r')
      || document.body.classList.contains('r')
      || !!document.querySelector('.r'));
    if (!isRetina) test.skip();
    await page.evaluate(() => {
      document.querySelector('.users-online-wrap')?.classList.add('with-long-digits');
    });
    const fs = await page
      .locator(`${MINUTE_BLOCK} .digits-list > li`)
      .first()
      .evaluate((el) => getComputedStyle(el as HTMLElement).fontSize);
    expect(parseFloat(fs)).toBe(24);
  });
});

// ─── Visual regression (screenshot) ───────────────────────────────────────────
// Take a screenshot of the widget at each breakpoint and compare against a
// baseline. Run with `--update-snapshots` once on master to capture baselines,
// then run again on the branch — diffs surface as test failures.

test.describe('Users Online — visual snapshots', () => {
  for (const bp of BREAKPOINTS) {
    test(`SS — ${bp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await gotoHome(page);
      const widget = page.locator(WIDGET);
      await expect(widget).toBeVisible();
      // Mask the digits list — the live counter changes between baseline and
      // branch runs. We're testing the chrome (frames, arrows, line, shadow).
      await expect(widget).toHaveScreenshot(`users-online-${bp.width}.png`, {
        mask: [page.locator(`${WIDGET} .digits-list`)],
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
