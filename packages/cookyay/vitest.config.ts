import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: ['./src/test-setup.ts'],
    // Browser-mode tests run separately via vitest.browser.config.ts
    exclude: ['src/**/*.browser.test.ts', 'node_modules/**'],
    passWithNoTests: true,
  },
})
