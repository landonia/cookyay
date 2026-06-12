/**
 * Task 008 — Preferences modal acceptance-criteria tests (jsdom)
 *
 * AC1: Focus trap (Tab/Shift-Tab) + focus return to opener or document.body
 * AC2: role=switch toggles; necessary locked static, still announced to SR
 * AC3: Escape closes without saving any consent change
 * AC4: Save persists granular choices, triggers grant event, service lists render
 * AC5 (keyboard walkthrough in real browser) → preferences.browser.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetPreferences, mountPreferences } from './preferences.js'
import { _resetApi, init } from './api.js'
import { _resetBanner } from './banner.js'
import { buildConsentRecord, clearConsent, readConsent, writeConsent } from './consent/index.js'

// ---------------------------------------------------------------------------
// Config fixture
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  policyVersion: 'v1',
  categories: {
    necessary: { label: 'Necessary', services: [{ name: 'Session cookie' }] },
    functional: { label: 'Functional', services: [{ name: 'Zendesk Chat' }] },
    analytics: { label: 'Analytics', services: [{ name: 'Google Analytics' }] },
    marketing: { label: 'Marketing', services: [{ name: 'Facebook Pixel' }] },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openModal(overrides: Record<string, unknown> = {}): void {
  init({ ...BASE_CONFIG, ...overrides })
  mountPreferences(null)
}

function getModal(): HTMLElement | null {
  return document.getElementById('cookyay-preferences')
}

function getSwitch(cat: string): HTMLElement | null {
  return getModal()?.querySelector<HTMLElement>(`[data-cookyay-switch="${cat}"]`) ?? null
}

function getSaveBtn(): HTMLElement | null {
  return getModal()?.querySelector<HTMLElement>('[data-cookyay-save]') ?? null
}

function getCloseBtn(): HTMLElement | null {
  return getModal()?.querySelector<HTMLElement>('[data-cookyay-prefs-close]') ?? null
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearConsent()
  document.body.innerHTML = ''
  document.head.querySelectorAll('#cookyay-prefs-styles').forEach((el) => el.remove())
})

afterEach(() => {
  _resetPreferences()
  _resetBanner()
  _resetApi()
  clearConsent()
})

// ---------------------------------------------------------------------------
// AC1: JS focus trap (Tab/Shift-Tab intercepted)
// ---------------------------------------------------------------------------

describe('AC1: Focus trap', () => {
  it('modal renders with role=dialog and aria-modal=true', () => {
    openModal()
    const modal = getModal()!
    expect(modal.getAttribute('role')).toBe('dialog')
    expect(modal.getAttribute('aria-modal')).toBe('true')
  })

  it('modal is labelled via aria-labelledby pointing to the heading', () => {
    openModal()
    const modal = getModal()!
    const headingId = modal.getAttribute('aria-labelledby')!
    const heading = document.getElementById(headingId)!
    expect(heading.tagName).toBe('H2')
    expect(heading.textContent).toBe('Cookie preferences')
  })

  it('focus moves to first interactive element (close button) on mount', () => {
    openModal()
    const closeBtn = getCloseBtn()!
    expect(document.activeElement).toBe(closeBtn)
  })

  it('Tab from last focusable element wraps to first (preventDefault called)', () => {
    openModal()
    const modal = getModal()!
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>('button'))
    const last = focusables[focusables.length - 1]
    last.focus()

    const evt = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    let prevented = false
    evt.preventDefault = () => {
      prevented = true
    }
    modal.dispatchEvent(evt)

    expect(prevented).toBe(true)
    // Handler calls first.focus() — confirm activeElement moved
    expect(document.activeElement).toBe(focusables[0])
  })

  it('Shift+Tab from first focusable element wraps to last (preventDefault called)', () => {
    openModal()
    const modal = getModal()!
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>('button'))
    const first = focusables[0]
    first.focus()

    const evt = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
    let prevented = false
    evt.preventDefault = () => {
      prevented = true
    }
    modal.dispatchEvent(evt)

    expect(prevented).toBe(true)
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })

  it('Tab in the middle of the list does not wrap (no preventDefault)', () => {
    openModal()
    const modal = getModal()!
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>('button'))
    // Focus a middle element (index 1 if it exists)
    const mid = focusables[1] ?? focusables[0]
    mid.focus()

    const evt = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    let prevented = false
    evt.preventDefault = () => {
      prevented = true
    }
    modal.dispatchEvent(evt)

    expect(prevented).toBe(false)
  })

  it('focus returns to opener element on close (close button)', () => {
    init(BASE_CONFIG)
    const opener = document.createElement('button')
    opener.type = 'button'
    opener.textContent = 'Open preferences'
    document.body.appendChild(opener)
    opener.focus()

    mountPreferences(opener)
    expect(getModal()).not.toBeNull()

    getCloseBtn()!.click()

    expect(getModal()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('focus returns to opener element on close (save button)', () => {
    init(BASE_CONFIG)
    const opener = document.createElement('button')
    opener.type = 'button'
    document.body.appendChild(opener)
    opener.focus()

    mountPreferences(opener)
    getSaveBtn()!.click()

    expect(document.activeElement).toBe(opener)
  })

  it('calling mountPreferences again while open re-focuses the existing modal', () => {
    init(BASE_CONFIG)
    mountPreferences(null)
    const first = getModal()
    mountPreferences(null)
    // Same modal element — not double-mounted
    expect(getModal()).toBe(first)
  })
})

// ---------------------------------------------------------------------------
// AC2: role=switch toggles; necessary locked static
// ---------------------------------------------------------------------------

describe('AC2: Toggle semantics', () => {
  it('non-necessary categories render as role=switch buttons', () => {
    openModal()
    const switches = getModal()!.querySelectorAll('[role="switch"]')
    expect(switches.length).toBe(3) // functional, analytics, marketing
  })

  it('each switch has aria-checked attribute ("true" or "false")', () => {
    openModal()
    const switches = getModal()!.querySelectorAll('[role="switch"]')
    for (const sw of switches) {
      expect(['true', 'false']).toContain(sw.getAttribute('aria-checked'))
    }
  })

  it('switch aria-label uses the aria-category-toggle string with label filled in', () => {
    openModal()
    const analyticsSwitch = getSwitch('analytics')!
    expect(analyticsSwitch.getAttribute('aria-label')).toBe('Toggle Analytics cookies')
  })

  it('clicking a switch toggles aria-checked from false to true', () => {
    openModal()
    const sw = getSwitch('analytics')!
    expect(sw.getAttribute('aria-checked')).toBe('false')
    sw.click()
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('clicking a switch again toggles aria-checked back to false', () => {
    openModal()
    const sw = getSwitch('analytics')!
    sw.click()
    sw.click()
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('switches pre-populate from existing consent record', () => {
    const record = buildConsentRecord(
      { necessary: true, functional: true, analytics: false, marketing: true },
      'v1',
      '0.1.0',
      false,
    )
    writeConsent(record, {})
    openModal()
    expect(getSwitch('functional')?.getAttribute('aria-checked')).toBe('true')
    expect(getSwitch('analytics')?.getAttribute('aria-checked')).toBe('false')
    expect(getSwitch('marketing')?.getAttribute('aria-checked')).toBe('true')
  })

  it('necessary category has NO role=switch element', () => {
    openModal()
    expect(getModal()!.querySelector('[data-cookyay-switch="necessary"]')).toBeNull()
  })

  it('necessary category renders the lock affordance (always-on indicator)', () => {
    openModal()
    const alwaysOn = getModal()!.querySelector('.cookyay-prefs__always-on')!
    expect(alwaysOn).not.toBeNull()
  })

  it('lock icon is decorative (aria-hidden); "Always active" text is SR-readable', () => {
    openModal()
    const alwaysOn = getModal()!.querySelector('.cookyay-prefs__always-on')!
    const lockIcon = alwaysOn.querySelector('[aria-hidden="true"]')!
    expect(lockIcon).not.toBeNull()
    // Text content visible to SR
    const textNode = [...alwaysOn.children].find((el) => !el.hasAttribute('aria-hidden'))
    expect(textNode?.textContent).toBe('Always active')
  })

  it('necessary label element is in the DOM (SR can navigate to it)', () => {
    openModal()
    const necLabel = document.getElementById('cookyay-cat-necessary')!
    expect(necLabel).not.toBeNull()
    expect(necLabel.textContent).toBe('Necessary')
  })
})

// ---------------------------------------------------------------------------
// AC3: Escape closes without saving
// ---------------------------------------------------------------------------

describe('AC3: Escape key behaviour', () => {
  it('Escape closes the preferences modal', () => {
    openModal()
    const modal = getModal()!
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(getModal()).toBeNull()
  })

  it('Escape does not write a consent record', () => {
    openModal()
    const modal = getModal()!
    // Toggle something to make sure a save would have changed state
    getSwitch('analytics')!.click()
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(readConsent('v1')).toBeNull()
  })

  it('close button closes the modal without saving', () => {
    openModal()
    getSwitch('analytics')!.click()
    getCloseBtn()!.click()
    expect(getModal()).toBeNull()
    expect(readConsent('v1')).toBeNull()
  })

  it('backdrop click closes without saving', () => {
    openModal()
    getSwitch('analytics')!.click()
    const backdrop = getModal()!.querySelector<HTMLElement>('.cookyay-prefs__backdrop')!
    backdrop.click()
    expect(getModal()).toBeNull()
    expect(readConsent('v1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC4: Save persists choices + grant flows + service lists
// ---------------------------------------------------------------------------

describe('AC4: Save action', () => {
  it('Save writes a consent record', () => {
    openModal()
    getSaveBtn()!.click()
    expect(readConsent('v1')).not.toBeNull()
  })

  it('Save persists only the toggled-on categories', () => {
    openModal()
    getSwitch('analytics')!.click() // enable analytics
    getSaveBtn()!.click()
    const record = readConsent('v1')!
    expect(record.categories.necessary).toBe(true)
    expect(record.categories.analytics).toBe(true)
    expect(record.categories.functional).toBe(false)
    expect(record.categories.marketing).toBe(false)
  })

  it('Save all categories on', () => {
    openModal()
    getSwitch('functional')!.click()
    getSwitch('analytics')!.click()
    getSwitch('marketing')!.click()
    getSaveBtn()!.click()
    const record = readConsent('v1')!
    expect(record.categories).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  })

  it('Save closes the modal', () => {
    openModal()
    getSaveBtn()!.click()
    expect(getModal()).toBeNull()
  })

  it('Save dispatches cookyay:consent event', () => {
    openModal()
    const spy = vi.fn()
    document.addEventListener('cookyay:consent', spy, { once: true })
    getSaveBtn()!.click()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('Save with analytics enabled dispatches cookyay:consent before closing', () => {
    openModal()
    getSwitch('analytics')!.click()
    let consentFiredBeforeClose = false
    document.addEventListener(
      'cookyay:consent',
      () => {
        consentFiredBeforeClose = getModal() !== null
      },
      { once: true },
    )
    getSaveBtn()!.click()
    expect(consentFiredBeforeClose).toBe(true)
  })

  it('style tag injected once — idempotent on repeated opens', () => {
    openModal()
    _resetPreferences()
    // Reset banner and re-init to allow a second mountPreferences call
    _resetBanner()
    _resetApi()
    init(BASE_CONFIG)
    mountPreferences(null)
    expect(document.querySelectorAll('#cookyay-prefs-styles').length).toBe(1)
  })

  it('per-category service list renders from config', () => {
    openModal()
    const services = getModal()!.querySelectorAll('.cookyay-prefs__service')
    const names = [...services].map((el) => el.textContent)
    expect(names).toContain('Google Analytics')
    expect(names).toContain('Facebook Pixel')
    expect(names).toContain('Zendesk Chat')
    expect(names).toContain('Session cookie')
  })

  it('category without services renders no service list element', () => {
    init({ policyVersion: 'v1', categories: { analytics: { label: 'Analytics' } } })
    mountPreferences(null)
    // analytics has no services → no .cookyay-prefs__services under analytics section
    const analyticsCatRow = getModal()!
      .querySelector('[data-cookyay-switch="analytics"]')!
      .closest('.cookyay-prefs__category')!
    expect(analyticsCatRow.querySelector('.cookyay-prefs__services')).toBeNull()
  })

  it('uses the string table label for the save button', () => {
    openModal()
    expect(getSaveBtn()!.textContent).toBe('Save preferences')
  })

  it('uses a custom string table when config.strings is set', () => {
    openModal({ strings: { savePreferencesLabel: 'Enregistrer', preferencesTitle: 'Préférences' } })
    expect(getSaveBtn()!.textContent).toBe('Enregistrer')
    expect(getModal()!.querySelector('.cookyay-prefs__title')!.textContent).toBe('Préférences')
  })
})

// ---------------------------------------------------------------------------
// Integration: openPreferences() API route
// ---------------------------------------------------------------------------

describe('openPreferences() integration', () => {
  it('openPreferences() mounts the modal', async () => {
    const { openPreferences } = await import('./api.js')
    init(BASE_CONFIG)
    openPreferences()
    expect(getModal()).not.toBeNull()
  })

  it('openPreferences() still dispatches cookyay:open-preferences event', async () => {
    const { openPreferences } = await import('./api.js')
    init(BASE_CONFIG)
    const spy = vi.fn()
    document.addEventListener('cookyay:open-preferences', spy, { once: true })
    openPreferences()
    expect(spy).toHaveBeenCalledOnce()
  })
})
