/**
 * E2E tests for scanner auto-detection path (task 009).
 *
 * Two test groups:
 *
 * 1. Golden-file test: crawl fixtures/detection/mixed-signals.html, classify,
 *    and compare the normalized output to e2e/expected-detection-config.json.
 *    The same normalizeConfig() helper used by scanner-classify.spec.ts handles
 *    non-deterministic parts (scannedAt, page URL port).
 *
 * 2. Detection fixture smoke tests:
 *    - cookie-signals.html  → detects GA4, Meta Pixel, Hotjar from cookies
 *    - localstorage-signals.html → detects Segment, Hotjar from localStorage
 *    - no-signals.html      → zero classified services, empty _unclassified
 *
 * These tests exercise the crawl → classify → emitConfig path end-to-end
 * against hermetic fixture pages with no real third-party network calls.
 *
 * Fixture server is started by playwright.config.ts webServer (port 4001).
 * Build order: pnpm --filter cookyay build, then pnpm --filter @cookyay/scanner build.
 */
import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crawl } from '../src/crawler.js'
import { classify } from '../src/classifier.js'
import { emitConfig } from '../src/config-emitter.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE_BASE = 'http://127.0.0.1:4001'

// ---------------------------------------------------------------------------
// Normalization helper — mirrors the one in scanner-classify.spec.ts
// ---------------------------------------------------------------------------

function normalizeConfig(config: unknown, fixtureBase: string): unknown {
  const json = JSON.stringify(config)
  const normalized = json
    // Replace the fixture server base URL with a stable placeholder
    .replace(new RegExp(fixtureBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'FIXTURE_BASE')
    // Replace the scannedAt timestamp with a stable placeholder
    .replace(/"scannedAt"\s*:\s*"[^"]*"/g, '"scannedAt": "NORMALIZED"')
  return JSON.parse(normalized)
}

// ---------------------------------------------------------------------------
// Golden-file test — mixed-signals.html
// ---------------------------------------------------------------------------

test('detection golden: mixed-signals.html produces byte-stable config', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/mixed-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)
  const normalized = normalizeConfig(config, FIXTURE_BASE)

  const goldenPath = join(__dirname, 'expected-detection-config.json')
  expect(existsSync(goldenPath)).toBe(true)
  const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'))

  expect(normalized).toEqual(golden)
})

// ---------------------------------------------------------------------------
// Detection smoke tests
// ---------------------------------------------------------------------------

test('detection: cookie-signals.html detects GA4, Meta Pixel, and Hotjar', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/cookie-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  // GA4 — analytics (from _ga cookie)
  expect(config.categories.analytics).toBeDefined()
  const analyticsSvcIds = config.categories.analytics!.services.map((s) => s._meta.serviceId)
  expect(analyticsSvcIds.some((id) => id === 'ga4')).toBe(true)

  // Meta Pixel — marketing (from _fbp cookie)
  expect(config.categories.marketing).toBeDefined()
  const marketingSvcIds = config.categories.marketing!.services.map((s) => s._meta.serviceId)
  expect(marketingSvcIds.some((id) => id === 'meta-pixel')).toBe(true)

  // Hotjar — analytics (from _hjid cookie; same category as GA4)
  expect(analyticsSvcIds.some((id) => id === 'hotjar')).toBe(true)
})

test('detection: cookie-signals.html classified services have medium or high confidence', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/cookie-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  const allServices = Object.values(config.categories).flatMap((cat) => cat?.services ?? [])
  expect(allServices.length).toBeGreaterThan(0)

  for (const svc of allServices) {
    // Cookie-only detections yield 'medium'; two-signal detections yield 'high'.
    // No pure cookie-signal detection should come back as 'low'.
    expect(['medium', 'high']).toContain(svc._meta.confidence)
  }
})

test('detection: localstorage-signals.html detects Segment and Hotjar', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/localstorage-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  // Both Segment and Hotjar are analytics
  expect(config.categories.analytics).toBeDefined()
  const analyticsSvcIds = config.categories.analytics!.services.map((s) => s._meta.serviceId)

  // Segment (ajs_user_id localStorage)
  expect(analyticsSvcIds.some((id) => id === 'segment')).toBe(true)

  // Hotjar (_hjSessionId localStorage)
  expect(analyticsSvcIds.some((id) => id === 'hotjar')).toBe(true)
})

test('detection: no-signals.html produces zero classified services', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/no-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  // No classified services
  const allServices = Object.values(config.categories).flatMap((cat) => cat?.services ?? [])
  expect(allServices).toHaveLength(0)

  // No suggested blocking
  expect(config.suggestedBlocking).toHaveLength(0)

  // _unclassified should be empty for a truly clean page
  expect(config._unclassified).toHaveLength(0)
})

test('detection: mixed-signals.html detects all four representative services', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/mixed-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  // GA4 — analytics
  expect(config.categories.analytics).toBeDefined()
  const analyticsSvcIds = config.categories.analytics!.services.map((s) => s._meta.serviceId)
  expect(analyticsSvcIds.some((id) => id === 'ga4')).toBe(true)

  // Hotjar — analytics
  expect(analyticsSvcIds.some((id) => id === 'hotjar')).toBe(true)

  // Segment — analytics
  expect(analyticsSvcIds.some((id) => id === 'segment')).toBe(true)

  // Meta Pixel — marketing
  expect(config.categories.marketing).toBeDefined()
  const marketingSvcIds = config.categories.marketing!.services.map((s) => s._meta.serviceId)
  expect(marketingSvcIds.some((id) => id === 'meta-pixel')).toBe(true)

  // Google Ads — marketing
  expect(marketingSvcIds.some((id) => id === 'google-ads')).toBe(true)
})

test('detection: mixed-signals.html includes suggestedBlocking entries', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/mixed-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  // suggestedBlocking should be populated — each detected service with a
  // derivable blocking host gets an entry (e.g. GA4 → google-analytics.com)
  expect(config.suggestedBlocking.length).toBeGreaterThan(0)

  for (const entry of config.suggestedBlocking) {
    expect(entry.host).toBeTruthy()
    expect(entry.services.length).toBeGreaterThan(0)
    expect(['necessary', 'functional', 'analytics', 'marketing']).toContain(entry.category)
    expect(['low', 'medium', 'high']).toContain(entry.confidence)
    expect(entry.snippet).toBeTruthy()
  }
})

test('detection: mixed-signals.html suggestedBlocking entries are sorted by host', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/mixed-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  const hosts = config.suggestedBlocking.map((e) => e.host)
  const sorted = [...hosts].sort((a, b) => a.localeCompare(b))
  expect(hosts).toEqual(sorted)
})

// ---------------------------------------------------------------------------
// Script-src + iframe-src host classification (AC3: host-detection in spec)
// ---------------------------------------------------------------------------

test('detection: script-iframe-signals.html detects GA4 via script-src host and YouTube via iframe-src host', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/script-iframe-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  // GA4 detected via script-src host (www.googletagmanager.com → googletagmanager.com)
  expect(config.categories.analytics).toBeDefined()
  const analyticsServices = config.categories.analytics!.services
  const ga4Entry = analyticsServices.find((s) => s._meta.serviceId === 'ga4')
  expect(ga4Entry).toBeDefined()
  // matchedBy must reflect the script-host path — not cookie or localStorage
  expect(ga4Entry!._meta.matchedBy).toBe('script-host')

  // YouTube detected via iframe data-src host (www.youtube.com → youtube.com)
  expect(config.categories.marketing).toBeDefined()
  const marketingServices = config.categories.marketing!.services
  const ytEntry = marketingServices.find((s) => s._meta.serviceId === 'youtube')
  expect(ytEntry).toBeDefined()
  // matchedBy must reflect the iframe-host path — not cookie or localStorage
  expect(ytEntry!._meta.matchedBy).toBe('iframe-host')
})

test('detection: script-iframe-signals.html suggestedBlocking includes GTM and YouTube hosts', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/script-iframe-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  const blockingHosts = config.suggestedBlocking.map((e) => e.host)
  // GA4 blocking hosts include googletagmanager.com (the script src host)
  expect(blockingHosts.some((h) => h === 'googletagmanager.com')).toBe(true)
  // YouTube blocking hosts include youtube.com (the iframe data-src host)
  expect(blockingHosts.some((h) => h === 'youtube.com')).toBe(true)
})

// ---------------------------------------------------------------------------
// Host-dedup case (AC3: dedup asserted in the Playwright spec)
// ---------------------------------------------------------------------------

test('detection: mixed-signals.html host-dedup — GA4 and UA share google-analytics.com', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/detection/mixed-signals.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const classified = classify(findings)
  const config = emitConfig(classified)

  // Both GA4 (_ga cookie) and UA (__utma cookie) share google-analytics.com.
  // The emitter must produce exactly ONE suggestedBlocking entry for that host
  // listing both service ids — this is 007's dedup behavior.
  const gaAnalyticsEntry = config.suggestedBlocking.find((e) => e.host === 'google-analytics.com')
  expect(gaAnalyticsEntry).toBeDefined()
  expect(gaAnalyticsEntry!.services).toContain('ga4')
  expect(gaAnalyticsEntry!.services).toContain('ua')

  // There must be exactly one entry for this host (dedup worked — not two separate entries)
  const gaAnalyticsEntries = config.suggestedBlocking.filter((e) => e.host === 'google-analytics.com')
  expect(gaAnalyticsEntries).toHaveLength(1)
})
