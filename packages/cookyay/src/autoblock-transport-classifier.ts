/**
 * Transport-layer classify logic — lazy chunk companion to `autoblock-proxy.ts`.
 *
 * This module contains the **full Phase-2 classify+hold logic** for `window.fetch`
 * and `navigator.sendBeacon` interception. It is exported from `autoblock-loader.ts`
 * and therefore only reaches the browser as part of the lazy `autoblock-loader-*.js`
 * chunk, which loads only when `autoBlock: true`.
 *
 * **Why split from `autoblock-proxy.ts`?**
 * `autoblock-proxy.ts` is statically imported by `api.ts` and therefore included in
 * the always-on ESM-OFF bundle (`dist/index.js`). Keeping the complex classify logic
 * (AbortSignal handling, keepalive drop, declared-wins check, Request clone, 204 stub)
 * here removes ~1 kB gzip from the OFF bundle, satisfying the v7 ESM-OFF budget gate.
 * The thin stubs in `autoblock-proxy.ts` delegate to the classifiers via function
 * pointers set by `activateTransportClassifiers()` at Phase-2 activation time.
 *
 * **Design constraint — no static import from `autoblock-proxy.ts`:**
 * If this module imported from `autoblock-proxy.ts`, the bundler would extract
 * `autoblock-proxy.ts` + its deps into a shared chunk loaded by ALL users (not just
 * `autoBlock:true` users), defeating the tree-shake-to-zero guarantee. Instead, all
 * proxy state is forwarded as factory parameters from `api.ts`. The utility functions
 * `_extractUrl` and `_isDeclaredCovered` are intentionally duplicated here (they are
 * tiny: 3 + 5 lines) to preserve the chunk boundary.
 *
 * [task 003 — fetch classify semantics]
 * [task 004 — sendBeacon classify semantics]
 * [task 006 — bundle-budget gate (moved here from autoblock-proxy.ts)]
 * [research/performance-engineer.md §Rec1 (minimal sync stub, full logic in lazy chunk)]
 */

import type { AutoBlockMatch } from './autoblock-matcher.js'

// ---------------------------------------------------------------------------
// Inline type mirrors (avoid importing from autoblock-proxy.ts — see module doc)
// ---------------------------------------------------------------------------

/** Mirror of HeldFetch shape from autoblock-proxy.ts — kept in sync manually. */
interface HeldFetch {
  url: string
  replayInput: string | URL | Request
  init: RequestInit | undefined
  category: string
  serviceId: string
  signal: AbortSignal | null
}

/** Mirror of QueuedBeacon shape from autoblock-proxy.ts — kept in sync manually. */
interface QueuedBeacon {
  url: string
  data: BodyInit | null | undefined
  category: string
  serviceId: string
}

// ---------------------------------------------------------------------------
// Inline utility duplicates
// (Intentionally duplicated from autoblock-proxy.ts to avoid shared-chunk creation)
// ---------------------------------------------------------------------------

/** Extract URL string from fetch input — string | URL | Request. Zero allocation for strings. */
function extractUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Check if URL is already covered by a declared data-category element (declared-wins guard).
 * Called only after a curated-DB match — non-matching URLs never reach this.
 */
function isDeclaredCovered(url: string): boolean {
  const nodes = document.querySelectorAll('[type="text/plain"][data-category][data-src]')
  for (let i = 0; i < nodes.length; i++) {
    if ((nodes[i] as HTMLElement).getAttribute('data-src') === url) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Context bag forwarded from api.ts at Phase-2 activation time
// ---------------------------------------------------------------------------

/** State forwarded from autoblock-proxy.ts via api.ts at factory-call time. */
export interface TransportClassifierContext {
  /** The saved original window.fetch (captured before any override). */
  origFetch: typeof window.fetch
  /** The saved native Response constructor (captured before any override). */
  nativeResponse: typeof Response
  /** The saved original navigator.sendBeacon (captured before any override). */
  origSendBeacon: typeof navigator.sendBeacon | null
  /** The live _heldFetches array from autoblock-proxy.ts. */
  heldFetches: HeldFetch[]
  /** The live _queuedBeacons array from autoblock-proxy.ts. */
  queuedBeacons: QueuedBeacon[]
  /** Function to check if the page is currently unloading. */
  isUnloading: () => boolean
}

// ---------------------------------------------------------------------------
// fetch classifier factory
// ---------------------------------------------------------------------------

/**
 * Build the Phase-2 fetch classifier closure.
 *
 * The returned function is wired into the thin `patchedFetch` stub in
 * `autoblock-proxy.ts` via `activateTransportClassifiers()`. It is called only
 * in Phase 2 (matcher loaded, classifier set) for every `window.fetch` call.
 *
 * **Hybrid stub+queue semantics (task 003):**
 * 1. Extract URL, run matcher — cheapest operations first (no clone yet).
 * 2. On match: immediately resolve the caller's Promise with a benign
 *    `new Response(null, { status: 204 })` stub — no hang, no timeout.
 * 3. Separately (if not a keepalive/unload call): clone the Request body at
 *    intercept time and push to `_heldFetches` for best-effort replay on grant.
 * 4. If `AbortSignal` fires before grant: discard the held entry.
 *
 * [task 003 AC1–AC7; research/performance-engineer.md §Findings 1, 3]
 */
export function makeFetchClassifier(
  matcher: (url: string) => AutoBlockMatch | null,
  debug: ((msg: string, ...args: unknown[]) => void) | null,
  ctx: TransportClassifierContext,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const { origFetch, nativeResponse: NativeResponse, heldFetches } = ctx

  return function classifyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Extract URL (cheapest operation) and classify.
    // [research/performance-engineer.md §Findings 1, §Recommendations 2]
    const url = extractUrl(input as string | URL | Request)
    const match = matcher(url)

    if (!match) {
      // Non-matching (first-party / non-curated) — pass through untouched.
      // No stub, no hold, no Request.clone() (clone happens ONLY after confirmed match).
      return origFetch.call(window, input, init)
    }

    // Matched curated tracking endpoint — check declared-wins before queuing.
    // If the same URL is already covered by a declared `data-category` element
    // in the DOM (e.g. `<script type="text/plain" data-category="..." data-src="url">`),
    // the declarative engine already handles the request — pass through without queuing.
    // [task 005 AC6 — declared-wins / no-double-queue; research/test-strategist.md §F4]
    if (isDeclaredCovered(url)) {
      debug?.('fetch to "%s" — skipped by transport proxy (declared element covers this URL)', url)
      return origFetch.call(window, input, init)
    }

    // Drop keepalive requests (page is ending — no meaningful replay context).
    // [research/runtime-interception-domain-expert.md §Findings 3, §Gotchas]
    const isKeepalive =
      init?.keepalive === true ||
      (input instanceof Request && (input as Request).keepalive === true)
    if (isKeepalive) {
      debug?.(
        'auto-blocked keepalive fetch to "%s" — dropped (no replay; page is ending) (service: %s)',
        url,
        match.serviceId,
      )
      return Promise.resolve(new NativeResponse(null, { status: 204 }))
    }

    debug?.(
      'auto-blocked fetch to "%s" (service: %s, category: %s) — returning 204 stub, queuing for replay',
      url,
      match.serviceId,
      match.category,
    )

    // Clone the Request body at intercept time (NOT at grant time).
    // The Request body is a one-read ReadableStream — cloning must happen now.
    // For string/URL inputs, no clone is needed (they are immutable).
    // [task 003 AC2; research/runtime-interception-domain-expert.md §Findings 2, §Recommendations 2]
    // [research/performance-engineer.md §Findings 3 (clone ONLY after confirmed match)]
    let replayInput: string | URL | Request
    if (input instanceof Request) {
      replayInput = (input as Request).clone()
    } else {
      replayInput = input as string | URL
    }

    // Extract the AbortSignal for discard-on-abort tracking.
    // Signal may come from the RequestInit or (for Request objects) the Request itself.
    // [task 003 AC6; research/runtime-interception-domain-expert.md §Gotchas (AbortSignal)]
    const signal: AbortSignal | null =
      init?.signal instanceof AbortSignal
        ? (init.signal as AbortSignal)
        : input instanceof Request
          ? (input as Request).signal
          : null

    // Build the HeldFetch entry (stores replay input + metadata).
    const heldEntry: HeldFetch = {
      url,
      replayInput,
      init,
      category: match.category,
      serviceId: match.serviceId,
      signal,
    }
    heldFetches.push(heldEntry)

    // If the signal is already aborted, discard immediately (don't queue).
    if (signal?.aborted) {
      heldFetches.splice(heldFetches.indexOf(heldEntry), 1)
      debug?.('fetch AbortSignal already aborted at intercept time — discarded: "%s"', url)
      return Promise.resolve(new NativeResponse(null, { status: 204 }))
    }

    // Attach abort listener: if signal fires before grant, discard the entry.
    if (signal !== null) {
      signal.addEventListener(
        'abort',
        () => {
          const idx = heldFetches.indexOf(heldEntry)
          if (idx !== -1) {
            heldFetches.splice(idx, 1)
            debug?.('fetch AbortSignal fired — discarded held fetch: "%s"', url)
          }
        },
        { once: true },
      )
    }

    // Return the benign 204 stub immediately — the caller's Promise is settled NOW.
    // The held entry is replayed independently by the grant path (fire-and-forget).
    return Promise.resolve(new NativeResponse(null, { status: 204 }))
  }
}

// ---------------------------------------------------------------------------
// sendBeacon classifier factory
// ---------------------------------------------------------------------------

/**
 * Build the Phase-2 sendBeacon classifier closure.
 *
 * The returned function is wired into the thin `patchedSendBeacon` stub in
 * `autoblock-proxy.ts` via `activateTransportClassifiers()`. It is called only
 * in Phase 2 for every `navigator.sendBeacon` call.
 *
 * **Queue-and-return-true semantics (task 004):**
 * - Matched pre-consent beacon: queued in `_queuedBeacons`, returns `true` to caller.
 * - Unload-drop guard: if `isUnloading()` or `document.hidden`, drop and return `true`.
 * - Pass-through: non-matched and declared-covered beacons forward to `_origSendBeacon`.
 *
 * [task 004 AC1–AC5; research/runtime-interception-domain-expert.md §Findings 4]
 */
export function makeBeaconClassifier(
  matcher: (url: string) => AutoBlockMatch | null,
  debug: ((msg: string, ...args: unknown[]) => void) | null,
  ctx: TransportClassifierContext,
): (url: string, data?: BodyInit | null) => boolean {
  const { origSendBeacon, queuedBeacons, isUnloading } = ctx

  return function classifyBeacon(url: string, data?: BodyInit | null): boolean {
    const match = matcher(url)

    if (!match) {
      return origSendBeacon?.call(navigator, url, data) ?? false
    }

    // Declared-wins guard.
    // [task 005 AC6 — declared-wins / no-double-queue]
    if (isDeclaredCovered(url)) {
      debug?.(
        'sendBeacon to "%s" — skipped by transport proxy (declared element covers this URL)',
        url,
      )
      return origSendBeacon?.call(navigator, url, data) ?? false
    }

    // Unload-drop guard: if the page is unloading (pagehide fired) or the
    // document is hidden (tab-background = dominant session-end trigger for
    // GA4/Meta Pixel beacons), drop the beacon. Return `true` so the caller's
    // retry logic is not tripped.
    // [task 004 AC5; research/runtime-interception-domain-expert.md §Findings 4]
    if (isUnloading() || document.hidden) {
      return true
    }

    // Matched, page still active: queue for delivery on grant, return true.
    debug?.(
      'auto-blocked sendBeacon to "%s" (service: %s, category: %s)',
      url,
      match.serviceId,
      match.category,
    )
    queuedBeacons.push({
      url,
      data,
      category: match.category,
      serviceId: match.serviceId,
    })
    return true
  }
}

// ---------------------------------------------------------------------------
// Transport drain hook factory
// ---------------------------------------------------------------------------

/**
 * Build the grant-time transport drain callback.
 *
 * The returned function is registered via `_registerTransportReleaseHook()` in
 * `api.ts`. When `blocking.ts:grant(category)` fires, it calls this callback to
 * replay held fetches and queued beacons for the granted category.
 *
 * Defined here (in the lazy chunk) so the drain logic — which references
 * `heldFetches`, `queuedBeacons`, replay strings, etc. — does NOT appear in the
 * always-on ESM-OFF bundle.
 *
 * [task 002 AC4, AC6; task 003 AC2, AC7; task 006 §Bundle-budget gate]
 */
export function makeTransportDrainHook(
  ctx: TransportClassifierContext,
  debug: ((msg: string, ...args: unknown[]) => void) | null,
): (category: string) => void {
  const { origFetch, origSendBeacon, heldFetches, queuedBeacons } = ctx

  return function drainTransportForCategory(category: string): void {
    // Drain held fetches for this category.
    // [task 003 AC2 — replay via replayInput (cloned at intercept time), fire-and-forget]
    let i = heldFetches.length
    while (i--) {
      const hf = heldFetches[i]
      if (hf.category !== category) continue
      heldFetches.splice(i, 1)
      debug?.('replaying held fetch to "%s" (service: %s)', hf.url, hf.serviceId)
      if (origFetch) {
        // Use replayInput (cloned Request or original string/URL) so body is intact.
        // Do NOT pass init when replayInput is a Request — headers/method/body are in the clone.
        const replayIsRequest = hf.replayInput instanceof Request
        origFetch(hf.replayInput as RequestInfo | URL, replayIsRequest ? undefined : hf.init).catch(
          (err: unknown) => {
            debug?.('replay fetch to "%s" failed: %s', hf.url, err)
          },
        )
      }
    }

    // Drain queued beacons for this category.
    let j = queuedBeacons.length
    while (j--) {
      const qb = queuedBeacons[j]
      if (qb.category !== category) continue
      queuedBeacons.splice(j, 1)
      debug?.('replaying queued sendBeacon to "%s" (service: %s)', qb.url, qb.serviceId)
      origSendBeacon?.call(navigator, qb.url, qb.data)
    }
  }
}
