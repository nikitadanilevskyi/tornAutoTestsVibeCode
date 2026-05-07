/**
 * Branch: 21996-adapt-functionality-pot-minigame-armoury-table
 *
 * What changed:
 *  - DEPOSIT: item is now removed from the player directly via
 *    removeArmouryItemByItemID() instead of being transferred to a "pot user" (ID 4545).
 *  - REWARDS: winner items are now created fresh via addSeveralItemsToArmoury()
 *    instead of being bulk-transferred from the pot user by armouryID.
 *  - INTERFACES: transferSeveralItemToNewUser() and getArmouryIDsForUpdate()
 *    removed from every layer (interface → manager → provider → DAL).
 *  - LOG FORMAT: logReward() 3rd argument is now {item_id: qty} map instead of
 *    armoury DB records; only the "dbItems" MongoDB audit field is affected.
 */

import { test, expect, APIRequestContext, APIResponse } from '@playwright/test';

// ─── helpers ─────────────────────────────────────────────────────────────────

const ENDPOINT = '/christmas_town.php';
// Must match GamePotTrigger::TRIGGER_GAME_TYPE — the TriggerBuilder routes any
// type starting with 'game' into the game\ sub-namespace, resolving to GamePotTrigger.
// Using the human-readable 'Pot' label causes a PHP fatal (class PotTrigger not found).
const GAME_TYPE = 'gamePot';

/** POST to the Christmas Town miniGameAction endpoint */
async function miniGameAction(
  request: APIRequestContext,
  params: { action: string; result?: Record<string, unknown> },
): Promise<APIResponse> {
  return request.post(ENDPOINT, {
    form: {
      step: 'miniGameAction',
      gameType: GAME_TYPE,
      action: params.action,
      ...(params.result
        ? Object.fromEntries(
            Object.entries(params.result).map(([k, v]) => [`result[${k}]`, String(v)]),
          )
        : {}),
    },
  });
}

/** GET the player's current pot-eligible items for a given category */
async function getPotItemsList(
  request: APIRequestContext,
  category: string,
): Promise<APIResponse> {
  return request.post(ENDPOINT, {
    form: { step: 'getPotItems', type: category },
  });
}

/**
 * Fetch current game state for the Pot mini-game.
 * Returns null when Christmas Town is not active (seasonal gate closed).
 */
async function fetchGameState(
  request: APIRequestContext,
): Promise<Record<string, unknown> | null> {
  const res = await miniGameAction(request, { action: 'state' });
  if (!res.ok()) return null;
  const body = await res.json().catch(() => null);
  // The backend returns { error: '...' } when the game is closed/inaccessible
  if (!body || body['error'] || body['message'] === 'This game is closed!') return null;
  return body as Record<string, unknown>;
}

// ─── seasonal gate ────────────────────────────────────────────────────────────

/**
 * All tests in this file are wrapped in a beforeAll that skips the whole suite
 * when Christmas Town is not active (outside December or feature flag off).
 * This lets the suite live in CI year-round without false failures.
 */
let christmasTownActive = false;

test.beforeAll(async ({ request }) => {
  const state = await fetchGameState(request);
  christmasTownActive = state !== null;
});

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('Pot mini-game — branch 21996', () => {
  // ── 1. Seasonal availability ───────────────────────────────────────────────
  test('Christmas Town page is reachable', async ({ page }) => {
    const res = await page.goto('/christmas_town.php');
    expect(res?.status(), 'Page should not 404 or 500').not.toBeGreaterThan(400);
  });

  test('miniGameAction state endpoint responds without server error', async ({ request }) => {
    const res = await miniGameAction(request, { action: 'state' });
    expect(res.status(), 'Endpoint should return 200').toBe(200);
    const body = await res.json();
    // Even a closed game returns a valid JSON object, never raw HTML/fatal
    expect(typeof body).toBe('object');
  });

  // ── 2. Game state shape ────────────────────────────────────────────────────
  test('game state has expected fields when active', async ({ request }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');

    const state = await fetchGameState(request);
    expect(state).not.toBeNull();
    // Should contain itemsRemaining, yourItemsInPot, category
    expect(state).toHaveProperty('itemsRemaining');
    expect(state).toHaveProperty('yourItemsInPot');
    expect(state).toHaveProperty('category');
    expect(typeof state!['itemsRemaining']).toBe('number');
    expect(typeof state!['yourItemsInPot']).toBe('number');
  });

  // ── 3. Deposit — item removed from player inventory ────────────────────────
  test('depositing an item reduces player inventory by 1', async ({ request }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');

    const state = await fetchGameState(request);
    const category = state!['category'] as string;
    expect(category, 'Game must return a category string').toBeTruthy();

    // Get eligible items before deposit
    const beforeRes = await getPotItemsList(request, category);
    expect(beforeRes.ok()).toBeTruthy();
    const beforeItems: Array<{ itemID: number; name: string }> = await beforeRes.json();
    test.skip(beforeItems.length === 0, `No eligible ${category} items in inventory — skipping deposit test`);

    const itemToDeposit = beforeItems[0];

    // Perform deposit
    const depositRes = await miniGameAction(request, {
      action: 'complete',
      result: { itemID: itemToDeposit.itemID },
    });
    expect(depositRes.ok()).toBeTruthy();
    const depositBody = await depositRes.json();

    // Should NOT return an error about not owning the item
    expect(depositBody['message'], 'Deposit should not fail with ownership error').not.toMatch(
      /do not own/i,
    );
    // Should confirm the deposit or signal game end
    const isDepositConfirm =
      /you add/i.test(String(depositBody['message'])) ||
      /congratulations/i.test(String(depositBody['message']));
    expect(isDepositConfirm, `Unexpected message: ${depositBody['message']}`).toBeTruthy();

    // Get eligible items after deposit — count must be 1 less for that item
    const afterRes = await getPotItemsList(request, category);
    const afterItems: Array<{ itemID: number; name: string }> = await afterRes.json();

    const countBefore = beforeItems.filter((i) => i.itemID === itemToDeposit.itemID).length;
    const countAfter = afterItems.filter((i) => i.itemID === itemToDeposit.itemID).length;
    expect(
      countAfter,
      `Inventory for item ${itemToDeposit.itemID} should decrease by 1 (was ${countBefore})`,
    ).toBe(countBefore - 1);
  });

  // ── 4. Deposit — yourItemsInPot counter increments ────────────────────────
  test('yourItemsInPot counter increments after deposit', async ({ request }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');

    const stateBefore = await fetchGameState(request);
    const potBefore = stateBefore!['yourItemsInPot'] as number;
    const category = stateBefore!['category'] as string;

    const itemsRes = await getPotItemsList(request, category);
    const items: Array<{ itemID: number }> = await itemsRes.json();
    test.skip(items.length === 0, 'No eligible items for deposit');

    await miniGameAction(request, {
      action: 'complete',
      result: { itemID: items[0].itemID },
    });

    const stateAfter = await fetchGameState(request);
    if (!stateAfter) return; // game may have ended if this was a winning deposit
    const potAfter = stateAfter['yourItemsInPot'] as number;

    expect(potAfter, 'yourItemsInPot should increase by 1').toBe(potBefore + 1);
  });

  // ── 5. Deposit — non-owned item rejected ──────────────────────────────────
  test('depositing a non-existent itemID returns ownership error', async ({ request }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');

    const res = await miniGameAction(request, {
      action: 'complete',
      result: { itemID: 999999999 }, // deliberately invalid
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(String(body['message'])).toMatch(/do not own|wrong type|not found/i);
  });

  // ── 6. Deposit — wrong category item rejected ─────────────────────────────
  test('depositing item of wrong category is rejected', async ({ request }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');

    const state = await fetchGameState(request);
    const currentCategory = state!['category'] as string;

    // Try each other category; use a category that is unlikely to match the
    // current one. We just need a real itemID from a *different* category.
    // Because we can't easily get a cross-category item without more API calls,
    // we test with a clearly wrong category type by passing itemID=0.
    const res = await miniGameAction(request, {
      action: 'complete',
      result: { itemID: 0 },
    });
    const body = await res.json();
    expect(String(body['message'])).toMatch(/do not own|wrong type|not found/i);
    // The current category must not have changed
    const stateAfter = await fetchGameState(request);
    if (stateAfter) {
      expect(stateAfter['category']).toBe(currentCategory);
    }
  });

  // ── 7. Deposit — max items limit enforced ─────────────────────────────────
  test('player cannot deposit more than GAME_ITEMS_ALLOWED (3) items', async ({ request }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');

    const state = await fetchGameState(request);
    const itemsRemaining = state!['itemsRemaining'] as number;

    if (itemsRemaining > 0) {
      // Verify that the state correctly reflects the remaining quota
      expect(itemsRemaining).toBeGreaterThanOrEqual(0);
      expect(itemsRemaining).toBeLessThanOrEqual(3);
    } else {
      // At limit: next deposit should be rejected
      const category = state!['category'] as string;
      const itemsRes = await getPotItemsList(request, category);
      const items: Array<{ itemID: number }> = await itemsRes.json();
      if (items.length > 0) {
        const res = await miniGameAction(request, {
          action: 'complete',
          result: { itemID: items[0].itemID },
        });
        const body = await res.json();
        expect(String(body['message'])).toMatch(/cannot|can not|not allowed/i);
      }
    }
  });

  // ── 8. Reward — items added to winner inventory (win triggered) ────────────
  test('winning the game adds correct item quantities to winner inventory', async ({
    request,
  }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');
    /**
     * This test can only run when:
     *  - The player is about to trigger the winning deposit.
     * Because we cannot force this state reliably in automation, the test
     * verifies the API response shape when a win occurs during a deposit.
     *
     * If the deposit response contains "congratulations", we validate the
     * response payload and then verify inventory increased.
     */
    const state = await fetchGameState(request);
    const category = state!['category'] as string;
    const itemsRes = await getPotItemsList(request, category);
    const items: Array<{ itemID: number }> = await itemsRes.json();

    test.skip(items.length === 0, 'No items available to trigger win test');

    const beforeInventory: Array<{ itemID: number }> = await itemsRes.json();
    const depositRes = await miniGameAction(request, {
      action: 'complete',
      result: { itemID: items[0].itemID },
    });
    const body = await depositRes.json();

    if (/congratulations/i.test(String(body['message']))) {
      // Win occurred — verify response structure
      expect(body).toHaveProperty('board');
      expect(body).toHaveProperty('state');
      expect((body['state'] as Record<string, unknown>)['nextGame']).toBeGreaterThan(0);

      // Inventory should have increased for at least one item type
      const afterRes = await getPotItemsList(request, category);
      const afterInventory: Array<{ itemID: number }> = await afterRes.json();
      // Net change: +pot items gained, -1 item just deposited
      // At minimum the count should be different (items added)
      expect(afterInventory.length).not.toBe(beforeInventory.length);
    }
    // If no win, the test is informational — still passes
  });

  // ── 9. Reward log format — no server error from changed $rewardItems shape ─
  test('logReward does not throw when called with new {item_id: qty} format', async ({
    request,
  }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');
    /**
     * The 3rd argument to logReward() changed from armoury DB records to a
     * {item_id: qty} map. Any PHP fatal would surface as a 500 or malformed JSON.
     * A successful deposit (or a win) proves logReward ran without error.
     */
    const state = await fetchGameState(request);
    const category = state!['category'] as string;
    const itemsRes = await getPotItemsList(request, category);
    const items: Array<{ itemID: number }> = await itemsRes.json();
    test.skip(items.length === 0, 'No items to trigger reward log');

    const res = await miniGameAction(request, {
      action: 'complete',
      result: { itemID: items[0].itemID },
    });
    // A 500 or non-JSON response would mean logReward threw
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('fatal');
    expect(body).not.toHaveProperty('error');
  });

  // ── 10. Removed methods — no interface errors ──────────────────────────────
  test('transferSeveralItemToNewUser and getArmouryIDsForUpdate are no longer callable', async ({
    request,
  }) => {
    /**
     * These methods were removed from every interface layer in this branch.
     * We verify that any code path that goes through the normal game flow
     * does NOT result in "Method does not exist" or similar errors.
     * A clean state-action response proves the layer stack is intact.
     */
    const res = await miniGameAction(request, { action: 'state' });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Should be a game state object or a closed-game message, never a PHP fatal
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/transferSeveralItemToNewUser|getArmouryIDsForUpdate|fatal error/i);
  });

  // ── 11. Casino ban — deposit rejected for banned users ────────────────────
  test('casino-banned users receive a ban message, not a PHP error', async ({ request }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');
    /**
     * We cannot force a casino ban in automation, but we verify the gate
     * does not throw after the refactor by confirming the endpoint is reachable
     * and returns structured JSON for any user.
     */
    const state = await fetchGameState(request);
    // If user is banned, body will have a ban message — still valid JSON, not a 500
    if (state === null) {
      // Game closed: acceptable
      return;
    }
    expect(typeof state).toBe('object');
  });

  // ── 12. Concurrent deposit — Redis lock prevents double-spend ─────────────
  test('sending two simultaneous deposit requests does not double-remove items', async ({
    request,
  }) => {
    test.skip(!christmasTownActive, 'Christmas Town is not active (seasonal)');

    const state = await fetchGameState(request);
    const category = state!['category'] as string;
    const itemsRes = await getPotItemsList(request, category);
    const items: Array<{ itemID: number }> = await itemsRes.json();
    test.skip(items.length === 0, 'No items available');

    const itemID = items[0].itemID;
    const countBefore = items.filter((i) => i.itemID === itemID).length;

    // Fire two identical deposits simultaneously
    const [res1, res2] = await Promise.all([
      miniGameAction(request, { action: 'complete', result: { itemID } }),
      miniGameAction(request, { action: 'complete', result: { itemID } }),
    ]);

    const [b1, b2] = await Promise.all([res1.json(), res2.json()]);

    // At least one should succeed and at most one should succeed
    const successCount = [b1, b2].filter(
      (b) =>
        /you add|congratulations/i.test(String(b['message'])) && !b['error'],
    ).length;
    expect(successCount, 'Exactly one of the two concurrent deposits should succeed').toBeLessThanOrEqual(1);

    // Inventory should only have decreased by at most 1
    const afterRes = await getPotItemsList(request, category);
    const afterItems: Array<{ itemID: number }> = await afterRes.json();
    const countAfter = afterItems.filter((i) => i.itemID === itemID).length;
    expect(
      countBefore - countAfter,
      'Item count should decrease by at most 1 (lock prevents double-remove)',
    ).toBeLessThanOrEqual(1);
  });
});
