---
id: 002
title: Client auto-block matcher — matchAutoBlock(url) → {serviceId, category}
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
  - "goals.md §What ships in v5"
  - "prd.md §3.2"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (amend)"
test_refs: []
research_refs:
  - "research/performance-engineer.md §Findings"
  - "research/runtime-interception-domain-expert.md §Findings"
  - "research/_index.md §Update — Author decisions"
acceptance_criteria:
  - "A pure function (e.g. matchAutoBlock(url: string) in packages/cookyay/src) returns { serviceId, category } for a URL whose host/path matches a curated service in db-autoblock.generated.ts, or null otherwise — zero runtime dependencies, no DOM access, callable in node/jsdom."
  - "Threshold is single-signal 'medium': a curated-service requestHost OR requestPath match is sufficient to return a hit (v4's two-signal 'high' is unreachable at load time since no cookies exist yet) [research/_index.md §Update]."
  - "Google-owned services are NEVER returned as a match (skip-Google decision) — the existing Consent Mode v2 path degrades them instead; a unit test asserts a GTM/GA4 URL returns null."
  - "Shared-CDN hosts are not blocked on host alone: a service whose host is a shared CDN matches only when its scriptUrlGlob also matches the URL — covered by a unit test with a true-positive and a CDN false-positive case."
  - "A Vitest unit test (jsdom/node, no browser) drives the matcher data-style over representative service URLs (mirroring db.test.ts's table-driven pattern): host match, path match, no-match, Google-skip, CDN-disambiguation."
created: 2026-06-10
---

## Task
The runtime interception proxy (task 004) needs to answer one question fast: does
this script/iframe URL belong to a known, blockable third party, and in which
category? Build that decision as a pure, browser-portable function over the
generated client DB [goals.md §What ships in v5]. Keeping it pure and DOM-free
makes it unit-testable without a browser and reusable by the parity test (007).
The matching rules encode the author's research decisions: single-signal medium
threshold, skip Google, shared-CDN disambiguation via scriptUrlGlob
[research/_index.md §Update].

## Implementation notes
- Port the host/path matching semantics from the scanner's `findServiceByHost` /
  `findServiceByRequest` (`db.ts`) so verdicts stay identical — task 007 asserts it.
- Use a Map/Set of hosts for O(1) lookup; the ~50-service set is tiny, no trie or
  regex engine needed [research/performance-engineer.md].
- Normalize the URL (strip scheme, lowercase host) before matching; handle relative
  vs absolute defensively.

## Out of scope
- Installing the interception proxy or touching the DOM (task 004).
- Config gating / tree-shaking (task 003).
- Queue/grant integration (task 005).

## Implementation summary

**Files changed:**
- `packages/cookyay/src/autoblock-matcher.ts` — New pure function `matchAutoBlock(url)` with supporting helpers `_buildIndex()`, `_matchGlob()`, `_extractHost()`, `_hostMatches()`, and `_createMatcher()` (test helper). Zero runtime dependencies, no DOM access, browser-portable TS.
- `packages/cookyay/src/autoblock-matcher.test.ts` — 63 Vitest unit tests covering all 5 acceptance criteria: host match, subdomain match, path match, no-match, relative URLs, Google-skip, CDN disambiguation (true-positive + false-positive), table-driven representative URLs, glob helper, and index construction.

**Acceptance criteria check:**
- [x] AC1 (pure function, `packages/cookyay/src`, returns `{ serviceId, category }` | null, zero deps, no DOM, node/jsdom-callable) — `autoblock-matcher.ts:1–281`; imports only `db-autoblock.types.js` and `db-autoblock.generated.js`; tests run in jsdom environment.
- [x] AC2 (single-signal medium threshold: requestHost OR requestPath hit is sufficient) — host lookup at `autoblock-matcher.ts:166–193`; path lookup at `autoblock-matcher.ts:196–212`; covered by `matchAutoBlock — host match (live DB)` and `matchAutoBlock — path match (requestPaths)` test suites.
- [x] AC3 (Google-owned services NEVER returned; unit test asserts GTM/GA4 URL returns null) — Google entries excluded at index build time (`autoblock-matcher.ts:59–60`); 6-test `matchAutoBlock — Google-owned services skipped [AC3]` suite covers GTM, GA4, UA, reCAPTCHA, Google Optimize, Google Ads.
- [x] AC4 (shared-CDN host requires scriptUrlGlob match; unit test with true-positive and CDN false-positive) — `requiresGlobMatch` flag at `autoblock-matcher.ts:62–64`; CDN guard at `autoblock-matcher.ts:175–181`; `matchAutoBlock — CDN disambiguation via scriptUrlGlobs [AC4]` suite uses synthetic `_createMatcher()` DB with a CDN service carrying `scriptUrlGlobs`.
- [x] AC5 (Vitest unit test, jsdom/node, table-driven pattern: host match, path match, no-match, Google-skip, CDN-disambiguation) — `autoblock-matcher.test.ts` covers all five patterns in dedicated describe blocks + 22-row `matchAutoBlock — table-driven URL matches [AC5]` suite mirroring db.test.ts's `CURATED_SIGNAL_TABLE`.

**Tests:** `pnpm --filter cookyay exec vitest run` — 356/356 pass (63 new, 293 pre-existing).

**Notes for verifier:**
- The `_createMatcher()` helper is needed because no production service currently has `scriptUrlGlobs` set (task 001 confirmed no service sits on a shared CDN host at this time). The CDN-disambiguation logic is correct and tested against synthetic data.
- `sentry-cdn.com` (Sentry's JS SDK CDN) is intentionally not in `services.yaml` requestHosts — only `sentry.io` (the data ingestion endpoint) is. The table-driven test documents this gap with a null-expectation and a comment.
- The host lookup uses a "progressive label stripping" strategy: it tries the exact hostname, then `foo.example.com → example.com` etc. (max ~5 Map.get() calls for a typical 3-4 label hostname). This avoids O(n) iteration over all 99 requestHosts while still supporting subdomain matching.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Pure, DOM-free `matchAutoBlock(url)` over the generated client DB; single-signal medium threshold, Google-skip, and shared-CDN glob disambiguation all implemented and tested; logic mirrors the scanner's `findServiceByRequest` for parity; 356/356 tests green, typecheck clean.
**Acceptance criteria check:**
- [x] AC1 (pure fn in `packages/cookyay/src`, returns `{serviceId,category}`|null, zero deps, no DOM, node/jsdom) — `autoblock-matcher.ts:231`; imports only `db-autoblock.types` + `db-autoblock.generated` (grep confirms no `document`/`window`/`require`); uses only `new URL`/`Map`/string ops; runs under vitest `environment: 'jsdom'` (vitest.config.ts).
- [x] AC2 (single-signal medium: host OR path sufficient) — host lookup `:254-270`, path lookup `:282-289`; the `facebook.com/tr` path-only test (host not in requestHosts) proves a path-alone hit returns meta-pixel.
- [x] AC3 (Google services NEVER returned; GTM/GA4 → null) — excluded at index build `_buildIndex:91`; 6-row Google-skip suite (GTM, GA4, UA, reCAPTCHA, Optimize, Ads) all assert null and pass.
- [x] AC4 (shared-CDN needs scriptUrlGlob; true-positive + CDN false-positive) — `requiresGlobMatch` flag `:93-94`, CDN guard `:261-266`; `_createMatcher` synthetic CDN suite has 1 true-positive + 3 false-positive (lodash/react) cases, all green.
- [x] AC5 (Vitest jsdom/node, table-driven: host/path/no-match/Google-skip/CDN) — all five patterns in dedicated describe blocks plus a 22-row `MATCH_TABLE` mirroring db.test.ts; runs in jsdom, zero browser deps.
**Tests:** 356/356 pass (`pnpm --filter cookyay exec vitest run`; 63 new in `autoblock-matcher.test.ts`); `pnpm --filter cookyay typecheck` exits 0.
**Notes:** Parity with scanner `db.ts findServiceByRequest` verified independently — same exact-or-subdomain host rule and `"host/path"` startsWith path rule; task 007 will lock this in. The `sentry-cdn.com → null` table row and the documented host-vs-path ordering difference (matcher scans all hosts then paths; scanner is per-service) are benign given unique-per-service requestHosts (confirmed in task 001).
