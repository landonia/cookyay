/**
 * Unit tests for the classification engine and config emitter.
 *
 * These run in Node (Vitest) without Playwright or a fixture server.
 * Coverage:
 * - Cookie classification (exact, wildcard, OCD, curated)
 * - Request-host classification
 * - localStorage classification
 * - Unclassified bucket population
 * - noscript warning detection
 * - Config emitter: categories, confidence, _unclassified, _noscriptWarnings
 */
import { describe, it, expect } from 'vitest'
import { classify } from './classifier.js'
import { emitConfig } from './config-emitter.js'
import { findServiceByCookie, findServiceByHost, findServiceByLocalStorage } from './db.js'
import type { RawFindings } from './types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFindings(overrides: Partial<RawFindings> = {}): RawFindings {
  return {
    scannedAt: '2000-01-01T00:00:00.000Z',
    targetUrl: 'http://localhost:4001/test',
    pagesVisited: ['http://localhost:4001/test'],
    pages: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// db.ts — findServiceByCookie
// ---------------------------------------------------------------------------

describe('findServiceByCookie', () => {
  it('finds GA4 _ga cookie with high confidence (curated)', () => {
    const result = findServiceByCookie('_ga')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('ga4')
    expect(result!.confidence).toBe('high')
  })

  it('finds GA4 _ga_TESTID wildcard cookie', () => {
    const result = findServiceByCookie('_ga_TESTID123')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('ga4')
  })

  it('finds Meta Pixel _fbp cookie with high confidence', () => {
    const result = findServiceByCookie('_fbp')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('meta-pixel')
    expect(result!.confidence).toBe('high')
  })

  it('finds Hotjar _hjid cookie', () => {
    const result = findServiceByCookie('_hjid')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('hotjar')
  })

  it('returns null for an unknown cookie', () => {
    const result = findServiceByCookie('__totally_unknown_xyz_abc')
    expect(result).toBeNull()
  })

  it('finds Intercom wildcard cookie intercom-id-abc123', () => {
    const result = findServiceByCookie('intercom-id-abc123')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('intercom')
  })

  it('finds Cloudflare __cf_bm (OCD entry) with medium confidence', () => {
    const result = findServiceByCookie('__cf_bm')
    expect(result).not.toBeNull()
    // OCD classifies Cloudflare cookies as "Functional" (bot-management,
    // not strictly necessary in the consent-law sense — mapped as functional)
    expect(result!.service.category).toBe('functional')
    expect(result!.confidence).toBe('medium')
  })
})

// ---------------------------------------------------------------------------
// db.ts — findServiceByHost
// ---------------------------------------------------------------------------

describe('findServiceByHost', () => {
  it('matches google-analytics.com as ga4', () => {
    const result = findServiceByHost('www.google-analytics.com')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('ga4')
    expect(result!.confidence).toBe('medium')
  })

  it('matches connect.facebook.net as meta-pixel', () => {
    const result = findServiceByHost('connect.facebook.net')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('meta-pixel')
  })

  it('matches youtube.com as youtube', () => {
    const result = findServiceByHost('www.youtube.com')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('youtube')
  })

  it('returns null for localhost', () => {
    const result = findServiceByHost('localhost')
    expect(result).toBeNull()
  })

  it('returns null for unknown host', () => {
    const result = findServiceByHost('my-totally-unknown-saas.io')
    expect(result).toBeNull()
  })

  // Regression tests for the previous substring-match false-positive bug.
  // With t.co in requestHosts, hosts like 'giant.com', 'react.com', 'audit.com'
  // must NOT be classified as X (Twitter) Pixel.
  it('does NOT match giant.com as twitter-pixel (false-positive regression)', () => {
    const result = findServiceByHost('giant.com')
    expect(result).toBeNull()
  })

  it('does NOT match audit.com as twitter-pixel (false-positive regression)', () => {
    const result = findServiceByHost('audit.com')
    expect(result).toBeNull()
  })

  it('does NOT match react.com as twitter-pixel (false-positive regression)', () => {
    const result = findServiceByHost('react.com')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// db.ts — findServiceByLocalStorage
// ---------------------------------------------------------------------------

describe('findServiceByLocalStorage', () => {
  it('matches Hotjar _hjSessionId', () => {
    const result = findServiceByLocalStorage('_hjSessionId')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('hotjar')
  })

  it('matches Segment ajs_user_id', () => {
    const result = findServiceByLocalStorage('ajs_user_id')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('segment')
  })

  it('returns null for unknown key', () => {
    const result = findServiceByLocalStorage('my_custom_app_state')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// classify() — cookies
// ---------------------------------------------------------------------------

describe('classify() — cookie classification', () => {
  it('classifies a known cookie (_ga) and populates cookies array', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [
            {
              name: '_ga',
              domain: 'localhost',
              path: '/',
              expires: 9999999999,
              secure: false,
              sameSite: 'Lax',
              firstParty: true,
            },
          ],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.cookies).toHaveLength(1)
    expect(classified.cookies[0].name).toBe('_ga')
    expect(classified.cookies[0].service.id).toBe('ga4')
    expect(classified.cookies[0].confidence).toBe('high')
    expect(classified.unclassified.some((u) => u.name === '_ga')).toBe(false)
  })

  it('places unknown cookies in the unclassified bucket', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [
            {
              name: '__mystery_cookie',
              domain: 'example.com',
              path: '/',
              expires: null,
              secure: false,
              sameSite: 'Lax',
              firstParty: false,
            },
          ],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.unclassified.some((u) => u.name === '__mystery_cookie' && u.kind === 'cookie')).toBe(true)
  })

  it('does not place consent cookie in unclassified', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [
            {
              name: 'cookyay_consent',
              domain: 'localhost',
              path: '/',
              expires: 9999999999,
              secure: false,
              sameSite: 'Lax',
              firstParty: true,
            },
          ],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.cookies).toHaveLength(0)
    expect(classified.unclassified).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// classify() — requests
// ---------------------------------------------------------------------------

describe('classify() — third-party request classification', () => {
  it('classifies third-party google-analytics.com requests', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [
            {
              url: 'https://www.google-analytics.com/g/collect',
              host: 'www.google-analytics.com',
              resourceType: 'xhr',
              firstParty: false,
            },
          ],
          scripts: [],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.requests).toHaveLength(1)
    expect(classified.requests[0].service.id).toBe('ga4')
  })

  it('skips first-party requests', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [
            {
              url: 'http://localhost:4001/api/data',
              host: 'localhost',
              resourceType: 'fetch',
              firstParty: true,
            },
          ],
          scripts: [],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.requests).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// classify() — scripts with data-category
// ---------------------------------------------------------------------------

describe('classify() — script classification', () => {
  it('classifies a blocked script with data-category="analytics" via declared category', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [
            {
              src: '/local/stubs/ga4.js',
              blocked: true,
              category: 'analytics',
            },
          ],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.scripts).toHaveLength(1)
    expect(classified.scripts[0].declaredCategory).toBe('analytics')
    // Not in unclassified (has a declared category)
    expect(classified.unclassified.some((u) => u.name === '/local/stubs/ga4.js')).toBe(false)
  })

  it('classifies an external script by host match', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [
            {
              src: 'https://www.googletagmanager.com/gtag/js?id=G-123',
              blocked: false,
              category: null,
            },
          ],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.scripts).toHaveLength(1)
    expect(classified.scripts[0].service?.id).toBe('ga4')
    // Classified by host — not in unclassified
    expect(classified.unclassified.some((u) => u.name.includes('googletagmanager'))).toBe(false)
  })

  it('places unknown relative-URL scripts in unclassified', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [
            {
              src: '/js/my-custom-lib.js',
              blocked: false,
              category: null,
            },
          ],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.unclassified.some((u) => u.name === '/js/my-custom-lib.js' && u.kind === 'script')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// classify() — iframes
// ---------------------------------------------------------------------------

describe('classify() — iframe classification', () => {
  it('classifies a blocked YouTube iframe by data-category and dataSrc', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [
            {
              src: null,
              dataSrc: '/stubs/ytplayer.html',
              blocked: true,
              category: 'marketing',
            },
          ],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.iframes).toHaveLength(1)
    expect(classified.iframes[0].blocked).toBe(true)
    expect(classified.iframes[0].declaredCategory).toBe('marketing')
    // Has declared category — not in unclassified
    expect(classified.unclassified.some((u) => u.kind === 'iframe')).toBe(false)
  })

  it('classifies a real YouTube iframe by host', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [
            {
              src: 'https://www.youtube.com/embed/abc123',
              dataSrc: null,
              blocked: false,
              category: null,
            },
          ],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.iframes).toHaveLength(1)
    expect(classified.iframes[0].service?.id).toBe('youtube')
  })
})

// ---------------------------------------------------------------------------
// classify() — noscript warnings
// ---------------------------------------------------------------------------

describe('classify() — noscript warnings', () => {
  it('produces a warning for a noscript with a tracking pixel img', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [
            {
              text: '<img src="https://www.facebook.com/tr?id=123&ev=PageView&noscript=1" height="1" width="1" style="display:none"/>',
            },
          ],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.noscriptWarnings).toHaveLength(1)
    expect(classified.noscriptWarnings[0].text).toContain('facebook.com')
  })

  it('does NOT produce a warning for a benign noscript (e.g. "JavaScript required" message)', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [
            {
              text: 'JavaScript is required. Please enable JavaScript to use this site.',
            },
          ],
        },
      ],
    })

    const classified = classify(findings)
    expect(classified.noscriptWarnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// emitConfig() — config output shape
// ---------------------------------------------------------------------------

describe('emitConfig()', () => {
  it('groups classified services into the four categories', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [
            {
              name: '_ga',
              domain: 'example.com',
              path: '/',
              expires: 9999999999,
              secure: false,
              sameSite: 'Lax',
              firstParty: false,
            },
            {
              name: '_fbp',
              domain: '.facebook.com',
              path: '/',
              expires: 9999999999,
              secure: true,
              sameSite: 'None',
              firstParty: false,
            },
          ],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    const config = emitConfig(classified)

    expect(config.categories.analytics).toBeDefined()
    expect(config.categories.marketing).toBeDefined()
    expect(config.categories.analytics!.services.some((s) => s._meta.serviceId === 'ga4')).toBe(true)
    expect(config.categories.marketing!.services.some((s) => s._meta.serviceId === 'meta-pixel')).toBe(true)
  })

  it('confidence annotations appear on each service', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [
            {
              name: '_ga',
              domain: 'example.com',
              path: '/',
              expires: 9999999999,
              secure: false,
              sameSite: 'Lax',
              firstParty: false,
            },
          ],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    const config = emitConfig(classified)
    const ga4Service = config.categories.analytics?.services[0]
    expect(ga4Service).toBeDefined()
    expect(['high', 'medium', 'low']).toContain(ga4Service!._meta.confidence)
  })

  it('unknown artifacts go to _unclassified, never silently dropped', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [
            {
              name: '__weird_unknown_cookie',
              domain: 'weird-unknown.io',
              path: '/',
              expires: null,
              secure: false,
              sameSite: 'Lax',
              firstParty: false,
            },
          ],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    const config = emitConfig(classified)
    expect(config._unclassified.some((u) => u.name === '__weird_unknown_cookie')).toBe(true)
    expect(config._unclassified[0]._note).toBeTruthy()
  })

  it('noscript warnings appear in _noscriptWarnings with a warning message', () => {
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/test',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [],
          iframes: [],
          noscripts: [
            {
              text: '<noscript><img src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX" height="1" width="1" style="display:none"></noscript>',
            },
          ],
        },
      ],
    })

    const classified = classify(findings)
    const config = emitConfig(classified)
    expect(config._noscriptWarnings).toHaveLength(1)
    expect(config._noscriptWarnings[0]._warning).toContain('REMOVE')
  })

  it('_scanMeta contains classifierVersion', () => {
    const classified = classify(makeFindings({ pages: [] }))
    const config = emitConfig(classified)
    expect(config._scanMeta.classifierVersion).toBe('1.0.0')
    expect(config._scanMeta.targetUrl).toBe('http://localhost:4001/test')
  })
})

// ---------------------------------------------------------------------------
// Round-trip: classify + emit produces usable config categories
// ---------------------------------------------------------------------------

describe('classify + emitConfig round-trip', () => {
  it('fixture-like findings produce analytics + marketing categories', () => {
    // Simulate what all.html produces when scanned
    const findings = makeFindings({
      pages: [
        {
          url: 'http://localhost:4001/fixtures/blocking/all.html',
          cookies: [],
          storage: [],
          requests: [],
          scripts: [
            { src: '/fixtures/stubs/ga4.js', blocked: true, category: 'analytics' },
            { src: '/fixtures/stubs/pixel.js', blocked: true, category: 'marketing' },
          ],
          iframes: [
            { src: null, dataSrc: '/fixtures/stubs/ytplayer.html', blocked: true, category: 'marketing' },
          ],
          noscripts: [],
        },
      ],
    })

    const classified = classify(findings)
    const config = emitConfig(classified)

    // analytics category contains the ga4 stub
    expect(config.categories.analytics).toBeDefined()
    const analyticsServices = config.categories.analytics!.services
    expect(analyticsServices.some((s) => s.name.includes('ga4'))).toBe(true)

    // marketing category contains pixel + ytplayer
    expect(config.categories.marketing).toBeDefined()
    const marketingServices = config.categories.marketing!.services
    expect(marketingServices.some((s) => s.name.includes('pixel'))).toBe(true)
    expect(marketingServices.some((s) => s.name.includes('ytplayer'))).toBe(true)

    // The config is valid as a cookyay config (has policyVersion field)
    expect(config.policyVersion).toBe('REPLACE_ME')
  })
})
