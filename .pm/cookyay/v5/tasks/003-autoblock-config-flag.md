---
id: 003
title: autoBlock config flag + validation + tree-shake-to-zero wiring
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["002"]
complexity: 3
prd_refs:
  - "goals.md §What ships in v5"
  - "prd.md §3.1"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (amend)"
test_refs: []
research_refs:
  - "research/performance-engineer.md §Findings"
  - "research/_index.md §Update — Author decisions"
acceptance_criteria:
  - "CookyayConfig (config.ts) gains an optional `autoBlock?: boolean` field, documented, defaulting to false — existing installs are byte-for-byte unaffected when omitted (declarative-only behavior unchanged)."
  - "Config validation: passing a non-boolean autoBlock emits a ConfigWarning consistent with the existing validateConfig pattern; the field is surfaced in the same warnings path as other config keys."
  - "When autoBlock is false (or omitted), the generated signature DB and matcher code TREE-SHAKE OUT of the bundle — verified by building the opt-out bundle and confirming db-autoblock.generated.ts symbols are absent (the import is conditional/lazy at module level, not top-level eager)."
  - "A unit test asserts the default is false and that the matcher/DB are only reachable when autoBlock is true; `pnpm --filter cookyay typecheck && test` green."
created: 2026-06-10
---

## Task
Auto-block is opt-in: a single config boolean enables it, default off, so no
existing install changes behavior silently [goals.md §What ships in v5,
research/_index.md §Update]. Critically, the signature DB must cost *zero bytes*
for the majority who leave auto-block off — so the DB/matcher import has to be
structured to tree-shake away under `autoBlock: false`
[research/performance-engineer.md §Findings]. This task adds the field, its
validation, and the conditional wiring that the interception proxy (004) keys off.

## Implementation notes
- Add `autoBlock?: boolean` near the other optional flags in `CookyayConfig`
  (`config.ts`), with a doc comment pointing at the "Cookyay first in <head>"
  install requirement (task 004/009 surface it to users).
- Tree-shaking: keep the `db-autoblock.generated.ts` + matcher import out of the
  always-on code path. A dynamic import or a guarded module-level branch that the
  bundler can prune is acceptable — prove it with a size/symbol check (task 008
  formalizes the budget gate).
- Follow the existing `validateConfig` / `ConfigWarning` conventions in `config.ts`.

## Out of scope
- The interception proxy itself (task 004).
- The size-limit CI gate wiring (task 008) — this task only proves tree-shaking
  works; 008 makes it an enforced gate.

## Implementation summary
**Files changed:**
- `packages/cookyay/src/config.ts` — Added `autoBlock?: boolean` field to `CookyayConfig` with comprehensive doc comment (pointing at "Cookyay first in `<head>`" install requirement, Google-skip behaviour, tree-shake-to-zero guarantee, and relevant references to goals.md/prd.md). Added `INVALID_AUTO_BLOCK` warning in `validateConfig()` using `config.autoBlock !== undefined && typeof config.autoBlock !== 'boolean'` check, consistent with the existing warnings pattern (non-fatal, carries a human-readable message including the received value via `JSON.stringify`).
- `packages/cookyay/src/autoblock-loader.ts` — New module (the conditional entry point for the auto-block path). Imports `matchAutoBlock` from `autoblock-matcher.ts` at module level (correct within this file), then exports `getAutoBlockMatcher(config)` which returns the function when `config.autoBlock === true` and `null` otherwise. Includes a doc comment explaining the tree-shaking contract: task 004's proxy MUST import this file via a dynamic `import()` inside `if (config.autoBlock)` so bundlers can prune it from opt-out builds. `autoblock-loader.ts` is NOT imported anywhere in the always-on bundle chain (api.ts, bootstrap.ts, index.ts, etc.).
- `packages/cookyay/src/config.test.ts` — New test file. 19 Vitest unit tests (jsdom env) covering: optional field with no warnings; `true`/`false`/`undefined` all produce no warnings; non-boolean values (string, number, null, object) produce `INVALID_AUTO_BLOCK`; warning message includes the received value; warning is non-fatal; warning coexists with other warnings; `getAutoBlockMatcher()` returns null for false/absent, returns the live matcher for true; matcher correctly hits Hotjar (non-Google service), returns null for unknown URLs, returns null for GTM (Google-skip rule).

**Acceptance criteria check:**
- [x] AC1 (`autoBlock?: boolean` in `CookyayConfig`, documented, default false, existing installs unaffected) — `config.ts:124–147` (field + doc comment); build confirms 0 autoblock symbols in both ESM and IIFE bundles (grep returns 0 matches for `AUTOBLOCK_SERVICES`/`hotjar`/`autoblock` in `dist/index.js` and `dist/index.iife.js`).
- [x] AC2 (non-boolean `autoBlock` emits `ConfigWarning` via `validateConfig` pattern) — `config.ts:191–197` (`INVALID_AUTO_BLOCK` check); tested by 8 tests in `config.test.ts:68–131` (`validateConfig — autoBlock type checking` describe block).
- [x] AC3 (tree-shake to zero when `autoBlock` false/omitted; DB symbols absent from opt-out bundle) — `pnpm --filter cookyay build` produces bundles with 0 occurrences of `AUTOBLOCK_SERVICES`/`hotjar`/`autoblock` symbols. Structural guarantee: `autoblock-loader.ts` is not imported by any module in the always-on bundle chain; task 004 will import it via dynamic `import()` inside `if (config.autoBlock)` (documented in `autoblock-loader.ts` JSDoc).
- [x] AC4 (unit test asserts default is false; matcher/DB only reachable when `autoBlock: true`; typecheck + test green) — `config.test.ts:141–198` (`getAutoBlockMatcher — conditional matcher access` describe block, 7 tests); `pnpm --filter cookyay typecheck` exits 0; `pnpm --filter cookyay exec vitest run` 375/375 pass.

**Tests:** `pnpm --filter cookyay typecheck && pnpm --filter cookyay exec vitest run`

**Notes for verifier:**
- `autoblock-loader.ts` is a new module that sits between the always-on bundle and `autoblock-matcher.ts`. It imports `matchAutoBlock` eagerly (top-level within the module), but the module itself is NOT in the always-on static import chain — it must only be imported by task 004 via a conditional dynamic `import()`. The JSDoc in `autoblock-loader.ts` explains this contract explicitly for task 004's implementor.
- Tree-shaking proof was verified with `grep -c "AUTOBLOCK_SERVICES\|hotjar\|autoblock"` on the built output files — both `dist/index.js` (ESM) and `dist/index.iife.js` (IIFE) returned 0 matches.
- The validation guard uses `config.autoBlock !== undefined` (not `'autoBlock' in config`) to avoid a false positive when a user explicitly sets `autoBlock: undefined` in their config object (which should be treated identically to omitting the field).

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** opt-in `autoBlock` flag, validation warning, and structural tree-shake-to-zero wiring all implemented and independently verified — opt-out bundles contain zero autoblock/DB symbols.
**Acceptance criteria check:**
- [x] AC1 (`autoBlock?: boolean`, documented, default false, existing installs unaffected) — `config.ts:138-161` adds the optional field with a thorough doc comment (install requirement, Google-skip, tree-shake guarantee, prd/goals refs). `validateConfig(baseConfig())` emits 0 warnings (`config.test.ts:37-58`). Empirically byte-stable: `dist/index.js` and `dist/index.iife.js` contain 0 occurrences of autoblock symbols/tracker hosts.
- [x] AC2 (non-boolean autoBlock emits ConfigWarning via existing pattern) — `config.ts:221-226` `INVALID_AUTO_BLOCK` guard uses `!== undefined && typeof !== 'boolean'`, non-fatal, surfaced via the same `warnings.push` path; message carries the received value via `JSON.stringify`. Covered by 8 tests (`config.test.ts:65-122`) including coexistence with `UNKNOWN_CATEGORY`.
- [x] AC3 (tree-shake to zero when off; DB symbols absent from opt-out bundle) — `pnpm --filter cookyay build` succeeds; `grep -c` for `AUTOBLOCK_SERVICES|hotjar|autoblock|matchAutoBlock|getAutoBlockMatcher` returns 0 in ESM (`dist/index.js`), IIFE (`dist/index.iife.js`), and `dist/bootstrap.js`; representative tracker hosts (`googletagmanager`, `hotjar`, etc.) also return 0. Structurally sound: `autoblock-loader.ts`/`autoblock-matcher.ts`/`db-autoblock.generated.ts` are imported by nothing in the always-on chain (verified by repo-wide grep) — only the test file and the autoblock modules themselves reference them. The 50-entry DB is genuinely populated, so the absence is real elimination, not an empty DB.
- [x] AC4 (unit test asserts default false; matcher/DB only reachable when true; typecheck + test green) — `getAutoBlockMatcher` (`autoblock-loader.ts:56-61`) gates access; `config.test.ts:140-187` (7 tests) confirms null for false/absent, live callable matcher for true (Hotjar hit, unknown miss, GTM Google-skip miss, singleton identity). `tsc --noEmit` clean, `eslint src` clean, `vitest run` 375/375 pass.
**Tests:** 375/375 pass (`pnpm --filter cookyay exec vitest run`); typecheck + lint clean. No testing.md present (test-strategy-compliance check skipped). Scope respected — proxy (004) and size-limit gate (008) correctly deferred.
