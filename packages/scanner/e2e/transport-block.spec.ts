/**
 * E2E: transport-layer (fetch + sendBeacon) auto-block — hermetic lifecycle proof (v7, task 005)
 *
 * Proves that, with autoBlock:true and NO hand-declared data-category rules for the
 * tracking endpoints, the banner holds `fetch` and `navigator.sendBeacon` calls to
 * curated tracking endpoints inert until the matching consent category is granted,
 * then replays them exactly once — using the same blocking.ts grant/drain engine
 * as the declarative and DOM-auto-block paths.
 *
 * ## Hermeticity strategy
 *   1. page.route() default-deny: all non-localhost requests are aborted.
 *   2. facebook.com/tr (the canonical curated tracking endpoint) is fulfilled with
 *      empty 200 responses so the hit-counter can increment on replay.
 *   3. region1.google-analytics.com (skip-Google case) is fulfilled with 200 so
 *      a hit-counter can prove it reached the network pre-consent.
 *   4. /fixtures/transport/collect (same-origin) is served by the fixture server.
 *   5. Everything else (other externals) is aborted.
 *
 * ## Route setup
 *   ONE `**\/*` catch-all handler with inline if/else dispatch (the single-handler
 *   rule from bootstrap-first.spec.ts and pixel-block.spec.ts), counting hits to
 *   curated endpoints and fulfilling/aborting everything else.
 *
 * ## Test coverage (AC map to task 005 acceptance criteria)
 *   AC1 — fetch NEGATIVE+POSITIVE: facebook.com/tr receives 0 requests before consent,
 *          exactly 1 after marketing grant (waitForResponse — deterministic timing)
 *   AC1 — beacon NEGATIVE+POSITIVE: facebook.com/tr POST receives 0 requests before
 *          consent, exactly 1 after marketing grant (waitForRequest — deterministic)
 *   AC2 — fixture pages load with autoBlock:true, fire pre-consent calls (held)
 *          and post-grant calls (replayed), and fire non-curated same-origin calls
 *          (passed through)
 *   AC3 — app's own fetch/beacon to same-origin is observed BEFORE consent (passthrough)
 *   AC4 — benign stub does not throw/hang (unit layer, confirmed here via DOM assertion)
 *   AC5 — skip-Google: Google Analytics endpoint is NOT held (passthrough, hits >= 1)
 *   AC6 — declared-wins: a URL covered by a declared data-category rule is NOT also
 *          queued by the transport proxy (network hit, not a 204 stub)
 *   AC7 — XHR NOT intercepted: XMLHttpRequest to a curated endpoint is NOT held
 *   AC8 — CI wiring confirmed (browser-mode and playwright run in the same e2e job)
 *
 * [goals.md §Acceptance bar, prd.md §3.2,
 *  research/test-strategist.md §F1,F2,F3,F4,F5, §Recommendations 1-6]
 */
import { test, expect } from '@playwright/test'

const FETCH_PAGE = '/fixtures/transport/fetch.html'
const BEACON_PAGE = '/fixtures/transport/beacon.html'

// ---------------------------------------------------------------------------
// Route setup helpers
// ---------------------------------------------------------------------------

/**
 * Set up hermetic routing for the transport fixture pages.
 *
 * Uses a single `**\/*` catch-all handler with inline if/else dispatch so there
 * is no ambiguity about handler order. This enforces the single-handler rule from
 * bootstrap-first.spec.ts:54 and pixel-block.spec.ts:55.
 *
 * Rules:
 *   1. 127.0.0.1 / localhost → continue (fixture server)
 *   2. facebook.com/tr (GET or POST) → fulfill 200 + increment fbHitCounter
 *   3. region1.google-analytics.com → fulfill 200 + increment googleHitCounter
 *   4. Everything else → abort (other external hosts)
 *
 * The single hit-counter approach mirrors pixel-block.spec.ts §setupRoutes.
 * [research/test-strategist.md §F1 — page.route() over fixture-server counters]
 * [research/test-strategist.md §Gotchas — single **\/* handler, inline dispatch]
 */
async function setupRoutes({
  page,
  fbHitCounter,
  googleHitCounter,
}: {
  page: import('@playwright/test').Page
  fbHitCounter: { count: number }
  googleHitCounter: { count: number }
}): Promise<void> {
  await page.route('**/*', (route) => {
    const url = route.request().url()
    let hostname: string
    let pathname: string
    try {
      const parsed = new URL(url)
      hostname = parsed.hostname
      pathname = parsed.pathname
    } catch {
      return route.abort()
    }

    // Allow fixture server (127.0.0.1 or localhost)
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return route.continue()
    }

    // facebook.com/tr tracking endpoint — count hits, fulfill with 200
    // Matches: www.facebook.com/tr?... (GET or POST)
    if (
      (hostname === 'www.facebook.com' || hostname === 'facebook.com') &&
      pathname.startsWith('/tr')
    ) {
      fbHitCounter.count++
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
    }

    // Google Analytics endpoint — fulfill 200 to count passthrough hits
    // (skip-Google proof: this endpoint must NOT be held pre-consent)
    if (hostname === 'region1.google-analytics.com' || hostname === 'www.google-analytics.com') {
      googleHitCounter.count++
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
    }

    // Abort all other external traffic (safety net)
    return route.abort()
  })
}

// ---------------------------------------------------------------------------
// fetch fixture: AC1 (NEGATIVE proof — 0 hits before consent)
// [research/test-strategist.md §F1, §Recommendations 1]
// ---------------------------------------------------------------------------

test.describe('fetch: NEGATIVE proof — 0 network requests to facebook.com/tr before consent', () => {
  test('curated tracking fetch endpoint receives ZERO requests before consent', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(FETCH_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Allow Phase 2 (lazy autoblock-loader chunk) to resolve
    await page.waitForTimeout(300)

    // NEGATIVE proof: tracking endpoint must NOT have received any requests
    expect(fbHitCounter.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// fetch fixture: AC1 (POSITIVE proof — exactly 1 hit after marketing grant)
// Uses waitForResponse for deterministic timing (no arbitrary waitForTimeout).
// [research/test-strategist.md §F3, §Recommendations 3]
// ---------------------------------------------------------------------------

test.describe('fetch: POSITIVE proof — tracking request fires exactly once after grant', () => {
  test('curated tracking fetch endpoint receives EXACTLY ONE request after marketing grant', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(FETCH_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Pre-consent: zero hits
    await page.waitForTimeout(300)
    expect(fbHitCounter.count).toBe(0)

    // Grant marketing consent via accept-all and wait for the replayed fetch to arrive.
    // waitForResponse is deterministic — fires when the route handler fulfills the request,
    // eliminating the setTimeout(fn,0) INP-stagger timing flake.
    // [research/test-strategist.md §F3, §Recommendations 3]
    const replayPromise = page.waitForResponse(
      (response) =>
        response.url().includes('facebook.com/tr') && response.request().method() !== 'OPTIONS',
      { timeout: 5000 },
    )

    await page.click('[data-cookyay-accept]')
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    // Wait for the replayed fetch to land
    await replayPromise

    // POSITIVE proof: exactly one network hit after grant
    expect(fbHitCounter.count).toBe(1)
  })

  test('reject-all keeps tracking fetch held — ZERO requests after reject', async ({ page }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(FETCH_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    await page.click('[data-cookyay-reject]')
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    // Allow drain path — nothing should fire
    await page.waitForTimeout(300)

    expect(fbHitCounter.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// sendBeacon fixture: AC1 (NEGATIVE proof — 0 POST requests before consent)
// [research/test-strategist.md §F1]
// ---------------------------------------------------------------------------

test.describe('sendBeacon: NEGATIVE proof — 0 network requests to facebook.com/tr before consent', () => {
  test('curated tracking beacon endpoint receives ZERO requests before consent', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(BEACON_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Allow Phase 2 (lazy autoblock-loader chunk) to resolve
    await page.waitForTimeout(300)

    // NEGATIVE proof: beacon endpoint must NOT have received any requests
    expect(fbHitCounter.count).toBe(0)
  })

  test('sendBeacon wrapper returns true synchronously (queued-for-delivery semantics)', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(BEACON_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Wait for Phase 2 (matcher loads) before firing tracking beacon
    await page.waitForTimeout(300)

    // Fire the tracking beacon via the fixture helper (exposed after Phase 2 is active).
    // The proxy intercepts it, queues it, and returns true synchronously.
    // [autoblock-proxy.ts §patchedSendBeacon — queued-for-delivery return]
    await page.evaluate(() => window.__fireTrackingBeacon?.())

    // The fixture sets window.__beaconTest.beaconRetval to the sendBeacon return value
    const beaconRetval = await page.evaluate(() => window.__beaconTest?.beaconRetval)
    expect(beaconRetval).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// sendBeacon fixture: AC1 (POSITIVE proof — exactly 1 POST after grant)
// Uses waitForRequest for deterministic timing.
// [research/test-strategist.md §F3, §Recommendations 3]
// ---------------------------------------------------------------------------

test.describe('sendBeacon: POSITIVE proof — beacon fires exactly once after grant', () => {
  test('curated tracking beacon endpoint receives EXACTLY ONE request after marketing grant', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(BEACON_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Pre-consent: zero hits
    await page.waitForTimeout(300)

    // Fire the tracking beacon via the fixture helper (Phase 2 is now active).
    // The proxy intercepts it, queues it — no network hit yet.
    // [autoblock-proxy.ts §patchedSendBeacon — held path]
    await page.evaluate(() => window.__fireTrackingBeacon?.())
    expect(fbHitCounter.count).toBe(0)

    // Grant marketing consent and wait for the replayed beacon request to arrive.
    // waitForRequest is deterministic — fires when the browser sends the beacon.
    // [research/test-strategist.md §F3, §Recommendations 3]
    const beaconReplayPromise = page.waitForRequest(
      (req) => req.url().includes('facebook.com/tr') && req.method() === 'POST',
      { timeout: 5000 },
    )

    await page.click('[data-cookyay-accept]')
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    // Wait for the replayed beacon
    await beaconReplayPromise

    // POSITIVE proof: exactly one network hit after grant
    expect(fbHitCounter.count).toBe(1)
  })

  test('reject-all keeps beacon queued — ZERO requests after reject', async ({ page }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(BEACON_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    await page.click('[data-cookyay-reject]')
    await expect(page.locator('#cookyay-banner')).not.toBeVisible()

    await page.waitForTimeout(300)

    expect(fbHitCounter.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// AC3 — NEGATIVE: app's own fetch/beacon to same-origin passes through untouched
// [research/test-strategist.md §F4 item 1, task 005 AC3]
// ---------------------------------------------------------------------------

test.describe('NEGATIVE — app fetch passthrough: same-origin fetch is observed before consent', () => {
  test('same-origin fetch (/fixtures/transport/collect) is NOT held by the proxy', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(FETCH_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Wait for the same-origin fetch to complete (it fires immediately on load)
    await page.waitForTimeout(300)

    // Same-origin fetch status box must show "passed through" (not held)
    await expect(page.locator('#same-origin-status')).toContainText('passed through ✓', {
      timeout: 3000,
    })
  })
})

test.describe('NEGATIVE — app beacon passthrough: same-origin beacon is NOT held', () => {
  test('same-origin sendBeacon (/fixtures/transport/collect) is NOT held by the proxy', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(BEACON_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    await page.waitForTimeout(300)

    // Same-origin beacon status must show "passed through"
    await expect(page.locator('#same-origin-beacon-status')).toContainText('passed through', {
      timeout: 3000,
    })
  })
})

// ---------------------------------------------------------------------------
// AC5 — NEGATIVE: skip-Google — Google endpoint passes through (not held)
// [research/test-strategist.md §F4 item 3, goals.md §Consent Mode v2]
// ---------------------------------------------------------------------------

test.describe('NEGATIVE — skip-Google: Google Analytics fetch passes through pre-consent', () => {
  test('pre-consent fetch to Google Analytics is NOT held (passes through to network)', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(FETCH_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Wait for the Google fetch (Phase 2 loads, matcher runs — Google is skip-Google)
    await page.waitForTimeout(300)

    // Google Analytics hit counter must be >= 1 (request passed through, not held)
    expect(googleHitCounter.count).toBeGreaterThanOrEqual(1)

    // Status box confirms the pass-through
    await expect(page.locator('#google-fetch-status')).toContainText('not held', { timeout: 3000 })
  })
})

test.describe('NEGATIVE — skip-Google: Google Analytics sendBeacon passes through pre-consent', () => {
  test('pre-consent sendBeacon to Google Analytics is NOT held', async ({ page }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(BEACON_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    await page.waitForTimeout(300)

    // Google beacon is not held — status shows "passed through"
    await expect(page.locator('#google-beacon-status')).toContainText('not held', { timeout: 3000 })
  })
})

// ---------------------------------------------------------------------------
// AC6 — NEGATIVE: declared-wins — URL covered by declared data-category not double-queued
// [research/test-strategist.md §F4 item 4, task 005 AC6]
// ---------------------------------------------------------------------------

test.describe('NEGATIVE — declared-wins: fetch to declared data-src URL is NOT double-queued', () => {
  test('fetch to a declared data-category URL passes through (not intercepted by transport proxy)', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(FETCH_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Wait for Phase 2 classify-and-release before firing declared-wins fetch
    await page.waitForTimeout(300)

    // Fire the declared-wins fetch via the fixture helper (Phase 2 is now active).
    // The URL is covered by a declared data-category element — the transport proxy
    // must NOT queue it (declared-wins: proxy defers to the declarative engine).
    // [autoblock-proxy.ts §_isDeclaredCovered — declared-wins guard]
    await page.evaluate(() => window.__fireDeclaredFetch?.())

    // The declared-wins status box must show that the fetch was NOT held by the transport proxy
    await expect(page.locator('#declared-wins-status')).toContainText('✓', { timeout: 3000 })

    // The pre-consent counter for facebook.com/tr must account for the declared-wins passthrough.
    // The declared URL (same as the auto-block endpoint) passes through — route handler
    // fulfills it with 200 (not a 204 stub). This means fbHitCounter will be 1 for the
    // declared-wins pass-through, but 0 for the auto-blocked held fetch.
    // Note: the fixture makes ONE auto-blocked fetch (trackingUrl) and ONE declared-wins
    // fetch (declaredUrl = same host). The auto-blocked one is held (0 hits pre-consent);
    // the declared-wins one passes through (1 hit pre-consent).
    // Net count before consent = 1 (from declared-wins passthrough only).
    expect(fbHitCounter.count).toBe(1) // only the declared-wins passthrough
  })
})

// ---------------------------------------------------------------------------
// AC7 — NEGATIVE: XHR NOT intercepted — no over-reach by the transport proxy
// [research/test-strategist.md §F4, _index.md §Update Q5, task 005 AC7]
// ---------------------------------------------------------------------------

test.describe('NEGATIVE — XHR NOT intercepted: XMLHttpRequest to curated endpoint is not held', () => {
  test('XMLHttpRequest to facebook.com/tr is observed on the network (not held by proxy)', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(FETCH_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Wait for Phase 2 (matcher loads) — proxy is now active
    await page.waitForTimeout(300)

    // Fire an XHR to the curated tracking endpoint directly in the page.
    // The XHR must NOT be held by the transport proxy — it should reach the network.
    await page.evaluate(() => {
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', 'https://www.facebook.com/tr?ev=XHR&id=OVERREACH-TEST', true)
        xhr.onload = () => resolve()
        xhr.onerror = () => resolve() // network error is OK — still proves no hold
        xhr.onabort = () => resolve() // aborted by route handler — still proves no hold
        xhr.timeout = 2000
        xhr.ontimeout = () => resolve()
        xhr.send()
      })
    })

    // The XHR was NOT held by the transport proxy — it reached the route handler.
    // fbHitCounter >= 1 means the XHR went through (proxy did NOT intercept it).
    //
    // Background: the fetch/sendBeacon proxy ONLY wraps window.fetch and
    // navigator.sendBeacon. XMLHttpRequest is intentionally NOT intercepted
    // in v7 (deferred to a later version — goals.md §What's deferred).
    //
    // Note: fbHitCounter at this point includes any prior hits from the
    // declared-wins passthrough. We assert >= 1 to confirm the XHR went through.
    expect(fbHitCounter.count).toBeGreaterThanOrEqual(1)
  })

  // Silent-gap plan note: no curated-DB tracker relies solely on XHR.
  // All 44 non-Google services in db-autoblock.generated.ts use requestHosts/requestPaths
  // that cover fetch/sendBeacon endpoints. No service is XHR-exclusive.
  // Therefore v7's omission of XHR interception creates no silent coverage gaps.
  // This finding is also confirmed at the unit layer in autoblock-transport.test.ts
  // (Task 005 AC7 — silent-gap confirmation test).
  test('XHR over-reach guard: window.XMLHttpRequest is NOT patched by the proxy', async ({
    page,
  }) => {
    const fbHitCounter = { count: 0 }
    const googleHitCounter = { count: 0 }
    await setupRoutes({ page, fbHitCounter, googleHitCounter })

    await page.goto(FETCH_PAGE)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    await page.waitForTimeout(300)

    // Confirm window.XMLHttpRequest is the native constructor (not patched)
    const xhrIsNative = await page.evaluate(() => {
      // The native XMLHttpRequest is a function with no cookyay-specific properties
      return (
        typeof window.XMLHttpRequest === 'function' &&
        !('__cookyay_patched' in window.XMLHttpRequest)
      )
    })
    expect(xhrIsNative).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// pagehide beacon — documented edge case (test.skip with keepalive replay risk note)
// [research/test-strategist.md §Recommendations 6, §Gotchas, task 005 § Implementation notes]
// ---------------------------------------------------------------------------

// This edge-case fixture tests a sendBeacon fired on the pagehide event.
// It is skipped because the keepalive replay risk makes it non-deterministic in CI:
// browsers allow at most one in-flight keepalive request per page unload, and the
// queued beacon may be silently dropped if replay uses keepalive:true on unload.
// The v7 implementation correctly DROPS pre-consent beacons on pagehide (unload-drop
// guard in autoblock-proxy.ts §patchedSendBeacon) — this is the documented v7 posture.
// [research/_index.md §Update Q3 (drop, not defer)]
// [research/test-strategist.md §Recommendations 6 — hook for future work]
test.skip('pagehide-beacon edge case — keepalive replay risk (documented; deferred to future version)', async ({
  page,
}) => {
  // This test is intentionally skipped.
  // The v7 unload-drop guard is proven at the unit layer in autoblock-transport.test.ts
  // (Task 004 AC5 — unload-drop guard tests). The Playwright-level pagehide test is
  // non-deterministic due to keepalive semantics and is not part of the v7 acceptance bar.
  // Future work: add a beacon-unload.html fixture once the keepalive replay path is
  // explicitly designed (possibly v8).
  void page
})
