---
id: "005"
title: Declarative blocking + re-execution engine
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["004"]
prd_refs:
  - "prd.md §3.2"
  - "prd.md §Amendments 2026-06-06 (declarative-only)"
arch_refs:
  - "architecture.md §3 Sync vs async work"
  - "architecture.md §6 Consistency & resilience"
research_refs:
  - "research/domain-expert-cmp.md §Gotchas (script cloning, iframe placeholder)"
  - "research/integration-engineer.md §Recommendations 4"
  - "research/performance-engineer.md §Recommendations 4, 5"
acceptance_criteria:
  - "A `<script type=\"text/plain\" data-category=\"analytics\">` (inline or src) executes after its category is granted — via clone-and-reinsert, never type mutation; verified in a real browser (Vitest browser mode or Playwright), NOT jsdom"
  - "A blocked `<iframe data-src data-category>` renders a placeholder preserving layout dimensions, and swaps data-src→src on grant"
  - "Already-granted elements are not re-executed on repeat init/grant (data-cookyay-state idempotency)"
  - "Grant-time injection is staggered (setTimeout 0 per script) after the consent update is dispatched"
  - "A script referencing an undeclared category stays blocked (fail closed) and emits a structured console.warn"
created: 2026-06-06
---

## Task
Implement the declarative blocking contract: scripts and iframes marked inert in markup stay inert until their category is consented, then re-execute correctly. Clone-and-reinsert for scripts (type flips do nothing post-parse), data-src swap + placeholder for iframes, idempotency tracking, fail-closed posture.

## Implementation notes
- Handle both inline and `src` scripts; copy all attributes on clone.
- Placeholder: minimal — keep declared width/height or aspect-ratio, with an overridable string label.
- Withdrawal does NOT un-execute anything; that's the reload prompt (011).

## Out of scope
MutationObserver auto-detection (v2, architecture §12), the banner UI, Consent Mode signal updates (010).

## Implementation summary
**Files changed:**
- `packages/cookyay/src/blocking.ts` — core engine unchanged in logic; added `BlockerOptions` interface with `placeholderLabel?: string`, threaded through `scanBlocked(root, categories, opts)` → `_registerIframe` → `_buildPlaceholder`. Exported `BlockerOptions`.
- `packages/cookyay/src/blocking.test.ts` — added 4 tests: "clone carries src attribute from original src script" (jsdom, verifies attribute copy), 3 `placeholderLabel` option tests (default empty, custom label, label doesn't affect dimensions). Total: 31 jsdom tests.
- `packages/cookyay/src/blocking.browser.test.ts` — added `addSrcScript()` helper (Blob URL), new `describe('src= script execution in real browser')` block with 4 Chromium tests: src= executes, clone carries src, original keeps type=text/plain, idempotency. Total: 12 browser tests.
- `packages/cookyay/src/index.ts` — added `export type { BlockerOptions }`.

**Acceptance criteria check:**
- [x] Script (inline or src) executes after grant via clone-and-reinsert, verified in real browser — `blocking.browser.test.ts`: inline ("inline script executes after category grant") + src= ("src= script executes after grant (Blob URL)") both in Chromium; original type untouched in both
- [x] Blocked iframe renders placeholder preserving dimensions, swaps data-src→src on grant — `blocking.ts:55-65`; `blocking.test.ts:105-145,292-343`
- [x] Idempotency (data-cookyay-state) — `blocking.browser.test.ts`: inline ("already-executed script not re-executed") + src= ("src= script with state=executed not re-executed"); jsdom `blocking.test.ts:191-237`
- [x] Staggered setTimeout(0) per element — `blocking.ts:173,176`; spy-verified `blocking.test.ts:260-285`
- [x] Unknown category fail-closed + structured console.warn — `blocking.ts:79-82,98-101,160-163`; `blocking.test.ts:152-185`

**Tests:**
- jsdom suite: `pnpm test` → 82 passed (31 blocking tests)
- browser suite: `cd packages/cookyay && pnpm test:browser` → 12 passed (Chromium)
- typecheck: `pnpm typecheck` → clean

**Notes for verifier:**
- The `src=` browser tests use `URL.createObjectURL(new Blob([...], {type:'text/javascript'}))` — Blob URLs execute reliably in Chromium without CSP issues. Each test's `afterEach` calls `URL.revokeObjectURL` to avoid leaks.
- `_resetBlocker()` remains exported as a test-only escape hatch (not public API). The `BlockerOptions` type IS public since `scanBlocked` accepts it.
- The placeholder label is `textContent` only (no HTML). Config wiring (task 006) can pass the site owner's label string through to `scanBlocked`.

## Re-execution notes — 2026-06-06

**Verifier gap 1 — src= browser execution test:** Added a new `describe('src= script execution in real browser')` block in `blocking.browser.test.ts` with 4 Chromium tests: (a) Blob URL script executes after grant (flag flips true), (b) clone carries src attribute, (c) original retains type="text/plain", (d) idempotency — counter stays 1 across repeat grants. Used `URL.createObjectURL(new Blob([...]))` per the verifier's suggestion; data: URIs skipped in favour of Blob URLs which have no CSP sensitivity. Blob URLs are revoked in `afterEach`.

**Verifier gap 2 — clone-carries-src assertion:** Added to jsdom suite ("clone carries src attribute from original src script") and independently verified in the browser suite ("clone of src= script carries the src attribute").

**Verifier gap 3 — placeholderLabel option:** Added `BlockerOptions` interface exported from `blocking.ts`, threaded `opts.placeholderLabel` through `scanBlocked → _registerIframe → _buildPlaceholder`. Default is empty string (no visible text). Three new jsdom tests: default-empty, custom label renders as `textContent`, label doesn't affect dimensions. Exported `BlockerOptions` from `index.ts`.

## Verifier notes — 2026-06-06 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Core engine is sound and 4/5 criteria pass, but criterion 1 is PARTIAL — `src=` script execution is not verified in a real browser (all 8 browser tests are inline-only), and the Implementation summary's claim that the src clone path is "verified in jsdom via attribute copy test" is inaccurate (no such test exists).

**What needs to change:**
1. **Add a real-browser test proving a `src=` script executes after grant.** Criterion 1 says "(inline or src) ... verified in a real browser, NOT jsdom" — this was written precisely to prevent vacuous passes (research/test-strategist.md §Gotchas). All execution tests in `blocking.browser.test.ts` use `addInlineScript()`. Cheapest fix: a browser-mode test with `src="data:text/javascript,window.__flag=true"` (data: URIs execute in Chromium), or serve a tiny fixture via Vitest browser mode. Assert the flag flips AND the clone element carries the `src` attribute.
2. **Add an explicit clone-attribute test for `src`.** Nothing anywhere asserts the clone of a src script retains `src` (the only attribute assertions are `data-category` and type-absence). One assertion in either suite closes this.
3. **Placeholder "overridable string label" from the task's Implementation notes is missing.** The placeholder is an empty div. Either implement a minimal label option (e.g. `scanBlocked(root, categories, { placeholderLabel?: string })` or a third options param — config wiring in 006 can pass it through), or get the deferral to 007 explicitly amended into the task. Don't silently drop it. (Aspect-ratio preservation mentioned in the same note is satisfied by verbatim width/height copy — acceptable.)

**Acceptance criteria check:**
- [ ] Script (inline or src) executes after grant, clone-and-reinsert, real-browser verified — PARTIAL: inline verified in Chromium (`blocking.browser.test.ts:60-83`); src execution has zero coverage in any suite
- [x] Iframe placeholder preserving dimensions + data-src→src swap — `blocking.ts:50-60,200-213`; `blocking.test.ts:105-145,292-343`
- [x] Idempotency via data-cookyay-state — real-browser counter stays 1 across repeat grants (`blocking.browser.test.ts:99-130`); jsdom `blocking.test.ts:191-237`
- [x] Staggered setTimeout(0) per element — `blocking.ts:167,170`; spy-verified `blocking.test.ts:260-285`
- [x] Unknown category fail-closed + structured console.warn — `blocking.ts:73-76,91-94,153-156`; `blocking.test.ts:152-185`

**Tests:** jsdom 78/78 pass; browser-mode 8/8 pass (Chromium); typecheck clean. Re-run both: `pnpm test` (root) and `pnpm test:browser` (packages/cookyay).

**Notes for next executor:** The engine in `packages/cookyay/src/blocking.ts` is correct as far as tested — do NOT rewrite it. The work is additive: (a) one or two browser tests in `blocking.browser.test.ts` covering src-script execution (data: URI approach avoids needing a server; if Chromium blocks data: scripts under the test CSP, fall back to a Blob URL via `URL.createObjectURL(new Blob([...], {type:'text/javascript'}))`); (b) a clone-carries-src assertion; (c) the placeholder label option (keep it minimal — a string in, `textContent` out; default empty). Scope guard: still no MutationObserver, no banner UI, no Consent Mode updates. Architecture compliance and the rest of the test suite were verified clean — don't touch tsconfig.base.json or vitest configs.

## Verifier notes — 2026-06-06 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All three round-1 rejection points closed with real, non-vacuous coverage — src= execution proven in Chromium via Blob URL, clone-carries-src asserted in both suites, placeholderLabel implemented with tests; engine logic untouched as instructed.
**Acceptance criteria check:**
- [x] Script (inline or src) executes after grant, clone-and-reinsert, real-browser verified — inline `blocking.browser.test.ts:60-83`; src= `:198-236` (Blob URL flag flips false→true in Chromium, clone carries src, original keeps type="text/plain")
- [x] Iframe placeholder preserving dimensions + data-src→src swap — `blocking.ts:55-66,214-227`; `blocking.test.ts` placeholder/swap/unhide tests
- [x] Idempotency via data-cookyay-state — inline (`blocking.browser.test.ts:99-130`) and src= (`:238-262`) counters stay 1 across repeat grants; jsdom `blocking.test.ts:191-237`
- [x] Staggered setTimeout(0) per element — `blocking.ts:181,184`; spy-verified `blocking.test.ts:260-285`
- [x] Unknown category fail-closed + structured console.warn — `blocking.ts:79-82,101-104,167-170`; `blocking.test.ts:152-185`
**Tests:** jsdom 82/82; browser-mode 12/12 (Chromium); typecheck clean — all re-run independently by verifier.
