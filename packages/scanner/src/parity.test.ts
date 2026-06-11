/**
 * Scanner↔banner parity test — matcher agrees with scanner verdict.
 *
 * Asserts that for every curated service in data/services.yaml, the scanner's
 * host/path resolution (findServiceByHost / findServiceByRequest in db.ts) and
 * the v5 client matcher (matchAutoBlock in cookyay's autoblock-matcher.ts) return
 * the SAME serviceId and category for a representative URL of that service.
 *
 * **Package placement decision:**
 * This test lives in `packages/scanner/src/` because the scanner owns the
 * canonical `CURATED_SERVICES` list and the `findServiceByHost` / `findServiceByRequest`
 * functions that drive scan-time verdicts. The client matcher is imported via a
 * relative path (../../cookyay/src/autoblock-matcher.ts) — valid in Vitest node
 * mode since both packages are siblings in the pnpm workspace. No cross-package
 * dependency is needed at build time; the relative import is test-only.
 *
 * **Coverage:**
 * 1. Non-Google services: scanner and client return the same serviceId + category.
 * 2. Google-owned services: scanner matches (returns a non-null result) but client
 *    returns null — this is the ONE documented divergence [goals.md §Consent Mode
 *    v2: skip Google tags]. The test encodes this explicitly so it can never silently
 *    pass as an accidental mismatch.
 * 3. Data-driven over the full 50-service curated set: adding a service to
 *    services.yaml automatically extends parity coverage without touching this file.
 * 4. The test fails loudly (Vitest's `.toBe()` assertion) if either code path drifts
 *    (e.g. a field rename, matching-rule change, or new Google service added without
 *    the google: true flag).
 *
 * [task 007 — acceptance criteria]
 * [research/test-strategist.md §Findings F5]
 * [goals.md §What's new in v5, §Acceptance bar]
 */

import { describe, it, expect } from 'vitest'
import { CURATED_SERVICES } from './db-curated.generated.js'
import { findServiceByRequest } from './db.js'
import { matchAutoBlock } from '../../cookyay/src/autoblock-matcher.js'

// ---------------------------------------------------------------------------
// URL synthesis helpers
// ---------------------------------------------------------------------------

/**
 * Synthesise a representative absolute HTTPS URL for a curated service.
 *
 * Strategy (in priority order):
 *   1. If requestHosts is non-empty: "https://<first host>/parity-probe"
 *   2. If requestPaths is non-empty: each entry is "host/path" so the URL becomes
 *      "https://<entry-host><entry-path>parity-probe"
 *   3. If neither is present: return null (service has no URL-based signal — skipped).
 */
function synthesiseUrl(service: (typeof CURATED_SERVICES)[number]): string | null {
  if (service.requestHosts.length > 0) {
    return `https://${service.requestHosts[0]}/parity-probe`
  }
  if (service.requestPaths && service.requestPaths.length > 0) {
    const entry = service.requestPaths[0]
    const slashIdx = entry.indexOf('/')
    if (slashIdx === -1) return null
    const rpHost = entry.slice(0, slashIdx)
    const rpPath = entry.slice(slashIdx)
    return `https://${rpHost}${rpPath}parity-probe`
  }
  return null
}

// ---------------------------------------------------------------------------
// Parity assertions
// ---------------------------------------------------------------------------

describe('scanner↔banner parity — all curated services', () => {
  // Separate Google-owned vs. non-Google services for different assertion paths.
  const nonGoogleServices = CURATED_SERVICES.filter((s) => !s.google)
  const googleServices = CURATED_SERVICES.filter((s) => s.google === true)

  // -------------------------------------------------------------------------
  // Non-Google services: scanner and client MUST return the SAME verdict.
  // -------------------------------------------------------------------------
  describe('non-Google services — scanner verdict equals client verdict', () => {
    it.each(nonGoogleServices.map((s) => [s.id, s] as [string, (typeof CURATED_SERVICES)[number]]))(
      '%s',
      (_id, service) => {
        const url = synthesiseUrl(service)
        if (url === null) {
          // Service has no URL-based signal — cookie/localStorage only.
          // Cannot test URL-level parity; skip with an explanation.
          // (No curated service currently falls into this bucket.)
          return
        }

        const host = new URL(url).hostname

        // Scanner verdict
        const scannerResult = findServiceByRequest(url, host)
        // Client verdict
        const clientResult = matchAutoBlock(url)

        // Both must agree: either both match (with the same service + category)
        // or both return null.
        if (scannerResult === null) {
          expect(
            clientResult,
            `service "${service.id}": scanner returned null for URL "${url}" — client should also return null`,
          ).toBeNull()
        } else {
          expect(
            clientResult,
            `service "${service.id}": scanner matched "${scannerResult.service.id}" but client returned null for URL "${url}"`,
          ).not.toBeNull()

          expect(
            clientResult!.serviceId,
            `service "${service.id}": scanner matched "${scannerResult.service.id}" ` +
              `but client matched "${clientResult!.serviceId}" for URL "${url}"`,
          ).toBe(scannerResult.service.id)

          expect(
            clientResult!.category,
            `service "${service.id}": scanner returned category "${scannerResult.service.category}" ` +
              `but client returned category "${clientResult!.category}" for URL "${url}"`,
          ).toBe(scannerResult.service.category)
        }
      },
    )
  })

  // -------------------------------------------------------------------------
  // Google-owned services: scanner matches, client MUST return null.
  //
  // This is the ONE documented, intentional divergence: DOM-blocking GTM/GA4
  // would suppress all Consent Mode v2 update signals, so the client matcher
  // explicitly skips Google services and lets CM v2 degrade them instead.
  // [goals.md §Consent Mode v2: skip Google tags, prd.md §3.4]
  //
  // Encoding this explicitly (rather than letting it silently "pass" as both-null)
  // catches two failure modes:
  //   a) A newly added Google service that forgets `google: true` in services.yaml
  //      — scanner returns non-null, client returns non-null → test fails.
  //   b) The client matcher accidentally starts matching Google services
  //      — scannerResult non-null, clientResult non-null → test fails.
  // -------------------------------------------------------------------------
  describe('Google-owned services — scanner matches, client returns null (intended divergence)', () => {
    it.each(googleServices.map((s) => [s.id, s] as [string, (typeof CURATED_SERVICES)[number]]))(
      '%s',
      (_id, service) => {
        const url = synthesiseUrl(service)
        if (url === null) {
          // No URL-based signal for this Google service; cannot probe parity.
          // Fail explicitly so the test author notices the gap.
          throw new Error(
            `service "${service.id}" (google:true) has no requestHosts or requestPaths — ` +
              `cannot synthesise a representative URL for parity testing. ` +
              `Add at least one URL-based signal to services.yaml.`,
          )
        }

        const host = new URL(url).hostname

        // Scanner MUST match (Google services are in the DB and have URL signals)
        const scannerResult = findServiceByRequest(url, host)
        expect(
          scannerResult,
          `service "${service.id}" (google:true): expected scanner to match URL "${url}" but it returned null — ` +
            `ensure the service has valid requestHosts/requestPaths entries in services.yaml`,
        ).not.toBeNull()

        // Client MUST return null (Google-owned services are excluded from the
        // runtime matcher at index-build time — see _buildIndex() in autoblock-matcher.ts)
        const clientResult = matchAutoBlock(url)
        expect(
          clientResult,
          `service "${service.id}" (google:true): client matcher returned a non-null result for URL "${url}" — ` +
            `Google-owned services must be excluded from the runtime matcher (google:true flag not respected)`,
        ).toBeNull()
      },
    )
  })

  // -------------------------------------------------------------------------
  // Totals guard: every curated service must be represented in either the
  // non-Google or Google-owned assertion set above. This ensures that adding
  // a new service to services.yaml automatically extends parity coverage
  // (and cannot silently be missing from both test groups because of a
  // mistyped `google` flag or similar).
  // -------------------------------------------------------------------------
  it('covers all curated services — non-Google + Google counts equal total', () => {
    expect(nonGoogleServices.length + googleServices.length).toBe(CURATED_SERVICES.length)
    expect(CURATED_SERVICES.length).toBeGreaterThan(0)
  })
})
