#!/usr/bin/env node
/**
 * build-services-db.mjs — Curated service database generator
 *
 * Reads packages/scanner/data/services.yaml and emits three generated files:
 *
 *   1. src/db-curated.generated.ts — TypeScript module imported by db.ts.
 *      This mirrors the ingest-ocd.mjs → db-ocd.generated.ts pipeline for
 *      the hand-curated service entries, making services.yaml the single
 *      contributor-facing source of truth.
 *
 *   2. ../../cookyay/src/db-autoblock.generated.ts — Client-safe slice for the
 *      runtime auto-block feature (v5). Contains ONLY id, category,
 *      requestHosts, requestPaths, scriptUrlGlobs, iframeSrcGlobs, and
 *      google flag — cookies/localStorage/source fields stripped.
 *      Typed against the AutoBlockEntry shape used by the client runtime matcher.
 *      [goals.md §Signature-DB delivery: inline a stripped client subset via codegen]
 *
 *   3. ../../fixtures/service-fingerprints.json — Test stub descriptor used
 *      by the fixture server and E2E tests to stay in sync on what "GA4
 *      detected" means. Generated from the same services.yaml so it cannot
 *      drift as the curated DB grows to ~50 services.
 *      [architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 3)]
 *
 * Usage:
 *   node scripts/build-services-db.mjs
 *
 * Run automatically via `prebuild` in package.json.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(__dirname, '..')
// Workspace root is two levels above the scanner package
const WORKSPACE_ROOT = join(PKG_ROOT, '..', '..')
const INPUT_PATH = join(PKG_ROOT, 'data', 'services.yaml')
const OUTPUT_PATH = join(PKG_ROOT, 'src', 'db-curated.generated.ts')
// Client-safe slice for the runtime auto-block feature (v5)
// [goals.md §Signature-DB delivery: inline a stripped client subset via codegen]
const AUTOBLOCK_OUTPUT_PATH = join(WORKSPACE_ROOT, 'packages', 'cookyay', 'src', 'db-autoblock.generated.ts')
const FINGERPRINTS_OUTPUT_PATH = join(WORKSPACE_ROOT, 'fixtures', 'service-fingerprints.json')

// ---------------------------------------------------------------------------
// Valid category enum
// ---------------------------------------------------------------------------
const VALID_CATEGORIES = new Set(['necessary', 'functional', 'analytics', 'marketing'])

// ---------------------------------------------------------------------------
// Validate + normalise the YAML data
// ---------------------------------------------------------------------------

/**
 * Validate a cookie/localStorage pattern entry.
 * @param {unknown} entry
 * @param {string} context
 * @returns {{ name: string; wildcard: boolean }}
 */
function validatePattern(entry, context) {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`${context}: pattern must be an object with name + wildcard`)
  }
  const { name, wildcard } = /** @type {Record<string, unknown>} */ (entry)
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${context}: pattern.name must be a non-empty string`)
  }
  if (typeof wildcard !== 'boolean') {
    throw new Error(`${context}: pattern.wildcard must be a boolean`)
  }
  return { name, wildcard }
}

/**
 * Validate a single service definition from the YAML.
 * @param {unknown} raw
 * @param {number} index
 */
function validateService(raw, index) {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`services[${index}]: must be an object`)
  }
  const s = /** @type {Record<string, unknown>} */ (raw)

  // Required fields
  if (typeof s.id !== 'string' || !/^[a-z0-9-]+$/.test(s.id)) {
    throw new Error(`services[${index}]: id must match /^[a-z0-9-]+$/, got ${JSON.stringify(s.id)}`)
  }
  if (typeof s.name !== 'string' || s.name.length === 0) {
    throw new Error(`services[${index}] (${s.id}): name must be a non-empty string`)
  }
  if (!VALID_CATEGORIES.has(/** @type {string} */ (s.category))) {
    throw new Error(
      `services[${index}] (${s.id}): category must be one of ${[...VALID_CATEGORIES].join('|')}, got ${JSON.stringify(s.category)}`,
    )
  }

  // Boolean flag — optional, default false
  // google: true marks services owned by Google. The runtime auto-block matcher
  // skips these services and relies on Consent Mode v2 instead (DOM-blocking GTM/GA4
  // would suppress all CM v2 update signals).
  if (s.google !== undefined && typeof s.google !== 'boolean') {
    throw new Error(`services[${index}] (${s.id}): google must be a boolean, got ${JSON.stringify(s.google)}`)
  }
  const google = s.google === true

  // Array fields — all optional, default to []
  const cookies = Array.isArray(s.cookies) ? s.cookies : []
  const localStorage = Array.isArray(s.localStorage) ? s.localStorage : []
  const requestHosts = Array.isArray(s.requestHosts) ? s.requestHosts : []
  const requestPaths = Array.isArray(s.requestPaths) ? s.requestPaths : []
  const scriptUrlGlobs = Array.isArray(s.scriptUrlGlobs) ? s.scriptUrlGlobs : []
  const iframeSrcGlobs = Array.isArray(s.iframeSrcGlobs) ? s.iframeSrcGlobs : []

  // Validate cookie patterns
  const validatedCookies = cookies.map((c, ci) =>
    validatePattern(c, `services[${index}] (${s.id}).cookies[${ci}]`),
  )
  const validatedStorage = localStorage.map((l, li) =>
    validatePattern(l, `services[${index}] (${s.id}).localStorage[${li}]`),
  )

  // Validate requestHosts are strings
  for (const [hi, h] of requestHosts.entries()) {
    if (typeof h !== 'string') {
      throw new Error(`services[${index}] (${s.id}).requestHosts[${hi}]: must be a string`)
    }
  }
  for (const [pi, p] of requestPaths.entries()) {
    if (typeof p !== 'string') {
      throw new Error(`services[${index}] (${s.id}).requestPaths[${pi}]: must be a string`)
    }
  }
  for (const [gi, g] of scriptUrlGlobs.entries()) {
    if (typeof g !== 'string') {
      throw new Error(`services[${index}] (${s.id}).scriptUrlGlobs[${gi}]: must be a string`)
    }
  }
  for (const [gi, g] of iframeSrcGlobs.entries()) {
    if (typeof g !== 'string') {
      throw new Error(`services[${index}] (${s.id}).iframeSrcGlobs[${gi}]: must be a string`)
    }
  }

  // At least one match signal required
  if (
    validatedCookies.length === 0 &&
    validatedStorage.length === 0 &&
    requestHosts.length === 0 &&
    requestPaths.length === 0 &&
    scriptUrlGlobs.length === 0 &&
    iframeSrcGlobs.length === 0
  ) {
    throw new Error(
      `services[${index}] (${s.id}): must have at least one match signal ` +
        `(cookies, localStorage, requestHosts, requestPaths, scriptUrlGlobs, or iframeSrcGlobs)`,
    )
  }

  return {
    id: /** @type {string} */ (s.id),
    name: /** @type {string} */ (s.name),
    category: /** @type {string} */ (s.category),
    google,
    cookies: validatedCookies,
    localStorage: validatedStorage,
    requestHosts: /** @type {string[]} */ (requestHosts),
    requestPaths: /** @type {string[]} */ (requestPaths),
    scriptUrlGlobs: /** @type {string[]} */ (scriptUrlGlobs),
    iframeSrcGlobs: /** @type {string[]} */ (iframeSrcGlobs),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Parse YAML
  const raw = readFileSync(INPUT_PATH, 'utf-8')
  let doc
  try {
    doc = parseYaml(raw)
  } catch (err) {
    throw new Error(`Failed to parse ${INPUT_PATH}: ${err.message}`)
  }

  if (typeof doc !== 'object' || doc === null) {
    throw new Error('services.yaml: must be a YAML object at the top level')
  }

  // Check schemaVersion
  if (doc.schemaVersion !== 1) {
    throw new Error(
      `services.yaml: schemaVersion must be 1, got ${JSON.stringify(doc.schemaVersion)}`,
    )
  }

  if (!Array.isArray(doc.services)) {
    throw new Error('services.yaml: `services` must be an array')
  }

  // Validate each service
  const services = doc.services.map((s, i) => validateService(s, i))

  // Check for duplicate ids
  const seenIds = new Set()
  for (const s of services) {
    if (seenIds.has(s.id)) {
      throw new Error(`services.yaml: duplicate id "${s.id}"`)
    }
    seenIds.add(s.id)
  }

  console.log(`[build-services-db] Validated ${services.length} curated service definitions`)

  // ---------------------------------------------------------------------------
  // Emit TypeScript
  // ---------------------------------------------------------------------------
  const now = new Date().toISOString().slice(0, 10)
  const lines = [
    `/**`,
    ` * AUTO-GENERATED by scripts/build-services-db.mjs — DO NOT EDIT MANUALLY.`,
    ` * Generated: ${now}`,
    ` * Source: data/services.yaml (schemaVersion: 1)`,
    ` *`,
    ` * To regenerate: node scripts/build-services-db.mjs`,
    ` */`,
    `import type { ServiceDefinition } from './db.js'`,
    ``,
    `// ${services.length} hand-curated service definitions`,
    `export const CURATED_SERVICES: ServiceDefinition[] = [`,
  ]

  for (const s of services) {
    lines.push(`  {`)
    lines.push(`    id: ${JSON.stringify(s.id)},`)
    lines.push(`    name: ${JSON.stringify(s.name)},`)
    lines.push(`    category: ${JSON.stringify(s.category)},`)
    lines.push(`    cookies: [`)
    for (const c of s.cookies) {
      lines.push(`      { name: ${JSON.stringify(c.name)}, wildcard: ${c.wildcard} },`)
    }
    lines.push(`    ],`)
    lines.push(`    localStorage: [`)
    for (const l of s.localStorage) {
      lines.push(`      { name: ${JSON.stringify(l.name)}, wildcard: ${l.wildcard} },`)
    }
    lines.push(`    ],`)
    lines.push(`    requestHosts: [`)
    for (const h of s.requestHosts) {
      lines.push(`      ${JSON.stringify(h)},`)
    }
    lines.push(`    ],`)
    if (s.requestPaths.length > 0) {
      lines.push(`    requestPaths: [`)
      for (const p of s.requestPaths) {
        lines.push(`      ${JSON.stringify(p)},`)
      }
      lines.push(`    ],`)
    }
    if (s.google) {
      lines.push(`    google: true,`)
    }
    if (s.scriptUrlGlobs.length > 0) {
      lines.push(`    scriptUrlGlobs: [`)
      for (const g of s.scriptUrlGlobs) {
        lines.push(`      ${JSON.stringify(g)},`)
      }
      lines.push(`    ],`)
    }
    if (s.iframeSrcGlobs.length > 0) {
      lines.push(`    iframeSrcGlobs: [`)
      for (const g of s.iframeSrcGlobs) {
        lines.push(`      ${JSON.stringify(g)},`)
      }
      lines.push(`    ],`)
    }
    lines.push(`    source: 'curated',`)
    lines.push(`  },`)
  }

  lines.push(`]`)
  lines.push(``)

  const output = lines.join('\n')
  writeFileSync(OUTPUT_PATH, output, 'utf-8')
  console.log(`[build-services-db] Wrote ${services.length} service definitions to ${OUTPUT_PATH}`)

  // ---------------------------------------------------------------------------
  // Emit packages/cookyay/src/db-autoblock.generated.ts
  //
  // Client-safe slice of the curated service DB for the v5 runtime auto-block
  // feature. Contains ONLY: id, category, requestHosts, requestPaths,
  // scriptUrlGlobs, iframeSrcGlobs, and google flag.
  // Cookies, localStorage, and source fields are stripped — they are scanner-only
  // signals and provide no utility for blocking scripts/iframes at runtime.
  //
  // The google flag marks Google-owned services (GA4, GTM, Google Ads, reCAPTCHA,
  // Google Optimize). The runtime matcher skips these and relies on Consent Mode v2
  // to degrade them instead (DOM-blocking GTM/GA4 would suppress all CM v2 update
  // signals). [goals.md §Consent Mode v2: skip Google tags, prd.md §3.4]
  //
  // Services with no client-side signals (no requestHosts, requestPaths,
  // scriptUrlGlobs, or iframeSrcGlobs) are omitted from the client slice — they
  // exist in the scanner DB only for cookie/localStorage classification.
  //
  // Typed against AutoBlockEntry (defined in db-autoblock.types.ts in cookyay).
  // [architecture.md §Amendments 2026-06-10 — v4 architecture decisions (amend)]
  // ---------------------------------------------------------------------------

  // Filter to services with at least one client-side signal
  const clientServices = services.filter(
    (s) =>
      s.requestHosts.length > 0 ||
      s.requestPaths.length > 0 ||
      s.scriptUrlGlobs.length > 0 ||
      s.iframeSrcGlobs.length > 0,
  )

  const googleCount = clientServices.filter((s) => s.google).length
  const nonGoogleCount = clientServices.length - googleCount

  const autoblockLines = [
    `/**`,
    ` * AUTO-GENERATED by packages/scanner/scripts/build-services-db.mjs — DO NOT EDIT MANUALLY.`,
    ` * Generated: ${now}`,
    ` * Source: packages/scanner/data/services.yaml (schemaVersion: 1)`,
    ` *`,
    ` * Client-safe slice of the curated service DB for runtime auto-block (v5).`,
    ` * Contains ONLY: id, category, requestHosts, requestPaths, scriptUrlGlobs,`,
    ` * iframeSrcGlobs, and google flag. Cookies/localStorage/source are stripped.`,
    ` *`,
    ` * Services with google:true are owned by Google (GA4/GTM/Google Ads/etc.) and`,
    ` * are handled by Consent Mode v2 instead of DOM-blocking.`,
    ` * [goals.md §Consent Mode v2: skip Google tags, prd.md §3.4]`,
    ` *`,
    ` * To regenerate: node packages/scanner/scripts/build-services-db.mjs`,
    ` * (or: pnpm --filter @cookyay/scanner build, or the cookyay prebuild)`,
    ` */`,
    `import type { AutoBlockEntry } from './db-autoblock.types.js'`,
    ``,
    `// ${clientServices.length} curated services with client-side signals`,
    `// (${googleCount} Google-owned [skipped by runtime matcher], ${nonGoogleCount} non-Google [actively blocked])`,
    `export const AUTOBLOCK_SERVICES: AutoBlockEntry[] = [`,
  ]

  for (const s of clientServices) {
    autoblockLines.push(`  {`)
    autoblockLines.push(`    id: ${JSON.stringify(s.id)},`)
    autoblockLines.push(`    category: ${JSON.stringify(s.category)},`)
    if (s.google) {
      autoblockLines.push(`    google: true,`)
    }
    autoblockLines.push(`    requestHosts: [`)
    for (const h of s.requestHosts) {
      autoblockLines.push(`      ${JSON.stringify(h)},`)
    }
    autoblockLines.push(`    ],`)
    if (s.requestPaths.length > 0) {
      autoblockLines.push(`    requestPaths: [`)
      for (const p of s.requestPaths) {
        autoblockLines.push(`      ${JSON.stringify(p)},`)
      }
      autoblockLines.push(`    ],`)
    }
    if (s.scriptUrlGlobs.length > 0) {
      autoblockLines.push(`    scriptUrlGlobs: [`)
      for (const g of s.scriptUrlGlobs) {
        autoblockLines.push(`      ${JSON.stringify(g)},`)
      }
      autoblockLines.push(`    ],`)
    }
    if (s.iframeSrcGlobs.length > 0) {
      autoblockLines.push(`    iframeSrcGlobs: [`)
      for (const g of s.iframeSrcGlobs) {
        autoblockLines.push(`      ${JSON.stringify(g)},`)
      }
      autoblockLines.push(`    ],`)
    }
    autoblockLines.push(`  },`)
  }

  autoblockLines.push(`]`)
  autoblockLines.push(``)

  const autoblockOutput = autoblockLines.join('\n')
  writeFileSync(AUTOBLOCK_OUTPUT_PATH, autoblockOutput, 'utf-8')
  console.log(
    `[build-services-db] Wrote ${clientServices.length} auto-block entries (${googleCount} Google, ${nonGoogleCount} non-Google) to ${AUTOBLOCK_OUTPUT_PATH}`,
  )

  // ---------------------------------------------------------------------------
  // Emit fixtures/service-fingerprints.json
  //
  // This file is a test stub descriptor: it documents, for each curated service,
  // the synthetic cookie names, localStorage keys, and request URL patterns that
  // fixture pages and E2E tests should set/intercept.
  //
  // Schema mirrors the existing hand-maintained file so downstream consumers
  // (fixture server, E2E tests) need no changes — only the source changes from
  // hand-edited to generated.
  //
  // Derivation rules:
  //   cookies        — cookie patterns rendered as flat strings; wildcard patterns
  //                    gain a trailing "*" suffix (e.g. "_ga_" + wildcard → "_ga_*").
  //   localStorage   — same rendering as cookies.
  //   requestPatterns — derived from requestHosts (as "host/*") and requestPaths
  //                    (as-is, host/path already qualified). These are URL glob
  //                    patterns for test-side matching.
  //   stubScript     — null (fixture-server-specific; not derivable from schema).
  //   stubCookies    — [] (fixture-server-specific).
  //   stubIframeSrc  — omitted (fixture-server-specific).
  // ---------------------------------------------------------------------------

  /**
   * Render a CookiePattern-like object as a flat string.
   * { name: "_ga_", wildcard: true } → "_ga_*"
   * { name: "_ga", wildcard: false } → "_ga"
   * @param {{ name: string; wildcard: boolean }} pattern
   * @returns {string}
   */
  function renderPattern(pattern) {
    return pattern.wildcard ? `${pattern.name}*` : pattern.name
  }

  /**
   * Derive requestPatterns from requestHosts and requestPaths.
   * requestHosts entries → "host/*" (wildcard suffix — matches any path on that host).
   * requestPaths entries → returned as-is (already "host/path" qualified).
   * @param {string[]} requestHosts
   * @param {string[]} requestPaths
   * @returns {string[]}
   */
  function deriveRequestPatterns(requestHosts, requestPaths) {
    const patterns = []
    for (const h of requestHosts) {
      patterns.push(`${h}/*`)
    }
    for (const p of requestPaths) {
      patterns.push(p)
    }
    return patterns
  }

  const fingerprintServices = services.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    cookies: s.cookies.map(renderPattern),
    localStorage: s.localStorage.map(renderPattern),
    requestPatterns: deriveRequestPatterns(s.requestHosts, s.requestPaths),
    stubScript: null,
    stubCookies: [],
  }))

  const fingerprintsDoc = {
    $schema: 'https://json-schema.org/draft/2020-12',
    description:
      `Synthetic cookie names and request URL patterns for ${services.length} curated services. ` +
      `AUTO-GENERATED by scripts/build-services-db.mjs from data/services.yaml — DO NOT EDIT MANUALLY. ` +
      `To regenerate: node scripts/build-services-db.mjs`,
    services: fingerprintServices,
  }

  const fingerprintsJson = JSON.stringify(fingerprintsDoc, null, 2) + '\n'
  writeFileSync(FINGERPRINTS_OUTPUT_PATH, fingerprintsJson, 'utf-8')
  console.log(
    `[build-services-db] Wrote ${services.length} service fingerprints to ${FINGERPRINTS_OUTPUT_PATH}`,
  )
}

main()
