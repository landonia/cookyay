---
id: 003
title: fetch interception — hybrid 204-stub + clone-and-replay on grant
status: done # pending | in-progress | done-pending-verify | done | rejected
assignee: ""             # set by /pm:claim — "<name> <email>"
branch: ""               # set by /pm:claim — pm/<slug>/<NNN>-<task-slug>
claimed_at: ""           # set by /pm:claim — YYYY-MM-DD
pr_url: ""               # set by /pm:complete — GitHub PR URL
completed_at: ""         # set by /pm:complete — YYYY-MM-DD
jira_key: ""             # set by /pm:jira-link or /pm:jira-create — e.g. "PROJ-123"
depends_on: ["002"]      # list of task ids as strings
complexity: 5            # Fibonacci points: 1 | 2 | 3 | 5 | 8 | 13
prd_refs:
  - "prd.md §3.2 Prior script blocking"
  - "prd.md §3.4 Google Consent Mode v2 (skip-Google passthrough)"
  - "goals.md §What ships in v7 (fetch interception)"
  - "goals.md §Acceptance bar"
arch_refs:
  - "architecture.md §3 Sync vs async work"
  - "architecture.md §6 Consistency & resilience (idempotency / fail closed)"
test_refs: []
research_refs:
  - "research/runtime-interception-domain-expert.md §Findings 2 (input normalization / stream-consumption), §3 (hybrid stub+queue), §5 (skip-Google), §Recommendations 1–3, 7"
  - "research/existing-codebase-archaeologist.md §Findings 3 (held-fetch shape), §Gotchas (Request object, stub semantics)"
  - "research/performance-engineer.md §Findings 1, 3 (URL extraction; defer clone past match)"
  - "research/_index.md §Update Q1 (204 stub), Q4 (clone body at intercept time)"
acceptance_criteria:
  - "A matched pre-consent `fetch` to a curated tracking endpoint (e.g. `https://www.facebook.com/tr`) is NOT sent on the network, and the caller's promise resolves immediately to a benign `new Response(null, { status: 204 })` stub — it does not throw and does not hang (proven in a browser-mode test with `await fetch(...)` and `.json()`/`.text()` accessors resolving)."
  - "On grant of the matching category, the originally-matched call is replayed exactly once via the saved `_origFetch` (network request observed). The `Request` body is cloned at intercept time (`request.clone()`), not grant time, so replay payloads are intact."
  - "Non-matching (first-party / non-curated) fetches pass through to `_origFetch` synchronously and untouched — same `Response`, no stub, no hold, no `Request.clone()` (clone happens only after a confirmed match, per research/performance §Findings 3)."
  - "`fetch` input is normalized for `string`, `URL`, and `Request` forms via the shared `_extractUrl` helper before matching; a `Request`-object call is matched on `request.url`."
  - "Skip-Google holds at the transport layer: a pre-consent `fetch` to a Google endpoint (e.g. `region1.google-analytics.com/g/collect`) passes through to the network (Consent Mode v2 owns it), never held — the matcher returns null for Google hosts."
  - "An in-flight held call whose `AbortSignal` fires before grant is discarded (not replayed), leaving no zombie queue entry."
  - "Replay/drain logic lives in the lazy `autoblock-loader` chunk (Phase-2), keeping the ESM-OFF bundle within the working ceiling; debug logs are `_debug`-gated (no bare `console.log`)."
  - "Per architecture.md §10 testing: jsdom unit tests cover URL normalization + the 204 stub Response duck-type (`.ok/.status/.headers/.json()/.text()/.blob()/.arrayBuffer()/.clone()` all present and resolving); browser-mode `transport-proxy.browser.test.ts` covers real `window.fetch` wrapping + grant-path replay timing. `pnpm typecheck && build && lint && test && size` green."
created: 2026-06-12
---

## Task
Implement `window.fetch` interception on top of the task-002 seam. Modern trackers
(Meta `facebook.com/tr`, TikTok, Snapchat, LinkedIn, Pinterest) now beacon via
`fetch(..., { keepalive: true })`, bypassing the DOM entirely
[research/runtime-interception-domain-expert.md §Findings 1]. v7 closes this gap with
the user-resolved **hybrid stub+queue** strategy: resolve the caller's promise
immediately with a benign `204 No Content` stub (no hang, no timeout, survives
`await`), and separately queue a `Request.clone()` for best-effort replay via
`_origFetch` when the matching category is granted [research/_index.md §Update Q1, Q4].

Skip-Google and the curated-endpoint-only scope are the guardrails: only URLs that
`matchAutoBlock` resolves to a not-yet-granted category are held; everything else —
including all first-party API traffic and all Google endpoints — passes straight
through. This is higher page-breakage risk than pixels (app code may `await` a fetch),
mitigated entirely by the curated scope + the non-throwing stub.

## Implementation notes
- Anchor: the Phase-2 fetch wrapper logic in `packages/cookyay/src/autoblock-loader.ts`
  (drain/replay) wired to the synchronous shim + stores from task 002 in
  `autoblock-proxy.ts`; `matchAutoBlock` from `autoblock-matcher.ts` unchanged.
- Held entry shape: `{ url, request: clonedRequest, resolve, category }` — but the
  caller's promise is resolved *immediately* with the 204 stub (hybrid), and the
  cloned request is queued independently for grant-time replay. Do not gate the
  caller's promise on grant (avoids the never-resolved-if-never-granted leak,
  research/domain-expert §Findings 3).
- Construct the `new Response(null, { status: 204 })` stub from the native `Response`
  captured before any override (research/archaeologist §Gotchas).
- `keepalive` fetch captured during `pagehide`/unload must NOT be queued for replay
  (page is ending; nothing to replay into) — drop with a `_debug` log. The general
  unload-drop documentation is task 007; the code-level drop guard lands here.
- Extract URL → `matchAutoBlock` → only then `clone()` (research/performance §Findings 3).

## Out of scope
- `navigator.sendBeacon` interception — task 004 (shares the seam; distinct semantics).
- Hermetic Playwright/browser fixtures and the full e2e/XHR-negative spec suite — task 005
  (this task's own unit + browser-mode tests prove the wrapping logic in isolation).
- Final `.size-limit.json` tightening — task 006.
- README/parity documentation of the limits — task 007.
- Persisting unreplayed calls across sessions — out of v7 (sessionStorage/localStorage queue).

## Re-execution notes — 2026-06-11
**Verifier note addressed:** The single rejection was the Prettier format gate failing on 4 files: `api.ts`, `autoblock-proxy.ts`, `autoblock-transport.test.ts`, and `transport-proxy.browser.test.ts`. Fixed by running `npx prettier --write` on those 4 files. No functional, logic, or test changes were made — this was a pure cosmetic fix as directed by the verifier.

**Full gate results after fix:** `pnpm typecheck && pnpm build && pnpm lint && pnpm test && pnpm format:check && pnpm size` — all green. 938 unit tests pass; 46 browser tests pass; all size limits under budget; format check reports "All matched files use Prettier code style!".

## Implementation summary
**Files changed:**
- `packages/cookyay/src/autoblock-proxy.ts` — Updated `HeldFetch` interface: replaced `input`/`resolve`/`reject` with `replayInput` (cloned Request or original string/URL) and `signal` (AbortSignal for discard-on-abort). Added `_origResponse` module variable (saves native `Response` constructor before any override). Updated `installAutoBlockProxy()` fetch shim to: (1) save `_origResponse`, (2) implement hybrid stub+queue — immediately return `Promise.resolve(new NativeResponse(null, { status: 204 }))` to the caller, (3) drop `keepalive` fetches (page-ending, no replay context), (4) clone `Request` input at intercept time (`request.clone()`), (5) extract AbortSignal and discard held entry on abort, (6) push `HeldFetch` entry with `replayInput`/`signal`. Updated `_resetAutoBlockProxy()` to clear `_origResponse`. Updated module docstring to describe hybrid stub+queue semantics.
- `packages/cookyay/src/api.ts` — Updated `_registerTransportHook()` drain callback: uses `hf.replayInput` (not the removed `hf.input`) for the replay call to `_origFetch`, passes `undefined` init when `replayInput` is a Request (headers/method/body are in the clone). Removed the now-unnecessary `hf.resolve`/`hf.reject` calls. Added `.catch()` to swallow replay network errors (fire-and-forget replay per research recommendations).
- `packages/cookyay/src/autoblock-transport.test.ts` — Updated existing tests to reflect new `HeldFetch` shape (no `resolve`/`reject`, uses `replayInput` instead of `input`). Updated `HeldFetch` structure assertions. Added new test blocks covering: Task 003 AC1 (204 stub duck-type: `.ok`, `.status`, `.headers`, `.text()`, `.json()`, `.blob()`, `.arrayBuffer()`, `.clone()`), Task 003 AC2 (clone at intercept time — Request vs string/URL), Task 003 AC3 (non-matching pass-through confirmation), Task 003 AC5 (skip-Google via matcher returning null), Task 003 AC6 (AbortSignal discard — fires before grant, already-aborted, partial discard, signal field stored), keepalive drop tests.
- `packages/cookyay/src/transport-proxy.browser.test.ts` — New browser-mode test file (19 tests): covers real `window.fetch` wrapping in Chromium — 204 stub in real browser (AC1: all accessor duck-type methods), grant-path replay timing (AC2), non-matching pass-through (AC3), skip-Google (AC5), AbortSignal discard in real browser (AC6), debug-log guard (AC7 — no bare console.log), `_extractUrl` in real browser environment, integration (hold → grant → drain).

**Acceptance criteria check:**
- [x] AC1 — matched pre-consent `fetch` resolves immediately to `new Response(null, { status: 204 })` — `autoblock-proxy.ts:patchedFetch` returns `Promise.resolve(new NativeResponse(null, { status: 204 }))` immediately. Covered by `autoblock-transport.test.ts` "Task 003 AC1" block (10 tests) and `transport-proxy.browser.test.ts` "AC1" block (8 tests).
- [x] AC2 — on grant, replayed exactly once via `_origFetch`; `Request` body cloned at intercept time — `autoblock-proxy.ts` clones with `(input as Request).clone()` immediately on match (before grant). `api.ts:_registerTransportHook` replays via `origFetch(hf.replayInput, ...)`. Covered by AC2 block (4 tests including clone-vs-original reference check).
- [x] AC3 — non-matching fetches pass through to `_origFetch` synchronously, no stub/hold/clone — `autoblock-proxy.ts:patchedFetch` early-returns `origFetch.call(window, input, init)` when `!match`. Covered by AC3 block (2 tests).
- [x] AC4 — `_extractUrl` handles string/URL/Request — unchanged from task 002. Covered by `autoblock-transport.test.ts` `AC3 — _extractUrl helper` block and `transport-proxy.browser.test.ts` AC7 block.
- [x] AC5 — skip-Google holds at transport layer: Google endpoint passes through (matcher returns null) — `autoblock-proxy.ts` skip-Google is intrinsic to `matchAutoBlock` index. Covered by AC5 block (2 tests).
- [x] AC6 — AbortSignal fires before grant → entry discarded — abort event listener in `patchedFetch`, `idx !== -1` guard. Covered by AC6 block (7 tests including already-aborted, partial discard).
- [x] AC7 — replay/drain lives in lazy `autoblock-loader` chunk; debug logs `_debug`-gated — `_registerTransportHook` is in `api.ts` and called from within `import('./autoblock-loader.js').then(...)`. All new `_debug?.()` calls follow existing convention. Covered by `transport-proxy.browser.test.ts` AC7 block.
- [x] AC8 — jsdom unit tests cover URL normalization + 204 stub duck-type; browser-mode `transport-proxy.browser.test.ts` covers real `window.fetch` wrapping + grant-path replay timing. `pnpm typecheck && build && lint && test && format:check && size` all green (938 unit + 46 browser tests; format clean).

**Tests:** `pnpm --filter cookyay exec vitest run` (588 tests, 15 files, all passing) + `pnpm --filter cookyay exec vitest run --config vitest.browser.config.ts` (46 tests, 4 browser files, all passing)

**Notes for verifier:**
- The `HeldFetch` interface no longer has `resolve`/`reject` fields — the caller's Promise is settled immediately at intercept time with the 204 stub. The `replayInput` field replaces `input`: for `Request` objects it is `request.clone()` (cloned at intercept time); for string/URL it is the original value.
- `keepalive` fetch detection checks both `init?.keepalive === true` and `(input instanceof Request && input.keepalive === true)` — the dropped keepalive returns a 204 stub (non-throwing) but is NOT added to `_heldFetches`.
- The abort listener uses `{ once: true }` to prevent memory leaks and checks `idx !== -1` before splicing (defensive against races).
- `_origResponse` is captured at install time and used to construct the stub — prevents any third-party `Response` override affecting stub semantics.
- ESM-OFF grew from 12.98 kB (task 002 baseline) to 13.38 kB (+0.40 kB gzip) — within the 13.5 kB working ceiling. The growth comes from the AbortSignal handling and keepalive guard added to the fetch shim. Task 006 tightens the limit.
- `api.ts:_registerTransportHook` replay passes `undefined` init when `replayInput` is a Request (headers/method/body are in the clone; passing init too would conflict with the cloned Request's headers).

## Verifier notes — 2026-06-11 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Implementation is functionally correct and all 8 ACs pass with strong test coverage, but the Prettier **format gate is red** on every file this task touched — a CI gate the v7 acceptance bar explicitly requires (`goals.md §Acceptance bar`: "all green in CI (including the v6 browser-mode and format gates)").

**What needs to change:**
1. Run `pnpm format` (or `npx prettier --write packages/cookyay/src/api.ts packages/cookyay/src/autoblock-proxy.ts packages/cookyay/src/autoblock-transport.test.ts packages/cookyay/src/transport-proxy.browser.test.ts`). These 4 files are the ONLY Prettier violations in the entire repo (verified with `npx prettier --check .`), so they are a regression introduced by this task — the format gate was green before. Concrete examples: `autoblock-proxy.ts:781` has redundant parens (`(init?.keepalive === true) ||` → `init?.keepalive === true ||`) and `:818` has an unwrapped nested ternary Prettier wants split across lines.
2. Re-run the FULL gate including format before re-submitting: `pnpm typecheck && pnpm build && pnpm lint && pnpm test && pnpm format:check && pnpm size`. The Implementation summary's AC8 line lists `typecheck && build && lint && test && size` but omits `format:check`, which is why this slipped through — add it to the re-verification command.
3. No functional changes are needed. Do NOT touch the interception logic, tests, or stores — they are correct. This is a formatting-only fix.

**Acceptance criteria check:**
- [x] AC1 — 204 stub, non-throwing, non-hanging — `autoblock-proxy.ts:790,835,855` return `Promise.resolve(new NativeResponse(null, { status: 204 }))`. Unit duck-type block (`autoblock-transport.test.ts:770-861`, all accessors `.ok/.status/.headers/.json()/.text()/.blob()/.arrayBuffer()/.clone()`) + browser AC1 block pass.
- [x] AC2 — replay once via `_origFetch`, Request cloned at intercept time — `autoblock-proxy.ts:806-810` clones on match; `api.ts:_registerTransportHook` (lines ~256-290) replays via `getOrigFetch()` with `replayInput`, passes `undefined` init for Request. Clone-not-original asserted (`autoblock-transport.test.ts:365`).
- [x] AC3 — non-matching pass-through, no stub/hold/clone — `autoblock-proxy.ts:769-773` early-returns `origFetch.call(...)`. Covered (`autoblock-transport.test.ts:932`, browser AC3).
- [x] AC4 — `_extractUrl` normalizes string/URL/Request — `autoblock-proxy.ts:260-264`. Covered (`autoblock-transport.test.ts:129`).
- [x] AC5 — skip-Google passes through (matcher returns null) — intrinsic to matcher; covered unit (`:960`) + real-browser (`transport-proxy.browser.test.ts:221`).
- [x] AC6 — AbortSignal fires before grant → discarded — `autoblock-proxy.ts:832-851` (already-aborted + listener with `idx !== -1` guard). Covered incl. partial-discard (`autoblock-transport.test.ts:993-1090`) + browser.
- [x] AC7 — replay/drain in lazy `autoblock-loader` chunk; `_debug`-gated — hook registered inside `import('./autoblock-loader.js').then(...)` in `api.ts`; `_debug` gated by `_config?.debug` (`api.ts:94-98`); no bare `console.log` in touched src (verified). ESM-OFF 13.38 kB < 13.5 kB ceiling.
- [ ] AC8 — "`pnpm typecheck && build && lint && test && size` all green" — typecheck/lint/build PASS; unit 588/588 PASS; browser 46/46 PASS; size all under budget. **FAILS the format gate** (`pnpm format:check` red on the 4 touched files), which `goals.md §Acceptance bar` includes in "all green in CI". The literal AC8 command omits format, but the version's acceptance bar binds it.

**Tests:** Unit 588/588 pass; browser-mode 46/46 pass; typecheck/lint/build green; size all under budget. Format check FAILS (4 files).
**Notes for next executor:** Pure cosmetic fix — `pnpm format` then re-run the full gate with `format:check` added. The fetch interception, hybrid stub+queue, clone-at-intercept, AbortSignal discard, keepalive drop, and lazy-chunk replay wiring are all correct and well-tested; leave them untouched.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Re-execution fixed the sole prior blocker (Prettier format gate). All 8 ACs pass with real, assertion-bearing jsdom + browser-mode tests, and the full v7 acceptance-bar gate — including `format:check` — is green. No functional changes since last verify; logic remains correct.
**Acceptance criteria check:**
- [x] AC1 — 204 stub, non-throwing, non-hanging — `autoblock-proxy.ts:790,837,857` return `Promise.resolve(new NativeResponse(null, { status: 204 }))`. Duck-type block `autoblock-transport.test.ts:767-859` (`.ok/.status/.headers/.text()/.json()/.blob()/.arrayBuffer()/.clone()`) + browser AC1 pass.
- [x] AC2 — replay once via `_origFetch`, Request cloned at intercept time — `autoblock-proxy.ts:806-810` clones on match; `api.ts:_registerTransportHook` (247-263) replays via `getOrigFetch()` with `replayInput`, passes `undefined` init for Request. Clone-not-original asserted (`autoblock-transport.test.ts:365` `expect(hf.replayInput).not.toBe(req)`).
- [x] AC3 — non-matching pass-through, no stub/hold/clone — `autoblock-proxy.ts:769-773` early-returns `origFetch.call(...)`. Covered (`autoblock-transport.test.ts:929`, browser AC3).
- [x] AC4 — `_extractUrl` normalizes string/URL/Request — `autoblock-proxy.ts:260-264`. Covered (`autoblock-transport.test.ts:129`).
- [x] AC5 — skip-Google passes through (matcher returns null) — `autoblock-transport.test.ts:957`, real-browser AC5 (`transport-proxy.browser.test.ts`).
- [x] AC6 — AbortSignal fires before grant → discarded — `autoblock-proxy.ts:834-853` (already-aborted + `{ once: true }` listener with `idx !== -1` guard). Covered incl. partial-discard.
- [x] AC7 — replay/drain in lazy `autoblock-loader` chunk; `_debug`-gated — hook registered inside `import('./autoblock-loader.js').then(...)`; no bare `console.log` in touched shim (browser AC7 asserts). ESM-OFF 13.37 kB < 13.5 kB ceiling.
- [x] AC8 — full gate green: typecheck, lint, build, unit 588/588, browser 46/46, size all under budget, `format:check` clean ("All matched files use Prettier code style!").
**Tests:** Unit 588/588 pass; browser-mode 46/46 pass; typecheck/lint/build/size/format all green.

## Verifier notes
<!-- Empty at creation. Populated by /pm:verify if rejected. -->
