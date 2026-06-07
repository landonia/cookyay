/**
 * Task 010 — Google Consent Mode v2 integration acceptance-criteria tests
 *
 * AC1: Seven-signal map — correct gtag signal names and values for every
 *      category combination (accept all / reject all / granular / GPC)
 * AC2: gtag('consent','update', …) fires on every consent change via the
 *      cookyay:consent event — asserted via dataLayer inspection, no real
 *      Google scripts loaded
 * AC3: Defaults denied for ALL visitors (bootstrap fires default before update)
 * AC4: wait_for_update configurable via buildInlineSnippet; default is 500
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildConsentModeSignals,
  applyConsentModeUpdate,
  _resetConsentMode,
} from './consentmode.js'
import { _resetApi, init, _recordConsent } from './api.js'
import { _resetBanner } from './banner.js'
import { _resetGpc } from './gpc.js'
import { clearConsent } from './consent/index.js'
import { buildInlineSnippet, INLINE_SNIPPET_JS } from './snippet.js'

// ---------------------------------------------------------------------------
// dataLayer capture helper (GTM-style gtag stub — no real Google scripts)
// ---------------------------------------------------------------------------

type DataLayerEntry = IArguments | unknown[]

function setupGtag(): DataLayerEntry[] {
  const layer: DataLayerEntry[] = []
  window.dataLayer = layer as unknown[]
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    layer.push(arguments)
  }
  return layer
}

function getConsentUpdates(layer: DataLayerEntry[]): Array<Record<string, string>> {
  const updates: Array<Record<string, string>> = []
  for (const entry of layer) {
    const args = Array.from(entry as ArrayLike<unknown>)
    if (args[0] === 'consent' && args[1] === 'update') {
      updates.push(args[2] as Record<string, string>)
    }
  }
  return updates
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let dataLayer: DataLayerEntry[]

beforeEach(() => {
  dataLayer = setupGtag()
  clearConsent()
  document.body.innerHTML = ''
  document.head.querySelectorAll('style').forEach((s) => s.remove())
  // Arm __COOKYAY (bootstrap contract)
  window.__COOKYAY = { q: [], gpc: false }
})

afterEach(() => {
  _resetConsentMode()
  _resetGpc()
  _resetBanner()
  _resetApi()
  clearConsent()
  Reflect.deleteProperty(window, '__COOKYAY')
  Reflect.deleteProperty(window, 'dataLayer')
  Reflect.deleteProperty(window, 'gtag')
})

// ---------------------------------------------------------------------------
// AC1: Seven-signal map correctness
// ---------------------------------------------------------------------------

describe('AC1: buildConsentModeSignals — seven-signal map', () => {
  describe('accept all (all categories true)', () => {
    const signals = buildConsentModeSignals({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })

    it('grants functionality_storage (necessary → functionality)', () => {
      expect(signals.functionality_storage).toBe('granted')
    })
    it('grants security_storage (necessary → security)', () => {
      expect(signals.security_storage).toBe('granted')
    })
    it('grants personalization_storage (functional → personalization)', () => {
      expect(signals.personalization_storage).toBe('granted')
    })
    it('grants analytics_storage (analytics → analytics)', () => {
      expect(signals.analytics_storage).toBe('granted')
    })
    it('grants ad_storage (marketing → ad)', () => {
      expect(signals.ad_storage).toBe('granted')
    })
    it('grants ad_user_data (marketing → ad_user_data)', () => {
      expect(signals.ad_user_data).toBe('granted')
    })
    it('grants ad_personalization (marketing → ad_personalization)', () => {
      expect(signals.ad_personalization).toBe('granted')
    })
  })

  describe('reject all (only necessary true)', () => {
    const signals = buildConsentModeSignals({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    })

    it('grants functionality_storage (necessary always granted)', () => {
      expect(signals.functionality_storage).toBe('granted')
    })
    it('grants security_storage (necessary always granted)', () => {
      expect(signals.security_storage).toBe('granted')
    })
    it('denies personalization_storage (functional denied)', () => {
      expect(signals.personalization_storage).toBe('denied')
    })
    it('denies analytics_storage (analytics denied)', () => {
      expect(signals.analytics_storage).toBe('denied')
    })
    it('denies ad_storage (marketing denied)', () => {
      expect(signals.ad_storage).toBe('denied')
    })
    it('denies ad_user_data (marketing denied)', () => {
      expect(signals.ad_user_data).toBe('denied')
    })
    it('denies ad_personalization (marketing denied)', () => {
      expect(signals.ad_personalization).toBe('denied')
    })
  })

  describe('granular: analytics only', () => {
    const signals = buildConsentModeSignals({
      necessary: true,
      functional: false,
      analytics: true,
      marketing: false,
    })

    it('grants analytics_storage only', () => {
      expect(signals.analytics_storage).toBe('granted')
    })
    it('denies personalization_storage', () => {
      expect(signals.personalization_storage).toBe('denied')
    })
    it('denies ad signals', () => {
      expect(signals.ad_storage).toBe('denied')
      expect(signals.ad_user_data).toBe('denied')
      expect(signals.ad_personalization).toBe('denied')
    })
  })

  describe('granular: functional + marketing, no analytics', () => {
    const signals = buildConsentModeSignals({
      necessary: true,
      functional: true,
      analytics: false,
      marketing: true,
    })

    it('grants personalization_storage', () => {
      expect(signals.personalization_storage).toBe('granted')
    })
    it('denies analytics_storage', () => {
      expect(signals.analytics_storage).toBe('denied')
    })
    it('grants all three ad signals', () => {
      expect(signals.ad_storage).toBe('granted')
      expect(signals.ad_user_data).toBe('granted')
      expect(signals.ad_personalization).toBe('granted')
    })
  })

  it('signals object has exactly seven keys', () => {
    const signals = buildConsentModeSignals({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    })
    expect(Object.keys(signals)).toHaveLength(7)
  })
})

// ---------------------------------------------------------------------------
// AC2: gtag('consent','update') fires on every consent change
// ---------------------------------------------------------------------------

describe('AC2: update fires on every consent change via cookyay:consent', () => {
  it('fires on accept-all via init + banner interaction', () => {
    init({ policyVersion: 'v1' })
    _recordConsent({ necessary: true, functional: true, analytics: true, marketing: true })
    const updates = getConsentUpdates(dataLayer)
    expect(updates.length).toBeGreaterThanOrEqual(1)
    const last = updates[updates.length - 1]!
    expect(last.functionality_storage).toBe('granted')
    expect(last.analytics_storage).toBe('granted')
    expect(last.ad_storage).toBe('granted')
  })

  it('fires on reject-all', () => {
    init({ policyVersion: 'v1' })
    _recordConsent({ necessary: true, functional: false, analytics: false, marketing: false })
    const updates = getConsentUpdates(dataLayer)
    expect(updates.length).toBeGreaterThanOrEqual(1)
    const last = updates[updates.length - 1]!
    expect(last.functionality_storage).toBe('granted')
    expect(last.analytics_storage).toBe('denied')
    expect(last.ad_storage).toBe('denied')
  })

  it('fires on granular save', () => {
    init({ policyVersion: 'v1' })
    _recordConsent({ necessary: true, functional: false, analytics: true, marketing: false })
    const updates = getConsentUpdates(dataLayer)
    expect(updates.length).toBeGreaterThanOrEqual(1)
    const last = updates[updates.length - 1]!
    expect(last.analytics_storage).toBe('granted')
    expect(last.personalization_storage).toBe('denied')
    expect(last.ad_storage).toBe('denied')
  })

  it('fires on GPC (via init with gpc active)', () => {
    window.__COOKYAY = { q: [], gpc: true }
    init({ policyVersion: 'v1' })
    // GPC path: _recordConsent called by gpc.ts with functional/analytics/marketing denied
    const updates = getConsentUpdates(dataLayer)
    expect(updates.length).toBeGreaterThanOrEqual(1)
    const last = updates[updates.length - 1]!
    expect(last.analytics_storage).toBe('denied')
    expect(last.ad_storage).toBe('denied')
    expect(last.functionality_storage).toBe('granted')
  })

  it('fires on every sequential consent change', () => {
    init({ policyVersion: 'v1' })
    _recordConsent({ necessary: true, functional: false, analytics: false, marketing: false })
    _recordConsent({ necessary: true, functional: true, analytics: true, marketing: true })
    const updates = getConsentUpdates(dataLayer)
    expect(updates.length).toBeGreaterThanOrEqual(2)
  })

  it('no-ops when gtag is not a function', () => {
    Reflect.deleteProperty(window, 'gtag')
    // Should not throw
    expect(() =>
      applyConsentModeUpdate({
        necessary: true,
        functional: false,
        analytics: false,
        marketing: false,
      }),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// AC3: Defaults denied for ALL visitors
// ---------------------------------------------------------------------------

describe('AC3: Defaults are denied for all visitors', () => {
  it('buildInlineSnippet includes all-denied defaults', () => {
    const snippet = buildInlineSnippet()
    expect(snippet).toContain('ad_storage:"denied"')
    expect(snippet).toContain('analytics_storage:"denied"')
    expect(snippet).toContain('ad_user_data:"denied"')
    expect(snippet).toContain('ad_personalization:"denied"')
    expect(snippet).toContain('functionality_storage:"denied"')
    expect(snippet).toContain('personalization_storage:"denied"')
    expect(snippet).toContain('security_storage:"denied"')
  })

  it('defaults fire as "default" not "update" (snippet uses consent default)', () => {
    const snippet = buildInlineSnippet()
    expect(snippet).toContain('"default"')
    expect(snippet).not.toContain('"update"')
  })

  it('update never fires before _recordConsent is called', () => {
    // After init without GPC and without any user action, no update should fire
    init({ policyVersion: 'v1' })
    const updates = getConsentUpdates(dataLayer)
    expect(updates).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// AC4: wait_for_update is configurable with default 500
// ---------------------------------------------------------------------------

describe('AC4: wait_for_update configurability', () => {
  it('default snippet has wait_for_update:500', () => {
    const snippet = buildInlineSnippet()
    expect(snippet).toContain('wait_for_update:500')
  })

  it('buildInlineSnippet accepts custom wait_for_update value', () => {
    const snippet = buildInlineSnippet(1000)
    expect(snippet).toContain('wait_for_update:1000')
    expect(snippet).not.toContain('wait_for_update:500')
  })

  it('buildInlineSnippet with 300ms produces correct snippet', () => {
    const snippet = buildInlineSnippet(300)
    expect(snippet).toContain('wait_for_update:300')
  })

  it('INLINE_SNIPPET_JS uses default 500 (backward compat)', () => {
    expect(INLINE_SNIPPET_JS).toContain('wait_for_update:500')
  })
})

// ---------------------------------------------------------------------------
// Signal values are exactly 'granted' | 'denied' (no typos)
// ---------------------------------------------------------------------------

describe('Signal value type safety', () => {
  it('all values are strictly "granted" or "denied"', () => {
    const allTrue = buildConsentModeSignals({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
    for (const v of Object.values(allTrue)) {
      expect(['granted', 'denied']).toContain(v)
    }
    const allFalse = buildConsentModeSignals({
      necessary: false,
      functional: false,
      analytics: false,
      marketing: false,
    })
    for (const v of Object.values(allFalse)) {
      expect(['granted', 'denied']).toContain(v)
    }
  })
})
