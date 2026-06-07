---
id: "010"
title: Google Consent Mode v2 integration
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: "2026-06-07"
jira_key: ""
depends_on: ["004", "006"]
prd_refs:
  - "prd.md §3.4"
  - "prd.md §Amendments 2026-06-06 (defaults denied for all)"
arch_refs:
  - "architecture.md §1 Deployment topology"
  - "architecture.md §13 Open questions (wait_for_update)"
research_refs:
  - "research/integration-engineer.md §Recommendations 1, 2, 3"
  - "research/ux-researcher.md §Gotchas (gtag ordering)"
acceptance_criteria:
  - "Deterministic seven-signal map implemented: necessary → functionality_storage + security_storage always granted; functional → personalization_storage; analytics → analytics_storage; marketing → ad_storage + ad_user_data + ad_personalization (documented in code and docs)"
  - "gtag('consent','update', …) fires on every consent change (accept/reject/granular/withdrawal/GPC) with the correct signal map — asserted via dataLayer inspection in unit tests, no real Google scripts loaded"
  - "Defaults are denied for ALL visitors (set by bootstrap); update path never fires before the default exists"
  - "wait_for_update is configurable with default 500 (closes architecture.md §13 item)"
  - "GTM Custom HTML workaround is written up (doc page or doc stub committed) covering the Sandbox API race"
created: 2026-06-06
---

## Task
Wire banner state to Google Consent Mode v2: the explicit seven-signal category map, update calls on every state change, and the documented GTM workaround. Defaults already fire in the bootstrap (004); this task owns the mapping logic and update lifecycle.

## Implementation notes
- Test by asserting dataLayer push shapes (test-strategist tier 1) — stub gtag the way GTM defines it.
- Version the mapping module so Consent Mode API drift (prd §7 risk) is isolated to one file.

## Out of scope
A published GTM .tpl template (v2, architecture §12), loading any real Google script in tests.

## Implementation summary
**Files changed:**
- `packages/cookyay/src/consentmode.ts` — new versioned module: seven-signal map (`buildConsentModeSignals`), `applyConsentModeUpdate`, and a `cookyay:consent` event listener that fires the update on every `_recordConsent` call; test-only `_resetConsentMode` export
- `packages/cookyay/src/snippet.ts` — added `buildInlineSnippet(waitForUpdate = 500)` generator; `INLINE_SNIPPET_JS` derived from it (backward compat preserved); closes architecture §13
- `packages/cookyay/src/index.ts` — side-effect import `'./consentmode.js'`; re-exports `buildInlineSnippet`, `buildConsentModeSignals`, `applyConsentModeUpdate`, `ConsentModeSignals`, `ConsentSignalValue`
- `packages/cookyay/src/consentmode.test.ts` — 35 tests: AC1 full signal-map coverage (all combos), AC2 dataLayer update assertions (accept/reject/granular/GPC/sequential/no-gtag no-op), AC3 defaults-only assertion, AC4 wait_for_update configurability
- `docs/gtm-workaround.md` — GTM Custom HTML workaround doc covering the Sandbox API race (step-by-step setup, signal map table, known limitation note)

**Acceptance criteria check:**
- [x] Deterministic seven-signal map — `consentmode.ts:43-56` (`buildConsentModeSignals`), map documented in module header and `docs/gtm-workaround.md §Signal map reference`; AC1 tests cover all four category combinations
- [x] `gtag('consent','update', …)` fires on every consent change — `_handleConsentEvent` at `consentmode.ts:68` wired to `cookyay:consent`; `_recordConsent` in `api.ts:256` dispatches that event on every write (accept/reject/granular/GPC); AC2 tests assert dataLayer shapes; no real Google scripts loaded
- [x] Defaults denied for ALL visitors; update never fires before default — `snippet.ts` generates all-denied `gtag('consent','default',...)` snippet; AC3 test "update never fires before _recordConsent is called" confirms no update on `init()` alone
- [x] `wait_for_update` configurable with default 500 — `buildInlineSnippet(waitForUpdate = 500)` in `snippet.ts:18`; AC4 tests verify default and custom values; architecture §13 closed
- [x] GTM Custom HTML workaround doc — `docs/gtm-workaround.md` covering Sandbox API race, step-by-step Custom HTML tag code, ordering requirements, and signal map reference

**Tests:** `pnpm vitest run` → 251/251 pass · `tsc --noEmit` clean · `eslint src` clean

**Notes for verifier:**
- The `cookyay:consent` listener approach means the update fires for GPC-triggered consent writes too (since `gpc.ts` calls `_recordConsent`, which dispatches `cookyay:consent`) — no special GPC wiring needed
- `_resetConsentMode()` detaches and re-attaches the named `_handleConsentEvent` listener; this prevents multiple listener accumulation across tests while keeping the module functional after teardown
- `buildInlineSnippet` is re-exported from `index.ts` so integrators can generate custom snippets without importing snippet.ts directly
- The event listener is registered at import time (module side-effect); the side-effect import in `index.ts` ensures it's live when the UI bundle loads

## Re-execution notes — 2026-06-07
**Verifier note 1 addressed:** `src/consentmode.ts` — replaced `window.gtag` direct access (which relied on `bootstrap.ts`'s `declare global` not present in tsup's isolated DTS program) with an inline cast `(window as Window & { gtag?: (...args: unknown[]) => void }).gtag`, matching the `gpc.ts:141` pattern. `pnpm -r build` now completes all four artifacts including DTS; `dist/index.d.ts` regenerated at 11.40 KB.
**Verifier note 2 addressed:** `docs/gtm-workaround.md` — complete rewrite: removed the contradictory "avoids the race" claim; accurately describes the v1 posture (page-level `gtag('consent','update')` from the bundle + `wait_for_update` window, outside GTM's queue — Google's standard Advanced Consent Mode pattern); demoted the Custom HTML tag to an optional diagnostic tool with a `console.debug` + dataLayer event push (not a second `gtag update` call, avoiding the duplicate); added v2 roadmap note about `.tpl` + Sandbox API.

## Verifier notes — 2026-06-07 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All five ACs pass functionally and the unit/typecheck/lint gates are green, but `pnpm build` (tsup) fails in the DTS step with 2 type errors in `consentmode.ts` — this breaks the CI build gate (`ci.yml` build-lint-test job runs `pnpm -r build` on every push) and left `dist/index.d.ts` missing.

**What needs to change:**
1. `src/consentmode.ts:69-70` — TS2339 `Property 'gtag' does not exist on type 'Window & typeof globalThis'` during `tsup` DTS build. Root cause: `applyConsentModeUpdate` uses `window.gtag` directly, relying on the `declare global` augmentation in `bootstrap.ts` — but tsup's DTS build for the `index` entry compiles an isolated program that does NOT include `bootstrap.ts` (it's a separate entry), so the augmentation is absent. `tsc --noEmit -p .` passes only because the project tsconfig includes all of `src/`. Fix: follow the pattern `gpc.ts:141` already uses for `window.__COOKYAY` — a local inline cast, e.g.:
   ```ts
   const gtag = (window as Window & { gtag?: (...args: unknown[]) => void }).gtag
   if (typeof gtag !== 'function') return
   gtag('consent', 'update', buildConsentModeSignals(categories))
   ```
   (A module-local `declare global` would also work but duplicates the bootstrap declaration; the cast matches existing repo convention.)
2. Doc fix while you're in there — `docs/gtm-workaround.md` has an internal contradiction: "Why a workaround is needed" claims the Custom HTML approach "avoids the race", while "Known limitation" correctly admits it's still dataLayer-queued. Also note the Step 2 Custom HTML tag is functionally redundant: the Cookyay bundle's own `consentmode.ts` listener already fires the identical `gtag('consent','update')` on `cookyay:consent`, so the GTM tag adds a duplicate update, not a fix. Rework the doc to be honest about the v1 posture: the page-level `gtag('consent','update')` from the bundle + `wait_for_update` window is the v1 mechanism (this is Google's standard "advanced consent mode" pattern for GTM); the Custom HTML tag should be presented as optional/diagnostic, or use the `google_tag_data.iac.push(...)` mechanism that research/integration-engineer.md §Recommendations 2 names as the actual queue-bypassing workaround.
3. Re-verify with: `pnpm -r build` (must complete all four artifacts incl. DTS — confirm `dist/index.d.ts` regenerates), `npx tsc --noEmit -p packages/cookyay/tsconfig.json` (clean), `npx eslint packages/cookyay/src` (clean), `npx vitest run` (251 tests green).

**Acceptance criteria check:**
- [x] Deterministic seven-signal map — `consentmode.ts:45-58`; documented in module header + `docs/gtm-workaround.md` §Signal map reference; AC1 test group covers accept-all/reject-all/granular combos + exactly-seven-keys
- [x] update fires on every consent change via dataLayer inspection — listener `consentmode.ts:77-97` on `cookyay:consent`; `api.ts:256` dispatches that event on EVERY `_recordConsent` (single authoritative write path, so future withdrawal in task 011 inherits it); AC2 tests assert dataLayer shapes for accept/reject/granular/GPC/sequential; gtag stubbed GTM-style, no real Google scripts
- [x] Defaults denied for all visitors; update never before default — snippet all-denied (`snippet.ts:23-31`); AC3 test "update never fires before _recordConsent is called" passes
- [x] wait_for_update configurable, default 500 — `buildInlineSnippet(waitForUpdate = 500)` `snippet.ts:18`, exported from `index.ts:3`; AC4 tests cover default + 1000 + 300; `INLINE_SNIPPET_JS` backward-compat preserved (bootstrap.test.ts still passes)
- [x] GTM workaround doc committed covering the Sandbox API race — `docs/gtm-workaround.md` (quality issues noted in point 2 above; criterion as written is met)

**Tests:** vitest 251/251 pass · tsc --noEmit clean · eslint clean · size ~8.7KB combined min+gzip (under 20KB budget) · **`pnpm build` FAILS (DTS step, 2 × TS2339)**

**Notes for next executor:**
- Only `src/consentmode.ts` (the `applyConsentModeUpdate` body) and `docs/gtm-workaround.md` need touching. The signal map, snippet generator, index.ts exports, and all 35 tests are correct — do not refactor them.
- The test file `consentmode.test.ts` assigns `window.gtag` directly (its own stub), which works because the test program includes `bootstrap.ts` globals — tests will keep passing after the cast fix as long as `applyConsentModeUpdate` still reads `window.gtag` at call time, not import time.
- After the fix, run `pnpm -r build` from the repo root and confirm tsup completes ESM + DTS + both IIFE entries; the prior failed run deleted `dist/index.d.ts` (clean ran before DTS errored), so a successful rebuild is also the cleanup.
- Non-blocking future-work observations (do NOT address in this task):
  - The compiled `dist/bootstrap.js` artifact hardcodes `wait_for_update: 500` (`bootstrap.ts:51`); only the snippet-generator path is configurable. If a self-hosted bootstrap.js consumer needs a custom window, that's a v2 config surface — architecture §13 is satisfied by `buildInlineSnippet`.
  - architecture.md §13 still lists wait_for_update as an open question; consider an amendment closing it now that the decision (configurable via `buildInlineSnippet`, default 500) is implemented — same pattern as task 009's toast-container resolution.

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Both rejection points fixed exactly as prescribed (call-time inline cast for `window.gtag` matching the `gpc.ts` convention; honest doc rewrite with the Custom HTML tag demoted to diagnostic-only) — full CI gate now green including the previously broken `pnpm -r build` DTS step.
**Acceptance criteria check:**
- [x] Deterministic seven-signal map, documented in code and docs — `consentmode.ts:45-58`; module header + `docs/gtm-workaround.md` §Signal map reference; AC1 test group (all category combos + exactly-seven-keys)
- [x] update fires on every consent change via dataLayer inspection, no real Google scripts — listener wired to `cookyay:consent` which `api.ts:256` dispatches on every `_recordConsent` (single write path; withdrawal in task 011 inherits it); AC2 tests cover accept/reject/granular/GPC/sequential
- [x] Defaults denied for ALL visitors; update never before default — all-denied snippet `snippet.ts:23-31`; AC3 "no update on init alone" test passes
- [x] wait_for_update configurable, default 500 — `buildInlineSnippet(waitForUpdate = 500)` `snippet.ts:18`, exported from index.ts; AC4 tests (default/1000/300 + INLINE_SNIPPET_JS backward compat); closes architecture §13
- [x] GTM workaround doc covering the Sandbox API race — `docs/gtm-workaround.md` rewritten: v1 Advanced Consent Mode posture, load-order requirement, diagnostic Custom HTML tag, v2 .tpl roadmap
**Tests:** vitest 251/251 pass · `pnpm -r build` exit 0 (DTS regenerates `dist/index.d.ts`, 11.4 KB, new exports present) · tsc --noEmit clean · eslint clean · ~8.7KB combined min+gzip (under 20KB budget)
