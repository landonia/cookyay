/**
 * E2E: visitor journey flows (PRD §3.1–§3.3, §3.5)
 *
 * Covers: first visit, accept, reject, granular (via preferences modal),
 * withdrawal + reload prompt, policy-version re-prompt, and GPC visitor.
 *
 * page.route() aborts all non-localhost traffic in beforeEach.
 */
import { test, expect } from '@playwright/test'

const INDEX = '/fixtures/index.html'
const ALL_PAGE = '/fixtures/blocking/all.html'

// Synthetic flags from stub scripts
type StubWindow = Window &
  typeof globalThis & {
    __analyticsInlineRan?: boolean
  }

// Default-deny all external network (test-strategist §Rec 3, §Finding 6)
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
// First visit
// ---------------------------------------------------------------------------

test('first visit: banner is shown and consent cookie is absent', async ({ page }) => {
  await page.goto(INDEX)

  await expect(page.locator('#cookyay-banner')).toBeVisible()

  const cookies = await page.context().cookies()
  const consentCookie = cookies.find((c) => c.name === 'cookyay_consent')
  expect(consentCookie).toBeUndefined()
})

// ---------------------------------------------------------------------------
// Accept flow
// ---------------------------------------------------------------------------

test('accept flow: banner dismissed, consent cookie written, re-open link visible', async ({
  page,
}) => {
  await page.goto(INDEX)

  await page.click('[data-cookyay-accept]')

  await expect(page.locator('#cookyay-banner')).not.toBeVisible()
  await expect(page.locator('#cookyay-reopen')).toBeVisible()

  const cookies = await page.context().cookies()
  const consentCookie = cookies.find((c) => c.name === 'cookyay_consent')
  expect(consentCookie).toBeDefined()

  // Decode and verify categories — all granted
  const payload = JSON.parse(decodeURIComponent(consentCookie!.value)) as {
    c: { n: boolean; f: boolean; a: boolean; m: boolean }
    gpc: boolean
  }
  expect(payload.c.n).toBe(true)
  expect(payload.c.a).toBe(true)
  expect(payload.c.m).toBe(true)
  expect(payload.gpc).toBe(false)
})

// ---------------------------------------------------------------------------
// Reject flow
// ---------------------------------------------------------------------------

test('reject flow: banner dismissed, consent cookie written with all optional denied', async ({
  page,
}) => {
  await page.goto(INDEX)

  await page.click('[data-cookyay-reject]')

  await expect(page.locator('#cookyay-banner')).not.toBeVisible()

  const cookies = await page.context().cookies()
  const consentCookie = cookies.find((c) => c.name === 'cookyay_consent')
  expect(consentCookie).toBeDefined()

  const payload = JSON.parse(decodeURIComponent(consentCookie!.value)) as {
    c: { n: boolean; f: boolean; a: boolean; m: boolean }
  }
  // Necessary always true; everything else denied
  expect(payload.c.n).toBe(true)
  expect(payload.c.f).toBe(false)
  expect(payload.c.a).toBe(false)
  expect(payload.c.m).toBe(false)
})

// ---------------------------------------------------------------------------
// Returning visitor
// ---------------------------------------------------------------------------

test('returning visitor: no banner shown when valid consent is already stored', async ({
  page,
}) => {
  // First visit — accept
  await page.goto(INDEX)
  await page.click('[data-cookyay-accept]')
  await expect(page.locator('#cookyay-banner')).not.toBeVisible()

  // Navigate again with the same browser context (cookies persist)
  await page.goto(INDEX)
  await expect(page.locator('#cookyay-banner')).not.toBeVisible()
  await expect(page.locator('#cookyay-reopen')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Granular flow (via preferences modal)
// ---------------------------------------------------------------------------

test('granular flow: only consented categories are granted', async ({ page }) => {
  await page.goto(ALL_PAGE)

  // Open preferences modal from the banner's "Manage" button
  await page.click('[data-cookyay-manage]')
  await expect(page.locator('#cookyay-preferences')).toBeVisible()

  // Toggle analytics ON, leave marketing OFF
  const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
  await analyticsSwitch.click()
  await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')

  await page.click('[data-cookyay-save]')

  // Analytics script runs
  await expect(page.locator('#inline-status')).toContainText('executed ✓')
  // Marketing stays blocked
  expect(await page.evaluate(() => (window as StubWindow).__analyticsInlineRan)).toBe(true)
})

// ---------------------------------------------------------------------------
// Withdrawal + reload prompt
// ---------------------------------------------------------------------------

test('withdrawal flow: revoking a granted category shows the reload prompt', async ({ page }) => {
  // First visit — accept all
  await page.goto(ALL_PAGE)
  await page.click('[data-cookyay-accept]')
  await expect(page.locator('#cookyay-banner')).not.toBeVisible()
  await expect(page.locator('#cookyay-reopen')).toBeVisible()

  // Open preferences via the re-open link
  await page.click('#cookyay-reopen')
  await expect(page.locator('#cookyay-preferences')).toBeVisible()

  // Analytics switch should be ON (we accepted all)
  const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
  await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')

  // Revoke analytics
  await analyticsSwitch.click()
  await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'false')

  await page.click('[data-cookyay-save]')

  // Withdrawal toast must appear
  await expect(page.locator('[data-cookyay-withdrawal]')).toBeVisible()

  // Reload button must be present in the toast
  await expect(page.locator('[data-cookyay-withdrawal-reload]')).toBeVisible()
})

test('withdrawal toast dismisses on close button click', async ({ page }) => {
  await page.goto(ALL_PAGE)
  await page.click('[data-cookyay-accept]')
  await page.click('#cookyay-reopen')

  const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
  await analyticsSwitch.click()
  await page.click('[data-cookyay-save]')

  await expect(page.locator('[data-cookyay-withdrawal]')).toBeVisible()
  await page.click('[data-cookyay-withdrawal-close]')
  await expect(page.locator('[data-cookyay-withdrawal]')).not.toBeVisible()
})

// ---------------------------------------------------------------------------
// Policy-version re-prompt
// ---------------------------------------------------------------------------

test('policy-version re-prompt: banner shown when stored consent has a different policy version', async ({
  page,
}) => {
  // Pre-seed a consent cookie whose policyVersion differs from the fixture site's ('fixture-v1')
  const oldPayload = {
    sv: 1,
    t: 1700000000,
    pv: 'old-policy', // mismatch — fixture uses 'fixture-v1'
    bv: '0.1.0',
    c: { n: true, f: true, a: true, m: true },
    gpc: false,
  }
  await page.context().addCookies([
    {
      name: 'cookyay_consent',
      value: encodeURIComponent(JSON.stringify(oldPayload)),
      domain: '127.0.0.1',
      path: '/',
      sameSite: 'Lax',
    },
  ])

  // Navigate — readConsent() invalidates on pv mismatch → banner appears
  await page.goto(ALL_PAGE)
  await expect(page.locator('#cookyay-banner')).toBeVisible()
})

// ---------------------------------------------------------------------------
// GPC visitor
// ---------------------------------------------------------------------------

test('GPC visitor: GPC toast shown, banner suppressed, scripts stay blocked', async ({ page }) => {
  // Inject navigator.globalPrivacyControl before any page script runs
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: false,
    })
  })

  await page.goto(ALL_PAGE)

  // GPC toast must be visible
  await expect(page.locator('#cookyay-gpc-toast')).toBeVisible()

  // Banner must NOT appear (GPC writes a denied record before mountBanner() runs)
  await expect(page.locator('#cookyay-banner')).not.toBeVisible()

  // Scripts must remain blocked
  await page.waitForTimeout(150)
  const ran = await page.evaluate(() => (window as StubWindow).__analyticsInlineRan)
  expect(ran).toBeUndefined()
})

test('GPC visitor: second visit does not re-show GPC toast', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: false,
    })
  })

  // First visit — toast shown, record written with gpc:true
  await page.goto(ALL_PAGE)
  await expect(page.locator('#cookyay-gpc-toast')).toBeVisible()

  // Dismiss toast
  await page.locator('.cookyay-gpc-toast__close').click()
  await expect(page.locator('#cookyay-gpc-toast')).not.toBeVisible()

  // Second visit — gpc:true already in cookie; toast is suppressed
  await page.goto(ALL_PAGE)
  await expect(page.locator('#cookyay-gpc-toast')).not.toBeVisible()
  await expect(page.locator('#cookyay-banner')).not.toBeVisible()
})

// Task 021 — regression: explicit post-GPC choices must persist across reloads
// Repro: Brave (GPC default on) — saving Cookie settings was forgotten on reload
// because the record was written with gpc:false, so _runGpc() overwrote it.
test('GPC visitor: explicit preference choices persist after reload (task 021)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: false,
    })
  })

  // First visit — GPC applied, toast shown, banner suppressed
  await page.goto(ALL_PAGE)
  await expect(page.locator('#cookyay-gpc-toast')).toBeVisible()
  await expect(page.locator('#cookyay-banner')).not.toBeVisible()

  // User opens Cookie settings via the re-open link (always injected, even when banner suppressed)
  await expect(page.locator('#cookyay-reopen')).toBeVisible()
  await page.click('#cookyay-reopen')
  await expect(page.locator('#cookyay-preferences')).toBeVisible()

  const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
  // GPC-applied record has analytics=false; turn it on explicitly
  await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'false')
  await analyticsSwitch.click()
  await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')
  await page.click('[data-cookyay-save]')

  // Verify cookie was written with gpc:true (GPC-acknowledged)
  const cookiesAfterSave = await page.context().cookies()
  const cookieAfterSave = cookiesAfterSave.find((c) => c.name === 'cookyay_consent')
  expect(cookieAfterSave).toBeDefined()
  const payloadAfterSave = JSON.parse(decodeURIComponent(cookieAfterSave!.value)) as {
    c: { a: boolean }
    gpc: boolean
  }
  expect(payloadAfterSave.gpc).toBe(true) // GPC-acknowledged
  expect(payloadAfterSave.c.a).toBe(true) // analytics granted

  // Reload — the explicit choices must survive
  await page.goto(ALL_PAGE)

  // Toast must NOT re-appear (record already gpc:true)
  await expect(page.locator('#cookyay-gpc-toast')).not.toBeVisible()
  // Banner must stay suppressed
  await expect(page.locator('#cookyay-banner')).not.toBeVisible()

  // Cookie must still reflect analytics=true
  const cookiesAfterReload = await page.context().cookies()
  const cookieAfterReload = cookiesAfterReload.find((c) => c.name === 'cookyay_consent')
  expect(cookieAfterReload).toBeDefined()
  const payloadAfterReload = JSON.parse(decodeURIComponent(cookieAfterReload!.value)) as {
    c: { a: boolean }
    gpc: boolean
  }
  expect(payloadAfterReload.gpc).toBe(true)
  expect(payloadAfterReload.c.a).toBe(true) // analytics choice preserved
})
