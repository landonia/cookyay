// Withdrawal + re-prompt — real-browser tests (Vitest browser mode, Chromium)
//
// These tests cover what jsdom cannot validate:
// (a) Withdraw a granted category via preferences modal → toast appears; × dismisses it.
// (b) Grant-after-save actually EXECUTES a blocked inline script (real window side-effect,
//     not just attribute inspection — this is the whole reason browser-mode is required,
//     see architecture.md §10 testing row and blocking.browser.test.ts rationale).
// (c) Withdrawal save fires cookyay:change in a real browser event loop.
//
// Requires: @vitest/browser + playwright chromium (vitest.browser.config.ts)

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetApi, init } from './api.js'
import { _resetBanner } from './banner.js'
import { _resetPreferences, mountPreferences } from './preferences.js'
import { _resetWithdrawal } from './withdrawal.js'
import { buildConsentRecord, clearConsent, writeConsent } from './consent/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONFIG = {
  policyVersion: 'v1',
  categories: {
    necessary: { services: [{ name: 'Session' }] },
    functional: { services: [{ name: 'Chat' }] },
    analytics: { services: [{ name: 'GA4' }] },
    marketing: { services: [{ name: 'Pixel' }] },
  },
}

function allGranted() {
  return { necessary: true as const, functional: true as const, analytics: true as const, marketing: true as const }
}

function wait(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getModal(): HTMLElement | null {
  return document.getElementById('cookyay-preferences')
}

function getWithdrawalToast(): HTMLElement | null {
  return document.getElementById('cookyay-withdrawal-toast')
}

let _id = 0
function uid(): string {
  return `_cy_wd_${_id++}`
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearConsent()
  document.body.textContent = ''
})

afterEach(() => {
  _resetWithdrawal()
  _resetPreferences()
  _resetBanner()
  _resetApi()
  clearConsent()
  for (const el of document.querySelectorAll('[data-test-withdrawal]')) {
    el.remove()
  }
})

// ---------------------------------------------------------------------------
// (a) Withdraw → toast appears; × dismisses it
// ---------------------------------------------------------------------------

describe('withdrawal toast in real browser', () => {
  it('(a) revoking a granted category shows the toast', async () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(CONFIG)
    mountPreferences(null)
    await wait()

    const modal = getModal()!
    const analyticsSwitch = modal.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!
    expect(analyticsSwitch.getAttribute('aria-checked')).toBe('true')
    analyticsSwitch.click()
    await wait()

    modal.querySelector<HTMLElement>('[data-cookyay-save]')!.click()
    await wait()

    expect(getWithdrawalToast()).not.toBeNull()
  })

  it('(a) × close button dismisses the toast', async () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(CONFIG)
    mountPreferences(null)
    await wait()

    const modal = getModal()!
    modal.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!.click()
    modal.querySelector<HTMLElement>('[data-cookyay-save]')!.click()
    await wait()

    const toast = getWithdrawalToast()!
    toast.querySelector<HTMLElement>('[data-cookyay-withdrawal-close]')!.click()
    await wait()

    expect(getWithdrawalToast()).toBeNull()
  })

  it('(a) toast is NOT shown when no category is revoked', async () => {
    // Prior record has all denied; save with analytics newly enabled → only a grant, no withdrawal
    init(CONFIG)
    mountPreferences(null)
    await wait()

    const modal = getModal()!
    modal.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!.click()
    modal.querySelector<HTMLElement>('[data-cookyay-save]')!.click()
    await wait()

    expect(getWithdrawalToast()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (b) Grant-after-save executes a blocked inline script (real window side-effect)
// ---------------------------------------------------------------------------

describe('grant-after-save executes blocked script (real browser)', () => {
  it('(b) newly granted category causes blocked inline script to run', async () => {
    const flag = uid()
    ;(window as unknown as Record<string, unknown>)[flag] = false

    const script = document.createElement('script')
    script.setAttribute('type', 'text/plain')
    script.setAttribute('data-category', 'analytics')
    script.setAttribute('data-test-withdrawal', 'true')
    script.textContent = `window['${flag}'] = true`
    document.body.appendChild(script)

    // No prior consent — fresh visitor
    init(CONFIG)
    mountPreferences(null)
    await wait()

    const modal = getModal()!
    modal.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!.click()
    modal.querySelector<HTMLElement>('[data-cookyay-save]')!.click()
    await wait(100)  // allow setTimeout(fn, 0) in grant() to fire

    expect((window as unknown as Record<string, unknown>)[flag]).toBe(true)
  })

  it('(b) already-executed script is NOT re-run on a second save (idempotent)', async () => {
    const counter = uid()
    ;(window as unknown as Record<string, unknown>)[counter] = 0

    const script = document.createElement('script')
    script.setAttribute('type', 'text/plain')
    script.setAttribute('data-category', 'analytics')
    script.setAttribute('data-test-withdrawal', 'true')
    script.textContent = `window['${counter}'] = (window['${counter}'] || 0) + 1`
    document.body.appendChild(script)

    init(CONFIG)
    mountPreferences(null)
    await wait()

    // First save — grant analytics
    const modal1 = getModal()!
    modal1.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!.click()
    modal1.querySelector<HTMLElement>('[data-cookyay-save]')!.click()
    await wait(100)

    expect((window as unknown as Record<string, unknown>)[counter]).toBe(1)

    // Second save — analytics still on (no withdrawal, no re-execution)
    mountPreferences(null)
    await wait()
    getModal()!.querySelector<HTMLElement>('[data-cookyay-save]')!.click()
    await wait(100)

    expect((window as unknown as Record<string, unknown>)[counter]).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// (c) Withdrawal save fires cookyay:change
// ---------------------------------------------------------------------------

describe('cookyay:change on withdrawal in real browser', () => {
  it('(c) withdrawal save dispatches cookyay:change with updated categories', async () => {
    writeConsent(buildConsentRecord(allGranted(), 'v1', '0.1.0', false))
    init(CONFIG)

    let changeDetail: Record<string, unknown> | null = null
    function onchange(e: Event): void {
      changeDetail = (e as CustomEvent).detail as Record<string, unknown>
    }
    document.addEventListener('cookyay:change', onchange)

    mountPreferences(null)
    await wait()

    const modal = getModal()!
    modal.querySelector<HTMLElement>('[data-cookyay-switch="analytics"]')!.click()
    modal.querySelector<HTMLElement>('[data-cookyay-save]')!.click()
    await wait()

    document.removeEventListener('cookyay:change', onchange)

    expect(changeDetail).not.toBeNull()
    const cats = (changeDetail!['categories'] as Record<string, boolean>)
    expect(cats['analytics']).toBe(false)
    expect(cats['necessary']).toBe(true)
  })
})
