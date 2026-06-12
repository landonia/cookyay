/**
 * Auto-block loader — conditional entry point for the runtime auto-block path.
 *
 * This module is the ONLY file in the always-on bundle that may reference the
 * auto-block matcher and signature DB. It exposes a single function
 * `getAutoBlockMatcher(config)` that returns the matcher when `autoBlock: true`
 * and `null` otherwise.
 *
 * Tree-shaking contract:
 *   - This module itself MUST be imported lazily by the interception proxy
 *     (task 004). The proxy should do:
 *
 *       if (config.autoBlock) {
 *         const { getAutoBlockMatcher } = await import('./autoblock-loader.js')
 *         const matcher = getAutoBlockMatcher(config)
 *         installProxy(matcher)
 *       }
 *
 *     Because the import expression is inside a conditional, bundlers that
 *     perform dead-code elimination (esbuild/tsup, rollup) will not include
 *     this module — and therefore neither `autoblock-matcher.ts` nor
 *     `db-autoblock.generated.ts` — in any opt-out build.
 *
 *   - This module MUST NOT be imported at the top level of any always-on
 *     module (api.ts, bootstrap.ts, index.ts, blocking.ts, banner.ts, etc.).
 *     A top-level eager import would pull the entire DB into every bundle.
 *
 * Note: the import of `autoblock-matcher.ts` here IS a top-level eager import
 * within this module — that is correct and intentional. The tree-shaking
 * guarantee comes from the fact that this module is only reached via the
 * conditional dynamic import in the proxy (task 004), not from any static
 * import chain that is always included.
 *
 * [goals.md §Auto-block is opt-in via a single config boolean]
 * [goals.md §Signature-DB delivery: inline a stripped client subset via codegen]
 * [research/performance-engineer.md §Findings — tree-shakes to zero for opt-out]
 * [research/_index.md §Update — Author decisions (C)]
 * [architecture.md §Amendments 2026-06-10 — v4 architecture decisions (amend)]
 */

import type { CookyayConfig } from './config.js'
import type { AutoBlockMatch } from './autoblock-matcher.js'
import { matchAutoBlock } from './autoblock-matcher.js'
// Diagnostic is co-located in this lazy chunk so it is NOT included in the
// always-on ESM-OFF bundle (index.js). api.ts obtains runBootstrapDiagnostic
// via the same dynamic import('./autoblock-loader.js') it already uses for
// getAutoBlockMatcher — the diagnostic rides in the same lazy chunk at zero
// extra ESM-OFF cost.
// [task 001 §Bundle-budget reclamation, research/performance-engineer.md §Rec3]
export { runBootstrapDiagnostic } from './autoblock-diagnostic.js'
// Transport classifier factories and drain hook are exported from this lazy chunk
// so they are NOT included in the always-on ESM-OFF bundle. api.ts obtains them
// via the same dynamic import('./autoblock-loader.js') that provides
// getAutoBlockMatcher, then calls activateTransportClassifiers() to wire the
// Phase-2 classify logic and registers the drain hook via
// _registerTransportReleaseHook().
// [task 006 §Bundle-budget gate; research/performance-engineer.md §Rec1]
export {
  makeFetchClassifier,
  makeBeaconClassifier,
  makeTransportDrainHook,
} from './autoblock-transport-classifier.js'

/**
 * Return the `matchAutoBlock` function when `config.autoBlock` is `true`,
 * or `null` when auto-block is disabled (the default).
 *
 * The returned function is the pure URL matcher built on the bundled signature
 * DB. Pass it to the interception proxy (task 004) to classify intercepted
 * script/iframe URLs at runtime.
 *
 * @returns `(url: string) => AutoBlockMatch | null` when `autoBlock: true`,
 *          otherwise `null`.
 */
export function getAutoBlockMatcher(
  config: Pick<CookyayConfig, 'autoBlock'>,
): ((url: string) => AutoBlockMatch | null) | null {
  if (!config.autoBlock) return null
  return matchAutoBlock
}

// Re-export the match type for callers that import this module
export type { AutoBlockMatch }
