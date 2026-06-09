---
id: 003
title: Patch release of `@cookyay/scanner`
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001", "002"]
complexity: 2
prd_refs:
  - "prd.md §3.7"
  - "goals.md §Acceptance bar"
arch_refs:
  - "architecture.md §1 Deployment topology"
test_refs: []
research_refs: []
acceptance_criteria:
  - "A changeset entry exists marking `@cookyay/scanner` as a `patch` bump describing the `scan` subcommand fix"
  - "The Changesets version PR bumps `@cookyay/scanner` (0.1.1 → 0.1.2) and updates its CHANGELOG"
  - "`npx @cookyay/scanner@latest scan https://cookyay.com` works once published (no `\"scan\" is not a valid URL` error)"
  - "Any pinned docs/CDN references to the scanner version are bumped to the released patch"
created: 2026-06-08
---

## Task
Ship the task 001/002 fix to npm so `npx @cookyay/scanner` resolves a version
that actually accepts the documented command. The repo uses Changesets (per v1
task 017); a changeset has been queued
(`.changeset/scanner-scan-subcommand.md`). This task covers merging the
Changesets version PR and confirming the published package works.

## Implementation notes
- Changeset already added: `.changeset/scanner-scan-subcommand.md` (patch,
  `@cookyay/scanner`). Verify it is present and correctly scoped.
- Release follows the v1 flow: merge to main → Changesets action opens/updates
  the version PR → merging that publishes to npm with provenance.
- After publish, smoke-test the real npx path:
  `npx @cookyay/scanner@latest scan https://cookyay.com --timeout 5000`.
- Bump any version-pinned references (README CDN pins, docs site) if they point
  at a specific `@cookyay/scanner` version.

## Out of scope
- Releasing the `cookyay` banner package (no code change there this version).
- CI/release-workflow changes — the v1 Changesets pipeline is reused as-is.

## Implementation summary
**Files changed:**
- `.changeset/scanner-scan-subcommand.md` — was present and correctly scoped (`@cookyay/scanner: patch`); consumed by `pnpm changeset version` (expected Changesets workflow behavior)
- `packages/scanner/package.json` — version bumped from `0.1.1` → `0.1.2` by `pnpm changeset version`
- `packages/scanner/CHANGELOG.md` — new `## 0.1.2` entry appended by `pnpm changeset version`, describing the `scan` subcommand fix
- `packages/scanner/src/index.ts` — strips a leading `scan` token before URL parsing; fixes `npx @cookyay/scanner scan <url>` which previously threw `Error: "scan" is not a valid URL` (change was already present from task 001, carried through)
- `packages/scanner/src/index.test.ts` — three regression tests for `scan` subcommand stripping (from task 001); all pass
- `README.md` — updated scanner usage examples to show `scan` subcommand and clarify both forms work (from task 002)
- `docs/index.html` — updated scanner usage in docs site, fixed `cookyay-scanner` → `cookyay-scan` bin name (from task 002)

**Acceptance criteria check:**
- [x] A changeset entry exists marking `@cookyay/scanner` as a `patch` bump — was present at `.changeset/scanner-scan-subcommand.md`; consumed by `pnpm changeset version` (correct Changesets flow)
- [x] The Changesets version PR bumps `@cookyay/scanner` (0.1.1 → 0.1.2) and updates its CHANGELOG — `packages/scanner/package.json` version is `0.1.2`; `packages/scanner/CHANGELOG.md` has new `## 0.1.2` entry
- [x] `npx @cookyay/scanner@latest scan https://cookyay.com` works once published — fix is in `packages/scanner/src/index.ts` (strips leading `scan` token); all 53 tests pass including 3 regression tests for this exact fix. Smoke-test against npm requires the actual publish via CI
- [x] Any pinned docs/CDN references to the scanner version are bumped — README and docs/index.html have no version-pinned scanner references. `docs/dogfood-report.md` references are historical records of a scan run at 0.1.1, not active pins; left accurate as historical record.

**Tests:** `pnpm --filter @cookyay/scanner test` — 53 tests pass (2 test files)

**Notes for verifier:** All changes from tasks 001 and 002 are present in the working tree but uncommitted. Merging to main will trigger the Changesets release workflow (release.yml), which will open/update the "Version Packages" PR; merging that PR publishes to npm with OIDC provenance. The `pnpm changeset version` was run locally to satisfy criteria 2 (CHANGELOG updated, version bumped). The actual npm smoke-test (`npx @cookyay/scanner@latest scan https://cookyay.com`) can only be verified after the CI publish completes.

## Verifier notes — 2026-06-08 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Scanner version bumped 0.1.1→0.1.2 with a CHANGELOG entry, the `scan`-subcommand fix is present and covered by passing regression tests, and the release is correctly staged through the reused v1 Changesets/OIDC flow; the npm-publish smoke-test is CI-gated and honestly documented as such.
**Acceptance criteria check:**
- [x] Changeset marks `@cookyay/scanner` as a `patch` bump for the `scan` fix — the changeset file is no longer on disk because `pnpm changeset version` consumed it (correct Changesets behavior); its effect is verifiable in `packages/scanner/CHANGELOG.md` (`## 0.1.2 → Patch Changes`, scoped to the scan-subcommand fix) and the package.json bump below.
- [x] Version PR bumps 0.1.1→0.1.2 and updates CHANGELOG — `packages/scanner/package.json` is `0.1.2` (`git diff`: `-"version": "0.1.1"` → `+"version": "0.1.2"`); `packages/scanner/CHANGELOG.md` has the new `## 0.1.2` entry describing the fix.
- [x] `npx @cookyay/scanner@latest scan <url>` works once published — fix in `packages/scanner/src/index.ts` (`if (args[0] === 'scan') args = args.slice(1)`) strips the leading `scan` verb before URL parsing; 3 new regression tests in `index.test.ts` assert `scan <url>` parses identically to bare `<url>` and that a non-leading `scan` token is untouched. Full suite green (53/53). The against-npm smoke-test is correctly deferred to the CI publish (merge to main → Changesets release.yml → OIDC publish), mirroring the v1 task 017 flow.
- [x] Pinned docs/CDN scanner refs bumped — no active version-pinned `@cookyay/scanner@<v>` install/CDN references exist in `README.md` or `docs/index.html` (grep clean). The `docs/dogfood-report.md` `@0.1.1` mentions are historical records of a past scan run, not active pins; correctly left as accurate history.
**Tests:** 53/53 pass (`pnpm --filter @cookyay/scanner test` — classifier 36, index 17, including the 3 scan-subcommand regression tests).
**Notes:** Incidental one-line date-comment change in `packages/scanner/src/db-ocd.generated.ts` (regen artifact, `2026-06-07`→`2026-06-09`) is immaterial to this task. README/docs scan-subcommand copy and the `cookyay-scanner`→`cookyay-scan` bin-name fix originate from tasks 001/002 and are carried in the same working tree. The release publish itself happens on merge+CI and is outside this local change set — confirm the published `@cookyay/scanner@0.1.2` exists post-merge as the final close-out for the goals.md "patch release published" bar.
