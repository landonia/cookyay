/**
 * Unit tests for parseArgs — specifically covering the --depth 0 fix
 * (depth zero = "scan only the start page, follow no links") and the
 * warning emitted for unparseable / out-of-range flag values.
 *
 * Also includes a regression test for bin/npx symlink invocation, ensuring
 * that cli.js works when invoked through a symlink (the ESM import.meta.url
 * vs process.argv[1] comparison breaks through symlinks; the cli/index split
 * fixes this).
 *
 * These are Node-environment Vitest tests; they do NOT require Playwright
 * or the fixture server to be running.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './index.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

describe('parseArgs', () => {
  describe('--depth flag', () => {
    it('accepts --depth 0 and returns depth 0', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com', '--depth', '0'])
      expect(result).not.toBeNull()
      expect(result).not.toBe('help')
      if (result && result !== 'help') {
        expect(result.depth).toBe(0)
      }
    })

    it('accepts --depth 1 and returns depth 1', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com', '--depth', '1'])
      expect(result).not.toBeNull()
      expect(result).not.toBe('help')
      if (result && result !== 'help') {
        expect(result.depth).toBe(1)
      }
    })

    it('uses default depth 2 when --depth is absent', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com'])
      expect(result).not.toBeNull()
      expect(result).not.toBe('help')
      if (result && result !== 'help') {
        expect(result.depth).toBe(2)
      }
    })
  })

  describe('invalid flag values emit warnings and fall back to defaults', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
      errorSpy.mockRestore()
    })

    it('warns and uses default when --depth is non-numeric', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com', '--depth', 'abc'])
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--depth'))
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"abc"'))
      if (result && result !== 'help') {
        expect(result.depth).toBe(2) // default
      }
    })

    it('warns and uses default when --max-pages is 0 (below minimum of 1)', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com', '--max-pages', '0'])
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--max-pages'))
      if (result && result !== 'help') {
        expect(result.maxPages).toBe(20) // default
      }
    })

    it('warns and uses default when --timeout is non-numeric', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com', '--timeout', 'fast'])
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--timeout'))
      if (result && result !== 'help') {
        expect(result.timeout).toBe(30_000) // default
      }
    })
  })

  describe('other flags', () => {
    it('parses --max-pages correctly', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com', '--max-pages', '5'])
      if (result && result !== 'help') {
        expect(result.maxPages).toBe(5)
      }
    })

    it('parses --timeout correctly', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com', '--timeout', '10000'])
      if (result && result !== 'help') {
        expect(result.timeout).toBe(10000)
      }
    })

    it('returns null when no URL is given', () => {
      const result = parseArgs(['node', 'cookyay-scan'])
      expect(result).toBeNull()
    })

    it('returns "help" for -h', () => {
      const result = parseArgs(['node', 'cookyay-scan', '-h'])
      expect(result).toBe('help')
    })

    it('returns "help" for --help', () => {
      const result = parseArgs(['node', 'cookyay-scan', '--help'])
      expect(result).toBe('help')
    })

    it('parses --output correctly', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com', '--output', 'out.json'])
      if (result && result !== 'help') {
        expect(result.output).toBe('out.json')
      }
    })

    it('sets output to null when --output is absent', () => {
      const result = parseArgs(['node', 'cookyay-scan', 'https://example.com'])
      if (result && result !== 'help') {
        expect(result.output).toBeNull()
      }
    })
  })
})

/**
 * Regression test: bin symlink invocation.
 *
 * Verifies that dist/cli.js works correctly when invoked through a symlink,
 * matching how `npx @cookyay/scanner` and `node_modules/.bin/cookyay-scan`
 * resolve the bin entry. The prior ESM guard (process.argv[1] === import.meta.url)
 * broke through symlinks because Node realpaths the module but argv[1] stays
 * as the symlink path — main() was never called (silent no-op, exit 0).
 *
 * This test creates a temp-dir symlink pointing at dist/cli.js and spawns it
 * via `node <symlink> --help`, asserting that usage text is printed and exit is 0.
 */
describe('bin symlink regression', () => {
  it('dist/cli.js prints --help and exits 0 when invoked through a symlink', () => {
    // dist/cli.js path relative to src/ — go up one level to package root, then dist/
    const cliDistPath = resolve(__dirname, '..', 'dist', 'cli.js')

    const tmpDir = mkdtempSync(join(tmpdir(), 'cookyay-bin-test-'))
    const symlinkPath = join(tmpDir, 'cookyay-scan')

    try {
      symlinkSync(cliDistPath, symlinkPath)

      const result = spawnSync('node', [symlinkPath, '--help'], {
        encoding: 'utf-8',
        timeout: 10_000,
      })

      // Must exit 0
      expect(result.status).toBe(0)

      // Must print usage (stdout or stderr — help goes to stdout)
      const combined = (result.stdout ?? '') + (result.stderr ?? '')
      expect(combined).toContain('Usage: cookyay-scan <url>')
      expect(combined).toContain('--depth')
      expect(combined).toContain('--max-pages')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
