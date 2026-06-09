import { writeFile } from 'node:fs/promises'
import { crawl } from './crawler.js'
import { classify } from './classifier.js'
import { emitConfig } from './config-emitter.js'

const HELP = `
Usage: cookyay-scan <url> [options]

Crawls a site, classifies cookies/storage/requests against a built-in service
database (Open Cookie Database + curated top-20), and emits a ready-to-use
cookyay config JSON.  No data is sent to any server — output is local only.

Options:
  --depth <n>         Same-origin link follow depth (default: 2)
  --max-pages <n>     Maximum pages to visit (default: 20)
  --timeout <ms>      Per-page navigation timeout in ms (default: 30000)
  --output <file>     Write raw findings JSON to a file (default: stdout)
  --config-out <file> Write classified cookyay config JSON to a file.
                      When omitted: config is NOT written (use --output for
                      the raw crawl JSON). Pass "-" to write config to stdout.
  -h, --help          Show this help

Examples:
  cookyay-scan https://example.com --config-out cookyay.config.json
  cookyay-scan https://example.com --depth 1 --config-out -
  cookyay-scan https://example.com --output raw.json --config-out config.json
`.trim()

export interface CliArgs {
  url: string
  depth: number
  maxPages: number
  timeout: number
  output: string | null
  configOut: string | null
}

export function parseArgs(argv: string[]): CliArgs | 'help' | null {
  let args = argv.slice(2)

  // Accept an optional leading `scan` subcommand. The documented invocation is
  // `npx @cookyay/scanner scan <url>`, and npx (package name != bin name) runs
  // the single `cookyay-scan` bin and forwards `scan <url>` as argv. Without
  // this, the literal `scan` token is picked up as the URL and `new URL("scan")`
  // throws. Stripping it here makes both `... scan <url>` and the bare
  // `... <url>` forms work identically. Only the leading position is treated as
  // the verb, so a flag-prefixed or later token is untouched.
  if (args[0] === 'scan') args = args.slice(1)

  if (args.includes('-h') || args.includes('--help')) return 'help'

  const url = args.find((a) => !a.startsWith('-'))
  if (!url) return null

  function numFlag(name: string, def: number, minValue: number): number {
    const idx = args.indexOf(`--${name}`)
    if (idx !== -1 && args[idx + 1] !== undefined) {
      const raw = args[idx + 1]
      const n = Number(raw)
      if (Number.isFinite(n) && n >= minValue) return Math.floor(n)
      console.error(
        `Warning: --${name} "${raw}" is not a valid value (expected integer >= ${minValue}); using default ${def}.`,
      )
    }
    return def
  }

  const outputIdx = args.indexOf('--output')
  const output = outputIdx !== -1 ? (args[outputIdx + 1] ?? null) : null

  const configOutIdx = args.indexOf('--config-out')
  const configOut = configOutIdx !== -1 ? (args[configOutIdx + 1] ?? null) : null

  return {
    url,
    depth: numFlag('depth', 2, 0),
    maxPages: numFlag('max-pages', 20, 1),
    timeout: numFlag('timeout', 30_000, 1),
    output,
    configOut,
  }
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv)

  if (parsed === 'help') {
    console.log(HELP)
    return
  }

  if (parsed === null) {
    console.error('Error: URL is required.\n')
    console.error('Usage: cookyay-scan <url> [options]')
    console.error('Run cookyay-scan --help for full usage.')
    process.exit(1)
  }

  try {
    new URL(parsed.url)
  } catch {
    console.error(`Error: "${parsed.url}" is not a valid URL.`)
    process.exit(1)
  }

  const { url, depth, maxPages, timeout, output, configOut } = parsed

  console.error(
    `Scanning ${url}  (depth: ${depth}, max-pages: ${maxPages}, timeout: ${timeout}ms)`,
  )

  const findings = await crawl({ url, depth, maxPages, timeout })

  // -------------------------------------------------------------------------
  // Raw findings output
  // -------------------------------------------------------------------------
  const rawJson = JSON.stringify(findings, null, 2)

  if (output) {
    await writeFile(output, rawJson, 'utf-8')
    console.error(`Raw findings written to: ${output}`)
  } else if (!configOut) {
    // Default: if no --config-out given, write raw JSON to stdout (backward compat)
    process.stdout.write(rawJson + '\n')
  }

  // -------------------------------------------------------------------------
  // Classification + config output
  // -------------------------------------------------------------------------
  if (configOut !== null) {
    const classified = classify(findings)
    const config = emitConfig(classified)
    const configJson = JSON.stringify(config, null, 2)

    if (configOut === '-') {
      process.stdout.write(configJson + '\n')
    } else {
      await writeFile(configOut, configJson, 'utf-8')
      console.error(`Config written to: ${configOut}`)
    }

    // Surface noscript warnings to stderr
    if (classified.noscriptWarnings.length > 0) {
      console.error(
        `\nWarning: ${classified.noscriptWarnings.length} <noscript> fallback tag(s) detected.` +
        ` These bypass script blocking and must be removed from your HTML for GDPR/CCPA compliance.` +
        ` See _noscriptWarnings in the config output for details.`,
      )
    }

    // Summary
    const cats = Object.keys(config.categories)
    const totalServices = cats.reduce(
      (n, c) => n + (config.categories[c as keyof typeof config.categories]?.services.length ?? 0),
      0,
    )
    console.error(
      `Classification complete: ${totalServices} service(s) across ${cats.length} categories; ` +
      `${config._unclassified.length} unclassified artifact(s).`,
    )
  }

  console.error(`Pages visited: ${findings.pagesVisited.length}`)
}

// This file is the library entry — it does NOT auto-run main().
// The CLI entry is src/cli.ts, which imports and unconditionally runs main().
// This separation avoids the ESM symlink guard pitfall (process.argv[1] vs
// import.meta.url mismatch when invoked through npm bin symlinks / npx).
