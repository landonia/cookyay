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
  },
  // IIFE CDN build — window.Cookyay for <script> tag usage
  {
    entry: { index: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Cookyay',
    target: 'es2020',
    minify: true,
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
