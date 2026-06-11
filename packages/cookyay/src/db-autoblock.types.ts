/**
 * Client-side shape for a single auto-block DB entry.
 *
 * This is the browser-portable, zero-dependency type used by the v5 runtime
 * auto-block matcher. It carries ONLY the fields needed to recognise and
 * classify a script/iframe at load time:
 *   - id + category:     identity and the consent category gate
 *   - requestHosts:      unambiguous host-level matching (subdomain-aware)
 *   - requestPaths:      host-qualified path prefixes for shared hosts
 *                        (e.g. "facebook.com/tr", "www.google.com/recaptcha/")
 *   - scriptUrlGlobs:    URL glob patterns for script src disambiguation
 *                        (required when requestHosts sits on a shared CDN)
 *   - iframeSrcGlobs:    URL glob patterns for iframe src disambiguation
 *   - google:            true for Google-owned services (GA4/GTM/Ads/reCAPTCHA/…)
 *                        The runtime matcher skips these and lets Consent Mode v2
 *                        degrade them instead — DOM-blocking GTM would suppress
 *                        all CM v2 update signals.
 *                        [goals.md §Consent Mode v2: skip Google tags, prd.md §3.4]
 *
 * Scanner-only fields (cookies, localStorage, source) are intentionally absent —
 * they provide no utility for blocking scripts/iframes and would waste bundle budget.
 *
 * This type is the single client-side contract. The generated file
 * `db-autoblock.generated.ts` (emitted by packages/scanner/scripts/build-services-db.mjs)
 * must satisfy it. Task 002 (runtime matcher) also imports this type.
 *
 * [architecture.md §Amendments 2026-06-10 — v4 architecture decisions (amend),
 *  goals.md §Signature-DB delivery: inline a stripped client subset via codegen]
 */

export type AutoBlockCategory = 'necessary' | 'functional' | 'analytics' | 'marketing'

export interface AutoBlockEntry {
  /** Unique stable identifier (slug). Matches the scanner's ServiceDefinition.id. */
  id: string
  /** Consent category this service belongs to. */
  category: AutoBlockCategory
  /**
   * True for Google-owned services (GA4, GTM, Google Ads, Google Optimize,
   * reCAPTCHA). The runtime matcher skips these — Consent Mode v2 handles
   * their degradation instead.
   */
  google?: boolean
  /**
   * Exact hostnames / parent domains that match this service.
   * Matching rules: exact (`host === h`) or subdomain (`host.endsWith('.'+h)`).
   * These are unambiguous hosts — each host belongs to only one service.
   */
  requestHosts: string[]
  /**
   * Host-qualified path prefixes for services whose host alone is too broad.
   * Each entry is a "host/path" string (e.g. "facebook.com/tr").
   * A URL matches if its host equals / is a subdomain of the entry host AND
   * its pathname starts with the entry path component.
   */
  requestPaths?: string[]
  /**
   * URL glob patterns for known script src values.
   * Required when requestHosts contains a shared CDN host to disambiguate
   * between multiple services on the same host.
   */
  scriptUrlGlobs?: string[]
  /**
   * URL glob patterns for known iframe src values.
   * Required when requestHosts contains a shared CDN host to disambiguate
   * between multiple services on the same host.
   */
  iframeSrcGlobs?: string[]
}
