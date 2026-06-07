import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    // Exclude Playwright E2E specs — they must not be collected by Vitest
    exclude: ['e2e/**', '**/node_modules/**'],
  },
})
