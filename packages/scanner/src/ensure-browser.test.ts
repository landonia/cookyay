/**
 * Unit tests for ensureBrowser() — the Chromium auto-provisioning helper.
 *
 * These are Node-environment Vitest tests. They do NOT trigger a real ~150MB
 * Chromium download. All Playwright and fs interactions are mocked so the tests
 * assert decision-making only.
 *
 * Scenarios covered:
 *  1. Binary present  → ensureBrowser() returns without spawning anything.
 *  2. Binary absent   → ensureBrowser() prints the notice and spawns the
 *                       installer; on success it returns (no process.exit).
 *  3. Binary absent + install fails → ensureBrowser() calls process.exit(1)
 *                                     with a branded error message.
 *  4. Binary absent + resolvePlaywrightCli throws → ensureBrowser() calls
 *                                                    process.exit(1) with a
 *                                                    branded error message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks — declared before any import of the module under test.
// ---------------------------------------------------------------------------

// Mock 'node:fs' so we can control existsSync without touching the real FS.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

// Mock 'node:child_process' so spawnSync never spawns a real process.
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

// Mock 'playwright' so chromium.executablePath() returns a deterministic path.
vi.mock('playwright', () => ({
  chromium: {
    executablePath: vi.fn(() => '/fake/chromium/path'),
  },
}))

// Import after mocks are in place.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { ensureBrowser, resolvePlaywrightCli } from './ensure-browser.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_IMPORT_META_URL = 'file:///fake/module/ensure-browser.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureBrowser', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processExitSpy: any

  beforeEach(() => {
    vi.resetAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Cast to avoid TS "void vs never" complaint on process.exit spy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Scenario 1: binary already present → silent no-op
  // -------------------------------------------------------------------------
  it('returns without spawning when the binary is already present', async () => {
    // executablePath() returns '/fake/chromium/path'; report it as existing.
    vi.mocked(existsSync).mockReturnValue(true)

    await ensureBrowser(FAKE_IMPORT_META_URL)

    // spawnSync must NOT have been called
    expect(spawnSync).not.toHaveBeenCalled()
    // No output
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    // No exit
    expect(processExitSpy).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 2: binary absent + successful install → returns, no exit
  // -------------------------------------------------------------------------
  it('prints a notice and spawns the installer when the binary is missing', async () => {
    // executablePath() path does NOT exist; cli.js path DOES exist (for resolvePlaywrightCli).
    vi.mocked(existsSync).mockImplementation((p) => {
      // The chromium binary path is '/fake/chromium/path'
      if (String(p) === '/fake/chromium/path') return false
      // Any other path (the playwright cli.js) is present
      return true
    })

    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
    })

    // We need resolvePlaywrightCli to succeed. Patch it inline by spying on the
    // module's own export — here we intercept at the spawnSync level instead,
    // which is simpler: if spawnSync is called with the right args and returns
    // status 0, the function should return without calling process.exit.
    //
    // Since resolvePlaywrightCli uses createRequire internally and we can't
    // easily mock that in a unit test, we test the integration via the spawnSync
    // mock path: if resolvePlaywrightCli would throw, ensureBrowser would call
    // process.exit(1) — so a successful path through spawnSync proves
    // resolvePlaywrightCli succeeded.

    // We'll call a version of ensureBrowser that uses a real import.meta.url
    // so createRequire can actually resolve 'playwright'. Use the real module
    // URL here (the test file is already in the scanner package).
    await ensureBrowser(import.meta.url)

    // The notice must have been printed.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Chromium not found — downloading'),
    )

    // spawnSync must have been called with node + playwright cli + install chromium.
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['install', 'chromium']),
      expect.objectContaining({ stdio: 'inherit' }),
    )

    // Must NOT have exited.
    expect(processExitSpy).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 3: binary absent + install fails → process.exit(1) + branded error
  // -------------------------------------------------------------------------
  it('exits with code 1 and a branded error when the installer fails', async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p) === '/fake/chromium/path') return false
      return true
    })

    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
    })

    await ensureBrowser(import.meta.url)

    // Must have printed a branded error mentioning the manual fallback.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('npx playwright install chromium'),
    )

    // Must have called process.exit(1).
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  // -------------------------------------------------------------------------
  // Scenario 4: binary absent + resolvePlaywrightCli fails → branded exit
  // -------------------------------------------------------------------------
  it('exits with code 1 when resolvePlaywrightCli cannot find the CLI', async () => {
    // Binary missing AND no file system path resolves (simulates broken install).
    vi.mocked(existsSync).mockReturnValue(false)

    // spawnSync should NOT be reached — process.exit is called before it.
    // (We still mock it so we can assert it was NOT called.)
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
    })

    // Use a fake importMetaUrl so createRequire can't resolve 'playwright'
    // (the URL points at a non-existent directory).
    await ensureBrowser('file:///nonexistent/fake/module.js')

    // Must have shown a branded error.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('npx playwright install chromium'),
    )

    // Must have exited 1.
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})

// ---------------------------------------------------------------------------
// resolvePlaywrightCli
// ---------------------------------------------------------------------------

describe('resolvePlaywrightCli', () => {
  beforeEach(() => {
    // Restore existsSync to returning true for the happy-path resolution test,
    // since the module-level vi.mock intercepts node:fs globally.
    vi.mocked(existsSync).mockReturnValue(true)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('returns a path that ends with cli.js when called from this test file', () => {
    // The scanner package has playwright as a dependency, so this must resolve.
    // existsSync is mocked to return true so the CLI path check passes.
    const cliPath = resolvePlaywrightCli(import.meta.url)
    expect(cliPath).toMatch(/cli\.js$/)
  })

  it('throws when the resolved cli.js path does not exist', () => {
    // existsSync returns false → the "Playwright CLI not found" guard triggers.
    vi.mocked(existsSync).mockReturnValue(false)
    expect(() => resolvePlaywrightCli(import.meta.url)).toThrow(/Playwright CLI not found/)
  })
})
