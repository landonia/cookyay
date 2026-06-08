// GPC (Global Privacy Control) policy + confirmation toast (PRD §3.3, CCPA regs 2026-01-01)
//
// Architecture §13 decision: separate toast container (role="status", aria-live="polite"),
// NOT the banner's dialog container. Rationale: the banner is a consent-choice dialog;
// the toast is a polite informational status message — semantically distinct elements
// with different AT announcement behaviours.
//
// Policy: if navigator.globalPrivacyControl === true (captured by bootstrap),
//   - override any stored record that was NOT written with knowledge of GPC
//     (gpc:false records — pre-GPC stale grants, CCPA §1798.135)
//   - write a denied record with gpc:true
//   - suppress the banner (mountBanner() finds the written record, returns early)
//   - show a dismissible toast exactly once (suppressed if stored record already has gpc:true)
//
// Explicit post-GPC choices (PRD §3.3, CCPA §7025(c)(2)):
//   When a user saves preferences while GPC is live, _recordConsent() marks that record
//   gpc:true (see api.ts — effectiveGpc). On subsequent loads, alreadyGpc === true so
//   _runGpc() leaves the record intact and skips the toast. Stored choices persist.

import { _getConfig, _getStrings, _recordConsent, _registerGpcUI } from './api.js'
import { readConsent } from './consent/index.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOAST_ID = 'cookyay-gpc-toast'
const TOAST_STYLES_ID = 'cookyay-gpc-styles'

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const TOAST_CSS = `
#${TOAST_ID} {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: var(--cookyay-z, 2147483646);
  max-width: 24rem;
  background: var(--cookyay-bg, #ffffff);
  color: var(--cookyay-text, #1a1a1a);
  border: 1px solid var(--cookyay-border, #1a1a1a);
  border-radius: var(--cookyay-radius, .25rem);
  font-family: var(--cookyay-font, system-ui, -apple-system, "Segoe UI", sans-serif);
  font-size: .875rem;
  line-height: 1.5;
  padding: .75rem 1rem;
  box-shadow: 0 2px 8px rgba(0,0,0,.15);
  display: flex;
  align-items: flex-start;
  gap: .5rem;
  box-sizing: border-box;
}
@media (forced-colors: active) {
  #${TOAST_ID} { border-color: ButtonText; }
}
.cookyay-gpc-toast__msg {
  flex: 1;
}
.cookyay-gpc-toast__close {
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1;
  padding: 0 .25rem;
  color: var(--cookyay-text, #1a1a1a);
  flex-shrink: 0;
  border-radius: var(--cookyay-radius, .25rem);
}
.cookyay-gpc-toast__close:focus-visible {
  outline: 3px solid var(--cookyay-focus, #005fcc);
  outline-offset: 2px;
}
.cookyay-gpc-toast__close:hover {
  background: var(--cookyay-text, #1a1a1a);
  color: var(--cookyay-bg, #ffffff);
}
`

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _toastEl: HTMLElement | null = null

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function _injectStyles(): void {
  if (document.getElementById(TOAST_STYLES_ID)) return
  const style = document.createElement('style')
  style.id = TOAST_STYLES_ID
  style.textContent = TOAST_CSS
  document.head.appendChild(style)
}

function _buildToast(): HTMLElement {
  const strings = _getStrings()

  const container = document.createElement('div')
  container.id = TOAST_ID
  container.setAttribute('role', 'status')
  container.setAttribute('aria-live', 'polite')

  const msg = document.createElement('span')
  msg.className = 'cookyay-gpc-toast__msg'
  msg.textContent = strings.gpcNoticeText

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'cookyay-gpc-toast__close'
  closeBtn.setAttribute('aria-label', strings.closeLabel)
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', _dismiss)

  container.append(msg, closeBtn)
  return container
}

function _dismiss(): void {
  if (!_toastEl) return
  _toastEl.remove()
  _toastEl = null
  document.removeEventListener('keydown', _handleKeydown)
}

function _handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') _dismiss()
}

function _mountToast(): void {
  _injectStyles()
  _toastEl = _buildToast()
  document.body.appendChild(_toastEl)
  document.addEventListener('keydown', _handleKeydown)
}

// ---------------------------------------------------------------------------
// GPC policy
// ---------------------------------------------------------------------------

function _runGpc(): void {
  const gpcActive = typeof window !== 'undefined' && !!(window as typeof window & { __COOKYAY?: { gpc: boolean } }).__COOKYAY?.gpc
  if (!gpcActive) return

  const config = _getConfig()!

  // Check whether stored record already reflects GPC opt-out
  const existing = readConsent(config.policyVersion)
  const alreadyGpc = existing?.gpc === true

  if (alreadyGpc) {
    // Record is correct; banner will be suppressed by mountBanner() finding it.
    // No toast re-shown on repeated page loads.
    return
  }

  // Write denied record with gpc:true, overriding any stale stored grant.
  _recordConsent(
    { necessary: true, functional: false, analytics: false, marketing: false },
    true,
  )

  // Mount toast once DOM is ready
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', _mountToast, { once: true })
  } else {
    _mountToast()
  }
}

// ---------------------------------------------------------------------------
// IoC registration — runs at module load time, same pattern as banner.ts
// ---------------------------------------------------------------------------

_registerGpcUI(_runGpc)

// ---------------------------------------------------------------------------
// Test-only reset
// ---------------------------------------------------------------------------

export function _resetGpc(): void {
  _dismiss()
  document.getElementById(TOAST_STYLES_ID)?.remove()
}
