// Google Consent Mode v2 integration — v1 mapping
// PRD §3.4 | prd §7 risk: API drift is isolated to this file (version the mapping module)
//
// Seven-signal deterministic map from four banner categories:
//   necessary  → functionality_storage + security_storage  (always granted; necessary is not toggleable)
//   functional → personalization_storage
//   analytics  → analytics_storage
//   marketing  → ad_storage + ad_user_data + ad_personalization
//
// This module registers a document listener at import time. The side-effect import in
// index.ts wires it up automatically when the UI bundle loads.

import type { CategoryId } from './consent/index.js'
import type { ConsentEventDetail } from './events.js'

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

export type ConsentSignalValue = 'granted' | 'denied'

export interface ConsentModeSignals {
  functionality_storage: ConsentSignalValue
  security_storage: ConsentSignalValue
  personalization_storage: ConsentSignalValue
  analytics_storage: ConsentSignalValue
  ad_storage: ConsentSignalValue
  ad_user_data: ConsentSignalValue
  ad_personalization: ConsentSignalValue
}

// ---------------------------------------------------------------------------
// Signal map — isolated here for Consent Mode API drift containment
// ---------------------------------------------------------------------------

/**
 * Build the seven Consent Mode v2 signals from banner category choices.
 *
 * Mapping (deterministic, documented in §3.4):
 *   necessary  → functionality_storage + security_storage (always granted)
 *   functional → personalization_storage
 *   analytics  → analytics_storage
 *   marketing  → ad_storage + ad_user_data + ad_personalization
 */
export function buildConsentModeSignals(
  categories: Record<CategoryId, boolean>,
): ConsentModeSignals {
  const g = (v: boolean): ConsentSignalValue => (v ? 'granted' : 'denied')
  return {
    functionality_storage:   g(categories.necessary),
    security_storage:        g(categories.necessary),
    personalization_storage: g(categories.functional),
    analytics_storage:       g(categories.analytics),
    ad_storage:              g(categories.marketing),
    ad_user_data:            g(categories.marketing),
    ad_personalization:      g(categories.marketing),
  }
}

// ---------------------------------------------------------------------------
// Update path
// ---------------------------------------------------------------------------

/**
 * Fire gtag('consent','update', …) with the correct seven-signal map.
 * No-op if gtag is not available (non-Google-tag environments).
 *
 * Uses an inline cast for `window.gtag` so this module does not depend on
 * the `declare global` in bootstrap.ts — tsup compiles each entry in an
 * isolated program and the bootstrap augmentation would be absent.
 */
export function applyConsentModeUpdate(categories: Record<CategoryId, boolean>): void {
  if (typeof window === 'undefined') return
  const gtag = (window as Window & { gtag?: (...args: unknown[]) => void }).gtag
  if (typeof gtag !== 'function') return
  gtag('consent', 'update', buildConsentModeSignals(categories))
}

// ---------------------------------------------------------------------------
// Event listener — fires on every _recordConsent call via cookyay:consent
// ---------------------------------------------------------------------------

function _handleConsentEvent(e: Event): void {
  const detail = (e as CustomEvent<ConsentEventDetail>).detail
  applyConsentModeUpdate(detail.categories)
}

let _attached = false

function _attach(): void {
  if (typeof document === 'undefined' || _attached) return
  document.addEventListener('cookyay:consent', _handleConsentEvent)
  _attached = true
}

function _detach(): void {
  if (typeof document === 'undefined' || !_attached) return
  document.removeEventListener('cookyay:consent', _handleConsentEvent)
  _attached = false
}

// Auto-attach at import time
_attach()

// ---------------------------------------------------------------------------
// Test-only reset
// ---------------------------------------------------------------------------

/** @internal Exported for test teardown only. */
export function _resetConsentMode(): void {
  _detach()
  _attach()
}
