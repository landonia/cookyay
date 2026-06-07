/**
 * Classification engine — takes raw crawl findings (task 015) and maps each
 * cookie, storage entry, request host, script, and iframe to a known service
 * (or an "unclassified" bucket). Annotates each hit with a confidence level.
 *
 * Confidence levels (per task 016 impl notes):
 *   high   — exact known cookie name + host (or curated exact match)
 *   medium — host match only (service inferred from request origin)
 *   low    — heuristic / pattern guess with no definitive signal
 *
 * Unknown artifacts are NEVER silently dropped — they land in an explicit
 * "unclassified — review me" section (acceptance criterion 2).
 */
import type { RawFindings } from './types.js'
import {
  findServiceByCookie,
  findServiceByHost,
  findServiceByLocalStorage,
  type Confidence,
  type ServiceCategory,
  type ServiceDefinition,
} from './db.js'

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ClassifiedCookie {
  name: string
  domain: string
  service: ServiceDefinition
  confidence: Confidence
  pages: string[]
}

export interface ClassifiedStorage {
  type: 'localStorage' | 'sessionStorage'
  key: string
  service: ServiceDefinition
  confidence: Confidence
  pages: string[]
}

export interface ClassifiedRequest {
  host: string
  service: ServiceDefinition
  confidence: Confidence
  pages: string[]
}

export interface ClassifiedScript {
  src: string
  /** Whether the script was declared with type="text/plain" (already blocked). */
  blocked: boolean
  /** data-category attribute if present on the element. */
  declaredCategory: string | null
  service: ServiceDefinition | null
  confidence: Confidence | null
  pages: string[]
}

export interface ClassifiedIframe {
  src: string
  /** Whether the iframe was declared with data-src (already blocked). */
  blocked: boolean
  declaredCategory: string | null
  service: ServiceDefinition | null
  confidence: Confidence | null
  pages: string[]
}

export interface NoscriptWarning {
  text: string
  pages: string[]
}

/** An artifact (cookie, storage key, host, script) that could not be classified. */
export interface UnclassifiedArtifact {
  kind: 'cookie' | 'localStorage' | 'sessionStorage' | 'request-host' | 'script' | 'iframe'
  name: string
  detail?: string
  pages: string[]
}

export interface ClassifiedFindings {
  scannedAt: string
  targetUrl: string
  pagesVisited: string[]

  /** Classified cookies, deduplicated by (name, service.id). */
  cookies: ClassifiedCookie[]
  /** Classified storage keys. */
  storage: ClassifiedStorage[]
  /** Third-party hosts matched to a service. */
  requests: ClassifiedRequest[]
  /** Blocked/declared scripts that were matched (or found unclassified). */
  scripts: ClassifiedScript[]
  /** Blocked/declared iframes that were matched (or found unclassified). */
  iframes: ClassifiedIframe[]
  /** noscript tags found — these bypass script blocking and need a warning. */
  noscriptWarnings: NoscriptWarning[]
  /** Everything that could not be matched — never dropped. */
  unclassified: UnclassifiedArtifact[]
}

// ---------------------------------------------------------------------------
// Helper: key-based deduplication utilities
// ---------------------------------------------------------------------------

function getOrCreate<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  const existing = map.get(key)
  if (existing !== undefined) return existing
  const fresh = factory()
  map.set(key, fresh)
  return fresh
}

// ---------------------------------------------------------------------------
// Core classification logic
// ---------------------------------------------------------------------------

export function classify(raw: RawFindings): ClassifiedFindings {
  // Maps for deduplication by key
  const cookieMap = new Map<string, ClassifiedCookie>()           // key: `${name}@@${serviceId}`
  const storageMap = new Map<string, ClassifiedStorage>()          // key: `${type}@@${key}`
  const requestMap = new Map<string, ClassifiedRequest>()          // key: `${host}@@${serviceId}`
  const scriptMap = new Map<string, ClassifiedScript>()            // key: `${src}`
  const iframeMap = new Map<string, ClassifiedIframe>()            // key: `${src|dataSrc}`
  const noscriptMap = new Map<string, NoscriptWarning>()           // key: normalized text
  const unclassifiedMap = new Map<string, UnclassifiedArtifact>()  // key: `${kind}@@${name}`

  for (const page of raw.pages) {
    const pageUrl = page.url

    // -----------------------------------------------------------------------
    // Cookies
    // -----------------------------------------------------------------------
    for (const cookie of page.cookies) {
      // Skip first-party "necessary" consent cookies
      if (isConsentCookie(cookie.name)) continue

      const match = findServiceByCookie(cookie.name)
      if (match) {
        const key = `${cookie.name}@@${match.service.id}`
        const entry = getOrCreate(cookieMap, key, () => ({
          name: cookie.name,
          domain: cookie.domain,
          service: match.service,
          confidence: match.confidence,
          pages: [],
        }))
        if (!entry.pages.includes(pageUrl)) entry.pages.push(pageUrl)
      } else {
        // Only report non-trivial, non-session-only cookies as unclassified
        const uKey = `cookie@@${cookie.name}`
        const entry = getOrCreate(unclassifiedMap, uKey, () => ({
          kind: 'cookie' as const,
          name: cookie.name,
          detail: `domain: ${cookie.domain}`,
          pages: [],
        }))
        if (!entry.pages.includes(pageUrl)) entry.pages.push(pageUrl)
      }
    }

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------
    for (const entry of page.storage) {
      const match = findServiceByLocalStorage(entry.key)
      if (match) {
        const sKey = `${entry.type}@@${entry.key}`
        const classified = getOrCreate(storageMap, sKey, () => ({
          type: entry.type,
          key: entry.key,
          service: match.service,
          confidence: match.confidence,
          pages: [],
        }))
        if (!classified.pages.includes(pageUrl)) classified.pages.push(pageUrl)
      } else {
        const uKey = `${entry.type}@@${entry.key}`
        const uEntry = getOrCreate(unclassifiedMap, uKey, () => ({
          kind: entry.type as 'localStorage' | 'sessionStorage',
          name: entry.key,
          pages: [],
        }))
        if (!uEntry.pages.includes(pageUrl)) uEntry.pages.push(pageUrl)
      }
    }

    // -----------------------------------------------------------------------
    // Requests (third-party hosts)
    // -----------------------------------------------------------------------
    for (const req of page.requests) {
      if (req.firstParty) continue
      const match = findServiceByHost(req.host)
      if (match) {
        const rKey = `${req.host}@@${match.service.id}`
        const entry = getOrCreate(requestMap, rKey, () => ({
          host: req.host,
          service: match.service,
          confidence: match.confidence,
          pages: [],
        }))
        if (!entry.pages.includes(pageUrl)) entry.pages.push(pageUrl)
      } else {
        const uKey = `request-host@@${req.host}`
        const entry = getOrCreate(unclassifiedMap, uKey, () => ({
          kind: 'request-host' as const,
          name: req.host,
          pages: [],
        }))
        if (!entry.pages.includes(pageUrl)) entry.pages.push(pageUrl)
      }
    }

    // -----------------------------------------------------------------------
    // Scripts (blocked / declarative)
    // -----------------------------------------------------------------------
    for (const script of page.scripts) {
      if (script.src === null) continue // skip inline scripts
      const src = script.src

      // Try to classify by looking at the URL
      const scriptHost = tryExtractHost(src)
      const match = scriptHost ? findServiceByHost(scriptHost) : null

      const sKey = src
      const entry = getOrCreate(scriptMap, sKey, () => ({
        src,
        blocked: script.blocked,
        declaredCategory: script.category,
        service: match ? match.service : null,
        confidence: match ? match.confidence : null,
        pages: [],
      }))
      if (!entry.pages.includes(pageUrl)) entry.pages.push(pageUrl)

      // Only add to unclassified if no service match AND no declared category
      // (a declared data-category means the emitter will pick it up correctly)
      if (!match && !script.category) {
        const uKey = `script@@${src}`
        const uEntry = getOrCreate(unclassifiedMap, uKey, () => ({
          kind: 'script' as const,
          name: src,
          pages: [],
        }))
        if (!uEntry.pages.includes(pageUrl)) uEntry.pages.push(pageUrl)
      }
    }

    // -----------------------------------------------------------------------
    // Iframes (blocked / declarative)
    // -----------------------------------------------------------------------
    for (const iframe of page.iframes) {
      const iframeSrc = iframe.dataSrc ?? iframe.src
      if (!iframeSrc) continue

      const iframeHost = tryExtractHost(iframeSrc)
      const match = iframeHost ? findServiceByHost(iframeHost) : null

      const iKey = iframeSrc
      const entry = getOrCreate(iframeMap, iKey, () => ({
        src: iframeSrc,
        blocked: iframe.blocked,
        declaredCategory: iframe.category,
        service: match ? match.service : null,
        confidence: match ? match.confidence : null,
        pages: [],
      }))
      if (!entry.pages.includes(pageUrl)) entry.pages.push(pageUrl)

      // Only add to unclassified if no service match AND no declared category
      if (!match && !iframe.category) {
        const uKey = `iframe@@${iframeSrc}`
        const uEntry = getOrCreate(unclassifiedMap, uKey, () => ({
          kind: 'iframe' as const,
          name: iframeSrc,
          pages: [],
        }))
        if (!uEntry.pages.includes(pageUrl)) uEntry.pages.push(pageUrl)
      }
    }

    // -----------------------------------------------------------------------
    // Noscript elements — always surface as warnings
    // -----------------------------------------------------------------------
    for (const noscript of page.noscripts) {
      const text = noscript.text.trim()
      if (!text) continue
      // Only surface noscripts that look like third-party tracker fallbacks
      // (i.e. they contain <img> or <iframe> elements — classic pixel patterns)
      if (!looksLikeTrackerNoscript(text)) continue

      const nKey = text.slice(0, 200) // stable dedup key
      const entry = getOrCreate(noscriptMap, nKey, () => ({ text, pages: [] }))
      if (!entry.pages.includes(pageUrl)) entry.pages.push(pageUrl)
    }
  }

  return {
    scannedAt: raw.scannedAt,
    targetUrl: raw.targetUrl,
    pagesVisited: raw.pagesVisited,
    cookies: [...cookieMap.values()],
    storage: [...storageMap.values()],
    requests: [...requestMap.values()],
    scripts: [...scriptMap.values()],
    iframes: [...iframeMap.values()],
    noscriptWarnings: [...noscriptMap.values()],
    unclassified: [...unclassifiedMap.values()],
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Consent-management cookies — these are first-party and not surfaced as trackers. */
const CONSENT_COOKIE_PREFIXES = ['cookyay', 'CookieConsent', 'cookieconsent', 'cookie_consent']
function isConsentCookie(name: string): boolean {
  return CONSENT_COOKIE_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * Try to extract a hostname from a URL or path.
 * Returns null for relative paths (cannot determine host).
 */
function tryExtractHost(src: string): string | null {
  try {
    const u = new URL(src)
    return u.hostname
  } catch {
    // Relative URL — no host info
    return null
  }
}

/**
 * Heuristic: a noscript element looks like a tracker fallback if it contains
 * an img tag with a tracking pixel pattern or an iframe with an analytics URL.
 */
function looksLikeTrackerNoscript(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    (lower.includes('<img') && (lower.includes('pixel') || lower.includes('fbq') || lower.includes('tr?') || lower.includes('gtm'))) ||
    lower.includes('<iframe') ||
    lower.includes('googletagmanager.com') ||
    lower.includes('facebook.com/tr') ||
    lower.includes('analytics')
  )
}

// ---------------------------------------------------------------------------
// Category scoring: pick the dominant category across all classification hits
// when a script/iframe has a data-category declared on it, that wins over
// service classification.
// ---------------------------------------------------------------------------

/** Given a classified script/iframe, determine the effective category. */
export function effectiveCategory(
  declaredCategory: string | null,
  service: ServiceDefinition | null,
): ServiceCategory | null {
  if (declaredCategory) {
    // Validate against known categories
    const known: ServiceCategory[] = ['necessary', 'functional', 'analytics', 'marketing']
    const lower = declaredCategory.toLowerCase() as ServiceCategory
    if (known.includes(lower)) return lower
  }
  return service?.category ?? null
}
