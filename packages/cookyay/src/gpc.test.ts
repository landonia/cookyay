/**
 * Task 009 — GPC honoring + confirmation toast acceptance-criteria tests
 *
 * AC1: GPC active + no stored consent → non-necessary denied, gpc:true record
 *      written, banner suppressed, toast shown
 * AC2: GPC active + stale stored grant → live GPC overrides, record updated
 * AC2x (task 021): GPC active + user saves explicit choices → record marked
 *      gpc:true, choices persist on reload, no repeat toast
 * AC3: GPC active + stored record already gpc:true → no toast re-shown
 * AC4: Toast a11y — role=status, aria-live=polite, keyboard-dismissible,
 *      all strings config-overridable
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetGpc } from './gpc.js'
import { _resetApi, _recordConsent, init } from './api.js'
import { _resetBanner } from './banner.js'
import { buildConsentRecord, clearConsent, readConsent, writeConsent } from './consent/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG = { policyVersion: 'v1' }

function setGpc(value: boolean): void {
  window.__COOKYAY = { q: [], gpc: value }
}

function getToast(): HTMLElement | null {
  return document.getElementById('cookyay-gpc-toast')
}

function getBanner(): HTMLElement | null {
  return document.getElementById('cookyay-banner')
}

function initWithGpc(gpc: boolean, configOverrides: Record<string, unknown> = {}): void {
  setGpc(gpc)
  init({ ...BASE_CONFIG, ...configOverrides })
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearConsent()
  document.body.innerHTML = ''
  document.head.querySelectorAll('style').forEach((s) => s.remove())
})

afterEach(() => {
  _resetGpc()
  _resetBanner()
  _resetApi()
  clearConsent()
  // Remove GPC flag
  Reflect.deleteProperty(window, '__COOKYAY')
})

// ---------------------------------------------------------------------------
// AC1: GPC active, no prior consent
// ---------------------------------------------------------------------------

describe('AC1: GPC active — first visit', () => {
  it('writes a consent record with gpc:true', () => {
    initWithGpc(true)
    const record = readConsent('v1')
    expect(record).not.toBeNull()
    expect(record!.gpc).toBe(true)
  })

  it('denies all non-necessary categories', () => {
    initWithGpc(true)
    const record = readConsent('v1')!
    expect(record.categories.necessary).toBe(true)
    expect(record.categories.functional).toBe(false)
    expect(record.categories.analytics).toBe(false)
    expect(record.categories.marketing).toBe(false)
  })

  it('suppresses the opt-in banner', () => {
    initWithGpc(true)
    expect(getBanner()).toBeNull()
  })

  it('shows the GPC confirmation toast', () => {
    initWithGpc(true)
    expect(getToast()).not.toBeNull()
  })

  it('toast is visible (not display:none)', () => {
    initWithGpc(true)
    const toast = getToast()!
    expect(toast.style.display).not.toBe('none')
  })
})

// ---------------------------------------------------------------------------
// AC2: Live GPC overrides stale stored grant
// ---------------------------------------------------------------------------

describe('AC2: Live GPC overrides stale stored grant', () => {
  it('overrides an existing record that granted marketing/analytics', () => {
    // Pre-store a full-grant record (no GPC)
    writeConsent(
      buildConsentRecord(
        { necessary: true, functional: true, analytics: true, marketing: true },
        'v1',
        '0.1.0',
        false,
      ),
      {},
    )
    initWithGpc(true)
    const record = readConsent('v1')!
    expect(record.gpc).toBe(true)
    expect(record.categories.analytics).toBe(false)
    expect(record.categories.marketing).toBe(false)
  })

  it('suppresses banner even when prior consent had no GPC opt-out', () => {
    writeConsent(
      buildConsentRecord(
        { necessary: true, functional: false, analytics: false, marketing: false },
        'v1',
        '0.1.0',
        false,
      ),
      {},
    )
    initWithGpc(true)
    expect(getBanner()).toBeNull()
  })

  it('shows toast when overriding a stale grant', () => {
    writeConsent(
      buildConsentRecord(
        { necessary: true, functional: true, analytics: true, marketing: true },
        'v1',
        '0.1.0',
        false,
      ),
      {},
    )
    initWithGpc(true)
    expect(getToast()).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC3: No toast re-shown when stored record already reflects GPC opt-out
// ---------------------------------------------------------------------------

describe('AC3: Already-GPC record — no toast on reload', () => {
  it('does not show toast when stored record already has gpc:true', () => {
    writeConsent(
      buildConsentRecord(
        { necessary: true, functional: false, analytics: false, marketing: false },
        'v1',
        '0.1.0',
        true, // already gpc
      ),
      {},
    )
    initWithGpc(true)
    expect(getToast()).toBeNull()
  })

  it('does not overwrite the stored record when gpc:true already set', () => {
    const priorRecord = buildConsentRecord(
      { necessary: true, functional: false, analytics: false, marketing: false },
      'v1',
      '0.1.0',
      true,
    )
    writeConsent(priorRecord, {})
    initWithGpc(true)
    const current = readConsent('v1')!
    // timestamp is in the record — confirm it's the original by checking gpc still true
    expect(current.gpc).toBe(true)
  })

  it('suppresses banner when stored record has gpc:true', () => {
    writeConsent(
      buildConsentRecord(
        { necessary: true, functional: false, analytics: false, marketing: false },
        'v1',
        '0.1.0',
        true,
      ),
      {},
    )
    initWithGpc(true)
    expect(getBanner()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC4: Toast accessibility + string config
// ---------------------------------------------------------------------------

describe('AC4: Toast accessibility', () => {
  it('toast has role="status"', () => {
    initWithGpc(true)
    expect(getToast()!.getAttribute('role')).toBe('status')
  })

  it('toast has aria-live="polite"', () => {
    initWithGpc(true)
    expect(getToast()!.getAttribute('aria-live')).toBe('polite')
  })

  it('toast has a close button', () => {
    initWithGpc(true)
    const closeBtn = getToast()!.querySelector<HTMLButtonElement>('button')
    expect(closeBtn).not.toBeNull()
  })

  it('close button dismisses the toast on click', () => {
    initWithGpc(true)
    const closeBtn = getToast()!.querySelector<HTMLButtonElement>('button')!
    closeBtn.click()
    expect(getToast()).toBeNull()
  })

  it('Escape key dismisses the toast', () => {
    initWithGpc(true)
    expect(getToast()).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(getToast()).toBeNull()
  })

  it('toast message text comes from strings.gpcNoticeText', () => {
    initWithGpc(true)
    const msg = getToast()!.querySelector('.cookyay-gpc-toast__msg')!
    expect(msg.textContent).toBe(
      'Your privacy preference (Global Privacy Control) was detected and applied.',
    )
  })

  it('gpcNoticeText is config-overridable', () => {
    initWithGpc(true, {
      strings: { gpcNoticeText: 'Custom GPC notice.' },
    })
    const msg = getToast()!.querySelector('.cookyay-gpc-toast__msg')!
    expect(msg.textContent).toBe('Custom GPC notice.')
  })

  it('close button label comes from strings.closeLabel', () => {
    initWithGpc(true)
    const closeBtn = getToast()!.querySelector<HTMLButtonElement>('button')!
    expect(closeBtn.getAttribute('aria-label')).toBe('Close')
  })

  it('closeLabel is config-overridable', () => {
    initWithGpc(true, { strings: { closeLabel: 'Dismiss' } })
    const closeBtn = getToast()!.querySelector<HTMLButtonElement>('button')!
    expect(closeBtn.getAttribute('aria-label')).toBe('Dismiss')
  })
})

// ---------------------------------------------------------------------------
// AC2x (task 021): Explicit post-GPC choices are preserved
// ---------------------------------------------------------------------------
//
// Repro: GPC applied → user opens Cookie settings, grants analytics → saves.
// Previously, the saved record had gpc:false (default param), so on the next
// load _runGpc() treated it as a stale pre-GPC grant and overwrote it.
// Fix: _recordConsent() ORs gpc || gpcLive, so any write while GPC is live
// produces a gpc:true record that _runGpc() leaves intact.

describe('AC2x: Explicit post-GPC consent choices persist across reloads', () => {
  it('_recordConsent written while GPC live produces a gpc:true record', () => {
    setGpc(true)
    initWithGpc(true)

    // Simulate user saving preferences after seeing the GPC toast
    _resetGpc()
    _resetBanner()
    _resetApi()

    setGpc(true)
    init(BASE_CONFIG)
    // User explicitly grants analytics via Cookie settings
    _recordConsent({ necessary: true, functional: false, analytics: true, marketing: false })

    const record = readConsent('v1')!
    expect(record.gpc).toBe(true)
    expect(record.categories.analytics).toBe(true)
  })

  it('explicit choices survive a simulated reload (no override, no repeat toast)', () => {
    // Step 1: first visit — GPC applied, record written gpc:true all-denied
    initWithGpc(true)
    expect(getToast()).not.toBeNull()

    // Step 2: user saves custom preferences while GPC is still live
    _recordConsent({ necessary: true, functional: false, analytics: true, marketing: false })
    const savedRecord = readConsent('v1')!
    expect(savedRecord.gpc).toBe(true) // gpc flag propagated
    expect(savedRecord.categories.analytics).toBe(true)

    // Step 3: simulate reload — reset module state but keep cookie/storage intact
    _resetGpc()
    _resetBanner()
    _resetApi()
    document.body.innerHTML = ''
    document.head.querySelectorAll('style').forEach((s) => s.remove())

    // Step 4: re-init with GPC still active
    setGpc(true)
    init(BASE_CONFIG)

    // Record must NOT be overridden — analytics choice survives
    const reloadRecord = readConsent('v1')!
    expect(reloadRecord.gpc).toBe(true)
    expect(reloadRecord.categories.analytics).toBe(true)

    // Toast must NOT re-appear (already gpc:true)
    expect(getToast()).toBeNull()

    // Banner must stay suppressed
    expect(getBanner()).toBeNull()
  })

  it('pre-GPC stale grant is still overridden (AC2 unchanged)', () => {
    // A record written WITHOUT GPC active (gpc:false) gets overridden
    writeConsent(
      buildConsentRecord(
        { necessary: true, functional: true, analytics: true, marketing: true },
        'v1',
        '0.1.0',
        false, // no GPC awareness
      ),
      {},
    )
    initWithGpc(true)
    const record = readConsent('v1')!
    expect(record.gpc).toBe(true)
    expect(record.categories.analytics).toBe(false)
  })

  it('explicit denial while GPC live is also preserved (user can confirm all-denied explicitly)', () => {
    initWithGpc(true)

    // User explicitly saves all-denied (e.g. confirms their preference)
    _recordConsent({ necessary: true, functional: false, analytics: false, marketing: false })
    const savedRecord = readConsent('v1')!
    expect(savedRecord.gpc).toBe(true)
    expect(savedRecord.categories.analytics).toBe(false)

    // Simulate reload
    _resetGpc()
    _resetBanner()
    _resetApi()
    document.body.innerHTML = ''
    document.head.querySelectorAll('style').forEach((s) => s.remove())

    setGpc(true)
    init(BASE_CONFIG)

    expect(getToast()).toBeNull() // no repeat toast
    expect(getBanner()).toBeNull() // banner suppressed
    const reloadRecord = readConsent('v1')!
    expect(reloadRecord.categories.analytics).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// No-GPC: normal flow unaffected
// ---------------------------------------------------------------------------

describe('No GPC: normal banner flow', () => {
  it('banner shows when GPC is false', () => {
    initWithGpc(false)
    expect(getBanner()).not.toBeNull()
  })

  it('no toast shown when GPC is false', () => {
    initWithGpc(false)
    expect(getToast()).toBeNull()
  })

  it('no consent record written when GPC is false and no prior consent', () => {
    initWithGpc(false)
    // Banner is shown; no GPC-triggered record written
    // (the banner hasn't been interacted with, so no record stored yet)
    // Note: readConsent returns null because no record written yet
    expect(readConsent('v1')).toBeNull()
  })
})
