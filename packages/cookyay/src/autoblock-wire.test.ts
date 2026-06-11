// Wire auto-detected elements into blocking.ts grant/inject queue — jsdom unit tests (task 005)
//
// Tests cover all 5 acceptance criteria:
//
// AC1 — Auto-detected (held) elements from task 004 are enqueued into the EXISTING
//         blocking.ts category-keyed queue and injected on consent grant via the same
//         clone-and-reinsert / data-src-promote path as declared elements.
//
// AC2 — Each auto-detected element is tagged with data-cookyay-auto="true" distinct
//         from declared elements; declared-element behavior is unchanged.
//
// AC3 — Declared-wins precedence: an element already attributed by the declarative
//         engine is NOT double-processed by auto-block (handled exactly once).
//
// AC4 — Consent withdrawal surfaces the same "reload required" posture as declared
//         third parties: withdrawal of an auto-blocked category triggers the existing flow.
//
// AC5 — Injection staggered via setTimeout(fn, 0) INP guard; includes a test that a
//         granted auto-detected script executes (clone is inserted).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STATE_BLOCKED,
  STATE_EXECUTED,
  _resetBlocker,
  enqueueAutoDetected,
  grant,
  scanBlocked,
} from './blocking.js'
import {
  ATTR_AUTO_DETECTED,
  _holdElement,
  _resetAutoBlockProxy,
  activateMatcher,
  getHeldElements,
  installAutoBlockProxy,
  isProxyInstalled,
} from './autoblock-proxy.js'
import type { AutoBlockMatch } from './autoblock-matcher.js'
import { _resetApi, init } from './api.js'
import { clearConsent, buildConsentRecord, writeConsent } from './consent/index.js'
import { _resetPreferences, mountPreferences } from './preferences.js'
import { _resetWithdrawal } from './withdrawal.js'
import { _resetBanner } from './banner.js'

// ---------------------------------------------------------------------------
// Test matcher helpers
// ---------------------------------------------------------------------------

function makeHotjarMatcher(): (url: string) => AutoBlockMatch | null {
  return (url: string) => {
    if (url.includes('hotjar.com')) {
      return { serviceId: 'hotjar', category: 'analytics' }
    }
    return null
  }
}

function makeYoutubeMatcher(): (url: string) => AutoBlockMatch | null {
  return (url: string) => {
    if (url.includes('youtube.com')) {
      return { serviceId: 'youtube', category: 'marketing' }
    }
    return null
  }
}

/** Install + activate the proxy with a matcher in one call. */
function installAndActivate(matcher: (url: string) => AutoBlockMatch | null): void {
  installAutoBlockProxy()
  activateMatcher(matcher)
}

// ---------------------------------------------------------------------------
// Helpers for building held elements (simulates what the proxy produces)
// ---------------------------------------------------------------------------

/**
 * Build a script element that simulates what the proxy leaves behind:
 * data-cookyay-state="blocked", data-cookyay-auto="true", data-category set,
 * src NOT assigned (the proxy held it inert).
 */
function makeHeldScript(src: string, category: string): HTMLScriptElement {
  const s = document.createElement('script')
  s.setAttribute('data-cookyay-state', STATE_BLOCKED)
  s.setAttribute('data-cookyay-auto', 'true')
  s.setAttribute('data-category', category)
  // src is intentionally NOT set — the proxy intercepted it
  document.body.appendChild(s)
  return s
}

/**
 * Build an iframe element that simulates what the proxy leaves behind.
 * The proxy intercepts the src assignment (stores it in HeldElement.src)
 * but never assigns it to the element.
 */
function makeHeldIframe(src: string, category: string): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.setAttribute('data-cookyay-state', STATE_BLOCKED)
  f.setAttribute('data-cookyay-auto', 'true')
  f.setAttribute('data-category', category)
  // src not assigned — proxy held it
  document.body.appendChild(f)
  return f
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetAutoBlockProxy()
  _resetBlocker()
  _resetApi()
  clearConsent()
  document.body.innerHTML = ''
})

afterEach(() => {
  _resetAutoBlockProxy()
  _resetBlocker()
  _resetWithdrawal()
  _resetPreferences()
  _resetBanner()
  _resetApi()
  clearConsent()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// enqueueAutoDetected() unit tests — blocking.ts new export
// ---------------------------------------------------------------------------

describe('enqueueAutoDetected — direct enqueue into blocking queue', () => {
  it('stores the captured src as data-src on the element', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')
    expect(s.getAttribute('data-src')).toBe('https://static.hotjar.com/c/hotjar.js')
  })

  it('stores the captured src as data-src on an iframe element', () => {
    const f = makeHeldIframe('https://www.youtube.com/embed/abc', 'marketing')
    enqueueAutoDetected(f, 'https://www.youtube.com/embed/abc', 'marketing')
    expect(f.getAttribute('data-src')).toBe('https://www.youtube.com/embed/abc')
  })

  it('grant() after enqueueAutoDetected schedules a setTimeout(fn,0) per element', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    expect(setTimeoutSpy).toHaveBeenCalledOnce()
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(0)
    setTimeoutSpy.mockRestore()
  })

  it('skips an element already STATE_EXECUTED', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    s.setAttribute('data-cookyay-state', STATE_EXECUTED)
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    setTimeoutSpy.mockRestore()
  })

  it('emits console.warn and skips for an unknown category', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'unknown-cat')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'unknown-cat')

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain('unknown category')
    setTimeoutSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// AC1 — Auto-detected elements use the same grant/inject path as declared ones
// ---------------------------------------------------------------------------

describe('AC1 — auto-detected elements enqueued into blocking.ts queue and injected on grant', () => {
  it('a held script is enqueued and a clone is inserted after grant (AC1 + AC5)', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    // Clone script should be inserted next to the original
    const scripts = document.body.querySelectorAll<HTMLScriptElement>('script')
    const clones = Array.from(scripts).filter(
      (sc) => sc !== s && sc.getAttribute('src') === 'https://static.hotjar.com/c/hotjar.js',
    )
    expect(clones.length).toBe(1)
  })

  it('the auto-detected script clone carries src (from data-src) and no type attribute', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    const clone = document.body.querySelector<HTMLScriptElement>(
      `script[src="https://static.hotjar.com/c/hotjar.js"]:not([data-cookyay-auto])`,
    )
    expect(clone).not.toBeNull()
    expect(clone!.getAttribute('type')).toBeNull()
  })

  it('a held iframe is enqueued and its data-src is promoted to src after grant', () => {
    const f = makeHeldIframe('https://www.youtube.com/embed/abc', 'marketing')
    enqueueAutoDetected(f, 'https://www.youtube.com/embed/abc', 'marketing')

    vi.useFakeTimers()
    grant('marketing')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(f.getAttribute('data-src')).toBeNull()
    // jsdom represents src as the full URL
    expect(f.src).toContain('youtube.com')
  })

  it('grant sets data-cookyay-state="executed" on auto-detected script', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('grant sets data-cookyay-state="executed" on auto-detected iframe', () => {
    const f = makeHeldIframe('https://www.youtube.com/embed/abc', 'marketing')
    enqueueAutoDetected(f, 'https://www.youtube.com/embed/abc', 'marketing')

    vi.useFakeTimers()
    grant('marketing')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(f.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('granting analytics does NOT release a marketing auto-detected script', () => {
    const s = makeHeldScript('https://www.youtube.com/embed/abc', 'marketing')
    enqueueAutoDetected(s, 'https://www.youtube.com/embed/abc', 'marketing')

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)
  })

  it('auto-detected and declared elements in same category are both injected on grant', () => {
    // Declared element (type="text/plain" + data-category)
    const declared = document.createElement('script')
    declared.setAttribute('type', 'text/plain')
    declared.setAttribute('data-category', 'analytics')
    declared.setAttribute('src', 'https://example.com/analytics.js')
    document.body.appendChild(declared)
    scanBlocked()

    // Auto-detected element
    const held = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(held, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    // Both originals should be executed
    expect(declared.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
    expect(held.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('injection is NOT synchronous — clone not inserted until setTimeout fires (INP guard, AC5)', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')

    // Before timers run, no clone
    const scriptsBefore = Array.from(document.body.querySelectorAll('script')).filter(
      (sc) => sc !== s,
    )
    expect(scriptsBefore.length).toBe(0)

    vi.runAllTimers()
    vi.useRealTimers()

    // After timers, clone present
    const scriptsAfter = Array.from(document.body.querySelectorAll('script')).filter(
      (sc) => sc !== s && sc.getAttribute('src') === 'https://static.hotjar.com/c/hotjar.js',
    )
    expect(scriptsAfter.length).toBe(1)
  })

  it('grant is idempotent — a second grant call does not re-inject the script', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    grant('analytics') // second call — queue already drained
    vi.runAllTimers()
    vi.useRealTimers()

    const clones = Array.from(document.body.querySelectorAll('script')).filter(
      (sc) => sc !== s && sc.getAttribute('src') === 'https://static.hotjar.com/c/hotjar.js',
    )
    expect(clones.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// AC2 — Observability marker: data-cookyay-auto="true" on auto-detected elements
// ---------------------------------------------------------------------------

describe('AC2 — observability marker data-cookyay-auto distinct from declared elements', () => {
  it('enqueueAutoDetected preserves data-cookyay-auto="true" on the element', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')
    expect(s.getAttribute(ATTR_AUTO_DETECTED)).toBe('true')
  })

  it('auto-detected elements carry data-cookyay-auto; declared elements do NOT', () => {
    const declared = document.createElement('script')
    declared.setAttribute('type', 'text/plain')
    declared.setAttribute('data-category', 'analytics')
    declared.setAttribute('src', 'https://example.com/analytics.js')
    document.body.appendChild(declared)
    scanBlocked()

    const held = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(held, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    expect(declared.getAttribute(ATTR_AUTO_DETECTED)).toBeNull()
    expect(held.getAttribute(ATTR_AUTO_DETECTED)).toBe('true')
  })

  it('the injected clone for a declared script does NOT carry data-cookyay-auto', () => {
    const declared = document.createElement('script')
    declared.setAttribute('type', 'text/plain')
    declared.setAttribute('data-category', 'analytics')
    declared.setAttribute('src', 'https://example.com/analytics.js')
    document.body.appendChild(declared)
    scanBlocked()

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    const clone = document.body.querySelector<HTMLScriptElement>(
      `script[src="https://example.com/analytics.js"]:not([type="text/plain"])`,
    )
    expect(clone).not.toBeNull()
    expect(clone!.getAttribute(ATTR_AUTO_DETECTED)).toBeNull()
  })

  it('the injected clone for an auto-detected script does NOT carry data-cookyay-auto', () => {
    const held = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(held, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    // The live clone should NOT carry the observability marker (it's a real executing script)
    const clone = document.body.querySelector<HTMLScriptElement>(
      `script[src="https://static.hotjar.com/c/hotjar.js"]:not([data-cookyay-auto])`,
    )
    expect(clone).not.toBeNull()
    expect(clone!.getAttribute(ATTR_AUTO_DETECTED)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC3 — Declared-wins precedence: same element handled exactly once
// ---------------------------------------------------------------------------

describe('AC3 — declared-wins: same element declared + DB-matched is processed exactly once', () => {
  it('a script declared in markup (type=text/plain + data-category) AND proxy-matched is NOT held by the proxy (declared wins)', () => {
    // This simulates the case where a site owner ALSO declared the script in markup
    // AND auto-block would match it. The proxy's _holdElement() skips elements that
    // already have data-cookyay-state="blocked" (set by scanBlocked).

    // Declared script — processed by scanBlocked first
    const s = document.createElement('script')
    s.setAttribute('type', 'text/plain')
    s.setAttribute('data-category', 'analytics')
    s.setAttribute('src', 'https://static.hotjar.com/c/hotjar.js')
    document.body.appendChild(s)
    scanBlocked() // registers with data-cookyay-state="blocked"

    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)

    // Now simulate the proxy attempting to hold the same element
    installAutoBlockProxy()
    const match: AutoBlockMatch = { serviceId: 'hotjar', category: 'analytics' }
    // _holdElement should skip elements that already have STATE_BLOCKED
    const wasHeld = _holdElement(s, 'https://static.hotjar.com/c/hotjar.js', match)
    expect(wasHeld).toBe(false)

    // The element is NOT in the held queue (proxy skipped it)
    expect(getHeldElements()).toHaveLength(0)
  })

  it('declared element remains in the blocking queue (not evicted) when proxy skips it', () => {
    const s = document.createElement('script')
    s.setAttribute('type', 'text/plain')
    s.setAttribute('data-category', 'analytics')
    s.setAttribute('src', 'https://static.hotjar.com/c/hotjar.js')
    document.body.appendChild(s)
    scanBlocked()

    // Proxy skip attempt
    installAutoBlockProxy()
    const match: AutoBlockMatch = { serviceId: 'hotjar', category: 'analytics' }
    _holdElement(s, 'https://static.hotjar.com/c/hotjar.js', match)

    // Grant should inject exactly once (declarative path)
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1) // only one injection
    setTimeoutSpy.mockRestore()
    vi.runAllTimers()
    vi.useRealTimers()

    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('enqueueAutoDetected does not re-enqueue an element already STATE_EXECUTED', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    s.setAttribute('data-cookyay-state', STATE_EXECUTED) // already executed

    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    setTimeoutSpy.mockRestore()
  })

  it('two auto-detected elements with different src URLs are each enqueued once', () => {
    const s1 = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    const s2 = makeHeldScript('https://script.hotjar.com/modules.js', 'analytics')
    enqueueAutoDetected(s1, 'https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s2, 'https://script.hotjar.com/modules.js', 'analytics')

    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    // Two elements → two setTimeouts (same as declared behavior)
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2)
    vi.runAllTimers()
    vi.useRealTimers()
    setTimeoutSpy.mockRestore()

    expect(s1.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
    expect(s2.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })
})

// ---------------------------------------------------------------------------
// AC4 — Withdrawal posture consistent with declared third-party flow
// ---------------------------------------------------------------------------

describe('AC4 — withdrawal posture consistent with declared third-party flow', () => {
  const BASE_CONFIG = {
    policyVersion: 'v1',
    categories: {
      necessary: { services: [{ name: 'Session' }] },
      functional: { services: [{ name: 'Chat' }] },
      analytics: { services: [{ name: 'Hotjar' }] },
      marketing: { services: [{ name: 'YouTube' }] },
    },
  }

  it('withdrawal toast appears when an auto-detected analytics category is revoked', () => {
    // User previously granted analytics
    writeConsent(buildConsentRecord(
      { necessary: true, functional: false, analytics: true, marketing: false },
      'v1', '0.1.0', false,
    ))

    // Simulate an auto-detected analytics script having been injected (state=executed)
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    s.setAttribute('data-cookyay-state', STATE_EXECUTED) // already executed on prior grant

    init(BASE_CONFIG)
    mountPreferences(null)

    // User revokes analytics
    const analyticsSwitch = document.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!
    expect(analyticsSwitch.getAttribute('aria-checked')).toBe('true')
    analyticsSwitch.click() // now false

    document.querySelector<HTMLElement>('[data-cookyay-save]')!.click()

    // Withdrawal toast must appear (same as for declared elements)
    const toast = document.getElementById('cookyay-withdrawal-toast')
    expect(toast).not.toBeNull()
  })

  it('withdrawal toast does NOT appear when an auto-detected category is granted (not revoked)', () => {
    // User had no prior consent
    init(BASE_CONFIG)
    mountPreferences(null)

    // Enable analytics
    const analyticsSwitch = document.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!
    analyticsSwitch.click() // now true

    document.querySelector<HTMLElement>('[data-cookyay-save]')!.click()

    const toast = document.getElementById('cookyay-withdrawal-toast')
    expect(toast).toBeNull()
  })

  it('the withdrawal posture is identical for auto-detected and declared elements — both route through preferences.ts', () => {
    // This is a structural test: the withdrawal check in preferences.ts compares
    // the new choices against the previous consent record regardless of whether
    // the blocked scripts were declared or auto-detected. The mechanism is unified.
    //
    // We verify it by checking that a user who previously granted analytics,
    // regardless of whether any auto-detected element is present, sees the toast
    // when revoking analytics via preferences.
    writeConsent(buildConsentRecord(
      { necessary: true, functional: false, analytics: true, marketing: false },
      'v1', '0.1.0', false,
    ))
    init(BASE_CONFIG)
    mountPreferences(null)

    document.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!.click()
    document.querySelector<HTMLElement>('[data-cookyay-save]')!.click()

    expect(document.getElementById('cookyay-withdrawal-toast')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC5 — INP guard: setTimeout(fn, 0) stagger + a granted auto-detected script executes
// ---------------------------------------------------------------------------

describe('AC5 — INP guard: injection staggered; a granted auto-detected script executes', () => {
  it('grant schedules exactly one setTimeout(fn, 0) per auto-detected element', () => {
    const s1 = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    const s2 = makeHeldScript('https://script.hotjar.com/modules.js', 'analytics')
    const f1 = makeHeldIframe('https://www.youtube.com/embed/abc', 'marketing')

    enqueueAutoDetected(s1, 'https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s2, 'https://script.hotjar.com/modules.js', 'analytics')
    enqueueAutoDetected(f1, 'https://www.youtube.com/embed/abc', 'marketing')

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    // Two analytics elements → two setTimeouts
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2)
    for (const call of setTimeoutSpy.mock.calls) {
      expect(call[1]).toBe(0)
    }
    setTimeoutSpy.mockRestore()
  })

  it('a granted auto-detected script results in a live clone being inserted (AC5: executes)', () => {
    // This is the "a test that a granted auto-detected script executes" from the AC.
    // In jsdom, script execution requires the browser environment, but we can verify
    // the clone is created with the correct src (clone + reinsert happened).
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    // The clone is a real <script src=...> element (no type attribute, no text/plain)
    // which the browser would execute when inserted.
    const clone = document.body.querySelector<HTMLScriptElement>(
      `script[src="https://static.hotjar.com/c/hotjar.js"]`,
    )
    // The clone must exist (not be the original held element)
    expect(clone).not.toBeNull()
    expect(clone).not.toBe(s)
    // Clone must not have type=text/plain or data-cookyay-auto
    expect(clone!.getAttribute('type')).toBeNull()
    expect(clone!.getAttribute(ATTR_AUTO_DETECTED)).toBeNull()
    // Clone carries data-cookyay-state="executed" (set by blocking.ts before
    // assigning src to prevent the v5 proxy from re-intercepting the injection).
    expect(clone!.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
    // The original is also marked executed
    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('a granted auto-detected iframe has its src promoted (no clone — in-place promotion)', () => {
    const f = makeHeldIframe('https://www.youtube.com/embed/abc', 'marketing')
    enqueueAutoDetected(f, 'https://www.youtube.com/embed/abc', 'marketing')

    vi.useFakeTimers()
    grant('marketing')
    vi.runAllTimers()
    vi.useRealTimers()

    // data-src removed; src set
    expect(f.getAttribute('data-src')).toBeNull()
    expect(f.src).toContain('youtube.com')
    expect(f.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('injection does not happen synchronously (before setTimeout fires)', () => {
    const s = makeHeldScript('https://static.hotjar.com/c/hotjar.js', 'analytics')
    enqueueAutoDetected(s, 'https://static.hotjar.com/c/hotjar.js', 'analytics')

    vi.useFakeTimers()
    grant('analytics')

    // Before timers — no clone
    const noClone = document.body.querySelectorAll<HTMLScriptElement>(
      `script[src="https://static.hotjar.com/c/hotjar.js"]`,
    )
    expect(noClone.length).toBe(0)

    vi.runAllTimers()
    vi.useRealTimers()

    // After timers — clone present
    const clone = document.body.querySelectorAll<HTMLScriptElement>(
      `script[src="https://static.hotjar.com/c/hotjar.js"]`,
    )
    expect(clone.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Integration: full proxy → enqueue → grant flow (end-to-end via the proxy)
// ---------------------------------------------------------------------------

describe('Integration — proxy intercept → enqueueAutoDetected → grant → inject', () => {
  it('a script intercepted by the proxy is granted and clone-injected after grant()', () => {
    installAndActivate(makeHotjarMatcher())

    // Simulate a third party doing document.createElement('script'); el.src = '...'
    const s = document.createElement('script')
    s.src = 'https://static.hotjar.com/c/hotjar.js'

    // Proxy should have held it
    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)
    expect(s.getAttribute(ATTR_AUTO_DETECTED)).toBe('true')
    expect(getHeldElements()).toHaveLength(1)

    document.body.appendChild(s)

    // Now wire held elements into the blocking queue (task 005 API)
    const held = getHeldElements().splice(0)
    for (const { el, src, category } of held) {
      enqueueAutoDetected(el as HTMLScriptElement | HTMLIFrameElement, src, category)
    }

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    const clone = document.body.querySelector<HTMLScriptElement>(
      `script[src="https://static.hotjar.com/c/hotjar.js"]:not([data-cookyay-auto])`,
    )
    expect(clone).not.toBeNull()
    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('a proxy-intercepted iframe is granted and src-promoted after grant()', () => {
    installAndActivate(makeYoutubeMatcher())

    const f = document.createElement('iframe')
    f.src = 'https://www.youtube.com/embed/abc'

    expect(f.getAttribute(ATTR_AUTO_DETECTED)).toBe('true')
    expect(getHeldElements()).toHaveLength(1)

    document.body.appendChild(f)

    const held = getHeldElements().splice(0)
    for (const { el, src, category } of held) {
      enqueueAutoDetected(el as HTMLScriptElement | HTMLIFrameElement, src, category)
    }

    vi.useFakeTimers()
    grant('marketing')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(f.getAttribute('data-src')).toBeNull()
    expect(f.src).toContain('youtube.com')
    expect(f.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('via init({ autoBlock: true }) — held elements are enqueued and injectable after matcher resolves', async () => {
    // init() with autoBlock installs the proxy synchronously.
    // A script created after init() is staged by the shim.
    init({ policyVersion: '1.0', autoBlock: true })
    expect(isProxyInstalled()).toBe(true)

    const s = document.createElement('script')
    // Phase 1: shim captures this assignment into _staged, nothing fetches
    s.src = 'https://static.hotjar.com/c/hotjar.js'

    // Src not forwarded yet
    expect(s.getAttribute('src')).toBeNull()

    // Simulate DB chunk resolving: activateMatcher classifies staged → _held
    // (In real usage, api.ts does this in the import().then() callback.)
    activateMatcher(makeHotjarMatcher())

    // Now the element is in _held
    expect(getHeldElements()).toHaveLength(1)
    expect(getHeldElements()[0].category).toBe('analytics')
    expect(getHeldElements()[0].src).toBe('https://static.hotjar.com/c/hotjar.js')

    // Wire into blocking queue
    const held = getHeldElements().splice(0)
    for (const { el, src, category } of held) {
      enqueueAutoDetected(el as HTMLScriptElement | HTMLIFrameElement, src, category)
    }

    document.body.appendChild(s)

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    const clone = document.body.querySelector<HTMLScriptElement>(
      `script[src="https://static.hotjar.com/c/hotjar.js"]:not([data-cookyay-auto])`,
    )
    expect(clone).not.toBeNull()
    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })
})
