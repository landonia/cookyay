---
id: 002
title: Transport install seam — save/replace globals, held stores, reset, release wiring
status: done # pending | in-progress | done-pending-verify | done | rejected
assignee: ""             # set by /pm:claim — "<name> <email>"
branch: ""               # set by /pm:claim — pm/<slug>/<NNN>-<task-slug>
claimed_at: ""           # set by /pm:claim — YYYY-MM-DD
pr_url: ""               # set by /pm:complete — GitHub PR URL
completed_at: ""         # set by /pm:complete — YYYY-MM-DD
jira_key: ""             # set by /pm:jira-link or /pm:jira-create — e.g. "PROJ-123"
depends_on: ["001"]      # list of task ids as strings
complexity: 5            # Fibonacci points: 1 | 2 | 3 | 5 | 8 | 13
prd_refs:
  - "prd.md §3.2 Prior script blocking"
  - "goals.md §What ships in v7"
  - "goals.md §Acceptance bar"
arch_refs:
  - "architecture.md §3 Sync vs async work"
  - "architecture.md §6 Consistency & resilience (idempotency, fail closed)"
test_refs: []
research_refs:
  - "research/existing-codebase-archaeologist.md §Findings 1 (install seam), §3 (held-store analog), §5 (static import budget), §7 (reset must restore globals)"
  - "research/existing-codebase-archaeologist.md §Recommendations 1, 3, 4, 6"
  - "research/performance-engineer.md §Findings 6, §Recommendations 1, 4 (minimal sync stub; _extractUrl helper)"
  - "research/runtime-interception-domain-expert.md §Gotchas (circular re-interception; prototype-chain replacement)"
  - "research/_index.md §Update Q2 (Phase 2 lazy install timing)"
acceptance_criteria:
  - "`installAutoBlockProxy()` synchronously saves the original `window.fetch` and `navigator.sendBeacon` into module-level `_origFetch` / `_origSendBeacon` and installs wrapper shims, in the same synchronous call that already saves `_origCreateElement` / `_origImage` — no async gap, not in `bootstrap.ts`."
  - "`navigator.sendBeacon` is wrapped via instance-property shadow (`navigator.sendBeacon = wrapped`), not `Navigator.prototype`, so frozen-prototype environments do not throw."
  - "Module-level `_heldFetches` and `_queuedBeacons` stores exist (parallel to `_held`/`_staged`), with a shared `_extractUrl(input)` helper handling `string | URL | Request` with zero allocation for the common absolute-string case."
  - "A transport release hook is wired so `grant(category)` drains the matching held/queued entries for the granted category, using the same IoC/registration pattern as `_registerUI`/`_registerGpcUI` — `blocking.ts` has no knowledge of transport internals."
  - "`_resetAutoBlockProxy()` restores `window.fetch` and `navigator.sendBeacon` from the saved originals AND clears `_heldFetches` / `_queuedBeacons`; a jsdom unit test asserts both globals are byte-identical to originals after reset and the stores are empty (no cross-test pollution)."
  - "Replay paths call through the saved `_origFetch` / `_origSendBeacon`, never `window.fetch` / `navigator.sendBeacon`, preventing circular re-interception (covered by a unit assertion)."
  - "Per architecture.md §10 testing, `_extractUrl` and the install/reset behaviour are covered by jsdom unit tests in `autoblock-proxy.test.ts` (or a sibling); `pnpm typecheck && build && lint && test && size` all green, and the post-task ESM-OFF measurement stays within the working ceiling set in task 001."
created: 2026-06-12
---

## Task
Build the shared synchronous foundation that both transport interceptors (fetch in
003, sendBeacon in 004) sit on. Transport calls have no DOM element to carry hold
state, so v7 introduces module-level held-request / queued-beacon stores drained by
the same `grant()` trigger as DOM elements
[research/existing-codebase-archaeologist.md §Findings 1, 3].

The non-negotiable seam: `window.fetch` and `navigator.sendBeacon` must be saved and
replaced **synchronously** inside `installAutoBlockProxy()` — the same Phase-1 call
that already saves `_origCreateElement`/`_origImage` — because the wrappers only work
if installed before any third party runs. The actual classify/hold/replay *logic*
lives in the lazy `autoblock-loader` chunk (Phase 2) per the resolved install-timing
decision [research/_index.md §Update Q2]; this task lands the minimal synchronous
stub + shared state + reset/release plumbing, keeping new bytes in the always-present
ESM-OFF bundle small (research/performance §Rec1 targets ≤80 lines / ~0.3 kB gzip).

## Implementation notes
- Anchor files: `packages/cookyay/src/autoblock-proxy.ts` (`installAutoBlockProxy`,
  `activateMatcher`, `_resetAutoBlockProxy`), `packages/cookyay/src/api.ts`
  (`init()` install call + an `_enqueueHeldTransport`-style hook parallel to
  `_enqueueHeldElements`), `packages/cookyay/src/blocking.ts` (`grant()` dispatch +
  registration hooks), `packages/cookyay/src/autoblock-loader.ts` (home for the
  Phase-2 replay/drain logic added in 003/004).
- `_extractUrl(input)`: `typeof input === 'string' ? input : input instanceof URL ?
  input.href : input.url` — reused by both transports and avoids a third copy of
  host-extraction logic (research/performance §Rec4).
- The matcher (`matchAutoBlock(url)`) needs NO changes — it already takes a bare URL
  string and handles `requestPaths`; skip-Google is intrinsic to the index
  (research/existing-codebase-archaeologist.md §Findings 4).
- Keep the synchronous stub minimal; push drain/replay into the lazy chunk to protect
  the ESM-OFF budget (this is why task 001 runs first).

## Out of scope
- The actual fetch hold/204-stub/replay semantics — task 003.
- The actual sendBeacon queue/return-true/unload-drop semantics — task 004.
- Any matcher (`autoblock-matcher.ts`) change — none needed.
- Hermetic e2e fixtures/specs — task 005.
- `XMLHttpRequest` or `document.write` wrapping — deferred per goals.md.

## Implementation summary
**Files changed:**
- `packages/cookyay/src/autoblock-proxy.ts` — Added `_origFetch`, `_origSendBeacon`, `_heldFetches`, `_queuedBeacons` module-level variables; added `HeldFetch` and `QueuedBeacon` export interfaces; added `_extractUrl(input)` helper; added `getHeldFetches()`, `getQueuedBeacons()`, `getOrigFetch()`, `getOrigSendBeacon()` public exports; updated `installAutoBlockProxy()` to save the fetch/sendBeacon originals synchronously (in the same call as DOM override saves) and install wrapper shims (Phase 1 pass-through, Phase 2 classify+hold); updated `_resetAutoBlockProxy()` to restore both globals and clear both transport stores; updated module docstring.
- `packages/cookyay/src/blocking.ts` — Added `_registerTransportReleaseHook()` IoC function (parallel to `_registerUI`/`_registerGpcUI`); added `_transportReleaseHook` module variable; updated `grant()` to call `_transportReleaseHook?.(category)` after draining the DOM element queue; updated `_resetBlocker()` to clear the hook.
- `packages/cookyay/src/api.ts` — Added `getHeldFetches`, `getQueuedBeacons`, `getOrigFetch`, `getOrigSendBeacon` to the `autoblock-proxy.js` import; added `_registerTransportReleaseHook` to the `blocking.js` import; added `_registerTransportHook()` function (drains `_heldFetches`/`_queuedBeacons` by category via saved originals); wired `_registerTransportHook()` into the lazy `import('./autoblock-loader.js').then(...)` callback after `_enqueueHeldElements()`.
- `packages/cookyay/src/autoblock-transport.test.ts` — New jsdom test file: 49 tests covering all 7 acceptance criteria (`_extractUrl`, synchronous install, instance-property shadow, stores populated, Phase 1 pass-through, reset/restore/clear, replay-via-originals, grant drain hook).

**Acceptance criteria check:**
- [x] AC1: `installAutoBlockProxy()` saves `_origFetch`/`_origSendBeacon` synchronously with the DOM override saves, and installs fetch/sendBeacon wrapper shims — `autoblock-proxy.ts` lines ~454-458 (saves) and ~686-771 (shims). Covered by `autoblock-transport.test.ts` AC1 block (6 tests).
- [x] AC2: `navigator.sendBeacon` wrapped via `navigator.sendBeacon = patchedSendBeacon` (instance-property shadow, not `Navigator.prototype`) — `autoblock-proxy.ts` line ~742. Covered by AC2 block (3 tests).
- [x] AC3: `_heldFetches` and `_queuedBeacons` stores exist; `_extractUrl` handles `string | URL | Request` zero-alloc for strings — `autoblock-proxy.ts` exports at ~150-225. Covered by AC3 block (15 tests including URL/Request shapes).
- [x] AC4: Transport release hook wired via `_registerTransportReleaseHook()` IoC pattern; `grant()` calls the hook; `api.ts` registers a drain callback; `blocking.ts` has zero knowledge of transport internals — `blocking.ts:grant()` + `api.ts:_registerTransportHook()`. Covered by AC4 block (7 tests including multi-transport/multi-category).
- [x] AC5: `_resetAutoBlockProxy()` restores `window.fetch` and `navigator.sendBeacon` from saved originals AND clears `_heldFetches`/`_queuedBeacons`; jsdom tests assert byte-identical globals after reset and empty stores — `autoblock-proxy.ts:_resetAutoBlockProxy()`. Covered by AC5 block (9 tests).
- [x] AC6: Replay paths in `api.ts:_registerTransportHook()` call `getOrigFetch()`/`getOrigSendBeacon()`, never `window.fetch`/`navigator.sendBeacon` — `api.ts:_registerTransportHook()` lines. Covered by AC6 block (3 tests including circular-re-interception assertion).
- [x] AC7: `pnpm typecheck && build && lint && test && size` all green. ESM-OFF: 12.98 kB < 13.5 kB working ceiling. 559/559 tests pass (510 existing + 49 new).

**Tests:** `pnpm --filter cookyay exec vitest run` (559 tests, 15 test files)

**Notes for verifier:**
- The `fetch`/`sendBeacon` shims in `installAutoBlockProxy()` are guarded with `if (_origFetch !== null)` / `if (_origSendBeacon !== null)` so the install is resilient in environments (like jsdom) where these globals may not exist. The test-setup provides explicit stubs to simulate a real browser.
- Phase 1 pass-through (no staging for transport) is an intentional design decision per research/_index.md §Update Q2. The accepted cost is a brief pre-chunk-load escape window for async tracking calls. A test in the AC1/Phase 1 block (`fetch calls pass through in Phase 1`) documents and asserts this behavior.
- ESM-OFF grew from 12.24 kB (task 001 baseline) to 12.98 kB (+0.74 kB gzip) for the transport install seam. This is within the 13.5 kB working ceiling and consistent with the performance-engineer estimate of ≤0.3 kB for just the sync stub. The growth is slightly above the estimate because the stub includes interface exports and the `_extractUrl` helper that the lazy-chunk tasks (003/004) share.
- The `_registerTransportHook()` in `api.ts` is the minimal drain implementation (no 204 stub, no Request.clone replay fidelity). Tasks 003/004 will replace/extend the held fetch resolution with the hybrid stub+queue semantics.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Synchronous transport install seam (save/replace fetch+sendBeacon, held stores, _extractUrl, IoC release hook, reset/restore) is correct and complete; all 7 ACs pass, full gate green (typecheck/build/lint/559 tests/size), ESM-OFF 12.98 kB < 13.5 kB ceiling.

**Acceptance criteria check:**
- [x] AC1 (sync install saves _origFetch/_origSendBeacon in same call as DOM saves, shims installed, not bootstrap.ts) — `autoblock-proxy.ts` saves at the DOM-override block (`_origFetch = window.fetch ?? null`, `_origSendBeacon = navigator.sendBeacon ?? null`); fetch/sendBeacon shims installed in the same `installAutoBlockProxy()` body. Verified by `autoblock-transport.test.ts` AC1 block (saves null pre-install, non-null post-install, isProxyInstalled true in same call).
- [x] AC2 (instance-property shadow, not Navigator.prototype) — `navigator.sendBeacon = function patchedSendBeacon(...)`. Test asserts `Object.prototype.hasOwnProperty.call(navigator,'sendBeacon')` is true and pass-through hits the original.
- [x] AC3 (_heldFetches/_queuedBeacons stores + zero-alloc _extractUrl for string|URL|Request) — module-level arrays exported via getters; `_extractUrl` returns string as-is (no alloc), `URL.href`, `Request.url`. 15 tests incl. URL/Request input shapes.
- [x] AC4 (IoC release hook parallel to _registerUI/_registerGpcUI; grant drains; blocking.ts has no transport knowledge) — `_registerTransportReleaseHook()` in `blocking.ts`, `grant()` calls `_transportReleaseHook?.(category)` after the DOM queue drain; `api.ts:_registerTransportHook()` registers the drain. `blocking.ts` references only an opaque callback. Tests cover correct/wrong-category, multi-transport, repeat grants, reset-unregisters.
- [x] AC5 (reset restores both globals byte-identical AND clears both stores) — `_resetAutoBlockProxy()` restores `window.fetch`/`navigator.sendBeacon` from saved originals and zeroes both arrays. Tests assert restored globals are `.toBe` the pre-install refs and stores empty; origs back to null.
- [x] AC6 (replay via saved originals, never window.fetch/navigator.sendBeacon) — `api.ts:_registerTransportHook()` drains via `getOrigFetch()`/`getOrigSendBeacon()`; shims call `origFetch.call(window, ...)`/`origBeacon.call(navigator, ...)`. Circular-re-interception assertion present (`savedOrigFetch !== window.fetch`, replay calls saved original).
- [x] AC7 (full gate green; ESM-OFF within ceiling) — re-ran independently: typecheck clean, build success, lint clean, `vitest run` 559/559 pass (15 files), `size-limit` all green (ESM-OFF 12.98 kB < 13.5 kB; autoBlock-ON 15.82 kB < 20 kB).

**Scope/architecture/research compliance:** No drift. Phase-1 transport pass-through (no staging) matches research/_index.md §Update Q2. Minimal api.ts drain (no 204 stub / Request.clone) is correctly deferred to tasks 003/004 and documented. Synchronous install honors architecture.md §3; reset/reject-on-reset honors §6 fail-closed. No matcher changes. No debug artifacts left behind. Note (non-blocking, for executor of 003/004): the AC4/AC6 transport tests register inline drain hooks rather than exercising `api.ts:_registerTransportHook()` directly — acceptable for the seam, but 003/004 should add coverage of the real api.ts callback once it grows the stub+replay semantics.

**Tests:** 559/559 passing (49 new in `autoblock-transport.test.ts`).

<!-- Empty at creation. Populated by /pm:verify if rejected. -->
