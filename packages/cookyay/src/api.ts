import type { CategoryId, ConsentRecord } from './consent/index.js'
import { CATEGORY_IDS, buildConsentRecord, readConsent, writeConsent } from './consent/index.js'
import type { CookyayConfig } from './config.js'
import { resolveStrings, validateConfig } from './config.js'
import { dispatchChangeEvent, dispatchConsentEvent } from './events.js'
import { _resetBlocker, grant, scanBlocked } from './blocking.js'
import { VERSION } from './version.js'

type ConsentCallback = (granted: boolean) => void

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let _initialized = false
let _config: CookyayConfig | null = null
const _listeners = new Map<CategoryId, Set<ConsentCallback>>()

// In-memory session marker — set when consent is given or updated this page load.
// Prevents the banner from re-mounting mid-session (e.g. if a very short-lived
// cookie expires while the visitor is still on the page). Reset only on page
// navigation (module re-load) or explicit test teardown.
let _seenThisSession = false

// UI hook — registered by banner.ts on import (inversion of control, avoids
// circular deps between api.ts and banner.ts)
let _uiHook: (() => void) | null = null

/**
 * Register the UI mount function. Called once by banner.ts at module load time.
 * @internal
 */
export function _registerUI(hook: () => void): void {
  _uiHook = hook
}

// Preferences UI hook — registered by preferences.ts on import (same IoC pattern)
let _preferencesHook: ((opener: Element | null) => void) | null = null

/**
 * Register the preferences modal mount function. Called once by preferences.ts at module load time.
 * @internal
 */
export function _registerPreferencesUI(hook: (opener: Element | null) => void): void {
  _preferencesHook = hook
}

// GPC hook — registered by gpc.ts on import (same IoC pattern)
let _gpcHook: (() => void) | null = null

/**
 * Register the GPC policy + toast function. Called once by gpc.ts at module load time.
 * @internal
 */
export function _registerGpcUI(hook: () => void): void {
  _gpcHook = hook
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _log(msg: string, ...args: unknown[]): void {
  console.warn(`[Cookyay] ${msg}`, ...args)
}

function _debug(msg: string, ...args: unknown[]): void {
  if (_config?.debug) {
    console.log(`[Cookyay debug] ${msg}`, ...args)
  }
}

function _getCurrentRecord(): ConsentRecord | null {
  if (!_config) return null
  return readConsent(_config.policyVersion)
}

function _notifyListeners(record: ConsentRecord): void {
  for (const cat of CATEGORY_IDS) {
    const cbs = _listeners.get(cat)
    if (!cbs) continue
    const granted = record.categories[cat]
    for (const cb of cbs) {
      try {
        cb(granted)
      } catch {
        // Listener errors must not propagate — fail-open for external callbacks
      }
    }
  }
}

// Event delegation handler — kept as a named function so it can be removed on reset
function _handleOpenClick(e: Event): void {
  const target = (e.target as Element | null)?.closest('[data-cookyay-open]')
  if (target) {
    e.preventDefault()
    openPreferences()
  }
}

/**
 * Scan the current DOM for declaratively blocked elements, emitting console.warn
 * for any that reference an unknown category (the top DX hazard — silent typos).
 * Also registers known-category elements in the blocking queue for grant() calls.
 *
 * Called immediately at init() and, if the DOM is still loading, again on
 * DOMContentLoaded so elements parsed after the <head> snippet are also caught.
 */
function _scanDOM(): void {
  // scanBlocked warns for any data-category not in CATEGORY_IDS and enqueues the rest
  scanBlocked(document, CATEGORY_IDS)

  // If init() ran from <head> while the document was still being parsed, body
  // content isn't in the DOM yet. Schedule a second scan so those elements
  // are caught. readyState 'interactive' or 'complete' means parsing is done.
  if (document.readyState !== 'interactive' && document.readyState !== 'complete') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        scanBlocked(document, CATEGORY_IDS)
        // Elements enqueued by this late scan belong to a returning visitor's
        // already-granted categories — replay grants so they execute too.
        _replayStoredGrants()
      },
      { once: true },
    )
    _debug('DOMContentLoaded scan scheduled (readyState:', document.readyState, ')')
  }
}

/**
 * Returning-visitor grant replay: if a valid consent record is already stored,
 * grant() every non-necessary category the visitor previously consented to so
 * blocked scripts/iframes execute on this page load too (PRD §3.2 — re-execute
 * on grant applies to every visit, not just the visit where consent was given).
 *
 * Runs after the GPC hook so a GPC-overridden (denied) record is what gets read.
 * No-op when no record exists (first visit — the banner's accept/save paths
 * grant instead). grant() drains the per-category queue, so calling this after
 * each DOM scan is safe and idempotent.
 */
function _replayStoredGrants(): void {
  const record = _getCurrentRecord()
  if (!record) return

  for (const cat of CATEGORY_IDS) {
    if (cat !== 'necessary' && record.categories[cat]) {
      grant(cat)
    }
  }
  _debug('stored grants replayed', record.categories)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise Cookyay with a site config. Must be called once before the banner
 * renders. Re-running is a no-op (emits a console.warn).
 */
export function init(config: CookyayConfig): void {
  if (_initialized) {
    _log('init() called more than once — subsequent calls are a no-op.')
    return
  }

  const warnings = validateConfig(config)
  for (const w of warnings) {
    _log(w.message)
  }

  // Fatal warnings (e.g., missing policyVersion) prevent initialisation
  if (warnings.some((w) => w.fatal)) {
    return
  }

  _config = config
  _initialized = true

  _debug('init() called', {
    policyVersion: config.policyVersion,
    categories: Object.keys(config.categories ?? {}),
    modal: config.modal ?? false,
    autoOpenLink: config.autoOpenLink ?? true,
  })

  // Wire data-cookyay-open click delegation
  document.addEventListener('click', _handleOpenClick)

  // Scan DOM for declaratively blocked elements, warn for unknown categories
  _scanDOM()

  // Apply GPC policy + show toast if needed — must run before banner so the
  // consent record is written before mountBanner() checks for existing consent.
  _gpcHook?.()

  // Returning visitor with stored consent: replay grants for already-consented
  // categories so blocked scripts/iframes execute on this page load. Must run
  // after _gpcHook so a GPC override (denied record) is respected.
  _replayStoredGrants()

  // Mount UI (banner, re-open link) — registered by banner.ts via _registerUI
  _uiHook?.()

  _debug('init() complete')
}

/**
 * Return the current per-category consent state.
 * Returns an empty object if no consent has been recorded yet.
 */
export function getConsent(): Partial<Record<CategoryId, boolean>> {
  if (!_initialized || !_config) {
    _log('getConsent() called before init() — returning empty state.')
    return {}
  }
  const record = _getCurrentRecord()
  if (!record) return {}
  return { ...record.categories }
}

/**
 * Subscribe to consent state for a specific category.
 *
 * - If consent is already stored, `cb` fires immediately with the current value.
 * - On future consent records, `cb` fires with the new value for that category.
 * - Returns an unsubscribe function.
 */
export function onConsent(category: CategoryId, cb: ConsentCallback): () => void {
  // Fire immediately if consent is already stored
  if (_initialized && _config) {
    const record = _getCurrentRecord()
    if (record) {
      try {
        cb(record.categories[category])
      } catch {
        // ignore
      }
    }
  }

  // Register for future changes
  let cbs = _listeners.get(category)
  if (!cbs) {
    cbs = new Set()
    _listeners.set(category, cbs)
  }
  cbs.add(cb)

  return () => {
    _listeners.get(category)?.delete(cb)
  }
}

/**
 * Open the preferences modal. Captures the currently focused element as the
 * focus-return target so the modal can restore it on close (WCAG 2.4.3).
 * Also dispatches `cookyay:open-preferences` for zero-coupling integrations.
 */
export function openPreferences(): void {
  const opener = document.activeElement
  _preferencesHook?.(opener)
  document.dispatchEvent(new CustomEvent('cookyay:open-preferences', { bubbles: false }))
}

// ---------------------------------------------------------------------------
// Internal write path (called by banner UI in tasks 007/008)
// ---------------------------------------------------------------------------

/**
 * Record a consent choice: write to storage, dispatch events, notify listeners.
 *
 * This is the single authoritative write path. All UI paths (accept-all,
 * reject-all, save-preferences) should call this rather than writeConsent directly.
 *
 * @internal Not part of the external public API.
 */
export function _recordConsent(
  categories: Record<CategoryId, boolean>,
  gpc = false,
): void {
  if (!_config) {
    _log('_recordConsent() called before init() — ignoring.')
    return
  }

  const prev = _getCurrentRecord()

  // If GPC is live at write time, mark the record GPC-acknowledged (gpc:true) regardless
  // of whether the caller supplied the flag. This ensures explicit choices made *after*
  // the GPC opt-out was applied are preserved on reload — _runGpc() sees gpc:true,
  // treats the record as already reflecting the signal, and skips the override.
  // CCPA §7025(c)(2): explicit subsequent consent by the consumer may override GPC.
  const gpcLive =
    typeof window !== 'undefined' &&
    !!(window as typeof window & { __COOKYAY?: { gpc: boolean } }).__COOKYAY?.gpc
  const effectiveGpc = gpc || gpcLive

  const record = buildConsentRecord(categories, _config.policyVersion, VERSION, effectiveGpc)
  writeConsent(record, _config.cookie ?? {})

  _seenThisSession = true
  _debug('consent recorded', { categories, gpc: effectiveGpc })

  // Always fire cookyay:consent (initial + updates)
  dispatchConsentEvent(record)

  // Fire cookyay:change only when category choices differ from the previous record
  if (prev) {
    const changed = CATEGORY_IDS.some((cat) => prev.categories[cat] !== record.categories[cat])
    if (changed) {
      dispatchChangeEvent(record)
    }
  }

  _notifyListeners(record)
}

// ---------------------------------------------------------------------------
// Test-only reset (not part of the public API)
// ---------------------------------------------------------------------------

/**
 * Reset all singleton state.
 * @internal Exported for test teardown only.
 */
export function _resetApi(): void {
  document.removeEventListener('click', _handleOpenClick)
  _initialized = false
  _config = null
  _seenThisSession = false
  _listeners.clear()
  _resetBlocker()
}

/**
 * Returns true if consent was given or updated in this page session.
 * Used by mountBanner() to prevent mid-session re-prompts.
 * @internal
 */
export function _hasSeenThisSession(): boolean {
  return _seenThisSession
}

/**
 * Expose the current resolved config.
 * @internal Used by banner UI modules to read config without re-passing it.
 */
export function _getConfig(): CookyayConfig | null {
  return _config
}

/**
 * Expose the resolved strings (config overrides merged over defaults).
 * @internal Used by UI modules to render localised text.
 */
export function _getStrings(): ReturnType<typeof resolveStrings> {
  return resolveStrings(_config?.strings)
}
