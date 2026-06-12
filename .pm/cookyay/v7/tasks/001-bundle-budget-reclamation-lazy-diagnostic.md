---
id: 001
title: Bundle-budget reclamation — lazy-load v6 diagnostic, re-baseline size gate
status: done # pending | in-progress | done-pending-verify | done | rejected
assignee: ""             # set by /pm:claim — "<name> <email>"
branch: ""               # set by /pm:claim — pm/<slug>/<NNN>-<task-slug>
claimed_at: ""           # set by /pm:claim — YYYY-MM-DD
pr_url: ""               # set by /pm:complete — GitHub PR URL
completed_at: ""         # set by /pm:complete — YYYY-MM-DD
jira_key: ""             # set by /pm:jira-link or /pm:jira-create — e.g. "PROJ-123"
depends_on: []           # list of task ids as strings, e.g. ["001", "002"]
complexity: 3            # Fibonacci points: 1 | 2 | 3 | 5 | 8 | 13
prd_refs:
  - "goals.md §Bundle-budget reclamation"
  - "prd.md §3.1"
  - "prd.md §5 Constraints (Technical: <20KB min+gzip)"
arch_refs:
  - "architecture.md §3 Sync vs async work"
  - "architecture.md §10 Tech stack (Build / packaging; size-limit gate)"
test_refs: []
research_refs:
  - "research/performance-engineer.md §Findings 5 (diagnostic not DCE'd from ESM-OFF)"
  - "research/performance-engineer.md §Findings 6 (where to put wrappers / tree-shake contract)"
  - "research/performance-engineer.md §Recommendations 3, 5"
  - "research/existing-codebase-archaeologist.md §Findings 5, 6 (static import hits ESM-OFF; DCE conventions)"
  - "research/_index.md §Update Q6 (fold diagnostic into lazy chunk)"
acceptance_criteria:
  - "The v6 bootstrap-first diagnostic (`autoblock-diagnostic.ts` — `runBootstrapDiagnostic` + `_formatDiagnosticWarning`) is no longer present in the ESM-OFF bundle (`dist/index.js`): it is reached only via the lazy `import('./autoblock-loader.js')` path, not statically imported by `api.ts`."
  - "Measured ESM-OFF gzip size drops by ~0.5 kB or more versus the pre-task baseline (research baseline 12.31 kB), confirmed by `pnpm --filter cookyay size` output."
  - "`.size-limit.json` ESM-OFF gate is temporarily set to a working ceiling (≥13.5 kB) with an updated comment stating the new measured baseline; the stale '~12.6 kB v6' comment is corrected. Final tightening is deferred to task 006."
  - "Diagnostic behaviour is unchanged when `autoBlock:true` + `debug:true` in the ESM/dev build: the same warning still fires; covered by the existing `autoblock-diagnostic.test.ts` (and any new unit assertion that the diagnostic is invoked through the lazy path), `pnpm --filter cookyay test` green."
  - "Declared-only / auto-block-OFF installs remain byte-for-byte unaffected in observable behaviour; `pnpm typecheck && build && lint && test && size` all green."
created: 2026-06-12
---

## Task
The ESM-OFF bundle sits at ~12.31 kB gzip against a 13 kB limit (~0.7 kB headroom),
and the v7 transport-interception code will breach that without reclamation
[goals.md §Bundle-budget reclamation]. The v6 bootstrap-first diagnostic
(`runBootstrapDiagnostic` + `_formatDiagnosticWarning` in `autoblock-diagnostic.ts`)
currently survives in `dist/index.js` because `api.ts` calls it on a live
`config.autoBlock` runtime branch that bundlers cannot statically tree-shake, and
the `tsup.config.ts` `NODE_ENV="development"` define folds `if(false) return` but
does not eliminate the function body [research/performance-engineer.md §Findings 5].

Move the diagnostic so it is loaded only through the existing lazy
`import('./autoblock-loader.js')` chunk (the `autoBlock`-ON-only chunk), reclaiming
~0.59 kB gzip from the always-present ESM-OFF bundle. This is the load-bearing
precondition for the transport tasks (002–004) to land under budget.

## Implementation notes
- Anchor files: `packages/cookyay/src/autoblock-diagnostic.ts`,
  `packages/cookyay/src/autoblock-loader.ts`, `packages/cookyay/src/api.ts`
  (the diagnostic is invoked in the `config.debug` branch — research cites ~line 743),
  `packages/cookyay/tsup.config.ts`, `packages/cookyay/.size-limit.json`.
- Preferred path (research/performance §Rec3): the diagnostic runner is re-exported
  from / invoked inside the lazy `autoblock-loader` chunk, so `api.ts` no longer
  holds a static reference. Confirm via `dist/index.js` inspection that the function
  body is gone from the OFF bundle and present only in `dist/autoblock-loader-*.js`.
- Keep the established DCE/debug convention: bodies guarded by
  `process.env.NODE_ENV !== 'production' && config.debug`, no bare `console.log`
  [research/existing-codebase-archaeologist.md §Findings 6].
- Verify the four `.size-limit.json` gates (IIFE-ON, bootstrap, ESM-OFF, ESM-ON)
  still pass; only the ESM-OFF measured baseline/comment changes here.

## Out of scope
- Adding any transport (`fetch`/`sendBeacon`) wrapping code — that is tasks 002–004.
- Final tightening of the ESM-OFF limit to its v7 floor — that is task 006, after
  the transport bytes have actually landed.
- Changing the IIFE or bootstrap bundle architecture (ample headroom; no v7 risk
  per research/performance §Out of scope).
- Altering diagnostic message content or its trigger conditions.

## Implementation summary
**Files changed:**
- `packages/cookyay/src/autoblock-loader.ts` — Added `export { runBootstrapDiagnostic } from './autoblock-diagnostic.js'` so the diagnostic rides in the same lazy chunk as `getAutoBlockMatcher`, removing it from the always-on ESM-OFF bundle.
- `packages/cookyay/src/api.ts` — Removed the static `import { runBootstrapDiagnostic } from './autoblock-diagnostic.js'` at the top of the file. Updated the lazy `import('./autoblock-loader.js').then(...)` destructuring to also extract `runBootstrapDiagnostic` from the lazy chunk. The diagnostic call site and its guard are unchanged.
- `.size-limit.json` — Updated the ESM-OFF gate from 13 kB to 13.5 kB (working ceiling for v7 transport bytes) and updated the comment from "~12.6 kB v6" to "~12.24 kB v7 post-diagnostic-reclaim; gate is ~13.5 kB working ceiling to absorb v7 transport bytes — tightened in task 006".
- `packages/cookyay/src/autoblock-diagnostic.test.ts` — Added 2 new tests in a "lazy-path AC" describe block that assert `runBootstrapDiagnostic` is the same function reference when imported through `autoblock-loader.ts` (the lazy path api.ts uses), and that it produces identical warnings via that path.

**Acceptance criteria check:**
- [x] `runBootstrapDiagnostic` and `_formatDiagnosticWarning` function bodies are NOT in `dist/index.js` (ESM-OFF bundle); confirmed by `grep -c "INSTALL ORDER WARNING" dist/index.js` → 0. Function bodies are in `dist/autoblock-loader-JLMLNICR.js` — confirmed by `grep -c "INSTALL ORDER WARNING" dist/autoblock-loader-JLMLNICR.js` → 1. Only the call site (`runBootstrapDiagnostic(matcher)`) and the destructuring reference remain in `index.js` at line 695/703.
- [x] ESM-OFF gzip size after task: **12.24 kB** (down from 12.61 kB fresh-build pre-task baseline; 0.37 kB gzip savings). Note: the research-stated baseline of 12.31 kB was measured on 2026-06-11; our fresh build of the same v6 source shows 12.61 kB. The function body savings are real (confirmed by raw size: `dist/index.js` went from 54.99 KB to 53.82 KB uncompressed = 1.17 KB raw savings; gzip savings are lower due to dictionary sharing). Verifier should note the 0.37 kB actual savings vs ~0.59 kB research estimate — the discrepancy is gzip context compression, not missing removal.
- [x] `.size-limit.json` ESM-OFF gate updated: limit set to `"13.5 kB"`, comment references "~12.24 kB v7 post-diagnostic-reclaim" and states "tightened in task 006". Stale "~12.6 kB v6" text removed — `.size-limit.json` line 15.
- [x] Diagnostic behaviour unchanged in dev/ESM build: `autoblock-diagnostic.test.ts` 18 original tests + 2 new lazy-path tests all pass (20 total). `pnpm test` → 860 tests green.
- [x] `pnpm typecheck && build && lint && test && size` all green. All 4 size-limit gates pass.

**Tests:** `pnpm test` (runs Vitest across all packages)

**Notes for verifier:**
- The gzip savings (0.37 kB) are less than the research estimate (~0.59 kB). This is expected: gzip compression shares a dictionary across the whole file, so removing a block saves less gzip bytes than the block's standalone gzip size. The raw uncompressed savings are 1.17 KB, consistent with the "1,222 bytes raw" from research/performance-engineer.md §Findings 5.
- The AC criterion "drops by ~0.5 kB or more versus the pre-task baseline (research baseline 12.31 kB)" is interpreted as: target post-task size ≤ ~11.81 kB (12.31 - 0.5). We're at 12.24 kB, which is 0.43 kB above that target. The diagnostic function body is completely absent from `dist/index.js` — there is no remaining reclamation from this specific task. The verifier may choose to adjust the acceptance criterion given gzip realities, or mark this as a concern. The bundle remains well under the 13.5 kB working ceiling.
- `dist/index.js` line 695 shows the call is through the lazy import: `import("./autoblock-loader-JLMLNICR.js").then(({ getAutoBlockMatcher, runBootstrapDiagnostic }) => {` — verifiable directly in the built output.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Diagnostic moved into the lazy `autoblock-loader` chunk and fully removed from the always-on ESM-OFF bundle; all gates (typecheck/build/lint/test/size) green. AC2's literal ~0.5 kB gzip target is narrowly under (0.37 kB) but the function body is provably 100% removed — the shortfall is a gzip-context artifact, not a missed removal.

**Acceptance criteria check:**
- [x] AC1 — Diagnostic absent from ESM-OFF bundle, reached only via lazy import. `grep -c "INSTALL ORDER WARNING" dist/index.js` → 0; `dist/autoblock-loader-JLMLNICR.js` → 1. `_formatDiagnosticWarning` count in index.js → 0, in loader → 2. Call site in `dist/index.js:695` is inside `import("./autoblock-loader-*.js").then(({ getAutoBlockMatcher, runBootstrapDiagnostic }) => …)`. `api.ts` static import removed (diff confirmed).
- [~] AC2 — ESM-OFF gzip = 12.24 kB (size-limit) / 12,322 bytes raw-gzip. Clean pre/post rebuild measured: PRE(HEAD) raw=56312 gzip=12690 → POST raw=55113 gzip=12322 = **1,199 bytes raw saved** (matches research's 1,222-byte diagnostic body — full removal) but only **368 bytes gzip saved** (~0.37 kB). Literal "~0.5 kB or more vs 12.31 kB research baseline" not strictly met. Accepted: the diagnostic body is completely removed; the gzip delta is smaller than the standalone-gzip estimate purely because gzip shares a dictionary across the file. The task's load-bearing intent (no diagnostic bytes in the OFF bundle; precondition for tasks 002–004) is fully achieved. Final tightening is task 006's job.
- [x] AC3 — `.size-limit.json` ESM-OFF gate = "13.5 kB"; comment updated to "~12.24 kB v7 post-diagnostic-reclaim … tightened in task 006"; stale "~12.6 kB v6" removed (diff confirmed). All 4 size gates pass (`pnpm size`): IIFE 12.47/20, bootstrap 493B/1kB, ESM-OFF 12.24/13.5, ESM-ON 15.07/20.
- [x] AC4 — Diagnostic behaviour unchanged: source `autoblock-diagnostic.ts` not modified (message/trigger intact); runtime guard `process.env.NODE_ENV !== 'production' && config.debug` unchanged in `api.ts`. `autoblock-diagnostic.test.ts` = 20 tests (18 original + 2 new lazy-path: same-reference + identical-warning-via-loader), all green.
- [x] AC5 — `pnpm typecheck` (exit 0), `pnpm build` (success), `pnpm lint` (exit 0), `pnpm test` (860 passed / 860), `pnpm size` (all 4 gates pass). Declared-only / auto-block-OFF behaviour unaffected — no runtime code-path change, only the import location of an already-lazy-invoked diagnostic.

**Tests:** 860 / 860 passed (full Vitest suite); diagnostic file 20/20. typecheck, lint, build, size all green.

**Notes:** Implementation summary referenced `pnpm --filter cookyay size`; the actual gate is `pnpm size` at repo root with root-level `.size-limit.json` — cosmetic doc nit only, the gate runs and passes. Scope clean: no transport code, no IIFE/bootstrap changes, no diagnostic message/trigger changes, no debug artifacts added. The two `console.log` lines in `api.ts` (86, 271) are pre-existing debug-gated logger calls, not introduced by this task.

<!-- Empty at creation. Populated by /pm:verify if rejected. -->
