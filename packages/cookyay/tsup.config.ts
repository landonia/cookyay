import { defineConfig } from 'tsup'

export default defineConfig([
  // ESM build — importable from bundlers
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    target: 'es2020',
    sourcemap: true,
    // Replace process.env.NODE_ENV so the diagnostic's DCE guard evaluates to
    // "development" in the ESM bundle. The IIFE/CDN build with minify:true
    // already replaces it with "production" and DCEs the diagnostic body.
    // Without this, `process` is undefined in the browser and throws at runtime.
    define: { 'process.env.NODE_ENV': '"development"' },
  },
  // IIFE CDN build — window.Cookyay for <script> tag usage
  {
    entry: { index: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Cookyay',
    target: 'es2020',
    minify: true,
    // Replace process.env.NODE_ENV with "production" so esbuild's constant-folding
    // DCEs the bootstrap-order diagnostic body (guarded by
    // `process.env.NODE_ENV !== 'production'`). Without this define, the env var
    // reference remains as a live expression and the diagnostic strings survive
    // minification. [task 006 AC3; research/performance-engineer.md §Findings 3]
    define: { 'process.env.NODE_ENV': '"production"' },
    outExtension: () => ({ js: '.iife.js' }),
  },
  // Bootstrap — standalone synchronous <head> snippet
  {
    entry: { bootstrap: 'src/bootstrap.ts' },
    format: ['iife'],
    target: 'es2020',
    minify: true,
    outExtension: () => ({ js: '.js' }),
  },
])
