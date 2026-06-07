---
id: "014"
title: Accessibility CI (axe + keyboard + equal-prominence)
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["013"]
prd_refs:
  - "goals.md §Acceptance bar (keyboard/screen-reader smoke)"
  - "prd.md §3.1"
arch_refs:
  - "architecture.md §11 Cross-cutting (Accessibility tooling)"
research_refs:
  - "research/accessibility-specialist.md §Recommendations"
  - "research/compliance-and-legal.md §Recommendations 4"
  - "research/domain-expert-cmp.md §Recommendations 7"
acceptance_criteria:
  - "@axe-core/playwright runs against banner, preferences modal, and GPC toast states with zero violations at WCAG 2.2 AA"
  - "Scripted keyboard-only walkthrough passes: Tab into banner, activate Manage preferences, verify focus trap (Tab cycles inside modal), toggle a switch, Escape closes without saving, focus returns to invoker"
  - "Equal-prominence test compares computed styles of Accept-all vs Reject-all in the default theme and fails on divergence (compliance rec 4)"
  - "All checks run in the PR-to-main CI job and pass"
created: 2026-06-06
---

## Task
Encode the accessibility and dark-pattern bars as CI checks so they can't regress: axe scans of all three UI surfaces, a keyboard-navigation script, and the equal-prominence computed-style assertion that makes the CNIL/EDPB compliance line mechanical.

## Implementation notes
- Reuse the Playwright harness and fixture pages from 013.
- axe can't catch focus-trap correctness — that's why the keyboard script is separate.

## Out of scope
Manual screen-reader testing (stays a release-checklist item in 020), VPAT publication (not committed for v1).

## Implementation summary
**Files changed:**
- `packages/scanner/e2e/accessibility.spec.ts` — new spec with 12 tests across three suites: axe WCAG 2.2 AA scans, keyboard-only walkthrough, and equal-prominence computed-style assertion
- `packages/scanner/package.json` — added `@axe-core/playwright ^4.11.3` devDependency
- `.github/workflows/pr.yml` — added `accessibility` job that runs `playwright test e2e/accessibility.spec.ts` on every PR to main

**Acceptance criteria check:**
- [x] `@axe-core/playwright` runs against banner, preferences modal, and GPC toast states with zero violations at WCAG 2.2 AA — `accessibility.spec.ts:37` (banner), `:50` (modal), `:63` (GPC toast); all include `wcag22aa` tag
- [x] Scripted keyboard-only walkthrough passes: Tab into banner (`accessibility.spec.ts:89`), activate Manage preferences (`accessibility.spec.ts:114`), verify focus trap Tab-cycles inside modal (`accessibility.spec.ts:127`), toggle a switch (`accessibility.spec.ts:184`), Escape closes without saving (`accessibility.spec.ts:199`), focus returns to invoker (`accessibility.spec.ts:199` — asserts `[data-cookyay-manage]` is focused after close)
- [x] Equal-prominence test compares computed styles of Accept-all vs Reject-all in the default theme and fails on divergence — `accessibility.spec.ts:259`; checks 13 CSS properties including `background-color`, `color`, `font-size`, `font-weight`, all padding and border values
- [x] All checks run in PR-to-main CI job and pass — `pr.yml` `accessibility` job runs `pnpm --filter @cookyay/scanner exec playwright test e2e/accessibility.spec.ts`

**Tests:** `pnpm --filter @cookyay/scanner exec playwright test e2e/accessibility.spec.ts` — 12 passed; full suite: `pnpm --filter @cookyay/scanner exec playwright test` — 36 passed

**Notes for verifier:** The axe scans use `.include()` to scope to each UI surface individually so unrelated fixture-site issues don't pollute the check. The equal-prominence test checks computed styles (not class names), so it catches any theme override that creates visual disparity between the two buttons. The focus-trap test verifies `modal.contains(document.activeElement)` after tabbing through all focusable elements, confirming no escape.

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All four criteria verified against the actual spec and source; 12/12 accessibility tests and 36/36 full e2e suite pass on independent re-run; implementation matches architecture §11 and all three research refs.
**Acceptance criteria check:**
- [x] axe WCAG 2.2 AA, zero violations on banner / preferences modal / GPC toast — `packages/scanner/e2e/accessibility.spec.ts:37,50,63`; tags include `wcag2a/2aa/21a/21aa/22aa` (correct cumulative set for "2.2 AA"); `.include()` scoping to each surface is appropriate; all three pass on re-run
- [x] Keyboard-only walkthrough — focus moves into banner on mount (`:89`, matches `banner.ts:447` and a11y research rec 3), Tab cycle (`:98`), Enter opens modal (`:114`), focus trap forward wrap (`:127`) AND backward Shift+Tab wrap (`:164`), Space toggles switch via `aria-checked` (`:184`), Escape closes without saving + focus returns to `[data-cookyay-manage]` invoker (`:199`). The no-consent assertion checks the `cookyay_consent` cookie, which is the authoritative store (`consent/storage.ts:129` — "No cookie → no valid consent"), so it is not vacuous. Bonus: Escape-on-banner never dismisses or records consent (`:230`, research rec 7)
- [x] Equal-prominence computed-style test — `:259`; compares 13 prominence-determining properties (font, padding, borders, colors) and fails with a per-property divergence diff; correctly excludes width (varies with text length). Satisfies compliance rec 4
- [x] CI integration — `pr.yml:110-144` `accessibility` job runs `playwright test e2e/accessibility.spec.ts` on `pull_request → main`, with browser caching mirroring the e2e job. Command verified green locally; an actual CI run is unverifiable (repo has no commits/remote yet — pre-017), config-level pass
**Tests:** 12/12 accessibility spec; 36/36 full e2e suite (`pnpm --filter @cookyay/scanner exec playwright test`)
**Non-blocking cleanup for a future pass:** `accessibility.spec.ts:144-161` contains leftover debug scaffolding — `activeId`/`activeDataAttr` are computed via two extra `page.evaluate` round-trips then `void`-ed with a "suppress unused variable" comment. The real assertion (`modal.contains(document.activeElement)`) follows; delete the dead block. Also note the `accessibility` CI job re-runs a spec the `e2e` job already covers (`playwright test` runs all specs) — intentional as a named gate, but worth a `--grep`-style split later if CI minutes matter.
