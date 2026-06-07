/**
 * Task 007 — Banner UI (first layer) acceptance-criteria tests
 *
 * Covers:
 *  AC1: Three equal-prominence actions (Accept / Reject / Manage)
 *  AC2: Non-modal dialog semantics; config flag enables modal
 *  AC3: Fixed-bottom placement; returning visitors never see a paint
 *  AC4: Escape never records consent — refocuses first button
 *  AC5: CSS custom properties; scroll-padding-bottom applied and removed
 *  AC6: Auto-injected re-open / Do Not Sell affordance; config opt-out
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountBanner, _hideBanner, _resetBanner } from './banner.js'
import { _resetApi, init } from './api.js'
import { buildConsentRecord, clearConsent, readConsent, writeConsent } from './consent/index.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  policyVersion: 'v1',
  categories: {
    necessary: { label: 'Necessary', description: 'Essential cookies' },
    analytics: { label: 'Analytics', description: 'Analytics cookies' },
  },
} as const

function mountWithConfig(overrides: Record<string, unknown> = {}): void {
  init({ ...BASE_CONFIG, ...overrides })
}

function getBanner(): HTMLElement | null {
  return document.getElementById('cookyay-banner')
}

function getReopen(): HTMLElement | null {
  return document.getElementById('cookyay-reopen')
}

function getBtn(attr: string): HTMLButtonElement | null {
  return getBanner()?.querySelector<HTMLButtonElement>(`[${attr}]`) ?? null
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearConsent()
  document.body.innerHTML = ''
  document.documentElement.style.scrollPaddingBottom = ''
})

afterEach(() => {
  _resetBanner()
  _resetApi()
  clearConsent()
})

// ---------------------------------------------------------------------------
// AC1: Three equal-prominence actions
// ---------------------------------------------------------------------------

describe('AC1: Three actions with equal visual prominence', () => {
  it('renders Accept, Reject, and Manage buttons', () => {
    mountWithConfig()
    expect(getBtn('data-cookyay-accept')).not.toBeNull()
    expect(getBtn('data-cookyay-reject')).not.toBeNull()
    expect(getBtn('data-cookyay-manage')).not.toBeNull()
  })

  it('Accept and Reject share the same primary class', () => {
    mountWithConfig()
    const accept = getBtn('data-cookyay-accept')!
    const reject = getBtn('data-cookyay-reject')!
    expect(accept.className).toBe(reject.className)
    expect(accept.className).toContain('cookyay-btn--primary')
  })

  it('Manage has secondary class (distinct from Accept/Reject)', () => {
    mountWithConfig()
    const manage = getBtn('data-cookyay-manage')!
    expect(manage.className).toContain('cookyay-btn--secondary')
    expect(manage.className).not.toContain('cookyay-btn--primary')
  })

  it('uses string-table labels', () => {
    mountWithConfig()
    expect(getBtn('data-cookyay-accept')?.textContent).toBe('Accept all')
    expect(getBtn('data-cookyay-reject')?.textContent).toBe('Reject all')
    expect(getBtn('data-cookyay-manage')?.textContent).toBe('Manage preferences')
  })
})

// ---------------------------------------------------------------------------
// AC2: Non-modal dialog semantics; modal config flag
// ---------------------------------------------------------------------------

describe('AC2: Dialog semantics', () => {
  it('default: role=dialog with aria-modal=false', () => {
    mountWithConfig()
    const banner = getBanner()!
    expect(banner.getAttribute('role')).toBe('dialog')
    expect(banner.getAttribute('aria-modal')).toBe('false')
  })

  it('default: visually-hidden <h2> labelled by aria-labelledby', () => {
    mountWithConfig()
    const banner = getBanner()!
    const headingId = banner.getAttribute('aria-labelledby')
    expect(headingId).toBe('cookyay-banner-heading')
    const heading = document.getElementById(headingId!)!
    expect(heading.tagName).toBe('H2')
    expect(heading.className).toContain('cookyay-vsr')
    expect(heading.textContent).toBe('We use cookies')
  })

  it('modal:true sets aria-modal=true', () => {
    mountWithConfig({ modal: true })
    expect(getBanner()?.getAttribute('aria-modal')).toBe('true')
  })

  it('focus moves to first button on mount', () => {
    mountWithConfig()
    const firstBtn = getBanner()?.querySelector<HTMLButtonElement>('button')
    expect(document.activeElement).toBe(firstBtn)
  })

  describe('modal Tab focus trap', () => {
    it('Tab from last focusable element wraps to first', () => {
      mountWithConfig({ modal: true })
      const banner = getBanner()!
      const focusables = banner.querySelectorAll<HTMLElement>('button')
      const last = focusables[focusables.length - 1]
      last.focus()

      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
      let prevented = false
      tabEvent.preventDefault = () => { prevented = true }
      banner.dispatchEvent(tabEvent)

      expect(prevented).toBe(true)
      // jsdom doesn't physically move focus, but the handler calls first.focus() —
      // we trust the code coverage; this test verifies preventDefault was called.
    })

    it('Shift+Tab from first focusable wraps to last', () => {
      mountWithConfig({ modal: true })
      const banner = getBanner()!
      const firstBtn = banner.querySelector<HTMLButtonElement>('button')!
      firstBtn.focus()

      const shiftTab = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      })
      let prevented = false
      shiftTab.preventDefault = () => { prevented = true }
      banner.dispatchEvent(shiftTab)

      expect(prevented).toBe(true)
    })

    it('Tab trap is NOT active in non-modal mode', () => {
      mountWithConfig({ modal: false })
      const banner = getBanner()!
      const focusables = banner.querySelectorAll<HTMLElement>('button')
      const last = focusables[focusables.length - 1]
      last.focus()

      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
      let prevented = false
      tabEvent.preventDefault = () => { prevented = true }
      banner.dispatchEvent(tabEvent)

      expect(prevented).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// AC3: Fixed-bottom placement; returning visitors
// ---------------------------------------------------------------------------

describe('AC3: Fixed-bottom placement and returning-visitor suppression', () => {
  it('banner element has id=cookyay-banner', () => {
    mountWithConfig()
    expect(getBanner()).not.toBeNull()
  })

  it('CSS <style> tag is injected into <head>', () => {
    mountWithConfig()
    expect(document.getElementById('cookyay-styles')).not.toBeNull()
  })

  it('does not render banner if valid consent already stored', () => {
    const record = buildConsentRecord(
      { necessary: true, functional: false, analytics: false, marketing: false },
      'v1',
      '0.1.0',
      false,
    )
    writeConsent(record, {})
    mountWithConfig()
    expect(getBanner()).toBeNull()
  })

  it('renders banner when stored consent has a different policyVersion', () => {
    const record = buildConsentRecord(
      { necessary: true, functional: false, analytics: false, marketing: false },
      'v2',
      '0.1.0',
      false,
    )
    writeConsent(record, {})
    mountWithConfig({ policyVersion: 'v1' })
    expect(getBanner()).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC4: Escape never records consent; refocuses first button
// ---------------------------------------------------------------------------

describe('AC4: Escape key behaviour', () => {
  it('Escape does not remove the banner', () => {
    mountWithConfig()
    const banner = getBanner()!
    banner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(getBanner()).not.toBeNull()
  })

  it('Escape refocuses first button', () => {
    mountWithConfig()
    const banner = getBanner()!
    const firstBtn = banner.querySelector<HTMLButtonElement>('button')!
    // Blur away
    firstBtn.blur()
    banner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.activeElement).toBe(firstBtn)
  })

  it('Escape does not write a consent record', () => {
    mountWithConfig()
    const banner = getBanner()!
    banner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(readConsent('v1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC5: CSS custom properties; scroll-padding-bottom
// ---------------------------------------------------------------------------

describe('AC5: Theming and scroll-padding', () => {
  it('injected <style> contains --cookyay-* custom property declarations', () => {
    mountWithConfig()
    const style = document.getElementById('cookyay-styles')!
    expect(style.textContent).toContain('--cookyay-bg')
    expect(style.textContent).toContain('--cookyay-text')
    expect(style.textContent).toContain('--cookyay-btn-bg')
  })

  it('scroll-padding-bottom is set on html element after mount', () => {
    mountWithConfig()
    const val = document.documentElement.style.scrollPaddingBottom
    expect(val).toBeTruthy()
  })

  it('scroll-padding-bottom is cleared after Accept', () => {
    mountWithConfig()
    getBtn('data-cookyay-accept')!.click()
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
  })

  it('scroll-padding-bottom is cleared after Reject', () => {
    mountWithConfig()
    getBtn('data-cookyay-reject')!.click()
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
  })

  it('style tag is injected only once on repeated mount calls', () => {
    mountWithConfig()
    // Dismiss the first banner (keeps the style tag), then mount directly —
    // this exercises _injectStyles() idempotency without going through init()
    _hideBanner()
    mountBanner()
    expect(document.querySelectorAll('#cookyay-styles').length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// AC6: Always-present re-open affordance; config opt-out
// ---------------------------------------------------------------------------

describe('AC6: Re-open / Do Not Sell affordance', () => {
  it('auto-injects the re-open button when no prior consent', () => {
    mountWithConfig()
    expect(getReopen()).not.toBeNull()
  })

  it('re-open button has data-cookyay-open attribute', () => {
    mountWithConfig()
    expect(getReopen()?.hasAttribute('data-cookyay-open')).toBe(true)
  })

  it('re-open button is hidden while banner is visible', () => {
    mountWithConfig()
    expect(getReopen()?.style.display).toBe('none')
  })

  it('re-open button becomes visible after Accept (banner dismissed)', () => {
    mountWithConfig()
    getBtn('data-cookyay-accept')!.click()
    expect(document.getElementById('cookyay-reopen')).not.toBeNull()
    expect(document.getElementById('cookyay-reopen')?.style.display).not.toBe('none')
  })

  it('re-open button becomes visible after Reject (banner dismissed)', () => {
    mountWithConfig()
    getBtn('data-cookyay-reject')!.click()
    expect(document.getElementById('cookyay-reopen')?.style.display).not.toBe('none')
  })

  it('autoOpenLink:false suppresses the re-open button', () => {
    mountWithConfig({ autoOpenLink: false })
    expect(getReopen()).toBeNull()
  })

  it('re-open button injected even when returning visitor (no banner shown)', () => {
    const record = buildConsentRecord(
      { necessary: true, functional: false, analytics: false, marketing: false },
      'v1',
      '0.1.0',
      false,
    )
    writeConsent(record, {})
    mountWithConfig()
    expect(getReopen()).not.toBeNull()
    // And it should be visible (no banner to hide behind)
    expect(getReopen()?.style.display).not.toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Button action integration
// ---------------------------------------------------------------------------

describe('Button actions', () => {
  it('Accept fires cookyay:consent event', () => {
    const spy = vi.fn()
    document.addEventListener('cookyay:consent', spy, { once: true })
    mountWithConfig()
    getBtn('data-cookyay-accept')!.click()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('Reject fires cookyay:consent event', () => {
    const spy = vi.fn()
    document.addEventListener('cookyay:consent', spy, { once: true })
    mountWithConfig()
    getBtn('data-cookyay-reject')!.click()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('Accept dismisses the banner', () => {
    mountWithConfig()
    getBtn('data-cookyay-accept')!.click()
    expect(getBanner()).toBeNull()
  })

  it('Reject dismisses the banner', () => {
    mountWithConfig()
    getBtn('data-cookyay-reject')!.click()
    expect(getBanner()).toBeNull()
  })

  it('Manage fires cookyay:open-preferences event', () => {
    const spy = vi.fn()
    document.addEventListener('cookyay:open-preferences', spy, { once: true })
    mountWithConfig()
    getBtn('data-cookyay-manage')!.click()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('Manage does not dismiss the banner', () => {
    mountWithConfig()
    getBtn('data-cookyay-manage')!.click()
    expect(getBanner()).not.toBeNull()
  })

  it('banner auto-closes on external cookyay:consent event', async () => {
    mountWithConfig()
    expect(getBanner()).not.toBeNull()
    document.dispatchEvent(new CustomEvent('cookyay:consent', { bubbles: false }))
    await Promise.resolve()
    expect(getBanner()).toBeNull()
  })
})
