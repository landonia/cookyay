/**
 * Service fingerprint database for cookie/request classification.
 *
 * Sources:
 * 1. Open Cookie Database (github.com/jkwakman/Open-Cookie-Database)
 *    License: Apache-2.0 — compatible with this project's Apache-2.0 license.
 *    Attribution: Cookie data sourced from the Open Cookie Database by J. Kwakman
 *    (https://github.com/jkwakman/Open-Cookie-Database), licensed under Apache-2.0.
 *    Entries are generated at build time by `scripts/ingest-ocd.mjs` into
 *    `src/db-ocd.generated.ts`. To refresh: `node scripts/ingest-ocd.mjs`.
 *
 * 2. Hand-curated top-20 supplement — adds request-host matching and fills
 *    gaps not covered by the OCD (e.g. localStorage keys, iframe hosts).
 *    The curated entries take precedence over OCD entries in lookup order
 *    (curated entries appear first in SERVICE_DB).
 *
 * Confidence levels:
 *   high   — curated entry with exact cookie name or prefix-wildcard match
 *            (intentional deviation from impl notes: host cross-check adds
 *            no meaningful signal for cookie-based classification and is
 *            omitted; "high" = curated source + cookie match)
 *   medium — OCD entry with any cookie match, or any host/request match
 *   low    — heuristic / declared-category only (no cookie or host signal)
 */

import { OCD_SERVICES } from './db-ocd.generated.js'

export type Confidence = 'high' | 'medium' | 'low'
export type ServiceCategory = 'necessary' | 'functional' | 'analytics' | 'marketing'

export interface CookiePattern {
  /** Exact cookie name, or a pattern ending in `*` for prefix matching. */
  name: string
  /** Whether `name` is a prefix wildcard (e.g. `_ga_*`). */
  wildcard: boolean
}

export interface ServiceDefinition {
  /** Unique stable identifier (slug). */
  id: string
  /** Human-readable name. */
  name: string
  /** Cookyay category this service belongs to. */
  category: ServiceCategory
  /** Cookie names / patterns. */
  cookies: CookiePattern[]
  /** localStorage key patterns. */
  localStorage: CookiePattern[]
  /** Request host substrings to match against `RequestRecord.host`. */
  requestHosts: string[]
  /** Source: 'ocd' = Open Cookie Database, 'curated' = hand-curated supplement. */
  source: 'ocd' | 'curated'
}

// ---------------------------------------------------------------------------
// Curated top-20 supplement — adds request hosts and localStorage
// ---------------------------------------------------------------------------
function curated(def: Omit<ServiceDefinition, 'source'>): ServiceDefinition {
  return { ...def, source: 'curated' }
}

// ---------------------------------------------------------------------------
// The combined database
// Order matters: entries listed earlier win on tie when two definitions match
// the same cookie (we prefer 'curated' entries which tend to be more specific).
// ---------------------------------------------------------------------------
export const SERVICE_DB: ServiceDefinition[] = [
  // -------------------------------------------------------------------------
  // CURATED top-20 (with request-host matching)
  // -------------------------------------------------------------------------
  curated({
    id: 'ga4',
    name: 'Google Analytics 4',
    category: 'analytics',
    cookies: [
      { name: '_ga', wildcard: false },
      { name: '_ga_', wildcard: true },
      { name: '_gali', wildcard: false },
    ],
    localStorage: [],
    requestHosts: [
      'google-analytics.com',
      'analytics.google.com',
      'googletagmanager.com',
    ],
  }),
  curated({
    id: 'ua',
    name: 'Google Universal Analytics (GA3)',
    category: 'analytics',
    cookies: [
      { name: '_ga', wildcard: false },
      { name: '_gid', wildcard: false },
      { name: '_gat', wildcard: true },
      { name: '_dc_gtm_', wildcard: true },
      { name: '__utma', wildcard: false },
      { name: '__utmb', wildcard: false },
      { name: '__utmc', wildcard: false },
      { name: '__utmt', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['google-analytics.com'],
  }),
  curated({
    id: 'gtm',
    name: 'Google Tag Manager',
    category: 'analytics',
    cookies: [{ name: '_ga', wildcard: false }],
    localStorage: [],
    requestHosts: ['googletagmanager.com'],
  }),
  curated({
    id: 'meta-pixel',
    name: 'Meta (Facebook) Pixel',
    category: 'marketing',
    cookies: [
      { name: '_fbp', wildcard: false },
      { name: '_fbc', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['connect.facebook.net', 'facebook.com'],
  }),
  curated({
    id: 'youtube',
    name: 'YouTube',
    category: 'marketing',
    cookies: [
      { name: 'VISITOR_INFO1_LIVE', wildcard: false },
      { name: 'YSC', wildcard: false },
      { name: 'PREF', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['youtube.com', 'youtube-nocookie.com', 'ytimg.com'],
  }),
  curated({
    id: 'linkedin-insight',
    name: 'LinkedIn Insight Tag',
    category: 'marketing',
    cookies: [
      { name: 'lidc', wildcard: false },
      { name: 'lissc', wildcard: false },
      { name: 'li_gc', wildcard: false },
      { name: 'AnalyticsSyncHistory', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['linkedin.com', 'snap.licdn.com'],
  }),
  curated({
    id: 'hotjar',
    name: 'Hotjar',
    category: 'analytics',
    cookies: [
      { name: '_hjid', wildcard: false },
      { name: '_hjFirstSeen', wildcard: false },
      { name: '_hjIncludedInPageviewSample', wildcard: false },
      { name: '_hjSession', wildcard: true },
    ],
    localStorage: [{ name: '_hjSessionId', wildcard: false }],
    requestHosts: ['static.hotjar.com', 'hotjar.com'],
  }),
  curated({
    id: 'intercom',
    name: 'Intercom',
    category: 'functional',
    cookies: [
      { name: 'intercom-id-', wildcard: true },
      { name: 'intercom-session-', wildcard: true },
      { name: 'intercom-device-id-', wildcard: true },
    ],
    localStorage: [],
    requestHosts: ['widget.intercom.io', 'intercom.io'],
  }),
  curated({
    id: 'hubspot',
    name: 'HubSpot Analytics',
    category: 'analytics',
    cookies: [
      { name: 'hubspotutk', wildcard: false },
      { name: '__hstc', wildcard: false },
      { name: '__hssc', wildcard: false },
      { name: '__hssrc', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['hs-analytics.net', 'hubspot.com', 'hs-scripts.com'],
  }),
  curated({
    id: 'zendesk',
    name: 'Zendesk Chat',
    category: 'functional',
    cookies: [
      { name: '__zlcmid', wildcard: false },
      { name: 'ZD-buid', wildcard: false },
      { name: 'ZD-suid', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['static.zdassets.com', 'zopim.com'],
  }),
  curated({
    id: 'crisp',
    name: 'Crisp Chat',
    category: 'functional',
    cookies: [{ name: 'crisp-client/session/', wildcard: true }],
    localStorage: [{ name: 'crisp-client/session/', wildcard: true }],
    requestHosts: ['client.crisp.chat', 'crisp.chat'],
  }),
  curated({
    id: 'drift',
    name: 'Drift',
    category: 'functional',
    cookies: [{ name: 'driftt_aid', wildcard: false }],
    localStorage: [],
    requestHosts: ['js.driftt.com', 'drift.com'],
  }),
  curated({
    id: 'segment',
    name: 'Segment',
    category: 'analytics',
    cookies: [{ name: 'ajs_', wildcard: true }],
    localStorage: [
      { name: 'ajs_user_id', wildcard: false },
      { name: 'ajs_anonymous_id', wildcard: false },
    ],
    requestHosts: ['cdn.segment.com', 'segment.io'],
  }),
  curated({
    id: 'amplitude',
    name: 'Amplitude',
    category: 'analytics',
    cookies: [{ name: 'amplitude_id_', wildcard: true }],
    localStorage: [
      { name: 'amplitude_id_', wildcard: true },
      { name: 'amplitude_unsent_', wildcard: true },
    ],
    requestHosts: ['cdn.amplitude.com', 'api.amplitude.com'],
  }),
  curated({
    id: 'mixpanel',
    name: 'Mixpanel',
    category: 'analytics',
    cookies: [{ name: 'mp_', wildcard: true }],
    localStorage: [],
    requestHosts: ['cdn.mxpnl.com', 'api.mixpanel.com'],
  }),
  curated({
    id: 'twitter-pixel',
    name: 'X (Twitter) Pixel',
    category: 'marketing',
    cookies: [
      { name: 'muc_ads', wildcard: false },
      { name: '_twitter_sess', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['static.ads-twitter.com', 'analytics.twitter.com', 't.co'],
  }),
  curated({
    id: 'clarity',
    name: 'Microsoft Clarity',
    category: 'analytics',
    cookies: [
      { name: '_clck', wildcard: false },
      { name: '_clsk', wildcard: false },
      { name: 'CLID', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['clarity.ms'],
  }),
  curated({
    id: 'cloudflare-insights',
    name: 'Cloudflare Web Analytics',
    category: 'analytics',
    cookies: [{ name: '_cflb', wildcard: false }],
    localStorage: [],
    requestHosts: ['static.cloudflareinsights.com', 'cloudflareinsights.com'],
  }),
  curated({
    id: 'vimeo',
    name: 'Vimeo',
    category: 'marketing',
    cookies: [
      { name: 'player', wildcard: false },
      { name: 'vuid', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['player.vimeo.com', 'vimeocdn.com'],
  }),
  curated({
    id: 'tiktok-pixel',
    name: 'TikTok Pixel',
    category: 'marketing',
    cookies: [
      { name: '_tt_enable_cookie', wildcard: false },
      { name: '_ttp', wildcard: false },
    ],
    localStorage: [],
    requestHosts: ['analytics.tiktok.com', 'tiktok.com'],
  }),

  // -------------------------------------------------------------------------
  // Open Cookie Database entries — generated by scripts/ingest-ocd.mjs
  // (Apache-2.0; see db-ocd.generated.ts for full attribution and entry count)
  // Curated entries above take precedence: findServiceByCookie() returns the
  // first match, and curated entries are listed first.
  // -------------------------------------------------------------------------
  ...OCD_SERVICES,
]

// ---------------------------------------------------------------------------
// Lookup helpers used by the classifier
// ---------------------------------------------------------------------------

/** Returns true if `cookieName` matches the given pattern (exact or prefix wildcard). */
export function matchesCookiePattern(pattern: CookiePattern, cookieName: string): boolean {
  if (pattern.wildcard) {
    return cookieName.startsWith(pattern.name)
  }
  return cookieName === pattern.name
}

/**
 * Find the best matching service for a given cookie name.
 * Returns { service, confidence } or null if not matched.
 *
 * Confidence:
 *   high   — curated entry with exact name match
 *   high   — curated entry with wildcard match
 *   medium — OCD entry with any match
 */
export function findServiceByCookie(
  cookieName: string,
): { service: ServiceDefinition; confidence: Confidence } | null {
  // Prefer curated entries over OCD entries; within same source prefer exact over wildcard
  let bestMatch: { service: ServiceDefinition; confidence: Confidence } | null = null

  for (const service of SERVICE_DB) {
    for (const pattern of service.cookies) {
      if (matchesCookiePattern(pattern, cookieName)) {
        const conf: Confidence = service.source === 'curated' ? 'high' : 'medium'
        // Accept first match; since curated entries are listed before OCD, first is best
        if (bestMatch === null) {
          bestMatch = { service, confidence: conf }
        }
        break
      }
    }
    if (bestMatch !== null) break
  }

  return bestMatch
}

/**
 * Find the best matching service for a request host.
 * Returns { service, confidence: 'medium' } or null.
 *
 * Matching rules (strictest first to avoid false positives):
 *   1. Exact match: host === h
 *   2. Subdomain match: host ends with ".<h>"
 *
 * The `includes()` check is intentionally NOT used — it produces false positives
 * (e.g. 't.co' in requestHosts would match 'react.com', 'giant.com', etc.).
 */
export function findServiceByHost(
  host: string,
): { service: ServiceDefinition; confidence: Confidence } | null {
  for (const service of SERVICE_DB) {
    for (const h of service.requestHosts) {
      if (host === h || host.endsWith(`.${h}`)) {
        return { service, confidence: 'medium' }
      }
    }
  }
  return null
}

/**
 * Find the best matching service for a localStorage key.
 */
export function findServiceByLocalStorage(
  key: string,
): { service: ServiceDefinition; confidence: Confidence } | null {
  for (const service of SERVICE_DB) {
    for (const pattern of service.localStorage) {
      if (matchesCookiePattern(pattern, key)) {
        return { service, confidence: service.source === 'curated' ? 'high' : 'medium' }
      }
    }
  }
  return null
}
