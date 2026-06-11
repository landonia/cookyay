// Declarative blocking + re-execution engine (PRD §3.2)
//
// Site owners mark scripts/iframes inert in markup:
//   <script type="text/plain" data-category="analytics">...</script>
//   <iframe data-src="https://..." data-category="marketing" width="560" height="315"></iframe>
//
// On category grant, scripts are injected via clone-and-reinsert (not type mutation)
// and iframes get their data-src promoted to src. Each injection is staggered via
// setTimeout(fn, 0) after the consent update fires (INP guard, architecture §3).
//
// v5 extension — enqueueAutoDetected():
//   Auto-detected elements (intercepted by the runtime proxy, task 004) are funneled
//   through this same engine via enqueueAutoDetected(). The only difference is that
//   their src URL arrives via HeldElement.src (not from a DOM attribute), so it is
//   stored as data-src before enqueueing. _injectScript() is extended to handle
//   auto-detected scripts: when a script has no src attribute (never assigned by the
//   proxy) but carries data-src + data-cookyay-auto, the clone uses the data-src URL.
//   _injectIframe() already handles data-src for both declared and auto-detected iframes.

import type { CategoryId } from './consent/index.js'
import { CATEGORY_IDS } from './consent/index.js'

const ATTR_CATEGORY = 'data-category'
const ATTR_STATE = 'data-cookyay-state'
const ATTR_PLACEHOLDER = 'data-cookyay-placeholder'
/** Marks an element as auto-detected (set by autoblock-proxy.ts, read here for inject). */
const ATTR_AUTO_DETECTED = 'data-cookyay-auto'

export const STATE_BLOCKED = 'blocked'
export const STATE_EXECUTED = 'executed'

export interface BlockerOptions {
  /** Text shown inside the iframe placeholder div while consent is pending. Defaults to empty. */
  placeholderLabel?: string
}

interface QueueEntry {
  el: HTMLScriptElement | HTMLIFrameElement
  placeholder: HTMLElement | null
}

// Module-level queue keyed by category. Cleared on _resetBlocker().
const _q = new Map<string, QueueEntry[]>()

function _warn(msg: string, ...args: unknown[]): void {
  console.warn(`[Cookyay] ${msg}`, ...args)
}

function _isKnownCategory(cat: string, known: readonly CategoryId[]): cat is CategoryId {
  return (known as readonly string[]).includes(cat)
}

function _enqueue(cat: string, entry: QueueEntry): void {
  const list = _q.get(cat)
  if (list) {
    list.push(entry)
  } else {
    _q.set(cat, [entry])
  }
}

// ---------------------------------------------------------------------------
// Iframe placeholder
// ---------------------------------------------------------------------------

function _buildPlaceholder(iframe: HTMLIFrameElement, label: string): HTMLDivElement {
  const div = document.createElement('div')
  div.setAttribute(ATTR_PLACEHOLDER, 'true')

  const w = iframe.getAttribute('width')
  const h = iframe.getAttribute('height')
  if (w) div.style.width = /^\d+$/.test(w) ? `${w}px` : w
  if (h) div.style.height = /^\d+$/.test(h) ? `${h}px` : h
  if (label) div.textContent = label

  return div
}

// ---------------------------------------------------------------------------
// Registration (scan phase)
// ---------------------------------------------------------------------------

function _registerScript(el: HTMLScriptElement, known: readonly CategoryId[]): void {
  // Idempotency: already processed elements are skipped
  if (el.getAttribute(ATTR_STATE) === STATE_EXECUTED) return

  const cat = el.getAttribute(ATTR_CATEGORY)
  if (!cat) return

  if (!_isKnownCategory(cat, known)) {
    _warn('script references unknown category "%s" — staying blocked', cat, el)
    return
  }

  // Don't double-register
  if (el.getAttribute(ATTR_STATE) === STATE_BLOCKED) return

  el.setAttribute(ATTR_STATE, STATE_BLOCKED)
  _enqueue(cat, { el, placeholder: null })
}

function _registerIframe(
  el: HTMLIFrameElement,
  known: readonly CategoryId[],
  label: string,
): void {
  if (el.getAttribute(ATTR_STATE) === STATE_EXECUTED) return

  const cat = el.getAttribute(ATTR_CATEGORY)
  if (!cat) return

  if (!_isKnownCategory(cat, known)) {
    _warn('iframe references unknown category "%s" — staying blocked', cat, el)
    return
  }

  if (el.getAttribute(ATTR_STATE) === STATE_BLOCKED) return

  el.setAttribute(ATTR_STATE, STATE_BLOCKED)

  const placeholder = _buildPlaceholder(el, label)
  // Placeholder follows the iframe in the DOM; iframe itself is hidden (no src = collapsed)
  el.insertAdjacentElement('afterend', placeholder)
  el.style.display = 'none'

  _enqueue(cat, { el, placeholder })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the DOM for declaratively blocked scripts and iframes.
 * Safe to call multiple times — idempotent via data-cookyay-state.
 *
 * @param root      The subtree to scan. Defaults to document.
 * @param knownCategories  Categories defined in the site's config.
 *                         Any element referencing an unknown category stays blocked
 *                         and emits a structured console.warn (fail-closed).
 * @param opts      Optional behaviour overrides.
 */
export function scanBlocked(
  root: ParentNode = document,
  knownCategories: readonly CategoryId[] = CATEGORY_IDS,
  opts: BlockerOptions = {},
): void {
  const label = opts.placeholderLabel ?? ''

  const scripts = root.querySelectorAll<HTMLScriptElement>(
    'script[type="text/plain"][data-category]',
  )
  for (const s of scripts) {
    _registerScript(s, knownCategories)
  }

  const iframes = root.querySelectorAll<HTMLIFrameElement>('iframe[data-src][data-category]')
  for (const f of iframes) {
    _registerIframe(f, knownCategories, label)
  }
}

/**
 * Grant a category: inject all queued elements for that category.
 *
 * Call this AFTER the consent record has been written and the cookyay:consent
 * event has been dispatched. Each element is processed via setTimeout(fn, 0)
 * so the consent update completes before any heavy third-party script runs
 * (INP guard — architecture §3).
 *
 * Elements referencing an unknown category are silently ignored (fail-closed);
 * this function itself warns if called with an unknown category string.
 */
export function grant(
  category: CategoryId | string,
  knownCategories: readonly CategoryId[] = CATEGORY_IDS,
): void {
  if (!_isKnownCategory(category, knownCategories)) {
    _warn('grant called with unknown category "%s" — no-op', category)
    return
  }

  const entries = _q.get(category as CategoryId) ?? []
  _q.delete(category as CategoryId)

  for (const entry of entries) {
    const { el, placeholder } = entry
    if (el.getAttribute(ATTR_STATE) === STATE_EXECUTED) continue

    if (el.tagName === 'SCRIPT') {
      const script = el as HTMLScriptElement
      setTimeout(() => _injectScript(script), 0)
    } else {
      const iframe = el as HTMLIFrameElement
      setTimeout(() => _injectIframe(iframe, placeholder), 0)
    }
  }
}

function _injectScript(original: HTMLScriptElement): void {
  // Double-check idempotency inside the setTimeout callback
  if (original.getAttribute(ATTR_STATE) === STATE_EXECUTED) return

  // Mark before inserting — prevents any concurrent re-entry
  original.setAttribute(ATTR_STATE, STATE_EXECUTED)

  const clone = document.createElement('script')

  // Mark the clone as executed BEFORE assigning its src. This is important when
  // the v5 auto-block proxy is installed: the proxy's createElement/setAttribute
  // override would otherwise intercept the src assignment on this live clone and
  // re-hold it inert. The proxy's _holdElement() checks data-cookyay-state and
  // skips elements already marked 'executed' — so setting it here prevents
  // re-interception of the injection clone.
  // Note: the attribute is left on the live clone (a harmless debugging marker
  // that identifies the element as a Cookyay-managed script injection).
  clone.setAttribute(ATTR_STATE, STATE_EXECUTED)

  // Copy all attributes except:
  //   • type        — omitting it defaults to text/javascript (re-execute intent)
  //   • data-cookyay-state — set above; skip to avoid overwriting from original's value
  //   • data-src    — used as a holding slot by auto-detected scripts; not a real
  //                   HTML attribute, so skip it (we assign src directly below)
  //   • data-cookyay-auto — observability marker; not needed on the live clone
  for (const { name, value } of original.attributes) {
    if (name === 'type' || name === ATTR_STATE || name === 'data-src' || name === ATTR_AUTO_DETECTED) continue
    clone.setAttribute(name, value)
  }

  // For auto-detected scripts the proxy never assigned src (held inert), so the
  // captured URL is stored in data-src by enqueueAutoDetected(). Promote it here.
  const hasSrc = original.getAttribute('src')
  const dataSrc = original.getAttribute('data-src')

  if (!hasSrc && dataSrc) {
    // Auto-detected path: use the stored URL as the src of the live clone.
    clone.setAttribute('src', dataSrc)
  } else if (!hasSrc && original.textContent) {
    // Declared inline script with no src.
    clone.textContent = original.textContent
  }
  // else: hasSrc already copied above via the attribute loop.

  ;(original.parentNode ?? document.head).insertBefore(clone, original.nextSibling)
}

function _injectIframe(original: HTMLIFrameElement, placeholder: HTMLElement | null): void {
  if (original.getAttribute(ATTR_STATE) === STATE_EXECUTED) return

  original.setAttribute(ATTR_STATE, STATE_EXECUTED)
  placeholder?.remove()

  const dataSrc = original.getAttribute('data-src')
  if (dataSrc) {
    original.removeAttribute('data-src')
    original.src = dataSrc
  }

  original.style.display = ''
}

/**
 * Enqueue an auto-detected (runtime-intercepted) element for consent-gated injection.
 *
 * Called by api.ts after the auto-block matcher resolves and classifies held elements
 * (task 005). The element has already been held inert by the proxy (task 004) —
 * `data-cookyay-state="blocked"` and `data-cookyay-auto="true"` are already set;
 * the src URL was captured in HeldElement.src (never assigned to the DOM).
 *
 * This function stores the src as `data-src` on the element so that the existing
 * grant/inject path can release it:
 *   • Scripts:  _injectScript() reads `data-src` (auto-detected path) and uses it
 *               as the clone's src.
 *   • Iframes:  _injectIframe() already promotes `data-src → src` — no change needed.
 *
 * Declared-wins precedence: if the element already carries `data-cookyay-state`
 * set to STATE_EXECUTED (extremely unlikely but defensive), it is skipped.
 * Elements already registered by scanBlocked() (STATE_BLOCKED from the declared
 * engine) should never reach here — the proxy's _holdElement() guards that.
 *
 * Withdrawal posture: auto-detected elements flow through the same grant() path as
 * declared ones; withdrawal detection (preferences.ts) therefore applies identically
 * — already-executed third-party scripts cannot be unloaded, so the "reload required"
 * toast fires for auto-detected categories the same way it does for declared ones.
 *
 * [task 005 AC1, AC2, AC4; research/existing-codebase-archaeologist.md §Recommendations 4]
 * [architecture.md §3 Sync vs async work — injection staggered via setTimeout(fn,0)]
 */
export function enqueueAutoDetected(
  el: HTMLScriptElement | HTMLIFrameElement,
  src: string,
  category: string,
  knownCategories: readonly CategoryId[] = CATEGORY_IDS,
): void {
  // Idempotency: skip elements already executed (should never happen, but defensive).
  if (el.getAttribute(ATTR_STATE) === STATE_EXECUTED) return

  if (!_isKnownCategory(category, knownCategories)) {
    _warn('auto-detected element matched unknown category "%s" — staying blocked', category, el)
    return
  }

  // Store the captured URL so the inject path can use it.
  // For scripts: _injectScript() reads data-src when src is absent.
  // For iframes: _injectIframe() already reads data-src.
  el.setAttribute('data-src', src)

  _enqueue(category, { el, placeholder: null })
}

/**
 * Clear all internal state.
 * Exported for test teardown only — not part of the public API.
 */
export function _resetBlocker(): void {
  _q.clear()
}
