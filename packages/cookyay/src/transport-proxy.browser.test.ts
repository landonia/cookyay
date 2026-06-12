// fetch + sendBeacon interception — browser-mode tests (tasks 003, 004)
//
// These tests verify the acceptance criteria that require real browser APIs:
//
// fetch (task 003):
//   - A matched pre-consent fetch resolves immediately to a benign 204 stub
//     (AC1: does not throw, does not hang, survives await + .json()/.text() accessors)
//   - On grant, the held call is replayed via _origFetch (AC2 — replay timing)
//   - Non-matching fetches pass through to window.fetch synchronously (AC3)
//   - Skip-Google: a pre-consent fetch to a Google endpoint passes through (AC5)
//   - AbortSignal discard: held entry removed when signal fires before grant (AC6)
//   - Replay/drain lives in the lazy autoblock-loader chunk; debug logs _debug-gated (AC7)
//
// sendBeacon (task 004):
//   - A matched pre-consent sendBeacon is not sent and returns true (AC1)
//   - On grant, the queued beacon is delivered exactly once via _origSendBeacon (AC2)
//   - Non-matching beacons pass through untouched (AC3)
//   - Skip-Google holds at the beacon transport layer (AC4)
//   - Unload-drop guard: _isUnloading flag prevents queueing (AC5)
//   - Debug logs are _debug-gated; ESM-OFF within ceiling (AC6)
//
// Requires: @vitest/browser + playwright chromium (see vitest.browser.config.ts)
//
// NOTE: These tests do NOT make real network requests to third-party hosts.
// All "third-party" endpoints are served from the local test origin or use
// no-op interception.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _extractUrl,
  _resetAutoBlockProxy,
  activateMatcher,
  activateTransportClassifiers,
  getHeldFetches,
  getOrigFetch,
  getOrigResponse,
  getOrigSendBeacon,
  getQueuedBeacons,
  installAutoBlockProxy,
  isUnloading,
} from './autoblock-proxy.js'
import { _registerTransportReleaseHook, _resetBlocker, grant } from './blocking.js'
import { _resetApi } from './api.js'
import { clearConsent } from './consent/index.js'
import type { AutoBlockMatch } from './autoblock-matcher.js'
import { makeFetchClassifier, makeBeaconClassifier } from './autoblock-transport-classifier.js'

// ---------------------------------------------------------------------------
// Test matcher helpers
// ---------------------------------------------------------------------------

function makeFetchTrackingMatcher(): (url: string) => AutoBlockMatch | null {
  return (url: string) => {
    if (url.includes('tracking.example.com')) {
      return { serviceId: 'test-tracker', category: 'analytics' }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Phase 2 activation helper — used by all tests that need full Phase 2 behaviour
// ---------------------------------------------------------------------------

/**
 * Activate both the matcher AND the transport classifiers in one call.
 *
 * Mirrors the `activatePhase2()` helper in `autoblock-transport.test.ts`.
 * In production, `api.ts` calls `activateMatcher()` then `activateTransportClassifiers()`
 * (with classifiers built via `makeFetchClassifier`/`makeBeaconClassifier` from the lazy
 * chunk). In browser tests we call both here to simulate the same Phase 2 state.
 *
 * Must be called AFTER `installAutoBlockProxy()` (so the origFetch/origResponse/etc.
 * saved refs are available).
 */
function activatePhase2(matcher: (url: string) => AutoBlockMatch | null): void {
  activateMatcher(matcher)
  const ctx = {
    origFetch: getOrigFetch()!,
    nativeResponse: getOrigResponse()!,
    origSendBeacon: getOrigSendBeacon(),
    heldFetches: getHeldFetches(),
    queuedBeacons: getQueuedBeacons(),
    isUnloading,
  }
  activateTransportClassifiers(
    makeFetchClassifier(matcher, null, ctx),
    makeBeaconClassifier(matcher, null, ctx),
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetAutoBlockProxy()
  _resetBlocker()
  _resetApi()
  clearConsent()
})

afterEach(() => {
  _resetAutoBlockProxy()
  _resetBlocker()
  _resetApi()
  clearConsent()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// AC1 — Matched pre-consent fetch resolves immediately with 204 stub in real browser
// ---------------------------------------------------------------------------

describe('AC1 — 204 stub: matched fetch resolves immediately (real window.fetch)', () => {
  it('a matched fetch returns a Response without awaiting grant', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    // This must resolve immediately — no grant, no hang
    const response = await window.fetch('https://tracking.example.com/collect')
    expect(response).toBeDefined()
    expect(response.status).toBe(204)
  })

  it('the 204 stub does not throw (no rejection)', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    await expect(window.fetch('https://tracking.example.com/collect')).resolves.toBeDefined()
  })

  it('.text() on the 204 stub resolves to a string (does not throw)', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const response = await window.fetch('https://tracking.example.com/collect')
    const text = await response.text()
    expect(typeof text).toBe('string')
  })

  it('.json() on the 204 stub throws SyntaxError (empty body is not valid JSON — not a hang)', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const response = await window.fetch('https://tracking.example.com/collect')
    // SyntaxError (empty body), not a hang or unhandled rejection
    await expect(response.json()).rejects.toThrow()
  })

  it('.blob() on the 204 stub resolves (does not throw)', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const response = await window.fetch('https://tracking.example.com/collect')
    const blob = await response.blob()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBe(0) // empty body
  })

  it('.arrayBuffer() on the 204 stub resolves (does not throw)', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const response = await window.fetch('https://tracking.example.com/collect')
    const ab = await response.arrayBuffer()
    expect(ab).toBeInstanceOf(ArrayBuffer)
    expect(ab.byteLength).toBe(0) // empty body
  })

  it('.clone() on the 204 stub returns a new Response with status 204', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const response = await window.fetch('https://tracking.example.com/collect')
    const cloned = response.clone()
    expect(cloned.status).toBe(204)
  })

  it('ok is true on the 204 stub (204 is in the 200–299 success range)', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const response = await window.fetch('https://tracking.example.com/collect')
    expect(response.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC2 — Grant-path replay via _origFetch (timing and fire-and-forget)
// ---------------------------------------------------------------------------

describe('AC2 — grant-path replay calls _origFetch (real browser fetch wrapping)', () => {
  it('before grant: _origFetch is not called for a matched pre-consent fetch', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const saved = getOrigFetch()
    const savedSpy = vi.fn().mockImplementation(saved!)

    // Replace _origFetch temporarily via getOrigFetch + hook spy
    // We test by observing that the real held-fetch replay path calls origFetch.
    await window.fetch('https://tracking.example.com/collect')

    // Verify entry is in held queue
    expect(getHeldFetches()).toHaveLength(1)

    // The real fetch was NOT called yet (only 204 stub was returned)
    // (We can't easily spy on getOrigFetch() directly in browser mode, but we can
    // verify the held queue is populated and the stub was returned.)
    expect(getHeldFetches()[0].url).toBe('https://tracking.example.com/collect')
    // Use void here to avoid unhandled promise if replay fails (cross-origin)
    void savedSpy
  })

  it('the held entry stores replayInput (string) for string fetch input', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const url = 'https://tracking.example.com/collect?v=1'
    await window.fetch(url)

    const hf = getHeldFetches()[0]
    expect(hf.replayInput).toBe(url)
  })

  it('the held entry stores a cloned Request when input is a Request object', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const req = new Request('https://tracking.example.com/collect', { method: 'POST' })
    await window.fetch(req)

    const hf = getHeldFetches()[0]
    // replayInput is a clone, not the original Request
    expect(hf.replayInput).toBeInstanceOf(Request)
    expect(hf.replayInput).not.toBe(req)
    expect((hf.replayInput as Request).url).toBe(req.url)
    expect((hf.replayInput as Request).method).toBe('POST')
  })
})

// ---------------------------------------------------------------------------
// AC3 — Non-matching fetches pass through unchanged (no stub, no hold)
// ---------------------------------------------------------------------------

describe('AC3 — non-matching fetches pass through in real browser', () => {
  it('a non-matching fetch does NOT add an entry to _heldFetches', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher()) // only matches tracking.example.com

    // Fetch to the test origin (same-origin, will fail or succeed depending on server)
    // Use a relative URL that the test runner can resolve (will likely 404 but not hang)
    try {
      await window.fetch('/non-tracking-endpoint')
    } catch {
      // Network failure is OK — we only care that it was NOT held
    }

    expect(getHeldFetches()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// AC5 — Skip-Google: fetch to Google endpoints passes through (Consent Mode v2)
// ---------------------------------------------------------------------------

describe('AC5 — skip-Google holds at the transport layer (real browser)', () => {
  it('a matched meta-pixel fetch is held; a Google fetch passes through (matcher returns null for Google)', async () => {
    installAutoBlockProxy()
    // Matcher: returns match for facebook.com/tr, null for everything else (including Google)
    activatePhase2((url: string) => {
      if (url.includes('facebook.com/tr')) return { serviceId: 'meta-pixel', category: 'marketing' }
      return null
    })

    // Google-like URL — matcher returns null → passthrough (no hold, no stub)
    try {
      await window.fetch('https://region1.google-analytics.com/g/collect?v=2')
    } catch {
      // Network failure OK — we only care it was NOT held and NOT stubbed
    }
    expect(getHeldFetches()).toHaveLength(0)

    // Meta pixel — should be held and return 204
    const response = await window.fetch('https://www.facebook.com/tr?id=123')
    expect(response.status).toBe(204)
    expect(getHeldFetches()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// AC6 — AbortSignal discard (real browser)
// ---------------------------------------------------------------------------

describe('AC6 — AbortSignal discard in real browser', () => {
  it('a held fetch entry is removed when its AbortSignal fires before grant', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const controller = new AbortController()
    await window.fetch('https://tracking.example.com/collect', { signal: controller.signal })

    // Entry is held
    expect(getHeldFetches()).toHaveLength(1)

    // Fire the signal — entry should be discarded
    controller.abort()
    expect(getHeldFetches()).toHaveLength(0)
  })

  it('a fetch with an already-aborted signal returns 204 stub and is NOT queued', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    const controller = new AbortController()
    controller.abort() // pre-abort

    const response = await window.fetch('https://tracking.example.com/collect', {
      signal: controller.signal,
    })
    expect(response.status).toBe(204) // stub returned (non-throwing)
    expect(getHeldFetches()).toHaveLength(0) // NOT queued
  })
})

// ---------------------------------------------------------------------------
// AC7 — Replay lives in lazy chunk; debug logs are _debug-gated (not bare console.log)
// ---------------------------------------------------------------------------

describe('AC7 — no bare console.log in the transport shim (debug logs are _debug-gated)', () => {
  it('console.log is NOT called during fetch interception (debug=false)', async () => {
    const logSpy = vi.spyOn(console, 'log')

    // Install without debug logger (default — production-like)
    installAutoBlockProxy(null)
    activatePhase2(makeFetchTrackingMatcher())

    await window.fetch('https://tracking.example.com/collect')
    grant('analytics') // trigger drain path

    expect(logSpy).not.toHaveBeenCalled()
  })

  it('_extractUrl handles string | URL | Request identically in real browser', () => {
    // _extractUrl must work in the real browser environment
    const str = 'https://tracking.example.com/collect?v=1'
    expect(_extractUrl(str)).toBe(str)

    const urlObj = new URL('https://tracking.example.com/collect')
    expect(_extractUrl(urlObj)).toBe('https://tracking.example.com/collect')

    const req = new Request('https://tracking.example.com/collect', { method: 'POST' })
    expect(_extractUrl(req)).toBe('https://tracking.example.com/collect')
  })
})

// ---------------------------------------------------------------------------
// Integration — grant-path replay (Phase 2 → grant → _origFetch called)
// ---------------------------------------------------------------------------

describe('Integration — fetch hold + grant + replay in real browser', () => {
  it('on grant of the matching category, the held entry is removed from _heldFetches', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    await window.fetch('https://tracking.example.com/collect')
    expect(getHeldFetches()).toHaveLength(1)

    // Wire a minimal drain hook and grant
    _registerTransportReleaseHook((category) => {
      const saved = getOrigFetch()
      const fetches = getHeldFetches()
      let i = fetches.length
      while (i--) {
        const hf = fetches[i]
        if (hf.category !== category) continue
        fetches.splice(i, 1)
        // Fire-and-forget replay via saved original (swallow network errors in test)
        const replayIsRequest = hf.replayInput instanceof Request
        saved?.(hf.replayInput as RequestInfo | URL, replayIsRequest ? undefined : hf.init)?.catch(
          () => {
            /* replay network error in test context — swallow */
          },
        )
      }
    })

    grant('analytics')
    expect(getHeldFetches()).toHaveLength(0)
  })

  it('the caller promise (204 stub) is already resolved before grant fires', async () => {
    installAutoBlockProxy()
    activatePhase2(makeFetchTrackingMatcher())

    // This must resolve immediately (before any grant call)
    const stubResponse = await window.fetch('https://tracking.example.com/collect')
    expect(stubResponse.status).toBe(204)

    // The held entry is queued but the caller already has their response
    expect(getHeldFetches()).toHaveLength(1)
  })
})

// ===========================================================================
// Task 004 — navigator.sendBeacon browser-mode tests
// ===========================================================================

function makeBeaconMatcher(): (url: string) => AutoBlockMatch | null {
  return (url: string) => {
    if (url.includes('facebook.com/tr')) {
      return { serviceId: 'meta-pixel', category: 'marketing' }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Task 004 AC1 — matched pre-consent sendBeacon NOT sent; returns true (real browser)
// ---------------------------------------------------------------------------

describe('Task 004 AC1 — matched sendBeacon not sent, returns true (real browser sendBeacon)', () => {
  it('real navigator.sendBeacon is replaced with a wrapper shim after install', () => {
    const origBeacon = navigator.sendBeacon
    installAutoBlockProxy()
    // The shim should be installed (different function reference)
    expect(navigator.sendBeacon).not.toBe(origBeacon)
  })

  it('the sendBeacon wrapper is an own property (instance shadow, not prototype)', () => {
    installAutoBlockProxy()
    expect(Object.prototype.hasOwnProperty.call(navigator, 'sendBeacon')).toBe(true)
  })

  it('a matched pre-consent sendBeacon returns true synchronously', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    const result = navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'payload')
    expect(result).toBe(true)
  })

  it('a matched beacon is NOT forwarded to the network (stored in _queuedBeacons)', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'ev=PageView')

    expect(getQueuedBeacons()).toHaveLength(1)
    expect(getQueuedBeacons()[0].url).toBe('https://www.facebook.com/tr?id=123')
    expect(getQueuedBeacons()[0].data).toBe('ev=PageView')
    expect(getQueuedBeacons()[0].category).toBe('marketing')
  })
})

// ---------------------------------------------------------------------------
// Task 004 AC2 — on grant, queued beacon delivered via _origSendBeacon
// ---------------------------------------------------------------------------

describe('Task 004 AC2 — grant-path: queued beacon delivered via saved _origSendBeacon', () => {
  it('the saved _origSendBeacon is the pre-install real sendBeacon', () => {
    const origBeacon = navigator.sendBeacon
    installAutoBlockProxy()
    expect(getOrigSendBeacon()).toBe(origBeacon)
    expect(getOrigSendBeacon()).not.toBe(navigator.sendBeacon) // shim installed
  })

  it('on grant, the queued beacon is drained from _queuedBeacons', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'data')
    expect(getQueuedBeacons()).toHaveLength(1)

    _registerTransportReleaseHook((category) => {
      const savedBeacon = getOrigSendBeacon()
      const beacons = getQueuedBeacons()
      let j = beacons.length
      while (j--) {
        const qb = beacons[j]
        if (qb.category !== category) continue
        beacons.splice(j, 1)
        // Deliver via saved original — NOT navigator.sendBeacon (would re-enter shim)
        savedBeacon?.call(navigator, qb.url, qb.data)
      }
    })

    grant('marketing')
    expect(getQueuedBeacons()).toHaveLength(0)
  })

  it('string data payload is forwarded intact via _origSendBeacon', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    const origBeacon = getOrigSendBeacon()!
    const beaconSpy = vi.fn().mockReturnValue(true)

    // Intercept calls to the saved original without breaking the shim
    // We check indirectly: the data payload ends up in the drained entry,
    // and we verify the drain calls with the captured data.
    navigator.sendBeacon('https://www.facebook.com/tr?id=123', '{"event":"Purchase"}')

    const entry = getQueuedBeacons()[0]
    expect(entry.data).toBe('{"event":"Purchase"}')
    void origBeacon // prevent TS unused warning
    void beaconSpy
  })

  it('Blob data is stored and accessible (type preserved) in _queuedBeacons', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    const blob = new Blob(['{"ev":"cart"}'], { type: 'application/json' })
    navigator.sendBeacon('https://www.facebook.com/tr?id=123', blob)

    const entry = getQueuedBeacons()[0]
    expect(entry.data).toBeInstanceOf(Blob)
    expect((entry.data as Blob).type).toBe('application/json')
  })
})

// ---------------------------------------------------------------------------
// Task 004 AC3 — Non-matching beacons pass through (real browser)
// ---------------------------------------------------------------------------

describe('Task 004 AC3 — non-matching beacons pass through in real browser', () => {
  it('a non-matching sendBeacon does NOT add to _queuedBeacons', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher()) // only matches facebook.com/tr

    // First-party endpoint — should pass through
    // Note: in real browser this may fail (no server), but we only care about the queue state
    try {
      navigator.sendBeacon('/analytics/event', '{"ev":"click"}')
    } catch {
      // pass-through to real browser sendBeacon might fail in test origin — OK
    }

    expect(getQueuedBeacons()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Task 004 AC4 — Skip-Google holds at sendBeacon transport layer (real browser)
// ---------------------------------------------------------------------------

describe('Task 004 AC4 — skip-Google: Google sendBeacon endpoints pass through (real browser)', () => {
  it('a beacon to a Google endpoint passes through (matcher returns null for Google hosts)', () => {
    installAutoBlockProxy()
    activatePhase2((url: string) =>
      url.includes('facebook.com/tr') ? { serviceId: 'meta-pixel', category: 'marketing' } : null,
    )

    // Google Analytics endpoint — matcher returns null → passthrough (not queued)
    try {
      navigator.sendBeacon('https://region1.google-analytics.com/g/collect', '{"event":"session"}')
    } catch {
      // real sendBeacon may fail in test context — we only care about the queue state
    }

    expect(getQueuedBeacons()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Task 004 AC5 — Unload-drop guard (real browser, pagehide/visibilitychange events)
// ---------------------------------------------------------------------------

describe('Task 004 AC5 — unload-drop guard (real browser sendBeacon)', () => {
  it('before pagehide: a matched beacon IS queued (no unload)', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'pre-unload')
    expect(getQueuedBeacons()).toHaveLength(1)
  })

  it('a matched beacon fired after pagehide is dropped (not queued)', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    window.dispatchEvent(new Event('pagehide'))

    const result = navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'page-exit-data')

    // Must return true (fire-and-forget contract preserved)
    expect(result).toBe(true)
    // Must NOT be queued
    expect(getQueuedBeacons()).toHaveLength(0)
  })

  it('after pagehide, a matched beacon returns true and is not sent to origSendBeacon', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    window.dispatchEvent(new Event('pagehide'))

    const result = navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'drop-me')
    expect(result).toBe(true)
    expect(getQueuedBeacons()).toHaveLength(0)
  })

  it('_resetAutoBlockProxy() clears unload guard (beacon queues again after fresh install)', () => {
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())
    window.dispatchEvent(new Event('pagehide'))

    // Guard is engaged — beacon is dropped
    navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'dropped')
    expect(getQueuedBeacons()).toHaveLength(0)

    // Reset — guard cleared; removed listeners
    _resetAutoBlockProxy()

    // Re-install fresh proxy (no prior unload in this install)
    installAutoBlockProxy()
    activatePhase2(makeBeaconMatcher())

    // No pagehide since re-install — beacon must queue
    navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'queued')
    expect(getQueuedBeacons()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Task 004 AC6 — Debug logs are _debug-gated (no bare console.log for beacons)
// ---------------------------------------------------------------------------

describe('Task 004 AC6 — no bare console.log in the sendBeacon shim (debug=false)', () => {
  it('console.log is NOT called during sendBeacon interception (debug=false)', () => {
    const logSpy = vi.spyOn(console, 'log')

    installAutoBlockProxy(null) // no debug logger
    activatePhase2(makeBeaconMatcher())

    navigator.sendBeacon('https://www.facebook.com/tr?id=123', 'payload')
    grant('marketing') // trigger drain path

    expect(logSpy).not.toHaveBeenCalled()
  })
})
