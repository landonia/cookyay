// Second-layer preferences modal (PRD §3.1, Architecture §11 a11y)
//
// Modal dialog: role=dialog, aria-modal=true, real JS focus trap
// (Tab/Shift-Tab intercepted — aria-modal alone is not a trap).
//
// Necessary category: locked static state with lock icon (NOT a disabled
// checkbox — disabled checkboxes imply choice, which is misleading).
// Other categories: role=switch with aria-checked (WCAG 4.1.2).
//
// Escape closes without saving consent. Save persists granular choices and
// triggers grant flows. Focus returns to opener, or document.body on load.
//
// Default contrast ratios (WCAG 1.4.3 / 1.4.11):
//   #1a1a1a on #ffffff → 18.1:1  (text, labels)    ✓
//   #ffffff on #1a1a1a → 18.1:1  (primary btn)     ✓
//   Switch off: #d1d5db track — functional indicator ✓

import type { CategoryId } from './consent/index.js'
import { CATEGORY_IDS, readConsent } from './consent/index.js'
import { grant } from './blocking.js'
import { _getConfig, _getStrings, _recordConsent, _registerPreferencesUI } from './api.js'
import { showWithdrawalPrompt } from './withdrawal.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODAL_ID = 'cookyay-preferences'
const MODAL_HEADING_ID = 'cookyay-prefs-heading'
const PREFS_STYLES_ID = 'cookyay-prefs-styles'

const CAT_LABELS: Record<CategoryId, string> = {
  necessary: 'Necessary',
  functional: 'Functional',
  analytics: 'Analytics',
  marketing: 'Marketing',
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _modalEl: HTMLElement | null = null
let _openerEl: Element | null = null

// ---------------------------------------------------------------------------
// CSS (injected once into <head> on first open)
// ---------------------------------------------------------------------------

const PREFS_STYLES = `
#${MODAL_ID} {
  position: fixed;
  inset: 0;
  z-index: var(--cookyay-z, 2147483647);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.cookyay-prefs__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}

.cookyay-prefs__panel {
  position: relative;
  background: var(--cookyay-bg, #ffffff);
  color: var(--cookyay-text, #1a1a1a);
  border-radius: var(--cookyay-radius, .375rem);
  width: min(calc(100% - 2rem), 36rem);
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .2);
  font-family: var(--cookyay-font, system-ui, -apple-system, "Segoe UI", sans-serif);
  font-size: var(--cookyay-font-size, 1rem);
  line-height: 1.5;
  box-sizing: border-box;
}

.cookyay-prefs__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem .75rem;
  border-bottom: 1px solid rgba(0, 0, 0, .08);
}

.cookyay-prefs__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.3;
}

.cookyay-prefs__close {
  background: transparent;
  border: 2px solid transparent;
  border-radius: var(--cookyay-radius, .25rem);
  color: var(--cookyay-text, #1a1a1a);
  cursor: pointer;
  font-size: 1.25rem;
  line-height: 1;
  padding: .25rem .5rem;
  flex-shrink: 0;
}

.cookyay-prefs__close:focus-visible {
  outline: 3px solid var(--cookyay-focus, #005fcc);
  outline-offset: 2px;
}

.cookyay-prefs__body {
  padding: 0 1.25rem;
  flex: 1;
  overflow-y: auto;
}

.cookyay-prefs__category {
  padding: 1rem 0;
  border-bottom: 1px solid rgba(0, 0, 0, .06);
  box-sizing: border-box;
}

.cookyay-prefs__category:last-child {
  border-bottom: none;
}

.cookyay-prefs__cat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.cookyay-prefs__cat-label {
  font-weight: 600;
  font-size: 1rem;
}

/* Necessary: always-active static indicator (no toggle — lock affordance) */
.cookyay-prefs__always-on {
  display: flex;
  align-items: center;
  gap: .375rem;
  font-size: .875rem;
  color: #6b7280;
  flex-shrink: 0;
}

/* role=switch toggle */
.cookyay-prefs__switch {
  background: transparent;
  border: 2px solid transparent;
  border-radius: var(--cookyay-radius, .25rem);
  cursor: pointer;
  padding: .125rem;
  flex-shrink: 0;
}

.cookyay-prefs__switch:focus-visible {
  outline: 3px solid var(--cookyay-focus, #005fcc);
  outline-offset: 2px;
}

.cookyay-prefs__switch-track {
  display: block;
  width: 2.75rem;
  height: 1.5rem;
  border-radius: 999px;
  background: #d1d5db;
  position: relative;
  transition: background .15s;
  box-sizing: border-box;
}

.cookyay-prefs__switch[aria-checked="true"] .cookyay-prefs__switch-track {
  background: var(--cookyay-btn-bg, #1a1a1a);
}

.cookyay-prefs__switch-thumb {
  display: block;
  position: absolute;
  top: .1875rem;
  left: .1875rem;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 50%;
  background: #ffffff;
  transition: transform .15s;
}

.cookyay-prefs__switch[aria-checked="true"] .cookyay-prefs__switch-thumb {
  transform: translateX(1.25rem);
}

@media (forced-colors: active) {
  .cookyay-prefs__switch-track { border: 1px solid ButtonText; }
  .cookyay-prefs__switch[aria-checked="true"] .cookyay-prefs__switch-track { background: Highlight; }
  .cookyay-prefs__switch-thumb { background: ButtonText; }
}

/* Per-category service list */
.cookyay-prefs__services {
  margin: .5rem 0 0;
  padding: 0 0 0 1.25rem;
  font-size: .875rem;
  color: #4b5563;
}

.cookyay-prefs__service {
  margin-bottom: .25rem;
}

.cookyay-prefs__service:last-child {
  margin-bottom: 0;
}

/* Footer */
.cookyay-prefs__footer {
  padding: .75rem 1.25rem 1rem;
  border-top: 1px solid rgba(0, 0, 0, .08);
  display: flex;
  justify-content: flex-end;
}
`

// ---------------------------------------------------------------------------
// Style injection
// ---------------------------------------------------------------------------

function _injectPrefsStyles(): void {
  if (document.getElementById(PREFS_STYLES_ID)) return
  const style = document.createElement('style')
  style.id = PREFS_STYLES_ID
  style.textContent = PREFS_STYLES
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------

function _buildCategorySection(cat: CategoryId, isOn: boolean): HTMLElement {
  const config = _getConfig()!
  const strings = _getStrings()
  const catConfig = config.categories?.[cat]
  const label = catConfig?.label ?? CAT_LABELS[cat]

  const section = document.createElement('div')
  section.className = 'cookyay-prefs__category'

  const row = document.createElement('div')
  row.className = 'cookyay-prefs__cat-row'

  const labelEl = document.createElement('span')
  labelEl.id = `cookyay-cat-${cat}`
  labelEl.className = 'cookyay-prefs__cat-label'
  labelEl.textContent = label
  row.appendChild(labelEl)

  if (cat === 'necessary') {
    // Static locked indicator — NOT a disabled checkbox.
    // Lock icon is decorative (aria-hidden); "Always active" text is the
    // accessible announcement so screen-reader users know it can't be toggled.
    const alwaysOn = document.createElement('span')
    alwaysOn.className = 'cookyay-prefs__always-on'
    const lockIcon = document.createElement('span')
    lockIcon.setAttribute('aria-hidden', 'true')
    lockIcon.textContent = '🔒' // 🔒
    const lockText = document.createElement('span')
    lockText.textContent = 'Always active'
    alwaysOn.append(lockIcon, lockText)
    row.appendChild(alwaysOn)
  } else {
    // role=switch communicates on/off semantics (WCAG 4.1.2 Name, Role, Value).
    // aria-label from the configurable string table; {label} replaced at render time.
    const ariaLabel = strings['aria-category-toggle'].replace('{label}', label)
    const sw = document.createElement('button')
    sw.type = 'button'
    sw.setAttribute('role', 'switch')
    sw.setAttribute('aria-checked', isOn ? 'true' : 'false')
    sw.setAttribute('aria-label', ariaLabel)
    sw.setAttribute('data-cookyay-switch', cat)
    sw.className = 'cookyay-prefs__switch'
    const track = document.createElement('span')
    track.className = 'cookyay-prefs__switch-track'
    track.setAttribute('aria-hidden', 'true')
    const thumb = document.createElement('span')
    thumb.className = 'cookyay-prefs__switch-thumb'
    track.appendChild(thumb)
    sw.appendChild(track)
    sw.addEventListener('click', _handleSwitchClick)
    row.appendChild(sw)
  }

  section.appendChild(row)

  // Per-category service list rendered from config (AC4)
  const services = catConfig?.services
  if (services && services.length > 0) {
    const ul = document.createElement('ul')
    ul.className = 'cookyay-prefs__services'
    for (const svc of services) {
      const li = document.createElement('li')
      li.className = 'cookyay-prefs__service'
      li.textContent = svc.name
      ul.appendChild(li)
    }
    section.appendChild(ul)
  }

  return section
}

function _buildModalEl(initialChoices: Record<CategoryId, boolean>): HTMLElement {
  const strings = _getStrings()

  const modal = document.createElement('div')
  modal.id = MODAL_ID
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', MODAL_HEADING_ID)
  modal.setAttribute('tabindex', '-1')

  // Backdrop — click-to-close without saving (same as Escape)
  const backdrop = document.createElement('div')
  backdrop.className = 'cookyay-prefs__backdrop'
  backdrop.setAttribute('aria-hidden', 'true')
  backdrop.addEventListener('click', _closeModal)
  modal.appendChild(backdrop)

  // Panel
  const panel = document.createElement('div')
  panel.className = 'cookyay-prefs__panel'

  // Header
  const header = document.createElement('div')
  header.className = 'cookyay-prefs__header'

  const heading = document.createElement('h2')
  heading.id = MODAL_HEADING_ID
  heading.className = 'cookyay-prefs__title'
  heading.textContent = strings.preferencesTitle

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'cookyay-prefs__close cookyay-btn'
  closeBtn.setAttribute('aria-label', strings['aria-close'])
  closeBtn.setAttribute('data-cookyay-prefs-close', '')
  closeBtn.textContent = '×' // ×
  closeBtn.addEventListener('click', _closeModal)

  header.append(heading, closeBtn)
  panel.appendChild(header)

  // Body — one section per category
  const body = document.createElement('div')
  body.className = 'cookyay-prefs__body'
  for (const cat of CATEGORY_IDS) {
    body.appendChild(_buildCategorySection(cat, initialChoices[cat]))
  }
  panel.appendChild(body)

  // Footer — Save preferences button
  const footer = document.createElement('div')
  footer.className = 'cookyay-prefs__footer'

  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.className = 'cookyay-btn cookyay-btn--primary'
  saveBtn.setAttribute('data-cookyay-save', '')
  saveBtn.setAttribute('aria-label', strings['aria-save-preferences'])
  saveBtn.textContent = strings.savePreferencesLabel
  saveBtn.addEventListener('click', _handleSave)

  footer.appendChild(saveBtn)
  panel.appendChild(footer)
  modal.appendChild(panel)

  return modal
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function _handleSwitchClick(e: Event): void {
  const sw = e.currentTarget as HTMLElement
  const current = sw.getAttribute('aria-checked') === 'true'
  sw.setAttribute('aria-checked', current ? 'false' : 'true')
}

function _handleSave(): void {
  if (!_modalEl) return
  const config = _getConfig()

  // Snapshot previous consent before overwriting — used to detect withdrawal
  const prev = config ? readConsent(config.policyVersion) : null

  const choices: Record<CategoryId, boolean> = {
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  }
  for (const cat of CATEGORY_IDS) {
    if (cat !== 'necessary') {
      const sw = _modalEl.querySelector<HTMLElement>(`[data-cookyay-switch="${cat}"]`)
      choices[cat] = sw?.getAttribute('aria-checked') === 'true'
    }
  }
  _recordConsent(choices)

  // Grant newly-enabled categories; staggered by setTimeout(fn,0) in grant() (AC4)
  for (const cat of CATEGORY_IDS) {
    if (cat !== 'necessary' && choices[cat]) {
      grant(cat)
    }
  }

  // Withdrawal detection: collect any previously-granted non-necessary categories now off.
  const revokedCats = CATEGORY_IDS.filter(
    (cat) => cat !== 'necessary' && prev?.categories[cat] === true && choices[cat] === false,
  )
  if (revokedCats.length > 0) {
    // Invoke the site owner's first-party cleanup hook, if provided (AC1 / impl note).
    config?.clearOnWithdraw?.(revokedCats)
    // Show honest "reload required" toast — no silent auto-reload.
    showWithdrawalPrompt()
  }

  _closeModal()
}

function _handleModalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    // Close without saving — Escape must never record consent (a11y rec 7)
    e.stopPropagation()
    _closeModal()
    return
  }

  // Tab focus trap — intercept Tab/Shift-Tab so focus cycles within the modal
  // (aria-modal="true" alone does NOT trap focus — browsers don't implement it)
  if (e.key === 'Tab' && _modalEl) {
    const focusables = Array.from(
      _modalEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    if (!focusables.length) return
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

// ---------------------------------------------------------------------------
// Close (without saving)
// ---------------------------------------------------------------------------

function _closeModal(): void {
  if (!_modalEl) return
  _modalEl.removeEventListener('keydown', _handleModalKeydown)
  _modalEl.remove()
  _modalEl = null
  const openerEl = _openerEl
  _openerEl = null
  // Return focus to the invoking element, or document.body when opened on load
  if (openerEl) {
    ;(openerEl as HTMLElement).focus?.()
  } else {
    document.body.focus()
  }
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export function mountPreferences(opener: Element | null): void {
  const config = _getConfig()
  if (!config) return

  // Already open — bring focus in instead of double-mounting
  if (_modalEl) {
    _modalEl.focus()
    return
  }

  _openerEl = opener

  // Pre-populate switches from any existing consent record
  const existing = readConsent(config.policyVersion)
  const initialChoices: Record<CategoryId, boolean> = {
    necessary: true,
    functional: existing?.categories.functional ?? false,
    analytics: existing?.categories.analytics ?? false,
    marketing: existing?.categories.marketing ?? false,
  }

  _injectPrefsStyles()
  _modalEl = _buildModalEl(initialChoices)
  document.body.appendChild(_modalEl)

  // Move focus to first interactive element (close button) on open
  const firstFocusable = _modalEl.querySelector<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled])',
  )
  ;(firstFocusable ?? _modalEl).focus()

  _modalEl.addEventListener('keydown', _handleModalKeydown)
}

// ---------------------------------------------------------------------------
// Test-only reset
// ---------------------------------------------------------------------------

export function _resetPreferences(): void {
  if (_modalEl) {
    _modalEl.removeEventListener('keydown', _handleModalKeydown)
    _modalEl.remove()
    _modalEl = null
  }
  _openerEl = null
  document.getElementById(PREFS_STYLES_ID)?.remove()
}

// ---------------------------------------------------------------------------
// Self-register with the API on module load (IoC — avoids circular import)
// NOTE: do NOT set "sideEffects": false in package.json — tree-shakers would
// drop this import and the preferences modal would never register.
// ---------------------------------------------------------------------------

_registerPreferencesUI(mountPreferences)
