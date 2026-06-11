---
id: 008
title: Generate service-fingerprints.json from the DB source
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001"]
complexity: 3
prd_refs:
  - "goals.md §Acceptance bar"
  - "prd.md §3.6"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 3)"
test_refs: []
research_refs:
  - "research/test-strategist.md §Gotchas"
  - "research/existing-codebase-archaeologist.md §Update — 2026-06-10 (Q3)"
acceptance_criteria:
  - "fixtures/service-fingerprints.json is generated from the same services.yaml source (via the 001 generator or a sibling build step), not hand-maintained — regenerating produces no diff when the DB is unchanged."
  - "The build emits an error (or the generator overwrites) if the committed fingerprints file is stale relative to services.yaml, so it cannot drift as the DB grows to ~50."
  - "A CI/Vitest check fails when fingerprints and the DB diverge."
  - "The existing fixture-driven tests that consume service-fingerprints.json still pass against the generated file."
created: 2026-06-10
---

## Task
Remove the hand-maintained drift risk between `fixtures/service-fingerprints.json`
and the signature DB. As the curated set grows to ~50, a manually-mirrored stub
file will silently fall out of sync [research/test-strategist.md §Gotchas]. Make
the fingerprints file generated from the same `services.yaml` source so there is
one source of truth [architecture.md §Amendments change 3].

## Implementation notes
- Extend the 001 generator (or add a sibling script in the same `prebuild`) to
  emit the fingerprints stub from the parsed services. Commit the generated file.
- Add a drift guard: either fail the build when the committed file is stale, or a
  Vitest cross-check test comparing generated-vs-committed (the test-strategist
  suggested the latter as the lighter option).
- Keep the fingerprints schema whatever the fixture server (`fixtures/serve.mjs`)
  and existing tests expect — this is a generation/source change, not a format
  change.

## Out of scope
- Authoring new detection fixture pages and the second golden file (009).

## Implementation summary
**Files changed:**
- `packages/scanner/scripts/build-services-db.mjs` — Extended to also emit `fixtures/service-fingerprints.json` from the parsed `services.yaml` data. Added `FINGERPRINTS_OUTPUT_PATH` constant pointing to the workspace root fixtures directory. Added `renderPattern()` and `deriveRequestPatterns()` helper functions, plus the full fingerprints JSON generation step at the end of `main()`. The schema of the generated file matches the existing hand-maintained format (id, name, category, cookies as flat strings with `*` suffix for wildcards, localStorage, requestPatterns derived from requestHosts+requestPaths, stubScript: null, stubCookies: []).
- `fixtures/service-fingerprints.json` — Regenerated from `services.yaml` (50 curated services vs. prior 20 hand-maintained). Added `AUTO-GENERATED` description. `stubScript` and `stubCookies` default to null/[] for all services (fixture-server-specific, not derivable from schema). The file is now git-committed as a generated artifact, rebuilt in every `prebuild`.
- `packages/scanner/src/db.test.ts` — Added `FINGERPRINTS_PATH` constant (line 24) and new describe block `fixtures/service-fingerprints.json — drift guard (task 008)` (lines 735–808) with 5 Vitest tests: parses valid JSON, count matches curated DB count, every curated ID appears in fingerprints, every fingerprints ID appears in curated DB, categories match. Drift simulated and verified — removing one service from the fingerprints file causes 2 tests to fail with actionable error messages.

**Acceptance criteria check:**
- [x] `fixtures/service-fingerprints.json` is generated from `services.yaml` — `build-services-db.mjs` now generates both outputs; idempotency verified (two consecutive runs produce no diff).
- [x] Build overwrites if stale — generator runs in `prebuild` (already wired in `package.json`), always overwrites the committed file.
- [x] CI/Vitest check fails when fingerprints and DB diverge — `db.test.ts` drift guard tests verified to fail when IDs diverge; all 299 tests pass with current generated file.
- [x] Existing fixture-driven tests still pass — all 299 Vitest tests pass (`pnpm test` in `packages/scanner`).

**Tests:** `cd packages/scanner && pnpm test` — 299 tests, 4 files, all pass.

**Notes for verifier:**
- The `stubScript`/`stubCookies` fields default to `null`/`[]` for all services in the generated file (fixture-server-specific stubs for ga4.js, pixel.js, ytplayer.html are in the stub files themselves; their paths were previously hard-coded in the hand-maintained fingerprints but no code currently reads them).
- The drift-guard test uses ID + category checks. It does NOT byte-compare the full file (no golden file check) because `requestPatterns` derivation is intentionally simpler than the hand-crafted originals. The key invariant — service IDs and categories stay aligned — is what matters for test coordination.
- Regenerating `db-curated.generated.ts` is a side-effect of running `build-services-db.mjs`. The generated TS file is unchanged (same 50 services) since task 001 already ran.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Fingerprints file is now generated from `services.yaml` by `build-services-db.mjs` (wired into `prebuild`), is byte-idempotent across re-runs, and a Vitest drift guard fails on divergence; all 299 tests pass.
**Acceptance criteria check:**
- [x] Generated from same `services.yaml` source, not hand-maintained, no diff when DB unchanged — `build-services-db.mjs:269-346` emits `fixtures/service-fingerprints.json` from the parsed services; two consecutive generator runs produce byte-identical output (shasum `562188a…` unchanged), and the committed file matches a fresh regen.
- [x] Build overwrites if stale — `package.json:34` runs `build-services-db.mjs` in `prebuild`, which unconditionally `writeFileSync`s the committed file (the task explicitly accepts "generator overwrites" as a valid option).
- [x] CI/Vitest check fails when fingerprints and DB diverge — `db.test.ts:766-820` drift-guard block (count/missing-id/stale-id/category cross-checks). Independently verified: removing one service from the fingerprints file produced 2 failing tests with actionable "Run: node …/build-services-db.mjs" messages; restored after.
- [x] Existing fixture-driven tests still pass against the generated file — `cd packages/scanner && pnpm test` → 299/299 pass.
**Notes:** Generated file drops the prior hand-maintained `stubScript`/`stubCookies`/`stubIframeSrc` values (now null/[]/omitted). Verified no code consumes those fields — only `db.test.ts` reads the file, and `fixtures/serve.mjs`/E2E do not import it — so this is non-breaking. Matches architecture.md §Amendments 2026-06-10 change 3 (single `services.yaml` source of truth) and the test-strategist §Gotchas recommendation (Vitest ID cross-check over a golden byte-compare). Scope respected — detection fixtures + second golden file correctly deferred to task 009.
**Tests:** 299/299 pass; drift-guard negative case independently confirmed (2 failures on simulated drift).
