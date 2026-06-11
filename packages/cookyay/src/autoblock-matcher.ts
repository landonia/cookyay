/**
 * Client-side auto-block URL matcher — matchAutoBlock(url) → {serviceId, category} | null
 *
 * Pure function: zero runtime dependencies, no DOM access, callable in
 * Node, jsdom, or the browser. Used by the v5 runtime interception proxy
 * (task 004) and the scanner↔banner parity test (task 007).
 *
 * Matching rules (author-decided, research/_index.md §Update):
 *   1. A single host OR path signal is sufficient to return a hit
 *      ("medium" threshold — v4's two-signal "high" is unreachable at load
 *      time since no cookies exist yet).
 *   2. Google-owned services (google: true) are NEVER returned — Consent Mode
 *      v2 degrades them instead; DOM-blocking GTM/GA4 would suppress all CM v2
 *      update signals [goals.md §Consent Mode v2: skip Google tags, prd.md §3.4].
 *   3. Shared-CDN hosts require a scriptUrlGlob match for disambiguation:
 *      when a service's requestHosts entry is a shared CDN, it MUST carry a
 *      non-empty scriptUrlGlobs list; a host-only match is insufficient.
 *      (Currently no production service uses this path, but the logic is
 *      correct and tested.)
 *
 * Performance notes (research/performance-engineer.md §Findings 7):
 *   The ~50-service set is tiny; a plain Map/Set of hosts gives O(1) lookups.
 *   No trie or regex engine is needed. The index is built once at module
 *   initialisation and reused across all calls.
 *
 * [architecture.md §Amendments 2026-06-10 — v4 architecture decisions (amend)]
 * [goals.md §Client-side signature recognition, §Confidence threshold]
 * [research/performance-engineer.md §Recommendations 3]
 */

import type { AutoBlockCategory, AutoBlockEntry } from './db-autoblock.types.js'
import { AUTOBLOCK_SERVICES } from './db-autoblock.generated.js'

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface AutoBlockMatch {
  /** Stable slug identifying the matched service. */
  serviceId: string
  /** Consent category the service belongs to. */
  category: AutoBlockCategory
}

// ---------------------------------------------------------------------------
// Index — built once, reused across all matchAutoBlock() calls
// ---------------------------------------------------------------------------

interface IndexedEntry {
  entry: AutoBlockEntry
  /** True when this entry has at least one scriptUrlGlob, meaning host-only
   *  matching is insufficient for disambiguation (shared-CDN guard). */
  requiresGlobMatch: boolean
}

/**
 * Maps a normalised hostname → list of service index entries.
 * A hostname may appear in multiple services' requestHosts (e.g.
 * google-analytics.com appears in both ga4 and ua) — both are stored here;
 * the first non-Google hit wins.
 */
type HostIndex = Map<string, IndexedEntry[]>

/**
 * A requestPaths entry parsed into its constituent components.
 */
interface PathEntry {
  /** Hostname part of the "host/path" string, e.g. "facebook.com". */
  host: string
  /** Path prefix part (with leading '/'), e.g. "/tr". */
  path: string
  /** Reference back to the service entry. */
  indexed: IndexedEntry
}

interface AutoBlockIndex {
  hostIndex: HostIndex
  pathEntries: PathEntry[]
}

/**
 * Build the lookup index from the generated DB.
 * Called once at module load time; exported for test introspection only.
 */
export function _buildIndex(services: AutoBlockEntry[]): AutoBlockIndex {
  const hostIndex: HostIndex = new Map()
  const pathEntries: PathEntry[] = []

  for (const entry of services) {
    // Skip Google-owned services — Consent Mode v2 handles them.
    if (entry.google) continue

    const requiresGlobMatch =
      Array.isArray(entry.scriptUrlGlobs) && entry.scriptUrlGlobs.length > 0

    const indexed: IndexedEntry = { entry, requiresGlobMatch }

    // Index requestHosts
    for (const h of entry.requestHosts ?? []) {
      const normalised = h.toLowerCase()
      const list = hostIndex.get(normalised)
      if (list) {
        list.push(indexed)
      } else {
        hostIndex.set(normalised, [indexed])
      }
    }

    // Index requestPaths — each entry is "host/path"
    for (const rp of entry.requestPaths ?? []) {
      const slashIdx = rp.indexOf('/')
      if (slashIdx === -1) continue // malformed — skip
      const rpHost = rp.slice(0, slashIdx).toLowerCase()
      const rpPath = rp.slice(slashIdx) // includes the leading '/'
      pathEntries.push({ host: rpHost, path: rpPath, indexed })
    }
  }

  return { hostIndex, pathEntries }
}

// Module-level singleton index — built from the generated DB.
const _INDEX: AutoBlockIndex = _buildIndex(AUTOBLOCK_SERVICES)

// ---------------------------------------------------------------------------
// Simple glob matcher
// ---------------------------------------------------------------------------

/**
 * Test whether `str` matches `pattern` where `*` in the pattern matches any
 * sequence of characters (including none).
 *
 * Example: `matchGlob("*.gtm.js*", "https://www.googletagmanager.com/gtm.js?id=GTM-XXX")` → true
 *
 * This is intentionally simple: only `*` is special; `?`, `[…]`, and
 * `{…}` are treated as literals. This is sufficient for URL glob patterns
 * of the form `"*.example.com/script.js*"`.
 */
export function _matchGlob(pattern: string, str: string): boolean {
  // Fast path: no wildcard — exact match
  if (!pattern.includes('*')) return pattern === str

  // Split pattern on '*' and match greedily left-to-right.
  const parts = pattern.split('*')
  let pos = 0

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.length === 0) continue

    const found = str.indexOf(part, pos)
    if (found === -1) return false

    // First segment must match at the start of the string
    if (i === 0 && found !== 0) return false

    pos = found + part.length
  }

  // Last segment (after the final '*') must match at the end of the string
  // unless the pattern ends with '*' (empty last part).
  const lastPart = parts[parts.length - 1]
  if (lastPart.length > 0) {
    return str.endsWith(lastPart)
  }

  return true
}

// ---------------------------------------------------------------------------
// Host normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Extract and normalise the hostname from a URL string.
 * Returns `null` for relative URLs (always first-party — never need blocking)
 * or malformed URLs that cannot be parsed.
 *
 * Normalisation: lowercase, no trailing dot.
 */
function _extractHost(url: string): string | null {
  // Relative URLs start without a scheme — they are first-party; skip them.
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null

  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Test whether `candidateHost` matches the DB entry host `entryHost`
 * using exact OR subdomain matching (same rules as scanner's db.ts).
 *
 * Examples:
 *   "hotjar.com"        matches "hotjar.com"       (exact)
 *   "static.hotjar.com" matches "hotjar.com"       (subdomain)
 *   "nothotjar.com"     does NOT match "hotjar.com" (no substring match)
 */
function _hostMatches(candidateHost: string, entryHost: string): boolean {
  return candidateHost === entryHost || candidateHost.endsWith(`.${entryHost}`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Test whether `url` matches a known, blockable third-party service.
 *
 * @param url  Absolute URL string (e.g. `"https://static.hotjar.com/c/hotjar.js"`).
 *             Relative URLs always return `null` (first-party, not blockable).
 *
 * @returns `{ serviceId, category }` on a hit, or `null` on no match.
 *
 * Matching algorithm:
 *   1. Extract and lowercase the hostname. Relative → null immediately.
 *   2. Host lookup (O(1) via Map): if the host (or a parent domain) appears in
 *      a service's `requestHosts`:
 *      a. If `requiresGlobMatch` is true (shared-CDN service), ALSO require
 *         that the full URL matches at least one of the service's `scriptUrlGlobs`.
 *         No glob match → no hit (prevents false-positives on shared CDNs).
 *      b. Otherwise, return the hit immediately.
 *   3. Path lookup (linear over ~2 entries): if no host hit, test `requestPaths`.
 *      Each entry is "host/path"; both host and path must match simultaneously.
 *   4. Return null if neither check hits.
 *
 * Google-owned services are excluded at index build time (never in the index).
 */
export function matchAutoBlock(url: string): AutoBlockMatch | null {
  const host = _extractHost(url)
  if (host === null) return null

  const { hostIndex, pathEntries } = _INDEX

  // --- Step 1: Host index lookup ---
  // Check for exact host match, then progressively strip leading labels to
  // find a parent-domain match (e.g. "static.hotjar.com" → "hotjar.com").
  //
  // We try exact first, then iterate parent domains to avoid O(n) scan of
  // the full 99-host index. For a ~50-service / ~99-host set this is at most
  // ~5 Map.get() calls per URL.
  const hostCandidates: string[] = [host]
  {
    let h = host
    while (h.includes('.')) {
      const dot = h.indexOf('.')
      h = h.slice(dot + 1)
      hostCandidates.push(h)
    }
  }

  for (const candidate of hostCandidates) {
    const entries = hostIndex.get(candidate)
    if (!entries) continue

    for (const indexed of entries) {
      const { entry, requiresGlobMatch } = indexed

      if (requiresGlobMatch) {
        // Shared-CDN: require a scriptUrlGlob match to avoid false-positives
        const globs = entry.scriptUrlGlobs!
        const globMatches = globs.some((g) => _matchGlob(g, url))
        if (!globMatches) continue // skip — CDN false-positive guard
      }

      return { serviceId: entry.id, category: entry.category }
    }
  }

  // --- Step 2: Path lookup ---
  // requestPaths entries: each is "host/path"; both host and pathname must match.
  let pathname: string | null = null
  try {
    pathname = new URL(url).pathname
  } catch {
    // Malformed URL — host extraction succeeded above but pathname parse failed.
    // This is unlikely; fall through and return null.
  }

  if (pathname !== null) {
    for (const pe of pathEntries) {
      if (_hostMatches(host, pe.host) && pathname.startsWith(pe.path)) {
        const { entry } = pe.indexed
        return { serviceId: entry.id, category: entry.category }
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Test-only: allow rebuilding the index from a custom DB (for CDN-glob tests)
// ---------------------------------------------------------------------------

/**
 * Create an isolated matcher function backed by a custom service list.
 * For unit testing only — not part of the public API.
 */
export function _createMatcher(
  services: AutoBlockEntry[],
): (url: string) => AutoBlockMatch | null {
  const index = _buildIndex(services)
  return function matchAutoBlockCustom(url: string): AutoBlockMatch | null {
    const host = _extractHost(url)
    if (host === null) return null

    const { hostIndex, pathEntries } = index

    const hostCandidates: string[] = [host]
    {
      let h = host
      while (h.includes('.')) {
        const dot = h.indexOf('.')
        h = h.slice(dot + 1)
        hostCandidates.push(h)
      }
    }

    for (const candidate of hostCandidates) {
      const entries = hostIndex.get(candidate)
      if (!entries) continue

      for (const indexed of entries) {
        const { entry, requiresGlobMatch } = indexed

        if (requiresGlobMatch) {
          const globs = entry.scriptUrlGlobs!
          const globMatches = globs.some((g) => _matchGlob(g, url))
          if (!globMatches) continue
        }

        return { serviceId: entry.id, category: entry.category }
      }
    }

    let closurePathname: string | null = null
    try {
      closurePathname = new URL(url).pathname
    } catch {
      // Malformed URL — fall through
    }

    if (closurePathname !== null) {
      for (const pe of pathEntries) {
        if (_hostMatches(host, pe.host) && closurePathname.startsWith(pe.path)) {
          const { entry } = pe.indexed
          return { serviceId: entry.id, category: entry.category }
        }
      }
    }

    return null
  }
}
