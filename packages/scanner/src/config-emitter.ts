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
import type { Confidence, ServiceCategory } from './db.js'

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
