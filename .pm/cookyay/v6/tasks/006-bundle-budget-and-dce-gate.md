---
id: 006
title: Bundle-budget gate + prod-DCE-strip assertion + parity-still-green
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["002", "003", "004"]
complexity: 2
prd_refs:
  - "prd.md §3.1"
  - "prd.md §5"
  - "goals.md §Acceptance bar"
arch_refs: []
test_refs: []
research_refs:
  - "research/performance-engineer.md §Findings 1,3,5; Recommendations"
  - "research/existing-codebase-archaeologist.md §Findings 9"
acceptance_criteria:
  - "`pnpm size` (size-limit) is green: the auto-block-ENABLED bundle (DB + matcher + <img> proxy + new Image override) stays under the <20KB min+gzip budget [prd.md §3.1], and the measured size is recorded (commit message or .size-limit.json comment)."
  - "The auto-block-OFF bundle still tree-shakes the signature DB to zero and remains within its existing budget entry (≈13KB) — the statically-imported <img> proxy additions did not bloat the default install beyond tolerance [archaeologist §9; perf §5]."
  - "The bootstrap-first diagnostic is confirmed DCE-stripped from the production build: an assertion/check shows the diagnostic's identifying strings (e.g. 'INSTALL ORDER WARNING') and autoblock-diagnostic symbols are ABSENT from the minified production bundle [research/performance-engineer.md §Findings 3]."
  - "The scanner↔banner parity test stays green across the expanded DB (`pnpm test`), confirming no scan-time/run-time divergence was introduced by the new pixel entries."
created: 2026-06-11
---

## Task
Guard v6's additions against the hard `<20KB` budget and confirm the dev-only
diagnostic costs zero bytes in production. v5 left ~6KB of gzip headroom on the
enabled bundle; the pixel entries (~48–65B each) and the small `<img>` proxy addition
fit comfortably, but the budget must be enforced, not assumed [research/performance-engineer.md §1].

## Implementation notes
- Update `.size-limit.json` if the enabled-bundle entry needs its description/threshold
  refreshed; keep the OFF-bundle and bootstrap entries.
- DCE check: build the production bundle and grep the minified output to assert the
  diagnostic strings/symbols are absent (proves the `NODE_ENV`/`__DEV__` guard worked).
  tsup's `minify:true` IIFE build already enables esbuild DCE — no config change needed
  [perf §3].
- This is a verification/gate task — small surface, but it must actually run the build
  and size step, not just inspect config.

## Out of scope
- The feature implementations (tasks 002/003/004) and e2e proofs (task 005).
- Adding new pixel DB entries (task 001) — this only confirms they fit the budget.

## Implementation summary
**Files changed:**
- `.size-limit.json` — Updated entry name comments to reflect v6 measured sizes (12.27 kB IIFE+bootstrap, 12.6 kB ESM OFF, 15.01 kB ESM ON). All budgets unchanged (20 kB / 1 kB / 13 kB / 20 kB).
- `packages/cookyay/tsup.config.ts` — Added `define: { 'process.env.NODE_ENV': '"production"' }` to the IIFE CDN build entry. Without this, esbuild does not replace `process.env.NODE_ENV` even with `minify: true`, so the `if (process.env.NODE_ENV === 'production') return` guard in `autoblock-diagnostic.ts` is never constant-folded and the diagnostic body survives minification. The ESM build keeps `"development"` (already had the define) so bundler consumers see the diagnostic in non-production builds as intended.
- `packages/cookyay/src/api.ts` — Wrapped the `runBootstrapDiagnostic` call site with `if (process.env.NODE_ENV !== 'production' && config.debug)`. The inner `process.env.NODE_ENV` guard at the call site is what enables esbuild to DCE the entire call reference (not just the function body), which in turn allows the function and `_formatDiagnosticWarning` to be tree-shaken from the IIFE output. Without this, the function shell remained even though the body was empty.
- `packages/cookyay/src/env.d.ts` — New minimal ambient type declaration for `process.env.NODE_ENV` (scoped to `{ readonly env: { readonly NODE_ENV: string } }`). Required because tsup's DTS builder does not include `@types/node` when generating declarations for a browser-targeted package. This is intentionally minimal — it does NOT pull in full `@types/node`.

**Acceptance criteria check:**
- [x] AC1: `pnpm size` green — IIFE+bootstrap: 12.27 kB gzip (< 20 kB); ESM ON: 15.01 kB gzip (< 20 kB). Measured sizes recorded in `.size-limit.json` name strings.
- [x] AC2: ESM OFF (auto-block disabled): 12.6 kB gzip (< 13 kB). DB tree-shaken to zero — `grep 'facebook.com/tr\|meta-pixel'` returns nothing from `dist/index.js`.
- [x] AC3: DCE confirmed — `grep 'INSTALL ORDER WARNING\|getEntriesByType\|runBootstrapDiagnostic\|_formatDiagnosticWarning\|process.env.NODE_ENV'` returns NO matches from `packages/cookyay/dist/index.iife.js`. Root cause was two-fold: (1) IIFE build lacked `define: { 'process.env.NODE_ENV': '"production"' }` so esbuild couldn't constant-fold the guard; (2) even with define, the function shell survived because its call site in `api.ts` was always live. Both gaps are now fixed.
- [x] AC4: `pnpm test` — 858 tests pass (19 test files), including `src/parity.test.ts` (51 tests) confirming scanner↔banner parity across the expanded DB.

**Tests:** `pnpm test` (858 tests, 19 files all green)

**Notes for verifier:**
- The task implementation note says "no config change needed" for esbuild DCE — this was incorrect: `define: { 'process.env.NODE_ENV': '"production"' }` was missing from the IIFE build in `tsup.config.ts`. The ESM build already had the define (set to `"development"`), but the IIFE production build did not, leaving `process.env.NODE_ENV` as a runtime expression that esbuild could not fold. The fix is minimal (one line) and matches what the research/perf §3 describes should happen.
- `env.d.ts` is an ambient declaration file, not a module. It applies globally to all TypeScript files in `src/` without requiring an import. It is intentionally narrow to avoid polluting browser TypeScript consumers with Node.js type namespace.
- ESM bundle (ON) grew from ~14.33 kB (v5 baseline) to 15.01 kB. This is within the 20 kB hard limit and matches the performance-engineer's projection for v6 additions (~650B increase from `<img>` proxy code + diagnostic + new pixel entries).

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Rebuilt from source and independently reproduced every gate — `pnpm size` green on all 4 entries with recorded numbers matching exactly, IIFE prod bundle DCE-strips all diagnostic symbols, ESM OFF tree-shakes the DB to zero, and the scanner↔banner parity suite stays green within the 858-test workspace run.
**Acceptance criteria check:**
- [x] AC1 (enabled bundle < 20KB, size recorded) — `pnpm size`: IIFE+bootstrap 12.27 kB gzip, ESM ON 15.01 kB gzip, both < 20 kB; measured sizes recorded in `.size-limit.json` name strings and match the live build exactly.
- [x] AC2 (OFF bundle tree-shakes DB to zero, within ~13KB entry) — ESM OFF 12.6 kB gzip < 13 kB limit; `grep -c 'facebook.com/tr|meta-pixel' dist/index.js` = 0; DB present only in `dist/autoblock-loader-*.js` (lazy chunk), confirming static `<img>` proxy additions did not pull the DB into the default install.
- [x] AC3 (diagnostic DCE-stripped from prod) — `grep -c` on `dist/index.iife.js` returns 0 for all of `INSTALL ORDER WARNING`, `getEntriesByType`, `runBootstrapDiagnostic`, `_formatDiagnosticWarning`, and `process.env.NODE_ENV`. The fix (IIFE `define: { 'process.env.NODE_ENV': '"production"' }` in tsup.config.ts + outer NODE_ENV guard at the `api.ts` call site) correctly elides the function shell, not just the body. Dev path preserved: `INSTALL ORDER WARNING` still present once in the ESM (`"development"`) build.
- [x] AC4 (parity green across expanded DB) — root `pnpm test` (`vitest run`): 19 files / 858 tests pass, including `packages/scanner/src/parity.test.ts` (51 tests). typecheck + lint also green, confirming `env.d.ts` integrates cleanly.
**Tests:** 858/858 pass (19 files); size 4/4 green; typecheck + lint clean.
**Note:** The Implementation summary referenced the parity test as `src/parity.test.ts`; its actual path is `packages/scanner/src/parity.test.ts`. Counts (858 total / 51 parity) are accurate; path label was the only imprecision — not a defect.
