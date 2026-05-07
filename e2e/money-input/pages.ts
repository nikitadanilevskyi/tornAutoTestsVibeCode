import { type Page, type Locator } from '@playwright/test';

// ─── Shared page-definition type ─────────────────────────────────────────────

export type PageDef = {
  name: string;
  url: string;
  getInput: (page: Page) => Locator;
  navigate?: (page: Page) => Promise<boolean | void>;
  /** Run sub-tests serially (one worker) to avoid concurrent PHP
   *  session-locking issues when multiple workers hit the same page. */
  serial?: boolean;
  /** Pass true when the input uses tornInputMoney with strictMode: false
   *  (allowZero: true), so that 0 produces "success" instead of "error". */
  allowZero?: boolean;
  /** Pages whose money input is only reachable when the player is currently
   *  travelling abroad (Travel Abroad Shop, Cayman Bank deposit/withdraw).
   *  Filtered out of the default workflow specs (simple-pages, height,
   *  broad-smoke) and exercised separately by e2e/money-input-traveling. */
  traveling?: boolean;
  /** Set to true when the page hosts a money input variant whose contract
   *  diverges from the standard tornInputMoney helpers (e.g. the React
   *  `AmountInput` on the Travel Abroad Shop — single-digit cap, 24px
   *  height, no $ symbol button). Behavioral tests are skipped for these
   *  entries; only the reachability SANITY check applies. */
  sanityOnly?: boolean;
};

// ─── Shared locator helper ────────────────────────────────────────────────────

/** Visible text input inside the standard input-money-group, scoped to a container.
 *  Excludes groups with class no-max-value (plugin on inputs without data-money). */
export function visibleInput(
  page: Page,
  containerSelector: string,
  groupExtra = '',
): Locator {
  return page.locator(
    `${containerSelector} .input-money-group${groupExtra} input[type="text"]`,
  );
}

// ─── Page definitions ─────────────────────────────────────────────────────────
//
// Each entry describes one money input on a Torn page:
//   • url      – initial page to navigate to
//   • getInput – returns the Locator for the money input
//   • navigate – optional extra steps to reach the input;
//                return `false` to skip the test (prerequisite not met)
//
// Tests only interact with the input value (fill / tab) — they never submit
// a form, so they are safe to run against the live dev environment.

export const PAGES: PageDef[] = [

  // ── Always accessible ───────────────────────────────────────────────────

  {
    // Navigate to a known user profile, click "Send cash", dismiss the "Do
    // not fall for scams!" warning dialog, then wait for the form to render.
    // The form uses LegacyMoneyInput which internally calls tornInputMoney,
    // so the standard .input-money-group selector applies.
    //
    // serial=true: prevents PHP session locking when 3 workers concurrently
    // hit profiles.php?XID=2150779 (same issue as pmarket.php).
    name: 'Send Cash',
    url: '/profiles.php?XID=2150779',
    serial: true,
    allowZero: true,   // LegacyMoneyInput uses strictMode: false by default
    // LegacyMoneyInput renders <input> with no explicit type attribute, so
    // input[type="text"] does not match.  Both display and hidden clones get
    // class input-money; :not([type="hidden"]) selects the visible display input.
    getInput: (p) => p.locator('.send-cash .input-money-group input.input-money:not([type="hidden"])'),
    navigate: async (page) => {
      // React app injects initial state from PHP, so buttons render on mount.
      // waitFor handles the brief React hydration delay.
      const btn = page.locator('.profile-button.profile-button-sendMoney');
      const appeared = await btn
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!appeared) return false;
      await btn.click();

      // A "Do not fall for scams!" warning dialog appears first (unless the
      // player previously checked "Don't show again").  Wait then click Okay.
      const okayBtn = page.locator('.send-cash-text .cancel-btn').filter({ hasText: 'Okay' });
      const warningAppeared = await okayBtn
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (warningAppeared) {
        await okayBtn.click();
      }

      // Wait for tornInputMoney to wrap the LegacyMoneyInput after form renders.
      const group = page.locator('.send-cash .input-money-group');
      const formAppeared = await group
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!formAppeared) return false;
    },
  },

  {
    // The investment form is only visible when the user has no active/expired
    // investment (PHP renders invest-head-wrap without display:none in that case).
    // tornInputMoney is initialised inside the onBankLoad() AJAX callback.
    // Selecting a time period from the dropdown before checking the input
    // ensures the form is properly activated and makes the test realistic.
    name: 'Bank / Investment',
    url: '/bank.php',
    serial: true,
    // bank.php renders <input class="money"> with no explicit type attribute.
    // tornInputMoney adds class input-money; exclude hidden + button siblings.
    getInput: (p) => p.locator('.invest-head-wrap .input-money-group input.input-money:not([type="hidden"]):not([type="button"])'),
    navigate: async (page) => {
      // onBankLoad() always calls tornInputMoney on .money-wrap .money regardless
      // of the PHP-rendered visibility state (no investment / active / expired).
      // The bank page has a live countdown timer so 'networkidle' never fires;
      // poll for the AJAX callback to finish (creates .input-money-group).
      const groupFound = await page.waitForFunction(
        () => !!document.querySelector('.invest-head-wrap .input-money-group'),
        { timeout: 15_000 },
      ).then(() => true).catch(() => false);
      if (!groupFound) return false;

      // Force-show the wrap in case it is hidden (active or expired investment),
      // then select "One week" to activate the INVEST button.
      // initDropdown() uses jQuery UI selectmenu which hides the native <select>,
      // so Playwright's selectOption won't work — use jQuery trigger instead.
      await page.evaluate(() => {
        (window as any).$('.invest-head-wrap').show();
        (window as any).$('#select-length').val('1week').trigger('change');
      });

      const input = page.locator('.invest-head-wrap .input-money-group input.input-money:not([type="hidden"]):not([type="button"])');
      const appeared = await input
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!appeared) return false;
    },
  },

  {
    // The points market page runs tornInputMoney on BOTH the quantity input
    // (no data-money → group gets class no-max-value) and the price input
    // (has data-money="100000" → standard group, has $ button).
    // :not(.no-max-value) selects only the price group.
    // initActions() runs synchronously on DOMReady but we still wait briefly
    // in case the add-listing block is conditionally absent.
    //
    // serial=true: PHP session locking means concurrent workers receive empty
    // pages when they all hit pmarket.php at the same time.  Running the three
    // sub-tests in the same worker (serial mode) prevents this.
    name: 'Points Market / Price per point',
    url: '/pmarket.php',
    serial: true,
    getInput: (p) => visibleInput(p, '.add-listing-block', ':not(.no-max-value)'),
    navigate: async (page) => {
      const input = page.locator('.add-listing-block .input-money-group:not(.no-max-value) input[type="text"]');
      const appeared = await input
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!appeared) return false;
    },
  },

  // NOTE: Points Market / Quantity (#quantity-points) is intentionally omitted.
  // points_market.js adds a focusout handler that caps the value to the player's
  // available point balance independently of tornInputMoney's data-money attribute.
  // Since data-money is absent, our infrastructure cannot detect this external cap,
  // causing checkShortcutsAndFormatting to fail for any value > player's points.

  // ── Accessible to all players ────────────────────────────────────────────

  {
    // loan.php renders a "Increase Loan" form with a .take-amount input.
    // tornInputMoney wraps it: the display clone has type="text" and
    // class="take-amount left input-money"; the hidden clone has type="hidden".
    // Only the "Increase Loan" form is unconditionally present — the back/pay
    // forms only appear when an active loan exists.
    name: 'Loan / Increase Loan',
    url: '/loan.php',
    getInput: (p) => p.locator('.take-back-wrap .input-money-group input.take-amount:not([type="hidden"]):not([type="button"])'),
    navigate: async (page) => {
      const group = page.locator('.take-back-wrap .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // museum.php calls tornInputMoney on all set exchange inputs.
    // Each group gets class no-max-value (no data-money on the input).
    // Unusually the display clone has type="tel" (not "text"), so visibleInput
    // won't work — select directly via class.  We target the first group only
    // (Plushie sets) as a representative sample.
    name: 'Museum / Exchange Sets',
    url: '/museum.php',
    getInput: (p) =>
      p.locator('.museum .actions-wrapper .input-money-group').first()
       .locator('input.sets-amount:not([type="hidden"])'),
    navigate: async (page) => {
      const group = page.locator('.museum .actions-wrapper .input-money-group').first();
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Requires navigating to a sub-section ────────────────────────────────

  {
    // Church calls tornInputMoney with groupMoneyClass='input-money-group-church'
    // (non-default) and only when the user clicks the "Donate" button.
    // The jQuery click handler is bound to '.donate-wrap .btn-wrap', so we
    // click that element directly (not the inner button) to avoid any event-
    // propagation edge cases.  After the click the handler removes the 'hide'
    // class from .give-wrap and calls tornInputMoney synchronously.
    name: 'Church / Donate',
    url: '/church.php',
    getInput: (p) => p.locator('#church-donate .give-wrap .input-money-group-church input[type="text"]'),
    navigate: async (page) => {
      const btnWrap = page.locator('#church-donate .donate-wrap .btn-wrap');
      // At narrow viewports the donate section may not be rendered or accessible.
      const btnVisible = await btnWrap
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!btnVisible) return false;

      await btnWrap.click();
      // .give-wrap starts with class 'hide' (display:none).  The click handler
      // calls removeClass('hide'), making it visible.
      const appeared = await page
        .locator('#church-donate .give-wrap')
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!appeared) return false;
    },
  },

  {
    // The bounties page uses hash routing.  Clicking "Put a bounty on
    // someone" loads the add-bounty form with the reward money input.
    name: 'Bounties / Reward',
    url: '/bounties.php',
    getInput: (p) => p.locator('.add-bounties-wrap .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const addLink = page.locator('a[href="#/p=add"]');
      const linkVisible = await addLink
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!linkVisible) return false;
      await addLink.click();
      const group = page.locator('.add-bounties-wrap .input-money-group');
      const appeared = await group
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!appeared) return false;
    },
  },

  // ── Requires faction membership ──────────────────────────────────────────

  {
    // #/tab=armoury with no sub= defaults to sub=donate (faction_new.js line 677).
    // armouryPageTabContent POSTs to factions.php?step=armouryTabContent, renders
    // donate-new.php, then calls tornInputMoney on .donate-wrap .cash .amount.
    // donate-new.php: <input class="amount" type="text" aria-label="How much money...">
    // getByRole('textbox') is used over input[type="text"] for readability.
    name: 'Faction Armoury / Deposit Money',
    url: '/factions.php?step=your&type=1#/tab=armoury',
    getInput: (p) => p.getByRole('textbox', { name: /How much money would you like to deposit/i }),
    navigate: async (page) => {
      // Wait for the donate-tab AJAX to complete and tornInputMoney to wrap the input.
      const groupFound = await page.waitForFunction(
        () => !!document.querySelector('.donate-wrap .cash .input-money-group'),
        { timeout: 15_000 },
      ).then(() => true).catch(() => false);
      if (!groupFound) return false;

      const input = page.getByRole('textbox', { name: /How much money would you like to deposit/i });
      const visible = await input
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Requires company membership ──────────────────────────────────────────

  {
    // Advertising budget input uses strictMode: false → 0 is valid (allowZero).
    // data-money="0" when the company has no ad budget allocated, so formatting
    // and relative-shortcut tests are skipped automatically (maxValue = 0).
    name: 'Company / Advertising Budget',
    url: '/companies.php?step=your&type=1#/option=advertising',
    allowZero: true,
    getInput: (p) => p.locator('.advertising-amount-container .input-money-group input.advertising-amount:not([type="hidden"]):not([type="button"])'),
    navigate: async (page) => {
      const group = page.locator('.advertising-amount-container .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    name: 'Company Funds / Withdraw',
    url: '/companies.php?step=your&type=1#/option=funds',
    getInput: (p) => visibleInput(p, '.funds-wrap.withdraw'),
    navigate: async (page) => {
      const group = page.locator('.funds-wrap.withdraw .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    name: 'Company Funds / Deposit',
    url: '/companies.php?step=your&type=1#/option=funds',
    getInput: (p) => visibleInput(p, '.funds-wrap.deposit'),
    navigate: async (page) => {
      const group = page.locator('.funds-wrap.deposit .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Casino ───────────────────────────────────────────────────────────────

  {
    // Blackjack initialises tornInputMoney on .bet-input-wrap input (no strictMode:
    // false → allowZero defaults to false).  data-money is set dynamically by the
    // game JS to the player's on-hand cash.  The group also gets class no-max-value
    // during the brief window before the game JS writes data-money, but getMaxValue
    // reads the attribute from the input element directly, so this is harmless.
    name: 'Casino / Blackjack Bet',
    url: '/page.php?sid=blackjack',
    getInput: (p) => p.locator('.bet-input-wrap .input-money-group input.bet:not([type="hidden"]):not([type="button"])'),
    navigate: async (page) => {
      const group = page.locator('.bet-input-wrap .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
      // Game JS sets data-money asynchronously after the group is visible.
      // Wait for it so that getMaxValue captures the real cap before tests run.
      await page.waitForFunction(
        () => {
          const el = document.querySelector(
            '.bet-input-wrap .input-money-group input.bet:not([type="hidden"]):not([type="button"])',
          ) as HTMLInputElement | null;
          return el !== null && el.getAttribute('data-money') !== null;
        },
        { timeout: 10_000 },
      ).catch(() => { /* proceed without cap if game JS never fires */ });
    },
  },

  // ── Requires items listed in bazaar ──────────────────────────────────────

  {
    // Bazaar manage page uses LegacyMoneyInput (data-testid="legacy-money-input"),
    // which calls tornInputMoney with strictMode: false → 0 is valid (allowZero).
    // tornInputMoney wraps each item's price input; data-money="100000000000000000000"
    // (no practical upper bound).  The display clone has no explicit type attribute,
    // so :not([type="hidden"]):not([type="button"]) selects it.
    // We target the first group (first listed item) as a representative sample.
    name: 'Bazaar / Item Price',
    url: '/bazaar.php#/manage',
    allowZero: true,
    getInput: (p) =>
      p.locator('.input-money-group').first()
       .locator('input.input-money:not([type="hidden"]):not([type="button"])'),
    navigate: async (page) => {
      const group = page.locator('.input-money-group').first();
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Requires a property with an ultra-safe vault ─────────────────────────

  {
    name: 'Properties Vault / Withdraw',
    url: '/properties.php#/p=options&ID=4165929&tab=vault',
    // vault.php renders <input type="text" data-money="...">, so visibleInput works.
    // .vault-cont:not(.deposit-box) selects the withdraw form (left side).
    getInput: (p) => visibleInput(p, '.vault-cont:not(.deposit-box)'),
    navigate: async (page) => {
      const group = page.locator('.vault-cont:not(.deposit-box) .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    name: 'Properties Vault / Deposit',
    url: '/properties.php#/p=options&ID=4165929&tab=vault',
    // vault.php renders <input type="text" data-money="...">, so visibleInput works.
    // .deposit-box selects the deposit form (right side).
    getInput: (p) => visibleInput(p, '.deposit-box'),
    navigate: async (page) => {
      const group = page.locator('.deposit-box .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // properties.php initialises vault, deposit, and pay-rent (upkeep) inputs
    // together when the property options AJAX loads.  The display clone for
    // input[name="pay"] has type="text" and class="input-money".
    // Scoped to .upkeep-opt to distinguish it from the vault inputs on the
    // same page.  data-money reflects the player's current cash on hand.
    name: 'Properties / Pay Rent',
    url: '/properties.php#/p=options&ID=4165929&tab=upkeep',
    getInput: (p) => p.locator('.upkeep-opt .input-money-group input.input-money:not([type="hidden"]):not([type="button"])'),
    navigate: async (page) => {
      const group = page.locator('.upkeep-opt .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Properties — sell / lease / offer-extension tabs ────────────────────

  {
    // Clicking the "sell" option in the property options list triggers
    // toggledOptionsContainers('sell') which calls tornInputMoney on
    // .sell-opt .market.cont .money[type="text"].  The hash tab=sell makes
    // properties.js auto-click the sell-prop li on page load.
    name: 'Properties / Sell',
    url: '/properties.php#/p=options&ID=4165929&tab=sell',
    getInput: (p) => p.locator('.sell-opt .market.cont .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.sell-opt .market.cont .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // Properties lease tab — user section, cost field.
    // tornInputMoney is called with strictMode: true, skipBlurCheck: true,
    // buttonElement: null.  No data-money → relative shortcuts are skipped.
    name: 'Properties / Lease — User Cost',
    url: '/properties.php#/p=options&ID=4165929&tab=lease',
    getInput: (p) => p.locator('.lease-opt #user .cost .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.lease-opt #user .cost .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // Properties lease tab — user section, amount (duration/payment) field.
    name: 'Properties / Lease — User Amount',
    url: '/properties.php#/p=options&ID=4165929&tab=lease',
    getInput: (p) => p.locator('.lease-opt #user .amount .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.lease-opt #user .amount .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // Properties lease tab — market section, cost field.
    name: 'Properties / Lease — Market Cost',
    url: '/properties.php#/p=options&ID=4165929&tab=lease',
    getInput: (p) => p.locator('.lease-opt #market .cost .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.lease-opt #market .cost .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // Properties lease tab — market section, amount field.
    name: 'Properties / Lease — Market Amount',
    url: '/properties.php#/p=options&ID=4165929&tab=lease',
    getInput: (p) => p.locator('.lease-opt #market .amount .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.lease-opt #market .amount .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // Properties offer-extension tab — cost field.
    // tornInputMoney: strictMode: true, skipBlurCheck: true, buttonElement: null.
    name: 'Properties / Offer Extension — Cost',
    url: '/properties.php#/p=options&ID=4165929&tab=offerExtension',
    getInput: (p) => p.locator('.offerExtension-opt .cost .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.offerExtension-opt .cost .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // Properties offer-extension tab — amount (duration) field.
    name: 'Properties / Offer Extension — Amount',
    url: '/properties.php#/p=options&ID=4165929&tab=offerExtension',
    getInput: (p) => p.locator('.offerExtension-opt .amount .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.offerExtension-opt .amount .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Faction — donate points, pay-day ─────────────────────────────────────

  {
    // Faction armoury donate tab initialises tornInputMoney on both
    // .donate-wrap .cash .amount (already covered) AND .donate-wrap .points .amount.
    // The points input has no data-money; relative shortcuts are skipped.
    name: 'Faction Armoury / Donate Points',
    url: '/factions.php?step=your&type=1#/tab=armoury&sub=donate',
    getInput: (p) => p.locator('.donate-wrap .points .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.donate-wrap .points .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // Faction controls — pay-day tab.  tornInputMoney is initialised when
    // controlsPageTabContent runs with opt.tab === 'pay-day'.  This tab is
    // only visible to faction leaders; the navigate function returns false
    // (skips) if the pay-day panel fails to load.
    name: 'Faction Controls / Pay Day',
    url: '/factions.php?step=your#/tab=controls&option=pay-day',
    getInput: (p) => p.locator('.payment-cont .input-money-group input[type="text"]'),
    navigate: async (page) => {
      // Navigate to the controls tab first if not already there
      const controlsTab = page.locator('.faction-tabs li[data-case="controls"] a');
      const tabVisible = await controlsTab
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!tabVisible) return false;
      await controlsTab.click();

      const group = page.locator('.payment-cont .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Company management tabs ───────────────────────────────────────────────

  {
    // Company manage — stock tab.  tornInputMoney is called on
    // .manage-company .quantity input[type=text] with strictMode: false
    // (allowZero: true).  No data-money → relative shortcuts are skipped.
    // Tab is loaded via AJAX when #/option=stock is activated.
    name: 'Company / Stock Quantity',
    url: '/companies.php?step=your&type=1#/option=stock',
    allowZero: true,
    getInput: (p) => p.locator('.manage-company .quantity .input-money-group input[type="text"]').first(),
    navigate: async (page) => {
      const group = page.locator('.manage-company .quantity .input-money-group').first();
      const visible = await group
        .waitFor({ state: 'visible', timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // Company manage — employees tab.  tornInputMoney called on .employee-input-pay
    // with strictMode: false (allowZero: true).  The input may be readonly if
    // the player lacks ownership permissions; navigate returns false in that case.
    name: 'Company / Employee Pay',
    url: '/companies.php?step=your&type=1#/option=employees',
    allowZero: true,
    getInput: (p) => p.locator('.employee-input-pay.input-money').first(),
    navigate: async (page) => {
      // Wait for tornInputMoney to wrap at least one employee pay input
      const group = page.locator('.input-money-group').filter({ has: page.locator('.employee-input-pay') }).first();
      const visible = await group
        .waitFor({ state: 'visible', timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
      // Skip if the input is readonly (no edit permission)
      const input = page.locator('.employee-input-pay.input-money').first();
      const readonly = await input.getAttribute('readonly');
      if (readonly !== null) return false;
    },
  },

  {
    // Company manage — pricing tab.  tornInputMoney called with default options
    // (strictMode: true, allowZero: false).  First pricing input is used.
    name: 'Company / Item Pricing',
    url: '/companies.php?step=your&type=1#/option=pricing',
    getInput: (p) => p.locator('.manage-company .pricing-list .input-money-group input[type="text"]').first(),
    navigate: async (page) => {
      const group = page.locator('.manage-company .pricing-list .input-money-group').first();
      const visible = await group
        .waitFor({ state: 'visible', timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Auction House ─────────────────────────────────────────────────────────

  {
    // amarket.php — bid amount input.  tornInputMoney is called inside the
    // AJAX success callback after clicking .bid-btn on a listed lot.
    // The navigate function clicks the first available bid button to load
    // the bid form; returns false if no biddable lots exist.
    name: 'Auction House / Bid',
    url: '/amarket.php',
    serial: true,
    getInput: (p) => p.locator('input[name="bid"].input-money:not([type="hidden"])').first(),
    navigate: async (page) => {
      // Wait for the auction listing to load
      const firstBidBtn = page.locator('.bid-btn .torn-btn, .bid-icon').first();
      const btnVisible = await firstBidBtn
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!btnVisible) return false;

      await firstBidBtn.click();

      // AJAX renders the bid form and calls tornInputMoney
      const group = page.locator('.input-money-group').filter({ has: page.locator('input[name="bid"]') }).first();
      const visible = await group
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Item shop (Gun Shop) ──────────────────────────────────────────────────

  {
    // shops.php — sell items amount.  tornInputMoney is called on
    // .sell-items-list input[name="amount"][type="text"] with showSymbolButton: false.
    // data-money is set on each input to the quantity available.
    // Returns false if the player has no items listed for sale.
    name: 'Gun Shop / Sell Items Amount',
    url: '/shops.php',
    serial: true,
    getInput: (p) => p.locator('.sell-items-list input[name="amount"].input-money:not([type="hidden"])').first(),
    navigate: async (page) => {
      const group = page.locator('.sell-items-list .input-money-group').first();
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    // shops.php — pawn shop sell points.  tornInputMoney is called on
    // .sell-points-wrap input[name=points] with default options (strictMode: true).
    // No data-money → relative shortcuts are skipped.
    name: 'Gun Shop / Sell Points',
    url: '/shops.php',
    serial: true,
    getInput: (p) => p.locator('.sell-points-wrap .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.sell-points-wrap .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Racing ────────────────────────────────────────────────────────────────

  {
    // racing.php — custom race bet amount.  tornInputMoney is called in init()
    // on #createCustomRace .bet-wrap .input-wrap input with strictMode: false
    // (allowZero: true) and showSymbolButton: false.  The form is rendered
    // server-side when #select-racing-track exists; returns false if the
    // player does not have racing access.
    name: 'Racing / Custom Race Bet',
    url: '/racing.php',
    allowZero: true,
    getInput: (p) => p.locator('#createCustomRace .bet-wrap .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('#createCustomRace .bet-wrap .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Trade ─────────────────────────────────────────────────────────────────

  {
    // trade.php — add money to trade.  tornInputMoney is called on
    // .init-trade input[name="amount"] with strictMode: false (allowZero: true).
    // The panel only renders when a trade is in the initiateTrade step;
    // returns false if no active trade exists.
    name: 'Trade / Add Money',
    url: '/trade.php',
    allowZero: true,
    serial: true,
    getInput: (p) => p.locator('.init-trade .input-money-group input[type="text"]'),
    navigate: async (page) => {
      const group = page.locator('.init-trade .input-money-group');
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Item Market ───────────────────────────────────────────────────────────

  {
    // item-market SPA — AmountInput (wraps LegacyMoneyInput) for stacked items.
    // The input is only visible when a stacked listing is selected.
    // AmountInput uses the same .input-money-group DOM structure.
    // data-money is set to available quantity (not cash) so shortcuts and
    // symbol button operate against the item count, not a money cap.
    name: 'Item Market / Buy Quantity',
    url: '/page.php?sid=ItemMarket',
    serial: true,
    getInput: (p) =>
      p.locator('.buy-controls .input-money-group input.input-money:not([type="hidden"])')
        .first(),
    navigate: async (page) => {
      // Wait for the React SPA to mount
      await page.waitForFunction(
        () => !!document.getElementById('react-item-market-root') || !!document.querySelector('[data-testid="item-market"]'),
        { timeout: 20_000 },
      ).catch(() => {});
      // Click the first stacked item row — only stacked listings show the qty input
      const stackedRow = page.locator('[data-testid="item-row"]:has(.buy-controls), .item-row:has(.buy-controls)').first();
      const rowVisible = await stackedRow
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!rowVisible) return false;

      const group = page.locator('.buy-controls .input-money-group').first();
      const inputVisible = await group
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!inputVisible) return false;
    },
  },

  // ── Stock Market ──────────────────────────────────────────────────────────

  {
    // stock-market SPA — LegacyMoneyInput for share count in the buy dialog.
    // Opens when a stock card is clicked.  data-money = max shares to buy.
    name: 'Stock Market / Buy Shares',
    url: '/page.php?sid=stocks',
    serial: true,
    getInput: (p) =>
      p.locator('.input-money-group input.input-money:not([type="hidden"])').first(),
    navigate: async (page) => {
      // Wait for at least one stock card to be visible
      const card = page.locator('.stock-card, [data-testid="stock-card"], .stock-item').first();
      const cardVisible = await card
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!cardVisible) return false;
      await card.click();

      // Wait for the dialog to open and LegacyMoneyInput to mount
      const group = page.locator('.input-money-group').first();
      const inputVisible = await group
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!inputVisible) return false;
    },
  },

  // ── Bookie ────────────────────────────────────────────────────────────────

  {
    // bookie — tornInputMoney on the bet amount input.  Has data-money (max bet
    // from vault balance) and data-minvalue (MIN_BET_LIMIT, typically 1000).
    // The bet form is inside .bookie-popular-wrap.
    name: 'Bookie / Bet Amount',
    url: '/page.php?sid=bookie',
    serial: true,
    getInput: (p) =>
      p.locator('.bookie-popular-wrap .input-money-group input.input-money:not([type="hidden"])')
        .first(),
    navigate: async (page) => {
      // Wait for a bookie match panel to be visible
      const betWrap = page.locator('.bookie-popular-wrap .input-money-group').first();
      const visible = await betWrap
        .waitFor({ state: 'visible', timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Hold'em ───────────────────────────────────────────────────────────────

  {
    // hold'em — BetInput (wraps LegacyMoneyInput) in the bet panel.
    // Visible during an active hand when it is the player's turn to act.
    // Returns false if no hand in progress.
    name: "Hold'em / Bet Input",
    url: '/page.php?sid=holdemData',
    serial: true,
    getInput: (p) =>
      p.locator('.input-money-group input.input-money:not([type="hidden"])').first(),
    navigate: async (page) => {
      const group = page.locator('.input-money-group').first();
      const visible = await group
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Travel Abroad Shop ────────────────────────────────────────────────────

  {
    // /page.php?sid=travel — Travelling page hosts the destination shop's
    // AmountInput (wraps LegacyMoneyInput) marked with
    // `data-testid="legacy-money-input"` for item quantities.
    // Returns false when the player is not currently travelling abroad.
    name: 'Travel Abroad Shop / Item Quantity',
    url: '/page.php?sid=travel',
    serial: true,
    traveling: true,
    sanityOnly: true,
    // The abroad-shop input is the AmountInput (wraps LegacyMoneyInput).
    // `data-testid="legacy-money-input"` is set directly on the <input>
    // element (NOT on a wrapper div) and appears on BOTH the visible text
    // input and the plugin-cloned hidden input — filter to type=text only.
    getInput: (p) =>
      p.locator('input.input-money[data-testid="legacy-money-input"]:not([type="hidden"])').first(),
    navigate: async (page) => {
      // Shop is only rendered when the player is currently abroad.
      const input = page.locator('input.input-money[data-testid="legacy-money-input"]:not([type="hidden"])').first();
      const visible = await input
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  // ── Cayman Bank (player must be currently in the Cayman Islands) ──────────
  //
  // Reached via /index.php?page=bank when the player is abroad in Cayman.
  // Two standard tornInputMoney inputs share the page, distinguished by
  // their type-class:
  //   • input.deposit.input-money  — cap = on-hand cash (msg.moneywithoutf)
  //   • input.withdraw.input-money — cap = Cayman balance (msg.inbankwithoutf)
  // Wrapper form classes are reversed by Torn's markup
  // (form.deposit-operations.first wraps WITHDRAW; .last wraps DEPOSIT) so
  // we key off the input's own class, which is unambiguous.

  {
    name: 'Cayman Bank / Deposit',
    url: '/index.php?page=bank',
    serial: true,
    traveling: true,
    getInput: (p) => p.locator('input.deposit.input-money:not([type="hidden"])').first(),
    navigate: async (page) => {
      const input = page.locator('input.deposit.input-money:not([type="hidden"])').first();
      const visible = await input
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },

  {
    name: 'Cayman Bank / Withdraw',
    url: '/index.php?page=bank',
    serial: true,
    traveling: true,
    getInput: (p) => p.locator('input.withdraw.input-money:not([type="hidden"])').first(),
    navigate: async (page) => {
      const input = page.locator('input.withdraw.input-money:not([type="hidden"])').first();
      const visible = await input
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) return false;
    },
  },
];
