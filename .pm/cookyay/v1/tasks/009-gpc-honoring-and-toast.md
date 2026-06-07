---
id: "009"
title: GPC honoring + confirmation toast
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: "2026-06-07"
jira_key: ""
depends_on: ["003", "007"]
prd_refs:
  - "prd.md §3.3"
  - "prd.md §Amendments 2026-06-06 (GPC toast)"
arch_refs:
  - "architecture.md §1 Deployment topology (bootstrap GPC detect)"
  - "architecture.md §13 Open questions (toast container)"
research_refs:
  - "research/compliance-and-legal.md §Recommendations 3; §Gotchas 2"
  - "research/ux-researcher.md §Recommendations 5; §Gotchas (GPC vs stored consent)"
  - "research/domain-expert-cmp.md §Recommendations 2"
acceptance_criteria:
  - "With navigator.globalPrivacyControl === true and no stored consent: non-necessary categories are denied, a consent record with gpc:true is stored, the opt-in banner is suppressed, and a visible dismissible confirmation toast announces the signal was honored (CCPA reg effective 2026-01-01)"
  - "A live GPC signal overrides a previously stored grant of marketing/analytics categories on page load (stored consent does not beat GPC)"
  - "If the stored record already reflects GPC opt-out, no toast re-appears on subsequent loads"
  - "Toast is accessible (announced via appropriate live region or focus strategy; dismissible by keyboard) and all its strings are config-overridable"
created: 2026-06-06
---

## Task
Complete the GPC story: the bootstrap (004) already reads the flag pre-render; this task implements the policy — deny non-necessary categories, record gpc:true, suppress the banner, override stale stored grants, and show the legally-required visible confirmation toast exactly once.

## Implementation notes
- ~10 lines of policy + a small toast component; keep it inside the UI bundle, not the bootstrap.
- Resolve architecture.md §13: decide toast container vs banner dialog container with an a11y eye; note the decision in the PR.

## Out of scope
The Do Not Sell link injection (done in 007), Consent Mode signal mapping (010 reads the resulting state).

## Re-execution notes — 2026-06-07
**Verifier note 1 addressed:** `setGpc` helper in `gpc.test.ts:30` — replaced the invalid double-cast with a direct assignment `window.__COOKYAY = { q: [], gpc: value }`, which satisfies the global type declaration from `bootstrap.ts` exactly.
**Verifier note 2 addressed:** teardown in `gpc.test.ts:62` — replaced `delete (window as ...)` with `Reflect.deleteProperty(window, '__COOKYAY')` to avoid the TS2790 error on a non-optional property.
`npx tsc --noEmit` now exits clean; all 216 tests still pass.

## Implementation summary
**Files changed:**
- `packages/cookyay/src/gpc.ts` — new module: GPC policy (reads `window.__COOKYAY.gpc` set by bootstrap), writes denied consent record with `gpc:true`, shows dismissible toast; registers via IoC pattern (`_registerGpcUI`)
- `packages/cookyay/src/api.ts` — added `_gpcHook` + `_registerGpcUI` export; calls `_gpcHook?.()` in `init()` before `_uiHook?.()` so the consent record is written before `mountBanner()` checks for existing consent
- `packages/cookyay/src/index.ts` — exported `_registerGpcUI`; added side-effect import `'./gpc.js'`
- `packages/cookyay/src/gpc.test.ts` — 23 new tests covering all 4 ACs

**Architecture §13 decision:** Separate toast container with `role="status"` + `aria-live="polite"` — NOT the banner's dialog container. The banner is a consent-choice dialog; the toast is a polite informational status message. Different semantics require different AT announcement behaviour.

**Acceptance criteria check:**
- [x] GPC active + no consent: non-necessary denied, `gpc:true` stored, banner suppressed, toast shown — `gpc.ts:_runGpc()` writes record before `mountBanner()` runs; tests in `AC1` group
- [x] Live GPC overrides stale stored grant — `alreadyGpc === false` path writes new record even when prior record exists; tests in `AC2` group
- [x] No toast re-shown when stored record already `gpc:true` — `alreadyGpc === true` early-return; tests in `AC3` group
- [x] Toast a11y: `role="status"`, `aria-live="polite"`, close button, Escape dismissal, all strings config-overridable — `gpc.ts:_buildToast()`; tests in `AC4` group

**Tests:** `pnpm vitest run src/gpc.test.ts` (23 tests) · Full suite: 216 tests, all passing.

**Notes for verifier:**
- The `_gpcHook` runs before `_uiHook` in `init()` — critical ordering so `mountBanner()` finds the already-written GPC consent record and returns early (banner suppression)
- Toast uses CSS custom properties (`--cookyay-*`) matching the banner, so it inherits any site theme overrides
- Escape key listener is scoped to toast lifetime (added on mount, removed on dismiss) — no global listener leak
- `_resetGpc()` exported for test teardown only, not in public API

## Verifier notes — 2026-06-07 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Implementation is functionally complete and all 4 ACs pass at runtime, but `tsc --noEmit` fails with 2 type errors in `src/gpc.test.ts` — this breaks the CI typecheck gate (architecture.md §9: lint + typecheck + unit on every push).

**What needs to change:**
1. `src/gpc.test.ts:30` — TS2322 in the `setGpc` helper: the double-cast `{ gpc: value, q: [] } as unknown as { gpc: boolean }` strips `q` from the type, which conflicts with the global `Window.__COOKYAY: { q: Element[]; gpc: boolean }` declaration from `bootstrap.ts`. Fix: drop the casts entirely and assign the correctly-shaped object — `window.__COOKYAY = { q: [], gpc: value }` (the global declaration from bootstrap.ts is already in scope via the project tsconfig).
2. `src/gpc.test.ts:62` — TS2790: `delete (window as Window & { __COOKYAY?: unknown }).__COOKYAY` fails because the global declaration makes `__COOKYAY` a required property (intersection with an optional doesn't make it optional). Fix: use `Reflect.deleteProperty(window, '__COOKYAY')` or cast through `Record<string, unknown>`.
3. Re-verify with: `npx tsc --noEmit` (must be clean), `npx eslint src` (clean), `npx vitest run` (216 tests green).

**Acceptance criteria check:**
- [x] GPC + no consent → denied categories, gpc:true record, banner suppressed, dismissible toast — `gpc.ts:140-168`, AC1 test group (5 tests pass)
- [x] Live GPC overrides stale stored grant — `gpc.ts:148` `alreadyGpc` check, AC2 test group (3 tests pass)
- [x] No toast re-shown when record already gpc:true — `gpc.ts:150-154`, AC3 test group (3 tests pass)
- [x] Toast a11y (role=status, aria-live=polite, Escape + click dismiss) + strings overridable — `gpc.ts:95-134`, AC4 test group (9 tests pass)

**Tests:** vitest 216/216 pass · eslint clean · build clean (combined ~8.5KB min+gzip, under budget) · **tsc --noEmit FAILS (2 errors)**

**Notes for next executor:**
- Only `src/gpc.test.ts` needs touching — `gpc.ts`, `api.ts`, and `index.ts` typecheck clean and are accepted as-is. Do not refactor them.
- Architecture §13 decision (separate `role="status"` toast container, not the banner dialog container) is sound and documented in the `gpc.ts` header comment — keep it.
- Non-blocking future-work observations (do NOT address in this task; surface to the user if relevant later):
  - `_runGpc()` reads only `window.__COOKYAY.gpc`; an ESM consumer calling `init()` without the inline bootstrap snippet would silently skip GPC honoring. A fallback read of `navigator.globalPrivacyControl` would harden the compliance path. Per the task body, GPC detection is scoped to the bootstrap (004), so this is not a rejection ground.
  - The toast is inserted into the DOM already populated; some screen readers don't announce pre-populated live regions. `role="status"` satisfies the AC as written ("appropriate live region"), and task 014 (a11y CI) can validate empirically.

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Both rejection points fixed exactly as prescribed (no-cast `window.__COOKYAY` assignment; `Reflect.deleteProperty` teardown); full CI gate now green and all 4 acceptance criteria verified passing.
**Acceptance criteria check:**
- [x] GPC + no consent → denied categories, gpc:true record, banner suppressed, dismissible toast — `gpc.ts:140-168`; AC1 test group (5 tests)
- [x] Live GPC overrides stale stored grant on page load — `gpc.ts:148` (`alreadyGpc` requires `existing.gpc === true`); AC2 test group (3 tests)
- [x] No toast re-shown when stored record already gpc:true — `gpc.ts:150-154` early return; AC3 test group (3 tests)
- [x] Toast accessible (role=status, aria-live=polite, Escape + click dismiss) + all strings config-overridable — `gpc.ts:95-134`; AC4 test group (9 tests)
**Tests:** 216/216 pass · tsc --noEmit clean · eslint clean · build clean, ~8.5KB min+gzip combined (under 20KB budget)
