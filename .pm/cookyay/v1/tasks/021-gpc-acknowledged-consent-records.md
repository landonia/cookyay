---
id: "021"
title: Persist explicit post-GPC consent choices (GPC-acknowledged records)
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: "2026-06-07"
jira_key: ""
depends_on: ["009", "013"]
prd_refs:
  - "prd.md §3.3"
  - "prd.md §Amendments 2026-06-07 (GPC override must not stomp explicit post-GPC choices)"
arch_refs:
  - "architecture.md §1 Deployment topology (bootstrap GPC detect)"
research_refs:
  - "research/compliance-and-legal.md §Recommendations 3"
  - "research/ux-researcher.md §Gotchas (GPC vs stored consent)"
acceptance_criteria:
  - "With GPC live, saving explicit choices via the banner or preferences modal writes a GPC-acknowledged record (gpc:true); after reload those choices persist (granted categories replay), the banner stays suppressed, and the toast is NOT re-shown"
  - "A record written without GPC live is still overridden by a live GPC signal on page load (009 AC2 unchanged) and the toast shows exactly once"
  - "Unit tests cover both paths; Playwright e2e regression covers save-prefs-under-GPC → reload → choices persist, no repeat toast"
  - "CI gates green: tsc --noEmit, eslint, vitest, Playwright, size-limit (<20KB combined)"
created: 2026-06-07
---

## Task
Fix the dogfood-found bug where `_runGpc()` stomps explicit user choices made after
the GPC opt-out was applied (Brave: saved Cookie-settings choices forgotten on
every reload). Refine the `gpc` flag's semantics from "record written by GPC policy"
to "record written with GPC accounted for": any record written while GPC is live is
marked `gpc:true`, so `_runGpc()`'s `alreadyGpc` check skips it on subsequent loads.

Repro (Brave or any GPC-enabled browser):
1. Load → GPC applied, denied record with `gpc:true` written, toast shown.
2. Open Cookie settings, grant a category, save → record written with `gpc:false`
   (`api.ts:_recordConsent` default param).
3. Reload → `_runGpc()` sees `gpc !== true`, treats the explicit choice as a stale
   pre-GPC grant, overwrites with all-denied + `gpc:true`, re-shows the toast.

Legal basis: CCPA §7025(c)(2) permits a consumer's explicit subsequent consent to
override the GPC signal — persisting the post-GPC choice is the compliant behavior.

## Implementation notes
- Core change is in `_recordConsent` (api.ts): compute live GPC at write time and
  pass `gpc || gpcLive` to `buildConsentRecord`. Mirror the typed window cast used
  in `gpc.ts:141` (`window.__COOKYAY?.gpc`).
- Update the policy header comment in `gpc.ts` (lines 8–12) to document the refined
  semantics and the CCPA §7025(c)(2) basis.
- No schema change — readers of `record.gpc` are only `_runGpc()`'s `alreadyGpc`
  check and storage serialization (`consent/storage.ts`).
- Existing 009 unit tests (AC2 group) must keep passing — pre-GPC stale grants are
  still overridden.

## Out of scope
Task 020's dogfood report update (the Brave re-test is recorded there); ESM-without-
bootstrap GPC fallback (009 verifier's non-blocking observation — still deferred).

## Implementation summary
**Files changed:**
- `packages/cookyay/src/api.ts` — `_recordConsent()`: compute `gpcLive` from `window.__COOKYAY?.gpc` at write time; pass `gpc || gpcLive` as `effectiveGpc` to `buildConsentRecord`. This marks every record written while GPC is active as `gpc:true`, preventing `_runGpc()` from overriding explicit post-GPC user choices on subsequent loads.
- `packages/cookyay/src/gpc.ts` — Updated policy header comment (lines 1–20) to document the refined GPC semantics and the CCPA §7025(c)(2) basis for honouring explicit post-GPC choices.
- `packages/cookyay/src/gpc.test.ts` — Added AC2x test group (4 new tests): `_recordConsent` written while GPC live produces `gpc:true`; explicit choices survive a simulated reload (no override, no repeat toast); pre-GPC stale grants still overridden; explicit denial while GPC live also preserved.
- `packages/scanner/e2e/flows.spec.ts` — Added Playwright regression test `GPC visitor: explicit preference choices persist after reload (task 021)`: enables GPC → first visit (toast shown, banner suppressed) → opens Cookie settings via `#cookyay-reopen` → grants analytics → saves → verifies cookie has `gpc:true` and `c.a:true` → reloads → confirms no repeat toast, banner suppressed, analytics choice preserved.

**Acceptance criteria check:**
- [x] With GPC live, saving preferences writes a GPC-acknowledged record (`gpc:true`); after reload choices persist, banner suppressed, toast NOT re-shown — `gpc.test.ts` AC2x group (4 tests); Playwright test `flows.spec.ts:269`
- [x] A record written without GPC live is still overridden by a live GPC signal (AC2 unchanged) — `gpc.test.ts` "pre-GPC stale grant still overridden" (line ~370); all original AC2 tests (3) still pass
- [x] Unit tests cover both paths; Playwright e2e regression covers save-prefs-under-GPC → reload → choices persist, no repeat toast — 293/293 unit tests pass; 11/11 Playwright `flows.spec.ts` pass
- [x] CI gates green: tsc --noEmit (clean), eslint (clean), vitest 293/293, Playwright 11/11, size-limit 9.21 KB gzip (under 20 KB combined budget)

**Tests:** `npx vitest run` (293 tests) · `pnpm -F @cookyay/scanner exec playwright test e2e/flows.spec.ts` (11 tests)

**Notes for verifier:**
- The fix is a 4-line change in `_recordConsent` (api.ts): compute `gpcLive` from the `window.__COOKYAY.gpc` flag the bootstrap sets synchronously, then `effectiveGpc = gpc || gpcLive`. No schema change — `record.gpc` was already stored; the change is only in when `gpc:true` is written.
- The original AC2 ("live GPC overrides stale stored grant") is preserved: a record with `gpc:false` still triggers `alreadyGpc === false` in `_runGpc()` → gets overridden. Only records written with `gpc:true` (either by `_runGpc()` itself or by `_recordConsent` while GPC live) are left intact.
- The window type cast in `_recordConsent` mirrors exactly the one already used in `gpc.ts:141` — no new type unsafe code.
- Rebuild required before Playwright tests: `pnpm build` in `packages/cookyay` (Playwright tests against `dist/`; unit tests use Vite transforms so no rebuild needed for unit tests).

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Fix is minimal, correct, and matches the PRD amendment exactly; all four acceptance criteria verified with independently re-run gates, plus an extra verifier-run behavioral check confirming granted categories actually replay (script re-executes) after reload under live GPC.

**Acceptance criteria check:**
- [x] GPC live + explicit save → gpc:true record; choices persist on reload, banner suppressed, no repeat toast — `api.ts:296-301` (`effectiveGpc = gpc || gpcLive`); unit AC2x group (4 tests, `gpc.test.ts:279-374`); Playwright `flows.spec.ts:269` (cookie `gpc:true` + `c.a:true` before AND after reload, toast/banner absent after reload)
- [x] Record written without GPC live still overridden; toast exactly once — AC2x "pre-GPC stale grant is still overridden" (`gpc.test.ts:333`); original AC2 group (3 tests) + AC3 group (3 tests) unchanged and passing; e2e "second visit does not re-show GPC toast" passing
- [x] Unit + Playwright coverage of both paths — 27 tests in `gpc.test.ts` (4 new), 11/11 in `flows.spec.ts` (1 new regression test)
- [x] CI gates green — independently re-ran: `tsc --noEmit` clean · `eslint src` clean · vitest 293/293 · Playwright 11/11 · size-limit 9.21 KB gzip combined (<20 KB), bootstrap 493 B (<1 KB)

**Tests:** vitest 293/293 · Playwright flows 11/11 · all re-run by verifier, not taken from the summary.

**Cross-checks:**
- Scope: only `api.ts` (4-line semantic change + comment), `gpc.ts` header comment, and the two test files — no drift; dogfood-report update correctly left to task 020.
- Architecture: no stack/topology change; the `window.__COOKYAY` cast mirrors the existing `gpc.ts:141` pattern (architecture.md §1 bootstrap GPC detect respected).
- Research: ux-researcher gotcha ("stored consent does not override a live GPC signal") preserved for records written without GPC knowledge; CCPA §7025(c)(2) basis for explicit-subsequent-consent documented in both the code comment and the PRD amendment.
- Verifier behavioral check (scratch Playwright run, then deleted): after explicit grant under GPC + reload, `__analyticsInlineRan === true` (replay works) and marketing script stays `data-cookyay-state="blocked"`.

**Non-blocking suggestion (future work, not a rejection ground):** the committed e2e regression test verifies persistence via the cookie payload; adding one assertion that `window.__analyticsInlineRan === true` after reload would also pin the "(granted categories replay)" clause of criterion 1 in CI permanently.
