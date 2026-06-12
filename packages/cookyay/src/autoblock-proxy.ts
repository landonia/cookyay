/**
 * Runtime auto-block interception proxy — synchronous createElement/setAttribute/fetch/sendBeacon override.
 *
 * ## Two-phase install
 *
 * The proxy operates in two phases to satisfy both the synchronous-install requirement
 * and the tree-shake-to-zero contract:
 *
 * **Phase 1 — synchronous trapping shim (installed immediately in `init()`)**
 * A tiny, always-synchronous shim overrides `document.createElement`,
 * `Element.prototype.setAttribute`, `window.Image`, `window.fetch`, and
 * `navigator.sendBeacon` at the moment `init({ autoBlock: true })` is
 * called — BEFORE any third-party code can run.
 *
 * For DOM elements: the shim captures every `<script>`/`<iframe>`/`<img>` `src`
 * assignment into a staging queue, holding each element inert. No match logic runs yet.
 *
 * For transport (fetch/sendBeacon): per the resolved install-timing decision
 * (research/_index.md §Update Q2), the wrappers pass through in Phase 1 (before the
 * matcher loads). This avoids staging first-party API calls hostage and keeps
 * first-party traffic clean. The accepted trade-off is a brief pre-chunk-load window
 * where async tracking calls could escape — the same intrinsic bootstrap-first limit
 * v6 already documents.
 *
 * **Phase 2 — classify-and-release (runs after lazy-loaded matcher resolves)**
 * A conditional `import()` loads the auto-block matcher (DB + index) in parallel.
 * Once loaded:
 * - DOM elements: `activateMatcher()` drains the staging queue: matched elements
 *   stay held; non-matched elements have their src forwarded immediately.
 * - Transport: `activateTransportClassifiers()` wires function-pointer classifiers
 *   into the thin stubs installed in Phase 1.
 *   - Matched `fetch` calls: the caller's Promise is immediately resolved with a
 *     benign `new Response(null, { status: 204 })` stub (hybrid stub+queue). A clone
 *     of the original request (`request.clone()`) is queued in `_heldFetches` for
 *     best-effort replay via `_origFetch` when `grant(category)` fires. `keepalive`
 *     fetches are dropped (page is ending). `AbortSignal`-aborted held calls are
 *     discarded before replay. [task 003]
 *   - Matched `sendBeacon` calls: queued in `_queuedBeacons`; on grant, delivered
 *     via `_origSendBeacon`. [task 004]
 *   The full classify logic lives in `autoblock-transport-classifier.ts` (lazy chunk)
 *   to keep the always-on ESM-OFF bundle lean. [task 006 §Bundle-budget gate]
 *
 * **Why this satisfies AC1/AC5 and the tree-shake contract simultaneously:**
 * - All shims are installed synchronously inside the same microtask as `init()` —
 *   no async gap, no network fetch required.
 * - The DB (`db-autoblock.generated.ts`) and matcher (`autoblock-matcher.ts`) are
 *   never statically imported by any always-on module; they only load when
 *   `autoBlock: true` via a conditional `import()` expression (tree-shake to zero
 *   for opt-out installs).
 * - The synchronous stub for fetch/sendBeacon is kept ≤20 lines / well under 0.3 kB
 *   gzip to stay within the ESM-OFF budget; full classify logic is lazy-loaded.
 *
 * [goals.md §What ships in v5, v7, §Interception mechanism, §Auto-block is opt-in]
 * [research/runtime-interception-domain-expert.md §Findings 1, §Gotchas]
 * [research/performance-engineer.md §Recommendations 1, 4]
 * [research/_index.md §Update Q2 (Phase 2 lazy install timing)]
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
 * The proxy populates this when it intercepts a matched script/iframe/img;
 * task 005 drains it to wire into the grant/inject path.
 */
export interface HeldElement {
  /** The element that was intercepted. */
  el: HTMLScriptElement | HTMLIFrameElement | HTMLImageElement
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
// Transport held stores — parallel to _held/_staged for fetch/sendBeacon (v7)
// ---------------------------------------------------------------------------

/**
 * A held fetch call pending consent — hybrid stub+queue semantics (task 003).
 *
 * When the fetch shim matches a curated tracking endpoint in Phase 2, the caller's
 * Promise is **immediately resolved** with a benign `new Response(null, { status: 204 })`
 * stub (no hang, no timeout, survives `await`). Separately, a clone of the original
 * request (or the original string/URL input) is stored here for **best-effort replay**
 * via `_origFetch` when `grant(category)` fires.
 *
 * Key properties:
 * - `replayInput` — the input forwarded to `_origFetch` at replay time. When the
 *   original was a `Request` object, this is `request.clone()` (cloned at intercept
 *   time, not grant time — the body stream is a one-read `ReadableStream` that may
 *   already be GC'd by grant time). For string/URL inputs this is the original value.
 * - `signal` — the `AbortSignal` from the original request or init, if any. If the
 *   signal fires before grant, the held entry is discarded (not replayed).
 * - No `resolve`/`reject` fields — the caller's Promise was already settled at
 *   intercept time; the replay is a fire-and-forget side-effect.
 *
 * `keepalive` fetches captured during page unload are NOT stored here — they are
 * dropped at intercept time (page is ending; no meaningful context to replay into).
 *
 * [task 003 AC1 (204 stub), AC2 (clone at intercept time, replay on grant),
 *  AC6 (AbortSignal discard), AC7 (replay in lazy chunk)]
 * [research/existing-codebase-archaeologist.md §Findings 3, §Gotchas]
 * [research/runtime-interception-domain-expert.md §Findings 3, §Recommendations 1–3]
 * [research/performance-engineer.md §Findings 3 (clone deferred past URL check)]
 */
export interface HeldFetch {
  /** The extracted URL string (from string | URL | Request input). */
  url: string
  /**
   * The input forwarded to `_origFetch` at replay time.
   * - `Request` input → `request.clone()` (cloned at intercept time)
   * - `string` / `URL` input → the original value (no clone needed)
   */
  replayInput: string | URL | Request
  /** The original init options (may be undefined). Not passed when replayInput is a Request. */
  init: RequestInit | undefined
  /** The consent category this tracking endpoint requires. */
  category: string
  /** The service slug for debug logging. */
  serviceId: string
  /**
   * The AbortSignal from the original request or init, if any.
   * If this signal fires before grant, the held entry must be discarded.
   * [task 003 AC6; research/runtime-interception-domain-expert.md §Gotchas (AbortSignal)]
   */
  signal: AbortSignal | null
}

/**
 * A queued sendBeacon call pending consent.
 * Stored when the sendBeacon shim matches a curated tracking endpoint in Phase 2.
 * The shim returns `true` to the caller immediately. On grant, `_origSendBeacon`
 * is called to deliver the queued payload.
 *
 * [research/runtime-interception-domain-expert.md §Findings 4]
 */
export interface QueuedBeacon {
  /** The target URL. */
  url: string
  /** The beacon payload (string, Blob, FormData, URLSearchParams, or null). */
  data: BodyInit | null | undefined
  /** The consent category this tracking endpoint requires. */
  category: string
  /** The service slug for debug logging. */
  serviceId: string
}

/** Module-level store of held fetch calls pending consent. */
const _heldFetches: HeldFetch[] = []
/** Module-level store of queued beacon calls pending consent. */
const _queuedBeacons: QueuedBeacon[] = []

// ---------------------------------------------------------------------------
// Staging queue — elements captured before the matcher is available (Phase 1)
// ---------------------------------------------------------------------------

interface StagedElement {
  el: HTMLScriptElement | HTMLIFrameElement | HTMLImageElement
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

/** Saved reference to the original window.Image constructor before any override. */
let _origImage: typeof Image | null = null

/**
 * Saved reference to the native `Response` constructor, captured before any
 * third-party override. The 204 benign stub (`new Response(null, { status: 204 })`)
 * is constructed through this saved reference so it is always the real browser
 * `Response`, not a potential third-party shim.
 * [task 003 AC1; research/existing-codebase-archaeologist.md §Gotchas (benign stub)]
 */
let _origResponse: typeof Response | null = null

/**
 * Saved reference to the original window.fetch before any override.
 * Replay paths MUST call through this, never `window.fetch`, to prevent
 * circular re-interception.
 * [research/runtime-interception-domain-expert.md §Gotchas (circular re-interception)]
 */
let _origFetch: typeof window.fetch | null = null

/**
 * Saved reference to the original navigator.sendBeacon before any override.
 * Wrapped via instance-property shadow (`navigator.sendBeacon = wrapped`), NOT
 * `Navigator.prototype.sendBeacon` — frozen-prototype environments do not throw.
 * [task 002 AC2; research/runtime-interception-domain-expert.md §Gotchas (prototype-chain)]
 */
let _origSendBeacon: typeof navigator.sendBeacon | null = null

/**
 * True when the page is in the process of unloading (after `pagehide` or
 * `visibilitychange` to `hidden`). When true, any matched pre-consent
 * `sendBeacon` call is **dropped** rather than queued — there is no future
 * page context to replay into, so queueing is meaningless.
 *
 * This flag is set by `_handleUnload` (installed alongside the sendBeacon shim)
 * and cleared by `_resetAutoBlockProxy()` for test hygiene.
 *
 * [task 004 AC5; research/runtime-interception-domain-expert.md §Findings 4;
 *  research/_index.md §Update Q3 (drop, not defer)]
 */
let _isUnloading = false

/**
 * Event listener installed on `pagehide` (window) to detect page unload.
 * The `document.hidden` check in `patchedSendBeacon` covers the `visibilitychange`
 * (tab-background) case without a second listener reference.
 * Saved so it can be removed in `_resetAutoBlockProxy()` for test hygiene.
 *
 * [task 004 AC5]
 */
let _pageLifecycleHandler: (() => void) | null = null

/**
 * Phase-2 fetch classifier — set by `activateTransportClassifiers()` when the
 * lazy auto-block chunk loads. `null` during Phase 1 (matcher not yet loaded).
 *
 * Contains the full classify+hold logic (AbortSignal handling, keepalive drop,
 * declared-wins check, Request clone, 204 stub) factored out of the always-on
 * bundle into the lazy `autoblock-loader` chunk for ESM-OFF budget reclamation.
 *
 * [task 006 §Bundle-budget gate; research/performance-engineer.md §Rec1]
 */
let _fetchClassifierFn:
  | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)
  | null = null

/**
 * Phase-2 beacon classifier — set by `activateTransportClassifiers()` when the
 * lazy chunk loads. `null` during Phase 1.
 *
 * [task 006 §Bundle-budget gate]
 */
let _beaconClassifierFn: ((url: string, data?: BodyInit | null) => boolean) | null = null

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
 * Extract a URL string from a fetch input argument with zero allocation for the
 * common absolute-string case.
 *
 * `fetch(input, init)` accepts three input shapes:
 * - `string`  — returned as-is (no allocation)
 * - `URL`     — `.href` read directly (no allocation)
 * - `Request` — `.url` read directly (already absolute, no allocation)
 *
 * The same logic is reused by the sendBeacon wrapper (which only receives a string
 * URL, but shares the type signature for consistency and future-proofing).
 *
 * [research/performance-engineer.md §Findings 1, §Recommendations 2, 4]
 * [research/existing-codebase-archaeologist.md §Recommendations 6]
 */
export function _extractUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Check if a fetch/sendBeacon URL is already covered by a declared `data-category`
 * element in the DOM (declared-wins / no-double-queue guard).
 *
 * Mirrors the `ATTR_STATE === STATE_BLOCKED` check in `_holdElement` for DOM elements,
 * but for the transport layer where there is no intercepted element to inspect.
 * Called only after a curated-DB match (Phase 2) — non-matching URLs never reach this.
 *
 * [task 005 AC6 — declared-wins; research/test-strategist.md §F4 item 4]
 */
export function _isDeclaredCovered(url: string): boolean {
  const nodes = document.querySelectorAll('[type="text/plain"][data-category][data-src]')
  for (let i = 0; i < nodes.length; i++) {
    if ((nodes[i] as HTMLElement).getAttribute('data-src') === url) return true
  }
  return false
}

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
  el: HTMLScriptElement | HTMLIFrameElement | HTMLImageElement,
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
 * Return the live `_heldFetches` array.
 * Exported so `api.ts` can drain it when wiring transport into the grant path.
 * Callers should splice from it to clear entries.
 *
 * [task 002 AC3; research/existing-codebase-archaeologist.md §Recommendations 3]
 */
export function getHeldFetches(): HeldFetch[] {
  return _heldFetches
}

/**
 * Return the live `_queuedBeacons` array.
 * Exported so `api.ts` can drain it when wiring transport into the grant path.
 * Callers should splice from it to clear entries.
 *
 * [task 002 AC3; research/existing-codebase-archaeologist.md §Recommendations 3]
 */
export function getQueuedBeacons(): QueuedBeacon[] {
  return _queuedBeacons
}

/**
 * Expose the saved original `window.fetch` for replay-path callers.
 * Replay paths MUST call through this, not `window.fetch`, to prevent circular
 * re-interception.
 *
 * Returns `null` if the proxy is not installed (no override is active).
 *
 * [task 002 AC6; research/runtime-interception-domain-expert.md §Recommendations 3]
 */
export function getOrigFetch(): typeof window.fetch | null {
  return _origFetch
}

/**
 * Expose the saved original `navigator.sendBeacon` for replay-path callers.
 * Replay paths MUST call through this, not `navigator.sendBeacon`, to prevent
 * circular re-interception.
 *
 * Returns `null` if the proxy is not installed (no override is active).
 *
 * [task 002 AC6; research/runtime-interception-domain-expert.md §Recommendations 3]
 */
export function getOrigSendBeacon(): typeof navigator.sendBeacon | null {
  return _origSendBeacon
}

/**
 * Expose the saved native `Response` constructor so the lazy transport-classifier
 * chunk can construct benign 204 stubs using the real Response, not a third-party shim.
 *
 * [task 003 AC1; task 006 §Bundle-budget reclamation]
 */
export function getOrigResponse(): typeof Response | null {
  return _origResponse
}

/**
 * Return the current `_isUnloading` flag so the lazy transport-classifier
 * chunk can check whether the page is unloading before queuing a beacon.
 *
 * [task 004 AC5; task 006 §Bundle-budget reclamation]
 */
export function isUnloading(): boolean {
  return _isUnloading
}

/**
 * Activate the Phase-2 transport classifiers.
 *
 * Called by `api.ts` after the lazy `autoblock-loader` chunk resolves.
 * Installs the `_fetchClassifierFn` and `_beaconClassifierFn` function pointers
 * that the thin shims in `installAutoBlockProxy()` delegate to once the matcher
 * is available (Phase 2). Also registers the `pagehide` lifecycle listener that
 * sets `_isUnloading` for the sendBeacon drop guard.
 *
 * Must be called AFTER `activateMatcher()` so the `_matcher` is non-null when
 * the classifiers run their first call.
 *
 * [task 006 §Bundle-budget gate; research/performance-engineer.md §Rec1]
 */
export function activateTransportClassifiers(
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  beaconFn: (url: string, data?: BodyInit | null) => boolean,
): void {
  _fetchClassifierFn = fetchFn
  _beaconClassifierFn = beaconFn

  // Register the unload listener now (not in Phase 1) so it coexists with
  // the beacon classifier that checks _isUnloading. Clearing happens in
  // _resetAutoBlockProxy().
  if (_origSendBeacon !== null && _pageLifecycleHandler === null) {
    _isUnloading = false
    _pageLifecycleHandler = (): void => {
      _isUnloading = true
    }
    window.addEventListener('pagehide', _pageLifecycleHandler, { capture: true })
  }
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
export function activateMatcher(matcher: (url: string) => AutoBlockMatch | null): void {
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
 *   1. Wraps `document.createElement` — for `<script>`, `<iframe>`, and `<img>`,
 *      wraps the returned element so that setting its `src` triggers the shim/matcher.
 *   2. Wraps `Element.prototype.setAttribute` — catches `setAttribute('src', …)`
 *      calls (the HTML parser's `src` assignment path) for script/iframe/img.
 *   3. Wraps `window.Image` constructor — closes the `new Image()` gap (canonical
 *      Meta Pixel pattern that bypasses `document.createElement` entirely).
 *
 * Google-owned services always pass through (the matcher never returns a hit
 * for Google hosts, so `match` is null and the element is not held).
 *
 * `<img>` interception is scoped to curated tracking-pixel endpoints only
 * (host + requestPaths in the DB). Content images on non-curated hosts/paths
 * pass through untouched.
 *
 * `document.write` is intentionally NOT intercepted.
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
  // Transport globals are saved here, in the same synchronous call as the DOM
  // overrides, so they are captured before any third-party code can replace them.
  // [task 002 AC1; research/existing-codebase-archaeologist.md §Recommendations 1]
  _origCreateElement = document.createElement.bind(document)
  _origSetAttribute = Element.prototype.setAttribute
  _origImage = window.Image
  // Save the native Response constructor before any override so the 204 benign
  // stub is constructed with the real Response, not a potential third-party shim.
  // [task 003 AC1; research/existing-codebase-archaeologist.md §Gotchas (benign stub)]
  _origResponse = typeof Response !== 'undefined' ? Response : null
  // Save the raw function references (no .bind()) so callers can compare
  // them byte-for-byte (Object.is equality) against the pre-install globals.
  // The shims call through them with explicit context (.call) where needed.
  _origFetch = window.fetch ?? null
  // navigator.sendBeacon may be absent in older environments and test environments
  // (jsdom does not implement it). Guard to avoid TypeError.
  _origSendBeacon = navigator.sendBeacon ?? null

  const origSetAttribute = _origSetAttribute

  // -------------------------------------------------------------------------
  // Override: Element.prototype.setAttribute
  // -------------------------------------------------------------------------
  // Intercepts `el.setAttribute('src', url)` — the HTML parser's path when
  // it sets `src` last, triggering the fetch. Also catches dynamically created
  // elements that use setAttribute instead of the src property.
  //
  // We wrap the prototype so ALL elements benefit without needing to patch each
  // newly created element individually. However we only act on <script>/<iframe>/<img>
  // for `src`; all other attribute mutations pass through immediately.
  Element.prototype.setAttribute = function patchedSetAttribute(name: string, value: string): void {
    if (
      name === 'src' &&
      (this.tagName === 'SCRIPT' || this.tagName === 'IFRAME' || this.tagName === 'IMG')
    ) {
      const el = this as HTMLScriptElement | HTMLIFrameElement | HTMLImageElement

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
    if (tag !== 'script' && tag !== 'iframe' && tag !== 'img') {
      return el // non-script/iframe/img: pass through immediately (no overhead)
    }

    const targetEl = el as HTMLScriptElement | HTMLIFrameElement | HTMLImageElement

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
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(targetEl), 'src')
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
            _staged.push({
              el: targetEl,
              src: value,
              origProtoSetter: protoSetter,
              viaSetAttribute: false,
            })
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

  // -------------------------------------------------------------------------
  // Override: window.Image constructor
  // -------------------------------------------------------------------------
  // `new Image()` bypasses document.createElement entirely — it calls the
  // HTMLImageElement constructor directly. This is the canonical Meta Pixel
  // pattern (`var img = new Image(); img.src = url`) and must be patched
  // synchronously in the same bootstrap tick as the other overrides.
  //
  // Shape per runtime SME §1: capture original as _origImage (already saved
  // above), install a PatchedImage constructor that creates the real element
  // via _origImage and installs the same one-shot src trap.
  // [research/runtime-interception-domain-expert.md §Findings 1, §Gotchas 1]
  const origImg = _origImage!
  window.Image = function PatchedImage(
    this: HTMLImageElement,
    width?: number,
    height?: number,
  ): HTMLImageElement {
    const img = new origImg(width, height)

    // Save prototype src setter for the trap.
    const protoDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(img), 'src')
    const protoSetter = protoDesc?.set ?? null

    // Install the same one-shot src trap used by the createElement path.
    Object.defineProperty(img, 'src', {
      configurable: true,
      enumerable: true,
      get(): string {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(img), 'src')
        return desc?.get?.call(img) ?? ''
      },
      set(value: string): void {
        // Remove the instance-level trap first (prevents re-entry).
        delete (img as unknown as Record<string, unknown>).src

        if (_matcher !== null) {
          // Phase 2: real matcher — classify inline.
          const match = _matcher(value)
          if (match) {
            const held = _holdElement(img, value, match)
            if (held) return // suppress src — element stays inert
          }
        } else {
          // Phase 1: stage the element (hold inert until matcher resolves).
          if (
            !img.getAttribute(ATTR_AUTO_DETECTED) &&
            img.getAttribute(ATTR_STATE) !== STATE_BLOCKED &&
            img.getAttribute(ATTR_STATE) !== 'executed'
          ) {
            _staged.push({
              el: img,
              src: value,
              origProtoSetter: protoSetter,
              viaSetAttribute: false,
            })
            return // hold inert — do NOT assign src yet
          }
        }

        // Not held/staged: forward to prototype setter.
        if (protoSetter) {
          protoSetter.call(img, value)
        }
      },
    })

    return img
  } as unknown as typeof Image
  window.Image.prototype = origImg.prototype

  // -------------------------------------------------------------------------
  // Override: window.fetch
  // -------------------------------------------------------------------------
  // Minimal synchronous stub — installs the wrapper that routes through to the
  // Phase-2 classifier once `activateTransportClassifiers()` is called.
  //
  // **Phase 1** (before the lazy DB chunk loads): `_fetchClassifierFn` is null;
  // the shim passes every call through to `_origFetch` unchanged. First-party
  // API calls are never staged/held.
  //
  // **Phase 2** (after `activateTransportClassifiers()` fires): `_fetchClassifierFn`
  // is set to the full classify+hold logic that lives in the lazy chunk
  // (`autoblock-transport-classifier.ts`). The stub delegates to it.
  //
  // The full classify logic (AbortSignal handling, keepalive drop, declared-wins
  // check, Request clone, 204 stub) is factored into the lazy chunk to keep the
  // always-on ESM-OFF bundle lean.
  //
  // Anti-circular-re-interception: the shim calls `_origFetch`, never `window.fetch`.
  //
  // [task 003 AC1, AC2, AC6, AC7; task 002 AC1; task 006 §Bundle-budget gate]
  // [research/performance-engineer.md §Rec1 (minimal synchronous stub, ≤80 lines)]
  // [research/_index.md §Update Q2 (Phase 2 lazy install timing)]
  if (_origFetch !== null) {
    const origFetch = _origFetch
    window.fetch = function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      // Phase 1 or classifier not yet loaded: pass through immediately.
      if (_matcher === null || _fetchClassifierFn === null) {
        return origFetch.call(window, input, init)
      }
      // Phase 2: delegate to the full classify+hold logic in the lazy chunk.
      return _fetchClassifierFn(input, init)
    }
  }

  // -------------------------------------------------------------------------
  // Override: navigator.sendBeacon
  // -------------------------------------------------------------------------
  // Minimal synchronous stub — same delegation pattern as patchedFetch above.
  //
  // Wrapped via instance-property shadow (`navigator.sendBeacon = wrapped`), NOT
  // `Navigator.prototype.sendBeacon` — frozen-prototype environments must not throw.
  // [task 002 AC2; research/runtime-interception-domain-expert.md §Gotchas (prototype-chain)]
  //
  // The full classify+queue+unload-drop logic (task 004) lives in the lazy chunk.
  // The `pagehide` lifecycle listener is registered by `activateTransportClassifiers()`
  // (not here) so it only fires while the classifier is active.
  //
  // [task 004 AC1–AC5; task 006 §Bundle-budget gate]
  if (_origSendBeacon !== null) {
    const origBeacon = _origSendBeacon
    navigator.sendBeacon = function patchedSendBeacon(
      url: string,
      data?: BodyInit | null,
    ): boolean {
      // Phase 1 or classifier not yet loaded: pass through immediately.
      if (_matcher === null || _beaconClassifierFn === null) {
        return origBeacon.call(navigator, url, data)
      }
      // Phase 2: delegate to the full classify+queue+unload-drop logic in the lazy chunk.
      return _beaconClassifierFn(url, data)
    }
  }

  _installed = true
  _debug?.(
    'auto-block proxy installed (createElement + setAttribute + Image + fetch + sendBeacon overrides active)',
  )
}

/**
 * Uninstall the proxy overrides and restore all native globals.
 *
 * Restores: `document.createElement`, `Element.prototype.setAttribute`,
 * `window.Image`, `window.fetch`, and `navigator.sendBeacon`.
 * Clears all held/staged/transport stores to prevent cross-test pollution.
 *
 * Exported for test teardown only — not part of the public API.
 *
 * [task 002 AC5; research/existing-codebase-archaeologist.md §Findings 7]
 */
export function _resetAutoBlockProxy(): void {
  // Always clear ALL queues, regardless of whether the proxy is installed,
  // so direct _holdElement() calls in tests are cleaned up.
  _held.length = 0
  _staged.length = 0
  _heldFetches.length = 0
  _queuedBeacons.length = 0

  if (!_installed) {
    // Also clear the matcher and classifiers in case they were set outside the
    // install path in tests.
    _matcher = null
    _fetchClassifierFn = null
    _beaconClassifierFn = null
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

  if (_origImage !== null) {
    window.Image = _origImage
    _origImage = null
  }

  if (_origFetch !== null) {
    window.fetch = _origFetch
    _origFetch = null
  }

  // Clear the saved Response constructor (no global to restore — it was saved, not replaced).
  _origResponse = null

  if (_origSendBeacon !== null) {
    navigator.sendBeacon = _origSendBeacon
    _origSendBeacon = null
  }

  // Remove the pagehide listener registered by activateTransportClassifiers()
  // (task 004 AC5 — unload-drop guard cleanup; moved from installAutoBlockProxy
  // in task 006 for ESM-OFF budget reclamation).
  if (_pageLifecycleHandler !== null) {
    window.removeEventListener('pagehide', _pageLifecycleHandler, { capture: true })
    _pageLifecycleHandler = null
  }
  _isUnloading = false

  // Clear Phase-2 transport classifier function pointers (task 006).
  _fetchClassifierFn = null
  _beaconClassifierFn = null

  _installed = false
  _matcher = null
  _debug = null
}
