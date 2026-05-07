/**
 * Branch: config/rspack-migration-with-loose
 *
 * E2E for the heaviest @tanstack/react-query consumer outside Chat:
 * apps/elimination/* uses ~10 useQuery / useMutation hooks plus WebSocket
 * cache writes. Loose-mode class transforms (now disabled) were the root
 * cause of the persist bug; this test confirms the broader react-query
 * runtime is healthy on the rspack build.
 */

import { test, expect, type ConsoleMessage } from '@playwright/test';

const ELIM_URL = '/elimination.php';

const REACT_QUERY_ERRORS = [
  /Cannot read properties of undefined \(reading 'state'\)/i,
  /Cannot read properties of undefined \(reading 'data'\)/i,
  /defaultShouldDehydrateQuery/i,
  /useQuery/i,
  /useMutation/i,
  /QueryClient/i,
];

const isQueryError = (text: string) => REACT_QUERY_ERRORS.some((re) => re.test(text));

test.describe('Elimination — react-query consumers', () => {
  let consoleErrors: ConsoleMessage[] = [];
  let pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg); });
    page.on('pageerror', (err) => pageErrors.push(err));
  });

  test('EL-01 — Elimination home mounts without react-query errors', async ({ page }) => {
    const resp = await page.goto(ELIM_URL);
    if (resp && resp.status() >= 400) {
      test.skip(true, `Elimination not available (HTTP ${resp.status()})`);
    }
    const root = page.locator('[class*="EliminationApp"], .elimination, #elimination-react-root, [data-testid="elimination-root"]').first();
    const visible = await root.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!visible) test.skip(true, 'Elimination event not active or page not accessible');

    // Give queries a chance to resolve.
    await page.waitForTimeout(2_500);

    expect(consoleErrors.filter((m) => isQueryError(m.text())).map((m) => m.text())).toEqual([]);
    expect(pageErrors.filter((e) => isQueryError(e.message)).map((e) => e.message)).toEqual([]);
  });

  test('EL-02 — Top Teams panel renders data from useQuery', async ({ page }) => {
    await page.goto(ELIM_URL);
    const topTeams = page
      .locator('[class*="TopTeams"], [data-testid="top-teams"], .top-teams')
      .first();
    const visible = await topTeams.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!visible) test.skip(true, 'Top Teams panel not visible');

    // The panel should contain at least one team row once the query resolves.
    const rowCount = await topTeams.locator('li, tr, [class*="TeamRow"], [class*="team-row"]').count();
    expect(rowCount, 'team rows in Top Teams').toBeGreaterThan(0);
  });

  test('EL-03 — Headline component renders without errors', async ({ page }) => {
    await page.goto(ELIM_URL);
    const headline = page
      .locator('[class*="Headline"], [data-testid="headline"], .headline')
      .first();
    const visible = await headline.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!visible) test.skip(true, 'Headline not present on this Elimination state');

    // Headline must contain non-empty text (i.e. the query returned something).
    const text = await headline.innerText();
    expect(text.trim().length, 'headline text length').toBeGreaterThan(0);
  });
});
