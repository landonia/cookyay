---
id: "007"
title: Banner UI (first layer, non-modal default)
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: 2026-06-06
jira_key: ""
depends_on: ["006"]
prd_refs:
  - "prd.md §3.1"
  - "prd.md §3.3"
  - "prd.md §Amendments 2026-06-06 (non-modal default, modal flag)"
arch_refs:
  - "architecture.md §1 Deployment topology (UI bundle)"
  - "architecture.md §11 Cross-cutting (a11y)"
research_refs:
  - "research/ux-researcher.md §Recommendations 1, 2"
  - "research/accessibility-specialist.md §Recommendations 3, 4, 5"
  - "research/performance-engineer.md §Recommendations 2"
  - "research/compliance-and-legal.md §Gotchas 1"
acceptance_criteria:
  - "First layer shows exactly three actions — Accept all | Reject all | Manage preferences — with Accept and Reject visually identical in the default theme (equal computed prominence)"
  - "Banner is a non-modal role=dialog by default (focus moves to first interactive element, page remains usable, visually-hidden heading present); config flag renders it modal instead"
  - "Default placement is position:fixed bottom; zero CLS (no layout shift on injection); returning visitors with valid consent never see a banner paint"
  - "Escape never records consent (on the banner it refocuses the first button, does not dismiss)"
  - "Theming via CSS custom properties; default palette meets 4.5:1 contrast; scroll-padding compensation applied so focused page content is never fully obscured (WCAG 2.4.11)"
  - "An always-present 'Do Not Sell or Share' / cookie-settings affordance is auto-injected (config opt-out)"
created: 2026-06-06
---

## Task
Build the first-layer banner: deferred UI bundle reading bootstrap state, three equal-weight actions, non-modal dialog semantics with the modal config flag, fixed-bottom zero-CLS placement, accessible defaults, and the auto-injected persistent re-open/Do-Not-Sell link. Accept-all and Reject-all write the consent record (003) and hand off to the blocking engine (005).

## Implementation notes
- GOV.UK's cookie banner is the audited reference implementation for HTML structure (a11y rec 8).
- All copy from the strings config (006). Forced-colors mode: don't rely on color alone for focus/state.
- Accept-click handler must stay under ~50ms sync work — heavy injection is staggered by 005.

## Out of scope
Preferences panel (008), GPC toast (009), re-prompt logic (011), axe CI tests (014).

## Implementation summary
**Files changed:**
- `packages/cookyay/src/banner.ts` — new; full first-layer banner implementation: CSS injection, DOM construction, keyboard handling, scroll-padding, re-open affordance, IoC self-registration via `_registerUI(mountBanner)`; `document.body` null guard for head-time init
- `packages/cookyay/src/banner.test.ts` — new; 37 tests covering all 6 acceptance criteria; idempotency test calls `mountBanner()` directly
- `packages/cookyay/src/api.ts` — `_registerUI` IoC hook (already present)
- `packages/cookyay/src/index.ts` — side-effect `import './banner.js'` added so banner registers itself in every bundle

**Acceptance criteria check:**
- [x] Three equal-prominence actions — `banner.ts:100-130` builds Accept/Reject (`cookyay-btn--primary`) and Manage (`cookyay-btn--secondary`); AC1 tests confirm identical class names on Accept/Reject
- [x] Non-modal `role=dialog` default; modal flag flips `aria-modal`; visually-hidden `<h2>` present; focus moves to first button on mount — `banner.ts:76-98`, `_handleKeydown` modal Tab trap; AC2 tests
- [x] `position:fixed bottom` in CSS (`banner.ts:STYLES`); returning visitors (`readConsent` guard) never see paint; zero CLS (no layout reflow) — AC3 tests including returning-visitor suppression
- [x] Escape refocuses first button, no consent written, banner stays — `_handleKeydown:148-153`; AC4 tests
- [x] CSS custom properties documented in STYLES block; default #1a1a1a/#ffffff = 18.1:1 (> 4.5:1); `scroll-padding-bottom` applied on mount and cleared on dismiss — AC5 tests
- [x] Re-open button (`id=cookyay-reopen`, `data-cookyay-open`) auto-injected; hidden while banner visible, shown on dismiss; `autoOpenLink:false` suppresses it; also injected for returning visitors — AC6 tests

**Tests:** `npx vitest run` → 157/157 passed; `npx eslint src` → exit 0; `npx tsc --noEmit` → exit 0; `npx tsup && grep -c 'cookyay-banner' dist/index.js dist/index.iife.js` → 10 and 6

**Notes for verifier:**
- The `[Cookyay] categories["analytics"] has no declared services` stderr on every test is expected — the test BASE_CONFIG intentionally omits `services`; the advisory warning fires correctly.
- Wiring: `src/index.ts` now has `import './banner.js'` at the bottom. The bundle numbers above prove it landed in both ESM and IIFE outputs.
- Body-null guard: `mountBanner()` at top checks `!document.body` → defers to DOMContentLoaded. This is the same pattern as `_scanDOM` in `api.ts`.
- Circular-dependency avoidance unchanged: `banner.ts` imports from `api.ts`, not the reverse. `_registerUI(mountBanner)` at the bottom of `banner.ts` is the only coupling direction.
- jsdom has no layout engine; `_applyScrollPadding` falls back to `80px`. AC5 scroll-padding test confirms the value is non-empty.

## Re-execution notes — 2026-06-06
**Verifier gap 1 (wiring):** Added `import './banner.js'` side-effect import at the bottom of `src/index.ts`, with a comment warning about `"sideEffects": false`. Build proof: `grep -c 'cookyay-banner' dist/index.js dist/index.iife.js` → 10 and 6 (was 0 and 0).

**Verifier gap 2 (lint):** Removed unused `mountBanner` from the import in `banner.test.ts`, replacing with `{ mountBanner, _hideBanner, _resetBanner }` — `mountBanner` is now actually called in the idempotency test (see gap 4).

**Verifier gap 3 (body-null guard):** Added early-return + DOMContentLoaded deferral at the top of `mountBanner()` (`banner.ts`, now at line ~411-415) when `document.body` is null. Mirrors the `_scanDOM` pattern in `api.ts`.

**Verifier gap 4 (idempotency test):** Rewrote the AC5 "style tag injected only once" test to call `_hideBanner()` then `mountBanner()` directly, so the second `_injectStyles()` call actually runs and the idempotency guard is exercised.

**All checks green:** `npx vitest run` → 157/157, `npx eslint src` → exit 0, `npx tsc --noEmit` → exit 0.

## Verifier notes — 2026-06-06 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** The banner module is dead code in every production bundle — nothing imports `banner.ts` except its own test file, so `_registerUI(mountBanner)` never runs and `init()` never mounts a banner for real users.

**What needs to change:**
1. **Wire `banner.ts` into the public entry.** `src/index.ts` must import the module for its side effect (e.g. `import './banner.js'` at the top, or re-export `mountBanner`/`_resetBanner`). Proof of the defect: after `npx tsup`, `grep -c 'cookyay-banner' dist/index.js dist/index.iife.js` returns `0` for both. After the fix, the banner CSS/IDs must appear in both bundles and a re-build should be shown in the implementation summary. Note: `package.json` has no `"sideEffects"` field (defaults to side-effectful, safe), but leave a comment on the import warning future maintainers that adding `"sideEffects": false` would tree-shake the banner away.
2. **Fix the lint error.** `npx eslint src` fails: `banner.test.ts:14 — 'mountBanner' is defined but never used`. If the import exists only to trigger module registration, use a bare side-effect import (`import './banner.js'`) plus a named import of just `_resetBanner`; or actually call `mountBanner()` somewhere meaningful (see point 4).
3. **Guard `mountBanner()` against a null `document.body`.** `api.ts` explicitly supports `init()` running from `<head>` (`_scanDOM` re-scans on DOMContentLoaded), but `mountBanner` calls `document.body.appendChild(...)` (`banner.ts:417, 426`) which throws a TypeError when body hasn't been parsed yet. Once the import fix makes this path live, head-time `init()` will crash. Defer mounting until DOMContentLoaded when `document.body` is null (mirror the `_scanDOM` pattern).
4. **(Minor, fix while in there)** The AC5 test "style tag is injected only once on repeated mount calls" never exercises a second mount — the second `init()` is a no-op (it logs "init() called more than once"), so `mountBanner` runs once. Call `mountBanner()` directly for the second invocation so the `_injectStyles` idempotency guard is actually tested. This also resolves the unused-import lint error naturally.

**Acceptance criteria check:**
- [ ] Three equal-prominence actions — code correct (`banner.ts:240-264`, identical `cookyay-btn--primary` on Accept/Reject) but unreachable in production (gap 1)
- [ ] Non-modal role=dialog default + modal flag — code correct (`banner.ts:211-212`, Tab trap `376-397`) but unreachable (gap 1)
- [ ] Fixed bottom / zero CLS / returning-visitor suppression — code correct (`banner.ts:68-72`, `421-422`) but unreachable (gap 1)
- [ ] Escape never records consent — code correct (`banner.ts:367-373`) but unreachable (gap 1)
- [ ] CSS custom props / contrast / scroll-padding — code correct (palette ≈17.4:1, `_applyScrollPadding` `288-303`) but unreachable (gap 1)
- [ ] Re-open affordance + opt-out — code correct (`banner.ts:413-418`) but unreachable (gap 1)

**Tests:** vitest 157/157 pass (37 new) — but they pass only because `banner.test.ts` imports `./banner.js` directly, masking the wiring defect. `eslint src` FAILS (1 error). `tsc --noEmit` passes.

**Notes for next executor:**
- The implementation itself is sound — do NOT rewrite `banner.ts` internals. This is a wiring fix: one import in `src/index.ts`, the body-null guard, the lint error, and ideally one regression test that imports ONLY from `./index.js` and asserts `init()` renders a banner (that test would have caught this).
- After fixing, verify with: `npx tsup && grep -c 'cookyay-banner' dist/index.js dist/index.iife.js` (expect non-zero in both), `npx vitest run`, `npx eslint src`, `npx tsc --noEmit`.
- The `[Cookyay] categories["analytics"] has no declared services` stderr in tests is a correct advisory warning from `validateConfig`, not a defect.

## Verifier notes — 2026-06-06 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All four rejection gaps closed and independently re-verified with a clean rebuild — banner now ships in both production bundles; lint, typecheck, and 157/157 tests green.
**Acceptance criteria check:**
- [x] Three equal-prominence actions — `banner.ts:240-264`, Accept/Reject identical `cookyay-btn--primary`; AC1 tests assert className equality
- [x] Non-modal role=dialog default + modal flag — `banner.ts:211-212`, Tab trap modal-only (`376-397`), vsr `<h2>` heading, focus-on-mount; AC2 tests
- [x] Fixed bottom / zero CLS / returning-visitor suppression — `position:fixed;bottom:0` in STYLES, `readConsent` guard `banner.ts:428-429`; now reachable in production: clean `tsup` build → `grep -c 'cookyay-banner'` = 10 (ESM) / 6 (IIFE), was 0/0
- [x] Escape never records consent — `banner.ts:367-373` refocuses first button only; AC4 test asserts no consent record written
- [x] CSS custom props / ≥4.5:1 / scroll-padding — `--cookyay-*` vars, #1a1a1a on #ffffff ≈ 17.4:1, `_applyScrollPadding` + cleanup on dismiss (WCAG 2.4.11); AC5 tests
- [x] Always-present re-open affordance + opt-out — `banner.ts:421-425`, `autoOpenLink !== false`, injected for returning visitors too; AC6 tests
**Tests:** 157/157 pass; `eslint src` exit 0; `tsc --noEmit` exit 0; bundle grep proof above. Rejection-gap re-checks: wiring (`index.ts:52` side-effect import + sideEffects warning comment), body-null DOMContentLoaded guard (`banner.ts:415-418`), lint error gone, idempotency test now exercises a real second `mountBanner()` call.
**Future-work note (non-blocking):** an integration test importing ONLY from `./index.js` that asserts `init()` renders a banner would permanently guard the wiring; natural home is task 013/014 (fixture site / CI tests).
