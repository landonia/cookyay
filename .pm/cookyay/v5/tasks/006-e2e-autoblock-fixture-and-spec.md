---
id: 006
title: Hermetic e2e auto-block fixture + spec
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["005"]
complexity: 5
prd_refs:
  - "goals.md §Acceptance bar"
  - "prd.md §5"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (amend)"
test_refs: []
research_refs:
  - "research/test-strategist.md §Findings"
  - "research/test-strategist.md §Gotchas"
acceptance_criteria:
  - "A hermetic fixture page loads known-service stubs (a local stand-in GA/analytics script and a marketing iframe, NO real network to google/facebook) with NO data-category declarations and an autoBlock:true config; each fake third party sets a detectable global flag (e.g. window.__ranAnalytics) when it executes."
  - "An e2e/browser spec asserts the full lifecycle: before consent the matched script/iframe is held (its global flag is NOT set), after granting the matching category the script executes (flag set) and the iframe src is promoted — proving block-until-consent then run."
  - "A coexistence case asserts an element that is BOTH declared (type=text/plain data-category) AND DB-matched is handled exactly once (declared wins; no double-execution, no gap)."
  - "A negative case asserts a Google-host stub is NOT held by auto-block (skip-Google), and a same-origin/app script is untouched."
  - "Tests are deterministic and hermetic (network to third-party hosts stubbed/aborted, e.g. via page.route or local fixtures per the v4 pattern); the suite runs in CI and is green. Test placement follows the existing convention (Vitest browser-mode in packages/cookyay, matching blocking.browser.test.ts, or Playwright e2e — pick one and state why)."
created: 2026-06-10
---

## Task
The goals.md acceptance bar is that, with auto-block on and *no* hand-declared
rules, the banner blocks the third parties present until the matching category is
granted — and that declared and auto-block coexist correctly [goals.md
§Acceptance bar]. Prove it hermetically in a real browser. The hard part is
deterministically answering "did the third party actually execute?" — solved by
fake trackers that set a global flag, asserted before and after consent
[research/test-strategist.md §Findings]. Keep it offline: no real requests to
google/facebook, mirroring the v4 detection-golden fixture approach.

## Implementation notes
- Reuse the v4 hermetic pattern: stub external requests (`page.route()` abort, or
  local fixture files) so the suite never touches real third-party hosts
  [research/test-strategist.md §Gotchas]. This also serves as a safety net against
  MutationObserver/timing flake.
- Fixture pages live alongside the existing fixtures; each fake service sets a
  unique `window.__ran*` flag on execute so the spec can assert held vs. executed.
- Cover: held-before-consent, executes-after-grant, declared-wins coexistence,
  Google skip, same-origin pass-through.
- Decide test placement up front (Vitest browser-mode vs. Playwright e2e) — the
  test-strategist flagged this; align with `blocking.browser.test.ts` if simplest.

## Out of scope
- The parity (scanner↔banner) test (task 007).
- The bundle-budget gate (task 008).
- Production dogfooding (the manual acceptance step, per the v1 testing posture).

## Implementation summary

**Files changed:**
- `fixtures/auto-block/all.html` — New hermetic fixture page. Calls `init({ autoBlock: true })` with no `data-category` declarations, then dynamically injects known-service scripts/iframes via `document.createElement` so the proxy's Phase 1 shim (already installed synchronously by `init()`) stages them immediately. Services: Hotjar analytics script (`static.hotjar.com`), Meta Pixel marketing script (`connect.facebook.net`), YouTube marketing iframe (`youtube.com/embed/...`). Also includes: a declared+DB-matchable coexistence script (`type="text/plain" data-category="analytics"` with a Hotjar URL — declared wins), a Google-host negative case (GTM, not held), and a same-origin first-party script (not held). Status divs are updated by `onConsent` callbacks so the Playwright spec can assert DOM state.
- `fixtures/stubs/hotjar.js` — New analytics stub script. Sets `window.__hotjarRan = true` on execution.
- `fixtures/stubs/same-origin-app.js` — New first-party app stub. Sets `window.__sameOriginRan = true` on execution.
- `fixtures/stubs/yt-embed.html` — New YouTube embed stub HTML page for iframe fulfillment.
- `packages/scanner/e2e/auto-block.spec.ts` — New Playwright spec (11 tests) covering all 5 ACs. Uses `page.route()` to fulfill known-service hostnames with local stubs (Hotjar → `hotjar.js`, Meta Pixel → inline JS setting `__pixelAutoRan`, YouTube → `yt-embed.html`, coexist Hotjar path → inline JS incrementing `__coexistCount`), and aborts all other external requests.
- `packages/cookyay/dist/` — Rebuilt with `pnpm --filter cookyay build` to include task 005's `blocking.ts` changes (`_injectScript` auto-detected `data-src` path; `enqueueAutoDetected`). The prior dist was stale.

**Acceptance criteria check:**
- [x] AC1 (hermetic fixture, no `data-category`, `autoBlock:true`, detectable window flags) — `fixtures/auto-block/all.html` calls `init({ autoBlock: true })` with no declared `data-category` attrs on the auto-block scripts; `hotjar.js` sets `__hotjarRan`, inline pixel stub sets `__pixelAutoRan`; YouTube iframe is the iframe test case.
- [x] AC2 (full lifecycle: held before consent, executes after grant, iframe src promoted) — `pre-consent` describe block (3 tests): Hotjar/Pixel flags absent, YouTube `src` null; `post-grant` describe block (4 tests including granular + reject-all): accept-all → flags set + iframe src promoted; granular analytics grant → only Hotjar executes, marketing stays blocked.
- [x] AC3 (coexistence: declared wins, no double-execution) — `coexistence` describe block (1 test): `#autoblock-coexist` has `type="text/plain" data-category="analytics"` AND Hotjar URL; `data-cookyay-auto` is null (proxy skipped it), state is `"blocked"` (declarative engine registered it), `__coexistCount === 1` after grant (exactly once). `auto-block.spec.ts:301`.
- [x] AC4 (negative: Google skip, same-origin pass-through) — `negative cases` describe block (2 tests): GTM's `data-cookyay-auto` is absent (matcher returns null for `google:true` services); same-origin runs immediately (`__sameOriginRan` true, no `data-cookyay-auto`). `auto-block.spec.ts:343,362`.
- [x] AC5 (hermetic, runs in CI, test placement stated) — `page.route()` default-deny with selective fulfillment; spec in `packages/scanner/e2e/` picked up by `playwright.config.ts` (no new CI plumbing). Placement rationale: Playwright e2e (not Vitest browser-mode) because `page.route()` is required to intercept third-party hostname requests AND assert real script execution — Vitest browser-mode lacks route interception. 77/77 tests green.

**Tests:** `pnpm --filter @cookyay/scanner exec playwright test` — 77/77 pass (11 new in `auto-block.spec.ts`). Unit tests: 465/465 pass (`pnpm --filter cookyay exec vitest run`). Browser tests: 23/23 pass.

**Notes for verifier:**
- The key design decision: third-party scripts are injected **dynamically** (via `document.createElement('script')` + `el.src = '...'`) rather than as `<script src="...">` in the HTML. This is because `init()` is called from a `type="module"` script (deferred), so any `<script src="...">` in the HTML would parse and execute before the proxy is installed. Dynamic injection after `init()` is the correct real-world pattern the proxy is designed to intercept.
- The fixture relies on the dist being built from the task 005 source. The dist was rebuilt as part of this task (`pnpm --filter cookyay build`).
- `page.route()` uses `route.fulfill()` (not `route.abort()`) for Hotjar, Pixel, and YouTube hostnames so the stub JS actually executes on grant. All other external requests (including GTM) are aborted.
- The coexistence test selects the original `<script type="text/plain">` element via `#autoblock-coexist[type="text/plain"]` because `_injectScript` copies the `id` attribute to the clone, creating two elements with the same id. Same pattern for `#autoblock-hotjar[data-cookyay-auto="true"]`.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Hermetic Playwright auto-block spec proves block-until-consent, declared-wins coexistence, Google skip, and same-origin pass-through with real script-execution assertions; all ACs met and the full e2e suite is green.
**Acceptance criteria check:**
- [x] AC1 (hermetic fixture, no data-category, autoBlock:true, detectable flags) — `fixtures/auto-block/all.html` calls `init({autoBlock:true})` and dynamically injects Hotjar/Pixel/YouTube with no `data-category`; stubs `fixtures/stubs/hotjar.js`/inline pixel/`yt-embed.html` set `__hotjarRan`/`__pixelAutoRan`/`__ytEmbedLoaded`. No real network: `page.route('**/*')` default-deny aborts all non-localhost except locally-fulfilled known hosts (`auto-block.spec.ts:75-139`).
- [x] AC2 (lifecycle: held→grant→executes, iframe src promoted) — pre-consent describe asserts flags undefined + `data-cookyay-state="blocked"` + iframe src null (`auto-block.spec.ts:145-187`); post-grant describe asserts `__hotjarRan/__pixelAutoRan === true`, iframe src promoted to `youtube.com/embed/`, state → `executed`, plus granular-grant category isolation and reject-all-stays-held (`auto-block.spec.ts:193-292`).
- [x] AC3 (coexistence, declared wins, exactly once) — `#autoblock-coexist` is `type="text/plain" data-category="analytics"` + Hotjar URL; test asserts `data-cookyay-auto` null (proxy skipped), state `blocked`→`executed`, `__coexistCount === 1` after grant (`auto-block.spec.ts:298-333`).
- [x] AC4 (Google skip + same-origin pass-through) — GTM test asserts `data-cookyay-auto` absent and state ≠ `blocked`; same-origin executes immediately (`__sameOriginRan` true) with no auto attrs (`auto-block.spec.ts:340-372`).
- [x] AC5 (deterministic/hermetic, CI, green, placement stated) — `retries:0`, default-deny routing, spec lives in `packages/scanner/e2e/` and is auto-picked by CI's unfiltered `pnpm --filter @cookyay/scanner exec playwright test` (`.github/workflows/pr.yml:108`); placement rationale (Playwright over Vitest browser-mode for route interception) documented in the spec header.
**Tests:** Auto-block spec 11/11 pass; full e2e suite 77/77 pass (re-run independently). No `.only`/`.skip`/debug artifacts in new files.
**Notes:** Research recommended a `MutationObserver`, but the architecture amendment (task 004) settled on a synchronous createElement/setAttribute proxy; the fixture and spec correctly model the proxy (dynamic injection after `init()`). No `testing.md` for v5, so test-strategy-compliance check skipped per pm:verify. Future-work (out of scope here): the matcher/parity Vitest tiers (research Rec 1-2) and `.size-limit.json` extension land in tasks 007/008.
