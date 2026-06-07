---
id: "015"
title: "Scanner: Playwright crawler core"
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001", "012"]
prd_refs:
  - "prd.md §3.6"
  - "prd.md §Amendments 2026-06-06 (Playwright-based)"
arch_refs:
  - "architecture.md §10 Tech stack (Monorepo layout, Testing)"
research_refs:
  - "research/test-strategist.md §Open questions 3 (Update)"
acceptance_criteria:
  - "npx @cookyay/scanner <url> crawls same-origin pages (configurable depth/page limit), driving Playwright Chromium"
  - "Collects per-page: cookies set (name, domain, expiry, party), localStorage/sessionStorage keys, third-party request hosts, script/iframe origins, and noscript tags"
  - "Run against the fixture site (012), it deterministically captures the synthetic trackers' artifacts — covered by an integration test"
  - "Respects a --timeout and exits non-zero with a clear message on unreachable targets; never sends collected data anywhere (writes local JSON only)"
created: 2026-06-06
---

## Task
Build the crawl/collect half of the scanner: a Playwright-driven CLI that visits a site's pages and records every storage artifact and third-party touchpoint into a raw findings JSON. Classification and config generation are task 016.

## Implementation notes
- Reuse the Playwright dependency already in the workspace (shared Chromium, shared CI cache).
- Raw findings format is an internal contract with 016 — type it.
- Capture cookies via CDP/context.cookies() after interaction-free settle; note SPAs may need a wait heuristic.

## Out of scope
Service classification, confidence scores, config emission (016), scanning behind auth, JS-rendered route discovery beyond same-origin links.

## Re-execution notes — 2026-06-07
**Addressed verifier issues:**
1. **`--depth 0` silently ignored → fixed.** `numFlag()` in `index.ts` now takes a `minValue` parameter. `depth` uses `minValue: 0` (so `n >= 0` is accepted), while `--max-pages` and `--timeout` keep `minValue: 1`. Verified live: `node dist/index.js <url> --depth 0` now prints `(depth: 0, ...)` and does not follow links.
2. **Silent fallback on bad flags → fixed.** `numFlag()` now emits `console.error(Warning: --<name> "<value>" is not a valid value ...)` when the supplied value doesn't pass validation, before falling back to the default. Consistent with architecture.md §5 "misconfiguration surfaces as structured warnings."
3. **Test covering `--depth 0` CLI arg path → added.** Exported `parseArgs` (and `CliArgs`) from `index.ts`. Added `packages/scanner/src/index.test.ts` with 13 Vitest unit tests covering: `--depth 0`, `--depth 1`, default depth, invalid `--depth abc`, `--max-pages 0` (below minimum), invalid `--timeout`, and standard flag parsing. All 13 pass.
4. **`main()` side-effect on import → fixed.** Added ESM-safe `import.meta.url` guard so `main()` only fires when the file is the actual process entry point — preventing test-environment side-effects.
5. Added `"test": "vitest run"` script to `package.json` for unit test runner access.

## Re-execution notes — 2026-06-07 (round 3)
**Addressed verifier issues:**
1. **ESM entry guard breaks symlinked bin invocation → fixed.** Removed the `process.argv[1] === fileURLToPath(import.meta.url)` guard entirely. Split into two files: `src/index.ts` (library entry — exports `parseArgs`, `CliArgs`, `main`; no auto-run) and `src/cli.ts` (CLI entry — unconditionally calls `main()`). Updated `package.json` `bin` from `dist/index.js` to `dist/cli.js`. Updated `tsup.config.ts` to build both entries as separate configs: `index` with `dts: true`, `cli` with `dts: false` and the `#!/usr/bin/env node` banner. Verified: `ln -sf dist/cli.js /tmp/bin/cookyay-scan && node /tmp/bin/cookyay-scan --help` prints usage and exits 0.
2. **Symlink regression test added.** Added `describe('bin symlink regression')` block to `src/index.test.ts` (test 14). Creates a tmpdir symlink pointing at `dist/cli.js`, spawns `node <symlink> --help`, asserts exit 0 and usage text in output. This is the exact failure mode identified by the verifier. All 14 unit tests pass.

## Implementation summary
**Files changed:**
- `packages/scanner/src/types.ts` — unchanged (verified good in prior rounds)
- `packages/scanner/src/crawler.ts` — unchanged (verified good in prior rounds)
- `packages/scanner/src/index.ts` — removed `fileURLToPath` import and ESM guard at bottom; exported `main()`; replaced guard with a comment explaining the cli/index split
- `packages/scanner/src/cli.ts` — new; unconditionally imports and calls `main()` from `index.ts`; this is the bin entry
- `packages/scanner/src/index.test.ts` — added `describe('bin symlink regression')` block (test 14): creates tmpdir symlink → `dist/cli.js`, spawns `node <symlink> --help`, asserts exit 0 and usage text; also added necessary imports (`spawnSync`, `mkdtempSync`, `symlinkSync`, `rmSync`, `join`, `resolve`, `tmpdir`, `fileURLToPath`)
- `packages/scanner/package.json` — changed `bin["cookyay-scan"]` from `./dist/index.js` to `./dist/cli.js`
- `packages/scanner/tsup.config.ts` — changed from single config to array of two configs: `index` (dts: true, no banner) and `cli` (dts: false, shebang banner, clean: false so it doesn't wipe the index output)
- `packages/scanner/e2e/scanner-crawl.spec.ts` — unchanged (8 e2e tests, all still pass)
- `packages/scanner/tsconfig.json` — unchanged

**Acceptance criteria check:**
- [x] `npx @cookyay/scanner <url>` crawls same-origin pages (configurable depth/page limit), driving Playwright Chromium — bin now `dist/cli.js`; symlink invocation verified working (`--help` via symlink prints usage, exit 0); `crawl()` in `crawler.ts` with BFS depth/maxPages; `--depth 0` accepted and respected
- [x] Collects per-page: cookies (name, domain, expiry, party), localStorage/sessionStorage keys, third-party request hosts, script/iframe origins, noscript tags — `collectPage()` in `crawler.ts:31-114`, unchanged and previously verified end-to-end
- [x] Run against fixture site (012), deterministically captures synthetic trackers' artifacts — 8 integration tests in `e2e/scanner-crawl.spec.ts`, unchanged and previously verified
- [x] Respects `--timeout`, exits non-zero with clear message on unreachable targets; never sends data anywhere — unchanged and previously verified; only egress is local `--output` file or stdout

**Tests:**
- Unit: `pnpm --filter @cookyay/scanner test` → 14/14 pass
- E2E: `pnpm --filter @cookyay/scanner test:e2e --grep scanner-crawl` (requires `pnpm --filter cookyay build` first)

**Notes for verifier:** The fix is a clean cli/index split — `src/index.ts` is the pure library (exports `parseArgs`, `CliArgs`, `main`; no side effects on import), `src/cli.ts` unconditionally runs `main()`. The bin points at `dist/cli.js` which has the shebang. `dist/index.js` is the library-only output (no shebang, no auto-run). Symlink regression test (test 14) creates a real temp-dir symlink and spawns `node <symlink> --help` — this is the exact failure case from the prior verifier's repro.

## Verifier notes
<!-- Empty at creation. Populated by /pm:verify if rejected. -->

## Verifier notes — 2026-06-07 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Implementation is substantively solid (all 44 e2e tests pass, collection verified end-to-end), but the CLI silently coerces `--depth 0` to the default of 2, making a valid depth value unconfigurable — criterion 1 is PARTIAL.
**What needs to change:**
1. `numFlag()` in `packages/scanner/src/index.ts` (line ~35) guards with `Number.isFinite(n) && n > 0`, so `--depth 0` falls through to the default of 2. Depth 0 ("scan only the start page, follow no links") is a valid value — `crawl()` supports it and `e2e/scanner-crawl.spec.ts` uses `depth: 0` throughout. Verified live: `node dist/index.js <url> --depth 0` prints `(depth: 2, ...)` and follows links. Fix: accept `n >= 0` for `--depth` (keep `> 0` for `--max-pages` and `--timeout`), and add a test covering `--depth 0` through the CLI arg path (a unit test of `parseArgs`, or an e2e invocation of the built CLI).
2. Same root cause, secondary: invalid numeric flag values (`--depth abc`, `--max-pages 0`) are silently replaced by defaults with no message. Emit a `console.error` warning (or exit non-zero) on unparseable/out-of-range flag values — consistent with the project's "misconfiguration surfaces as structured warnings, silent config typos are the top DX hazard" stance (architecture.md §5).
**Acceptance criteria check:**
- [ ] `npx @cookyay/scanner <url>` crawls same-origin pages (configurable depth/page limit), driving Playwright Chromium — PARTIAL: Chromium launch, BFS, same-origin filtering, hash-normalized dedupe, and `--max-pages` all verified; but `--depth 0` is silently ignored (becomes 2), so depth is not fully configurable.
- [x] Collects per-page cookies/storage/third-party hosts/script-iframe origins/noscript — verified end-to-end against an ad-hoc page setting a cookie, localStorage, sessionStorage, and a third-party request: all captured with correct fields (name/domain/expiry/firstParty; storage type+key; `example.com` flagged third-party). Fixture-site run captured 6 scripts, 1 iframe, 1 noscript, 4 requests.
- [x] Deterministic capture of fixture-site (012) tracker artifacts, covered by integration test — 8 tests in `e2e/scanner-crawl.spec.ts` all pass (blocked inline + GA4 analytics scripts, pixel marketing script, ytplayer iframe with data-src/category, noscript, multi-page depth traversal).
- [x] `--timeout` respected; non-zero exit with clear message on unreachable targets; local-only output — verified exit 1 + clear stderr message for unreachable target, missing URL, and invalid URL; findings go only to stdout or the `--output` file; no network egress of collected data in `crawler.ts`/`index.ts`.
**Tests:** 44/44 Playwright e2e pass (8 new scanner-crawl + 36 pre-existing); `tsc --noEmit` and `eslint src` clean.
**Notes for next executor:** Only `packages/scanner/src/index.ts` needs touching (plus a small test for the flag parsing). Everything else — `crawler.ts`, `types.ts`, the e2e spec, the `playwright` prod dep, the DOM lib tsconfig change — verified good; do not rework. Build order matters: `pnpm --filter cookyay build` before `pnpm --filter @cookyay/scanner exec playwright test` (the fixture server serves the banner bundle).

## Verifier notes — 2026-06-07 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** The prior round's issues (`--depth 0`, silent flag fallback, tests) are all fixed and verified, but the new ESM entry guard added in this round breaks the bin/npx invocation path — `npx @cookyay/scanner <url>` would silently do nothing and exit 0, failing criterion 1 as literally written.
**What needs to change:**
1. **Entry guard breaks symlinked bin invocation.** `packages/scanner/src/index.ts` (lines ~105-112) guards `main()` with `process.argv[1] === fileURLToPath(import.meta.url)`. npm installs package bins as symlinks on macOS/Linux (`node_modules/.bin/cookyay-scan` → `dist/index.js`; the dist file has the `#!/usr/bin/env node` shebang via tsup banner). When invoked through the symlink, `process.argv[1]` is the symlink path but Node realpaths the main ESM module, so `fileURLToPath(import.meta.url)` is the resolved `dist/index.js` path — the comparison is false and `main()` never runs. Verified live: `ln -s .../dist/index.js /tmp/cy-bin/cookyay-scan && node /tmp/cy-bin/cookyay-scan <url> --depth 0` produces **no output and exit 0** (silent no-op; same for `--help`). pnpm workspace bins and `npx` hit the same path. Fix options (either is fine):
   - Preferred: drop the guard heuristic entirely — keep `src/index.ts` as the library entry (exports `parseArgs`, `CliArgs`), add a tiny `src/cli.ts` that imports and unconditionally runs `main()`, point `package.json` `bin` at `dist/cli.js`, and add `src/cli.ts` to the tsup entry list. Tests import from `index.ts` and never touch `cli.ts`, so no guard is needed.
   - Alternative: realpath both sides, e.g. `realpathSync(process.argv[1] ?? '') === __filename` wrapped in try/catch (argv[1] may be undefined or nonexistent).
2. **Add a regression test for the bin invocation path.** Spawn the built CLI through a symlink (create one in a temp dir pointing at `dist/index.js` or `dist/cli.js`) and assert `--help` prints usage and exit 0 — this is what would have caught the silent no-op. A plain `node dist/index.js --help` spawn test is not sufficient; the symlink is the failure trigger.
**Acceptance criteria check:**
- [ ] `npx @cookyay/scanner <url>` crawls same-origin pages (configurable depth/page limit), driving Playwright Chromium — FAIL on the npx path: bin-style symlink invocation silently no-ops (see item 1). Direct `node dist/index.js` verified working: `--depth 0` now accepted and respected (1 page visited, no link follow against fixture index.html with links present), `--max-pages` honored, invalid `--depth abc` emits a warning and falls back to default 2, BFS same-origin crawl via `chromium.launch()` confirmed in `crawler.ts`.
- [x] Collects per-page cookies/storage/third-party hosts/script-iframe origins/noscript — verified end-to-end against an ad-hoc page (port 4777) setting a cookie, localStorage, sessionStorage, and a cross-origin fetch: cookie captured with name/domain/expiry/firstParty, both storage keys captured with type, cross-origin request flagged `firstParty: false`. Fixture-site scan captured 2 scripts, 1 noscript, 4 requests.
- [x] Deterministic fixture-site (012) capture covered by integration test — 8 tests in `e2e/scanner-crawl.spec.ts` pass (blocked analytics/marketing scripts with categories, blocked ytplayer iframe with data-src, noscript, request records, depth-1 multi-page traversal, unreachable-target rejection).
- [x] `--timeout` respected; non-zero exit + clear message on unreachable targets; local-only output — verified exit 1 with `Error: page.goto: net::ERR_CONNECTION_REFUSED ...` on unreachable target (--timeout 3000 honored), exit 1 on missing/invalid URL with clear messages; only egress is the local `--output` file or stdout; no telemetry anywhere in `crawler.ts`/`index.ts`.
**Tests:** Unit 13/13 pass (`pnpm --filter @cookyay/scanner test`); e2e 44/44 pass (full scanner-package Playwright suite); `tsc --noEmit` and `eslint src` clean.
**Notes for next executor:** Only the CLI entry wiring needs touching — `packages/scanner/src/index.ts` (and `package.json` `bin` + `tsup.config.ts` entry if you take the `cli.ts` split, which is the cleaner fix). `crawler.ts`, `types.ts`, `index.test.ts`, the e2e spec, the `numFlag(minValue)` refactor, and the warning behavior are all verified good — do not rework. Keep `parseArgs`/`CliArgs` exported (unit tests depend on them). Build order for e2e: `pnpm --filter cookyay build` first (fixture server serves the banner bundle), then `pnpm --filter @cookyay/scanner exec playwright test`. Repro for the bug: `pnpm --filter @cookyay/scanner build && ln -sf "$PWD/packages/scanner/dist/index.js" /tmp/cookyay-scan && node /tmp/cookyay-scan --help` → currently prints nothing.

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Round-3 fix (cli/index split) resolves the symlinked-bin silent no-op; all four criteria now verified live, including the exact prior failure repro, with full test suite green.
**Acceptance criteria check:**
- [x] `npx @cookyay/scanner <url>` crawls same-origin pages (configurable depth/page limit), driving Playwright Chromium — `package.json` bin → `dist/cli.js` (shebang present, executable); verified live through a temp-dir symlink (the prior failure trigger): `--help` prints usage + exit 0, and a full scan via the symlink against an ad-hoc 2-page site visited both pages at `--depth 1`, only the start page at `--depth 0`, with `--max-pages` honored; `--depth abc` emits `Warning: --depth "abc" is not a valid value (expected integer >= 0); using default 2.`; BFS + same-origin filter + hash-normalized dedupe in `crawler.ts`, `chromium.launch()` confirmed.
- [x] Collects per-page cookies/storage/third-party hosts/script-iframe origins/noscript — verified end-to-end via the built CLI against an ad-hoc server (port 4888): cookie captured with name/domain/expiry/firstParty (`verify_cookie`, expiry honored, firstParty true), `localStorage`/`sessionStorage` keys with type, cross-port fetch flagged `firstParty: false` with host+resourceType, blocked analytics script (src+category), blocked iframe (dataSrc+category, src null), noscript text.
- [x] Deterministic fixture-site (012) capture covered by integration test — 8 tests in `e2e/scanner-crawl.spec.ts` pass (blocked analytics/marketing scripts with categories, blocked ytplayer iframe, noscript, request records, depth-1 multi-page traversal, unreachable-target rejection).
- [x] `--timeout` respected; non-zero exit + clear message on unreachable targets; local-only output — verified exit 1 with `Error: page.goto: net::ERR_CONNECTION_REFUSED ...` via symlinked bin (`--timeout 3000` honored), exit 1 + clear messages for missing and invalid URL; code review of `crawler.ts`/`index.ts`/`cli.ts` shows the only data egress is the local `--output` file or stdout — no telemetry.
**Tests:** Unit 14/14 pass (`pnpm --filter @cookyay/scanner test`, includes the symlink regression test which spawns `node <tmpdir-symlink> --help` against `dist/cli.js`); e2e 44/44 pass (full scanner-package Playwright suite); `tsc --noEmit` and `eslint src` clean. Non-blocking observation: `tsup.config.ts` runs two parallel configs with `clean: true` on the index entry — builds correctly today, but if tsup's parallel scheduling ever changes, the clean could race the cli output; consider `clean: false` everywhere with a prebuild `rm -rf dist` if flakiness appears.
