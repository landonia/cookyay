/**
 * Runtime auto-block interception proxy — synchronous createElement/setAttribute override.
 *
 * ## Two-phase install
 *
 * The proxy operates in two phases to satisfy both the synchronous-install requirement
 * and the tree-shake-to-zero contract:
 *
 * **Phase 1 — synchronous trapping shim (installed immediately in `init()`)**
 * A tiny, always-synchronous shim overrides `document.createElement` and
 * `Element.prototype.setAttribute` at the moment `init({ autoBlock: true })` is
 * called — BEFORE any third-party code can run. The shim captures every
 * `<script>`/`<iframe>` `src` assignment into a staging queue, holding each
 * element inert (src never forwarded to the browser). No match logic runs yet.
 *
 * **Phase 2 — classify-and-release (runs after lazy-loaded matcher resolves)**
 * A conditional `import()` loads the auto-block matcher (DB + index) in parallel.
 * Once loaded, `classifyAndRelease()` drains the staging queue: matched elements
 * stay held (added to `_held` for task 005); non-matched elements have their src
 * forwarded immediately (released to the browser).  From this point the shim
 * upgrades to use the real matcher inline, so new intercepts are classified without
 * queuing.
 *
 * **Why this satisfies AC1/AC5 and the tree-shake contract simultaneously:**
 * - The shim is installed synchronously inside the same microtask as `init()` —
 *   no async gap, no network fetch required. A script created immediately after
 *   `init()` returns is already intercepted.
 * - The DB (`db-autoblock.generated.ts`) and matcher (`autoblock-matcher.ts`) are
 *   never statically imported by any always-on module; they only load when
 *   `autoBlock: true` via a conditional `import()` expression (tree-shake to zero
 *   for opt-out installs).
 * - Non-matched scripts are released as soon as the matcher resolves — a same-origin
 *   module chunk is available in sub-milliseconds; this is orders of magnitude faster
 *   than a CDN fetch (100–300ms) and never blocks page rendering for first-party
 *   scripts.
 *
 * [goals.md §What ships in v5, §Interception mechanism, §Auto-block is opt-in]
 * [research/runtime-interception-domain-expert.md §Findings 1, §Gotchas]
 * [architecture.md §3 Sync vs async work, §Amendments 2026-06-10]
 * [prd.md §3.2, §5]
 */

import type { AutoBlockMatch } from './autoblock-matcher.js'
import { STATE_BLOCKED } from './blocking.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ATTR_CATEGORY = 'data-category'
const ATTR_STATE = 'data-cookyay-state'
/** Marks an element as auto-detected (not declared) — for observability/debugging. */
export const ATTR_AUTO_DETECTED = 'data-cookyay-auto'

// ---------------------------------------------------------------------------
// Held elements queue — registered by the proxy, consumed by task 005
// ---------------------------------------------------------------------------

/**
 * A held element pending consent.
 * The proxy populates this when it intercepts a matched script/iframe;
 * task 005 drains it to wire into the grant/inject path.
 */
export interface HeldElement {
  /** The element that was intercepted. */
  el: HTMLScriptElement | HTMLIFrameElement
  /** The original src URL that was being set (may differ from el.src if held inert). */
  src: string
  /** The consent category this service requires. */
  category: string
  /** The matched service slug (for debug logging). */
  serviceId: string
}

/** Module-level queue of elements held pending consent. */
const _held: HeldElement[] = []

// ---------------------------------------------------------------------------
// Staging queue — elements captured before the matcher is available (Phase 1)
// ---------------------------------------------------------------------------

interface StagedElement {
  el: HTMLScriptElement | HTMLIFrameElement
  src: string
  /** The original prototype setter to call when releasing a non-matched element. */
  origProtoSetter: ((v: string) => void) | null
  /** True if captured via setAttribute path rather than src property setter. */
  viaSetAttribute: boolean
}

/** Staging queue: elements captured by the shim before the matcher resolves. */
const _staged: StagedElement[] = []

// ---------------------------------------------------------------------------
// Proxy install/uninstall state
// ---------------------------------------------------------------------------

/** True when the proxy overrides are currently installed. */
let _installed = false

/** Saved reference to the original document.createElement before any override. */
let _origCreateElement: typeof document.createElement | null = null

/** Saved reference to the original setAttribute before any override. */
let _origSetAttribute: typeof Element.prototype.setAttribute | null = null

/**
 * The real matcher, injected by `activateMatcher()` after the DB chunk loads.
 * `null` during Phase 1 (shim-only); non-null once Phase 2 begins.
 */
let _matcher: ((url: string) => AutoBlockMatch | null) | null = null

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _log(msg: string, ...args: unknown[]): void {
  console.warn(`[Cookyay] ${msg}`, ...args)
}

let _debug: ((msg: string, ...args: unknown[]) => void) | null = null

/**
 * Hold an element inert (no src fetch) and register it for later grant/inject.
 *
 * For scripts: the src is NOT assigned — the browser never fetches the URL.
 * For iframes: the src is NOT assigned — the iframe stays empty.
 *
 * The element is marked with `data-cookyay-state="blocked"` and
 * `data-cookyay-auto="true"` so downstream code can identify auto-detected
 * elements vs. declaratively blocked ones.
 *
 * Declared elements (`data-cookyay-state` already set to "blocked") are
 * skipped — declared rules always win, no double-registration.
 *
 * @param el    The intercepted script or iframe element.
 * @param src   The URL that was about to be assigned as src.
 * @param match The auto-block matcher result.
 * @returns `true` if the element was held; `false` if it was skipped (declared
 *          or already executed).
 */
export function _holdElement(
  el: HTMLScriptElement | HTMLIFrameElement,
  src: string,
  match: AutoBlockMatch,
): boolean {
  // Declared rule wins: skip elements already registered by blocking.ts
  if (el.getAttribute(ATTR_STATE) === STATE_BLOCKED) return false
  // Idempotency: skip already-executed elements
  if (el.getAttribute(ATTR_STATE) === 'executed') return false
  // Idempotency: skip already-held elements (proxy may fire more than once
  // for the same element via setAttribute + property setter paths)
  if (el.getAttribute(ATTR_AUTO_DETECTED)) return false

  el.setAttribute(ATTR_STATE, STATE_BLOCKED)
  el.setAttribute(ATTR_AUTO_DETECTED, 'true')
  el.setAttribute(ATTR_CATEGORY, match.category)

  _held.push({ el, src, category: match.category, serviceId: match.serviceId })

  _debug?.(
    'auto-blocked <%s src="%s"> (service: %s, category: %s)',
    el.tagName.toLowerCase(),
    src,
    match.serviceId,
    match.category,
  )

  return true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a copy of the current held-elements queue.
 * Exported so task 005 can drain it when wiring into the grant/inject path.
 *
 * The returned array is a live reference (not a copy) — task 005 should
 * splice from it rather than holding a separate reference.
 */
export function getHeldElements(): HeldElement[] {
  return _held
}

/**
 * True when the proxy overrides are currently installed.
 * Useful for tests and for task 005 health-checks.
 */
export function isProxyInstalled(): boolean {
  return _installed
}

// ---------------------------------------------------------------------------
// Phase 2: classify-and-release — called once the lazy matcher loads
// ---------------------------------------------------------------------------

/**
 * Activate the real matcher and process the staging queue.
 *
 * Called by api.ts after the auto-block DB chunk resolves.  This is the Phase 2
 * transition:
 *   1. Store the matcher so future intercepts use it inline.
 *   2. Drain `_staged`: matched elements → `_held`; non-matched → release src.
 *
 * @internal Exported for api.ts and tests only.
 */
export function activateMatcher(
  matcher: (url: string) => AutoBlockMatch | null,
): void {
  if (_matcher !== null) {
    _log('activateMatcher() called more than once — skipped.')
    return
  }
  _matcher = matcher

  // Drain the staging queue: classify each element held by the trapping shim.
  for (const staged of _staged) {
    const { el, src, origProtoSetter, viaSetAttribute } = staged

    // Skip if already processed by a concurrent setAttribute + property setter path
    if (el.getAttribute(ATTR_AUTO_DETECTED)) continue
    // Also skip if already declared-blocked (blocking.ts may have run in between)
    if (el.getAttribute(ATTR_STATE) === STATE_BLOCKED) continue

    const match = matcher(src)
    if (match) {
      _holdElement(el, src, match)
    } else {
      // Release: forward the deferred src to the browser now.
      if (viaSetAttribute) {
        // The element was staged via setAttribute — call the original setAttribute.
        _origSetAttribute?.call(el, 'src', src)
      } else {
        // The element was staged via the src property setter.
        if (origProtoSetter) {
          origProtoSetter.call(el, src)
        } else {
          // Fallback: use the real setAttribute if no proto setter saved.
          _origSetAttribute?.call(el, 'src', src)
        }
      }
    }
  }
  _staged.length = 0 // clear after processing
}

// ---------------------------------------------------------------------------
// Phase 1: install synchronous trapping shim
// ---------------------------------------------------------------------------

/**
 * Install the synchronous `document.createElement` + `setAttribute` proxy.
 *
 * Must be called synchronously at init time (before any third-party script
 * runs) when `autoBlock: true`.
 *
 * ## Two-phase behaviour:
 *
 * **Phase 1 (immediately after this call):** A trapping shim is in place.
 * Every `<script>`/`<iframe>` `src` assignment is captured in `_staged` and held
 * inert (src never forwarded) until `activateMatcher()` is called.
 *
 * **Phase 2 (after `activateMatcher()`):** The real matcher is applied.
 * Staged elements are classified and either held (matched → `_held`) or released
 * (non-matched → src forwarded). New intercepts are classified inline.
 *
 * ## Override details:
 *   1. Wraps `document.createElement` — for `<script>` and `<iframe>`, wraps
 *      the returned element so that setting its `src` triggers the shim/matcher.
 *   2. Wraps `Element.prototype.setAttribute` — catches `setAttribute('src', …)`
 *      calls (the HTML parser's `src` assignment path).
 *
 * Google-owned services always pass through (the matcher never returns a hit
 * for Google hosts, so `match` is null and the element is not held).
 *
 * `<img>` pixels and `document.write` are intentionally NOT intercepted.
 *
 * @param debugLog Optional debug logger; when provided, auto-block intercepts
 *                 are logged at `[Cookyay debug]` level.
 */
export function installAutoBlockProxy(
  debugLog?: ((msg: string, ...args: unknown[]) => void) | null,
): void {
  if (_installed) {
    _log('installAutoBlockProxy() called more than once — skipped.')
    return
  }

  _debug = debugLog ?? null

  // Save originals before any override so we can call through and restore.
  _origCreateElement = document.createElement.bind(document)
  _origSetAttribute = Element.prototype.setAttribute

  const origSetAttribute = _origSetAttribute

  // -------------------------------------------------------------------------
  // Override: Element.prototype.setAttribute
  // -------------------------------------------------------------------------
  // Intercepts `el.setAttribute('src', url)` — the HTML parser's path when
  // it sets `src` last, triggering the fetch. Also catches dynamically created
  // elements that use setAttribute instead of the src property.
  //
  // We wrap the prototype so ALL elements benefit without needing to patch each
  // newly created element individually. However we only act on <script>/<iframe>
  // for `src`; all other attribute mutations pass through immediately.
  Element.prototype.setAttribute = function patchedSetAttribute(
    name: string,
    value: string,
  ): void {
    if (
      name === 'src' &&
      (this.tagName === 'SCRIPT' || this.tagName === 'IFRAME')
    ) {
      const el = this as HTMLScriptElement | HTMLIFrameElement

      if (_matcher !== null) {
        // Phase 2: real matcher available — classify inline.
        const match = _matcher(value)
        if (match) {
          // _holdElement returns false if the element was skipped (e.g. it's
          // already STATE_EXECUTED — the injection engine marks live clones
          // executed before assigning src so re-interception is prevented).
          // Only suppress the real setAttribute if the element was actually held.
          const held = _holdElement(el, value, match)
          if (held) return // intentionally skip the real setAttribute call
        }
      } else {
        // Phase 1: matcher not yet loaded — stage the element (hold inert).
        // Only stage if the element isn't already held or declared-blocked.
        if (
          !el.getAttribute(ATTR_AUTO_DETECTED) &&
          el.getAttribute(ATTR_STATE) !== STATE_BLOCKED &&
          el.getAttribute(ATTR_STATE) !== 'executed'
        ) {
          _staged.push({ el, src: value, origProtoSetter: null, viaSetAttribute: true })
          return // hold inert — do NOT forward src yet
        }
      }
    }
    // All other mutations (non-src, non-script/iframe, or released non-matched)
    // pass through untouched.
    origSetAttribute.call(this, name, value)
  }

  // -------------------------------------------------------------------------
  // Override: document.createElement
  // -------------------------------------------------------------------------
  // Intercepts `document.createElement('script')` / `document.createElement('iframe')`.
  // The returned element is wrapped so that property-style `el.src = url` is
  // also intercepted (in addition to setAttribute, handled above).
  //
  // We define a one-shot `src` property getter/setter on the specific element
  // instance (not on the prototype — that would affect all scripts). Once the
  // src is inspected and either held/staged or forwarded, the instance property
  // is deleted and the prototype chain resumes (idempotent, single-intercept).
  //
  // Note: calling through to the original (captured above as `_origCreateElement`)
  // ensures we don't break other browser extensions that also wrap createElement —
  // they chain in order. [research/runtime-interception-domain-expert.md §Gotchas]
  const origCreate = _origCreateElement

  document.createElement = function patchedCreateElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K | string,
    options?: ElementCreationOptions,
  ): HTMLElement {
    const el = origCreate(tagName as K, options) as HTMLElement

    const tag = typeof tagName === 'string' ? tagName.toLowerCase() : tagName
    if (tag !== 'script' && tag !== 'iframe') {
      return el // non-script/iframe: pass through immediately (no overhead)
    }

    const targetEl = el as HTMLScriptElement | HTMLIFrameElement

    // Save the prototype src setter for use in the trap below.
    const protoDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(targetEl), 'src')
    const protoSetter = protoDesc?.set ?? null

    // Install a one-shot `src` property trap on this specific element instance.
    // This fires when JS code does `el.src = '...'` rather than setAttribute.
    Object.defineProperty(targetEl, 'src', {
      configurable: true,
      enumerable: true,
      get(): string {
        // Delegate to the prototype getter to read the real current src.
        const desc = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(targetEl),
          'src',
        )
        return desc?.get?.call(targetEl) ?? ''
      },
      set(value: string): void {
        // Remove the instance-level trap first (prevents re-entry if the
        // matcher somehow triggers another src set, e.g. a placeholder src).
        // The prototype setter resumes from this point forward.
        delete (targetEl as unknown as Record<string, unknown>).src

        if (_matcher !== null) {
          // Phase 2: real matcher available — classify inline.
          const match = _matcher(value)
          if (match) {
            // _holdElement returns false if the element was skipped (e.g. it's
            // already STATE_EXECUTED — the injection engine marks live clones
            // executed before assigning src so re-interception is prevented).
            // Only suppress the src assignment if the element was actually held.
            const held = _holdElement(targetEl, value, match)
            if (held) return // Do NOT assign the real src — element stays inert.
          }
        } else {
          // Phase 1: matcher not yet loaded — stage the element (hold inert).
          if (
            !targetEl.getAttribute(ATTR_AUTO_DETECTED) &&
            targetEl.getAttribute(ATTR_STATE) !== STATE_BLOCKED &&
            targetEl.getAttribute(ATTR_STATE) !== 'executed'
          ) {
            _staged.push({ el: targetEl, src: value, origProtoSetter: protoSetter, viaSetAttribute: false })
            return // hold inert — do NOT assign src yet
          }
        }

        // Not held/staged: forward to the prototype setter (native behavior).
        if (protoSetter) {
          protoSetter.call(targetEl, value)
        }
      },
    })

    return targetEl
  }

  _installed = true
  _debug?.('auto-block proxy installed (createElement + setAttribute overrides active)')
}

/**
 * Uninstall the proxy overrides and restore native createElement/setAttribute.
 *
 * Exported for test teardown only — not part of the public API.
 */
export function _resetAutoBlockProxy(): void {
  // Always clear the held and staged queues, regardless of whether the proxy
  // is installed, so direct _holdElement() calls in tests are cleaned up.
  _held.length = 0
  _staged.length = 0

  if (!_installed) {
    // Also clear the matcher in case it was set outside the install path in tests
    _matcher = null
    return
  }

  if (_origSetAttribute !== null) {
    Element.prototype.setAttribute = _origSetAttribute
    _origSetAttribute = null
  }

  if (_origCreateElement !== null) {
    document.createElement = _origCreateElement
    _origCreateElement = null
  }

  _installed = false
  _matcher = null
  _debug = null
}
