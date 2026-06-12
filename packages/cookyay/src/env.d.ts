/**
 * Minimal `process.env` ambient declaration for browser-targeted TypeScript files
 * that use `process.env.NODE_ENV` for build-time DCE guards.
 *
 * tsup/esbuild replaces `process.env.NODE_ENV` with a literal at build time:
 *   - IIFE production build: `"production"` → esbuild DCEs `!== 'production'` guards
 *   - ESM build: `"development"` → diagnostics are active for bundler consumers
 *
 * This declaration is intentionally minimal — it does NOT pull in `@types/node`.
 * Adding full Node types to a browser package would pollute the type namespace
 * and mislead TypeScript consumers who import this library.
 *
 * [task 006, research/performance-engineer.md §Findings 3]
 */
declare const process: {
  readonly env: {
    readonly NODE_ENV: string
  }
}
