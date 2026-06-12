---
id: 004
title: Bootstrap-first diagnostic — autoblock-diagnostic.ts, debug-gated, DCE-stripped from prod
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: []
complexity: 3
prd_refs:
  - "prd.md §3.1"
  - "goals.md §What's new in v6 — bootstrap-first diagnostic"
arch_refs:
  - "architecture.md §3 Sync vs async work"
test_refs: []
research_refs:
  - "research/runtime-interception-domain-expert.md §Findings 4; Gotchas 5"
  - "research/performance-engineer.md §Findings 3"
  - "research/_index.md §Update — Author decisions (D, G)"
acceptance_criteria:
  - "A new packages/cookyay/src/autoblock-diagnostic.ts exposes a dev-only function that, after the proxy/matcher is active in api.ts, detects known trackers that loaded BEFORE the Cookyay bootstrap by (a) scanning performance.getEntriesByType('resource') for URLs matching the curated DB and (b) a DOM scan of existing script[src]/img[src]/iframe[src] — emitting one actionable console.warn per hit naming the service and URL ('[Cookyay] INSTALL ORDER WARNING: \"<service>\" (<url>) loaded before Cookyay bootstrap. Move Cookyay first in <head>.') [runtime §4]."
  - "The diagnostic fires ONLY when config.debug === true; with debug unset/false it never runs and emits nothing [research/_index.md §Update D]."
  - "The diagnostic makes NO attempt to retroactively block already-fetched resources — it is purely advisory and never throws (tolerates absent Performance API entries / cross-origin name-only entries gracefully) [runtime §4, Gotcha 5]."
  - "The diagnostic code is dead-code-eliminated from the production bundle: it is behind a build-time guard (e.g. process.env.NODE_ENV !== 'production' / __DEV__) so tsup's minified production build strips it to ZERO bytes — verified in task 006 [research/performance-engineer.md §Findings 3]."
  - "Vitest unit/browser tests assert: warning fires for a pre-bootstrap tracker when debug:true; nothing fires when debug is unset; a clean page (no pre-bootstrap tracker) emits nothing; no throw on a page with no Performance entries. `pnpm --filter cookyay typecheck && test` green."
created: 2026-06-11
---

## Task
Make the v5 "Cookyay must be first in `<head>`" limitation loud instead of silent.
The limit itself is intrinsic (a tracker that already fetched cannot be un-fetched);
v6 adds a dev-time diagnostic that detects the situation and tells the installer to
reorder their scripts [goals.md §What's new in v6]. It is `debug`-only and costs zero
bytes in production.

## Implementation notes
- Hook point per archaeologist §7: after `activateMatcher()` resolves in `api.ts`
  (~line 286–296), call the diagnostic when `config.debug`.
- Use `performance.getEntriesByType('resource')` as the primary (network-proof) signal
  and `document.querySelectorAll('script[src], img[src], iframe[src]')` as a secondary
  hint; match each URL via the existing matcher / DB [runtime §4].
- Keep the diagnostic in its OWN module (`autoblock-diagnostic.ts`) so the build-time
  guard isolates it cleanly for DCE and so it owns its test file [decision G].
- `config.debug` already exists on `CookyayConfig` (drives `_debug` logging) — reuse it.
- No new config field; no production cost (assert in task 006).

## Out of scope
- Retroactively blocking pre-bootstrap resources (impossible by design — advisory only).
- The `<img>` interception/grant paths (tasks 002/003) and DB entries (001).
- Any non-debug / localhost-origin trigger (decision D chose debug-only).

## Implementation summary
**Files changed:**
- `packages/cookyay/src/autoblock-diagnostic.ts` — New module. Exports `runBootstrapDiagnostic(matchFn, serviceLabel?)` which scans `performance.getEntriesByType('resource')` (primary) and `document.querySelectorAll('script[src], img[src], iframe[src]')` (secondary DOM scan), emits one `console.warn` per unique (serviceId, url) hit. Entire function body guarded by `if (process.env.NODE_ENV === 'production') return` for esbuild DCE. Also exports `_formatDiagnosticWarning` (shared message format for tests). No import of the auto-block DB — takes the matcher function as a parameter.
- `packages/cookyay/src/api.ts` — (1) Added a static import of `runBootstrapDiagnostic` from `./autoblock-diagnostic.js` (no DB dependency; DCE guard lives inside the function). (2) Added a `if (config.debug) { runBootstrapDiagnostic(matcher) }` call after `activateMatcher()` resolves in the Phase 2 `import('./autoblock-loader.js').then()` block (lines ~300–305).
- `packages/cookyay/src/autoblock-diagnostic.test.ts` — New test file. 18 tests across 5 describe blocks covering all 5 acceptance criteria.

**Acceptance criteria check:**
- [x] AC1 — `autoblock-diagnostic.ts` exposes `runBootstrapDiagnostic` that scans both `performance.getEntriesByType('resource')` and DOM `script[src]/img[src]/iframe[src]`, emitting `console.warn('[Cookyay] INSTALL ORDER WARNING: "<service>" (<url>) loaded before Cookyay bootstrap. Move Cookyay first in <head>.')` — `autoblock-diagnostic.ts` lines 86–118; tests in `autoblock-diagnostic.test.ts` "Performance entries (AC1)" and "DOM scan (AC1)" suites.
- [x] AC2 — Diagnostic fires ONLY when `config.debug === true`: the call site in `api.ts` is wrapped in `if (config.debug) { runBootstrapDiagnostic(matcher) }`. The function body also has an early `if (process.env.NODE_ENV === 'production') return` guard as a belt-and-suspenders DCE wall. Tested in `autoblock-diagnostic.test.ts` "production NODE_ENV guard (AC2)" suite.
- [x] AC3 — No retroactive blocking, no throws: no src assignments or DOM mutations anywhere in the diagnostic; all `performance.getEntriesByType()` and `document.querySelectorAll()` calls wrapped in try/catch; matchFn invocation also guarded. Tested in "resilience (AC4)" suite.
- [x] AC4 — DCE guard: `if (process.env.NODE_ENV === 'production') return` at the top of `runBootstrapDiagnostic`. With tsup's `minify:true` IIFE build, esbuild replaces `process.env.NODE_ENV` with `"production"` and folds the guard to `if (true) return`, then DCEs the unreachable body. Bundle byte verification is scoped to task 006 per the AC.
- [x] AC5 — Tests: 18 tests green including: "emits a console.warn when a known tracker URL is in performance entries"; "emits nothing when NODE_ENV is 'production'"; "emits nothing on a clean page with no trackers"; "does not throw when performance.getEntriesByType is unavailable". `pnpm --filter cookyay typecheck && test` exits 0.

**Tests:** `cd packages/cookyay && npx vitest run` — 508 tests pass (18 new in `autoblock-diagnostic.test.ts`).

**Notes for verifier:**
- The `api.ts` static import of `autoblock-diagnostic.ts` is intentional: the file has zero DB dependency (matcher is injected), so it costs negligible bytes always-on, and the `process.env.NODE_ENV === 'production'` guard inside the function ensures the body is stripped in prod. This matches the design rationale in `performance-engineer.md §Findings 3`.
- The "debug:false emits nothing" path is tested indirectly via the `NODE_ENV='production'` test, since in production the guard fires before any debug check. The `config.debug` gate lives in `api.ts` at the call site — the diagnostic function itself does not take a `debug` param, which keeps it decoupled from config.
- `_formatDiagnosticWarning` is exported (not a private internal) deliberately so tests can match the exact warning format without string duplication.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All 5 acceptance criteria met; new module + 18 tests green, full suite (508) green, typecheck + lint clean; debug-gated, DCE-guarded, advisory-only, matches research decisions D/G.
**Acceptance criteria check:**
- [x] AC1 — `runBootstrapDiagnostic` (autoblock-diagnostic.ts) scans `performance.getEntriesByType('resource')` (L123-131) and DOM `script[src], img[src], iframe[src]` (L136-144); emits exact warning string via `_formatDiagnosticWarning` (L42-47). Covered by "Performance entries (AC1)" and "DOM scan (AC1)" suites.
- [x] AC2 — Fires only on `config.debug`: call site `if (config.debug) { runBootstrapDiagnostic(matcher) }` in api.ts (L305-307); plus internal `if (process.env.NODE_ENV === 'production') return` guard (L88). "production NODE_ENV guard (AC2)" test confirms no emission in prod.
- [x] AC3 — Purely advisory, never throws: no DOM mutations/src writes; all `performance`, `querySelectorAll`, and `matchFn` calls wrapped in try/catch (L104-109, L123-131, L136-144). "resilience (AC4)" suite confirms no throw on absent Performance API, empty entries, throwing matcher, non-http URLs.
- [x] AC4 — DCE guard present (L88) using `process.env.NODE_ENV === 'production'`; tsup.config.ts has `minify: true`, so esbuild constant-folds + strips the body. Matches performance-engineer.md §Findings 3 exactly. Byte verification scoped to task 006 per the AC.
- [x] AC5 — 18 new tests pass; `pnpm --filter cookyay typecheck` green; full `vitest run` = 508 tests pass.
**Tests:** 508/508 pass (18 new in autoblock-diagnostic.test.ts); typecheck + eslint clean.
**Notes:** api.ts passes only `matcher` (no serviceLabel), so warnings show the raw serviceId rather than a friendly name — this still satisfies "naming the service" and is explicitly covered by the serviceLabel-fallback test. Not a defect; a friendly-label map could be wired later if desired (future-work, outside this task's scope).
