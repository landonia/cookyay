/**
 * CLI entry point — unconditionally runs main().
 *
 * This file is intentionally separate from src/index.ts (the library entry)
 * so that tests can import parseArgs/CliArgs from index.ts without triggering
 * any CLI side-effects, and so that npm bin symlinks / npx invocations work
 * correctly (the ESM process.argv[1] vs import.meta.url guard breaks through
 * symlinks because Node realpaths the module URL but leaves argv[1] as-is).
 */
import { main } from './index.js'

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`Error: ${msg}`)
  process.exit(1)
})
