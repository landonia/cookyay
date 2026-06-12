---
id: 003
title: Wire held <img> pixels into blocking.ts grant path — _injectImg() fire-on-grant
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["002"]
complexity: 5
prd_refs:
  - "prd.md §3.2"
  - "goals.md §What ships in v6 — <img> beacon pixel auto-block"
arch_refs:
  - "architecture.md §3 Sync vs async work"
test_refs: []
research_refs:
  - "research/existing-codebase-archaeologist.md §Findings 3; Gotchas"
  - "research/runtime-interception-domain-expert.md §Findings 2"
  - "research/_index.md §Update — Author decisions (E)"
acceptance_criteria:
  - "Held <img> pixels from task 002 are enqueued into the EXISTING blocking.ts category-keyed queue via enqueueAutoDetected() (its signature + QueueEntry.el union extended to include HTMLImageElement) — re-using the proven engine, not a parallel one [archaeologist §3]."
  - "A new _injectImg() in blocking.ts fires the pixel on consent grant by assigning the stored src in place (mirroring _injectIframe's data-src promotion), with NO clone-and-reinsert — the fire-and-forget GET needs no execution/replay [runtime §2]. grant() gains an `else if (el.tagName === 'IMG')` branch dispatching to it."
  - "_injectImg sets data-cookyay-state=\"executed\" on the <img> BEFORE assigning src (defensive re-interception guard, mirroring _injectScript) so the now-active <img> proxy from task 002 does not re-hold the element during injection [archaeologist Gotcha]."
  - "Fire-once-on-grant semantics: the pixel fires exactly once when its category is granted on the same page; if the page navigates away before consent, the pixel is never fired (correct — no replay on a later visit) [runtime §2; decision E]. The fire occurs synchronously enough for analytics accuracy while honoring the existing setTimeout(fn,0) INP-stagger posture [architecture.md §3]."
  - "Declared-wins precedence holds: an <img> already attributed by the declarative engine is not double-processed by auto-block; consent withdrawal surfaces the same posture as other third parties. Covered by a test where a pixel is both declared and DB-matched and is handled exactly once."
  - "A browser-mode test asserts a granted auto-detected pixel actually issues its request (src promoted); `pnpm --filter cookyay test` and `pnpm test` green."
created: 2026-06-11
---

## Task
Connect the held `<img>` pixels from task 002 to the existing consent grant/inject
engine so a blocked pixel fires once when its category is consented. Unlike scripts
(clone-and-reinsert) and iframes (data-src promote with execution), a pixel is a
fire-and-forget GET — the release mechanism is simply assigning the stored `src` to
the held `<img>` [research/runtime-interception-domain-expert.md §2]. Reuse
`blocking.ts`'s queue rather than building a parallel path.

## Implementation notes
- `packages/cookyay/src/blocking.ts`: add `_injectImg()` modeled on `_injectIframe()`
  (~line 247–260); add the `IMG` branch to the `grant()` dispatcher (~line 174–198);
  widen `enqueueAutoDetected()` and `QueueEntry.el` unions to include `HTMLImageElement`.
- `autoblock-wire.ts` enqueues held pixels for `<img>` exactly as it does iframes
  (data-src storage path + `_enqueue()` call are identical) [archaeologist §3].
- Set `data-cookyay-state="executed"` before `img.src=` to avoid the active proxy
  re-holding it (the proxy exists after task 002).

## Out of scope
- Proxy interception / `new Image()` (task 002).
- DB entries (task 001), diagnostic (task 004), e2e fixtures (task 005).
- Changing declared-element behavior or the scanBlocked registration path.

## Implementation summary

**Files changed:**
- `packages/cookyay/src/blocking.ts` — Already contained the `_injectImg()` function, `IMG` branch in `grant()`, and `HTMLImageElement` in `QueueEntry.el` and `enqueueAutoDetected()` unions (added by task 002 for type coherence). No additional changes to this file were needed for task 003's functional implementation — it was complete.
- `packages/cookyay/src/autoblock-wire.test.ts` — Added `makeHeldImg()` helper function. Added 14 new `<img>` pixel tests covering AC1–AC5: enqueue stores data-src on img, grant schedules setTimeout(fn,0), img src promoted in-place (no clone), STATE_EXECUTED set on inject, fire-once idempotency, wrong-category does not release, declared-wins precedence tests (proxy skips STATE_BLOCKED img, double-enqueue handled exactly once). Added two full-proxy integration tests (createElement+.src= path and `new Image()` path) for the end-to-end flow.
- `packages/cookyay/src/blocking.browser.test.ts` — Added import of `STATE_BLOCKED` and `enqueueAutoDetected`. Added a new describe block "auto-detected img pixel — src promoted in real browser (task 003 AC6)" with 4 real-Chromium tests: src promoted after marketing grant, no clone created (in-place inject), STATE_EXECUTED set after grant, fire-once semantics on repeat grant.

**Acceptance criteria check:**
- [x] AC1 — `enqueueAutoDetected()` accepts `HTMLImageElement` (`blocking.ts:320`); `QueueEntry.el` union includes `HTMLImageElement` (`blocking.ts:38`). Tested by `autoblock-wire.test.ts` "stores the captured src as data-src on a held <img> pixel element" and integration tests.
- [x] AC2 — `_injectImg()` (`blocking.ts:279-290`) promotes data-src to src in-place with NO clone. `grant()` dispatches to it via `else if (el.tagName === 'IMG')` (`blocking.ts:193-196`). Tested by "a held <img> pixel is enqueued and its data-src is promoted to src after grant" and "<img> is NOT cloned — in-place src promotion".
- [x] AC3 — `_injectImg` sets `STATE_EXECUTED` at `blocking.ts:283` BEFORE assigning src at `blocking.ts:288`. Tested by "grant sets data-cookyay-state='executed' on the held <img> BEFORE src is assigned" and the browser-mode "_injectImg sets STATE_EXECUTED before src assignment".
- [x] AC4 — Fire-once semantics via `setTimeout(() => _injectImg(img), 0)` (`blocking.ts:196`). Tested by "<img> pixel injection is idempotent — a second grant does NOT re-fire the pixel" (jsdom) and "pixel fires exactly once on grant — fire-once semantics" (browser mode).
- [x] AC5 — Declared-wins: `_holdElement()` skips elements with STATE_BLOCKED (`autoblock-proxy.ts:151`). Three tests in the AC3 describe block in `autoblock-wire.test.ts`: "AC5 — an <img> pixel that is both declared AND DB-matched is handled exactly once (declared wins)", "AC5 — declared-then-auto: _holdElement skips an <img> with STATE_BLOCKED", "AC5 — pixel declared AND auto-detected is not double-processed: grant fires exactly once".
- [x] AC6 — Four browser-mode tests in `blocking.browser.test.ts` (describe "auto-detected img pixel — src promoted in real browser") assert `img.src` contains the pixel URL after `grant()` in real Chromium. `pnpm --filter cookyay test` passes 490 unit tests; `pnpm test` passes 840 total tests (18 files).

**Tests:** `pnpm --filter cookyay exec vitest run` (490 tests, all passing); `pnpm --filter cookyay exec vitest run --config vitest.browser.config.ts` (27 tests, all passing); `pnpm test` (840 tests, all passing)

**Notes for verifier:**
- The core functional implementation (`_injectImg()`, `IMG` branch in `grant()`, `HTMLImageElement` in unions) was already present in `blocking.ts` when task 003 began — it was added by task 002 for TypeScript type coherence as documented in task 002's implementation summary. Task 003's contribution is the comprehensive test coverage proving the implementation is correct end-to-end: jsdom unit tests (AC1–AC5) and real-browser tests (AC6).
- The `autoblock-wire.test.ts` test "AC5 — pixel declared AND auto-detected is not double-processed: grant fires exactly once" enqueues the same img twice (simulating double-detection). The second `enqueueAutoDetected` call adds a second entry to the queue. Both `grant()` attempts will fire `setTimeout(_injectImg, 0)`, but the second `_injectImg()` call sees `STATE_EXECUTED` (set by the first) and returns early — net result is exactly one src promotion. This is the idempotency guard at `blocking.ts:280`.
- Browser tests assert `img.src` using `toContain('facebook.com/tr')` because real Chromium normalises the src to a full absolute URL; the pixel URL is set correctly.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All six acceptance criteria pass with real evidence; `_injectImg` correctly mirrors `_injectIframe` (in-place src promotion, no clone) and sets STATE_EXECUTED before src per archaeologist Gotcha; full suite (840 tests) green.
**Acceptance criteria check:**
- [x] AC1 (enqueue via existing engine, unions widened) — `blocking.ts:38` (`QueueEntry.el` includes `HTMLImageElement`), `blocking.ts:320` (`enqueueAutoDetected` param union); tested by `autoblock-wire.test.ts` "stores the captured src as data-src on a held <img> pixel element" + integration tests.
- [x] AC2 (in-place src promotion, no clone; grant IMG branch) — `_injectImg` `blocking.ts:279-290` promotes `data-src→src` with no clone; `grant()` IMG branch `blocking.ts:193-196`; tested by "<img> is NOT cloned — in-place src promotion" (jsdom) + "no new <img> element is created" (browser).
- [x] AC3 (STATE_EXECUTED before src) — set at `blocking.ts:283`, src assigned at `blocking.ts:288`; tested in jsdom + browser ("_injectImg sets STATE_EXECUTED before src assignment").
- [x] AC4 (fire-once on grant) — `setTimeout(()=>_injectImg(img),0)` `blocking.ts:196` + idempotency guard `blocking.ts:280`; tested by "<img> pixel injection is idempotent — a second grant does NOT re-fire" (jsdom) + "pixel fires exactly once on grant" (browser).
- [x] AC5 (declared-wins / handled exactly once) — `_holdElement` skips STATE_BLOCKED (`autoblock-proxy.ts`); three AC5 tests in `autoblock-wire.test.ts` confirm single processing including double-enqueue → exactly one src promotion.
- [x] AC6 (browser test asserts request issued via src promotion) — 4 real-Chromium tests in `blocking.browser.test.ts` "auto-detected img pixel — src promoted in real browser"; all green.
**Tests:** unit 490/490; cookyay browser 27/27 (blocking.browser 16/16); full monorepo `pnpm test` 840/840. No scope drift: changes stay within blocking.ts inject path + tests; proxy/`new Image()` interception is task 002's pre-placed work, declared-element path untouched.
