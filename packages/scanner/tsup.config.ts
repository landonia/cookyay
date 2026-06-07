import { defineConfig } from 'tsup'

export default defineConfig([
  // Library entry: exports parseArgs, CliArgs, main — no shebang, generates .d.ts
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    dts: true,
    clean: true,
  },
  // CLI entry: unconditionally runs main() — has shebang, no .d.ts needed
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    dts: false,
    clean: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
