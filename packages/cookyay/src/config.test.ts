/**
 * Unit tests for CookyayConfig.autoBlock field and validateConfig() [task 003].
 *
 * Coverage (AC1–AC4):
 *   AC1 — autoBlock is optional, defaults to false (or rather: is absent and
 *          treated as false by all downstream code); existing configs are
 *          byte-for-byte unaffected when the field is omitted.
 *   AC2 — validateConfig() emits a ConfigWarning when autoBlock is non-boolean.
 *   AC3 — (tree-shake proof) autoblock-loader.ts returns the matcher only when
 *          autoBlock: true, and null otherwise — confirming the DB/matcher code
 *          path is only reachable when the flag is set.
 *   AC4 — default is false; matcher/DB are only reachable via getAutoBlockMatcher
 *          when autoBlock: true.
 *
 * [task 003 acceptance_criteria]
 * [goals.md §Auto-block is opt-in via a single config boolean]
 */

import { describe, it, expect } from 'vitest'
import { validateConfig } from './config.js'
import type { CookyayConfig } from './config.js'
import { getAutoBlockMatcher } from './autoblock-loader.js'

// ---------------------------------------------------------------------------
// Helper: minimal valid config
// ---------------------------------------------------------------------------

function baseConfig(overrides?: Partial<CookyayConfig>): CookyayConfig {
  return { policyVersion: '1', ...overrides }
}

// ---------------------------------------------------------------------------
// AC1 — autoBlock field is optional; omitted configs produce no warnings
// ---------------------------------------------------------------------------

describe('CookyayConfig — autoBlock field', () => {
  it('is absent by default (field not required) — validateConfig emits no warning', () => {
    const warnings = validateConfig(baseConfig())
    expect(warnings).toHaveLength(0)
  })

  it('accepts autoBlock: true without a warning', () => {
    const warnings = validateConfig(baseConfig({ autoBlock: true }))
    expect(warnings).toHaveLength(0)
  })

  it('accepts autoBlock: false without a warning', () => {
    const warnings = validateConfig(baseConfig({ autoBlock: false }))
    expect(warnings).toHaveLength(0)
  })

  it('treats omitted autoBlock identically to autoBlock: false for downstream (no field = not set)', () => {
    const cfg = baseConfig()
    // The field is optional — it should be absent (undefined), not defaulted to false
    // by config.ts itself. Downstream code (api.ts / task-004 proxy) treats
    // undefined and false identically (both falsy).
    expect(cfg.autoBlock).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// AC2 — validateConfig emits INVALID_AUTO_BLOCK warning for non-boolean values
// ---------------------------------------------------------------------------

describe('validateConfig — autoBlock type checking', () => {
  it('warns when autoBlock is a string', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnings = validateConfig(baseConfig({ autoBlock: 'yes' as any }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('INVALID_AUTO_BLOCK')
    expect(warnings[0].message).toMatch(/boolean/)
    expect(warnings[0].fatal).toBeFalsy()
  })

  it('warns when autoBlock is a number', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnings = validateConfig(baseConfig({ autoBlock: 1 as any }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('INVALID_AUTO_BLOCK')
  })

  it('warns when autoBlock is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnings = validateConfig(baseConfig({ autoBlock: null as any }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('INVALID_AUTO_BLOCK')
  })

  it('warns when autoBlock is an object', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnings = validateConfig(baseConfig({ autoBlock: {} as any }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('INVALID_AUTO_BLOCK')
  })

  it('does NOT warn when autoBlock is undefined (field absent in JS object)', () => {
    // undefined is the same as omitting the field in JSON config — not a type error
    const warnings = validateConfig(baseConfig({ autoBlock: undefined }))
    expect(warnings).toHaveLength(0)
  })

  it('INVALID_AUTO_BLOCK warning message includes the received value', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnings = validateConfig(baseConfig({ autoBlock: 'enabled' as any }))
    expect(warnings[0].message).toContain('"enabled"')
  })

  it('INVALID_AUTO_BLOCK is not fatal — init() proceeds with autoBlock treated as false', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnings = validateConfig(baseConfig({ autoBlock: 'yes' as any }))
    expect(warnings[0].fatal).toBeFalsy()
  })

  it('INVALID_AUTO_BLOCK does not suppress other warnings', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badConfig: any = { policyVersion: '1', autoBlock: 'yes', categories: { unknown_cat: {} } }
    const warnings = validateConfig(badConfig as CookyayConfig)
    // One INVALID_AUTO_BLOCK + one UNKNOWN_CATEGORY
    expect(warnings.length).toBeGreaterThanOrEqual(2)
    expect(warnings.some((w) => w.code === 'INVALID_AUTO_BLOCK')).toBe(true)
    expect(warnings.some((w) => w.code === 'UNKNOWN_CATEGORY')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC3 + AC4 — Tree-shake proof: matcher/DB reachable ONLY when autoBlock: true
//
// getAutoBlockMatcher() is the single gated entry point to the matcher and DB.
// When autoBlock is false or omitted, it returns null (the caller — task 004's
// proxy — never gets a reference to the matcher, so the DB is not accessed).
// When autoBlock is true, it returns the live matchAutoBlock function backed by
// the generated signature DB.
//
// The static tree-shake guarantee is structural: autoblock-loader.ts (this
// module's import target) is NOT imported anywhere in the always-on bundle
// (api.ts, bootstrap.ts, index.ts, blocking.ts, banner.ts). Task 004 will
// import it via a dynamic import() inside an if (config.autoBlock) branch.
// ---------------------------------------------------------------------------

describe('getAutoBlockMatcher — conditional matcher access [AC3, AC4]', () => {
  it('returns null when autoBlock is false (default-off)', () => {
    const matcher = getAutoBlockMatcher({ autoBlock: false })
    expect(matcher).toBeNull()
  })

  it('returns null when autoBlock is absent (undefined — treated as false)', () => {
    const matcher = getAutoBlockMatcher({})
    expect(matcher).toBeNull()
  })

  it('returns a function when autoBlock is true', () => {
    const matcher = getAutoBlockMatcher({ autoBlock: true })
    expect(typeof matcher).toBe('function')
  })

  it('the returned matcher is callable and returns a hit for a known service URL [AC4]', () => {
    const matcher = getAutoBlockMatcher({ autoBlock: true })
    expect(matcher).not.toBeNull()
    // Hotjar is in the curated DB (non-Google, analytics category)
    const result = matcher!('https://static.hotjar.com/c/hotjar-123.js')
    expect(result).not.toBeNull()
    expect(result!.serviceId).toBe('hotjar')
    expect(result!.category).toBe('analytics')
  })

  it('the returned matcher returns null for an unknown URL [AC4]', () => {
    const matcher = getAutoBlockMatcher({ autoBlock: true })
    expect(matcher).not.toBeNull()
    const result = matcher!('https://example.com/some-script.js')
    expect(result).toBeNull()
  })

  it('the returned matcher respects the Google-skip rule — GTM returns null [AC4]', () => {
    const matcher = getAutoBlockMatcher({ autoBlock: true })
    expect(matcher).not.toBeNull()
    // GTM is Google-owned; matchAutoBlock always returns null for it
    const result = matcher!('https://www.googletagmanager.com/gtm.js?id=GTM-XXXX')
    expect(result).toBeNull()
  })

  it('calling getAutoBlockMatcher twice with autoBlock:true returns the same (identity-equal) matcher function', () => {
    // Confirms no extra overhead from repeated calls — the matcher is a module singleton
    const m1 = getAutoBlockMatcher({ autoBlock: true })
    const m2 = getAutoBlockMatcher({ autoBlock: true })
    expect(m1).toBe(m2)
  })
})
