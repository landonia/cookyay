#!/usr/bin/env node
/**
 * Generates e2e/expected-detection-config.json by crawling
 * fixtures/detection/mixed-signals.html, classifying findings,
 * and normalizing the emitted config.
 *
 * Run this script deliberately whenever the DB or emitter changes in a
 * way that's expected to affect detection output:
 *
 *   # 1. Build the scanner source (also runs prebuild to rebuild the DB)
 *   pnpm --filter @cookyay/scanner build
 *
 *   # 2. Ensure the fixture server is running on port 4001
 *   node fixtures/serve.mjs 4001 &
 *
 *   # 3. Compile and run this script
 *   node_modules/.bin/tsup packages/scanner/scripts/generate-detection-golden.mjs \
 *     --format esm --platform node --no-dts \
 *     --external playwright --external playwright-core \
 *     --out-dir packages/scanner/dist
 *   node packages/scanner/dist/generate-detection-golden.mjs
 *
 * Or use the Playwright spec itself with --update-snapshots semantics:
 *   pnpm --filter @cookyay/scanner test:e2e e2e/detection-golden.spec.ts
 * (this also works because the spec reads the golden file — if the file
 *  already matches, all tests pass; if not, update the golden manually
 *  using the steps above.)
 *
 * The golden file must be committed alongside any such change so that
 * detection-golden.spec.ts can assert byte-stable output in CI.
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// NOTE: This script is compiled by tsup (see instructions above) so that it
// can import from the scanner's TypeScript source modules. The imports below
// use .js extensions per ESM convention (TypeScript resolves them to .ts).
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_BASE = 'http://127.0.0.1:4001'

// Dynamic imports so this file parses correctly as a .mjs even before compilation
const { crawl } = await import('../src/crawler.js')
const { classify } = await import('../src/classifier.js')
const { emitConfig } = await import('../src/config-emitter.js')

console.log(`Crawling ${FIXTURE_BASE}/fixtures/detection/mixed-signals.html ...`)

const findings = await crawl({
  url: `${FIXTURE_BASE}/fixtures/detection/mixed-signals.html`,
  depth: 0,
  maxPages: 1,
  timeout: 30_000,
})

const classified = classify(findings)
const config = emitConfig(classified)

// Normalize non-deterministic parts
const json = JSON.stringify(config)
const normalized = json
  .replace(new RegExp(FIXTURE_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'FIXTURE_BASE')
  .replace(/"scannedAt"\s*:\s*"[^"]*"/g, '"scannedAt": "NORMALIZED"')

const goldenPath = join(__dirname, '..', 'e2e', 'expected-detection-config.json')
writeFileSync(goldenPath, JSON.stringify(JSON.parse(normalized), null, 2) + '\n', 'utf-8')
console.log(`Golden file written to: ${goldenPath}`)
