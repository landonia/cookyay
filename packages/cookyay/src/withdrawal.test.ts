// Task 011 — Withdrawal + re-prompt flows (jsdom tests)
//
// AC1: Withdrawal updates record, fires events, surfaces dismissible "reload required" prompt
// AC2: policyVersion bump — stored consent invalidated; banner re-surfaces on next load
//      (never mid-session via _hasSeenThisSession guard)
// AC3: Record expiry (default 12 months, configurable) triggers re-prompt on next load
// AC4: Newly granted categories on preference change execute their blocked scripts
//      (covered here for the re-grant path; grant() itself is tested in blocking.test.ts)
// AC5: All flows covered by tests in this file + preferences.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetApi, _hasSeenThisSession, _recordConsent, init } from './api.js'
import { _resetBanner, mountBanner } from './banner.js'
import { _resetPreferences, mountPreferences } from './preferences.js'
import { _resetWithdrawal } from './withdrawal.js'
import {
  buildConsentRecord,
  clearConsent,
  readConsent,
  writeConsent,
} from './consent/index.js'
import type { CategoryId } from './consent/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  policyVersion: 'v1',
  categories: {
    necessary: { services: [{ name: 'Session' }] },
    functional: { services: [{ name: 'Chat' }] },
    analytics: { services: [{ name: 'GA4' }] },
    marketing: { services: [{ name: 'Pixel' }] },
  },
}

function allGranted(): Record<CategoryId, boolean> {
  return { necessary: true, functional: true, analytics: true, marketing: true }
}

function allDenied(): Record<CategoryId, boolean> {
  return { necessary: true, functional: false, analytics: false, marketing: false }
}

function getModal(): HTMLElement | null {
  return document.getElementById('cookyay-preferences')
}

function getWithdrawalToast(): HTMLElement | null {
  return document.getElementById('cookyay-withdrawal-toast')
}

function getBanner(): HTMLElement | null {
  return document.getElementById('cookyay-banner')
}

function getSaveBtn(): HTMLElement | null {
  return getModal()?.querySelector<HTMLElement>('[data-cookyay-save]') ?? null
}

function getSwitch(cat: string): HTMLElement | null {
  return getModal()?.querySelector<HTMLElement>(`[data-cookyay-switch="${cat}"]`) ?? null
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearConsent()
  document.body.innerHTML = ''
})

afterEach(() => {
  _resetWithdrawal()
  _resetPreferences()
  _resetBanner()
  _resetApi()
  clearConsent()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// AC1: Withdrawal prompt
// ---------------------------------------------------------------------------

describe('AC1: Withdrawal — "reload recommended" prompt', () => {
  it('shows withdrawal toast when a previously granted category is revoked', () => {
    // Pre-load a consent record with analytics granted
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)

    // Turn analytics off (was previously on)
    const analyticsSwitch = getSwitch('analytics')!
    expect(analyticsSwitch.getAttribute('aria-checked')).toBe('true')
    analyticsSwitch.click() // now false

    getSaveBtn()!.click()

    expect(getWithdrawalToast()).not.toBeNull()
  })

  it('does NOT show toast when no previously granted category is revoked', () => {
    // All denied → save with all still denied: no withdrawal
    writeConsent(buildConsentRecord(allDenied(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)
    getSaveBtn()!.click()
    expect(getWithdrawalToast()).toBeNull()
  })

  it('does NOT show toast on first-time save (no prior record)', () => {
    init(BASE_CONFIG)
    mountPreferences(null)
    getSaveBtn()!.click()
    expect(getWithdrawalToast()).toBeNull()
  })

  it('does NOT show toast when adding categories (no withdrawal)', () => {
    // Previously denied analytics, now granting it — this is a grant, not a withdrawal
    writeConsent(buildConsentRecord(allDenied(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)
    getSwitch('analytics')!.click() // enable analytics
    getSaveBtn()!.click()
    expect(getWithdrawalToast()).toBeNull()
  })

  it('toast is dismissible via the × close button', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    const toast = getWithdrawalToast()!
    const closeBtn = toast.querySelector<HTMLElement>('[data-cookyay-withdrawal-close]')!
    closeBtn.click()

    expect(getWithdrawalToast()).toBeNull()
  })

  it('toast contains a "Reload page" button', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    const reloadBtn = getWithdrawalToast()?.querySelector('[data-cookyay-withdrawal-reload]')
    expect(reloadBtn).not.toBeNull()
  })

  it('reload button calls window.location.reload', () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    })

    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    const reloadBtn = getWithdrawalToast()!.querySelector<HTMLElement>('[data-cookyay-withdrawal-reload]')!
    reloadBtn.click()

    expect(reloadSpy).toHaveBeenCalledOnce()
  })

  it('toast has role="status" and aria-live="polite"', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    const toast = getWithdrawalToast()!
    expect(toast.getAttribute('role')).toBe('status')
    expect(toast.getAttribute('aria-live')).toBe('polite')
  })

  it('consent record is updated after withdrawal save', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)
    getSwitch('analytics')!.click() // revoke analytics
    getSaveBtn()!.click()

    const record = readConsent('v1')!
    expect(record.categories.analytics).toBe(false)
    expect(record.categories.necessary).toBe(true)
  })

  it('cookyay:consent event is fired on withdrawal save', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)

    const spy = vi.fn()
    document.addEventListener('cookyay:consent', spy, { once: true })

    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    expect(spy).toHaveBeenCalledOnce()
  })

  it('cookyay:change event is fired on withdrawal save', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)

    const spy = vi.fn()
    document.addEventListener('cookyay:change', spy, { once: true })

    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    expect(spy).toHaveBeenCalledOnce()
  })

  it('toast text is configurable via strings.withdrawalPromptText', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init({ ...BASE_CONFIG, strings: { withdrawalPromptText: 'Custom withdrawal message' } })
    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    expect(getWithdrawalToast()?.querySelector('.cookyay-withdrawal__msg')?.textContent)
      .toBe('Custom withdrawal message')
  })

  it('reload button label is configurable via strings.reloadLabel', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init({ ...BASE_CONFIG, strings: { reloadLabel: 'Recharger la page' } })
    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    const reloadBtn = getWithdrawalToast()?.querySelector('[data-cookyay-withdrawal-reload]')
    expect(reloadBtn?.textContent).toBe('Recharger la page')
  })

  it('default prompt text explains that scripts persist until reload', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)
    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    const msg = getWithdrawalToast()?.querySelector('.cookyay-withdrawal__msg')?.textContent ?? ''
    // Must mention scripts persisting (honest-limitation posture, compliance §Gotcha 5)
    expect(msg.toLowerCase()).toMatch(/scripts.*already ran|already ran.*scripts/)
  })
})

// ---------------------------------------------------------------------------
// AC1 addendum: clearOnWithdraw hook
// ---------------------------------------------------------------------------

describe('AC1 addendum: clearOnWithdraw config hook', () => {
  it('clearOnWithdraw is called when a category is revoked', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    const hook = vi.fn()
    init({ ...BASE_CONFIG, clearOnWithdraw: hook })
    mountPreferences(null)
    getSwitch('analytics')!.click() // revoke analytics
    getSaveBtn()!.click()

    expect(hook).toHaveBeenCalledOnce()
  })

  it('clearOnWithdraw receives the exact revoked category ids', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    const hook = vi.fn()
    init({ ...BASE_CONFIG, clearOnWithdraw: hook })
    mountPreferences(null)
    getSwitch('analytics')!.click()  // revoke analytics
    getSwitch('marketing')!.click()  // revoke marketing
    getSaveBtn()!.click()

    expect(hook).toHaveBeenCalledWith(expect.arrayContaining(['analytics', 'marketing']))
    const [revoked] = hook.mock.calls[0] as [string[]]
    expect(revoked).not.toContain('necessary')
    expect(revoked).not.toContain('functional')
  })

  it('clearOnWithdraw is NOT called when no categories are revoked (grant only)', () => {
    writeConsent(buildConsentRecord(allDenied(), 'v1', '0.1.0', false))
    const hook = vi.fn()
    init({ ...BASE_CONFIG, clearOnWithdraw: hook })
    mountPreferences(null)
    getSwitch('analytics')!.click()  // grant analytics (not a revocation)
    getSaveBtn()!.click()

    expect(hook).not.toHaveBeenCalled()
  })

  it('clearOnWithdraw is NOT called on first-time save (no prior record)', () => {
    const hook = vi.fn()
    init({ ...BASE_CONFIG, clearOnWithdraw: hook })
    mountPreferences(null)
    getSaveBtn()!.click()

    expect(hook).not.toHaveBeenCalled()
  })

  it('clearOnWithdraw fires before the toast is shown', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    const callOrder: string[] = []
    const hook = vi.fn(() => {
      callOrder.push('hook')
      // Toast should NOT be in DOM yet when hook fires
      if (getWithdrawalToast()) callOrder.push('toast-already-present')
    })
    init({ ...BASE_CONFIG, clearOnWithdraw: hook })
    mountPreferences(null)
    getSwitch('analytics')!.click()
    getSaveBtn()!.click()

    expect(callOrder).toContain('hook')
    expect(callOrder).not.toContain('toast-already-present')
    // Toast appears after hook
    expect(getWithdrawalToast()).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC2: policyVersion bump — never mid-session
// ---------------------------------------------------------------------------

describe('AC2: policyVersion re-prompt — next load, never mid-session', () => {
  it('stored consent with old policyVersion: readConsent returns null (would trigger re-prompt on next load)', () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    // Simulate a version bump: current policyVersion is now 'v2'
    const record = readConsent('v2')
    expect(record).toBeNull()
  })

  it('banner mounts when stored policyVersion does not match config (fresh page load)', () => {
    // Old consent under policyVersion 'v1'; config now uses 'v2'
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init({ policyVersion: 'v2' })
    // Banner should appear because readConsent('v2') returns null
    expect(getBanner()).not.toBeNull()
  })

  it('banner does NOT re-mount mid-session after consent was given (_hasSeenThisSession guard)', () => {
    init(BASE_CONFIG)
    // Consent given this session
    _recordConsent(allGranted())
    expect(_hasSeenThisSession()).toBe(true)

    // Simulate a mid-session banner mount attempt (e.g., after short-lived cookie expires)
    mountBanner()
    // Guard suppresses the banner
    expect(getBanner()).toBeNull()
  })

  it('_hasSeenThisSession is false before any consent is recorded', () => {
    init(BASE_CONFIG)
    expect(_hasSeenThisSession()).toBe(false)
  })

  it('_hasSeenThisSession is true after _recordConsent is called', () => {
    init(BASE_CONFIG)
    _recordConsent(allDenied())
    expect(_hasSeenThisSession()).toBe(true)
  })

  it('_hasSeenThisSession resets to false after _resetApi()', () => {
    init(BASE_CONFIG)
    _recordConsent(allDenied())
    _resetApi()
    expect(_hasSeenThisSession()).toBe(false)
  })

  it('banner mounts on a fresh page load (no session marker, no stored consent)', () => {
    init(BASE_CONFIG)
    // No stored consent, no session marker → banner should appear
    expect(getBanner()).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC3: Record expiry — re-prompt on next load
// ---------------------------------------------------------------------------

describe('AC3: Record expiry triggers re-prompt on next load', () => {
  it('expired cookie (no cookie in document.cookie): readConsent returns null', () => {
    // Simulate expired cookie by simply not writing one
    const record = readConsent('v1')
    expect(record).toBeNull()
  })

  it('expiryDays config is passed through to the consent cookie', () => {
    const spy = vi.spyOn(document, 'cookie', 'set')
    init({ policyVersion: 'v1', cookie: { expiryDays: 30 } })
    _recordConsent(allGranted())

    // The cookie string should contain Max-Age=2592000 (30 * 24 * 60 * 60)
    const cookieCalls = spy.mock.calls.map((c) => c[0] as string)
    const consentCookie = cookieCalls.find((c) => c.startsWith('cookyay_consent='))
    expect(consentCookie).toBeDefined()
    expect(consentCookie).toContain('Max-Age=2592000')
  })

  it('default expiryDays is 365 (12 months)', () => {
    const spy = vi.spyOn(document, 'cookie', 'set')
    init(BASE_CONFIG)
    _recordConsent(allGranted())

    const cookieCalls = spy.mock.calls.map((c) => c[0] as string)
    const consentCookie = cookieCalls.find((c) => c.startsWith('cookyay_consent='))
    expect(consentCookie).toBeDefined()
    expect(consentCookie).toContain('Max-Age=31536000') // 365 * 24 * 60 * 60
  })

  it('after cookie expiry (no cookie present), banner re-appears on a fresh page load', () => {
    // Cookie expired = no cookie at all; fresh session (no session marker)
    // init() with no stored consent should mount the banner
    init(BASE_CONFIG)
    expect(getBanner()).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC4: Newly granted categories execute their blocked scripts on preference change
// ---------------------------------------------------------------------------

describe('AC4: Grant on preference change (without reload)', () => {
  it('newly enabled category results in grant() being called (via blocking queue)', async () => {
    // Set up a blocked script element
    const script = document.createElement('script')
    script.setAttribute('type', 'text/plain')
    script.setAttribute('data-category', 'analytics')
    script.textContent = 'window.__analyticsRan = true'
    document.body.appendChild(script)

    // Start with no consent
    init(BASE_CONFIG)

    // Simulate a first-time save with analytics enabled
    mountPreferences(null)
    getSwitch('analytics')!.click() // enable
    getSaveBtn()!.click()

    // After setTimeout(0) the grant() callback runs
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    // The script should have been cloned and inserted (data-cookyay-state="executed")
    expect(script.getAttribute('data-cookyay-state')).toBe('executed')
  })

  it('already-executed scripts are not re-run on a subsequent preference save', async () => {
    const script = document.createElement('script')
    script.setAttribute('type', 'text/plain')
    script.setAttribute('data-category', 'analytics')
    document.body.appendChild(script)

    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(BASE_CONFIG)

    // Manually mark as executed (simulating it was run on a previous page)
    script.setAttribute('data-cookyay-state', 'executed')

    // Open preferences and re-save with analytics still enabled
    mountPreferences(null)
    getSaveBtn()!.click()

    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    // Script count should not have increased (idempotent)
    const scripts = document.querySelectorAll('script[data-category="analytics"]')
    expect(scripts.length).toBe(1)
  })
})
