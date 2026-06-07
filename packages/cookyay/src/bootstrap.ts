// Cookyay bootstrap — synchronous <head> snippet.
// Reads consent cookie, stubs dataLayer/gtag, fires Consent Mode v2 defaults,
// detects GPC, and arms the declarative script/iframe intercept queue.
// Must be the first <script> in <head>, before GTM/GA tags.

// ---------------------------------------------------------------------------
// Global type extensions (stripped at compile time, zero runtime cost)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
    /**
     * Intercept contract for task 005.
     * q  — elements with type="text/plain" waiting to be unblocked on consent.
     * gpc — navigator.globalPrivacyControl captured at boot.
     */
    __COOKYAY: { q: Element[]; gpc: boolean }
  }
  interface Navigator {
    /** Global Privacy Control (CCPA / browser-native; may be absent) */
    globalPrivacyControl?: boolean
  }
}

// ---------------------------------------------------------------------------
// Consent Mode v2 signal defaults
// ---------------------------------------------------------------------------

interface ConsentDefaults {
  ad_storage: 'denied' | 'granted'
  analytics_storage: 'denied' | 'granted'
  ad_user_data: 'denied' | 'granted'
  ad_personalization: 'denied' | 'granted'
  functionality_storage: 'denied' | 'granted'
  personalization_storage: 'denied' | 'granted'
  security_storage: 'denied' | 'granted'
  wait_for_update: number
}

function buildDefaults(): ConsentDefaults {
  return {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'denied',
    wait_for_update: 500,
  }
}

// ---------------------------------------------------------------------------
// Cookie parser — inline to keep bootstrap self-contained
// ---------------------------------------------------------------------------

function applyStoredChoices(defaults: ConsentDefaults): void {
  const m = document.cookie.match(/(?:^|;\s*)cookyay_consent=([^;]+)/)
  if (!m) return
  try {
    const p = JSON.parse(decodeURIComponent(m[1])) as Record<string, unknown>
    if (p?.sv !== 1 || !p?.c || typeof p.c !== 'object') return
    const c = p.c as Record<string, boolean>
    // necessary → functionality + security (always true in a valid record)
    if (c.n) {
      defaults.functionality_storage = 'granted'
      defaults.security_storage = 'granted'
    }
    // functional → functionality (overlaps with necessary) + personalization
    if (c.f) {
      defaults.functionality_storage = 'granted'
      defaults.personalization_storage = 'granted'
    }
    if (c.a) defaults.analytics_storage = 'granted'
    // marketing → ad signals
    if (c.m) {
      defaults.ad_storage = 'granted'
      defaults.ad_user_data = 'granted'
      defaults.ad_personalization = 'granted'
    }
  } catch {
    // malformed cookie — keep denied
  }
}

// ---------------------------------------------------------------------------
// Bootstrap core — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Run the bootstrap synchronously. Called automatically on load; exported
 * so tests can call it against a known DOM/window state.
 */
export function applyBootstrap(): void {
  // 1. Arm intercept queue — task 005 reads window.__COOKYAY.q
  if (!window.__COOKYAY) {
    window.__COOKYAY = { q: [], gpc: false }
  }

  // 2. GPC detection — only record the flag here; toast/override UX is task 009
  window.__COOKYAY.gpc = !!navigator.globalPrivacyControl

  // 3. dataLayer / gtag stub (no-op if gtag.js already defined them)
  if (!window.dataLayer) window.dataLayer = []
  if (typeof window.gtag !== 'function') {
    // Regular function expression so `arguments` is available (gtag.js compatible)
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments)
    }
  }

  // 4. Build defaults; update from stored cookie for returning visitors
  const defaults = buildDefaults()
  applyStoredChoices(defaults)

  // 5. Fire Consent Mode v2 default — must precede any Google tag loading
  window.gtag('consent', 'default', defaults)
}

// Auto-execute synchronously when the script loads
applyBootstrap()

export {}
