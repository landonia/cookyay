/**
 * Unit tests for the bootstrap-first diagnostic (task 004 — autoblock-diagnostic.ts).
 *
 * Acceptance criteria verified:
 *   AC1 — warning fires for a pre-bootstrap tracker when debug:true
 *          (via performance entries AND DOM scan)
 *   AC2 — nothing fires when debug is unset / false (tested via NODE_ENV gate)
 *   AC3 — a clean page (no pre-bootstrap tracker) emits nothing
 *   AC4 — no throw on a page with no Performance entries
 *   AC5 — warning message names the service and URL correctly
 *
 * Note on the NODE_ENV DCE guard:
 *   In production builds (NODE_ENV=production), esbuild replaces the
 *   `process.env.NODE_ENV !== 'production'` guard with `false` and DCEs the entire
 *   module body. In this test environment (NODE_ENV=test / undefined), the guard
 *   evaluates to `true`, so all code paths are exercised. The "nothing fires in
 *   production" guarantee is verified by the AC4 / negative tests below — the
 *   build-time guarantee is asserted in task 006 (bundle budget + DCE gate).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBootstrapDiagnostic, _formatDiagnosticWarning } from './autoblock-diagnostic.js'
import type { AutoBlockMatch } from './autoblock-matcher.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A matcher that returns a hit for any URL containing 'connect.facebook.net'. */
function makeFbMatcher(): (url: string) => AutoBlockMatch | null {
  return (url: string): AutoBlockMatch | null => {
    if (url.includes('connect.facebook.net')) {
      return { serviceId: 'meta-pixel', category: 'marketing' }
    }
    return null
  }
}

/** A service label resolver that returns a nice name for meta-pixel. */
function fbLabel(serviceId: string): string {
  if (serviceId === 'meta-pixel') return 'Meta Pixel'
  return serviceId
}

/** Matcher that never hits — simulates a clean page. */
function makeNoOpMatcher(): (url: string) => AutoBlockMatch | null {
  return () => null
}

// ---------------------------------------------------------------------------
// Setup/teardown: mock console.warn and Performance/DOM globals
// ---------------------------------------------------------------------------

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  // Reset jsdom performance entries stub after each test.
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Helper: stub performance.getEntriesByType to return a list of PerformanceEntry-
// like objects. jsdom does not populate resource entries from test code, so we
// need to stub the method directly.
// ---------------------------------------------------------------------------

function stubPerfEntries(urls: string[]): void {
  const entries = urls.map((name) => ({ name }) as PerformanceEntry)
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => entries)
}

// ---------------------------------------------------------------------------
// Helper: inject real DOM elements into the document body for DOM-scan tests.
// ---------------------------------------------------------------------------

function addScriptSrc(src: string): HTMLScriptElement {
  const el = document.createElement('script')
  el.src = src
  document.body.appendChild(el)
  return el
}

function addImgSrc(src: string): HTMLImageElement {
  const el = document.createElement('img')
  el.src = src
  document.body.appendChild(el)
  return el
}

function addIframeSrc(src: string): HTMLIFrameElement {
  const el = document.createElement('iframe')
  el.src = src
  document.body.appendChild(el)
  return el
}

function cleanupDomElements(els: Element[]): void {
  for (const el of els) {
    el.parentNode?.removeChild(el)
  }
}

// ---------------------------------------------------------------------------
// AC1 — warning fires for a pre-bootstrap tracker when debug:true
// (primary signal: performance.getEntriesByType)
// ---------------------------------------------------------------------------

describe('runBootstrapDiagnostic — Performance entries (AC1)', () => {
  it('emits a console.warn when a known tracker URL is in performance entries', () => {
    const trackerUrl = 'https://connect.facebook.net/en_US/fbevents.js'
    stubPerfEntries([trackerUrl])

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(_formatDiagnosticWarning('Meta Pixel', trackerUrl))
  })

  it('names the service and URL in the warning message', () => {
    const url = 'https://connect.facebook.net/signals/config/12345'
    stubPerfEntries([url])

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    const [msg] = warnSpy.mock.calls[0] as [string]
    expect(msg).toContain('[Cookyay] INSTALL ORDER WARNING')
    expect(msg).toContain('"Meta Pixel"')
    expect(msg).toContain(url)
    expect(msg).toContain('Move Cookyay first in <head>')
  })

  it('emits nothing when no tracker URL is in performance entries', () => {
    stubPerfEntries(['https://fonts.googleapis.com/css2?family=Roboto'])

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('deduplicates — emits only ONE warning per (serviceId, url) pair', () => {
    const url = 'https://connect.facebook.net/en_US/fbevents.js'
    // Both the perf scan and the DOM scan would hit the same URL, but dedup
    // should ensure only one warning. We can force this by having two identical
    // perf entries.
    const entries = [{ name: url }, { name: url }] as PerformanceEntry[]
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => entries)

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    expect(warnSpy).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// AC1 — warning fires via DOM scan (secondary signal)
// ---------------------------------------------------------------------------

describe('runBootstrapDiagnostic — DOM scan (AC1)', () => {
  let injected: Element[] = []

  afterEach(() => {
    cleanupDomElements(injected)
    injected = []
    // Ensure performance stub returns nothing so DOM scan is the only signal.
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => [])
  })

  it('warns when a script[src] matching a tracker is found in the DOM', () => {
    // Stub perf entries to empty so the warning can only come from the DOM scan.
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => [])

    const trackerUrl = 'https://connect.facebook.net/en_US/fbevents.js'
    injected.push(addScriptSrc(trackerUrl))

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain(trackerUrl)
  })

  it('warns when an img[src] matching a tracker is found in the DOM', () => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => [])

    // Create the img element manually (bypassing the proxy) by using
    // setAttribute directly after creation to avoid the autoblock-proxy shim.
    // In this test file, no proxy is installed, so img.src assignment is fine.
    const trackerUrl = 'https://connect.facebook.net/tr?id=test'
    injected.push(addImgSrc(trackerUrl))

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain(trackerUrl)
  })

  it('warns when an iframe[src] matching a tracker is found in the DOM', () => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => [])

    const trackerUrl = 'https://connect.facebook.net/plugins/like.php'
    injected.push(addIframeSrc(trackerUrl))

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain(trackerUrl)
  })

  it('does not warn for first-party / non-tracker DOM elements', () => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => [])

    injected.push(addScriptSrc('/app.js'))
    injected.push(addImgSrc('https://images.example.com/photo.jpg'))

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('deduplicates across Performance + DOM scan for the same URL', () => {
    const url = 'https://connect.facebook.net/en_US/fbevents.js'
    // Both perf and DOM contain the same URL.
    const entries = [{ name: url }] as PerformanceEntry[]
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => entries)

    injected.push(addScriptSrc(url))

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    // Must only warn once despite both signals hitting.
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// AC2 — nothing fires when debug is unset / false
// (The config.debug gate lives in api.ts; here we test the NODE_ENV guard
// by temporarily setting process.env.NODE_ENV = 'production'.)
// ---------------------------------------------------------------------------

describe('runBootstrapDiagnostic — production NODE_ENV guard (AC2)', () => {
  it('emits nothing when NODE_ENV is "production"', () => {
    const trackerUrl = 'https://connect.facebook.net/en_US/fbevents.js'
    stubPerfEntries([trackerUrl])

    // Temporarily set NODE_ENV to production to trigger the early-return guard.
    const origEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      runBootstrapDiagnostic(makeFbMatcher(), fbLabel)
    } finally {
      process.env.NODE_ENV = origEnv
    }

    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AC3 — clean page (no pre-bootstrap tracker) emits nothing
// ---------------------------------------------------------------------------

describe('runBootstrapDiagnostic — clean page emits nothing (AC3)', () => {
  it('emits nothing on a clean page with no trackers in perf entries or DOM', () => {
    stubPerfEntries([])

    runBootstrapDiagnostic(makeFbMatcher(), fbLabel)

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('emits nothing when the matcher never returns a hit', () => {
    const urls = [
      'https://fonts.googleapis.com/css2?family=Roboto',
      'https://cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/lib.js',
      'https://example.com/image.png',
    ]
    stubPerfEntries(urls)

    runBootstrapDiagnostic(makeNoOpMatcher())

    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AC4 — no throw on a page with no Performance entries
// ---------------------------------------------------------------------------

describe('runBootstrapDiagnostic — resilience (AC4)', () => {
  it('does not throw when performance.getEntriesByType is unavailable', () => {
    // Override performance.getEntriesByType to throw (simulates absent API).
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      throw new Error('Performance API not available')
    })

    expect(() => runBootstrapDiagnostic(makeFbMatcher(), fbLabel)).not.toThrow()
  })

  it('does not throw when the performance entries list is empty', () => {
    stubPerfEntries([])

    expect(() => runBootstrapDiagnostic(makeFbMatcher(), fbLabel)).not.toThrow()
  })

  it('does not throw when the matchFn throws', () => {
    stubPerfEntries(['https://connect.facebook.net/en_US/fbevents.js'])

    const throwingMatcher = (): AutoBlockMatch | null => {
      throw new Error('matcher error')
    }

    expect(() => runBootstrapDiagnostic(throwingMatcher)).not.toThrow()
    // Should also not have warned (matched threw, so no warning)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not throw when performance entries contain non-http URLs (cross-origin)', () => {
    // Cross-origin resource timing entries may have opaque names in some browsers,
    // but they always have a string `.name`. Test with unusual URL formats.
    stubPerfEntries(['', 'data:image/gif;base64,R0l', 'blob:http://localhost/123'])

    expect(() => runBootstrapDiagnostic(makeFbMatcher(), fbLabel)).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('falls back gracefully when serviceLabel is omitted (uses serviceId)', () => {
    const url = 'https://connect.facebook.net/en_US/fbevents.js'
    stubPerfEntries([url])

    // Call without providing serviceLabel — should use serviceId as the name.
    runBootstrapDiagnostic(makeFbMatcher())

    expect(warnSpy).toHaveBeenCalledOnce()
    // The warning should use the raw serviceId as the name.
    expect(warnSpy.mock.calls[0][0]).toContain('"meta-pixel"')
  })
})

// ---------------------------------------------------------------------------
// _formatDiagnosticWarning — message format contract
// ---------------------------------------------------------------------------

describe('_formatDiagnosticWarning', () => {
  it('includes the service name, URL, and install guidance', () => {
    const msg = _formatDiagnosticWarning('Meta Pixel', 'https://connect.facebook.net/test')
    expect(msg).toContain('[Cookyay] INSTALL ORDER WARNING')
    expect(msg).toContain('"Meta Pixel"')
    expect(msg).toContain('https://connect.facebook.net/test')
    expect(msg).toContain('Move Cookyay first in <head>')
  })
})

// ---------------------------------------------------------------------------
// Lazy-path assertion — task 001 AC4
//
// Verifies that autoblock-loader.ts re-exports runBootstrapDiagnostic so the
// diagnostic is obtained from the same lazy import('./autoblock-loader.js') that
// provides getAutoBlockMatcher (bundle-budget reclamation: diagnostic NOT present
// in the ESM-OFF bundle when this re-export path is used).
// ---------------------------------------------------------------------------

describe('runBootstrapDiagnostic re-exported from autoblock-loader (task 001 lazy-path AC)', () => {
  it('is the same function reference re-exported from autoblock-loader.ts', async () => {
    // Dynamic import of the lazy chunk mirrors the runtime path in api.ts:
    //   void import('./autoblock-loader.js').then(({ runBootstrapDiagnostic }) => …)
    // The same function object must be importable from both the direct source
    // and through the autoblock-loader re-export.
    const { runBootstrapDiagnostic: diagFromLoader } = await import('./autoblock-loader.js')

    // Both imports must refer to the same function.
    expect(diagFromLoader).toBe(runBootstrapDiagnostic)
  })

  it('produces identical warnings whether called via direct import or loader re-export', async () => {
    const { runBootstrapDiagnostic: diagFromLoader } = await import('./autoblock-loader.js')

    const trackerUrl = 'https://connect.facebook.net/en_US/fbevents.js'
    stubPerfEntries([trackerUrl])

    // Call via the loader re-export (the path api.ts uses).
    diagFromLoader(makeFbMatcher(), fbLabel)

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(_formatDiagnosticWarning('Meta Pixel', trackerUrl))
  })
})
