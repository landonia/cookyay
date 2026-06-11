/**
 * Config emitter — converts ClassifiedFindings into a ready-to-use
 * cookyay config JSON object that can be passed directly to Cookyay.init().
 *
 * Output shape mirrors CookyayConfig from packages/cookyay/src/config.ts.
 * The scanner does NOT depend on the cookyay package at runtime (no circular
 * dep, no banner code in the scanner bundle) — the output is plain JSON.
 *
 * Confidence annotations are included in JSON comments (via the `_meta` field
 * on each service entry) so site owners can review and adjust classifications.
 *
 * noscript warnings are surfaced as a top-level `_warnings` array — they are
 * never silently dropped (acceptance criterion 3).
 *
 * Unknown artifacts appear in `_unclassified` — never silently dropped
 * (acceptance criterion 2).
 */
import type { ClassifiedFindings } from './classifier.js'
import { effectiveCategory } from './classifier.js'
import type { Confidence, ServiceCategory, ServiceDefinition } from './db.js'

// ---------------------------------------------------------------------------
// Output types (mirrors CookyayConfig loosely; plain JSON-serialisable)
// ---------------------------------------------------------------------------

export interface EmittedService {
  name: string
  cookies: string[]
  localStorage?: string[]
  /** Classification metadata — not consumed by Cookyay at runtime. */
  _meta: {
    confidence: Confidence
    matchedBy: 'cookie' | 'request-host' | 'localStorage' | 'script-host' | 'iframe-host' | 'declared-category'
    serviceId: string
    pages: string[]
  }
}

/**
 * A host-deduped suggested blocking entry.
 *
 * Multiple services that share a blocking host (e.g. GA4 + Google Ads both
 * fire from googletagmanager.com) are merged into a single entry so the site
 * owner only needs one rule in their markup.
 *
 * `snippet` is a verbatim-pasteable HTML tag the site owner adds before the
 * actual script/iframe load in their HTML:
 *   - Script:  <script type="text/plain" data-category="<cat>" src="<url>"></script>
 *   - Iframe:  <iframe data-src="<url>" data-category="<cat>"></iframe>
 *
 * The banner's blocking engine (packages/cookyay/src/blocking.ts) reads these
 * attributes at init time and holds the element inert until the user consents.
 */
export interface SuggestedBlockingEntry {
  /** Primary blocking host (e.g. "googletagmanager.com"). */
  host: string
  /** All service ids whose traffic traverses this host. */
  services: string[]
  /** Cookyay category to assign to this block rule. When services disagree,
   *  the most permissive category wins (marketing > analytics > functional > necessary). */
  category: ServiceCategory
  /** Highest confidence level observed across all contributing services. */
  confidence: Confidence
  /**
   * Verbatim-pasteable HTML snippet.
   * Add this tag to your HTML (before the script/iframe actually loads) to
   * enable Cookyay to block it until the visitor consents.
   */
  snippet: string
}

export interface EmittedCategory {
  label: string
  services: EmittedService[]
}

export interface EmittedUnclassified {
  kind: string
  name: string
  detail?: string
  pages: string[]
  _note: string
}

export interface EmittedNoscriptWarning {
  text: string
  pages: string[]
  _warning: string
}

export interface EmittedConfig {
  /**
   * Bump this value whenever your cookie usage changes materially.
   * This triggers re-consent for returning visitors.
   */
  policyVersion: string
  categories: Partial<Record<ServiceCategory, EmittedCategory>>
  /**
   * Ready-to-paste blocking rules, one entry per distinct host.
   *
   * When multiple detected services share a host (e.g. GA4 + Google Ads both
   * load from googletagmanager.com) they are merged into a single entry so
   * you only need to add one rule.  Each entry includes a `snippet` field —
   * copy it verbatim into your HTML before the third-party script/iframe loads
   * to let Cookyay hold it inert until the visitor consents.
   *
   * Only services that have an identifiable blocking host are included here.
   * Unclassified or necessary-category services are excluded.
   */
  suggestedBlocking: SuggestedBlockingEntry[]
  /**
   * Scripts/iframes that could NOT be automatically classified.
   * Review each entry and move it to the appropriate category manually.
   * IMPORTANT: nothing in this list will be blocked by Cookyay until you
   * move it into a category above.
   */
  _unclassified: EmittedUnclassified[]
  /**
   * noscript fallback tags detected on the site.
   * WARNING: These bypass script blocking entirely. Remove all <noscript>
   * fallback tags from third-party scripts — they load tracking pixels even
   * when JavaScript is disabled and will NOT be blocked by Cookyay.
   */
  _noscriptWarnings: EmittedNoscriptWarning[]
  /** Scan metadata. */
  _scanMeta: {
    scannedAt: string
    targetUrl: string
    pagesVisited: number
    classifierVersion: string
  }
}

export const CLASSIFIER_VERSION = '1.0.0'

// ---------------------------------------------------------------------------
// Category display labels
// ---------------------------------------------------------------------------
const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  necessary: 'Necessary',
  functional: 'Functional',
  analytics: 'Analytics',
  marketing: 'Marketing',
}

// ---------------------------------------------------------------------------
// Suggested blocking helpers
// ---------------------------------------------------------------------------

/**
 * Category precedence for merging: marketing is most permissive (needs most
 * consent), necessary is least (never blocked). When two services share a host
 * but differ in category we use the most permissive one so the banner correctly
 * holds the shared host inert until the stricter consent is granted.
 */
const CATEGORY_PRECEDENCE: Record<ServiceCategory, number> = {
  necessary: 0,
  functional: 1,
  analytics: 2,
  marketing: 3,
}

/** Returns the more permissive of two categories. */
function higherCategory(a: ServiceCategory, b: ServiceCategory): ServiceCategory {
  return CATEGORY_PRECEDENCE[a] >= CATEGORY_PRECEDENCE[b] ? a : b
}

/** Returns the higher of two confidence levels. */
function higherConfidence(a: Confidence, b: Confidence): Confidence {
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }
  return rank[a] >= rank[b] ? a : b
}

/**
 * Derive the primary blocking host for a service definition.
 *
 * Priority:
 *   1. First entry in `requestHosts` (most common case).
 *   2. Host portion of the first `requestPaths` entry (e.g. "facebook.com/tr" → "facebook.com").
 *   3. Hostname extracted from the first `scriptUrlGlobs` entry.
 *   4. Hostname extracted from the first `iframeSrcGlobs` entry.
 *
 * Returns null if no blocking host can be derived (service has no match signals
 * that translate to a blockable host — e.g. cookie-only OCD entries).
 */
export function deriveBlockingHost(svc: ServiceDefinition): string | null {
  if (svc.requestHosts && svc.requestHosts.length > 0) {
    return svc.requestHosts[0]
  }
  if (svc.requestPaths && svc.requestPaths.length > 0) {
    const first = svc.requestPaths[0]
    const slashIdx = first.indexOf('/')
    return slashIdx !== -1 ? first.slice(0, slashIdx) : first
  }
  if (svc.scriptUrlGlobs && svc.scriptUrlGlobs.length > 0) {
    try {
      // Remove leading wildcard + dot: "*.example.com/..." → "example.com/..."
      const cleaned = svc.scriptUrlGlobs[0].replace(/^\*\./, '').replace(/\*$/, '')
      const urlStr = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`
      return new URL(urlStr).hostname
    } catch {
      // ignore malformed globs
    }
  }
  if (svc.iframeSrcGlobs && svc.iframeSrcGlobs.length > 0) {
    try {
      const cleaned = svc.iframeSrcGlobs[0].replace(/^\*\./, '').replace(/\*$/, '')
      const urlStr = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`
      return new URL(urlStr).hostname
    } catch {
      // ignore malformed globs
    }
  }
  return null
}

/**
 * Render a verbatim-pasteable blocking snippet for a host.
 *
 * - If the service has `iframeSrcGlobs`: produces an iframe snippet using
 *   `data-src` (the banner's iframe blocking contract).
 * - Otherwise: produces a script snippet using `src` (the banner's script
 *   blocking contract: type="text/plain" with the src attribute preserved).
 *
 * The URL in the snippet is derived from the first matching glob pattern,
 * simplified to the most specific known URL. When no glob is available,
 * `https://<host>` is used as a placeholder the site owner can refine.
 */
export function renderSnippet(svc: ServiceDefinition, host: string, category: ServiceCategory): string {
  // Prefer iframe snippet when iframeSrcGlobs is populated
  if (svc.iframeSrcGlobs && svc.iframeSrcGlobs.length > 0) {
    const url = svc.iframeSrcGlobs[0].replace(/\*$/, '').replace(/^\*\./, 'https://')
    const finalUrl = url.startsWith('http') ? url : `https://${url}`
    return `<iframe data-src="${finalUrl}" data-category="${category}"></iframe>`
  }

  // Script snippet
  let url: string
  if (svc.scriptUrlGlobs && svc.scriptUrlGlobs.length > 0) {
    const glob = svc.scriptUrlGlobs[0]
    // Convert glob to usable URL: strip leading "*." prefix-wildcard, strip trailing "*"
    const cleaned = glob
      .replace(/^\*\./, '')   // "*.example.com/..." → "example.com/..."
      .replace(/\*$/, '')      // "example.com/gtm.js*" → "example.com/gtm.js"
    url = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`
  } else {
    url = `https://${host}`
  }

  return `<script type="text/plain" data-category="${category}" src="${url}"></script>`
}

/**
 * Returns all blockable hosts for a service definition.
 *
 * A service may be blockable via multiple hosts (e.g. GA4 can be blocked at
 * `google-analytics.com`, `analytics.google.com`, or `googletagmanager.com`).
 * This function returns all of them so that when multiple services share a host
 * (e.g. GA4 + GTM both use `googletagmanager.com`) they are correctly merged
 * into a single `suggestedBlocking` entry.
 *
 * Order: `requestHosts` entries come first (most common), then hosts derived
 * from `requestPaths` entries (path-level host), then glob-derived hosts.
 */
function allBlockingHosts(svc: ServiceDefinition): string[] {
  const hosts: string[] = []

  // requestHosts: each entry is a direct blockable host
  if (svc.requestHosts) {
    for (const h of svc.requestHosts) {
      if (h && !hosts.includes(h)) hosts.push(h)
    }
  }

  // requestPaths: extract host portion ("facebook.com/tr" → "facebook.com")
  if (svc.requestPaths) {
    for (const entry of svc.requestPaths) {
      const slashIdx = entry.indexOf('/')
      const h = slashIdx !== -1 ? entry.slice(0, slashIdx) : entry
      if (h && !hosts.includes(h)) hosts.push(h)
    }
  }

  // scriptUrlGlobs / iframeSrcGlobs: derive hostname from URL
  const globs = [...(svc.scriptUrlGlobs ?? []), ...(svc.iframeSrcGlobs ?? [])]
  for (const glob of globs) {
    try {
      const cleaned = glob.replace(/^\*\./, '').replace(/\*$/, '')
      const urlStr = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`
      const h = new URL(urlStr).hostname
      if (h && !hosts.includes(h)) hosts.push(h)
    } catch {
      // ignore malformed globs
    }
  }

  return hosts
}

/**
 * Build the `suggestedBlocking[]` array from classified findings.
 *
 * Algorithm:
 *   1. Collect the unique set of ServiceDefinitions observed across all
 *      classified cookies, storage, requests, scripts, and iframes.
 *   2. Skip necessary-category services (never blocked) and services with
 *      no derivable blocking host.
 *   3. For each detected service, enumerate ALL its blockable hosts. This
 *      ensures that when multiple services share a host (e.g. GA4 + GTM both
 *      have `googletagmanager.com` in their `requestHosts`) they collapse into
 *      a single entry.
 *   4. Group by blocking host. Services that share a host are merged: the
 *      entry carries all service ids, the most permissive category, and the
 *      highest confidence level observed.
 *   5. Render a snippet for each host entry. The snippet URL is derived from
 *      the primary service's glob patterns; falling back to `https://<host>`.
 *   6. Sort by host name for stable output.
 */
function buildSuggestedBlocking(findings: ClassifiedFindings): SuggestedBlockingEntry[] {
  // Collect unique (serviceId → {ServiceDefinition, max confidence}) entries
  const serviceMap = new Map<string, { svc: ServiceDefinition; confidence: Confidence; category: ServiceCategory }>()

  function addService(svc: ServiceDefinition, confidence: Confidence): void {
    const cat = svc.category
    if (cat === 'necessary') return // never blocked
    const existing = serviceMap.get(svc.id)
    if (existing) {
      existing.confidence = higherConfidence(existing.confidence, confidence)
    } else {
      serviceMap.set(svc.id, { svc, confidence, category: cat })
    }
  }

  for (const c of findings.cookies) addService(c.service, c.confidence)
  for (const s of findings.storage) addService(s.service, s.confidence)
  for (const r of findings.requests) addService(r.service, r.confidence)
  for (const s of findings.scripts) {
    if (s.service) addService(s.service, s.confidence ?? 'low')
  }
  for (const f of findings.iframes) {
    if (f.service) addService(f.service, f.confidence ?? 'low')
  }

  // Group by blocking host.
  // Each service may block on multiple hosts; enumerate all to ensure correct dedup
  // (services sharing a host — e.g. GA4 + GTM on googletagmanager.com — merge into one entry).
  // Map<host, { services: string[], category, confidence, primarySvc }>
  const hostMap = new Map<string, {
    services: string[]
    category: ServiceCategory
    confidence: Confidence
    primarySvc: ServiceDefinition
  }>()

  for (const { svc, confidence, category } of serviceMap.values()) {
    const hosts = allBlockingHosts(svc)
    if (hosts.length === 0) continue // no blockable host — skip

    for (const host of hosts) {
      const existing = hostMap.get(host)
      if (existing) {
        if (!existing.services.includes(svc.id)) {
          existing.services.push(svc.id)
        }
        existing.category = higherCategory(existing.category, category)
        existing.confidence = higherConfidence(existing.confidence, confidence)
      } else {
        hostMap.set(host, {
          services: [svc.id],
          category,
          confidence,
          primarySvc: svc,
        })
      }
    }
  }

  // Build final entries, sorted by host for stable output
  const entries: SuggestedBlockingEntry[] = []
  for (const [host, { services, category, confidence, primarySvc }] of hostMap) {
    entries.push({
      host,
      services: [...services].sort(),
      category,
      confidence,
      snippet: renderSnippet(primarySvc, host, category),
    })
  }

  return entries.sort((a, b) => a.host.localeCompare(b.host))
}

// ---------------------------------------------------------------------------
// Core emitter
// ---------------------------------------------------------------------------

export function emitConfig(findings: ClassifiedFindings): EmittedConfig {
  // Collect all services into per-category buckets
  // Key = `${category}@@${serviceId}`
  const servicesByCategory = new Map<
    ServiceCategory,
    Map<string, EmittedService>
  >()

  // Extra unclassified entries generated during script/iframe processing
  // (e.g. necessary-category scripts — not blocking-relevant but surfaced for awareness)
  const extraUnclassified: EmittedUnclassified[] = []

  // Helper: get/create category bucket
  function bucket(cat: ServiceCategory): Map<string, EmittedService> {
    const existing = servicesByCategory.get(cat)
    if (existing) return existing
    const fresh = new Map<string, EmittedService>()
    servicesByCategory.set(cat, fresh)
    return fresh
  }

  // Helper: add cookies to a service entry
  function addCookies(svc: EmittedService, cookies: string[]): void {
    for (const c of cookies) {
      if (!svc.cookies.includes(c)) svc.cookies.push(c)
    }
  }

  // -----------------------------------------------------------------------
  // From classified cookies
  // -----------------------------------------------------------------------
  for (const cookie of findings.cookies) {
    const cat = cookie.service.category
    const b = bucket(cat)
    const existing = b.get(cookie.service.id)
    if (existing) {
      addCookies(existing, [cookie.name])
      for (const p of cookie.pages) {
        if (!existing._meta.pages.includes(p)) existing._meta.pages.push(p)
      }
    } else {
      b.set(cookie.service.id, {
        name: cookie.service.name,
        cookies: [cookie.name],
        _meta: {
          confidence: cookie.confidence,
          matchedBy: 'cookie',
          serviceId: cookie.service.id,
          pages: [...cookie.pages],
        },
      })
    }
  }

  // -----------------------------------------------------------------------
  // From classified storage
  // -----------------------------------------------------------------------
  for (const storage of findings.storage) {
    const cat = storage.service.category
    const b = bucket(cat)
    const existing = b.get(storage.service.id)
    if (existing) {
      if (storage.type === 'localStorage') {
        if (!existing.localStorage) existing.localStorage = []
        if (!existing.localStorage.includes(storage.key)) {
          existing.localStorage.push(storage.key)
        }
      }
    } else {
      const entry: EmittedService = {
        name: storage.service.name,
        cookies: [],
        _meta: {
          confidence: storage.confidence,
          matchedBy: 'localStorage',
          serviceId: storage.service.id,
          pages: [...storage.pages],
        },
      }
      if (storage.type === 'localStorage') {
        entry.localStorage = [storage.key]
      }
      b.set(storage.service.id, entry)
    }
  }

  // -----------------------------------------------------------------------
  // From classified requests (third-party host matches)
  // -----------------------------------------------------------------------
  for (const req of findings.requests) {
    const cat = req.service.category
    const b = bucket(cat)
    const existing = b.get(req.service.id)
    if (existing) {
      for (const p of req.pages) {
        if (!existing._meta.pages.includes(p)) existing._meta.pages.push(p)
      }
      // Note: request-host matches always return confidence 'medium' (findServiceByHost
      // never returns 'high'), so no confidence upgrade is possible here.
    } else {
      b.set(req.service.id, {
        name: req.service.name,
        cookies: [],
        _meta: {
          confidence: req.confidence,
          matchedBy: 'request-host',
          serviceId: req.service.id,
          pages: [...req.pages],
        },
      })
    }
  }

  // -----------------------------------------------------------------------
  // From classified scripts/iframes with data-category declarations
  // These are the most actionable: the site owner already declared the script
  // with a category, so we use that as the authoritative category.
  // -----------------------------------------------------------------------
  // Collects necessary scripts/iframes surfaced below
  const necessaryScriptIds = new Set<string>()

  for (const script of findings.scripts) {
    if (!script.service && !script.declaredCategory) continue

    const cat = effectiveCategory(script.declaredCategory, script.service)
    if (!cat) continue

    if (cat === 'necessary') {
      // Necessary scripts are always allowed — no blocking needed. Surface them
      // in _unclassified with an informational note so site owners are aware.
      const serviceId = script.service?.id ?? `script:${script.src}`
      if (!necessaryScriptIds.has(serviceId)) {
        necessaryScriptIds.add(serviceId)
        extraUnclassified.push({
          kind: 'script',
          name: script.service?.name ?? script.src,
          detail: 'category: necessary (always allowed — no blocking required)',
          pages: [...script.pages],
          _note: 'This script is classified as necessary and does not need to be blocked. No action required.',
        })
      }
      continue
    }

    const b = bucket(cat)
    const serviceId = script.service?.id ?? `script:${script.src}`
    const existing = b.get(serviceId)
    if (!existing) {
      b.set(serviceId, {
        name: script.service?.name ?? script.src,
        cookies: script.service ? script.service.cookies.map((c) => (c.wildcard ? c.name + '*' : c.name)) : [],
        _meta: {
          confidence: script.confidence ?? 'low',
          matchedBy: script.declaredCategory ? 'declared-category' : 'script-host',
          serviceId,
          pages: [...script.pages],
        },
      })
    } else {
      for (const p of script.pages) {
        if (!existing._meta.pages.includes(p)) existing._meta.pages.push(p)
      }
    }
  }

  const necessaryIframeIds = new Set<string>()

  for (const iframe of findings.iframes) {
    if (!iframe.service && !iframe.declaredCategory) continue

    const cat = effectiveCategory(iframe.declaredCategory, iframe.service)
    if (!cat) continue

    if (cat === 'necessary') {
      // Necessary iframes — surface in _unclassified with informational note
      const serviceId = iframe.service?.id ?? `iframe:${iframe.src}`
      if (!necessaryIframeIds.has(serviceId)) {
        necessaryIframeIds.add(serviceId)
        extraUnclassified.push({
          kind: 'iframe',
          name: iframe.service?.name ?? iframe.src,
          detail: 'category: necessary (always allowed — no blocking required)',
          pages: [...iframe.pages],
          _note: 'This iframe is classified as necessary and does not need to be blocked. No action required.',
        })
      }
      continue
    }

    const b = bucket(cat)
    const serviceId = iframe.service?.id ?? `iframe:${iframe.src}`
    const existing = b.get(serviceId)
    if (!existing) {
      b.set(serviceId, {
        name: iframe.service?.name ?? iframe.src,
        cookies: iframe.service ? iframe.service.cookies.map((c) => (c.wildcard ? c.name + '*' : c.name)) : [],
        _meta: {
          confidence: iframe.confidence ?? 'low',
          matchedBy: iframe.declaredCategory ? 'declared-category' : 'iframe-host',
          serviceId,
          pages: [...iframe.pages],
        },
      })
    } else {
      for (const p of iframe.pages) {
        if (!existing._meta.pages.includes(p)) existing._meta.pages.push(p)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Build final categories object
  // -----------------------------------------------------------------------
  const categories: Partial<Record<ServiceCategory, EmittedCategory>> = {}
  const catOrder: ServiceCategory[] = ['necessary', 'functional', 'analytics', 'marketing']

  for (const cat of catOrder) {
    const b = servicesByCategory.get(cat)
    if (b && b.size > 0) {
      categories[cat] = {
        label: CATEGORY_LABELS[cat],
        services: [...b.values()],
      }
    }
  }

  // -----------------------------------------------------------------------
  // Unclassified artifacts
  // -----------------------------------------------------------------------
  const unclassified: EmittedUnclassified[] = [
    ...findings.unclassified.map((u) => ({
      kind: u.kind,
      name: u.name,
      detail: u.detail,
      pages: u.pages,
      _note:
        'Could not automatically classify this artifact. Review it and move it to the appropriate category in the config above, or add a script/iframe declaration to your HTML with data-category="<category>".',
    })),
    // Necessary-category scripts/iframes: always allowed, surfaced for awareness only
    ...extraUnclassified,
  ]

  // -----------------------------------------------------------------------
  // Noscript warnings
  // -----------------------------------------------------------------------
  const noscriptWarnings: EmittedNoscriptWarning[] = findings.noscriptWarnings.map((w) => ({
    text: w.text.slice(0, 500), // cap for JSON readability
    pages: w.pages,
    _warning:
      'REMOVE THIS <noscript> TAG from your HTML. noscript fallback tags bypass script blocking entirely — they load tracking pixels even when JavaScript is disabled and CANNOT be blocked by Cookyay. Removing them is required for GDPR/CCPA compliance.',
  }))

  return {
    policyVersion: 'REPLACE_ME',
    categories,
    suggestedBlocking: buildSuggestedBlocking(findings),
    _unclassified: unclassified,
    _noscriptWarnings: noscriptWarnings,
    _scanMeta: {
      scannedAt: findings.scannedAt,
      targetUrl: findings.targetUrl,
      pagesVisited: findings.pagesVisited.length,
      classifierVersion: CLASSIFIER_VERSION,
    },
  }
}

// ---------------------------------------------------------------------------
// Conversion helper: strip scanner-only metadata to produce a plain
// CookyayConfig that can be passed directly to Cookyay.init().
//
// The EmittedConfig contains extra fields (_meta on each service, plus
// _unclassified / _noscriptWarnings / _scanMeta at the top level) that are
// useful for review but must be removed before passing to init() — they are
// not part of the CookyayConfig schema.
// ---------------------------------------------------------------------------

export interface CookyayReadyConfig {
  policyVersion: string
  categories: Partial<Record<ServiceCategory, {
    label?: string
    services: { name: string; cookies?: string[]; localStorage?: string[] }[]
  }>>
}

/**
 * Convert an EmittedConfig to a plain CookyayConfig-compatible object.
 * Strips _meta, _unclassified, _noscriptWarnings, _scanMeta.
 * The caller should replace 'REPLACE_ME' in policyVersion with a real value.
 */
export function toCookyayConfig(emitted: EmittedConfig): CookyayReadyConfig {
  const categories: CookyayReadyConfig['categories'] = {}

  for (const [cat, catData] of Object.entries(emitted.categories) as [ServiceCategory, EmittedCategory | undefined][]) {
    if (!catData) continue
    categories[cat] = {
      label: catData.label,
      services: catData.services.map((svc) => ({
        name: svc.name,
        ...(svc.cookies.length > 0 ? { cookies: svc.cookies } : {}),
        ...(svc.localStorage && svc.localStorage.length > 0 ? { localStorage: svc.localStorage } : {}),
      })),
    }
  }

  return {
    policyVersion: emitted.policyVersion,
    categories,
  }
}
