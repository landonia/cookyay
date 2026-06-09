/**
 * ensureBrowser — auto-provision the Chromium headless shell on first run.
 *
 * Playwright ships as an npm package but does NOT download browser binaries
 * during `npm install`. A cold `npx @cookyay/scanner scan <url>` therefore
 * reaches `chromium.launch()` and dies with a raw "Executable doesn't exist"
 * message. This module fixes that by:
 *
 *   1. Checking whether the required binary is already present (fast, no-op if
 *      it is).
 *   2. If absent: printing a one-time notice and spawning Playwright's own
 *      installer for Chromium only, streaming its output so the user sees
 *      progress.
 *   3. If the download fails: surfacing a branded, actionable error with the
 *      manual fallback command rather than leaking the raw Playwright stack.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

/**
 * Resolve the path to Playwright's own `cli.js` installer from the `playwright`
 * package that is already on the dependency graph (i.e. the one the scanner uses
 * for crawling). This avoids any reliance on a globally installed `npx` or a
 * `playwright` binary on `PATH` — it always runs the exact version the package
 * depends on.
 *
 * Throws if the CLI script cannot be found (should never happen in a correct
 * install, but we surface a clear error rather than a confusing stack).
 */
export function resolvePlaywrightCli(importMetaUrl: string): string {
  const req = createRequire(importMetaUrl)
  let pkgJsonPath: string
  try {
    pkgJsonPath = req.resolve('playwright/package.json')
  } catch {
    throw new Error(
      'Cannot resolve the playwright package. Make sure playwright is installed (`pnpm install`).',
    )
  }
  const cliPath = join(dirname(pkgJsonPath), 'cli.js')
  if (!existsSync(cliPath)) {
    throw new Error(
      `Playwright CLI not found at expected path: ${cliPath}. Try reinstalling playwright.`,
    )
  }
  return cliPath
}

/**
 * Ensure the Chromium headless shell binary is present before the crawl starts.
 *
 * - Binary present  → silent no-op; the normal scan proceeds.
 * - Binary absent   → print a one-time notice, download Chromium only (not
 *   Firefox/WebKit), then return so the crawl continues in the same invocation.
 * - Download fails  → print a branded error with the manual fallback command
 *   and process.exit(1) — the raw Playwright launch error must not leak through
 *   cli.ts's generic error wrapper.
 *
 * Output goes to stderr so it doesn't pollute JSON written to stdout.
 *
 * @param importMetaUrl  Pass `import.meta.url` from the calling module so the
 *                       correct `playwright` package is resolved at runtime.
 */
export async function ensureBrowser(importMetaUrl: string): Promise<void> {
  // --- fast path: binary already present ---
  const execPath = chromium.executablePath()
  if (existsSync(execPath)) {
    return
  }

  // --- slow path: binary missing, download Chromium only ---
  console.error('Chromium not found — downloading (~150MB, one time)...')

  let cliPath: string
  try {
    cliPath = resolvePlaywrightCli(importMetaUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `Error: Chromium isn't installed and the automatic download failed. Run\n` +
        `  npx playwright install chromium\n` +
        `and re-run your scan.\n\nDetails: ${msg}`,
    )
    process.exit(1)
  }

  const result = spawnSync(process.execPath, [cliPath, 'install', 'chromium'], {
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(
      `Error: Chromium isn't installed and the automatic download failed. Run\n` +
        `  npx playwright install chromium\n` +
        `and re-run your scan.`,
    )
    process.exit(1)
  }
}
