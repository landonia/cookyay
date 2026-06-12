import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COOKIE_NAME,
  LS_KEY,
  buildConsentRecord,
  clearConsent,
  readConsent,
  writeConsent,
} from './storage.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLICY_V = '1.0'
const BANNER_V = '0.1.0'

const ALL_DENIED = {
  necessary: true,
  functional: false,
  analytics: false,
  marketing: false,
}

const ALL_GRANTED = {
  necessary: true,
  functional: true,
  analytics: true,
  marketing: true,
}

function makeRecord(overrides: Partial<ReturnType<typeof buildConsentRecord>> = {}) {
  return { ...buildConsentRecord(ALL_DENIED, POLICY_V, BANNER_V, false), ...overrides }
}

function cookieValue(): string | null {
  const cookies = document.cookie.split(';')
  for (const c of cookies) {
    const [key, ...rest] = c.trim().split('=')
    if (key === COOKIE_NAME) return rest.join('=')
  }
  return null
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear all cookies
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`
  localStorage.clear()
})

afterEach(() => {
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Schema shape
// ---------------------------------------------------------------------------

describe('ConsentRecord schema', () => {
  it('includes all required fields', () => {
    const record = buildConsentRecord(ALL_DENIED, POLICY_V, BANNER_V, false)
    expect(record.schemaVersion).toBe(1)
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(record.bannerVersion).toBe(BANNER_V)
    expect(record.policyVersion).toBe(POLICY_V)
    expect(record.categories).toEqual(ALL_DENIED)
    expect(typeof record.gpc).toBe('boolean')
  })

  it('timestamp is ISO-8601', () => {
    const record = buildConsentRecord(ALL_DENIED, POLICY_V, BANNER_V, false)
    expect(() => new Date(record.timestamp)).not.toThrow()
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp)
  })

  it('includes gpc flag', () => {
    const record = buildConsentRecord(ALL_DENIED, POLICY_V, BANNER_V, true)
    expect(record.gpc).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cookie write
// ---------------------------------------------------------------------------

describe('writeConsent — cookie', () => {
  it('sets cookyay_consent cookie', () => {
    writeConsent(makeRecord())
    expect(cookieValue()).not.toBeNull()
  })

  it('cookie payload is compact (short keys)', () => {
    writeConsent(makeRecord())
    const raw = decodeURIComponent(cookieValue()!)
    const parsed = JSON.parse(raw)
    // Compact: sv, t, pv, bv, c (with n/f/a/m), gpc — no long keys
    expect(parsed).toHaveProperty('sv')
    expect(parsed).toHaveProperty('t')
    expect(parsed).toHaveProperty('pv')
    expect(parsed).toHaveProperty('bv')
    expect(parsed).toHaveProperty('c')
    expect(parsed.c).toHaveProperty('n')
    expect(parsed.c).toHaveProperty('f')
    expect(parsed.c).toHaveProperty('a')
    expect(parsed.c).toHaveProperty('m')
    // Must NOT store long-form keys like 'categories' or 'timestamp' in cookie
    expect(parsed).not.toHaveProperty('categories')
    expect(parsed).not.toHaveProperty('timestamp')
    // t is epoch seconds (a reasonable integer)
    expect(typeof parsed.t).toBe('number')
    expect(parsed.t).toBeGreaterThan(0)
  })

  it('round-trips categories correctly', () => {
    writeConsent(makeRecord({ categories: ALL_GRANTED }))
    const result = readConsent(POLICY_V)
    expect(result?.categories).toEqual(ALL_GRANTED)
  })

  it('cookie string contains SameSite=Lax, Path=/, and default Max-Age (365 days)', () => {
    const spy = vi.spyOn(document, 'cookie', 'set')
    writeConsent(makeRecord())
    const cookieStr = spy.mock.calls[0][0] as string
    expect(cookieStr).toContain('SameSite=Lax')
    expect(cookieStr).toContain('Path=/')
    expect(cookieStr).toContain('Max-Age=31536000')
    spy.mockRestore()
  })

  it('appends Domain attribute when domain option is configured', () => {
    const spy = vi.spyOn(document, 'cookie', 'set')
    writeConsent(makeRecord(), { domain: 'example.com' })
    const cookieStr = spy.mock.calls[0][0] as string
    expect(cookieStr).toContain('Domain=example.com')
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// localStorage mirror
// ---------------------------------------------------------------------------

describe('writeConsent — localStorage mirror', () => {
  it('mirrors the full record to localStorage', () => {
    const record = makeRecord()
    writeConsent(record)
    const raw = localStorage.getItem(LS_KEY)
    expect(raw).not.toBeNull()
    const stored = JSON.parse(raw!)
    expect(stored.schemaVersion).toBe(record.schemaVersion)
    expect(stored.timestamp).toBe(record.timestamp)
    expect(stored.policyVersion).toBe(record.policyVersion)
    expect(stored.bannerVersion).toBe(record.bannerVersion)
    expect(stored.categories).toEqual(record.categories)
    expect(stored.gpc).toBe(record.gpc)
  })

  it('localStorage stores long-form field names (full record)', () => {
    writeConsent(makeRecord())
    const stored = JSON.parse(localStorage.getItem(LS_KEY)!)
    expect(stored).toHaveProperty('categories')
    expect(stored).toHaveProperty('timestamp')
    expect(stored).toHaveProperty('schemaVersion')
  })
})

// ---------------------------------------------------------------------------
// readConsent
// ---------------------------------------------------------------------------

describe('readConsent', () => {
  it('returns null when no consent is stored', () => {
    expect(readConsent(POLICY_V)).toBeNull()
  })

  it('returns the record after writeConsent', () => {
    writeConsent(makeRecord())
    const result = readConsent(POLICY_V)
    expect(result).not.toBeNull()
    expect(result!.policyVersion).toBe(POLICY_V)
  })

  it('returns null when cookie is absent even if localStorage has data', () => {
    // Simulate cookie cleared but localStorage tampered / stale
    writeConsent(makeRecord())
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`
    expect(readConsent(POLICY_V)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Reconciliation — cookie wins
// ---------------------------------------------------------------------------

describe('reconciliation: cookie wins on disagreement', () => {
  it('cookie categories override localStorage categories', () => {
    // Write a record (both cookie and localStorage agree)
    writeConsent(makeRecord({ categories: ALL_DENIED }))

    // Tamper with localStorage to grant analytics
    const lsRaw = JSON.parse(localStorage.getItem(LS_KEY)!)
    lsRaw.categories.analytics = true
    localStorage.setItem(LS_KEY, JSON.stringify(lsRaw))

    // readConsent should use cookie values, not the tampered localStorage
    const result = readConsent(POLICY_V)
    expect(result?.categories.analytics).toBe(false)
  })

  it('cookie policyVersion overrides localStorage policyVersion disagreement', () => {
    writeConsent(makeRecord())

    // Tamper localStorage policyVersion
    const lsRaw = JSON.parse(localStorage.getItem(LS_KEY)!)
    lsRaw.policyVersion = '9.9'
    localStorage.setItem(LS_KEY, JSON.stringify(lsRaw))

    // Cookie says POLICY_V — should still read successfully
    const result = readConsent(POLICY_V)
    expect(result?.policyVersion).toBe(POLICY_V)
  })
})

// ---------------------------------------------------------------------------
// policyVersion invalidation
// ---------------------------------------------------------------------------

describe('policyVersion invalidation', () => {
  it('returns null when stored policyVersion differs from current', () => {
    writeConsent(makeRecord({ policyVersion: '1.0' }))
    expect(readConsent('2.0')).toBeNull()
  })

  it('returns record when policyVersions match', () => {
    writeConsent(makeRecord({ policyVersion: '1.0' }))
    expect(readConsent('1.0')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Unknown schemaVersion → no-consent, not a crash
// ---------------------------------------------------------------------------

describe('unknown schemaVersion', () => {
  it('returns null for an unknown schemaVersion without throwing', () => {
    writeConsent(makeRecord())
    // Directly mutate the cookie to an unknown schema version
    const raw = decodeURIComponent(cookieValue()!)
    const payload = JSON.parse(raw)
    payload.sv = 999
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(payload))}; Path=/`
    expect(() => readConsent(POLICY_V)).not.toThrow()
    expect(readConsent(POLICY_V)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Record expiry → invalidation handled by Max-Age (cookie auto-expires)
// ---------------------------------------------------------------------------

describe('record expiry via cookie Max-Age', () => {
  it('expired cookie (cleared) returns null from readConsent', () => {
    writeConsent(makeRecord())
    // Simulate expiry by clearing the cookie
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`
    expect(readConsent(POLICY_V)).toBeNull()
  })

  it('uses custom expiryDays as Max-Age in the cookie string', () => {
    const spy = vi.spyOn(document, 'cookie', 'set')
    writeConsent(makeRecord(), { expiryDays: 30 })
    const cookieStr = spy.mock.calls[0][0] as string
    expect(cookieStr).toContain('Max-Age=2592000') // 30 * 24 * 3600
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Timestamp persistence — survives without localStorage
// ---------------------------------------------------------------------------

describe('timestamp persistence', () => {
  it('timestamp round-trips exactly via cookie (no localStorage required)', () => {
    const record = makeRecord()
    writeConsent(record)
    // Remove localStorage; cookie still carries `t` (epoch seconds)
    localStorage.clear()
    const result = readConsent(POLICY_V)
    // Epoch-second precision means the round-tripped ISO string may differ by
    // sub-second fractions — compare truncated to the second
    const expected = new Date(
      Math.floor(new Date(record.timestamp).getTime() / 1000) * 1000,
    ).toISOString()
    expect(result?.timestamp).toBe(expected)
  })

  it('timestamp is NOT fabricated as "now" when localStorage is absent', () => {
    const record = makeRecord()
    writeConsent(record)
    localStorage.clear()
    const before = Date.now()
    const result = readConsent(POLICY_V)
    const resultMs = new Date(result!.timestamp).getTime()
    // The timestamp must come from the stored record, not from the current time
    expect(resultMs).toBeLessThan(before)
    // (before is at least the same millisecond as the write; result is from the
    //  stored epoch-second, so it is <= the write time truncated to the second)
  })
})

// ---------------------------------------------------------------------------
// Init path: nothing written before a consent decision
// ---------------------------------------------------------------------------

describe('init path — no pre-consent writes', () => {
  it('readConsent does not write any cookie or localStorage entry', () => {
    // Spy on document.cookie setter and localStorage.setItem
    const cookieSetSpy = vi.spyOn(document, 'cookie', 'set')
    const lsSetSpy = vi.spyOn(Storage.prototype, 'setItem')

    readConsent(POLICY_V)

    expect(cookieSetSpy).not.toHaveBeenCalled()
    expect(lsSetSpy).not.toHaveBeenCalled()

    cookieSetSpy.mockRestore()
    lsSetSpy.mockRestore()
  })

  it('clearConsent does not write localStorage items', () => {
    const lsSetSpy = vi.spyOn(Storage.prototype, 'setItem')
    clearConsent()
    expect(lsSetSpy).not.toHaveBeenCalled()
    lsSetSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// clearConsent
// ---------------------------------------------------------------------------

describe('clearConsent', () => {
  it('removes cookie and localStorage entry', () => {
    writeConsent(makeRecord())
    clearConsent()
    expect(readConsent(POLICY_V)).toBeNull()
    expect(localStorage.getItem(LS_KEY)).toBeNull()
  })
})
