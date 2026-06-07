---
id: "008"
title: Preferences modal (focus trap, switches)
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["007"]
prd_refs:
  - "prd.md §3.1"
  - "prd.md §Amendments 2026-06-06"
arch_refs:
  - "architecture.md §11 Cross-cutting (a11y)"
research_refs:
  - "research/accessibility-specialist.md §Recommendations 1, 2, 7; §Gotchas (aria-modal, focus return)"
  - "research/ux-researcher.md §Gotchas (necessary toggle)"
acceptance_criteria:
  - "Preferences panel is a modal dialog with a real JS focus trap (Tab/Shift-Tab intercepted — aria-modal alone is not a trap); focus returns to the invoking element on close, or document.body when opened on load"
  - "Category toggles use role=switch with aria-checked; 'necessary' renders as locked-on static state (lock affordance, NOT a disabled checkbox) and is still announced to screen readers"
  - "Escape closes the panel without saving any consent change"
  - "Save action persists the granular choices via the consent core and triggers grant flows; per-category service lists render from config"
  - "Keyboard-only walkthrough (open → toggle → save → focus restored) passes in a browser-mode test"
created: 2026-06-06
---

## Task
Build the second layer: the focus-trapped preferences modal with granular category switches. This is where most CMP a11y audits fail (role=switch misuse, fake focus traps, disabled-checkbox "necessary" rows), so the acceptance criteria encode the audit findings directly.

## Implementation notes
- Fieldset/legend grouping if sub-controls exist; all strings overridable (006).
- Opens from: banner's Manage preferences, openPreferences(), data-cookyay-open, the auto-injected link.

## Out of scope
Withdrawal reload prompt (011), GPC toast (009), axe CI wiring (014).

## Implementation summary
**Files changed:**
- `packages/cookyay/src/preferences.ts` — new; full preferences modal: CSS injection, DOM construction (role=dialog/aria-modal=true, role=switch toggles, necessary locked-static, per-category service lists), real JS focus trap (Tab/Shift-Tab intercepted on `_handleModalKeydown`), Escape closes without saving, Save path calls `_recordConsent` + `grant()` for enabled categories, focus returns to opener or `document.body`; IoC self-registration via `_registerPreferencesUI(mountPreferences)`
- `packages/cookyay/src/preferences.test.ts` — new; 36 jsdom tests covering AC1–AC4 (focus trap, switch semantics, Escape, Save, service lists, string overrides, idempotency, opener focus return, `openPreferences()` integration)
- `packages/cookyay/src/preferences.browser.test.ts` — new; 5 Chromium browser-mode tests covering AC5 keyboard walkthrough (focus on mount, Tab wrap, Shift+Tab wrap, Escape-without-save, full open→toggle→save→focus-returned walkthrough)
- `packages/cookyay/src/api.ts` — added `_preferencesHook` singleton, `_registerPreferencesUI(hook)` export, updated `openPreferences()` to call `_preferencesHook?.(document.activeElement)` before dispatching the event (hook is null in contexts that don't import preferences.ts, so all existing banner tests pass unchanged)
- `packages/cookyay/src/index.ts` — added side-effect `import './preferences.js'` and exported `_registerPreferencesUI`

**Acceptance criteria check:**
- [x] Real JS focus trap (Tab/Shift-Tab intercepted, aria-modal alone is not a trap) — `preferences.ts:_handleModalKeydown` (Tab/Shift-Tab intercept), listener attached to `_modalEl`; AC1 tests + browser walkthrough test confirm `preventDefault` called and `activeElement` moves
- [x] Focus returns to invoking element on close, or document.body — `_closeModal()` calls `(openerEl as HTMLElement).focus?.()` when opener provided, else `document.body.focus()`; "focus returns to opener" tests confirm
- [x] Category toggles use role=switch with aria-checked — `preferences.ts:_buildCategorySection` builds `<button role="switch" aria-checked="...">` for functional/analytics/marketing; 3 switch tests confirm
- [x] necessary renders as locked-on static state (lock 🔒 affordance, NOT a disabled checkbox); still announced to SR — lock icon has `aria-hidden="true"` (decorative), "Always active" text span is readable; `cookyay-cat-necessary` label in DOM; no `data-cookyay-switch="necessary"`; tests confirm
- [x] Escape closes the panel without saving — `_handleModalKeydown` Escape branch calls `_closeModal()` without calling `_recordConsent`; tests confirm `readConsent()` remains null
- [x] Save action persists granular choices via consent core and triggers grant flows — `_handleSave()` reads switch states, calls `_recordConsent(choices)`, calls `grant(cat)` for enabled categories, then closes; tests confirm correct record written and `cookyay:consent` dispatched
- [x] Per-category service lists render from config — `_buildCategorySection` appends `<ul class="cookyay-prefs__services">` when `catConfig.services?.length > 0`; service list test confirms GA4/Pixel/etc. render
- [x] Keyboard-only walkthrough (open → toggle → save → focus restored) passes in a browser-mode test — `preferences.browser.test.ts` "complete walkthrough" test covers full path in real Chromium

**Tests:** `npx vitest run` → 193/193 passed (36 new jsdom); `npx vitest run --config vitest.browser.config.ts` → 17/17 passed (5 new browser); `npx eslint src` → exit 0; `npx tsc --noEmit` → exit 0; `npx tsup && grep -c 'cookyay-preferences' dist/index.js dist/index.iife.js` → 1/1 (module ships in both bundles)

**Notes for verifier:**
- The `[Cookyay] categories["analytics"] has no declared services` stderr on banner tests is pre-existing (banner BASE_CONFIG omits services); it's the correct advisory warning.
- `openPreferences()` keeps dispatching `cookyay:open-preferences` for zero-coupling integrations (GTM). The banner "Manage fires cookyay:open-preferences" test still passes unchanged.
- When `preferences.ts` is NOT imported (e.g., in banner.test.ts), `_preferencesHook` is null and `openPreferences()` is a safe no-op (optional chaining). No banner tests break.
- Preferences modal z-index (`--cookyay-z` + 1 = 2147483647) sits one level above the banner (2147483646) so it overlays correctly.
- The `document.body.textContent = ''` in `preferences.browser.test.ts` avoids the innerHTML security note while still clearing the DOM.

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All 5 acceptance criteria verified against the actual code with independently re-run tests; implementation matches the a11y research (real JS trap, role=switch, lock-static necessary, Escape-never-consents) and stays in scope.
**Acceptance criteria check:**
- [x] Real JS focus trap + focus return — `preferences.ts:421-453` (`_handleModalKeydown` intercepts Tab/Shift-Tab with wrap + `preventDefault`; listener attached at mount `preferences.ts:509`); `_closeModal` (`preferences.ts:459-472`) restores focus to opener else `document.body`. Verified in jsdom (AC1 suite) and real Chromium (`preferences.browser.test.ts` wrap tests assert real `activeElement` movement).
- [x] role=switch with aria-checked; necessary locked-static, SR-announced — `preferences.ts:279-297` builds `<button role="switch" aria-checked>` for functional/analytics/marketing with config-overridable `aria-label`; necessary renders aria-hidden lock icon + readable "Always active" text (`preferences.ts:265-277`), no switch, no disabled checkbox. Tests confirm all of it.
- [x] Escape closes without saving — `preferences.ts:422-427` Escape → `_closeModal()` only; tests confirm `readConsent('v1')` stays null after toggling then Escape (also covered for close-button and backdrop paths).
- [x] Save persists via consent core + grant flows; service lists from config — `_handleSave` (`preferences.ts:397-419`) reads switch states → `_recordConsent` → `grant()` per enabled category (grant verified idempotent via `data-cookyay-state`, `blocking.ts:124`); `<ul class="cookyay-prefs__services">` renders from `categories[cat].services` (`preferences.ts:303-314`). `cookyay:consent` dispatch confirmed by test.
- [x] Keyboard walkthrough in browser-mode test — `preferences.browser.test.ts` "complete walkthrough" passes in real Chromium (17/17).
**Tests:** 193/193 jsdom + 17/17 Chromium browser-mode (re-run by verifier); `eslint` clean; `tsc --noEmit` clean; `tsup` build ships preferences in both ESM and IIFE bundles; `size-limit` 8.04 kB gzip of 20 kB budget, bootstrap 493 B of 1 kB.
**Non-blocking observations (future work, not defects):**
- AC5 walkthrough drives focus via `element.focus()` + synthetic keydown rather than trusted key events (`userEvent.keyboard`). Real-key coverage arrives naturally with the Playwright E2E suite (task 013) — worth including a real-Tab traversal there.
- If a site overrides `--cookyay-z`, banner and modal resolve to the same z-index (different fallbacks only); DOM append order keeps the modal on top, but a one-line docs note (task 018) would prevent surprise.
