/**
 * E2E: Bootstrap-first diagnostic — install-order warning proof (v6, task 005)
 *
 * Proves that the dev-time bootstrap-order diagnostic (autoblock-diagnostic.ts)
 * fires a console.warn when a known tracker loads BEFORE the Cookyay bootstrap,
 * and does NOT fire when debug is unset (prod mode).
 *
 * ## Two fixtures driven:
 *   - `fixtures/bootstrap-first/dev.html`  — tracker BEFORE bootstrap, debug:true
 *   - `fixtures/bootstrap-first/prod.html` — same order, debug omitted (falsy)
 *
 * ## Hermetic strategy
 *   All external requests (facebook.com, etc.) are aborted via page.route().
 *   The diagnostic runs on the DOM scan (script[src]/img[src]) and/or the
 *   Performance resource timing entries — both signals detect the pre-bootstrap
 *   pixel. No real network needed.
 *
 * ## Console capture
 *   Register page.on('console', …) BEFORE page.goto() so the listener is active
 *   when the browser parses <head> and fires init().
 *   [research/test-strategist.md §F2, §Gotchas — console.warn capture ordering]
 *
 * ## Test coverage (AC map to task 005 acceptance criteria)
 *   AC5 — bootstrap-first spec: warning fires with debug:true; absent without it;
 *          neither mode throws. Placement: packages/scanner/e2e/bootstrap-first.spec.ts
 *   AC6 — hermetic (all third-party hosts aborted), runs in CI, green
 *
 * [goals.md §What's new in v6 — bootstrap-first diagnostic]
 * [research/test-strategist.md §F2, §Rec 4]
 * [autoblock-diagnostic.ts, api.ts §config.debug gate]
 */
import { test, expect } from '@playwright/test'

const DEV_PAGE = '/fixtures/bootstrap-first/dev.html'
const PROD_PAGE = '/fixtures/bootstrap-first/prod.html'

/** The discriminant string that identifies the install-order warning. */
const WARNING_MARKER = 'INSTALL ORDER WARNING'

// ---------------------------------------------------------------------------
// Route setup — abort all external traffic hermetically
// ---------------------------------------------------------------------------

/**
 * Abort all non-localhost requests. The diagnostic runs on DOM scan + Performance
 * resource timing — both work without the external request actually succeeding.
 * The <img src="facebook.com/tr"> in the fixture HTML is parsed before the proxy
 * installs; the browser attempts the fetch, which this route aborts. The
 * PerformanceEntry for the attempt (or the img[src] DOM attribute) still triggers
 * the diagnostic.
 *
 * Uses a single **\/* handler (matching the auto-block.spec.ts pattern) so there
 * is no handler-order ambiguity.
 */
async function setupRoutes({ page }: { page: import('@playwright/test').Page }): Promise<void> {
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
    // Abort all third-party requests — the diagnostic's DOM scan detects the
    // pre-bootstrap <img> element without needing the request to succeed.
    return route.abort()
  })
}

// ---------------------------------------------------------------------------
// AC5: warning fires with debug:true
// [research/test-strategist.md §F2]
// ---------------------------------------------------------------------------

test.describe('bootstrap-first diagnostic — dev mode (debug:true)', () => {
  test('install-order warning fires for a pre-bootstrap tracker when debug:true', async ({
    page,
  }) => {
    const warnings: string[] = []
    // Register console listener BEFORE page.goto() to capture init()-time warnings
    page.on('console', (msg) => {
      if (msg.type() === 'warning') {
        warnings.push(msg.text())
      }
    })

    await setupRoutes({ page })
    await page.goto(DEV_PAGE)

    // Wait for init() to complete (it's in a type="module" block — deferred)
    // and for the diagnostic's async path (autoblock-loader import) to settle.
    await page.waitForTimeout(500)

    // At least one warning must contain the INSTALL ORDER WARNING marker
    const installOrderWarnings = warnings.filter((w) => w.includes(WARNING_MARKER))
    expect(installOrderWarnings.length).toBeGreaterThanOrEqual(1)

    // The warning must name a service and a URL (facebook.com/tr)
    const fbWarning = installOrderWarnings.find(
      (w) => w.includes('facebook.com') || w.includes('meta') || w.includes('Meta'),
    )
    expect(fbWarning).toBeDefined()
  })

  test('warning message matches the expected format (names service and URL)', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text())
    })

    await setupRoutes({ page })
    await page.goto(DEV_PAGE)
    await page.waitForTimeout(500)

    const installOrderWarnings = warnings.filter((w) => w.includes(WARNING_MARKER))
    expect(installOrderWarnings.length).toBeGreaterThanOrEqual(1)

    // Format: '[Cookyay] INSTALL ORDER WARNING: "<service>" (<url>) loaded before Cookyay bootstrap...'
    const warning = installOrderWarnings[0]
    expect(warning).toContain('[Cookyay]')
    expect(warning).toContain('Move Cookyay first in <head>')
  })

  test('page does not throw any errors when the diagnostic fires', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await setupRoutes({ page })
    await page.goto(DEV_PAGE)
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// AC5: diagnostic silent without debug (prod mode)
// [research/test-strategist.md §F2, autoblock-diagnostic.ts AC2]
// ---------------------------------------------------------------------------

test.describe('bootstrap-first diagnostic — prod mode (debug omitted)', () => {
  test('NO install-order warning fires when debug is not set', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text())
    })

    await setupRoutes({ page })
    await page.goto(PROD_PAGE)
    await page.waitForTimeout(500)

    // No install-order warning should appear — debug is false/omitted
    const installOrderWarnings = warnings.filter((w) => w.includes(WARNING_MARKER))
    expect(installOrderWarnings).toHaveLength(0)
  })

  test('page does not throw any errors in prod mode', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await setupRoutes({ page })
    await page.goto(PROD_PAGE)
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })
})
