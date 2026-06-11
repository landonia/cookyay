---
id: 009
title: Detection-path fixtures + 2nd golden file + e2e spec
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["005", "007", "008"]
complexity: 5
prd_refs:
  - "goals.md §Acceptance bar"
  - "prd.md §3.6"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 3)"
  - "architecture.md §9 Environments & deployment"
test_refs: []
research_refs:
  - "research/test-strategist.md §Findings 3"
  - "research/test-strategist.md §Findings 4"
acceptance_criteria:
  - "fixtures/detection/ contains hermetic stand-in pages that emit the signals of representative services (a script tag at a googletagmanager-style path, a fake GA beacon, cookies/localStorage with known service names, an iframe for a video service) — no real third-party network calls."
  - "A second golden file e2e/expected-detection-config.json captures the emitted config (incl. suggestedBlocking[]) for a fixtures/detection/mixed-signals page, using the existing normalizeConfig() helper."
  - "A Playwright spec crawls the detection fixtures and asserts the emitted config matches the golden, exercising host-detection + suggestedBlocking + dedup offline."
  - "CI added runtime for the new crawl stays under ~1 min (retries: 0, workers: 2 retained); `pnpm --filter @cookyay/scanner e2e` green locally."
created: 2026-06-10
---

## Task
Prove the full crawl → detect → emit path against a hermetic fixture, since the
acceptance bar keeps the real-site run as a manual step [goals.md §Acceptance bar].
Today only the declared-category *blocking* path is exercised end-to-end; v4's
auto-detection needs its own fixtures and a golden config so detection regressions
surface in CI [research/test-strategist.md §Findings 3–4].

## Implementation notes
- Add `fixtures/detection/` pages that set cookies/localStorage and load scripts at
  service-matching paths via the local fixture server (`fixtures/serve.mjs`).
  Request-host-only signals are better covered by unit tests than Playwright (making
  a real third-party host appear in `req.host` from localhost needs proxy trickery)
  — focus the fixtures on cookie/localStorage/script-path/iframe signals.
- Reuse `normalizeConfig()` from the existing `scanner-classify.spec.ts` for the
  golden comparison; the golden is regenerated **deliberately** whenever the DB or
  emitter changes.
- A `mixed-signals.html` page that triggers a host-dedup case (GA4 + Google Ads)
  is the key fixture for asserting 007's dedup behavior.

## Out of scope
- The real-site dogfood run (manual acceptance, tracked at release).
- New service signatures (005) — this consumes them.

## Re-execution notes — 2026-06-10

**Verifier items addressed:**

1. **Added script-tag detection fixture (AC1, verifier item 1).** `fixtures/detection/script-iframe-signals.html` (new) contains `<script type="text/plain" src="https://www.googletagmanager.com/gtag/js?id=G-FIXTURE">`. `fixtures/detection/mixed-signals.html` (updated) also carries the same script tag. The classifier reads `src` via `getAttribute`, extracts `www.googletagmanager.com`, and matches GA4 via `findServiceByHost()` (`classifier.ts:254`). No network request fires (`type="text/plain"`). Pattern mirrors `fixtures/blocking/all.html` exactly as verifier instructed.

2. **Added video-iframe detection fixture (AC1, verifier item 2).** Both `script-iframe-signals.html` and the updated `mixed-signals.html` contain `<iframe data-src="https://www.youtube.com/embed/fixture123">`. No `src` attribute → no network request. Classified via `classifier.ts:285-289` (`tryExtractHost(dataSrc)` → `findServiceByHost("www.youtube.com")` → `youtube` service).

3. **Made mixed-signals.html trigger actual host-dedup (AC3, verifier item 3).** Added `__utma` cookie (UA service). Both GA4 (`_ga` cookie) and UA (`__utma` cookie) have `google-analytics.com` in their `requestHosts`. The golden now shows a single `google-analytics.com` suggestedBlocking entry with `services: ["ga4","ua"]`. This is the exact GA4+UA pair the verifier referenced (`classifier.test.ts:1416`).

4. **Exercised host-detection and dedup in the Playwright spec (AC3, verifier item 4).** Three new tests added:
   - `script-iframe-signals.html detects GA4 via script-src host and YouTube via iframe-src host` — asserts `matchedBy: "script-host"` for GA4 and `matchedBy: "iframe-host"` for YouTube.
   - `script-iframe-signals.html suggestedBlocking includes GTM and YouTube hosts` — asserts blocking hosts include both.
   - `mixed-signals.html host-dedup — GA4 and UA share google-analytics.com` — asserts exactly one entry with both service IDs.

5. **Script name nit (verifier item 5).** The `test:e2e` script name is correct; `pnpm --filter @cookyay/scanner test:e2e` is the verified command. No `e2e` alias added (non-blocking per verifier).

## Implementation summary
**Files changed:**
- `fixtures/detection/cookie-signals.html` — unchanged (passing)
- `fixtures/detection/localstorage-signals.html` — unchanged (passing)
- `fixtures/detection/no-signals.html` — unchanged (passing)
- `fixtures/detection/mixed-signals.html` — updated: added `__utma` cookie (UA service, for GA4+UA host-dedup on `google-analytics.com`); added `<script type="text/plain" src="https://www.googletagmanager.com/gtag/js?id=G-FIXTURE">` (script-src host signal for GA4); added `<iframe data-src="https://www.youtube.com/embed/fixture123">` (iframe-src host signal for YouTube)
- `fixtures/detection/script-iframe-signals.html` — new hermetic fixture; exercises script-src host classification (GA4 via GTM host) and iframe-src host classification (YouTube); all elements use `type="text/plain"` / `data-src` so no network requests fire
- `packages/scanner/e2e/expected-detection-config.json` — regenerated golden; now includes UA (analytics), YouTube (marketing/iframe-host), and the host-dedup case (`google-analytics.com → services: ["ga4","ua"]`); total 14 `suggestedBlocking` entries
- `packages/scanner/e2e/detection-golden.spec.ts` — 3 new tests added: script/iframe host-detection assertions (`matchedBy: "script-host"` / `"iframe-host"`), suggestedBlocking host coverage, host-dedup assertion for `google-analytics.com`; total now 11 detection tests (66 total across all e2e specs)

**Acceptance criteria check:**
- [x] AC1: `fixtures/detection/` contains hermetic stand-in pages with script-tag-at-GTM-path, iframe-for-video-service, cookies, and localStorage — `script-iframe-signals.html` (new) + updated `mixed-signals.html` deliver all required signal types; no real network calls; `fixtures/detection/`
- [x] AC2: Second golden `e2e/expected-detection-config.json` captures emitted config (incl. `suggestedBlocking[]`) for `mixed-signals.html` via `normalizeConfig()` — regenerated; includes UA, YouTube, GA4+UA dedup entry; `packages/scanner/e2e/expected-detection-config.json`
- [x] AC3: Playwright spec crawls detection fixtures, asserts golden, exercises host-detection + suggestedBlocking + dedup — new tests at `detection-golden.spec.ts:239,267,289` assert `matchedBy: "script-host"`, `matchedBy: "iframe-host"`, and single `google-analytics.com` entry with `services: ["ga4","ua"]`; all 66 tests green
- [x] AC4: CI runtime <1 min; `pnpm --filter @cookyay/scanner test:e2e` green locally — 66 tests pass in 8.3s; `retries: 0`, `workers: 2` unchanged in `playwright.config.ts`

**Tests:** `pnpm --filter @cookyay/scanner test:e2e` (66/66 pass, 8.3s)

**Notes for verifier:**
- The GA4 script-src (`www.googletagmanager.com`) does NOT produce a separate categories entry because GA4 is already present from the `_ga` cookie signal; the emitter merges them (service already in the analytics bucket). The `matchedBy` on the categories entry stays `"cookie"` (cookie wins as first match). The script-host detection is confirmed via the dedicated `script-iframe-signals.html` fixture where GA4 has NO cookies — only the script-src — so `matchedBy` there is `"script-host"` and the assertion at line 248 passes.
- The host-dedup golden entry for `google-analytics.com` now lists `services: ["ga4","ua"]` (sorted). This is the exact pair the verifier referenced from `classifier.test.ts:1416`; the Playwright assertion at line 293-296 confirms it end-to-end.
- `generate-detection-golden.mjs` requires compiling via tsup before use (documented in the script header); maintainer-only tool, not used in CI.

## Verifier notes — 2026-06-10 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Cookie/localStorage fixtures + golden + spec are solid, but AC1's
required script-tag and video-iframe signal fixtures are missing on an invalid
justification, and the spec/fixture exercises neither host-detection nor dedup
(AC3) — the "key fixture" host-dedup case the task itself calls for does not
actually occur.

**What needs to change:**
1. **Add the script-tag detection fixture (AC1 "a script tag at a
   googletagmanager-style path").** This is achievable hermetically — the
   executor's "proxy trickery" justification is wrong here. The classifier
   matches scripts by host extracted from the DOM `src` *attribute*
   (`classifier.ts:249-255` → `tryExtractHost(src)` → `findServiceByHost`), and
   the crawler reads `src` via `getAttribute` (`crawler.ts:83-89`) regardless of
   whether the resource loads. A blocked `<script type="text/plain"
   src="https://www.googletagmanager.com/gtag/js?id=...">` fires no network
   request yet classifies by host. The existing `fixtures/blocking/all.html`
   already uses this exact pattern (`src="/fixtures/stubs/ga4.js"`,
   `data-src="/fixtures/stubs/ytplayer.html"`). The "proxy trickery" caveat in
   research/test-strategist.md §F3 applies ONLY to the live **request-host**
   signal (`req.host` from a real outbound request), not to script-src/iframe-src
   classification. Skipping request-host is fine; skipping script/iframe is not.
2. **Add the video-iframe detection fixture (AC1 "an iframe for a video
   service").** Same mechanism: iframes are classified by host extracted from
   `src`/`data-src` (`classifier.ts:284-289`). A
   `<iframe data-src="https://www.youtube.com/embed/...">` (blocked placeholder,
   no network) classifies as the video service hermetically. Add youtube (or
   another video service in the DB) coverage.
3. **Make `mixed-signals.html` actually trigger the host-dedup case, OR exercise
   dedup in the Playwright spec.** The task's own Implementation notes call this
   "the key fixture for asserting 007's dedup behavior," yet the delivered
   fixture produces zero host collisions — every `suggestedBlocking` entry in the
   golden has exactly one service. Use two services that share a host (e.g. GA4 +
   UA both → `google-analytics.com`, the pair already unit-tested at
   `classifier.test.ts:1416`) via signals detectable in a hermetic page (cookie
   and/or a script-src at a shared host per item 1), so the golden shows one
   deduped entry with `services: ["ga4","ua", ...]`. Then assert that dedup in
   the spec. If a true hermetic dedup case is genuinely impossible, that must be
   surfaced with evidence, not silently dropped.
4. **Exercise host-detection in the spec (AC3).** Once items 1-2 land, add an
   assertion that a service detected purely via script/iframe host (not
   cookie/localStorage) appears in the emitted config with `matchedBy` reflecting
   the host/script/iframe path. Today the spec only ever exercises
   cookie/localStorage detection.
5. Minor: AC4 references `pnpm --filter @cookyay/scanner e2e`; the actual script
   is `test:e2e` (`package.json:39`). No `e2e` script exists. Either add an
   `e2e` alias or treat as wording-only — non-blocking, noted for accuracy.

**Acceptance criteria check:**
- [ ] AC1 (hermetic fixtures: script-path, GA beacon, cookies/localStorage,
  iframe video) — PARTIAL. cookie-signals/localstorage-signals/no-signals/
  mixed-signals deliver cookie + localStorage signals hermetically (good), but
  the required script-tag-at-a-gtm-path and video-iframe signals are absent. The
  justification (proxy trickery) is valid only for request-host, not for
  DOM-src classification; both omitted signals were achievable.
- [x] AC2 (second golden `e2e/expected-detection-config.json` incl.
  `suggestedBlocking[]`, via `normalizeConfig()`) — PASS.
  `expected-detection-config.json` present, 11 suggestedBlocking entries,
  `normalizeConfig()` mirrored from scanner-classify.spec.ts.
- [ ] AC3 (spec crawls fixtures, asserts golden, exercising host-detection +
  suggestedBlocking + dedup offline) — PARTIAL. suggestedBlocking is exercised;
  host-detection is not (no script/iframe host signals in any fixture); dedup is
  not (mixed-signals produces no host collision — every golden entry has one
  service). Both pushed to unit tests, but AC3 requires the Playwright spec to
  exercise them.
- [x] AC4 (CI runtime < ~1 min added; retries:0/workers:2 retained; e2e green) —
  PASS. 63 e2e tests green in 8.3s; `retries: 0` and `workers: 2` unchanged in
  playwright.config.ts (script name nit in item 5).

**Tests:** e2e 63/63 pass (8.3s); unit 299/299 pass. All green — but green tests
do not cover the two missing AC1 signal types or the AC3 host-detection/dedup
paths in the e2e fixture context.

**Notes for next executor:** Files to revisit —
`fixtures/detection/mixed-signals.html` (add script-src + iframe-src signals and
a real host-collision pair), add e.g.
`fixtures/detection/script-iframe-signals.html`,
`packages/scanner/e2e/detection-golden.spec.ts` (assert host-detection +
dedup), then regenerate `packages/scanner/e2e/expected-detection-config.json`
via `scripts/generate-detection-golden.mjs`. Reuse the established hermetic
pattern from `fixtures/blocking/all.html` (relative/blocked src + data-src so no
real network fires). Confirm host classification with `classifier.ts:249-309`
and `crawler.ts:83-103`. The dedup unit tests at `classifier.test.ts:1416` and
`:1449` show the expected GA4+UA → google-analytics.com collapse to mirror in
the golden.

<!-- Empty at creation. Populated by /pm:verify if rejected. -->

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Re-execution addresses all five prior rejection items — hermetic
script-src and iframe-src host fixtures added, real GA4+UA host-dedup case
present, and the Playwright spec now asserts host-detection (`matchedBy:
script-host` / `iframe-host`) and dedup; all 66 e2e tests green in 8.2s.
**Acceptance criteria check:**
- [x] AC1 (hermetic fixtures: script-path, iframe video, cookies/localStorage) —
  `fixtures/detection/script-iframe-signals.html` (new) and updated
  `mixed-signals.html` carry `<script type="text/plain"
  src="https://www.googletagmanager.com/gtag/js?id=G-FIXTURE">` and `<iframe
  data-src="https://www.youtube.com/embed/fixture123">`; cookie-signals.html /
  localstorage-signals.html / no-signals.html provide cookie + localStorage +
  clean-page coverage. All hermetic (`type="text/plain"` / `data-src` → no
  network). Verified classification path at `classifier.ts:249-255` (script-host)
  and `:284-289` (iframe-host).
- [x] AC2 (second golden `e2e/expected-detection-config.json` incl.
  `suggestedBlocking[]`, via `normalizeConfig()`) — present; 14 suggestedBlocking
  entries including the deduped `google-analytics.com → ["ga4","ua"]`;
  `normalizeConfig()` mirrored from scanner-classify.spec.ts; golden test passes.
- [x] AC3 (spec exercises host-detection + suggestedBlocking + dedup offline) —
  `detection-golden.spec.ts:239` asserts GA4 `matchedBy: "script-host"` and
  YouTube `matchedBy: "iframe-host"` from a fixture with NO cookies (proves the
  host path, not cookie fallback); `:289` asserts exactly one
  `google-analytics.com` entry listing both `ga4` and `ua`. Both pass.
- [x] AC4 (CI runtime < ~1 min; retries:0/workers:2 retained; e2e green) — 66/66
  pass in 8.2s; `retries: 0` (playwright.config.ts:21) and `workers: 2` in CI
  (`:18`) unchanged; folded into existing e2e job per research F5.
**Tests:** e2e 66/66 pass (8.2s, locally re-run by verifier). Prior nit (AC4 text
references `e2e` vs actual `test:e2e` script) is wording-only, non-blocking.
