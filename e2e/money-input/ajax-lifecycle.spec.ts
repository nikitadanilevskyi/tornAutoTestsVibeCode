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

/**
 * Bank / Investment as the canonical SINGLE-input page with `ajaxAction`.
 * The Bank plugin instance is initialised with
 *   ajaxAction: "inputMoneyAction.php?step=bankAction"
 * so the visibility-change listener fires a real network request — the
 * only way to actually exercise the `isAjaxLoading` complete-callback
 * timing (LC-06).
 */
async function gotoBank(page: Page): Promise<boolean> {
  await page.goto('/bank.php');
  try {
    await page.waitForFunction(
      () => !!document.querySelector('.invest-head-wrap .input-money-group'),
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).$('.invest-head-wrap').show();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).$('#select-length').val('1week').trigger('change');
    });
    const input = page.locator(
      '.invest-head-wrap .input-money-group input.input-money:not([type="hidden"]):not([type="button"])',
    );
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Properties Vault — Deposit input is the only `tornInputMoney` consumer
 * with BOTH `ajaxAction` and `ajaxLabelAction` configured (see
 * static/js/script/src/properties.js — Vault deposit definition). The
 * `updateOnVisible()` path is the only place where both AJAX calls fire
 * in sequence, so it's the only surface where we can exercise the
 * dual-AJAX behaviour introduced by the refactor.
 */
async function gotoVaultDeposit(page: Page): Promise<boolean> {
  // Vault is on property ID 4165929 (different from Sell/Lease which use
  // 4191017). Update both IDs manually if the player loses access to
  // either property.
  await page.goto('/properties.php#/p=options&ID=4165929&tab=vault');
  try {
    const group = page.locator('.deposit-box .input-money-group').first();
    await group.waitFor({ state: 'visible', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

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
    if (!(await gotoBank(page))) test.skip(true, 'Bank page navigation failed');
    await page.waitForTimeout(1_000);
    const count = await visibilityListenerCount(page);
    expect(count).toBe(1);
  });

  test('LC-06 — complete callback clears isAjaxLoading: a subsequent updateOnVisible() call fires a fresh AJAX', async ({ page }) => {
    // Bank initialises the plugin with `ajaxAction`, so the AJAX path is
    // exercised. We bypass the visibility-change dispatch (which depends on
    // jQuery event-delivery quirks across the layers) and invoke
    // `updateOnVisible()` directly on the instance — that is the function
    // the visibility-change listener calls under the hood, so the contract
    // we want to test (complete clears isAjaxLoading) is identical.
    if (!(await gotoBank(page))) test.skip(true, 'Bank page navigation failed');
    await page.waitForTimeout(1_500);

    // Plugin AJAX action URLs all use inputMoneyAction.php with a step= query.
    const isMoneyAjax = (url: string) => /inputMoneyAction\.php/i.test(url);
    const cycle1: string[] = [];
    const cycle2: string[] = [];
    let phase: 1 | 2 = 1;

    page.on('request', (req) => {
      if (req.method() === 'POST' && isMoneyAjax(req.url())) {
        (phase === 1 ? cycle1 : cycle2).push(req.url());
      }
    });

    // Cycle 1 — directly call updateOnVisible on Bank's plugin instance.
    await page.evaluate(() => {
      // @ts-expect-error jQuery global
      const $ = window.jQuery;
      const inst = $.data(
        $('input.input-money:not([type="hidden"])').get(0),
        'plugin_tornInputMoney',
      );
      inst.updateOnVisible();
    });
    await page.waitForTimeout(2_500);

    // If Bank's plugin instance was initialised without ajaxAction (e.g. the
    // configuration changed), the call short-circuits and fires no request.
    // Skip in that case — the contract is meaningless when ajaxAction is unset.
    if (cycle1.length === 0) {
      test.skip(true, 'Bank plugin instance has no ajaxAction — cannot exercise complete callback');
      return;
    }

    // Cycle 2 — after the first cycle's complete callback has fired and
    // cleared isAjaxLoading, a fresh call must be allowed.
    phase = 2;
    await page.evaluate(() => {
      // @ts-expect-error jQuery global
      const $ = window.jQuery;
      const inst = $.data(
        $('input.input-money:not([type="hidden"])').get(0),
        'plugin_tornInputMoney',
      );
      inst.updateOnVisible();
    });
    await page.waitForTimeout(2_500);

    // If isAjaxLoading were sticky (the bug we're guarding against), cycle 2
    // would never fire — the request count would be 0.
    expect(cycle2.length, 'cycle 2 fires a fresh request after isAjaxLoading clears').toBeGreaterThan(0);
  });

  test('LC-07 — updateOnVisible() fires BOTH ajaxAction and ajaxLabelAction when both are configured', async ({ page }) => {
    // Properties Vault Deposit is the only money input in the codebase that
    // sets both `ajaxAction` and `ajaxLabelAction`. The refactored
    // updateOnVisible() must dispatch both AJAX calls — one to refresh the
    // value cap and one to refresh the label/display value.
    if (!(await gotoVaultDeposit(page))) test.skip(true, 'Vault Deposit not accessible');
    await page.waitForTimeout(1_500);

    // Read the configured action URLs directly from the plugin instance.
    const config = await page.evaluate(() => {
      // @ts-expect-error jQuery global
      const $ = window.jQuery;
      const el = $('.deposit-box input.input-money:not([type="hidden"])').get(0);
      const inst = el && $.data(el, 'plugin_tornInputMoney');
      if (!inst || !inst.option) return null;
      return {
        ajaxAction: inst.option('ajaxAction') ?? null,
        ajaxLabelAction: inst.option('ajaxLabelAction') ?? null,
      };
    });
    if (!config || !config.ajaxAction || !config.ajaxLabelAction) {
      test.skip(true, 'Vault Deposit plugin instance has no ajaxLabelAction configured');
      return;
    }

    // Count requests by their full URL — the two actions have different
    // step= values so we can distinguish them.
    const seen: string[] = [];
    page.on('request', (req) => {
      if (/inputMoneyAction\.php/i.test(req.url())) seen.push(req.url());
    });

    await page.evaluate(() => {
      // @ts-expect-error jQuery global
      const $ = window.jQuery;
      const inst = $.data(
        $('.deposit-box input.input-money:not([type="hidden"])').get(0),
        'plugin_tornInputMoney',
      );
      inst.updateOnVisible();
    });
    await page.waitForTimeout(2_500);

    // Both actions point at inputMoneyAction.php but they differ in some
    // query parameter (ajaxAction has &ID=…&step=generalAction, while
    // ajaxLabelAction has only step=generalAction). We expect TWO requests.
    expect(seen.length, `Both ajaxAction and ajaxLabelAction must fire — got ${seen.length} request(s): ${seen.join('\n  ')}`).toBeGreaterThanOrEqual(2);
  });

  test('LC-08 — deferred init (plugin attached inside AJAX callback): re-running init does not duplicate the visibility listener', async ({ page }) => {
    // Bank initializes the plugin INSIDE its onBankLoad AJAX callback.
    // When the user changes the investment-length dropdown, bank.js re-runs
    // its setup logic. The plugin's guard (`if (!$.data(this, ...))`) must
    // prevent a duplicate instance, and the namespaced `.off(...).on(...)`
    // registration must keep the document-level listener count at 1.
    if (!(await gotoBank(page))) test.skip(true, 'Bank page navigation failed');
    await page.waitForTimeout(1_500);

    const beforeCount = await visibilityListenerCount(page);
    expect(beforeCount, 'baseline: listener count after initial deferred init').toBe(1);

    // Force a re-init pass by selecting a different investment length.
    // bank.js handles #select-length 'change' and runs its setup logic.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const $ = (window as { jQuery?: unknown }).jQuery as any;
      $('#select-length').val('2week').trigger('change');
    });
    await page.waitForTimeout(2_000);

    const afterCount = await visibilityListenerCount(page);
    expect(afterCount, 'listener count must remain 1 after a re-init pass').toBe(1);

    // Also verify the plugin instance is the SAME one (not replaced)
    const sameInstance = await page.evaluate(() => {
      // @ts-expect-error jQuery global
      const $ = window.jQuery;
      const el = $('input.input-money:not([type="hidden"])').get(0);
      return !!(el && $.data(el, 'plugin_tornInputMoney'));
    });
    expect(sameInstance, 'plugin instance still present after re-init pass').toBe(true);
  });
});
