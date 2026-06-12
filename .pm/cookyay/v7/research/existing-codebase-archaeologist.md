---
persona: existing-codebase-archaeologist
version: v7
date: 2026-06-11
---

# existing-codebase-archaeologist — Research findings

## Summary

- The bootstrap install point is `api.ts:init()` — `installAutoBlockProxy()` is called synchronously before any DOM scan; wrapping `window.fetch` and `navigator.sendBeacon` must happen at that exact same call, not in the bootstrap snippet or lazily, or the pre-consent window is not covered.
- The existing hold → grant → fire lifecycle (`HeldElement`, `_held`, `enqueueAutoDetected`, `grant()`) is fully element-centric; transport requests have no DOM element to carry state, so v7 needs analogous but separate held-request and queued-beacon stores, drained by the same `grant()` trigger.
- `matchAutoBlock(url)` already accepts a bare URL string and returns `AutoBlockMatch | null` — no matcher changes are required; transport interception reuses the exact same call site.
- Bundle headroom is the binding constraint: the ESM-OFF bundle is measured at ~12.6 kB against a 13 kB limit (~0.4 kB left); `autoblock-proxy.ts` is statically imported so every byte added there costs all installs; the transport wrapping code must either live inside the lazy `autoblock-loader` chunk or be aggressively small.

---

## Findings

**1. Bootstrap install point — where `fetch`/`sendBeacon` wrapping must hook in**
[goals.md §What ships in v7, prd.md §3.2]
`api.ts:init()` (line 269–315) is the single install seam. When `config.autoBlock` is true it calls `installAutoBlockProxy(debugFn)` synchronously — no async gap — then fires the lazy `import('./autoblock-loader.js')`. The same `installAutoBlockProxy()` function in `autoblock-proxy.ts` (line 290) must also wrap `window.fetch` and `navigator.sendBeacon` in that same synchronous call. Both globals must be saved and replaced before `installAutoBlockProxy()` returns, exactly as `_origCreateElement`, `_origSetAttribute`, and `_origImage` are saved at lines 301–303. The `bootstrap.ts:applyBootstrap()` snippet does NOT install the proxy — it only arms `window.__COOKYAY`, GPC flag, and Consent Mode defaults. Transport wrapping must NOT go there.

**2. Two-phase timing applies identically to transport**
[goals.md §What ships in v7, architecture.md §3 Sync vs async work]
Phase 1 (`installAutoBlockProxy()`) must capture and replace `window.fetch`/`navigator.sendBeacon` synchronously. In Phase 1 (before `activateMatcher()` resolves), the shim cannot yet classify URLs — it must either (a) stage all matched or unmatched requests until the matcher resolves, or (b) adopt a more conservative approach and hold ALL fetch/beacon calls in Phase 1, then classify and replay/release in `activateMatcher()` alongside the existing `_staged` drain. The latter matches the exact pattern used for DOM elements (`_staged` queue, `classifyAndRelease` in `activateMatcher()`). `autoblock-proxy.ts:activateMatcher()` (line 212) is the natural drain point for held transport calls too.

**3. HeldElement lifecycle — transport analog**
[goals.md §What ships in v7, prd.md §3.2]
The DOM path: proxy intercepts → `_holdElement()` pushes to `_held[]` → `api.ts:_enqueueHeldElements()` splices `_held` → `enqueueAutoDetected(el, src, category)` stores `data-src` on element and enqueues in `_q` → `grant(category)` drains `_q` and calls `_injectScript/_injectIframe/_injectImg`. The transport analog has no DOM element:
- **`fetch`**: a held request needs `{url, init, resolve, reject}` stored somewhere (the promise returned to the caller must resolve eventually). On grant, replay via `_origFetch(url, init).then(resolve, reject)`. Pre-consent the caller gets a promise that resolves to a benign stub `Response` (e.g. `new Response(null, { status: 200 })`).
- **`sendBeacon`**: fire-and-forget returning `boolean`; a queued beacon needs only `{url, data}`. On grant, call `_origSendBeacon(url, data)`. Pre-consent return `true` to the caller immediately.
Both stores should be module-level arrays in `autoblock-proxy.ts` (same home as `_held`, `_staged`) and drained either by a new `grant()` hook or by wiring through `api.ts` analogously to `_enqueueHeldElements()`. Using the existing `blocking.ts:grant()` dispatch path is tempting but that function is element-keyed (`_q: Map<string, QueueEntry[]>`); transport calls are category-keyed but have no element — cleanest approach is a parallel `_heldFetches` / `_queuedBeacons` store drained by a new `releaseTransport(category)` called from `grant()` or from `api.ts` on consent.

**4. Matcher accepts bare URL string — no changes needed**
[goals.md §What ships in v7, prd.md §3.2]
`autoblock-matcher.ts:matchAutoBlock(url: string)` (line 230) takes a plain URL string. The DOM proxy already passes the raw `src` string — fetch/beacon interception will pass `url` from the `fetch(url, init)` call or `sendBeacon(url, data)` call directly. The existing `requestPaths` matching (line 273–289) already handles `facebook.com/tr` and similar tracking endpoints that are the primary `fetch`/`sendBeacon` targets. No matcher changes required; the skip-Google guard is intrinsic to the index (Google entries excluded at build time, `autoblock-matcher.ts:91`).

**5. Static import of `autoblock-proxy.ts` hits the ESM-OFF bundle**
[goals.md §Bundle-budget reclamation, prd.md §3.1, v6/RELEASE.md §Known limitations]
`api.ts` statically imports from `autoblock-proxy.ts` (lines 14–19) because the proxy shim must be available synchronously in `init()`. Any code added to `autoblock-proxy.ts` is therefore included in the always-on ESM-OFF bundle regardless of `config.autoBlock`. The v6 measured ESM-OFF size was ~12.6 kB against a 13 kB limit — ~400 bytes headroom. The fetch/sendBeacon shim stubs (the wrapping closures that run before the matcher) are unavoidably in this file. The bundle-budget reclamation work item in v7 goals is therefore load-bearing, not cosmetic. Options include: moving transport-only state/logic into a new `autoblock-transport.ts` that is conditionally imported (parallel to `autoblock-loader.ts`), or exploiting the same lazy chunk path. However, the synchronous-install requirement means at minimum the save-and-replace lines must be in the Phase 1 sync path.

**6. DCE and debug-gating conventions**
[goals.md §Bundle-budget reclamation, architecture.md §10 Tech stack]
The `autoblock-diagnostic.ts` pattern is the established template for DCE: `tsup.config.ts` defines `process.env.NODE_ENV` as `"production"` for the IIFE build and `"development"` for ESM; debug bodies are guarded by `process.env.NODE_ENV !== 'production' && config.debug`. Transport interception debug logs must follow the same `_debug?.()` pattern already used throughout `autoblock-proxy.ts`. No `console.log` without the `_debug` guard.

**7. `_resetAutoBlockProxy()` must restore transport globals**
[goals.md §Acceptance bar]
`autoblock-proxy.ts:_resetAutoBlockProxy()` (line 521) restores `Element.prototype.setAttribute`, `document.createElement`, and `window.Image`. It must also restore `window.fetch` and `navigator.sendBeacon` from saved originals, and drain/clear the `_heldFetches` and `_queuedBeacons` stores. This is test-teardown critical — Vitest jsdom tests that don't restore these globals will pollute subsequent tests, as already documented for `_origImage`.

**8. Declared-wins + skip-Google must hold at transport layer**
[goals.md §Same guardrails as pixels, prd.md §3.2, §3.4]
The existing `_holdElement()` skip guard checks `el.getAttribute(ATTR_STATE) === STATE_BLOCKED` (declared-wins precedence). There is no DOM element for fetch/beacon, but the declared-wins rule translates to: if a URL is already being blocked declaratively (unlikely for a network call, but conceptually), do not also queue it as a transport call. In practice, the curated-endpoint-only scope provides the guard. Skip-Google: `matchAutoBlock()` never returns a hit for Google hosts (excluded at index build time); no additional guard needed in the transport shim — a `fetch` to `google-analytics.com` passes through automatically.

**9. Build outputs and ESM vs IIFE**
[goals.md §Acceptance bar, tsup.config.ts, .size-limit.json]
Two production builds: ESM (`dist/index.js`) and IIFE CDN (`dist/index.iife.js`). IIFE is minified with `process.env.NODE_ENV = "production"` → DCE strips diagnostic code. The lazy `autoblock-loader` chunk appears as `dist/autoblock-loader-*.js` (dynamic import split). Any new lazy transport chunk would follow the same pattern. `.size-limit.json` currently measures four gates: IIFE auto-block-ON (20 kB), bootstrap (1 kB), ESM-OFF (13 kB), ESM-ON (20 kB). A new chunk for transport-only code would be measured as part of the ESM-ON gate.

---

## Gotchas

- **Benign stub response semantics**: A held `fetch` must return a `Promise<Response>` that resolves (not rejects) to avoid crashing app code that `await`s it. Using `new Response(null, { status: 200 })` is safe, but callers that check `response.ok` or parse JSON will see a 200 empty body — this may cause silent data loss in analytics code (which is the intent, but should be documented). The stub must be created with the native `Response` before any override of it.
- **`sendBeacon` called after page unload**: `sendBeacon` is often called in `visibilitychange`/`pagehide` handlers — if consent is never granted in the session, the queued beacon is lost on navigation. This matches the `<img>` pixel posture (documented in v5/v6) and is the correct fail-closed behaviour, but the queue must not attempt to send after the page is gone.
- **Phase 1 over-capture for `fetch`**: Unlike `<img>` (which only hits tracking endpoints), `fetch` is used for all app API calls. Staging ALL fetch calls in Phase 1 (before the matcher resolves) would hold first-party API responses hostage for the ~few milliseconds the DB chunk takes to load. The correct Phase 1 behaviour is: immediately classify using the matcher if available (Phase 2), or pass through without staging (Phase 1 for non-matched). But since the matcher is not yet available in Phase 1, a safe heuristic is to only stage fetches whose URL contains known tracking host keywords (a fast string check) or, simpler, to make Phase 1 a pure pass-through for fetch/beacon and only intercept once the matcher is available (Phase 2 only). This is architecturally distinct from the DOM shim where all createElement calls are trivially cheap to stage.
- **`autoblock-proxy.ts` is statically imported — every added byte costs ESM-OFF**: the `_origFetch` / `_origSendBeacon` variable declarations and the wrapping closures are unavoidable statics. Keep them minimal; push replay/queuing logic into the lazy chunk if the budget demands it.
- **`fetch` URL can be a `Request` object**: `window.fetch(url | Request, init?)` — the first argument may be a `Request` instance, not a string. `matchAutoBlock()` expects a string; the shim must extract `.url` from a `Request` before passing to the matcher.

---

## Recommendations (priority order)

1. **Add `window.fetch` and `navigator.sendBeacon` save-and-replace to `installAutoBlockProxy()`** in `autoblock-proxy.ts`, following the exact pattern of `_origCreateElement`/`_origImage`. Add `_origFetch` and `_origSendBeacon` module-level variables; restore them in `_resetAutoBlockProxy()`. This is the non-negotiable synchronous install seam.
2. **Adopt Phase 2-only interception for transport** (pass through in Phase 1, classify inline in Phase 2 once matcher is set). This avoids the first-party API over-capture problem and is simpler than a Phase 1 staging queue for fetch/beacon. The matcher resolves in sub-milliseconds (same-origin chunk), making the pre-matcher window negligible for non-DOM transports.
3. **Store held fetches as `{url, init, resolve, reject, category}[]` and queued beacons as `{url, data, category}[]`** in `autoblock-proxy.ts` (parallel to `_held`). Export `getHeldFetches()` and `getQueuedBeacons()` for consumption by `api.ts:_enqueueHeldElements()` (or a new `_enqueueHeldTransport()` parallel function).
4. **Wire transport release through `blocking.ts:grant()`** — add a transport-drain callback registered by `api.ts` (same IoC pattern as `_registerUI`/`_registerGpcUI`) so `grant()` can fire held fetch replays and queued beacons for the granted category without `blocking.ts` knowing about the transport internals.
5. **Address the ESM-OFF budget before landing transport code** — measure `autoblock-proxy.ts` size delta after the fetch/beacon wrapping additions; if it breaches the 400 byte headroom, move the transport queuing state/logic into a new `autoblock-transport.ts` lazily loaded alongside `autoblock-loader.ts` in the `config.autoBlock` conditional import block.
6. **Extract `fetch` URL from `Request` objects** at the shim entry point before calling `matchAutoBlock()` — a one-liner `typeof url === 'string' ? url : url.url` guard prevents a runtime type error on sites that construct `Request` objects explicitly.

---

## Open questions for the user

1. **Phase 1 fetch pass-through vs staging**: Is a small window where pre-consent tracking fetches could escape (the few milliseconds between `init()` and the DB chunk resolving) acceptable, given that (a) the curated DB only covers ~44 services and (b) the practical alternative is holding all app API calls hostage? Or should Phase 1 stage ALL `fetch`/`sendBeacon` calls (accepting the latency risk)?
2. **Benign stub `Response` contract**: Is `new Response(null, { status: 200 })` the right stub, or should it be `new Response(null, { status: 204 })`? Should the stub carry a header (e.g. `X-Cookyay-Blocked: true`) for debuggability? Does the stub need to match the `Content-Type` the caller might inspect?
3. **Session-end beacon loss**: When a matched `sendBeacon` is queued and the user navigates away before granting consent, the beacon is silently dropped. Is this acceptable (consistent with `<img>` pixel posture), or should v7 document this explicitly in the honest-parity section?
4. **`fetch` called with a `Request` object**: Some tracker SDKs construct `new Request(url, options)` before passing to `fetch`. The shim extracts `.url` — is this sufficient, or does v7 need to also handle the case where the `Request` carries a body that must be preserved on replay?

---

## Out of scope

- `XMLHttpRequest` interception — explicitly deferred per goals.md §What's deferred to later versions.
- `document.write` — deferred.
- Auto-block on by default — remains opt-in; no default flip in v7.
- Changing the declared-wins precedence logic for DOM elements or the `scanBlocked` registration path.
- Google tag handling — unchanged; CM v2 handles GA4/GTM; skip-Google guard is intrinsic to the matcher index.
- Any non-auto-block product capability (consent analytics, i18n, hosted config).

## Update — 2026-06-12 — User decisions

The cross-cutting open questions were resolved by the user (see [_index.md §Update](_index.md)):
- **fetch stub** → `204 No Content`, empty body (not configurable in v7); hybrid stub+queue retained.
- **Install timing** → Phase 2 lazy `autoblock-loader` chunk; the small pre-chunk-load escape window is an accepted, documented bootstrap-first limit.
- **sendBeacon at unload** → dropped pre-consent (no sessionStorage persistence); documented in README limits.

Carried as implementation constraints: clone Request body / forward beacon `data` at intercept time; add a negative test that XHR is NOT intercepted; fold the v6 diagnostic into the lazy chunk for budget reclamation. No PRD amendment required.
