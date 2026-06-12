# test-strategist — Research findings

## Summary

- **`page.route()` hit-counter is the correct hermetic proof** for both `fetch` and `sendBeacon` — the existing fixture server at `fixtures/serve.mjs` already has a `/fixtures/stubs/collect` beacon sink, but extending it with a per-request counter would require a long-running test-process side-channel; `page.route()` keeps all assertion state in the Playwright process exactly as v6 did for `<img>` pixels [`pixel-block.spec.ts:64-97`].
- **Three-tier split is unchanged:** jsdom for pure-logic (matcher, queue, stub shape), vitest browser-mode for real `window.fetch`/`navigator.sendBeacon` wrapping + promise timing, Playwright e2e for network-level NEGATIVE/POSITIVE proof — mirroring the v5–v6 pattern [`blocking.browser.test.ts`, `pixel-block.spec.ts`].
- **Async/timing flakes are the central risk** — held fetch resolves via a Promise, sendBeacon replay dispatches via `setTimeout(fn, 0)` (v6's INP-stagger pattern [`architecture.md §3`]), and `pagehide`/`visibilitychange` beacons add a page-lifecycle dimension; all must be tamed with `waitForFunction`/`Promise.race` or fixture-side acknowledgement rather than fixed `waitForTimeout`.
- **Four negative cases are load-bearing:** app's own non-curated fetch untouched (synchronous passthrough, unchanged response), benign stub does not throw or hang, skip-Google applies to transport layer, declared-wins applies to URLs already in a `data-category` declared script's endpoint list.

---

## Findings

**F1. Hermetic network assertion — `page.route()` over fixture-server counters** [`goals.md §Acceptance bar`]

The fixture server (`fixtures/serve.mjs`) has a `/fixtures/stubs/collect` POST sink that returns 204, but its counter is not test-visible without a side-channel (shared state between the Node server process and the Playwright worker). `page.route()` counters live entirely in the test process alongside the assertion — the same pattern used for `<img>` pixels in `pixel-block.spec.ts:64-97`. **Recommendation: use `page.route()` counters for all network assertions.** One catch-all handler with inline hostname/pathname dispatch (the pattern established in `pixel-block.spec.ts:64`, enforcing the single-handler rule from `bootstrap-first.spec.ts:54`) counts hits to the tracking endpoint and aborts everything else. The fixture server remains the static file host only.

For `sendBeacon`, `page.route()` intercepts the POST at the Playwright network layer before the browser sends it — the count increments even for `keepalive`-style requests. For `fetch`, the same handler intercepts the request and can `fulfill()` with a 200 to keep the replayed call from hanging. Both match how v6 handled `facebook.com/tr` pixel hits.

**F2. Unit / browser / e2e split** [`goals.md §Acceptance bar`, `architecture.md §10 Testing`]

- **jsdom (vitest unit):** URL normalization in the transport matcher for `string`, `URL`, and `Request` inputs (the three overloads of `window.fetch`); queue data structure (held entries keyed by category); benign stub shape (`{ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve(''), blob: () => ... }` — must not throw, must not hang); `sendBeacon` queue entry (`url + data`); declared-wins logic (URL already covered by a `data-category` rule is skipped by the transport proxy). Mirror `autoblock-matcher.test.ts` for the URL normalization cases.
- **vitest browser-mode (Chromium, `*.browser.test.ts`):** Real `window.fetch` wrapping — the shim must intercept `window.fetch(url)`, `window.fetch(request)`, and `window.fetch(url, init)` forms; held fetch returns the benign stub (no throw, no hang for `await fetch(...).then(r => r.json())`); `navigator.sendBeacon` returns `true` pre-consent (queue semantics); non-curated fetch passes through synchronously (same `Response` object, no stub); `setTimeout(fn, 0)` grant dispatch resolves the held Promise before the next macro-task. These tests land in `packages/cookyay/src/` as `transport-proxy.browser.test.ts`, picked up by `vitest.browser.config.ts` via `src/**/*.browser.test.ts` [`vitest.browser.config.ts:4`].
- **Playwright e2e:** Full network proof — `fetch` and `sendBeacon` to a curated endpoint receive ZERO network requests before consent (the route handler's counter stays at 0), and exactly the right number after grant. Fixtures land under `fixtures/transport/`. Specs land in `packages/scanner/e2e/transport-block.spec.ts`, mirroring `pixel-block.spec.ts`. v6 wired browser-mode tests into the e2e CI job; v7 transport tests follow the same CI path [`005-hermetic-e2e-fixtures-and-specs.md §AC6`].

**F3. Async/timing flake risks** [`goals.md §Acceptance bar`, `architecture.md §3 Sync vs async`]

The v6 grant path uses `setTimeout(fn, 0)` for INP-stagger. For `fetch`, the held Promise resolves inside this `setTimeout` callback — meaning the replayed network call fires one macro-task after `grant()` returns. `waitForTimeout(300)` was sufficient for v6 pixels and is acceptable here (same order of magnitude), but the deterministic alternative is `await page.waitForFunction(() => window.__transportTestHits?.fetch >= 1)` driven by a fixture-side global the route handler increments. For `sendBeacon`, the POST is fire-and-forget — `page.waitForRequest(url => url.includes('/tr'))` is the cleanest Playwright idiom and eliminates the race entirely.

`pagehide`/`visibilitychange` beacon triggers are an edge case: if the fixture page is navigated or closed mid-test, a queued sendBeacon may fire during teardown and pollute the next test's counter. Mitigation: isolate fixture page to a dedicated browser context per test (Playwright's default) and drain the queue explicitly in the fixture's `beforeunload` handler (or simply assert that the count stays 0 until grant within a single page lifecycle).

**F4. Negative coverage that matters** [`goals.md §Acceptance bar`]

1. **App's own fetch untouched:** the fixture page makes a `fetch('/fixtures/stubs/collect')` to the same-origin fixture server (non-curated URL). Assert `response.ok === true` synchronously returned (no stub, no hold). Counter for `/fixtures/stubs/collect` from app fetch must be 1 before consent.
2. **Benign stub does not throw or hang:** unit-layer test — `await fetch('https://www.facebook.com/tr')` before consent returns a Response-shaped object; `.json()` resolves; `.text()` resolves; no unhandled rejection.
3. **Skip-Google for transport:** `fetch('https://www.google-analytics.com/g/collect', ...)` pre-consent passes through (route handler counts it as an allowed request). Assert counter >= 1 and no hold.
4. **Declared-wins at the transport layer:** if the page already has a `data-category="analytics"` declared script pointing to an analytics endpoint, and the app also calls `fetch` to the same endpoint, the transport proxy must not double-queue it. This is an edge case but matches v6's declared-wins pattern for `<img>` pixels [`pixel-block.spec.ts:304-328`].

**F5. Fixtures needed** [`goals.md §What's new in v7`, `005-hermetic-e2e-fixtures-and-specs.md §Implementation notes`]

- `fixtures/transport/fetch.html` — loads with `autoBlock:true`, no `data-category` declarations. Inline script calls `fetch('https://www.facebook.com/tr?ev=PageView')` pre-consent (to assert it's held) and wires an `onConsent('marketing', ...)` handler to call it again post-grant (to assert replay). Also calls `fetch('/fixtures/stubs/collect')` (non-curated, must pass through). Status boxes updated for DOM-level assertions in Playwright.
- `fixtures/transport/beacon.html` — same pattern for `navigator.sendBeacon('https://www.facebook.com/tr', JSON.stringify({ev:'PageView'}))`. Wire a button that calls sendBeacon and a status box that shows the return value (must be `true` pre-consent). Post-grant callback asserts the queued beacon was replayed.
- `fixtures/transport/passthrough.html` (optional, or inline in fetch.html) — non-curated `fetch` + `sendBeacon` to the fixture server; asserts zero interference.
- **Fixture server extension:** add a `/fixtures/transport/collect` endpoint that records POSTs with a simple counter, exposed as a JSON probe at `GET /fixtures/transport/collect/count`. This provides an optional server-side counter as a belt-and-suspenders check alongside `page.route()`. The existing single-catch-all route in `serve.mjs` already handles this pattern for the beacon sink [`serve.mjs:47-51`].

---

## Gotchas

- **`fetch` takes `string | URL | Request`** — the proxy must normalize all three forms to extract the URL before matching. Unit-test all three input variants; the browser-mode test should also exercise the `Request` form (which carries `keepalive`, `method`, `body`, etc. that must be forwarded on replay).
- **`keepalive` fetch on `pagehide`** — browsers allow at most one in-flight `keepalive:true` fetch per page unload. If the replayed fetch uses `keepalive:true` (copied from the original `init`), replay after a `pagehide` grant may be silently dropped. The fixture and spec must not test this path in the e2e fixture to avoid intermittent failures; document as a known limitation.
- **`page.route()` single-handler rule** — as established in `pixel-block.spec.ts` and `bootstrap-first.spec.ts`, register exactly ONE `**/*` handler per test with inline if/else dispatch. Multiple handlers registered in sequence cause ambiguous order and are a known source of flake.
- **Browser-mode vitest runs in the e2e CI job** — the `transport-proxy.browser.test.ts` file must be under `packages/cookyay/src/` with the `.browser.test.ts` suffix so `vitest.browser.config.ts:4` picks it up. The CI step that runs browser-mode tests must be confirmed to run before the Playwright e2e step (same job, sequential steps) — see v6's CI wiring pattern.
- **Benign stub must be a complete Response-interface duck-type** — app code may inspect `response.headers`, `response.status`, `response.ok`, call `.json()`, `.text()`, `.blob()`, `.arrayBuffer()`, or `response.clone()`. Each must exist and resolve (not throw). The unit tests must cover each accessor.
- **`sendBeacon` return value** — spec says `sendBeacon` returns `false` if the user agent can't queue the request (e.g. payload too large). The wrapper must return `true` for queued (not-yet-sent) beacons to avoid breaking callers that check the return value as a reliability signal.

---

## Recommendations

1. **(P0) Use `page.route()` counters as the canonical network proof** — implement `setupRoutes()` in `transport-block.spec.ts` with the same single-handler inline dispatch pattern as `pixel-block.spec.ts:55-100`. Count hits to the curated endpoint (e.g. `facebook.com/tr`); fulfill with `{ status: 200, body: '' }` to complete the replayed `fetch`; abort everything else except localhost. This is the only hermetic, test-process-local, race-free assertion mechanism.
2. **(P0) Unit-test the benign stub exhaustively** — `fetch` stubs that partially implement the Response interface cause silent `TypeError` in app code. Cover `.ok`, `.status`, `.headers`, `.json()`, `.text()`, `.blob()`, `.arrayBuffer()`, `.clone()`, `response.body` (ReadableStream or null). Run in jsdom; no browser needed.
3. **(P1) Tame timing with `page.waitForRequest` for sendBeacon replay** — prefer `await page.waitForRequest(req => req.url().includes('/tr') && req.method() === 'POST')` over `waitForTimeout` for the POSITIVE proof. For fetch replay, `page.waitForResponse(url => url.includes('/tr'))` is equivalent. Both eliminate the arbitrary-wait flake entirely.
4. **(P1) Wire `transport-proxy.browser.test.ts` into `vitest.browser.config.ts`** — no config change needed (glob `src/**/*.browser.test.ts` already covers it), but confirm the CI e2e job invokes `vitest --config vitest.browser.config.ts` before `playwright test`, matching the v6 pattern from `005-hermetic-e2e-fixtures-and-specs.md §AC6`.
5. **(P2) Extend `fixtures/serve.mjs` with a `/fixtures/transport/collect` counter endpoint** — a simple in-process Map keyed by endpoint slug gives an optional server-side verification layer without shared state. Useful for debugging; not required if `page.route()` counters are sufficient.
6. **(P2) Add a `pagehide`-beacon fixture as a documented edge-case test** — not in the main acceptance bar, but a `transport/beacon-unload.html` fixture that calls `sendBeacon` on `pagehide` exercises the lifecycle path. Mark the test `test.skip` with a comment explaining the `keepalive` replay risk; gives a hook for future work.

---

## Open questions for the user

1. **Benign stub fidelity level** — should the stub implement `response.clone()` (returns a second stub) and `response.body` (returns a `ReadableStream`)? High-fidelity stubs add bundle weight; a minimal stub risks breaking exotic app code. What is the threshold?
2. **sendBeacon data forwarding** — should the queued payload (`data` arg — `string | Blob | FormData | URLSearchParams | ArrayBuffer | ArrayBufferView`) be forwarded byte-for-byte on replay, or is it acceptable to forward as-is (reference preserved)? If `Blob` objects have been GC'd or their `arrayBuffer()` consumed, forwarding by reference may send stale data.
3. **Transport proxy install point** — should `window.fetch` and `navigator.sendBeacon` be wrapped in the same synchronous `init()` call as the `createElement` proxy (v5's Phase 1), or in a separate lazy-loaded module (Phase 2)? The goals say "must be first in `<head>`" but the lazy Phase 2 import introduces a gap for async tracking calls. This decision affects which tests need to cover the gap.
4. **`XMLHttpRequest` scope** — `goals.md` defers XHR to a later version. Confirm that transport-layer tests should explicitly assert XHR calls are NOT intercepted (a negative test proving no over-reach), or simply leave XHR out of scope with no test.

---

## Out of scope

- `XMLHttpRequest` interception — explicitly deferred in `goals.md §What's deferred to later versions`.
- `document.write` legacy injection — deferred since v5.
- Performance/bundle-size assertions for the new transport proxy — covered by the dedicated bundle-budget reclamation task (`goals.md §Bundle-budget reclamation`), not this test strategy.
- Server-side consent logging, webhook, or any network egress beyond the hermetic fixture server.
- Cross-browser testing beyond Chromium — consistent with v5–v6 CI scope (`vitest.browser.config.ts:9` Chromium-only; `architecture.md §9` Playwright E2E Chromium-only).
- `pagehide`/`visibilitychange` beacon as a required acceptance-bar case — noted as a known edge case and documented, but not blocking v7 done.

## Update — 2026-06-12 — User decisions

The cross-cutting open questions were resolved by the user (see [_index.md §Update](_index.md)):
- **fetch stub** → `204 No Content`, empty body (not configurable in v7); hybrid stub+queue retained.
- **Install timing** → Phase 2 lazy `autoblock-loader` chunk; the small pre-chunk-load escape window is an accepted, documented bootstrap-first limit.
- **sendBeacon at unload** → dropped pre-consent (no sessionStorage persistence); documented in README limits.

Carried as implementation constraints: clone Request body / forward beacon `data` at intercept time; add a negative test that XHR is NOT intercepted; fold the v6 diagnostic into the lazy chunk for budget reclamation. No PRD amendment required.
