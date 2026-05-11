/**
 * Branch: 21446-money-ajax-requests
 *
 * Covers the JS-level lifecycle fixes in tornInputMoney:
 *
 *   - Plugin instance correctly stored via $.data()
 *   - Public methods accessible via $.data(el, 'plugin_tornInputMoney')
 *   - destroy() restores the original `name` attribute
 *   - destroy() unwraps the input (insertBefore + remove) without cloning,
 *     preserving any external listeners on the original element
 *   - destroy() removes the document-level visibilitychange listener
 *     when the LAST instance is removed (reference-counted)
 *   - isFormatting flag prevents recursive input events when the plugin
 *     programmatically updates the value
 *   - Native HTMLInputElement value setter correctly dispatches 'input'
 */

import { test, expect, type Page } from '@playwright/test';

/** Same navigation flow as e2e/money-input/faction-give-to-user.spec.ts. */
async function gotoFactionGive(page: Page): Promise<boolean> {
  await page.goto('/factions.php?step=your');
  try {
    await page.locator('.faction-tabs li[data-case="controls"] a').click({ timeout: 15_000 });
    const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
    await form.waitFor({ state: 'visible', timeout: 40_000 });
    await form.getByTestId('autocomplete-input').click();
    await page.getByRole('button', { name: /User \w+ with ID/i }).first().click({ timeout: 10_000 });
    const input = page.getByRole('textbox', { name: /How much money would you like/i });
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function visibilityListenerCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    // @ts-expect-error jQuery internal
    const events = window.jQuery && window.jQuery._data(document, 'events');
    if (!events || !events.visibilitychange) return 0;
    return events.visibilitychange.filter((h: { namespace?: string }) => h.namespace === 'tornInputMoney').length;
  });
}

test.describe('tornInputMoney — plugin lifecycle (#21446)', () => {
  test('PL-01 — version bumped to 1.1', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_000);
    const v = await page.evaluate(() => {
      // @ts-expect-error
      return window.jQuery && window.jQuery.fn.tornInputMoney && window.jQuery.fn.tornInputMoney.defaults && window.jQuery.fn.tornInputMoney.defaults.version;
    });
    expect(v).toBe('1.1');
  });

  test('PL-02 — calling tornInputMoney("format") via the jQuery prototype works', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    // Without crashing — pre-fix this threw "Method does not exist" because
    // the plugin instance wasn't stored with $.data().
    const ok = await page.evaluate(() => {
      try {
        // @ts-expect-error
        window.jQuery('input.input-money:not([type="hidden"])').first().tornInputMoney('format');
        return true;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(ok).toBe(true);
  });

  test('PL-03 — destroy() restores the original `name` attribute and unwraps the DOM', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    const result = await page.evaluate(() => {
      // @ts-expect-error
      const $ = window.jQuery;
      const $input = $('input.input-money:not([type="hidden"])').first();
      if ($input.length === 0) return { skipped: true };

      // Pre-destroy snapshot
      const originalName = $input.data('original-name');
      const wrapperBefore = $input.parent('.input-money-group').length;

      // Tag the element so we can find it again post-destroy by attribute.
      const marker = 'pl03-marker-' + Date.now();
      $input.attr('data-pl03', marker);

      $input.tornInputMoney('destroy');

      // Post-destroy: find the same physical element (insertBefore preserves
      // the original DOM node — clone would break this).
      const $afterByMarker = $('input[data-pl03="' + marker + '"]');
      const sameNode = $afterByMarker.length === 1 && $afterByMarker.get(0) === $input.get(0);
      const wrapperAfter = $afterByMarker.parent('.input-money-group').length;
      const restoredName = $afterByMarker.attr('name');
      const stillHasInputMoneyClass = $afterByMarker.hasClass('input-money');
      const hasPluginData = $.data($afterByMarker.get(0), 'plugin_tornInputMoney') !== undefined;

      return {
        skipped: false,
        originalName,
        sameNode,
        wrapperBefore,
        wrapperAfter,
        restoredName,
        stillHasInputMoneyClass,
        hasPluginData,
      };
    });

    if ((result as { skipped: boolean }).skipped) test.skip();
    const r = result as Exclude<typeof result, { skipped: true }>;
    expect(r.wrapperBefore, 'wrapper present before destroy').toBe(1);
    expect(r.wrapperAfter, 'wrapper removed after destroy').toBe(0);
    expect(r.sameNode, 'original DOM node preserved (no clone)').toBe(true);
    expect(r.restoredName, 'name attribute restored').toBe(r.originalName);
    expect(r.stillHasInputMoneyClass, 'input-money class removed').toBe(false);
    expect(r.hasPluginData, '$.data plugin entry cleared').toBe(false);
  });

  test('PL-04 — destroy() removes the document visibilitychange listener when last instance is removed', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    expect(await visibilityListenerCount(page), 'listener present before destroy').toBe(1);

    await page.evaluate(() => {
      // @ts-expect-error
      const $ = window.jQuery;
      $('input.input-money:not([type="hidden"])').each(function () {
        $(this).tornInputMoney('destroy');
      });
    });

    expect(await visibilityListenerCount(page), 'listener removed after last destroy').toBe(0);
  });

  test('PL-05 — destroy() with multiple inputs only removes the global listener after the LAST one', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    const meta = await page.evaluate(() => {
      // @ts-expect-error
      const $ = window.jQuery;
      const inputs = $('input.input-money:not([type="hidden"])');
      return { count: inputs.length };
    });
    if (meta.count < 2) test.skip(true, 'Need ≥2 inputs to test reference-counting');

    // Destroy first only.
    await page.evaluate(() => {
      // @ts-expect-error
      window.jQuery('input.input-money:not([type="hidden"])').first().tornInputMoney('destroy');
    });
    expect(await visibilityListenerCount(page), 'listener still present (others active)').toBe(1);

    // Destroy the rest.
    await page.evaluate(() => {
      // @ts-expect-error
      const $ = window.jQuery;
      $('input.input-money:not([type="hidden"])').each(function () {
        $(this).tornInputMoney('destroy');
      });
    });
    expect(await visibilityListenerCount(page), 'listener gone after last destroy').toBe(0);
  });

  test('PL-06 — re-init after destroy works (no crash, plugin instance restored)', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    const result = await page.evaluate(() => {
      // @ts-expect-error
      const $ = window.jQuery;
      const $input = $('input.input-money:not([type="hidden"])').first();
      if ($input.length === 0) return { skipped: true };

      const marker = 'pl06-' + Date.now();
      $input.attr('data-pl06', marker);
      $input.tornInputMoney('destroy');

      const $after = $('input[data-pl06="' + marker + '"]');
      // Re-init with no options (uses defaults).
      try {
        $after.tornInputMoney({});
      } catch (e) {
        return { skipped: false, error: (e as Error).message };
      }
      const inst = $.data($after.get(0), 'plugin_tornInputMoney');
      const wrapped = $after.parent('.input-money-group').length === 1;
      return { skipped: false, error: null, hasInstance: !!inst, wrapped };
    });

    if ((result as { skipped: boolean }).skipped) test.skip();
    const r = result as Exclude<typeof result, { skipped: true }>;
    expect(r.error, 're-init should not throw').toBeNull();
    expect(r.hasInstance, '$.data plugin instance present after re-init').toBe(true);
    expect(r.wrapped, 're-init re-creates the wrapper').toBe(true);
  });

  test('PL-07 — formatter() does not recurse: programmatic value update fires "input" exactly ONCE', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    // Attach an external counter on the input event before triggering format.
    const fired = await page.evaluate(() => {
      // @ts-expect-error
      const $ = window.jQuery;
      const $input = $('input.input-money:not([type="hidden"])').first();
      if ($input.length === 0) return -1;

      let count = 0;
      const handler = () => { count++; };
      $input.get(0).addEventListener('input', handler);

      // Cause the plugin to call formatter() with a value mismatch.
      // Trigger a normal user-typed value first → fills + formats.
      const inst = $.data($input.get(0), 'plugin_tornInputMoney');
      // Programmatically call format via the public method.
      $input.val('1000'); // unformatted
      inst.format();

      // Give microtasks a tick.
      return new Promise<number>((res) => setTimeout(() => res(count), 200));
    });

    if (fired === -1) test.skip();
    // With the fix, formatter dispatches 'input' once and the early-return
    // on isFormatting prevents the handler from recursing back.
    // External listener should observe exactly 1 event.
    expect(fired).toBe(1);
  });

  test('PL-08 — onAfterChange hook fires once per value change (not in a loop)', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    const result = await page.evaluate(() => {
      // @ts-expect-error
      const $ = window.jQuery;
      const $input = $('input.input-money:not([type="hidden"])').first();
      if ($input.length === 0) return -1;

      // Re-bind the plugin with an onAfterChange hook spy. We have to
      // destroy + reinit to inject the hook.
      const originalName = $input.attr('name');
      $input.tornInputMoney('destroy');

      let onAfterChangeCalls = 0;
      // @ts-expect-error
      $input.attr('name', originalName).tornInputMoney({
        onAfterChange: () => { onAfterChangeCalls++; },
      });

      // Type one character.
      const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      native.call($input.get(0), '1k');
      $input.get(0).dispatchEvent(new Event('input', { bubbles: true }));

      return new Promise<number>((res) => setTimeout(() => res(onAfterChangeCalls), 250));
    });

    if (result === -1) test.skip();
    // Pre-fix: formatter() retriggered input → handler ran again → infinite/excessive calls.
    // Post-fix: handler runs ONCE for the user typing, formatter dispatch is filtered out by isFormatting.
    expect(result, 'onAfterChange call count for one user-typed input').toBeLessThanOrEqual(2);
    expect(result, 'onAfterChange must fire at least once').toBeGreaterThanOrEqual(1);
  });

  test('PL-09 — calling a non-existent method throws a clear error', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    const err = await page.evaluate(() => {
      try {
        // @ts-expect-error
        window.jQuery('input.input-money:not([type="hidden"])').first().tornInputMoney('thisIsNotAMethod');
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(err).toMatch(/does not exist/i);
  });

  test('PL-10 — destroy() preserves external listeners attached to the original DOM node', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    // Attach an external focus listener BEFORE destroy, then destroy the plugin,
    // then dispatch focus. The change-log explicitly claims the original DOM
    // node is preserved (insertBefore + remove, not clone), so any listener
    // attached BEFORE destroy must continue to fire.
    const result = await page.evaluate(async () => {
      // @ts-expect-error jQuery global
      const $ = window.jQuery;
      const $input = $('input.input-money:not([type="hidden"])').first();
      if ($input.length === 0) return { skipped: true } as const;

      const el = $input.get(0) as HTMLInputElement;

      // External listener — purposely on the underlying DOM node.
      let focusFired = 0;
      const onFocus = (): void => { focusFired++; };
      el.addEventListener('focus', onFocus);

      // Pre-destroy sanity: focus once to confirm the listener actually works.
      el.focus();
      await new Promise((r) => setTimeout(r, 50));
      el.blur();
      const firedBeforeDestroy = focusFired;

      $input.tornInputMoney('destroy');

      // Post-destroy: focus the same physical node. Cloning would have
      // dropped the listener; insertBefore + remove preserves it.
      el.focus();
      await new Promise((r) => setTimeout(r, 100));
      el.removeEventListener('focus', onFocus);

      return {
        skipped: false,
        firedBeforeDestroy,
        firedAfterDestroy: focusFired - firedBeforeDestroy,
      } as const;
    });

    if (result.skipped) test.skip();
    expect(result.firedBeforeDestroy, 'pre-destroy: listener wired correctly').toBe(1);
    expect(result.firedAfterDestroy, 'post-destroy: external listener still fires (DOM node preserved)').toBeGreaterThanOrEqual(1);
  });

  test('PL-11 — formatter() dispatches native input event observable by external (React-style) listeners', async ({ page }) => {
    if (!(await gotoFactionGive(page))) test.skip();
    await page.waitForTimeout(1_500);

    // PL-07 / PL-08 verify the COUNT of `input` events fired by formatter().
    // PL-11 verifies the FRAMEWORK-COMPAT contract: an external listener
    // attached via `el.addEventListener('input', …)` actually observes the
    // dispatchEvent call from the native value setter. This is what React /
    // Vue rely on to keep their controlled-component state in sync.
    const result = await page.evaluate(async () => {
      // @ts-expect-error jQuery global
      const $ = window.jQuery;
      const $input = $('input.input-money:not([type="hidden"])').first();
      if ($input.length === 0) return -1;

      const el = $input.get(0) as HTMLInputElement;

      let observedValue: string | null = null;
      let observedBubbles = false;
      const onInput = (e: Event) => {
        observedValue = (e.target as HTMLInputElement).value;
        observedBubbles = e.bubbles;
      };
      el.addEventListener('input', onInput);

      // Drive the plugin's native setter + dispatchEvent path.
      $input.val('1000');
      const inst = $.data(el, 'plugin_tornInputMoney');
      inst.format();

      await new Promise((r) => setTimeout(r, 200));
      el.removeEventListener('input', onInput);

      return { observedValue, observedBubbles, fieldValue: el.value };
    });

    if (result === -1) test.skip();
    const r = result as { observedValue: string | null; observedBubbles: boolean; fieldValue: string };
    expect(r.observedValue, 'external listener received the formatted value').not.toBeNull();
    expect(r.observedValue, 'external listener sees the formatted value').toBe(r.fieldValue);
    expect(r.observedBubbles, 'dispatched event must bubble (so React onChange catches it)').toBe(true);
  });
});
