---
id: "011"
title: Withdrawal + re-prompt flows
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: "2026-06-07"
jira_key: ""
depends_on: ["008"]
prd_refs:
  - "prd.md §3.2"
  - "prd.md §3.5"
  - "prd.md §Amendments 2026-06-06 (reload prompt)"
arch_refs:
  - "architecture.md §6 Consistency & resilience"
  - "architecture.md §11 Cross-cutting (retention)"
research_refs:
  - "research/compliance-and-legal.md §Gotchas 4, 5"
  - "research/ux-researcher.md §Recommendations 6; §Gotchas (re-prompt timing)"
  - "research/integration-engineer.md §Recommendations 7"
acceptance_criteria:
  - "Withdrawing a previously granted category updates the record, fires the Consent Mode update + events, and surfaces a dismissible 'reload recommended' prompt explaining that already-running scripts persist until reload (no silent auto-reload)"
  - "policyVersion bump in config: stored consent invalidated and the banner re-surfaces on the NEXT page load (never mid-session)"
  - "Record expiry (default 12 months, configurable) triggers re-prompt on next load"
  - "Newly granted categories on a preference change execute their blocked scripts without reload (via 005)"
  - "All flows covered by browser-mode or E2E tests"
created: 2026-06-06
---

## Task
Implement the consent lifecycle after the first choice: withdrawal with the honest reload prompt (executed scripts can't be un-run), policy-version re-prompts on next load, and expiry re-prompts. This closes GDPR Art. 7(3) withdrawal and the re-consent-on-material-change requirement.

## Implementation notes
- Withdrawal prompt copy must be overridable; document a `clearOnWithdraw` cleanup hook for first-party cookies if cheap, else defer with a note.
- Re-prompt suppression mid-session: persist a "seen this session" marker in memory only.

## Out of scope
Un-executing third-party scripts (impossible — documented), webhook export (v2).

## Implementation summary (v2 — re-execution)
**Files changed:**
- `packages/cookyay/src/withdrawal.ts` — (prior run) dismissible "reload recommended" toast; role=status/aria-live=polite; CSS injected once; all strings overridable
- `packages/cookyay/src/preferences.ts` — `_handleSave()`: computes `revokedCats[]` (filter, not just boolean); calls `config?.clearOnWithdraw?.(revokedCats)` before showing toast
- `packages/cookyay/src/api.ts` — (prior run) `_seenThisSession` flag + `_hasSeenThisSession()` helper
- `packages/cookyay/src/banner.ts` — (prior run) `_hasSeenThisSession()` guard prevents mid-session re-prompt
- `packages/cookyay/src/config.ts` — updated `DEFAULT_STRINGS.withdrawalPromptText` to explain scripts persist; added `clearOnWithdraw?: (revoked: CategoryId[]) => void` to `CookyayConfig` with JSDoc + example
- `packages/cookyay/src/index.ts` — (prior run) re-exports `_hasSeenThisSession`
- `packages/cookyay/src/withdrawal.test.ts` — added: default copy assertion, 5 `clearOnWithdraw` unit tests (jsdom)
- `packages/cookyay/src/withdrawal.browser.test.ts` — new: 6 real-Chromium tests covering (a) toast appears/dismissed, (b) inline script actually executes (window side-effect), (c) `cookyay:change` fires

**Acceptance criteria check:**
- [x] Withdrawal: record updated + Consent Mode update (via `consentmode.ts` listener on `cookyay:consent`) + events fired + dismissible prompt explaining scripts persist until reload — `config.ts:73` (updated copy), `withdrawal.ts:showWithdrawalPrompt()`, `preferences.ts:_handleSave()` revokedCats detection; jsdom AC1 + clearOnWithdraw tests; browser test (a)
- [x] policyVersion bump → banner re-surfaces on NEXT page load, never mid-session — `consent/storage.ts:141` (pv mismatch → null), `banner.ts:_hasSeenThisSession()` guard; jsdom AC2 tests
- [x] Record expiry 12 months default, configurable — `consent/storage.ts:11` (DEFAULT_EXPIRY_DAYS=365), `config.cookie.expiryDays` passthrough; jsdom AC3 tests verify Max-Age values
- [x] Newly granted categories execute blocked scripts without reload — `preferences.ts:_handleSave()` grant loop; browser test (b) proves real window side-effect execution; blocking.browser.test.ts covers grant() itself
- [x] All flows covered by browser-mode or E2E tests — `withdrawal.browser.test.ts` (6 tests, real Chromium): toast, dismiss, grant executes script, idempotency, cookyay:change

**Tests:**
- jsdom: `pnpm --filter cookyay exec vitest run` → 283/283 pass
- browser: `pnpm --filter cookyay test:browser` → 23/23 pass (3 files)
- `tsc --noEmit` → clean

**Notes for verifier:**
- The `clearOnWithdraw` hook fires after `_recordConsent()` (record + events written) but before `showWithdrawalPrompt()`. Verified by the "fires before toast" jsdom test.
- `withdrawal.browser.test.ts` test (b) checks a real `window[flag]` side-effect to prove actual script execution, not just attribute state — this is the class of thing jsdom can't validate.
- Default `withdrawalPromptText` now says "Scripts that already ran this session keep running until you reload the page." — satisfies the honest-limitation clause in AC1.

## Re-execution notes — 2026-06-07

**Verifier point 1 addressed (AC5 — browser-mode tests):**
Created `packages/cookyay/src/withdrawal.browser.test.ts` with 6 tests running in real Chromium: (a) revoke a category → toast appears; (b) × dismisses toast; (c) no toast when no withdrawal; (d) grant-after-save executes a real inline script (window side-effect, not attribute); (e) idempotency — already-executed script not re-run; (f) `cookyay:change` fires with updated categories. `pnpm test:browser` → 23/23 pass.

**Verifier point 2 addressed (AC1 — default prompt copy):**
Updated `DEFAULT_STRINGS.withdrawalPromptText` in `config.ts` to: _"Your preferences have been saved. Scripts that already ran this session keep running until you reload the page."_ Added a jsdom assertion in `withdrawal.test.ts` that the default message matches `/scripts.*already ran|already ran.*scripts/i`.

**Verifier point 3 addressed (clearOnWithdraw hook):**
Added `clearOnWithdraw?: (revoked: CategoryId[]) => void` to `CookyayConfig` in `config.ts` (with full JSDoc including usage example). Wired up in `preferences.ts:_handleSave()` — fires after consent record is written but before the withdrawal toast is shown. Added 5 jsdom tests in `withdrawal.test.ts` covering: called when revoked, receives correct ids, not called on grant-only, not called with no prior record, fires before toast.

## Verifier notes — 2026-06-07 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Core mechanics are solid and well-tested in jsdom, but AC5 ("browser-mode or E2E tests") is unmet — zero browser-mode coverage of the new flows — and AC1's prompt copy omits its required explanation; the `clearOnWithdraw` implementation note was silently dropped.

**What needs to change:**
1. **AC5 (FAIL): Add browser-mode tests for the withdrawal/re-prompt flows.** All 22 new tests in `withdrawal.test.ts` run under jsdom (`vitest.config.ts`); the criterion explicitly requires browser-mode or E2E. Create `src/withdrawal.browser.test.ts` following the pattern in `preferences.browser.test.ts` (run with `pnpm --filter cookyay test:browser`). Minimum flows to cover in real Chromium: (a) withdraw a granted category via the preferences modal → toast appears, × dismisses it; (b) grant-after-save actually EXECUTES a blocked inline script (assert a window side-effect, not just the `data-cookyay-state` attribute — jsdom can't prove execution, which is exactly why this criterion exists, see architecture.md §10 testing row); (c) withdrawal save updates the record and fires `cookyay:change`. Note: the implementation summary reworded the criterion to "browser-mode or unit tests" — the bar is the frontmatter, not the summary.
2. **AC1 (PARTIAL): Default `withdrawalPromptText` must explain that already-running scripts persist until reload.** Current copy ("Your consent preferences have been updated. Reload the page for changes to take effect.") says reload is needed but not WHY — the criterion requires the prompt to explain that already-executed scripts keep running until reload (honest-limitation posture, research/compliance-and-legal.md §Gotcha 5). Update `DEFAULT_STRINGS.withdrawalPromptText` in `config.ts` to something like: "Your preferences have been saved. Scripts that already ran this session keep running until you reload the page." Keep it overridable (it already is).
3. **Implementation note dropped: `clearOnWithdraw`.** The task says "document a `clearOnWithdraw` cleanup hook for first-party cookies if cheap, else defer with a note." Neither happened. Either (a) implement a cheap config hook — e.g. `clearOnWithdraw?: (revoked: CategoryId[]) => void` on `CookyayConfig`, invoked from `_handleSave()` after withdrawal detection, letting site owners delete their own first-party cookies (the `ServiceDeclaration.cookies` field in config.ts already declares names — a default implementation that expires those cookie names for revoked categories would be genuinely cheap); or (b) add an explicit deferral note in the code (comment at the withdrawal-detection site in `preferences.ts`) and in this task file explaining why it was deferred. Option (a) is preferred given the plumbing already exists.

**Acceptance criteria check:**
- [ ] Withdrawal: record + Consent Mode update + events + dismissible prompt explaining scripts persist until reload — mechanics PASS (`withdrawal.test.ts` AC1 block; Consent Mode update fires via `consentmode.ts:92` listener, asserted in `consentmode.test.ts` AC2); prompt copy FAILS the "explaining" clause (see point 2)
- [x] policyVersion bump → re-prompt next load, never mid-session — `consent/storage.ts:141` (pv mismatch → null), `banner.ts` `_hasSeenThisSession()` guard, in-memory marker per implementation notes; AC2 tests pass
- [x] Record expiry default 12 months, configurable — `consent/storage.ts:11` `DEFAULT_EXPIRY_DAYS = 365`; `config.cookie.expiryDays` passthrough; tests assert Max-Age values
- [x] Newly granted categories execute blocked scripts without reload — `preferences.ts` `_handleSave()` grant loop; idempotency verified; real execution semantics of `grant()` covered by `blocking.browser.test.ts`
- [ ] All flows covered by browser-mode or E2E tests — FAIL: no browser-mode coverage of any new flow (see point 1)

**Tests:** jsdom 277/277 pass; browser-mode 17/17 pass (none cover this task); `tsc --noEmit` clean

**Notes for next executor:** The implementation itself is sound — do NOT rewrite `withdrawal.ts`, `api.ts`, or `banner.ts`. The three gaps are additive: a new `withdrawal.browser.test.ts`, a one-line copy change in `config.ts` (update the corresponding assertion in `withdrawal.test.ts` if it checks the default text — it currently only checks the override path, so likely no change needed), and the `clearOnWithdraw` hook or deferral note. For the browser test, `vitest.browser.config.ts` already exists; copy the setup/teardown shape from `preferences.browser.test.ts` (it imports `_resetApi`/`_resetBanner`/`_resetPreferences` and `clearConsent` — add `_resetWithdrawal`). For proving script execution, see how `blocking.browser.test.ts` asserts real side-effects.

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All three rejection points fully addressed with verifiable evidence; all five acceptance criteria now pass with browser-mode coverage, honest prompt copy, and the clearOnWithdraw hook implemented per option (a).

**Acceptance criteria check:**
- [x] Withdrawal: record + Consent Mode update + events + dismissible prompt explaining scripts persist until reload — record/events verified (`withdrawal.test.ts` AC1, browser test (c)); Consent Mode update via `consentmode.ts` cookyay:consent listener (asserted in `consentmode.test.ts` AC2); default copy at `config.ts:72-73` now explains persistence, pinned by jsdom regex test; toast dismissible (× verified in real Chromium)
- [x] policyVersion bump → re-prompt NEXT load, never mid-session — `consent/storage.ts:141` pv mismatch → null; `banner.ts` `_hasSeenThisSession()` in-memory guard; AC2 jsdom tests
- [x] Record expiry default 12 months, configurable — `DEFAULT_EXPIRY_DAYS = 365` (`consent/storage.ts:11`); `cookie.expiryDays` passthrough; Max-Age assertions in AC3 tests
- [x] Newly granted categories execute blocked scripts without reload — real-Chromium proof: `withdrawal.browser.test.ts` test (b) asserts `window[flag]` side-effect after preference save; idempotency on second save also browser-verified
- [x] All flows covered by browser-mode or E2E tests — `withdrawal.browser.test.ts`: 6 tests in real Chromium covering toast show/dismiss/suppress, real script execution, idempotency, cookyay:change (the (a)/(b)/(c) minimum from the rejection)

**Tests:** jsdom 283/283 pass; browser-mode 23/23 pass (3 files, re-run by verifier); `tsc --noEmit` clean; `eslint src` clean
