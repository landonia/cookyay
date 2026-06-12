/**
 * Unit tests for matchAutoBlock(url) — v5 client auto-block matcher.
 *
 * Coverage (mirroring db.test.ts's table-driven pattern per AC5):
 *   1. Host match — a URL on a recognised service host returns that service.
 *   2. Path match — a URL matching a requestPaths "host/path" entry returns
 *      the correct service (e.g. Meta Pixel via facebook.com/tr).
 *   3. No match — an unknown host returns null.
 *   4. Google-skip — Google-owned services (GA4, GTM, reCAPTCHA) return null
 *      even for exact host/URL matches [AC3].
 *   5. CDN disambiguation — a service whose requestHosts entry is a shared CDN
 *      is NOT matched on host alone; it requires a scriptUrlGlob hit too [AC4].
 *   6. Relative URLs — always return null (first-party, not blockable).
 *   7. Subdomain matching — a subdomain of a recognised host matches.
 *   8. Subdomain NOT a false-positive — an unrelated domain with the service
 *      name as a substring does NOT match.
 *
 * Runs in jsdom / Node — zero browser dependencies required.
 *
 * [AC5: Vitest unit test, jsdom/node, no browser]
 * [research/_index.md §Update — Author decisions]
 * [research/performance-engineer.md §Findings 7]
 */

import { describe, it, expect } from 'vitest'
import type { AutoBlockEntry } from './db-autoblock.types.js'
import { matchAutoBlock, _createMatcher, _matchGlob, _buildIndex } from './autoblock-matcher.js'

// ---------------------------------------------------------------------------
// 1. Host match — representative services from the live DB
// ---------------------------------------------------------------------------

describe('matchAutoBlock — host match (live DB)', () => {
  it('matches Hotjar on its primary host', () => {
    const result = matchAutoBlock('https://static.hotjar.com/c/hotjar-123.js')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('hotjar')
    expect(result!.category).toBe('analytics')
  })

  it('matches Meta Pixel script host (connect.facebook.net)', () => {
    const result = matchAutoBlock('https://connect.facebook.net/en_US/fbevents.js')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('meta-pixel')
    expect(result!.category).toBe('marketing')
  })

  it('matches Intercom on its script host', () => {
    const result = matchAutoBlock('https://widget.intercom.io/widget/abc123')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('intercom')
    expect(result!.category).toBe('functional')
  })

  it('matches Segment CDN host', () => {
    const result = matchAutoBlock('https://cdn.segment.com/analytics.js/v1/key/analytics.min.js')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('segment')
    expect(result!.category).toBe('analytics')
  })

  it('matches Stripe JS host', () => {
    const result = matchAutoBlock('https://js.stripe.com/v3/')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('stripe')
    expect(result!.category).toBe('functional')
  })

  it('matches Plausible analytics host', () => {
    const result = matchAutoBlock('https://plausible.io/js/script.js')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('plausible')
    expect(result!.category).toBe('analytics')
  })

  it('matches Twitter/X Pixel host', () => {
    const result = matchAutoBlock('https://static.ads-twitter.com/uwt.js')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('twitter-pixel')
    expect(result!.category).toBe('marketing')
  })
})

// ---------------------------------------------------------------------------
// 2. Subdomain matching — service host is a parent domain
// ---------------------------------------------------------------------------

describe('matchAutoBlock — subdomain matching', () => {
  it('matches a subdomain of a recognised service host', () => {
    // hotjar.com is in requestHosts; foo.hotjar.com is a subdomain → should match
    const result = matchAutoBlock('https://foo.hotjar.com/script.js')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('hotjar')
  })

  it('does NOT match an unrelated domain that contains the service name', () => {
    // "nothotjar.com" contains "hotjar" as a substring but is not a subdomain
    const result = matchAutoBlock('https://nothotjar.com/script.js')
    expect(result).toBeNull()
  })

  it('does NOT match a domain where service host is a suffix but not a dot-boundary', () => {
    // "featurehotjar.com" ends with "hotjar.com" but is NOT a subdomain (no dot boundary)
    const result = matchAutoBlock('https://featurehotjar.com/script.js')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. Path match — requestPaths "host/path" entries
// ---------------------------------------------------------------------------

describe('matchAutoBlock — path match (requestPaths)', () => {
  it('matches Meta Pixel via requestPaths (facebook.com/tr)', () => {
    // facebook.com is NOT in requestHosts for meta-pixel — only connect.facebook.net is.
    // But "facebook.com/tr" is in requestPaths.
    const result = matchAutoBlock('https://www.facebook.com/tr?id=123&ev=PageView')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('meta-pixel')
    expect(result!.category).toBe('marketing')
  })

  it('does NOT match facebook.com on an unrelated path (requestPaths path-prefix guard)', () => {
    // "facebook.com/login" is NOT a path-prefix match for "facebook.com/tr"
    const result = matchAutoBlock('https://www.facebook.com/login')
    expect(result).toBeNull()
  })

  it('does NOT match a requestPaths host+path pattern on an unrelated host', () => {
    // "notfacebook.com/tr" — same path but different host → must not match meta-pixel
    const result = matchAutoBlock('https://notfacebook.com/tr?id=123')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. No match — unknown host
// ---------------------------------------------------------------------------

describe('matchAutoBlock — no match', () => {
  it('returns null for a completely unknown host', () => {
    expect(matchAutoBlock('https://totally-unknown-third-party.example.com/script.js')).toBeNull()
  })

  it('returns null for a first-party domain', () => {
    expect(matchAutoBlock('https://mysite.com/bundle.js')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(matchAutoBlock('')).toBeNull()
  })

  it('returns null for a malformed URL', () => {
    expect(matchAutoBlock('not-a-url')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. Relative URLs — always null (first-party)
// ---------------------------------------------------------------------------

describe('matchAutoBlock — relative URLs', () => {
  it('returns null for a relative URL (no scheme)', () => {
    expect(matchAutoBlock('/js/analytics.js')).toBeNull()
  })

  it('returns null for a protocol-relative URL', () => {
    // "//static.hotjar.com/..." — missing scheme, treated as first-party
    expect(matchAutoBlock('//static.hotjar.com/c/hotjar.js')).toBeNull()
  })

  it('returns null for a data: URI', () => {
    expect(matchAutoBlock('data:text/javascript,console.log(1)')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. Google-skip — Google-owned services return null [AC3]
// ---------------------------------------------------------------------------

describe('matchAutoBlock — Google-owned services skipped [AC3]', () => {
  it('returns null for GTM (googletagmanager.com)', () => {
    const result = matchAutoBlock('https://www.googletagmanager.com/gtm.js?id=GTM-XXXX')
    expect(result).toBeNull()
  })

  it('returns null for GA4 (google-analytics.com)', () => {
    const result = matchAutoBlock('https://www.google-analytics.com/analytics.js')
    expect(result).toBeNull()
  })

  it('returns null for UA (analytics.google.com)', () => {
    const result = matchAutoBlock('https://analytics.google.com/g/collect')
    expect(result).toBeNull()
  })

  it('returns null for reCAPTCHA path (www.google.com/recaptcha/)', () => {
    const result = matchAutoBlock('https://www.google.com/recaptcha/api.js')
    expect(result).toBeNull()
  })

  it('returns null for Google Optimize (optimize.google.com)', () => {
    const result = matchAutoBlock('https://optimize.google.com/optimize.js')
    expect(result).toBeNull()
  })

  it('returns null for Google Ads (googleadservices.com)', () => {
    const result = matchAutoBlock('https://www.googleadservices.com/pagead/conversion_async.js')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 7. CDN disambiguation — shared-CDN hosts require scriptUrlGlob match [AC4]
//
// No production service currently sits on a shared CDN (task 001 verified
// this). We test the logic with a synthetic DB via _createMatcher().
// ---------------------------------------------------------------------------

describe('matchAutoBlock — CDN disambiguation via scriptUrlGlobs [AC4]', () => {
  // Synthetic service: "my-tracker" sits on cdn.jsdelivr.net (a shared CDN).
  // It carries a scriptUrlGlob to disambiguate.
  const cdnService: AutoBlockEntry = {
    id: 'my-tracker',
    category: 'analytics',
    requestHosts: ['cdn.jsdelivr.net'],
    scriptUrlGlobs: ['https://cdn.jsdelivr.net/npm/my-tracker*/dist/tracker.js*'],
  }

  // An unrelated legitimate package also served from cdn.jsdelivr.net
  const match = _createMatcher([cdnService])

  it('true-positive: URL matching the scriptUrlGlob is blocked', () => {
    const url = 'https://cdn.jsdelivr.net/npm/my-tracker@1.0.0/dist/tracker.js'
    const result = match(url)
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('my-tracker')
    expect(result!.category).toBe('analytics')
  })

  it('CDN false-positive: unrelated package on the same CDN host is NOT blocked', () => {
    // Same host (cdn.jsdelivr.net) but a completely different package path
    const url = 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js'
    const result = match(url)
    expect(result).toBeNull()
  })

  it('CDN false-positive: a package on same host but different path segment is not blocked', () => {
    // A package at a completely different top-level path on the same CDN host
    // does NOT match the tracker's scriptUrlGlob.
    const url = 'https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.production.min.js'
    const result = match(url)
    expect(result).toBeNull()
  })

  it('CDN false-positive: lodash (completely different) is not blocked', () => {
    const url = 'https://cdn.jsdelivr.net/npm/lodash/lodash.min.js'
    const result = match(url)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 8. Table-driven matching — representative service URLs [AC5]
//
// Mirrors db.test.ts's CURATED_SIGNAL_TABLE pattern. Each row covers at
// least one of: host match, subdomain match, or path match.
// Google-owned rows are deliberately absent (tested in §6 above).
// ---------------------------------------------------------------------------

interface MatchRow {
  serviceId: string
  category: 'analytics' | 'marketing' | 'functional' | 'necessary'
  url: string
  description: string
}

const MATCH_TABLE: MatchRow[] = [
  // Analytics
  {
    serviceId: 'hotjar',
    category: 'analytics',
    url: 'https://static.hotjar.com/c/hotjar-123.js',
    description: 'Hotjar — static.hotjar.com host match',
  },
  {
    serviceId: 'clarity',
    category: 'analytics',
    url: 'https://www.clarity.ms/tag/xyz',
    description: 'Clarity — subdomain of clarity.ms',
  },
  {
    serviceId: 'mixpanel',
    category: 'analytics',
    url: 'https://cdn.mxpnl.com/libs/mixpanel.min.js',
    description: 'Mixpanel — cdn.mxpnl.com host match',
  },
  {
    serviceId: 'amplitude',
    category: 'analytics',
    url: 'https://cdn.amplitude.com/libs/amplitude-min.js',
    description: 'Amplitude — cdn.amplitude.com host match',
  },
  {
    serviceId: 'segment',
    category: 'analytics',
    url: 'https://cdn.segment.com/analytics.js/v1/writeKey/analytics.min.js',
    description: 'Segment — cdn.segment.com host match',
  },
  {
    serviceId: 'hubspot',
    category: 'analytics',
    url: 'https://js.hs-scripts.com/12345.js',
    description: 'HubSpot — subdomain of hs-scripts.com',
  },
  {
    serviceId: 'plausible',
    category: 'analytics',
    url: 'https://plausible.io/js/script.outbound-links.js',
    description: 'Plausible — plausible.io host match',
  },
  {
    serviceId: 'fullstory',
    category: 'analytics',
    url: 'https://edge.fullstory.com/s/fs.js',
    description: 'FullStory — edge.fullstory.com host match',
  },
  {
    serviceId: 'posthog',
    category: 'analytics',
    url: 'https://app.posthog.com/static/array.js',
    description: 'PostHog — app.posthog.com host match',
  },
  // Marketing
  {
    serviceId: 'meta-pixel',
    category: 'marketing',
    url: 'https://connect.facebook.net/en_US/fbevents.js',
    description: 'Meta Pixel — connect.facebook.net host match',
  },
  {
    serviceId: 'meta-pixel',
    category: 'marketing',
    url: 'https://www.facebook.com/tr?id=123456&ev=PageView',
    description: 'Meta Pixel — facebook.com/tr path match',
  },
  {
    serviceId: 'youtube',
    category: 'marketing',
    url: 'https://www.youtube.com/iframe_api',
    description: 'YouTube — subdomain of youtube.com',
  },
  {
    serviceId: 'linkedin-insight',
    category: 'marketing',
    url: 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
    description: 'LinkedIn Insight — snap.licdn.com host match',
  },
  {
    serviceId: 'twitter-pixel',
    category: 'marketing',
    url: 'https://static.ads-twitter.com/uwt.js',
    description: 'Twitter/X Pixel — static.ads-twitter.com host match',
  },
  {
    serviceId: 'tiktok-pixel',
    category: 'marketing',
    url: 'https://analytics.tiktok.com/i18n/pixel/events.js',
    description: 'TikTok Pixel — analytics.tiktok.com host match',
  },
  {
    serviceId: 'klaviyo',
    category: 'marketing',
    url: 'https://static.klaviyo.com/onsite/js/klaviyo.js',
    description: 'Klaviyo — static.klaviyo.com host match',
  },
  {
    serviceId: 'pinterest-tag',
    category: 'marketing',
    url: 'https://s.pinimg.com/ct/core.js',
    description: 'Pinterest Tag — s.pinimg.com host match',
  },
  // Functional
  {
    serviceId: 'intercom',
    category: 'functional',
    url: 'https://widget.intercom.io/widget/appid123',
    description: 'Intercom — widget.intercom.io host match',
  },
  {
    serviceId: 'zendesk',
    category: 'functional',
    url: 'https://static.zdassets.com/ekr/snippet.js',
    description: 'Zendesk — static.zdassets.com host match',
  },
  {
    serviceId: 'stripe',
    category: 'functional',
    url: 'https://js.stripe.com/v3/',
    description: 'Stripe — js.stripe.com host match',
  },
  {
    serviceId: 'crisp',
    category: 'functional',
    url: 'https://client.crisp.chat/l.js',
    description: 'Crisp — client.crisp.chat host match',
  },
  {
    serviceId: 'sentry',
    category: 'functional',
    url: 'https://browser.sentry-cdn.com/7.0.0/bundle.tracing.js',
    description: 'Sentry — browser.sentry-cdn.com (subdomain of sentry.io → check)',
  },
]

describe('matchAutoBlock — table-driven URL matches [AC5]', () => {
  it.each(MATCH_TABLE)('$description', ({ serviceId, category, url }) => {
    // Note: sentry-cdn.com is NOT a subdomain of sentry.io; only sentry.io is in
    // requestHosts. We handle this with a special case check below.
    if (serviceId === 'sentry' && url.includes('sentry-cdn.com')) {
      // sentry-cdn.com is not in services.yaml requestHosts — this URL is a
      // third-party CDN for the Sentry browser SDK, not sentry.io itself.
      // The matcher correctly returns null here; the test documents that the
      // SDK CDN is not auto-blocked (only sentry.io data ingestion host is).
      const result = matchAutoBlock(url)
      // sentry-cdn.com is separate from sentry.io; expect null
      expect(result).toBeNull()
      return
    }

    const result = matchAutoBlock(url)
    expect(result, `expected match for "${url}" → ${serviceId}`).not.toBeNull()
    expect(result!.serviceId).toBe(serviceId)
    expect(result!.category).toBe(category)
  })
})

// ---------------------------------------------------------------------------
// 9. _matchGlob — unit tests for the glob helper
// ---------------------------------------------------------------------------

describe('_matchGlob — glob pattern matching', () => {
  it('exact match when no wildcard', () => {
    expect(_matchGlob('hello', 'hello')).toBe(true)
    expect(_matchGlob('hello', 'world')).toBe(false)
  })

  it('* matches any substring', () => {
    expect(_matchGlob('*.js', 'script.js')).toBe(true)
    expect(_matchGlob('*.js', 'script.min.js')).toBe(true)
    expect(_matchGlob('*.js', 'script.css')).toBe(false)
  })

  it('* at both ends matches a substring', () => {
    expect(_matchGlob('*hotjar*', 'https://static.hotjar.com/c/hotjar.js')).toBe(true)
    expect(_matchGlob('*hotjar*', 'https://example.com/unrelated.js')).toBe(false)
  })

  it('pattern with domain and path prefix', () => {
    expect(
      _matchGlob(
        'https://cdn.jsdelivr.net/npm/my-tracker*/dist/tracker.js*',
        'https://cdn.jsdelivr.net/npm/my-tracker@1.0.0/dist/tracker.js',
      ),
    ).toBe(true)

    expect(
      _matchGlob(
        'https://cdn.jsdelivr.net/npm/my-tracker*/dist/tracker.js*',
        'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
      ),
    ).toBe(false)
  })

  it('empty pattern matches empty string only', () => {
    expect(_matchGlob('', '')).toBe(true)
    expect(_matchGlob('', 'x')).toBe(false)
  })

  it('* alone matches everything', () => {
    expect(_matchGlob('*', 'anything')).toBe(true)
    expect(_matchGlob('*', '')).toBe(true)
  })

  it('prefix+suffix pattern (no middle wildcard)', () => {
    expect(_matchGlob('foo*bar', 'fooXYZbar')).toBe(true)
    expect(_matchGlob('foo*bar', 'foobar')).toBe(true)
    expect(_matchGlob('foo*bar', 'foobaz')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 10. _buildIndex — Google filtering and index structure
// ---------------------------------------------------------------------------

describe('_buildIndex — index construction', () => {
  it('excludes Google-owned entries from the host index', () => {
    const services: AutoBlockEntry[] = [
      { id: 'ga4', category: 'analytics', google: true, requestHosts: ['google-analytics.com'] },
      { id: 'non-google', category: 'analytics', requestHosts: ['example-analytics.com'] },
    ]
    const index = _buildIndex(services)
    expect(index.hostIndex.has('google-analytics.com')).toBe(false)
    expect(index.hostIndex.has('example-analytics.com')).toBe(true)
  })

  it('excludes Google-owned entries from the path entries list', () => {
    const services: AutoBlockEntry[] = [
      {
        id: 'recaptcha',
        category: 'functional',
        google: true,
        requestHosts: [],
        requestPaths: ['www.google.com/recaptcha/'],
      },
      {
        id: 'non-google-path',
        category: 'marketing',
        requestHosts: [],
        requestPaths: ['www.example.com/pixel/'],
      },
    ]
    const index = _buildIndex(services)
    expect(index.pathEntries.some((pe) => pe.host === 'www.google.com')).toBe(false)
    expect(index.pathEntries.some((pe) => pe.host === 'www.example.com')).toBe(true)
  })

  it('marks a service with non-empty scriptUrlGlobs as requiresGlobMatch=true', () => {
    const services: AutoBlockEntry[] = [
      {
        id: 'cdn-service',
        category: 'analytics',
        requestHosts: ['cdn.jsdelivr.net'],
        scriptUrlGlobs: ['https://cdn.jsdelivr.net/npm/cdn-service*'],
      },
    ]
    const index = _buildIndex(services)
    const entries = index.hostIndex.get('cdn.jsdelivr.net')
    expect(entries).toBeDefined()
    expect(entries![0].requiresGlobMatch).toBe(true)
  })

  it('marks a service with empty scriptUrlGlobs as requiresGlobMatch=false', () => {
    const services: AutoBlockEntry[] = [
      {
        id: 'normal-service',
        category: 'analytics',
        requestHosts: ['normal.example.com'],
        scriptUrlGlobs: [],
      },
    ]
    const index = _buildIndex(services)
    const entries = index.hostIndex.get('normal.example.com')
    expect(entries).toBeDefined()
    expect(entries![0].requiresGlobMatch).toBe(false)
  })
})
