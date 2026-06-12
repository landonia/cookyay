/**
 * E2E: declarative blocking + re-execution flows (PRD §3.2)
 *
 * All tests drive fixtures/blocking/all.html which exercises every blocking
 * pattern (inline script, external-src script, iframe) in one page.
 *
 * page.route() aborts all non-localhost traffic in beforeEach so no real
 * third-party requests can escape even if a test regression allows scripts
 * to execute unexpectedly (test-strategist §Rec 3, §Finding 6).
 */
import { test, expect } from '@playwright/test'

const ALL_PAGE = '/fixtures/blocking/all.html'

// Synthetic window flags set by stub scripts — not on the standard Window type
type StubWindow = Window &
  typeof globalThis & {
    __analyticsInlineRan?: boolean
    __ga4Ran?: boolean
    __pixelRan?: boolean
    __undeclaredRan?: boolean
  }

// Default-deny all external network; allow only 127.0.0.1 (the fixture server)
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    try {
      const { hostname } = new URL(route.request().url())
      if (hostname === '127.0.0.1' || hostname === 'localhost') {
        return route.continue()
      }
    } catch {
      // malformed URL — abort
    }
    return route.abort()
  })
})

// ---------------------------------------------------------------------------
// Pre-consent: everything must be blocked
// ---------------------------------------------------------------------------

test.describe('pre-consent blocking', () => {
  test('inline analytics script does not execute before consent', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    const ran = await page.evaluate(() => (window as StubWindow).__analyticsInlineRan)
    expect(ran).toBeUndefined()

    // Script node must still carry type="text/plain"
    const type = await page.locator('#blocked-inline').getAttribute('type')
    expect(type).toBe('text/plain')
  })

  test('external GA4 stub does not execute before consent', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    const ran = await page.evaluate(() => (window as StubWindow).__ga4Ran)
    expect(ran).toBeUndefined()
  })

  test('external Meta Pixel stub does not execute before consent', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    const ran = await page.evaluate(() => (window as StubWindow).__pixelRan)
    expect(ran).toBeUndefined()
  })

  test('blocked iframe has no src before consent and placeholder is injected', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // iframe must have data-src but not src — no network request fires
    const src = await page.locator('#blocked-yt').getAttribute('src')
    expect(src).toBeNull()

    const dataSrc = await page.locator('#blocked-yt').getAttribute('data-src')
    expect(dataSrc).toBeTruthy()

    // iframe is hidden; a sibling placeholder div is present (blocking.ts _buildPlaceholder)
    await expect(page.locator('#blocked-yt')).toHaveCSS('display', 'none')
    await expect(page.locator('[data-cookyay-placeholder]')).toBeVisible()
  })

  test('undeclared-category script stays blocked even when other categories are granted', async ({
    page,
  }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-accept]')

    // Give all scripts time to run
    await expect(page.locator('#inline-status')).toContainText('executed ✓')

    // Undeclared ("advertising") must never run
    const ran = await page.evaluate(() => (window as StubWindow).__undeclaredRan)
    expect(ran).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Accept all
// ---------------------------------------------------------------------------

test.describe('accept-all', () => {
  test('executes inline analytics script', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-accept]')

    await expect(page.locator('#inline-status')).toContainText('executed ✓')
    const ran = await page.evaluate(() => (window as StubWindow).__analyticsInlineRan)
    expect(ran).toBe(true)
  })

  test('executes external GA4 stub', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-accept]')

    await expect(page.locator('#ga4-status')).toContainText('executed ✓')
    const ran = await page.evaluate(() => (window as StubWindow).__ga4Ran)
    expect(ran).toBe(true)
  })

  test('executes external Meta Pixel stub', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-accept]')

    await expect(page.locator('#pixel-status')).toContainText('executed ✓')
    const ran = await page.evaluate(() => (window as StubWindow).__pixelRan)
    expect(ran).toBe(true)
  })

  test('swaps iframe placeholder and sets src', async ({ page }) => {
    await page.goto(ALL_PAGE)

    // Pre-consent: placeholder present, iframe hidden
    await expect(page.locator('[data-cookyay-placeholder]')).toBeVisible()
    await expect(page.locator('#blocked-yt')).toHaveCSS('display', 'none')

    await page.click('[data-cookyay-accept]')

    await expect(page.locator('#iframe-status')).toContainText('loaded ✓')

    // Post-grant: placeholder removed, iframe visible with src set
    await expect(page.locator('[data-cookyay-placeholder]')).not.toBeAttached()
    await expect(page.locator('#blocked-yt')).toBeVisible()
    const src = await page.locator('#blocked-yt').getAttribute('src')
    expect(src).toContain('/fixtures/stubs/ytplayer.html')
  })

  test('banner is dismissed after accept', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-accept]')
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Reject all
// ---------------------------------------------------------------------------

test.describe('reject-all', () => {
  test('all scripts remain inert after reject', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-reject]')

    // Banner gone — consent recorded
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    // Give blocking engine's setTimeout(0) queue time to drain (nothing scheduled)
    await page.waitForTimeout(100)

    expect(await page.evaluate(() => (window as StubWindow).__analyticsInlineRan)).toBeUndefined()
    expect(await page.evaluate(() => (window as StubWindow).__ga4Ran)).toBeUndefined()
    expect(await page.evaluate(() => (window as StubWindow).__pixelRan)).toBeUndefined()
  })

  test('iframe has no src after reject', async ({ page }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-reject]')

    await expect(page.locator('#cookyay-banner')).not.toBeVisible()
    await page.waitForTimeout(100)

    const src = await page.locator('#blocked-yt').getAttribute('src')
    expect(src).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Granular consent
// ---------------------------------------------------------------------------

test.describe('granular consent', () => {
  test('analytics grant executes only analytics scripts; marketing stays blocked', async ({
    page,
  }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-manage]')

    // Modal open — analytics and marketing are both off for first visit
    const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'false')

    await analyticsSwitch.click()
    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')

    // Marketing stays off
    const marketingSwitch = page.locator('[data-cookyay-switch="marketing"]')
    await expect(marketingSwitch).toHaveAttribute('aria-checked', 'false')

    await page.click('[data-cookyay-save]')

    // Analytics scripts execute
    await expect(page.locator('#inline-status')).toContainText('executed ✓')
    await expect(page.locator('#ga4-status')).toContainText('executed ✓')

    // Marketing scripts stay blocked
    const pixelRan = await page.evaluate(() => (window as StubWindow).__pixelRan)
    expect(pixelRan).toBeUndefined()

    const iframeSrc = await page.locator('#blocked-yt').getAttribute('src')
    expect(iframeSrc).toBeNull()
  })

  test('marketing grant executes only marketing scripts; analytics stays blocked', async ({
    page,
  }) => {
    await page.goto(ALL_PAGE)
    await page.click('[data-cookyay-manage]')

    const marketingSwitch = page.locator('[data-cookyay-switch="marketing"]')
    await expect(marketingSwitch).toHaveAttribute('aria-checked', 'false')
    await marketingSwitch.click()
    await expect(marketingSwitch).toHaveAttribute('aria-checked', 'true')

    // Analytics stays off
    const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'false')

    await page.click('[data-cookyay-save]')

    // Marketing scripts execute
    await expect(page.locator('#pixel-status')).toContainText('executed ✓')
    await expect(page.locator('#iframe-status')).toContainText('loaded ✓')

    // Analytics stays blocked
    const analyticsRan = await page.evaluate(() => (window as StubWindow).__analyticsInlineRan)
    expect(analyticsRan).toBeUndefined()

    const ga4Ran = await page.evaluate(() => (window as StubWindow).__ga4Ran)
    expect(ga4Ran).toBeUndefined()
  })
})
