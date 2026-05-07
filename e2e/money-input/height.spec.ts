import { test } from '@playwright/test';
import {
  checkInputHeight,
  VIEWPORTS,
  ZOOM_LEVELS,
} from '../helpers/money-input';
import { PAGES } from './pages';

// ─── Height = 34 px at every viewport and zoom level ─────────────────────────
//
// Two test groups per page:
//
//   1. Viewport sweep — navigate at each of 6 viewport widths and assert that
//      the CSS computed height of the money input is exactly 34 px.  This
//      catches any responsive CSS rule that might accidentally resize the
//      element at a breakpoint.
//
//      Breakpoints under test:
//        mobile     ≤ 386 px  → 375 px sample
//        tablet     387–785 px → 600 px sample
//        big-tablet 786–1000 px → 900 px sample
//        desktop    > 1000 px  → 1280 px sample
//        3K         2560 px
//        4K+        3840 px
//
//   2. Zoom sweep (desktop 1280 px) — apply CSS body zoom at 75 %, 100 %,
//      125 %, and 150 % and assert that the underlying CSS height remains
//      34 px.  `offsetHeight` is used for both groups because it returns the
//      element's unscaled layout height and is therefore zoom-independent,
//      letting us assert a single expected value (34) at every zoom factor.
//
// serial pages (Send Cash, Bank, Points Market) run all sub-tests in the same
// worker to prevent concurrent PHP session-locking issues.
//
// If a page's prerequisite is not met (e.g. the account has no company, no
// property vault, …) the test is skipped rather than failed.

// Traveling pages (Travel Abroad Shop, Cayman Bank) require the player to be
// currently abroad. They are exercised separately in e2e/money-input/traveling.spec.ts.
for (const pageDef of PAGES.filter((p) => !p.traveling)) {
  test.describe(`${pageDef.name} — height ${34}px`, () => {
    if (pageDef.serial) test.describe.configure({ mode: 'serial' });
    test.setTimeout(90_000);

    // ── Helper: navigate to the page and return false when a prerequisite
    //    is missing so the caller can skip the test.
    async function setup(page: Parameters<typeof pageDef.navigate>[0]): Promise<boolean> {
      await page.goto(pageDef.url);
      if (pageDef.navigate) {
        const result = await pageDef.navigate(page);
        if (result === false) return false;
      }
      return true;
    }

    // ── 1. Viewport sweep ───────────────────────────────────────────────────

    for (const viewport of VIEWPORTS) {
      test(`viewport ${viewport.label}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        const ok = await setup(page);
        if (!ok) {
          testInfo.skip(true, `${pageDef.name}: prerequisite not met`);
          return;
        }

        const input = pageDef.getInput(page);
        const visible = await input.isVisible().catch(() => false);
        if (!visible) {
          // Some inputs are hidden on very narrow viewports (e.g. behind a
          // collapsed panel) — skip rather than fail.
          testInfo.skip(true, `input not visible at ${viewport.label}`);
          return;
        }

        await checkInputHeight(input);
      });
    }

    // ── 2. Zoom sweep (desktop 1280 px) ────────────────────────────────────

    for (const zoom of ZOOM_LEVELS) {
      test(`zoom ${zoom.label} (desktop 1280px)`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1280, height: 800 });

        const ok = await setup(page);
        if (!ok) {
          testInfo.skip(true, `${pageDef.name}: prerequisite not met`);
          return;
        }

        // Apply CSS body zoom.  `offsetHeight` is unaffected by ancestor zoom,
        // so the assertion value stays 34 regardless of zoom factor.
        await page.evaluate((z) => {
          document.body.style.zoom = String(z);
        }, zoom.value);

        await checkInputHeight(pageDef.getInput(page));
      });
    }
  });
}
