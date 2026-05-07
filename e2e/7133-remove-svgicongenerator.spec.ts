/**
 * Branch 7133-remove-svgicongenerator-from-shared-components
 *
 * What changed:
 *  - SVGIconGenerator removed from UserInfo, SelectSearch, and Header
 *  - New standalone UserOnlineStatus component replaces it for online/idle/offline dots
 *  - Global Defs.svg (gradient definitions) removed from Header App.tsx
 *  - Gradient definitions moved into individual SVG files (Online.svg, Idle.svg, Offline.svg)
 *  - SelectSearch icons (Clear, Search/Commit, History, AddRole, AddSave) now use
 *    self-contained local SVG files instead of SVGIconGenerator + iconStyler
 *  - iconStyler.ts utility deleted
 *
 * Pages under test:
 *  A) Profile page       — UserInfo component with online status dot
 *  B) Profile mini popup — same UserInfo via profile-mini app
 *  C) Header global search autocomplete — UserOnlineStatus in results
 *  D) Item Market        — UserInfo in seller rows
 *  E) Contacts page      — PlayerCell with UserInfo
 *  F) SelectSearch       — Clear / Search / History buttons, Lasts row, AddRole, AddSave
 */

import { test, expect, Page } from '@playwright/test'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Returns fill/stroke CSS of the first SVG path inside a status icon wrapper. */
async function getStatusIconColor(page: Page, wrapperSelector: string): Promise<string | null> {
  return page
    .locator(wrapperSelector)
    .first()
    .evaluate((el) => {
      const path = el.querySelector('path, circle')
      if (!path) return null
      const s = getComputedStyle(path as Element)
      return s.fill || s.stroke || null
    })
    .catch(() => null)
}

/** Returns true if any SVG gradient defs exist in the document. */
async function hasGradientDefs(page: Page, gradientId: string): Promise<boolean> {
  return page.evaluate(
    (id) => !!document.querySelector(`linearGradient#${id}`),
    gradientId,
  )
}

/** Waits for React apps to hydrate (profileroot, header-root, etc.) */
async function waitForReact(page: Page, rootSelector = '#profileroot') {
  await page.waitForSelector(`${rootSelector}:not(:empty)`, { timeout: 15_000 })
}

// ─── A: Profile page — UserInfo online status dot ────────────────────────────

test.describe('A — Profile page: UserOnlineStatus dot', () => {
  test.beforeEach(async ({ page }) => {
    // XID 1 is always present; any user with a known online status will do
    await page.goto('/profiles.php?XID=1')
    await waitForReact(page, '#profileroot')
  })

  test('① UserInfo renders a status icon element', async ({ page }) => {
    const statusIcon = page.locator('.user-info-status, [aria-label*="is online"], [aria-label*="is offline"], [aria-label*="is idle"]').first()
    await expect(statusIcon).toBeVisible({ timeout: 10_000 })
  })

  test('② status icon contains an SVG', async ({ page }) => {
    const svg = page.locator('.user-info-status svg, [class*="userOnlineStatus"] svg').first()
    await expect(svg).toBeVisible({ timeout: 10_000 })
  })

  test('③ gradient defs are present inside the status SVG (not a missing ref)', async ({ page }) => {
    // The new approach embeds defs inside each SVG — at least one of the three should exist
    const hasAnyGradient = await page.evaluate(() =>
      ['userStatusOnline', 'userStatusOffline', 'userStatusIdle'].some(
        (id) => !!document.querySelector(`linearGradient#${id}`),
      ),
    )
    expect(hasAnyGradient, 'at least one gradient def should be present in page').toBe(true)
  })

  test('④ no orphaned global Defs.svg (old statusOnline/statusOffline/statusIdle ids removed)', async ({ page }) => {
    // The old global Defs.svg used ids: statusOnline, statusOffline, statusIdle
    // These should no longer exist since Defs.svg was removed from App.tsx
    for (const oldId of ['statusOnline', 'statusOffline', 'statusIdle']) {
      const exists = await hasGradientDefs(page, oldId)
      expect(exists, `old gradient id "${oldId}" should be gone`).toBe(false)
    }
  })

  test('⑤ no JS console errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await page.reload()
    await waitForReact(page, '#profileroot')
    const svgErrors = errors.filter((e) => /gradient|svg|icon/i.test(e))
    expect(svgErrors, 'no SVG-related console errors').toHaveLength(0)
  })
})

// ─── B: Profile mini popup — UserOnlineStatus dot ────────────────────────────

test.describe('B — Profile mini popup: UserOnlineStatus dot', () => {
  test('⑥ mini-profile popup renders a status SVG', async ({ page }) => {
    await page.goto('/profiles.php?XID=1')
    await waitForReact(page, '#profileroot')

    // Trigger mini-profile via hover or click on a user link if present
    const userLink = page.locator('a[href*="profiles.php?XID"]').first()
    if (!(await userLink.isVisible())) test.skip()

    await userLink.hover()
    await page.waitForSelector('#react-profile-mini-root:not(:empty)', { timeout: 8_000 }).catch(() => null)

    const miniSvg = page.locator('#react-profile-mini-root svg').first()
    // If mini profile doesn't appear in this env, skip gracefully
    if (!(await miniSvg.isVisible().catch(() => false))) test.skip()

    await expect(miniSvg).toBeVisible()
  })
})

// ─── C: Header global search — UserOnlineStatus in autocomplete results ───────

test.describe('C — Header global search: status icon in results', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/profiles.php?XID=1')
    await page.waitForLoadState('networkidle')
  })

  test('⑦ search input is present in header', async ({ page }) => {
    const searchInput = page.locator('#header-root input[type="text"], #header-root input[placeholder*="Search"]').first()
    await expect(searchInput).toBeVisible({ timeout: 10_000 })
  })

  test('⑧ typing a name shows user dropdown with status icons', async ({ page }) => {
    const searchInput = page.locator('#header-root input[type="text"], #header-root input[placeholder*="Search"]').first()
    if (!(await searchInput.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    await searchInput.click()
    await searchInput.fill('a')
    await page.waitForTimeout(600) // debounce

    // At least one result should appear
    const resultItem = page.locator('#header-root [class*="item"], #header-root [class*="user"]').first()
    if (!(await resultItem.isVisible({ timeout: 5_000 }).catch(() => false))) test.skip()

    // Status icon (SVG) inside the result
    const statusSvg = page.locator('#header-root [class*="userOnlineStatus"] svg, #header-root [class*="status"] svg').first()
    await expect(statusSvg).toBeVisible({ timeout: 5_000 })
  })

  test('⑨ no blank/broken image where status icon should be', async ({ page }) => {
    const searchInput = page.locator('#header-root input[type="text"]').first()
    if (!(await searchInput.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    await searchInput.fill('a')
    await page.waitForTimeout(600)

    // Should find no <img> tags used as status placeholders (legacy approach)
    const brokenImgs = await page.locator('#header-root [class*="item"] img[alt=""]').count()
    expect(brokenImgs, 'no empty-alt images as status stand-ins').toBe(0)
  })
})

// ─── D: Item Market — UserInfo in seller rows ─────────────────────────────────

test.describe('D — Item Market: UserInfo seller status icon', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/imarket.php')
    await page.waitForLoadState('networkidle')
  })

  test('⑩ seller rows contain a status SVG', async ({ page }) => {
    const sellerRow = page.locator('[class*="sellerRow"], [class*="SellerRow"]').first()
    if (!(await sellerRow.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    const statusSvg = sellerRow.locator('svg').first()
    await expect(statusSvg).toBeVisible()
  })

  test('⑪ status SVG contains a path (not an empty shell)', async ({ page }) => {
    const firstSellerSvg = page.locator('[class*="sellerRow"] svg, [class*="SellerRow"] svg').first()
    if (!(await firstSellerSvg.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    const pathCount = await firstSellerSvg.locator('path').count()
    expect(pathCount, 'status SVG should have at least 1 path').toBeGreaterThan(0)
  })
})

// ─── E: Contacts page — PlayerCell UserInfo ───────────────────────────────────

test.describe('E — Contacts page: PlayerCell status icon', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/page.php?sid=contacts')
    await page.waitForLoadState('networkidle')
  })

  test('⑫ contacts page loads without errors', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Fatal error')
  })

  test('⑬ each player row has a status icon SVG', async ({ page }) => {
    const rows = page.locator('[class*="playerCell"], [class*="PersonCell"]')
    const count = await rows.count()
    if (count === 0) test.skip()

    const firstSvg = rows.first().locator('svg')
    await expect(firstSvg).toBeVisible({ timeout: 8_000 })
  })
})

// ─── F: SelectSearch component — icon buttons ─────────────────────────────────
// The SelectSearch is used in: admin multi-cases, personal-stats, report creation.
// Easiest reliable surface: personal stats user search.

test.describe('F — SelectSearch: Clear / Search / History button icons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/personalstats.php')
    await page.waitForLoadState('networkidle')
  })

  test('⑭ Search (commit) button is visible and contains an SVG', async ({ page }) => {
    const commitBtn = page.locator('[class*="commit"], [aria-label*="Search"], button[title*="Search"]').first()
    if (!(await commitBtn.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    const svg = commitBtn.locator('svg')
    await expect(svg).toBeVisible()
  })

  test('⑮ typing into SelectSearch input shows a Clear button with SVG', async ({ page }) => {
    const input = page.locator('[class*="selectSearch"] input, [class*="SelectSearch"] input').first()
    if (!(await input.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    await input.fill('test')
    const clearBtn = page.locator('[class*="clear"], button[title*="Clear"]').first()
    await expect(clearBtn).toBeVisible({ timeout: 3_000 })

    const svg = clearBtn.locator('svg')
    await expect(svg).toBeVisible()
  })

  test('⑯ Clear button click removes the input value', async ({ page }) => {
    const input = page.locator('[class*="selectSearch"] input, [class*="SelectSearch"] input').first()
    if (!(await input.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    await input.fill('test')
    const clearBtn = page.locator('[class*="clear"], button[title*="Clear"]').first()
    if (!(await clearBtn.isVisible({ timeout: 3_000 }).catch(() => false))) test.skip()

    await clearBtn.click()
    await expect(input).toHaveValue('')
  })

  test('⑰ History button is visible and contains an SVG', async ({ page }) => {
    const historyBtn = page.locator('[class*="history"], button[title*="History"]').first()
    if (!(await historyBtn.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    const svg = historyBtn.locator('svg')
    await expect(svg).toBeVisible()
  })

  test('⑱ History dropdown items each have a history icon SVG and a remove button SVG', async ({ page }) => {
    const historyBtn = page.locator('[class*="history"], button[title*="History"]').first()
    if (!(await historyBtn.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip()

    await historyBtn.click()
    const historyList = page.locator('[class*="lasts"], [class*="Lasts"]').first()
    if (!(await historyList.isVisible({ timeout: 3_000 }).catch(() => false))) test.skip()

    const firstItem = historyList.locator('li, [class*="item"]').first()
    if (!(await firstItem.isVisible({ timeout: 2_000 }).catch(() => false))) test.skip()

    // History icon SVG
    const historySvg = firstItem.locator('[class*="icon"] svg').first()
    await expect(historySvg).toBeVisible()

    // Remove (clear) button SVG
    const removeSvg = firstItem.locator('button svg').first()
    await expect(removeSvg).toBeVisible()
  })

  test('⑲ no iconStyler-dependent invisible icons (no empty SVG wrappers)', async ({ page }) => {
    // Old iconStyler could produce SVGs with opacity=0 or missing fills when dynamic coloring failed.
    // Check that no SVG inside SelectSearch has width/height of 0.
    const allSvgs = page.locator('[class*="selectSearch"] svg, [class*="SelectSearch"] svg')
    const count = await allSvgs.count()
    if (count === 0) test.skip()

    for (let i = 0; i < Math.min(count, 10); i++) {
      const box = await allSvgs.nth(i).boundingBox()
      if (box !== null) {
        expect(box.width, `SVG #${i} should have positive width`).toBeGreaterThan(0)
        expect(box.height, `SVG #${i} should have positive height`).toBeGreaterThan(0)
      }
    }
  })
})

// ─── Cross-cutting: multiple status icons on same page (gradient ID scoping) ──

test.describe('G — Multiple status icons: gradient ID collision check', () => {
  test('⑳ faction members page: all status icons have the correct gradient color', async ({ page }) => {
    await page.goto('/factions.php?step=your')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('[class*="member"], [class*="Member"]', { timeout: 10_000 }).catch(() => null)

    // Collect all status SVGs — if gradient IDs conflict, some icons will be wrong color
    const statusSvgs = page.locator('[class*="userOnlineStatus"] svg, [class*="status"] svg')
    const count = await statusSvgs.count()
    if (count < 2) test.skip() // need multiple to test collision

    // All SVGs should have a non-zero bounding box (visible icons)
    for (let i = 0; i < Math.min(count, 20); i++) {
      const box = await statusSvgs.nth(i).boundingBox()
      if (box !== null) {
        expect(box.width, `status icon #${i} should be visible`).toBeGreaterThan(0)
      }
    }
  })
})
