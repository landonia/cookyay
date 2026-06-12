// Withdrawal "reload recommended" prompt (PRD §3.2, Architecture §6)
//
// When a visitor withdraws a previously granted category (i.e. saves preferences
// with a category switched off that was previously on), already-executed scripts
// cannot be un-run without a page reload.  A dismissible toast explains this
// honestly and offers a "Reload page" button — no silent auto-reload.
//
// Design mirrors the GPC toast (role="status", aria-live="polite") to reuse
// the established pattern.  The dismiss × and optional reload button satisfy the
// "easy withdrawal" posture (GDPR Art. 7(3)) while being honest about runtime
// limitations [research: integration-engineer §Rec 7, compliance §Gotcha 5].

import { _getStrings } from './api.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOAST_ID = 'cookyay-withdrawal-toast'
const TOAST_STYLES_ID = 'cookyay-withdrawal-styles'

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const TOAST_CSS = `
#${TOAST_ID} {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: var(--cookyay-z, 2147483647);
  max-width: 26rem;
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
  flex-direction: column;
  gap: .5rem;
  box-sizing: border-box;
}
@media (forced-colors: active) {
  #${TOAST_ID} { border-color: ButtonText; }
}
.cookyay-withdrawal__row {
  display: flex;
  align-items: flex-start;
  gap: .5rem;
}
.cookyay-withdrawal__msg {
  flex: 1;
}
.cookyay-withdrawal__close {
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
.cookyay-withdrawal__close:focus-visible {
  outline: 3px solid var(--cookyay-focus, #005fcc);
  outline-offset: 2px;
}
.cookyay-withdrawal__close:hover {
  background: var(--cookyay-text, #1a1a1a);
  color: var(--cookyay-bg, #ffffff);
}
.cookyay-withdrawal__reload {
  align-self: flex-end;
  background: var(--cookyay-btn-bg, #1a1a1a);
  color: var(--cookyay-btn-text, #ffffff);
  border: 2px solid var(--cookyay-btn-bg, #1a1a1a);
  border-radius: var(--cookyay-radius, .25rem);
  cursor: pointer;
  font-family: inherit;
  font-size: .875rem;
  font-weight: 600;
  line-height: 1.25;
  padding: .375rem .75rem;
}
.cookyay-withdrawal__reload:focus-visible {
  outline: 3px solid var(--cookyay-focus, #005fcc);
  outline-offset: 2px;
}
.cookyay-withdrawal__reload:hover {
  opacity: .85;
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
  container.setAttribute('data-cookyay-withdrawal', '')

  const row = document.createElement('div')
  row.className = 'cookyay-withdrawal__row'

  const msg = document.createElement('span')
  msg.className = 'cookyay-withdrawal__msg'
  msg.textContent = strings.withdrawalPromptText

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'cookyay-withdrawal__close'
  closeBtn.setAttribute('aria-label', strings.closeLabel)
  closeBtn.setAttribute('data-cookyay-withdrawal-close', '')
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', dismiss)

  row.append(msg, closeBtn)
  container.appendChild(row)

  const reloadBtn = document.createElement('button')
  reloadBtn.type = 'button'
  reloadBtn.className = 'cookyay-withdrawal__reload'
  reloadBtn.setAttribute('data-cookyay-withdrawal-reload', '')
  reloadBtn.textContent = strings.reloadLabel
  reloadBtn.addEventListener('click', _reload)
  container.appendChild(reloadBtn)

  return container
}

function dismiss(): void {
  if (!_toastEl) return
  _toastEl.remove()
  _toastEl = null
}

function _reload(): void {
  window.location.reload()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show the "reload recommended" withdrawal prompt.
 *
 * Safe to call multiple times — if the toast is already visible it is replaced
 * (e.g. the visitor opens preferences a second time and withdraws another category).
 */
export function showWithdrawalPrompt(): void {
  // Replace any existing instance so the toast is always fresh
  if (_toastEl) {
    _toastEl.remove()
    _toastEl = null
  }

  _injectStyles()
  _toastEl = _buildToast()

  if (!document.body) {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        if (_toastEl) document.body.appendChild(_toastEl)
      },
      { once: true },
    )
  } else {
    document.body.appendChild(_toastEl)
  }
}

// ---------------------------------------------------------------------------
// Test-only reset
// ---------------------------------------------------------------------------

export function _resetWithdrawal(): void {
  dismiss()
  document.getElementById(TOAST_STYLES_ID)?.remove()
}
