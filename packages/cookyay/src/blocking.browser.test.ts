// Declarative blocking engine — real-browser execution tests (Vitest browser mode)
//
// These tests verify the acceptance criteria that CANNOT be validated in jsdom:
//   - A script executes after category grant via clone-and-reinsert
//   - The original element retains type="text/plain" (type is never mutated)
//   - Already-granted (state=executed) elements are not re-executed
//
// Requires: @vitest/browser + playwright chromium (see vitest.browser.config.ts)

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STATE_EXECUTED, _resetBlocker, grant, scanBlocked } from './blocking.js'

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
  return new Promise(resolve => setTimeout(resolve, ms))
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

    scanBlocked()  // should skip
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
    grant('analytics')   // different category
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
