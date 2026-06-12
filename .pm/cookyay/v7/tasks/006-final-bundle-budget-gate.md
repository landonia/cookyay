---
id: 006
title: Final bundle-budget gate — verify ESM-OFF under budget, tighten size-limit
status: done      # pending | in-progress | done-pending-verify | done | rejected
assignee: ""             # set by /pm:claim — "<name> <email>"
branch: ""               # set by /pm:claim — pm/<slug>/<NNN>-<task-slug>
claimed_at: ""           # set by /pm:claim — YYYY-MM-DD
pr_url: ""               # set by /pm:complete — GitHub PR URL
completed_at: ""         # set by /pm:complete — YYYY-MM-DD
jira_key: ""             # set by /pm:jira-link or /pm:jira-create — e.g. "PROJ-123"
depends_on: ["001", "003", "004"]   # list of task ids as strings
complexity: 2            # Fibonacci points: 1 | 2 | 3 | 5 | 8 | 13
prd_refs:
  - "goals.md §Acceptance bar (bundle-budget reclamation lands)"
  - "prd.md §3.1 Consent banner library (<20KB min+gzip)"
  - "prd.md §5 Constraints (Technical)"
arch_refs:
  - "architecture.md §2 Scaling model (<20KB budget, CI-gated)"
  - "architecture.md §10 Tech stack (Build / packaging; size-limit)"
test_refs: []
research_refs:
  - "research/performance-engineer.md §Findings 4 (ESM-OFF headroom), §Recommendations 5 (raise then tighten)"
  - "research/existing-codebase-archaeologist.md §Findings 9 (four size-limit gates)"
acceptance_criteria:
  - "With all v7 transport code (tasks 002–004) landed, measured ESM-OFF (`dist/index.js`) gzip is back UNDER its limit with measurable headroom (research target ≥1 kB reclaimed net), confirmed by `pnpm --filter cookyay size`."
  - "`.size-limit.json` ESM-OFF gate is tightened from task 001's temporary working ceiling to a firm v7 floor (research suggests ~12.8 kB) with an updated comment citing the measured post-transport baseline; the temporary-raise comment is removed."
  - "The `autoBlock`-enabled bundles stay under their 20 kB min+gzip limits: IIFE-ON gate and ESM-ON gate (`index.js` + `autoblock-loader-*.js`) both pass."
  - "Declared-only / auto-block-OFF installs remain byte-for-byte unaffected by v7 (opt-out still tree-shakes the transport + DB code to zero in the OFF bundle)."
  - "Scanner↔banner parity (the v5 task-007 invariant) still holds — no regression in the shared signature contract."
  - "All four `.size-limit.json` gates pass; `pnpm typecheck && build && lint && test && size` all green in CI (including v6 browser-mode and format gates)."
created: 2026-06-12
---

## Task
Close the v7 bundle-budget loop. Task 001 reclaimed headroom up front (lazy-loading the
v6 diagnostic) and raised the ESM-OFF limit to a temporary working ceiling so the
transport tasks could land without false size failures. Now that the transport wrapping
code (002–004) is in, measure the real post-transport ESM-OFF size, confirm it sits
back under budget with the reclaimed headroom intact, and tighten `.size-limit.json` to
a firm floor so future drift is caught [research/performance-engineer.md §Rec5: "raise
temporarily … then tighten once reclamation is verified"].

This is the verification-and-tighten bookend to task 001 and proves the goals.md
acceptance-bar line: "Bundle-budget reclamation lands: ESM-OFF is back under budget with
measurable headroom, and the `autoBlock`-enabled bundle stays under the 20 KB budget."

## Implementation notes
- Anchor: `packages/cookyay/.size-limit.json` (four gates: IIFE-ON 20 kB, bootstrap 1 kB,
  ESM-OFF 13 kB nominal, ESM-ON 20 kB), `pnpm --filter cookyay size`.
- If the synchronous transport stub from task 002 pushed ESM-OFF closer to the limit than
  expected, this task may need to push a small additional slice of stub logic into the lazy
  chunk — keep that minimal and coordinate against the 002 seam rather than reworking it.
- Update the stale measured-size comments to the real v7 numbers (the v6 comments still say
  "~12.6 kB v6" / "~12.27 kB v6" / "~15.01 kB v6").

## Out of scope
- Any new transport feature work — tasks 002–004 own that.
- IIFE/bootstrap bundle architecture changes (ample headroom; no v7 risk).
- Changing the diagnostic lazy-load done in task 001 (only verifying its effect persists).

## Re-execution notes — 2026-06-11

**Verifier notes addressed:**

1. **Browser-mode regression (VN#1) — FIXED.** `src/transport-proxy.browser.test.ts` was not
   updated to call `activateTransportClassifiers()` after the task 006 lazy-chunk relocation.
   Added the same `activatePhase2(matcher)` helper used in `autoblock-transport.test.ts`
   (imports `activateTransportClassifiers`, `getOrigResponse`, `isUnloading` from
   `autoblock-proxy.js` and `makeFetchClassifier`/`makeBeaconClassifier` from
   `autoblock-transport-classifier.js`). All 33 standalone `activateMatcher(...)` call sites
   in the browser test (including two inline-lambda variants) replaced with `activatePhase2(...)`.
   Result: `pnpm test:browser` now 61/61 pass (was 23 failed / 38 passed).

2. **Format gate (VN#2) — FIXED.** Ran `npx prettier --write packages/cookyay/src/autoblock-transport-classifier.ts`.
   `pnpm format:check` now passes across all files.

3. **AC#6 check updated (VN#3) — DONE.** See updated AC check below.

**Verified full gate:**
`pnpm typecheck` ✓ | `pnpm build` ✓ | `pnpm lint` ✓ | `pnpm test` 970/970 ✓ |
`pnpm size` 4/4 gates ✓ | `cd packages/cookyay && pnpm test:browser` 61/61 ✓ |
`pnpm format:check` ✓

## Implementation summary

### What was done

Tasks 002–004 added synchronous transport stubs (fetch/sendBeacon wrappers) and the
full Phase-2 classify+hold+drain logic. After those tasks landed, the ESM-OFF bundle
(`dist/index.js`) measured **13.59 kB gzip** against the 13.7 kB temporary ceiling —
only 110 bytes of headroom and well above the 12.8 kB firm-floor research target.

This task reclaimed budget by relocating the full transport classify+drain logic from
the always-on bundle into the existing lazy `autoblock-loader` chunk:

**Two new exports added to `autoblock-transport-classifier.ts` (lazy chunk):**
- `makeFetchClassifier(matcher, debug, ctx)` — Phase-2 fetch classify+hold+204-stub factory
- `makeBeaconClassifier(matcher, debug, ctx)` — Phase-2 beacon classify+queue factory
- `makeTransportDrainHook(ctx, debug)` — grant-time drain callback factory (replays held
  fetches and queued beacons on `grant(category)`; moved from `api.ts`'s
  `_registerTransportHook()` which was removed)

**`autoblock-proxy.ts` (always-on bundle) changes:**
- `patchedFetch` and `patchedSendBeacon` shims reduced to 4-line delegation stubs via
  `_fetchClassifierFn` / `_beaconClassifierFn` function pointers
- `activateTransportClassifiers(fetchFn, beaconFn)` new export — called by `api.ts` after
  the lazy chunk resolves; also registers the `pagehide` unload listener
- `activateTransportClassifiers`, `getOrigResponse`, `isUnloading` exported for the context bag

**`api.ts` changes:**
- Lazy import destructures `makeFetchClassifier`, `makeBeaconClassifier`, `makeTransportDrainHook`
- Builds `classifierCtx` parameter bag (avoids static import from `autoblock-proxy.ts` in the
  lazy chunk, preventing shared-chunk extraction by esbuild)
- Calls `activateTransportClassifiers(fetchFn, beaconFn)` and
  `_registerTransportReleaseHook(makeTransportDrainHook(classifierCtx, debugFn))`
- Removed `_registerTransportHook()` function (~50 lines raw drain logic)

**`autoblock-loader.ts`:** Added `makeTransportDrainHook` to the re-export list.

**`autoblock-transport.test.ts`:** Added `activatePhase2(matcher)` helper that calls both
`activateMatcher()` and `activateTransportClassifiers()` to simulate full Phase 2 state in
unit tests. All 83 test sites updated from `activateMatcher(...)` to `activatePhase2(...)`.

**Re-execution (2026-06-11) — additional files changed to fix VN#1 and VN#2:**

- `packages/cookyay/src/transport-proxy.browser.test.ts` — Added `activatePhase2()` helper
  (mirrors `autoblock-transport.test.ts`); added imports for `activateTransportClassifiers`,
  `getOrigResponse`, `isUnloading` from `autoblock-proxy.js` and `makeFetchClassifier`,
  `makeBeaconClassifier` from `autoblock-transport-classifier.js`; replaced all 33 standalone
  `activateMatcher(...)` call sites (including two inline-lambda variants) with `activatePhase2(...)`.
- `packages/cookyay/src/autoblock-transport-classifier.ts` — Ran `prettier --write` to fix
  formatting (print-width violations in `makeFetchClassifier` function added by prior executor).

### Measured sizes (post-implementation)

| Bundle | Measured gzip | Gate |
|---|---|---|
| ESM-OFF (`dist/index.js`) | 12.92 kB | 13.1 kB (tightened from 13.7 kB) |
| IIFE-ON (`dist/index.iife.js` + `bootstrap.js`) | 13.7 kB | 20 kB |
| Bootstrap | 493 B | 1 kB |
| ESM-ON (`dist/index.js` + `dist/autoblock-loader-*.js`) | 16.92 kB | 20 kB |

Net reclamation from working ceiling: **0.78 kB** (12.92 kB vs 13.7 kB ceiling).
Net change from v6 pre-transport baseline (~12.6 kB): +0.32 kB for full transport support.

The research target of ≥1 kB from the ceiling was pre-implementation and overestimated
actual savings from removing the Phase-2 transport code (~3.4 kB raw → ~0.78 kB gzip
saved due to gzip dictionary sharing in the surrounding context). The firm v7 floor is
set at **13.1 kB** (180 bytes headroom over the 12.92 kB measured baseline).

### AC check

- [x] ESM-OFF under limit with measurable headroom: 12.92 kB < 13.1 kB gate (180B headroom)
- [x] Gate tightened from 13.7 kB working ceiling to 13.1 kB firm v7 floor; stale v6 comment removed
- [x] IIFE-ON (13.7 kB) and ESM-ON (16.92 kB) both under 20 kB
- [x] Tree-shake-to-zero contract preserved: no shared chunk in ESM build output
- [x] Scanner↔banner parity: scanner tests all pass (parity.test.ts 51 green); signature DB unchanged
- [x] All four `.size-limit.json` gates pass; full CI all green INCLUDING browser-mode (61/61) and format gates:
  `pnpm typecheck` ✓ | `pnpm build` ✓ | `pnpm lint` ✓ | `pnpm test` 970/970 ✓ | `pnpm size` 4/4 ✓ | `pnpm test:browser` 61/61 ✓ | `pnpm format:check` ✓

## Verifier notes — 2026-06-11 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Bundle/size gates all pass and numbers match, but AC #6's required full CI gate is RED on two fronts — the v6 browser-mode gate (23 failing transport browser tests, a regression this task's refactor introduced) and the format gate (unformatted file this task touched).

**What needs to change:**
1. **Browser-mode gate is red — regression caused by this task's lazy-chunk relocation.** `cd packages/cookyay && pnpm test:browser` fails: 23/34 tests in `src/transport-proxy.browser.test.ts` fail (full run: 23 failed / 38 passed). Root cause: this task moved the Phase-2 fetch/beacon classify+hold logic out of the always-on bundle and gated it behind `activateTransportClassifiers()` (sets `_fetchClassifierFn`/`_beaconClassifierFn`; see `packages/cookyay/src/autoblock-proxy.ts:864` and `:893` — the shims pass through when those pointers are null). The unit suite `src/autoblock-transport.test.ts` was migrated to an `activatePhase2()` helper (which calls both `activateMatcher()` AND `activateTransportClassifiers()`), but `src/transport-proxy.browser.test.ts` was NOT — it still calls only `activateMatcher(...)` (33 call sites, lines 83–601), so the classifier pointers stay null and every "held"/"queued" assertion sees an empty array (e.g. `transport-proxy.browser.test.ts:588` `expected [] to have a length of 1`). Fix: update the browser test setup to also call `activateTransportClassifiers(makeFetchClassifier(...), makeBeaconClassifier(...))` — mirror the `activatePhase2()` helper added to the jsdom suite — and re-run `pnpm test:browser` to green. (Do NOT relax the budget refactor; the activation seam is correct, the browser test just wasn't updated to the new two-step activation.)
2. **Format gate is red.** `pnpm format:check` fails on `packages/cookyay/src/autoblock-transport-classifier.ts` — the `makeFetchClassifier` function this task added is not prettier-formatted (e.g. the `classifyFetch` signature and a `debug?.(...)` call exceed the print width / wrong wrapping; `npx prettier --write` collapses them to single lines). Run `pnpm format` (or `prettier --write packages/cookyay/src/autoblock-transport-classifier.ts`) and re-verify with `pnpm format:check`.
3. **Update the Implementation summary's AC check honestly.** Its line "`pnpm typecheck && build && lint && test && size` all green" omits the browser-mode and format gates that AC #6 explicitly names ("including v6 browser-mode and format gates"). Both must be run and green before re-submitting.

**Acceptance criteria check:**
- [x] AC1 ESM-OFF under limit w/ measurable headroom — PASS: `pnpm size` → 12.92 kB < 13.1 kB gate (180 B headroom). Headroom is modest; note the ≥1 kB research target was not met, but the summary documents this honestly (gzip dictionary sharing) and the bundle is provably under budget.
- [x] AC2 gate tightened, stale comment removed — PASS: `.size-limit.json` ESM-OFF limit now 13.1 kB; comment reads "measured ~12.92 kB v7 post-transport-reclaim; firm v7 floor gate"; no temporary-raise comment remains. (The committed v6 baseline was 13 kB; the 13.7 kB temporary ceiling existed only in the uncommitted v7 task-001 working tree, so the net diff shows 13→13.1.)
- [x] AC3 autoBlock-ON bundles under 20 kB — PASS: IIFE-ON 13.7 kB, ESM-ON 16.92 kB, both < 20 kB.
- [x] AC4 OFF install tree-shakes transport+DB to zero — PASS: ESM build emits a single lazy `dist/autoblock-loader-*.js` chunk; ESM-OFF `index.js` measures 12.92 kB with the DB tree-shaken; no shared chunk extracted.
- [x] AC5 scanner↔banner parity holds — PASS: `pnpm test` → scanner `parity.test.ts` 51 tests green; full suite 970/970.
- [ ] AC6 all four size gates + full CI green INCLUDING browser-mode and format gates — FAIL: size (4/4), typecheck, lint, build, and node-mode test are green, but `pnpm test:browser` is RED (23 failures) and `pnpm format:check` is RED. AC #6 explicitly requires both.

**Tests:** `pnpm test` 970/970 pass; `pnpm size` 4/4 gates pass; `pnpm typecheck`/`pnpm lint`/`pnpm build` green. `pnpm test:browser` FAILS (23 failed / 38 passed). `pnpm format:check` FAILS (`autoblock-transport-classifier.ts`).

**Notes for next executor:** The size-budget work itself is correct and accepted — do not redo it. The two fixes are mechanical: (1) add `activateTransportClassifiers(...)` to the `transport-proxy.browser.test.ts` setup (copy the `activatePhase2()` pattern from `autoblock-transport.test.ts`; you'll need `makeFetchClassifier`/`makeBeaconClassifier` from `autoblock-transport-classifier.ts` wired with the same ctx bag `api.ts` builds), and (2) `pnpm format`. Then run the FULL gate `pnpm typecheck && pnpm build && pnpm lint && pnpm test && pnpm size && (cd packages/cookyay && pnpm test:browser) && pnpm format:check` and confirm every line is green before re-submitting.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Re-execution fixed exactly the two gates the prior rejection flagged — both verified green independently: `pnpm test:browser` 61/61 (was 23 failed) and `pnpm format:check` clean. All four size gates pass with the documented numbers; full CI green.
**Acceptance criteria check:**
- [x] AC1 ESM-OFF under limit w/ measurable headroom — `pnpm size` → ESM-OFF 12.92 kB < 13.1 kB gate (180 B headroom). ≥1 kB research target not met but documented honestly (gzip dictionary sharing); bundle provably under budget.
- [x] AC2 gate tightened, stale comment removed — `.size-limit.json` ESM-OFF limit now 13.1 kB; comment reads "measured ~12.92 kB v7 post-transport-reclaim; firm v7 floor gate"; no temporary-raise comment remains (committed v6 baseline was 13 kB; the 13.7 kB temporary ceiling lived only in the v7 working tree).
- [x] AC3 autoBlock-ON bundles under 20 kB — IIFE-ON 13.7 kB, ESM-ON 16.92 kB, both < 20 kB.
- [x] AC4 OFF install tree-shakes transport+DB to zero — ESM build emits a single lazy `dist/autoblock-loader-BOBMFIU6.js` chunk; DB endpoint strings absent from `dist/index.js`; no shared chunk extracted.
- [x] AC5 scanner↔banner parity holds — `parity.test.ts` 51/51 green; signature DB unchanged.
- [x] AC6 all four size gates + full CI green INCLUDING browser-mode and format gates — `pnpm typecheck` ✓ | `pnpm build` ✓ | `pnpm lint` ✓ | `pnpm test` 970/970 ✓ | `pnpm size` 4/4 ✓ | `pnpm test:browser` 61/61 ✓ | `pnpm format:check` ✓. Both previously-red gates confirmed green independently; fixes verified real (activatePhase2 helper + 33 updated call sites in transport-proxy.browser.test.ts), not just claimed.
**Tests:** node suite 970/970 pass; browser 61/61 pass; size 4/4 gates pass; typecheck/lint/build/format:check all green.
