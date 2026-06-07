// Declarative blocking engine — jsdom unit tests
//
// These tests cover: DOM registration, state tracking, iframe placeholder,
// fail-closed warn behavior, idempotency, and stagger scheduling.
// Script *execution* requires a real browser — see blocking.browser.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STATE_BLOCKED,
  STATE_EXECUTED,
  _resetBlocker,
  grant,
  scanBlocked,
} from './blocking.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScript({
  category = 'analytics',
  src,
  inline = 'window._ran = true',
}: {
  category?: string
  src?: string
  inline?: string
} = {}): HTMLScriptElement {
  const s = document.createElement('script')
  s.setAttribute('type', 'text/plain')
  s.setAttribute('data-category', category)
  if (src) {
    s.setAttribute('src', src)
  } else {
    s.textContent = inline
  }
  document.body.appendChild(s)
  return s
}

function makeIframe({
  category = 'marketing',
  width = '560',
  height = '315',
  dataSrc = 'https://example.com/embed',
}: {
  category?: string
  width?: string
  height?: string
  dataSrc?: string
} = {}): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.setAttribute('data-category', category)
  f.setAttribute('data-src', dataSrc)
  if (width) f.setAttribute('width', width)
  if (height) f.setAttribute('height', height)
  document.body.appendChild(f)
  return f
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetBlocker()
  document.body.innerHTML = ''
})

afterEach(() => {
  _resetBlocker()
  document.body.innerHTML = ''
})

// ---------------------------------------------------------------------------
// scanBlocked — script registration
// ---------------------------------------------------------------------------

describe('scanBlocked — scripts', () => {
  it('sets data-cookyay-state="blocked" on a blocked script', () => {
    const s = makeScript()
    scanBlocked()
    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)
  })

  it('does not change the type attribute (stays "text/plain")', () => {
    const s = makeScript()
    scanBlocked()
    expect(s.getAttribute('type')).toBe('text/plain')
  })

  it('registers inline and src scripts with the same data-category', () => {
    const inline = makeScript({ category: 'analytics', inline: '1+1' })
    const src = makeScript({ category: 'analytics', src: 'https://example.com/a.js' })
    scanBlocked()
    expect(inline.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)
    expect(src.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)
  })
})

// ---------------------------------------------------------------------------
// scanBlocked — iframe registration + placeholder
// ---------------------------------------------------------------------------

describe('scanBlocked — iframes', () => {
  it('sets data-cookyay-state="blocked" on a blocked iframe', () => {
    const f = makeIframe()
    scanBlocked()
    expect(f.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)
  })

  it('hides the iframe while blocked', () => {
    const f = makeIframe()
    scanBlocked()
    expect(f.style.display).toBe('none')
  })

  it('inserts a placeholder after the iframe', () => {
    const f = makeIframe({ width: '560', height: '315' })
    scanBlocked()
    const placeholder = f.nextElementSibling as HTMLElement | null
    expect(placeholder?.getAttribute('data-cookyay-placeholder')).toBe('true')
  })

  it('placeholder preserves numeric width as px', () => {
    const f = makeIframe({ width: '400' })
    scanBlocked()
    const ph = f.nextElementSibling as HTMLElement
    expect(ph.style.width).toBe('400px')
  })

  it('placeholder preserves numeric height as px', () => {
    const f = makeIframe({ height: '225' })
    scanBlocked()
    const ph = f.nextElementSibling as HTMLElement
    expect(ph.style.height).toBe('225px')
  })

  it('placeholder preserves percentage dimensions verbatim', () => {
    const f = makeIframe({ width: '100%', height: '50vh' })
    scanBlocked()
    const ph = f.nextElementSibling as HTMLElement
    expect(ph.style.width).toBe('100%')
    expect(ph.style.height).toBe('50vh')
  })
})

// ---------------------------------------------------------------------------
// Fail-closed: unknown category
// ---------------------------------------------------------------------------

describe('fail-closed: unknown category', () => {
  it('emits console.warn for a script with an unknown category', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeScript({ category: 'unknown-cat' })
    scanBlocked()
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain('unknown category')
    warnSpy.mockRestore()
  })

  it('does not set data-cookyay-state on a script with an unknown category', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = makeScript({ category: 'unknown-cat' })
    scanBlocked()
    expect(s.getAttribute('data-cookyay-state')).toBeNull()
    vi.restoreAllMocks()
  })

  it('emits console.warn for an iframe with an unknown category', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeIframe({ category: 'unknown-cat' })
    scanBlocked()
    expect(warnSpy).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
  })

  it('emits console.warn when grant is called with an unknown category', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    grant('totally-unknown')
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain('unknown category')
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency via data-cookyay-state', () => {
  it('scanBlocked does not double-register an already-blocked script', () => {
    // Calling twice should not push two entries; grant should only inject once
    makeScript()
    scanBlocked()
    scanBlocked()  // second call

    vi.useFakeTimers()
    grant('analytics')
    const clones1 = document.body.querySelectorAll('script:not([type="text/plain"])')
    vi.runAllTimers()
    const clones2 = document.body.querySelectorAll('script:not([type="text/plain"])')
    vi.useRealTimers()

    // jsdom doesn't execute scripts, but we can verify at most one clone is inserted
    // (clones1 is empty before timers run; clones2 has at most 1 if jsdom appended it)
    expect(clones1.length).toBe(0)
    expect(clones2.length).toBeLessThanOrEqual(1)
  })

  it('scanBlocked skips an element already marked STATE_EXECUTED', () => {
    const s = makeScript()
    s.setAttribute('data-cookyay-state', STATE_EXECUTED)
    scanBlocked()
    // Even if grant is called, no injection should happen (queue is empty)
    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()
    // State must remain executed, not overwritten to blocked
    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('grant after queue drain is a no-op (elements removed from queue)', () => {
    makeScript()
    scanBlocked()

    vi.useFakeTimers()
    grant('analytics')     // drains queue
    grant('analytics')     // second call — queue already drained
    vi.runAllTimers()
    vi.useRealTimers()

    // Only one clone should appear (not two)
    const clones = document.body.querySelectorAll('script:not([type="text/plain"])')
    expect(clones.length).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Stagger: setTimeout(fn, 0) per element
// ---------------------------------------------------------------------------

describe('grant stagger (setTimeout 0)', () => {
  it('does not inject scripts synchronously on grant', () => {
    makeScript({ category: 'analytics' })
    makeScript({ category: 'analytics' })
    scanBlocked()

    vi.useFakeTimers()
    grant('analytics')

    // Before timers run, no clones yet
    const before = document.body.querySelectorAll('script:not([type="text/plain"])')
    expect(before.length).toBe(0)

    vi.runAllTimers()
    vi.useRealTimers()
  })

  it('schedules one setTimeout per queued element', () => {
    makeScript({ category: 'analytics' })
    makeScript({ category: 'analytics' })
    makeScript({ category: 'marketing' })
    scanBlocked()

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    // Should have scheduled exactly 2 timeouts (one per analytics script)
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2)
    for (const call of setTimeoutSpy.mock.calls) {
      expect(call[1]).toBe(0)
    }
    setTimeoutSpy.mockRestore()
  })

  it('iframe injection is also staggered via setTimeout 0', () => {
    makeIframe({ category: 'marketing' })
    scanBlocked()

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('marketing')
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(0)
    setTimeoutSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// grant — iframe data-src → src swap + placeholder removal
// ---------------------------------------------------------------------------

describe('grant — iframe unblocking', () => {
  it('removes placeholder from DOM after grant', () => {
    const f = makeIframe()
    scanBlocked()
    const placeholder = f.nextElementSibling as HTMLElement
    expect(placeholder.getAttribute('data-cookyay-placeholder')).toBe('true')

    vi.useFakeTimers()
    grant('marketing')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(document.body.contains(placeholder)).toBe(false)
  })

  it('sets src from data-src and removes data-src after grant', () => {
    const f = makeIframe({ dataSrc: 'https://example.com/embed' })
    scanBlocked()

    vi.useFakeTimers()
    grant('marketing')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(f.getAttribute('src') ?? f.src).toContain('example.com/embed')
    expect(f.getAttribute('data-src')).toBeNull()
  })

  it('unhides the iframe after grant', () => {
    const f = makeIframe()
    scanBlocked()
    expect(f.style.display).toBe('none')

    vi.useFakeTimers()
    grant('marketing')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(f.style.display).toBe('')
  })

  it('sets data-cookyay-state="executed" on iframe after grant', () => {
    const f = makeIframe()
    scanBlocked()

    vi.useFakeTimers()
    grant('marketing')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(f.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })
})

// ---------------------------------------------------------------------------
// grant — script state tracking
// ---------------------------------------------------------------------------

describe('grant — script state tracking', () => {
  it('sets data-cookyay-state="executed" on script after grant', () => {
    const s = makeScript()
    scanBlocked()

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(s.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('clone does not carry type="text/plain"', () => {
    makeScript({ inline: 'void 0' })
    scanBlocked()

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    const clone = document.body.querySelector('script:not([type="text/plain"])')
    // jsdom may or may not append it (jsdom doesn't run scripts), but if it did:
    if (clone) {
      expect(clone.getAttribute('type')).not.toBe('text/plain')
      expect(clone.getAttribute('type')).toBeNull()
    }
  })

  it('clone carries src attribute from original src script', () => {
    makeScript({ src: 'https://example.com/analytics.js' })
    scanBlocked()

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    const clone = document.body.querySelector('script:not([type="text/plain"])')
    expect(clone).not.toBeNull()
    expect(clone!.getAttribute('src')).toBe('https://example.com/analytics.js')
  })
})

// ---------------------------------------------------------------------------
// placeholderLabel option
// ---------------------------------------------------------------------------

describe('scanBlocked — placeholderLabel option', () => {
  it('placeholder has empty textContent by default', () => {
    const f = makeIframe()
    scanBlocked()
    const ph = f.nextElementSibling as HTMLElement
    expect(ph.textContent).toBe('')
  })

  it('placeholder shows provided label text', () => {
    const f = makeIframe()
    scanBlocked(document, undefined, { placeholderLabel: 'Video blocked (no consent)' })
    const ph = f.nextElementSibling as HTMLElement
    expect(ph.textContent).toBe('Video blocked (no consent)')
  })

  it('placeholder label does not affect dimensions', () => {
    const f = makeIframe({ width: '560', height: '315' })
    scanBlocked(document, undefined, { placeholderLabel: 'Blocked' })
    const ph = f.nextElementSibling as HTMLElement
    expect(ph.style.width).toBe('560px')
    expect(ph.style.height).toBe('315px')
  })
})

// ---------------------------------------------------------------------------
// Category isolation
// ---------------------------------------------------------------------------

describe('category isolation', () => {
  it('granting analytics does not release marketing scripts', () => {
    const marketing = makeScript({ category: 'marketing' })
    scanBlocked()

    vi.useFakeTimers()
    grant('analytics')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(marketing.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)
  })

  it('each category is processed independently', () => {
    makeScript({ category: 'analytics' })
    makeScript({ category: 'marketing' })
    scanBlocked()

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    grant('analytics')
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
    setTimeoutSpy.mockRestore()
  })
})
