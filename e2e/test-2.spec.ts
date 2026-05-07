import { test, expect } from '@playwright/test';

test('Faction Controls — Give money / Change balance', async ({ page }) => {
  test.setTimeout(90_000);

  const form = page.locator('form').filter({ hasText: 'Give money or change balance' });
  const amountInput = page.getByRole('textbox', { name: /How much money would you like/i });

  // Navigate to faction page then click the CONTROLS tab.
  // Controls content and the give-to-user React app are loaded via sequential AJAX calls.
  await page.goto('/factions.php?step=your');
  await page.locator('.faction-tabs li[data-case="controls"] a').click();

  // Wait for the faction-give-to-user React app to mount (two AJAX hops)
  await form.waitFor({ state: 'visible', timeout: 40_000 });

  // Give $1 to a member
  await form.getByTestId('autocomplete-input').click();
  await page.getByRole('button', { name: /User nikitad with ID/i }).click();
  await amountInput.fill('1');
  await page.getByRole('button', { name: 'give money' }).click();
  await page.getByRole('button', { name: 'CONFIRM' }).click();
  await expect(page.getByText('You gave $1 to nikitad')).toBeVisible();

  // Give negative amount (-$1)
  await form.getByTestId('autocomplete-input').click();
  await page.getByRole('button', { name: /User nikitad with ID/i }).click();
  await amountInput.fill('-1');
  await page.getByRole('button', { name: 'give money' }).click();
  await page.getByRole('button', { name: 'CONFIRM' }).click();
  await expect(page.getByText(/You (gave|took) \$1/i)).toBeVisible();

  // Switch between Give money and Add to balance modes
  await form.getByTestId('autocomplete-input').click();
  await page.getByRole('button', { name: /User nikitad with ID/i }).click();
  await page.getByText('Add to balance').first().click();
  await expect(page.getByText('Add to balance').first()).toBeVisible();
  await page.getByText('Give money').click();
  await expect(page.getByText('Give money')).toBeVisible();

  // Fill amount with "max" shortcut
  await amountInput.fill('max');
  await amountInput.press('Tab');
  await expect(amountInput).not.toHaveValue('max');
  await expect(amountInput).not.toHaveValue('');
});
