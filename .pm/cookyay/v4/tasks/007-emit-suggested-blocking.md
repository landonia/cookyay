---
id: 007
title: Emit suggestedBlocking[] (host-deduped + paste-ready snippet)
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001", "006"]
complexity: 5
prd_refs:
  - "goals.md §What ships in v4"
  - "prd.md §3.2"
  - "prd.md §3.6"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 2)"
  - "architecture.md §5 API style"
test_refs: []
research_refs:
  - "research/existing-codebase-archaeologist.md §Summary"
  - "research/data-modeler.md §Update — 2026-06-10"
acceptance_criteria:
  - "config-emitter.ts produces a suggestedBlocking[] array in the emitted config; each entry is keyed by host and deduped — services colliding on one host (GA4 + Google Ads → googletagmanager.com) share a single entry listing all justifying service ids."
  - "Each entry carries: host, services[], category, confidence, and a rendered snippet string that is a verbatim-pasteable <script type=\"text/plain\" data-category=\"…\" data-src=\"…\"> (iframe variant for iframe-sourced services), derived from the service's scriptUrlGlobs/iframeSrcGlobs."
  - "The snippet's data-category matches the service category and uses the banner's expected markup contract (verified against packages/cookyay blocking expectations)."
  - "Vitest/golden tests assert the suggestedBlocking output for a known set of detected services, including the host-dedup case; existing emitter tests still pass."
created: 2026-06-10
---

## Task
Close the gap between "detected" and "ready-to-block." The emitter currently
outputs annotated service entries but no copy-paste markup; the banner blocks only
markup-driven `type="text/plain"` scripts, so site owners still hand-author block
rules [research/existing-codebase-archaeologist.md §Summary]. Add a
`suggestedBlocking[]` array whose entries the owner pastes directly into their HTML
[goals.md §What ships, architecture.md §Amendments change 2].

## Implementation notes
- **Dedupe by host:** group detected services by host first, then render one
  snippet per host listing all contributing service ids in `services[]`.
- The emitter owns the markup format (single source of truth) — render the snippet
  from `scriptUrlGlobs`/`iframeSrcGlobs` (populated in 001/005) and the resolved
  category. Match the exact attributes the banner's blocking engine expects.
- `confidence` on each entry comes from the 006 computed value — depend on 006.
- Keep the existing per-service annotated output intact alongside the new array
  unless it's fully subsumed; don't break current consumers.

## Out of scope
- Banner-side runtime auto-block (deferred to v5). Fixture/golden e2e coverage of
  the full crawl→emit path (009). Docs (010).

## Implementation summary
**Files changed:**
- `packages/scanner/src/config-emitter.ts` — Added `SuggestedBlockingEntry` interface, `suggestedBlocking: SuggestedBlockingEntry[]` field to `EmittedConfig`, and four new exported/internal helpers: `deriveBlockingHost`, `allBlockingHosts`, `renderSnippet`, `buildSuggestedBlocking`. The `emitConfig` function now calls `buildSuggestedBlocking(findings)` and includes the result in the returned config. Import updated to also import `ServiceDefinition` type from `./db.js`.
- `packages/scanner/src/classifier.test.ts` — Added `deriveBlockingHost` and `renderSnippet` to the import line; added `ServiceDefinition` type import. Added 17 new tests in 4 new describe blocks: `deriveBlockingHost()`, `renderSnippet()`, `emitConfig() — suggestedBlocking[] (task 007)`, covering all acceptance criteria.
- `packages/scanner/e2e/expected-config.json` — Updated E2E golden file to include `"suggestedBlocking": []` (the fixture uses local relative-path stubs that don't match any service's `requestHosts`, so the array is empty for the fixture scan).

**Acceptance criteria check:**
- [x] config-emitter.ts produces a suggestedBlocking[] array in the emitted config; each entry is keyed by host and deduped — satisfied by `buildSuggestedBlocking` + `allBlockingHosts` which enumerate ALL `requestHosts` per service so services sharing any host collapse into one entry. Test: "deduplicates services sharing the same host into a single entry (GA4 + UA → google-analytics.com)" at classifier.test.ts:1278.
- [x] Each entry carries: host, services[], category, confidence, and a rendered snippet string — satisfied by `SuggestedBlockingEntry` interface (config-emitter.ts:48-80) and `buildSuggestedBlocking`/`renderSnippet` helpers. Tests: "each entry has host, services, category, confidence, and snippet" at classifier.test.ts:1341.
- [x] The snippet's data-category matches the service category and uses the banner's expected markup contract — script snippets use `type="text/plain" data-category="<cat>" src="<url>"` matching `blocking.ts:139`; iframe snippets use `data-src="<url>" data-category="<cat>"` matching `blocking.ts:146`. Test: "script snippets use type='text/plain' and data-category" at classifier.test.ts:1365.
- [x] Vitest/golden tests assert the suggestedBlocking output for a known set of detected services, including the host-dedup case; existing emitter tests still pass — 17 new tests added; all 294 tests pass (277 existing + 17 new).

**Tests:** `pnpm --filter @cookyay/scanner exec vitest run`

**Notes for verifier:**
- The AC says the script snippet format is `data-src="…"` but the banner's actual blocking engine (`packages/cookyay/src/blocking.ts:139`) uses `src` for scripts (not `data-src` — that's only for iframes). I used `src` per the banner's actual contract. The AC likely has a typo; the verifier should confirm against `blocking.ts`.
- `suggestedBlocking` is empty when all detected services are cookie-only OCD entries (no `requestHosts`). This is by design — cookie-only services have no blockable host to emit a snippet for.
- The `allBlockingHosts` function enumerates all `requestHosts` per service (not just the first), enabling correct dedup for services like GA4 that have 3 hosts including `googletagmanager.com`. A site with GA4 + UA detected will see ONE entry for `google-analytics.com` listing both.
- E2E golden file updated to include `"suggestedBlocking": []` — this is stable because the fixture uses local relative-path stubs.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** suggestedBlocking[] is host-deduped, carries host/services/category/confidence/snippet, the snippet matches the banner's real blocking contract (blocking.ts), and all 294 vitest + 55 Playwright e2e (incl. byte-stable golden) pass.
**Acceptance criteria check:**
- [x] config-emitter.ts produces a host-keyed, deduped `suggestedBlocking[]` — `buildSuggestedBlocking`/`allBlockingHosts` enumerate every `requestHosts` entry per service so services sharing a host collapse into one entry (config-emitter.ts:265-391). Verified by classifier.test.ts:1416 (GA4 + UA → single `google-analytics.com` entry listing both ids) and :1449 (no duplicate host entries).
- [x] Each entry carries host, services[], category, confidence, and a rendered snippet (script/iframe variant) derived from scriptUrlGlobs/iframeSrcGlobs — `SuggestedBlockingEntry` (config-emitter.ts:54-70) + `renderSnippet` (config-emitter.ts:229-251). Verified by classifier.test.ts:1361, :1309 (iframe data-src), :1324 (script glob URL).
- [x] Snippet data-category matches the service category and uses the banner's markup contract — checked against blocking.ts:139 (`script[type="text/plain"][data-category]`, `src` preserved on the clone) and blocking.ts:146 (`iframe[data-src][data-category]`). The AC text says scripts use `data-src`; that is a typo — the banner injects scripts by cloning all attributes EXCEPT `type` (blocking.ts:200-203), so scripts must keep `src`, not `data-src`. The executor surfaced this and used `src` for scripts / `data-src` for iframes, which is the correct, banner-faithful contract. Verified by classifier.test.ts:1389, :1555.
- [x] Vitest/golden tests assert the suggestedBlocking output including the host-dedup case; existing emitter tests still pass — 294 vitest pass (incl. 17 new task-007 tests) and 55 Playwright e2e pass, including `classify() golden file ... byte-stable config` with the new `suggestedBlocking: []` field. typecheck + eslint clean.
**Tests:** 294/294 vitest pass; 55/55 Playwright e2e pass; typecheck + lint clean.
**Note (non-blocking, for future cleanup):** classifier.test.ts:1480 ("uses the most permissive category when services with different categories share a host") has a misleading name — its body does not exercise the `higherCategory` merge path, only asserting every entry has a valid category. The merge logic itself is correct (config-emitter.ts:164-166, 365). Not a correctness issue; consider tightening that test in a later pass.
