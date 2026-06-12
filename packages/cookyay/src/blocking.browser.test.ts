// Declarative blocking engine — real-browser execution tests (Vitest browser mode)
//
// These tests verify the acceptance criteria that CANNOT be validated in jsdom:
//   - A script executes after category grant via clone-and-reinsert
//   - The original element retains type="text/plain" (type is never mutated)
//   - Already-granted (state=executed) elements are not re-executed
//   - A granted auto-detected <img> pixel has its src promoted (task 003 AC6)
//
// Requires: @vitest/browser + playwright chromium (see vitest.browser.config.ts)

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  STATE_BLOCKED,
  STATE_EXECUTED,
  _resetBlocker,
  enqueueAutoDetected,
  grant,
  scanBlocked,
} from './blocking.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0
function uid() {
  return `_cy_test_${_id++}`
}

function addInlineScript(category: string, body: string): HTMLScriptElement {
  const s = document.createElement('script')
  s.setAttribute('type', 'text/plain')
  s.setAttribute('data-category', category)
  s.setAttribute('data-test-blocking', 'true')
  s.textContent = body
  document.body.appendChild(s)
  return s
}

function addSrcScript(category: string, body: string): { el: HTMLScriptElement; blobUrl: string } {
  const blob = new Blob([body], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  const s = document.createElement('script')
  s.setAttribute('type', 'text/plain')
  s.setAttribute('data-category', category)
  s.setAttribute('data-test-blocking', 'true')
  s.setAttribute('src', blobUrl)
  document.body.appendChild(s)
  return { el: s, blobUrl }
}

function wait(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetBlocker()
  // Remove any test elements appended in prior tests
  for (const el of document.querySelectorAll('[data-test-blocking]')) {
    el.remove()
  }
})

afterEach(() => {
  _resetBlocker()
  for (const el of document.querySelectorAll('[data-test-blocking]')) {
    el.remove()
  }
})

// ---------------------------------------------------------------------------
// Script execution via clone-and-reinsert
// ---------------------------------------------------------------------------

describe('script execution in real browser', () => {
  it('inline script executes after category grant', async () => {
    const flag = uid()
    ;(window as unknown as Record<string, unknown>)[flag] = false
    addInlineScript('analytics', `window['${flag}'] = true`)

    scanBlocked()
    grant('analytics')
    await wait()

    expect((window as unknown as Record<string, unknown>)[flag]).toBe(true)
  })

  it('original element keeps type="text/plain" — type is never mutated', async () => {
    const flag = uid()
    const s = addInlineScript('analytics', `window['${flag}'] = true`)

    scanBlocked()
    grant('analytics')
    await wait()

    // Confirm execution happened, then verify original is untouched
    expect((window as unknown as Record<string, unknown>)[flag]).toBe(true)
    expect(s.getAttribute('type')).toBe('text/plain')
  })

  it('clone is inserted after original (reinsert, not type flip)', async () => {
    const flag = uid()
    const original = addInlineScript('analytics', `window['${flag}'] = true`)

    scanBlocked()
    grant('analytics')
    await wait()

    // A sibling script without type=text/plain must exist after the original
    const sibling = original.nextElementSibling as HTMLScriptElement | null
    expect(sibling?.tagName).toBe('SCRIPT')
    expect(sibling?.getAttribute('type')).not.toBe('text/plain')
  })

  it('already-executed script is not re-executed on repeat grant (idempotency)', async () => {
    const counter = uid()
    ;(window as unknown as Record<string, unknown>)[counter] = 0
    addInlineScript('analytics', `window['${counter}'] = (window['${counter}'] || 0) + 1`)

    scanBlocked()
    grant('analytics')
    await wait()

    expect((window as unknown as Record<string, unknown>)[counter]).toBe(1)

    // Second grant — queue was already drained
    grant('analytics')
    await wait()

    expect((window as unknown as Record<string, unknown>)[counter]).toBe(1)
  })

  it('script with state=executed skipped by scanBlocked (init idempotency)', async () => {
    const counter = uid()
    ;(window as unknown as Record<string, unknown>)[counter] = 0
    const s = addInlineScript('analytics', `window['${counter}'] = (window['${counter}'] || 0) + 1`)

    // Pre-mark as executed
    s.setAttribute('data-cookyay-state', STATE_EXECUTED)

    scanBlocked() // should skip
    grant('analytics')
    await wait()

    expect((window as unknown as Record<string, unknown>)[counter]).toBe(0)
  })

  it('data-category is copied onto the clone', async () => {
    const flag = uid()
    const original = addInlineScript('analytics', `window['${flag}'] = true`)

    scanBlocked()
    grant('analytics')
    await wait()

    const clone = original.nextElementSibling as HTMLScriptElement | null
    expect(clone?.getAttribute('data-category')).toBe('analytics')
  })

  it('multiple scripts in same category all execute', async () => {
    const flag1 = uid()
    const flag2 = uid()
    ;(window as unknown as Record<string, unknown>)[flag1] = false
    ;(window as unknown as Record<string, unknown>)[flag2] = false
    addInlineScript('analytics', `window['${flag1}'] = true`)
    addInlineScript('analytics', `window['${flag2}'] = true`)

    scanBlocked()
    grant('analytics')
    await wait()

    expect((window as unknown as Record<string, unknown>)[flag1]).toBe(true)
    expect((window as unknown as Record<string, unknown>)[flag2]).toBe(true)
  })

  it('granting one category does not execute scripts in another category', async () => {
    const flag = uid()
    ;(window as unknown as Record<string, unknown>)[flag] = false
    addInlineScript('marketing', `window['${flag}'] = true`)

    scanBlocked()
    grant('analytics') // different category
    await wait()

    expect((window as unknown as Record<string, unknown>)[flag]).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// src= script execution via clone-and-reinsert (real browser, Blob URL)
// ---------------------------------------------------------------------------

describe('src= script execution in real browser', () => {
  const blobUrls: string[] = []

  afterEach(() => {
    // Clean up blob URLs created during the test
    for (const url of blobUrls) URL.revokeObjectURL(url)
    blobUrls.length = 0
  })

  it('src= script executes after grant (Blob URL)', async () => {
    const flag = uid()
    ;(window as unknown as Record<string, unknown>)[flag] = false

    const { blobUrl } = addSrcScript('analytics', `window['${flag}'] = true`)
    blobUrls.push(blobUrl)

    scanBlocked()
    grant('analytics')
    await wait(100)

    expect((window as unknown as Record<string, unknown>)[flag]).toBe(true)
  })

  it('clone of src= script carries the src attribute', async () => {
    const flag = uid()
    const { el: original, blobUrl } = addSrcScript('analytics', `window['${flag}'] = true`)
    blobUrls.push(blobUrl)

    scanBlocked()
    grant('analytics')
    await wait(100)

    const clone = original.nextElementSibling as HTMLScriptElement | null
    expect(clone?.tagName).toBe('SCRIPT')
    expect(clone?.getAttribute('src')).toBe(blobUrl)
  })

  it('original src= element keeps type="text/plain" after grant', async () => {
    const flag = uid()
    const { el: original, blobUrl } = addSrcScript('analytics', `window['${flag}'] = true`)
    blobUrls.push(blobUrl)

    scanBlocked()
    grant('analytics')
    await wait(100)

    expect(original.getAttribute('type')).toBe('text/plain')
  })

  it('src= script with state=executed is not re-executed (idempotency)', async () => {
    const counter = uid()
    ;(window as unknown as Record<string, unknown>)[counter] = 0

    const { el, blobUrl } = addSrcScript(
      'analytics',
      `window['${counter}'] = (window['${counter}'] || 0) + 1`,
    )
    blobUrls.push(blobUrl)

    scanBlocked()
    grant('analytics')
    await wait(100)

    expect((window as unknown as Record<string, unknown>)[counter]).toBe(1)

    // Second grant — queue already drained and element already STATE_EXECUTED
    grant('analytics')
    await wait(100)

    expect((window as unknown as Record<string, unknown>)[counter]).toBe(1)

    // Confirm the original is still type=text/plain
    expect(el.getAttribute('type')).toBe('text/plain')
  })
})

// ---------------------------------------------------------------------------
// Auto-detected <img> pixel — fire-on-grant (task 003 AC6)
//
// These tests verify in real Chromium that the _injectImg() path actually
// promotes the stored src onto the <img> element when its category is granted.
//
// The "network request is issued" part of the acceptance bar requires a
// Playwright e2e fixture (task 005). Here we assert the DOM-observable
// outcome: img.src is assigned (which would cause a real network GET in a
// non-test context).
// ---------------------------------------------------------------------------

describe('auto-detected img pixel — src promoted in real browser (task 003 AC6)', () => {
  // Clean up any test img elements after each test
  afterEach(() => {
    _resetBlocker()
    for (const el of document.querySelectorAll('[data-test-blocking]')) {
      el.remove()
    }
  })

  it('a held auto-detected <img> pixel has its src promoted after marketing grant', async () => {
    // Build an img element that simulates what the proxy leaves behind:
    // data-cookyay-state="blocked", data-cookyay-auto="true", src NOT set.
    const img = document.createElement('img')
    img.setAttribute('data-cookyay-state', STATE_BLOCKED)
    img.setAttribute('data-cookyay-auto', 'true')
    img.setAttribute('data-category', 'marketing')
    img.setAttribute('data-test-blocking', 'true')
    // Pixel dimensions — typical tracking pixel setup
    img.width = 1
    img.height = 1
    img.style.display = 'none'
    document.body.appendChild(img)

    // Wire into the blocking queue via enqueueAutoDetected (the task 003 path)
    const pixelUrl = 'https://www.facebook.com/tr?id=123&ev=PageView&noscript=1'
    enqueueAutoDetected(img, pixelUrl, 'marketing')

    // Before grant: data-src set, src empty, state still blocked
    expect(img.getAttribute('data-src')).toBe(pixelUrl)
    expect(img.getAttribute('data-cookyay-state')).toBe(STATE_BLOCKED)

    // Grant the marketing category — _injectImg() fires via setTimeout(fn, 0)
    grant('marketing')
    await wait(50)

    // After grant: data-src removed, img.src is the pixel URL, state=executed
    expect(img.getAttribute('data-src')).toBeNull()
    // In real Chromium, src is normalised to an absolute URL
    expect(img.src).toContain('facebook.com/tr')
    expect(img.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })

  it('no new <img> element is created — _injectImg is in-place, not clone-and-reinsert', async () => {
    const img = document.createElement('img')
    img.setAttribute('data-cookyay-state', STATE_BLOCKED)
    img.setAttribute('data-cookyay-auto', 'true')
    img.setAttribute('data-category', 'marketing')
    img.setAttribute('data-test-blocking', 'true')
    document.body.appendChild(img)

    const pixelUrl = 'https://www.facebook.com/tr?id=789&ev=ViewContent'
    enqueueAutoDetected(img, pixelUrl, 'marketing')

    const imgsBefore = document.body.querySelectorAll('[data-test-blocking]').length
    grant('marketing')
    await wait(50)

    // Only one test img element — no clone was created
    const imgsAfter = document.body.querySelectorAll('[data-test-blocking]').length
    expect(imgsAfter).toBe(imgsBefore)
    expect(img.src).toContain('facebook.com/tr')
  })

  it('_injectImg sets STATE_EXECUTED before src assignment (re-interception guard)', async () => {
    // In a real browser, the ordering (STATE_EXECUTED set BEFORE src=)
    // is critical: if the proxy is active, it checks STATE_EXECUTED and skips
    // already-injected elements. We verify the resulting state here.
    const img = document.createElement('img')
    img.setAttribute('data-cookyay-state', STATE_BLOCKED)
    img.setAttribute('data-cookyay-auto', 'true')
    img.setAttribute('data-category', 'analytics')
    img.setAttribute('data-test-blocking', 'true')
    document.body.appendChild(img)

    const pixelUrl = 'https://connect.facebook.net/en_US/fbevents.js'
    enqueueAutoDetected(img, pixelUrl, 'analytics')

    grant('analytics')
    await wait(50)

    // STATE_EXECUTED is set — the proxy would skip this element on any future
    // src assignment, preventing re-interception.
    expect(img.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
    expect(img.src).toContain('facebook.net')
  })

  it('pixel fires exactly once on grant — fire-once semantics (AC4)', async () => {
    const img = document.createElement('img')
    img.setAttribute('data-cookyay-state', STATE_BLOCKED)
    img.setAttribute('data-cookyay-auto', 'true')
    img.setAttribute('data-category', 'marketing')
    img.setAttribute('data-test-blocking', 'true')
    document.body.appendChild(img)

    const pixelUrl = 'https://www.facebook.com/tr?id=111&ev=Purchase'
    enqueueAutoDetected(img, pixelUrl, 'marketing')

    // First grant
    grant('marketing')
    await wait(50)

    const srcAfterFirst = img.src
    expect(srcAfterFirst).toContain('facebook.com/tr')

    // Second grant — queue already drained; _injectImg checks STATE_EXECUTED
    grant('marketing')
    await wait(50)

    // src did not change — no second inject
    expect(img.src).toBe(srcAfterFirst)
    expect(img.getAttribute('data-cookyay-state')).toBe(STATE_EXECUTED)
  })
})
