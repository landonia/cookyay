/**
 * E2E: runtime auto-block fixture + spec (v5, task 006)
 *
 * Proves that, with autoBlock:true and NO hand-declared data-category rules,
 * the banner intercepts known third-party scripts/iframes, holds them until
 * the matching consent category is granted, then releases them — using the
 * same blocking.ts grant/inject engine as the declarative path.
 *
 * Test placement rationale: Playwright e2e in packages/scanner/e2e/ (same
 * location as blocking.spec.ts) rather than Vitest browser-mode because the
 * suite needs page.route() control over third-party hostname requests AND real
 * script execution assertions — Vitest browser-mode lacks route interception.
 * [research/test-strategist.md §F3, §Rec 3, §Open question 3]
 *
 * Hermeticity strategy:
 *   1. page.route() default-deny: all non-localhost requests are aborted.
 *   2. For known-service stubs that need to execute on grant, page.route()
 *      fulfills the third-party host with local JS/HTML stub content so window
 *      flags can be asserted.
 *   3. Google-owned hosts (googletagmanager.com) are aborted — the important
 *      assertion is that data-cookyay-auto is absent, not that the script ran.
 *
 * [goals.md §Acceptance bar, prd.md §5, research/test-strategist.md §F3, §F4, §Gotchas]
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..')

const AUTO_BLOCK_PAGE = '/fixtures/auto-block/all.html'

// Synthetic window flags set by stub scripts
type StubWindow = Window &
  typeof globalThis & {
    __hotjarRan?: boolean
    __pixelAutoRan?: boolean
    __gtmRan?: boolean
    __sameOriginRan?: boolean
    __coexistCount?: number
    __ytEmbedLoaded?: boolean
  }

// ---------------------------------------------------------------------------
// Stub content (served from local files when third-party hosts are requested)
// ---------------------------------------------------------------------------

/**
 * Read a local stub file as a string for use in page.route() fulfillment.
 * Called once per test (not at module load time) so fixture server startup
 * timing does not matter.
 */
function readStub(filename: string): string {
  return readFileSync(join(WORKSPACE_ROOT, 'fixtures', 'stubs', filename), 'utf8')
}

// ---------------------------------------------------------------------------
// Route setup helpers
// ---------------------------------------------------------------------------

/**
 * Set up hermetic routing for the auto-block fixture page.
 *
 * Rules (applied in order):
 *   1. 127.0.0.1 / localhost → continue (fixture server)
 *   2. static.hotjar.com → fulfill with hotjar.js stub
 *   3. connect.facebook.net → fulfill with a pixel stub that sets __pixelAutoRan
 *   4. www.youtube.com (embed) → fulfill with yt-embed.html stub
 *   5. Everything else → abort (safety net for external requests)
 *
 * [research/test-strategist.md §Gotchas — page.route() abort is the last line of defence]
 */
async function setupRoutes({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  // Hotjar analytics stub
  const hotjarStub = readStub('hotjar.js')
  // Meta Pixel marketing stub (sets __pixelAutoRan — different from declared __pixelRan)
  const pixelAutoStub = [
    ';(function(){',
    '  window.__pixelAutoRan = true;',
    '})();',
  ].join('\n')
  // YouTube embed stub (HTML)
  const ytStub = readStub('yt-embed.html')
  // Same-origin script: served by fixture server, no route needed

  await page.route('**/*', (route) => {
    const url = route.request().url()
    let hostname: string
    try {
      hostname = new URL(url).hostname
    } catch {
      return route.abort()
    }

    // Allow fixture server
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return route.continue()
    }

    // Fulfill known-service stubs so window flags can be set on grant
    if (hostname === 'static.hotjar.com' || hostname.endsWith('.hotjar.com')) {
      // Differentiate the coexist script from the main Hotjar stub
      const pathname = new URL(url).pathname
      if (pathname.includes('hotjar-coexist')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: ';(function(){ window.__coexistCount = (window.__coexistCount || 0) + 1; })();',
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: hotjarStub,
      })
    }

    if (hostname === 'connect.facebook.net') {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: pixelAutoStub,
      })
    }

    if (hostname === 'www.youtube.com' || hostname === 'youtube.com') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: ytStub,
      })
    }

    // Abort everything else (Google hosts, other external traffic)
    return route.abort()
  })
}

// ---------------------------------------------------------------------------
// AC1 + AC2: pre-consent blocking and post-grant execution
// ---------------------------------------------------------------------------

test.describe('pre-consent: auto-detected scripts/iframes are held', () => {
  test.beforeEach(setupRoutes)

  test('auto-detected Hotjar analytics script is held before consent (flag absent)', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    const ran = await page.evaluate(() => (window as StubWindow).__hotjarRan)
    expect(ran).toBeUndefined()

    // Element must carry data-cookyay-auto="true" (proxy held it)
    const autoAttr = await page.locator('#autoblock-hotjar').getAttribute('data-cookyay-auto')
    expect(autoAttr).toBe('true')

    // Element must carry data-cookyay-state="blocked"
    const stateAttr = await page.locator('#autoblock-hotjar').getAttribute('data-cookyay-state')
    expect(stateAttr).toBe('blocked')
  })

  test('auto-detected Meta Pixel marketing script is held before consent (flag absent)', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    const ran = await page.evaluate(() => (window as StubWindow).__pixelAutoRan)
    expect(ran).toBeUndefined()

    const autoAttr = await page.locator('#autoblock-pixel').getAttribute('data-cookyay-auto')
    expect(autoAttr).toBe('true')
  })

  test('auto-detected YouTube marketing iframe is held before consent (src absent)', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // iframe must have no src — the proxy intercepted it before the browser fetched it
    const src = await page.locator('#autoblock-yt').getAttribute('src')
    expect(src).toBeNull()

    // data-cookyay-auto must be set (held by proxy)
    const autoAttr = await page.locator('#autoblock-yt').getAttribute('data-cookyay-auto')
    expect(autoAttr).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// AC1: post-grant execution (full lifecycle: held → grant → executes)
// ---------------------------------------------------------------------------

test.describe('post-grant: auto-detected elements execute after category grant', () => {
  test.beforeEach(setupRoutes)

  test('granting analytics releases held Hotjar script and it executes', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Pre-consent: not executed
    expect(await page.evaluate(() => (window as StubWindow).__hotjarRan)).toBeUndefined()

    // Grant analytics via accept (also grants marketing — but we check both flags)
    await page.click('[data-cookyay-accept]')

    // Banner dismissed
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    // Hotjar stub executes (route fulfilled with stub JS)
    await expect(page.locator('#hotjar-status')).toContainText('executed ✓', { timeout: 3000 })
    expect(await page.evaluate(() => (window as StubWindow).__hotjarRan)).toBe(true)

    // data-cookyay-state on the original must be "executed" after injection.
    // The clone also shares the same id — select the original via data-cookyay-auto.
    const stateAttr = await page
      .locator('#autoblock-hotjar[data-cookyay-auto="true"]')
      .getAttribute('data-cookyay-state')
    expect(stateAttr).toBe('executed')
  })

  test('granting marketing releases held Meta Pixel script and it executes', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    expect(await page.evaluate(() => (window as StubWindow).__pixelAutoRan)).toBeUndefined()

    await page.click('[data-cookyay-accept]')
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    await expect(page.locator('#pixel-status')).toContainText('executed ✓', { timeout: 3000 })
    expect(await page.evaluate(() => (window as StubWindow).__pixelAutoRan)).toBe(true)
  })

  test('granting marketing promotes iframe src (YouTube embed becomes visible)', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Pre-consent: no src
    expect(await page.locator('#autoblock-yt').getAttribute('src')).toBeNull()

    await page.click('[data-cookyay-accept]')
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    // Post-grant: src is promoted to the YouTube URL
    await expect(page.locator('#yt-status')).toContainText('src promoted ✓', { timeout: 3000 })
    const src = await page.locator('#autoblock-yt').getAttribute('src')
    expect(src).toContain('youtube.com/embed/')
  })

  test('granular analytics grant executes only analytics scripts; marketing stays held', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Open preferences modal and grant only analytics
    await page.click('[data-cookyay-manage]')

    const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'false')
    await analyticsSwitch.click()
    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')

    // Marketing stays off
    const marketingSwitch = page.locator('[data-cookyay-switch="marketing"]')
    await expect(marketingSwitch).toHaveAttribute('aria-checked', 'false')

    await page.click('[data-cookyay-save]')

    // Analytics (Hotjar) executes
    await expect(page.locator('#hotjar-status')).toContainText('executed ✓', { timeout: 3000 })
    expect(await page.evaluate(() => (window as StubWindow).__hotjarRan)).toBe(true)

    // Marketing scripts remain held
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => (window as StubWindow).__pixelAutoRan)).toBeUndefined()
    expect(await page.locator('#autoblock-yt').getAttribute('src')).toBeNull()
  })

  test('reject-all keeps all auto-detected scripts held', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    await page.click('[data-cookyay-reject]')
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    // Allow the setTimeout(fn,0) queue to drain — nothing should execute
    await page.waitForTimeout(150)

    expect(await page.evaluate(() => (window as StubWindow).__hotjarRan)).toBeUndefined()
    expect(await page.evaluate(() => (window as StubWindow).__pixelAutoRan)).toBeUndefined()
    expect(await page.locator('#autoblock-yt').getAttribute('src')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC3: coexistence — declared wins, no double-execution
// ---------------------------------------------------------------------------

test.describe('coexistence: declared element + DB-matchable URL handled exactly once', () => {
  test.beforeEach(setupRoutes)

  test('declared data-category wins over auto-block; script executes exactly once after grant', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // The coexist script has type="text/plain" data-category="analytics" — declarative engine owns it
    // data-cookyay-auto must NOT be set (proxy skipped it — declared wins)
    const autoAttr = await page.locator('#autoblock-coexist').getAttribute('data-cookyay-auto')
    expect(autoAttr).toBeNull()

    // It must be registered by scanBlocked (data-cookyay-state="blocked", not via auto-block)
    const stateAttr = await page.locator('#autoblock-coexist').getAttribute('data-cookyay-state')
    expect(stateAttr).toBe('blocked')

    // Grant analytics
    await page.click('[data-cookyay-manage]')
    const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
    await analyticsSwitch.click()
    await page.click('[data-cookyay-save]')

    // Coexist script executes exactly once (counter=1)
    await expect(page.locator('#coexist-status')).toContainText('count=1 ✓', { timeout: 3000 })

    // Verify via window.__coexistCount
    const count = await page.evaluate(() => (window as StubWindow).__coexistCount ?? 0)
    expect(count).toBe(1)

    // Confirm state is "executed" on the original (not stuck on "blocked").
    // The clone also shares the same id — select the original via type="text/plain".
    const finalState = await page
      .locator('#autoblock-coexist[type="text/plain"]')
      .getAttribute('data-cookyay-state')
    expect(finalState).toBe('executed')
  })
})

// ---------------------------------------------------------------------------
// AC4: negative cases — Google host skipped, same-origin passes through
// ---------------------------------------------------------------------------

test.describe('negative cases: Google host and same-origin scripts are not held', () => {
  test.beforeEach(setupRoutes)

  test('Google GTM host is NOT auto-blocked (data-cookyay-auto absent)', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Wait for the proxy to process all staged elements
    await page.waitForTimeout(300)

    // GTM element must NOT carry data-cookyay-auto (proxy skipped it — Google skip)
    const autoAttr = await page.locator('#autoblock-gtm').getAttribute('data-cookyay-auto')
    expect(autoAttr).toBeNull()

    // data-cookyay-state must NOT be "blocked" from auto-block
    const stateAttr = await page.locator('#autoblock-gtm').getAttribute('data-cookyay-state')
    expect(stateAttr).not.toBe('blocked')

    // The GTM status box should confirm absent auto attr
    await expect(page.locator('#gtm-status')).toContainText('absent = correct', { timeout: 2000 })
  })

  test('same-origin/first-party script is not held and executes immediately', async ({ page }) => {
    await page.goto(AUTO_BLOCK_PAGE)

    // Same-origin script runs immediately — no consent required
    await expect(page.locator('#same-origin-status')).toContainText('executed ✓', { timeout: 2000 })
    expect(await page.evaluate(() => (window as StubWindow).__sameOriginRan)).toBe(true)

    // No auto-block attributes on the same-origin script element
    const autoAttr = await page.locator('#autoblock-same-origin').getAttribute('data-cookyay-auto')
    expect(autoAttr).toBeNull()
  })
})
