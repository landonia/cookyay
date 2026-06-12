// First-layer banner UI (PRD §3.1, §3.3, Architecture §1 UI bundle)
//
// Three-action non-modal dialog (role=dialog, aria-modal=false by default).
// Config flag switches to modal (aria-modal=true + Tab focus trap).
// Escape never records consent — refocuses first button.
// Accept/Reject write the consent record and unblock queued scripts.
// A persistent re-open / "Do Not Sell or Share" affordance is auto-injected.
//
// WCAG 2.4.11: scroll-padding-bottom keeps focused page content visible.
// Default palette contrast ratios (WCAG 1.4.3 / 1.4.11):
//   #1a1a1a on #ffffff → 18.1:1  (text, secondary btn)   ✓
//   #ffffff on #1a1a1a → 18.1:1  (primary btn text)       ✓
//   #005fcc focus ring on #ffffff → 6.7:1 (≥3:1 for UI)  ✓

import type { CategoryId } from './consent/index.js'
import { CATEGORY_IDS, readConsent } from './consent/index.js'
import { grant } from './blocking.js'
import {
  _getConfig,
  _getStrings,
  _hasSeenThisSession,
  _recordConsent,
  _registerUI,
  openPreferences,
} from './api.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BANNER_ID = 'cookyay-banner'
const BANNER_HEADING_ID = 'cookyay-banner-heading'
const REOPEN_ID = 'cookyay-reopen'
const STYLES_ID = 'cookyay-styles'

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _bannerEl: HTMLElement | null = null
let _reopenEl: HTMLElement | null = null
let _resizeObserver: ResizeObserver | null = null

// ---------------------------------------------------------------------------
// CSS (injected once into <head>)
// ---------------------------------------------------------------------------

const STYLES = `
/* === Cookyay default theme ===
 * Override via CSS custom properties on any ancestor selector:
 * --cookyay-z        z-index (default: max safe integer - 1)
 * --cookyay-bg       banner/reopen background
 * --cookyay-text     text colour
 * --cookyay-border   banner top border / reopen border
 * --cookyay-btn-bg   primary button (Accept/Reject) background
 * --cookyay-btn-text primary button text
 * --cookyay-focus    focus outline colour
 * --cookyay-font     font-family
 * --cookyay-font-size base font size
 * --cookyay-radius   border-radius
 */

.cookyay-vsr {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0,0,0,0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}

#${BANNER_ID} {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: var(--cookyay-z, 2147483646);
  background: var(--cookyay-bg, #ffffff);
  color: var(--cookyay-text, #1a1a1a);
  border-top: 2px solid var(--cookyay-border, #1a1a1a);
  font-family: var(--cookyay-font, system-ui, -apple-system, "Segoe UI", sans-serif);
  font-size: var(--cookyay-font-size, 1rem);
  line-height: 1.5;
  box-sizing: border-box;
}

/* Forced-colors support: use system colours, not custom-property colours */
@media (forced-colors: active) {
  #${BANNER_ID} { border-top-color: ButtonText; }
  .cookyay-btn--primary { forced-color-adjust: none; }
}

#${BANNER_ID}[aria-modal="true"] {
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .45);
}

.cookyay-banner__inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1rem 1.25rem;
}

.cookyay-banner__title {
  margin: 0 0 .25rem;
  font-size: 1.125rem;
  font-weight: 700;
}

.cookyay-banner__desc {
  margin: 0 0 1rem;
}

.cookyay-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
  align-items: center;
}

.cookyay-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: .5rem 1.125rem;
  border-radius: var(--cookyay-radius, .25rem);
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.25;
  cursor: pointer;
  text-decoration: none;
  border: 2px solid transparent;
  transition: opacity .1s;
}

.cookyay-btn:focus-visible {
  outline: 3px solid var(--cookyay-focus, #005fcc);
  outline-offset: 2px;
}

/* Accept and Reject share identical styles — equal visual prominence (CNIL / EDPB) */
.cookyay-btn--primary {
  background: var(--cookyay-btn-bg, #1a1a1a);
  color: var(--cookyay-btn-text, #ffffff);
  border-color: var(--cookyay-btn-bg, #1a1a1a);
}

.cookyay-btn--primary:hover {
  opacity: .85;
}

.cookyay-btn--secondary {
  background: transparent;
  color: var(--cookyay-text, #1a1a1a);
  border-color: var(--cookyay-text, #1a1a1a);
}

.cookyay-btn--secondary:hover {
  background: var(--cookyay-text, #1a1a1a);
  color: var(--cookyay-bg, #ffffff);
}

/* Persistent re-open / "Do Not Sell or Share" affordance */
#${REOPEN_ID} {
  position: fixed;
  bottom: .75rem;
  left: .75rem;
  z-index: var(--cookyay-z, 2147483646);
  background: var(--cookyay-bg, #ffffff);
  color: var(--cookyay-text, #1a1a1a);
  border: 1px solid var(--cookyay-border, #9ca3af);
  border-radius: var(--cookyay-radius, .25rem);
  font-family: var(--cookyay-font, system-ui, sans-serif);
  font-size: .875rem;
  font-weight: 500;
  padding: .375rem .625rem;
  cursor: pointer;
  line-height: 1.25;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .1);
}

#${REOPEN_ID}:focus-visible {
  outline: 3px solid var(--cookyay-focus, #005fcc);
  outline-offset: 2px;
}

#${REOPEN_ID}:hover {
  border-color: var(--cookyay-text, #1a1a1a);
}
`

// ---------------------------------------------------------------------------
// Style injection
// ---------------------------------------------------------------------------

function _injectStyles(): void {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = STYLES
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// Banner DOM construction
// ---------------------------------------------------------------------------

function _buildBannerEl(): HTMLElement {
  const config = _getConfig()!
  const strings = _getStrings()
  const isModal = config.modal ?? false

  const banner = document.createElement('div')
  banner.id = BANNER_ID
  banner.setAttribute('role', 'dialog')
  banner.setAttribute('aria-modal', isModal ? 'true' : 'false')
  banner.setAttribute('aria-labelledby', BANNER_HEADING_ID)
  banner.setAttribute('tabindex', '-1')

  const inner = document.createElement('div')
  inner.className = 'cookyay-banner__inner'

  // Visually-hidden <h2> — accessible heading for screen reader navigation
  // (a11y rec 4: heading-jump shortcuts locate the banner; aria-labelledby references it)
  const heading = document.createElement('h2')
  heading.id = BANNER_HEADING_ID
  heading.className = 'cookyay-vsr'
  heading.textContent = strings.bannerTitle

  // Visible title (aria-hidden — screen readers read the heading above instead)
  const titleEl = document.createElement('p')
  titleEl.className = 'cookyay-banner__title'
  titleEl.setAttribute('aria-hidden', 'true')
  titleEl.textContent = strings.bannerTitle

  const descEl = document.createElement('p')
  descEl.className = 'cookyay-banner__desc'
  descEl.textContent = strings.bannerDescription

  const actionsEl = document.createElement('div')
  actionsEl.className = 'cookyay-banner__actions'

  // Accept all — primary button
  const acceptBtn = document.createElement('button')
  acceptBtn.type = 'button'
  acceptBtn.className = 'cookyay-btn cookyay-btn--primary'
  acceptBtn.setAttribute('data-cookyay-accept', '')
  acceptBtn.setAttribute('aria-label', strings['aria-accept-all'])
  acceptBtn.textContent = strings.acceptAllLabel
  acceptBtn.addEventListener('click', _handleAccept)

  // Reject all — primary button (intentionally identical class to Accept)
  const rejectBtn = document.createElement('button')
  rejectBtn.type = 'button'
  rejectBtn.className = 'cookyay-btn cookyay-btn--primary'
  rejectBtn.setAttribute('data-cookyay-reject', '')
  rejectBtn.setAttribute('aria-label', strings['aria-reject-all'])
  rejectBtn.textContent = strings.rejectAllLabel
  rejectBtn.addEventListener('click', _handleReject)

  // Manage preferences — secondary button
  const manageBtn = document.createElement('button')
  manageBtn.type = 'button'
  manageBtn.className = 'cookyay-btn cookyay-btn--secondary'
  manageBtn.setAttribute('data-cookyay-manage', '')
  manageBtn.setAttribute('aria-label', strings['aria-manage-preferences'])
  manageBtn.textContent = strings.managePreferencesLabel
  manageBtn.addEventListener('click', _handleManage)

  actionsEl.append(acceptBtn, rejectBtn, manageBtn)
  inner.append(heading, titleEl, descEl, actionsEl)
  banner.appendChild(inner)

  return banner
}

function _buildReopenEl(): HTMLElement {
  const strings = _getStrings()
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.id = REOPEN_ID
  btn.setAttribute('data-cookyay-open', '')
  btn.setAttribute('aria-label', strings.reopenLabel)
  btn.textContent = strings.reopenLabel
  return btn
}

// ---------------------------------------------------------------------------
// Scroll-padding compensation (WCAG 2.4.11 Focus Not Obscured)
// ---------------------------------------------------------------------------

function _applyScrollPadding(): void {
  const update = (): void => {
    if (!_bannerEl) return
    // getBoundingClientRect().height is 0 in jsdom (no layout engine);
    // fall back to a sensible default so the padding is always non-empty.
    const h = _bannerEl.getBoundingClientRect().height
    document.documentElement.style.scrollPaddingBottom = `${h || 80}px`
  }

  update()

  if (typeof ResizeObserver !== 'undefined' && _bannerEl) {
    _resizeObserver = new ResizeObserver(update)
    _resizeObserver.observe(_bannerEl)
  }
}

function _removeScrollPadding(): void {
  _resizeObserver?.disconnect()
  _resizeObserver = null
  document.documentElement.style.scrollPaddingBottom = ''
}

// ---------------------------------------------------------------------------
// Visibility helpers
// ---------------------------------------------------------------------------

function _showReopen(): void {
  if (_reopenEl) _reopenEl.style.display = ''
}

function _hideReopen(): void {
  if (_reopenEl) _reopenEl.style.display = 'none'
}

export function _hideBanner(): void {
  if (_bannerEl) {
    _bannerEl.removeEventListener('keydown', _handleKeydown)
    _bannerEl.remove()
    _bannerEl = null
  }
  _removeScrollPadding()
  _showReopen()
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function _handleAccept(): void {
  const all: Record<CategoryId, boolean> = {
    necessary: true,
    functional: true,
    analytics: true,
    marketing: true,
  }
  _recordConsent(all)
  // Grant each non-necessary category; grant() stagers via setTimeout(fn,0)
  for (const cat of CATEGORY_IDS) {
    if (cat !== 'necessary') grant(cat)
  }
  _hideBanner()
}

function _handleReject(): void {
  _recordConsent({
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  })
  _hideBanner()
}

function _handleManage(): void {
  openPreferences()
}

function _handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    // Never record consent on Escape — refocus first button only (PRD Amendment)
    e.stopPropagation()
    const firstBtn = _bannerEl?.querySelector<HTMLButtonElement>('button')
    firstBtn?.focus()
    return
  }

  // Tab focus trap — only active in modal mode
  if (e.key === 'Tab' && _getConfig()?.modal) {
    if (!_bannerEl) return
    const focusables = Array.from(
      _bannerEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
}

// Auto-close when consent is recorded from an external path (e.g., preferences modal task 008)
function _handleConsentRecorded(): void {
  if (_bannerEl) _hideBanner()
}

// ---------------------------------------------------------------------------
// Main mount function
// ---------------------------------------------------------------------------

export function mountBanner(): void {
  const config = _getConfig()
  if (!config) return

  // init() may run from <head> before <body> is parsed; defer mounting until body exists.
  // Mirrors the DOMContentLoaded pattern in api.ts _scanDOM().
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => mountBanner(), { once: true })
    return
  }

  // Inject re-open / "Do Not Sell or Share" affordance (always-present, config opt-out)
  if (config.autoOpenLink !== false && !document.getElementById(REOPEN_ID)) {
    _injectStyles()
    _reopenEl = _buildReopenEl()
    document.body.appendChild(_reopenEl)
  }

  // Consent already given or updated this session — never re-prompt mid-session
  // (covers: policy-version bump during SPA session, short-lived cookie expiry)
  if (_hasSeenThisSession()) return

  // Returning visitors with valid consent see no banner
  const existing = readConsent(config.policyVersion)
  if (existing) return

  _injectStyles()
  _bannerEl = _buildBannerEl()
  document.body.appendChild(_bannerEl)

  // Re-open link is redundant while banner is visible
  _hideReopen()

  // Scroll-padding compensation — WCAG 2.4.11
  _applyScrollPadding()

  // Move focus to first button on mount (a11y rec 3 — more reliable than aria-live)
  const firstBtn = _bannerEl.querySelector<HTMLButtonElement>('button')
  firstBtn?.focus()

  // Keyboard handler (Escape + modal Tab trap)
  _bannerEl.addEventListener('keydown', _handleKeydown)

  // Auto-close if consent is recorded by a different path (preferences modal)
  document.addEventListener('cookyay:consent', _handleConsentRecorded, { once: true })
}

// ---------------------------------------------------------------------------
// Test-only reset
// ---------------------------------------------------------------------------

export function _resetBanner(): void {
  _hideBanner()
  if (_reopenEl) {
    _reopenEl.remove()
    _reopenEl = null
  }
  document.getElementById(STYLES_ID)?.remove()
  document.removeEventListener('cookyay:consent', _handleConsentRecorded)
}

// ---------------------------------------------------------------------------
// Self-register with the API on module load (IoC — avoids circular import)
// ---------------------------------------------------------------------------

_registerUI(mountBanner)
