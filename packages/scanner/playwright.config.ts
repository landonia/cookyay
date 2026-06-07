import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
// Resolve workspace root from packages/scanner → ../../
const WORKSPACE_ROOT = join(__dirname, '..', '..')
const FIXTURE_SERVER_PORT = 4001

export default defineConfig({
  testDir: './e2e',

  // Chromium only — evergreen target per architecture §9/§10
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],

  // Run in parallel; individual tests clear their own cookies so order doesn't matter
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,

  // No retries — flakiness means a real bug in a library this small
  retries: 0,

  // Default timeout: 15 s per test action (allows for slow CI startup)
  timeout: 30_000,

  use: {
    baseURL: `http://127.0.0.1:${FIXTURE_SERVER_PORT}`,
    // Trace on failure only — keeps CI artefacts small
    trace: 'on-first-retry',
  },

  webServer: {
    command: `node ${join(WORKSPACE_ROOT, 'fixtures/serve.mjs')} ${FIXTURE_SERVER_PORT}`,
    url: `http://127.0.0.1:${FIXTURE_SERVER_PORT}/fixtures/index.html`,
    // Re-use a server already running locally; in CI always start fresh
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },

  reporter: process.env.CI ? 'github' : 'list',
})
