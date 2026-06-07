/**
 * Integration test: scanner crawler against the hermetic fixture site (task 012).
 *
 * The fixture server is started by playwright.config.ts webServer.
 * The cookyay package must be built before running: pnpm --filter cookyay build
 *
 * Verifies that crawl() deterministically captures the synthetic trackers'
 * artifacts declared in fixtures/blocking/all.html — blocked scripts with
 * data-category attributes and a blocked iframe with data-src.
 */
import { test, expect } from '@playwright/test'
import { crawl } from '../src/crawler.js'

const FIXTURE_BASE = 'http://127.0.0.1:4001'

test('crawl() returns RawFindings with required top-level fields', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/blocking/all.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  expect(typeof findings.scannedAt).toBe('string')
  expect(new Date(findings.scannedAt).toISOString()).toBe(findings.scannedAt)
  expect(findings.targetUrl).toBe(`${FIXTURE_BASE}/fixtures/blocking/all.html`)
  expect(findings.pagesVisited).toHaveLength(1)
  expect(findings.pages).toHaveLength(1)
})

test('crawl() captures blocked analytics scripts from all.html', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/blocking/all.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const page = findings.pages[0]
  expect(page).toBeDefined()

  const blockedAnalytics = page.scripts.filter(
    (s) => s.blocked && s.category === 'analytics',
  )
  // Inline analytics script + GA4 src script
  expect(blockedAnalytics.length).toBeGreaterThanOrEqual(2)

  // Inline script has no src
  const inlineScript = blockedAnalytics.find((s) => s.src === null)
  expect(inlineScript).toBeDefined()

  // GA4 stub has a src pointing to the fixture stub
  const ga4Script = blockedAnalytics.find((s) => s.src?.includes('ga4'))
  expect(ga4Script).toBeDefined()
  expect(ga4Script?.src).toBe('/fixtures/stubs/ga4.js')
})

test('crawl() captures blocked marketing scripts from all.html', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/blocking/all.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const page = findings.pages[0]
  const blockedMarketing = page.scripts.filter(
    (s) => s.blocked && s.category === 'marketing',
  )
  expect(blockedMarketing.length).toBeGreaterThanOrEqual(1)

  const pixelScript = blockedMarketing.find((s) => s.src?.includes('pixel'))
  expect(pixelScript).toBeDefined()
  expect(pixelScript?.src).toBe('/fixtures/stubs/pixel.js')
})

test('crawl() captures blocked iframe from all.html', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/blocking/all.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const page = findings.pages[0]
  const blockedIframes = page.iframes.filter((f) => f.blocked)
  expect(blockedIframes.length).toBeGreaterThanOrEqual(1)

  const ytIframe = blockedIframes.find((f) => f.dataSrc?.includes('ytplayer'))
  expect(ytIframe).toBeDefined()
  expect(ytIframe?.category).toBe('marketing')
  expect(ytIframe?.src).toBeNull()
  expect(ytIframe?.dataSrc).toBe('/fixtures/stubs/ytplayer.html')
})

test('crawl() captures noscript elements', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/blocking/all.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const page = findings.pages[0]
  expect(page.noscripts.length).toBeGreaterThanOrEqual(1)
  expect(page.noscripts[0].text.length).toBeGreaterThan(0)
})

test('crawl() records network requests including resource type', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/blocking/all.html`,
    depth: 0,
    maxPages: 1,
    timeout: 30_000,
  })

  const page = findings.pages[0]
  expect(page.requests.length).toBeGreaterThan(0)

  // All requests should have a host
  for (const req of page.requests) {
    expect(typeof req.host).toBe('string')
    expect(req.host.length).toBeGreaterThan(0)
    expect(typeof req.resourceType).toBe('string')
    expect(typeof req.firstParty).toBe('boolean')
  }
})

test('crawl() follows same-origin links up to the configured depth', async () => {
  const findings = await crawl({
    url: `${FIXTURE_BASE}/fixtures/index.html`,
    depth: 1,
    maxPages: 10,
    timeout: 30_000,
  })

  // With depth=1 from index, several blocking pages should be visited
  expect(findings.pagesVisited.length).toBeGreaterThan(1)

  // all.html should be in the visited set (it's linked from index.html)
  const visitedAll = findings.pagesVisited.some((u) => u.includes('all.html'))
  expect(visitedAll).toBe(true)

  // Blocked scripts should be found across pages
  const allBlockedScripts = findings.pages.flatMap((p) =>
    p.scripts.filter((s) => s.blocked),
  )
  expect(allBlockedScripts.length).toBeGreaterThan(0)
})

test('crawl() exits non-zero on unreachable target', async () => {
  await expect(
    crawl({
      url: 'http://127.0.0.1:19999/no-such-server',
      depth: 0,
      maxPages: 1,
      timeout: 5_000,
    }),
  ).rejects.toThrow()
})
