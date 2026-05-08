import { Locator, expect } from '@playwright/test';

// ─── Input value → expected display value ────────────────────────────────────

/** k / m / b shortcuts + decimal variants (always work, no data-money needed) */
export const SHORTCUT_CASES = [
  { value: '1k',    expected: '1,000',             label: '1k → 1,000' },
  { value: '1m',    expected: '1,000,000',          label: '1m → 1,000,000' },
  { value: '1b',    expected: '1,000,000,000',      label: '1b → 1,000,000,000' },
  { value: '1.5k',  expected: '1,500',              label: '1.5k decimal → 1,500' },
  { value: '2.5m',  expected: '2,500,000',          label: '2.5m decimal → 2,500,000' },
  { value: '1.5b',  expected: '1,500,000,000',      label: '1.5b decimal → 1,500,000,000' },
] as const;

/** Plain number formatting (always works) */
export const FORMATTING_CASES = [
  { value: '1000',       expected: '1,000',          label: '1000 → 1,000' },
  { value: '1000000',    expected: '1,000,000',       label: '1000000 → 1,000,000' },
  { value: '1000000000', expected: '1,000,000,000',   label: '1000000000 → 1,000,000,000' },
] as const;

/**
 * Relative shortcuts — require a data-money attribute on the input.
 * Expected values are calculated at runtime from the current max.
 */
export const RELATIVE_SHORTCUTS = [
  { value: 'max',     fraction: 1,       label: 'max → 100% of max' },
  { value: 'all',     fraction: 1,       label: 'all → 100% of max' },
  { value: 'half',    fraction: 1 / 2,   label: 'half → 50% of max' },
  { value: '1/2',     fraction: 1 / 2,   label: '1/2 → 50% of max' },
  { value: 'quarter', fraction: 1 / 4,   label: 'quarter → 25% of max' },
  { value: '1/4',     fraction: 1 / 4,   label: '1/4 → 25% of max' },
  { value: '1/3',     fraction: 1 / 3,   label: '1/3 → 33% of max' },
  { value: '25%',     fraction: 0.25,    label: '25% → 25% of max' },
  { value: '50%',     fraction: 0.5,     label: '50% → 50% of max' },
  { value: '2/3',     fraction: 2 / 3,   label: '2/3 → 66% of max' },
] as const;

/** Negative value cases — only for fields with allowNegativeNumbers: true */
export const NEGATIVE_CASES = [
  { value: '-1000', expected: '-1,000',           label: '-1000 → -1,000' },
  { value: '-1k',   expected: '-1,000',           label: '-1k → -1,000' },
  { value: '-1m',   expected: '-1,000,000',       label: '-1m → -1,000,000' },
  { value: '-1b',   expected: '-1,000,000,000',   label: '-1b → -1,000,000,000' },
] as const;

// ─── DOM helpers ─────────────────────────────────────────────────────────────

/** The .input-money-group wrapper that surrounds the given input */
export function moneyGroup(input: Locator): Locator {
  return input.locator('xpath=ancestor::div[contains(@class,"input-money-group")]');
}

/** Read max value from data-money attribute (returns null if not set) */
export async function getMaxValue(input: Locator): Promise<number | null> {
  const raw = await input.getAttribute('data-money');
  if (!raw) return null;
  return parseInt(raw.replace(/,/g, ''), 10);
}

/** Format an integer the same way the plugin does (comma-separated thousands) */
export function pluginFormat(n: number): string {
  return n.toLocaleString('en-US');
}

// ─── Fill helper ─────────────────────────────────────────────────────────────

/**
 * Fill the money input and trigger the formatter.
 * Uses fill() which fires native input events consumed by the tornInputMoney plugin.
 * Tab press ensures blur runs any deferred validation.
 */
export async function fillMoney(input: Locator, value: string): Promise<void> {
  await input.fill(value);
  await input.press('Tab');
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

export async function expectSuccess(input: Locator): Promise<void> {
  await expect(moneyGroup(input)).toHaveClass(/success/);
}

export async function expectError(input: Locator): Promise<void> {
  await expect(moneyGroup(input)).toHaveClass(/error/);
}

// ─── Test suites ─────────────────────────────────────────────────────────────

/**
 * ①  Exact number formatting — 1000 → 1,000 etc.
 * ⑤  Decimal shortcuts — 1.5k → 1,500 etc.
 * ②  k / m / b shortcuts
 * ㉑ Large number display
 *
 * Cap-aware: when the input has a data-money cap and an expected value would
 * exceed it, the plugin clamps the displayed value to the cap.  We compare
 * against the clamped value so the test still verifies that the plugin parsed
 * the shortcut correctly (e.g. "1m" is understood as 1,000,000) while
 * accepting the correct capped output.
 */
export async function checkShortcutsAndFormatting(input: Locator): Promise<void> {
  const maxValue = await getMaxValue(input);
  // Skip when cap is 0: every value would be clamped to 0 which the plugin
  // marks as error, making expectSuccess always fail.
  if (maxValue === 0) return;
  for (const { value, expected } of [...FORMATTING_CASES, ...SHORTCUT_CASES]) {
    const expectedNum = parseInt(expected.replace(/,/g, ''), 10);
    const effectiveExpected =
      maxValue !== null && expectedNum > maxValue ? pluginFormat(maxValue) : expected;
    await fillMoney(input, value);
    await expect(input).toHaveValue(effectiveExpected);
    await expectSuccess(input);
  }
}

/**
 * ⑥–⑪  Relative shortcuts: max, all, half, 1/2, quarter, 1/4, 1/3, 25%, 50%, 2/3.
 * Requires data-money attribute. Skipped silently when not present.
 */
export async function checkRelativeShortcuts(input: Locator): Promise<void> {
  const maxValue = await getMaxValue(input);
  if (!maxValue) return;

  for (const { value, fraction } of RELATIVE_SHORTCUTS) {
    await fillMoney(input, value);
    const expected = pluginFormat(Math.round(maxValue * fraction));
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  }
}

/**
 * ⑫  $ symbol button click → fills max value.
 * Skipped if no symbol button is present (no data-money attribute).
 */
export async function checkSymbolButton(input: Locator): Promise<void> {
  const maxValue = await getMaxValue(input);
  if (!maxValue) return;

  const btn = moneyGroup(input).locator('.input-money-symbol');
  if (!(await btn.isVisible())) return;

  await btn.click();
  await expect(input).toHaveValue(pluginFormat(maxValue));
  await expectSuccess(input);
}

/**
 * ⑰  Empty input → no success class (neither success nor error).
 * ⑱  0 → error in strict mode; success when allowZero is true.
 * ⑲  Value exceeding max → auto-capped (checked when data-money present).
 * ⑳  Invalid text → error in strict mode; no success class when allowZero.
 *
 * Pass `{ allowZero: true }` for inputs that use tornInputMoney with
 * strictMode: false (e.g. LegacyMoneyInput defaults).
 */
export async function checkValidation(
  input: Locator,
  { allowZero = false }: { allowZero?: boolean } = {},
): Promise<void> {
  // ⑰ empty — group should have neither success nor error
  await input.fill('');
  await input.dispatchEvent('input');
  await expect(moneyGroup(input)).not.toHaveClass(/success/);

  // ⑱ zero: error in strict mode, success when allowZero
  await fillMoney(input, '0');
  if (allowZero) {
    await expectSuccess(input);
  } else {
    await expectError(input);
  }

  // ⑳ invalid text: plugin normalises to empty → error in strict mode;
  //    with allowZero the result is empty (no success class)
  await fillMoney(input, 'abc');
  if (allowZero) {
    await expect(moneyGroup(input)).not.toHaveClass(/success/);
  } else {
    await expectError(input);
  }

  // ⑲ over-limit → capped at max.
  // Skipped when maxValue exceeds Number.MAX_SAFE_INTEGER (e.g. Bazaar's 10^20
  // sentinel cap) because maxValue * 10 loses precision and produces "1e+21"
  // which the plugin does not recognise as a valid number.
  const maxValue = await getMaxValue(input);
  if (maxValue && maxValue <= Number.MAX_SAFE_INTEGER) {
    await fillMoney(input, String(maxValue * 10));
    await expect(input).toHaveValue(pluginFormat(maxValue));
    await expectSuccess(input);
  }
}

/**
 * ⑬–⑯  Negative values (-1000, -1k, -1m, -1b).
 * Only call this for fields where allowNegativeNumbers is true.
 */
export async function checkNegativeValues(input: Locator): Promise<void> {
  for (const { value, expected } of NEGATIVE_CASES) {
    await fillMoney(input, value);
    await expect(input).toHaveValue(expected);
    await expectSuccess(input);
  }
}

// ─── Viewport breakpoints ─────────────────────────────────────────────────────

/** Viewport sizes matching the tornInputMoney responsive requirements. */
export const VIEWPORTS = [
  { label: 'mobile (375px)',        width: 375,  height: 812  },  // ≤ 386 px
  { label: 'tablet (600px)',        width: 600,  height: 900  },  // 387–785 px
  { label: 'big-tablet (900px)',    width: 900,  height: 900  },  // 786–1000 px
  { label: 'desktop (1280px)',      width: 1280, height: 800  },  // > 1000 px
  { label: '3K (2560px)',           width: 2560, height: 1440 },
  { label: '4K+ (3840px)',          width: 3840, height: 2160 },
] as const;

export type Viewport = (typeof VIEWPORTS)[number];

// ─── Zoom levels ──────────────────────────────────────────────────────────────

export const ZOOM_LEVELS = [
  { label: '75%',  value: 0.75 },
  { label: '100%', value: 1.00 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.50 },
] as const;

export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

// ─── Height check ─────────────────────────────────────────────────────────────

/** Expected CSS height of every input-money element, in px. */
export const EXPECTED_INPUT_HEIGHT_PX = 34;

/**
 * Assert the CSS computed height of the money input equals EXPECTED_INPUT_HEIGHT_PX.
 *
 * Computes total box-model height as:
 *   content height + padding-top + padding-bottom
 *   + (border-top + border-bottom) × bodyZoom
 *
 * Chromium quirk: when `document.body.style.zoom` is applied, `getComputedStyle`
 * reports border widths scaled inversely by the zoom factor (border / zoom).
 * Multiplying them back by the current body zoom restores the true CSS value.
 * Height and padding values are NOT affected by body zoom in getComputedStyle,
 * so they need no correction.
 *
 * The result is zoom-independent and equals `offsetHeight` at 1× zoom.  For
 * `border-box` inputs it equals the CSS `height` value directly (34 px).
 */
export async function checkInputHeight(
  input: Locator,
  expectedPx: number = EXPECTED_INPUT_HEIGHT_PX,
): Promise<void> {
  const h = await input.evaluate((el) => {
    const s = getComputedStyle(el as HTMLElement);
    const bodyZoom = parseFloat((document.body as HTMLElement).style.zoom) || 1;
    return (
      parseFloat(s.height) +
      parseFloat(s.paddingTop) +
      parseFloat(s.paddingBottom) +
      (parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth)) * bodyZoom
    );
  });
  // Round to nearest integer to absorb sub-pixel floating-point noise from
  // multiplying border widths by the zoom factor (e.g. 33.999995 → 34).
  expect(
    Math.round(h),
    `input-money height: expected ${expectedPx}px, got ${h}px`,
  ).toBe(expectedPx);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run all input-behavior checks that don't require form submission.
 * Pass allowNegative: true for fields that accept negative numbers.
 */
export async function checkAllInputBehavior(
  input: Locator,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): Promise<void> {
  await checkShortcutsAndFormatting(input);
  await checkRelativeShortcuts(input);
  await checkSymbolButton(input);
  await checkValidation(input);
  if (allowNegative) {
    await checkNegativeValues(input);
  }
}
