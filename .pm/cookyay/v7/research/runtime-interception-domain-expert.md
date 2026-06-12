# runtime-interception-domain-expert — Research findings

## Summary

- GA4 (`/g/collect`) and Meta Pixel (`/tr`) now beacon primarily via `navigator.sendBeacon` with a `fetch`+`keepalive` fallback, meaning host-based matching alone is insufficient — the `requestPaths` index (already present in `autoblock-matcher.ts`) is the correct signal, and the skip-Google rule eliminates GA4's transport calls without any special casing.
- A held `fetch` that returns a benign stub Response (HTTP 204, empty body) is the correct default: it prevents promise hangs, survives `await resp.json()` callers (they get a parse error, not a hang — controllable), and avoids the unreplayable-at-unload class of bugs that hold-and-replay creates for `keepalive` requests.
- `sendBeacon` during `pagehide`/`visibilitychange` cannot be deferred: if the user never granted consent in this page session the beacon is simply dropped — this is the legally correct outcome and must be documented clearly, not patched around.
- Bootstrap-first is as intrinsic to transport interception as it is to DOM interception; the v6 diagnostic extension point is the natural home for a "fetch/sendBeacon patched after third-party ran" warning.

---

## Findings

**1. How trackers actually beacon — and what v7 can and can't intercept** [goals.md §What ships in v7]

GA4 sends its measurement hit (`/g/collect`) as `navigator.sendBeacon("https://region1.google-analytics.com/g/collect", body)` on each event, with a `fetch(..., { keepalive: true })` fallback when `sendBeacon` is unavailable or the payload exceeds the 64 KB limit. The URL always contains the `/g/collect` path; the hostname varies (`analytics.google.com`, `region1.google-analytics.com`, `region1.analytics.google.com`). Because the skip-Google rule filters every `*.google.com` and `*.googleapis.com` host at index-build time (existing `autoblock-matcher.ts` line 91 `if (entry.google) continue`), GA4 traffic passes through to Consent Mode v2 on both transports without any transport-specific code.

Meta Pixel (`facebook.com/tr`) now preferentially uses `fetch` with `keepalive: true` (replacing the legacy `<img>` pixel), plus `sendBeacon` as a secondary transport during page unload. TikTok, Snapchat, LinkedIn Insight, and Pinterest similarly use `sendBeacon`+`fetch` for their event endpoints — the same hosts/paths already in the curated DB's `requestPaths`. The transport-layer interceptor therefore needs URL-matching logic that is structurally identical to the existing `matchAutoBlock(url)` call — the same matcher is reusable.

Implication: v7 cannot catch transport calls that fire before the proxy is installed (the same hard limit as DOM interception). Trackers loaded via `<script async>` that call `sendBeacon` in their own `load` callback have a narrow but real window to fire before Cookyay's wrapper replaces `navigator.sendBeacon`.

**2. `fetch` input normalization and the stream-consumption trap** [goals.md §What ships in v7]

`fetch(input, init)` where `input` is one of:
- A plain string — common; use `new URL(input, location.href).href` to resolve relative URLs before matching.
- A `URL` object — call `.href` directly.
- A `Request` object — the URL is at `request.url` (always absolute). **Critical**: the `Request` body is a `ReadableStream` that can only be consumed once. If the proxy reads `.body` or calls `.text()` for logging/inspection, the original request becomes inert. For replay, the proxy must call `request.clone()` before storing the held call — `clone()` branches the stream so both the stored copy and the eventual replay copy are readable. Cloning is cheap for beacon payloads (typically <1 KB) but must be done at intercept time, not at grant time (the stream may already be GC'd by then).

Method and headers for matching: trackers use `POST` for `sendBeacon`-style fetch calls; the URL alone is sufficient for host+path matching (method filtering is not needed at match time — the matcher only needs the URL). Keeping the interceptor URL-only avoids reading `init.body` or `Request.body` during the intercept hot path.

**3. Hold-and-replay vs benign-stub for `fetch`** [goals.md §What ships in v7, §Acceptance bar]

Three options:

- **(a) Hold-and-replay**: Store the `fetch` arguments; resolve the caller's `Promise<Response>` only after grant by performing the real fetch. Breakage modes: (1) app code with a timeout (e.g., 5 s abort signal) will see a rejection mid-session; (2) `keepalive: true` requests during `pagehide` cannot be replayed — the page is unloading, `fetch` will throw or silently fail after the document is destroyed; (3) if the user never grants consent, the held Promise never resolves — a memory leak and a potential hang for any `await` in the calling code.

- **(b) Benign-stub (immediate resolution, never replay)**: Resolve immediately with `new Response(null, { status: 204 })`. Callers that inspect the status code get a 204; callers that call `.json()` get a `SyntaxError` (empty body is not valid JSON) — this is a throw, not a hang. Callers that only fire-and-forget (the tracking pattern) are unaffected. The real tracking call is never made pre-consent and never replayed.

- **(c) Hybrid**: Resolve the caller's Promise with the benign stub AND additionally queue the actual call for replay on grant (decoupled from the caller's Promise). The caller gets an immediate non-hanging response; on grant the real request is sent as a best-effort side-effect. This is the correct semantic for analytics beacons: the page-load event data is still sent on grant, just slightly late.

**Recommendation**: Hybrid (c) is the best default. Stub the caller immediately (prevents hangs/timeouts), queue a clone of the original request for replay on grant. For `keepalive` requests captured during page unload, do NOT queue for replay — the page session is ending and there is no meaningful "on grant" context; drop silently and emit a `[Cookyay debug]` log if debug is enabled.

**4. `sendBeacon` semantics and the unload-drop guarantee** [goals.md §What ships in v7]

`navigator.sendBeacon(url, data)` returns a synchronous boolean: `true` means the UA accepted the payload for queuing, `false` means it was rejected (e.g., payload >64 KB). The proxy must return `true` for matched pre-consent beacons (to avoid breaking the caller's retry logic) while suppressing the actual send.

Beacons fired during `pagehide` or `visibilitychange` (the dominant pattern for GA4 session-end and Meta Pixel cart-abandon events): if the user has not yet granted consent, the beacon must be dropped. There is no "next page" to replay to — the current browsing context is being destroyed. Queueing for replay in `localStorage` and sending on a future page load is a tempting workaround but it is architecturally out of scope (requires persistent queue, cross-session consent checks) and semantically wrong (the event metadata is stale). The honest behavior: pre-consent unload beacons are dropped, and this is the legally correct outcome — no tracking data without consent. Document this explicitly in the README and comparison page (same pattern as v6's honest-limits section in `RELEASE.md`).

For beacons fired during normal page interaction (not unload), the same hybrid strategy as fetch applies: return `true`, queue the payload, send on grant within the same page session.

**5. Skip-Google and declared-wins across the transport layer** [goals.md §What ships in v7, prd.md §3.4]

The existing `matchAutoBlock` index excludes Google-owned services at build time (`entry.google` flag). Since `fetch`/`sendBeacon` interceptors call the same matcher function with the extracted URL, skip-Google is free — no additional logic needed. GA4's `region1.google-analytics.com/g/collect` hits the Google-skip path and returns `null`, passing through to Consent Mode v2 unchanged.

Declared-wins: the transport interceptors have no DOM element to check for `data-cookyay-state`. The declared-wins concept does not directly apply to fetch/sendBeacon (there is no declarative markup for network calls). The correct posture: transport interception is auto-block only; declared rules (in `blocking.ts`) operate on DOM elements as before and are orthogonal. No conflict possible.

**6. Bootstrap-first dependency** [goals.md §Context from prior version, architecture.md §3]

`window.fetch` and `navigator.sendBeacon` must be wrapped synchronously in the same microtask as `init({ autoBlock: true })` — the same Phase 1 contract as `document.createElement`. The two-phase proxy pattern (Phase 1: install a trapping shim that stages all matched calls; Phase 2: activateMatcher drains the staged queue and upgrades to inline classification) extends naturally. A tracker loaded via `<script async>` has a window to call the original `fetch` if it executes before Cookyay's wrapper replaces `window.fetch`. The v6 bootstrap-first diagnostic in `autoblock-diagnostic.ts` can be extended: if a known tracker's `sendBeacon`/`fetch` call is observed but the wrapper is not yet installed (i.e., the original function reference is still on the stack), emit the debug-gated warning.

---

## Gotchas

- **Request body stream single-read**: Failing to `clone()` a `Request` object before storing it for replay silently corrupts the eventual replay call — the body will be empty. Must clone at intercept time.
- **`keepalive` + unload = unreplayable**: `keepalive` fetches caught during `pagehide` cannot be held for replay; they must be dropped with a debug log, not queued.
- **Circular re-interception**: The replay path calls the original (saved) `fetch`, not `window.fetch`. If the proxy naively calls `window.fetch` at grant time it re-enters itself. Store and call through to `_origFetch` (same pattern as `_origCreateElement` in `autoblock-proxy.ts`).
- **AbortSignal on held fetches**: Callers may pass an `AbortController` signal. If the signal fires before grant, the held call should be discarded (not replayed). The proxy must observe `signal.addEventListener('abort', ...)` on staged calls.
- **`sendBeacon` payload types**: `sendBeacon(url, data)` where `data` can be `Blob`, `FormData`, `URLSearchParams`, or `string`. All are serializable and safe to queue; `Blob` with a MIME type should be preserved as-is for replay.
- **Prototype chain replacement**: `navigator.sendBeacon` is a method on the `Navigator` prototype; wrapping it requires `navigator.sendBeacon = wrappedFn` (instance property shadow), NOT `Navigator.prototype.sendBeacon` — some environments freeze the prototype.

---

## Recommendations

1. **(P0) Use the hybrid stub+queue strategy for `fetch`**: resolve the caller's Promise immediately with `new Response(null, { status: 204 })`, queue a `request.clone()` for replay on grant. Drop `keepalive` requests caught during unload (no replay).
2. **(P0) Always clone `Request` objects at intercept time** before staging them — never at grant time.
3. **(P0) Call through to `_origFetch` / `_origSendBeacon` at replay time**, never through `window.fetch` / `navigator.sendBeacon`, to prevent circular re-interception.
4. **(P1) Return `true` from the `sendBeacon` wrapper for all matched pre-consent calls** (queued or dropped at unload) to avoid caller retry storms.
5. **(P1) Extend the v6 bootstrap-first diagnostic** (`autoblock-diagnostic.ts`) to warn when a transport-layer tracker call is observed before the wrapper is installed — same debug-gate, same DCE strip.
6. **(P2) Document the unload-drop guarantee honestly** in README and the comparison page: pre-consent `sendBeacon` calls at page unload are dropped, not deferred — this is the legally correct behavior.
7. **(P2) Observe `AbortSignal` on staged fetch calls** and discard on abort — prevents zombie entries in the held queue.

---

## Open questions for the user

1. **Stub response shape for app code**: Is `204 / empty body` the right stub, or should it be `200 / {}` to avoid `SyntaxError` in callers that unconditionally call `.json()`? (A `200 / {}` stub is slightly more defensive but misrepresents HTTP semantics.)
2. **Replay fidelity vs. staleness**: Should queued fetch replays carry the original `Date`/timestamp headers, or is best-effort post-grant delivery (potentially seconds later) acceptable for all curated tracking endpoints?
3. **XHR fast-follow**: v7 defers XHR. Is there a concrete tracker that uses XHR and is currently in the curated DB, meaning v7 still leaves a known gap?
4. **Cross-session `sendBeacon` queue** (explicitly deferred above): Is there any appetite to persist pre-consent unload beacons to `sessionStorage` and replay them on the next page load, or is drop-on-unload the final answer?

---

## Out of scope

- `XMLHttpRequest` interception — deferred per goals.md §What's deferred to later versions.
- `document.write` injection path — deferred per goals.md.
- Auto-block on by default — product decision, not in v7.
- Persistent cross-session beacon queue (localStorage/sessionStorage replay).
- Custom `requestPaths` rules supplied by site owners at runtime (config-driven matcher extension).
- IAB TCF consent signal integration with transport-layer blocking.

## Update — 2026-06-12 — User decisions

The cross-cutting open questions were resolved by the user (see [_index.md §Update](_index.md)):
- **fetch stub** → `204 No Content`, empty body (not configurable in v7); hybrid stub+queue retained.
- **Install timing** → Phase 2 lazy `autoblock-loader` chunk; the small pre-chunk-load escape window is an accepted, documented bootstrap-first limit.
- **sendBeacon at unload** → dropped pre-consent (no sessionStorage persistence); documented in README limits.

Carried as implementation constraints: clone Request body / forward beacon `data` at intercept time; add a negative test that XHR is NOT intercepted; fold the v6 diagnostic into the lazy chunk for budget reclamation. No PRD amendment required.
