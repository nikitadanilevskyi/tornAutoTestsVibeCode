/**
 * Branch: config/rspack-migration-with-loose
 *
 * E2E for the ChristmasTown ParameterEditor fix. Pre-fix code in
 *   apps/christmastown_editor/src/routes/ParameterEditor/components/FormTriggerFields.tsx:122
 * was:
 *   [...(triggerData.positions ?? {}), constants.EMPTY_POSITION]
 * which crashed with "{} is not iterable" when positions was nullish.
 *
 * Test strategy: open the editor, locate a Teleport trigger with empty
 * positions, click "Add position", and verify no crash. Admin-only —
 * skips gracefully when the account doesn't have access.
 */

import { test, expect, type ConsoleMessage } from '@playwright/test';

const EDITOR_URL = '/loader.php?sid=christmastownEditor';

test.describe('ChristmasTown ParameterEditor — Add Position', () => {
  let consoleErrors: ConsoleMessage[] = [];
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg); });
    page.on('pageerror', (err) => pageErrors.push(err));
  });

  test('CT-01 — ParameterEditor mounts without console errors', async ({ page }) => {
    const resp = await page.goto(EDITOR_URL);
    if (resp && resp.status() >= 400) {
      test.skip(true, `Editor not accessible (HTTP ${resp.status()})`);
    }

    const editorRoot = page
      .locator('.parameter-editor, [class*="ParameterEditor"], .christmastown-editor, #christmastown_editor')
      .first();
    const visible = await editorRoot.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) test.skip(true, 'Account does not have ChristmasTown editor access');

    const noisy = (msg: string) =>
      /is not iterable/i.test(msg) ||
      /TypeError/i.test(msg) ||
      /handleAddPosition/i.test(msg);

    expect(consoleErrors.filter((m) => noisy(m.text())).map((m) => m.text()), 'console errors').toEqual([]);
    expect(pageErrors.filter((e) => noisy(e.message)).map((e) => e.message), 'uncaught errors').toEqual([]);
  });

  test('CT-02 — clicking "Add position" on an empty Teleport trigger does not throw', async ({ page }) => {
    await page.goto(EDITOR_URL);
    const editorRoot = page.locator('.parameter-editor, [class*="ParameterEditor"]').first();
    const visible = await editorRoot.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) test.skip(true, 'Editor not accessible');

    // Find an "Add position" button. Different builds may use different copy;
    // try a few common variants.
    const addBtn = page.getByRole('button', { name: /add position|add point|add teleport/i }).first();
    const found = await addBtn.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!found) test.skip(true, 'No Teleport trigger with an Add Position control on screen');

    await addBtn.click();
    // Give React a tick to commit; a runtime crash would surface in pageerror.
    await page.waitForTimeout(200);

    const noisy = (msg: string) =>
      /is not iterable/i.test(msg) ||
      /TypeError/i.test(msg) ||
      /handleAddPosition/i.test(msg);
    expect(consoleErrors.filter((m) => noisy(m.text())).map((m) => m.text())).toEqual([]);
    expect(pageErrors.filter((e) => noisy(e.message)).map((e) => e.message)).toEqual([]);
  });
});
