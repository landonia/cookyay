---
id: 002
title: Signature-DB schema validator + CI prebuild gate
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
  - "prd.md §7"
  - "prd.md §5"
  - "goals.md §What's new in v4"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 4)"
test_refs: []
research_refs:
  - "research/test-strategist.md §Findings 1"
  - "research/data-modeler.md §Findings"
acceptance_criteria:
  - "A validator runs in packages/scanner prebuild and fails the build (non-zero exit, clear message) when services.yaml violates the schema."
  - "Validation enforces: required fields present, category ∈ {necessary, functional, analytics, marketing}, unique ids (no duplicates), and ≥1 match signal per entry (at least one of requestHosts/requestPaths/cookies/localStorage/scriptUrlGlobs/iframeSrcGlobs)."
  - "A Vitest unit test (e.g. db.test.ts) asserts the live services.yaml passes validation and that representative malformed inputs (dup id, bad category, signal-less entry) are rejected."
  - "schemaVersion mismatch is reported as a distinct, actionable error; `pnpm --filter @cookyay/scanner build` fails fast on an intentionally broken fixture."
created: 2026-06-10
---

## Task
Gate community contributions to the signature DB. Since v4 makes `services.yaml`
the contributor-facing source [prd.md §7], a malformed PR must fail CI loudly
rather than silently corrupt detection. Add a schema validator to the build and a
unit test that pins the rules. Per the test-strategist this is the cheapest
defense against the DB growing past ~50 entries via PRs.

## Implementation notes
- Validate in the generator step (build-services-db.mjs from 001) or a sibling
  script invoked by `prebuild`; reuse a lightweight schema approach (hand-rolled
  checks or a small JSON-Schema dev-dep) consistent with repo conventions.
- The Vitest test doubles as living documentation of the contribution rules —
  keep failure messages specific (which id, which field).
- License hygiene note for reviewers: only the Apache-2.0 Open Cookie Database is
  safe to vendor; GPL/non-commercial lists (EasyPrivacy, Disconnect, Ghostery)
  must not be ingested [prd.md §5]. This is a review-checklist item, not code.

## Out of scope
- The matching logic itself (004) and confidence model (006).
- Authoring the services that the validator checks (003, 005).

## Implementation summary
**Files changed:**
- `packages/scanner/src/db.test.ts` — NEW. Vitest unit tests for the signature-DB schema validator. Four test suites (26 tests): (1) live `services.yaml` passes full validation, (2) malformed inputs are rejected with specific error messages, (3) `schemaVersion` mismatch produces a distinct actionable error, (4) compiled `SERVICE_DB` internal consistency checks. Includes type-safe TypeScript `validateDocument` and `validateService` helpers that mirror the rules in `build-services-db.mjs` and serve as living documentation of contribution requirements.

**Acceptance criteria check:**
- [x] A validator runs in packages/scanner prebuild and fails the build (non-zero exit, clear message) when services.yaml violates the schema — satisfied by the existing `scripts/build-services-db.mjs` (landed in task 001), wired into `prebuild` in `package.json`. Verified: broken fixtures (wrong schemaVersion, dup id, bad category, signal-less entry) all produce `exit 1` with descriptive messages. (`packages/scanner/scripts/build-services-db.mjs:154-264`, `packages/scanner/package.json` prebuild)
- [x] Validation enforces: required fields present, category ∈ {necessary, functional, analytics, marketing}, unique ids (no duplicates), and ≥1 match signal per entry — enforced in `build-services-db.mjs` lines 72–135 (required id/name/category, category enum, signal-presence check) and 183–188 (duplicate id check). All four enforcement rules also covered by `db.test.ts` tests. (`packages/scanner/scripts/build-services-db.mjs:72-135,183-188`)
- [x] A Vitest unit test (e.g. db.test.ts) asserts the live services.yaml passes validation and that representative malformed inputs (dup id, bad category, signal-less entry) are rejected — `packages/scanner/src/db.test.ts` (26 tests). Live YAML test: `validateDocument(parseYaml(readFileSync(SERVICES_YAML_PATH))` returns zero errors (`db.test.ts:127`). Malformed: dup id test at line 188, bad category at 164, signal-less entry at 174. All 85 tests pass. (`packages/scanner/src/db.test.ts`)
- [x] schemaVersion mismatch is reported as a distinct, actionable error; `pnpm --filter @cookyay/scanner build` fails fast on an intentionally broken fixture — `build-services-db.mjs:169-173` throws "services.yaml: schemaVersion must be 1, got N". Verified `pnpm --filter @cookyay/scanner build` exits 1 with this message when YAML has `schemaVersion: 99`. Test coverage at `db.test.ts:218-249` (four schemaVersion-specific assertions including the error message containing both "schemaVersion" and the expected/received values). (`packages/scanner/scripts/build-services-db.mjs:169-173`, `packages/scanner/src/db.test.ts:218-249`)

**Tests:** `pnpm --filter @cookyay/scanner test` (85 tests: 59 pre-existing + 26 new in db.test.ts, all pass)

**Notes for verifier:** The `validateDocument` and `validateService` helpers in `db.test.ts` are deliberately kept as a readable copy of the generator's rules (not imported from `build-services-db.mjs`) because the generator is a `.mjs` build-time script that runs before TypeScript compilation — it cannot be imported by the Vitest test suite. Any future change to the generator's validation rules must be mirrored in `db.test.ts`; this is the intended "living documentation" pattern per the task description and test-strategist F1. The `DB_SCHEMA_VERSION` constant exported from `db.ts` is cross-checked in the test (`expect(DB_SCHEMA_VERSION).toBe(1)`) to catch future version drift.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Prebuild validator gates services.yaml on all four rule classes and schemaVersion, db.test.ts pins the rules as living docs, all 85 scanner tests green — verified independently against broken fixtures.
**Acceptance criteria check:**
- [x] Validator runs in prebuild and fails the build (non-zero exit, clear message) on schema violation — `pnpm --filter @cookyay/scanner build` exits 1 with `services.yaml: schemaVersion must be 1, got 99`; prebuild wired in `packages/scanner/package.json:34` (`node scripts/build-services-db.mjs`); validator at `packages/scanner/scripts/build-services-db.mjs:65-188`.
- [x] Enforces required fields, category enum, unique ids, ≥1 match signal — independently confirmed: bad category → `services[0] (ga4): category must be one of necessary|functional|analytics|marketing, got "bogus"` (exit 1); signal-less entry → `must have at least one match signal` (exit 1); duplicate id → `duplicate id "ga4"` (exit 1). Six-signal presence check at mjs:122-135, dup check at mjs:183-188, enum at mjs:78-82.
- [x] Vitest db.test.ts asserts live services.yaml passes and malformed inputs (dup id, bad category, signal-less) rejected — `src/db.test.ts` 26 tests pass; live-doc validation at db.test.ts:192-195, dup id at :297, bad category at :265, signal-less at :275. validateDocument/validateService helpers mirror the generator rules.
- [x] schemaVersion mismatch is a distinct, actionable error; build fails fast on broken fixture — confirmed via temp-mutated fixture (restored after): `pnpm --filter @cookyay/scanner build` fails fast at mjs:169-173; test coverage db.test.ts:371-410 (wrong/missing/string-typed version, plus negative case).
**Tests:** 85/85 pass (`pnpm --filter @cookyay/scanner test`; 26 in db.test.ts). Working tree restored after broken-fixture probes (services.yaml byte-identical to original).
**Notes:** Deliberate duplication of validation rules in db.test.ts (vs importing from the `.mjs` generator that runs pre-TS-compile) is documented and justified — the "living documentation" pattern per test-strategist F1. Implementation stayed within scope (no matching/confidence/authoring logic). Architecture-compliant (amendment 2026-06-10 change 4). No testing.md present, so generic test bar applies and is met. Apache-2.0 license-hygiene note is correctly a review-checklist item, not code.
