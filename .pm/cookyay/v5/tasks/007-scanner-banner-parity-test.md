---
id: 007
title: Scanner↔banner parity test — matcher agrees with scanner verdict
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001", "002"]
complexity: 3
prd_refs:
  - "goals.md §Acceptance bar"
  - "goals.md §What ships in v5"
arch_refs: []
test_refs: []
research_refs:
  - "research/test-strategist.md §Findings"
  - "research/_index.md §Convergent conclusions"
acceptance_criteria:
  - "A unit test asserts that for every curated service in services.yaml, the scanner's host/path resolution (findServiceByHost / findServiceByRequest in db.ts) and the v5 client matcher (task 002) return the SAME serviceId and category for a representative URL of that service — no divergence between scan-time and run-time verdicts."
  - "The test is data-driven over the curated DB (not a hand-picked subset) so adding a service to services.yaml automatically extends parity coverage; Google-owned services are asserted to be matched by the scanner but skipped by the client matcher (the one intended, documented divergence)."
  - "The test fails loudly if the two code paths drift (e.g. a field rename or matching-rule change on one side), and runs in CI green as part of `pnpm test`."
created: 2026-06-10
---

## Task
v5's value depends on the banner classifying a service the same way the scanner
does — otherwise a site owner's scan report and their live blocking disagree
[goals.md §Acceptance bar]. Both consume `services.yaml`, but through different
code (scanner's `db.ts` matchers vs. the new client matcher), so drift is possible.
A cheap data-driven parity test over the full curated set locks them together and
is the lowest-cost form of the acceptance-bar parity requirement
[research/test-strategist.md §Findings, research/_index.md §Convergent conclusions].

## Implementation notes
- Iterate the curated services; for each, synthesize a representative URL from its
  requestHosts/requestPaths and assert scanner-verdict === client-verdict on
  (serviceId, category).
- Encode the ONE intended divergence explicitly: Google-owned services are scanner-
  matched but client-skipped (skip-Google decision) — assert that, don't let it
  silently pass as a mismatch.
- Keep it in whichever package can import both sides cleanly (likely a cross-package
  test, or duplicate the representative-URL fixtures); state the choice.

## Out of scope
- The matcher implementation (task 002) and DB codegen (task 001).
- Runtime blocking behavior (tasks 004–006).

## Implementation summary
**Files changed:**
- `packages/scanner/src/parity.test.ts` — new file; data-driven parity test iterating all 50 curated services, asserting scanner (`findServiceByRequest`) and client (`matchAutoBlock`) agree on serviceId + category for a synthesised representative URL; Google-owned services have a separate assertion block confirming scanner matches but client returns null (the one intended divergence).

**Acceptance criteria check:**
- [x] AC1 — unit test asserts scanner + client agree on serviceId + category for every curated service — `parity.test.ts` lines 91–120 (non-Google block) and 134–157 (Google block) use `it.each(CURATED_SERVICES filtered by google flag)` and call both `findServiceByRequest` and `matchAutoBlock` on the same synthesised URL, asserting identity.
- [x] AC2 — data-driven over full curated DB; Google divergence encoded explicitly — `it.each(nonGoogleServices)` and `it.each(googleServices)` together cover all 50 entries from `CURATED_SERVICES`; the "totals guard" test (`parity.test.ts` line 167) asserts `nonGoogleServices.length + googleServices.length === CURATED_SERVICES.length`, so any new service.yaml entry is automatically included.
- [x] AC3 — test fails loudly on drift; green in `pnpm test` — assertions use `.toBe()` / `.not.toBeNull()` with descriptive failure messages; running `pnpm test` at workspace root collected 815 tests (51 from parity.test.ts) all passing.

**Tests:** `pnpm test` (workspace root) or `pnpm --filter @cookyay/scanner test`

**Package placement decision:** test lives in `packages/scanner/src/parity.test.ts`. Scanner owns the canonical `CURATED_SERVICES` list and the `findServiceByRequest`/`findServiceByHost` functions. The client matcher is imported via relative path `../../cookyay/src/autoblock-matcher.ts` — valid in Vitest node mode (test-only, no build-time cross-package dep added to package.json). The choice is documented in the test file's header comment.

**Notes for verifier:** The `ua` and `gtm` services share hosts with `ga4` (Google-owned). The scanner's first-match semantics return `ga4` for `google-analytics.com` even when iterating `ua`, and `ga4` for `googletagmanager.com` even when iterating `gtm`. The parity assertion for these services still holds because both scanner and client agree: scanner returns `ga4` (non-null, Google-owned), client returns null. The Google-service test block asserts scanner non-null and client null — both conditions are satisfied regardless of whether the scanner returns `ua`/`gtm` or `ga4`. To verify this manually: run `pnpm --filter @cookyay/scanner test` and observe all 51 tests pass.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Data-driven parity test locks scanner (`findServiceByRequest`) and client (`matchAutoBlock`) verdicts together over the full 50-service curated DB, encodes the single Google divergence explicitly, and runs green in `pnpm test`.
**Acceptance criteria check:**
- [x] AC1 — scanner+client agree on serviceId+category for every curated service — `parity.test.ts:79-125` non-Google block asserts `clientResult.serviceId/.category .toBe(scannerResult.service.id/.category)`. Confirmed all 44 non-Google services carry a URL signal (requestHosts/requestPaths), so each exercises the strong-identity branch (none hit the no-signal skip). All 51 parity tests pass.
- [x] AC2 — data-driven over full DB; Google divergence explicit — both groups built via `it.each(CURATED_SERVICES.filter(...))`; totals guard (`parity.test.ts:186-189`) asserts non-Google(44)+Google(6)===total(50) so new services.yaml entries auto-extend coverage. Google block (`parity.test.ts:142-177`) asserts scanner non-null AND client `.toBeNull()` (the one intended divergence per goals.md §Consent Mode v2: skip Google tags), and throws loudly if a Google service lacks a URL signal.
- [x] AC3 — fails loudly on drift; green in CI `pnpm test` — assertions use `.toBe()`/`.not.toBeNull()`/`.toBeNull()` with descriptive failure messages; workspace-root `pnpm test` = 815 passing (51 from parity.test.ts), `pnpm --filter @cookyay/scanner test` = 350 passing.
**Cross-checks:** In scope (test-only; matcher/codegen/runtime untouched). Matches research/test-strategist.md §F5 recommendation 2 exactly. No testing.md in v5 → test-strategy gate skipped. Package-placement decision (scanner package, relative import of client matcher) documented in file header. No dead code or debug artifacts.
**Tests:** 51/51 parity tests pass (350/350 scanner suite; 815/815 workspace root).
