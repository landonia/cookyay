---
id: 006
title: Upgrade confidence to "two signals agree = high"
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001"]
complexity: 5
prd_refs:
  - "prd.md §3.6"
  - "goals.md §What ships in v4"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 1)"
test_refs: []
research_refs:
  - "research/domain-expert-trackers.md §Summary"
  - "research/data-modeler.md §Update — 2026-06-10"
acceptance_criteria:
  - "Confidence is computed in classifier.ts (never stored per-service): high = two independent signals agree on the same service on the same page (e.g. a cookie match cross-checked against a fired requestHost); single-signal matches resolve to medium/low."
  - "The semantic no longer keys off 'came from a curated source' — a curated service with only one observed signal is not automatically high."
  - "Existing _meta.confidence consumers (config-emitter) keep working; the e2e golden is regenerated intentionally if confidence values legitimately change, with the change called out in the PR."
  - "Vitest tests cover: two-signal → high, single-signal → medium/low, and the mp_/_ga cross-check cases from task 003 resolving correctly; suite green."
created: 2026-06-10
---

## Task
Make the per-classification confidence annotation [prd.md §3.6] mean something a
site owner can triage on. Today `high` essentially means "curated"; the SME's more
defensible rule is "two independent signals agree." Implement the cross-signal
check in `classifier.ts` so confidence reflects evidence strength, not data
provenance [research/domain-expert-trackers.md §Summary].

## Implementation notes
- Cross-check a cookie match against the same page's fired `requestHosts` (and/or
  script/iframe globs) for the same service id; agreement → `high`. Keep the rule
  centralized so 003's `mp_`/`_ga` fixes and 007's emitted confidence stay
  consistent.
- Confidence stays fully computed — do not add a stored confidence field to
  `ServiceDefinition` [research/data-modeler.md].
- Coordinate with 007: the emitted `suggestedBlocking[].confidence` reads this
  value, so land 006 before/with 007.

## Out of scope
- Adding services (005) or fixing the specific false-positive signatures (003,
  beyond the cross-check the confidence rule provides).

## Implementation summary
**Files changed:**
- `packages/scanner/src/db.ts` — Updated confidence semantics: `findServiceByCookie` and `findServiceByLocalStorage` now return `medium` for all matches (was `high` for curated entries). Updated module docstring and function jsdocs to describe the new model where `high` is exclusively computed in classifier.ts.
- `packages/scanner/src/classifier.ts` — Added cross-signal confidence upgrade logic. After all per-page signals are collected, any service ID observed by both a cookie/storage signal AND a request/host signal on the same page is upgraded to `high`. Updated module docstring. Added per-page tracking maps (`pageCookieServices`, `pageRequestServices`) and an `addPageSignal` helper.
- `packages/scanner/src/classifier.test.ts` — Updated existing tests that expected `high` for single-signal curated cookie lookups (2 tests in `findServiceByCookie`, 1 in `classify() — cookie classification`). Added a new `describe` block with 8 tests covering the AC requirements.
- `packages/scanner/src/db.test.ts` — Updated `CURATED_SIGNAL_TABLE` comment and the 3 `it.each` assertions that checked `high` confidence on single cookie/localStorage/host lookups; they now assert `medium` with a comment explaining why.

**Acceptance criteria check:**
- [x] "Confidence is computed in classifier.ts (never stored per-service): high = two independent signals agree on the same service on the same page" — `classifier.ts` lines 321-355: cross-signal upgrade block; `db.ts` lookup helpers never return `high`.
- [x] "The semantic no longer keys off 'came from a curated source' — a curated service with only one observed signal is not automatically high." — `findServiceByCookie` returns `medium` for all entries; test "does NOT automatically make a curated entry high with a single cookie signal" asserts `hotjar` stays `medium`.
- [x] "Existing _meta.confidence consumers (config-emitter) keep working; the e2e golden is regenerated intentionally if confidence values legitimately change" — `config-emitter.ts` unchanged; e2e golden only has `low` values (declared-category only, no cookies/requests in fixture) — no change needed.
- [x] "Vitest tests cover: two-signal → high, single-signal → medium/low, and the mp_/_ga cross-check cases from task 003 resolving correctly; suite green." — New `describe('classify() — two-signal confidence upgrade (task 006)')` block in `classifier.test.ts` with 8 tests. Suite: 277 passed.

**Tests:** `cd packages/scanner && pnpm vitest run`

**Notes for verifier:**
- The cross-page isolation test ("does NOT upgrade to high when cookie and request are on different pages") verifies that the per-page check is correctly scoped — GA4 cookie on page A + GA4 request on page B does not produce `high`.
- `config-emitter.ts` is unchanged — it reads `confidence` from the classified entries which can now be `high`, `medium`, or `low`; all consumers use it as an annotation so the higher fidelity of the new model is transparent.
- The e2e `expected-config.json` golden shows only `low` confidence (fixture site uses declared-category markup with no real cookies/requests), so it was not regenerated.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Confidence is now computed in classifier.ts ("two signals agree = high"); db.ts lookup helpers only return medium; tests cover all AC cases; suite green (277/277).
**Acceptance criteria check:**
- [x] Confidence computed in classifier.ts (never stored); high = two independent signals agree on same service+page — `classifier.ts:330-364` cross-signal upgrade block keyed per-page (`pageCookieServices`/`pageRequestServices`); `db.ts` `findServiceByCookie`/`findServiceByHost`/`findServiceByRequest`/`findServiceByLocalStorage` all return `'medium'` only (db.ts:143,171,228,243,264); `ServiceDefinition` carries no confidence field.
- [x] Semantic no longer keys off "curated source" — `db.ts` lookups dropped the curated→high rule; test "does NOT automatically make a curated entry high with a single cookie signal" (classifier.test.ts:1069) asserts hotjar stays medium; db.test.ts:694-720 assert medium for single-signal curated lookups.
- [x] Existing _meta.confidence consumers keep working; e2e golden regenerated intentionally if values change — `config-emitter.ts` reads `confidence` unchanged; e2e `expected-config.json` contains only `low` values (declared-category fixture, no real cookies/requests) so no regeneration needed; e2e spec accepts high/medium/low. (Minor: config-emitter.ts:201-202 comment is now slightly stale — says request-host "never returns high"/"no upgrade possible"; behavior is correct since it reads req.confidence which the classifier may have upgraded. Non-blocking doc nit, out of task file scope.)
- [x] Vitest covers two-signal→high, single-signal→medium/low, mp_/_ga task-003 cross-check; suite green — new `describe('classify() — two-signal confidence upgrade (task 006)')` (classifier.test.ts:906) with 8 tests incl. GA4 cookie+request→high, _fbp+connect.facebook.net→high, single-signal→medium, mp_ without request→medium, _ga→ga4 (not ua) upgrade, and cross-page isolation→medium. `pnpm vitest run`: 277 passed.
**Tests:** 277/277 passed (`pnpm vitest run`); `tsc --noEmit` clean.
