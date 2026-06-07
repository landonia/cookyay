import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyBootstrap } from './bootstrap.js'
import { INLINE_SNIPPET_JS } from './snippet.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetBootstrapState() {
  delete (window as Partial<Window>).__COOKYAY
  delete (window as Partial<Window>).gtag
  delete (window as Partial<Window>).dataLayer
  document.cookie = 'cookyay_consent=; Max-Age=0; Path=/'
}

function setCookiePayload(c: { n: boolean; f: boolean; a: boolean; m: boolean }) {
  const payload = { sv: 1, t: Math.floor(Date.now() / 1000), pv: '1.0', bv: '0.1.0', c, gpc: false }
  document.cookie = `cookyay_consent=${encodeURIComponent(JSON.stringify(payload))}; Path=/`
}

/** Return the first dataLayer entry as a plain array */
function firstDataLayerEntry(): unknown[] {
  const entry = (window.dataLayer as unknown[])[0]
  return Array.from(entry as ArrayLike<unknown>)
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetBootstrapState()
})

afterEach(() => {
  resetBootstrapState()
})

// ---------------------------------------------------------------------------
// applyBootstrap — no stored consent (first-time visitor)
// ---------------------------------------------------------------------------

describe('applyBootstrap — no stored consent', () => {
  it('initialises window.__COOKYAY with empty queue and gpc:false', () => {
    applyBootstrap()
    expect(window.__COOKYAY).toBeDefined()
    expect(window.__COOKYAY.q).toEqual([])
    expect(window.__COOKYAY.gpc).toBe(false)
  })

  it('stubs window.dataLayer as an empty array when absent', () => {
    applyBootstrap()
    expect(Array.isArray(window.dataLayer)).toBe(true)
  })

  it('stubs window.gtag as a function when absent', () => {
    applyBootstrap()
    expect(typeof window.gtag).toBe('function')
  })

  it('fires gtag consent default as the first dataLayer entry', () => {
    applyBootstrap()
    const entry = firstDataLayerEntry()
    expect(entry[0]).toBe('consent')
    expect(entry[1]).toBe('default')
  })

  it('all ad/analytics/personalization signals are denied for first-time visitor', () => {
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.ad_storage).toBe('denied')
    expect(defaults.analytics_storage).toBe('denied')
    expect(defaults.ad_user_data).toBe('denied')
    expect(defaults.ad_personalization).toBe('denied')
    expect(defaults.personalization_storage).toBe('denied')
  })

  it('functionality_storage and security_storage are denied for first-time visitor (strictest-everywhere)', () => {
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.functionality_storage).toBe('denied')
    expect(defaults.security_storage).toBe('denied')
  })

  it('sets wait_for_update to 500', () => {
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.wait_for_update).toBe(500)
  })

  it('all seven Consent Mode v2 signals are present', () => {
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    const required = [
      'ad_storage',
      'analytics_storage',
      'ad_user_data',
      'ad_personalization',
      'functionality_storage',
      'personalization_storage',
      'security_storage',
    ]
    for (const signal of required) {
      expect(defaults).toHaveProperty(signal)
    }
  })
})

// ---------------------------------------------------------------------------
// applyBootstrap — returning visitor with stored consent
// ---------------------------------------------------------------------------

describe('applyBootstrap — returning visitor (stored consent)', () => {
  it('grants analytics_storage when analytics category is true', () => {
    setCookiePayload({ n: true, f: false, a: true, m: false })
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.analytics_storage).toBe('granted')
    expect(defaults.ad_storage).toBe('denied')
  })

  it('grants ad signals when marketing category is true', () => {
    setCookiePayload({ n: true, f: false, a: false, m: true })
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.ad_storage).toBe('granted')
    expect(defaults.ad_user_data).toBe('granted')
    expect(defaults.ad_personalization).toBe('granted')
    expect(defaults.analytics_storage).toBe('denied')
  })

  it('grants functionality_storage and personalization_storage when functional category is true', () => {
    setCookiePayload({ n: true, f: true, a: false, m: false })
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.functionality_storage).toBe('granted')
    expect(defaults.personalization_storage).toBe('granted')
    expect(defaults.analytics_storage).toBe('denied')
  })

  it('grants all non-necessary signals when all categories are true', () => {
    setCookiePayload({ n: true, f: true, a: true, m: true })
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.ad_storage).toBe('granted')
    expect(defaults.analytics_storage).toBe('granted')
    expect(defaults.ad_user_data).toBe('granted')
    expect(defaults.ad_personalization).toBe('granted')
    expect(defaults.personalization_storage).toBe('granted')
    // granted via c.n mapping, not a hardcoded default
    expect(defaults.functionality_storage).toBe('granted')
    expect(defaults.security_storage).toBe('granted')
  })

  it('keeps denied signals when only necessary category is true', () => {
    setCookiePayload({ n: true, f: false, a: false, m: false })
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.ad_storage).toBe('denied')
    expect(defaults.analytics_storage).toBe('denied')
    expect(defaults.personalization_storage).toBe('denied')
  })

  it('necessary category (c.n) grants functionality_storage and security_storage', () => {
    setCookiePayload({ n: true, f: false, a: false, m: false })
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.functionality_storage).toBe('granted')
    expect(defaults.security_storage).toBe('granted')
  })

  it('functional category (c.f) alone grants functionality_storage and personalization_storage', () => {
    // c.n=false is not a real-world case (necessary is always true) but tests the mapping independently
    setCookiePayload({ n: false, f: true, a: false, m: false })
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.functionality_storage).toBe('granted')
    expect(defaults.personalization_storage).toBe('granted')
    expect(defaults.security_storage).toBe('denied')
    expect(defaults.analytics_storage).toBe('denied')
  })

  it('ignores a malformed cookie and falls back to all-denied', () => {
    document.cookie = 'cookyay_consent=not-valid-json; Path=/'
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.ad_storage).toBe('denied')
    expect(defaults.analytics_storage).toBe('denied')
  })

  it('ignores a cookie with an unknown schema version', () => {
    const payload = { sv: 99, t: 0, pv: '1.0', bv: '0.1.0', c: { n: true, f: true, a: true, m: true }, gpc: false }
    document.cookie = `cookyay_consent=${encodeURIComponent(JSON.stringify(payload))}; Path=/`
    applyBootstrap()
    const defaults = firstDataLayerEntry()[2] as Record<string, unknown>
    expect(defaults.ad_storage).toBe('denied')
    expect(defaults.analytics_storage).toBe('denied')
  })
})

// ---------------------------------------------------------------------------
// GPC detection
// ---------------------------------------------------------------------------

describe('applyBootstrap — GPC detection', () => {
  it('records gpc:false when navigator.globalPrivacyControl is absent', () => {
    applyBootstrap()
    expect(window.__COOKYAY.gpc).toBe(false)
  })

  it('records gpc:true when navigator.globalPrivacyControl is true', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
    })
    applyBootstrap()
    expect(window.__COOKYAY.gpc).toBe(true)
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: undefined,
      configurable: true,
    })
  })
})

// ---------------------------------------------------------------------------
// Intercept queue arming (contract for task 005)
// ---------------------------------------------------------------------------

describe('applyBootstrap — intercept queue', () => {
  it('arms window.__COOKYAY.q as an empty array', () => {
    applyBootstrap()
    expect(Array.isArray(window.__COOKYAY.q)).toBe(true)
    expect(window.__COOKYAY.q).toHaveLength(0)
  })

  it('does not overwrite an existing __COOKYAY object (idempotent arm)', () => {
    const pre = { q: [] as Element[], gpc: false }
    ;(window as Window).__COOKYAY = pre
    applyBootstrap()
    // The same reference should be preserved (we only set if absent)
    expect(window.__COOKYAY).toBe(pre)
  })

  it('does not overwrite an existing window.gtag', () => {
    const existing = vi.fn()
    window.gtag = existing
    applyBootstrap()
    expect(window.gtag).toBe(existing)
  })

  it('does not overwrite a pre-existing window.dataLayer', () => {
    const existing: unknown[] = ['pre-existing']
    window.dataLayer = existing
    applyBootstrap()
    expect(window.dataLayer[0]).toBe('pre-existing')
  })
})

// ---------------------------------------------------------------------------
// Ordering: consent default fires before simulated gtag.js load
// ---------------------------------------------------------------------------

describe('ordering — consent default precedes simulated gtag.js load', () => {
  it('consent default is the first entry in dataLayer before gtag.js fires', () => {
    applyBootstrap()

    // Simulate what gtag.js does when it loads: it pushes 'js' and 'config'
    window.gtag('js', new Date())
    window.gtag('config', 'G-XXXXXXX')

    expect(window.dataLayer).toHaveLength(3)
    // Entry 0 must be the consent default
    const first = Array.from((window.dataLayer as unknown[])[0] as ArrayLike<unknown>)
    expect(first[0]).toBe('consent')
    expect(first[1]).toBe('default')

    const second = Array.from((window.dataLayer as unknown[])[1] as ArrayLike<unknown>)
    expect(second[0]).toBe('js')

    const third = Array.from((window.dataLayer as unknown[])[2] as ArrayLike<unknown>)
    expect(third[0]).toBe('config')
  })

  it('INLINE_SNIPPET_JS fires consent default before simulated gtag.js entries', () => {
    // Safe: INLINE_SNIPPET_JS is a compile-time constant from our own source,
    // not user input. eval() is the only way to run an HTML-embeddable snippet
    // in jsdom and verify its dataLayer ordering behaviour.
    eval(INLINE_SNIPPET_JS)

    // Simulate gtag.js loading
    window.gtag('js', new Date())

    expect((window.dataLayer as unknown[]).length).toBeGreaterThanOrEqual(2)
    const first = Array.from((window.dataLayer as unknown[])[0] as ArrayLike<unknown>)
    expect(first[0]).toBe('consent')
    expect(first[1]).toBe('default')

    const second = Array.from((window.dataLayer as unknown[])[1] as ArrayLike<unknown>)
    expect(second[0]).toBe('js')
  })

  it('INLINE_SNIPPET_JS consent defaults include all seven signals', () => {
    // Safe: same as above — compile-time constant, not user input.
    eval(INLINE_SNIPPET_JS)
    const defaults = Array.from((window.dataLayer as unknown[])[0] as ArrayLike<unknown>)[2] as Record<string, unknown>
    for (const signal of [
      'ad_storage',
      'analytics_storage',
      'ad_user_data',
      'ad_personalization',
      'functionality_storage',
      'personalization_storage',
      'security_storage',
    ]) {
      expect(defaults).toHaveProperty(signal)
    }
    expect(defaults.wait_for_update).toBe(500)
  })
})
