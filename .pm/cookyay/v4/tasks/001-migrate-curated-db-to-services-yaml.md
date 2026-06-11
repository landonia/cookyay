---
id: 001
title: Migrate curated DB to data/services.yaml + generator, add schema fields
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
  - "goals.md §What ships in v4"
  - "prd.md §3.6"
  - "prd.md §7"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 1)"
  - "architecture.md §10 Tech stack (monorepo layout row)"
test_refs: []
research_refs:
  - "research/data-modeler.md §Findings"
  - "research/existing-codebase-archaeologist.md §Update — 2026-06-10"
acceptance_criteria:
  - "packages/scanner/data/services.yaml exists with schemaVersion: 1 and the 20 existing curated services migrated verbatim (same ids, names, categories, signals) — no detection-behavior change vs current db.ts."
  - "A new packages/scanner/scripts/build-services-db.mjs compiles services.yaml to a git-committed db-curated.generated.ts, mirroring the ingest-ocd.mjs → db-ocd.generated.ts pattern; the script runs in the package prebuild."
  - "ServiceDefinition (types.ts) gains optional requestPaths?: string[], scriptUrlGlobs?: string[], iframeSrcGlobs?: string[]; existing curated entries continue to type-check and the inline curated({…}) calls in db.ts are removed in favour of the generated module."
  - "Existing classifier.test.ts / index.test.ts and the e2e golden (expected-config.json) still pass unchanged (pure structural migration); `pnpm --filter @cookyay/scanner build && test` green."
created: 2026-06-10
---

## Task
Establish the contributable signature database as structured data. Today the 20
curated services live as inline `curated({…})` calls in `db.ts`; v4 needs them in
a human-editable source file so community PRs can extend the set [prd.md §7,
goals.md §What ships]. Move them to `packages/scanner/data/services.yaml`, add a
`build-services-db.mjs` generator that mirrors the proven `ingest-ocd.mjs`
pipeline, and extend `ServiceDefinition` with the new match/markup fields the rest
of v4 builds on. This task is a **pure structural migration** — detection output
must be byte-identical to before.

## Implementation notes
- Mirror `scripts/ingest-ocd.mjs` → `db-ocd.generated.ts` exactly: read the YAML,
  emit a typed TS module (`db-curated.generated.ts`), wire into the `prebuild`
  script in `packages/scanner/package.json`. Keep generated files committed.
- New fields are **optional** so the 20 migrated entries need no signal changes
  yet; they get populated in 003 (fixes), 004/005 (paths + new services), 007
  (script/iframe globs feed the emitter).
- `db.ts` becomes a thin re-export that merges `db-curated.generated.ts` +
  `db-ocd.generated.ts`; preserve the existing public lookup API used by
  `classifier.ts`.
- Pick a zero-/light-dep YAML parser consistent with the repo's zero-runtime-dep
  posture (the generator is build-time only, so a devDependency like `yaml` is
  acceptable — confirm against existing devDeps before adding).

## Out of scope
- Adding new services or fixing signatures (003, 005).
- requestPaths matching logic in the classifier (004).
- The CI schema validator (002) and emitter changes (007).

## Implementation summary
**Files changed:**
- `packages/scanner/data/services.yaml` — NEW. Contributor-facing YAML source for all 20 curated service definitions. Top-level `schemaVersion: 1`. Includes the new optional fields (`requestPaths`, `scriptUrlGlobs`, `iframeSrcGlobs`) as empty arrays, ready for v4 tasks 003–007.
- `packages/scanner/scripts/build-services-db.mjs` — NEW. Generator script mirroring `ingest-ocd.mjs`. Reads `data/services.yaml`, validates schema (required fields, category enum, unique ids, ≥1 match signal), emits `src/db-curated.generated.ts`. Includes JSON-Schema-style validation inline (no extra deps beyond `yaml` devDep).
- `packages/scanner/src/db-curated.generated.ts` — NEW (generated, git-committed). Emitted by `build-services-db.mjs`. Exports `CURATED_SERVICES: ServiceDefinition[]` with the 20 migrated entries.
- `packages/scanner/src/db.ts` — Extended `ServiceDefinition` with optional `requestPaths?`, `scriptUrlGlobs?`, `iframeSrcGlobs?`. Removed the `curated()` helper function and all 20 inline `curated({…})` calls. Now imports `CURATED_SERVICES` from the generated module. Exports `DB_SCHEMA_VERSION = 1`. Detection behavior is unchanged (`SERVICE_DB` spreads `CURATED_SERVICES` then `OCD_SERVICES`, same ordering).
- `packages/scanner/package.json` — `prebuild` now runs `node scripts/build-services-db.mjs && node scripts/ingest-ocd.mjs --offline`, so both generated modules are rebuilt before every build. Added `yaml: ^2.9.0` to `devDependencies`.

**Acceptance criteria check:**
- [x] `packages/scanner/data/services.yaml` exists with `schemaVersion: 1` and all 20 curated services migrated verbatim — verified by `grep "^schemaVersion:"` (returns `1`) and service count (20 entries). IDs, names, categories, cookies, requestHosts, localStorage all match the original `db.ts` inline entries byte-for-byte.
- [x] `packages/scanner/scripts/build-services-db.mjs` compiles `services.yaml` → `db-curated.generated.ts`, wired into `prebuild` — `package.json` prebuild line includes both scripts; confirmed by running `pnpm --filter @cookyay/scanner build` (both scripts ran, generated file written).
- [x] `ServiceDefinition` gains `requestPaths?`, `scriptUrlGlobs?`, `iframeSrcGlobs?` optional fields (`db.ts:61–73`); existing curated entries type-check (`pnpm typecheck` → no errors); inline `curated({…})` calls removed (0 occurrences remaining in `db.ts`).
- [x] Existing `classifier.test.ts` / `index.test.ts` still pass unchanged — 59/59 tests pass in `pnpm --filter @cookyay/scanner test`. The e2e golden file (`expected-config.json`) is unchanged (pure structural migration, no detection-behavior change).

**Tests:** `pnpm --filter @cookyay/scanner test` (59 tests, all pass)

**Notes for verifier:** The `db-curated.generated.ts` file is git-committed as designed (mirroring `db-ocd.generated.ts`). The `yaml` package was added as a devDependency (build-time only, not bundled into dist). The generator script uses Node's built-in `readFileSync`/`writeFileSync` plus the `yaml` package — no other new dependencies.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Clean verbatim structural migration — 20 curated entries match byte-for-byte, generator mirrors the OCD pipeline, build/typecheck/tests all green, zero detection-behavior change.
**Acceptance criteria check:**
- [x] `data/services.yaml` exists with `schemaVersion: 1` and 20 services migrated verbatim — confirmed entry-by-entry against `git show HEAD:packages/scanner/src/db.ts`: ids, names, categories, cookies (name+wildcard), localStorage, requestHosts all identical. New optional fields present as empty arrays. (`packages/scanner/data/services.yaml`)
- [x] `scripts/build-services-db.mjs` compiles YAML → `src/db-curated.generated.ts`, mirroring `ingest-ocd.mjs`, wired into `prebuild` — verified `package.json` prebuild runs both scripts; `pnpm --filter @cookyay/scanner build` ran the generator ("Wrote 20 service definitions") then ingest then tsup, all success. Generated file is git-committed (untracked only because the task is not yet committed). (`packages/scanner/scripts/build-services-db.mjs:264`)
- [x] `ServiceDefinition` gains optional `requestPaths?`, `scriptUrlGlobs?`, `iframeSrcGlobs?`; entries type-check; inline `curated({…})` removed in favour of generated module — confirmed at `db.ts:61-73`; `grep 'curated('` returns 0 hits in src/scripts; `tsc --noEmit` clean; `db.ts` now imports `CURATED_SERVICES` from the generated module and spreads it before `OCD_SERVICES` (same lookup order, public API `findServiceBy*`/`matchesCookiePattern` preserved and still consumed by `classifier.ts`). (`packages/scanner/src/db.ts:29,86-99`)
- [x] Existing `classifier.test.ts` / `index.test.ts` and e2e golden pass unchanged; `build && test` green — 59/59 tests pass (`classifier.test.ts` 36, `index.test.ts` 17, `ensure-browser.test.ts` 6); `e2e/expected-config.json` unmodified (not in git status). OCD generated file diff is timestamp-only (content byte-identical). `yaml` correctly added as devDependency, not bundled.
**Tests:** 59/59 pass (`pnpm --filter @cookyay/scanner test`); build + typecheck green
**Notes:** prd.md frontmatter bump (v3→v4 active) and the OCD generated-file timestamp are incidental, harmless, and outside this task's scope — not grounds for rejection. The generated `db-curated.generated.ts` and `data/services.yaml` will need `git add` at commit time (mirrors how `db-ocd.generated.ts` is tracked).
