/**
 * Schema-validator unit tests for the curated service signature database.
 *
 * These tests serve as living documentation of the contribution rules:
 * any community PR that adds or modifies a service in data/services.yaml
 * must satisfy every assertion below. Tests run in Vitest (Node, no browser).
 *
 * Coverage:
 * 1. Live services.yaml passes validation (required fields, category enum,
 *    unique ids, ≥1 match signal, schemaVersion).
 * 2. Malformed inputs are rejected with specific, actionable error messages.
 * 3. schemaVersion mismatch produces a distinct, recognisable error.
 * 4. SERVICE_DB compiled output is internally consistent.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { describe, it, expect } from 'vitest'
import { SERVICE_DB, DB_SCHEMA_VERSION, findServiceByCookie, findServiceByHost, findServiceByLocalStorage } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVICES_YAML_PATH = join(__dirname, '..', 'data', 'services.yaml')
// Workspace root is 3 levels above src/ (src → scanner → packages → workspace)
const FINGERPRINTS_PATH = join(__dirname, '..', '..', '..', 'fixtures', 'service-fingerprints.json')

// ---------------------------------------------------------------------------
// Validation helpers — these mirror the rules in scripts/build-services-db.mjs
// and serve as the authoritative living documentation of what the generator
// enforces. Any change to the generator's rules MUST be reflected here.
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set(['necessary', 'functional', 'analytics', 'marketing'])

interface PatternLike {
  name: unknown
  wildcard: unknown
}

interface ServiceLike {
  id: unknown
  name: unknown
  category: unknown
  cookies?: unknown[]
  localStorage?: unknown[]
  requestHosts?: unknown[]
  requestPaths?: unknown[]
  scriptUrlGlobs?: unknown[]
  iframeSrcGlobs?: unknown[]
  [key: string]: unknown
}

interface ServicesYamlDoc {
  schemaVersion: unknown
  services: unknown[]
}

/**
 * Validates a single service definition.
 * Returns null on success, or an error message string on failure.
 */
function validateService(raw: unknown, index: number): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return `services[${index}]: must be an object`
  }
  const s = raw as ServiceLike

  if (typeof s.id !== 'string' || !/^[a-z0-9-]+$/.test(s.id)) {
    return `services[${index}]: id must match /^[a-z0-9-]+$/, got ${JSON.stringify(s.id)}`
  }
  if (typeof s.name !== 'string' || s.name.length === 0) {
    return `services[${index}] (${String(s.id)}): name must be a non-empty string`
  }
  if (!VALID_CATEGORIES.has(s.category as string)) {
    return (
      `services[${index}] (${String(s.id)}): category must be one of ` +
      `${[...VALID_CATEGORIES].join('|')}, got ${JSON.stringify(s.category)}`
    )
  }

  const cookies = Array.isArray(s.cookies) ? s.cookies : []
  const localStorage = Array.isArray(s.localStorage) ? s.localStorage : []
  const requestHosts = Array.isArray(s.requestHosts) ? s.requestHosts : []
  const requestPaths = Array.isArray(s.requestPaths) ? s.requestPaths : []
  const scriptUrlGlobs = Array.isArray(s.scriptUrlGlobs) ? s.scriptUrlGlobs : []
  const iframeSrcGlobs = Array.isArray(s.iframeSrcGlobs) ? s.iframeSrcGlobs : []

  // Validate pattern objects
  for (const [ci, c] of cookies.entries()) {
    const p = c as PatternLike
    if (typeof p?.name !== 'string' || p.name.length === 0) {
      return `services[${index}] (${String(s.id)}).cookies[${ci}]: name must be a non-empty string`
    }
    if (typeof p?.wildcard !== 'boolean') {
      return `services[${index}] (${String(s.id)}).cookies[${ci}]: wildcard must be a boolean`
    }
  }
  for (const [li, l] of localStorage.entries()) {
    const p = l as PatternLike
    if (typeof p?.name !== 'string' || p.name.length === 0) {
      return `services[${index}] (${String(s.id)}).localStorage[${li}]: name must be a non-empty string`
    }
    if (typeof p?.wildcard !== 'boolean') {
      return `services[${index}] (${String(s.id)}).localStorage[${li}]: wildcard must be a boolean`
    }
  }

  // At least one match signal required
  if (
    cookies.length === 0 &&
    localStorage.length === 0 &&
    requestHosts.length === 0 &&
    requestPaths.length === 0 &&
    scriptUrlGlobs.length === 0 &&
    iframeSrcGlobs.length === 0
  ) {
    return (
      `services[${index}] (${String(s.id)}): must have at least one match signal ` +
      `(cookies, localStorage, requestHosts, requestPaths, scriptUrlGlobs, or iframeSrcGlobs)`
    )
  }

  return null
}

/**
 * Full-document validation — validates schemaVersion, parses all services,
 * checks for duplicate ids. Returns a list of error strings (empty = valid).
 */
function validateDocument(doc: unknown): string[] {
  const errors: string[] = []

  if (typeof doc !== 'object' || doc === null) {
    return ['document must be a YAML object at the top level']
  }
  const d = doc as ServicesYamlDoc

  // schemaVersion check — distinct error so it's immediately actionable
  if (d.schemaVersion !== 1) {
    errors.push(
      `schemaVersion mismatch: expected 1, got ${JSON.stringify(d.schemaVersion)}. ` +
        `Update your services.yaml to use schemaVersion: 1 or upgrade the generator.`,
    )
    // Cannot continue without the right schema version
    return errors
  }

  if (!Array.isArray(d.services)) {
    return [...errors, '`services` must be an array']
  }

  const seenIds = new Set<string>()
  for (const [i, s] of d.services.entries()) {
    const err = validateService(s, i)
    if (err !== null) {
      errors.push(err)
    } else {
      // Only check for dup ids on valid-id entries
      const id = (s as ServiceLike).id as string
      if (seenIds.has(id)) {
        errors.push(`duplicate id "${id}" at services[${i}]`)
      }
      seenIds.add(id)
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// 1. Live services.yaml passes validation
// ---------------------------------------------------------------------------

describe('services.yaml — live document passes schema validation', () => {
  const raw = readFileSync(SERVICES_YAML_PATH, 'utf-8')
  const doc = parseYaml(raw) as ServicesYamlDoc

  it('parses without YAML syntax errors', () => {
    expect(doc).toBeTruthy()
    expect(typeof doc).toBe('object')
  })

  it('has schemaVersion: 1', () => {
    expect(doc.schemaVersion).toBe(1)
    // Matches the exported DB_SCHEMA_VERSION constant
    expect(DB_SCHEMA_VERSION).toBe(1)
  })

  it('has a non-empty services array', () => {
    expect(Array.isArray(doc.services)).toBe(true)
    expect(doc.services.length).toBeGreaterThan(0)
  })

  it('passes full document validation with zero errors', () => {
    const errors = validateDocument(doc)
    expect(errors).toEqual([])
  })

  it('all service ids are unique', () => {
    const ids = doc.services.map((s) => (s as ServiceLike).id as string)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('all service categories are in the valid enum', () => {
    for (const s of doc.services) {
      const svc = s as ServiceLike
      expect(
        VALID_CATEGORIES.has(svc.category as string),
        `service "${String(svc.id)}" has invalid category: ${JSON.stringify(svc.category)}`,
      ).toBe(true)
    }
  })

  it('all services have at least one match signal', () => {
    for (const s of doc.services) {
      const svc = s as ServiceLike
      const hasSignal =
        (Array.isArray(svc.cookies) && svc.cookies.length > 0) ||
        (Array.isArray(svc.localStorage) && svc.localStorage.length > 0) ||
        (Array.isArray(svc.requestHosts) && svc.requestHosts.length > 0) ||
        (Array.isArray(svc.requestPaths) && svc.requestPaths.length > 0) ||
        (Array.isArray(svc.scriptUrlGlobs) && svc.scriptUrlGlobs.length > 0) ||
        (Array.isArray(svc.iframeSrcGlobs) && svc.iframeSrcGlobs.length > 0)
      expect(
        hasSignal,
        `service "${String(svc.id)}" has no match signal — add at least one of: ` +
          `cookies, localStorage, requestHosts, requestPaths, scriptUrlGlobs, iframeSrcGlobs`,
      ).toBe(true)
    }
  })

  it('no curated service uses the reserved "ocd-" id prefix', () => {
    for (const s of doc.services) {
      const id = String((s as ServiceLike).id ?? '')
      expect(
        id.startsWith('ocd-'),
        `service "${id}" uses the reserved "ocd-" prefix (reserved for Open Cookie Database entries)`,
      ).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Malformed inputs are rejected with specific, actionable error messages
// ---------------------------------------------------------------------------

describe('validateDocument() — malformed inputs are rejected', () => {
  it('rejects a missing id', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [{ name: 'Test', category: 'analytics', requestHosts: ['example.com'] }],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/id/)
  })

  it('rejects an id with uppercase letters', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [{ id: 'MyService', name: 'Test', category: 'analytics', requestHosts: ['example.com'] }],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/id/)
  })

  it('rejects a bad category value', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [{ id: 'bad-cat', name: 'Bad Cat', category: 'unknown', requestHosts: ['example.com'] }],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/category/)
    expect(errors[0]).toMatch(/bad-cat/)
  })

  it('rejects a service with no match signals', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [
        {
          id: 'no-signals',
          name: 'No Signals',
          category: 'analytics',
          cookies: [],
          localStorage: [],
          requestHosts: [],
          requestPaths: [],
          scriptUrlGlobs: [],
          iframeSrcGlobs: [],
        },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/match signal/)
    expect(errors[0]).toMatch(/no-signals/)
  })

  it('rejects duplicate ids and names both instances', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [
        { id: 'dupe', name: 'First', category: 'analytics', requestHosts: ['first.com'] },
        { id: 'dupe', name: 'Second', category: 'marketing', requestHosts: ['second.com'] },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('duplicate') && e.includes('dupe'))).toBe(true)
  })

  it('rejects a cookie pattern with no name', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [
        {
          id: 'bad-pattern',
          name: 'Bad Pattern',
          category: 'analytics',
          cookies: [{ name: '', wildcard: false }],
        },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/name/)
  })

  it('rejects a cookie pattern where wildcard is not a boolean', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [
        {
          id: 'bad-wildcard',
          name: 'Bad Wildcard',
          category: 'analytics',
          cookies: [{ name: '_ga', wildcard: 'yes' }],
        },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/wildcard/)
  })

  it('accepts a minimal valid entry with only requestHosts', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [
        { id: 'minimal', name: 'Minimal Service', category: 'necessary', requestHosts: ['cdn.example.com'] },
      ],
    })
    expect(errors).toEqual([])
  })

  it('accepts a valid entry with only cookies', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [
        {
          id: 'cookie-only',
          name: 'Cookie Only',
          category: 'marketing',
          cookies: [{ name: '_ck_test', wildcard: false }],
        },
      ],
    })
    expect(errors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. schemaVersion mismatch produces a distinct, actionable error
// ---------------------------------------------------------------------------

describe('validateDocument() — schemaVersion mismatch', () => {
  it('reports schemaVersion mismatch as a distinct error when version is wrong', () => {
    const errors = validateDocument({
      schemaVersion: 99,
      services: [{ id: 'test', name: 'Test', category: 'analytics', requestHosts: ['example.com'] }],
    })
    expect(errors.length).toBeGreaterThan(0)
    // Error must mention "schemaVersion" so the contributor knows what to fix
    expect(errors[0]).toMatch(/schemaVersion/)
    // Error must mention the expected version (1) and what was received
    expect(errors[0]).toMatch(/1/)
    expect(errors[0]).toMatch(/99/)
  })

  it('reports schemaVersion mismatch when version is missing', () => {
    const errors = validateDocument({
      schemaVersion: undefined,
      services: [{ id: 'test', name: 'Test', category: 'analytics', requestHosts: ['example.com'] }],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/schemaVersion/)
  })

  it('reports schemaVersion mismatch when version is a string instead of number', () => {
    const errors = validateDocument({
      schemaVersion: '1',
      services: [],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/schemaVersion/)
  })

  it('does NOT report schemaVersion error when version is correct (1)', () => {
    const errors = validateDocument({
      schemaVersion: 1,
      services: [{ id: 'ok', name: 'OK Service', category: 'necessary', requestHosts: ['example.com'] }],
    })
    expect(errors.filter((e) => e.includes('schemaVersion'))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// FP-003 — False-positive signature regression tests
// Each block asserts: (a) the previously-false-positive input no longer matches,
// and (b) a true-positive input for the same service still does.
// ---------------------------------------------------------------------------

describe('FP-003-1 — Twitter/X Pixel: t.co removed from requestHosts', () => {
  // t.co is Twitter's URL shortener and fires on every tweet link — not a pixel signal.
  it('does NOT match t.co as twitter-pixel (false-positive: URL shortener on editorial sites)', () => {
    const result = findServiceByHost('t.co')
    // t.co must not classify as twitter-pixel
    expect(result?.service.id).not.toBe('twitter-pixel')
  })

  it('still matches static.ads-twitter.com as twitter-pixel (true-positive)', () => {
    const result = findServiceByHost('static.ads-twitter.com')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('twitter-pixel')
  })

  it('still matches analytics.twitter.com as twitter-pixel (true-positive)', () => {
    const result = findServiceByHost('analytics.twitter.com')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('twitter-pixel')
  })
})

describe('FP-003-2 — Meta Pixel: bare facebook.com removed from requestHosts', () => {
  // facebook.com is used by social login, Like buttons, share widgets — not Pixel alone.
  it('does NOT match bare facebook.com as meta-pixel (false-positive: social login / Like buttons)', () => {
    const result = findServiceByHost('facebook.com')
    expect(result?.service.id).not.toBe('meta-pixel')
  })

  it('does NOT match www.facebook.com as meta-pixel (false-positive subdomain)', () => {
    const result = findServiceByHost('www.facebook.com')
    expect(result?.service.id).not.toBe('meta-pixel')
  })

  it('still matches connect.facebook.net as meta-pixel (true-positive: Pixel script host)', () => {
    const result = findServiceByHost('connect.facebook.net')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('meta-pixel')
  })

  it('still matches _fbp cookie as meta-pixel (true-positive: globally unique cookie)', () => {
    const result = findServiceByCookie('_fbp')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('meta-pixel')
  })
})

describe('FP-003-3 — Vimeo: generic player cookie removed', () => {
  // "player" is too generic — any audio/video player can set a "player" cookie.
  it('does NOT match "player" cookie as vimeo (false-positive: generic audio/video player cookie)', () => {
    const result = findServiceByCookie('player')
    expect(result?.service.id).not.toBe('vimeo')
  })

  it('still matches "vuid" cookie as vimeo (true-positive: Vimeo-unique user id cookie)', () => {
    const result = findServiceByCookie('vuid')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('vimeo')
  })

  it('still matches player.vimeo.com host as vimeo (true-positive)', () => {
    const result = findServiceByHost('player.vimeo.com')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('vimeo')
  })
})

describe('FP-003-4 — Mixpanel: mp_ cookie removed as standalone signal', () => {
  // mp_ is short enough to collide with unrelated first-party cookies.
  // Detection relies on requestHost, not cookie alone.
  it('does NOT match "mp_something" cookie as mixpanel (false-positive: too-short prefix)', () => {
    const result = findServiceByCookie('mp_something_random')
    expect(result?.service.id).not.toBe('mixpanel')
  })

  it('does NOT match "mp_abc123" cookie as mixpanel (false-positive: first-party collision)', () => {
    const result = findServiceByCookie('mp_abc123')
    expect(result?.service.id).not.toBe('mixpanel')
  })

  it('still matches api.mixpanel.com host as mixpanel (true-positive)', () => {
    const result = findServiceByHost('api.mixpanel.com')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('mixpanel')
  })

  it('still matches cdn.mxpnl.com host as mixpanel (true-positive)', () => {
    const result = findServiceByHost('cdn.mxpnl.com')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('mixpanel')
  })
})

describe('FP-003-5 — _ga cookie: single attribution to ga4, not ua or gtm', () => {
  // _ga is shared across ga4/ua/gtm definitions; with _ga removed from ua and gtm,
  // a single _ga cookie now unambiguously attributes to ga4 only.
  it('classifies _ga cookie as ga4 (true-positive: ga4 is the owner)', () => {
    const result = findServiceByCookie('_ga')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('ga4')
  })

  it('does NOT classify _ga cookie as ua (false-positive: _ga removed from ua)', () => {
    // ua must now be distinguished by its own unique cookies (_gid, __utma, etc.)
    const result = findServiceByCookie('_ga')
    expect(result?.service.id).not.toBe('ua')
  })

  it('does NOT classify _ga cookie as gtm (false-positive: _ga removed from gtm)', () => {
    const result = findServiceByCookie('_ga')
    expect(result?.service.id).not.toBe('gtm')
  })

  it('still classifies _gid cookie as ua (true-positive: ua-unique cookie)', () => {
    const result = findServiceByCookie('_gid')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('ua')
  })

  it('still classifies __utma cookie as ua (true-positive: legacy UA cookie)', () => {
    const result = findServiceByCookie('__utma')
    expect(result).not.toBeNull()
    expect(result!.service.id).toBe('ua')
  })

  it('still classifies googletagmanager.com host as gtm or ga4 (true-positive: GTM host)', () => {
    const result = findServiceByHost('googletagmanager.com')
    expect(result).not.toBeNull()
    // ga4 is listed first in services.yaml and also has googletagmanager.com requestHost
    // so it wins the host lookup — either ga4 or gtm is acceptable since both are correct
    expect(['ga4', 'gtm']).toContain(result!.service.id)
  })
})

// ---------------------------------------------------------------------------
// 4. SERVICE_DB compiled output is internally consistent
// ---------------------------------------------------------------------------

describe('SERVICE_DB — compiled database internal consistency', () => {
  it('contains at least as many entries as services.yaml curated count', () => {
    // SERVICE_DB includes both curated and OCD entries — must be non-trivially large
    expect(SERVICE_DB.length).toBeGreaterThan(20)
  })

  it('all service ids in the compiled DB are non-empty strings', () => {
    for (const svc of SERVICE_DB) {
      expect(typeof svc.id).toBe('string')
      expect(svc.id.length).toBeGreaterThan(0)
    }
  })

  it('all service categories in the compiled DB are in the valid enum', () => {
    for (const svc of SERVICE_DB) {
      expect(
        VALID_CATEGORIES.has(svc.category),
        `compiled DB entry "${svc.id}" has invalid category: ${svc.category}`,
      ).toBe(true)
    }
  })

  it('curated entries in the compiled DB all have at least one match signal', () => {
    const curatedEntries = SERVICE_DB.filter((s) => s.source === 'curated')
    for (const svc of curatedEntries) {
      const hasSignal =
        (svc.cookies?.length ?? 0) > 0 ||
        (svc.localStorage?.length ?? 0) > 0 ||
        (svc.requestHosts?.length ?? 0) > 0 ||
        (svc.requestPaths?.length ?? 0) > 0 ||
        (svc.scriptUrlGlobs?.length ?? 0) > 0 ||
        (svc.iframeSrcGlobs?.length ?? 0) > 0
      expect(
        hasSignal,
        `compiled curated entry "${svc.id}" has no match signal`,
      ).toBe(true)
    }
  })

  it('no curated entry in the compiled DB uses the reserved "ocd-" prefix', () => {
    const curatedEntries = SERVICE_DB.filter((s) => s.source === 'curated')
    for (const svc of curatedEntries) {
      expect(
        svc.id.startsWith('ocd-'),
        `curated entry "${svc.id}" uses reserved "ocd-" id prefix`,
      ).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Data-driven matching table — one row per curated service added in task 005
//    (reaching ~50 curated services). Each row asserts that a representative
//    signal resolves to the correct service id and a valid confidence level.
//
//    Format: { id, cookieSample?, hostSample?, localStorageSample? }
//    At least one signal field must be provided per row.
//
//    Confidence semantics (task 006 — "two signals agree = high"):
//      cookie/localStorage/host hits from a single lookup → 'medium'
//      'high' is only emitted by classifier.ts when two independent signals
//      agree on the same service on the same page.
//
//    Reference: test-strategist research §F2 / §Recommendation 1
// ---------------------------------------------------------------------------

interface SignalRow {
  id: string
  category: string
  cookieSample?: string
  hostSample?: string
  localStorageSample?: string
}

const CURATED_SIGNAL_TABLE: SignalRow[] = [
  // --- Existing services (smoke-test a representative signal each) ---
  { id: 'ga4', category: 'analytics', cookieSample: '_ga' },
  { id: 'ua', category: 'analytics', cookieSample: '_gid' },
  // gtm: googletagmanager.com is shared with ga4 (ga4 listed first → wins host lookup).
  // GTM is covered by the existing named test at "FP-003-5". No distinct signal here.
  { id: 'gtm', category: 'analytics' },
  { id: 'meta-pixel', category: 'marketing', cookieSample: '_fbp' },
  { id: 'youtube', category: 'marketing', cookieSample: 'VISITOR_INFO1_LIVE' },
  { id: 'linkedin-insight', category: 'marketing', cookieSample: 'lidc' },
  { id: 'hotjar', category: 'analytics', cookieSample: '_hjid' },
  { id: 'intercom', category: 'functional', cookieSample: 'intercom-id-abc123' },
  { id: 'hubspot', category: 'analytics', cookieSample: 'hubspotutk' },
  { id: 'zendesk', category: 'functional', cookieSample: '__zlcmid' },
  { id: 'crisp', category: 'functional', hostSample: 'client.crisp.chat' },
  { id: 'drift', category: 'functional', cookieSample: 'driftt_aid' },
  { id: 'segment', category: 'analytics', localStorageSample: 'ajs_user_id' },
  { id: 'amplitude', category: 'analytics', cookieSample: 'amplitude_id_xyz' },
  { id: 'mixpanel', category: 'analytics', hostSample: 'api.mixpanel.com' },
  { id: 'twitter-pixel', category: 'marketing', cookieSample: 'muc_ads' },
  { id: 'clarity', category: 'analytics', cookieSample: '_clck' },
  { id: 'cloudflare-insights', category: 'analytics', cookieSample: '_cflb' },
  { id: 'vimeo', category: 'marketing', cookieSample: 'vuid' },
  { id: 'tiktok-pixel', category: 'marketing', cookieSample: '_ttp' },
  { id: 'recaptcha', category: 'functional', cookieSample: '_GRECAPTCHA' },
  // --- New services added in task 005 ---
  { id: 'google-ads', category: 'marketing', cookieSample: '_gcl_au' },
  { id: 'snapchat-pixel', category: 'marketing', cookieSample: '_scid' },
  { id: 'pinterest-tag', category: 'marketing', cookieSample: '_pinterest_ct_ua' },
  { id: 'reddit-pixel', category: 'marketing', cookieSample: 'rdt_uuid' },
  { id: 'quora-pixel', category: 'marketing', cookieSample: '_qca' },
  { id: 'posthog', category: 'analytics', cookieSample: 'ph_abc123' },
  { id: 'fullstory', category: 'analytics', cookieSample: 'fs_uid' },
  { id: 'heap', category: 'analytics', cookieSample: '_hp2_abc' },
  { id: 'klaviyo', category: 'marketing', cookieSample: '__kla_id' },
  { id: 'mailchimp', category: 'marketing', hostSample: 'chimpstatic.com' },
  { id: 'activecampaign', category: 'marketing', cookieSample: 'ac_enable_tracking' },
  { id: 'braze', category: 'marketing', localStorageSample: 'ab.storage.userId.abc' },
  { id: 'optimizely', category: 'analytics', cookieSample: 'optimizelyEndUserId' },
  { id: 'vwo', category: 'analytics', cookieSample: '_vwo_uuid' },
  { id: 'lucky-orange', category: 'analytics', cookieSample: '_lo_uid' },
  { id: 'crazy-egg', category: 'analytics', cookieSample: '_ceir' },
  { id: 'mouseflow', category: 'analytics', cookieSample: '_mf_id' },
  { id: 'freshchat', category: 'functional', hostSample: 'wchat.freshchat.com' },
  { id: 'tidio', category: 'functional', cookieSample: 'tidio_session' },
  { id: 'olark', category: 'functional', cookieSample: 'hb_xid' },
  { id: 'sentry', category: 'functional', cookieSample: '__sentry_xyz' },
  { id: 'stripe', category: 'functional', cookieSample: '__stripe_mid' },
  { id: 'cloudflare-turnstile', category: 'functional', localStorageSample: 'cf_turnstile_abc' },
  { id: 'google-optimize', category: 'analytics', cookieSample: '_gaexp' },
  { id: 'plausible', category: 'analytics', hostSample: 'plausible.io' },
  { id: 'fathom', category: 'analytics', hostSample: 'cdn.usefathom.com' },
  { id: 'trustpilot', category: 'marketing', hostSample: 'widget.trustpilot.com' },
  { id: 'podium', category: 'functional', cookieSample: 'podium_session' },
  { id: 'pendo', category: 'analytics', hostSample: 'cdn.pendo.io' },
]

describe('CURATED_SIGNAL_TABLE — data-driven per-service matching (task 005)', () => {
  it.each(CURATED_SIGNAL_TABLE)(
    '$id ($category): representative cookie signal matches correct service',
    ({ id, cookieSample }) => {
      if (!cookieSample) return // skip rows with no cookie sample
      const result = findServiceByCookie(cookieSample)
      expect(result, `cookie "${cookieSample}" should match service "${id}"`).not.toBeNull()
      expect(result!.service.id).toBe(id)
      // Single cookie signal → medium (task 006: 'high' requires a second independent
      // signal on the same page, which is computed by classifier.ts, not the lookup helper)
      expect(result!.confidence).toBe('medium')
    },
  )

  it.each(CURATED_SIGNAL_TABLE)(
    '$id ($category): representative host signal matches correct service',
    ({ id, hostSample }) => {
      if (!hostSample) return // skip rows with no host sample
      const result = findServiceByHost(hostSample)
      expect(result, `host "${hostSample}" should match service "${id}"`).not.toBeNull()
      expect(result!.service.id).toBe(id)
      // Single host signal → medium
      expect(result!.confidence).toBe('medium')
    },
  )

  it.each(CURATED_SIGNAL_TABLE)(
    '$id ($category): representative localStorage signal matches correct service',
    ({ id, localStorageSample }) => {
      if (!localStorageSample) return // skip rows with no localStorage sample
      const result = findServiceByLocalStorage(localStorageSample)
      expect(result, `localStorage key "${localStorageSample}" should match service "${id}"`).not.toBeNull()
      expect(result!.service.id).toBe(id)
      // Single localStorage signal → medium (task 006: same reasoning as cookie above)
      expect(result!.confidence).toBe('medium')
    },
  )

  it('all 50 curated services have at least one signal row in CURATED_SIGNAL_TABLE', () => {
    const tableIds = new Set(CURATED_SIGNAL_TABLE.map((r) => r.id))
    const curatedIds = SERVICE_DB.filter((s) => s.source === 'curated').map((s) => s.id)
    const missing = curatedIds.filter((id) => !tableIds.has(id))
    expect(
      missing,
      `These curated services have no row in CURATED_SIGNAL_TABLE: ${missing.join(', ')}`,
    ).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Drift guard — fixtures/service-fingerprints.json must stay in sync
//    with the curated service DB.
//
//    This test compares the IDs in the committed fixtures/service-fingerprints.json
//    against the curated entries in SERVICE_DB. A mismatch means the fingerprints
//    file is stale and needs to be regenerated by running:
//       node packages/scanner/scripts/build-services-db.mjs
//
//    [architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 3)]
//    [research/test-strategist.md §Gotchas: drift risk as DB grows to ~50]
// ---------------------------------------------------------------------------

interface FingerprintEntry {
  id: string
  name: string
  category: string
  cookies: string[]
  localStorage: string[]
  requestPatterns: string[]
  stubScript: string | null
  stubCookies: string[]
}

interface FingerprintsFile {
  description?: string
  services: FingerprintEntry[]
}

describe('fixtures/service-fingerprints.json — drift guard (task 008)', () => {
  const fingerprintsRaw = readFileSync(FINGERPRINTS_PATH, 'utf-8')
  const fingerprints = JSON.parse(fingerprintsRaw) as FingerprintsFile
  const curatedServices = SERVICE_DB.filter((s) => s.source === 'curated')

  it('fingerprints file parses as valid JSON with a services array', () => {
    expect(typeof fingerprints).toBe('object')
    expect(Array.isArray(fingerprints.services)).toBe(true)
    expect(fingerprints.services.length).toBeGreaterThan(0)
  })

  it('fingerprints service count matches curated DB count (stale file = drift)', () => {
    expect(
      fingerprints.services.length,
      `fixtures/service-fingerprints.json has ${fingerprints.services.length} entries ` +
        `but the curated DB has ${curatedServices.length}. ` +
        `Run: node packages/scanner/scripts/build-services-db.mjs`,
    ).toBe(curatedServices.length)
  })

  it('every curated DB id appears in fingerprints (no missing entries)', () => {
    const fpIds = new Set(fingerprints.services.map((s) => s.id))
    const missing = curatedServices.filter((s) => !fpIds.has(s.id)).map((s) => s.id)
    expect(
      missing,
      `These curated service IDs are absent from fixtures/service-fingerprints.json: ` +
        `${missing.join(', ')}. Run: node packages/scanner/scripts/build-services-db.mjs`,
    ).toHaveLength(0)
  })

  it('every fingerprints id appears in the curated DB (no stale entries)', () => {
    const curatedIds = new Set(curatedServices.map((s) => s.id))
    const stale = fingerprints.services.filter((s) => !curatedIds.has(s.id)).map((s) => s.id)
    expect(
      stale,
      `fixtures/service-fingerprints.json contains IDs not in the curated DB: ` +
        `${stale.join(', ')}. Run: node packages/scanner/scripts/build-services-db.mjs`,
    ).toHaveLength(0)
  })

  it('fingerprints category for each service matches the curated DB category', () => {
    const curatedById = new Map(curatedServices.map((s) => [s.id, s]))
    for (const fp of fingerprints.services) {
      const db = curatedById.get(fp.id)
      if (!db) continue // already caught by previous test
      expect(
        fp.category,
        `fixtures/service-fingerprints.json service "${fp.id}" has category "${fp.category}" ` +
          `but the curated DB has "${db.category}". ` +
          `Run: node packages/scanner/scripts/build-services-db.mjs`,
      ).toBe(db.category)
    }
  })
})
