---
id: 001
title: Auto-provision Chromium on first run
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: []
complexity: 5
prd_refs:
  - "prd.md §3.6"
  - "goals.md §What ships in v3"
  - "goals.md §Acceptance bar"
arch_refs:
  - "architecture.md §9 Environments & deployment"
  - "architecture.md §10 Tech stack"
test_refs: []
research_refs: []
acceptance_criteria:
  - "Before the crawl launches, the scanner detects whether the required Chromium binary exists (e.g. via Playwright's executablePath / a launch pre-check)"
  - "When the binary is missing, the scanner prints a one-time notice (e.g. `Chromium not found — downloading (~150MB, one time)...`), downloads only Chromium (headless shell), then continues the same scan invocation with no manual `npx playwright install` step"
  - "When the binary is already present, the install path is a no-op and produces no extra output beyond the normal scan logs"
  - "If the download fails (offline / disk / permissions), the scanner surfaces a branded, actionable error naming the manual fallback `npx playwright install chromium` — not a raw Playwright `browserType.launch: Executable doesn't exist` stack"
  - "A unit test asserts the missing-binary path triggers the install routine and the present-binary path skips it (Playwright install/launch mocked — no real download in the test)"
  - "`pnpm --filter @cookyay/scanner test` is green"
created: 2026-06-09
---

## Task
A cold `npx @cookyay/scanner scan <url>` installs the `playwright` npm package but
never downloads the Chromium binary, so the crawl reaches `chromium.launch()`
(`packages/scanner/src/crawler.ts:143`) and dies with `browserType.launch:
Executable doesn't exist at .../chrome-headless-shell`. v2's `scan`-subcommand fix
unblocked the crawl path and exposed this. Make the scanner provision its own
browser on first run: detect the missing binary, download Chromium once with a
clear message, then continue the scan — and fail gracefully with the manual
fallback command if the download itself can't proceed [prd.md §3.6, goals.md
§What ships in v3].

## Implementation notes
- The check + install belongs at the start of the crawl, before
  `chromium.launch()` in `crawler.ts` (or a small `ensureBrowser()` helper it
  calls). Keep it in the scanner package; no banner-package or CI-workflow change.
- Detecting "missing": `chromium.executablePath()` throws / points at a
  non-existent path when browsers aren't installed. A try/launch-then-fallback is
  also acceptable — prefer the cheaper pre-check so the normal path stays fast.
- Installing programmatically: the supported route is spawning Playwright's own
  installer for Chromium only — e.g. `spawnSync`/`execFileSync` on the resolved
  `playwright` CLI with `install chromium` (or `install --with-deps` is NOT
  wanted — keep it to the browser download, no system deps). Stream its output so
  the user sees progress. Resolve the installer from the installed `playwright`
  package rather than assuming a global `npx`.
- Download only Chromium — do NOT pull Firefox/WebKit; the crawler is
  Chromium-only [architecture.md §10 Tech stack].
- Idempotency: once present, the pre-check passes and the installer is never
  spawned (no extra stdout/stderr).
- Graceful failure: wrap the install in try/catch; on failure print a branded
  message (`Error: Chromium isn't installed and the automatic download failed. Run
  \`npx playwright install chromium\` and re-run your scan.`) and exit non-zero —
  do not let the raw Playwright launch error leak through `cli.ts`'s generic
  wrapper.
- Test approach mirrors `index.test.ts`: Node-environment Vitest, mock the
  launch/install boundary (e.g. `vi.mock('playwright')` and a spy on the install
  spawn) so the test asserts the decision without a real ~150MB download.

## Out of scope
- README / docs-site copy updates — that's task 002.
- The Changesets version bump and npm publish — that's task 003.
- Bundling/vendoring a browser into the npm tarball, or switching to system-Chrome
  via `channel` — the chosen approach is download-on-first-run.
- Changing the banner (`cookyay`) package or the CI Playwright cache.

## Re-execution notes — 2026-06-09
**Verifier notes addressed:**
1. Removed the unused `import { chromium } from 'playwright'` at line 45 of `packages/scanner/src/ensure-browser.test.ts`. The `chromium` binding was never referenced in the test body — only the `vi.mock('playwright', ...)` factory used it internally, which does not count as a use of the imported binding. Deletion is the cleanest fix per the verifier's guidance.
2. Confirmed all three gates are green post-fix:
   - `pnpm --filter @cookyay/scanner lint` → clean (no errors)
   - `pnpm --filter @cookyay/scanner typecheck` → clean
   - `pnpm --filter @cookyay/scanner test` → 59/59 passed (3 files)

The implementation in `ensure-browser.ts` and the `crawler.ts` wiring were not touched — they were correct as verified previously.

## Implementation summary
**Files changed:**
- `packages/scanner/src/ensure-browser.ts` — new module; `ensureBrowser(importMetaUrl)` checks `existsSync(chromium.executablePath())`, prints a one-time notice if absent, spawns `node <playwright-cli> install chromium` (with `stdio: 'inherit'` so progress streams to the user), returns silently on success; exits 1 with a branded error naming the manual fallback on spawn failure or if the Playwright CLI cannot be resolved. Also exports `resolvePlaywrightCli(importMetaUrl)` which locates the CLI from the installed `playwright` package via `createRequire`.
- `packages/scanner/src/crawler.ts` — added `import { ensureBrowser } from './ensure-browser.js'` and `await ensureBrowser(import.meta.url)` at the top of `crawl()`, before `chromium.launch()`.
- `packages/scanner/src/ensure-browser.test.ts` — new Vitest test file (Node environment, no real download). Mocks `node:fs` (`existsSync`), `node:child_process` (`spawnSync`), and `playwright` (`chromium.executablePath`). Six tests covering: (1) binary present → silent no-op; (2) binary absent + install succeeds → notice printed, installer spawned, no exit; (3) binary absent + install fails → branded error + process.exit(1); (4) binary absent + resolvePlaywrightCli can't find CLI → branded error + process.exit(1); (5) resolvePlaywrightCli returns path ending in `cli.js`; (6) resolvePlaywrightCli throws when `cli.js` path doesn't exist. **Re-execution change:** removed unused `import { chromium } from 'playwright'` (was line 45) to clear the `@typescript-eslint/no-unused-vars` lint error.

**Acceptance criteria check:**
- [x] Before the crawl launches, the scanner detects whether the required Chromium binary exists — `crawler.ts` calls `ensureBrowser()` at the top of `crawl()`, before `chromium.launch()`; detection uses `existsSync(chromium.executablePath())`.
- [x] When the binary is missing, prints a one-time notice, downloads only Chromium, continues in the same invocation — `ensure-browser.ts:68` prints `'Chromium not found — downloading (~150MB, one time)...'`; spawns `playwright cli install chromium` only; returns on success so `crawl()` proceeds.
- [x] When binary is already present, silent no-op — `ensure-browser.ts:54-57` early-returns when `existsSync(execPath)` is true.
- [x] If download fails, surfaces branded error with manual fallback `npx playwright install chromium` — `ensure-browser.ts:89-95` and `ensure-browser.ts:73-79`.
- [x] Unit test asserts missing-binary triggers install routine and present-binary skips it (mocked, no real download) — `ensure-browser.test.ts` scenarios 1 and 2.
- [x] `pnpm --filter @cookyay/scanner test` is green — 59 tests pass (3 test files). Lint and typecheck also clean after removing unused import.

**Tests:** `pnpm --filter @cookyay/scanner test`

**Notes for verifier:** The installer is spawned as `spawnSync(process.execPath, [cliPath, 'install', 'chromium'], { stdio: 'inherit' })` where `cliPath` is resolved via `createRequire(importMetaUrl)` → `playwright/package.json` → `dirname + '/cli.js'`. This pins the exact `playwright` version the package uses rather than relying on a globally installed `playwright` CLI. `import.meta.url` is threaded through from `crawler.ts` → `ensureBrowser()` → `resolvePlaywrightCli()` so the resolution is always relative to the correct package context.

## Verifier notes — 2026-06-09 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Functionally correct and all ACs pass, but the new test file introduces a CI-breaking lint error (unused `chromium` import), and `pnpm -r lint` is a merge gate (`.github/workflows/ci.yml:29`).

**What needs to change:**
1. Remove the unused import in `packages/scanner/src/ensure-browser.test.ts:45` — `import { chromium } from 'playwright'`. `chromium` is never referenced anywhere in the test body (only `existsSync` and `spawnSync` are used; the `vi.mock('playwright', ...)` factory on line 36 does not count as a use of the imported binding). This trips `@typescript-eslint/no-unused-vars` and fails `pnpm --filter @cookyay/scanner lint` → `pnpm -r lint`, which runs in CI on every push (`.github/workflows/ci.yml:29`) and on PRs. Either delete the line or, if you genuinely need the binding referenced, prefix per the rule (`^_`). Cleanest fix is deletion — the mock factory is self-contained.
2. After removing it, re-run `pnpm --filter @cookyay/scanner lint`, `pnpm --filter @cookyay/scanner typecheck`, and `pnpm --filter @cookyay/scanner test` to confirm all three are green before re-submitting. Typecheck and test are already green; only lint fails.

**Acceptance criteria check:**
- [x] Pre-launch detection of Chromium binary — `crawler.ts:144` calls `ensureBrowser(import.meta.url)` before `chromium.launch()` (`crawler.ts:146`); detection via `existsSync(chromium.executablePath())` (`ensure-browser.ts:70-71`).
- [x] Missing binary → one-time notice + Chromium-only download, same invocation — notice at `ensure-browser.ts:76`, `spawnSync(node, [cliPath, 'install', 'chromium'])` at `ensure-browser.ts:91-93` (Chromium only, no `--with-deps`), returns on success so crawl proceeds.
- [x] Present binary → silent no-op — `ensure-browser.ts:71-73` early-returns; test scenario 1 asserts no spawn/output/exit.
- [x] Download failure → branded error naming `npx playwright install chromium`, not raw stack — `ensure-browser.ts:95-102` (spawn failure) and `ensure-browser.ts:83-88` (CLI unresolvable), both `process.exit(1)`; this fires before `chromium.launch()` so the raw "Executable doesn't exist" error never reaches cli.ts's generic wrapper (`cli.ts:12-15`).
- [x] Unit test asserts missing-binary triggers install and present-binary skips it, mocked — `ensure-browser.test.ts` scenarios 1 and 2; no real download (fs/child_process/playwright all mocked).
- [~] `pnpm --filter @cookyay/scanner test` green — the test command itself passes (59/59), BUT the package's lint gate fails, so the task does not pass the full CI bar for the touched package.

**Tests:** `pnpm --filter @cookyay/scanner test` → 59 passed (3 files). `pnpm --filter @cookyay/scanner typecheck` → clean. `pnpm --filter @cookyay/scanner lint` → FAILS: 1 error, `ensure-browser.test.ts:45 'chromium' is defined but never used`.

**Notes for next executor:** One-line fix — delete `ensure-browser.test.ts:45`. The implementation in `ensure-browser.ts` and the `crawler.ts` wiring are correct and need no changes; do not touch them. Just clear the lint error and re-verify. No scope drift observed (docs/version-bump correctly left to tasks 002/003); architecture-compliant (Chromium-only, scanner-package-contained).

## Verifier notes — 2026-06-09 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Prior rejection (unused `chromium` import) is fixed; the test file no longer imports `chromium`, all three CI gates (lint, typecheck, test) are green, and all acceptance criteria pass with the implementation unchanged.
**Acceptance criteria check:**
- [x] Pre-launch Chromium detection — `crawler.ts:144` calls `ensureBrowser(import.meta.url)` before `chromium.launch()` (`crawler.ts:146`); detection via `existsSync(chromium.executablePath())` (`ensure-browser.ts:70-71`).
- [x] Missing binary → one-time notice + Chromium-only download, same invocation — notice `ensure-browser.ts:76`; `spawnSync(node, [cliPath,'install','chromium'])` `ensure-browser.ts:91-93` (no `--with-deps`); returns on success so crawl proceeds. Test scenario 2 asserts both.
- [x] Present binary → silent no-op — `ensure-browser.ts:71-73` early-return; test scenario 1 asserts no spawn/output/exit.
- [x] Download failure → branded error naming `npx playwright install chromium`, not raw stack — `ensure-browser.ts:95-102` (spawn fail) and `ensure-browser.ts:83-88` (CLI unresolvable), both `process.exit(1)` before `chromium.launch()`.
- [x] Unit test asserts missing→install / present→skip, mocked, no real download — `ensure-browser.test.ts` scenarios 1 & 2 (fs/child_process/playwright mocked).
- [x] `pnpm --filter @cookyay/scanner test` green — 59/59 (6 in ensure-browser.test.ts). Confirmed lint rc=0 and typecheck rc=0 too; the unused-import error from the prior pass is gone.
**Tests:** 59/59 passed (3 files). lint clean, typecheck clean. Verified independently.
