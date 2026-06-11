# Test-strategist — Research findings

## Summary

- v5 adds a runtime interception path in the banner (MutationObserver + script/iframe gating) that must be tested at the real-browser level; the existing jsdom Vitest suite covers the declarative engine but cannot exercise `MutationObserver` timing or actual script execution suppression.
- The hermetic fixture site (`fixtures/blocking/all.html`) and its stub-script pattern (`window.__ga4Ran`, `window.__pixelRan`) are directly reusable for auto-block tests — a new fixture page that loads real-looking-but-inert third-party scripts without hand-declared `data-category` attributes is the primary new asset needed.
- The 20 KB combined bundle budget is already governed by a hard-fail `size-limit` gate in CI (`pr.yml` `size-limit` job); v5 must extend this to cover the auto-block path (whether the signature DB is inlined or lazy-loaded), but no new CI plumbing is needed — only an updated `.size-limit.json` entry.
- Parity between scan-time and run-time verdicts is testable cheaply: both consume `services.yaml` via `SERVICE_DB`; a dedicated Vitest unit test asserting that every service id reachable by `findServiceByHost`/`findServiceByCookie` is also matchable by the new client-side matcher closes the gap without Playwright.

---

## Findings

### F1 — Existing blocking tests split cleanly on jsdom vs. real-browser lines; both halves are reusable [goals.md §Acceptance bar, prd.md §3.2]

`blocking.test.ts` covers DOM registration, state tracking, placeholder injection, idempotency, and stagger scheduling in jsdom (fast, ~300ms). `blocking.browser.test.ts` covers actual script execution via Vitest browser mode (Chromium headless). For v5, the new `autoBlock` module (client-side signature matcher + MutationObserver interceptor) follows the same split: pure matcher logic (host/path → category resolution, confidence-threshold gating, declared-wins precedence) belongs in jsdom Vitest; the assertion that an intercepted script is actually prevented from running until consent belongs in the browser mode or Playwright.

### F2 — Client-side signature matcher logic is pure JS and can be unit-tested without a browser [goals.md §What ships in v5, prd.md §3.6]

The v4 `findServiceByHost`, `findServiceByRequest`, and `findServiceByCookie` functions are already exercised in ~200 unit tests in `classifier.test.ts` and `db.test.ts` without touching Playwright. The v5 client-side matcher (which consumes the same `SERVICE_DB` or a derived compact form) exposes exactly the same decision surface: given a URL, return `{ category, serviceId, confidence } | null`. A Vitest node-env test file (`auto-block.test.ts`) should assert: (a) known hosts resolve to the correct category; (b) services below the confidence threshold are not gated; (c) a declared `data-category` on the same script element wins over the auto-detected category (declared-wins precedence); and (d) unknown URLs return `null`. These are all pure function calls — no DOM, no timers. This tier runs in milliseconds and catches ~90% of matcher regressions before any browser starts.

### F3 — The hard part: asserting actual script suppression in a real browser requires new fixture pages [goals.md §Acceptance bar, prd.md §5]

The existing `fixtures/blocking/all.html` uses hand-declared `data-category` attributes; v5 auto-block must intercept scripts that have NO such declaration. A new fixture page `fixtures/auto-block/all.html` should load four inert stubs that mimic known third-party src patterns (e.g. `<script src="/fixtures/stubs/ga4.js">` served from the fixture server, but with a src attribute whose hostname in the page HTML is set to a recognizable pattern like `googletagmanager.com` — see approach note below) without declaring `data-category`. The pattern from the blocking stubs applies directly: each stub sets a `window.__<serviceId>Ran = true` flag. The Playwright spec asserts the flag is `undefined` before consent and `true` after granting the matching category. The `page.route()` default-deny-external pattern from `blocking.spec.ts` and `flows.spec.ts` must be applied here too — every test's `beforeEach` should abort all non-localhost traffic.

**Approach note on host matching in the hermetic fixture:** The MutationObserver intercepts `<script src="...">` elements before the browser fetches them. The src value does not have to be a live URL for the interceptor to read and match its hostname. The fixture page can set `src="https://www.googletagmanager.com/gtag/js"` and `page.route()` can abort that request — what matters is whether the interceptor read the src, classified it, and blocked the element before the browser attempted the fetch. This avoids any real network dependency.

### F4 — Declared-wins and no-double-block coexistence must be Playwright-tested, not just unit-tested [goals.md §Acceptance bar]

The acceptance bar explicitly requires: "Declared rules and auto-block coexist correctly (declared always wins; no double-block, no gaps)." A Playwright spec on a fixture page that has BOTH a hand-declared `<script type="text/plain" data-category="analytics" src="...googletagmanager...">` AND auto-block enabled must assert: (a) the script is blocked pre-consent (exactly once — not double-registered); (b) it executes exactly once after analytics consent is granted; (c) the `data-cookyay-state` attribute ends at `"executed"`, not in a broken intermediate state. The idempotency tests in `blocking.browser.test.ts` (counter increments) provide the right pattern to reuse here.

### F5 — Parity testing between scan-time and run-time verdict for the same service is a unit-level concern [goals.md §What's new in v5, prd.md §3.6]

Both the scanner's `classify()` path and the banner's new auto-block path derive their verdicts from the same `SERVICE_DB` source (compiled from `services.yaml`). A Vitest unit test (`parity.test.ts` or added to `db.test.ts`) should iterate all curated services, call both `findServiceByHost(hostSample)` (scanner path) and the new client matcher with the same host, and assert that both return the same `serviceId` and `category`. This is fast (in-process, no DOM), catches divergence immediately when either path is updated, and gives the `/pm:test` interview a concrete, automatable form of the parity requirement. No Playwright run is needed for this coverage.

### F6 — Bundle budget gate already exists as a hard-fail in CI; v5 must update it to account for the DB delivery mechanism [prd.md §3.1, §5, goals.md §What ships in v5]

The `.size-limit.json` at workspace root currently gates on `packages/cookyay/dist/index.iife.js + bootstrap.js` combined at ≤ 20 KB gzipped, with a separate 1 KB gate on `bootstrap.js` alone (pr.yml `size-limit` job). If the signature DB is inlined into `index.iife.js`, this gate automatically covers it — no new CI entry needed, just verify the combined limit holds. If the DB is a separately loaded chunk (lazy/deferred), a third `size-limit` entry for that chunk must be added before merging v5. Either way, the gate should fail the PR, not merely warn (the existing `pnpm size` step already fails on breach).

### F7 — MutationObserver timing is the primary Playwright flake risk [prd.md §5, goals.md §What ships in v5]

The `MutationObserver` callback fires asynchronously. A race exists between: (1) the browser parsing `<script src="...">` and starting the fetch, and (2) the interceptor reading the `src` attribute and neutralizing the element. If the observer fires after the request is already in-flight, the script will execute. In the Playwright fixture tests, the recommended mitigation is to inject the auto-block initialization in the `<head>` (before any third-party script tags) and assert flag state only after `page.waitForLoadState('networkidle')` or an explicit `page.waitForTimeout(100)` — matching the pattern already used in `blocking.spec.ts` (`await page.waitForTimeout(100)` in reject-all tests). The `page.route()` abort-all-external pattern also acts as a safety net: even if the observer races and the browser attempts the fetch, the route abort prevents execution.

### F8 — CI cost impact is bounded; the new specs slot into the existing `e2e` job [prd.md §5, goals.md §What ships in v5]

The `pr.yml` `e2e` job runs all specs under `packages/scanner/e2e/` in parallel with `workers: 2`. Adding 4–6 new auto-block Playwright tests (one fixture page, ~5 test cases) adds roughly 30–60 seconds to the job wall-clock time, keeping the PR suite under 10 minutes. No new Playwright job should be created; the new `auto-block.spec.ts` file drops into the existing `e2e/` directory and is picked up automatically. The Vitest unit tests for the matcher and parity layer run in the workspace root `test` job (not Playwright) and add negligible time.

---

## Gotchas

- **MutationObserver cannot retroactively block a script already in the parser's fetch queue.** The auto-block initializer MUST run synchronously before any third-party script elements are present in the DOM — i.e., in the bootstrap snippet or the very first `<script>` in `<head>`. Tests that add third-party script elements via `innerHTML` after DOMContentLoaded will not represent the real-world timing and should be avoided in browser-mode tests.
- **`page.route()` abort does not prevent the MutationObserver from firing**, but it does prevent actual JS execution from a fetched src. This means fixture tests can confidently assert `window.__<service>Ran === undefined` even if the observer races slightly, because the route abort is the last line of defense. Do not remove the `page.route()` setup.
- **Confidence threshold gating introduces a test design challenge.** If the DB delivers only `requestHosts` signals at runtime (no cookies, no localStorage available pre-execution), all matches will be `medium` confidence. Tests that assert on confidence level must be written with the runtime-only signal set in mind, not the full two-signal model from the scanner. Unit tests for the threshold gate should explicitly cover the `low` boundary to prevent accidental changes from unblocking low-confidence services.
- **Double-block risk.** If a site owner has both `autoBlock: true` AND a `<script type="text/plain" data-category="...">` for the same service, both the `scanBlocked()` declarative pass and the MutationObserver may attempt to register the same element. The idempotency guard (`data-cookyay-state === "executed"` or `"blocked"` skips re-registration) in `blocking.ts` already handles this for the declarative path; the auto-block path must respect the same attribute before intercepting. Test this explicitly in a Playwright coexistence spec.
- **`fixtures/service-fingerprints.json` drift guard** (`db.test.ts` §6) must be extended or a parallel guard added for any new client-side matcher module that derives its own compact DB subset — to prevent the client copy from diverging from `services.yaml`.

---

## Recommendations

1. **Add `auto-block.test.ts`** (Vitest jsdom) for the client-side matcher: host/path → category resolution, confidence-threshold gating (do not block below threshold), declared-wins precedence, null return for unknown URLs. Mirror the data-driven `CURATED_SIGNAL_TABLE` pattern from `db.test.ts` — one row per ~50 curated services, `it.each`. Target: <150 lines. No Playwright needed for this tier.

2. **Add `parity.test.ts`** (Vitest node-env) that imports both the scanner's `findServiceByHost`/`findServiceByRequest` and the new client matcher and asserts they return the same `serviceId` + `category` for every curated service's representative signal. This is the automated form of the `[goals.md §What's new in v5]` parity requirement. ~50 assertions, runs in milliseconds.

3. **Add `fixtures/auto-block/all.html`** — a fixture page with `autoBlock: true` in the cookyay config and four inert stub scripts/iframes whose `src`/`data-src` values match known service hostnames (GA4, Meta Pixel, YouTube, Hotjar). No `data-category` attributes. The `page.route()` abort-all-external pattern from `blocking.spec.ts` must be applied in `beforeEach`. Add the corresponding `e2e/auto-block.spec.ts` Playwright spec (~6 test cases): pre-consent suppression, post-grant execution, reject-all stays suppressed, coexistence with a declared script for the same service, granular category grant releases only matching category.

4. **Extend `.size-limit.json`** before v5 merges: add a named entry for the DB delivery artifact (inline or separate chunk). If inline, add an explicit comment that the combined IIFE limit absorbs the DB. If separate chunk, add a new entry with a hard limit appropriate to the DB size. The existing `pnpm size` CI step enforces the gate automatically once the config is updated [prd.md §5].

5. **Add a `coexistence` test block** inside `auto-block.spec.ts` that loads a page with BOTH a hand-declared `<script type="text/plain" data-category="analytics">` pointing to a known-service URL AND `autoBlock: true`. Assert the script is not double-registered (counter increments exactly once after grant), state ends at `"executed"`, and no double-clone appears in the DOM. Reuse the counter pattern from `blocking.browser.test.ts`.

6. **Maintain `retries: 0`** and fold all new specs into the existing `e2e` job. Do not add a new Playwright CI job for auto-block.

---

## Open questions for the user

1. **DB delivery mechanism** — will the signature DB be inlined into `index.iife.js` at build time, or lazily loaded as a separate chunk? The answer determines whether `.size-limit.json` needs a new entry and whether the Playwright auto-block tests can assume the DB is synchronously available at page-load time (critical for MutationObserver race behavior). This is the primary research question for the architect persona.

2. **Confidence threshold for runtime block** — the v4 two-signal model emits `high` only when a cookie AND a request corroborate on the same page. At runtime the banner only sees request/script-src signals (no cookies yet, since the script hasn't run). Should the threshold for auto-block be `medium` (single signal: host match)? Or is `low` acceptable? The test for `threshold-gating` in `auto-block.test.ts` depends on the answer.

3. **Should the auto-block Playwright spec live in `packages/scanner/e2e/`** (where all current Playwright tests live) or in a new location closer to the `cookyay` package? The current test for the blocking engine's real-browser behavior (`blocking.browser.test.ts`) uses Vitest browser mode in `packages/cookyay` — the auto-block integration test could follow that pattern (no Playwright config needed) but would require the fixture server to be running. Recommend aligning on one approach before writing the spec.

---

## Out of scope

- Testing the OCD-generated 439 services at the auto-block level — only the ~50 curated services need auto-block coverage; OCD entries remain scanner-only.
- Real-network auto-block acceptance testing — per [prd.md §5] and [goals.md §Acceptance bar], the real-site dogfood run remains a manual step.
- Browser-compatibility testing beyond Chromium — evergreen-only per [prd.md §5].
- A11y testing of any auto-block UI (placeholder, consent-required message) — if added to the placeholder div, fold into the existing `accessibility.spec.ts`; not a new spec file.
- Performance profiling of MutationObserver overhead — not a CI concern for a 50-service DB.
