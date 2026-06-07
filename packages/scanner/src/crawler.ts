import { chromium } from 'playwright'
import type { BrowserContext } from 'playwright'
import type {
  RawFindings,
  PageFindings,
  CookieRecord,
  StorageEntry,
  RequestRecord,
  ScriptRecord,
  IframeRecord,
  NoscriptRecord,
} from './types.js'

export interface CrawlOptions {
  url: string
  depth?: number    // same-origin link follow depth (default 2)
  maxPages?: number // hard page cap (default 20)
  timeout?: number  // per-navigation timeout in ms (default 30_000)
}

function normalizeUrl(raw: string): string {
  const u = new URL(raw)
  u.hash = ''
  return u.href
}

async function collectPage(
  context: BrowserContext,
  url: string,
  targetOrigin: string,
  timeout: number,
): Promise<{ findings: PageFindings; links: string[] }> {
  const page = await context.newPage()
  const requests: RequestRecord[] = []

  page.on('request', (req) => {
    try {
      const u = new URL(req.url())
      requests.push({
        url: req.url(),
        host: u.hostname,
        resourceType: req.resourceType(),
        firstParty: u.origin === targetOrigin,
      })
    } catch {
      // malformed URL — skip
    }
  })

  await page.goto(url, { waitUntil: 'networkidle', timeout })

  // Cookies for this page's origin
  const rawCookies = await context.cookies(url)
  const targetHost = new URL(url).hostname
  const cookies: CookieRecord[] = rawCookies.map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    expires: c.expires === -1 ? null : c.expires,
    secure: c.secure,
    sameSite: c.sameSite as 'Strict' | 'Lax' | 'None',
    firstParty:
      c.domain === targetHost ||
      targetHost.endsWith(c.domain.startsWith('.') ? c.domain : `.${c.domain}`),
  }))

  // localStorage + sessionStorage keys
  const storage: StorageEntry[] = await page.evaluate(() => {
    const entries: Array<{ type: 'localStorage' | 'sessionStorage'; key: string }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null) entries.push({ type: 'localStorage', key })
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key !== null) entries.push({ type: 'sessionStorage', key })
    }
    return entries
  })

  // Script elements (including blocked declarative scripts)
  const scripts: ScriptRecord[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script')).map((el) => ({
      src: el.getAttribute('src'),
      blocked: el.getAttribute('type') === 'text/plain',
      category: el.getAttribute('data-category'),
    })),
  )

  // Iframe elements (including declarative-blocked placeholders)
  const iframes: IframeRecord[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('iframe')).map((el) => {
      const src = el.getAttribute('src')
      const dataSrc = el.getAttribute('data-src')
      return {
        src,
        dataSrc,
        blocked: dataSrc !== null && src === null,
        category: el.getAttribute('data-category'),
      }
    }),
  )

  // Noscript elements
  const noscripts: NoscriptRecord[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('noscript')).map((el) => ({
      text: el.textContent?.trim() ?? '',
    })),
  )

  // Discover same-origin links for the next depth level
  const links: string[] = await page.evaluate((origin) => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll('a[href]'))) {
      try {
        const href = (el as HTMLAnchorElement).href
        const u = new URL(href)
        if (u.origin === origin) {
          u.hash = ''
          out.push(u.href)
        }
      } catch {
        // ignore unparseable hrefs
      }
    }
    return out
  }, targetOrigin)

  await page.close()

  return {
    findings: { url, cookies, storage, requests, scripts, iframes, noscripts },
    links,
  }
}

export async function crawl(opts: CrawlOptions): Promise<RawFindings> {
  const { url, depth = 2, maxPages = 20, timeout = 30_000 } = opts

  const targetOrigin = new URL(url).origin
  const scannedAt = new Date().toISOString()

  const browser = await chromium.launch()
  const context = await browser.newContext()

  const visited = new Set<string>()
  const queue: Array<{ url: string; depth: number }> = [
    { url: normalizeUrl(url), depth: 0 },
  ]
  const pages: PageFindings[] = []

  try {
    while (queue.length > 0 && visited.size < maxPages) {
      const item = queue.shift()!
      if (visited.has(item.url)) continue
      visited.add(item.url)

      const { findings, links } = await collectPage(
        context,
        item.url,
        targetOrigin,
        timeout,
      )
      pages.push(findings)

      if (item.depth < depth) {
        for (const link of links) {
          const normalized = normalizeUrl(link)
          if (!visited.has(normalized)) {
            queue.push({ url: normalized, depth: item.depth + 1 })
          }
        }
      }
    }
  } finally {
    await browser.close()
  }

  return {
    scannedAt,
    targetUrl: url,
    pagesVisited: [...visited],
    pages,
  }
}
