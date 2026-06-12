// Config validation + public API unit tests (task 006)
//
// Covers: init() validation, no-op on re-run, debug logging, getConsent(),
// onConsent() immediate-fire + unsubscribe, _recordConsent() events + listeners,
// openPreferences() event, data-cookyay-open click delegation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _recordConsent, _resetApi, getConsent, init, onConsent, openPreferences } from './api.js'
import type { CategoryConfig, CookyayConfig } from './config.js'
import { validateConfig } from './config.js'
import { clearConsent, writeConsent, buildConsentRecord } from './consent/index.js'
import type { CategoryId } from './consent/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: CookyayConfig = {
  policyVersion: '1.0',
  categories: {
    analytics: { services: [{ name: 'Google Analytics' }] },
    marketing: { services: [{ name: 'Meta Pixel' }] },
  },
}

function allDenied(): Record<CategoryId, boolean> {
  return { necessary: true, functional: false, analytics: false, marketing: false }
}

function allGranted(): Record<CategoryId, boolean> {
  return { necessary: true, functional: true, analytics: true, marketing: true }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetApi()
  clearConsent()
  document.body.innerHTML = ''
})

afterEach(() => {
  _resetApi()
  clearConsent()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// validateConfig — unit tests (pure function, no state)
// ---------------------------------------------------------------------------

describe('validateConfig', () => {
  it('returns no warnings for a valid minimal config', () => {
    expect(validateConfig({ policyVersion: '1.0' })).toEqual([])
  })

  it('returns a fatal warning when policyVersion is missing', () => {
    const warnings = validateConfig({ policyVersion: '' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('MISSING_POLICY_VERSION')
    expect(warnings[0].fatal).toBe(true)
  })

  it('returns a warning for an unknown category key', () => {
    const warnings = validateConfig({
      policyVersion: '1.0',
      categories: { unknown: {} } as unknown as Partial<Record<CategoryId, CategoryConfig>>,
    })
    expect(warnings.some((w) => w.code === 'UNKNOWN_CATEGORY')).toBe(true)
    expect(warnings[0].message).toContain('unknown')
  })

  it('returns a warning for a non-necessary category with no services', () => {
    const warnings = validateConfig({
      policyVersion: '1.0',
      categories: { analytics: { services: [] } },
    })
    expect(warnings.some((w) => w.code === 'EMPTY_CATEGORY')).toBe(true)
  })

  it('does not warn about empty services for "necessary" category', () => {
    const warnings = validateConfig({
      policyVersion: '1.0',
      categories: { necessary: {} },
    })
    expect(warnings.some((w) => w.code === 'EMPTY_CATEGORY')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// init() — validation path
// ---------------------------------------------------------------------------

describe('init() — validation warnings', () => {
  it('emits console.warn for each config problem', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    init({ policyVersion: '' })
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain('[Cookyay]')
  })

  it('does not initialise when policyVersion is missing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    init({ policyVersion: '' })
    // getConsent should still warn about no init
    const warnSpy2 = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const consent = getConsent()
    expect(warnSpy2).toHaveBeenCalled()
    expect(consent).toEqual({})
  })

  it('warns for unknown category but still initialises (non-fatal)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    init({
      policyVersion: '1.0',
      categories: { badcat: {} } as unknown as Partial<Record<CategoryId, CategoryConfig>>,
    })
    expect(warnSpy).toHaveBeenCalled()
    // Should still be initialised — getConsent should not warn about missing init
    vi.restoreAllMocks()
    const warnSpy2 = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getConsent()
    expect(warnSpy2).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// init() — no-op on re-run
// ---------------------------------------------------------------------------

describe('init() — idempotency', () => {
  it('second init() call is a no-op and emits a warn', () => {
    init(BASE_CONFIG)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    init({ policyVersion: '2.0' })
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain('more than once')
    // Config should not have changed
    expect(getConsent()).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// init() — debug logging
// ---------------------------------------------------------------------------

describe('init() — debug mode', () => {
  it('logs verbose messages when debug: true', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    init({ ...BASE_CONFIG, debug: true })
    expect(logSpy).toHaveBeenCalled()
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('[Cookyay debug]'))).toBe(true)
  })

  it('does not log debug messages when debug is omitted', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    init(BASE_CONFIG)
    expect(logSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getConsent()
// ---------------------------------------------------------------------------

describe('getConsent()', () => {
  it('returns empty object and warns when called before init()', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getConsent()).toEqual({})
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns empty object when no consent is stored', () => {
    init(BASE_CONFIG)
    expect(getConsent()).toEqual({})
  })

  it('returns stored category choices', () => {
    writeConsent(buildConsentRecord(allGranted(), '1.0', '0.1.0', false))
    init(BASE_CONFIG)
    const consent = getConsent()
    expect(consent).toEqual(allGranted())
  })

  it('returns empty object when stored policyVersion does not match', () => {
    writeConsent(buildConsentRecord(allGranted(), 'old-version', '0.1.0', false))
    init(BASE_CONFIG)
    expect(getConsent()).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// onConsent() — immediate fire
// ---------------------------------------------------------------------------

describe('onConsent() — immediate fire if already consented', () => {
  it('fires callback immediately when consent is already stored for that category', () => {
    writeConsent(buildConsentRecord(allGranted(), '1.0', '0.1.0', false))
    init(BASE_CONFIG)

    const cb = vi.fn()
    onConsent('analytics', cb)
    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith(true)
  })

  it('fires callback with false when category is denied in stored record', () => {
    writeConsent(buildConsentRecord(allDenied(), '1.0', '0.1.0', false))
    init(BASE_CONFIG)

    const cb = vi.fn()
    onConsent('analytics', cb)
    expect(cb).toHaveBeenCalledWith(false)
  })

  it('does not fire immediately when no consent is stored', () => {
    init(BASE_CONFIG)
    const cb = vi.fn()
    onConsent('analytics', cb)
    expect(cb).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// onConsent() — future consent notifications
// ---------------------------------------------------------------------------

describe('onConsent() — future notifications via _recordConsent', () => {
  it('fires callback when a matching category is granted', () => {
    init(BASE_CONFIG)
    const cb = vi.fn()
    onConsent('analytics', cb)

    _recordConsent(allGranted())
    expect(cb).toHaveBeenCalledWith(true)
  })

  it('fires callback with false when category is denied', () => {
    init(BASE_CONFIG)
    const cb = vi.fn()
    onConsent('marketing', cb)

    _recordConsent(allDenied())
    expect(cb).toHaveBeenCalledWith(false)
  })

  it('does not fire callback after unsubscribe', () => {
    init(BASE_CONFIG)
    const cb = vi.fn()
    const unsub = onConsent('analytics', cb)
    unsub()

    _recordConsent(allGranted())
    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribe of one listener does not affect others for same category', () => {
    init(BASE_CONFIG)
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const unsub1 = onConsent('analytics', cb1)
    onConsent('analytics', cb2)
    unsub1()

    _recordConsent(allGranted())
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalled()
  })

  it('listener exceptions do not prevent other listeners from firing', () => {
    init(BASE_CONFIG)
    const throwing = vi.fn().mockImplementation(() => {
      throw new Error('oops')
    })
    const cb = vi.fn()
    onConsent('analytics', throwing)
    onConsent('analytics', cb)

    _recordConsent(allGranted())
    expect(cb).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// _recordConsent() — CustomEvents
// ---------------------------------------------------------------------------

describe('_recordConsent() — cookyay:consent event', () => {
  it('dispatches cookyay:consent on document', () => {
    init(BASE_CONFIG)
    const handler = vi.fn()
    document.addEventListener('cookyay:consent', handler)

    _recordConsent(allGranted())

    document.removeEventListener('cookyay:consent', handler)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('event detail carries schemaVersion', () => {
    init(BASE_CONFIG)
    let detail: Record<string, unknown> | null = null
    document.addEventListener('cookyay:consent', (e) => {
      detail = (e as CustomEvent).detail as Record<string, unknown>
    })

    _recordConsent(allGranted())
    expect(detail).not.toBeNull()
    expect(detail!['schemaVersion']).toBe(1)
  })

  it('event detail carries policyVersion', () => {
    init(BASE_CONFIG)
    let detail: Record<string, unknown> | null = null
    document.addEventListener('cookyay:consent', (e) => {
      detail = (e as CustomEvent).detail as Record<string, unknown>
    })

    _recordConsent(allGranted())
    expect(detail!['policyVersion']).toBe('1.0')
  })

  it('event detail carries category choices', () => {
    init(BASE_CONFIG)
    let detail: Record<string, unknown> | null = null
    document.addEventListener('cookyay:consent', (e) => {
      detail = (e as CustomEvent).detail as Record<string, unknown>
    })

    _recordConsent(allGranted())
    const cats = detail!['categories'] as Record<string, boolean>
    expect(cats['analytics']).toBe(true)
    expect(cats['marketing']).toBe(true)
  })
})

describe('_recordConsent() — cookyay:change event', () => {
  it('does not dispatch cookyay:change on first consent (no previous record)', () => {
    init(BASE_CONFIG)
    const handler = vi.fn()
    document.addEventListener('cookyay:change', handler)

    _recordConsent(allGranted())

    document.removeEventListener('cookyay:change', handler)
    expect(handler).not.toHaveBeenCalled()
  })

  it('dispatches cookyay:change when choices differ from previous record', () => {
    init(BASE_CONFIG)
    _recordConsent(allDenied())

    const handler = vi.fn()
    document.addEventListener('cookyay:change', handler)
    _recordConsent(allGranted())

    document.removeEventListener('cookyay:change', handler)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('does not dispatch cookyay:change when choices are identical', () => {
    init(BASE_CONFIG)
    _recordConsent(allGranted())

    const handler = vi.fn()
    document.addEventListener('cookyay:change', handler)
    _recordConsent(allGranted())

    document.removeEventListener('cookyay:change', handler)
    expect(handler).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// openPreferences()
// ---------------------------------------------------------------------------

describe('openPreferences()', () => {
  it('dispatches cookyay:open-preferences on document', () => {
    init(BASE_CONFIG)
    const handler = vi.fn()
    document.addEventListener('cookyay:open-preferences', handler)

    openPreferences()

    document.removeEventListener('cookyay:open-preferences', handler)
    expect(handler).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// data-cookyay-open binding
// ---------------------------------------------------------------------------

describe('data-cookyay-open click delegation', () => {
  it('clicking a data-cookyay-open element dispatches cookyay:open-preferences', () => {
    init(BASE_CONFIG)
    const btn = document.createElement('button')
    btn.setAttribute('data-cookyay-open', '')
    document.body.appendChild(btn)

    const handler = vi.fn()
    document.addEventListener('cookyay:open-preferences', handler)
    btn.click()
    document.removeEventListener('cookyay:open-preferences', handler)

    expect(handler).toHaveBeenCalledOnce()
  })

  it('clicking a child of a data-cookyay-open element also triggers it', () => {
    init(BASE_CONFIG)
    const link = document.createElement('a')
    link.setAttribute('data-cookyay-open', '')
    link.href = '#'
    const span = document.createElement('span')
    span.textContent = 'Settings'
    link.appendChild(span)
    document.body.appendChild(link)

    const handler = vi.fn()
    document.addEventListener('cookyay:open-preferences', handler)
    span.click()
    document.removeEventListener('cookyay:open-preferences', handler)

    expect(handler).toHaveBeenCalledOnce()
  })

  it('clicking a non-open element does not dispatch the event', () => {
    init(BASE_CONFIG)
    const other = document.createElement('button')
    other.textContent = 'Other'
    document.body.appendChild(other)

    const handler = vi.fn()
    document.addEventListener('cookyay:open-preferences', handler)
    other.click()
    document.removeEventListener('cookyay:open-preferences', handler)

    expect(handler).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// init() — DOM cross-check (criterion 4, data-category mismatch)
// ---------------------------------------------------------------------------

describe('init() — DOM data-category cross-check', () => {
  it("(a) warns when a blocked script has a typo'd data-category", () => {
    const s = document.createElement('script')
    s.setAttribute('type', 'text/plain')
    s.setAttribute('data-category', 'analytcis') // deliberate typo
    document.body.appendChild(s)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    init(BASE_CONFIG)

    const msgs = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(msgs.some((m) => m.includes('[Cookyay]') || m.includes('unknown category'))).toBe(true)
  })

  it("(b) warns when an iframe has a typo'd data-category", () => {
    const f = document.createElement('iframe')
    f.setAttribute('data-src', 'https://example.com/embed')
    f.setAttribute('data-category', 'marketting') // deliberate typo
    document.body.appendChild(f)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    init(BASE_CONFIG)

    const msgs = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(msgs.some((m) => m.includes('[Cookyay]') || m.includes('unknown category'))).toBe(true)
  })

  it('(c) emits no extra warning when all data-category values are valid', () => {
    const s = document.createElement('script')
    s.setAttribute('type', 'text/plain')
    s.setAttribute('data-category', 'analytics')
    document.body.appendChild(s)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    init(BASE_CONFIG)

    // Only EMPTY_CATEGORY warning for functional (no services in BASE_CONFIG) is acceptable;
    // there must be NO "unknown category" warning
    const msgs = warnSpy.mock.calls.map((c) => String(c[0]) + String(c[1] ?? ''))
    expect(msgs.some((m) => m.includes('unknown category'))).toBe(false)
  })

  it('(d) re-scans on DOMContentLoaded when readyState is "loading"', () => {
    // Simulate parsing still in progress by mocking readyState
    const readyStateSpy = vi
      .spyOn(Object.getPrototypeOf(document) as Document, 'readyState', 'get')
      .mockReturnValue('loading')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    init(BASE_CONFIG)

    readyStateSpy.mockRestore()

    // Add an element with unknown category AFTER init (simulates late-parsed body content)
    const s = document.createElement('script')
    s.setAttribute('type', 'text/plain')
    s.setAttribute('data-category', 'badcat')
    document.body.appendChild(s)

    // Fire DOMContentLoaded to trigger the deferred scan
    document.dispatchEvent(new Event('DOMContentLoaded'))

    const msgs = warnSpy.mock.calls.map((c) => String(c[0]) + String(c[1] ?? ''))
    expect(msgs.some((m) => m.includes('unknown category'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Returning-visitor grant replay (PRD §3.2 — blocked scripts execute on every
// visit after consent, not just the visit where consent was given)
// ---------------------------------------------------------------------------

describe('returning-visitor grant replay', () => {
  function makeBlockedScript(category: string): HTMLScriptElement {
    const s = document.createElement('script')
    s.setAttribute('type', 'text/plain')
    s.setAttribute('data-category', category)
    s.textContent = 'window.__replayRan = true'
    document.body.appendChild(s)
    return s
  }

  function storeConsent(categories: Record<CategoryId, boolean>): void {
    const record = buildConsentRecord(categories, '1.0', '0.1.0', false)
    writeConsent(record, {})
  }

  it('grants previously-consented categories at init (script reaches executed state)', () => {
    vi.useFakeTimers()
    storeConsent(allGranted())
    const s = makeBlockedScript('analytics')

    init(BASE_CONFIG)
    vi.runAllTimers()

    expect(s.getAttribute('data-cookyay-state')).toBe('executed')
    vi.useRealTimers()
  })

  it('leaves denied categories blocked at init', () => {
    vi.useFakeTimers()
    storeConsent(allDenied())
    const s = makeBlockedScript('analytics')

    init(BASE_CONFIG)
    vi.runAllTimers()

    expect(s.getAttribute('data-cookyay-state')).toBe('blocked')
    vi.useRealTimers()
  })

  it('grants only the consented categories, not others', () => {
    vi.useFakeTimers()
    storeConsent({ necessary: true, functional: false, analytics: true, marketing: false })
    const analytics = makeBlockedScript('analytics')
    const marketing = makeBlockedScript('marketing')

    init(BASE_CONFIG)
    vi.runAllTimers()

    expect(analytics.getAttribute('data-cookyay-state')).toBe('executed')
    expect(marketing.getAttribute('data-cookyay-state')).toBe('blocked')
    vi.useRealTimers()
  })

  it('is a no-op when no consent record is stored (first visit)', () => {
    vi.useFakeTimers()
    const s = makeBlockedScript('analytics')

    init(BASE_CONFIG)
    vi.runAllTimers()

    expect(s.getAttribute('data-cookyay-state')).toBe('blocked')
    vi.useRealTimers()
  })

  it('replays grants for late-parsed elements after the DOMContentLoaded re-scan', () => {
    vi.useFakeTimers()
    storeConsent(allGranted())

    // Simulate init() running from <head> while parsing is still in progress
    const readyStateSpy = vi
      .spyOn(Object.getPrototypeOf(document) as Document, 'readyState', 'get')
      .mockReturnValue('loading')
    init(BASE_CONFIG)
    readyStateSpy.mockRestore()

    // Element parsed after init (body content)
    const late = makeBlockedScript('analytics')

    document.dispatchEvent(new Event('DOMContentLoaded'))
    vi.runAllTimers()

    expect(late.getAttribute('data-cookyay-state')).toBe('executed')
    vi.useRealTimers()
  })

  it('does not replay grants for a record invalidated by a policy-version bump', () => {
    vi.useFakeTimers()
    // Record stored under an OLD policy version
    const record = buildConsentRecord(allGranted(), '0.9', '0.1.0', false)
    writeConsent(record, {})
    const s = makeBlockedScript('analytics')

    // init with policyVersion '1.0' — stored record no longer valid → re-prompt, no grants
    init(BASE_CONFIG)
    vi.runAllTimers()

    expect(s.getAttribute('data-cookyay-state')).toBe('blocked')
    vi.useRealTimers()
  })
})
