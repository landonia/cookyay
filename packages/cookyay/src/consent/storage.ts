import {
  CURRENT_SCHEMA_VERSION,
  type CategoryId,
  type ConsentRecord,
  type CookiePayload,
} from './types.js'

export const COOKIE_NAME = 'cookyay_consent'
export const LS_KEY = 'cookyay_consent'

const DEFAULT_EXPIRY_DAYS = 365

export interface WriteOptions {
  domain?: string
  expiryDays?: number
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function buildCookieString(payload: CookiePayload, opts: WriteOptions): string {
  const value = encodeURIComponent(JSON.stringify(payload))
  const maxAge = (opts.expiryDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60
  let cookie = `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax`
  if (opts.domain) cookie += `; Domain=${opts.domain}`
  return cookie
}

function recordToCookiePayload(record: ConsentRecord): CookiePayload {
  return {
    sv: record.schemaVersion,
    t: Math.floor(new Date(record.timestamp).getTime() / 1000),
    pv: record.policyVersion,
    bv: record.bannerVersion,
    c: {
      n: record.categories.necessary,
      f: record.categories.functional,
      a: record.categories.analytics,
      m: record.categories.marketing,
    },
    gpc: record.gpc,
  }
}

function cookiePayloadToRecord(payload: CookiePayload): ConsentRecord {
  return {
    schemaVersion: payload.sv,
    timestamp: new Date(payload.t * 1000).toISOString(),
    bannerVersion: payload.bv,
    policyVersion: payload.pv,
    categories: {
      necessary: payload.c.n,
      functional: payload.c.f,
      analytics: payload.c.a,
      marketing: payload.c.m,
    },
    gpc: payload.gpc,
  }
}

function parseCookiePayload(raw: string): CookiePayload | null {
  try {
    const obj = JSON.parse(decodeURIComponent(raw)) as unknown
    if (!obj || typeof obj !== 'object') return null
    const p = obj as Record<string, unknown>
    if (
      typeof p['sv'] !== 'number' ||
      typeof p['t'] !== 'number' ||
      typeof p['pv'] !== 'string' ||
      typeof p['bv'] !== 'string' ||
      typeof p['gpc'] !== 'boolean' ||
      !p['c'] ||
      typeof p['c'] !== 'object'
    ) {
      return null
    }
    const c = p['c'] as Record<string, unknown>
    if (
      typeof c['n'] !== 'boolean' ||
      typeof c['f'] !== 'boolean' ||
      typeof c['a'] !== 'boolean' ||
      typeof c['m'] !== 'boolean'
    ) {
      return null
    }
    return p as unknown as CookiePayload
  } catch {
    return null
  }
}

function getCookieValue(name: string): string | null {
  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a consent record. This is the only function allowed to write
 * to cookies or localStorage — nothing else may write pre-consent.
 */
export function writeConsent(record: ConsentRecord, opts: WriteOptions = {}): void {
  document.cookie = buildCookieString(recordToCookiePayload(record), opts)
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(record))
  } catch {
    // quota or private-browsing — cookie is already written, continue
  }
}

/**
 * Read the stored consent record.
 *
 * Cookie is the sole source of truth (architecture §6). Timestamp is
 * carried in the cookie payload (`t`, epoch seconds). localStorage is
 * a write-only rich mirror and is never read back by this function.
 */
export function readConsent(currentPolicyVersion: string): ConsentRecord | null {
  const cookieRaw = getCookieValue(COOKIE_NAME)

  // No cookie → no valid consent (localStorage alone is not authoritative)
  if (!cookieRaw) return null

  const payload = parseCookiePayload(cookieRaw)

  // Unparseable cookie → no-consent
  if (!payload) return null

  // Unknown schema version → no-consent (not a crash)
  if (payload.sv !== CURRENT_SCHEMA_VERSION) return null

  // policyVersion mismatch → invalidate
  if (payload.pv !== currentPolicyVersion) return null

  return cookiePayloadToRecord(payload)
}

/**
 * Remove the consent record from both cookie and localStorage.
 * Used during withdrawal or forced re-prompt.
 */
export function clearConsent(opts: WriteOptions = {}): void {
  let cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`
  if (opts.domain) cookie += `; Domain=${opts.domain}`
  document.cookie = cookie
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    // ignore
  }
}

/**
 * Build a ConsentRecord for writing. Centralises record construction so
 * callers cannot forget required fields.
 */
export function buildConsentRecord(
  categories: Record<CategoryId, boolean>,
  policyVersion: string,
  bannerVersion: string,
  gpc: boolean,
): ConsentRecord {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    bannerVersion,
    policyVersion,
    categories,
    gpc,
  }
}
