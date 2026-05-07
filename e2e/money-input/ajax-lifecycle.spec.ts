/**
 * Branch: 21446-money-ajax-requests
 *
 * Covers the AJAX-side fixes in the tornInputMoney rewrite:
 *
 *   - AJAX deduplication: module-scoped `isAjaxLoading` flag → only one
 *     in-flight request to options.ajaxAction at a time.
 *   - Single visibilitychange listener: regardless of how many inputs
 *     init the plugin, the document-level handler is registered ONCE
 *     (the new code calls `.off('visibilitychange.tornInputMoney')`
 *     before `.on(...)`).
 *   - Visible-tab refresh fans out to all instances via the new
 *     `updateOnVisible` public method, not via N independent listeners.
 *
 * Strategy: the Faction Give to User page mounts at least one money input
 * with `ajaxAction` set (vault refresh). We monitor network traffic while
 * faking tab visibility changes to confirm the throttling and single-
 * listener behaviour.
 */

import { test, expect, type Page, type Request } from '@playwright/test';
import { PAGES } from './pages';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Faction Give as the canonical multi-input page (vault + recipient).
 *  Same navigation flow as e2e/money-input/faction-give-to-user.spec.ts. */
async function gotoFactionGive(page: Page): Promise<boolean> {
  await page.goto('/factions.php?step=your');
  try {
    await page.locator('.faction-tabs li[data-case="controls"] a').click({ timeout: 15_000 });
    const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
    await form.waitFor({ state: 'visible', timeout: 40_000 });
    // Pick the first user in autocomplete to surface the money input.
    await form.getByTestId('autocomplete-input').click();
    await page.getByRole('button', { name: /User \w+ with ID/i }).first().click({ timeout: 10_000 });
    const input = page.getByRole('textbox', { name: /How much money would you like/i });
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Count visibilitychange listeners currently registered with the
 * .tornInputMoney namespace on document.
 *
 * jQuery stores them under $._data(document, 'events').visibilitychange.
 * Each handler in that array has a `namespace` property — we count those
 * whose namespace matches.
 */
async function visibilityListenerCount(page: Page, namespace = 'tornInputMoney'): Promise<number> {
  return page.evaluate((ns) => {
    // @ts-expect-error jQuery internal
    const events = window.jQuery && window.jQuery._data(document, 'events');
    if (!events || !events.visibilitychange) return 0;
    return events.visibilitychange.filter((h: { namespace?: string }) => h.namespace === ns).length;
  }, namespace);
}

/** Programmatically simulate a tab-visibility change event. */
async function dispatchVisibilityChange(page: Page, state: 'visible' | 'hidden'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** All requests posted to a moneyAjaxAction-shaped URL during the recording window. */
function recordAjax(page: Page): Request[] {
  const buf: Request[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /step=getMoney|ajaxAction|getMoney|getBalance/i.test(req.url())) {
      buf.push(req);
    }
  });
  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('tornInputMoney — AJAX lifecycle (#21446)', () => {
  test('LC-01 — only ONE visibilitychange.tornInputMoney handler is registered, no matter how many inputs init', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip(true, 'Faction Give page not accessible');

    // Wait for plugin init to settle.
    await page.waitForTimeout(1_500);

    const count = await visibilityListenerCount(page);
    expect(count, 'visibilitychange.tornInputMoney handlers').toBe(1);
  });

  test('LC-02 — all input.input-money instances are reachable via $.data("plugin_tornInputMoney")', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip(true, 'Faction Give page not accessible');
    await page.waitForTimeout(1_500);

    const summary = await page.evaluate(() => {
      // @ts-expect-error
      const $ = window.jQuery;
      const inputs = $('input.input-money:not([type="hidden"])');
      const total = inputs.length;
      let withInstance = 0;
      let withMethods = 0;
      inputs.each(function () {
        const inst = $.data(this, 'plugin_tornInputMoney');
        if (inst) {
          withInstance++;
          if (
            typeof inst.format === 'function' &&
            typeof inst.destroy === 'function' &&
            typeof inst.option === 'function' &&
            typeof inst.updateOnVisible === 'function' &&
            typeof inst.addRules === 'function'
          ) withMethods++;
        }
      });
      return { total, withInstance, withMethods };
    });

    expect(summary.total, 'visible money inputs').toBeGreaterThan(0);
    expect(summary.withInstance, 'inputs with $.data plugin instance').toBe(summary.total);
    expect(summary.withMethods, 'inputs with full public method API').toBe(summary.total);
  });

  test('LC-03 — visibility change → "visible" fires AT MOST ONE AJAX per money input (not N×M)', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip(true, 'Faction Give page not accessible');
    await page.waitForTimeout(1_500);

    // How many inputs would receive updateOnVisible?
    const inputCount = await page.evaluate(() =>
      // @ts-expect-error
      window.jQuery('input.input-money:not([type="hidden"])').length,
    );

    const buf = recordAjax(page);

    // Hide → show simulates a tab-blur / tab-return.
    await dispatchVisibilityChange(page, 'hidden');
    await page.waitForTimeout(200);
    await dispatchVisibilityChange(page, 'visible');
    await page.waitForTimeout(2_000);

    // Without the fix, the listener was registered N times → N×N triggers.
    // With the fix, the listener is registered ONCE and fans out to N inputs,
    // but `isAjaxLoading` ensures at most one concurrent request — so the
    // observed count should be at most N.
    expect(buf.length, `AJAX requests after a single tab-revisit (inputs=${inputCount})`).toBeLessThanOrEqual(inputCount);
  });

  test('LC-04 — rapid duplicate triggers do not pile up (isAjaxLoading throttle)', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip(true, 'Faction Give page not accessible');
    await page.waitForTimeout(1_500);

    const buf = recordAjax(page);

    // Fire multiple visibility cycles rapidly. The throttle should swallow
    // duplicates while a request is still in flight.
    for (let i = 0; i < 5; i++) {
      await dispatchVisibilityChange(page, 'hidden');
      await dispatchVisibilityChange(page, 'visible');
    }
    await page.waitForTimeout(2_500);

    const inputCount = await page.evaluate(() =>
      // @ts-expect-error
      window.jQuery('input.input-money:not([type="hidden"])').length,
    );
    // Conservative bound: even with 5 cycles, total requests must stay
    // bounded by the number of inputs × a small constant. Without the
    // throttle, this would be 5 × N or worse.
    expect(buf.length, `requests across 5 rapid cycles (inputs=${inputCount})`).toBeLessThanOrEqual(inputCount * 2);
  });

  test('LC-05 — single-input pages register exactly ONE visibility listener', async ({ page }) => {
    // Pick a single-input page from PAGES that has data-money set.
    const profileSendCash = PAGES.find((p) => p.name === 'Profile / Send Cash');
    if (!profileSendCash) test.skip(true, 'Profile / Send Cash page def not present');

    await page.goto(profileSendCash!.url);
    if (profileSendCash!.navigate) {
      const ok = await profileSendCash!.navigate(page);
      if (ok === false) test.skip(true, 'Send Cash navigation prereq failed');
    }
    await profileSendCash!.getInput(page).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_000);

    const count = await visibilityListenerCount(page);
    expect(count).toBe(1);
  });
});
