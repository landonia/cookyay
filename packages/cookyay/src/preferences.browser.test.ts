// Preferences modal — keyboard walkthrough in real Chromium browser (AC5)
//
// These tests verify the focus-trap and keyboard flow that CANNOT be fully
// validated in jsdom (real browser implements focus management differently):
//   - Focus lands on close button after mount (real browser activeElement)
//   - Tab wraps from last → first; Shift+Tab wraps from first → last
//   - Escape closes without saving in real browser
//   - Full walkthrough: open → toggle switch → save → focus returned to opener
//
// Requires: @vitest/browser + playwright chromium (vitest.browser.config.ts)

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetPreferences, mountPreferences } from './preferences.js'
import { _resetApi, init } from './api.js'
import { _resetBanner } from './banner.js'
import { clearConsent, readConsent } from './consent/index.js'

// ---------------------------------------------------------------------------
// Config fixture
// ---------------------------------------------------------------------------

const CONFIG = {
  policyVersion: 'v1',
  categories: {
    necessary: { label: 'Necessary', services: [{ name: 'Essential' }] },
    functional: { label: 'Functional', services: [{ name: 'Chat widget' }] },
    analytics: { label: 'Analytics', services: [{ name: 'GA4' }] },
    marketing: { label: 'Marketing', services: [{ name: 'Pixel' }] },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getModal(): HTMLElement | null {
  return document.getElementById('cookyay-preferences')
}

function wait(ms = 16): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearConsent()
  document.body.textContent = ''
})

afterEach(() => {
  _resetPreferences()
  _resetBanner()
  _resetApi()
  clearConsent()
})

// ---------------------------------------------------------------------------
// Keyboard walkthrough (real browser, AC5)
// ---------------------------------------------------------------------------

describe('keyboard walkthrough (real browser)', () => {
  it('focus lands on close button immediately after mount', async () => {
    const opener = document.createElement('button')
    opener.type = 'button'
    document.body.appendChild(opener)
    init(CONFIG)
    opener.focus()
    mountPreferences(opener)
    await wait()

    const closeBtn = getModal()?.querySelector<HTMLElement>('[data-cookyay-prefs-close]')
    expect(closeBtn).not.toBeNull()
    expect(document.activeElement).toBe(closeBtn)
  })

  it('Tab from last focusable (save) wraps to first (close) — real browser focus', async () => {
    init(CONFIG)
    mountPreferences(null)
    await wait()

    const modal = getModal()!
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>('button'))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    last.focus()
    await wait()

    expect(document.activeElement).toBe(last)

    const evt = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    let prevented = false
    evt.preventDefault = () => {
      prevented = true
    }
    modal.dispatchEvent(evt)
    await wait()

    expect(prevented).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('Shift+Tab from first focusable (close) wraps to last (save) — real browser focus', async () => {
    init(CONFIG)
    mountPreferences(null)
    await wait()

    const modal = getModal()!
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>('button'))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    first.focus()
    await wait()

    const evt = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    let prevented = false
    evt.preventDefault = () => {
      prevented = true
    }
    modal.dispatchEvent(evt)
    await wait()

    expect(prevented).toBe(true)
    expect(document.activeElement).toBe(last)
  })

  it('Escape closes without saving — real browser', async () => {
    init(CONFIG)
    mountPreferences(null)
    await wait()

    const modal = getModal()!
    const analyticsSwitch = modal.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!
    analyticsSwitch.click() // toggle on, then Escape should discard

    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait()

    expect(getModal()).toBeNull()
    expect(readConsent('v1')).toBeNull()
  })

  it('complete walkthrough: open → toggle analytics → save → focus returned to opener', async () => {
    // Create an opener button in the page
    const opener = document.createElement('button')
    opener.type = 'button'
    opener.textContent = 'Cookie settings'
    document.body.appendChild(opener)

    init(CONFIG)
    opener.focus()
    await wait()

    // Open preferences
    mountPreferences(opener)
    await wait()

    const modal = getModal()
    expect(modal).not.toBeNull()

    // Verify focus is inside the modal (on close button)
    const closeBtn = modal!.querySelector<HTMLElement>('[data-cookyay-prefs-close]')!
    expect(document.activeElement).toBe(closeBtn)

    // Tab to the analytics switch (index 2 in tab order: close, functional, analytics, …)
    const analyticsSwitch = modal!.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!
    analyticsSwitch.focus()
    await wait()
    expect(document.activeElement).toBe(analyticsSwitch)

    // Toggle analytics on (Space equivalent)
    expect(analyticsSwitch.getAttribute('aria-checked')).toBe('false')
    analyticsSwitch.click()
    expect(analyticsSwitch.getAttribute('aria-checked')).toBe('true')

    // Tab to save button and activate
    const saveBtn = modal!.querySelector<HTMLElement>('[data-cookyay-save]')!
    saveBtn.focus()
    saveBtn.click()
    await wait()

    // Consent saved with analytics enabled
    const record = readConsent('v1')
    expect(record).not.toBeNull()
    expect(record!.categories.necessary).toBe(true)
    expect(record!.categories.analytics).toBe(true)
    expect(record!.categories.functional).toBe(false)
    expect(record!.categories.marketing).toBe(false)

    // Modal closed
    expect(getModal()).toBeNull()

    // Focus returned to opener
    expect(document.activeElement).toBe(opener)
  })
})
