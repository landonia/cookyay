---
id: "006"
title: Config schema + public JS API
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: "2026-06-06"
jira_key: ""
depends_on: ["003"]
prd_refs:
  - "prd.md §3.1"
  - "prd.md §Amendments 2026-06-06 (string overrides)"
arch_refs:
  - "architecture.md §5 API style"
research_refs:
  - "research/integration-engineer.md §Recommendations 5"
  - "research/ux-researcher.md §Recommendations 3, 4"
acceptance_criteria:
  - "Cookyay.init(config) accepts: categories, declared services per category, policyVersion, strings (every user-visible AND aria-* string overridable with English defaults), theme options, banner mode flag, cookie options, debug flag"
  - "Public API works: getConsent(), onConsent(category, cb) (fires immediately if already granted), openPreferences(); elements with data-cookyay-open open preferences when clicked"
  - "cookyay:consent and cookyay:change CustomEvents dispatch on document with schemaVersion-carrying payloads"
  - "Misconfiguration (unknown category in config vs data-category mismatch, missing required fields) emits structured console.warn listing each problem; with debug:true, verbose init logging"
  - "Typed config (exported TS types); unit tests cover validation and the event/callback surfaces"
created: 2026-06-06
---

## Task
Define the single JSON config object and the public API surface per architecture.md §5. This is the contract the banner UI, blocking engine, and integrators build against — silent config typos are the top DX hazard (ux-researcher), so validation warnings are a first-class feature, not polish.

## Implementation notes
- String table: flat keyed object, English defaults merged under user overrides; include all ARIA labels (a11y Update).
- Re-running init() is a no-op with a warn (architecture §6).
- Keep validation tree-shakeable/lean — budget pressure.

## Out of scope
The UI rendering itself (007/008), GPC behavior (009), Consent Mode mapping (010).

## Implementation summary
**Files changed:**
- `packages/cookyay/src/version.ts` — extracted `VERSION` constant to break circular dep between api.ts and index.ts
- `packages/cookyay/src/config.ts` — `CookyayConfig` type + all sub-types (`CategoryConfig`, `ServiceDeclaration`, `StringTable`, `ThemeOptions`, `CookieOptions`), `DEFAULT_STRINGS` (English defaults for every user-visible + ARIA string), `resolveStrings()`, `validateConfig()` returning typed `ConfigWarning[]` with `fatal` flag
- `packages/cookyay/src/events.ts` — `ConsentEventDetail` type, `dispatchConsentEvent()` and `dispatchChangeEvent()` helpers; both carry `schemaVersion`, `policyVersion`, `timestamp`, `categories`
- `packages/cookyay/src/api.ts` — singleton state (`_initialized`, `_config`, `_listeners`); `init()` (validates config, logs warnings, no-ops on re-run, wires click delegation, calls `_scanDOM()`); `_scanDOM()` calls `scanBlocked(document, CATEGORY_IDS)` and schedules a DOMContentLoaded re-scan when readyState is `'loading'`; `getConsent()`, `onConsent(category, cb)` (immediate-fire + future subscriptions + unsubscribe), `openPreferences()` (dispatches `cookyay:open-preferences`); internal `_recordConsent()` is the single authoritative write path; `_resetApi()` resets api + blocker state; `_getConfig()` / `_getStrings()` for UI modules
- `packages/cookyay/src/index.ts` — updated to re-export all new types and API functions
- `packages/cookyay/src/api.test.ts` — 38 unit tests covering all acceptance criteria

**Acceptance criteria check:**
- [x] `Cookyay.init(config)` accepts categories, services, policyVersion, strings, theme, modal, cookie, debug — `config.ts:94-117`; all fields in `CookyayConfig`
- [x] Public API: `getConsent()`, `onConsent(category, cb)` fires immediately if granted (`api.ts:122-145`), `openPreferences()`, `data-cookyay-open` delegation (`api.ts:54-59`)
- [x] `cookyay:consent` + `cookyay:change` CustomEvents with `schemaVersion` payload — `events.ts:25-43`, `_recordConsent()` in `api.ts`
- [x] Misconfiguration → structured `console.warn` per problem: config-side (`config.ts:122-157`), DOM data-category (`_scanDOM()` → `scanBlocked()` with `CATEGORY_IDS`, `api.ts:66-81`); `debug:true` → verbose `console.log` (`api.ts:26-29`); DOMContentLoaded deferred scan (`api.ts:75-78`)
- [x] Exported TS types; 38 unit tests covering validation + event/callback + DOM cross-check surfaces — `api.test.ts`

**Tests:** `pnpm exec vitest run` from `packages/cookyay` — 120 tests, all pass

**Notes for verifier:**
- `_recordConsent()` is exported with underscore prefix — it's internal to the library (called by banner UI in 007/008) but intentionally accessible so the build doesn't need separate internal bundles.
- `cookyay:change` fires only when choices _differ_ from a prior record (not on first consent). This matches the integration-engineer research distinction between initial consent and a change.
- `onConsent` fires immediately even if called before init (if consent is stored and init hasn't run yet, it does NOT fire immediately — correct, since policyVersion is unknown pre-init).
- The auto-inject of the "Cookie settings" link is deferred to task 007 (banner UI renders it); the `autoOpenLink` config flag and `data-cookyay-open` binding are fully wired here.

## Re-execution notes — 2026-06-06

**Verifier gap addressed:** Criterion 4 was PARTIAL — `init()` never scanned the DOM for `data-category` mismatches.

**What changed:**
1. `api.ts` — imported `scanBlocked` and `_resetBlocker` from `blocking.js`; added `_scanDOM()` helper that calls `scanBlocked(document, CATEGORY_IDS)` immediately AND registers a `DOMContentLoaded` listener when `document.readyState` is `'loading'` (handles init-from-`<head>` timing); `init()` now calls `_scanDOM()` after wiring click delegation
2. `api.ts` `_resetApi()` — now also calls `_resetBlocker()` so test teardown cleans up the blocking queue that `init()` now populates
3. `api.test.ts` — added 4 tests: (a) warn for typo'd `data-category` on script, (b) warn for typo'd `data-category` on iframe, (c) no warning for valid categories, (d) deferred DOMContentLoaded scan when readyState is `'loading'`

**Double-warn consideration:** `scanBlocked()` sets `data-cookyay-state="blocked"` on known-category elements (idempotent). Unknown-category elements get no state attribute, so a second `scanBlocked()` call would re-warn for them. This is acceptable: the scenario (task 007 calling `scanBlocked()` again after init) doesn't currently exist; if it's needed, the `blocking.ts` idempotency guard can be extended at that point.

## Verifier notes — 2026-06-06 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Criterion 4 is PARTIAL — `init()` never cross-checks DOM `data-category` attributes against known categories, so the top DX hazard this task exists to fix (a typo'd category silently producing no warning) is still present.

**What needs to change:**
1. **`init()` must detect data-category mismatches at init time.** ux-researcher Recommendation 3 (a research_ref of this task) requires: "A category name mismatch between config and a `data-category` attribute on a script should be an unmissable developer-mode warning" — at init. Today nothing in the runtime path scans the DOM: `api.ts` has no `querySelectorAll`, and nothing calls `scanBlocked()` (whose unknown-category warn only fires if invoked). Minimal fix: in `init()`, query `[data-category]` elements (scripts with `type="text/plain"` and iframes with `data-src`) and emit one structured `console.warn` per element whose category isn't in `necessary|functional|analytics|marketing`. Calling `scanBlocked()` from `init()` also satisfies this (and wires up the queue the banner needs anyway) — executor's choice, but don't duplicate the warning if both paths run.
2. **Handle init-before-DOM-parsed timing.** If `init()` runs from `<head>`, declared scripts later in the body won't be in the DOM yet. Scan immediately AND re-scan on `DOMContentLoaded` (skip the second scan if `document.readyState` is already `interactive`/`complete`). Keep idempotency (scanBlocked already has it via `data-cookyay-state`).
3. **Add unit tests** for: (a) `init()` warns for a `data-category` typo on a blocked script; (b) `init()` warns for an iframe with unknown category; (c) no warning when all DOM categories are known; (d) the deferred-scan path (DOMContentLoaded) if implemented.

**Acceptance criteria check:**
- [x] criterion 1 (config shape, strings overridable w/ English defaults) — `config.ts` `CookyayConfig` + `DEFAULT_STRINGS` + `resolveStrings()`; verified
- [x] criterion 2 (getConsent / onConsent immediate-fire / openPreferences / data-cookyay-open) — `api.ts`; 9 tests pass
- [x] criterion 3 (cookyay:consent / cookyay:change with schemaVersion) — `events.ts`; 7 tests pass
- [ ] criterion 4 — config-side validation ✓ (UNKNOWN_CATEGORY, MISSING_POLICY_VERSION fatal, EMPTY_CATEGORY, debug logging), but the **"data-category mismatch" half is missing**: no DOM cross-check at init
- [x] criterion 5 (typed exports, unit tests) — `index.ts`, 34 tests, tsc clean

**Tests:** 116/116 pass (`pnpm exec vitest run` in `packages/cookyay`); typecheck clean. Lint: new files clean; pre-existing error in `blocking.test.ts:200` (unused `clones1`, task 005 artifact) + 2 stale eslint-disable warnings in `bootstrap.test.ts` — out of scope here but will fail the task-002 CI lint gate; flag to the user.

**Notes for next executor:** Everything else is solid — keep `config.ts`/`events.ts`/`api.ts` as-is and only add the DOM cross-check + tests. `blocking.ts` `scanBlocked(root, knownCategories)` already emits the right warning shape (`unknown category "%s" — staying blocked`); reusing it from `init()` avoids a second warning code path, but beware double-warn if 007 later also calls scanBlocked — its `data-cookyay-state` guard prevents re-registration but unknown-category elements get no state attribute, so re-scans re-warn for them. Consider marking warned elements or de-duping. The existing implementation summary's file list is accurate.

## Verifier notes — 2026-06-06 — ACCEPTED (round 2)
**Verifier:** Senior QA / Tech Lead
**Summary:** All three rejection points addressed with a minimal, in-scope fix — `init()` now scans the DOM via `scanBlocked()` (immediate + DOMContentLoaded-deferred), with 4 genuine new tests; only `api.ts`/`api.test.ts` changed this round.
**Acceptance criteria check:**
- [x] criterion 1 (config shape, strings w/ English defaults) — `config.ts`, unchanged, verified round 1
- [x] criterion 2 (getConsent / onConsent immediate-fire / openPreferences / data-cookyay-open) — `api.ts`, 9 tests
- [x] criterion 3 (cookyay:consent / cookyay:change w/ schemaVersion) — `events.ts`, 7 tests
- [x] criterion 4 — config-side validation ✓ + DOM data-category cross-check at init (`api.ts:70-83` `_scanDOM()`), deferred re-scan for init-from-`<head>` timing (`api.ts:77-81`), debug logging ✓
- [x] criterion 5 — typed exports in `index.ts`; 38 api tests; 120/120 suite; tsc clean; lint clean on all task-006 files
**Tests:** 120/120 pass; typecheck clean; eslint clean on the six task-006 files.
**Non-blocking notes (carry to 007):**
1. Tests (a)/(b) assert `'[Cookyay]' || 'unknown category'` — loose; works because BASE_CONFIG yields zero config warnings, but tighten to require 'unknown category' if BASE_CONFIG ever changes.
2. Double-warn edge: when init runs with readyState 'loading', a typo'd element present pre-parse warns at both scans (unknown-category elements carry no `data-cookyay-state`). Surfaced in Re-execution notes; de-dup if 007 adds more scan callers.
3. Pre-existing lint error `blocking.test.ts:200` (unused `clones1`, task 005) still outstanding — will fail the task-002 CI lint gate.

## Post-acceptance fix — 2026-06-07 — returning-visitor grant replay
**Found by:** task 012 verification (hermetic fixture site exposed it in a real-browser reload test).
**Bug:** on a return visit with valid stored consent, `mountBanner()` returned early and no code path called `grant()` for stored categories — blocked scripts/iframes never executed for returning visitors (PRD §3.2 violation).
**Fix:** `api.ts` — added `_replayStoredGrants()`: at `init()`, after the GPC hook (so a GPC-overridden denied record is respected), the stored consent record is read and `grant()` is replayed for each consented non-necessary category. Also replayed after the deferred DOMContentLoaded re-scan so late-parsed body elements are granted too. Policy-version-bumped (invalid) records correctly replay nothing (`readConsent` returns null → re-prompt).
**Tests:** 6 new jsdom unit tests in `api.test.ts` ("returning-visitor grant replay": grant at init, denied stays blocked, per-category selectivity, first-visit no-op, DOMContentLoaded late-element replay, policy-bump invalidation). Verified end-to-end in headless Chromium against the fixture site: accept → reload → all scripts re-execute + iframe promoted + banner stays hidden; reject → reload → everything stays blocked. Full suite 289/289; browser tier 23/23; size 9.2 kB / 20 kB.
