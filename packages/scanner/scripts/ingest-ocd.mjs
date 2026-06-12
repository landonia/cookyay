#!/usr/bin/env node
/**
 * ingest-ocd.mjs — Open Cookie Database ingestion script
 *
 * Downloads the OCD CSV from GitHub, maps its categories to Cookyay's four
 * categories, deduplicates entries, and writes a generated TypeScript file
 * that is imported by db.ts at build time.
 *
 * Source: github.com/jkwakman/Open-Cookie-Database
 * License: Apache-2.0 — compatible with this project's Apache-2.0 license.
 * Attribution: Cookie data sourced from the Open Cookie Database by J. Kwakman
 *   (https://github.com/jkwakman/Open-Cookie-Database), licensed under Apache-2.0.
 *
 * Usage:
 *   node scripts/ingest-ocd.mjs
 *   node scripts/ingest-ocd.mjs --offline  # uses cached copy if present
 *
 * Output:
 *   src/db-ocd.generated.ts
 *
 * Run automatically via `prebuild` in package.json.
 */

import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { get as httpsGet } from 'node:https'
import { Readable } from 'node:stream'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(__dirname, '..')
const OCD_URL =
  'https://raw.githubusercontent.com/jkwakman/Open-Cookie-Database/master/open-cookie-database.csv'
const CACHE_PATH = join(__dirname, '.ocd-cache.csv')
const OUTPUT_PATH = join(PKG_ROOT, 'src', 'db-ocd.generated.ts')

const offline = process.argv.includes('--offline')

// ---------------------------------------------------------------------------
// Category mapping: OCD → Cookyay
// OCD uses: Functional, Analytics, Marketing, Social Media, Unknown
// We map to Cookyay's four categories. "Unknown" and unmapped → skipped.
// ---------------------------------------------------------------------------
/** @type {Record<string, 'necessary' | 'functional' | 'analytics' | 'marketing'>} */
const CATEGORY_MAP = {
  Functional: 'functional',
  Analytics: 'analytics',
  Marketing: 'marketing',
  'Social Media': 'marketing',
  // "Unknown" deliberately excluded — better to leave unclassified
}

// ---------------------------------------------------------------------------
// Fetch or read CSV
// ---------------------------------------------------------------------------

async function fetchCsv() {
  if (offline && existsSync(CACHE_PATH)) {
    console.log('[ingest-ocd] Using cached OCD CSV:', CACHE_PATH)
    return readFileSync(CACHE_PATH, 'utf-8')
  }

  console.log('[ingest-ocd] Fetching OCD CSV from GitHub...')
  const text = await new Promise((resolve, reject) => {
    httpsGet(OCD_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching OCD CSV`))
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      res.on('error', reject)
    }).on('error', reject)
  })

  // Cache for offline use
  writeFileSync(CACHE_PATH, text, 'utf-8')
  return text
}

// ---------------------------------------------------------------------------
// Parse CSV (handles quoted fields with commas)
// ---------------------------------------------------------------------------

function parseCsvRow(line) {
  const fields = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuote = !inQuote
      }
    } else if (ch === ',' && !inQuote) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csv = await fetchCsv()
  const lines = csv.split('\n').filter(Boolean)
  const header = parseCsvRow(lines[0])

  // Column indices (OCD CSV structure):
  // ID, Platform, Category, Cookie / Data Key name, Domain, Description,
  // Retention period, Data Controller, User Privacy & GDPR Rights Portals, Wildcard match
  const COL_PLATFORM = header.indexOf('Platform')
  const COL_CATEGORY = header.indexOf('Category')
  const COL_COOKIE_NAME = header.indexOf('Cookie / Data Key name')
  const COL_WILDCARD = header.indexOf('Wildcard match')

  if (COL_COOKIE_NAME === -1) {
    throw new Error('OCD CSV schema changed — expected "Cookie / Data Key name" column')
  }

  // Group cookies by (platform, cookyay_category)
  // Map: `${platform}@@${category}` → Set<cookie_name>
  const groups = new Map()
  // Map: `${platform}@@${category}` → Set<wildcard_cookie_name>
  const wildcardGroups = new Map()

  let skipped = 0
  let processed = 0

  for (const line of lines.slice(1)) {
    const fields = parseCsvRow(line)
    const platform = (fields[COL_PLATFORM] ?? '').trim()
    const ocdCategory = (fields[COL_CATEGORY] ?? '').trim()
    const cookieName = (fields[COL_COOKIE_NAME] ?? '').trim()
    const isWildcard = (fields[COL_WILDCARD] ?? '').trim() === '1'

    if (!platform || !cookieName || !ocdCategory) {
      skipped++
      continue
    }

    const cookyayCategory = CATEGORY_MAP[ocdCategory]
    if (!cookyayCategory) {
      skipped++
      continue
    }

    const key = `${platform}@@${cookyayCategory}`
    if (!groups.has(key)) groups.set(key, new Set())
    if (!wildcardGroups.has(key)) wildcardGroups.set(key, new Set())

    if (isWildcard) {
      wildcardGroups.get(key).add(cookieName)
    } else {
      groups.get(key).add(cookieName)
    }
    processed++
  }

  console.log(`[ingest-ocd] Processed ${processed} entries, skipped ${skipped}`)

  // Build service definitions
  const services = []
  for (const [key, cookies] of groups) {
    const [platform, category] = key.split('@@')
    const wildcards = wildcardGroups.get(key) ?? new Set()

    // Create a stable ID from platform name
    const id =
      'ocd-' +
      platform
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)

    const allCookies = [
      ...[...cookies].map((n) => `{ name: ${JSON.stringify(n)}, wildcard: false }`),
      ...[...wildcards].map((n) => `{ name: ${JSON.stringify(n)}, wildcard: true }`),
    ]

    if (allCookies.length === 0) continue

    services.push({
      id,
      platform,
      category,
      cookies: allCookies,
    })
  }

  // Sort for stable output
  services.sort((a, b) => a.id.localeCompare(b.id))

  // De-duplicate IDs (multiple categories for same platform get a suffix)
  const idCounts = new Map()
  for (const s of services) {
    idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1)
  }
  const idSeen = new Map()
  for (const s of services) {
    const count = idCounts.get(s.id)
    if (count > 1) {
      const seen = idSeen.get(s.id) ?? 0
      if (seen > 0) {
        s.id = `${s.id}-${s.category}`
      }
      idSeen.set(s.id, seen + 1)
    }
  }

  // Generate TypeScript
  // No build-time date stamp: the output must be a pure function of the input
  // (the OCD cache) so builds are reproducible and don't churn the git diff daily.
  const lines_ts = [
    `/**`,
    ` * AUTO-GENERATED by scripts/ingest-ocd.mjs — DO NOT EDIT MANUALLY.`,
    ` * Source: Open Cookie Database (https://github.com/jkwakman/Open-Cookie-Database)`,
    ` * License: Apache-2.0`,
    ` * Attribution: Cookie data sourced from the Open Cookie Database by J. Kwakman`,
    ` *   (https://github.com/jkwakman/Open-Cookie-Database), licensed under Apache-2.0.`,
    ` *`,
    ` * To regenerate: node scripts/ingest-ocd.mjs`,
    ` * To update to latest OCD: delete scripts/.ocd-cache.csv then regenerate.`,
    ` */`,
    `import type { ServiceDefinition } from './db.js'`,
    ``,
    `// ${services.length} services derived from ${processed} OCD entries (${skipped} skipped — Unknown/unmapped categories)`,
    `export const OCD_SERVICES: ServiceDefinition[] = [`,
  ]

  for (const s of services) {
    lines_ts.push(`  {`)
    lines_ts.push(`    id: ${JSON.stringify(s.id)},`)
    lines_ts.push(`    name: ${JSON.stringify(s.platform)},`)
    lines_ts.push(`    category: ${JSON.stringify(s.category)},`)
    lines_ts.push(`    cookies: [`)
    for (const c of s.cookies) {
      lines_ts.push(`      ${c},`)
    }
    lines_ts.push(`    ],`)
    lines_ts.push(`    localStorage: [],`)
    lines_ts.push(`    requestHosts: [],`)
    lines_ts.push(`    source: 'ocd',`)
    lines_ts.push(`  },`)
  }

  lines_ts.push(`]`)
  lines_ts.push(``)

  const output = lines_ts.join('\n')
  writeFileSync(OUTPUT_PATH, output, 'utf-8')
  console.log(`[ingest-ocd] Wrote ${services.length} service definitions to ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error('[ingest-ocd] Error:', err)
  process.exit(1)
})
