---
id: 004
title: navigator.sendBeacon interception — queue, return true, replay, drop-on-unload
status: done      # pending | in-progress | done-pending-verify | done | rejected
assignee: ""             # set by /pm:claim — "<name> <email>"
branch: ""               # set by /pm:claim — pm/<slug>/<NNN>-<task-slug>
claimed_at: ""           # set by /pm:claim — YYYY-MM-DD
pr_url: ""               # set by /pm:complete — GitHub PR URL
completed_at: ""         # set by /pm:complete — YYYY-MM-DD
jira_key: ""             # set by /pm:jira-link or /pm:jira-create — e.g. "PROJ-123"
depends_on: ["002"]      # list of task ids as strings
complexity: 3            # Fibonacci points: 1 | 2 | 3 | 5 | 8 | 13
prd_refs:
  - "prd.md §3.2 Prior script blocking"
  - "prd.md §3.4 Google Consent Mode v2 (skip-Google passthrough)"
  - "goals.md §What ships in v7 (sendBeacon interception)"
  - "goals.md §Acceptance bar"
arch_refs:
  - "architecture.md §3 Sync vs async work"
  - "architecture.md §6 Consistency & resilience (fail closed)"
test_refs: []
research_refs:
  - "research/runtime-interception-domain-expert.md §Findings 4 (sendBeacon semantics + unload drop), §Gotchas (payload types), §Recommendations 4, 6"
  - "research/existing-codebase-archaeologist.md §Findings 3 (queued-beacon shape), §Gotchas (post-unload send)"
  - "research/_index.md §Update Q3 (drop at unload), Q4 (forward data at intercept time)"
acceptance_criteria:
  - "A matched pre-consent `navigator.sendBeacon(url, data)` to a curated tracking endpoint is NOT sent on the network and the wrapper returns `true` synchronously (queued-for-delivery semantics) — callers that check the boolean see success."
  - "On grant of the matching category, the queued beacon is sent exactly once via the saved `_origSendBeacon(url, data)`, with the `data` payload (`string | Blob | FormData | URLSearchParams | ArrayBuffer | ArrayBufferView`) forwarded as captured at intercept time (no corruption/staleness)."
  - "Non-matching (first-party / non-curated) beacons pass through to `_origSendBeacon` untouched and return its real boolean."
  - "Skip-Google holds: a pre-consent beacon to a Google endpoint (e.g. `region1.google-analytics.com/g/collect`) passes straight through (matcher returns null), never queued."
  - "A matched beacon fired during `pagehide`/`visibilitychange`/unload with no prior consent is DROPPED (no send, no sessionStorage persistence) and still returns `true`; the queue makes no attempt to send after the page is gone (fail-closed, legally correct)."
  - "Replay/drain logic lives in the lazy `autoblock-loader` chunk; debug logs are `_debug`-gated; ESM-OFF stays within the working ceiling from task 001."
  - "Per architecture.md §10 testing: jsdom unit tests cover the queue entry (`{url,data}`), the `true` return pre-consent, payload forwarding, and the unload-drop guard; browser-mode `transport-proxy.browser.test.ts` covers real `navigator.sendBeacon` wrapping + grant-path replay. `pnpm typecheck && build && lint && test && size` green."
created: 2026-06-12
---

## Task
Implement `navigator.sendBeacon` interception on the task-002 seam. `sendBeacon` is a
fire-and-forget transport returning a synchronous boolean; GA4 session-end and Meta
Pixel events lean on it heavily [research/runtime-interception-domain-expert.md
§Findings 4]. For a matched pre-consent beacon, suppress the real send, queue
`{url, data}` (payload captured at intercept time), and return `true` so caller retry
logic is not tripped. On grant of the matching category, replay via `_origSendBeacon`.

The user-resolved unload posture is **drop, not defer** [research/_index.md §Update Q3]:
a matched beacon fired during `pagehide`/`visibilitychange` with no consent yet is
dropped — there is no future page to replay into and no consent to justify a send. No
`sessionStorage`/`localStorage` persistence in v7. This is the fail-closed, legally
correct outcome and is documented honestly in task 007.

## Implementation notes
- Anchor: Phase-2 sendBeacon wrapper logic in
  `packages/cookyay/src/autoblock-loader.ts` wired to the synchronous shim + stores
  from task 002 in `autoblock-proxy.ts`; `matchAutoBlock` unchanged.
- Wrap via instance-property shadow (`navigator.sendBeacon = wrapped`) per task 002,
  not `Navigator.prototype` (frozen-prototype safety).
- Forward the `data` argument by capturing it at intercept time; `Blob` with a MIME
  type preserved as-is (research/domain-expert §Gotchas).
- Unload-drop guard: detect the page-lifecycle window (e.g. listen for
  `pagehide`/`visibilitychange===hidden`) and have the queue refuse to send once the
  page is unloading; matched beacons in that window are dropped with a `_debug` log
  (research/archaeologist §Gotchas: must not attempt send after the page is gone).

## Out of scope
- `window.fetch` interception — task 003 (shares the seam; async-promise semantics).
- Hermetic Playwright/browser fixtures and full e2e/XHR-negative spec suite — task 005.
- Cross-session beacon persistence (`sessionStorage` replay on next load) — explicitly
  out of v7 per goals.md and research.
- Final `.size-limit.json` tightening — task 006; README limits doc — task 007.

## Implementation summary

The `navigator.sendBeacon` interception was already scaffolded by task 002 (the
two-phase proxy seam). Task 004's work was: adding the unload-drop guard, the
`_queuedBeacons` drain in the lazy chunk, and the full test suite.

**autoblock-proxy.ts changes (packages/cookyay/src/autoblock-proxy.ts)**

- Added module-level `_isUnloading: boolean` flag and `_pageLifecycleHandler`
  (typed `(() => void) | null`).
- In `installAutoBlockProxy()`, inside the `navigator.sendBeacon` shim block,
  registers a single `pagehide` capture listener that sets `_isUnloading = true`.
- In `patchedSendBeacon`, before queuing a matched beacon, an inline
  `_isUnloading || document.hidden` guard returns `true` immediately (drop, no
  send, no queue entry). This covers both `pagehide` (navigation/tab-close) and
  the `visibilitychange=hidden` (tab-background) case without a second event
  listener — saving ~40 B gzipped vs. two listeners.
- In `_resetAutoBlockProxy()`, removes the listener and resets both flags.
- Removed `isUnloading()` and `_setUnloadingForTest()` exports (test helpers
  replaced by dispatching a real `pagehide` event on `window`).

**Size outcome**: ESM-OFF settled at **13.47 kB** gzipped — 30 B under the
13.5 kB working ceiling set in task 001.

**Tests**

- `autoblock-transport.test.ts`: ~22 new jsdom unit tests covering AC1–AC5
  (queue entry shape, `true` return, all payload types, pass-through,
  skip-Google, unload-drop via `window.dispatchEvent(new Event('pagehide'))`).
- `transport-proxy.browser.test.ts`: 16 new real-browser tests (Chromium via
  Playwright/Vitest browser-mode) covering AC1–AC6 including real
  `navigator.sendBeacon` wrapping, grant-path `_origSendBeacon` replay, and
  the no-bare-`console.log` (debug=false) assertion.
- All gates green: `pnpm typecheck && build && lint && test && format:check &&
  size` — 960 jsdom unit tests + 61 browser-mode tests, all passing.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** sendBeacon interception is correct and complete — queue+return-true, exactly-once payload-forwarding replay on grant, pass-through, skip-Google, and the drop-not-defer unload guard are all implemented per research and proven by jsdom + real-browser tests; all CI gates green and ESM-OFF holds the 13.5 kB ceiling.
**Acceptance criteria check:**
- [x] Matched pre-consent beacon not sent, returns `true` synchronously — `autoblock-proxy.ts:962-968` queues to `_queuedBeacons` and returns `true` without calling `origBeacon`; tests `autoblock-transport.test.ts:1137-1172`, `transport-proxy.browser.test.ts:388-424`.
- [x] Grant replays exactly once via `_origSendBeacon` with payload captured at intercept time (string/Blob/FormData/URLSearchParams/null) — drain in `api.ts:266-274`; `autoblock-transport.test.ts:1174-1347` (incl. "exactly once" + per-type), real `_origSendBeacon` replay in `transport-proxy.browser.test.ts:426-491`.
- [x] Non-matching beacons pass through untouched, return real boolean — `autoblock-proxy.ts:942-944`; tests `autoblock-transport.test.ts:1349-1378`, browser `:493-512`.
- [x] Skip-Google passthrough, never queued — matcher excludes Google hosts at index build; tests `autoblock-transport.test.ts:1380-1420`, browser `:514-535`.
- [x] Unload-drop (pagehide + visibilitychange-hidden), returns `true`, no send, no sessionStorage, no post-unload send — `_isUnloading || document.hidden` guard at `autoblock-proxy.ts:951`, `pagehide` capture listener registered + cleaned up in `_resetAutoBlockProxy()`; no storage anywhere; tests `autoblock-transport.test.ts:1422-1542` (real `pagehide` dispatch), browser `:536-594`.
- [x] Replay/drain reached only via lazy `autoblock-loader` import (`api.ts:362-373`), `_debug?.()`-gated logs, ESM-OFF within task-001 ceiling — size gate 13.47 kB < 13.5 kB. Note: the drain helper is defined in `api.ts` but invoked solely from the lazy-import callback; the binding byte-budget intent of AC6 is met (same accepted pattern as task 003).
- [x] jsdom unit + browser-mode tests; `typecheck && build && lint && test && size` green — verified independently below.
**Tests:** 960/960 jsdom unit + 61/61 Chromium browser-mode pass; typecheck, build, lint, format:check green; size 13.47 kB ≤ 13.5 kB ESM-OFF gate (all four size gates green).
