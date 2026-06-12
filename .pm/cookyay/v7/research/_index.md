# Research index — cookyay v7

Generated: 2026-06-12

v7 scope: extend runtime auto-block from the DOM (v5–v6: script/iframe/`<img>`)
to the **transport layer** — wrap `window.fetch` and `navigator.sendBeacon`,
hold matched curated-endpoint tracking calls until consent, replay/send on
grant, with a benign pre-consent stub for `fetch`. Plus a bundle-budget
reclamation work item. Acceptance: hermetic e2e proof per transport.

## Personas run
- [existing-codebase-archaeologist](existing-codebase-archaeologist.md) — the only valid install point is the synchronous body of `installAutoBlockProxy()` (`autoblock-proxy.ts`); the matcher `matchAutoBlock(url: string)` already takes a bare URL + handles `requestPaths`, so no matcher change is needed; transport calls have no DOM element, so v7 needs module-level `_heldFetches`/`_queuedBeacons` stores drained through `grant()`.
- [runtime-interception-domain-expert](runtime-interception-domain-expert.md) — recommends a **hybrid stub+queue for `fetch`** (resolve caller immediately with a benign stub; separately queue a `Request.clone()` and replay via the saved `_origFetch`); clone the one-read `Request` body at intercept time, not grant time; `sendBeacon` returns `true` synchronously and queues for same-session replay but **drops at `pagehide`/`unload`**; skip-Google comes free from the matcher's index-build exclusion.
- [performance-engineer](performance-engineer.md) — non-matching hot path stays cheap (zero-alloc URL extraction before the `Map.get`; `Request.clone()` ONLY after a confirmed match); ESM-OFF currently ~12.31 kB gzip (~702 B headroom); reclaim ≥1 kB by moving replay/drain logic and the v6 diagnostic into the lazy `autoblock-loader` chunk (the diagnostic's `if(false)` guard does NOT currently DCE because it's still called from a live path in `api.ts`).
- [test-strategist](test-strategist.md) — `page.route()` hit-counters (v6's `pixel-block.spec.ts` pattern) are the cleanest hermetic network proof; three-tier split (jsdom URL-normalization/queue/stub → browser-mode real wrapping/timing → Playwright negative+positive network proof); replace `waitForTimeout` with `waitForRequest`/`waitForResponse` to kill the `setTimeout(fn,0)` grant-path flake; four load-bearing negative tests (app fetch untouched, stub doesn't throw/hang, skip-Google passthrough, declared-wins no double-queue).

## Cross-cutting open questions
Deduplicated across reports; each links to its sources.

1. **Benign `fetch` stub shape** — 204/empty vs 200/`{}` vs higher-fidelity (`clone()`/`body` stream), and whether it should carry a debug header or be configurable. Trade-off: defensiveness/compat vs bundle weight and honest HTTP semantics. *(all four reports — [archaeologist Q2](existing-codebase-archaeologist.md), [domain-expert Q1](runtime-interception-domain-expert.md), [performance Q1](performance-engineer.md), [test-strategist Q1](test-strategist.md))*
2. **Transport install timing — Phase 1 (synchronous) vs Phase 2 (lazy)** — installing in the sync bootstrap closes the gap but means staging first-party calls until the DB chunk loads; installing in the lazy chunk keeps the hot path clean but opens a few-ms window where async tracking could escape. Architectural; drives the acceptance/test shape. *([archaeologist Q1](existing-codebase-archaeologist.md), [performance recs](performance-engineer.md), [test-strategist Q3](test-strategist.md))*
3. **`sendBeacon` at page unload** — drop pre-consent beacons (simple, legally correct: no consent = no send) vs persist to `sessionStorage` and replay on next load (more coverage, more complexity + a fresh consent-timing question). Goals currently lean drop. *([archaeologist Q3](existing-codebase-archaeologist.md), [domain-expert Q4](runtime-interception-domain-expert.md), [test-strategist Q2](test-strategist.md))*
4. **`Request`/beacon payload replay fidelity** — clone the `Request` body (one-read stream) and forward the `sendBeacon` `data` (string/Blob/FormData/…) byte-for-byte at intercept time so replays aren't corrupted/stale. Largely an implementation correctness constraint, not a scope fork. *([archaeologist Q4](existing-codebase-archaeologist.md), [domain-expert Q2](runtime-interception-domain-expert.md), [test-strategist Q2](test-strategist.md))*
5. **XHR known-gap check** — v7 defers `XMLHttpRequest`; confirm no curated-DB tracker relies solely on XHR (leaving a silent gap), and add a negative test asserting XHR is NOT intercepted (no over-reach). *([domain-expert Q3](runtime-interception-domain-expert.md), [test-strategist Q4](test-strategist.md))*
6. **Diagnostic lazy-load reclamation** — fold the v6 diagnostic into the same lazy `import('./autoblock-loader.js')` to reclaim ~0.59 kB from the OFF bundle. Implementation detail for the budget work item. *([performance Q3](performance-engineer.md))*

## Recommended next step
Three of these (Q1 stub shape, Q2 install timing, Q3 sendBeacon-unload) materially
shape the plan and acceptance bar — resolve them before planning. Q4–Q6 are
implementation constraints that `/pm:architect` or `/pm:plan` can carry directly.
Resolve the top three, then `/pm:plan cookyay` (optionally `/pm:architect cookyay`
first to amend the inherited architecture with the transport-interception design).

## Update — 2026-06-12 — Top three resolved by user

1. **Benign `fetch` stub (Q1)** → **`204 No Content`, empty body.** Honest HTTP
   semantics for a request never sent; cheapest on bundle. Not configurable in v7.
   The hybrid stays: resolve the caller immediately with the 204 stub AND queue a
   `Request.clone()` for replay-on-grant via the saved `_origFetch`.
2. **Install timing (Q2)** → **Phase 2 lazy chunk.** The `fetch`/`sendBeacon`
   wrappers live in the lazy `autoblock-loader` chunk, not the synchronous
   bootstrap — keeps the ESM-OFF bundle clean (serves the budget-reclamation goal)
   and the hot path unstaged. The accepted cost is a few-ms pre-chunk-load window
   where an async tracking call can escape — the same intrinsic bootstrap-first
   limit v6 already documents; the v6 diagnostic can be extended to flag it.
   Implication for tests: a test must cover/acknowledge the gap rather than assert
   zero-escape from `t=0`.
3. **`sendBeacon` at unload (Q3)** → **drop it.** A matched pre-consent beacon
   fired during `pagehide`/`unload` is dropped (no consent = no send; no future
   page to replay into) — consistent with the `<img>` pixel posture and legally
   correct. No `sessionStorage` persistence in v7. This MUST be documented
   honestly in the README limits section (a v7 docs task).

**Carried as implementation constraints (no fork):** Q4 replay fidelity — clone
the `Request` body / forward the `sendBeacon` `data` at intercept time, not grant
time. Q5 XHR — add a negative test asserting XHR is NOT intercepted (no
over-reach); confirm during planning that no curated-DB tracker is XHR-only. Q6 —
fold the v6 diagnostic into the lazy chunk to reclaim ~0.59 kB.

**PRD impact:** none — these refine v7's design within the already-scoped
transport-interception cut. No `/pm:amend` required.
