---
id: 005
title: Wire auto-detected elements into blocking.ts grant/inject queue
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["004"]
complexity: 5
prd_refs:
  - "prd.md §3.2"
  - "goals.md §What ships in v5"
arch_refs:
  - "architecture.md §3 Sync vs async work"
test_refs: []
research_refs:
  - "research/existing-codebase-archaeologist.md §Findings"
  - "research/existing-codebase-archaeologist.md §Recommendations"
  - "research/_index.md §Update — Author decisions"
acceptance_criteria:
  - "Auto-detected (held) script/iframe elements from task 004 are enqueued into the EXISTING blocking.ts category-keyed queue and injected on consent grant via the same clone-and-reinsert / data-src-promote path as declared elements — re-using the proven engine, not a parallel one [research/existing-codebase-archaeologist.md]."
  - "Each auto-detected element is tagged with an observability marker (e.g. data-cookyay-autodetected / autoDetected flag) distinct from declared elements, without changing the declared-element behavior."
  - "Declared-wins precedence: an element that is already attributed by the declarative engine (has data-cookyay-state / data-category) is NOT double-processed by auto-block — covered by a test where the same script is both declared and DB-matched and is handled exactly once."
  - "Consent withdrawal surfaces the same 'reload required' posture as declared third parties (third-party script state cannot be cleared programmatically) — withdrawal of an auto-blocked category is handled consistently with the existing withdrawal flow."
  - "Injection is staggered via the existing setTimeout(fn,0) INP guard [architecture.md §3]; `pnpm --filter cookyay test` green including a test that a granted auto-detected script executes."
created: 2026-06-10
---

## Task
Task 004 holds matched elements inert; this task makes them *come alive on consent*
using the engine that already exists [prd.md §3.2]. The `blocking.ts` grant/inject
queue, clone-and-reinsert re-execution, iframe `data-src` promotion, withdrawal
prompt, and INP-staggered injection are all proven — auto-detected elements should
flow through the same path with only an `autoDetected` marker added for
observability and the "declared wins" precedence enforced
[research/existing-codebase-archaeologist.md §Recommendations]. This keeps
scan-time and run-time behavior consistent and avoids a second, divergent engine.

## Implementation notes
- Reuse `blocking.ts`: enqueue held elements by their matched category, inject on
  the category-grant event exactly as declared entries are injected.
- Precedence: before auto-processing, check for `data-cookyay-state` /
  `data-category` — if the declarative engine already owns the element, skip it.
- Add the `autoDetected` marker on the queue entry / element for debugging and for
  the e2e assertions in task 006.
- Withdrawal: route through the existing withdrawal/reload-prompt flow; do not try
  to programmatically unload an already-executed third party.

## Out of scope
- Installing/holding interception (task 004) — consumed here.
- New e2e fixtures (task 006) — though this task's unit tests should cover the
  grant-executes and declared-wins cases.
- Docs (task 009).

## Implementation summary

**Files changed:**
- `packages/cookyay/src/blocking.ts` — Three changes: (1) Added `ATTR_AUTO_DETECTED = 'data-cookyay-auto'` constant (mirrors the proxy constant; used to skip this attribute when copying to the live clone). (2) Modified `_injectScript()`: marks the live clone as `STATE_EXECUTED` BEFORE assigning its `src`, preventing the v5 runtime proxy from re-intercepting the injection itself; also added `data-src` and `data-cookyay-auto` to the skip list when copying attributes to the clone; added the auto-detected path: when `src` is absent but `data-src` is present on the original, the clone gets `src = data-src`. (3) Exported new `enqueueAutoDetected(el, src, category)` function: stores the captured URL as `data-src` on the element, then calls `_enqueue(category, {el, placeholder:null})` — wiring the held element into the exact same category-keyed queue as declared elements.
- `packages/cookyay/src/autoblock-proxy.ts` — Fixed a latent bug in both intercept paths (Phase 2 `setAttribute` override and `src` property setter trap): previously returned early WITHOUT forwarding `src` whenever `_matcher` returned a match, regardless of whether `_holdElement` actually accepted the element. Now checks `_holdElement`'s return value: if it returns `false` (element already STATE_EXECUTED — e.g. the injection clone), the proxy falls through and forwards the src to the real setter. This prevents the proxy from silently re-intercepting live injection clones.
- `packages/cookyay/src/api.ts` — Two changes: (1) Imported `enqueueAutoDetected` and `getHeldElements` (already imported `activateMatcher`, `installAutoBlockProxy`, `_resetAutoBlockProxy`). (2) Added `_enqueueHeldElements()` private function that splices the held queue and calls `enqueueAutoDetected()` for each element; wired it into Phase 2 (after `activateMatcher()` resolves in the `import('./autoblock-loader.js').then(...)` callback), followed by `_replayStoredGrants()` so already-consented categories release their auto-detected elements immediately.
- `packages/cookyay/src/autoblock-wire.test.ts` — New test file (32 tests in 7 describe blocks) covering all 5 acceptance criteria: direct `enqueueAutoDetected()` unit tests; AC1 grant/inject path (scripts + iframes); AC2 observability marker; AC3 declared-wins precedence (proxy skip + enqueue idempotency); AC4 withdrawal posture consistency via preferences.ts; AC5 INP stagger + live-clone execution test; Integration end-to-end proxy→enqueue→grant→inject.

**Acceptance criteria check:**
- [x] AC1 (auto-detected elements enqueued into EXISTING blocking.ts queue, injected via same clone-and-reinsert / data-src-promote path) — `blocking.ts:enqueueAutoDetected()` calls `_enqueue()` (the same `_q` map); `grant()` processes via unchanged `_injectScript()`/`_injectIframe()`. Tests: "a held script is enqueued and a clone is inserted after grant", "a held iframe is enqueued and its data-src is promoted to src after grant", Integration suite.
- [x] AC2 (observability marker `data-cookyay-auto` distinct from declared elements, declared behavior unchanged) — `_holdElement()` (task 004) sets `data-cookyay-auto="true"`; `scanBlocked()` never sets it; `_injectScript()` skips it when copying to clone. Tests: "AC2 — observability marker" suite (4 tests), all 433 prior tests still pass.
- [x] AC3 (declared-wins: same element both declared and DB-matched handled exactly once) — `_holdElement()` returns `false` for STATE_BLOCKED elements; test covers this exact case. Tests: "AC3 — declared-wins" suite (4 tests) including "declared element remains in the blocking queue (not evicted) when proxy skips it" asserting single `setTimeout` call.
- [x] AC4 (withdrawal posture consistent with declared third parties) — auto-detected elements flow through the same `grant()` path; `preferences.ts` compares new choices against the prior consent record regardless of element origin. Tests: "AC4 — withdrawal posture consistent" suite (3 tests).
- [x] AC5 (injection staggered via `setTimeout(fn,0)`; test that a granted auto-detected script executes) — `grant()` unchanged: `setTimeout(fn, 0)` per element. Tests: "grant schedules exactly one setTimeout(fn, 0) per auto-detected element", "a granted auto-detected script results in a live clone being inserted (AC5: executes)", "injection does not happen synchronously".

**Tests:** `pnpm --filter cookyay typecheck && pnpm --filter cookyay exec vitest run` — 465/465 pass (32 new in `autoblock-wire.test.ts`); typecheck clean.

**Notes for verifier:**
- The key design decision: `enqueueAutoDetected()` stores the captured URL as `data-src` on the element (unified for both scripts and iframes). This lets `_injectIframe()` work unchanged (it already promotes `data-src → src`), and lets `_injectScript()` detect the auto-detected path via `!hasSrc && dataSrc`.
- A subtle but important fix was required in `autoblock-proxy.ts`: the Phase 2 intercept paths previously returned early without forwarding `src` whenever the matcher returned a match, even if `_holdElement` rejected the element (already STATE_EXECUTED). This would have caused live injection clones (created by `_injectScript` via `document.createElement('script')`) to be re-intercepted and re-held silently. The fix: check `_holdElement`'s boolean return value; only skip the real src assignment if the element was actually held. The corresponding fix in `blocking.ts`: mark the clone as `STATE_EXECUTED` before assigning its src, so `_holdElement` returns `false` immediately for it.
- `_enqueueHeldElements()` splices from the live `_held` array (not a copy). This ensures `_resetAutoBlockProxy()` in test teardown sees an empty array. After splicing, the held queue is empty — any further `activateMatcher`-sourced elements would arrive via the same callback path.
- The `_replayStoredGrants()` call after `_enqueueHeldElements()` handles returning visitors who already consented: their auto-detected elements are enqueued and immediately granted in the same microtask tick.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Auto-detected elements are wired into the existing `blocking.ts` category-keyed queue via `enqueueAutoDetected()`, reusing the unchanged `grant()`/`_injectScript()`/`_injectIframe()` engine; all 5 ACs verified by real, asserting tests; 465/465 pass, typecheck clean.
**Acceptance criteria check:**
- [x] AC1 (enqueued into EXISTING queue, injected via same clone-and-reinsert / data-src-promote path) — `enqueueAutoDetected()` (`blocking.ts:289`) stores src as `data-src` then calls the same `_enqueue()` (`_q` map); `grant()` drains via unchanged `_injectScript()`/`_injectIframe()`. Verified by the AC1 suite and the Integration suite (`autoblock-wire.test.ts:666,698,724`) where a live proxy intercepts → enqueue → grant → clone is inserted. Re-uses the proven engine, no parallel one.
- [x] AC2 (observability marker `data-cookyay-auto` distinct, declared behavior unchanged) — `_holdElement()` sets `data-cookyay-auto="true"`; `scanBlocked()` never sets it; `_injectScript()` skips the attr when copying to the live clone (`blocking.ts:226`). AC2 suite (4 tests) confirms declared elements + clones lack the marker; full suite green (declared path unchanged).
- [x] AC3 (declared-wins, same element handled exactly once) — `_holdElement()` returns `false` when `data-cookyay-state===STATE_BLOCKED` (`autoblock-proxy.ts:148`); AC3 suite (4 tests) asserts the proxy skips a declared+matched element (held queue length 0) and only one `setTimeout` fires.
- [x] AC4 (withdrawal posture consistent with declared third parties) — auto-detected elements flow through the same `grant()`/preferences withdrawal path. AC4 suite (3 tests) uses real `init()` + `mountPreferences()`, clicks the analytics switch + save, and asserts the real `#cookyay-withdrawal-toast` appears — genuine integration, not a stub.
- [x] AC5 (INP stagger via `setTimeout(fn,0)`; granted auto-detected script executes) — `grant()` schedules one `setTimeout(...,0)` per element (unchanged). AC5 suite asserts exactly one timer per element with delay 0, injection not synchronous, and a live clone (`src` set, no `type`, no `data-cookyay-auto`, `state=executed`) is inserted.
**Tests:** 465/465 pass (`vitest run`), incl. 32 new in `autoblock-wire.test.ts`; typecheck clean. Task 004's proxy suite grew 47→58 and stays green — the surfaced-and-justified `_holdElement` return-value fix in `autoblock-proxy.ts` (prevents re-interception of live injection clones) is covered, not a regression.
