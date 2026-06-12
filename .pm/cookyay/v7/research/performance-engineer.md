# performance-engineer — Research findings

## Summary

- The fetch/sendBeacon hot path introduces a URL-normalization cost (string → `new URL()`) on every call; the existing matcher's Map-based host index (93 hosts across 44 non-Google services) makes the non-matching case ~2–5 Map lookups, but the `new URL()` call cannot be avoided for the non-string input cases (Request objects, URL objects) and is the dominant per-call cost for the common pass-through path.
- The ESM-OFF bundle currently sits at **12.31 kB gzip** against a 13 kB limit (702 bytes headroom — slightly more than the ~0.4 kB the v6 QE flag implied), but `autoblock-proxy.ts` is statically imported and contributes ~1.55 kB gzip; the diagnostic adds another ~0.59 kB — neither is DCE'd from the OFF bundle today.
- The fetch/sendBeacon wrapper code must be installed synchronously like the existing DOM proxy shim, but if it lands in `autoblock-proxy.ts` it increases the always-present proxy cost; the reclamation strategy must split the transport-wrapper bytes into the lazy `autoblock-loader` chunk or a new peer chunk that only loads when `autoBlock:true`.
- No N+1 or large-data risks exist in the matcher itself; the primary allocation pressure in the transport hot path comes from unnecessary `Request.clone()` for non-matching calls — cloning must be deferred until after the URL has been checked.

---

## Findings

**1. URL normalization cost per fetch/sendBeacon call** [goals.md §What ships in v7]

`fetch(input, init)` accepts three input shapes: a plain string, a `URL` object, or a `Request` object. The hot path for non-matching calls (the vast majority of page fetches) must resolve a URL string before calling `matchAutoBlock`. Cost profile:

- **String input**: cheapest — a `new URL(str, location.href)` call is required only when `str` does not start with `http://`/`https://` (relative URL → always first-party → return `null` immediately). Absolute strings skip the `URL` construction cost entirely via `_extractHost`'s existing `!startsWith('http')` early-out. (`autoblock-matcher.ts` line 183–186)
- **URL input**: `.href` property read → zero allocation, no parsing.
- **Request input**: `.url` property read → no allocation (the URL is already resolved on construction).

For the wrapper, the cheapest universal extraction is: `typeof input === 'string' ? input : input instanceof URL ? input.href : input.url`. This avoids constructing any `URL` object for the most common case (plain string absolute URL) while handling all three shapes in O(1). (`autoblock-matcher.ts:_extractHost` already handles relative short-circuit.)

**2. Matcher lookup cost — host index is O(~5 Map.get calls), path scan is linear over 8 entries** [goals.md §What ships in v7, prd.md §3.1]

`autoblock-matcher.ts:matchAutoBlock` builds a module-level `Map<string, IndexedEntry[]>` at load time. At call time it builds a host-candidate array (exact match, then progressively strip leading labels: `static.hotjar.com` → `hotjar.com`) and calls `hostIndex.get()` for each candidate. For a three-label hostname like `api.segment.io` this is 3 Map.get calls; for a two-label host it is 2. The Map holds 93 non-Google host strings (counted from `db-autoblock.generated.ts`: 44 non-Google services × average ~2.1 hosts). For a first-party URL (`api.myapp.com`) that shares no labels with any tracked host, all Map.get calls miss and the path falls through.

The `pathEntries` linear scan (line 283, `autoblock-matcher.ts`) runs only when all host lookups miss. With 8 non-Google `requestPaths` entries this is negligible — 8 iterations at most, each a `_hostMatches` + `String.prototype.startsWith` pair. No regex, no trie needed.

**Early-out opportunity (not yet exploited):** for the transport wrapper's non-matching path, the wrapper can short-circuit before calling `matchAutoBlock` when `_matcher` is null (Phase 1, matcher not yet loaded). During Phase 1, every fetch should be staged; the `new URL` cost is still paid only at the hostCandidate-building step inside `matchAutoBlock`, which is not called until Phase 2.

**3. Allocation pressure — Request.clone() must be deferred past the URL check** [goals.md §What ships in v7]

The runtime-interception domain expert (`research/runtime-interception-domain-expert.md §Findings 2`) notes that `Request` body is a single-read `ReadableStream` and must be `clone()`d before staging. The performance implication: `clone()` should happen only after `matchAutoBlock(url)` returns non-null. For the dominant case (non-matching pass-through), zero cloning occurs. Cloning a sub-1 kB beacon body is cheap (<1 µs); the risk is cloning large multipart uploads for non-tracking fetches if the URL check runs *after* the clone. Implementation constraint: extract the URL, call the matcher, clone only on match.

**4. ESM-OFF bundle budget — autoblock-proxy.ts is always present (702 bytes headroom, ~1.55 kB at risk)** [goals.md §Bundle-budget reclamation, prd.md §3.1]

Measured from the current dist (built 2026-06-11):

| Artifact | Gzip size | Limit | Headroom |
|---|---|---|---|
| ESM OFF (`index.js`) | 12.31 kB | 13 kB | 702 bytes |
| IIFE + bootstrap combined | 11.98 kB | 20 kB | 8.02 kB |
| ESM ON (`index.js` + `autoblock-loader-*.js`) | 14.67 kB | 20 kB | 5.33 kB |

The `autoblock-proxy.ts` section in `index.js` is 6,473 bytes raw, ~1.55 kB gzip (measured by isolated gzip on the section). It is statically imported by `api.ts` (line 14–19) for synchronous Phase 1 install. The `autoblock-diagnostic.ts` section adds 1,222 bytes raw, ~0.59 kB gzip; it is not DCE'd in the ESM build because `tsup.config.ts` defines `process.env.NODE_ENV = '"development"'` (line 16), making `if (process.env.NODE_ENV === 'production') return` evaluate to `if (false) return` — the guard is folded but the function body remains (`dist/index.js` line 592–641 confirmed).

If the v7 fetch/sendBeacon wrappers land in `autoblock-proxy.ts`, they will expand the ~1.55 kB always-present proxy cost. A conservative estimate for the new transport proxy section (fetch wrapper + sendBeacon wrapper + held-call queue + replay logic) is 200–350 lines of compiled JS → ~3–5 kB raw → ~1–1.5 kB gzip. At 702 bytes headroom this would breach the ESM-OFF limit without reclamation.

**5. The diagnostic is not DCE'd from ESM-OFF — a straightforward reclamation** [goals.md §Bundle-budget reclamation, prd.md §3.1]

The `runBootstrapDiagnostic` function and `_formatDiagnosticWarning` helper survive in `index.js` because `tsup.config.ts:define` sets `NODE_ENV = "development"` for ESM (deliberately, to avoid `process` being undefined at runtime in bundler environments). The `if (false) return` guard at line 592 does not cause esbuild to DCE the function body — esbuild only drops unreachable code when it is within the dead branch; a dead return at function entry does not eliminate the function itself unless the function is also provably uncalled. Since `api.ts` calls `runBootstrapDiagnostic(matcher)` at line 743 inside the `config.debug` branch (not dead-code-eliminated in the ESM build), the function and its helper remain bundled. The ~0.59 kB gzip contribution is real and reclaim-able.

Reclamation path: move the diagnostic guard from inside `runBootstrapDiagnostic` to the call site in `api.ts` and make the call conditional on `process.env.NODE_ENV !== 'production'` *and* `config.autoBlock` (it is only callable in the autoBlock path today). This does not reduce the ESM-OFF bytes because the diagnostic is already only invoked when `config.autoBlock` is true — but it ensures the function body itself can be DCE'd if `api.ts` never calls it in tree-shake analysis. Better: if the diagnostic module is moved to a dynamic `import()` (lazy chunk alongside `autoblock-loader`), it lands in the ON-only chunk at zero cost to the OFF bundle. This reclaims ~0.59 kB gzip from the OFF bundle.

**6. Where to put the fetch/sendBeacon wrappers to satisfy the tree-shake contract** [goals.md §Auto-block is opt-in, prd.md §3.1]

The v7 wrappers must be synchronously installed in Phase 1 (same tick as `installAutoBlockProxy()`). Two implementation paths:

- **Option A — extend `autoblock-proxy.ts`**: Add `installFetchProxy()` and `installBeaconProxy()` to the existing statically-imported module. Simple but adds ~1–1.5 kB gzip to the OFF bundle permanently.
- **Option B — new `autoblock-transport.ts` lazily imported in `api.ts`**: A new file containing only the fetch/sendBeacon shim (no DOM proxy code). `api.ts` imports it via a conditional `import()` when `autoBlock:true`. BUT: the transport proxy must be installed synchronously — dynamic import is async. This creates the same Phase 1 / Phase 2 gap that the existing proxy design already solves for DOM elements. The transport wrapper would need to be installed in Phase 2 (after the `import()` resolves), which means any tracker that calls `fetch()` between `init()` and the lazy chunk load is not intercepted.

This is a hard architectural tension. Option B delays transport interception by the chunk-load microtask (~1 frame) — unacceptable for bootstrap-first. Option A keeps synchronous install but pays the bundle cost.

**Resolution path**: split the module at the function level. `autoblock-proxy.ts` retains only the synchronous DOM shim stubs (the `_staged` queue logic, `_matcher` slot, `_held` queue) — which are already in the bundle. A new synchronous function `installTransportProxy(staged)` can be added to `autoblock-proxy.ts` with a **stub body** (a few lines that only set up the `window.fetch`/`sendBeacon` overrides pointing at the existing `_matcher`/`_staged` infrastructure already in the module). The actual queue-drain/replay logic lives in `autoblock-loader.ts` / the lazy chunk. This keeps new bytes in the OFF bundle to under 50–80 lines (~0.3 kB gzip estimated) — within the 702-byte headroom.

---

## Gotchas

- **Phase 1 transport stubs must call through to `_origFetch`/`_origSendBeacon` immediately for non-matching calls** — any `new URL()` call in the stub must be skipped for relative URLs and for the case where `_matcher` is null (early-out: stage everything, let Phase 2 drain). Over-eagerly parsing every URL in Phase 1 adds latency before the matcher is ready.
- **`_createMatcher` duplication**: `autoblock-matcher.ts` lines 302–354 duplicate the full `matchAutoBlock` logic for test isolation. If the transport wrapper also duplicates host-extraction logic, it creates a third copy. A shared `_extractUrl(input)` helper in `autoblock-proxy.ts` prevents drift.
- **ESM-OFF diagnostic bytes are NOT from `process.env` DCE failure** — they are from the call site in `api.ts` being live (inside the `autoBlock` branch which bundlers do not statically DCE because `config.autoBlock` is a runtime value). This is a genuine limitation of runtime-conditional tree-shaking; only dynamic `import()` can enforce it.
- **The 702-byte headroom is fragile**: any unguarded addition to `api.ts`, `banner.ts`, or `blocking.ts` will consume it. The reclamation work item should produce ≥1 kB headroom, not just clear the current deficit.

---

## Recommendations

*(Priority-ordered)*

1. **(P0) Split transport wrappers into a minimal synchronous stub in `autoblock-proxy.ts`** — the stub overrides `window.fetch` and `navigator.sendBeacon` with shims that (a) stage calls during Phase 1, (b) inline-classify in Phase 2. Keep the stub to ≤80 lines. All replay/drain logic lives in `autoblock-loader.ts` (already in the lazy chunk). This is the only architecture that satisfies both synchronous install and tree-shake-to-zero for OFF builds.

2. **(P0) Extract the URL from fetch input before any other work** — use `typeof input === 'string' ? input : input instanceof URL ? input.href : input.url` to get the URL string with zero allocation for all three shapes. Pass it to `matchAutoBlock`. Only `clone()` the Request after a match is confirmed.

3. **(P1) Move the bootstrap diagnostic to a lazy `import()`** alongside `autoblock-loader.ts` — this reclaims ~0.59 kB gzip from the ESM-OFF bundle and makes the call site in `api.ts` DCE-free for OFF builds. It also resolves the current `if (false) return` dead-code-but-not-DCE'd anomaly in `dist/index.js`.

4. **(P1) Add a `_extractUrl(input)` helper to `autoblock-proxy.ts`** shared between the DOM path (where it exists inline today) and the new transport path — avoids a third copy of the host-extraction logic and makes the fetch/sendBeacon hot path consistent with the existing `_extractHost` in `autoblock-matcher.ts`.

5. **(P2) Raise the ESM-OFF size-limit to 13.5 kB temporarily** during v7 implementation, then tighten to 12.8 kB once reclamation is verified — prevents false positives while work-in-progress branches are being reviewed. Update `.size-limit.json` comment from "~12.6 kB v6" to reflect the measured 12.31 kB baseline.

6. **(P2) Add an early-out in the transport wrapper for Phase 1** (before `_matcher` is set): stage immediately without calling `matchAutoBlock` — avoids any Map.get cost during the bootstrap window when the matcher is not yet loaded.

---

## Open questions for the user

1. **Stub response shape**: The domain expert recommends a hybrid stub (`new Response(null, { status: 204 })` + replay on grant). Is a 204 safe for all known integrations that read the response body (e.g., Meta CAPI responses checked for acknowledgement)? Should the stub's status code be configurable?
2. **Transport wrapper placement**: Confirm that adding ~80 lines to `autoblock-proxy.ts` (the synchronous transport stubs) is acceptable, given that the module is statically imported in OFF builds. The ~0.3 kB gzip estimate for the stub is within current headroom after diagnostic reclamation, but a code review should verify the actual line count before the task is sized.
3. **Diagnostic lazy-load timing**: Moving the diagnostic to a dynamic `import()` means it would load in the same `.then()` callback as `autoblock-loader.ts`. Any objection to bundling both into one lazy `import('./autoblock-loader.js')` that re-exports the diagnostic runner?

---

## Out of scope

- `XMLHttpRequest` interception — explicitly deferred to a later version per [goals.md §What's deferred to later versions].
- `document.write` interception — out of v7 per [goals.md §What's deferred to later versions].
- Persistent beacon queue (cross-session hold for unload beacons) — architecturally out of scope per domain expert finding §4.
- Profiling or microbenchmarking the Map lookup vs alternative data structures — the 44-service / 93-host set is too small for any hash-map alternative to be meaningfully faster; no benchmark is needed.
- Changing the IIFE bundle architecture or the bootstrap bundle — both have ample headroom (8 kB and 507 bytes respectively) and no v7 risk.

## Update — 2026-06-12 — User decisions

The cross-cutting open questions were resolved by the user (see [_index.md §Update](_index.md)):
- **fetch stub** → `204 No Content`, empty body (not configurable in v7); hybrid stub+queue retained.
- **Install timing** → Phase 2 lazy `autoblock-loader` chunk; the small pre-chunk-load escape window is an accepted, documented bootstrap-first limit.
- **sendBeacon at unload** → dropped pre-consent (no sessionStorage persistence); documented in README limits.

Carried as implementation constraints: clone Request body / forward beacon `data` at intercept time; add a negative test that XHR is NOT intercepted; fold the v6 diagnostic into the lazy chunk for budget reclamation. No PRD amendment required.
