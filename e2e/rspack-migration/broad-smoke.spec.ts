/**
 * Branch: config/rspack-migration-with-loose
 *
 * Broad smoke for the rspack-built bundle. Walks the same set of pages
 * the money-input suite already navigates to (defined in pages.ts), but
 * asserts a much weaker contract:
 *
 *   - HTTP response is 2xx or 3xx (not 5xx)
 *   - No uncaught pageerror during initial render
 *   - No "is not iterable" / "Cannot read properties of undefined" bursts
 *
 * Loose-mode SWC was hiding these as runtime errors. With loose mode off,
 * any compilation regression in spread / class field / async transforms
 * surfaces here.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { PAGES } from '../money-input/pages';

const COMPILER_ERROR_PATTERNS = [
  /is not iterable/i,
  /Cannot read properties of undefined/i,
  /Cannot read property '.*' of undefined/i,
  /\(intermediate value\) is not iterable/i,
  /TypeError: .* is not a function/i,
  /Super expression must either be null or a function/i, // class transform regression signal
];

const isCompilerError = (text: string) =>
  COMPILER_ERROR_PATTERNS.some((re) => re.test(text));

async function captureLoad(page: Page, url: string) {
  const consoleErrors: ConsoleMessage[] = [];
  const pageErrors: Error[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m); });
  page.on('pageerror', (e) => pageErrors.push(e));

  const resp = await page.goto(url);
  // Brief settle so React error boundaries have a chance to fire.
  await page.waitForTimeout(750);
  return { resp, consoleErrors, pageErrors };
}

// Smoke every distinct URL from the money-input page list. We don't run the
// per-page `navigate` steps — just hit the URL and watch for compilation-shape
// errors during initial render. Same URL appearing multiple times (different
// money-input surfaces on one page) is deduplicated.
// Skip traveling-only pages (require player to be currently abroad).
const SMOKE_TARGETS = Array.from(
  new Map(
    PAGES.filter((p) => !p.traveling).map((p) => [p.url, { name: p.name.split(' / ')[0], url: p.url }]),
  ).values(),
);

test.describe('rspack broad smoke', () => {
  for (const { name, url } of SMOKE_TARGETS) {
    test(`SMOKE — ${name} (${url})`, async ({ page }) => {
      const { resp, consoleErrors, pageErrors } = await captureLoad(page, url);

      if (resp) {
        expect(resp.status(), `HTTP status for ${url}`).toBeLessThan(500);
      }

      const offendingConsole = consoleErrors
        .map((m) => m.text())
        .filter(isCompilerError);
      const offendingPage = pageErrors
        .map((e) => e.message)
        .filter(isCompilerError);

      expect(offendingConsole, `compiler-shape console errors on ${name}`).toEqual([]);
      expect(offendingPage, `uncaught compiler-shape errors on ${name}`).toEqual([]);
    });
  }
});
