/**
 * Bootstrap-first diagnostic — dev-only console warning for known trackers that
 * loaded before the Cookyay bootstrap.
 *
 * ## Why this exists
 *
 * When `autoBlock: true` is set, the Cookyay bootstrap must be the FIRST script
 * in `<head>`. Any `<script src>`, `<img src>`, or `<iframe src>` placed BEFORE
 * the bootstrap cannot be intercepted — the browser has already fetched those
 * resources. This module detects that situation at runtime and emits an actionable
 * warning so the developer knows to re-order their scripts.
 *
 * The diagnostic is:
 *   - **dev-only**: fires only when `config.debug === true` (author decision D).
 *   - **advisory only**: makes no attempt to retroactively block already-fetched
 *     resources (impossible by design; see goals.md §Bootstrap-first mitigation).
 *   - **zero-cost in production**: the entire module is wrapped in a
 *     `process.env.NODE_ENV !== 'production'` guard so esbuild/tsup's constant-
 *     folding + DCE strips every byte in minified production builds.
 *   - **never throws**: tolerates absent Performance API or cross-origin name-only
 *     entries gracefully.
 *
 * [goals.md §What's new in v6 — bootstrap-first diagnostic]
 * [research/runtime-interception-domain-expert.md §Findings 4; Gotchas 5]
 * [research/performance-engineer.md §Findings 3]
 * [research/_index.md §Update — Author decisions (D, G)]
 * [architecture.md §3 Sync vs async work]
 */

import type { AutoBlockMatch } from './autoblock-matcher.js'

// ---------------------------------------------------------------------------
// Warning message format (shared between the implementation and tests)
// ---------------------------------------------------------------------------

/**
 * Format the console warning message for a pre-bootstrap tracker hit.
 *
 * Exported so tests can match the exact message format without hardcoding it
 * in two places.
 */
export function _formatDiagnosticWarning(serviceName: string, url: string): string {
  return (
    `[Cookyay] INSTALL ORDER WARNING: "${serviceName}" (${url}) loaded before ` +
    `Cookyay bootstrap. Move Cookyay first in <head>.`
  )
}

// ---------------------------------------------------------------------------
// Core diagnostic function
// ---------------------------------------------------------------------------

/**
 * Scan for known trackers that were already loaded before the Cookyay bootstrap.
 *
 * Uses two complementary signals:
 *   **A. `performance.getEntriesByType('resource')`** — network-proof: any known
 *      tracker URL that appears here was actually fetched before the proxy installed.
 *      Cross-origin entries always have a `.name` (the URL), even when timing
 *      breakdown detail is hidden by CORS.
 *   **B. DOM scan** — `document.querySelectorAll('script[src], img[src], iframe[src]')`
 *      as a secondary signal: catches elements committed by the HTML parser whose
 *      network requests may not yet be in the PerformanceEntry list.
 *
 * A URL that hits via either signal emits one `console.warn` per unique (service, url)
 * pair. Already-seen pairs are deduplicated within a single diagnostic run.
 *
 * ## Design constraints
 *   - Must not throw on any input (Performance API absent, cross-origin restrictions,
 *     empty node lists). All access is guarded.
 *   - Must not attempt to retroactively block anything — purely advisory.
 *   - `matchFn` is passed in (injected by `api.ts`) so this module does NOT import
 *     the auto-block DB directly; it remains a zero-cost, DCE-friendly module.
 *
 * @param matchFn  The active auto-block URL matcher (same function used by the proxy).
 *                 Receives an absolute URL string; returns `{serviceId, category}` or
 *                 `null`.
 * @param serviceLabel  Optional mapping from `serviceId` → human-readable name.
 *                      Falls back to the raw `serviceId` when the map omits a service.
 *                      Passed in from `api.ts` which owns config; keeps this module
 *                      dependency-free.
 */
export function runBootstrapDiagnostic(
  matchFn: (url: string) => AutoBlockMatch | null,
  serviceLabel: (serviceId: string) => string = (id) => id,
): void {
  // Guard: entire function body is elided in production builds by esbuild DCE.
  if (process.env.NODE_ENV === 'production') return

  // Deduplicate warnings: a single (serviceId, url) pair should emit only once
  // even if both the Performance scan and the DOM scan both hit it.
  const seen = new Set<string>()

  /**
   * Inspect a single URL against the matcher; emit a warning on the first hit for
   * each unique (serviceId, url) pair.
   */
  function _inspect(url: string): void {
    if (!url || typeof url !== 'string') return
    // Only check absolute URLs (relative paths are first-party, never blockable).
    if (!url.startsWith('http://') && !url.startsWith('https://')) return

    let match: AutoBlockMatch | null = null
    try {
      match = matchFn(url)
    } catch {
      // matchFn must not throw, but guard defensively.
      return
    }
    if (!match) return

    const dedupeKey = `${match.serviceId}::${url}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)

    const name = serviceLabel(match.serviceId)
    console.warn(_formatDiagnosticWarning(name, url))
  }

  // ---------------------------------------------------------------------------
  // Signal A: Performance resource timing entries
  // ---------------------------------------------------------------------------
  try {
    const entries = performance.getEntriesByType('resource')
    for (const entry of entries) {
      // `entry.name` is the URL string; always present for all resource types.
      _inspect(entry.name)
    }
  } catch {
    // Performance API absent or throws (e.g. cross-origin iframe isolation) — skip.
  }

  // ---------------------------------------------------------------------------
  // Signal B: DOM scan of existing script/img/iframe elements
  // ---------------------------------------------------------------------------
  try {
    const elements = document.querySelectorAll('script[src], img[src], iframe[src]')
    for (const el of elements) {
      const src = el.getAttribute('src')
      if (src) _inspect(src)
    }
  } catch {
    // DOM access may fail in unusual environments — skip gracefully.
  }
}
